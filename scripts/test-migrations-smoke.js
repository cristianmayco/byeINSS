// scripts/test-migrations-smoke.js
// Standalone smoke runner que espelha as asserções dos arquivos vitest em src/__tests__/.
// Existe porque vitest não está instalado no ambiente atual e o harness TDD exige
// evidência executável de Red/Green.
//
// Uso: node scripts/test-migrations-smoke.js
// Exit code: 0 se todas as fases passarem, 1 se qualquer uma falhar.

'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const express = require('express');
const http = require('http');

const REPO_ROOT = path.resolve(__dirname, '..');
const SHARED = path.join(REPO_ROOT, 'src', 'shared');
const ROUTES = path.join(REPO_ROOT, 'src', 'server', 'routes');
const INIT_SQL = fs.readFileSync(path.join(REPO_ROOT, 'db', 'init.sql'), 'utf8');

let passed = 0;
let failed = 0;
const failures = [];
const tests = [];           // {group, name, fn}
let currentGroup = '';

function describe(group, body) {
  const prev = currentGroup;
  currentGroup = group;
  body();
  currentGroup = prev;
}

function it(name, fn) {
  tests.push({ group: currentGroup, name, fn });
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toEqual(expected) {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) throw new Error(`expected ${b}, got ${a}`);
    },
    toBeNull() {
      if (actual !== null) throw new Error(`expected null, got ${JSON.stringify(actual)}`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`expected truthy, got ${JSON.stringify(actual)}`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`expected falsy, got ${JSON.stringify(actual)}`);
    },
    toBeGreaterThan(n) {
      if (!(actual > n)) throw new Error(`expected ${actual} > ${n}`);
    },
    toBeLessThan(n) {
      if (!(actual < n)) throw new Error(`expected ${actual} < ${n}`);
    },
    toContain(value) {
      if (Array.isArray(actual)) {
        if (!actual.includes(value)) throw new Error(`expected array to contain ${JSON.stringify(value)}`);
      } else if (typeof actual === 'string') {
        if (!actual.includes(value)) throw new Error(`expected string to contain ${JSON.stringify(value)}`);
      } else {
        throw new Error('toContain requires array or string');
      }
    },
    toMatch(re) {
      if (!re.test(actual)) throw new Error(`expected ${JSON.stringify(actual)} to match ${re}`);
    }
  };
}

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

