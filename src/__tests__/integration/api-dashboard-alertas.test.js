// TDD Red — cobre o bug: /api/dashboard/alertas nunca emitia alertas de preço-teto,
// e o endpoint /sinais precisa classificar toda a faixa (sem "zona morta").

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';

import dashboardRouter from '../../server/routes/dashboard.js';

function appWithDb(db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = db; next(); });
  app.use('/api/dashboard', dashboardRouter);
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
      segmento TEXT, nota INTEGER, dy_minimo REAL,
      preco_teto REAL, preco_muito_bom REAL, alvo_pct_carteira REAL DEFAULT 1.76,
      ativo INTEGER DEFAULT 1
    );
    CREATE TABLE cotacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data TEXT NOT NULL, preco REAL NOT NULL, fonte TEXT DEFAULT 'manual');
    CREATE TABLE lancamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data TEXT NOT NULL, tipo TEXT NOT NULL, quantidade INTEGER NOT NULL, preco REAL NOT NULL, taxa REAL DEFAULT 0);
    CREATE TABLE proventos (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data_com TEXT, data_pagto TEXT NOT NULL, valor_por_cota REAL NOT NULL, tipo TEXT DEFAULT 'DIVIDENDO');
    CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);
    INSERT INTO config (chave, valor) VALUES
      ('alerta_concentracao_pct','90'), ('alerta_dy_limite','15'),
      ('pct_muito_barato','85'), ('pct_barato','100'), ('pct_caro','115');
  `);
  return db;
}

function addFii(db, { ticker, teto, muito_bom, preco, qtd = 10 }) {
  const info = db.prepare(
    `INSERT INTO ativos (ticker, tipo, preco_teto, preco_muito_bom, ativo) VALUES (?, 'FII', ?, ?, 1)`
  ).run(ticker, teto ?? null, muito_bom ?? null);
  const id = info.lastInsertRowid;
  if (preco != null) db.prepare(`INSERT INTO cotacoes (ativo_id, data, preco) VALUES (?, '2026-07-01', ?)`).run(id, preco);
  if (qtd > 0) db.prepare(`INSERT INTO lancamentos (ativo_id, data, tipo, quantidade, preco) VALUES (?, '2026-01-01', 'COMPRA', ?, ?)`).run(id, qtd, preco ?? teto ?? 10);
  return id;
}

describe('GET /api/dashboard/alertas — preço-teto', () => {
  let app, db;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('emite PRECO_TETO quando preço atual está no/abaixo do teto', async () => {
    // preço abaixo do teto mas acima do "muito bom" => PRECO_TETO (não OPORTUNIDADE)
    addFii(db, { ticker: 'GTWR11', teto: 102.86, muito_bom: 70, preco: 80.09 });
    const res = await request(app).get('/api/dashboard/alertas');
    expect(res.status).toBe(200);
    const a = res.body.find(x => x.ticker === 'GTWR11' && x.tipo === 'PRECO_TETO');
    expect(a).toBeTruthy();
  });

  it('emite OPORTUNIDADE quando preço atual está no/abaixo do "muito bom"', async () => {
    addFii(db, { ticker: 'TGAR11', teto: 82.29, muito_bom: 60, preco: 50.77 });
    const res = await request(app).get('/api/dashboard/alertas');
    const a = res.body.find(x => x.ticker === 'TGAR11');
    expect(a).toBeTruthy();
    expect(a.tipo).toBe('OPORTUNIDADE');
  });

  it('NÃO emite alerta de preço para FII acima do teto', async () => {
    addFii(db, { ticker: 'HGLG11', teto: 125.71, muito_bom: 110, preco: 148.92 });
    const res = await request(app).get('/api/dashboard/alertas');
    const a = res.body.find(x => x.ticker === 'HGLG11' && (x.tipo === 'PRECO_TETO' || x.tipo === 'OPORTUNIDADE'));
    expect(a).toBeFalsy();
  });

  it('gera alerta para TODOS os FIIs abaixo do teto (não só alguns)', async () => {
    addFii(db, { ticker: 'GGRC11', teto: 11.43, muito_bom: 9, preco: 9.92 });
    addFii(db, { ticker: 'PORD11', teto: 11.43, muito_bom: 9, preco: 8.46 });
    addFii(db, { ticker: 'RBRR11', teto: 80, muito_bom: 70, preco: 77.86 });
    const res = await request(app).get('/api/dashboard/alertas');
    const tickersComAlertaPreco = new Set(
      res.body.filter(x => x.tipo === 'PRECO_TETO' || x.tipo === 'OPORTUNIDADE').map(x => x.ticker)
    );
    expect(tickersComAlertaPreco.has('GGRC11')).toBe(true);
    expect(tickersComAlertaPreco.has('PORD11')).toBe(true);
    expect(tickersComAlertaPreco.has('RBRR11')).toBe(true);
  });

  it('não gera alerta de preço para FII sem teto definido', async () => {
    addFii(db, { ticker: 'ALZR11', teto: null, muito_bom: null, preco: 10 });
    const res = await request(app).get('/api/dashboard/alertas');
    const a = res.body.find(x => x.ticker === 'ALZR11' && (x.tipo === 'PRECO_TETO' || x.tipo === 'OPORTUNIDADE'));
    expect(a).toBeFalsy();
  });
});

describe('GET /api/dashboard/sinais — cobertura total de faixa', () => {
  let app, db;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('classifica FII entre teto e teto*1.1 sem deixar "zona morta"', async () => {
    // XPLG11: 91.59 vs teto 89.14 => ratio ~102.7% => CARO (não SEM_TETO nem vazio)
    addFii(db, { ticker: 'XPLG11', teto: 89.14, muito_bom: 80, preco: 91.59 });
    const res = await request(app).get('/api/dashboard/sinais');
    const s = res.body.find(x => x.ticker === 'XPLG11');
    expect(s).toBeTruthy();
    expect(s.sinal).toBe('CARO');
    expect(s.sinal).not.toBe('SEM_TETO');
  });
});
