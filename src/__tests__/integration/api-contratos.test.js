// TDD Red Phase — escrito ANTES de src/server/routes/contratos.js existir.
// Cobre os 3 endpoints do PRD 12 seção 6.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';

import contratosRouter from '../../server/routes/contratos.js';

function appWithDb(db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = db; next(); });
  app.use('/api/fiis/contratos', contratosRouter);
  // Compatilhado para dashboard
  app.use('/api/dashboard', (req, _res, next) => { req.db = db; next(); }, contratosRouter.dashboard || contratosRouter);
  return app;
}

function setupDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE ativos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL DEFAULT 'FII'
    );
    CREATE TABLE fii_scraper_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      campo TEXT NOT NULL,
      sucesso INTEGER NOT NULL,
      origem TEXT, erro TEXT,
      ts TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (ticker) REFERENCES ativos(ticker)
    );
    CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);
    INSERT INTO ativos (ticker, tipo) VALUES ('HGLG11', 'FII');
    INSERT INTO ativos (ticker, tipo) VALUES ('XPML11', 'FII');
    INSERT INTO ativos (ticker, tipo) VALUES ('PETR4', 'ACAO');
    INSERT INTO config (chave, valor) VALUES ('vencimento_janela_alerta_meses', '24');
  `);
  return db;
}

describe('GET /api/fiis/contratos/:ticker', () => {
  let app, db;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('retorna 404 para ticker inexistente', async () => {
    const res = await request(app).get('/api/fiis/contratos/NAOEXISTE11');
    expect(res.status).toBe(404);
  });

  it('retorna 200 com campos default-null para FII sem dados', async () => {
    const res = await request(app).get('/api/fiis/contratos/HGLG11');
    expect(res.status).toBe(200);
    expect(res.body.ticker).toBe('HGLG11');
    expect(res.body.vencimento_medio_contratos).toBeNull();
    expect(res.body.tipo_reajuste).toBeNull();
    expect(res.body.alerta_vencimento).toBe(false);
  });

  it('valida formato do ticker (400)', async () => {
    const res = await request(app).get('/api/fiis/contratos/123');
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/fiis/contratos/:ticker', () => {
  let app, db;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('cria/atualiza dados manuais e marca origem=manual', async () => {
    const res = await request(app)
      .put('/api/fiis/contratos/HGLG11')
      .send({
        vencimento_medio_contratos_meses: 18,
        tipo_reajuste: 'IGPM'
      });
    expect(res.status).toBe(200);
    expect(res.body.vencimento_medio_contratos_meses).toBe(18);
    expect(res.body.tipo_reajuste).toBe('IGPM');
    expect(res.body.vencimento_medio_origem).toBe('manual');
  });

  it('rejeita data+meses conflitantes (400)', async () => {
    const res = await request(app)
      .put('/api/fiis/contratos/HGLG11')
      .send({
        vencimento_medio_contratos: '2029-01-15',
        vencimento_medio_contratos_meses: 18
      });
    expect(res.status).toBe(400);
  });

  it('rejeita FIXO sem percentual (422)', async () => {
    const res = await request(app)
      .put('/api/fiis/contratos/HGLG11')
      .send({ tipo_reajuste: 'FIXO' });
    expect(res.status).toBe(422);
  });

  it('alerta_vencimento é true quando meses < 24 (PUT)', async () => {
    const res = await request(app)
      .put('/api/fiis/contratos/HGLG11')
      .send({ vencimento_medio_contratos_meses: 18, tipo_reajuste: 'IGPM' });
    expect(res.status).toBe(200);
    expect(res.body.alerta_vencimento).toBe(true);
  });

  it('alerta_vencimento = false quando meses >= 24', async () => {
    const res = await request(app)
      .put('/api/fiis/contratos/HGLG11')
      .send({ vencimento_medio_contratos_meses: 36 });
    expect(res.status).toBe(200);
    expect(res.body.alerta_vencimento).toBe(false);
  });

  it('404 quando ticker não existe', async () => {
    const res = await request(app)
      .put('/api/fiis/contratos/NAOEXISTE11')
      .send({ vencimento_medio_contratos_meses: 18 });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/dashboard/alertas-vencimento', () => {
  let app, db;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('retorna 200 com lista vazia quando não há alertas', async () => {
    const res = await request(app).get('/api/dashboard/alertas-vencimento');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.itens).toEqual([]);
  });

  it('retorna FIIs com meses < 24m', async () => {
    await request(app).put('/api/fiis/contratos/HGLG11').send({ vencimento_medio_contratos_meses: 18, tipo_reajuste: 'IGPM' });
    await request(app).put('/api/fiis/contratos/XPML11').send({ vencimento_medio_contratos_meses: 14, tipo_reajuste: 'FIXO', reajuste_percentual: 3.0 });
    const res = await request(app).get('/api/dashboard/alertas-vencimento');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const tickers = res.body.itens.map(i => i.ticker).sort();
    expect(tickers).toEqual(['HGLG11', 'XPML11']);
  });

  it('não retorna FIIs com meses >= 24', async () => {
    await request(app).put('/api/fiis/contratos/HGLG11').send({ vencimento_medio_contratos_meses: 36 });
    const res = await request(app).get('/api/dashboard/alertas-vencimento');
    expect(res.body.total).toBe(0);
  });

  it('não retorna ações (apenas FIIs)', async () => {
    await request(app).put('/api/fiis/contratos/PETR4').send({ vencimento_medio_contratos_meses: 18 });
    const res = await request(app).get('/api/dashboard/alertas-vencimento');
    expect(res.body.total).toBe(0);
  });
});
