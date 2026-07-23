// src/shared/peer.js
// Lógica pura do PRD 04 (Comparador vs Média do Segmento):
// desvios percentuais vs peer, classificação, preço-teto efetivo,
// multiplicador de rebalanceamento, simulação. SEM dependência de
// better-sqlite3, Electron ou Express.
//
// Funções públicas:
//   - calcularPvpVsPeer / calcularDyVsPeer / calcularVpaVsPeer (RF-008/009/010)
//   - classificarPeer (RF-011) com precedência do DESFAVORAVEL
//   - precoReferenciaPeer (RF-015)
//   - precoTetoEfetivo (RF-016) — peer nunca eleva o teto base
//   - multiplicadorPeer (RF-021)
//   - mergeSnapshotPeer (whitelist, imutável, null preserva valor válido)
//   - benchmarkVencido (RF-007)
//   - simularRebalanceamento (RF-019..023)

'use strict';

const DEFAULT_DESVIO_NEUTRO_PCT = 5.0;
const DEFAULT_DY_DESFAVORAVEL_PCT = 10.0;
const DEFAULT_VALIDADE_HORAS = 168;
const DEFAULT_MARGEM_TETO_PCT = 0.0;
const DEFAULT_MULT_FAVORAVEL = 1.15;
const DEFAULT_MULT_NEUTRO = 1.0;
const DEFAULT_MULT_DESFAVORAVEL = 0.75;

const PEER_FIELDS = [
  'pvp_medio_segmento',
  'dy_medio_segmento',
  'pl_medio_segmento',
  'vpa_medio_segmento',
  'peer_grupo_nome',
  'peer_grupo_tipo',
  'peer_fonte',
  'peer_atualizado_em'
];

// ----------------- cálculos de desvio (RF-008/009/010) -----------------

function calcularPvpVsPeer(p_vp, pvp_medio_segmento) {
  const v = numberOrNull(p_vp);
  const m = numberOrNull(pvp_medio_segmento);
  if (v === null || m === null || m <= 0) return null;
  const desvio_pct = (v / m - 1) * 100;
  return {
    fii: v,
    peer: m,
    desvio_pct,
    sinal: desvio_pct < -0.5 ? 'desconto' : desvio_pct > 0.5 ? 'premio' : 'em_linha'
  };
}

function calcularDyVsPeer(dy_12m, dy_medio_segmento) {
  const v = numberOrNull(dy_12m);
  const m = numberOrNull(dy_medio_segmento);
  if (v === null || m === null || m === 0) return null;
  const desvio_pct = (v / m - 1) * 100;
  return {
    fii: v,
    peer: m,
    desvio_pct,
    sinal: desvio_pct < -0.5 ? 'abaixo' : desvio_pct > 0.5 ? 'acima' : 'em_linha'
  };
}

function calcularVpaVsPeer(vp_cota, vpa_medio_segmento) {
  const v = numberOrNull(vp_cota);
  const m = numberOrNull(vpa_medio_segmento);
  if (v === null || m === null || m <= 0) return null;
  const desvio_pct = (v / m - 1) * 100;
  return {
    fii: v,
    peer: m,
    desvio_pct,
    uso: 'INFORMATIVO'
  };
}

// ----------------- classificação (RF-011) -----------------

function classificarPeer(input, opts = {}) {
  const limiarNeutro = opts.desvio_neutro_pct ?? DEFAULT_DESVIO_NEUTRO_PCT;
  const limiarDy = opts.dy_desfavoravel_pct ?? DEFAULT_DY_DESFAVORAVEL_PCT;

  const pvp = numberOrNull(input && input.pvp_desvio_pct);
  const dy = numberOrNull(input && input.dy_desvio_pct);

  if (pvp === null && dy === null) {
    return { classificacao: 'SEM_DADOS', motivo: 'DADOS_INSUFICIENTES' };
  }

  // Precedência do DESFAVORAVEL (RF-011).
  const pvpAcima = pvp !== null && pvp >= limiarNeutro;
  const dyAbaixo = dy !== null && dy <= -limiarDy;
  if (pvpAcima || dyAbaixo) {
    let motivo = 'P/VP e/ou DY acima do esperado';
    if (pvpAcima && dyAbaixo) motivo = 'P/VP alto + DY abaixo';
    else if (pvpAcima) motivo = `P/VP ${pvp.toFixed(1)}% acima da média`;
    else motivo = `DY ${Math.abs(dy).toFixed(1)}% abaixo da média`;
    return { classificacao: 'DESFAVORAVEL', motivo };
  }

  // FAVORAVEL: P/VP abaixo da banda neutra E DY não abaixo demais.
  const pvpAbaixo = pvp !== null && pvp <= -limiarNeutro;
  const dyNaoAbaixo = dy === null || dy > -limiarNeutro;
  if (pvpAbaixo && dyNaoAbaixo) {
    return { classificacao: 'FAVORAVEL', motivo: 'P/VP abaixo da média do segmento' };
  }

  return { classificacao: 'NEUTRO', motivo: 'Dentro da banda neutra do segmento' };
}

