// TDD Red Phase — PRD 04 (Comparador vs Média do Segmento): migration 1.7
// adiciona 8 colunas peer em ativos + 7 config seeds (limiares peer).
// Schema 1.6 → 1.7. Sem perda de dados. Idempotente. Transacional.

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

// Simula DB pós-1.6 com schema mínimo equivalente (sem colunas peer).
// Hardcoded para não depender de init.sql (que já inclui 1.7).
function db16ComDados() {
  const db = freshDb();
  db.exec(`
    CREATE TABLE ativos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL DEFAULT 'FII',
      segmento TEXT,
      razao_social TEXT,
      cnpj TEXT,
      gestor TEXT,
      taxa_adm REAL,
      nota INTEGER DEFAULT 5,
      observacao TEXT,
      dy_minimo REAL,
      preco_teto REAL,
      preco_muito_bom REAL,
      p_vp REAL,
      vp_cota REAL,
      vacancia REAL,
      num_imoveis INTEGER,
      dy_12m REAL,
      dy_24m REAL,
      ultimo_dividendo REAL,
      ultimo_pagto TEXT,
      alvo_pct_carteira REAL DEFAULT 1.76,
      ativo INTEGER DEFAULT 1,
      vencimento_medio_contratos DATE,
      vencimento_medio_contratos_meses INTEGER,
      tipo_reajuste TEXT,
      reajuste_percentual REAL,
      vencimento_medio_origem TEXT,
      vencimento_medio_coletado_em TEXT,
      alerta_vencimento INTEGER DEFAULT 0,
      -- Migration 1.3 (PRD 02)
      dy_medio_5a REAL,
      rentab_nominal_1a REAL,
      rentab_nominal_2a REAL,
      rentab_nominal_5a REAL,
      rentab_real_1a REAL,
      rentab_real_2a REAL,
      rentab_real_5a REAL,
      dy_medio_5a_fonte TEXT,
      dy_medio_5a_atualizado_em TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);
    CREATE TABLE schema_migrations (
      version TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      duration_ms INTEGER,
      rows_before INTEGER,
      rows_after INTEGER,
      reversible INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO config (chave, valor) VALUES ('versao_schema', '1.6');
    INSERT INTO schema_migrations (version, description) VALUES ('1.6', 'PRD 01 follow-up');
    INSERT INTO ativos (ticker, tipo, segmento, dy_12m, p_vp, vp_cota, preco_teto)
      VALUES ('HGLG11', 'FII', 'Logístico', 9.8, 0.89, 101.20, 170.00);
    INSERT INTO ativos (ticker, tipo, segmento, dy_12m, p_vp, vp_cota, preco_teto)
      VALUES ('XPML11', 'FII', 'Shoppings', 9.1, 0.95, 99.50, 165.00);
  `);
  return db;
}

