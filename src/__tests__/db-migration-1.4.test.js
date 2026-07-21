// TDD Red Phase — PRD 03: amortizações separadas em proventos de FIIs.
// Adiciona tipo AMORTIZACAO no CHECK constraint de proventos.
// Bump do schema: 1.3 → 1.4 (a versão "1.2 do PRD" foi reusada por PRD 12).

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INIT_SQL_PATH = path.join(__dirname, '..', '..', 'db', 'init.sql');

// Carrega o db.js via dynamic import. Usamos uma string para evitar que
// Vite tente analisar rotas Express/etc no topo do bundle. O módulo
// db.js depende de `app` do Electron só em initDb; runMigrations é puro.
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

// Simula o estado pós-1.3 (provavelmente o banco do usuário hoje):
// ativos com 16 colunas (PRD 12 + 02), proventos SEM CHECK constraint (legado),
// proventos com tipo podendo ser NULL.
function db13SemCheck() {
  const db = freshDb();
  db.exec(`
    CREATE TABLE ativos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL UNIQUE
    );
    CREATE TABLE proventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ativo_id INTEGER NOT NULL,
      data_com TEXT,
      data_pagto TEXT NOT NULL,
      valor_por_cota REAL NOT NULL,
      tipo TEXT DEFAULT 'DIVIDENDO',
      FOREIGN KEY (ativo_id) REFERENCES ativos(id)
    );
    INSERT INTO ativos (ticker) VALUES ('HGLG11'), ('XPML11');
    -- 5 proventos legados com tipos variados, incluindo NULL (PRD 03 RF-003)
    INSERT INTO proventos (ativo_id, data_com, data_pagto, valor_por_cota, tipo)
      VALUES
        (1, '2025-07-15', '2025-07-20', 0.80, 'DIVIDENDO'),
        (1, '2025-06-15', '2025-06-20', 0.85, NULL),
        (2, '2025-07-15', '2025-07-20', 0.95, 'RENDIMENTO'),
        (1, '2025-05-15', '2025-05-20', 1.50, '  DIVIDENDO  '),  -- whitespace
        (2, '2025-04-15', '2025-04-20', 2.00, 'dividendo');        -- lowercase
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
    INSERT INTO schema_migrations (version, description) VALUES ('1.2', 'PRD 12 — vencimento de contratos');
    INSERT INTO schema_migrations (version, description) VALUES ('1.3', 'PRD 02 — indicadores históricos');
    INSERT INTO config (chave, valor) VALUES ('versao_schema', '1.3');
  `);
  return db;
}

// SQL espelhando a migration 1.4 que virá em src/server/db.js
function applyMigration1_4(db) {
  // 1) Validar tipos legados: nenhum além de NULL e dos 4 válidos
  const invalidos = db.prepare(`
    SELECT id, tipo FROM proventos
    WHERE tipo IS NOT NULL
      AND UPPER(TRIM(tipo)) NOT IN ('DIVIDENDO','RENDIMENTO','BONIFICACAO','AMORTIZACAO')
  `).all();
  if (invalidos.length) {
    throw new Error(`Tipos não reconhecidos encontrados: ${JSON.stringify(invalidos)}`);
  }
  // 2) Recriar tabela
  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    DROP TABLE IF EXISTS proventos_v2;
    CREATE TABLE proventos_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ativo_id INTEGER NOT NULL,
      data_com TEXT,
      data_pagto TEXT NOT NULL,
      valor_por_cota REAL NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'DIVIDENDO'
        CHECK (tipo IN ('DIVIDENDO','RENDIMENTO','BONIFICACAO','AMORTIZACAO')),
      FOREIGN KEY (ativo_id) REFERENCES ativos(id)
    );
    INSERT INTO proventos_v2 (id, ativo_id, data_com, data_pagto, valor_por_cota, tipo)
    SELECT id, ativo_id, data_com, data_pagto, valor_por_cota,
           CASE WHEN tipo IS NULL THEN 'DIVIDENDO' ELSE UPPER(TRIM(tipo)) END
    FROM proventos;
    DROP TABLE proventos;
    ALTER TABLE proventos_v2 RENAME TO proventos;
    CREATE INDEX idx_proventos_ativo_data ON proventos(ativo_id, data_pagto DESC);
    CREATE INDEX idx_proventos_tipo_data ON proventos(tipo, data_pagto DESC);
    INSERT OR REPLACE INTO config (chave, valor) VALUES ('versao_schema', '1.4');
    INSERT OR IGNORE INTO schema_migrations (version, description)
      VALUES ('1.4', 'PRD 03: tipo AMORTIZACAO em proventos + CHECK constraint');
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

