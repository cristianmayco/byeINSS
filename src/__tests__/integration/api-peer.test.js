// src/__tests__/integration/api-peer.test.js
// Cobre os endpoints do PRD 04:
//   - GET /api/fiis/:ticker/comparativo-peer (detalhe)
//   - POST /api/dashboard/rebalanceamento (simulação)
//
// Inclui: validação de ticker, fallback SEM_DADOS, classificação,
// teto efetivo com/sem peer, rebalanceamento proporcional.

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';

import peerRoutes from '../../server/routes/peer.js';

function appWithDb(db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = db; next(); });
  app.use('/api/fiis', peerRoutes.comparativoRouter);
  app.use('/api/dashboard', peerRoutes.rebalanceamentoRouter);
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
      p_vp REAL, vp_cota REAL, dy_12m REAL, dy_24m REAL,
      pvp_medio_segmento REAL, dy_medio_segmento REAL,
      pl_medio_segmento REAL, vpa_medio_segmento REAL,
      peer_grupo_nome TEXT, peer_grupo_tipo TEXT,
      peer_fonte TEXT, peer_atualizado_em TEXT,
      preco_teto REAL, alvo_pct_carteira REAL DEFAULT 1.76,
      ativo INTEGER DEFAULT 1
    );
    CREATE TABLE lancamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ativo_id INTEGER NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('COMPRA','VENDA')),
      quantidade INTEGER NOT NULL,
      preco REAL NOT NULL,
      FOREIGN KEY (ativo_id) REFERENCES ativos(id)
    );
    CREATE TABLE cotacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ativo_id INTEGER NOT NULL,
      data TEXT NOT NULL,
      preco REAL NOT NULL,
      FOREIGN KEY (ativo_id) REFERENCES ativos(id)
    );
    CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);
    INSERT INTO config (chave, valor) VALUES
      ('peer_desvio_neutro_pct', '5.0'),
      ('peer_dy_desfavoravel_pct', '10.0'),
      ('peer_validade_horas', '168'),
      ('peer_margem_teto_pct', '0.0'),
      ('peer_multiplicador_favoravel', '1.15'),
      ('peer_multiplicador_neutro', '1.00'),
      ('peer_multiplicador_desfavoravel', '0.75');
  `);
  return db;
}

const agoraIso = '2026-07-22T12:00:00.000Z';

describe('GET /api/fiis/:ticker/comparativo-peer (PRD 04)', () => {
  let db, app;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });

  it('ticker inválido → 400', async () => {
    const res = await request(app).get('/api/fiis/INVALIDO/comparativo-peer');
    expect(res.status).toBe(400);
    expect(res.body.erro).toBe('TICKER_INVALIDO');
  });

  it('ticker inexistente → 404', async () => {
    const res = await request(app).get('/api/fiis/HGLG11/comparativo-peer');
    expect(res.status).toBe(404);
    expect(res.body.erro).toBe('ATIVO_NAO_ENCONTRADO');
  });

  it('ativo não-FII (tipo ACAO mas formato FII) → 404', async () => {
    // Para cair no handler de "não-FII" o ticker precisa passar a regex ^[A-Z]{4}11$
    // mas o tipo precisa ser != FII. Em produção isso não acontece (constraint),
    // mas testamos o handler defensivo.
    db.prepare(`INSERT INTO ativos (ticker, tipo) VALUES ('HGLG11', 'ACAO')`).run();
    const res = await request(app).get('/api/fiis/HGLG11/comparativo-peer');
    expect(res.status).toBe(404);
    expect(res.body.erro).toBe('ATIVO_NAO_FII');
  });

  it('FII sem benchmark → estado SEM_DADOS', async () => {
    db.prepare(`INSERT INTO ativos (ticker, tipo) VALUES ('HGLG11', 'FII')`).run();
    const res = await request(app).get('/api/fiis/HGLG11/comparativo-peer');
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('SEM_DADOS');
  });

  it('FII com benchmark completo + P/VP abaixo da média → classificacao FAVORAVEL', async () => {
    db.prepare(`INSERT INTO ativos (ticker, tipo, p_vp, vp_cota, dy_12m,
                                     pvp_medio_segmento, dy_medio_segmento,
                                     pl_medio_segmento, vpa_medio_segmento,
                                     peer_grupo_nome, peer_grupo_tipo,
                                     peer_fonte, peer_atualizado_em,
                                     preco_teto)
                VALUES ('HGLG11', 'FII', 0.85, 101.20, 9.8,
                        0.95, 9.10, 1500000000, 96.70,
                        'Logístico', 'SEGMENTO', 'investidor10', ?, 170.00)`).run(agoraIso);
    const res = await request(app).get('/api/fiis/HGLG11/comparativo-peer');
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('OK');
    expect(res.body.classificacao).toBe('FAVORAVEL');
    expect(res.body.pvp.desvio_pct).toBeLessThan(-5);
    expect(res.body.preco_teto_efetivo).toBeLessThan(170);
    expect(res.body.regra_limitante).toBe('PEER_PVP');
    expect(res.body.benchmark_aplicado).toBe(true);
    expect(res.body.multiplicador_peer).toBeCloseTo(1.15, 2);
  });

  it('snapshot há 8 dias → estado DESATUALIZADO', async () => {
    const oitoDias = '2026-07-14T12:00:00.000Z';
    db.prepare(`INSERT INTO ativos (ticker, tipo, p_vp, vp_cota, dy_12m,
                                     pvp_medio_segmento, dy_medio_segmento,
                                     pl_medio_segmento, vpa_medio_segmento,
                                     peer_atualizado_em)
                VALUES ('HGLG11', 'FII', 0.85, 101.20, 9.8,
                        0.95, 9.10, 1e9, 96.70, ?)`).run(oitoDias);
    const res = await request(app).get('/api/fiis/HGLG11/comparativo-peer');
    expect(res.body.estado).toBe('DESATUALIZADO');
    expect(res.body.grupo.desatualizado).toBe(true);
  });

  it('preco_teto menor que peer_ref → regra DY_BASE (peer não limita teto)', async () => {
    // vp_cota=100 × pvp_medio=1.05 = 105 > preco_teto=50
    // Peer sugere 105 mas teto base é 50 — peer NÃO ELEVA o teto.
    db.prepare(`INSERT INTO ativos (ticker, tipo, p_vp, vp_cota, dy_12m,
                                     pvp_medio_segmento, dy_medio_segmento,
                                     pl_medio_segmento, vpa_medio_segmento,
                                     peer_atualizado_em, preco_teto)
                VALUES ('HGLG11', 'FII', 1.05, 100, 9,
                        1.05, 9, 1e9, 100, ?, 50)`).run(agoraIso);
    // peer_ref = 100×1.05 = 105; preco_teto = 50; min = 50; regra = DY_BASE
    const res = await request(app).get('/api/fiis/HGLG11/comparativo-peer');
    expect(res.body.preco_teto_efetivo).toBe(50);
    expect(res.body.regra_limitante).toBe('DY_BASE');
  });

  it('preco_teto maior que peer_ref → regra PEER_PVP (peer limita teto)', async () => {
    db.prepare(`INSERT INTO ativos (ticker, tipo, p_vp, vp_cota, dy_12m,
                                     pvp_medio_segmento, dy_medio_segmento,
                                     pl_medio_segmento, vpa_medio_segmento,
                                     peer_atualizado_em, preco_teto)
                VALUES ('HGLG11', 'FII', 0.95, 100, 9,
                        0.95, 9, 1e9, 100, ?, 200)`).run(agoraIso);
    // peer_ref = 100×0.95 = 95 < preco_teto = 200 → MIN = 95, regra = PEER_PVP
    const res = await request(app).get('/api/fiis/HGLG11/comparativo-peer');
    expect(res.body.preco_teto_efetivo).toBe(95);
    expect(res.body.regra_limitante).toBe('PEER_PVP');
  });

  it('ticker minúsculo é normalizado para maiúsculas', async () => {
    db.prepare(`INSERT INTO ativos (ticker, tipo, p_vp, vp_cota, dy_12m,
                                     pvp_medio_segmento, dy_medio_segmento,
                                     pl_medio_segmento, vpa_medio_segmento,
                                     peer_atualizado_em)
                VALUES ('HGLG11', 'FII', 0.85, 101.20, 9.8,
                        0.95, 9.10, 1e9, 96.70, ?)`).run(agoraIso);
    const res = await request(app).get('/api/fiis/hglg11/comparativo-peer');
    expect(res.status).toBe(200);
    expect(res.body.ticker).toBe('HGLG11');
  });
});

describe('POST /api/dashboard/rebalanceamento (PRD 04)', () => {
  let db, app;
  beforeEach(() => { db = setupDb(); app = appWithDb(db); });

  it('aporte ausente → 400', async () => {
    const res = await request(app).post('/api/dashboard/rebalanceamento').send({});
    expect(res.status).toBe(400);
    expect(res.body.erro).toBe('APORTE_INVALIDO');
  });

  it('aporte negativo → 400', async () => {
    const res = await request(app).post('/api/dashboard/rebalanceamento').send({ aporte: -100 });
    expect(res.status).toBe(400);
  });

  it('aporte não numérico → 400', async () => {
    const res = await request(app).post('/api/dashboard/rebalanceamento').send({ aporte: 'abc' });
    expect(res.status).toBe(400);
  });

  it('sem FIIs ativos → 200 com sugestões vazias', async () => {
    const res = await request(app).post('/api/dashboard/rebalanceamento').send({ aporte: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.sugestoes).toEqual([]);
  });

  it('FII favorável recebe multiplicador 1.15', async () => {
    db.prepare(`INSERT INTO ativos (ticker, tipo, p_vp, vp_cota, dy_12m,
                                     pvp_medio_segmento, dy_medio_segmento,
                                     pl_medio_segmento, vpa_medio_segmento,
                                     peer_atualizado_em,
                                     preco_teto, alvo_pct_carteira)
                VALUES ('HGLG11', 'FII', 0.85, 100, 9.5,
                        0.95, 9, 1e9, 100, ?, 1000, 50)`).run(agoraIso);
    db.prepare(`INSERT INTO cotacoes (ativo_id, data, preco)
                VALUES (1, '2026-07-22', 50)`).run();
    const res = await request(app).post('/api/dashboard/rebalanceamento').send({ aporte: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.sugestoes).toHaveLength(1);
    expect(res.body.sugestoes[0].multiplicador_peer).toBeCloseTo(1.15, 2);
  });

  it('FII acima do teto → ignorado como ACIMA_DO_TETO', async () => {
    db.prepare(`INSERT INTO ativos (ticker, tipo, p_vp, vp_cota, dy_12m,
                                     pvp_medio_segmento, dy_medio_segmento,
                                     pl_medio_segmento, vpa_medio_segmento,
                                     peer_atualizado_em,
                                     preco_teto, alvo_pct_carteira)
                VALUES ('XPTO11', 'FII', 1.0, 100, 9, 1.0, 9, 1e9, 100, ?, 100, 50)`).run(agoraIso);
    db.prepare(`INSERT INTO cotacoes (ativo_id, data, preco) VALUES (1, '2026-07-22', 200)`).run();
    const res = await request(app).post('/api/dashboard/rebalanceamento').send({ aporte: 1000 });
    expect(res.body.sugestoes).toEqual([]);
    expect(res.body.ignorados.some(i => i.ticker === 'XPTO11' && i.motivo === 'ACIMA_DO_TETO')).toBe(true);
  });

  it('FII sem cotação → ignorado como SEM_COTACAO', async () => {
    db.prepare(`INSERT INTO ativos (ticker, tipo, preco_teto, alvo_pct_carteira)
                VALUES ('NOQUOT', 'FII', 100, 50)`).run();
    const res = await request(app).post('/api/dashboard/rebalanceamento').send({ aporte: 1000 });
    expect(res.body.ignorados.some(i => i.ticker === 'NOQUOT' && i.motivo === 'SEM_COTACAO')).toBe(true);
  });

  it('ativo não-FII é ignorado (escopo)', async () => {
    db.prepare(`INSERT INTO ativos (ticker, tipo, preco_teto, alvo_pct_carteira)
                VALUES ('PETR4', 'ACAO', 100, 50)`).run();
    db.prepare(`INSERT INTO cotacoes (ativo_id, data, preco) VALUES (1, '2026-07-22', 50)`).run();
    const res = await request(app).post('/api/dashboard/rebalanceamento').send({ aporte: 1000 });
    expect(res.body.sugestoes).toEqual([]);
  });

  it('envelope response inclui schema e configuração', async () => {
    const res = await request(app).post('/api/dashboard/rebalanceamento').send({ aporte: 1000 });
    expect(res.body.schema).toBe('1.7');
    expect(res.body.configuracao).toBeDefined();
    expect(res.body.configuracao.desvio_neutro_pct).toBe(5.0);
  });
});