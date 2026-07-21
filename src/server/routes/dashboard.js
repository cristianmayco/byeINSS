const express = require('express');
const router = express.Router();

const {
  agregarProventosMensais,
  calcularProjecao
} = require('../../shared/proventos-helpers.js');

const TIPOS_VALIDOS_DASH = new Set(['DIVIDENDO', 'RENDIMENTO', 'BONIFICACAO', 'AMORTIZACAO']);

function parseTiposDash(q) {
  if (!q) return null;
  const arr = String(q).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (arr.length === 0) return null;
  for (const t of arr) {
    if (!TIPOS_VALIDOS_DASH.has(t)) {
      const err = new Error(`Tipo inválido: ${t}`); err.status = 400; throw err;
    }
  }
  return arr;
}

function isoDateDash(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

// Resumo geral
router.get('/resumo', (req, res) => {
  const db = req.db;
  const posicoes = db.prepare(`
    SELECT
      a.id, a.ticker, a.tipo, a.segmento, a.nota, a.dy_minimo, a.preco_teto, a.preco_muito_bom, a.alvo_pct_carteira,
      (SELECT preco FROM cotacoes WHERE ativo_id = a.id ORDER BY data DESC LIMIT 1) AS preco_atual,
      (SELECT SUM(CASE WHEN tipo='COMPRA' THEN quantidade ELSE -quantidade END) FROM lancamentos WHERE ativo_id = a.id) AS qtd,
      (SELECT SUM(CASE WHEN tipo='COMPRA' THEN quantidade*preco + IFNULL(taxa,0) ELSE 0 END) /
              NULLIF(SUM(CASE WHEN tipo='COMPRA' THEN quantidade ELSE 0 END), 0)
       FROM lancamentos WHERE ativo_id = a.id) AS preco_medio
    FROM ativos a WHERE a.ativo = 1
  `).all();

  let patrimonio = 0, valor_investido = 0;
  const posicoesProcessadas = posicoes.map(p => {
    const qtd = Number(p.qtd || 0);
    const pm = Number(p.preco_medio || 0);
    const pa = Number(p.preco_atual || 0);
    const investido = qtd * pm;
    const saldo = qtd * pa;
    const variacao = saldo - investido;
    const variacaoPct = investido > 0 ? (variacao / investido) * 100 : 0;
    patrimonio += saldo;
    valor_investido += investido;
    return {
      ...p,
      qtd, preco_medio: pm, preco_atual: pa,
      investido, saldo, variacao, variacao_pct: variacaoPct
    };
  }).filter(p => p.qtd > 0);

  // % carteira
  posicoesProcessadas.forEach(p => {
    p.pct_carteira = patrimonio > 0 ? (p.saldo / patrimonio) * 100 : 0;
    p.desvio_ideal = (p.alvo_pct_carteira || 1.76) - p.pct_carteira;  // positivo = abaixo do ideal
  });

  // Por tipo
  const porTipo = {};
  posicoesProcessadas.forEach(p => {
    porTipo[p.tipo] = (porTipo[p.tipo] || 0) + p.saldo;
  });

  // Proventos 12M — RF-019/020: só DIVIDENDO + RENDIMENTO no numerador
  // do DY distribuível. Amortizações são reportadas em campo separado.
  const proventosDistr12m = db.prepare(`
    SELECT SUM(p.valor_por_cota * COALESCE(
      (SELECT SUM(CASE WHEN tipo='COMPRA' THEN quantidade ELSE -quantidade END)
       FROM lancamentos WHERE ativo_id = p.ativo_id AND data <= p.data_pagto), 0)) AS total
    FROM proventos p
    WHERE date(p.data_pagto) >= date('now', '-12 months')
      AND p.tipo IN ('DIVIDENDO','RENDIMENTO')
  `).get();
  const proventosAmort12m = db.prepare(`
    SELECT SUM(p.valor_por_cota * COALESCE(
      (SELECT SUM(CASE WHEN tipo='COMPRA' THEN quantidade ELSE -quantidade END)
       FROM lancamentos WHERE ativo_id = p.ativo_id AND data <= p.data_pagto), 0)) AS total
    FROM proventos p
    WHERE date(p.data_pagto) >= date('now', '-12 months')
      AND p.tipo = 'AMORTIZACAO'
  `).get();
  const proventosFluxo12m = db.prepare(`
    SELECT SUM(p.valor_por_cota * COALESCE(
      (SELECT SUM(CASE WHEN tipo='COMPRA' THEN quantidade ELSE -quantidade END)
       FROM lancamentos WHERE ativo_id = p.ativo_id AND data <= p.data_pagto), 0)) AS total
    FROM proventos p
    WHERE date(p.data_pagto) >= date('now', '-12 months')
      AND p.tipo IN ('DIVIDENDO','RENDIMENTO','AMORTIZACAO')
  `).get();
  const proventosTotal = db.prepare(`
    SELECT
      SUM(valor_por_cota) AS total,
      SUM(CASE WHEN tipo='AMORTIZACAO' THEN valor_por_cota ELSE 0 END) AS amortizacoes_total
    FROM proventos
  `).get();

  const totalProventos12m = Number(proventosDistr12m?.total || 0);
  const totalAmort12m = Number(proventosAmort12m?.total || 0);
  const totalFluxo12m = Number(proventosFluxo12m?.total || 0);
  const dy12m = patrimonio > 0 ? (totalProventos12m / patrimonio) * 100 : 0;

  res.json({
    patrimonio,
    valor_investido,
    ganho_capital: patrimonio - valor_investido,
    variacao_pct: valor_investido > 0 ? ((patrimonio - valor_investido) / valor_investido) * 100 : 0,
    proventos_12m: totalProventos12m,                    // legado = distribuíveis
    dy_carteira_12m: dy12m,                              // legado = DY distribuível
    amortizacoes_12m: totalAmort12m,                     // novo (RF-020)
    fluxo_caixa_proventos_12m: totalFluxo12m,            // novo (RF-020)
    proventos_total: Number(proventosTotal?.total || 0),
    amortizacoes_total: Number(proventosTotal?.amortizacoes_total || 0),
    por_tipo: porTipo,
    posicoes: posicoesProcessadas
  });
});

// Proventos por mês (últimos 12 meses por padrão).
// RF-014/016: separa DIVIDENDO+RENDIMENTO (distribuíveis) de AMORTIZACAO e BONIFICACAO.
// Aceita ?inicio=YYYY-MM-DD&fim=YYYY-MM-DD&tipos=DIVIDENDO,AMORTIZACAO
router.get('/proventos-mensais', (req, res) => {
  try {
    const tipos = parseTiposDash(req.query.tipos);
    let inicio = req.query.inicio;
    let fim = req.query.fim;
    if (inicio && !isoDateDash(inicio)) {
      return res.status(400).json({ error: 'inicio deve ser ISO YYYY-MM-DD' });
    }
    if (fim && !isoDateDash(fim)) {
      return res.status(400).json({ error: 'fim deve ser ISO YYYY-MM-DD' });
    }
    if (!inicio || !fim) {
      const db = req.db;
      // Default: últimos 12 meses
      const twelve = db.prepare("SELECT date('now','-12 months') AS d").get();
      const today = db.prepare("SELECT date('now') AS d").get();
      inicio = inicio || twelve.d;
      fim = fim || today.d;
    }

    const db = req.db;
    const provsRows = db.prepare(`
      SELECT p.id, p.ativo_id, a.ticker, p.data_pagto, p.valor_por_cota, p.tipo
      FROM proventos p
      JOIN ativos a ON a.id = p.ativo_id
      WHERE p.data_pagto >= ? AND p.data_pagto <= ?
      ${tipos ? `AND p.tipo IN (${tipos.map(() => '?').join(',')})` : ''}
    `).all(...(tipos ? [inicio, fim, ...tipos] : [inicio, fim]));

    // Quantidade elegível por linha
    const lancCache = new Map();
    const getLanc = (id) => {
      if (!lancCache.has(id)) {
        lancCache.set(id, db.prepare(`
          SELECT data, tipo, quantidade FROM lancamentos WHERE ativo_id = ? ORDER BY data
        `).all(id));
      }
      return lancCache.get(id);
    };
    const enriched = provsRows.map(p => ({
      ticker: p.ticker, ativo_id: p.ativo_id, data_pagto: p.data_pagto,
      valor_por_cota: p.valor_por_cota,
      tipo: p.tipo,
      // Deferimos o cálculo ao helper (uma única passada pelas posições).
      quantidade_elegivel: 0  // será sobrescrito abaixo
    }));
    // Calcula quantidade elegível para cada item usando helper
    const { calcularQuantidadeElegivel } = require('../../shared/proventos-helpers.js');
    enriched.forEach((p, i) => {
      const original = provsRows[i];
      const qtd = calcularQuantidadeElegivel(getLanc(p.ativo_id), null, p.data_pagto);
      p.quantidade_elegivel = qtd;
    });
    const serie = agregarProventosMensais(enriched, { inicio, fim });
    res.json(serie);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

// Projeção anual de proventos (RF-017/018/024).
// Aceita ?hoje=YYYY-MM-DD (default = hoje).
router.get('/projecao-proventos', (req, res) => {
  try {
    const db = req.db;
    const hoje = (req.query.hoje && isoDateDash(req.query.hoje))
      ? req.query.hoje
      : new Date().toISOString().slice(0, 10);

    // Ativos com posição aberta + cotação atual
    const ativos = db.prepare(`
      SELECT a.id, a.ticker, a.tipo,
             (SELECT preco FROM cotacoes WHERE ativo_id = a.id ORDER BY data DESC LIMIT 1) AS preco_atual,
             (SELECT SUM(CASE WHEN tipo='COMPRA' THEN quantidade ELSE -quantidade END)
              FROM lancamentos WHERE ativo_id = a.id) AS qtd
      FROM ativos a WHERE a.ativo = 1
    `).all();
    const ativosForProj = ativos
      .map(a => ({ ticker: a.ticker, qtd: Number(a.qtd || 0), preco_atual: Number(a.preco_atual || 0) }))
      .filter(a => a.qtd > 0);

    // Histórico de proventos últimos 24 meses + futuras explícitas
    const provsRows = db.prepare(`
      SELECT p.ativo_id, a.ticker, p.data_com, p.data_pagto, p.valor_por_cota, p.tipo
      FROM proventos p JOIN ativos a ON a.id = p.ativo_id
      WHERE p.data_pagto >= date(?, '-24 months')
    `).all(hoje);

    const provsForProj = provsRows.map(p => ({
      ticker: p.ticker,
      data_com: p.data_com,
      data_pagto: p.data_pagto,
      valor_por_cota: Number(p.valor_por_cota),
      tipo: p.tipo
    }));

    const result = calcularProjecao(provsForProj, ativosForProj, { hoje, lookaheadMonths: 12 });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || 'erro de cálculo' });
  }
});

// Evolução patrimonial (soma das cotações × qtd por mês)
router.get('/evolucao', (req, res) => {
  const db = req.db;
  // Para cada mês nos últimos 12, soma (qtd_naquele_mês × última cotação até aquele mês)
  const meses = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    meses.push(d.toISOString().slice(0,7));
  }
  const serie = meses.map(mes => {
    const dt = `${mes}-28`;
    const total = db.prepare(`
      SELECT SUM(
        COALESCE((SELECT SUM(CASE WHEN tipo='COMPRA' THEN quantidade ELSE -quantidade END)
                  FROM lancamentos WHERE ativo_id = a.id AND data <= ?), 0)
        * COALESCE((SELECT preco FROM cotacoes WHERE ativo_id = a.id AND data <= ? ORDER BY data DESC LIMIT 1), 0)
      ) AS patrimonio,
      SUM(
        COALESCE((SELECT SUM(CASE WHEN tipo='COMPRA' THEN quantidade ELSE -quantidade END)
                  FROM lancamentos WHERE ativo_id = a.id AND data <= ?), 0)
        * COALESCE((SELECT SUM(CASE WHEN tipo='COMPRA' THEN preco ELSE 0 END * CASE WHEN tipo='COMPRA' THEN quantidade ELSE -quantidade END)
                  FROM lancamentos WHERE ativo_id = a.id AND data <= ?), 0)
        / NULLIF((SELECT SUM(CASE WHEN tipo='COMPRA' THEN quantidade ELSE 0 END) FROM lancamentos WHERE ativo_id = a.id AND data <= ?), 0)
      ) AS investido
      FROM ativos a WHERE a.ativo = 1
    `).get(dt, dt, dt, dt, dt);
    return { mes, patrimonio: total?.patrimonio || 0, investido: total?.investido || 0 };
  });
  res.json(serie);
});

// Alertas
router.get('/alertas', (req, res) => {
  const db = req.db;
  const cfg = db.prepare('SELECT * FROM config').all().reduce((acc, r) => (acc[r.chave] = r.valor, acc), {});
  const dyLimite = Number(cfg.alerta_dy_limite || 15);
  const concLimite = Number(cfg.alerta_concentracao_pct || 10);

  const posicoes = db.prepare(`
    SELECT a.id, a.ticker, a.dy_minimo, a.preco_teto, a.preco_muito_bom, a.alvo_pct_carteira,
      (SELECT preco FROM cotacoes WHERE ativo_id = a.id ORDER BY data DESC LIMIT 1) AS preco_atual,
      (SELECT SUM(CASE WHEN tipo='COMPRA' THEN quantidade ELSE -quantidade END) FROM lancamentos WHERE ativo_id = a.id) AS qtd
    FROM ativos a WHERE a.ativo = 1
  `).all();

  const totalPatrimonio = posicoes.reduce((acc, p) => acc + (Number(p.qtd || 0) * Number(p.preco_atual || 0)), 0);

  const brl = (v) => `R$ ${Number(v).toFixed(2)}`;
  const alertas = [];
  posicoes.forEach(p => {
    const qtd = Number(p.qtd || 0);
    const preco = Number(p.preco_atual || 0);

    // Alerta de preço-teto / oportunidade — para TODOS os FIIs ativos que tenham
    // preço-teto definido e cotação atual, independente de já possuir o ativo
    // (é um sinal de compra e vale tanto para carteira quanto para watchlist).
    if (preco > 0 && p.preco_teto) {
      if (p.preco_muito_bom && preco <= p.preco_muito_bom) {
        alertas.push({ tipo: 'OPORTUNIDADE', ticker: p.ticker, msg: `${p.ticker} MUITO BARATO: ${brl(preco)} ≤ muito bom ${brl(p.preco_muito_bom)}`, valor: preco });
      } else if (preco <= p.preco_teto) {
        alertas.push({ tipo: 'PRECO_TETO', ticker: p.ticker, msg: `${p.ticker} no preço-teto: ${brl(preco)} ≤ teto ${brl(p.preco_teto)}`, valor: preco });
      }
    }

    // Concentração e DY: só fazem sentido para posições efetivamente detidas.
    if (qtd <= 0) return;
    const pct = totalPatrimonio > 0 ? (qtd * p.preco_atual / totalPatrimonio) * 100 : 0;
    if (pct > concLimite) {
      alertas.push({ tipo: 'CONCENTRACAO', ticker: p.ticker, msg: `${p.ticker} está ${pct.toFixed(1)}% da carteira (alvo ${p.alvo_pct_carteira||'—'}%)`, valor: pct });
    }
    // Alerta de DY mensal/12M — RF-019: só DIVIDENDO+RENDIMENTO entram no DY distribuível.
    const ult12m = db.prepare(`
      SELECT COALESCE(SUM(valor_por_cota), 0) AS total
      FROM proventos WHERE ativo_id = ?
      AND date(data_pagto) >= date('now', '-12 months')
      AND tipo IN ('DIVIDENDO','RENDIMENTO')
    `).get(p.id);
    const dy12m = p.preco_atual > 0 ? (Number(ult12m.total) / p.preco_atual * 100) : 0;
    if (dy12m > dyLimite) {
      alertas.push({ tipo: 'DY_ALTO', ticker: p.ticker, msg: `${p.ticker} com DY 12M de ${dy12m.toFixed(1)}% (sinal amarelo — sustentável?)`, valor: dy12m });
    }
  });
  res.json(alertas);
});

// Sinais de preço para cada ativo (usado na página Preço-teto)
router.get('/sinais', (req, res) => {
  const db = req.db;
  const cfg = db.prepare('SELECT * FROM config').all().reduce((acc, r) => (acc[r.chave] = r.valor, acc), {});
  const pctMuitoBarato = Number(cfg.pct_muito_barato || 85);
  const pctBarato = Number(cfg.pct_barato || 100);
  const pctCaro = Number(cfg.pct_caro || 115);

  const ativos = db.prepare(`
    SELECT a.id, a.ticker, a.tipo, a.preco_teto, a.preco_muito_bom, a.dy_minimo,
      (SELECT preco FROM cotacoes WHERE ativo_id = a.id ORDER BY data DESC LIMIT 1) AS preco_atual
    FROM ativos a WHERE a.ativo = 1
  `).all();

  const sinais = ativos.map(a => {
    let sinal = 'SEM_TETO'; // sem preço-teto definido
    let limite = null;
    if (a.preco_teto) {
      const ratio = a.preco_atual ? (a.preco_atual / a.preco_teto * 100) : null;
      limite = ratio;
      if (ratio === null) sinal = 'SEM_PRECO';
      else if (ratio <= pctMuitoBarato) sinal = 'MUITO_BARATO';
      else if (ratio <= pctBarato) sinal = 'BARATO';
      else if (ratio <= pctCaro) sinal = 'CARO';
      else sinal = 'MUITO_CARO';
    }
    return { ...a, ratio_preco_teto: limite, sinal };
  });
  res.json(sinais);
});

// Simulador de aportes (com suporte a reajuste anual)
router.post('/simular', (req, res) => {
  const { aporte_inicial=0, aporte_mensal, meses, taxa_anual=12, reajuste_anual=0 } = req.body;
  if (!meses) return res.status(400).json({ error: 'meses obrigatório' });
  const i = (taxa_anual / 100) / 12;
  let saldo = Number(aporte_inicial);
  let aporte = Number(aporte_mensal || 0);
  const serie = [{ mes: 0, patrimonio: saldo, aporte, aportado: Number(aporte_inicial) }];
  let aportado = Number(aporte_inicial);
  for (let m = 1; m <= meses; m++) {
    // Reajusta no início de cada ano (a partir do mês 13)
    if (reajuste_anual > 0 && m > 1 && ((m - 1) % 12 === 0)) {
      aporte = aporte * (1 + reajuste_anual / 100);
    }
    saldo = saldo * (1 + i) + aporte;
    aportado += aporte;
    if (m % Math.max(1, Math.floor(meses/24)) === 0 || m === meses) {
      serie.push({ mes: m, patrimonio: saldo, aporte, aportado });
    }
  }
  res.json({
    serie,
    patrimonio_final: saldo,
    total_aportado: aportado,
    rendimento: saldo - aportado,
    taxa_anual, meses, aporte_mensal_final: aporte
  });
});

// FIRE: patrimônio necessário para renda X
router.post('/fire', (req, res) => {
  const { renda_mensal_desejada, taxa_anual=12, taxa_retirada=4 } = req.body;
  if (!renda_mensal_desejada) return res.status(400).json({ error: 'renda_mensal_desejada obrigatória' });
  const patrimonio_necessario = (renda_mensal_desejada * 12) / (taxa_retirada / 100);
  // Simular
  const meses = 12 * 30;
  const i = (taxa_anual / 100) / 12;
  let saldo = 0;
  let meses_ate_meta = null;
  const serie = [];
  for (let m = 1; m <= meses; m++) {
    saldo = saldo * (1 + i);
    if (saldo >= patrimonio_necessario && meses_ate_meta === null) {
      meses_ate_meta = m;
    }
    if (m % 12 === 0) serie.push({ ano: m/12, patrimonio: saldo });
  }
  res.json({
    patrimonio_necessario,
    renda_mensal_desejada,
    taxa_retirada,
    taxa_anual,
    meses_ate_meta,
    serie
  });
});

module.exports = router;
