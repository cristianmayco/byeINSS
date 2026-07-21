// src/shared/scraper-contratos.js
//
// Parsers PUROS para extração de vencimento médio de contratos e tipo de
// reajuste a partir de HTML do Investidor10 (I10). PRD 12 sub-PR 3.
//
// Estes parsers NÃO tocam Electron, BrowserWindow, fetch, better-sqlite3.
// Recebem strings HTML brutas e devolvem objetos normalizados. Isso permite:
//   - testar com fixtures estáticas em src/__tests__/fixtures/*.html
//   - reusar entre scraper Electron (sub-PR 3) e scraper CLI/test
//   - validar regressões quando o I10 muda layout
//
// Contrato de saída canônico:
//   {
//     vencimento_medio_contratos:      'YYYY-MM-DD' | null,
//     vencimento_medio_contratos_meses: number | null,
//     tipo_reajuste:                   'IGPM'|'IPCA'|'FIXO'|'MISTO'|'OUTRO'|null,
//     reajuste_percentual:             number | null,
//     vencimento_medio_origem:         'main'|'comunicado'|'fallback'|null,
//     dy_medio_5a:                     number | null,
//     confianca:                       'alta'|'media'|'baixa'|'nenhuma'
//   }
//
// `confianca` é heurística baseada em quantos sinais casaram:
//   'alta'   → vencimento E tipo_reajuste parseados
//   'media'  → apenas um deles
//   'baixa'  → texto encontrado mas parse parcial (ex.: só "IGPM" sem contexto)
//   'nenhuma'→ nada parseado
//
// Quando dois formatos conflitam (data vs meses), `vencimento_medio_contratos`
// tem precedência (canônico no schema, RF-001 PRD 12).

'use strict';

const { parseTipoReajuste } = require('./contratos.js');

// ===== regex e padrões =====

// dd/mm/yyyy (com ou sem zeros à esquerda).
const DATE_BR_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
// "36 meses", "36 meses.", "≈ 36 meses", "36 m" — captura inteira simples.
const MESES_RE = /(\d{1,3})\s*(?:meses?|mês|mes|m)\b/i;
// "3 anos", "5 anos e meio" — converte para meses (1 ano = 12 meses).
const ANOS_RE = /(\d{1,2}(?:[.,]\d+)?)\s*anos?/i;
// Meses escondidos em texto como "Vencimento em 36 meses" — captura mais ampla.
const VENCIMENTO_LABEL_RE = /(?:vencimento|prazo|duração|vencer|expira)[^.\n]{0,80}/i;
// Faixas tipo "12 a 24 meses" — pega o valor MAIOR (conservador).
const FAIXA_RE = /(\d{1,3})\s*(?:a|até|to|-)\s*(\d{1,3})\s*meses?/i;
// Tipos de reajuste — variantes comuns do I10 (case-insensitive).
const TIPO_RE = /\b(IGP[\s-]?M|IPCA(?:\s*\+\s*\d+(?:[.,]\d+)?\s*%?)?|FIXO(?:\s+\d+(?:[.,]\d+)?\s*%?)?|INPC|IPC[\s-]?FIPE|MISTO)\b/i;

// ===== helpers de normalização =====

function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function brNumberToFloat(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[^\d,.\-]/g, '');
  if (!cleaned) return null;
  // Formato BR: 1.234,56 → 1234.56
  // Sem vírgula: 1234 ou 1234.56 → mantém
  if (cleaned.includes(',')) {
    return Number(cleaned.replace(/\./g, '').replace(',', '.')) || null;
  }
  return Number(cleaned) || null;
}

/**
 * Converte 'dd/mm/yyyy' em 'YYYY-MM-DD'. Retorna null se inválido.
 */
