// TDD Red Phase — PRD 03 RF-015 a RF-019, RF-022, RF-024.
// Lógica pura de agregação mensal, quantidade elegível e projeção.

import { describe, it, expect } from 'vitest';
import {
  calcularQuantidadeElegivel,
  agregarProventosMensais,
  calcularProjecao
} from '../shared/proventos-helpers.js';

describe('calcularQuantidadeElegivel — RF-015', () => {
  it('usa posição na data_com quando há lançamentos até essa data', () => {
    const lanc = [
      { data: '2026-01-10', tipo: 'COMPRA', quantidade: 100 },
      { data: '2026-02-15', tipo: 'VENDA',  quantidade: 30 }
    ];
    // 100 - 30 = 70
    expect(calcularQuantidadeElegivel(lanc, '2026-07-15', '2026-07-20')).toBe(70);
  });

  it('usa posição na data_pagto quando não há lançamentos até a data_com', () => {
    // Venda ANTES da data_com (sem posição na data_com)
    const lanc = [
      { data: '2026-01-10', tipo: 'COMPRA', quantidade: 100 },
      { data: '2026-06-01', tipo: 'VENDA',  quantidade: 50 }
    ];
    expect(calcularQuantidadeElegivel(lanc, '2026-07-15', '2026-07-20')).toBe(50);
  });

  it('RF-013 caso 12: sem lançamentos até data_pagto → 0', () => {
    const lanc = [];
    expect(calcularQuantidadeElegivel(lanc, '2026-07-15', '2026-07-20')).toBe(0);
  });

  it('RF-013 caso 13: venda entre data_com e data_pagto preserva direito', () => {
    // Compra antes; venda ENTRE data_com e data_pagto → mantém posição na data_com.
    const lanc = [
      { data: '2026-01-10', tipo: 'COMPRA', quantidade: 100 },
      { data: '2026-07-18', tipo: 'VENDA',  quantidade: 50 }  // data_com=15, pagto=20
    ];
    // Quantidade na data_com = 100 (a venda foi depois)
    expect(calcularQuantidadeElegivel(lanc, '2026-07-15', '2026-07-20')).toBe(100);
  });
});

describe('agregarProventosMensais — RF-014/016, KPI mensal por tipo', () => {
  // Helper: monta um dataset pequeno
  function prov(ticker, data_pagto, valor, tipo, qtd) {
    return { ticker, ativo_id: ticker === 'HGLG11' ? 1 : 2, data_pagto,
             valor_por_cota: valor, tipo, quantidade_elegivel: qtd };
  }

  it('separa DIVIDENDO+RENDIMENTO (distribuíveis) de AMORTIZACAO e BONIFICACAO', () => {
    const proventos = [
      prov('HGLG11', '2026-07-20', 0.80, 'DIVIDENDO', 100),    // 80
      prov('XPML11', '2026-07-20', 1.05, 'RENDIMENTO', 50),    // 52.5
      prov('HGLG11', '2026-07-20', 0.20, 'AMORTIZACAO', 100),  // 20
      prov('XPML11', '2026-08-20', 0.30, 'AMORTIZACAO', 50),   // 15
    ];
    const r = agregarProventosMensais(proventos, { inicio: '2026-07-01', fim: '2026-12-31' });
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({
      mes: '2026-07',
      distribuiveis: 132.5,    // 80 + 52.5
      amortizacoes: 20,
      bonificacoes: 0,
      total_caixa: 152.5
    });
    expect(r[0].por_tipo).toMatchObject({
      DIVIDENDO: 80, RENDIMENTO: 52.5, AMORTIZACAO: 20, BONIFICACAO: 0
    });
    expect(r[1]).toMatchObject({
      mes: '2026-08',
      distribuiveis: 0,
      amortizacoes: 15,
      bonificacoes: 0
    });
  });

  it('BONIFICACAO não compõe distribuíveis nem total_caixa (RF-016)', () => {
    const r = agregarProventosMensais([
      prov('HGLG11', '2026-07-20', 1.00, 'BONIFICACAO', 100)
    ], { inicio: '2026-07-01', fim: '2026-12-31' });
    expect(r[0].distribuiveis).toBe(0);
    expect(r[0].bonificacoes).toBe(100);
    expect(r[0].total_caixa).toBe(0);  // bonificação não é caixa
    expect(r[0].amortizacoes).toBe(0);
  });

  it('respeita início/fim do período', () => {
    const r = agregarProventosMensais([
      prov('HGLG11', '2026-06-20', 1, 'DIVIDENDO', 100),  // fora (junho)
      prov('HGLG11', '2026-07-20', 1, 'DIVIDENDO', 100)
    ], { inicio: '2026-07-01', fim: '2026-07-31' });
    expect(r).toHaveLength(1);
    expect(r[0].mes).toBe('2026-07');
  });
});

