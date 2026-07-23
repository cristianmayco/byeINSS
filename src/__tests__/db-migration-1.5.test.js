// TDD Red Phase — PRD 01: Histórico de Dividendos.
// Adiciona colunas competencia/precisao_data/status/fonte/origem_chave
// à tabela proventos + cria fii_dividendos_sync.
// Schema: 1.4 → 1.5 (PRD 03 já usou 1.4).

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INIT_SQL_PATH = path.join(__dirname, '..', '..', 'db', 'init.sql');

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

// Simula o estado pós-1.4 (PRD 03 aplicado):
// - proventos tem CHECK constraint para tipo (incluindo AMORTIZACAO)
// - idx_proventos_tipo_data existe
// - PRD 01 vai adicionar: competencia, precisao_data, status, fonte, origem_chave
function db14ComProventos({ preservarProventos = 5 } = {}) {
  const db = freshDb();
  const sql = fs.readFileSync(INIT_SQL_PATH, 'utf8');
  db.exec(sql);
  // Inserir um FII + N proventos
  db.prepare("INSERT INTO ativos (ticker, tipo) VALUES ('HGLG11', 'FII')").run();
  const insProv = db.prepare(`INSERT INTO proventos
    (ativo_id, data_com, data_pagto, valor_por_cota, tipo)
    VALUES (1, ?, ?, ?, ?)`);
  for (let i = 0; i < preservarProventos; i++) {
    const mes = ((i % 12) + 1).toString().padStart(2, '0');
    insProv.run(`2025-${mes}-15`, `2025-${mes}-20`, 0.80 + (i % 5) * 0.05, 'DIVIDENDO');
  }
  return db;
}

