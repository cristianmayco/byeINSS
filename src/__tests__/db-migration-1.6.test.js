// TDD Red Phase — PRD 01 follow-up: migration 1.6 corrige M1 (data_pagto NOT NULL
// em DBs legacy). Recria tabela `proventos` via padrão proventos_v2 + INSERT +
// DROP + RENAME, garantindo data_pagto TEXT (nullable) + todos os CHECKs.

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadRunMigrations() {
  const mod = await import('../server/db.js');
  return mod.runMigrations;
}

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = MEMORY');
  return db;
}

// Simula DB pós-1.5: proventos com data_pagto NOT NULL (legacy) +
// todas as colunas do PRD 01 (competencia/precisao_data/status/fonte/etc)
function db15LegacyComDados(nProventos = 5) {
  const db = freshDb();
  db.exec(`
    CREATE TABLE ativos (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL UNIQUE);
    CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);
    CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')), duration_ms INTEGER,
      rows_before INTEGER, rows_after INTEGER, reversible INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE fii_dividendos_sync (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ativo_id INTEGER NOT NULL,
      ultimo_status TEXT NOT NULL CHECK (ultimo_status IN
        ('NUNCA','EM_ANDAMENTO','SUCESSO','PARCIAL','ERRO','CANCELADO')),
      ultimo_ts TEXT,
      ultimo_total_lido INTEGER, ultimo_inseridos INTEGER, ultimo_atualizados INTEGER,
      ultimo_duplicados INTEGER, ultimo_conflitos INTEGER,
      primeira_competencia TEXT, ultima_competencia TEXT,
      cobertura_completa INTEGER DEFAULT 0 CHECK (cobertura_completa IN (0,1)),
      erro TEXT,
      FOREIGN KEY (ativo_id) REFERENCES ativos(id),
      UNIQUE (ativo_id)
    );
    CREATE INDEX idx_fii_divsync_ts ON fii_dividendos_sync(ultimo_ts DESC);
    CREATE TABLE proventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL,
      data_com TEXT,
      data_pagto TEXT NOT NULL,        -- LEGADO: NOT NULL
      valor_por_cota REAL NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'DIVIDENDO'
        CHECK (tipo IN ('DIVIDENDO','RENDIMENTO','BONIFICACAO','AMORTIZACAO')),
      competencia TEXT NOT NULL DEFAULT '0000-00',
      precisao_data TEXT NOT NULL DEFAULT 'DIA' CHECK (precisao_data IN ('DIA','MES')),
      status TEXT NOT NULL DEFAULT 'PAGO' CHECK (status IN ('PAGO','AGENDADO')),
      fonte TEXT NOT NULL DEFAULT 'MANUAL' CHECK (fonte IN ('MANUAL','INVESTIDOR10','IMPORTACAO','LEGADO')),
      origem_chave TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (ativo_id) REFERENCES ativos(id)
    );
    INSERT INTO ativos (ticker) VALUES ('HGLG11');
    INSERT INTO config (chave, valor) VALUES ('versao_schema', '1.5');
    INSERT INTO schema_migrations (version, description) VALUES ('1.5', 'PRD 01');
    ${(() => {
      let sql = '';
      for (let i = 0; i < nProventos; i++) {
        const mes = ((i % 12) + 1).toString().padStart(2, '0');
        sql += `INSERT INTO proventos (ativo_id, data_com, data_pagto, valor_por_cota, tipo, competencia, fonte)
                VALUES (1, '2025-${mes}-15', '2025-${mes}-20', 0.80, 'DIVIDENDO', '2025-${mes}', 'INVESTIDOR10');`;
      }
      return sql;
    })()}
  `);
  return db;
}