// HTTP test helper (sem supertest disponível)
function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function httpJson(server, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      method,
      path: urlPath,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ============== Testes ==============

function runContratosTests() {
  let mod;
  try {
    delete require.cache[require.resolve(SHARED + '/contratos.js')];
    mod = require(SHARED + '/contratos.js');
  } catch (e) {
    describe('calcularAlertaVencimento', () => {
      it('módulo contratos.js existe (espera RED)', () => { throw new Error('src/shared/contratos.js não existe'); });
    });
    describe('parseTipoReajuste', () => {
      it('módulo contratos.js existe (espera RED)', () => { throw new Error('src/shared/contratos.js não existe'); });
    });
    describe('validarDadosContratos', () => {
      it('módulo contratos.js existe (espera RED)', () => { throw new Error('src/shared/contratos.js não existe'); });
    });
    return;
  }
  const { calcularAlertaVencimento, parseTipoReajuste, validarDadosContratos, TIPOS_REAJUSTE } = mod;

  describe('calcularAlertaVencimento', () => {
    it('data futura > 24m: alerta=false', () => {
      const r = calcularAlertaVencimento({ dataVenc: '2029-01-15', meses: null, hoje: '2026-07-20' });
      expect(r.alerta_24m).toBe(false);
      expect(r.vencido).toBe(false);
      expect(r.meses_ate_vencimento).toBeGreaterThan(24);
    });
    it('data futura 13m: alerta=true', () => {
      const r = calcularAlertaVencimento({ dataVenc: '2027-08-15', meses: null, hoje: '2026-07-20' });
      expect(r.alerta_24m).toBe(true);
      expect(r.meses_ate_vencimento).toBeLessThan(24);
    });
    it('meses=18: alerta=true', () => {
      const r = calcularAlertaVencimento({ dataVenc: null, meses: 18, hoje: '2026-07-20' });
      expect(r.alerta_24m).toBe(true);
      expect(r.meses_ate_vencimento).toBe(18);
    });
    it('meses=36: alerta=false', () => {
      const r = calcularAlertaVencimento({ dataVenc: null, meses: 36, hoje: '2026-07-20' });
      expect(r.alerta_24m).toBe(false);
    });
    it('boundary: meses=24 → alerta=false', () => {
      const r = calcularAlertaVencimento({ dataVenc: null, meses: 24, hoje: '2026-07-20' });
      expect(r.alerta_24m).toBe(false);
    });
    it('boundary: meses=23 → alerta=true', () => {
      const r = calcularAlertaVencimento({ dataVenc: null, meses: 23, hoje: '2026-07-20' });
      expect(r.alerta_24m).toBe(true);
    });
    it('data passada: vencido=true', () => {
      const r = calcularAlertaVencimento({ dataVenc: '2025-01-01', meses: null, hoje: '2026-07-20' });
      expect(r.vencido).toBe(true);
      expect(r.alerta_24m).toBe(true);
    });
    it('sem input: estado vazio', () => {
      const r = calcularAlertaVencimento({ dataVenc: null, meses: null, hoje: '2026-07-20' });
      expect(r.alerta_24m).toBe(false);
      expect(r.vencido).toBe(false);
      expect(r.meses_ate_vencimento).toBeNull();
      expect(r.disponivel).toBe(false);
    });
    it('precedência: dataVenc sobrepõe meses', () => {
      const r = calcularAlertaVencimento({ dataVenc: '2029-01-15', meses: 18, hoje: '2026-07-20' });
      expect(r.alerta_24m).toBe(false);
      expect(r.meses_ate_vencimento).toBeGreaterThan(24);
    });
  });

  describe('parseTipoReajuste', () => {
    it('IGPM', () => expect(parseTipoReajuste('IGPM').tipo).toBe('IGPM'));
    it('IGP-M normaliza', () => {
      expect(parseTipoReajuste('IGP-M').tipo).toBe('IGPM');
      expect(parseTipoReajuste('IGP M').tipo).toBe('IGPM');
      expect(parseTipoReajuste('igp-m').tipo).toBe('IGPM');
    });
    it('IPCA variações', () => {
      expect(parseTipoReajuste('IPCA').tipo).toBe('IPCA');
      expect(parseTipoReajuste('ipca').tipo).toBe('IPCA');
      expect(parseTipoReajuste('IPCA-15').tipo).toBe('IPCA');
    });
    it('FIXO com percentual', () => {
      const r = parseTipoReajuste('Fixo 3%');
      expect(r.tipo).toBe('FIXO');
      expect(r.percentual).toBe(3.0);
    });
    it('FIXO sem percentual: erro', () => {
      const r = parseTipoReajuste('Fixo');
      expect(r.erro).toBeTruthy();
      expect(r.erro).toMatch(/percentual/i);
    });
    it('MISTO', () => expect(parseTipoReajuste('Misto').tipo).toBe('MISTO'));
    it('OUTRO preserva texto', () => {
      const r = parseTipoReajuste('INPC');
      expect(r.tipo).toBe('OUTRO');
      expect(r.texto_original).toBe('INPC');
    });
    it('TIPOS_REAJUSTE 5 valores', () => {
      expect(TIPOS_REAJUSTE).toEqual(['IGPM', 'IPCA', 'FIXO', 'MISTO', 'OUTRO']);
    });
  });

  describe('validarDadosContratos', () => {
    it('data+meses conflitantes', () => {
      const r = validarDadosContratos({
        vencimento_medio_contratos: '2029-01-15',
        vencimento_medio_contratos_meses: 18
      });
      expect(r.ok).toBe(false);
      expect(r.erro).toMatch(/conflit/i);
    });
    it('só dataVenc OK', () => {
      const r = validarDadosContratos({ vencimento_medio_contratos: '2029-01-15' });
      expect(r.ok).toBe(true);
    });
    it('só meses OK', () => {
      const r = validarDadosContratos({ vencimento_medio_contratos_meses: 30 });
      expect(r.ok).toBe(true);
    });
    it('sem nenhum input: OK', () => {
      const r = validarDadosContratos({});
      expect(r.ok).toBe(true);
    });
    it('FIXO sem percentual: 422', () => {
      const r = validarDadosContratos({ tipo_reajuste: 'FIXO' });
      expect(r.ok).toBe(false);
      expect(r.status).toBe(422);
    });
    it('FIXO com percentual: 200', () => {
      const r = validarDadosContratos({ tipo_reajuste: 'FIXO', reajuste_percentual: 3.0 });
      expect(r.ok).toBe(true);
    });
    it('tipo inválido: 400', () => {
      const r = validarDadosContratos({ tipo_reajuste: 'NAO_EXISTE' });
      expect(r.ok).toBe(false);
      expect(r.status).toBe(400);
    });
  });
}

function runMigrationTests() {
  describe('schema_migrations + migration 1.0 (init.sql)', () => {
    let db;
    try {
      db = freshDb();
      db.exec(INIT_SQL);
    } catch (e) {
      it('init.sql executa sem erro', () => { throw e; });
      return;
    }

    it('init.sql executa sem erro', () => { /* passou */ });

    it('schema_migrations existe com colunas certas', () => {
      const cols = db.prepare('PRAGMA table_info(schema_migrations)').all().map(c => c.name);
      expect(cols).toEqual(['version', 'description', 'applied_at', 'duration_ms', 'rows_before', 'rows_after', 'reversible']);
    });

    it('versao_schema = 1.2', () => {
      const v = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
      expect(v.valor).toBe('1.2');
    });

    it('ativos contém 7 novas colunas do PRD 12', () => {
      const cols = db.prepare('PRAGMA table_info(ativos)').all().map(c => c.name);
      const expectedSubset = [
        'vencimento_medio_contratos',
        'vencimento_medio_contratos_meses',
        'tipo_reajuste',
        'reajuste_percentual',
        'vencimento_medio_origem',
        'vencimento_medio_coletado_em',
        'alerta_vencimento'
      ];
      const missing = expectedSubset.filter(c => !cols.includes(c));
      if (missing.length) throw new Error(`faltando colunas: ${missing.join(',')}`);
    });

    it('fii_scraper_log existe com colunas', () => {
      const cols = db.prepare('PRAGMA table_info(fii_scraper_log)').all().map(c => c.name);
      const expected = ['id', 'ticker', 'campo', 'sucesso', 'origem', 'erro', 'ts'];
      const missing = expected.filter(c => !cols.includes(c));
      if (missing.length) throw new Error(`faltando colunas: ${missing.join(',')}`);
    });

    it('FK ativos→fii_scraper_log', () => {
      db.prepare("INSERT INTO ativos (ticker) VALUES ('HGLG11')").run();
      db.prepare("INSERT INTO fii_scraper_log (ticker, campo, sucesso) VALUES ('HGLG11', 'vencimento_medio_contratos', 1)").run();
      const r = db.prepare("SELECT COUNT(*) AS c FROM fii_scraper_log WHERE ticker='HGLG11'").get();
      expect(r.c).toBe(1);
    });

    it('integrity_check retorna ok', () => {
      const r = db.prepare('PRAGMA integrity_check').get();
      expect(r.integrity_check).toBe('ok');
    });
  });

  describe('runMigrations aplica 1.2 em DB legacy 1.1 (regression)', () => {
    it('7 colunas adicionadas em ativos legacy; fii_scraper_log criada; versao_schema bumped', () => {
      const db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      db.exec(`
        CREATE TABLE ativos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticker TEXT NOT NULL UNIQUE,
          tipo TEXT NOT NULL DEFAULT 'FII'
        );
        CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);
        INSERT INTO config (chave, valor) VALUES ('versao_schema', '1.1');
      `);

      const mod = require(REPO_ROOT + '/src/server/db.js');
      if (mod.runMigrations) {
        mod.runMigrations(db);
      } else {
        throw new Error('runMigrations deveria estar exportada');
      }

      const cols = db.prepare('PRAGMA table_info(ativos)').all().map(c => c.name);
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
      if (missing.length) throw new Error(`faltando colunas no DB legacy: ${missing.join(',')}`);

      const v = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
      if (v.valor !== '1.2') throw new Error(`versao_schema deveria ser 1.2, está ${v.valor}`);

      const fk = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='fii_scraper_log'`).get();
      if (!fk) throw new Error('fii_scraper_log não foi criada no DB legacy');
    });

    it('runMigrations chamado 2x é idempotente (versao_schema é bumped via INSERT OR REPLACE)', () => {
      const db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      db.exec(`
        CREATE TABLE ativos (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL UNIQUE);
        CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);
        INSERT INTO config (chave, valor) VALUES ('versao_schema', '1.1');
      `);
      const mod = require(REPO_ROOT + '/src/server/db.js');
      mod.runMigrations(db);
      // Segunda chamada: não pode quebrar, não pode duplicar coluna, não pode duplicar log.
      mod.runMigrations(db);
      const versao = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
      if (versao.valor !== '1.2') throw new Error(`versao_schema deveria ser 1.2, está ${versao.valor}`);
      const fkCount = db.prepare("SELECT COUNT(*) AS c FROM fii_scraper_log").get().c;
      if (fkCount !== 0) throw new Error(`fii_scraper_log não deveria ter linhas (count=${fkCount})`);
    });

    it('backupDb exportada e throws em DB corrompido (fix schema-reviewer #2)', () => {
      const mod = require(REPO_ROOT + '/src/server/db.js');
      if (typeof mod.backupDb !== 'function') {
        throw new Error('backupDb deveria estar exportada');
      }
      // Cria um arquivo com bytes aleatórios (não é um DB válido).
      // O VACUUM INTO deve falhar alto quando tenta abrir esse arquivo.
      const tmpFile = '/tmp/byeinss-bak-corrupt-' + Date.now() + '.db';
      const tmpDir = '/tmp/byeinss-bak-corrupt-dir-' + Date.now();
      fs.writeFileSync(tmpFile, 'isto nao é um banco sqlite valido');
      fs.mkdirSync(tmpDir, { recursive: true });
      let thrown = null;
      try {
        mod.backupDb(tmpFile, tmpDir);
      } catch (e) {
        thrown = e;
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
        try { fs.rmdirSync(tmpDir, { recursive: true }); } catch {}
      }
      if (!thrown) {
        throw new Error('backup deveria ter thrown em DB corrompido, mas retornou normal');
      }
      // Mensagem deve indicar falha real de abertura/SQLite
      const msg = (thrown.message || '').toLowerCase();
      const code = thrown.code || '';
      const validSignals = /not a database|malformed|cannot open|encrypted|file is not a database|unable to open|sqlite_/i;
      if (!validSignals.test(msg) && !validSignals.test(code)) {
        throw new Error(`exception não parece ser erro SQLite: code=${code} message=${thrown.message}`);
      }
    });

    it('backupDb preserva dados do WAL usando db.backup() (fix #5 code-reviewer re-revisão)', () => {
      const tmpDir = '/tmp/byeinss-backup-test-' + Date.now();
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      try {
        const dbPath = path.join(tmpDir, 'byeinss.db');
        // 1) Cria DB, insere linha, desabilita checkpoint automático
        const db1 = new Database(dbPath);
        db1.pragma('journal_mode = WAL');
        // Desabilita checkpoint automático para GARANTIR que a linha fique no WAL
        db1.pragma('wal_autocheckpoint = 0');
        db1.exec(`CREATE TABLE x (id INTEGER PRIMARY KEY, v TEXT)`);
        db1.prepare(`INSERT INTO x (id, v) VALUES (1, 'linha-no-wal')`).run();
        // Confirma que WAL existe e contém dados committed (passive checkpoint)
        const walSizeBefore = fs.existsSync(dbPath + '-wal') ? fs.statSync(dbPath + '-wal').size : 0;
        if (walSizeBefore === 0) {
          db1.close();
          throw new Error('Pré-condição falhou: WAL vazio — teste não comprovaria nada');
        }
        // NÃO fecha db1 — manter conexão aberta previne checkpoint automático
        // (que poderia mover dados do WAL para o .db principal)

        // 2) Roda backupDb em conexão SEPARADA (readonly)
        const mod = require(REPO_ROOT + '/src/server/db.js');
        const backupPath = mod.backupDb(dbPath, tmpDir);
        if (!backupPath || !fs.existsSync(backupPath)) throw new Error('backup não foi criado');

        // 3) Abre o backup — deve ter a linha (comprovando que VACUUM INTO leu o WAL)
        const db2 = new Database(backupPath, { readonly: true });
        const row = db2.prepare('SELECT v FROM x WHERE id = 1').get();
        db2.close();
        if (!row || row.v !== 'linha-no-wal') {
          throw new Error(`backup não preservou linha do WAL: ${JSON.stringify(row)}`);
        }
        // Limpeza
        db1.close();
      } finally {
        for (const f of fs.readdirSync(tmpDir)) {
          try { fs.unlinkSync(path.join(tmpDir, f)); } catch {}
        }
        try { fs.rmdirSync(tmpDir); } catch {}
      }
    });

    it('Legacy detection exercita initDb() real com schema parcial (1-6 cols) (fix #4 code-reviewer)', async () => {
      // Agora usa initDb() real (não runMigrations direto) para garantir
      // que o código de detecção hasAtivosTable && colunasFaltando é exercitado.
      const tmpDir = '/tmp/byeinss-legacy-test-' + Date.now();
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      try {
        const dbPath = path.join(tmpDir, 'byeinss.db');
        // Cria DB legacy com SÓ 4 das 7 colunas do PRD 12 (estado de migration interrompida)
        const dbSetup = new Database(dbPath);
        dbSetup.exec(`
          CREATE TABLE ativos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL UNIQUE,
            tipo TEXT NOT NULL DEFAULT 'FII',
            vencimento_medio_contratos DATE,
            vencimento_medio_contratos_meses INTEGER,
            tipo_reajuste TEXT,
            reajuste_percentual REAL
          );
          CREATE TABLE cotacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data TEXT NOT NULL, preco REAL NOT NULL, FOREIGN KEY (ativo_id) REFERENCES ativos(id));
          CREATE TABLE lancamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data TEXT NOT NULL, tipo TEXT NOT NULL CHECK(tipo IN ('COMPRA','VENDA')), quantidade INTEGER NOT NULL, preco REAL NOT NULL, FOREIGN KEY (ativo_id) REFERENCES ativos(id));
          CREATE TABLE proventos (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data_pagto TEXT NOT NULL, valor_por_cota REAL NOT NULL, FOREIGN KEY (ativo_id) REFERENCES ativos(id));
          CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);
          INSERT INTO config (chave, valor) VALUES ('versao_schema', '1.1.partial');
        `);
        dbSetup.prepare("INSERT INTO ativos (ticker, tipo) VALUES ('HGLG11', 'FII')").run();
        dbSetup.close();

        // initDb() real — exercita hasAtivosTable && colunasFaltando
        process.env.BYEINSS_DATA = tmpDir;
        // Limpa cache para forçar re-load do módulo
        delete require.cache[require.resolve(REPO_ROOT + '/src/server/db.js')];
        const mod = require(REPO_ROOT + '/src/server/db.js');
        await mod.initDb();
        const db = mod.getDb();

        const cols = db.prepare('PRAGMA table_info(ativos)').all().map(c => c.name);
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
        if (missing.length) throw new Error(`initDb não completou colunas: faltam ${missing.join(',')}`);
        const ativos = db.prepare('SELECT COUNT(*) AS c FROM ativos').get().c;
        if (ativos !== 1) throw new Error(`FII legado deveria estar preservado, count=${ativos}`);
        const v = db.prepare("SELECT valor FROM config WHERE chave='versao_schema'").get();
        if (v.valor !== '1.2') throw new Error(`versao_schema deveria ser 1.2, está ${v.valor}`);
        db.close();
      } finally {
        for (const f of fs.readdirSync(tmpDir)) {
          try { fs.unlinkSync(path.join(tmpDir, f)); } catch {}
        }
        try { fs.rmdirSync(tmpDir); } catch {}
        try { delete process.env.BYEINSS_DATA; } catch {}
      }
    });
  });
}

function runApiTests() {
  describe('API /api/fiis/contratos + /api/dashboard/alertas-vencimento', () => {
    let db, server, contratosRouter;
    let setupOk = true;

    it('setup DB inicializa', () => {
      db = freshDb();
      db.exec(INIT_SQL);
      db.prepare("INSERT OR IGNORE INTO ativos (ticker, tipo) VALUES ('HGLG11', 'FII')").run();
      db.prepare("INSERT OR IGNORE INTO ativos (ticker, tipo) VALUES ('XPML11', 'FII')").run();
      db.prepare("INSERT OR IGNORE INTO ativos (ticker, tipo) VALUES ('PETR4', 'ACAO')").run();
    });

    it('carrega contratos router', () => {
      try {
        delete require.cache[require.resolve(ROUTES + '/contratos.js')];
        contratosRouter = require(ROUTES + '/contratos.js');
      } catch (e) {
        setupOk = false;
        throw new Error('modulo contratos router nao existe (Red phase esperado): ' + e.message);
      }
    });

    it('sobe servidor HTTP em 127.0.0.1', async () => {
      if (!setupOk) return; // pulo se router não carregou
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.db = db; next(); });
      app.use('/api/fiis/contratos', contratosRouter);
      app.use('/api/dashboard', contratosRouter.dashboard || contratosRouter);
      server = await startServer(app);
    });

    it('GET 404 ticker inexistente (formato válido)', async () => {
      if (!setupOk) throw new Error('setup falhou — manter RED');
      const res = await httpJson(server, 'GET', '/api/fiis/contratos/AAAA11');
      if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
    });

    it('GET 200 campos default-null', async () => {
      if (!setupOk) throw new Error('setup falhou — manter RED');
      const res = await httpJson(server, 'GET', '/api/fiis/contratos/HGLG11');
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status} body=${JSON.stringify(res.body)}`);
      if (res.body.ticker !== 'HGLG11') throw new Error('ticker errado');
      if (res.body.vencimento_medio_contratos !== null) throw new Error('expected null');
      if (res.body.alerta_vencimento !== false) throw new Error('expected alerta=false');
    });

    it('GET 400 ticker inválido', async () => {
      if (!setupOk) throw new Error('setup falhou');
      const res = await httpJson(server, 'GET', '/api/fiis/contratos/123');
      if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
    });

    it('PUT cria manual + origem=manual', async () => {
      if (!setupOk) throw new Error('setup falhou');
      const res = await httpJson(server, 'PUT', '/api/fiis/contratos/HGLG11', { vencimento_medio_contratos_meses: 18, tipo_reajuste: 'IGPM' });
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status} body=${JSON.stringify(res.body)}`);
      if (res.body.vencimento_medio_contratos_meses !== 18) throw new Error('expected 18');
      if (res.body.tipo_reajuste !== 'IGPM') throw new Error('expected IGPM');
      if (res.body.vencimento_medio_origem !== 'manual') throw new Error('expected origem=manual');
      if (res.body.alerta_vencimento !== true) throw new Error('expected alerta=true');
    });

    it('PUT rejeita data+meses conflitantes (400)', async () => {
      if (!setupOk) throw new Error('setup falhou');
      const res = await httpJson(server, 'PUT', '/api/fiis/contratos/HGLG11', {
        vencimento_medio_contratos: '2029-01-15',
        vencimento_medio_contratos_meses: 18
      });
      if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
    });

    it('PUT rejeita FIXO sem percentual (422)', async () => {
      if (!setupOk) throw new Error('setup falhou');
      const res = await httpJson(server, 'PUT', '/api/fiis/contratos/HGLG11', { tipo_reajuste: 'FIXO' });
      if (res.status !== 422) throw new Error(`expected 422, got ${res.status}`);
    });

    it('PUT alerta=false quando meses >= 24', async () => {
      if (!setupOk) throw new Error('setup falhou');
      const res = await httpJson(server, 'PUT', '/api/fiis/contratos/XPML11', { vencimento_medio_contratos_meses: 36 });
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
      if (res.body.alerta_vencimento !== false) throw new Error('expected alerta=false');
    });

    it('PUT 404 quando ticker não existe (formato válido)', async () => {
      if (!setupOk) throw new Error('setup falhou');
      const res = await httpJson(server, 'PUT', '/api/fiis/contratos/AAAA11', { vencimento_medio_contratos_meses: 18 });
      if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
    });

    // === Regressões dos 5 novos fixes do code-reviewer (re-revisão) ===

    it('PUT rejeita data inválida (não-ISO) com 400 (fix #3)', async () => {
      if (!setupOk) throw new Error('setup falhou');
      const res = await httpJson(server, 'PUT', '/api/fiis/contratos/HGLG11', { vencimento_medio_contratos: 'not-a-date' });
      if (res.status !== 400) throw new Error(`expected 400, got ${res.status} body=${JSON.stringify(res.body)}`);
    });

    it('PUT rejeita data formato dd/mm/yyyy com 400 (fix #3)', async () => {
      if (!setupOk) throw new Error('setup falhou');
      const res = await httpJson(server, 'PUT', '/api/fiis/contratos/HGLG11', { vencimento_medio_contratos: '15/01/2029' });
      if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
    });

    it('PUT rejeita data impossível (2026-02-30) com 400 (fix #3)', async () => {
      if (!setupOk) throw new Error('setup falhou');
      const res = await httpJson(server, 'PUT', '/api/fiis/contratos/HGLG11', { vencimento_medio_contratos: '2026-02-30' });
      if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
    });

    it('PUT rejeita meses como string com 400 (fix #3)', async () => {
      if (!setupOk) throw new Error('setup falhou');
      const res = await httpJson(server, 'PUT', '/api/fiis/contratos/HGLG11', { vencimento_medio_contratos_meses: '18' });
      if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
    });

    it('PUT rejeita meses negativo com 400 (fix #3)', async () => {
      if (!setupOk) throw new Error('setup falhou');
      const res = await httpJson(server, 'PUT', '/api/fiis/contratos/HGLG11', { vencimento_medio_contratos_meses: -5 });
      if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
    });

    it('PUT rejeita FIXO com percentual > 100 com 422 (fix #3)', async () => {
      if (!setupOk) throw new Error('setup falhou');
      const res = await httpJson(server, 'PUT', '/api/fiis/contratos/HGLG11', { tipo_reajuste: 'FIXO', reajuste_percentual: 101 });
      if (res.status !== 422) throw new Error(`expected 422, got ${res.status}`);
    });

    it('PUT parcial: update só tipo_reajuste preserva meses (fix #2)', async () => {
      if (!setupOk) throw new Error('setup falhou');
      // Primeiro seta 18m com IGPM
      let r = await httpJson(server, 'PUT', '/api/fiis/contratos/HGLG11', { vencimento_medio_contratos_meses: 18, tipo_reajuste: 'IGPM' });
      if (r.status !== 200) throw new Error(`setup PUT falhou: ${r.status}`);
      if (r.body.alerta_vencimento !== true) throw new Error('setup: alerta deveria ser true com 18m');
      // Agora atualiza SÓ tipo_reajuste → meses deve continuar 18, alerta continua true
      r = await httpJson(server, 'PUT', '/api/fiis/contratos/HGLG11', { tipo_reajuste: 'IPCA' });
      if (r.status !== 200) throw new Error(`PUT parcial falhou: ${r.status} body=${JSON.stringify(r.body)}`);
      if (r.body.vencimento_medio_contratos_meses !== 18) throw new Error(`meses deveria continuar 18, obtido ${r.body.vencimento_medio_contratos_meses}`);
      if (r.body.alerta_vencimento !== true) throw new Error('alerta deveria continuar true');
    });

    it('PUT parcial: data+meses conflito detectado em merge (fix #2)', async () => {
      if (!setupOk) throw new Error('setup falhou');
      // Setta 18m primeiro
      let r = await httpJson(server, 'PUT', '/api/fiis/contratos/HGLG11', { vencimento_medio_contratos_meses: 18 });
      if (r.status !== 200) throw new Error('setup PUT falhou');
      // Agora tenta sobrescrever SÓ com data → merge resultaria em data+meses simultâneos
      r = await httpJson(server, 'PUT', '/api/fiis/contratos/HGLG11', { vencimento_medio_contratos: '2029-01-15' });
      if (r.status !== 400) throw new Error(`expected 400 (conflito detectado no merge), got ${r.status}`);
    });

    it('Dashboard dinâmico: FII com data+meses dentro da janela aparece mesmo sem meses persistido (fix #1)', async () => {
      if (!setupOk) throw new Error('setup falhou');
      // Limpa FIIs anteriores para 36m
      await httpJson(server, 'PUT', '/api/fiis/contratos/HGLG11', { vencimento_medio_contratos_meses: 36 });
      await httpJson(server, 'PUT', '/api/fiis/contratos/XPML11', { vencimento_medio_contratos_meses: 36 });
      // Insere um novo FII via SQL direto (data-only, sem meses)
      db.prepare("INSERT OR IGNORE INTO ativos (ticker, tipo) VALUES ('AAAA11', 'FII')").run();
      const dataCurta = new Date();
      dataCurta.setMonth(dataCurta.getMonth() + 15);
      const dataISO = dataCurta.toISOString().slice(0, 10);
      db.prepare(`
        UPDATE ativos SET
          vencimento_medio_contratos = ?,
          vencimento_medio_contratos_meses = NULL,
          vencimento_medio_origem = 'main',
          vencimento_medio_coletado_em = datetime('now')
        WHERE ticker = 'AAAA11'
      `).run(dataISO);
      // GET dashboard — AAAA11 deve aparecer (data-only, calculado dinamicamente)
      const r = await httpJson(server, 'GET', '/api/dashboard/alertas-vencimento');
      if (r.status !== 200) throw new Error(`GET dashboard falhou: ${r.status}`);
      if (!r.body.itens.find(i => i.ticker === 'AAAA11')) {
        throw new Error(`AAAA11 (data-only) deveria estar no dashboard, mas itens=${JSON.stringify(r.body.itens)}`);
      }
      // Limpa AAAA11 para não interferir nos testes seguintes
      db.prepare("DELETE FROM ativos WHERE ticker = 'AAAA11'").run();
    });

    it('GET dashboard: 2 FIIs abaixo 24m, ignora PETR4', async () => {
      if (!setupOk) throw new Error('setup falhou');
      await httpJson(server, 'PUT', '/api/fiis/contratos/HGLG11', { vencimento_medio_contratos_meses: 18, tipo_reajuste: 'IGPM' });
      await httpJson(server, 'PUT', '/api/fiis/contratos/XPML11', { vencimento_medio_contratos_meses: 14, tipo_reajuste: 'FIXO', reajuste_percentual: 3.0 });
      await httpJson(server, 'PUT', '/api/fiis/contratos/PETR4', { vencimento_medio_contratos_meses: 6 });
      const res = await httpJson(server, 'GET', '/api/dashboard/alertas-vencimento');
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
      if (res.body.total !== 2) throw new Error(`expected total=2, got ${res.body.total}`);
      const tickers = res.body.itens.map(i => i.ticker).sort();
      const expected = ['HGLG11', 'XPML11'];
      if (JSON.stringify(tickers) !== JSON.stringify(expected)) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(tickers)}`);
    });

    it('GET dashboard: 0 quando todos >= 24m', async () => {
      if (!setupOk) throw new Error('setup falhou');
      await httpJson(server, 'PUT', '/api/fiis/contratos/HGLG11', { vencimento_medio_contratos_meses: 36 });
      await httpJson(server, 'PUT', '/api/fiis/contratos/XPML11', { vencimento_medio_contratos_meses: 36 });
      const res = await httpJson(server, 'GET', '/api/dashboard/alertas-vencimento');
      if (res.body.total !== 0) throw new Error(`expected total=0, got ${res.body.total}`);
    });
  });
}

