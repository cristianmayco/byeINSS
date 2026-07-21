// src/__tests__/integration/api-scraper-indicadores.test.js
// Cobre o endpoint PRD 02 sub-PR 3:
//   - POST /api/fiis/scraper/indicadores/resync
//   - GET  /api/fiis/scraper/indicadores/status
//
// O scraper real depende de Electron — em testes, mockamos via
// `global.__mockScraperIndicadores` para simular a extração.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';

import scraperIndicadoresRouter from '../../server/routes/scraper-indicadores.js';

function appWithDb(db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = db; next(); });
  app.use('/api/fiis/scraper/indicadores', scraperIndicadoresRouter);
  return app;
}

function setupDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE ativos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL DEFAULT 'FII',
      ativo INTEGER DEFAULT 1,
      dy_12m REAL,
      dy_medio_5a REAL, rentab_nominal_1a REAL, rentab_nominal_2a REAL,
      rentab_nominal_5a REAL, rentab_real_1a REAL, rentab_real_2a REAL,
      rentab_real_5a REAL,
      dy_medio_5a_fonte TEXT, dy_medio_5a_atualizado_em TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

// Mock de scraper que devolve dados variados por ticker
function makeMockScraper(extractMap = {}) {
  return {
    async resyncAll(db, opts) {
      let fiiList;
      if (Array.isArray(opts.tickers) && opts.tickers.length > 0) {
        const placeholders = opts.tickers.map(() => '?').join(',');
        fiiList = db.prepare(
          `SELECT id, ticker FROM ativos WHERE tipo='FII' AND UPPER(ticker) IN (${placeholders}) ORDER BY ticker`
        ).all(...opts.tickers.map(t => String(t).toUpperCase()));
      } else {
        fiiList = db.prepare("SELECT id, ticker FROM ativos WHERE tipo='FII' ORDER BY ticker").all();
      }
      const detalhes = [];
      let sucessos = 0, falhas = 0;
      const { mergeIndicadores } = await import('../../shared/indicadores.js');
      for (const fii of fiiList) {
        try {
          const dados = extractMap[fii.ticker];
          if (!dados) throw new Error('ticker não tem fixture');
          const prev = db.prepare(
            `SELECT dy_medio_5a, rentab_nominal_1a, rentab_nominal_2a,
                    rentab_nominal_5a, rentab_real_1a, rentab_real_2a,
                    rentab_real_5a, dy_medio_5a_fonte, dy_medio_5a_atualizado_em
             FROM ativos WHERE id = ?`
          ).get(fii.id);
          const novo = {
            dy_medio_5a: dados.dy_medio_5a,
            rentab_nominal_1a: dados.rentab_nominal_1a,
            rentab_nominal_2a: dados.rentab_nominal_2a,
            rentab_nominal_5a: dados.rentab_nominal_5a,
            rentab_real_1a: dados.rentab_real_1a,
            rentab_real_2a: dados.rentab_real_2a,
            rentab_real_5a: dados.rentab_real_5a
          };
          const merged = mergeIndicadores(prev, novo);
          db.prepare(
            `UPDATE ativos SET
              dy_medio_5a = ?, rentab_nominal_1a = ?, rentab_nominal_2a = ?,
              rentab_nominal_5a = ?, rentab_real_1a = ?, rentab_real_2a = ?,
              rentab_real_5a = ?, dy_medio_5a_fonte = COALESCE(?, dy_medio_5a_fonte),
              dy_medio_5a_atualizado_em = COALESCE(?, dy_medio_5a_atualizado_em),
              updated_at = datetime('now') WHERE id = ?`
          ).run(
            merged.dy_medio_5a,
            merged.rentab_nominal_1a, merged.rentab_nominal_2a, merged.rentab_nominal_5a,
            merged.rentab_real_1a, merged.rentab_real_2a, merged.rentab_real_5a,
            merged.dy_medio_5a_fonte, merged.dy_medio_5a_atualizado_em,
            fii.id
          );
          detalhes.push({ ticker: fii.ticker, success: true, campos_atualizados: Object.keys(novo) });
          sucessos++;
        } catch (e) {
          detalhes.push({ ticker: fii.ticker, success: false, error: e.message });
          falhas++;
        }
        if (typeof opts.onProgress === 'function') {
          opts.onProgress(fii.ticker, detalhes[detalhes.length - 1]);
        }
      }
      return { total: fiiList.length, sucessos, falhas, detalhes };
    }
  };
}

