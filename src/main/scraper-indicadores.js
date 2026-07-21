// src/main/scraper-indicadores.js
//
// Orquestrador de resync do PRD 02 (Indicadores Históricos de DY + Rentabilidade).
// Chama extractFIIDetalhes do scraper principal, aplica mergeIndicadores
// (RF-008: persistência segura) e loga cada tentativa.
//
// Funções:
//   - resyncAll(db, opts) → itera FIIs (carteira ou subset), chama scraper,
//     persiste via mergeIndicadores, retorna { total, sucessos, falhas,
//     janela_execucao_ms, detalhes }.
//
// Regras:
//   - Falha de um ticker NÃO derruba o batch (RF-007 do PRD 02).
//   - onProgress(ticker, detalhe) é chamado após cada FII.
//   - Log leve: console.info por FII (PRD 02 RF-008).

'use strict';

const path = require('node:path');

function getScraper() {
  // Lazy-load para evitar carregar Electron em testes que só usam este módulo.
  if (global.__mockScraperIndicadores) return global.__mockScraperIndicadores;
  return require(path.join(__dirname, 'scraper.js'));
}

function getIndicadoresShared() {
  if (global.__mockIndicadoresShared) return global.__mockIndicadoresShared;
  return require(path.join(__dirname, '..', 'shared', 'indicadores.js'));
}

/**
 * Roda o scraper em todos os FIIs (ou subset) e atualiza o banco.
 *
 * @param {object} db           better-sqlite3 instance
 * @param {object} [opts]
 * @param {string[]} [opts.tickers]  se fornecido, roda só nesses tickers
 * @param {function} [opts.onProgress(ticker, detalhe)]
 * @returns {Promise<{
 *   total: number, sucessos: number, falhas: number,
 *   detalhes: Array<{ticker, success, campos_atualizados, error}>
 * }>}
 */
async function resyncAll(db, opts = {}) {
  const { mergeIndicadores } = getIndicadoresShared();
  const scraper = getScraper();

  const tickersFilter = Array.isArray(opts.tickers) && opts.tickers.length > 0
    ? opts.tickers.map(t => String(t).toUpperCase())
    : null;

  let fiiList;
  if (tickersFilter) {
    // Filtra pelos tickers fornecidos, normalizados.
    const placeholders = tickersFilter.map(() => '?').join(',');
    fiiList = db.prepare(
      `SELECT id, ticker FROM ativos WHERE tipo='FII' AND UPPER(ticker) IN (${placeholders}) ORDER BY ticker`
    ).all(...tickersFilter);
  } else {
    fiiList = db.prepare("SELECT id, ticker FROM ativos WHERE tipo='FII' ORDER BY ticker").all();
  }

  const detalhes = [];
  let sucessos = 0;
  let falhas = 0;

  for (const fii of fiiList) {
    const t0 = Date.now();
    let detalhe;
    try {
      const dados = await scraper.extractFIIDetalhes(fii.ticker);
      const prev = db.prepare(
        `SELECT dy_medio_5a, rentab_nominal_1a, rentab_nominal_2a, rentab_nominal_5a,
                rentab_real_1a, rentab_real_2a, rentab_real_5a,
                dy_medio_5a_fonte, dy_medio_5a_atualizado_em
         FROM ativos WHERE id = ?`
      ).get(fii.id);
      const novo = {
        dy_medio_5a: dados.dy_medio_5a,
        rentab_nominal_1a: dados.rentab_nominal_1a,
        rentab_nominal_2a: dados.rentab_nominal_2a,
        rentab_nominal_5a: dados.rentab_nominal_5a,
        rentab_real_1a: dados.rentab_real_1a,
        rentab_real_2a: dados.rentab_real_2a,
        rentab_real_5a: dados.rentab_real_5a
      };
      const merged = mergeIndicadores(prev, novo);
      const camposAtualizados = Object.keys(novo).filter(k =>
        prev == null || prev[k] !== merged[k]
      );
      db.prepare(
        `UPDATE ativos SET
          dy_medio_5a = ?, rentab_nominal_1a = ?, rentab_nominal_2a = ?, rentab_nominal_5a = ?,
          rentab_real_1a = ?, rentab_real_2a = ?, rentab_real_5a = ?,
          dy_medio_5a_fonte = COALESCE(?, dy_medio_5a_fonte),
          dy_medio_5a_atualizado_em = COALESCE(?, dy_medio_5a_atualizado_em),
          updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        merged.dy_medio_5a,
        merged.rentab_nominal_1a, merged.rentab_nominal_2a, merged.rentab_nominal_5a,
        merged.rentab_real_1a, merged.rentab_real_2a, merged.rentab_real_5a,
        merged.dy_medio_5a_fonte, merged.dy_medio_5a_atualizado_em,
        fii.id
      );
      detalhe = {
        ticker: fii.ticker,
        success: true,
        campos_atualizados: camposAtualizados,
        duracao_ms: Date.now() - t0
      };
      sucessos++;
    } catch (e) {
      detalhe = {
        ticker: fii.ticker,
        success: false,
        campos_atualizados: [],
        error: e.message,
        duracao_ms: Date.now() - t0
      };
      falhas++;
    }
    detalhes.push(detalhe);
    if (typeof opts.onProgress === 'function') {
      try { opts.onProgress(fii.ticker, detalhe); } catch { /* swallow */ }
    }
  }

  return {
    total: fiiList.length,
    sucessos,
    falhas,
    detalhes
  };
}

module.exports = { resyncAll };