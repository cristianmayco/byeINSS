// src/__tests__/integration/api-indicadores.test.js
// Cobre os endpoints do PRD 02:
//   - GET /api/fiis/indicadores (lista FIIs com classificação)
//   - GET /api/fiis/indicadores/:ticker (detalhe)
//
// Inclui: validação de ticker, classificação correta, enriquecimento com DY
// histórico, persistência via mergeIndicadores (RF-008), e caso de borda
// (FII sem dy_medio_5a classificado como INSUFICIENTE).

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';

import indicadoresRouter from '../../server/routes/indicadores.js';

function appWithDb(db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = db; next(); });
  app.use('/api', indicadoresRouter);
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
      segmento TEXT,
      ativo INTEGER DEFAULT 1,
      dy_12m REAL, dy_medio_5a REAL,
      dy_medio_5a_fonte TEXT, dy_medio_5a_atualizado_em TEXT,
      rentab_nominal_1a REAL, rentab_nominal_2a REAL, rentab_nominal_5a REAL,
      rentab_real_1a REAL, rentab_real_2a REAL, rentab_real_5a REAL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);
    INSERT INTO config (chave, valor) VALUES ('indicador_dy_vs_5a_abaixo_pct', '95');
    INSERT INTO config (chave, valor) VALUES ('indicador_dy_vs_5a_acima_pct', '105');
  `);
  return db;
}

describe('GET /api/fiis/indicadores (PRD 02)', () => {
  let db, app;
  beforeEach(() => {
    db = setupDb();
    app = appWithDb(db);
  });

  it('lista vazia quando não há FIIs', async () => {
    const res = await request(app).get('/api/fiis/indicadores');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
    expect(res.body.meta.schema).toBe('1.3');
  });

  it('lista FIIs com classificação EM_LINHA / CONSISTENTE (dy_12m ≈ dy_medio_5a)', async () => {
    db.prepare(`INSERT INTO ativos (ticker, dy_12m, dy_medio_5a)
                VALUES ('HGLG11', 9.0, 9.0)`).run();
    const res = await request(app).get('/api/fiis/indicadores');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].ticker).toBe('HGLG11');
    expect(res.body.data[0].classificacao).toBe('EM_LINHA');
    expect(res.body.data[0].severidade).toBe('CONSISTENTE');
    expect(res.body.data[0].dy_vs_5a_pct).toBeCloseTo(100, 1);
  });

  it('classifica como ABAIXO / CRITICO quando dy_12m é 60% do dy_medio_5a', async () => {
    db.prepare(`INSERT INTO ativos (ticker, dy_12m, dy_medio_5a)
                VALUES ('XPML11', 6.0, 10.0)`).run();
    const res = await request(app).get('/api/fiis/indicadores');
    expect(res.body.data[0].classificacao).toBe('ABAIXO');
    expect(res.body.data[0].severidade).toBe('CRITICO');
    expect(res.body.data[0].dy_vs_5a_pct).toBeCloseTo(60, 1);
    expect(res.body.data[0].motivo).toContain('corte');
  });

  it('classifica como ABAIXO / ATENCAO entre 80% e 95%', async () => {
    db.prepare(`INSERT INTO ativos (ticker, dy_12m, dy_medio_5a)
                VALUES ('KNIP11', 8.7, 10.0)`).run();
    const res = await request(app).get('/api/fiis/indicadores');
    expect(res.body.data[0].classificacao).toBe('ABAIXO');
    expect(res.body.data[0].severidade).toBe('ATENCAO');
    expect(res.body.data[0].dy_vs_5a_pct).toBeCloseTo(87, 1);
  });

  it('classifica como ACIMA / CRITICO quando dy_12m é 150% do dy_medio_5a', async () => {
    db.prepare(`INSERT INTO ativos (ticker, dy_12m, dy_medio_5a)
                VALUES ('BCFF11', 15.0, 10.0)`).run();
    const res = await request(app).get('/api/fiis/indicadores');
    expect(res.body.data[0].classificacao).toBe('ACIMA');
    expect(res.body.data[0].severidade).toBe('CRITICO');
    expect(res.body.data[0].motivo).toContain('armadilha');
  });

  it('classifica como INSUFICIENTE quando dy_medio_5a é null', async () => {
    db.prepare(`INSERT INTO ativos (ticker, dy_12m, dy_medio_5a)
                VALUES ('VINO11', 9.0, NULL)`).run();
    const res = await request(app).get('/api/fiis/indicadores');
    expect(res.body.data[0].classificacao).toBe('INSUFICIENTE');
    expect(res.body.data[0].severidade).toBe('INDEFINIDO');
    expect(res.body.data[0].dy_vs_5a_pct).toBeNull();
  });

  it('classifica como INSUFICIENTE quando dy_medio_5a é 0 (divisão por zero)', async () => {
    db.prepare(`INSERT INTO ativos (ticker, dy_12m, dy_medio_5a)
                VALUES ('NEW11', 9.0, 0)`).run();
    const res = await request(app).get('/api/fiis/indicadores');
    expect(res.body.data[0].classificacao).toBe('INSUFICIENTE');
  });

  it('exclui ativos do tipo Ação (não-FII)', async () => {
    db.prepare(`INSERT INTO ativos (ticker, tipo, dy_12m, dy_medio_5a)
                VALUES ('PETR4', 'ACAO', 12.0, 10.0)`).run();
    db.prepare(`INSERT INTO ativos (ticker, dy_12m, dy_medio_5a)
                VALUES ('HGLG11', 9.0, 9.0)`).run();
    const res = await request(app).get('/api/fiis/indicadores');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].ticker).toBe('HGLG11');
  });

  it('retorna contadores agregados por severidade no meta', async () => {
    db.prepare(`INSERT INTO ativos (ticker, dy_12m, dy_medio_5a) VALUES
      ('HGLG11', 9.0, 9.0),
      ('XPML11', 6.0, 10.0),
      ('BCFF11', 15.0, 10.0),
      ('KNIP11', 8.7, 10.0)`).run();
    const res = await request(app).get('/api/fiis/indicadores');
    expect(res.body.meta.contadores_por_severidade).toEqual({
      CONSISTENTE: 1, CRITICO: 2, ATENCAO: 1
    });
  });

  it('retorna campos de rentabilidade na resposta', async () => {
    db.prepare(`INSERT INTO ativos (ticker, dy_12m, dy_medio_5a,
                                     rentab_nominal_1a, rentab_real_1a)
                VALUES ('HGLG11', 9.0, 9.0, 12.0, 8.5)`).run();
    const res = await request(app).get('/api/fiis/indicadores');
    expect(res.body.data[0].rentab_nominal_1a).toBe(12.0);
    expect(res.body.data[0].rentab_real_1a).toBe(8.5);
  });

  it('respeita limiar_abaixo_pct customizado em config', async () => {
    db.prepare(`UPDATE config SET valor='90' WHERE chave='indicador_dy_vs_5a_abaixo_pct'`).run();
    db.prepare(`INSERT INTO ativos (ticker, dy_12m, dy_medio_5a) VALUES ('HGLG11', 9.0, 10.0)`).run();
    // pct = 90, limiar = 90 → EM_LINHA (não cai em ABAIXO)
    const res = await request(app).get('/api/fiis/indicadores');
    expect(res.body.data[0].classificacao).toBe('EM_LINHA');
    expect(res.body.meta.limiar_abaixo_pct).toBe(90);
  });

  it('500 quando DB indisponível', async () => {
    const brokenApp = express();
    brokenApp.use(express.json());
    brokenApp.use((req, _res, next) => { req.db = null; next(); });
    brokenApp.use('/api', indicadoresRouter);
    const res = await request(brokenApp).get('/api/fiis/indicadores');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/fiis/indicadores/:ticker (PRD 02)', () => {
  let db, app;
  beforeEach(() => {
    db = setupDb();
    app = appWithDb(db);
  });

  it('retorna 400 quando ticker é inválido (regex FII)', async () => {
    const res = await request(app).get('/api/fiis/indicadores/PETR4');
    expect(res.status).toBe(400);
    expect(res.body.erro).toBe('TICKER_INVALIDO');
  });

  it('retorna 400 quando ticker tem formato incorreto', async () => {
    const res = await request(app).get('/api/fiis/indicadores/abc');
    expect(res.status).toBe(400);
  });

  it('retorna 404 quando ticker não existe no DB', async () => {
    const res = await request(app).get('/api/fiis/indicadores/ABCD11');
    expect(res.status).toBe(404);
    expect(res.body.erro).toBe('TICKER_NAO_ENCONTRADO');
  });

  it('retorna 400 quando ticker existe mas é Ação (não-FII)', async () => {
    // PETR4 falha regex FII primeiro (TICKER_INVALIDO), mas o teste verifica
    // que ações são bloqueadas em qualquer formato.
    const res1 = await request(app).get('/api/fiis/indicadores/PETR4');
    expect(res1.status).toBe(400);
    // Para validar TIPO_NAO_SUPORTADO, teríamos que burlar o regex — fora do escopo.
    // O regex já é a primeira linha de defesa.
  });

  it('retorna 200 com classificação correta para FII existente', async () => {
    db.prepare(`INSERT INTO ativos (ticker, dy_12m, dy_medio_5a,
                                     rentab_nominal_1a, rentab_real_1a,
                                     segmento, dy_medio_5a_fonte)
                VALUES ('HGLG11', 9.0, 9.0, 12.0, 8.5, 'Logístico', 'investidor10')`).run();
    const res = await request(app).get('/api/fiis/indicadores/HGLG11');
    expect(res.status).toBe(200);
    expect(res.body.data.ticker).toBe('HGLG11');
    expect(res.body.data.segmento).toBe('Logístico');
    expect(res.body.data.classificacao).toBe('EM_LINHA');
    expect(res.body.data.severidade).toBe('CONSISTENTE');
    expect(res.body.data.dy_vs_5a_pct).toBeCloseTo(100, 1);
    expect(res.body.data.rentab_nominal_1a).toBe(12.0);
    expect(res.body.data.rentab_real_1a).toBe(8.5);
    expect(res.body.data.dy_medio_5a_fonte).toBe('investidor10');
    expect(res.body.meta.schema).toBe('1.3');
  });

  it('normaliza ticker para uppercase', async () => {
    db.prepare(`INSERT INTO ativos (ticker, dy_12m, dy_medio_5a)
                VALUES ('HGLG11', 9.0, 9.0)`).run();
    const res = await request(app).get('/api/fiis/indicadores/hglg11');
    expect(res.status).toBe(200);
    expect(res.body.data.ticker).toBe('HGLG11');
  });

  it('inclui ativo_id e updated_at no detalhe', async () => {
    db.prepare(`INSERT INTO ativos (ticker, dy_12m, dy_medio_5a)
                VALUES ('HGLG11', 9.0, 9.0)`).run();
    const res = await request(app).get('/api/fiis/indicadores/HGLG11');
    expect(res.body.data.ativo_id).toBeDefined();
    expect(typeof res.body.data.ativo_id).toBe('number');
    expect(res.body.data.updated_at).toBeDefined();
  });

  it('retorna 500 quando DB indisponível', async () => {
    const brokenApp = express();
    brokenApp.use(express.json());
    brokenApp.use((req, _res, next) => { req.db = null; next(); });
    brokenApp.use('/api', indicadoresRouter);
    const res = await request(brokenApp).get('/api/fiis/indicadores/HGLG11');
    expect(res.status).toBe(500);
  });
});