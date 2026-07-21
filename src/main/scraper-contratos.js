// src/main/scraper-contratos.js
//
// Orchestrator Electron para coleta de vencimento médio + tipo de reajuste
// a partir do Investidor10. PRD 12 sub-PR 3.
//
// Camadas:
//   1. fetchContratoHTML(ticker, source)        → carrega HTML via Electron
//   2. extractContratoFromPage(ticker, source)  → chama parser puro em src/shared
//   3. fetchContratoData(ticker, opts)          → orquestra main page + fallback Comunicado
//   4. resyncAll(db, opts)                      → percorre todos os FIIs (exceto manual)
//
// Comportamentos obrigatórios:
//   - Bind em scraperWindow existente (não cria nova janela).
//   - Timeout duro de 3s por FII (PRD 12 NFR-performance).
//   - Try/catch por etapa — falha não derruba o batch.
//   - Log de cada tentativa em fii_scraper_log (PRD 12 RF-008).
//   - Não persiste se vencimento_medio_origem = 'manual' (PRD 12 RF-009).
//
// Restrição: este módulo assume Electron (BrowserWindow). Para testes, ver
// src/__tests__/shared/scraper-contratos.test.js que cobre os parsers sem
// Electron. O endpoint /api/fiis/scraper/contratos/resync é testado via
// supertest com fetchContratoData mockado.

'use strict';

const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const {
  parseContratoFromMainHTML,
  parseContratoFromComunicadoHTML
} = require(path.join(__dirname, '..', 'shared', 'scraper-contratos.js'));

const TIMEOUT_MS = 3000;
const I10_BASE = 'https://investidor10.com.br/fiis';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

let _scraperWindow = null;

function getScraperWindow() {
  if (_scraperWindow && !_scraperWindow.isDestroyed()) return _scraperWindow;
  _scraperWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      userAgent: USER_AGENT
    }
  });
  return _scraperWindow;
}

/**
 * Carrega HTML de uma página I10 dentro do timeout.
 * Retorna string HTML ou lança erro.
 */
async function fetchHTML(url, { timeoutMs = TIMEOUT_MS } = {}) {
  const win = getScraperWindow();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout após ${timeoutMs}ms em ${url}`)), timeoutMs);
  });
  try {
    await Promise.race([win.loadURL(url), timeout]);
    const html = await Promise.race([win.webContents.executeJavaScript('document.documentElement.outerHTML'), timeout]);
    return String(html || '');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tenta coletar dados da página principal do FII (/fiis/{ticker}/).
 */
async function extractFromMain(ticker) {
  const url = `${I10_BASE}/${ticker.toLowerCase()}/`;
  const html = await fetchHTML(url);
  const parsed = parseContratoFromMainHTML(html);
  return { ...parsed, html_len: html.length };
}

/**
 * Tenta coletar dados do Comunicado mais recente do FII.
 */
async function extractFromComunicado(ticker) {
  const url = `${I10_BASE}/${ticker.toLowerCase()}/comunicados/`;
  const html = await fetchHTML(url);
  // Tenta isolar o comunicado mais recente pelo atributo data-date ou pela
  // primeira <article class="comunicado">.
  const m = html.match(/<article[^>]*data-date=["'](\d{4}-\d{2}-\d{2})["'][^>]*>([\s\S]*?)<\/article>/i);
  let snippet = html;
  let comunicadoDate = null;
  if (m) {
    snippet = m[2];
    comunicadoDate = m[1];
  } else {
    // Fallback: primeiro <article>.
    const m2 = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (m2) snippet = m2[1];
  }
  const parsed = parseContratoFromComunicadoHTML(snippet, comunicadoDate);
  return { ...parsed, html_len: html.length };
}

/**
 * Orquestra a coleta de um ticker: tenta página principal, fallback Comunicado.
 *
 * @returns {{
 *   ticker: string,
 *   success: boolean,
 *   source: 'main'|'comunicado'|null,
 *   payload: object|null,
 *   error: string|null
 * }}
 */
async function fetchContratoData(ticker) {
  if (!ticker || !/^[A-Z]{4}11$/.test(String(ticker).toUpperCase())) {
    return {
      ticker,
      success: false,
      source: null,
      payload: null,
      error: 'ticker inválido'
    };
  }
  const t = String(ticker).toUpperCase();

  // Tentativa 1: página principal.
  try {
    const r = await extractFromMain(t);
    if (r && (r.vencimento_medio_contratos || r.vencimento_medio_contratos_meses || r.tipo_reajuste)) {
      return {
        ticker: t,
        success: true,
        source: r.vencimento_medio_origem || 'main',
        payload: r,
        error: null
      };
    }
  } catch (e) {
    // Cai para Comunicado.
    console.warn(`[scraper-contratos] ${t} main page falhou: ${e.message}`);
  }

  // Tentativa 2: Comunicado.
  try {
    const r = await extractFromComunicado(t);
    if (r && (r.vencimento_medio_contratos || r.vencimento_medio_contratos_meses || r.tipo_reajuste)) {
      return {
        ticker: t,
        success: true,
        source: 'comunicado',
        payload: r,
        error: null
      };
    }
    return {
      ticker: t,
      success: false,
      source: 'comunicado',
      payload: r,
      error: 'nenhum dado parseado em main nem Comunicado'
    };
  } catch (e) {
    return {
      ticker: t,
      success: false,
      source: null,
      payload: null,
      error: e.message
    };
  }
}

/**
 * Persiste resultado na tabela ativos + log em fii_scraper_log.
 * Respeita origem='manual' (PRD 12 RF-009).
 */
function persistContrato(db, ticker, source, payload) {
  if (!db || !payload) return { persisted: false, reason: 'db/payload inválido' };
  const ativo = db.prepare('SELECT id, vencimento_medio_origem FROM ativos WHERE ticker = ?').get(ticker);
  if (!ativo) return { persisted: false, reason: 'ticker não cadastrado' };
  if (ativo.vencimento_medio_origem === 'manual') {
    return { persisted: false, reason: 'origem=manual, scraping desativado para este ticker' };
  }

  const fields = [];
  const values = [];
  const map = {
    vencimento_medio_contratos: payload.vencimento_medio_contratos,
    vencimento_medio_contratos_meses: payload.vencimento_medio_contratos_meses,
    tipo_reajuste: payload.tipo_reajuste,
    reajuste_percentual: payload.reajuste_percentual
  };
  for (const [col, v] of Object.entries(map)) {
    fields.push(`${col} = ?`);
    values.push(v === undefined ? null : v);
  }
  fields.push('vencimento_medio_origem = ?');
  values.push(source);
  fields.push('vencimento_medio_coletado_em = datetime(\'now\')');
  fields.push('updated_at = datetime(\'now\')');
  values.push(ativo.id);

  try {
    db.prepare(`UPDATE ativos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  } catch (e) {
    return { persisted: false, reason: `falha UPDATE: ${e.message}` };
  }

  // Log de auditoria: 1 linha por campo alterado.
  try {
    const ins = db.prepare(`
      INSERT INTO fii_scraper_log (ticker, campo, sucesso, origem, erro) VALUES (?, ?, 1, ?, NULL)
    `);
    for (const col of Object.keys(map)) ins.run(ticker, col, source);
  } catch { /* silencioso */ }

  return { persisted: true };
}

