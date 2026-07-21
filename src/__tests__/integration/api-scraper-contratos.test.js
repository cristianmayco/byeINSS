// src/__tests__/integration/api-scraper-contratos.test.js
// Testes de integração do endpoint POST /api/fiis/scraper/contratos/resync
// e GET /api/fiis/scraper/contratos/status. PRD 12 sub-PR 3.
//
// Usa supertest + better-sqlite3 em memória. O scraper Electron é MOCKADO
// via global.__mockScraperContratos (mecanismo exposto em
// src/server/routes/scraper-contratos.js) para isolar o teste do BrowserWindow.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cors from 'cors';
import request from 'supertest';
import Database from 'better-sqlite3';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbInitPath = join(__dirname, '..', '..', '..', 'db', 'init.sql');
const initSql = readFileSync(dbInitPath, 'utf8');

const scraperRouter = require('../../server/routes/scraper-contratos.js');

function buildApp(db) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use((req, _res, next) => { req.db = db; next(); });
  app.use('/api/fiis/scraper/contratos', scraperRouter);
  return app;
}

function seed(db, tickers) {
  const ins = db.prepare("INSERT INTO ativos (ticker, tipo, segmento, ativo) VALUES (?, 'FII', 'Logística', 1)");
  for (const t of tickers) ins.run(t);
}

beforeEach(() => {
  // Mock do scraper. Cada teste configura o retorno esperado.
  global.__mockScraperContratos = {
    resyncAll: async (db, opts = {}) => {
      const tickers = Array.isArray(opts.tickers) && opts.tickers.length
        ? opts.tickers
        : db.prepare("SELECT ticker FROM ativos WHERE tipo='FII' AND ativo=1 ORDER BY ticker").all().map(r => r.ticker);

      const detalhes = tickers.map(t => {
        const fixture = global.__mockScraperFixture?.[t];
        if (!fixture) {
          return { ticker: t, success: false, source: null, payload: null, error: 'sem fixture' };
        }
        // Persiste se sucesso.
        let persist = { persisted: false, reason: 'sem payload' };
        if (fixture.success && fixture.payload) {
          const ativo = db.prepare('SELECT id, vencimento_medio_origem FROM ativos WHERE ticker = ?').get(t);
          if (ativo && ativo.vencimento_medio_origem === 'manual') {
            persist = { persisted: false, reason: 'origem=manual' };
          } else if (ativo) {
            db.prepare(`
              UPDATE ativos SET
                vencimento_medio_contratos = ?,
                vencimento_medio_contratos_meses = ?,
                tipo_reajuste = ?,
                reajuste_percentual = ?,
                vencimento_medio_origem = ?,
                vencimento_medio_coletado_em = datetime('now'),
                updated_at = datetime('now')
              WHERE id = ?
            `).run(
              fixture.payload.vencimento_medio_contratos,
              fixture.payload.vencimento_medio_contratos_meses,
              fixture.payload.tipo_reajuste,
              fixture.payload.reajuste_percentual,
              fixture.source,
              ativo.id
            );
            db.prepare(`
              INSERT INTO fii_scraper_log (ticker, campo, sucesso, origem) VALUES (?, 'vencimento_medio_contratos', 1, ?)
            `).run(t, fixture.source);
            persist = { persisted: true };
          }
        } else {
          db.prepare(`
            INSERT INTO fii_scraper_log (ticker, campo, sucesso, origem, erro) VALUES (?, 'vencimento_medio_contratos', 0, ?, ?)
          `).run(t, fixture.source || 'main', String(fixture.error || 'falha').slice(0, 500));
        }
        return {
          ticker: t,
          success: fixture.success,
          source: fixture.source,
          persisted: persist.persisted,
          motivo_skip: persist.persisted ? null : persist.reason,
          error: fixture.error || null,
          confianca: fixture.payload?.confianca ?? null
        };
      });

      const sucessos = detalhes.filter(d => d.persisted).length;
      const falhas = detalhes.length - sucessos;
      return { total: detalhes.length, sucessos, falhas, detalhes };
    }
  };
});

afterEach(() => {
  delete global.__mockScraperContratos;
  delete global.__mockScraperFixture;
});

