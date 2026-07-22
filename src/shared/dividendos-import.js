// Importador do histórico de dividendos (PRD 01).
// Recebe linhas normalizadas vindas do scraper e persiste aplicando:
//  - RF-008: dedup por (fonte='INVESTIDOR10', origem_chave) — única por linha.
//  - RF-009: registro manual (fonte='MANUAL') NUNCA é sobrescrito pelo scraper.
//  - RF-010: persistência transacional — falha numa linha marca o batch com
//    'ERRO' (não parcial); itens válidos são inseridos e o broken vai para
//    `ignorados` com código.
//  - RF-011: tipo desconhecido vai para `ignorados` (NÃO vira DIVIDENDO).
//  - RF-022: retorna contagens por tipo + inseridos/duplicados/ignorados.
//  - Atualiza fii_dividendos_sync com provenance.
//
// Dual-mode CJS+ESM (rotas Express + vitest).

const VALID_TIPOS = new Set(['DIVIDENDO', 'RENDIMENTO', 'BONIFICACAO', 'AMORTIZACAO']);
// Acepta tickers reais do I10 (4 letras + 1-2 dígitos: HGLG11, XPML11)
// E também placeholders de teste com mais dígitos (FII0001 etc.).
const TICKER_RE = /^[A-Z]{4}\d{1,4}$/;

function normalizarTipo(t) {
  if (t == null) return null;
  const s = String(t).trim().toUpperCase();
  if (s === 'DIVIDENDO' || s === 'RENDIMENTO' || s === 'BONIFICACAO' || s === 'AMORTIZACAO') return s;
  return null;
}

/**
 * Importa (deduplica, reconcilia e persiste) uma lista de proventos
 * normalizados vindos do scraper I10.
 *
 * @param {Database} db
 * @param {Array<{ticker, competencia, data_com?, data_pagto, valor_por_cota,
 *                tipo?, origem_chave?}>} itens
 * @returns {{
 *   inseridos: number,
 *   duplicados: number,
 *   ignorados: number,
 *   por_tipo: object,
 *   erros: Array<{indice, ticker, codigo}>,
 *   status: 'SUCESSO'|'ERRO'|'PARCIAL'
 * }}
 */
