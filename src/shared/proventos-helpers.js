// Helpers puros (testáveis sem DB) para agregação e projeção de proventos.
// PRD 03 — RF-014 a RF-019, RF-022, RF-024.
// Dual-mode: CJS (require) e ESM (import).

/**
 * Calcula a quantidade elegível no momento de um provento.
 * RF-015: usa posição na data_com; se não houver lançamentos até lá,
 * usa a posição na data_pagto.
 */
function calcularQuantidadeElegivel(lancamentos, data_com, data_pagto) {
  const posNaCom = calcularPosicaoEmData(lancamentos, data_com);
  if (posNaCom > 0) return posNaCom;
  return Math.max(0, calcularPosicaoEmData(lancamentos, data_pagto));
}

function calcularPosicaoEmData(lancamentos, dataISO) {
  let total = 0;
  for (const l of (lancamentos || [])) {
    if (l.data <= dataISO) {
      total += l.tipo === 'COMPRA' ? Number(l.quantidade) : -Number(l.quantidade);
    }
  }
  return Math.max(0, total);
}

/**
 * Agrega proventos por mês com separação por tipo.
 * RF-014 (gráfico mensal empilhado), RF-016 (distribuíveis vs amortizações).
 */
function agregarProventosMensais(proventos, periodo) {
  const inicio = (periodo && periodo.inicio) || '0000-00-00';
  const fim = (periodo && periodo.fim) || '9999-12-31';
  const acc = new Map();
  for (const p of (proventos || [])) {
    if (!p.data_pagto || p.data_pagto < inicio || p.data_pagto > fim) continue;
    const mes = String(p.data_pagto).slice(0, 7);
    if (!acc.has(mes)) {
      acc.set(mes, {
        mes,
        por_tipo: { DIVIDENDO: 0, RENDIMENTO: 0, AMORTIZACAO: 0, BONIFICACAO: 0 },
        distribuiveis: 0,
        amortizacoes: 0,
        bonificacoes: 0,
        total_caixa: 0
      });
    }
    const bucket = acc.get(mes);
    const valor = Number(p.valor_por_cota || 0) * Number(p.quantidade_elegivel || 0);
    const tipo = String(p.tipo || '').toUpperCase();
    if (!(tipo in bucket.por_tipo)) continue;
    bucket.por_tipo[tipo] += valor;
    if (tipo === 'DIVIDENDO' || tipo === 'RENDIMENTO') {
      bucket.distribuiveis += valor;
      bucket.total_caixa += valor;
    } else if (tipo === 'AMORTIZACAO') {
      bucket.amortizacoes += valor;
      bucket.total_caixa += valor;
    } else if (tipo === 'BONIFICACAO') {
      bucket.bonificacoes += valor;
    }
  }
  return [...acc.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}

/**
 * Projeção anual de proventos para os próximos N meses.
 * RF-017 (último DIVIDENDO/RENDIMENTO × 12), RF-018 (amortizações futuras
 * explícitas), RF-019 (DY distribuível), RF-024 (sem base recorrente).
 */
function calcularProjecao(proventos, ativos, opts) {
  const hoje = (opts && opts.hoje) || new Date().toISOString().slice(0, 10);
  const lookaheadMonths = (opts && opts.lookaheadMonths) || 12;
  const cutoff = adicionarMeses(hoje, lookaheadMonths);

  const ultimoDistribuivel = new Map();
  for (const p of (proventos || [])) {
    if (p.tipo !== 'DIVIDENDO' && p.tipo !== 'RENDIMENTO') continue;
    const cur = ultimoDistribuivel.get(p.ticker);
    if (!cur || p.data_pagto > cur.data_pagto) {
      ultimoDistribuivel.set(p.ticker, { valor_por_cota: Number(p.valor_por_cota), data_pagto: p.data_pagto });
    }
  }

  const amortizacoesFuturas = (proventos || []).filter(
    p => p.tipo === 'AMORTIZACAO' && p.data_pagto >= hoje && p.data_pagto <= cutoff
  );

  let total_distribuivel_mensal = 0;
  let total_distribuivel_anual = 0;
  let patrimonio = 0;
  const detalhes = [];
  for (const a of (ativos || [])) {
    const qtd = Number(a.qtd || 0);
    const preco = Number(a.preco_atual || 0);
    patrimonio += qtd * preco;
    const ud = ultimoDistribuivel.get(a.ticker);
    let mensal_distribuivel = 0, anual_distribuivel = 0;
    let dy_anual_distribuivel = 0;
    let sem_base_recorrente = false;
    let desatualizado = false;
    let ultimo_distribuivel_por_cota = 0;
    let ultimo_pagto_distribuivel = null;
    if (ud) {
      ultimo_distribuivel_por_cota = ud.valor_por_cota;
      ultimo_pagto_distribuivel = ud.data_pagto;
      mensal_distribuivel = qtd * ud.valor_por_cota;
      anual_distribuivel = mensal_distribuivel * 12;
      dy_anual_distribuivel = (qtd * preco) > 0 ? (anual_distribuivel / (qtd * preco)) * 100 : 0;
      desatualizado = diasEntre(ud.data_pagto, hoje) > 90;
    } else {
      sem_base_recorrente = true;
    }
    detalhes.push({
      ticker: a.ticker,
      qtd,
      preco_atual: preco,
      ultimo_distribuivel_por_cota,
      ultimo_pagto_distribuivel,
      mensal_distribuivel,
      anual_distribuivel,
      dy_anual_distribuivel,
      desatualizado,
      sem_base_recorrente
    });
    total_distribuivel_mensal += mensal_distribuivel;
    total_distribuivel_anual += anual_distribuivel;
  }
  detalhes.sort((a, b) => b.mensal_distribuivel - a.mensal_distribuivel);

  const mapQty = new Map((ativos || []).map(a => [a.ticker, Number(a.qtd || 0)]));
  const amortizacoes_previstas = amortizacoesFuturas.map(p => {
    const quantidade_estimada = mapQty.get(p.ticker) || 0;
    return {
      ticker: p.ticker,
      data_com: p.data_com || null,
      data_pagto: p.data_pagto,
      valor_por_cota: Number(p.valor_por_cota),
      quantidade_estimada,
      valor_total_estimado: quantidade_estimada * Number(p.valor_por_cota)
    };
  });
  const total_amortizacoes_previstas = amortizacoes_previstas
    .reduce((s, a) => s + (Number(a.valor_total_estimado) || 0), 0);

  const dy_carteira_distribuivel = patrimonio > 0
    ? (total_distribuivel_anual / patrimonio) * 100
    : 0;

  return {
    total_distribuivel_mensal,
    total_distribuivel_anual,
    total_amortizacoes_previstas,
    dy_carteira_distribuivel,
    total_mensal: total_distribuivel_mensal,
    total_anual: total_distribuivel_anual,
    detalhes,
    amortizacoes_previstas
  };
}

function adicionarMeses(isoDate, meses) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d.toISOString().slice(0, 10);
}

function diasEntre(iso1, iso2) {
  const d1 = new Date(iso1 + 'T00:00:00Z').getTime();
  const d2 = new Date(iso2 + 'T00:00:00Z').getTime();
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

module.exports = {
  calcularQuantidadeElegivel,
  agregarProventosMensais,
  calcularProjecao
};