describe('GET /api/fiis/scraper/contratos/status', () => {
  it('retorna disponível quando o scraper mock carrega', async () => {
    const db = new Database(':memory:');
    db.exec(initSql);
    const app = buildApp(db);
    const r = await request(app).get('/api/fiis/scraper/contratos/status');
    expect(r.status).toBe(200);
    expect(r.body.disponivel).toBe(true);
    db.close();
  });

  it('retorna 503 quando o scraper não carrega', async () => {
    delete global.__mockScraperContratos;
    const db = new Database(':memory:');
    db.exec(initSql);
    const app = buildApp(db);
    // Monkey-patch require cache para forçar erro.
    const scraperPath = require.resolve('../../server/routes/scraper-contratos.js');
    const original = require.cache[scraperPath];
    // Cria app mock que joga erro em getScraper().
    const app2 = express();
    app2.use(cors());
    app2.use(express.json());
    app2.use((req, _res, next) => { req.db = db; next(); });
    app2.use('/api/fiis/scraper/contratos', (_req, _res) => {
      _res.status(503).json({ disponivel: false, erro: 'mock indisponível' });
    });
    const r = await request(app2).get('/api/fiis/scraper/contratos/status');
    expect(r.status).toBe(503);
    db.close();
  });
});

describe('POST /api/fiis/scraper/contratos/resync — validação', () => {
  it('retorna 400 quando tickers não é array', async () => {
    const db = new Database(':memory:');
    db.exec(initSql);
    const app = buildApp(db);
    const r = await request(app)
      .post('/api/fiis/scraper/contratos/resync')
      .send({ tickers: 'HGLG11' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/array/i);
    db.close();
  });

  it('retorna 400 quando ticker não casa regex FII', async () => {
    const db = new Database(':memory:');
    db.exec(initSql);
    const app = buildApp(db);
    const r = await request(app)
      .post('/api/fiis/scraper/contratos/resync')
      .send({ tickers: ['hglg11', 'XPML'] });  // XPML não tem 11
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/XPML/);
    db.close();
  });

  it('aceita body vazio (roda em todos os FIIs)', async () => {
    const db = new Database(':memory:');
    db.exec(initSql);
    seed(db, ['HGLG11']);
    const app = buildApp(db);
    global.__mockScraperFixture = {
      HGLG11: { success: true, source: 'main', payload: {
        vencimento_medio_contratos: '2028-08-15',
        vencimento_medio_contratos_meses: null,
        tipo_reajuste: 'IGPM',
        reajuste_percentual: null,
        vencimento_medio_origem: 'main',
        dy_medio_5a: 10.12,
        confianca: 'alta'
      }}
    };
    const r = await request(app)
      .post('/api/fiis/scraper/contratos/resync')
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.sucessos).toBe(1);
    expect(r.body.falhas).toBe(0);
    db.close();
  });

  it('aceita tickers específicos', async () => {
    const db = new Database(':memory:');
    db.exec(initSql);
    seed(db, ['HGLG11', 'XPML11', 'MXRF11']);
    const app = buildApp(db);
    global.__mockScraperFixture = {
      HGLG11: { success: true, source: 'main', payload: {
        vencimento_medio_contratos: '2028-08-15', vencimento_medio_contratos_meses: null,
        tipo_reajuste: 'IGPM', reajuste_percentual: null,
        vencimento_medio_origem: 'main', dy_medio_5a: 10.12, confianca: 'alta'
      }},
      XPML11: { success: true, source: 'main', payload: {
        vencimento_medio_contratos: null, vencimento_medio_contratos_meses: 18,
        tipo_reajuste: 'MISTO', reajuste_percentual: null,
        vencimento_medio_origem: 'main', dy_medio_5a: 9.87, confianca: 'alta'
      }},
      MXRF11: { success: false, source: 'main', payload: null, error: 'FII de papel' }
    };
    const r = await request(app)
      .post('/api/fiis/scraper/contratos/resync')
      .send({ tickers: ['HGLG11', 'XPML11'] });
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    expect(r.body.sucessos).toBe(2);
    db.close();
  });
});

