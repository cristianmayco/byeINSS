// scripts/smoke-api-endpoints.js
// Validação dos 3 endpoints do PRD 12 contra um DB já migrado para 1.2.
// Usa o express real do byeINSS + DB em arquivo.

'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const Database = require('better-sqlite3');

const TMP_DIR = '/tmp/byeinss-smoke-api';
const DB_PATH = path.join(TMP_DIR, 'byeinss.db');

function fresh() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  for (const f of fs.readdirSync(TMP_DIR)) fs.unlinkSync(path.join(TMP_DIR, f));
}
fresh();

function httpJson(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1', port, method, path,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null; try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  process.env.BYEINSS_DATA = TMP_DIR;
  const { initDb, getDb } = require(path.join(__dirname, '..', 'src', 'server', 'db.js'));
  await initDb();
  const db = getDb();

  // Seed
  db.prepare("INSERT OR IGNORE INTO ativos (ticker, tipo, segmento) VALUES ('HGLG11', 'FII', 'Tijolo')").run();
  db.prepare("INSERT OR IGNORE INTO ativos (ticker, tipo, segmento) VALUES ('XPML11', 'FII', 'Shopping')").run();
  db.prepare("INSERT OR IGNORE INTO ativos (ticker, tipo, segmento) VALUES ('MXRF11', 'FII', 'Papel')").run();
  db.prepare("INSERT OR IGNORE INTO ativos (ticker, tipo) VALUES ('PETR4', 'ACAO')").run();

  const { startServer, getServerPort } = require(path.join(__dirname, '..', 'src', 'server', 'index.js'));
  await startServer();
  const port = getServerPort();
  console.log(`API em http://127.0.0.1:${port}\n`);

  // 1) GET 404 ticker inexistente
  let r = await httpJson(port, 'GET', '/api/fiis/contratos/AAAA11');
  console.log('1) GET /api/fiis/contratos/AAAA11:', r.status, '—', JSON.stringify(r.body));
  if (r.status !== 404) throw new Error('esperado 404');

  // 2) GET 200 default-null
  r = await httpJson(port, 'GET', '/api/fiis/contratos/HGLG11');
  console.log('2) GET /api/fiis/contratos/HGLG11:', r.status, '— ticker:', r.body.ticker, 'alerta:', r.body.alerta_vencimento);
  if (r.status !== 200) throw new Error('esperado 200');
  if (r.body.alerta_vencimento !== false) throw new Error('alerta deveria ser false');

  // 3) GET 400 ticker inválido
  r = await httpJson(port, 'GET', '/api/fiis/contratos/123');
  console.log('3) GET /api/fiis/contratos/123:', r.status, '—', JSON.stringify(r.body));
  if (r.status !== 400) throw new Error('esperado 400');

  // 4) PUT criar contrato manual IGPM
  r = await httpJson(port, 'PUT', '/api/fiis/contratos/HGLG11', { vencimento_medio_contratos_meses: 18, tipo_reajuste: 'IGPM' });
  console.log('4) PUT HGLG11 (IGPM, 18m):', r.status, '— alerta:', r.body.alerta_vencimento, 'origem:', r.body.vencimento_medio_origem);
  if (r.status !== 200) throw new Error('esperado 200');
  if (r.body.alerta_vencimento !== true) throw new Error('alerta deveria ser true');
  if (r.body.vencimento_medio_origem !== 'manual') throw new Error('origem deveria ser manual');

  // 5) PUT FIXO sem percentual — 422
  r = await httpJson(port, 'PUT', '/api/fiis/contratos/HGLG11', { tipo_reajuste: 'FIXO' });
  console.log('5) PUT FIXO sem %:', r.status, '—', JSON.stringify(r.body));
  if (r.status !== 422) throw new Error('esperado 422');

  // 6) PUT FIXO com percentual — 200
  r = await httpJson(port, 'PUT', '/api/fiis/contratos/XPML11', { vencimento_medio_contratos_meses: 14, tipo_reajuste: 'FIXO', reajuste_percentual: 3.5 });
  console.log('6) PUT XPML11 (FIXO 3.5%, 14m):', r.status, '— alerta:', r.body.alerta_vencimento);
  if (r.status !== 200) throw new Error('esperado 200');
  if (r.body.alerta_vencimento !== true) throw new Error('alerta deveria ser true');
  if (r.body.reajuste_percentual !== 3.5) throw new Error('percentual deveria ser 3.5');

  // 7) PUT data+meses conflitantes — 400
  r = await httpJson(port, 'PUT', '/api/fiis/contratos/HGLG11', { vencimento_medio_contratos: '2029-01-15', vencimento_medio_contratos_meses: 18 });
  console.log('7) PUT data+meses conflitantes:', r.status, '—', JSON.stringify(r.body));
  if (r.status !== 400) throw new Error('esperado 400');

  // 8) PUT 36m — alerta=false
  r = await httpJson(port, 'PUT', '/api/fiis/contratos/MXRF11', { vencimento_medio_contratos_meses: 36, tipo_reajuste: 'IPCA' });
  console.log('8) PUT MXRF11 (IPCA, 36m):', r.status, '— alerta:', r.body.alerta_vencimento);
  if (r.status !== 200) throw new Error('esperado 200');
  if (r.body.alerta_vencimento !== false) throw new Error('alerta deveria ser false');

  // 9) GET dashboard alertas
  r = await httpJson(port, 'GET', '/api/dashboard/alertas-vencimento');
  console.log('9) GET /api/dashboard/alertas-vencimento:', r.status, '— total:', r.body.total, '— tickers:', r.body.itens.map(i => i.ticker));
  if (r.status !== 200) throw new Error('esperado 200');
  if (r.body.total !== 2) throw new Error(`esperado total=2, obtido ${r.body.total}`);
  if (!r.body.itens.find(i => i.ticker === 'HGLG11')) throw new Error('HGLG11 deveria estar no dashboard');
  if (!r.body.itens.find(i => i.ticker === 'XPML11')) throw new Error('XPML11 deveria estar no dashboard');
  if (r.body.itens.find(i => i.ticker === 'PETR4')) throw new Error('PETR4 (ação) NÃO deveria estar no dashboard');

  // 10) GET contratos do PETR4 (ação) — deve aceitar ticker format mas marcar alerta=false
  r = await httpJson(port, 'PUT', '/api/fiis/contratos/PETR4', { vencimento_medio_contratos_meses: 6 });
  console.log('10) PUT PETR4 (6m):', r.status, '— alerta:', r.body.alerta_vencimento);
  if (r.status !== 200) throw new Error('esperado 200');
  // PETR4 não é FII → alerta deve ser false mesmo com 6m
  if (r.body.alerta_vencimento !== false) throw new Error('alerta de ação deveria ser false');

  // 11) GET dashboard não deve incluir PETR4
  r = await httpJson(port, 'GET', '/api/dashboard/alertas-vencimento');
  console.log('11) GET dashboard final:', r.status, '— total:', r.body.total);
  if (r.body.total !== 2) throw new Error(`esperado total=2 (sem PETR4), obtido ${r.body.total}`);

  // 12) Config — janela de alerta é lida corretamente
  r = await httpJson(port, 'GET', '/api/config');
  console.log('12) GET /api/config:', r.status, '— janela:', r.body.vencimento_janela_alerta_meses);
  if (r.status !== 200) throw new Error('esperado 200');
  if (r.body.vencimento_janela_alerta_meses !== '24') throw new Error('janela deveria ser 24');

  console.log('\n=== API SMOKE OK — todos os 12 cenários validados ===');
  process.exit(0);
}

main().catch(e => {
  console.error('FAIL:', e.stack || e.message);
  process.exit(1);
});