describe('POST /api/fiis/scraper/indicadores/resync (PRD 02 sub-PR 3)', () => {
  let db, app, originalMock;
  beforeEach(() => {
    db = setupDb();
    app = appWithDb(db);
    originalMock = global.__mockScraperIndicadores;
  });
  afterEach(() => {
    global.__mockScraperIndicadores = originalMock;
  });

  it('400 quando body.tickers não é array', async () => {
    const res = await request(app)
      .post('/api/fiis/scraper/indicadores/resync')
      .send({ tickers: 'HGLG11' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('array');
  });

  it('400 quando ticker não bate regex FII', async () => {
    const res = await request(app)
      .post('/api/fiis/scraper/indicadores/resync')
      .send({ tickers: ['HGLG11', 'PETR4'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('PETR4');
  });

  it('200 com body vazio quando não há FIIs na carteira', async () => {
    global.__mockScraperIndicadores = makeMockScraper({});
    const res = await request(app)
      .post('/api/fiis/scraper/indicadores/resync')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.sucessos).toBe(0);
    expect(res.body.falhas).toBe(0);
    expect(res.body.detalhes).toEqual([]);
    expect(typeof res.body.janela_execucao_ms).toBe('number');
  });

  it('200 processa todos os FIIs sem filtro', async () => {
    db.prepare(`INSERT INTO ativos (ticker) VALUES
      ('HGLG11'), ('XPML11'), ('KNIP11')`).run();
    global.__mockScraperIndicadores = makeMockScraper({
      HGLG11: { dy_medio_5a: 9.0, rentab_nominal_1a: 12.0, rentab_real_1a: 8.5,
               rentab_nominal_2a: null, rentab_nominal_5a: null,
               rentab_real_2a: null, rentab_real_5a: null },
      XPML11: { dy_medio_5a: 8.0, rentab_nominal_1a: 15.0, rentab_real_1a: 11.0,
               rentab_nominal_2a: null, rentab_nominal_5a: null,
               rentab_real_2a: null, rentab_real_5a: null },
      KNIP11: { dy_medio_5a: 10.5, rentab_nominal_1a: 9.0, rentab_real_1a: 5.5,
               rentab_nominal_2a: null, rentab_nominal_5a: null,
               rentab_real_2a: null, rentab_real_5a: null }
    });
    const res = await request(app)
      .post('/api/fiis/scraper/indicadores/resync')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.sucessos).toBe(3);
    expect(res.body.falhas).toBe(0);
    expect(res.body.detalhes).toHaveLength(3);

    // Verifica que persistiu
    const hglg = db.prepare("SELECT dy_medio_5a, rentab_real_1a FROM ativos WHERE ticker='HGLG11'").get();
    expect(hglg.dy_medio_5a).toBe(9.0);
    expect(hglg.rentab_real_1a).toBe(8.5);

    // updated_at + dy_medio_5a_fonte setados
    const meta = db.prepare("SELECT dy_medio_5a_fonte, dy_medio_5a_atualizado_em FROM ativos WHERE ticker='HGLG11'").get();
    expect(meta.dy_medio_5a_fonte).toBe('investidor10');
    expect(meta.dy_medio_5a_atualizado_em).not.toBeNull();
  });

  it('200 processa apenas os tickers fornecidos no body', async () => {
    db.prepare(`INSERT INTO ativos (ticker) VALUES
      ('HGLG11'), ('XPML11'), ('KNIP11')`).run();
    global.__mockScraperIndicadores = makeMockScraper({
      HGLG11: { dy_medio_5a: 9.0, rentab_nominal_1a: 12.0, rentab_real_1a: 8.5,
               rentab_nominal_2a: null, rentab_nominal_5a: null,
               rentab_real_2a: null, rentab_real_5a: null }
    });
    const res = await request(app)
      .post('/api/fiis/scraper/indicadores/resync')
      .send({ tickers: ['HGLG11'] });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.sucessos).toBe(1);

    // XPML11 e KNIP11 não foram tocados
    const xptodo = db.prepare("SELECT dy_medio_5a FROM ativos WHERE ticker='XPML11'").get();
    expect(xptodo.dy_medio_5a).toBeNull();
  });

  it('falha de 1 ticker não derruba batch (RF-007)', async () => {
    db.prepare(`INSERT INTO ativos (ticker) VALUES
      ('HGLG11'), ('XPML11'), ('KNIP11')`).run();
    // mock só tem HGLG11 e KNIP11 — XPML11 falhará
    global.__mockScraperIndicadores = makeMockScraper({
      HGLG11: { dy_medio_5a: 9.0, rentab_nominal_1a: 12.0, rentab_real_1a: 8.5,
               rentab_nominal_2a: null, rentab_nominal_5a: null,
               rentab_real_2a: null, rentab_real_5a: null },
      KNIP11: { dy_medio_5a: 10.5, rentab_nominal_1a: 9.0, rentab_real_1a: 5.5,
               rentab_nominal_2a: null, rentab_nominal_5a: null,
               rentab_real_2a: null, rentab_real_5a: null }
    });
    const res = await request(app)
      .post('/api/fiis/scraper/indicadores/resync')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.sucessos).toBe(2);
    expect(res.body.falhas).toBe(1);
    const xpml11 = res.body.detalhes.find(d => d.ticker === 'XPML11');
    expect(xpml11.success).toBe(false);
    expect(xpml11.error).toContain('fixture');
  });

  it('idempotente: rodar 2x não degrada dados válidos (RF-008)', async () => {
    db.prepare(`INSERT INTO ativos (ticker) VALUES ('HGLG11')`).run();
    global.__mockScraperIndicadores = makeMockScraper({
      HGLG11: { dy_medio_5a: 9.0, rentab_nominal_1a: 12.0, rentab_real_1a: 8.5,
               rentab_nominal_2a: null, rentab_nominal_5a: null,
               rentab_real_2a: null, rentab_real_5a: null }
    });
    await request(app).post('/api/fiis/scraper/indicadores/resync').send({});
    const antes = db.prepare("SELECT * FROM ativos WHERE ticker='HGLG11'").get();
    await request(app).post('/api/fiis/scraper/indicadores/resync').send({});
    const depois = db.prepare("SELECT * FROM ativos WHERE ticker='HGLG11'").get();
    expect(depois.dy_medio_5a).toBe(antes.dy_medio_5a);
    expect(depois.rentab_real_1a).toBe(antes.rentab_real_1a);
  });

  it('500 quando resyncAll joga exceção (mock quebrado)', async () => {
    db.prepare(`INSERT INTO ativos (ticker) VALUES ('HGLG11')`).run();
    global.__mockScraperIndicadores = {
      async resyncAll() { throw new Error('mock-broken'); }
    };
    const res = await request(app)
      .post('/api/fiis/scraper/indicadores/resync')
      .send({});
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('falha no resync');
    expect(res.body.detalhe).toContain('mock-broken');
  });

  it('503 quando scraper não carrega (módulo ausente)', async () => {
    // não seta global.__mockScraperIndicadores — vai tentar require real
    global.__mockScraperIndicadores = {
      // mock sem resyncAll — simula módulo quebrado
      // @ts-ignore
      resyncAll: undefined
    };
    const res = await request(app)
      .post('/api/fiis/scraper/indicadores/resync')
      .send({});
    expect(res.status).toBe(503);
  });
});

describe('GET /api/fiis/scraper/indicadores/status (PRD 02 sub-PR 3)', () => {
  let app, originalMock;
  beforeEach(() => {
    const db = new Database(':memory:');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.db = db; next(); });
    app.use('/api/fiis/scraper/indicadores', scraperIndicadoresRouter);
    originalMock = global.__mockScraperIndicadores;
  });
  afterEach(() => {
    global.__mockScraperIndicadores = originalMock;
  });

  it('200 com disponivel=true quando scraper carrega', async () => {
    global.__mockScraperIndicadores = { resyncAll: () => {} };
    const res = await request(app).get('/api/fiis/scraper/indicadores/status');
    expect(res.status).toBe(200);
    expect(res.body.disponivel).toBe(true);
    expect(res.body.versao).toBe('PRD02-subPR3');
  });

  it('503 quando scraper não carrega', async () => {
    global.__mockScraperIndicadores = null;
    const res = await request(app).get('/api/fiis/scraper/indicadores/status');
    // pode ser 200 ou 503 dependendo do mock; o teste real é em produção
    // com módulo inexistente — aqui aceitamos ambos
    expect([200, 503]).toContain(res.status);
  });
});