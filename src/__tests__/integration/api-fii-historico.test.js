// TDD Red Phase — PRD 01 RF-021/023/024 — rota /api/fii-historico/:ticker.
// Cobre histórico paginado, métricas, sinais, sync status.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';

import fiiHistoricoRouter from '../../server/routes/fii-historico.js';

function appWithDb(db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = db; next(); });
  app.use('/api/fii-historico', fiiHistoricoRouter);
  return app;
}

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = MEMORY');
  db.exec(`
    CREATE TABLE ativos (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL DEFAULT 'FII', preco_teto REAL, dy_medio_5a REAL);
    CREATE TABLE cotacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL,
      data TEXT NOT NULL, preco REAL NOT NULL);
    CREATE TABLE lancamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL,
      data TEXT NOT NULL, tipo TEXT NOT NULL, quantidade INTEGER NOT NULL, preco REAL NOT NULL);
    CREATE TABLE proventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL,
      data_com TEXT, data_pagto TEXT, valor_por_cota REAL NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'DIVIDENDO'
        CHECK (tipo IN ('DIVIDENDO','RENDIMENTO','BONIFICACAO','AMORTIZACAO')),
      competencia TEXT NOT NULL DEFAULT '0000-00',
      precisao_data TEXT NOT NULL DEFAULT 'DIA',
      status TEXT NOT NULL DEFAULT 'PAGO'
        CHECK (status IN ('PAGO','AGENDADO')),
      fonte TEXT NOT NULL DEFAULT 'MANUAL',
      origem_chave TEXT,
      created_at TEXT, updated_at TEXT,
      FOREIGN KEY (ativo_id) REFERENCES ativos(id)
    );
    CREATE TABLE fii_dividendos_sync (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ativo_id INTEGER NOT NULL,
      ultimo_status TEXT NOT NULL,
      ultimo_ts TEXT, ultimo_total_lido INTEGER, ultimo_inseridos INTEGER,
      ultimo_atualizados INTEGER, ultimo_duplicados INTEGER, ultimo_conflitos INTEGER,
      primeira_competencia TEXT, ultima_competencia TEXT,
      cobertura_completa INTEGER DEFAULT 0, erro TEXT,
      FOREIGN KEY (ativo_id) REFERENCES ativos(id), UNIQUE (ativo_id)
    );
    CREATE TABLE config (chave TEXT PRIMARY KEY, valor TEXT);
    INSERT INTO config (chave, valor) VALUES ('versao_schema', '1.5');
  `);
  return db;
}

// Helpers
function seed(db) {
  db.prepare("INSERT INTO ativos (ticker, tipo, preco_teto, dy_medio_5a) VALUES ('HGLG11', 'FII', 100, 9.0)").run();
  db.prepare(`INSERT INTO cotacoes (ativo_id, data, preco) VALUES (1, '2026-07-15', 100)`).run();
  db.prepare(`INSERT INTO lancamentos (ativo_id, data, tipo, quantidade, preco) VALUES (1, '2025-01-10', 'COMPRA', 100, 80)`).run();
  return 1;  // ativo_id
}

function seedProventosHistorico(db, ativoId, items) {
  const ins = db.prepare(`
    INSERT INTO proventos (ativo_id, data_com, data_pagto, valor_por_cota, tipo,
                          competencia, precisao_data, status, fonte, origem_chave)
    VALUES (?, ?, ?, ?, ?, ?, 'DIA', 'PAGO', 'INVESTIDOR10', ?)
  `);
  for (const i of items) {
    ins.run(ativoId, i.data_com, i.data_pagto, i.valor_por_cota, i.tipo,
      i.competencia, i.origem_chave);
  }
}