function parseDateBR(text) {
  const m = String(text ?? '').match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!m) return null;
  const [_, dd, mm, yyyy] = m;
  const d = Number(dd);
  const mo = Number(mm);
  const y = Number(yyyy);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Validar data real (rejeita 2026-02-30).
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${yyyy}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Extrai número de meses de um texto livre.
 * Suporta:
 *   "36 meses" → 36
 *   "3 anos" → 36
 *   "3,5 anos" → 42
 *   "12 a 24 meses" → 24 (conservador)
 *   "≈ 36 m" → 36
 *   null se nada encontrado
 */
function parseMesNumber(text) {
  const t = String(text ?? '');
  const faixa = t.match(FAIXA_RE);
  if (faixa) return Number(faixa[2]);
  const anos = t.match(ANOS_RE);
  if (anos) {
    const n = Number(String(anos[1]).replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * 12) : null;
  }
  const meses = t.match(MESES_RE);
  if (meses) {
    const n = Number(meses[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Detecta tipo de reajuste em texto livre do I10.
 *
 * Função PURA — se o texto mencionar um índice conhecido, retorna o tipo
 * canônico. A responsabilidade de isolar o trecho relevante é do caller
 * (parseContratoFromMainHTML usa extractTipoReajusteText para isso,
 * garantindo que "IPCA" mencionado na descrição de CRIs não seja
 * capturado por engano).
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {boolean} [opts.requireContext=false]  se true, exige label de
 *      contexto (use true quando o caller NÃO isolou o trecho).
 * @returns {{ tipo: string|null, percentual: number|null, texto_original: string|null }}
 */
function parseTipoReajusteI10(text, opts = {}) {
  const { requireContext = false } = opts;
  const t = normalizeText(text);
  if (!t) return { tipo: null, percentual: null, texto_original: null };

  if (requireContext) {
    const hasContext =
      /(?:reajuste|índice(?:\s+de\s+(?:reajuste|correção|atualização))?|correção(?:\s+(?:anual|monetária))?|indexador|atualização(?:\s+(?:anual|monetária|contratual))?|cláusula\s+(?:de\s+)?reajuste)/i.test(t);
    if (!hasContext) {
      return { tipo: null, percentual: null, texto_original: text };
    }
  }

  // MISTO tem precedência: se houver mais de um índice canônico no texto,
  // é MISTO. Cobre "parte IGP-M, parte IPCA", "IGP-M e IPCA" etc.
  const canonicos = [];
  if (/\bIGP[\s-]?M\b/i.test(t)) canonicos.push('IGPM');
  if (/\bIPCA\b/i.test(t)) canonicos.push('IPCA');
  if (canonicos.length >= 2) {
    return { tipo: 'MISTO', percentual: null, texto_original: text };
  }
  // MISTO explícito também bate.
  if (/\bMISTO\b/i.test(t) || /\bMISTURADO\b/i.test(t)) {
    return { tipo: 'MISTO', percentual: null, texto_original: text };
  }

  // FIXO com percentual. Self-describing: "Fixo 3%" ou "Fixo 3,5% a.a."
  // ou "3% a.a. fixo". Não aceitamos "N% a.a." sozinho — pode ser
  // "IGPM + 1% a.a." que é IGP-M com sufixo, não FIXO.
  const fixoMatch =
    t.match(/\bFIXO\s+(\d{1,2}(?:[.,]\d+)?)\s*%(?:\s*(?:A\.?A\.?|AO\s*ANO|ANUAL))?/i) ||
    t.match(/(\d{1,2}(?:[.,]\d+)?)\s*%\s*(?:A\.?A\.?|AO\s*ANO|ANUAL)\s+(?:FIXO|FIXA)/i);
  if (fixoMatch) {
    const pct = brNumberToFloat(fixoMatch[1]);
    if (Number.isFinite(pct) && pct >= 0 && pct <= 100) {
      return { tipo: 'FIXO', percentual: pct, texto_original: text };
    }
  }

  // Mapeamento I10 → canônico (single index).
  if (canonicos[0] === 'IGPM') {
    return { tipo: 'IGPM', percentual: null, texto_original: text };
  }
  if (canonicos[0] === 'IPCA') {
    return { tipo: 'IPCA', percentual: null, texto_original: text };
  }
  if (/\bFIXO\b/i.test(t)) {
    return { tipo: 'FIXO', percentual: null, texto_original: text };
  }
  // Índices não-canônicos viram OUTRO.
  if (/\bINPC\b|\bIPC[\s-]?FIPE\b|\bINPC[\s-]?M\b/i.test(t)) {
    return { tipo: 'OUTRO', percentual: null, texto_original: text };
  }
  // Texto não-canonônico: NÃO delegamos para parseTipoReajuste() porque ele
  // retorna OUTRO para qualquer texto não-vazio (over-eager). Retornamos null
  // e deixamos o caller decidir se quer persistir como OUTRO ou não.
  return { tipo: null, percentual: null, texto_original: text };
}

/**
 * Calcula confiança baseada em quantos campos foram parseados.
 */
function deriveConfidence(parsed) {
  const temVencimento = Boolean(parsed.vencimento_medio_contratos) ||
    Number.isFinite(parsed.vencimento_medio_contratos_meses);
  const temTipo = Boolean(parsed.tipo_reajuste);
  if (temVencimento && temTipo) return 'alta';
  if (temVencimento || temTipo) return 'media';
  return 'nenhuma';
}

/**
 * Parser principal: extrai vencimento + tipo de reajuste do HTML da página
 * individual do FII no I10 (/fiis/{ticker}/).
 *
 * Heurística multi-seletor (PRD 12 RF-007):
 *   1. Procura blocos "Sobre" / "Informações" / "Contratos" / "Reajuste"
 *   2. Lê texto próximo a labels "Vencimento", "Prazo", "Reajuste", "Índice"
 *   3. Tenta tabelas estruturadas (label, valor) dentro do bloco
 *   4. Fallback: scan global do HTML (menos confiável, marca origem='fallback')
 *
 * @param {string} html   HTML cru da página
 * @returns {object}      payload canônico (nunca lança)
 */
function parseContratoFromMainHTML(html) {
  const payload = emptyPayload('main');
  if (typeof html !== 'string' || !html.trim()) return payload;

  // 1. Estratégia primária: extrai bloco "Contratos/Reajuste" ou "Sobre".
  //    Quando não há bloco isolado, caímos no HTML inteiro já stripped
  //    (evita capturar ".vencimento" de regras CSS, scripts inline, etc.).
  const sobreBlock = extractSobreBlock(html);
  const text = sobreBlock || stripTags(html);

  // 2. Vencimento: data ou meses — APENAS próximo a label explícita de
  //    vencimento. Evita falso positivo em "DY 5 anos" (BCFF11) ou
  //    "taxa 12 meses" (VINO11 descrição da taxa de administração).
  const vencLabel = text.match(VENCIMENTO_LABEL_RE);
  if (vencLabel) {
    const trecho = vencLabel[0];
    const data = parseDateBR(trecho);
    const meses = parseMesNumber(trecho);
    if (data) {
      payload.vencimento_medio_contratos = data;
    } else if (Number.isFinite(meses)) {
      payload.vencimento_medio_contratos_meses = meses;
    }
  }

  // 3. Tipo de reajuste — duas estratégias:
  //    a) FIXO self-describing: "Fixo 3,5% a.a." — match direto sem contexto.
  //       Tem precedência porque é unambiguous (evita confundir "Fixo 3,5%"
  //       com "Índice de correção: IPCA" na mesma página).
  //    b) Context-based: extractTipoReajusteText acha "Reajuste/Índice/Correção"
  //       e parseTipoReajusteI10 extrai o índice canônico.
  let tipoText = null;
  const fixoSelf = text.match(/\bFixo\s+\d{1,2}(?:[.,]\d+)?\s*%[^.\n]{0,40}/i);
  if (fixoSelf) tipoText = fixoSelf[0];
  if (!tipoText) {
    tipoText = extractTipoReajusteText(text);
  }
  if (tipoText) {
    const tipoParsed = parseTipoReajusteI10(tipoText);
    if (tipoParsed.tipo) {
      payload.tipo_reajuste = tipoParsed.tipo;
      payload.reajuste_percentual = tipoParsed.percentual;
    }
  }

  // 4. DY médio 5 anos — padrão único, varre HTML inteiro (costuma estar
  //    em bloco "Indicadores", separado de "Contratos/Reajuste").
  const dy5a = extractDyMedio5a(html);
  if (Number.isFinite(dy5a)) payload.dy_medio_5a = dy5a;

  // Se não houve bloco isolado e nada parseado, marca origem como fallback
  // para sinalizar baixa confiança (UI mostra empty state com explicação).
  if (!sobreBlock && (payload.tipo_reajuste || payload.vencimento_medio_contratos ||
      payload.vencimento_medio_contratos_meses)) {
    payload.vencimento_medio_origem = 'fallback';
  }

  payload.confianca = deriveConfidence(payload);
  return payload;
}

/**
 * Parser de Comunicado (fallback). Recebe HTML da página
 * /fiis/{ticker}/comunicados/ (ou já fatiado para o comunicado mais recente).
 *
 * @param {string} html
 * @param {string} [comunicadoDate]  data do comunicado (YYYY-MM-DD), preferida se houver.
 */
function parseContratoFromComunicadoHTML(html, comunicadoDate) {
  const payload = emptyPayload('comunicado');
  if (typeof html !== 'string' || !html.trim()) return payload;

  const text = htmlToText(html);
  // Procura referência a vencimento no texto do comunicado.
  const vencMatch = text.match(VENCIMENTO_LABEL_RE);
  const trecho = vencMatch ? vencMatch[0] : text;
  const data = parseDateBR(trecho);
  const meses = parseMesNumber(trecho);

  if (data) {
    payload.vencimento_medio_contratos = data;
  } else if (Number.isFinite(meses)) {
    payload.vencimento_medio_contratos_meses = meses;
  }

  // Para Comunicados, o texto já é o trecho relevante — desabilita a checagem
  // de contexto. Comunicados do I10 falam de reajuste sem repetir "Reajuste:" toda hora.
  const tipoParsed = parseTipoReajusteI10(text, { requireContext: false });
  if (tipoParsed.tipo) {
    payload.tipo_reajuste = tipoParsed.tipo;
    payload.reajuste_percentual = tipoParsed.percentual;
  }

  // Marca data de coleta do comunicado se informada.
  if (comunicadoDate) payload.vencimento_medio_coletado_em = comunicadoDate;
  payload.confianca = deriveConfidence(payload);
  return payload;
}

/**
 * Última linha de defesa: scan global do HTML, marca origem='fallback'.
 */
function parseContratoFromFallbackHTML(html) {
  const payload = emptyPayload('fallback');
  if (typeof html !== 'string' || !html.trim()) return payload;
  const text = htmlToText(html);

  const data = parseDateBR(text);
  const meses = parseMesNumber(text);
  if (data) payload.vencimento_medio_contratos = data;
  else if (Number.isFinite(meses)) payload.vencimento_medio_contratos_meses = meses;

  // Fallback global também passa o texto todo como trecho relevante.
  const tipoParsed = parseTipoReajusteI10(text, { requireContext: false });
  if (tipoParsed.tipo) {
    payload.tipo_reajuste = tipoParsed.tipo;
    payload.reajuste_percentual = tipoParsed.percentual;
  }
  payload.confianca = deriveConfidence(payload);
  return payload;
}

// ===== helpers internos =====

function emptyPayload(origem) {
  return {
    vencimento_medio_contratos: null,
    vencimento_medio_contratos_meses: null,
    tipo_reajuste: null,
    reajuste_percentual: null,
    vencimento_medio_origem: origem || null,
    dy_medio_5a: null,
    vencimento_medio_coletado_em: null,
    confianca: 'nenhuma'
  };
}

/**
 * Tenta isolar o bloco "Contratos/Reajuste" (preferido) ou "Sobre/Informações"
 * do HTML. Retorna innerText-ish do bloco, ou null se não achar.
 *
 * Ordem de preferência:
 *   1. <section> / <div> com id/class contendo "contrato" ou "reajuste"
 *   2. <section> / <div> com id/class contendo "sobre" ou "informações"
 *   3. Bloco de texto após <h2>/<h3> com esses termos
 *
 * A preferência por "contratos/reajuste" é importante: a página do I10
 * costuma ter um bloco "Sobre o fundo" ANTES do bloco "Contratos e Reajuste",
 * e queremos pular direto para o que tem os dados que importam.
 */
function extractSobreBlock(html) {
  const patterns = [
    // 1. Bloco contratos/reajuste (preferido).
    /<section[^>]*(?:id|class)=["'][^"']*(?:contrat[oa]s?|reajuste)[^"']*["'][^>]*>([\s\S]*?)<\/section>/i,
    /<div[^>]*(?:id|class)=["'][^"']*(?:contrat[oa]s?|reajuste)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    // 2. Bloco sobre/informações (fallback).
    /<section[^>]*(?:id|class)=["'][^"']*(?:sobre|informações?|informacoes)[^"']*["'][^>]*>([\s\S]*?)<\/section>/i,
    /<div[^>]*(?:id|class)=["'][^"']*(?:sobre|informações?|informacoes)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    // 3. Header h1-h6 + conteúdo seguinte. Inclui o texto do header no bloco.
    /(<h[1-6][^>]*>\s*(?:Contratos?|Reajuste|Sobre|Informações?)[^<]*<\/h[1-6]>)([\s\S]*?)(?=<h[1-6]|<footer|<\/section|<\/body)/i
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      // Pattern #5 captura header (m[1]) + body (m[2]). Outros capturam só body (m[1]).
      return stripTags((m[2] !== undefined ? m[1] + ' ' + m[2] : m[1]));
    }
  }
  return null;
}

function extractTipoReajusteText(text) {
  // Procura trecho em torno de rótulos que introduzem o tipo de reajuste.
  // Ordem de especificidade: rótulos compostos primeiro, depois simples.
  const patterns = [
    /(?:índice\s+de\s+(?:reajuste|correção|atualização)|correção\s+(?:anual|monetária)|indexador\s+(?:de\s+)?(?:reajuste|correção)|cláusula\s+(?:de\s+)?reajuste)/i,
    /(?:reajuste\s+(?:anual|contratual|de\s+aluguel)|atualização\s+(?:anual|monetária|contratual))/i,
    /(?:reajuste|índice|correção|indexador|atualização)\b/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      // Captura um trecho de até 80 chars a partir do match para
      // levar o nome do índice junto (ex.: "Índice IGP-M anual").
      const start = m.index;
      const end = Math.min(text.length, start + 80);
      return text.slice(start, end);
    }
  }
  return null;
}

function extractDyMedio5a(text) {
  // "DY 5 anos" / "Dividend Yield 5 anos" / "Yield Médio 5 anos"
  const m = text.match(/(?:dy|dividend\s+yield|yield\s+m[eé]dio)\s*(?:5\s*anos?|5a|5\s*years?)[^.\n]{0,30}?(\d{1,2}(?:[.,]\d+)?)\s*%/i);
  if (!m) return null;
  return brNumberToFloat(m[1]);
}

function stripTags(s) {
  return String(s ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlToText(html) {
  return stripTags(html);
}

module.exports = {
  parseContratoFromMainHTML,
  parseContratoFromComunicadoHTML,
  parseContratoFromFallbackHTML,
  parseTipoReajusteI10,
  parseDateBR,
  parseMesNumber,
  brNumberToFloat,
  normalizeText
};
