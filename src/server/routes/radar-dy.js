// src/server/routes/radar-dy.js
// Rotas REST do PRD 07 (Radar de DY Suspeito):
//
//   GET  /api/fiis/radar-dy                  → lista FIIs com classificação
//   GET  /api/fiis/radar-dy/:ticker          → detalhe por FII
//   PUT  /api/config/radar-dy                → atualiza thresholds
//
// Regras:
//   - Bind em 127.0.0.1 (validado em src/server/index.js).
//   - Prepared statements (não concatenar strings em SQL).
//   - Erros nunca vazam SQL paths ou payloads brutos.
//   - Validação determinística via src/shared/radar-dy.js.
//   - Thresholds lidos de `config.radar_dy_*` (defaults: 1.25/1.50).

'use strict';

const express = require('express');
const router = express.Router();

const radar = require('../../shared/radar-dy.js');

const TICKER_RE = /^[A-Z]{4}11$/;

function validarTicker(t) {
  if (!t) return false;
  return TICKER_RE.test(String(t).toUpperCase());
}

function getRadarConfig(db) {
  const cfg = {
    habilitado: '1',
    amarelo: radar.DEFAULT_LIMIAR_AMARELO,
    vermelho: radar.DEFAULT_LIMIAR_VERMELHO
  };
  const stmt = db.prepare('SELECT valor FROM config WHERE chave=?');
  const h = stmt.get('radar_dy_habilitado');
  if (h) cfg.habilitado = h.valor;
  const a = stmt.get('radar_dy_limiar_amarelo');
  if (a) cfg.amarelo = Number(a.valor);
  const v = stmt.get('radar_dy_limiar_vermelho');
  if (v) cfg.vermelho = Number(v.valor);
  return cfg;
}

function avaliarFII(row, cfg) {
  return radar.avaliarRadarFII(row, { amarelo: cfg.amarelo, vermelho: cfg.vermelho });
}

// ============================================================================
// GET /api/fiis/radar-dy
// ============================================================================
router.get('/', (req, res) => {
  const db = req.db || req.app.locals.db;
  if (!db) return res.status(500).json({ erro: 'DB_NAO_DISPONIVEL' });

  const cfg = getRadarConfig(db);
  if (cfg.habilitado !== '1') {
    return res.json({
      habilitado: false,
      mensagem: 'Radar de DY desativado',
      schema: '1.7'
    });
  }

  const rows = db.prepare(`
    SELECT ticker, tipo, ativo, dy_12m, dy_medio_5a, updated_at
    FROM ativos
    WHERE tipo = 'FII'
  `).all();

  const items = rows.map(r => avaliarFII(r, cfg));
  const ordenados = radar.ordenarAlertas(items);
  const resumo = radar.agregarResumo(items);

  return res.json({
    schema: '1.7',
    habilitado: true,
    thresholds: { amarelo: cfg.amarelo, vermelho: cfg.vermelho },
    total: items.length,
    resumo,
    items: ordenados
  });
});

// ============================================================================
// GET /api/fiis/radar-dy/:ticker
// ============================================================================
router.get('/:ticker', (req, res) => {
  const tickerRaw = req.params.ticker;
  if (!validarTicker(tickerRaw)) {
    return res.status(400).json({ erro: 'TICKER_INVALIDO' });
  }
  const ticker = String(tickerRaw).toUpperCase();
  const db = req.db || req.app.locals.db;
  if (!db) return res.status(500).json({ erro: 'DB_NAO_DISPONIVEL' });

  const row = db.prepare(
    `SELECT ticker, tipo, ativo, dy_12m, dy_medio_5a, updated_at
     FROM ativos WHERE ticker = ?`
  ).get(ticker);
  if (!row) {
    return res.status(404).json({ erro: 'ATIVO_NAO_ENCONTRADO', ticker });
  }
  if (row.tipo !== 'FII') {
    return res.status(404).json({ erro: 'ATIVO_NAO_FII', ticker, tipo: row.tipo });
  }

  const cfg = getRadarConfig(db);
  const item = avaliarFII(row, cfg);

  return res.json({
    schema: '1.7',
    habilitado: cfg.habilitado === '1',
    thresholds: { amarelo: cfg.amarelo, vermelho: cfg.vermelho },
    ...item
  });
});

// ============================================================================
// PUT /api/config/radar-dy
// Body: { amarelo: number, vermelho: number, habilitado?: '0'|'1' }
// ============================================================================
router.put('/', (req, res) => {
  const body = req.body || {};
  const v = radar.validarThresholds(body.amarelo, body.vermelho);
  if (!v.ok) {
    return res.status(400).json({ error: v.erro, code: v.code });
  }

  const db = req.db || req.app.locals.db;
  if (!db) return res.status(500).json({ erro: 'DB_NAO_DISPONIVEL' });

  // Salvamento atômico (RF-024): tudo em uma transação.
  const habilitado = body.habilitado === '0' ? '0' : '1';
  const stmtAmarelo = db.prepare(
    "INSERT INTO config (chave, valor) VALUES ('radar_dy_limiar_amarelo', ?) " +
    "ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor"
  );
  const stmtVermelho = db.prepare(
    "INSERT INTO config (chave, valor) VALUES ('radar_dy_limiar_vermelho', ?) " +
    "ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor"
  );
  const stmtHab = db.prepare(
    "INSERT INTO config (chave, valor) VALUES ('radar_dy_habilitado', ?) " +
    "ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor"
  );

  try {
    db.transaction(() => {
      stmtAmarelo.run(String(v.amarelo));
      stmtVermelho.run(String(v.vermelho));
      stmtHab.run(habilitado);
    })();
  } catch (e) {
    return res.status(500).json({ erro: 'FALHA_PERSISTIR' });
  }

  return res.json({
    schema: '1.7',
    thresholds: { amarelo: v.amarelo, vermelho: v.vermelho, habilitado }
  });
});

module.exports = router;
module.exports.getRadarConfig = getRadarConfig;
module.exports.avaliarFII = avaliarFII;