describe('calcularProjecao — RF-017, RF-018, RF-024', () => {
  function prov(ticker, data_pagto, valor, tipo) {
    return {
      ticker,
      ativo_id: ticker === 'HGLG11' ? 1 : 2,
      data_pagto,
      valor_por_cota: valor,
      tipo
    };
  }
  function ativo(ticker, qtd, preco) {
    return { ticker, id: ticker === 'HGLG11' ? 1 : 2, qtd, preco_atual: preco };
  }

  it('RF-017: usa último DIVIDENDO/RENDIMENTO e anualiza × 12', () => {
    const p = [
      prov('HGLG11', '2026-01-15', 0.80, 'DIVIDENDO'),
      prov('HGLG11', '2026-02-15', 0.85, 'DIVIDENDO'),
      prov('HGLG11', '2026-07-20', 0.90, 'DIVIDENDO')  // mais recente (distribuível)
    ];
    const a = [ativo('HGLG11', 100, 10)];
    const r = calcularProjecao(p, a, { hoje: '2026-07-21', lookaheadMonths: 12 });
    expect(r.detalhes[0]).toMatchObject({
      ticker: 'HGLG11',
      ultimo_distribuivel_por_cota: 0.90,
      mensal_distribuivel: 90,             // 100 * 0.90
      anual_distribuivel: 1080,           // 90 * 12
      dy_anual_distribuivel: 108           // 1080 / (100*10) * 100
    });
    expect(r.total_distribuivel_mensal).toBe(90);
    expect(r.total_distribuivel_anual).toBe(1080);
    expect(r.amortizacoes_previstas).toEqual([]);  // sem agendadas
  });

  it('RF-017: amortização recente NÃO substitui o último DIVIDENDO/RENDIMENTO', () => {
    const p = [
      prov('HGLG11', '2026-07-10', 0.80, 'DIVIDENDO'),
      prov('HGLG11', '2026-07-20', 0.50, 'AMORTIZACAO')  // mais recente, mas NÃO distribuível
    ];
    const a = [ativo('HGLG11', 100, 10)];
    const r = calcularProjecao(p, a, { hoje: '2026-07-21', lookaheadMonths: 12 });
    expect(r.detalhes[0].ultimo_distribuivel_por_cota).toBe(0.80);
    expect(r.detalhes[0].ultimo_pagto_distribuivel).toBe('2026-07-10');
  });

  it('RF-018: amortizações futuras explícitas entram em amortizacoes_previstas', () => {
    const hoje = '2026-07-21';
    const p = [
      prov('XPML11', '2026-07-31', 0.30, 'AMORTIZACAO')  // dentro de 12 meses
    ];
    const a = [ativo('XPML11', 100, 10)];
    const r = calcularProjecao(p, a, { hoje, lookaheadMonths: 12 });
    expect(r.amortizacoes_previstas).toHaveLength(1);
    expect(r.amortizacoes_previstas[0]).toMatchObject({
      ticker: 'XPML11',
      data_pagto: '2026-07-31',
      valor_por_cota: 0.30,
      quantidade_estimada: 100,
      valor_total_estimado: 30
    });
    // NÃO multiplica por 12
    expect(r.total_amortizacoes_previstas).toBe(30);
  });

  it('RF-018: amortizações passadas NÃO entram em amortizacoes_previstas', () => {
    const p = [
      prov('XPML11', '2026-01-15', 0.30, 'AMORTIZACAO')  // passada
    ];
    const a = [ativo('XPML11', 100, 10)];
    const r = calcularProjecao(p, a, { hoje: '2026-07-21', lookaheadMonths: 12 });
    expect(r.amortizacoes_previstas).toEqual([]);
    expect(r.total_amortizacoes_previstas).toBe(0);
  });

  it('RF-024: FII apenas com amortizações → distribuição zero, futuras visíveis separadas', () => {
    const p = [
      prov('HGLG11', '2026-07-15', 0.20, 'AMORTIZACAO'),
      prov('HGLG11', '2026-08-15', 0.20, 'AMORTIZACAO')
    ];
    const a = [ativo('HGLG11', 100, 10)];
    const r = calcularProjecao(p, a, { hoje: '2026-07-21', lookaheadMonths: 12 });
    expect(r.detalhes[0]).toMatchObject({
      mensal_distribuivel: 0,
      anual_distribuivel: 0,
      dy_anual_distribuivel: 0
    });
    expect(r.amortizacoes_previstas).toHaveLength(1);  // só a de agosto está no futuro
  });

  it('RF-024: sem provento → "Sem base recorrente" (baseado em detalhe)', () => {
    const p = [];
    const a = [ativo('HGLG11', 100, 10)];
    const r = calcularProjecao(p, a, { hoje: '2026-07-21', lookaheadMonths: 12 });
    expect(r.detalhes[0]).toMatchObject({
      ultimo_distribuivel_por_cota: 0,
      mensal_distribuivel: 0,
      anual_distribuivel: 0,
      sem_base_recorrente: true
    });
  });

  it('marca desatualizado se último distribuível > 90 dias (caso 17)', () => {
    const p = [
      prov('HGLG11', '2026-02-15', 0.80, 'DIVIDENDO')  // ~5 meses atrás
    ];
    const a = [ativo('HGLG11', 100, 10)];
    const r = calcularProjecao(p, a, { hoje: '2026-07-21', lookaheadMonths: 12 });
    expect(r.detalhes[0].desatualizado).toBe(true);
  });
});
