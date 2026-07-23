// src/server/routes/peer.js
// Rotas REST do PRD 04 (Comparador vs Média do Segmento):
//
//   GET  /api/fiis/:ticker/comparativo-peer      → detalhe do peer por FII
//   POST /api/dashboard/rebalanceamento          → simulação de rebalanceamento
//
// Regras:
//   - Bind em 127.0.0.1 (validado em src/server/index.js).
//   - Prepared statements (não concatenar strings em SQL).
//   - Erros nunca vazam SQL paths ou payloads brutos.
//   - Validação determinística via src/shared/peer.js.
//   - Thresholds lidos de config (peer_*).

'use strict';

const express = require('express');
const comparativoRouter = express.Router();
const rebalanceamentoRouter = express.Router();

const peer = require('../../shared/peer.js');

const TICKER_RE = /^[A-Z]{4}11$/;

function validarTicker(t) {
  if (!t) return false;
  return TICKER_RE.test(String(t).toUpperCase());
}

// Limiares lidos de config.
function getPeerConfig(db) {
  const cfg = {
    desvio_neutro_pct: peer.DEFAULT_DESVIO_NEUTRO_PCT,
    dy_desfavoravel_pct: peer.DEFAULT_DY_DESFAVORAVEL_PCT,
    validade_horas: peer.DEFAULT_VALIDADE_HORAS,
    margem_teto_pct: peer.DEFAULT_MARGEM_TETO_PCT,
    multiplicador_favoravel: peer.DEFAULT_MULT_FAVORAVEL,
    multiplicador_neutro: peer.DEFAULT_MULT_NEUTRO,
    multiplicador_desfavoravel: peer.DEFAULT_MULT_DESFAVORAVEL
  };
  const chaves = {
    desvio_neutro_pct: 'peer_desvio_neutro_pct',
    dy_desfavoravel_pct: 'peer_dy_desfavoravel_pct',
    validade_horas: 'peer_validade_horas',
    margem_teto_pct: 'peer_margem_teto_pct',
    multiplicador_favoravel: 'peer_multiplicador_favoravel',
    multiplicador_neutro: 'peer_multiplicador_neutro',
    multiplicador_desfavoravel: 'peer_multiplicador_desfavoravel'
  };
  const stmt = db.prepare('SELECT valor FROM config WHERE chave=?');
  for (const [k, chave] of Object.entries(chaves)) {
    const r = stmt.get(chave);
    const n = Number(r && r.valor);
    if (Number.isFinite(n)) cfg[k] = n;
  }
  return cfg;
}

// Calcula o objeto peer (RF-008/009/010/011) para uma linha de ativos.
function calcularPeerParaAtivo(row, cfg) {
  const pvp = peer.calcularPvpVsPeer(row.p_vp, row.pvp_medio_segmento);
  const dy = peer.calcularDyVsPeer(row.dy_12m, row.dy_medio_segmento);
  const vpa = peer.calcularVpaVsPeer(row.vp_cota, row.vpa_medio_segmento);

  const cls = peer.classificarPeer(
    { pvp_desvio_pct: pvp && pvp.desvio_pct, dy_desvio_pct: dy && dy.desvio_pct },
    { desvio_neutro_pct: cfg.desvio_neutro_pct, dy_desfavoravel_pct: cfg.dy_desfavoravel_pct }
  );

  const ref = peer.precoReferenciaPeer(row.vp_cota, row.pvp_medio_segmento);
  const tetoEfetivo = peer.precoTetoEfetivo({
    preco_teto: row.preco_teto,
    preco_referencia_peer: ref,
    margem_pct: cfg.margem_teto_pct
  });

  const vencido = peer.benchmarkVencido(row.peer_atualizado_em, { validadeHoras: cfg.validade_horas });

  return {
    pvp, dy, vpa,
    classificacao: cls.classificacao,
    motivo: cls.motivo,
    preco_referencia_peer: ref,
    preco_teto_efetivo: tetoEfetivo.teto_efetivo,
    regra_limitante: tetoEfetivo.regra_limitante,
    benchmark_aplicado: tetoEfetivo.benchmark_aplicado,
    multiplicador_peer: peer.multiplicadorPeer(cls.classificacao, cfg),
    vencido
  };
}

