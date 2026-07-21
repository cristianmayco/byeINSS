// @vitest-environment jsdom
// src/__tests__/renderer/indicadores-ui.test.js
// Cobertura do módulo UI do PRD 02 (Indicadores Históricos).
// Cobre: badges de classificação (cores), rentabilidade real, bloco
// de alerta no Dashboard, helpers de formatação e acessibilidade.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import indicadoresUI from '../../renderer/js/indicadores-ui.js';

beforeEach(() => {
  // limpa o body para cada teste
  document.body.replaceChildren();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('formatarPercentual', () => {
  test('formata número positivo em pt-BR com 1 casa', () => {
    expect(indicadoresUI.formatarPercentual(9.5)).toBe('9,5%');
    expect(indicadoresUI.formatarPercentual(100)).toBe('100,0%');
  });

  test('formata número negativo', () => {
    expect(indicadoresUI.formatarPercentual(-3.5)).toBe('-3,5%');
  });

  test('formata com casas customizadas', () => {
    expect(indicadoresUI.formatarPercentual(12.3456, 2)).toBe('12,35%');
    expect(indicadoresUI.formatarPercentual(12.3456, 0)).toBe('12%');
  });

  test('retorna — para null/undefined/NaN', () => {
    expect(indicadoresUI.formatarPercentual(null)).toBe('—');
    expect(indicadoresUI.formatarPercentual(undefined)).toBe('—');
    expect(indicadoresUI.formatarPercentual(NaN)).toBe('—');
    expect(indicadoresUI.formatarPercentual('abc')).toBe('—');
  });
});

describe('renderizarBadgeDyVs5a (DOM)', () => {
  test('badge CONSISTENTE com cor success', () => {
    const el = indicadoresUI.renderizarBadgeDyVs5a({
      classificacao: 'EM_LINHA', severidade: 'CONSISTENTE',
      dy_vs_5a_pct: 100, motivo: 'DY 12M em linha'
    });
    expect(el.classList.contains('dy-vs-5a-badge--success')).toBe(true);
    expect(el.getAttribute('aria-label')).toContain('Em linha');
    expect(el.textContent).toContain('Em linha');
    expect(el.textContent).toContain('100%');
  });

  test('badge ATENCAO com cor warning', () => {
    const el = indicadoresUI.renderizarBadgeDyVs5a({
      classificacao: 'ABAIXO', severidade: 'ATENCAO',
      dy_vs_5a_pct: 87, motivo: 'DY 12M abaixo de 95%'
    });
    expect(el.classList.contains('dy-vs-5a-badge--warning')).toBe(true);
    expect(el.title).toBe('DY 12M abaixo de 95%');
    expect(el.textContent).toContain('87%');
  });

  test('badge CRITICO com cor danger (boundary pct ≤ 80)', () => {
    const el = indicadoresUI.renderizarBadgeDyVs5a({
      classificacao: 'ABAIXO', severidade: 'CRITICO',
      dy_vs_5a_pct: 60, motivo: 'provável corte'
    });
    expect(el.classList.contains('dy-vs-5a-badge--danger')).toBe(true);
    expect(el.getAttribute('aria-label')).toContain('provável corte');
  });

  test('badge INSUFICIENTE / INDEFINIDO com cor muted', () => {
    const el = indicadoresUI.renderizarBadgeDyVs5a({
      classificacao: 'INSUFICIENTE', severidade: 'INDEFINIDO',
      dy_vs_5a_pct: null
    });
    expect(el.classList.contains('dy-vs-5a-badge--muted')).toBe(true);
    expect(el.textContent).toContain('—');
  });

  test('badge padrão quando item é null (defesa)', () => {
    const el = indicadoresUI.renderizarBadgeDyVs5a(null);
    expect(el.classList.contains('dy-vs-5a-badge--muted')).toBe(true);
    expect(el.textContent).toContain('—');
  });

  test('badge inclui dot decorativo com aria-hidden', () => {
    const el = indicadoresUI.renderizarBadgeDyVs5a({
      classificacao: 'EM_LINHA', severidade: 'CONSISTENTE', dy_vs_5a_pct: 95
    });
    const dot = el.querySelector('.dy-vs-5a-badge__dot');
    expect(dot).not.toBeNull();
    expect(dot.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('renderizarRentabilidadeReal12M (DOM)', () => {
  test('valor positivo sem classe de cor', () => {
    const el = indicadoresUI.renderizarRentabilidadeReal12M({ rentab_real_1a: 12.5 });
    expect(el.textContent).toBe('12,50%');
    expect(el.classList.contains('rentab-real-12m--negative')).toBe(false);
    expect(el.classList.contains('rentab-real-12m--zero')).toBe(false);
  });

  test('valor negativo ganha classe --negative', () => {
    const el = indicadoresUI.renderizarRentabilidadeReal12M({ rentab_real_1a: -3.5 });
    expect(el.textContent).toBe('-3,50%');
    expect(el.classList.contains('rentab-real-12m--negative')).toBe(true);
  });

  test('valor zero ganha classe --zero (muted)', () => {
    const el = indicadoresUI.renderizarRentabilidadeReal12M({ rentab_real_1a: 0 });
    expect(el.textContent).toBe('0,00%');
    expect(el.classList.contains('rentab-real-12m--zero')).toBe(true);
  });

  test('valor null → "—" com classe --empty', () => {
    const el = indicadoresUI.renderizarRentabilidadeReal12M({ rentab_real_1a: null });
    expect(el.textContent).toBe('—');
    expect(el.classList.contains('rentab-real-12m--empty')).toBe(true);
  });

  test('item null → "—"', () => {
    const el = indicadoresUI.renderizarRentabilidadeReal12M(null);
    expect(el.textContent).toBe('—');
  });

  test('aria-label descreve o valor', () => {
    const el = indicadoresUI.renderizarRentabilidadeReal12M({ rentab_real_1a: 8.5 });
    expect(el.getAttribute('aria-label')).toBe('Rentabilidade real 12 meses: 8,50%');
  });
});

describe('badgeDyVs5aHtml + rentabReal12MHtml (variantes string)', () => {
  test('badge HTML para EM_LINHA contém classe success', () => {
    const html = indicadoresUI.badgeDyVs5aHtml({
      classificacao: 'EM_LINHA', severidade: 'CONSISTENTE', dy_vs_5a_pct: 100
    });
    expect(html).toContain('dy-vs-5a-badge--success');
    expect(html).toContain('role="status"');
    expect(html).toContain('100%');
    expect(html).toContain('Em linha');
  });

  test('badge HTML escapa aspas no motivo', () => {
    const html = indicadoresUI.badgeDyVs5aHtml({
      classificacao: 'ABAIXO', severidade: 'ATENCAO',
      dy_vs_5a_pct: 90, motivo: 'DY 12M "abaixo" do esperado'
    });
    expect(html).not.toContain('"abaixo"');
    expect(html).toContain('&quot;');
  });

  test('rentab HTML para valor negativo tem classe negative', () => {
    const html = indicadoresUI.rentabReal12MHtml({ rentab_real_1a: -5 });
    expect(html).toContain('rentab-real-12m--negative');
    expect(html).toContain('-5,00%');
  });
});

describe('renderizarBlocoAlertaDashboard', () => {
  test('não renderiza nada quando lista vazia', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const res = indicadoresUI.renderizarBlocoAlertaDashboard(mount, []);
    expect(res.renderizado).toBe(false);
    expect(res.total).toBe(0);
    expect(mount.children.length).toBe(0);
  });

  test('não renderiza quando só há FIIs CONSISTENTE/INDEFINIDO', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const itens = [
      { ticker: 'HGLG11', classificacao: 'EM_LINHA', severidade: 'CONSISTENTE', dy_vs_5a_pct: 100 },
      { ticker: 'XPML11', classificacao: 'INSUFICIENTE', severidade: 'INDEFINIDO', dy_vs_5a_pct: null }
    ];
    const res = indicadoresUI.renderizarBlocoAlertaDashboard(mount, itens);
    expect(res.renderizado).toBe(false);
  });

  test('renderiza bloco quando há FIIs CRITICO/ATENCAO', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const itens = [
      { ticker: 'XPML11', classificacao: 'ABAIXO', severidade: 'CRITICO', dy_vs_5a_pct: 60, motivo: 'corte' },
      { ticker: 'BCFF11', classificacao: 'ACIMA', severidade: 'CRITICO', dy_vs_5a_pct: 130, motivo: 'armadilha' },
      { ticker: 'KNIP11', classificacao: 'ABAIXO', severidade: 'ATENCAO', dy_vs_5a_pct: 87 }
    ];
    const res = indicadoresUI.renderizarBlocoAlertaDashboard(mount, itens);
    expect(res.renderizado).toBe(true);
    expect(res.total).toBe(3);

    const bloco = mount.querySelector('[data-bloco="indicadores-alerta"]');
    expect(bloco).not.toBeNull();
    expect(bloco.getAttribute('aria-labelledby')).toBe('indicadores-alerta-titulo');

    const titulo = bloco.querySelector('.indicadores-alerta__titulo');
    expect(titulo.textContent).toContain('2 crítico(s)');
    expect(titulo.textContent).toContain('1 atenção');

    const items = bloco.querySelectorAll('.indicadores-alerta__item');
    expect(items.length).toBe(3);
    // Críticos vêm com classe danger
    expect(items[0].classList.contains('indicadores-alerta__item--danger')).toBe(true);
    expect(items[2].classList.contains('indicadores-alerta__item--warning')).toBe(true);

    // Links com href correto para a página de detalhe
    const links = bloco.querySelectorAll('a');
    expect(links[0].getAttribute('href')).toBe('#fii/XPML11');
    expect(links[0].getAttribute('aria-label')).toContain('XPML11');
  });

  test('respeita maxItens e mostra "mais" quando excede', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const itens = [];
    for (let i = 0; i < 15; i++) {
      const code = String.fromCharCode(65 + i) + 'G11'.padStart(0);
      itens.push({
        ticker: `${code}${'1'.padStart(2 - code.length, '1')}`.slice(0, 6).toUpperCase().padEnd(6, '1'),
        classificacao: 'ABAIXO', severidade: 'CRITICO', dy_vs_5a_pct: 60
      });
    }
    const res = indicadoresUI.renderizarBlocoAlertaDashboard(mount, itens, { maxItens: 5 });
    expect(res.renderizado).toBe(true);
    expect(res.total).toBe(15);
    const items = mount.querySelectorAll('.indicadores-alerta__item');
    expect(items.length).toBe(5);
    const mais = mount.querySelector('.indicadores-alerta__mais');
    expect(mais.textContent).toContain('+ 10');
  });

  test('substitui bloco anterior se chamado duas vezes', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const itens = [
      { ticker: 'HGLG11', classificacao: 'EM_LINHA', severidade: 'CONSISTENTE', dy_vs_5a_pct: 100 }
    ];
    indicadoresUI.renderizarBlocoAlertaDashboard(mount, itens); // não renderiza nada
    const itensCriticos = [
      { ticker: 'XPML11', classificacao: 'ABAIXO', severidade: 'CRITICO', dy_vs_5a_pct: 60 }
    ];
    indicadoresUI.renderizarBlocoAlertaDashboard(mount, itensCriticos);
    // Deve haver exatamente UM bloco (não dois)
    const blocos = mount.querySelectorAll('[data-bloco="indicadores-alerta"]');
    expect(blocos.length).toBe(1);
    expect(blocos[0].textContent).toContain('XPML11');
  });
});

describe('criarEnhancerDePosicao', () => {
  test('enhancer adiciona 2 células (DY vs 5y + Rent. real) ao tr', () => {
    const enhancer = indicadoresUI.criarEnhancerDePosicao({
      HGLG11: { classificacao: 'EM_LINHA', severidade: 'CONSISTENTE', dy_vs_5a_pct: 100, rentab_real_1a: 8.5 }
    });
    const tr = document.createElement('tr');
    enhancer(tr, { ticker: 'HGLG11' });
    expect(tr.children.length).toBe(2);
    expect(tr.children[0].classList.contains('col-dy-vs-5a')).toBe(true);
    expect(tr.children[1].classList.contains('col-rentab-real-12m')).toBe(true);
    expect(tr.children[0].textContent).toContain('Em linha');
    expect(tr.children[1].textContent).toContain('8,50%');
  });

  test('enhancer com ticker ausente usa fallback "—"', () => {
    const enhancer = indicadoresUI.criarEnhancerDePosicao({});
    const tr = document.createElement('tr');
    enhancer(tr, { ticker: 'XPML11' });
    expect(tr.children[0].textContent).toContain('—');
    expect(tr.children[1].textContent).toContain('—');
  });

  test('enhancer é case-insensitive no lookup', () => {
    const enhancer = indicadoresUI.criarEnhancerDePosicao({
      'HGLG11': { classificacao: 'EM_LINHA', severidade: 'CONSISTENTE', dy_vs_5a_pct: 100, rentab_real_1a: 8.5 }
    });
    const tr = document.createElement('tr');
    enhancer(tr, { ticker: 'hglg11' });
    expect(tr.children[0].textContent).toContain('Em linha');
  });
});

describe('exportação do módulo', () => {
  test('expõe namespace byeINSSIndicadoresUI quando window existe', () => {
    expect(typeof window.byeINSSIndicadoresUI).toBe('object');
    expect(typeof window.byeINSSIndicadoresUI.formatarPercentual).toBe('function');
  });

  test('expõe module.exports para uso em testes Node', () => {
    expect(typeof indicadoresUI.formatarPercentual).toBe('function');
    expect(typeof indicadoresUI.renderizarBadgeDyVs5a).toBe('function');
  });
});