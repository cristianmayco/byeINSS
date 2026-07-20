// src/server/routes/contratos.js
// Rotas REST do PRD 12 (Vencimento Médio de Contratos):
//
//   GET  /api/fiis/contratos/:ticker          → leitura consolidada
//   PUT  /api/fiis/contratos/:ticker          → upsert manual (marca origem=manual)
//   GET  /api/dashboard/alertas-vencimento    → lista FIIs com vencimento < N
//
// Fora de escopo deste PR (próximas sub-PRs PRD 12):
//   - POST /api/fiis/scraper/contratos/resync → dispara resync do scraper
//
// Regras:
//   - Bind em 127.0.0.1 (validado no app.listen de src/server/index.js).
//   - Prepared statements (não concatenar strings em SQL).
//   - Erros nunca vazam SQL paths ou payloads brutos.
//   - Validação determinística via src/shared/contratos.js.
//   - Janela de alerta lida de `config.vencimento_janela_alerta_meses`
//     (default 24) — fonte única para PUT, GET e dashboard.

'use strict';

const express = require('express');
const router = express.Router();

const {
  calcularAlertaVencimento,
  validarDadosContratos
} = require('../../shared/contratos.js');

const JANELA_DEFAULT = 24;

function hojeISO() {
  // Data local formatada em ISO YYYY-MM-DD (data de hoje "à meia-noite").
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Janela de alerta (meses) injetada pela config, com fallback seguro.
function getJanelaAlerta(db) {
  const r = db
    .prepare("SELECT valor FROM config WHERE chave='vencimento_janela_alerta_meses'")
    .get();
  const n = Number(r && r.valor);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : JANELA_DEFAULT;
}

// ===== ticker =====
const TICKER_RE = /^[A-Z]{4}11$/;          // FIIs
const TICKER_RE_ACAO = /^[A-Z]{4}[0-9]$/;  // Ações (rotas /fiis/* as aceitam para evitar
                                            // surpresa no caller, mas o domínio "vencimento
                                            // de contratos" não se aplica — ver RF002 PRD 12)

function tickerNormalizado(t) {
  return String(t).toUpperCase();
}

function validarTicker(t) {
  if (!t) return false;
  const u = String(t).toUpperCase();
  return TICKER_RE.test(u) || TICKER_RE_ACAO.test(u);
}

function getAtivo(db, ticker) {
  return db
    .prepare('SELECT id, ticker, tipo FROM ativos WHERE ticker = ?')
    .get(ticker);
}

function montarPayload(db, ativoId, ticker) {
  const row = db
    .prepare(`SELECT
        vencimento_medio_contratos,
        vencimento_medio_contratos_meses,
        tipo_reajuste,
        reajuste_percentual,
        vencimento_medio_origem,
        vencimento_medio_coletado_em,
        alerta_vencimento
      FROM ativos WHERE id = ?`)
    .get(ativoId);

  if (!row) return null;

  return {
    ticker,
    vencimento_medio_contratos: row.vencimento_medio_contratos,
    vencimento_medio_contratos_meses: row.vencimento_medio_contratos_meses,
    tipo_reajuste: row.tipo_reajuste,
    reajuste_percentual: row.reajuste_percentual,
    vencimento_medio_origem: row.vencimento_medio_origem,
    coletado_em: row.vencimento_medio_coletado_em,
    alerta_vencimento: Boolean(row.alerta_vencimento),
    meses_ate_vencimento: null  // recalculado pelo caller
  };
}

// ============== GET /api/fiis/contratos/:ticker ==============
router.get('/:ticker', (req, res) => {
  const ticker = tickerNormalizado(req.params.ticker);
  if (!validarTicker(ticker)) {
    return res.status(400).json({ error: 'ticker inválido' });
  }

  const db = req.db;
  const ativo = getAtivo(db, ticker);
  if (!ativo) return res.status(404).json({ error: 'FII não encontrado' });

  const payload = montarPayload(db, ativo.id, ticker);
  if (!payload) return res.status(404).json({ error: 'FII não encontrado' });

  const janela = getJanelaAlerta(db);
  const estado = calcularAlertaVencimento({
    dataVenc: payload.vencimento_medio_contratos,
    meses: payload.vencimento_medio_contratos_meses,
    hoje: hojeISO(),
    janela
  });
  payload.meses_ate_vencimento = estado.meses_ate_vencimento;
  // Override do alerta para refletir a janela configurada.
  payload.alerta_vencimento = estado.alerta_24m && ativo.tipo === 'FII';

  res.json(payload);
});

// ============== PUT /api/fiis/contratos/:ticker ==============
const MUTABLE_FIELDS = [
  'vencimento_medio_contratos',
  'vencimento_medio_contratos_meses',
  'tipo_reajuste',
  'reajuste_percentual'
];
const ORIGEM_MANUAL = 'manual';

router.put('/:ticker', (req, res) => {
  const ticker = tickerNormalizado(req.params.ticker);
  if (!validarTicker(ticker)) {
    return res.status(400).json({ error: 'ticker inválido' });
  }

  const db = req.db;
  const ativo = getAtivo(db, ticker);
  if (!ativo) return res.status(404).json({ error: 'FII não encontrado' });

  const body = req.body || {};

  // Lê estado atual para merge + validação de coerência.
  const current = db
    .prepare(`SELECT vencimento_medio_contratos, vencimento_medio_contratos_meses
              FROM ativos WHERE id = ?`)
    .get(ativo.id);

  // Validação com base no ESTADO RESULTANTE (body + current), não só body.
  // body[k] === null é tratado como "limpar" (substitui o valor atual).
  // body[k] === undefined significa "não toque" (mantém o valor atual).
  const merged = {
    vencimento_medio_contratos:
      body.vencimento_medio_contratos !== undefined
        ? body.vencimento_medio_contratos
        : (current ? current.vencimento_medio_contratos : null),
    vencimento_medio_contratos_meses:
      body.vencimento_medio_contratos_meses !== undefined
        ? body.vencimento_medio_contratos_meses
        : (current ? current.vencimento_medio_contratos_meses : null),
    tipo_reajuste: body.tipo_reajuste,
    reajuste_percentual: body.reajuste_percentual
  };
  const validacao = validarDadosContratos(merged);
  if (!validacao.ok) {
    return res
      .status(validacao.status || 400)
      .json({ error: validacao.erro });
  }

  const fields = [];
  const values = [];
  for (const k of MUTABLE_FIELDS) {
    if (body[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(body[k]);
    }
  }
  if (!fields.length) {
    return res.status(400).json({ error: 'nenhum campo a atualizar' });
  }
  fields.push(`vencimento_medio_origem = ?`);
  values.push(ORIGEM_MANUAL);
  fields.push(`vencimento_medio_coletado_em = datetime('now')`);

  // Recalcular alerta com ESTADO RESULTANTE (merged), não só body.
  const dataVenc = merged.vencimento_medio_contratos;
  const meses = merged.vencimento_medio_contratos_meses;
  const janela = getJanelaAlerta(db);
  const estado = calcularAlertaVencimento({ dataVenc, meses, hoje: hojeISO(), janela });
  fields.push(`alerta_vencimento = ?`);
  values.push(estado.alerta_24m && ativo.tipo === 'FII' ? 1 : 0);
  fields.push(`updated_at = datetime('now')`);
  values.push(ativo.id);

  try {
    db.prepare(`UPDATE ativos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  } catch (e) {
    return res.status(500).json({ error: 'falha de persistência' });
  }

  // Log de auditoria (canônico conforme PRD §5: campo = nome do campo alterado).
  // Como PUT é multi-campo, gravamos uma linha por campo efetivamente alterado.
  try {
    const ins = db.prepare(`
      INSERT INTO fii_scraper_log (ticker, campo, sucesso, origem) VALUES (?, ?, 1, ?)
    `);
    for (const k of MUTABLE_FIELDS) {
      if (body[k] !== undefined) ins.run(ticker, k, ORIGEM_MANUAL);
    }
  } catch { /* silencioso: log é best-effort */ }

  const payload = montarPayload(db, ativo.id, ticker);
  payload.meses_ate_vencimento = estado.meses_ate_vencimento;
  res.json(payload);
});

// ============== GET /api/dashboard/alertas-vencimento ==============
const dashboardRouter = express.Router();
dashboardRouter.get('/alertas-vencimento', (req, res) => {
  const db = req.db;
  const janela = getJanelaAlerta(db);
  const hoje = hojeISO();
  // Recalcula alerta DINAMICAMENTE (não usa o flag persistido que pode
  // estar desatualizado após mudança de janela de configuração).
  // Critérios:
  //   - tipo = 'FII'
  //   - tem dados de vencimento (data ou meses)
  //   - meses calculados < janela (com fallback para "desconhecido" se
  //     a fonte for parcial)
  //   - alerta só conta se origem conhecida (não veio em branco)
  const rows = db
    .prepare(`
      SELECT ticker,
             vencimento_medio_contratos,
             vencimento_medio_contratos_meses,
             tipo_reajuste,
             vencimento_medio_coletado_em,
             vencimento_medio_origem
      FROM ativos
      WHERE tipo = 'FII'
        AND vencimento_medio_origem IS NOT NULL
        AND (
          vencimento_medio_contratos_meses IS NOT NULL
          OR vencimento_medio_contratos IS NOT NULL
        )
      ORDER BY ticker
    `)
    .all();

  const itens = [];
  for (const r of rows) {
    const estado = calcularAlertaVencimento({
      dataVenc: r.vencimento_medio_contratos,
      meses: r.vencimento_medio_contratos_meses,
      hoje,
      janela
    });
    if (estado.disponivel && estado.alerta_24m) {
      itens.push({
        ticker: r.ticker,
        meses: estado.meses_ate_vencimento,
        tipo_reajuste: r.tipo_reajuste,
        snapshot_em: r.vencimento_medio_coletado_em
      });
    }
  }
  // Ordena do mais urgente (menor meses) para o menos
  itens.sort((a, b) => (a.meses ?? 0) - (b.meses ?? 0));

  res.json({ total: itens.length, itens, janela });
});

module.exports = router;
module.exports.dashboard = dashboardRouter;