// ============== Execução ==============

console.log('=== TDD Smoke Runner: byeINSS PRD 12 (Vencimento de Contratos) ===');
console.log('Phase 1: Red — testes escritos ANTES da implementação');
console.log('Phase 2: Green — implementação torna testes verdes');
console.log('Phase 3: Refactor — qualidade sob testes verdes');

let hasImplementation = true;
try { require(SHARED + '/contratos.js'); } catch { hasImplementation = false; }
try { require(ROUTES + '/contratos.js'); } catch { hasImplementation = false; }

console.log(`\nImplementação atual: ${hasImplementation ? 'GREEN phase (espera-se 0% failure)' : 'RED phase (espera-se failures nos módulos faltantes)'}\n`);

runContratosTests();
runMigrationTests();
runApiTests();

// runSequential: aguarda todos os testes assíncronos antes de imprimir resultado
(async () => {
  let lastLen = -1;
  while (tests.length !== lastLen) {
    lastLen = tests.length;
    const batch = tests.splice(0);
    for (const t of batch) {
      process.stdout.write(`  [${t.group}] → ${t.name}... `);
      try {
        await t.fn();
        passed += 1;
        console.log('OK');
      } catch (e) {
        failed += 1;
        failures.push({ name: `${t.group} → ${t.name}`, error: e });
        console.log(`FALHOU\n    ${e.message}`);
      }
    }
  }

  console.log(`\n=== Resultado ===`);
  console.log(`Passou: ${passed}`);
  console.log(`Falhou: ${failed}`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f.name}: ${f.error.message.split('\n')[0]}`));
  }
  process.exit(failed === 0 ? 0 : 1);
})();
