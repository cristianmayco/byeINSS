// Cobre os demais endpoints de dashboard.js: /resumo, /sinais (todos os ramos),
// /projecao-proventos, /simular, /fire. Complementa api-dashboard-alertas.test.js.

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
      id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL DEFAULT 'FII', segmento TEXT, nota INTEGER, dy_minimo REAL,
      preco_teto REAL, preco_muito_bom REAL, alvo_pct_carteira REAL DEFAULT 1.76, ativo INTEGER DEFAULT 1
    );
    CREATE TABLE cotacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data TEXT NOT NULL, preco REAL NOT NULL, fonte TEXT DEFAULT 'manual');
    CREATE TABLE lancamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data TEXT NOT NULL, tipo TEXT NOT NULL, quantidade INTEGER NOT NULL, preco REAL NOT NULL, taxa REAL DEFAULT 0);
    CREATE TABLE proventos (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data_com TEXT, data_pagto TEXT NOT NULL, valor_por_cota REAL NOT NULL, tipo TEXT DEFAULT 'DIVIDENDO');
    CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);
    INSERT INTO config (chave, valor) VALUES
      ('pct_muito_barato','85'), ('pct_barato','100'), ('pct_caro','115');
  `);
  return db;
}

// Cria FII com posição comprada e uma cotação atual
function seedFii(db, { ticker, teto, muito_bom, preco, qtd, pm, div }) {
  const info = db.prepare(`INSERT INTO ativos (ticker, tipo, preco_teto, preco_muito_bom, ativo) VALUES (?, 'FII', ?, ?, 1)`)
    .run(ticker, teto ?? null, muito_bom ?? null);
  const id = info.lastInsertRowid;
  if (preco != null) db.prepare(`INSERT INTO cotacoes (ativo_id, data, preco) VALUES (?, '2026-07-15', ?)`).run(id, preco);
  if (qtd) db.prepare(`INSERT INTO lancamentos (ativo_id, data, tipo, quantidade, preco) VALUES (?, '2026-01-10', 'COMPRA', ?, ?)`).run(id, qtd, pm ?? preco);
  if (div) db.prepare(`INSERT INTO proventos (ativo_id, data_com, data_pagto, valor_por_cota) VALUES (?, '2026-07-01', '2026-07-10', ?)`).run(id, div);
  return id;
}

describe('GET /api/dashboard/resumo', () => {
  let app, db;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('calcula patrimônio, investido e ganho de capital de posições abertas', async () => {
    seedFii(db, { ticker: 'HGLG11', teto: 150, muito_bom: 120, preco: 165, qtd: 100, pm: 150 });
    const res = await request(app).get('/api/dashboard/resumo');
    expect(res.status).toBe(200);
    expect(res.body.patrimonio).toBeCloseTo(16500, 2);       // 100 * 165
    expect(res.body.valor_investido).toBeCloseTo(15000, 2);   // 100 * 150
    expect(res.body.ganho_capital).toBeCloseTo(1500, 2);
    expect(res.body.posicoes).toHaveLength(1);
  });

  it('exclui posições zeradas (qtd = 0) do resultado', async () => {
    const id = seedFii(db, { ticker: 'MXRF11', teto: 10, muito_bom: 9, preco: 10, qtd: 100, pm: 10 });
    db.prepare(`INSERT INTO lancamentos (ativo_id, data, tipo, quantidade, preco) VALUES (?, '2026-02-01', 'VENDA', 100, 10)`).run(id);
    const res = await request(app).get('/api/dashboard/resumo');
    expect(res.body.posicoes).toHaveLength(0);
    expect(res.body.patrimonio).toBe(0);
  });
});

describe('GET /api/dashboard/sinais — todos os ramos', () => {
  let app, db;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  const sinalDe = async (fii) => {
    seedFii(db, fii);
    const res = await request(app).get('/api/dashboard/sinais');
    return res.body.find(s => s.ticker === fii.ticker).sinal;
  };

  it('ratio ≤ 85% → MUITO_BARATO', async () => {
    expect(await sinalDe({ ticker: 'A11', teto: 100, preco: 80 })).toBe('MUITO_BARATO');
  });
  it('85% < ratio ≤ 100% → BARATO', async () => {
    expect(await sinalDe({ ticker: 'B11', teto: 100, preco: 95 })).toBe('BARATO');
  });
  it('100% < ratio ≤ 115% → CARO', async () => {
    expect(await sinalDe({ ticker: 'C11', teto: 100, preco: 110 })).toBe('CARO');
  });
  it('ratio > 115% → MUITO_CARO', async () => {
    expect(await sinalDe({ ticker: 'D11', teto: 100, preco: 130 })).toBe('MUITO_CARO');
  });
  it('sem preço-teto → SEM_TETO', async () => {
    expect(await sinalDe({ ticker: 'E11', teto: null, preco: 50 })).toBe('SEM_TETO');
  });
  it('com teto mas sem cotação → SEM_PRECO', async () => {
    expect(await sinalDe({ ticker: 'F11', teto: 100, preco: null })).toBe('SEM_PRECO');
  });
});

describe('GET /api/dashboard/proventos-mensais', () => {
  let app, db;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('agrupa proventos por mês ponderados pela quantidade detida', async () => {
    const id = seedFii(db, { ticker: 'HGLG11', teto: 150, preco: 160, qtd: 100, pm: 150 });
    // dois pagamentos em meses diferentes dentro dos últimos 12 meses
    db.prepare(`INSERT INTO proventos (ativo_id, data_com, data_pagto, valor_por_cota) VALUES (?, NULL, '2026-06-10', 1.0)`).run(id);
    db.prepare(`INSERT INTO proventos (ativo_id, data_com, data_pagto, valor_por_cota) VALUES (?, NULL, '2026-07-10', 1.2)`).run(id);
    const res = await request(app).get('/api/dashboard/proventos-mensais');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    for (const row of res.body) expect(row).toHaveProperty('mes');
  });
});

describe('GET /api/dashboard/projecao-proventos', () => {
  let app, db;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('projeta anual = último dividendo × qtd × 12 (PRD 03 RF-017)', async () => {
    seedFii(db, { ticker: 'MCCI11', teto: 114, preco: 95, qtd: 200, pm: 100, div: 0.9 });
    const res = await request(app).get('/api/dashboard/projecao-proventos');
    expect(res.status).toBe(200);
    const d = res.body.detalhes.find(x => x.ticker === 'MCCI11');
    expect(d).toBeTruthy();
    expect(d.mensal_distribuivel).toBeCloseTo(200 * 0.9, 2);
    expect(d.anual_distribuivel).toBeCloseTo(200 * 0.9 * 12, 2);
    expect(res.body.total_distribuivel_anual).toBeGreaterThan(0);
  });

  it('RF-024: FII sem dividendo entra com mensal=0 e sem_base_recorrente=true', async () => {
    seedFii(db, { ticker: 'SEMDIV11', teto: 100, preco: 90, qtd: 100, pm: 90 }); // sem div
    const res = await request(app).get('/api/dashboard/projecao-proventos');
    const d = res.body.detalhes.find(x => x.ticker === 'SEMDIV11');
    expect(d).toBeDefined();
    expect(d.mensal_distribuivel).toBe(0);
    expect(d.sem_base_recorrente).toBe(true);
  });
});

describe('GET /api/dashboard/evolucao', () => {
  let app, db;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('retorna série de 12 meses com patrimônio e investido', async () => {
    seedFii(db, { ticker: 'BTLG11', teto: 110, preco: 105, qtd: 50, pm: 100 });
    const res = await request(app).get('/api/dashboard/evolucao');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(12);
    for (const ponto of res.body) {
      expect(ponto).toHaveProperty('mes');
      expect(ponto).toHaveProperty('patrimonio');
      expect(ponto).toHaveProperty('investido');
    }
  });
});

describe('POST /api/dashboard/simular', () => {
  let app, db;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('exige "meses"', async () => {
    const res = await request(app).post('/api/dashboard/simular').send({ aporte_mensal: 1000 });
    expect(res.status).toBe(400);
  });

  it('juros compostos: aportado e patrimônio crescem coerentemente', async () => {
    const res = await request(app).post('/api/dashboard/simular')
      .send({ aporte_inicial: 1000, aporte_mensal: 100, meses: 12, taxa_anual: 12 });
    expect(res.status).toBe(200);
    expect(res.body.total_aportado).toBeCloseTo(1000 + 100 * 12, 2);
    expect(res.body.patrimonio_final).toBeGreaterThan(res.body.total_aportado);
    expect(res.body.rendimento).toBeGreaterThan(0);
  });

  it('reajuste anual aumenta o aporte final', async () => {
    const res = await request(app).post('/api/dashboard/simular')
      .send({ aporte_mensal: 100, meses: 24, taxa_anual: 0, reajuste_anual: 10 });
    expect(res.body.aporte_mensal_final).toBeCloseTo(110, 2);
  });
});

describe('POST /api/dashboard/fire', () => {
  let app, db;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('exige renda_mensal_desejada', async () => {
    const res = await request(app).post('/api/dashboard/fire').send({});
    expect(res.status).toBe(400);
  });

  it('patrimônio necessário = renda anual / taxa de retirada', async () => {
    const res = await request(app).post('/api/dashboard/fire')
      .send({ renda_mensal_desejada: 5000, taxa_retirada: 4 });
    expect(res.status).toBe(200);
    expect(res.body.patrimonio_necessario).toBeCloseTo((5000 * 12) / 0.04, 2); // 1.500.000
  });
});
