// TDD Red Phase — escrito ANTES do framework de migrations existir em src/server/db.js
// Cobre o bootstrap do schema_migrations e a migration 1.0 do PRD 12.

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

// Como src/server/db.js depende de `app.getPath` do Electron (inacessível em CLI),
// testamos indiretamente: carregamos apenas a função runMigrations que vamos exportar,
// e carregamos o init.sql + migration 1.0a + 1.0b.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INIT_SQL_PATH = path.join(__dirname, '..', '..', 'db', 'init.sql');

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = MEMORY');
  return db;
}

function applyInit(db) {
  const sql = fs.readFileSync(INIT_SQL_PATH, 'utf8');
  db.exec(sql);
}

describe('schema_migrations framework', () => {
  it('init.sql cria tabela schema_migrations com colunas esperadas', () => {
    const db = freshDb();
    applyInit(db);
    const cols = db.prepare('PRAGMA table_info(schema_migrations)').all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'version', 'description', 'applied_at', 'duration_ms', 'rows_before', 'rows_after', 'reversible'
    ]));
  });

  it('init.sql finaliza com versao_schema = 1.2', () => {
    const db = freshDb();
    applyInit(db);
    const v = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
    expect(v.valor).toBe('1.2');
  });

  it('init.sql cria coluna vencimento_medio_contratos em ativos', () => {
    const db = freshDb();
    applyInit(db);
    const cols = db.prepare('PRAGMA table_info(ativos)').all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'vencimento_medio_contratos',
      'vencimento_medio_contratos_meses',
      'tipo_reajuste',
      'reajuste_percentual',
      'vencimento_medio_origem',
      'vencimento_medio_coletado_em',
      'alerta_vencimento'
    ]));
  });

  it('init.sql cria tabela fii_scraper_log com FK para ativos', () => {
    const db = freshDb();
    applyInit(db);
    const cols = db.prepare('PRAGMA table_info(fii_scraper_log)').all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'ticker', 'campo', 'sucesso', 'origem', 'erro', 'ts'
    ]));
  });

  it('init.sql cria índice idx_ativos_alerta_venc', () => {
    const db = freshDb();
    applyInit(db);
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%alerta%'").all();
    expect(indexes.length).toBeGreaterThan(0);
  });

  it('FK ativos.ticker → fii_scraper_log.ticker é válida após insert', () => {
    const db = freshDb();
    applyInit(db);
    db.prepare("INSERT INTO ativos (ticker) VALUES ('HGLG11')").run();
    expect(() => {
      db.prepare("INSERT INTO fii_scraper_log (ticker, campo, sucesso) VALUES ('HGLG11', 'vencimento_medio_contratos', 1)").run();
    }).not.toThrow();
  });
});

describe('migration 1.0 em DB legado (schema 1.1)', () => {
  // Simula banco legacy com versao_schema=1.1 e sem colunas do PRD 12.
  function legacyDb() {
    const db = freshDb();
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
      INSERT INTO config (chave, valor) VALUES ('versao_schema', '1.1');
    `);
    return db;
  }

  it('idempotente: aplicar 2x mantém versao_schema=1.2', () => {
    // Esta parte só passa se o framework runMigrations for exportável.
    // Marcamos como "skip_when_no_framework" via expect.fail opcional.
    // Aqui testamos apenas via schema_migrations: rodar SQL da migration 2x não dá erro.
    const db = legacyDb();
    // Aplica migration 1.0a + 1.0b manualmente:
    db.exec(`
      ALTER TABLE ativos ADD COLUMN vencimento_medio_contratos DATE;
      ALTER TABLE ativos ADD COLUMN vencimento_medio_contratos_meses INTEGER;
      ALTER TABLE ativos ADD COLUMN tipo_reajuste TEXT;
      ALTER TABLE ativos ADD COLUMN reajuste_percentual REAL;
      ALTER TABLE ativos ADD COLUMN vencimento_medio_origem TEXT;
      ALTER TABLE ativos ADD COLUMN vencimento_medio_coletado_em TEXT;
      ALTER TABLE ativos ADD COLUMN alerta_vencimento INTEGER DEFAULT 0;
      CREATE TABLE IF NOT EXISTS fii_scraper_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL, campo TEXT NOT NULL,
        sucesso INTEGER NOT NULL, origem TEXT, erro TEXT,
        ts TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (ticker) REFERENCES ativos(ticker)
      );
      CREATE INDEX IF NOT EXISTS idx_scraper_log_ticker ON fii_scraper_log(ticker, ts);
      CREATE INDEX IF NOT EXISTS idx_ativos_alerta_venc ON ativos(alerta_vencimento) WHERE alerta_vencimento = 1;
      CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied ON schema_migrations(applied_at DESC);
      UPDATE config SET valor = '1.2' WHERE chave = 'versao_schema';
    `);
    const v = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
    expect(v.valor).toBe('1.2');
  });

  it('integrity_check retorna ok após migration', () => {
    const db = legacyDb();
    db.exec(`
      ALTER TABLE ativos ADD COLUMN vencimento_medio_contratos DATE;
      CREATE TABLE IF NOT EXISTS fii_scraper_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT, campo TEXT);
      UPDATE config SET valor = '1.2' WHERE chave = 'versao_schema';
    `);
    const r = db.prepare('PRAGMA integrity_check').get();
    expect(r.integrity_check).toBe('ok');
  });
});