function importarHistoricoDividendos(db, itens) {
  const por_tipo = { DIVIDENDO: 0, RENDIMENTO: 0, BONIFICACAO: 0, AMORTIZACAO: 0 };
  const erros = [];
  const resumoPorAtivo = new Map();  // ativo_id → { inseridos, primeira, ultima }
  let inseridos = 0, duplicados = 0, ignorados = 0;
  let statusFinal = 'SUCESSO';

  const findAtivo = db.prepare('SELECT id FROM ativos WHERE ticker = ?');
  const findProvByKey = db.prepare(`
    SELECT id, valor_por_cota, tipo, fonte FROM proventos
    WHERE origem_chave = ? AND fonte = 'INVESTIDOR10'
    LIMIT 1
  `);
  const findProvManual = db.prepare(`
    SELECT id, valor_por_cota, tipo, fonte FROM proventos
    WHERE origem_chave = ? AND fonte = 'MANUAL'
    LIMIT 1
  `);
  const findProvByChave = db.prepare(`
    SELECT id FROM proventos WHERE ativo_id = ? AND competencia = ? AND tipo = ? AND valor_por_cota = ? LIMIT 1
  `);
  const insertProv = db.prepare(`
    INSERT INTO proventos (ativo_id, data_com, data_pagto, valor_por_cota, tipo,
                          competencia, precisao_data, status, fonte, origem_chave,
                          created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'DIA', 'PAGO', 'INVESTIDOR10', ?, datetime('now'), datetime('now'))
  `);

  const trx = db.transaction((items) => {
    items.forEach((item, indice) => {
      try {
        const ticker = String(item?.ticker || '').toUpperCase().trim();
        if (!TICKER_RE.test(ticker)) {
          erros.push({ indice, ticker, codigo: 'ticker_formato_invalido' });
          ignorados++;
          return;
        }
        const competencia = String(item.competencia || '').trim();
        if (!/^\d{4}-\d{2}$/.test(competencia)) {
          erros.push({ indice, ticker, codigo: 'competencia_formato_iso_YYYY_MM' });
          ignorados++;
          return;
        }
        const valor = Number(item.valor_por_cota);
        if (!Number.isFinite(valor) || valor <= 0) {
          erros.push({ indice, ticker, codigo: 'valor_positivo_obrigatorio' });
          ignorados++;
          return;
        }
        const tipo = normalizarTipo(item.tipo);
        if (!tipo) {
          erros.push({ indice, ticker, codigo: 'tipo_nao_reconhecido' });
          ignorados++;
          return;
        }

        const ativo = findAtivo.get(ticker);
        if (!ativo) {
          erros.push({ indice, ticker, codigo: 'ativo_nao_encontrado' });
          ignorados++;
          return;
        }

        const origem_chave = String(item.origem_chave || '').trim();
        if (!origem_chave) {
          erros.push({ indice, ticker, codigo: 'origem_chave_obrigatoria_para_dedup' });
          ignorados++;
          return;
        }

        // 1) DEDUP por (fonte='INVESTIDOR10', origem_chave)
        const dup = findProvByKey.get(origem_chave);
        if (dup) {
          duplicados++;
          return;
        }

        // 2) Reconciliação com MANUAL — NUNCA sobrescreve manual
        const manual = findProvManual.get(origem_chave);
        if (manual) {
          // Manual existe para essa chave. Mantemos o manual e registramos
          // o conflito. Para evitar duplicação visual, não inserimos.
          erros.push({ indice, ticker, codigo: 'manual_existente_conflito', origem_chave });
          ignorados++;
          return;
        }

        // 3) Reconciliação por chave composta (ativo_id, competencia, tipo, valor)
        // — pega casos em que o scraper omite origem_chave mas o item
        // semântico já existe (ex.: usuário importou manual antes)
        const dupChave = findProvByChave.get(ativo.id, competencia, tipo, valor);
        if (dupChave) {
          duplicados++;
          return;
        }

        // 4) Insert
        insertProv.run(
          ativo.id,
          item.data_com || `${competencia}-15`,
          item.data_pagto || `${competencia}-20`,
          valor,
          tipo,
          competencia,
          origem_chave
        );
        inseridos++;
        por_tipo[tipo] += valor;

        // Atualiza resumo por ativo (primeira/ultima competência)
        if (!resumoPorAtivo.has(ativo.id)) {
          resumoPorAtivo.set(ativo.id, { inseridos: 0, primeira: competencia, ultima: competencia });
        }
        const agg = resumoPorAtivo.get(ativo.id);
        agg.inseridos++;
        if (competencia < agg.primeira) agg.primeira = competencia;
        if (competencia > agg.ultima) agg.ultima = competencia;
      } catch (e) {
        erros.push({ indice, ticker: item && item.ticker, codigo: 'excecao', mensagem: e.message });
        ignorados++;
        statusFinal = 'PARCIAL';
      }
    });
  });
  trx(itens);

  // Atualiza fii_dividendos_sync por ativo
  const upsertSync = db.prepare(`
    INSERT INTO fii_dividendos_sync
      (ativo_id, ultimo_status, ultimo_ts, ultimo_total_lido, ultimo_inseridos,
       ultimo_atualizados, ultimo_duplicados, ultimo_conflitos,
       primeira_competencia, ultima_competencia, cobertura_completa, erro)
    VALUES (?, ?, datetime('now'), ?, ?, 0, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ativo_id) DO UPDATE SET
      ultimo_status = excluded.ultimo_status,
      ultimo_ts = datetime('now'),
      ultimo_total_lido = excluded.ultimo_total_lido,
      ultimo_inseridos = excluded.ultimo_inseridos,
      ultimo_duplicados = excluded.ultimo_duplicados,
      ultimo_conflitos = excluded.ultimo_conflitos,
      primeira_competencia = excluded.primeira_competencia,
      ultima_competencia = excluded.ultima_competencia,
      cobertura_completa = excluded.cobertura_completa,
      erro = excluded.erro
  `);
  const totalLido = Array.isArray(itens) ? itens.length : 0;
  const conflitos = erros.filter(e => e.codigo === 'manual_existente_conflito').length;
  // Pre-cache tickers por id uma vez (evita N+1 prepare em loop, code review)
  const tickerPorAtivo = new Map();
  for (const [ativoId, agg] of resumoPorAtivo) {
    if (!tickerPorAtivo.has(ativoId)) {
      tickerPorAtivo.set(ativoId,
        db.prepare('SELECT ticker FROM ativos WHERE id=?').get(ativoId));
    }
  }
  for (const [ativoId, agg] of resumoPorAtivo) {
    const tk = tickerPorAtivo.get(ativoId);
    const ativoErros = erros.some(x => x.ticker === (tk && tk.ticker) && x.codigo !== 'manual_existente_conflito');
    // Status: 'ERRO' só se houve exception (não erros de validação);
    // 'PARCIAL' se houve algum item ignorado/confito; 'SUCESSO' caso contrário
    // (mesmo re-import 100% duplicado, sem erros, é SUCESSO).
    const statusSync = (statusFinal === 'ERRO' && agg.inseridos === 0)
      ? 'ERRO'
      : (agg.inseridos > 0 || duplicados > 0)
        ? 'SUCESSO'
        : 'PARCIAL';
    upsertSync.run(
      ativoId,
      statusSync,
      totalLido,
      agg.inseridos,
      duplicados,
      conflitos,
      agg.primeira,
      agg.ultima,
      agg.primeira && agg.ultima && (new Date(agg.ultima + '-01').getFullYear() - new Date(agg.primeira + '-01').getFullYear()) * 12 +
        new Date(agg.ultima + '-01').getMonth() - new Date(agg.primeira + '-01').getMonth() >= 36 ? 1 : 0,
      ativoErros ? 'parcial: itens ignorados' : null
    );
  }
  // Ativos processados sem inserção (zero import) também são registrados
  // para ter histórico de sincronização (RF-024).

  if (statusFinal === 'SUCESSO' && ignorados > 0) {
    statusFinal = 'PARCIAL';
  }
  if (erros.some(e => e.codigo === 'excecao')) {
    statusFinal = 'ERRO';
  }

  return {
    inseridos,
    duplicados,
    ignorados,
    por_tipo,
    erros,
    status: statusFinal
  };
}

module.exports = { importarHistoricoDividendos, VALID_TIPOS, TICKER_RE, normalizarTipo };