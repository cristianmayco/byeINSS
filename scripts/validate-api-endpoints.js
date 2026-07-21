// scripts/validate-api-endpoints.js
// Sobe o Express server (sem Electron), popula o banco com dados de teste,
// exercita os 4 endpoints do PRD 02 (sub-PRs 1+3) e imprime o resultado.
// Uso: node scripts/validate-api-endpoints.js

'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');

// Pre-condição: BYEINSS_DATA aponta para um dir limpo
const TMP_DIR = path.join('/tmp', 'byeinss-validate-' + Date.now());
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.BYEINSS_DATA = TMP_DIR;

const { initDb, getDb } = require('../src/server/db.js');
const { startServer, getServerPort } = require('../src/server/index.js');

function httpJson(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const port = getServerPort();
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    }, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(chunks); } catch { parsed = chunks; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function assertEq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ' (esperado ' + JSON.stringify(expected) + ')'}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

function assertTrue(cond, label) {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) process.exitCode = 1;
}

async function seed(db) {
  console.log('\n[seed] populando 3 FIIs + 1 ação...');
  const inserts = [
    // HGLG11: Logístico, DY 12m 9% vs DY 5a 10% → EM_LINHA (90% < 95 → ATENCAO)
    ['HGLG11', 'FII', 'Logístico', 9.0, 10.0, 12.0, 8.5, 15.0, 7.0, 30.0, 18.0],
    // XPML11: Shoppings, DY 12m 6% vs DY 5a 10% → CRITICO (60% < 80)
    ['XPML11', 'FII', 'Shoppings', 6.0, 10.0, 15.0, 11.0, 22.0, 14.0, 55.0, 30.0],
    // KNIP11: Logístico, sem DY 5a → INSUFICIENTE
    ['KNIP11', 'FII', 'Logístico', 8.0, null, 9.0, 5.5, null, null, null, null],
    // PETR4: ação, deve ser ignorado
    ['PETR4', 'ACAO', null, 12.0, null, 18.0, 10.0, null, null, null, null]
  ];
  const stmt = db.prepare(`INSERT INTO ativos
    (ticker, tipo, segmento, dy_12m, dy_medio_5a,
     rentab_nominal_1a, rentab_real_1a,
     rentab_nominal_2a, rentab_real_2a,
     rentab_nominal_5a, rentab_real_5a,
     dy_medio_5a_fonte, dy_medio_5a_atualizado_em, ativo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)`);
  for (const row of inserts) stmt.run(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], 'investidor10');
}