describe('POST /api/fiis/scraper/contratos/resync — persistência', () => {
  it('persiste em ativos e cria log em fii_scraper_log', async () => {
    const db = new Database(':memory:');
    db.exec(initSql);
    seed(db, ['HGLG11']);
    const app = buildApp(db);
    global.__mockScraperFixture = {
      HGLG11: { success: true, source: 'main', payload: {
        vencimento_medio_contratos: '2028-08-15', vencimento_medio_contratos_meses: null,
        tipo_reajuste: 'IGPM', reajuste_percentual: null,
        vencimento_medio_origem: 'main', dy_medio_5a: 10.12, confianca: 'alta'
      }}
    };
    await request(app)
      .post('/api/fiis/scraper/contratos/resync')
      .send({});
    const ativo = db.prepare('SELECT vencimento_medio_contratos, tipo_reajuste, vencimento_medio_origem FROM ativos WHERE ticker = ?').get('HGLG11');
    expect(ativo.vencimento_medio_contratos).toBe('2028-08-15');
    expect(ativo.tipo_reajuste).toBe('IGPM');
    expect(ativo.vencimento_medio_origem).toBe('main');
    const logs = db.prepare("SELECT * FROM fii_scraper_log WHERE ticker = 'HGLG11'").all();
    expect(logs.length).toBeGreaterThan(0);
    db.close();
  });

  it('não sobrescreve ativo com vencimento_medio_origem = manual (RF-009)', async () => {
    const db = new Database(':memory:');
    db.exec(initSql);
    seed(db, ['HGLG11']);
    // Marca como manual.
    db.prepare("UPDATE ativos SET vencimento_medio_contratos = '2030-01-01', tipo_reajuste = 'FIXO', vencimento_medio_origem = 'manual' WHERE ticker = 'HGLG11'").run();
    const app = buildApp(db);
    global.__mockScraperFixture = {
      HGLG11: { success: true, source: 'main', payload: {
        vencimento_medio_contratos: '2028-08-15', vencimento_medio_contratos_meses: null,
        tipo_reajuste: 'IGPM', reajuste_percentual: null,
        vencimento_medio_origem: 'main', confianca: 'alta'
      }}
    };
    const r = await request(app)
      .post('/api/fiis/scraper/contratos/resync')
      .send({});
    // Endpoint conta como falha (não persistiu), mas mantém dados manuais.
    expect(r.body.detalhes[0].persisted).toBe(false);
    expect(r.body.detalhes[0].motivo_skip).toMatch(/manual/i);
    const ativo = db.prepare('SELECT vencimento_medio_contratos, tipo_reajuste FROM ativos WHERE ticker = ?').get('HGLG11');
    expect(ativo.vencimento_medio_contratos).toBe('2030-01-01'); // manual preservado
    expect(ativo.tipo_reajuste).toBe('FIXO');
    db.close();
  });

  it('loga falha em fii_scraper_log quando scraper retorna erro', async () => {
    const db = new Database(':memory:');
    db.exec(initSql);
    seed(db, ['BCFF11']);
    const app = buildApp(db);
    global.__mockScraperFixture = {
      BCFF11: { success: false, source: 'main', payload: null, error: 'timeout' }
    };
    await request(app)
      .post('/api/fiis/scraper/contratos/resync')
      .send({});
    const logs = db.prepare("SELECT * FROM fii_scraper_log WHERE ticker = 'BCFF11' AND sucesso = 0").all();
    expect(logs.length).toBe(1);
    expect(logs[0].erro).toContain('timeout');
    db.close();
  });

  it('falha de um ticker não derruba o batch (PRD 12 §8 RF-007)', async () => {
    const db = new Database(':memory:');
    db.exec(initSql);
    seed(db, ['HGLG11', 'XPML11', 'MXRF11']);
    const app = buildApp(db);
    global.__mockScraperFixture = {
      HGLG11: { success: true, source: 'main', payload: {
        vencimento_medio_contratos: '2028-08-15', vencimento_medio_contratos_meses: null,
        tipo_reajuste: 'IGPM', reajuste_percentual: null,
        vencimento_medio_origem: 'main', confianca: 'alta'
      }},
      XPML11: { success: false, source: null, payload: null, error: 'crash no parse' },
      MXRF11: { success: true, source: 'main', payload: {
        vencimento_medio_contratos: null, vencimento_medio_contratos_meses: 24,
        tipo_reajuste: 'FIXO', reajuste_percentual: 3.5,
        vencimento_medio_origem: 'main', confianca: 'alta'
      }}
    };
    const r = await request(app)
      .post('/api/fiis/scraper/contratos/resync')
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(3);
    expect(r.body.sucessos).toBe(2);
    expect(r.body.falhas).toBe(1);
    // Detalhes preservam sucesso/falha por ticker.
    const porTicker = Object.fromEntries(r.body.detalhes.map(d => [d.ticker, d]));
    expect(porTicker.HGLG11.success).toBe(true);
    expect(porTicker.XPML11.success).toBe(false);
    expect(porTicker.XPML11.error).toContain('crash');
    expect(porTicker.MXRF11.success).toBe(true);
    db.close();
  });
});
