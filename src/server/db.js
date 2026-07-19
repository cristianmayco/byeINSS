const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let dbInstance = null;

function getUserDataDir() {
  // Em produção (Electron empacotado), usa app.getPath('userData').
  // Em dev ou CLI, usa a pasta db/ local ou /tmp/byeinss.
  try {
    const { app } = require('electron');
    if (app && app.getPath) {
      const dir = app.getPath('userData');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
  } catch { /* electron não disponível */ }
  // Fallback
  if (process.env.BYEINSS_DATA) {
    if (!fs.existsSync(process.env.BYEINSS_DATA)) fs.mkdirSync(process.env.BYEINSS_DATA, { recursive: true });
    return process.env.BYEINSS_DATA;
  }
  return path.join(__dirname, '..', '..', 'db');
}

function dbPath() {
  return path.join(getUserDataDir(), 'byeinss.db');
}

function findInitSql() {
  // Tenta primeiro fora do asar (dev), depois dentro (produção)
  const candidates = [
    path.join(__dirname, '..', '..', 'db', 'init.sql'),
    path.join(__dirname, '..', '..', '..', 'db', 'init.sql'),
    path.join(process.resourcesPath || '/', 'app', 'db', 'init.sql'),
    path.join(process.resourcesPath || '/', 'app.asar', 'db', 'init.sql'),
    path.join(process.resourcesPath || '/', 'app.asar.unpacked', 'db', 'init.sql')
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

async function initDb() {
  if (dbInstance) return dbInstance;
  const p = dbPath();
  // Garante diretório
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  console.log('[db] dbPath:', p, 'exists:', fs.existsSync(p));
  dbInstance = new Database(p);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');
  const sqlPath = findInitSql();
  console.log('[db] init.sql path:', sqlPath);
  if (sqlPath) {
    const schema = fs.readFileSync(sqlPath, 'utf8');
    console.log('[db] schema length:', schema.length, 'bytes; has gestor:', schema.includes('gestor'));
    dbInstance.exec(schema);
    // Verificar
    const cols = dbInstance.prepare('PRAGMA table_info(ativos)').all();
    console.log('[db] colunas após exec:', cols.map(c => c.name).join(','));
  } else {
    console.log('[db] WARN: init.sql não encontrado, usando schema inline');
    // Fallback inline se nem init.sql for encontrado
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS ativos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL UNIQUE, tipo TEXT NOT NULL DEFAULT 'FII',
        segmento TEXT, razao_social TEXT, cnpj TEXT, gestor TEXT, taxa_adm REAL,
        nota INTEGER DEFAULT 5,
        observacao TEXT, dy_minimo REAL, preco_teto REAL, preco_muito_bom REAL,
        p_vp REAL, vp_cota REAL, vacancia REAL, num_imoveis INTEGER,
        dy_12m REAL, dy_24m REAL, ultimo_dividendo REAL, ultimo_pagto TEXT,
        alvo_pct_carteira REAL DEFAULT 1.76, ativo INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS cotacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data TEXT NOT NULL, preco REAL NOT NULL, fonte TEXT DEFAULT 'manual', FOREIGN KEY (ativo_id) REFERENCES ativos(id));
      CREATE TABLE IF NOT EXISTS lancamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data TEXT NOT NULL, tipo TEXT NOT NULL CHECK(tipo IN ('COMPRA','VENDA')), quantidade INTEGER NOT NULL, preco REAL NOT NULL, corretora TEXT, taxa REAL DEFAULT 0, observacao TEXT, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (ativo_id) REFERENCES ativos(id));
      CREATE TABLE IF NOT EXISTS proventos (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data_com TEXT, data_pagto TEXT NOT NULL, valor_por_cota REAL NOT NULL, tipo TEXT DEFAULT 'DIVIDENDO', FOREIGN KEY (ativo_id) REFERENCES ativos(id));
      CREATE TABLE IF NOT EXISTS metas (id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT NOT NULL, descricao TEXT, valor_alvo REAL NOT NULL, prazo_meses INTEGER, aporte_mensal REAL, taxa_anual REAL DEFAULT 12.0, patrimonio_atual REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS cenarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, descricao TEXT, tipo TEXT DEFAULT 'PATRIMONIO', valor_alvo REAL NOT NULL, prazo_meses INTEGER NOT NULL, aporte_inicial REAL DEFAULT 0, aporte_mensal REAL NOT NULL, taxa_anual REAL DEFAULT 12.0, reajuste_aporte_anual REAL DEFAULT 0, cor TEXT DEFAULT '#4ade80', ativo INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT);
    `);
  }
  return dbInstance;
}

function getDb() {
  if (!dbInstance) throw new Error('DB não inicializado');
  return dbInstance;
}

module.exports = { initDb, getDb, dbPath };