async function run() {
  await initDb();
  await startServer();
  const db = getDb();
  seed(db);

  // ---------- 1. GET /api/health (sanity) ----------
  console.log('\n[1] GET /api/health');
  const health = await httpJson('GET', '/api/health');
  assertEq(health.status, 200, 'status');
  assertEq(health.body.ok, true, 'ok flag');

  // ---------- 2. GET /api/fiis/indicadores ----------
  console.log('\n[2] GET /api/fiis/indicadores');
  const lista = await httpJson('GET', '/api/fiis/indicadores');
  assertEq(lista.status, 200, 'status');
  assertTrue(lista.body.data.length === 3, '3 FIIs (PETR4 ignorado)');
  assertTrue(lista.body.meta.schema === '1.3', 'meta.schema = 1.3');
  assertTrue(lista.body.meta.total === 3, 'meta.total = 3');
  const byTicker = Object.fromEntries(lista.body.data.map(d => [d.ticker, d]));

  // HGLG11: pct=90 → ABAIXO/ATENCAO
  assertEq(byTicker.HGLG11.classificacao, 'ABAIXO', 'HGLG11 classificacao');
  assertEq(byTicker.HGLG11.severidade, 'ATENCAO', 'HGLG11 severidade');
  assertTrue(Math.abs(byTicker.HGLG11.dy_vs_5a_pct - 90) < 0.01, 'HGLG11 dy_vs_5a_pct ≈ 90');

  // XPML11: pct=60 → ABAIXO/CRITICO
  assertEq(byTicker.XPML11.classificacao, 'ABAIXO', 'XPML11 classificacao');
  assertEq(byTicker.XPML11.severidade, 'CRITICO', 'XPML11 severidade');

  // KNIP11: sem dy_medio_5a → INSUFICIENTE
  assertEq(byTicker.KNIP11.classificacao, 'INSUFICIENTE', 'KNIP11 classificacao');
  assertEq(byTicker.KNIP11.severidade, 'INDEFINIDO', 'KNIP11 severidade');
  assertEq(byTicker.KNIP11.dy_vs_5a_pct, null, 'KNIP11 dy_vs_5a_pct = null');

  // PETR4 deve ter sido excluído
  assertTrue(!byTicker.PETR4, 'PETR4 (ACAO) excluído');

  // Meta contadores
  const contadores = lista.body.meta.contadores_por_severidade;
  assertEq(contadores && contadores.ATENCAO, 1, 'contadores.ATENCAO = 1');
  assertEq(contadores && contadores.CRITICO, 1, 'contadores.CRITICO = 1');
  assertEq(contadores && contadores.INDEFINIDO, 1, 'contadores.INDEFINIDO = 1');

  // ---------- 3. GET /api/fiis/indicadores/HGLG11 ----------
  console.log('\n[3] GET /api/fiis/indicadores/HGLG11');
  const detalhe = await httpJson('GET', '/api/fiis/indicadores/HGLG11');
  assertEq(detalhe.status, 200, 'status');
  assertEq(detalhe.body.data.ticker, 'HGLG11', 'ticker');
  assertEq(detalhe.body.data.segmento, 'Logístico', 'segmento');
  assertEq(detalhe.body.data.rentab_nominal_1a, 12.0, 'rentab_nominal_1a');
  assertEq(detalhe.body.data.rentab_real_1a, 8.5, 'rentab_real_1a');
  assertEq(detalhe.body.data.dy_medio_5a_fonte, 'investidor10', 'dy_medio_5a_fonte');

  // 3b. ticker inválido
  console.log('\n[3b] GET /api/fiis/indicadores/PETR4 (regex FII)');
  const erroRegex = await httpJson('GET', '/api/fiis/indicadores/PETR4');
  assertEq(erroRegex.status, 400, 'status 400');

  // 3c. ticker inexistente
  console.log('\n[3c] GET /api/fiis/indicadores/ABCD11 (404)');
  const erro404 = await httpJson('GET', '/api/fiis/indicadores/ABCD11');
  assertEq(erro404.status, 404, 'status 404');

  // 3d. lowercase normaliza
  console.log('\n[3d] GET /api/fiis/indicadores/hglg11 (normalizado)');
  const lower = await httpJson('GET', '/api/fiis/indicadores/hglg11');
  assertEq(lower.status, 200, 'status 200');
  assertEq(lower.body.data.ticker, 'HGLG11', 'ticker normalizado');

  // ---------- 4. GET /api/fiis/scraper/indicadores/status ----------
  console.log('\n[4] GET /api/fiis/scraper/indicadores/status');
  const status = await httpJson('GET', '/api/fiis/scraper/indicadores/status');
  // Pode ser 200 ou 503 dependendo se o módulo carrega fora do Electron.
  console.log(`  status ${status.status} body=${JSON.stringify(status.body)}`);
  assertTrue([200, 503].includes(status.status), 'status 200 ou 503 (módulo scraper condicional)');

  // ---------- 5. POST /api/fiis/scraper/indicadores/resync ----------
  console.log('\n[5] POST /api/fiis/scraper/indicadores/resync');
  const resync = await httpJson('POST', '/api/fiis/scraper/indicadores/resync', {});
  console.log(`  status ${resync.status} body=${JSON.stringify(resync.body)}`);
  assertTrue([200, 503].includes(resync.status), 'resync 200 ou 503 (scraper condicional)');
  if (resync.status === 503) {
    assertTrue(typeof resync.body.erro === 'string', '503 traz mensagem de erro');
  }

  // 5b. POST com tickers inválidos
  console.log('\n[5b] POST /api/fiis/scraper/indicadores/resync (tickers inválidos)');
  const resyncBad = await httpJson('POST', '/api/fiis/scraper/indicadores/resync', { tickers: ['LIXO'] });
  assertEq(resyncBad.status, 400, 'status 400');

  // ---------- 6. GET /api/dashboard/alertas-vencimento (regressão PRD 12) ----------
  console.log('\n[6] GET /api/dashboard/alertas-vencimento (regressão PRD 12)');
  const alertas = await httpJson('GET', '/api/dashboard/alertas-vencimento');
  assertEq(alertas.status, 200, 'status');
  assertTrue(Array.isArray(alertas.body.itens), 'shape preservado');

  console.log('\n[done] exit code:', process.exitCode || 0);
  process.exit(process.exitCode || 0);
}

run().catch(e => { console.error('FATAL:', e); process.exit(2); });