// ----------------- preço-teto efetivo (RF-016) -----------------

function precoReferenciaPeer(vp_cota, pvp_medio_segmento) {
  const vp = numberOrNull(vp_cota);
  const pvp = numberOrNull(pvp_medio_segmento);
  if (vp === null || pvp === null || pvp <= 0 || vp <= 0) return null;
  return vp * pvp;
}

function precoTetoEfetivo(input) {
  const base = numberOrNull(input && input.preco_teto);
  const ref = numberOrNull(input && input.preco_referencia_peer);
  const margem = numberOrNull(input && input.margem_pct) ?? 0;

  if (base === null) {
    return {
      teto_base: null,
      preco_referencia_peer: ref,
      teto_efetivo: null,
      regra_limitante: 'FALLBACK_SEM_PEER',
      benchmark_aplicado: false
    };
  }

  if (ref === null) {
    return {
      teto_base: base,
      preco_referencia_peer: null,
      teto_efetivo: base,
      regra_limitante: 'DY_BASE',
      benchmark_aplicado: false
    };
  }

  const refAjustada = ref * (1 + margem / 100);
  // peer NUNCA eleva o teto base
  const tetoEfetivo = Math.min(base, refAjustada);
  const regra = refAjustada < base ? 'PEER_PVP' : 'DY_BASE';

  return {
    teto_base: base,
    preco_referencia_peer: ref,
    teto_efetivo: Number.isFinite(tetoEfetivo) ? tetoEfetivo : base,
    regra_limitante: regra,
    benchmark_aplicado: true
  };
}

// ----------------- multiplicador (RF-021) -----------------

function multiplicadorPeer(classificacao, opts = {}) {
  switch (classificacao) {
    case 'FAVORAVEL':
      return opts.multiplicador_favoravel ?? DEFAULT_MULT_FAVORAVEL;
    case 'DESFAVORAVEL':
      return opts.multiplicador_desfavoravel ?? DEFAULT_MULT_DESFAVORAVEL;
    case 'NEUTRO':
    case 'SEM_DADOS':
    default:
      return opts.multiplicador_neutro ?? DEFAULT_MULT_NEUTRO;
  }
}

// ----------------- merge seguro -----------------

function mergeSnapshotPeer(prev, novo, opts = {}) {
  const fonte = (opts && opts.fonte) || 'investidor10';
  const atualizadoEm = (opts && opts.atualizadoEm) || new Date().toISOString();

  const out = { ...(prev || {}) };
  for (const k of PEER_FIELDS) {
    if (k === 'peer_fonte' || k === 'peer_atualizado_em') continue;
    const v = novo ? novo[k] : undefined;
    if (isUsableNumber(v) || (typeof v === 'string' && v.trim() !== '')) {
      out[k] = v;
    }
  }

  // peer_fonte + peer_atualizado_em: atualizados quando algum dos 4 numéricos mudou
  const trackedNumericos = ['pvp_medio_segmento', 'dy_medio_segmento', 'pl_medio_segmento', 'vpa_medio_segmento'];
  let atualizou = false;
  for (const k of trackedNumericos) {
    const v = novo ? novo[k] : undefined;
    if (isUsableNumber(v)) {
      const prevV = prev && prev[k];
      if (prevV !== v) { atualizou = true; break; }
    }
  }
  if (atualizou || !prev || !prev.peer_atualizado_em) {
    out.peer_fonte = fonte;
    out.peer_atualizado_em = atualizadoEm;
  }

  return out;
}