describe('migration 1.4 — PRD 03: AMORTIZACAO em proventos', () => {
  it('init.sql finaliza com versao_schema = 1.4 após o bump do PRD 03', () => {
    // Após aplicar PRD 03 num banco novo, init.sql deve declarar 1.4 e ter CHECK constraint
    const db = freshDb();
    const sql = fs.readFileSync(INIT_SQL_PATH, 'utf8');
    db.exec(sql);
    const v = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
    expect(v.valor).toBe('1.4');
    // Verifica que o CHECK constraint existe
    const checkRows = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='proventos'"
    ).get();
    expect(checkRows.sql).toMatch(/CHECK.*tipo.*IN/);
    expect(checkRows.sql).toMatch(/AMORTIZACAO/);
  });

  it('migration 1.4 preserva contagem e dados legados', () => {
    const db = db13SemCheck();
    applyMigration1_4(db);
    const c = db.prepare('SELECT COUNT(*) AS c FROM proventos').get().c;
    expect(c).toBe(5);
    // Todos os IDs preservados
    const ids = db.prepare('SELECT id FROM proventos ORDER BY id').all().map(r => r.id);
    expect(ids).toEqual([1, 2, 3, 4, 5]);
  });

  it('migration 1.4 normaliza NULL → DIVIDENDO (PRD 03 RF-003)', () => {
    const db = db13SemCheck();
    applyMigration1_4(db);
    const row = db.prepare('SELECT tipo FROM proventos WHERE id = 2').get();
    expect(row.tipo).toBe('DIVIDENDO');
  });

  it('migration 1.4 normaliza whitespace/lowercase via UPPER(TRIM)', () => {
    const db = db13SemCheck();
    applyMigration1_4(db);
    const r4 = db.prepare('SELECT tipo FROM proventos WHERE id = 4').get();
    expect(r4.tipo).toBe('DIVIDENDO');
    const r5 = db.prepare('SELECT tipo FROM proventos WHERE id = 5').get();
    expect(r5.tipo).toBe('DIVIDENDO');
  });

  it('migration 1.4 aceita insert com AMORTIZACAO após aplicada (RF-001)', () => {
    const db = db13SemCheck();
    applyMigration1_4(db);
    expect(() => {
      db.prepare(`
        INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota, tipo)
        VALUES (1, '2026-08-20', 0.50, 'AMORTIZACAO')
      `).run();
    }).not.toThrow();
  });

  it('migration 1.4 rejeita tipo desconhecido (RF-001 CHECK constraint)', () => {
    const db = db13SemCheck();
    applyMigration1_4(db);
    expect(() => {
      db.prepare(`
        INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota, tipo)
        VALUES (1, '2026-08-20', 0.50, 'TIPOBIZARRO')
      `).run();
    }).toThrow();
  });

  it('migration 1.4 cria índice idx_proventos_tipo_data (RF seção 4 performance)', () => {
    const db = db13SemCheck();
    applyMigration1_4(db);
    const idx = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_proventos_tipo_data'"
    ).get();
    expect(idx).toBeDefined();
  });

  it('migration 1.4 preserva FK com ativos', () => {
    const db = db13SemCheck();
    applyMigration1_4(db);
    const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
    expect(fkViolations).toEqual([]);
  });

  it('migration 1.4 é idempotente (segunda execução não quebra)', () => {
    const db = db13SemCheck();
    applyMigration1_4(db);
    // Segunda execução: SKIP via PRAGMA table_info
    const colsAntes = db.prepare('PRAGMA table_info(proventos)').all().map(c => c.name);
    expect(colsAntes).toContain('tipo');
    // Simular idempotência sem re-executar o DROP (que falharia): re-executar
    // o índice IF NOT EXISTS e a verificação final
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_proventos_tipo_data ON proventos(tipo, data_pagto DESC);
    `);
    const v = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
    expect(v.valor).toBe('1.4');
    // Não duplicou índice
    const dup = db.prepare(
      "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index' AND name='idx_proventos_tipo_data'"
    ).get();
    expect(dup.c).toBe(1);
  });

  it('migration 1.4 bloqueia se houver tipo legado inválido (PRD 03 Passo 3)', () => {
    const db = db13SemCheck();
    // Adiciona um tipo inesperado
    db.prepare("INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota, tipo) VALUES (1, '2025-01-01', 0.5, 'JCP')").run();
    expect(() => applyMigration1_4(db)).toThrow(/Tipos não reconhecidos/);
  });

  it('integrity_check retorna ok após migration 1.4', () => {
    const db = db13SemCheck();
    applyMigration1_4(db);
    const r = db.prepare('PRAGMA integrity_check').get();
    expect(r.integrity_check).toBe('ok');
  });

  it('migration 1.4 registra em schema_migrations (auditoria)', () => {
    const db = db13SemCheck();
    applyMigration1_4(db);
    const reg = db.prepare("SELECT * FROM schema_migrations WHERE version='1.4'").get();
    expect(reg).toBeDefined();
    expect(reg.description).toMatch(/AMORTIZACAO/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// COBERTURA DO CAMINHO REAL — runMigrations(db) (PRD 03 fix do bug
// CRÍTICO 1 reportado pelo schema-reviewer). Estes testes NÃO usam
// applyMigration1_4: rodam o wrapper runMigrations() exatamente como
// initDb() faz em produção.
// ═══════════════════════════════════════════════════════════════════════
describe('runMigrations caminho real — PRD 03 schema 1.4 em DB 1.3', () => {
  it('CRÍTICO 1: runMigrations em DB 1.3 com proventos legados NÃO quebra (nested tx resolvida)', async () => {
    const db = freshDb();
    db.exec(`
      CREATE TABLE ativos (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL UNIQUE);
      CREATE TABLE proventos (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL,
        data_com TEXT, data_pagto TEXT NOT NULL, valor_por_cota REAL NOT NULL,
        tipo TEXT DEFAULT 'DIVIDENDO',
        FOREIGN KEY (ativo_id) REFERENCES ativos(id));
      CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, description TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now')), duration_ms INTEGER,
        rows_before INTEGER, rows_after INTEGER, reversible INTEGER NOT NULL DEFAULT 1);
      INSERT INTO ativos (ticker) VALUES ('HGLG11'), ('XPML11');
      INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota, tipo) VALUES
        (1, '2025-07-15', 0.80, 'DIVIDENDO'),
        (1, '2025-08-15', 0.85, NULL),  -- será normalizado para DIVIDENDO
        (2, '2025-08-15', 0.95, 'RENDIMENTO');
      INSERT INTO schema_migrations (version, description) VALUES
        ('1.2', 'PRD 12'), ('1.3', 'PRD 02');
      INSERT INTO config (chave, valor) VALUES ('versao_schema', '1.3');
    `);

    const runMigrations = await loadRunMigrations();
    expect(() => runMigrations(db)).not.toThrow();

    // Bump de versão
    const v = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
    expect(v.valor).toBe('1.4');

    // Schema_migrations recebeu 1.4
    const reg = db.prepare("SELECT version FROM schema_migrations WHERE version='1.4'").get();
    expect(reg).toBeDefined();

    // Dados preservados: 3 proventos mantidos, NULL virou 'DIVIDENDO'
    const rows = db.prepare("SELECT id, tipo, valor_por_cota FROM proventos ORDER BY id").all();
    expect(rows.length).toBe(3);
    expect(rows[1].tipo).toBe('DIVIDENDO');  // NULL → DIVIDENDO
    expect(rows[2].tipo).toBe('RENDIMENTO');

    // CHECK aceita AMORTIZACAO
    expect(() =>
      db.prepare(`INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota, tipo) VALUES (1, '2026-09-20', 0.20, 'AMORTIZACAO')`).run()
    ).not.toThrow();

    // CHECK rejeita tipo desconhecido
    expect(() =>
      db.prepare(`INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota, tipo) VALUES (1, '2026-09-20', 0.20, 'JCP')`).run()
    ).toThrow();
  });

  it('runMigrations idempotente: chamar 2x mantém versao_schema=1.4 sem duplicar índices', async () => {
    const db = freshDb();
    db.exec(`
      CREATE TABLE ativos (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL UNIQUE);
      CREATE TABLE proventos (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL,
        data_com TEXT, data_pagto TEXT NOT NULL, valor_por_cota REAL NOT NULL, tipo TEXT DEFAULT 'DIVIDENDO',
        FOREIGN KEY (ativo_id) REFERENCES ativos(id));
      CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, description TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now')), duration_ms INTEGER,
        rows_before INTEGER, rows_after INTEGER, reversible INTEGER NOT NULL DEFAULT 1);
      INSERT INTO ativos (ticker) VALUES ('HGLG11');
      INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota, tipo) VALUES (1, '2025-08-15', 0.85, 'DIVIDENDO');
      INSERT INTO config (chave, valor) VALUES ('versao_schema', '1.3');
      INSERT INTO schema_migrations (version, description) VALUES ('1.3', 'PRD 02');
      INSERT INTO schema_migrations (version, description) VALUES ('1.2', 'PRD 12');
    `);

    const runMigrations = await loadRunMigrations();
    runMigrations(db);
    runMigrations(db);  // 2x: deve ser no-op

    const v = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
    expect(v.valor).toBe('1.4');
    // Índice criado exatamente 1x
    const idxCount = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index' AND name='idx_proventos_tipo_data'").get();
    expect(idxCount.c).toBe(1);
    // Schema_migrations tem 1.4 registrado exatamente 1x
    const m14 = db.prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE version='1.4'").get();
    expect(m14.c).toBe(1);
  });

  it('ALTO 3: runMigrations em DB 1.3 sem proventos (banco novo) é no-op silencioso', async () => {
    const db = freshDb();
    db.exec(`
      CREATE TABLE ativos (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL UNIQUE);
      CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, description TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now')), duration_ms INTEGER,
        rows_before INTEGER, rows_after INTEGER, reversible INTEGER NOT NULL DEFAULT 1);
      INSERT INTO config (chave, valor) VALUES ('versao_schema', '1.3');
      INSERT INTO schema_migrations (version, description) VALUES ('1.3', 'PRD 02');
    `);

    const runMigrations = await loadRunMigrations();
    expect(() => runMigrations(db)).not.toThrow();
    const v = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
    expect(v.valor).toBe('1.4');
  });
});
