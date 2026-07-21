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

/**
 * Realiza backup atômico do banco. Falha obrigatória (throw) se não conseguir
 * — alinhado à skill schema-migration / workflow schema-change. Backup deve
 * ocorrer ANTES de qualquer migration ou DDL destrutivo.
 *
 * Estratégia: usa o comando SQL `VACUUM INTO` (síncrono) que serializa
 * uma cópia consistente do banco incluindo o conteúdo do WAL. Isso é
 * mais robusto que `fs.copyFileSync` (que perde o WAL) e que
 * `db.backup()` (que é assíncrono no better-sqlite3 v11 e propaga
 * `The database connection is not open` se chamado sem await).
 */
function backupDb(p, dir) {
  if (!fs.existsSync(p)) return null;  // banco novo, sem o que copiar
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(dir, `byeinss.db.bak-${stamp}`);
  let srcDb = null;
  try {
    // Conexão de leitura apenas. VACUUM INTO não altera o DB original.
    srcDb = new Database(p, { readonly: true, fileMustExist: true });
    // Aspas envolvendo o path para evitar injection (path pode conter ' ou ")
    const safePath = backupPath.replace(/'/g, "''");
    srcDb.exec(`VACUUM INTO '${safePath}'`);
  } finally {
    if (srcDb) {
      try { srcDb.close(); } catch {}
    }
  }
  console.log('[db] backup criado (com WAL):', backupPath);
  return backupPath;
}

async function initDb() {
  if (dbInstance) return dbInstance;
  const p = dbPath();
  // Garante diretório
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  console.log('[db] dbPath:', p, 'exists:', fs.existsSync(p));

  // Backup automático ANTES de qualquer DDL (obrigatório, falha alto).
  backupDb(p, dir);

  dbInstance = new Database(p);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');

  // Decide se o banco é legacy (pré-migration 1.2 ou parcialmente migrado).
  // Lista as 7 colunas que a migration 1.2 adiciona + as 9 da migration 1.3;
  // se QUALQUER delas estiver ausente, é tratado como legacy e NÃO rodamos
  // init.sql inteiro (init.sql referencia colunas novas e quebraria).
  // runMigrations então completa a migração idempotentemente.
  const PRD12_COLS = [
    'vencimento_medio_contratos',
    'vencimento_medio_contratos_meses',
    'tipo_reajuste',
    'reajuste_percentual',
    'vencimento_medio_origem',
    'vencimento_medio_coletado_em',
    'alerta_vencimento'
  ];
  const PRD02_COLS = [
    'dy_medio_5a',
    'rentab_nominal_1a',
    'rentab_nominal_2a',
    'rentab_nominal_5a',
    'rentab_real_1a',
    'rentab_real_2a',
    'rentab_real_5a',
    'dy_medio_5a_fonte',
    'dy_medio_5a_atualizado_em'
  ];
  const ALL_NEEDED_COLS = [...PRD12_COLS, ...PRD02_COLS];
  const hasAtivosTable = dbInstance
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ativos'")
    .get();
  const ativosColsList = hasAtivosTable
    ? dbInstance.prepare('PRAGMA table_info(ativos)').all().map(c => c.name)
    : [];
  const ativosCols = new Set(ativosColsList);
  const colunasFaltando = ALL_NEEDED_COLS.filter(c => !ativosCols.has(c));
  // É legacy APENAS se a tabela `ativos` existe mas está faltando colunas.
  // Se `ativos` não existe, é fresh install — não pula init.sql.
  const isLegacy = hasAtivosTable && colunasFaltando.length > 0;
  console.log('[db] isLegacy:', isLegacy,
    'faltam', colunasFaltando.length, 'colunas PRD 12/02',
    colunasFaltando.length ? '(' + colunasFaltando.join(',') + ')' : '');

  if (isLegacy) {
    // Garante apenas o esqueleto mínimo (config table) se faltar.
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT);
    `);
    console.log('[db] DB legacy detectado — apenas runMigrations vai aplicar a upgrade');
  } else {
    const sqlPath = findInitSql();
    console.log('[db] init.sql path:', sqlPath);
    if (sqlPath) {
      const schema = fs.readFileSync(sqlPath, 'utf8');
      console.log('[db] schema length:', schema.length, 'bytes; has gestor:', schema.includes('gestor'));
      dbInstance.exec(schema);
      const cols = dbInstance.prepare('PRAGMA table_info(ativos)').all();
      console.log('[db] colunas após exec:', cols.map(c => c.name).join(','));
    } else {
      console.log('[db] WARN: init.sql não encontrado, usando schema inline');
      dbInstance.exec(FALLBACK_SCHEMA_INLINE);
    }
  }

  // Aplica migrations versionadas para cobrir bancos legados (schema anterior
  // a 1.2). Idempotente — já-aplicadas são puladas.
  runMigrations(dbInstance);

  // Validação final
  const fkViolations = dbInstance.prepare('PRAGMA foreign_key_check').all();
  if (fkViolations.length) {
    console.error('[db] ERRO: foreign_key_check retornou violações:', fkViolations);
    throw new Error('foreign_key_check falhou após migration — verifique backup');
  }
  const integrity = dbInstance.prepare('PRAGMA integrity_check').get();
  if (integrity.integrity_check !== 'ok') {
    console.error('[db] ERRO: integrity_check falhou:', integrity);
    throw new Error('integrity_check falhou após migration');
  }

  return dbInstance;
}

// Fallback inline — espelha db/init.sql. Sincronizar via revisão.
const FALLBACK_SCHEMA_INLINE = `
  CREATE TABLE IF NOT EXISTS ativos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL UNIQUE, tipo TEXT NOT NULL DEFAULT 'FII',
    segmento TEXT, razao_social TEXT, cnpj TEXT, gestor TEXT, taxa_adm REAL,
    nota INTEGER DEFAULT 5,
    observacao TEXT, dy_minimo REAL, preco_teto REAL, preco_muito_bom REAL,
    p_vp REAL, vp_cota REAL, vacancia REAL, num_imoveis INTEGER,
    dy_12m REAL, dy_24m REAL, ultimo_dividendo REAL, ultimo_pagto TEXT,
    alvo_pct_carteira REAL DEFAULT 1.76, ativo INTEGER DEFAULT 1,
    vencimento_medio_contratos DATE,
    vencimento_medio_contratos_meses INTEGER
      CHECK (vencimento_medio_contratos_meses IS NULL OR vencimento_medio_contratos_meses >= 0),
    tipo_reajuste TEXT
      CHECK (tipo_reajuste IS NULL OR tipo_reajuste IN ('IGPM','IPCA','FIXO','MISTO','OUTRO')),
    reajuste_percentual REAL
      CHECK (reajuste_percentual IS NULL OR (reajuste_percentual >= 0 AND reajuste_percentual <= 100)),
    vencimento_medio_origem TEXT
      CHECK (vencimento_medio_origem IS NULL OR vencimento_medio_origem IN ('main','comunicado','manual','fallback')),
    vencimento_medio_coletado_em TEXT,
    alerta_vencimento INTEGER DEFAULT 0 CHECK (alerta_vencimento IN (0,1)),
    -- Migration 1.3: Indicadores históricos de DY e rentabilidade real (PRD 02)
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
    updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS cotacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data TEXT NOT NULL, preco REAL NOT NULL, fonte TEXT DEFAULT 'manual', FOREIGN KEY (ativo_id) REFERENCES ativos(id));
  CREATE TABLE IF NOT EXISTS lancamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data TEXT NOT NULL, tipo TEXT NOT NULL CHECK(tipo IN ('COMPRA','VENDA')), quantidade INTEGER NOT NULL, preco REAL NOT NULL, corretora TEXT, taxa REAL DEFAULT 0, observacao TEXT, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (ativo_id) REFERENCES ativos(id));
  CREATE TABLE IF NOT EXISTS proventos (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data_com TEXT, data_pagto TEXT NOT NULL, valor_por_cota REAL NOT NULL, tipo TEXT NOT NULL DEFAULT 'DIVIDENDO' CHECK (tipo IN ('DIVIDENDO','RENDIMENTO','BONIFICACAO','AMORTIZACAO')), FOREIGN KEY (ativo_id) REFERENCES ativos(id));
  CREATE INDEX IF NOT EXISTS idx_proventos_tipo_data ON proventos(tipo, data_pagto DESC);
  CREATE TABLE IF NOT EXISTS metas (id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT NOT NULL, descricao TEXT, valor_alvo REAL NOT NULL, prazo_meses INTEGER, aporte_mensal REAL, taxa_anual REAL DEFAULT 12.0, patrimonio_atual REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS cenarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, descricao TEXT, tipo TEXT DEFAULT 'PATRIMONIO', valor_alvo REAL NOT NULL, prazo_meses INTEGER NOT NULL, aporte_inicial REAL DEFAULT 0, aporte_mensal REAL NOT NULL, taxa_anual REAL DEFAULT 12.0, reajuste_aporte_anual REAL DEFAULT 0, cor TEXT DEFAULT '#4ade80', ativo INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT);
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY, description TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    duration_ms INTEGER, rows_before INTEGER, rows_after INTEGER,
    reversible INTEGER NOT NULL DEFAULT 1);
  CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied ON schema_migrations(applied_at DESC);
  CREATE TABLE IF NOT EXISTS fii_scraper_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL, campo TEXT NOT NULL,
    sucesso INTEGER NOT NULL CHECK (sucesso IN (0,1)),
    origem TEXT, erro TEXT,
    ts TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (ticker) REFERENCES ativos(ticker));
  CREATE INDEX IF NOT EXISTS idx_scraper_log_ticker ON fii_scraper_log(ticker, ts);
  CREATE INDEX IF NOT EXISTS idx_ativos_alerta_venc ON ativos(alerta_vencimento) WHERE alerta_vencimento = 1;
  INSERT OR IGNORE INTO config (chave, valor) VALUES ('vencimento_janela_alerta_meses', '24');
  INSERT OR IGNORE INTO config (chave, valor) VALUES ('indicador_dy_vs_5a_abaixo_pct', '95');