describe('migration 1.6 — M1 fix (data_pagto nullable)', () => {
  it('init.sql finaliza com versao_schema = 1.7 (pós PRD 04)', () => {
    const db = freshDb();
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'init.sql'), 'utf8');
    db.exec(sql);
    const v = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
    expect(v.valor).toBe('1.7');
  });

  it('M1: runMigrations em DB 1.5 legacy torna data_pagto nullable', async () => {
    const db = db15LegacyComDados();
    // Sanity: confirma que está NOT NULL antes da migração
    const antes = db.prepare(
      "SELECT \"notnull\" FROM pragma_table_info('proventos') WHERE name='data_pagto'"
    ).get();
    expect(antes.notnull).toBe(1);  // legacy: NOT NULL

    const runMigrations = await loadRunMigrations();
    expect(() => runMigrations(db)).not.toThrow();

    // data_pagto agora nullable (align com init.sql)
    const depois = db.prepare(
      "SELECT \"notnull\" FROM pragma_table_info('proventos') WHERE name='data_pagto'"
    ).get();
    expect(depois.notnull).toBe(0);  // nullable após 1.6
  });

  it('migration 1.6 preserva os 5 proventos legados (id, valor, tipo)', async () => {
    const db = db15LegacyComDados();
    const runMigrations = await loadRunMigrations();
    runMigrations(db);

    const rows = db.prepare(
      "SELECT id, valor_por_cota, tipo, ativo_id FROM proventos ORDER BY id"
    ).all();
    expect(rows.length).toBe(5);
    expect(rows.every(r => r.tipo === 'DIVIDENDO')).toBe(true);
    expect(rows.every(r => r.valor_por_cota === 0.80)).toBe(true);
    expect(rows.every(r => r.ativo_id === 1)).toBe(true);
  });

  it('migration 1.6 idempotente: rodar 2x mantém versao_schema=1.7 sem duplicar', async () => {
    const db = db15LegacyComDados();
    const runMigrations = await loadRunMigrations();
    runMigrations(db);
    runMigrations(db);

    const v = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
    expect(v.valor).toBe('1.7');
    const m16 = db.prepare(
      "SELECT COUNT(*) AS c FROM schema_migrations WHERE version='1.6'"
    ).get();
    expect(m16.c).toBe(1);  // sem duplicação
  });

  it('migration 1.6 agora aceita INSERT com data_pagto NULL (precisao_data=MES)', async () => {
    const db = db15LegacyComDados();
    const runMigrations = await loadRunMigrations();
    runMigrations(db);

    // Antes da 1.6: NULL violaria NOT NULL constraint
    expect(() => {
      db.prepare(`INSERT INTO proventos (ativo_id, competencia, valor_por_cota, tipo,
                                          precisao_data, status, fonte)
                  VALUES (1, '2026-07', 0.50, 'DIVIDENDO', 'MES', 'PAGO', 'INVESTIDOR10')`).run();
    }).not.toThrow();
  });

  it('migration 1.6 preserva índices e CHECK constraints', async () => {
    const db = db15LegacyComDados();
    const runMigrations = await loadRunMigrations();
    runMigrations(db);

    // 4 índices devem continuar existindo
    for (const idx of ['idx_proventos_ativo_data', 'idx_proventos_tipo_data',
                       'idx_proventos_ativo_competencia', 'idx_proventos_status_pagto',
                       'idx_proventos_tipo_competencia', 'idx_fii_divsync_ts']) {
      const found = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?"
      ).get(idx);
      expect(found, `índice ${idx}`).toBeDefined();
    }

    // CHECK de tipo continua valendo
    expect(() => {
      db.prepare(`INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota, tipo)
                  VALUES (1, '2026-09-20', 0.20, 'JCP')`).run();
    }).toThrow();
  });

  it('migration 1.6 atualiza schema_migrations e versao_schema', async () => {
    const db = db15LegacyComDados();
    const runMigrations = await loadRunMigrations();
    runMigrations(db);

    const v = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
    expect(v.valor).toBe('1.7');
    const reg = db.prepare(
      "SELECT version, description FROM schema_migrations WHERE version='1.6'"
    ).get();
    expect(reg.description).toMatch(/data_pagto/);
  });
});