// ----------------- benchmark vencido (RF-007) -----------------

function benchmarkVencido(timestampIso, opts = {}) {
  const validadeHoras = opts.validadeHoras ?? DEFAULT_VALIDADE_HORAS;
  const agora = opts.agora ? new Date(opts.agora) : new Date();
  if (!timestampIso) return true;
  const ts = new Date(timestampIso);
  if (isNaN(ts.getTime())) return true;
  const diffMs = agora.getTime() - ts.getTime();
  const diffHoras = diffMs / 3_600_000;
  return diffHoras > validadeHoras;
}

// ----------------- simulação de rebalanceamento (RF-019..023) -----------------

function simularRebalanceamento(input) {
  const aporte = numberOrNull(input && input.aporte);
  if (aporte === null || aporte <= 0) {
    throw new Error('simularRebalanceamento: aporte deve ser número finito > 0');
  }

  const patrimonioAtual = numberOrNull(input && input.patrimonio_atual) ?? 0;
  const patrimonioProjetado = patrimonioAtual + aporte;
  const ativos = Array.isArray(input && input.ativos) ? input.ativos : [];

  const elegiveis = [];
  const ignorados = [];

  for (const a of ativos) {
    // Escopo: apenas FII ativo (RF-001 / RF-025)
    if (!a || a.tipo !== 'FII' || a.ativo !== 1) continue;

    const cotacao = numberOrNull(a.cotacao);
    if (cotacao === null || cotacao <= 0) {
      ignorados.push({ ticker: a.ticker, motivo: 'SEM_COTACAO' });
      continue;
    }

    const precoTeto = numberOrNull(a.preco_teto);
    if (precoTeto === null || precoTeto <= 0) {
      ignorados.push({ ticker: a.ticker, motivo: 'SEM_TETO' });
      continue;
    }

    if (cotacao > precoTeto) {
      ignorados.push({ ticker: a.ticker, motivo: 'ACIMA_DO_TETO' });
      continue;
    }

    const alvoPct = numberOrNull(a.alvo_pct_carteira) ?? 0;
    const saldoAtual = numberOrNull(a.saldo_atual) ?? 0;
    const gapAlvo = Math.max(0, (alvoPct / 100) * patrimonioProjetado - saldoAtual);

    if (gapAlvo < cotacao) {
      // Lacuna insuficiente para 1 cota — não seleciona
      ignorados.push({ ticker: a.ticker, motivo: 'SEM_GAP' });
      continue;
    }

    const classificacao = a.classificacao || 'SEM_DADOS';
    const multiplicador = multiplicadorPeer(classificacao);
    const ref = precoReferenciaPeer(a.vp_cota, a.pvp_medio_segmento);
    const tetoEfet = precoTetoEfetivo({
      preco_teto: precoTeto,
      preco_referencia_peer: ref,
      margem_pct: 0
    });

    // Se benchmark vencido, aplica fallback (multiplicador neutro, sem benchmark)
    const vencido = benchmarkVencido(a.peer_atualizado_em);
    if (vencido) {
      ignorados.push({ ticker: a.ticker, motivo: 'PEER_DESATUALIZADO_COM_FALLBACK' });
      continue;
    }

    elegiveis.push({
      ticker: a.ticker,
      cotacao,
      preco_teto: precoTeto,
      classificacao_peer: classificacao,
      multiplicador_peer: multiplicador,
      gap_alvo: gapAlvo,
      preco_teto_base: precoTeto,
      preco_referencia_peer: ref,
      preco_teto_efetivo: tetoEfet.teto_efetivo,
      regra_limitante: tetoEfet.regra_limitante,
      benchmark_aplicado: tetoEfet.benchmark_aplicado
    });
  }

  // Distribuição proporcional ao peso (gap × multiplicador) (RF-021)
  const pesos = elegiveis.map(e => e.gap_alvo * e.multiplicador_peer);
  const somaPesos = pesos.reduce((s, p) => s + p, 0);

  let valorAlocado = 0;
  const sugestoes = [];

  if (somaPesos > 0) {
    for (let i = 0; i < elegiveis.length; i++) {
      const e = elegiveis[i];
      const peso = pesos[i];
      // Proporção do aporte destinada a este FII, limitada pela lacuna
      const verba = Math.min(e.gap_alvo, (peso / somaPesos) * aporte);
      const quantidade = Math.floor(verba / e.cotacao);
      if (quantidade <= 0) continue;
      const valor = Number((quantidade * e.cotacao).toFixed(2));
      const gapDepois = Number((e.gap_alvo - valor).toFixed(2));

      sugestoes.push({
        ticker: e.ticker,
        quantidade,
        preco_unitario: e.cotacao,
        valor,
        gap_alvo_antes: Number(e.gap_alvo.toFixed(2)),
        gap_alvo_depois: gapDepois,
        classificacao_peer: e.classificacao_peer,
        multiplicador_peer: e.multiplicador_peer,
        preco_teto_base: e.preco_teto_base,
        preco_referencia_peer: e.preco_referencia_peer,
        preco_teto_efetivo: e.preco_teto_efetivo,
        regra_limitante: e.regra_limitante,
        benchmark_aplicado: e.benchmark_aplicado
      });
      valorAlocado += valor;
    }
  }

  // Redistribui sobra enquanto houver saldo capaz de comprar 1 cota elegível
  let sobra = Number((aporte - valorAlocado).toFixed(2));
  const aindaElegiveis = elegiveis
    .map((e, i) => ({ ...e, idx: i }))
    .filter((e, i) => !sugestoes.some(s => s.ticker === e.ticker) && sobra >= e.cotacao);

  // Heurística simples: preenche lacunas residuais na ordem dos pesos
  while (aindaElegiveis.some(e => sobra >= e.cotacao)) {
    let comprouAlgo = false;
    for (const e of aindaElegiveis) {
      if (sobra < e.cotacao) continue;
      const restante = e.gap_alvo - (sugestoes.find(s => s.ticker === e.ticker)?.valor ?? 0);
      if (restante < e.cotacao) continue;
      const idx = sugestoes.findIndex(s => s.ticker === e.ticker);
      if (idx >= 0) {
        sugestoes[idx].quantidade += 1;
        sugestoes[idx].valor = Number((sugestoes[idx].quantidade * e.cotacao).toFixed(2));
        sugestoes[idx].gap_alvo_depois = Number((restante - e.cotacao).toFixed(2));
      } else {
        sugestoes.push({
          ticker: e.ticker,
          quantidade: 1,
          preco_unitario: e.cotacao,
          valor: Number(e.cotacao.toFixed(2)),
          gap_alvo_antes: Number(e.gap_alvo.toFixed(2)),
          gap_alvo_depois: Number((e.gap_alvo - e.cotacao).toFixed(2)),
          classificacao_peer: e.classificacao_peer,
          multiplicador_peer: e.multiplicador_peer,
          preco_teto_base: e.preco_teto_base,
          preco_referencia_peer: e.preco_referencia_peer,
          preco_teto_efetivo: e.preco_teto_efetivo,
          regra_limitante: e.regra_limitante,
          benchmark_aplicado: e.benchmark_aplicado
        });
      }
      sobra = Number((sobra - e.cotacao).toFixed(2));
      valorAlocado = Number((valorAlocado + e.cotacao).toFixed(2));
      comprouAlgo = true;
    }
    if (!comprouAlgo) break;
  }

  return {
    aporte,
    patrimonio_antes: patrimonioAtual,
    patrimonio_projetado: patrimonioProjetado,
    valor_alocado: Number(valorAlocado.toFixed(2)),
    sobra,
    sugestoes,
    ignorados
  };
}

// ----------------- helpers internos -----------------

function isUsableNumber(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n);
}

function numberOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = {
  DEFAULT_DESVIO_NEUTRO_PCT,
  DEFAULT_DY_DESFAVORAVEL_PCT,
  DEFAULT_VALIDADE_HORAS,
  DEFAULT_MARGEM_TETO_PCT,
  DEFAULT_MULT_FAVORAVEL,
  DEFAULT_MULT_NEUTRO,
  DEFAULT_MULT_DESFAVORAVEL,
  PEER_FIELDS,
  calcularPvpVsPeer,
  calcularDyVsPeer,
  calcularVpaVsPeer,
  classificarPeer,
  precoReferenciaPeer,
  precoTetoEfetivo,
  multiplicadorPeer,
  mergeSnapshotPeer,
  benchmarkVencido,
  simularRebalanceamento
};