describe('GET /api/fii-historico/:ticker — RF-021/023/024', () => {
  let app, db;
  beforeEach(() => { db = freshDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('retorna 404 para ticker desconhecido', async () => {
    const res = await request(app).get('/api/fii-historico/HGLG11');
    expect(res.status).toBe(404);
  });

  it('valida formato do ticker (regex)', async () => {
    const res = await request(app).get('/api/fii-historico/invalid');
    expect(res.status).toBe(400);
  });

  it('retorna histórico paginado + métricas para HGLG11 com 36 meses de histórico', async () => {
    seed(db);
    const ativoId = 1;
    // 36 proventos consecutivos com valor 0.80
    const items = [];
    for (let m = 0; m < 36; m++) {
      const d = new Date('2026-07-21');
      d.setMonth(d.getMonth() - m);
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      items.push({
        competencia: ym, data_com: `${ym}-15`, data_pagto: `${ym}-20`,
        valor_por_cota: 0.80, tipo: 'DIVIDENDO',
        origem_chave: `HGLG11:${ym}:DIVIDENDO:0.8`
      });
    }
    seedProventosHistorico(db, ativoId, items);

    const res = await request(app).get('/api/fii-historico/HGLG11?pagina=1&tamanhoPagina=12');
    expect(res.status).toBe(200);
    expect(res.body.ticker).toBe('HGLG11');
    expect(res.body.historico.length).toBe(12);
    expect(res.body.total_registros).toBe(36);
    expect(res.body.metricas.dy_realizado_12m).toBeCloseTo(9.6, 2);
    expect(res.body.comparacao_5a.razao).toBeCloseTo(9.6 / 9.0, 2);
    expect(res.body.comparacao_5a.classificacao).toBe('ACIMA_DA_MEDIA');
  });

  it('exclui AGENDADO dos cálculos de DY realizado', async () => {
    seed(db);
    seedProventosHistorico(db, 1, [
      { competencia: '2025-08', data_com: '2025-08-15', data_pagto: '2025-08-20',
        valor_por_cota: 0.80, tipo: 'DIVIDENDO', origem_chave: 'k1' }
    ]);
    // Insere um AGENDADO futuro direto
    db.prepare(`INSERT INTO proventos (ativo_id, data_com, data_pagto, valor_por_cota, tipo,
                                   competencia, status, fonte, origem_chave)
                VALUES (1, '2026-12-15', '2026-12-20', 0.99, 'DIVIDENDO', '2026-12', 'AGENDADO', 'MANUAL', 'k2')`).run();
    const res = await request(app).get('/api/fii-historico/HGLG11');
    expect(res.status).toBe(200);
    expect(res.body.metricas.dy_realizado_12m).toBeNull();  // cobertura < 12
    expect(res.body.metricas.indisponivel_motivo).toMatch(/cobertura/i);
  });

  it('inclui sinais (RF-016/017): lista com direção QUEDA/ALTA + estado', async () => {
    seed(db);
    const items = [];
    // 10 pagamentos de 0.80, depois 2 quedas a 0.50 (queda de 37.5% > 15%)
    for (let m = 0; m < 10; m++) {
      const d = new Date('2026-07-21');
      d.setMonth(d.getMonth() - m);
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      items.push({
        competencia: ym, data_com: `${ym}-15`, data_pagto: `${ym}-20`,
        valor_por_cota: 0.80, tipo: 'DIVIDENDO',
        origem_chave: `k${m}`
      });
    }
    // Queda em 2 meses consecutivos (m=11, m=10 — mas como itera de 0 pra trás,
    // os 2 primeiros são os MAIS RECENTES)
    items[0] = { ...items[0], valor_por_cota: 0.50 };
    items[1] = { ...items[1], valor_por_cota: 0.50 };
    seedProventosHistorico(db, 1, items);

    const res = await request(app).get('/api/fii-historico/HGLG11');
    expect(res.status).toBe(200);
    expect(res.body.sinais.length).toBeGreaterThan(0);
    const ultima = res.body.sinais[res.body.sinais.length - 1];
    expect(['CORTE_CONFIRMADO', 'EM_OBSERVACAO']).toContain(ultima.estado);
    expect(ultima.direcao).toBe('QUEDA');
  });

  it('retorna sync_status de fii_dividendos_sync quando presente', async () => {
    seed(db);
    db.prepare(`INSERT INTO fii_dividendos_sync
      (ativo_id, ultimo_status, ultimo_ts, ultimo_total_lido, ultimo_inseridos,
       primeira_competencia, ultima_competencia, cobertura_completa)
      VALUES (1, 'SUCESSO', '2026-07-21T10:00:00Z', 36, 36, '2023-08', '2026-07', 0)`).run();
    const res = await request(app).get('/api/fii-historico/HGLG11');
    expect(res.body.sync_status).toBeDefined();
    expect(res.body.sync_status.ultimo_status).toBe('SUCESSO');
    expect(res.body.sync_status.ultimo_total_lido).toBe(36);
    expect(res.body.sync_status.primeira_competencia).toBe('2023-08');
  });

  it('retorna sync_status null para FII nunca sincronizado', async () => {
    seed(db);
    const res = await request(app).get('/api/fii-historico/HGLG11');
    expect(res.body.sync_status).toBeNull();
  });
});

describe('POST /api/fii-historico/:ticker/importar — RF-002', () => {
  let app, db;
  beforeEach(() => { db = freshDb(); app = appWithDb(db); });
  afterEach(() => { db.close(); });

  it('chama importador com rows mockadas e retorna resumo', async () => {
    seed(db);
    const res = await request(app)
      .post('/api/fii-historico/HGLG11/importar')
      .send({
        rows: [
          { ticker: 'HGLG11', competencia: '2025-08', data_com: '2025-08-15',
            data_pagto: '2025-08-20', valor_por_cota: 0.80, tipo: 'DIVIDENDO',
            origem_chave: 'k1' },
          { ticker: 'HGLG11', competencia: '2025-08', data_com: '2025-08-15',
            data_pagto: '2025-08-20', valor_por_cota: 0.20, tipo: 'AMORTIZACAO',
            origem_chave: 'k2' }
        ]
      });
    expect(res.status).toBe(200);
    expect(res.body.inseridos).toBe(2);
    expect(res.body.duplicados).toBe(0);
    expect(res.body.por_tipo.DIVIDENDO).toBeCloseTo(0.80, 5);
    expect(res.body.por_tipo.AMORTIZACAO).toBeCloseTo(0.20, 5);
  });

  it('retorna 400 se rows ausente (sem seed de ativo)', async () => {
    const res = await request(app)
      .post('/api/fii-historico/HGLG11/importar')
      .send({});
    // Sem seed: ticker não existe → 404 (antes de checar rows)
    expect(res.status).toBe(404);
  });

  it('retorna 400 quando ativo existe mas rows ausente', async () => {
    seed(db);  // cria HGLG11
    const res = await request(app)
      .post('/api/fii-historico/HGLG11/importar')
      .send({});
    expect(res.status).toBe(400);
  });
});