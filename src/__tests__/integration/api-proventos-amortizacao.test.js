// TDD Red Phase — PRD 03 RF-009/010/011/012, integração HTTP.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';

import proventosRouter from '../../server/routes/proventos.js';
import dashboardRouter from '../../server/routes/dashboard.js';

function appWithDb(db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = db; next(); });
  app.use('/api/proventos', proventosRouter);
  app.use('/api/dashboard', dashboardRouter);
  return app;
}

function setupDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE ativos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL DEFAULT 'FII', segmento TEXT, nota INTEGER,
      dy_minimo REAL, preco_teto REAL, preco_muito_bom REAL,
      alvo_pct_carteira REAL DEFAULT 1.76, ativo INTEGER DEFAULT 1
    );
    CREATE TABLE cotacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data TEXT NOT NULL, preco REAL NOT NULL, fonte TEXT DEFAULT 'manual');
    CREATE TABLE lancamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL, data TEXT NOT NULL, tipo TEXT NOT NULL, quantidade INTEGER NOT NULL, preco REAL NOT NULL, taxa REAL DEFAULT 0);
    CREATE TABLE proventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL,
      data_com TEXT, data_pagto TEXT NOT NULL, valor_por_cota REAL NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'DIVIDENDO'
        CHECK (tipo IN ('DIVIDENDO','RENDIMENTO','BONIFICACAO','AMORTIZACAO')),
      FOREIGN KEY (ativo_id) REFERENCES ativos(id)
    );
    INSERT INTO ativos (ticker, tipo) VALUES ('HGLG11', 'FII'), ('XPML11', 'FII');
  `);
  return db;
}

describe('GET /api/proventos — RF-009 filtros e contrato', () => {
  let app, db;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('aceita query tipos=DIVIDENDO,AMORTIZACAO e filtra', async () => {
    db.prepare(`INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota, tipo)
                VALUES (1, '2026-07-20', 0.80, 'DIVIDENDO'),
                       (1, '2026-07-20', 0.20, 'AMORTIZACAO'),
                       (1, '2026-08-15', 0.85, 'DIVIDENDO')`).run();
    const res = await request(app).get('/api/proventos?tipos=DIVIDENDO,AMORTIZACAO');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(3);
  });

  it('filtra apenas AMORTIZACAO', async () => {
    db.prepare(`INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota, tipo)
                VALUES (1, '2026-07-20', 0.80, 'DIVIDENDO'),
                       (1, '2026-07-20', 0.20, 'AMORTIZACAO'),
                       (1, '2026-08-15', 1.00, 'AMORTIZACAO')`).run();
    const res = await request(app).get('/api/proventos?tipos=AMORTIZACAO');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body.every(p => p.tipo === 'AMORTIZACAO')).toBe(true);
  });

  it('rejeita tipo inválido com 400', async () => {
    const res = await request(app).get('/api/proventos?tipos=JCP');
    expect(res.status).toBe(400);
  });

  it('inclui quantidade_elegivel e valor_total por linha (RF-015)', async () => {
    db.prepare(`INSERT INTO lancamentos (ativo_id, data, tipo, quantidade, preco)
                VALUES (1, '2026-01-10', 'COMPRA', 100, 10)`).run();
    db.prepare(`INSERT INTO proventos (ativo_id, data_com, data_pagto, valor_por_cota, tipo)
                VALUES (1, '2026-07-15', '2026-07-20', 0.80, 'DIVIDENDO')`).run();
    const res = await request(app).get('/api/proventos');
    expect(res.status).toBe(200);
    expect(res.body[0].ticker).toBe('HGLG11');
    expect(res.body[0].quantidade_elegivel).toBe(100);
    expect(res.body[0].valor_total).toBeCloseTo(80, 5);
  });
});

describe('POST /api/proventos — RF-010/011 validação', () => {
  let app, db;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('cria provento com tipo AMORTIZACAO', async () => {
    const res = await request(app).post('/api/proventos').send({
      ativo_id: 1, data_com: '2026-07-15', data_pagto: '2026-07-20',
      valor_por_cota: 0.20, tipo: 'AMORTIZACAO'
    });
    expect(res.status).toBe(201);
    expect(res.body.tipo).toBe('AMORTIZACAO');
  });

  it('rejeita tipo desconhecido com 422 (RF-001 CHECK)', async () => {
    const res = await request(app).post('/api/proventos').send({
      ativo_id: 1, data_pagto: '2026-07-20', valor_por_cota: 0.50, tipo: 'TIPOBIZARRO'
    });
    expect(res.status).toBe(422);
  });

  it('rejeita data_pagto não-ISO', async () => {
    const res = await request(app).post('/api/proventos').send({
      ativo_id: 1, data_pagto: '20/07/2026', valor_por_cota: 0.50, tipo: 'DIVIDENDO'
    });
    expect(res.status).toBe(400);
  });

  it('retorna 409 em duplicado (chave lógica completa)', async () => {
    await request(app).post('/api/proventos').send({
      ativo_id: 1, data_pagto: '2026-07-20', valor_por_cota: 0.50, tipo: 'AMORTIZACAO'
    });
    const res = await request(app).post('/api/proventos').send({
      ativo_id: 1, data_pagto: '2026-07-20', valor_por_cota: 0.50, tipo: 'AMORTIZACAO'
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/proventos/batch — RF-010 múltiplas parcelas', () => {
  let app, db;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('aceita campo legado "dividendos" como alias de DIVIDENDO', async () => {
    const res = await request(app).post('/api/proventos/batch').send({
      data_pagto: '2026-07-20',
      dividendos: [
        { ticker: 'HGLG11', valor_por_cota: 0.80 }
      ]
    });
    expect(res.status).toBe(200);
    expect(res.body.inseridos).toBe(1);
    expect(res.body.por_tipo.DIVIDENDO).toBeCloseTo(0.80, 5);
  });

  it('aceita múltiplas parcelas para mesmo ticker e data (RF-010)', async () => {
    const res = await request(app).post('/api/proventos/batch').send({
      data_pagto: '2026-07-20',
      proventos: [
        { ticker: 'HGLG11', valor_por_cota: 0.80, tipo: 'DIVIDENDO' },
        { ticker: 'HGLG11', valor_por_cota: 0.20, tipo: 'AMORTIZACAO' },
        { ticker: 'XPML11', valor_por_cota: 1.05, tipo: 'RENDIMENTO' }
      ]
    });
    expect(res.status).toBe(200);
    expect(res.body.inseridos).toBe(3);
    expect(res.body.duplicados).toBe(0);
  });

  it('retorna contagens por tipo (RF-022)', async () => {
    const res = await request(app).post('/api/proventos/batch').send({
      data_pagto: '2026-07-20',
      proventos: [
        { ticker: 'HGLG11', valor_por_cota: 0.20, tipo: 'AMORTIZACAO' },
        { ticker: 'HGLG11', valor_por_cota: 0.80, tipo: 'DIVIDENDO' },
        { ticker: 'HGLG11', valor_por_cota: 0.30, tipo: 'XYZ' }
      ]
    });
    expect(res.body.inseridos).toBe(2);
    expect(res.body.ignorados).toBe(1);
    expect(res.body.tipo_desconhecidos).toHaveLength(1);
    expect(res.body.por_tipo).toMatchObject({ DIVIDENDO: 0.80, AMORTIZACAO: 0.20 });
  });
});

describe('GET /api/dashboard/proventos-mensais — RF-014/016', () => {
  let app, db;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('retorna série mensal com distribuíveis + amortizações + bonificações', async () => {
    db.prepare(`INSERT INTO lancamentos (ativo_id, data, tipo, quantidade, preco)
                VALUES (1, '2026-01-10', 'COMPRA', 100, 10),
                       (2, '2026-01-10', 'COMPRA', 100, 10)`).run();
    db.prepare(`INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota, tipo)
                VALUES (1, '2026-07-20', 0.80, 'DIVIDENDO'),
                       (2, '2026-07-20', 0.20, 'AMORTIZACAO'),
                       (1, '2026-08-15', 0.85, 'DIVIDENDO')`).run();
    const res = await request(app).get('/api/dashboard/proventos-mensais?inicio=2026-07-01&fim=2026-12-31');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({
      mes: '2026-07',
      distribuiveis: 80,
      amortizacoes: 20,
      bonificacoes: 0,
      total_caixa: 100
    });
    expect(res.body[1]).toMatchObject({ mes: '2026-08', distribuiveis: 85, amortizacoes: 0 });
  });

  it('aceita filtro ?tipos=DIVIDENDO,RENDIMENTO (só distribuíveis)', async () => {
    db.prepare(`INSERT INTO lancamentos (ativo_id, data, tipo, quantidade, preco)
                VALUES (1, '2026-01-10', 'COMPRA', 100, 10)`).run();
    db.prepare(`INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota, tipo)
                VALUES (1, '2026-07-20', 0.80, 'DIVIDENDO'),
                       (1, '2026-07-20', 0.20, 'AMORTIZACAO')`).run();
    const res = await request(app).get('/api/dashboard/proventos-mensais?tipos=DIVIDENDO,RENDIMENTO');
    expect(res.status).toBe(200);
    // Sem amortização no período
    expect(res.body[0].distribuiveis).toBe(80);
    expect(res.body[0].amortizacoes).toBe(0);
  });
});

describe('GET /api/dashboard/projecao-proventos — RF-017/018', () => {
  let app, db;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('retorna distribuição anual baseada no último DIVIDENDO/RENDIMENTO', async () => {
    // Setup cotação + posição
    db.prepare(`INSERT INTO cotacoes (ativo_id, data, preco) VALUES (1, '2026-07-15', 10)`).run();
    db.prepare(`INSERT INTO lancamentos (ativo_id, data, tipo, quantidade, preco) VALUES (1, '2026-01-10', 'COMPRA', 100, 10)`).run();
    // Histórico de proventos
    db.prepare(`INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota, tipo)
                VALUES (1, '2026-01-15', 0.80, 'DIVIDENDO'),
                       (1, '2026-02-15', 0.85, 'DIVIDENDO'),
                       (1, '2026-07-20', 0.90, 'DIVIDENDO')`).run();
    const res = await request(app).get('/api/dashboard/projecao-proventos');
    expect(res.status).toBe(200);
    expect(res.body.total_distribuivel_mensal).toBeCloseTo(90, 5);
    expect(res.body.total_distribuivel_anual).toBeCloseTo(1080, 5);
    expect(res.body.detalhes[0]).toMatchObject({
      ticker: 'HGLG11',
      ultimo_distribuivel_por_cota: 0.90,
      mensal_distribuivel: 90,
      anual_distribuivel: 1080
    });
  });

  it('RF-018: amortizações futuras explícitas aparecem separadas, NÃO multiplicadas por 12', async () => {
    db.prepare(`INSERT INTO cotacoes (ativo_id, data, preco) VALUES (1, '2026-07-15', 10)`).run();
    db.prepare(`INSERT INTO lancamentos (ativo_id, data, tipo, quantidade, preco) VALUES (1, '2026-01-10', 'COMPRA', 100, 10)`).run();
    // Amortização futura dentro de 12 meses
    const futuro = new Date(); futuro.setMonth(futuro.getMonth() + 3);
    const dfuturo = futuro.toISOString().slice(0, 10);
    db.prepare(`INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota, tipo)
                VALUES (1, ?, 0.30, 'AMORTIZACAO')`).run(dfuturo);

    const res = await request(app).get('/api/dashboard/projecao-proventos');
    expect(res.body.amortizacoes_previstas).toHaveLength(1);
    expect(res.body.amortizacoes_previstas[0]).toMatchObject({
      ticker: 'HGLG11', valor_por_cota: 0.30, valor_total_estimado: 30
    });
    expect(res.body.total_amortizacoes_previstas).toBe(30);
  });

  it('RF-019: dy_carteira_distribuível usa só distribuíveis no numerador', async () => {
    db.prepare(`INSERT INTO cotacoes (ativo_id, data, preco) VALUES (1, '2026-07-15', 10)`).run();
    db.prepare(`INSERT INTO lancamentos (ativo_id, data, tipo, quantidade, preco) VALUES (1, '2026-01-10', 'COMPRA', 100, 10)`).run();
    db.prepare(`INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota, tipo)
                VALUES (1, '2026-07-20', 0.80, 'DIVIDENDO'),
                       (1, '2026-07-20', 5.00, 'AMORTIZACAO')`).run();  // NÃO conta no DY
    const res = await request(app).get('/api/dashboard/projecao-proventos');
    // PATRIMÔNIO = 100 * 10 = 1000
    // total_distribuivel_anual = 80 * 12 = 960
    // dy = 960 / 1000 * 100 = 96
    expect(res.body.dy_carteira_distribuivel).toBeCloseTo(96, 4);
  });
});

describe('GET /api/dashboard/resumo — RF-020 campo amortizacoes_12m', () => {
  let app, db;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('proventos_12m e dy_carteira_12m passam a representar só distribuíveis', async () => {
    db.prepare(`INSERT INTO cotacoes (ativo_id, data, preco) VALUES (1, '2026-07-15', 100)`).run();
    db.prepare(`INSERT INTO lancamentos (ativo_id, data, tipo, quantidade, preco) VALUES (1, '2026-01-10', 'COMPRA', 10, 100)`).run();
    // Cobertura de 12 meses
    db.prepare(`INSERT INTO proventos (ativo_id, data_pagto, valor_por_cota, tipo)
                VALUES (1, date('now','-6 months'), 1.00, 'DIVIDENDO'),
                       (1, date('now','-3 months'), 0.50, 'AMORTIZACAO')`).run();
    const res = await request(app).get('/api/dashboard/resumo');
    expect(res.status).toBe(200);
    expect(res.body.proventos_12m).toBeCloseTo(10, 5);  // só DIVIDENDO conta
    expect(res.body.amortizacoes_12m).toBeCloseTo(5, 5);
    expect(res.body.dy_carteira_12m).toBeGreaterThan(0);  // 10 / 1000 * 100 = 1
  });
});