/**
 * Itera todos os FIIs da carteira e roda fetchContratoData em cada um,
 * persistindo resultados. FIIs com vencimento_medio_origem='manual' são pulados.
 *
 * @param {object} db            better-sqlite3 instance
 * @param {object} [opts]
 * @param {string[]} [opts.tickers]  lista específica; se ausente, pega todos
 * @param {(ticker:string, result:object) => void} [opts.onProgress]
 * @returns {{ total: number, sucessos: number, falhas: number, detalhes: object[] }}
 */
async function resyncAll(db, opts = {}) {
  if (!db) throw new Error('db obrigatório');
  const tickers = Array.isArray(opts.tickers) && opts.tickers.length
    ? opts.tickers.map(t => String(t).toUpperCase())
    : db.prepare("SELECT ticker FROM ativos WHERE tipo='FII' AND ativo=1 ORDER BY ticker").all().map(r => r.ticker);

  const detalhes = [];
  let sucessos = 0;
  let falhas = 0;

  for (const ticker of tickers) {
    let result;
    try {
      result = await fetchContratoData(ticker);
    } catch (e) {
      result = { ticker, success: false, source: null, payload: null, error: e.message };
    }

    let persist = { persisted: false, reason: 'sem payload' };
    if (result.success && result.payload) {
      persist = persistContrato(db, ticker, result.source, result.payload);
      if (persist.persisted) sucessos += 1;
      else falhas += 1;
    } else {
      // Log de falha na auditoria.
      try {
        db.prepare(`
          INSERT INTO fii_scraper_log (ticker, campo, sucesso, origem, erro)
          VALUES (?, 'vencimento_medio_contratos', 0, ?, ?)
        `).run(ticker, result.source || 'main', String(result.error || 'falha').slice(0, 500));
      } catch { /* silencioso */ }
      falhas += 1;
    }

    const detalhe = {
      ticker,
      success: result.success,
      source: result.source,
      persisted: persist.persisted,
      motivo_skip: persist.persisted ? null : persist.reason,
      error: result.error || null,
      confianca: result.payload?.confianca ?? null
    };
    detalhes.push(detalhe);
    if (typeof opts.onProgress === 'function') {
      try { opts.onProgress(ticker, detalhe); } catch { /* silencioso */ }
    }
  }

  return { total: tickers.length, sucessos, falhas, detalhes };
}

module.exports = {
  fetchContratoData,
  fetchHTML,
  extractFromMain,
  extractFromComunicado,
  persistContrato,
  resyncAll,
  // Para testes/mocks.
  _internals: { TIMEOUT_MS, I10_BASE, USER_AGENT }
};
