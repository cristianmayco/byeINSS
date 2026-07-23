// src/__tests__/integration/api-radar-dy.test.js
// Cobre os endpoints do PRD 07:
//   - GET /api/fiis/radar-dy (lista FIIs classificados)
//   - GET /api/fiis/radar-dy/:ticker (detalhe)
//   - PUT /api/config/radar-dy (atualiza thresholds, RF-024 atômico)

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';

import radarDyRouter from '../../server/routes/radar-dy.js';

function appWithDb(db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = db; next(); });
  app.use('/api/fiis/radar-dy', radarDyRouter);
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
      dy_medio_5a REAL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);
    INSERT INTO config (chave, valor) VALUES
      ('radar_dy_habilitado', '1'),
      ('radar_dy_limiar_amarelo', '1.25'),
      ('radar_dy_limiar_vermelho', '1.50');
  `);
  return db;
}

describe('GET /api/fiis/radar-dy (PRD 07)', () => {
  let db, app;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });

  it('lista vazia', async () => {
    const res = await request(app).get('/api/fiis/radar-dy');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.habilitado).toBe(true);
  });

  it('FII com ratio 1.26 → AMARELO', async () => {
    db.prepare(`INSERT INTO ativos (ticker, tipo, dy_12m, dy_medio_5a)
                VALUES ('HGLG11', 'FII', 12.6, 10.0)`).run();
    const res = await request(app).get('/api/fiis/radar-dy');
    expect(res.body.items[0].nivel).toBe('AMARELO');
    expect(res.body.resumo.amarelos).toBe(1);
  });

  it('FII com ratio 1.51 → VERMELHO', async () => {
    db.prepare(`INSERT INTO ativos (ticker, tipo, dy_12m, dy_medio_5a)
                VALUES ('XPML11', 'FII', 15.1, 10.0)`).run();
    const res = await request(app).get('/api/fiis/radar-dy');
    expect(res.body.items[0].nivel).toBe('VERMELHO');
    expect(res.body.resumo.vermelhos).toBe(1);
  });

  it('FII sem dy_medio_5a → SEM_DADOS (não vira NORMAL)', async () => {
    db.prepare(`INSERT INTO ativos (ticker, tipo, dy_12m) VALUES ('NOVO11', 'FII', 9.0)`).run();
    const res = await request(app).get('/api/fiis/radar-dy');
    expect(res.body.items[0].nivel).toBe('SEM_DADOS');
    expect(res.body.resumo.normais).toBe(0);
  });

  it('FII com dy_medio_5a=0 → SEM_DADOS (RF-007)', async () => {
    db.prepare(`INSERT INTO ativos (ticker, tipo, dy_12m, dy_medio_5a)
                VALUES ('ZERO11', 'FII', 9, 0)`).run();
    const res = await request(app).get('/api/fiis/radar-dy');
    expect(res.body.items[0].nivel).toBe('SEM_DADOS');
  });

  it('ativos não-FII são excluídos', async () => {
    db.prepare(`INSERT INTO ativos (ticker, tipo, dy_12m, dy_medio_5a)
                VALUES ('PETR4', 'ACAO', 12, 10)`).run();
    db.prepare(`INSERT INTO ativos (ticker, tipo, dy_12m, dy_medio_5a)
                VALUES ('HGLG11', 'FII', 12, 10)`).run();
    const res = await request(app).get('/api/fiis/radar-dy');
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].ticker).toBe('HGLG11');
  });

  it('envelope inclui schema + thresholds', async () => {
    const res = await request(app).get('/api/fiis/radar-dy');
    expect(res.body.schema).toBe('1.7');
    expect(res.body.thresholds.amarelo).toBe(1.25);
    expect(res.body.thresholds.vermelho).toBe(1.50);
  });

  it('Radar desativado → 200 com habilitado=false', async () => {
    db.prepare(`UPDATE config SET valor='0' WHERE chave='radar_dy_habilitado'`).run();
    const res = await request(app).get('/api/fiis/radar-dy');
    expect(res.status).toBe(200);
    expect(res.body.habilitado).toBe(false);
    expect(res.body.mensagem).toMatch(/desativado/i);
  });

  it('ordenação: VERMELHO antes de AMARELO; ratio desc (RF-014)', async () => {
    db.prepare(`INSERT INTO ativos (ticker, tipo, dy_12m, dy_medio_5a)
                VALUES ('AAA', 'FII', 16, 10)`).run();
    db.prepare(`INSERT INTO ativos (ticker, tipo, dy_12m, dy_medio_5a)
                VALUES ('BBB', 'FII', 13, 10)`).run();
    db.prepare(`INSERT INTO ativos (ticker, tipo, dy_12m, dy_medio_5a)
                VALUES ('CCC', 'FII', 17, 10)`).run();
    const res = await request(app).get('/api/fiis/radar-dy');
    expect(res.body.items.map(i => i.ticker)).toEqual(['CCC', 'AAA', 'BBB']);
  });
});

describe('GET /api/fiis/radar-dy/:ticker (PRD 07)', () => {
  let db, app;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });

  it('ticker inválido → 400', async () => {
    const res = await request(app).get('/api/fiis/radar-dy/INVALIDO');
    expect(res.status).toBe(400);
  });

  it('ticker inexistente → 404', async () => {
    const res = await request(app).get('/api/fiis/radar-dy/HGLG11');
    expect(res.status).toBe(404);
  });

  it('não-FII (formato FII mas tipo=ACAO) → 404', async () => {
    // Para chegar ao handler "não-FII" o ticker precisa passar a regex ^[A-Z]{4}11$.
    db.prepare(`INSERT INTO ativos (ticker, tipo) VALUES ('HGLG11', 'ACAO')`).run();
    const res = await request(app).get('/api/fiis/radar-dy/HGLG11');
    expect(res.status).toBe(404);
    expect(res.body.erro).toBe('ATIVO_NAO_FII');
  });

  it('detalhe com classificação correta', async () => {
    db.prepare(`INSERT INTO ativos (ticker, tipo, dy_12m, dy_medio_5a)
                VALUES ('HGLG11', 'FII', 12.6, 10.0)`).run();
    const res = await request(app).get('/api/fiis/radar-dy/HGLG11');
    expect(res.status).toBe(200);
    expect(res.body.nivel).toBe('AMARELO');
    expect(res.body.ratio).toBeCloseTo(1.26, 2);
  });

  it('ticker minúsculo normalizado', async () => {
    db.prepare(`INSERT INTO ativos (ticker, tipo, dy_12m, dy_medio_5a)
                VALUES ('HGLG11', 'FII', 12.6, 10.0)`).run();
    const res = await request(app).get('/api/fiis/radar-dy/hglg11');
    expect(res.status).toBe(200);
    expect(res.body.ticker).toBe('HGLG11');
  });
});

describe('PUT /api/config/radar-dy (PRD 07)', () => {
  let db, app;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });

  it('thresholds válidos → 200 + persiste', async () => {
    const res = await request(app).put('/api/fiis/radar-dy').send({ amarelo: 1.30, vermelho: 1.60 });
    expect(res.status).toBe(200);
    expect(res.body.thresholds).toEqual({ amarelo: 1.30, vermelho: 1.60, habilitado: '1' });
    const v = db.prepare("SELECT valor FROM config WHERE chave='radar_dy_limiar_amarelo'").get();
    expect(v.valor).toBe('1.3');
  });

  it('thresholds inválidos (vermelho <= amarelo) → 400 + não persiste', async () => {
    const res = await request(app).put('/api/fiis/radar-dy').send({ amarelo: 1.5, vermelho: 1.3 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_THRESHOLDS');
    const v = db.prepare("SELECT valor FROM config WHERE chave='radar_dy_limiar_amarelo'").get();
    expect(v.valor).toBe('1.25');  // inalterado
  });

  it('amarelo <= 1.0 → 400', async () => {
    const res = await request(app).put('/api/fiis/radar-dy').send({ amarelo: 1.0, vermelho: 1.5 });
    expect(res.status).toBe(400);
  });

  it('salvamento atômico: se inválido, nenhum campo é alterado (RF-024)', async () => {
    // Amarelo válido, vermelho inválido (muito alto)
    const res = await request(app).put('/api/fiis/radar-dy').send({ amarelo: 1.3, vermelho: 11.0 });
    expect(res.status).toBe(400);
    const v = db.prepare("SELECT valor FROM config WHERE chave='radar_dy_limiar_amarelo'").get();
    expect(v.valor).toBe('1.25');  // inalterado
  });

  it('desativação via habilitado=0', async () => {
    const res = await request(app).put('/api/fiis/radar-dy').send({ amarelo: 1.25, vermelho: 1.50, habilitado: '0' });
    expect(res.status).toBe(200);
    expect(res.body.thresholds.habilitado).toBe('0');
  });
});