// scripts/smoke-migration-real.js
// End-to-end smoke: cria um DB legacy 1.1 em arquivo, roda initDb() real
// do byeINSS, valida que a migration 1.2 migrou o banco sem perder dados.

'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const TMP_DIR = '/tmp/byeinss-smoke';
const DB_PATH = path.join(TMP_DIR, 'byeinss.db');

console.log('=== E2E Smoke: Migração 1.1 → 1.2 em DB real ===\n');

// 1) Limpa estado anterior
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
for (const f of fs.readdirSync(TMP_DIR)) {
  fs.unlinkSync(path.join(TMP_DIR, f));
}
console.log('[1] Diretório limpo:', TMP_DIR);

// 2) Cria DB legacy 1.1 com 5 FIIs (sem colunas do PRD 12)
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE ativos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL UNIQUE,
    tipo TEXT NOT NULL DEFAULT 'FII',
    segmento TEXT, razao_social TEXT, cnpj TEXT, gestor TEXT, taxa_adm REAL,
    nota INTEGER DEFAULT 5,
    observacao TEXT, dy_minimo REAL, preco_teto REAL, preco_muito_bom REAL,
    p_vp REAL, vp_cota REAL, vacancia REAL, num_imoveis INTEGER,
    dy_12m REAL, dy_24m REAL, ultimo_dividendo REAL, ultimo_pagto TEXT,
    alvo_pct_carteira REAL DEFAULT 1.76, ativo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);
  CREATE TABLE cotacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data TEXT NOT NULL, preco REAL NOT NULL, FOREIGN KEY (ativo_id) REFERENCES ativos(id));
  CREATE TABLE lancamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data TEXT NOT NULL, tipo TEXT NOT NULL CHECK(tipo IN ('COMPRA','VENDA')), quantidade INTEGER NOT NULL, preco REAL NOT NULL, FOREIGN KEY (ativo_id) REFERENCES ativos(id));
  CREATE TABLE proventos (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data_pagto TEXT NOT NULL, valor_por_cota REAL NOT NULL, FOREIGN KEY (ativo_id) REFERENCES ativos(id));
  CREATE TABLE metas (id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT NOT NULL, valor_alvo REAL NOT NULL, prazo_meses INTEGER, aporte_mensal REAL, taxa_anual REAL DEFAULT 12.0, patrimonio_atual REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE cenarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, valor_alvo REAL NOT NULL, prazo_meses INTEGER NOT NULL, aporte_mensal REAL NOT NULL, taxa_anual REAL DEFAULT 12.0, ativo INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  INSERT INTO config (chave, valor) VALUES ('versao_schema', '1.1');
  INSERT INTO config (chave, valor) VALUES ('moeda', 'BRL');
`);

const tickers = ['HGLG11', 'XPML11', 'MXRF11', 'GGRC11', 'VGHF11'];
const insert = db.prepare("INSERT INTO ativos (ticker, segmento, nota) VALUES (?, ?, ?)");
for (let i = 0; i < tickers.length; i++) {
  insert.run(tickers[i], 'Tijolo', 7);
}
db.exec(`
  INSERT INTO cotacoes (ativo_id, data, preco)
  SELECT id, '2026-07-20', 100.00 + id FROM ativos;
  INSERT INTO lancamentos (ativo_id, data, tipo, quantidade, preco)
  SELECT id, '2026-01-15', 'COMPRA', 100, 95.00 FROM ativos;
  INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota)
  SELECT id, '2026-06-15', 0.90 FROM ativos;
