// TDD Red/Green — PRD 04: helpers de formatação de UI para colunas peer.

import { describe, it, expect } from 'vitest';
import {
  formatarPct,
  formatarMoeda,
  formatarDesvioPvp,
  formatarDesvioDy,
  formatarDesvioVpa,
  formatarChipClassificacao,
  chipClassificacaoAcessivel,
  aplicarFiltroPeer,
  ordenarPorDesvio
} from '../../shared/peer-ui.js';

describe('formatarPct', () => {
  it('positivo recebe +', () => {
    expect(formatarPct(10.5)).toBe('+10,5%');
  });
  it('negativo recebe − (minus unicode)', () => {
    expect(formatarPct(-3.20)).toBe('−3,2%');
  });
  it('zero sem sinal', () => {
    expect(formatarPct(0)).toBe('0,0%');
  });
  it('null/undefined → null', () => {
    expect(formatarPct(null)).toBeNull();
    expect(formatarPct(undefined)).toBeNull();
  });
});

describe('formatarMoeda', () => {
  it('BRL com vírgula', () => {
    expect(formatarMoeda(101.2)).toBe('R$ 101,20');
  });
  it('null → null', () => {
    expect(formatarMoeda(null)).toBeNull();
  });
});

describe('formatarDesvioPvp', () => {
  it('desconto: -6.32% → "−6,3%"', () => {
    const r = formatarDesvioPvp({
      pvp: { fii: 0.89, peer: 0.95, desvio_pct: -6.32 }
    });
    expect(r.texto).toBe('−6,3%');
    expect(r.titulo).toContain('0,89');
    expect(r.titulo).toContain('0,95');
  });
  it('prêmio: +10.5% → "+10,5%"', () => {
    const r = formatarDesvioPvp({
      pvp: { fii: 1.05, peer: 0.95, desvio_pct: 10.5 }
    });
    expect(r.texto).toBe('+10,5%');
  });
  it('sem benchmark → "—"', () => {
    const r = formatarDesvioPvp(null);
    expect(r.texto).toBe('—');
  });
});

describe('formatarDesvioDy', () => {
  it('acima: +7.69% → "+7,7%"', () => {
    const r = formatarDesvioDy({
      dy_12m: { fii: 9.8, peer: 9.1, desvio_pct: 7.69 }
    });
    expect(r.texto).toBe('+7,7%');
    expect(r.titulo).toContain('9,8');
    expect(r.titulo).toContain('9,1');
  });
  it('sem benchmark → "—"', () => {
    expect(formatarDesvioDy({}).texto).toBe('—');
  });
});

describe('formatarDesvioVpa', () => {
  it('formata com moeda no título', () => {
    const r = formatarDesvioVpa({
      vpa: { fii: 101.20, peer: 96.70, desvio_pct: 4.65 }
    });
    expect(r.texto).toBe('+4,7%');
    expect(r.titulo).toContain('R$ 101,20');
    expect(r.titulo).toContain('R$ 96,70');
  });
});

describe('formatarChipClassificacao', () => {
  it('FAVORAVEL → { texto: "Favorável", classe: "chip-favoravel" }', () => {
    expect(formatarChipClassificacao({ classificacao: 'FAVORAVEL' })).toEqual({
      texto: 'Favorável',
      classe: 'chip-favoravel'
    });
  });
  it('DESFAVORAVEL → chip-desfavoravel', () => {
    expect(formatarChipClassificacao({ classificacao: 'DESFAVORAVEL' })).toEqual({
      texto: 'Desfavorável',
      classe: 'chip-desfavoravel'
    });
  });
  it('NEUTRO → chip-neutro', () => {
    expect(formatarChipClassificacao({ classificacao: 'NEUTRO' })).toEqual({
      texto: 'Neutro',
      classe: 'chip-neutro'
    });
  });
  it('SEM_DADOS / null → "Sem dados"', () => {
    expect(formatarChipClassificacao({ classificacao: 'SEM_DADOS' }).texto).toBe('Sem dados');
    expect(formatarChipClassificacao(null).texto).toBe('Sem dados');
  });
});

describe('chipClassificacaoAcessivel (a11y)', () => {
  it('texto descritivo para FAVORAVEL', () => {
    expect(chipClassificacaoAcessivel({ classificacao: 'FAVORAVEL' })).toMatch(/favorável/i);
  });
  it('texto descritivo para DESFAVORAVEL', () => {
    expect(chipClassificacaoAcessivel({ classificacao: 'DESFAVORAVEL' })).toMatch(/desfavorável/i);
  });
  it('fallback para SEM_DADOS', () => {
    expect(chipClassificacaoAcessivel({})).toMatch(/sem dados/i);
  });
});

describe('aplicarFiltroPeer', () => {
  const itens = [
    { ticker: 'A', classificacao: 'FAVORAVEL' },
    { ticker: 'B', classificacao: 'DESFAVORAVEL' },
    { ticker: 'C', classificacao: 'NEUTRO' },
    { ticker: 'D', classificacao: 'SEM_DADOS' }
  ];
  it('sem filtro → retorna todos', () => {
    expect(aplicarFiltroPeer(itens, null).length).toBe(4);
  });
  it('filtro por uma classificação (array)', () => {
    const r = aplicarFiltroPeer(itens, ['FAVORAVEL']);
    expect(r.map(i => i.ticker)).toEqual(['A']);
  });
  it('filtro por CSV string', () => {
    const r = aplicarFiltroPeer(itens, 'FAVORAVEL,DESFAVORAVEL');
    expect(r.map(i => i.ticker).sort()).toEqual(['A', 'B']);
  });
  it('filtro case-insensitive', () => {
    const r = aplicarFiltroPeer(itens, 'favoravel');
    expect(r.map(i => i.ticker)).toEqual(['A']);
  });
});

describe('ordenarPorDesvio', () => {
  const itens = [
    { ticker: 'A', pvp: { desvio_pct: -10 } },
    { ticker: 'B', pvp: { desvio_pct: 5 } },
    { ticker: 'C', pvp: null },         // SEM_DADOS
    { ticker: 'D', pvp: { desvio_pct: 0 } }
  ];
  it('asc: menor para maior', () => {
    const r = ordenarPorDesvio(itens, 'pvp', 'asc').map(i => i.ticker);
    expect(r).toEqual(['A', 'D', 'B', 'C']);  // C no fim
  });
  it('desc: maior para menor', () => {
    const r = ordenarPorDesvio(itens, 'pvp', 'desc').map(i => i.ticker);
    expect(r).toEqual(['B', 'D', 'A', 'C']);
  });
  it('SEM_DADOS sempre no fim independente da direção', () => {
    expect(ordenarPorDesvio(itens, 'pvp', 'asc').slice(-1)[0].ticker).toBe('C');
    expect(ordenarPorDesvio(itens, 'pvp', 'desc').slice(-1)[0].ticker).toBe('C');
  });
});