// TDD Red/Green — PRD 04: helpers de UI para Preço-teto + Rebalanceamento.

import { describe, it, expect } from 'vitest';
import {
  classificarSinalPreco,
  formatarLinhaPrecoTeto,
  formatarSugestaoRebalanceamento,
  formatarIgnoradoRebalanceamento,
  formatarCoberturaResumo
} from '../../shared/rebalanceamento-ui.js';

describe('classificarSinalPreco', () => {
  it('preço atual muito abaixo do teto → MUITO_BARATO', () => {
    const r = classificarSinalPreco(100, 170);  // 58.8%
    expect(r.sinal).toBe('MUITO_BARATO');
    expect(r.texto).toBe('Muito barato');
  });
  it('preço atual ≈ teto → NO_TETO', () => {
    const r = classificarSinalPreco(160, 170);  // 94.1%
    expect(r.sinal).toBe('NO_TETO');
  });
  it('preço atual até 115% do teto → CARO', () => {
    const r = classificarSinalPreco(180, 170);  // 105.9%
    expect(r.sinal).toBe('CARO');
  });
  it('preço atual > 115% do teto → MUITO_CARO', () => {
    const r = classificarSinalPreco(200, 170);  // 117.6%
    expect(r.sinal).toBe('MUITO_CARO');
  });
  it('preço-teto ausente → SEM_TETO', () => {
    expect(classificarSinalPreco(100, null).sinal).toBe('SEM_TETO');
    expect(classificarSinalPreco(100, 0).sinal).toBe('SEM_TETO');
  });
  it('preço atual ausente → SEM_TETO', () => {
    expect(classificarSinalPreco(null, 170).sinal).toBe('SEM_TETO');
  });
});

describe('formatarLinhaPrecoTeto', () => {
  it('monta linha com peer aplicado', () => {
    const ativo = { preco_atual: 158.30, preco_teto: 170, vp_cota: 101.20, pvp_medio_segmento: 0.95 };
    const comp = { preco_teto_efetivo: 96.14, regra_limitante: 'PEER_PVP', benchmark_aplicado: true, preco_referencia_peer: 96.14 };
    const linha = formatarLinhaPrecoTeto(ativo, comp);
    expect(linha.preco_atual).toBe(158.30);
    expect(linha.preco_teto_base).toBe(170);
    expect(linha.preco_referencia_peer).toBe(96.14);
    expect(linha.preco_teto_efetivo).toBe(96.14);
    expect(linha.regra_limitante).toBe('PEER_PVP');
    expect(linha.benchmark_aplicado).toBe(true);
    // ratio = 158.30 / 96.14 = 1.647 → MUITO_CARO
    expect(linha.ratio_preco_teto).toBeGreaterThan(1.6);
    expect(linha.sinal).toBe('MUITO_CARO');
  });
  it('sem peer → DY_BASE', () => {
    const ativo = { preco_atual: 158.30, preco_teto: 170 };
    const comp = { preco_teto_efetivo: 170, regra_limitante: 'DY_BASE', benchmark_aplicado: false, preco_referencia_peer: null };
    const linha = formatarLinhaPrecoTeto(ativo, comp);
    expect(linha.regra_limitante).toBe('DY_BASE');
    expect(linha.benchmark_aplicado).toBe(false);
    expect(linha.sinal).toBe('NO_TETO');  // 158.30/170 = 93%
  });
  it('teto base ausente → SEM_TETO', () => {
    const linha = formatarLinhaPrecoTeto(
      { preco_atual: 100, preco_teto: null },
      { preco_teto_efetivo: null, regra_limitante: 'FALLBACK_SEM_PEER', benchmark_aplicado: false }
    );
    expect(linha.preco_teto_efetivo).toBeNull();
    expect(linha.sinal).toBe('SEM_TETO');
  });
});

describe('formatarSugestaoRebalanceamento', () => {
  it('formata BRL + multiplicador com 2 casas', () => {
    const sug = {
      ticker: 'HGLG11',
      quantidade: 5,
      preco_unitario: 158.30,
      valor: 791.50,
      gap_alvo_antes: 1100,
      gap_alvo_depois: 308.50,
      classificacao_peer: 'FAVORAVEL',
      multiplicador_peer: 1.15,
      preco_teto_base: 170,
      preco_referencia_peer: 96.14,
      preco_teto_efetivo: 96.14,
      regra_limitante: 'PEER_PVP',
      benchmark_aplicado: true
    };
    const r = formatarSugestaoRebalanceamento(sug);
    expect(r.ticker).toBe('HGLG11');
    expect(r.quantidade).toBe(5);
    expect(r.preco_unitario).toBe('R$ 158,30');
    expect(r.valor).toBe('R$ 791,50');
    expect(r.multiplicador_peer).toBe(1.15);
    expect(r.regra_limitante).toBe('PEER_PVP');
  });
  it('null/undefined → null', () => {
    expect(formatarSugestaoRebalanceamento(null)).toBeNull();
    expect(formatarSugestaoRebalanceamento(undefined)).toBeNull();
  });
});

describe('formatarIgnoradoRebalanceamento', () => {
  it('traduz motivo para texto pt-BR', () => {
    expect(formatarIgnoradoRebalanceamento({ ticker: 'X', motivo: 'SEM_COTACAO' }).motivo_texto)
      .toBe('Sem cotação');
    expect(formatarIgnoradoRebalanceamento({ ticker: 'X', motivo: 'PEER_DESATUALIZADO_COM_FALLBACK' }).motivo_texto)
      .toBe('Benchmark vencido');
  });
});

describe('formatarCoberturaResumo', () => {
  it('formato "X de Y FIIs com benchmark"', () => {
    expect(formatarCoberturaResumo({ total: 17, comBenchmark: 14, semBenchmark: 3 }))
      .toBe('14 de 17 FIIs com benchmark (3 sem)');
  });
  it('sem pendências: oculta "X sem"', () => {
    expect(formatarCoberturaResumo({ total: 17, comBenchmark: 17, semBenchmark: 0 }))
      .toBe('17 de 17 FIIs com benchmark');
  });
});