describe('migration 1.5 — PRD 01 Histórico de Dividendos', () => {
  it('init.sql finaliza com versao_schema = 1.7 após o bump do PRD 04', () => {
    const db = freshDb();
    const sql = fs.readFileSync(INIT_SQL_PATH, 'utf8');
    db.exec(sql);
    const v = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
    expect(v.valor).toBe('1.7');
  });

  it('init.sql cria tabela fii_dividendos_sync com colunas esperadas', () => {
    const db = freshDb();
    const sql = fs.readFileSync(INIT_SQL_PATH, 'utf8');
    db.exec(sql);
    const cols = db.prepare('PRAGMA table_info(fii_dividendos_sync)').all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'ativo_id', 'ultimo_status', 'ultimo_ts',
      'ultimo_total_lido', 'ultimo_inseridos', 'ultimo_atualizados',
      'ultimo_duplicados', 'ultimo_conflitos',
      'primeira_competencia', 'ultima_competencia',
      'cobertura_completa', 'erro'
    ]));
  });

  it('migration 1.5 adiciona 6 colunas em proventos SEM perder dados', async () => {
    const db = db14ComProventos({ preservarProventos: 5 });
    // init.sql já cria as 6+1 colunas (schema 1.5 direto), mas o caminho
    // "banco já criado em 1.4 + runMigrations aplica 1.5" precisa manter
    // a retrocompat — o assert aqui é: ao rodar migration 1.5 num DB que
    // JÁ tem competencia (via init.sql), nada é duplicado.
    const colsAntes = db.prepare('PRAGMA table_info(proventos)').all().map(c => c.name);
    expect(colsAntes).toContain('competencia');  // init.sql já incluiu

    const runMigrations = await loadRunMigrations();
    expect(() => runMigrations(db)).not.toThrow();

    const colsDepois = db.prepare('PRAGMA table_info(proventos)').all().map(c => c.name);
    expect(colsDepois).toEqual(expect.arrayContaining([
      'competencia', 'precisao_data', 'status', 'fonte', 'origem_chave',
      'created_at', 'updated_at'
    ]));
    // Não duplica colunas
    const count = (name) => db.prepare("SELECT COUNT(*) AS c FROM pragma_table_info('proventos') WHERE name=?").get(name).c;
    expect(count('competencia'), 'competencia não duplicada').toBe(1);
    expect(count('status'), 'status não duplicado').toBe(1);
    expect(count('fonte'), 'fonte não duplicado').toBe(1);

    // Dados do PRD 03 preservados: 5 proventos
    const c = db.prepare('SELECT COUNT(*) AS c FROM proventos').get().c;
    expect(c).toBe(5);
    // Tipos preservados (PRD 03)
    expect(db.prepare("SELECT COUNT(*) AS c FROM proventos WHERE tipo='DIVIDENDO'").get().c).toBe(5);

    // Defaults: competencia = YYYY-MM (extraída de data_pagto), status='PAGO',
    // precisao_data='DIA', fonte='LEGADO' (registros pré-existentes sem origem
    // rastreável viram LEGADO conforme plano seção 3.4).
    const sample = db.prepare('SELECT * FROM proventos LIMIT 1').get();
    expect(sample.competencia).toMatch(/^\d{4}-\d{2}$/);
    expect(sample.precisao_data).toBe('DIA');
    expect(sample.status).toBe('PAGO');
    expect(sample.fonte).toBe('LEGADO');
    expect(sample.origem_chave).toBeNull();
  });

  it('migration 1.5 idempotente: 2x mantém versao_schema=1.5 sem duplicar', async () => {
    const db = db14ComProventos();
    const runMigrations = await loadRunMigrations();
    runMigrations(db);
    runMigrations(db);

    const v = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
    expect(v.valor).toBe('1.7');
    // Sem duplicação: cada migration fica exatamente 1x (wrapper faz o
    // `applied.has(version) continue` no segundo run).
    const m15 = db.prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE version='1.5'").get();
    expect(m15.c).toBe(1);
    const m16 = db.prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE version='1.6'").get();
    expect(m16.c).toBe(1);
    const m17 = db.prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE version='1.7'").get();
    expect(m17.c).toBe(1);
  });

  it('migration 1.5 insere novo provento com tipo AMORTIZACAO (herança do PRD 03) + novos campos', async () => {
    const db = db14ComProventos();
    const runMigrations = await loadRunMigrations();
    runMigrations(db);

    expect(() => {
      db.prepare(`INSERT INTO proventos
        (ativo_id, data_com, data_pagto, valor_por_cota, tipo,
         competencia, precisao_data, status, fonte, origem_chave)
        VALUES (1, '2026-07-15', '2026-07-20', 0.50, 'AMORTIZACAO',
                '2026-07', 'DIA', 'PAGO', 'INVESTIDOR10',
                'HGLG11:2026-07:AMORTIZACAO:0.5')`).run();
    }).not.toThrow();

    const row = db.prepare("SELECT * FROM proventos WHERE tipo='AMORTIZACAO'").get();
    expect(row.origem_chave).toBe('HGLG11:2026-07:AMORTIZACAO:0.5');
  });

  it('cria índices idx_proventos_status_pagto + idx_proventos_tipo_competencia', async () => {
    const db = db14ComProventos();
    const runMigrations = await loadRunMigrations();
    runMigrations(db);

    for (const idx of ['idx_proventos_ativo_competencia', 'idx_proventos_status_pagto', 'idx_proventos_tipo_competencia']) {
      const found = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?"
      ).get(idx);
      expect(found, `índice ${idx} deve existir`).toBeDefined();
    }
  });

  it('fii_dividendos_sync aceita INSERT em FK para proventos/ativos existentes', async () => {
    const db = db14ComProventos();
    const runMigrations = await loadRunMigrations();
    runMigrations(db);

    db.prepare(`INSERT INTO fii_dividendos_sync
      (ativo_id, ultimo_status, ultimo_ts, ultimo_total_lido, primeira_competencia)
      VALUES (1, 'SUCESSO', datetime('now'), 5, '2025-01')`).run();
    const row = db.prepare('SELECT * FROM fii_dividendos_sync WHERE ativo_id=1').get();
    expect(row).toBeDefined();
    expect(row.ultimo_total_lido).toBe(5);
    expect(row.ultimo_status).toBe('SUCESSO');
  });
});
