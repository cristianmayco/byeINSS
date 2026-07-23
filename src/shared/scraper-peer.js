// src/shared/scraper-peer.js
//
// Parser PURO do box "Média Tipo/Segmento" do Investidor10 para PRD 04
// (Comparador vs Média do Segmento).
//
// Não toca Electron, BrowserWindow, fetch, better-sqlite3. Recebe HTML
// bruto e devolve snapshot canônico.
//
// Contrato de saída:
//   {
//     snapshot_valido:    boolean,
//     pvp_medio_segmento: number|null,
//     dy_medio_segmento: number|null,
//     pl_medio_segmento: number|null,
//     vpa_medio_segmento:number|null,
//     peer_grupo_nome:   string|null,
//     peer_grupo_tipo:   'SEGMENTO'|'TIPO'|'NAO_INFORMADO'|null,
//     avisos:            string[]
//   }

'use strict';

// ===== helpers de normalização =====

function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function brNumberToFloat(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Captura sinal opcional
  let sinal = 1;
  if (s.startsWith('-')) { sinal = -1; s = s.slice(1); }

  // Sufixos BR de escala (RF-004). Captura o último token e normaliza
  // para evitar match de "mil" dentro de "milhões".
  let multiplicador = 1;
  const tokens = s.split(/\s+/);
  const lastToken = tokens[tokens.length - 1];
  if (lastToken) {
    const norm = lastToken.toLowerCase()
      .replace(/ões/g, 'oes')
      .replace(/ão/g, 'ao');
    if (norm === 'milhoes' || norm === 'milhao') multiplicador = 1e6;
    else if (norm === 'bilhoes' || norm === 'bilhao' || norm === 'bi') multiplicador = 1e9;
    else if (norm === 'mil') multiplicador = 1e3;
    if (multiplicador !== 1) {
      tokens.pop();
      s = tokens.join(' ').trim();
    }
  }

  // Remove R$, %, espaços
  s = s.replace(/r\$\s?/gi, '').replace(/%/g, '').replace(/\s+/g, '');
  if (!s) return null;

  // Detecta formato BR: 1.234,56 → 1234.56   ou   12,34 → 12.34
  let n;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
    n = Number(s);
  } else {
    n = Number(s);
  }

  if (!Number.isFinite(n)) return null;
  return sinal * n * multiplicador;
}

// ===== localização do box =====

function extrairBlocoPeer(html) {
  if (!html || typeof html !== 'string') return null;

  const TITULO_RE = /<h[1-6][^>]*>\s*(?:m[ée]dia(?:\s+do)?\s+(?:tipo(?:\s*\/\s*segmento)?|segmento(?:\s*\/\s*tipo)?))\s*<\/h[1-6]>([\s\S]*?)(?=<(?:section|aside)\b|<\/section|<\/aside|<\/body|$)/i;

  const m = html.match(TITULO_RE);
  if (!m) return null;

  return m[1]
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|li|td)>/gi, '\n')
    .replace(/<\/span>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function detectarTipoGrupo(html) {
  if (!html || typeof html !== 'string') return 'NAO_INFORMADO';
  const m = html.match(/<h[1-6][^>]*>\s*(m[ée]dia[^<]*)<\/h[1-6]>/i);
  if (!m) return 'NAO_INFORMADO';
  const titulo = normalizeText(m[1]);
  if (/media\s+do\s+tipo/.test(titulo) && !/segmento/.test(titulo)) return 'TIPO';
  if (/media\s+do\s+segmento/.test(titulo) && !/tipo/.test(titulo)) return 'SEGMENTO';
  return 'NAO_INFORMADO';
}

function extrairNomeGrupo(html) {
  if (!html || typeof html !== 'string') return null;
  const m = html.match(/(?:segmento|tipo)\s*:\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\/&,-]{2,40})/i);
  if (!m) return null;
  return m[1].trim();
}

// ===== parser principal =====

