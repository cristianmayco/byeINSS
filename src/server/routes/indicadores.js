// src/server/routes/indicadores.js
// Rotas REST do PRD 02 (Indicadores Históricos de DY e Rentabilidade Real):
//
//   GET  /api/fiis/indicadores              → lista FIIs com classificação
//   GET  /api/fiis/indicadores/:ticker      → detalhe de um FII
//
// Regras:
//   - Bind em 127.0.0.1 (validado no app.listen de src/server/index.js).
//   - Prepared statements (não concatenar strings em SQL).
//   - Erros nunca vazam SQL paths ou payloads brutos.
//   - Validação determinística via src/shared/indicadores.js.
//   - Thresholds lidos de `config.indicador_dy_vs_5a_abaixo_pct` (default 95)
//     e `config.indicador_dy_vs_5a_acima_pct` (default 105).

'use strict';

const express = require('express');
const router = express.Router();

const {
  calcularDyVs5a,
  classificarDyVs5a,
  DEFAULT_LIMIAR_ABAIXO_PCT,
  DEFAULT_LIMIAR_ACIMA_PCT
} = require('../../shared/indicadores.js');

// ===== ticker =====
const TICKER_RE = /^[A-Z]{4}11$/; // FIIs

function tickerNormalizado(t) {
  return String(t).toUpperCase();
}

function validarTicker(t) {
  if (!t) return false;
  return TICKER_RE.test(tickerNormalizado(t));
}

// ===== config =====
function getLimiarAbaixo(db) {
  const r = db.prepare("SELECT valor FROM config WHERE chave='indicador_dy_vs_5a_abaixo_pct'").get();
  const n = Number(r && r.valor);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIAR_ABAIXO_PCT;
}

function getLimiarAcima(db) {
  const r = db.prepare("SELECT valor FROM config WHERE chave='indicador_dy_vs_5a_acima_pct'").get();
  const n = Number(r && r.valor);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIAR_ACIMA_PCT;
}

// ===== enriquecimento de linha =====
function enriquecerLinha(row, limiarAbaixo, limiarAcima) {
  const { razao, pct, calculavel, motivo_indisponivel } = calcularDyVs5a({
    dy_12m: row.dy_12m,
    dy_medio_5a: row.dy_medio_5a
  });
  const cls = calculavel
    ? classificarDyVs5a({ pct, limiar_abaixo_pct: limiarAbaixo, limiar_acima_pct: limiarAcima })
    : { classificacao: 'INSUFICIENTE', severidade: 'INDEFINIDO', motivo: motivo_indisponivel };
  return {
    ticker: row.ticker,
    segmento: row.segmento,
    dy_12m: row.dy_12m,
    dy_medio_5a: row.dy_medio_5a,
    dy_medio_5a_fonte: row.dy_medio_5a_fonte,
    dy_medio_5a_atualizado_em: row.dy_medio_5a_atualizado_em,
    rentab_nominal_1a: row.rentab_nominal_1a,
    rentab_nominal_2a: row.rentab_nominal_2a,
    rentab_nominal_5a: row.rentab_nominal_5a,
    rentab_real_1a: row.rentab_real_1a,
    rentab_real_2a: row.rentab_real_2a,
    rentab_real_5a: row.rentab_real_5a,
    dy_vs_5a_pct: pct,
    classificacao: cls.classificacao,
    severidade: cls.severidade,
    motivo: cls.motivo,
    ativo: row.ativo
  };
}

// ===== GET /api/fiis/indicadores =====
router.get('/fiis/indicadores', (req, res) => {
  const db = req.db;
  if (!db) return res.status(500).json({ erro: 'DB indisponível' });

  const limiarAbaixo = getLimiarAbaixo(db);
  const limiarAcima = getLimiarAcima(db);

  const rows = db.prepare(`
    SELECT ticker, segmento, tipo, ativo,
           dy_12m, dy_medio_5a, dy_medio_5a_fonte, dy_medio_5a_atualizado_em,
           rentab_nominal_1a, rentab_nominal_2a, rentab_nominal_5a,
           rentab_real_1a, rentab_real_2a, rentab_real_5a
    FROM ativos
    WHERE tipo='FII'
    ORDER BY ticker
  `).all();

  const dados = rows.map(r => enriquecerLinha(r, limiarAbaixo, limiarAcima));

  return res.json({
    data: dados,
    meta: {
      schema: '1.3',
      total: dados.length,
      limiar_abaixo_pct: limiarAbaixo,
      limiar_acima_pct: limiarAcima,
      contadores_por_severidade: dados.reduce((acc, d) => {
        acc[d.severidade] = (acc[d.severidade] || 0) + 1;
        return acc;
      }, {})
    }
  });
});

// ===== GET /api/fiis/indicadores/:ticker =====
router.get('/fiis/indicadores/:ticker', (req, res) => {
  const db = req.db;
  if (!db) return res.status(500).json({ erro: 'DB indisponível' });

  const ticker = tickerNormalizado(req.params.ticker);
  if (!validarTicker(ticker)) {
    return res.status(400).json({ erro: 'TICKER_INVALIDO', detalhe: 'Ticker deve seguir ^[A-Z]{4}11$' });
  }

  const row = db.prepare(`
    SELECT id, ticker, segmento, tipo, ativo,
           dy_12m, dy_medio_5a, dy_medio_5a_fonte, dy_medio_5a_atualizado_em,
           rentab_nominal_1a, rentab_nominal_2a, rentab_nominal_5a,
           rentab_real_1a, rentab_real_2a, rentab_real_5a,
           updated_at
    FROM ativos WHERE ticker=?
  `).get(ticker);

  if (!row) return res.status(404).json({ erro: 'TICKER_NAO_ENCONTRADO', ticker });

  if (row.tipo !== 'FII') {
    return res.status(400).json({ erro: 'TIPO_NAO_SUPORTADO', detalhe: 'Indicadores disponíveis apenas para ativos do tipo FII' });
  }

  const limiarAbaixo = getLimiarAbaixo(db);
  const limiarAcima = getLimiarAcima(db);
  const enriquecido = enriquecerLinha(row, limiarAbaixo, limiarAcima);
  enriquecido.updated_at = row.updated_at;
  enriquecido.ativo_id = row.id;

  return res.json({ data: enriquecido, meta: { schema: '1.3', limiar_abaixo_pct: limiarAbaixo, limiar_acima_pct: limiarAcima } });
});

module.exports = router;