`);
const legacyStats = {
  ativos: db.prepare('SELECT COUNT(*) AS c FROM ativos').get().c,
  cotacoes: db.prepare('SELECT COUNT(*) AS c FROM cotacoes').get().c,
  lancamentos: db.prepare('SELECT COUNT(*) AS c FROM lancamentos').get().c,
  proventos: db.prepare('SELECT COUNT(*) AS c FROM proventos').get().c
};
console.log('[2] DB legacy 1.1 criado:', legacyStats);
db.close();

// 3) Roda initDb() real (deve detectar 1.1, aplicar migration 1.2, criar backup)
process.env.BYEINSS_DATA = TMP_DIR;
const { initDb, getDb, runMigrations, MIGRATIONS } = require(path.join(__dirname, '..', 'src', 'server', 'db.js'));
initDb().then(() => {
  const db2 = getDb();

  // 4) Valida que a migration 1.2 foi aplicada e versao_schema bumped
  const versao = db2.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
  console.log('[3] Após initDb — versao_schema:', versao.valor);
  if (versao.valor !== '1.2') throw new Error(`esperado 1.2, obtido ${versao.valor}`);

  // 5) Valida que schema_migrations tem 1.2 registrada
  const migrations = db2.prepare('SELECT version, description FROM schema_migrations').all();
  console.log('[4] Migrations registradas:', migrations);
  if (!migrations.find(m => m.version === '1.2')) throw new Error('migration 1.2 não registrada');

  // 6) Valida que as 7 colunas do PRD 12 foram adicionadas em ativos
  const cols = db2.prepare('PRAGMA table_info(ativos)').all().map(c => c.name);
  const expected = [
    'vencimento_medio_contratos',
    'vencimento_medio_contratos_meses',
    'tipo_reajuste',
    'reajuste_percentual',
    'vencimento_medio_origem',
    'vencimento_medio_coletado_em',
    'alerta_vencimento'
  ];
  const missing = expected.filter(c => !cols.includes(c));
  if (missing.length) throw new Error(`faltando colunas após migration: ${missing.join(',')}`);
  console.log('[5] 7 colunas do PRD 12 presentes em ativos ✓');

  // 7) Valida que os dados legados foram preservados
  const newStats = {
    ativos: db2.prepare('SELECT COUNT(*) AS c FROM ativos').get().c,
    cotacoes: db2.prepare('SELECT COUNT(*) AS c FROM cotacoes').get().c,
    lancamentos: db2.prepare('SELECT COUNT(*) AS c FROM lancamentos').get().c,
    proventos: db2.prepare('SELECT COUNT(*) AS c FROM proventos').get().c
  };
  console.log('[6] Dados legados preservados:', newStats);
  if (JSON.stringify(newStats) !== JSON.stringify(legacyStats)) {
    throw new Error(`perda de dados na migration: ${JSON.stringify(legacyStats)} → ${JSON.stringify(newStats)}`);
  }

  // 8) Valida que a config moeda (legada) também foi preservada
  const moeda = db2.prepare("SELECT valor FROM config WHERE chave='moeda'").get();
  if (moeda.valor !== 'BRL') throw new Error(`config moeda perdida: ${moeda}`);
  console.log('[7] Config legada preservada: moeda=BRL ✓');

  // 9) Valida que a nova config janela de alerta foi inserida
  const janela = db2.prepare("SELECT valor FROM config WHERE chave='vencimento_janela_alerta_meses'").get();
  if (!janela || janela.valor !== '24') throw new Error(`janela alerta não foi seedada: ${janela}`);
  console.log('[8] Config janela_alerta seedada:', janela.valor, '✓');

  // 10) Valida que fii_scraper_log foi criada e permite insert
  db2.prepare("INSERT INTO fii_scraper_log (ticker, campo, sucesso) VALUES ('HGLG11', 'vencimento_medio_contratos', 1)").run();
  const logCount = db2.prepare("SELECT COUNT(*) AS c FROM fii_scraper_log").get().c;
  if (logCount !== 1) throw new Error(`fii_scraper_log não está funcional: count=${logCount}`);
  console.log('[9] fii_scraper_log funcional ✓');

  // 11) Valida que o idx_ativos_alerta_venc existe
  const idx = db2.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ativos_alerta_venc'").get();
  if (!idx) throw new Error('idx_ativos_alerta_venc ausente');
  console.log('[10] idx_ativos_alerta_venc presente ✓');

  // 12) Backup automático criado
  const backups = fs.readdirSync(TMP_DIR).filter(f => f.startsWith('byeinss.db.bak-'));
  console.log('[11] Backups encontrados:', backups.length);
  if (backups.length === 0) throw new Error('backup automático não foi criado');
  console.log('         ', backups[0]);

  // 13) idempotência: chamar runMigrations de novo não deve duplicar
  runMigrations(db2);
  const migrationsAfter = db2.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get().c;
  if (migrationsAfter !== 1) throw new Error(`idempotência quebrou: ${migrationsAfter} migrations`);
  console.log('[12] Idempotência de runMigrations ✓');

  // 14) Conectividade HTTP real — starta o express do byeINSS e bate no endpoint
  const { startServer } = require(path.join(__dirname, '..', 'src', 'server', 'index.js'));
  return startServer().then(() => {
    const { getServerPort } = require(path.join(__dirname, '..', 'src', 'server', 'index.js'));
    const port = getServerPort();
    const http = require('http');
    function httpGet(p) {
      return new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1', port, path: p, method: 'GET'
        }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.end();
      });
    }
    return httpGet('/api/health').then(r => {
      console.log('[13] /api/health:', r.status, r.body);
      if (r.status !== 200) throw new Error('health falhou');
      return httpGet('/api/fiis/contratos/HGLG11');
    }).then(r => {
      console.log('[14] GET /api/fiis/contratos/HGLG11:', r.status);
      if (r.status !== 200) throw new Error('GET contratos falhou: ' + r.status);
      return httpGet('/api/dashboard/alertas-vencimento');
    }).then(r => {
      console.log('[15] GET /api/dashboard/alertas-vencimento:', r.status);
      if (r.status !== 200) throw new Error('dashboard falhou: ' + r.status);
    });
  });
}).then(() => {
  console.log('\n=== E2E SMOKE OK — migração 1.1 → 1.2 funcionou em DB real ===');
  process.exit(0);
}).catch((e) => {
  console.error('\n=== E2E SMOKE FALHOU ===');
  console.error(e.stack || e.message);
  process.exit(1);
});