function parseBenchmarkSegmento(html) {
  const avisos = [];
  const out = {
    snapshot_valido: false,
    pvp_medio_segmento: null,
    dy_medio_segmento: null,
    pl_medio_segmento: null,
    vpa_medio_segmento: null,
    peer_grupo_nome: null,
    peer_grupo_tipo: 'NAO_INFORMADO',
    avisos
  };

  const bloco = extrairBlocoPeer(html);
  if (!bloco) {
    avisos.push('BOX_NAO_ENCONTRADO');
    return out;
  }

  out.peer_grupo_tipo = detectarTipoGrupo(html);
  out.peer_grupo_nome = extrairNomeGrupo(html);

  // Quebrar em linhas e procurar cada label.
  const linhas = bloco.split(/\n+/).map(l => l.trim()).filter(Boolean);

  const LABELS = [
    { key: 'pvp_medio_segmento',  patterns: [/^p\s*\/\s*vp\b/i, /^p\/vp\b/i] },
    { key: 'dy_medio_segmento',   patterns: [/^dividend\s+yield\s*12\s*m(eses)?\b/i, /^dy\s*12\s*m\b/i, /^yield\s*12\s*m\b/i, /^dividend\s+yield\b/i] },
    { key: 'pl_medio_segmento',   patterns: [/^valor\s+patrimonial(\s+total)?\b/i, /^patrim[oô]nio\s+l[ií]quido\b/i, /^pl\b/i] },
    { key: 'vpa_medio_segmento',  patterns: [/^vpa\b/i, /^valor\s+patrimonial\s+por\s+cota\b/i, /^vp\s*\/\s*cota\b/i] }
  ];

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    // Ignora linha que parece ser "Segmento:" ou "Tipo:" (informação de grupo)
    if (/^(segmento|tipo)\s*:/i.test(linha)) continue;

    for (const { key, patterns } of LABELS) {
      if (out[key] !== null) continue;
      for (const pat of patterns) {
        if (pat.test(linha)) {
          // Tenta extrair valor da MESMA linha após o label.
          let resto = linha.replace(pat, '').replace(/^[\s:]+/, '').trim();
          let v = brNumberToFloat(resto);

          // Se não há valor na mesma linha, tenta a PRÓXIMA.
          if (!Number.isFinite(v) && i + 1 < linhas.length) {
            const prox = linhas[i + 1];
            // Só consome a próxima linha se for valor puro (não é outro label).
            const proxEhOutroLabel = LABELS.some(o =>
              o.patterns.some(p => p.test(prox))
            ) || /^(segmento|tipo)\s*:/i.test(prox);
            if (!proxEhOutroLabel) {
              v = brNumberToFloat(prox);
              if (Number.isFinite(v)) {
                // marca próxima linha como "consumida" pulando-a
                i++;
              }
            }
          }

          if (Number.isFinite(v)) {
            out[key] = v;
            break;
          }
        }
      }
    }
  }

  out.snapshot_valido =
    Number.isFinite(out.pvp_medio_segmento) && out.pvp_medio_segmento > 0 &&
    Number.isFinite(out.dy_medio_segmento) && out.dy_medio_segmento >= 0 &&
    Number.isFinite(out.pl_medio_segmento) && out.pl_medio_segmento >= 0 &&
    Number.isFinite(out.vpa_medio_segmento) && out.vpa_medio_segmento > 0;

  if (!out.snapshot_valido) {
    if (!Number.isFinite(out.pvp_medio_segmento) || out.pvp_medio_segmento <= 0) avisos.push('PVP_AUSENTE');
    if (!Number.isFinite(out.dy_medio_segmento) || out.dy_medio_segmento < 0) avisos.push('DY_AUSENTE');
    if (!Number.isFinite(out.pl_medio_segmento) || out.pl_medio_segmento < 0) avisos.push('PL_AUSENTE');
    if (!Number.isFinite(out.vpa_medio_segmento) || out.vpa_medio_segmento <= 0) avisos.push('VPA_AUSENTE');
  }

  return out;
}

module.exports = {
  parseBenchmarkSegmento,
  extrairBlocoPeer,
  detectarTipoGrupo,
  extrairNomeGrupo,
  brNumberToFloat,
  normalizeText
};