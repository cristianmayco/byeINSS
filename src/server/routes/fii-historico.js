// Rotas REST do histórico de dividendos (PRD 01).
//  - GET /api/fii-historico/:ticker        — histórico paginado + métricas + sinais
//  - POST /api/fii-historico/:ticker/importar — endpoint que recebe linhas
//                                              do scraper Electron e delega
//                                              ao importarHistoricoDividendos

const express = require('express');
const router = express.Router();

const {
  calcularDYRealizado12M,
  calcularDYSustentavel,
  classificarSinais,
  resumirCadencia
} = require('../../shared/dividendos-hist.js');
const { importarHistoricoDividendos } = require('../../shared/dividendos-import.js');

const TICKER_RE = /^[A-Z]{4}\d{1,2}$/;

function parseTicker(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim().toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

function parsePaginacao(req) {
  const pagina = Math.max(1, parseInt(req.query.pagina || '1', 10) || 1);
  const tamanho = Math.min(200, Math.max(1, parseInt(req.query.tamanhoPagina || '100', 10) || 100));
  return { pagina, tamanho, offset: (pagina - 1) * tamanho };
}

function parseCotacaoReferencia(db, ativoId, hoje) {
  // Cotação mais recente com data <= hoje
  const r = db.prepare(`
    SELECT preco, data FROM cotacoes
    WHERE ativo_id = ? AND data <= ?
    ORDER BY data DESC LIMIT 1
  `).get(ativoId, hoje);
  return r ? Number(r.preco) : null;
}

function carregarHistorico(db, ativoId, paginacao, status) {
  const filtrosStatus = status ? `AND status = ?` : '';
  const params = status ? [ativoId, status, paginacao.tamanho, paginacao.offset]
    : [ativoId, paginacao.tamanho, paginacao.offset];
  const rows = db.prepare(`
    SELECT p.id, p.ativo_id, p.data_com, p.data_pagto, p.valor_por_cota, p.tipo,
           p.competencia, p.precisao_data, p.status, p.fonte, p.origem_chave,
           p.created_at, p.updated_at,
           (SELECT SUM(CASE WHEN tipo='COMPRA' THEN quantidade ELSE -quantidade END)
            FROM lancamentos WHERE ativo_id = p.ativo_id AND data <= COALESCE(p.data_com, p.data_pagto)) AS qtd_elegivel
    FROM proventos p
    WHERE p.ativo_id = ? ${filtrosStatus}
    ORDER BY p.competencia DESC, p.data_pagto DESC, p.id DESC
    LIMIT ? OFFSET ?
  `).all(...params);
  const total = db.prepare(
    `SELECT COUNT(*) AS c FROM proventos WHERE ativo_id = ? ${filtrosStatus ? 'AND status = ?' : ''}`
  ).get(...(status ? [ativoId, status] : [ativoId])).c;
  return { rows, total };
}

function calcularSinaisPorSerie(provs, dy5a) {
  // Constrói série mensal (valor total distribuído por competência),
  // ignora AMORTIZACAO/BONIFICACAO para os sinais de renda recorrente.
  const map = new Map();
  for (const p of provs) {
    if (p.tipo !== 'DIVIDENDO' && p.tipo !== 'RENDIMENTO') continue;
    if (p.status === 'AGENDADO') continue;
    map.set(p.competencia, (map.get(p.competencia) || 0) + p.valor_por_cota);
  }
  const serie = [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([competencia, valor]) => ({ competencia, valor }));
  // classificarSinais precisa de serieRecente + baseAnterior.
  // Calcula base como média dos 12 anteriores (rolling) se >=12 itens;
  // divisor é o tamanho EFETIVO do slice para evitar base subdimensionada
  // em janelas de 13-23 (bug fix code review).
  const serieRecente = serie.slice(-12);
  let baseAnterior = null;
  if (serie.length > 12) {
    const janelaBase = serie.slice(-24, -12);
    if (janelaBase.length > 0) {
      baseAnterior = janelaBase.reduce((s, m) => s + m.valor, 0) / janelaBase.length;
    }
  }
  const r = classificarSinais({ serieRecente, baseAnterior: baseAnterior ?? serie[0]?.valor, limitePct: 15 });
  // Cada sinal carrega o estado do classificador até aquele ponto — útil
  // para a UI renderizar marcadores ao longo do tempo.
  const estadoPorPosicao = [];
  let consecQueda = 0, consecAlta = 0;
  for (let i = 0; i < r.variacoes.length; i++) {
    const v = r.variacoes[i];
    if (v.direcao === 'QUEDA') { consecQueda++; consecAlta = 0; }
    else if (v.direcao === 'ALTA') { consecAlta++; consecQueda = 0; }
    else { consecQueda = 0; consecAlta = 0; }
    let estado = 'ESTAVEL';
    if (consecQueda >= 2) estado = 'CORTE_CONFIRMADO';
    else if (consecAlta >= 2) estado = 'AUMENTO_CONFIRMADO';
    else if (consecQueda === 1 || consecAlta === 1) estado = 'EM_OBSERVACAO';
    estadoPorPosicao.push(estado);
  }
  return {
    sinais: r.variacoes.map((v, i) => ({
      competencia: v.competencia,
      variacao_pct: v.variacao_pct,
      direcao: v.direcao,
      estado: estadoPorPosicao[i]
    })),
    estado_atual: r.estado,
    direcao_atual: r.direcao
  };
}

function compararComDy5a(dyRealizadoPct, dy5a) {
  if (dyRealizadoPct == null || dy5a == null || dy5a <= 0) {
    return { razao: null, diferenca_pp: null, classificacao: 'INDISPONIVEL' };
  }
  const razao = dyRealizadoPct / dy5a;
  const diferenca_pp = dyRealizadoPct - dy5a;
  let classificacao = 'EM_LINHA';
  if (razao > 1.05) classificacao = 'ACIMA_DA_MEDIA';
  else if (razao < 0.95) classificacao = 'ABAIXO_DA_MEDIA';
  return { razao, diferenca_pp, classificacao };
}

function syncStatus(db, ativoId) {
  const r = db.prepare(`
    SELECT ultimo_status, ultimo_ts, ultimo_total_lido, ultimo_inseridos,
           ultimo_atualizados, ultimo_duplicados, ultimo_conflitos,
           primeira_competencia, ultima_competencia, cobertura_completa, erro
    FROM fii_dividendos_sync WHERE ativo_id = ?
  `).get(ativoId);
  return r || null;
}

// GET /api/fii-historico/:ticker
router.get('/:ticker', (req, res) => {
  try {
    const ticker = parseTicker(req.params.ticker);
    if (!ticker) return res.status(400).json({ error: 'Ticker inválido (esperado 4 letras + 1-2 dígitos)' });
    const ativo = req.db.prepare(
      "SELECT id, ticker, tipo, dy_medio_5a, preco_teto FROM ativos WHERE ticker = ?"
    ).get(ticker);
    if (!ativo) return res.status(404).json({ error: 'Ativo não encontrado' });

    const paginacao = parsePaginacao(req);
    const incluirAgendado = String(req.query.incluirAgendado || '').toLowerCase() === 'true';
    const statusFiltro = incluirAgendado ? null : 'PAGO';
    const { rows, total } = carregarHistorico(req.db, ativo.id, paginacao, statusFiltro);

    const hoje = req.query.hoje || new Date().toISOString().slice(0, 10);
    const cotacao = parseCotacaoReferencia(req.db, ativo.id, hoje);

    // Para métricas: pegar TODOS os PAGOS dos últimos 36 meses (não só a página).
    const provsMetricas = req.db.prepare(`
      SELECT id, data_com, data_pagto, valor_por_cota, tipo, status, competencia
      FROM proventos
      WHERE ativo_id = ? AND status = 'PAGO' AND competencia >= strftime('%Y-%m', date(?, '-36 months'))
        AND tipo IN ('DIVIDENDO','RENDIMENTO','BONIFICACAO','AMORTIZACAO')
    `).all(ativo.id, hoje);

    const dyRealizado = calcularDYRealizado12M({
      proventos: provsMetricas, cotacao, hoje, janelaMeses: 12
    });
    const dySustentavel = calcularDYSustentavel({
      proventos: provsMetricas, cotacao, hoje
    });
    const cadencia = resumirCadencia({ proventos: provsMetricas, hoje });
    const sinais = calcularSinaisPorSerie(provsMetricas, ativo.dy_medio_5a);
    const comparacao = compararComDy5a(dyRealizado.dy_pct, ativo.dy_medio_5a);

    res.json({
      ticker: ativo.ticker,
      dy_medio_5a: ativo.dy_medio_5a,
      cotacao_referencia: cotacao,
      data_referencia: hoje,
      paginacao: { pagina: paginacao.pagina, tamanho: paginacao.tamanho, total },
      total_registros: total,
      historico: rows.map(r => ({
        id: r.id, competencia: r.competencia, data_com: r.data_com,
        data_pagto: r.data_pagto, valor_por_cota: r.valor_por_cota,
        tipo: r.tipo, status: r.status, fonte: r.fonte,
        quantidade_elegivel: r.qtd_elegivel || 0,
        valor_total: (r.valor_por_cota || 0) * (r.qtd_elegivel || 0),
        origem_chave: r.origem_chave
      })),
      metricas: {
        dy_realizado_12m: dyRealizado.dy_pct,
        cobertura_meses: dyRealizado.cobertura_meses,
        ultima_competencia_paga: dyRealizado.ultima_competencia,
        indisponivel_motivo: dyRealizado.indisponivel_motivo,
        dy_sustentavel_mensal: dySustentavel.valor_mensal,
        dy_sustentavel_pct: dySustentavel.dy_pct,
        dy_sustentavel_confianca: dySustentavel.confianca,
        cadencia: cadencia.cadencia,
        meses_pagantes_12m: cadencia.meses_pagantes
      },
      comparacao_5a: comparacao,
      sinais: sinais.sinais,
      estado_atual: sinais.estado_atual,
      direcao_atual: sinais.direcao_atual,
      sync_status: syncStatus(req.db, ativo.id)
    });
  } catch (e) {
    console.error('[fii-historico] GET error:', e);
    res.status(500).json({ error: 'Erro ao buscar histórico' });
  }
});

// POST /api/fii-historico/:ticker/importar
router.post('/:ticker/importar', (req, res) => {
  const ticker = parseTicker(req.params.ticker);
  if (!ticker) return res.status(400).json({ error: 'Ticker inválido' });
  const ativo = req.db.prepare('SELECT id FROM ativos WHERE ticker = ?').get(ticker);
  if (!ativo) return res.status(404).json({ error: 'Ativo não encontrado' });

  const rows = req.body && Array.isArray(req.body.rows) ? req.body.rows : null;
  if (!rows) return res.status(400).json({ error: '`rows` deve ser um array' });

  const result = importarHistoricoDividendos(req.db, rows);
  res.json({
    ticker,
    ativo_id: ativo.id,
    ...result
  });
});

module.exports = router;