`;

/**
 * Framework de migrations versionadas.
 *
 * Cada entry em MIGRATIONS é IMUTÁVEL após aplicada (registrada em
 * schema_migrations). Para nova migration, adicione um novo objeto com
 * `version` monotônico e função `up(db)`.
 *
 * Importante:
 *   - A função `up()` é executada dentro de uma transaction e a linha em
 *     schema_migrations é inserida NA MESMA transação (atomicidade real).
 *   - Após cada migration, `config.versao_schema` é bumped para a versão
 *     aplicada, mantendo a verdade única de versão de schema.
 *   - Cada migration é idempotente: usa IF NOT EXISTS / IF EXISTS.
 */
const MIGRATIONS = [
  {
    version: '1.2',
    description: 'PRD 12: vencimento médio de contratos + fii_scraper_log + framework schema_migrations',
    up(db) {
      // Cria framework schema_migrations (caso init.sql não esteja presente).
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version TEXT PRIMARY KEY,
          description TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (datetime('now')),
          duration_ms INTEGER,
          rows_before INTEGER,
          rows_after INTEGER,
          reversible INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied
          ON schema_migrations(applied_at DESC);
      `);
      // Adiciona 7 colunas em ativos (idempotente via PRAGMA table_info).
      const ativosCols = db.prepare('PRAGMA table_info(ativos)').all().map(c => c.name);
      const adds = [
        ['vencimento_medio_contratos', 'DATE'],
        ['vencimento_medio_contratos_meses', 'INTEGER CHECK (vencimento_medio_contratos_meses IS NULL OR vencimento_medio_contratos_meses >= 0)'],
        ['tipo_reajuste', "TEXT CHECK (tipo_reajuste IS NULL OR tipo_reajuste IN ('IGPM','IPCA','FIXO','MISTO','OUTRO'))"],
        ['reajuste_percentual', 'REAL CHECK (reajuste_percentual IS NULL OR (reajuste_percentual >= 0 AND reajuste_percentual <= 100))'],
        ['vencimento_medio_origem', "TEXT CHECK (vencimento_medio_origem IS NULL OR vencimento_medio_origem IN ('main','comunicado','manual','fallback'))"],
        ['vencimento_medio_coletado_em', 'TEXT'],
        ['alerta_vencimento', 'INTEGER DEFAULT 0 CHECK (alerta_vencimento IN (0,1))']
      ];
      for (const [name, decl] of adds) {
        if (!ativosCols.includes(name)) {
          db.exec(`ALTER TABLE ativos ADD COLUMN ${name} ${decl}`);
        }
      }
      // Cria tabela de auditoria do scraper (idempotente).
      db.exec(`
        CREATE TABLE IF NOT EXISTS fii_scraper_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticker TEXT NOT NULL,
          campo TEXT NOT NULL,
          sucesso INTEGER NOT NULL CHECK (sucesso IN (0,1)),
          origem TEXT,
          erro TEXT,
          ts TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (ticker) REFERENCES ativos(ticker)
        );
        CREATE INDEX IF NOT EXISTS idx_scraper_log_ticker ON fii_scraper_log(ticker, ts);
        CREATE INDEX IF NOT EXISTS idx_ativos_alerta_venc
          ON ativos(alerta_vencimento) WHERE alerta_vencimento = 1;
      `);
      // Seed config: janela de alerta. Idempotente.
      db.prepare(`
        INSERT OR IGNORE INTO config (chave, valor) VALUES ('vencimento_janela_alerta_meses', '24')
      `).run();
    }
  },
  {
    version: '1.3',
    description: 'PRD 02: indicadores históricos de DY (dy_medio_5a) + rentabilidades nominal/real 1a/2a/5a + fonte/atualizado_em',
    up(db) {
      // Adiciona 9 colunas nullable em ativos (idempotente via PRAGMA table_info).
      const ativosCols = db.prepare('PRAGMA table_info(ativos)').all().map(c => c.name);
      const adds = [
        ['dy_medio_5a', 'REAL'],
        ['rentab_nominal_1a', 'REAL'],
        ['rentab_nominal_2a', 'REAL'],
        ['rentab_nominal_5a', 'REAL'],
        ['rentab_real_1a', 'REAL'],
        ['rentab_real_2a', 'REAL'],
        ['rentab_real_5a', 'REAL'],
        ['dy_medio_5a_fonte', 'TEXT'],
        ['dy_medio_5a_atualizado_em', 'TEXT']
      ];
      for (const [name, decl] of adds) {
        if (!ativosCols.includes(name)) {
          db.exec(`ALTER TABLE ativos ADD COLUMN ${name} ${decl}`);
        }
      }
      // Seed config: threshold configurável de alerta DY vs 5a (PRD 02 RF-014).
      // Idempotente via INSERT OR IGNORE.
      db.prepare(`
        INSERT OR IGNORE INTO config (chave, valor) VALUES ('indicador_dy_vs_5a_abaixo_pct', '95')
      `).run();
    }
  },
  {
    // PRD 03: amortizações separadas em proventos de FIIs.
    // Adiciona tipo AMORTIZACAO + CHECK constraint em proventos.
    // Recria tabela (SQLite não suporta ALTER ADD CHECK).
    version: '1.4',
    description: 'PRD 03: tipo AMORTIZACAO em proventos + CHECK constraint + idx_proventos_tipo_data',
    up(db) {
      // 1. Defesa em profundidade: garantir framework schema_migrations presente.
      const hasSchema = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
        .get();
      if (!hasSchema) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now')),
            duration_ms INTEGER,
            rows_before INTEGER,
            rows_after INTEGER,
            reversible INTEGER NOT NULL DEFAULT 1
          );
          CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied
            ON schema_migrations(applied_at DESC);
        `);
      }
      // 2. Validar tipos legados (PRD 03 Passo 3). Bloqueia se houver.
      const hasProventos = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='proventos'")
        .get();
      if (!hasProventos) {
        // Banco sem proventos: nada a migrar — apenas garantir novo CHECK no init.sql.
        return;
      }
      const invalidos = db.prepare(`
        SELECT id, tipo FROM proventos
        WHERE tipo IS NOT NULL
          AND UPPER(TRIM(tipo)) NOT IN ('DIVIDENDO','RENDIMENTO','BONIFICACAO','AMORTIZACAO')
      `).all();
      if (invalidos.length) {
        throw new Error(
          `[migration 1.4] Existem proventos com tipo não reconhecido: ` +
          `ids=${invalidos.map(r => r.id).join(',')} ` +
          `tipos=${[...new Set(invalidos.map(r => r.tipo))].join(',')}. ` +
          `Migração interrompida — corrija manualmente antes de tentar de novo.`
        );
      }
      // 3. Verificar se já tem o CHECK constraint novo — idempotência.
      const tableSql = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='proventos'"
      ).get();
      if (tableSql && /CHECK\s*\(\s*tipo\s*IN/.test(tableSql.sql) &&
          /AMORTIZACAO/.test(tableSql.sql)) {
        // Já migrado — só garantir índices.
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_proventos_ativo_data
            ON proventos(ativo_id, data_pagto DESC);
          CREATE INDEX IF NOT EXISTS idx_proventos_tipo_data
            ON proventos(tipo, data_pagto DESC);
          INSERT OR IGNORE INTO config (chave, valor) VALUES ('versao_schema', '1.4');
        `);
        return;
      }
      // 4. Recriar tabela com CHECK (PRD 03 Passos 4-7).
      const rowsBefore = db.prepare('SELECT COUNT(*) AS c FROM proventos').get().c;
      const idsBefore = db.prepare('SELECT COALESCE(SUM(id), 0) AS s FROM proventos').get().s;
      const ativosBefore = db.prepare('SELECT COALESCE(SUM(ativo_id), 0) AS s FROM proventos').get().s;
      const valoresBefore = db.prepare('SELECT COALESCE(SUM(valor_por_cota), 0) AS s FROM proventos').get().s;

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
        COMMIT;
        PRAGMA foreign_keys = ON;
      `);

      // 5. Validações pós-migração (PRD 03 Passo 6 + 9).
      const rowsAfter = db.prepare('SELECT COUNT(*) AS c FROM proventos').get().c;
      const idsAfter = db.prepare('SELECT COALESCE(SUM(id), 0) AS s FROM proventos').get().s;
      const ativosAfter = db.prepare('SELECT COALESCE(SUM(ativo_id), 0) AS s FROM proventos').get().s;
      const valoresAfter = db.prepare('SELECT COALESCE(SUM(valor_por_cota), 0) AS s FROM proventos').get().s;
      if (rowsAfter !== rowsBefore || idsAfter !== idsBefore ||
          ativosAfter !== ativosBefore ||
          Math.abs(valoresAfter - valoresBefore) > 0.000001) {
        throw new Error(
          `[migration 1.4] Validação falhou — rows(${rowsBefore}→${rowsAfter}) ` +
          `ids(${idsBefore}→${idsAfter}) ativos(${ativosBefore}→${ativosAfter}) ` +
          `valores(${valoresBefore}→${valoresAfter})`
        );
      }
      const fkViolations = db.prepare('PRAGMA foreign_key_check(proventos)').all();
      if (fkViolations.length) {
        throw new Error(
          `[migration 1.4] foreign_key_check falhou: ${JSON.stringify(fkViolations)}`
        );
      }
      const integrity = db.prepare('PRAGMA integrity_check').get();
      if (integrity.integrity_check !== 'ok') {
        throw new Error(`[migration 1.4] integrity_check falhou: ${integrity.integrity_check}`);
      }
      // 6. Bump versão (runMigrations também faz — aqui é só idempotência extra).
      db.prepare(`
        INSERT OR REPLACE INTO config (chave, valor) VALUES ('versao_schema', '1.4')
      `).run();
    }
  }
];

function runMigrations(db) {
  // Garante que schema_migrations existe (defesa em profundidade).
  const hasSchema = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();
  if (!hasSchema) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY, description TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now')),
        duration_ms INTEGER, rows_before INTEGER, rows_after INTEGER,
        reversible INTEGER NOT NULL DEFAULT 1);
      CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied
        ON schema_migrations(applied_at DESC);
    `);
  }

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
  );

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    const t0 = Date.now();
    const tx = db.transaction(() => {
      m.up(db);
      db.prepare(`
        INSERT INTO schema_migrations (version, description, duration_ms)
        VALUES (?, ?, ?)
      `).run(m.version, m.description, Date.now() - t0);
      // Atualiza config.versao_schema dentro da mesma transaction.
      db.prepare(`
        INSERT OR REPLACE INTO config (chave, valor) VALUES ('versao_schema', ?)
      `).run(m.version);
    });
    tx();
    console.log(`[db] migration ${m.version} aplicada em ${Date.now() - t0}ms — ${m.description}`);
  }
}

function getDb() {
  if (!dbInstance) throw new Error('DB não inicializado');
  return dbInstance;
}

module.exports = { initDb, getDb, dbPath, MIGRATIONS, runMigrations, backupDb };