// ============================================================================
// GET /api/fiis/:ticker/comparativo-peer
// ============================================================================
comparativoRouter.get('/:ticker/comparativo-peer', (req, res) => {
  const tickerRaw = req.params.ticker;
  if (!validarTicker(tickerRaw)) {
    return res.status(400).json({ erro: 'TICKER_INVALIDO', mensagem: 'Ticker deve seguir ^[A-Z]{4}11$' });
  }
  const ticker = String(tickerRaw).toUpperCase();
  const db = req.db || req.app.locals.db;
  if (!db) return res.status(500).json({ erro: 'DB_NAO_DISPONIVEL' });

  const row = db.prepare(
    `SELECT id, ticker, tipo, p_vp, vp_cota, dy_12m, dy_24m, preco_teto,
            pvp_medio_segmento, dy_medio_segmento, pl_medio_segmento, vpa_medio_segmento,
            peer_grupo_nome, peer_grupo_tipo, peer_fonte, peer_atualizado_em,
            ativo
     FROM ativos WHERE ticker = ?`
  ).get(ticker);
  if (!row) {
    return res.status(404).json({ erro: 'ATIVO_NAO_ENCONTRADO', ticker });
  }
  if (row.tipo !== 'FII') {
    return res.status(404).json({ erro: 'ATIVO_NAO_FII', ticker, tipo: row.tipo });
  }

  const cfg = getPeerConfig(db);

  if (!Number.isFinite(row.pvp_medio_segmento) || !Number.isFinite(row.dy_medio_segmento)
      || !Number.isFinite(row.vpa_medio_segmento)) {
    return res.json({
      ticker,
      estado: 'SEM_DADOS',
      mensagem: 'Benchmark ainda não extraído para este FII.',
      grupo: { nome: row.peer_grupo_nome, tipo: row.peer_grupo_tipo, fonte: row.peer_fonte, atualizado_em: row.peer_atualizado_em },
      schema: '1.7'
    });
  }

  const calc = calcularPeerParaAtivo(row, cfg);

  return res.json({
    ticker,
    estado: calc.vencido ? 'DESATUALIZADO' : 'OK',
    schema: '1.7',
    grupo: {
      nome: row.peer_grupo_nome,
      tipo: row.peer_grupo_tipo,
      fonte: row.peer_fonte,
      atualizado_em: row.peer_atualizado_em,
      validade_horas: cfg.validade_horas,
      desatualizado: calc.vencido
    },
    pvp: calc.pvp,
    dy_12m: calc.dy,
    vpa: calc.vpa,
    classificacao: calc.classificacao,
    motivo: calc.motivo,
    preco_referencia_peer: calc.preco_referencia_peer,
    preco_teto_efetivo: calc.preco_teto_efetivo,
    regra_limitante: calc.regra_limitante,
    benchmark_aplicado: calc.benchmark_aplicado,
    multiplicador_peer: calc.multiplicador_peer
  });
});

// ============================================================================
// POST /api/dashboard/rebalanceamento
// Body: { "aporte": number }
// ============================================================================
rebalanceamentoRouter.post('/rebalanceamento', (req, res) => {
  const body = req.body || {};
  const aporte = Number(body.aporte);
  if (!Number.isFinite(aporte) || aporte <= 0) {
    return res.status(400).json({
      erro: 'APORTE_INVALIDO',
      mensagem: 'Aporte deve ser número finito > 0'
    });
  }

  const db = req.db || req.app.locals.db;
  if (!db) return res.status(500).json({ erro: 'DB_NAO_DISPONIVEL' });

  const cfg = getPeerConfig(db);

  // Patrimônio atual = soma(quantidade × cotação_atual) das posições abertas.
  // Usamos a cotação mais recente da tabela cotacoes por ativo.
  const patrimonioRow = db.prepare(`
    SELECT COALESCE(SUM(l.quantidade * COALESCE(
      (SELECT c.preco FROM cotacoes c WHERE c.ativo_id = a.id ORDER BY c.data DESC, c.id DESC LIMIT 1),
      0
    )), 0) AS total
    FROM ativos a
    JOIN lancamentos l ON l.ativo_id = a.id
    WHERE a.ativo = 1
  `).get();
  const patrimonioAtual = patrimonioRow ? Number(patrimonioRow.total) : 0;

  // Buscar FIIs ativos com cotação.
  const ativos = db.prepare(`
    SELECT
      a.ticker, a.tipo, a.p_vp, a.vp_cota, a.dy_12m,
      a.pvp_medio_segmento, a.dy_medio_segmento, a.vpa_medio_segmento,
      a.peer_grupo_nome, a.peer_grupo_tipo, a.peer_atualizado_em,
      a.preco_teto, a.alvo_pct_carteira, a.ativo,
      (SELECT COALESCE(SUM(l.quantidade), 0) FROM lancamentos l
        WHERE l.ativo_id = a.id AND l.tipo = 'COMPRA')
      - (SELECT COALESCE(SUM(l.quantidade), 0) FROM lancamentos l
        WHERE l.ativo_id = a.id AND l.tipo = 'VENDA') AS saldo_atual,
      (SELECT c.preco FROM cotacoes c WHERE c.ativo_id = a.id
        ORDER BY c.data DESC, c.id DESC LIMIT 1) AS cotacao
    FROM ativos a
    WHERE a.tipo = 'FII' AND a.ativo = 1
  `).all();

  // Calcular classificação para cada FII.
  const ativosEnriquecidos = ativos.map(a => {
    const cls = peer.classificarPeer({
      pvp_desvio_pct: (() => {
        const r = peer.calcularPvpVsPeer(a.p_vp, a.pvp_medio_segmento);
        return r && r.desvio_pct;
      })(),
      dy_desvio_pct: (() => {
        const r = peer.calcularDyVsPeer(a.dy_12m, a.dy_medio_segmento);
        return r && r.desvio_pct;
      })()
    }, { desvio_neutro_pct: cfg.desvio_neutro_pct, dy_desfavoravel_pct: cfg.dy_desfavoravel_pct });
    return { ...a, classificacao: cls.classificacao };
  });

  const resultado = peer.simularRebalanceamento({
    aporte,
    patrimonio_atual: patrimonioAtual,
    ativos: ativosEnriquecidos
  });

  return res.json({
    schema: '1.7',
    configuracao: cfg,
    ...resultado
  });
});

module.exports = {
  comparativoRouter,
  rebalanceamentoRouter,
  calcularPeerParaAtivo,
  getPeerConfig
};