describe('migration 1.7 — PRD 04: Comparador vs Média do Segmento (peer)', () => {
  it('init.sql finaliza com versao_schema = 1.7 (pós PRD 04)', () => {
    const db = freshDb();
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'init.sql'), 'utf8');
    db.exec(sql);
    const v = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
    expect(v.valor).toBe('1.7');
  });

  it('init.sql cria as 8 colunas peer em ativos', () => {
    const db = freshDb();
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'init.sql'), 'utf8');
    db.exec(sql);
    const cols = db.prepare('PRAGMA table_info(ativos)').all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'pvp_medio_segmento', 'dy_medio_segmento',
      'pl_medio_segmento', 'vpa_medio_segmento',
      'peer_grupo_nome', 'peer_grupo_tipo',
      'peer_fonte', 'peer_atualizado_em'
    ]));
  });

  it('init.sql cria os 7 seeds de configuração peer', () => {
    const db = freshDb();
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'init.sql'), 'utf8');
    db.exec(sql);
    const rows = db.prepare(
      "SELECT chave, valor FROM config WHERE chave LIKE 'peer%' ORDER BY chave"
    ).all();
    const keys = rows.map(r => r.chave);
    expect(keys).toEqual([
      'peer_desvio_neutro_pct',
      'peer_dy_desfavoravel_pct',
      'peer_margem_teto_pct',
      'peer_multiplicador_desfavoravel',
      'peer_multiplicador_favoravel',
      'peer_multiplicador_neutro',
      'peer_validade_horas'
    ]);
    // Defaults coerentes com RF-011/RF-016/RF-021/RF-007
    const get = (k) => rows.find(r => r.chave === k).valor;
    expect(parseFloat(get('peer_desvio_neutro_pct'))).toBe(5.0);
    expect(parseFloat(get('peer_dy_desfavoravel_pct'))).toBe(10.0);
    expect(parseInt(get('peer_validade_horas'), 10)).toBe(168);
    expect(parseFloat(get('peer_margem_teto_pct'))).toBe(0.0);
    expect(parseFloat(get('peer_multiplicador_favoravel'))).toBe(1.15);
    expect(parseFloat(get('peer_multiplicador_neutro'))).toBe(1.0);
    expect(parseFloat(get('peer_multiplicador_desfavoravel'))).toBe(0.75);
  });

  it('runMigrations em DB 1.6 adiciona as 8 colunas peer (todas NULL)', async () => {
    const db = db16ComDados();
    // Confirma baseline 1.6 sem colunas peer
    const antes = db.prepare('PRAGMA table_info(ativos)').all().map(c => c.name);
    expect(antes).not.toContain('pvp_medio_segmento');

    const runMigrations = await loadRunMigrations();
    expect(() => runMigrations(db)).not.toThrow();

    const depois = db.prepare('PRAGMA table_info(ativos)').all().map(c => c.name);
    expect(depois).toEqual(expect.arrayContaining([
      'pvp_medio_segmento', 'dy_medio_segmento',
      'pl_medio_segmento', 'vpa_medio_segmento',
      'peer_grupo_nome', 'peer_grupo_tipo',
      'peer_fonte', 'peer_atualizado_em'
    ]));

    // Todos NULL nos ativos existentes
    const ativos = db.prepare('SELECT * FROM ativos').all();
    expect(ativos.every(a =>
      a.pvp_medio_segmento === null &&
      a.dy_medio_segmento === null &&
      a.pl_medio_segmento === null &&
      a.vpa_medio_segmento === null &&
      a.peer_grupo_nome === null &&
      a.peer_grupo_tipo === null &&
      a.peer_fonte === null &&
      a.peer_atualizado_em === null
    )).toBe(true);
  });

  it('migration 1.7 preserva os 2 ativos existentes com seus dados', async () => {
    const db = db16ComDados();
    const runMigrations = await loadRunMigrations();
    runMigrations(db);

    const hglg = db.prepare("SELECT * FROM ativos WHERE ticker='HGLG11'").get();
    expect(hglg.ticker).toBe('HGLG11');
    expect(hglg.segmento).toBe('Logístico');
    expect(hglg.dy_12m).toBe(9.8);
    expect(hglg.p_vp).toBe(0.89);
    expect(hglg.preco_teto).toBe(170.0);

    const xpml = db.prepare("SELECT * FROM ativos WHERE ticker='XPML11'").get();
    expect(xpml.segmento).toBe('Shoppings');
    expect(xpml.preco_teto).toBe(165.0);
  });

  it('migration 1.7 atualiza versao_schema para 1.7', async () => {
    const db = db16ComDados();
    const runMigrations = await loadRunMigrations();
    runMigrations(db);

    const v = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
    expect(v.valor).toBe('1.7');
  });

  it('migration 1.7 é idempotente: rodar 2x mantém versao_schema=1.7 sem duplicar', async () => {
    const db = db16ComDados();
    const runMigrations = await loadRunMigrations();
    runMigrations(db);
    runMigrations(db);

    const v = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
    expect(v.valor).toBe('1.7');
    const m17 = db.prepare(
      "SELECT COUNT(*) AS c FROM schema_migrations WHERE version='1.7'"
    ).get();
    expect(m17.c).toBe(1);

    // Colunas continuam existindo e ainda NULL
    const cols = db.prepare('PRAGMA table_info(ativos)').all().map(c => c.name);
    expect(cols.filter(c => c.startsWith('peer_') || c.endsWith('_segmento')).length)
      .toBe(8);
  });

  it('migration 1.7 aceita INSERT de peer snapshot completo', async () => {
    const db = db16ComDados();
    const runMigrations = await loadRunMigrations();
    runMigrations(db);

    expect(() => {
      db.prepare(`UPDATE ativos SET
        pvp_medio_segmento = ?, dy_medio_segmento = ?, vpa_medio_segmento = ?,
        pl_medio_segmento = ?, peer_grupo_nome = ?, peer_grupo_tipo = ?,
        peer_fonte = ?, peer_atualizado_em = ?
        WHERE ticker = ?`).run(0.95, 9.10, 96.70, 1500000000.0,
          'Logístico', 'SEGMENTO', 'investidor10',
          '2026-07-19T14:30:00.000Z', 'HGLG11');
    }).not.toThrow();

    const row = db.prepare("SELECT * FROM ativos WHERE ticker='HGLG11'").get();
    expect(row.pvp_medio_segmento).toBe(0.95);
    expect(row.dy_medio_segmento).toBe(9.10);
    expect(row.vpa_medio_segmento).toBe(96.70);
    expect(row.peer_grupo_nome).toBe('Logístico');
    expect(row.peer_grupo_tipo).toBe('SEGMENTO');
    expect(row.peer_fonte).toBe('investidor10');
    expect(row.peer_atualizado_em).toBe('2026-07-19T14:30:00.000Z');
  });

  it('migration 1.7 preserva integridade (FK + integrity_check) pós-DDL', async () => {
    const db = db16ComDados();
    const runMigrations = await loadRunMigrations();
    runMigrations(db);

    const integrity = db.prepare('PRAGMA integrity_check').get();
    expect(integrity.integrity_check).toBe('ok');

    const fk = db.prepare('PRAGMA foreign_key_check').all();
    expect(fk).toEqual([]);
  });
});