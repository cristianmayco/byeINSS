// src/shared/rebalanceamento-ui.js
//
// Helpers puros para a tela Preço-teto + Simulação de Rebalanceamento (PRD 04).
// Sem dependência de DOM. Testáveis com vitest puro.
//
// Funções públicas:
//   - formatarSinalPreco(atual, teto_efetivo)         → 'MUITO_BARATO'|'NO_TETO'|'CARO'|'SEM_TETO'
//   - formatarLinhaPrecoTeto(ativo, comparativo)       → { sinal, regra_limitante, ... }
//   - formatarSugestaoRebalanceamento(sug)             → string pt-BR para tabela
//   - formatarIgnoradoRebalanceamento(ign)             → string pt-BR para tooltip
//   - formatarCoberturaResumo(cobertura)               → string pt-BR ("18 de 20 FIIs")

'use strict';

const pctConfig = {
  pct_muito_barato: 85.0,  // até 85% do preço-teto = muito barato
  pct_barato: 100.0,        // até 100% = no teto
  pct_caro: 115.0           // até 115% = caro
};

function readPctConfig(cfg = {}) {
  return {
    pct_muito_barato: Number.isFinite(cfg.pct_muito_barato) ? cfg.pct_muito_barato : pctConfig.pct_muito_barato,
    pct_barato: Number.isFinite(cfg.pct_barato) ? cfg.pct_barato : pctConfig.pct_barato,
    pct_caro: Number.isFinite(cfg.pct_caro) ? cfg.pct_caro : pctConfig.pct_caro
  };
}

/**
 * Determina o sinal de preço comparando preço atual vs preço-teto efetivo.
 * Retorna uma das classes canônicas do app.
 */
function classificarSinalPreco(precoAtual, precoTetoEfetivo, cfg = {}) {
  if (!Number.isFinite(precoAtual) || !Number.isFinite(precoTetoEfetivo)) {
    return { sinal: 'SEM_TETO', texto: 'Sem teto', classe: 'sinal-sem-teto' };
  }
  if (precoAtual <= 0 || precoTetoEfetivo <= 0) {
    return { sinal: 'SEM_TETO', texto: 'Sem teto', classe: 'sinal-sem-teto' };
  }
  const pct = (precoAtual / precoTetoEfetivo) * 100;
  const c = readPctConfig(cfg);
  if (pct <= c.pct_muito_barato) {
    return { sinal: 'MUITO_BARATO', texto: 'Muito barato', classe: 'sinal-muito-barato' };
  }
  if (pct <= c.pct_barato) {
    return { sinal: 'NO_TETO', texto: 'No teto', classe: 'sinal-no-teto' };
  }
  if (pct <= c.pct_caro) {
    return { sinal: 'CARO', texto: 'Caro', classe: 'sinal-caro' };
  }
  return { sinal: 'MUITO_CARO', texto: 'Muito caro', classe: 'sinal-muito-caro' };
}

/**
 * Calcula ratio_preco_teto e monta a linha canônica da tela Preço-teto.
 *
 * @param {object} ativo       { preco_atual, preco_teto, vp_cota, pvp_medio_segmento }
 * @param {object} comparativo { preco_teto_efetivo, regra_limitante, benchmark_aplicado, preco_referencia_peer }
 */
function nullableNum(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatarLinhaPrecoTeto(ativo, comparativo, cfg = {}) {
  const precoAtual = nullableNum(ativo && ativo.preco_atual);
  const precoTetoBase = nullableNum(ativo && ativo.preco_teto);
  const precoTetoEfetivo = nullableNum(comparativo && comparativo.preco_teto_efetivo);
  const ref = nullableNum(comparativo && comparativo.preco_referencia_peer);
  const regra = (comparativo && comparativo.regra_limitante) || 'DY_BASE';
  const benchmarkAplicado = !!(comparativo && comparativo.benchmark_aplicado);

  const ratio = (Number.isFinite(precoAtual) && Number.isFinite(precoTetoEfetivo) && precoTetoEfetivo > 0)
    ? Number((precoAtual / precoTetoEfetivo).toFixed(4))
    : null;

  const sinal = classificarSinalPreco(precoAtual, precoTetoEfetivo, cfg);

  return {
    preco_atual: precoAtual,
    preco_teto_base: precoTetoBase,
    preco_referencia_peer: ref,
    preco_teto_efetivo: precoTetoEfetivo,
    regra_limitante: regra,
    benchmark_aplicado: benchmarkAplicado,
    ratio_preco_teto: ratio,
    sinal: sinal.sinal,
    sinal_texto: sinal.texto,
    sinal_classe: sinal.classe
  };
}

/**
 * Formata uma sugestão de compra para a tabela de rebalanceamento.
 */
function formatarSugestaoRebalanceamento(sug) {
  if (!sug || typeof sug !== 'object') return null;
  return {
    ticker: sug.ticker,
    quantidade: sug.quantidade,
    preco_unitario: formatarBRL(sug.preco_unitario),
    valor: formatarBRL(sug.valor),
    gap_alvo_antes: formatarBRL(sug.gap_alvo_antes),
    gap_alvo_depois: formatarBRL(sug.gap_alvo_depois),
    classificacao_peer: sug.classificacao_peer || 'SEM_DADOS',
    multiplicador_peer: Number.isFinite(sug.multiplicador_peer)
      ? Number(sug.multiplicador_peer.toFixed(2)) : null,
    preco_teto_base: formatarBRL(sug.preco_teto_base),
    preco_referencia_peer: formatarBRL(sug.preco_referencia_peer),
    preco_teto_efetivo: formatarBRL(sug.preco_teto_efetivo),
    regra_limitante: sug.regra_limitante || 'DY_BASE',
    benchmark_aplicado: !!sug.benchmark_aplicado
  };
}

const IGNORADO_MOTIVO_TEXTO = {
  SEM_COTACAO: 'Sem cotação',
  SEM_TETO: 'Sem preço-teto',
  ACIMA_DO_TETO: 'Acima do teto',
  SEM_GAP: 'Sem gap para 1 cota',
  PEER_DESATUALIZADO_COM_FALLBACK: 'Benchmark vencido'
};

function formatarIgnoradoRebalanceamento(ign) {
  if (!ign || typeof ign !== 'object') return null;
  return {
    ticker: ign.ticker,
    motivo: ign.motivo,
    motivo_texto: IGNORADO_MOTIVO_TEXTO[ign.motivo] || ign.motivo
  };
}

function formatarCoberturaResumo(cobertura) {
  if (!cobertura || typeof cobertura !== 'object') return null;
  const { total = 0, comBenchmark = 0, semBenchmark = 0 } = cobertura;
  return `${comBenchmark} de ${total} FIIs com benchmark${semBenchmark > 0 ? ` (${semBenchmark} sem)` : ''}`;
}

function formatarBRL(n) {
  if (!Number.isFinite(n)) return null;
  return 'R$ ' + n.toFixed(2).replace('.', ',');
}

module.exports = {
  formatarBRL,
  classificarSinalPreco,
  formatarLinhaPrecoTeto,
  formatarSugestaoRebalanceamento,
  formatarIgnoradoRebalanceamento,
  formatarCoberturaResumo,
  IGNORADO_MOTIVO_TEXTO
};