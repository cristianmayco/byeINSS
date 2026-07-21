// @vitest-environment jsdom
// src/__tests__/renderer/indicadores-ui-rf18.test.js
// Sub-PR 4 do PRD 02 — fechamento dos 4 gaps:
//   - RF-018: matriz Nominal×Real × 1a/2a/5a acessível
//   - RF-019: ordenação numérica + filtro por classificação em Posições
//   - RF-021: contadores avaliada/sem-dados no bloco de alerta
//   - RF-022: ação "Ver FIIs" navegando para Posições filtrada
//   - RF-023: estado vazio com ação específica
//
// TDD Red phase: testes escritos ANTES da implementação.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import indicadoresUI from '../../renderer/js/indicadores-ui.js';

beforeEach(() => { document.body.replaceChildren(); });
afterEach(() => { document.body.replaceChildren(); });

// =====================================================================
// RF-018 — Matriz Nominal × Real × {1a, 2a, 5a} acessível
// =====================================================================

describe('renderizarMatrizRentabilidade (RF-018)', () => {
  test('retorna null/empty quando não há dados', () => {
    const el = indicadoresUI.renderizarMatrizRentabilidade({});
    // Sem nenhum campo, matriz fica vazia (não quebrando)
    expect(el).toBeDefined();
  });

  test('mostra 6 valores (Nominal/Real × 1a/2a/5a)', () => {
    const item = {
      rentab_nominal_1a: 10, rentab_real_1a: 7,
      rentab_nominal_2a: 22, rentab_real_2a: 14,
      rentab_nominal_5a: 55, rentab_real_5a: 30
    };
    const el = indicadoresUI.renderizarMatrizRentabilidade(item);
    const html = el.innerHTML;
    expect(html).toContain('Nominal');
    expect(html).toContain('Real');
    // Headers exibem "1 ano", "2 anos", "5 anos"
    expect(html).toContain('1 ano');
    expect(html).toContain('2 anos');
    expect(html).toContain('5 anos');
    expect(html).toContain('10,0%');
    expect(html).toContain('55,0%');
  });

  test('substitui valor ausente por "—" sem quebrar', () => {
    const item = { rentab_nominal_1a: 10 };
    const el = indicadoresUI.renderizarMatrizRentabilidade(item);
    const html = el.innerHTML;
    expect(html).toContain('10');
    // 5 outros valores faltantes → 5 "—"
    const dashCount = (html.match(/—/g) || []).length;
    expect(dashCount).toBeGreaterThanOrEqual(5);
  });

  test('inclui ARIA grid com headers claros', () => {
    const item = { rentab_nominal_1a: 10, rentab_real_1a: 7 };
    const el = indicadoresUI.renderizarMatrizRentabilidade(item);
    expect(el.getAttribute('role')).toBe('grid');
    expect(el.getAttribute('aria-label')).toContain('rentabilidade');
  });
});

describe('criarBotaoMatrizRentabilidade (RF-018)', () => {
  test('botão toggle "Detalhes" com aria-expanded', () => {
    const item = { rentab_nominal_1a: 10 };
    const btn = indicadoresUI.criarBotaoMatrizRentabilidade(item, 'XPML11');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toContain('XPML11');
    expect(btn.textContent.trim().toLowerCase()).toContain('detalhes');
  });

  test('clicar expande e mostra a matriz (alterna aria-expanded)', () => {
    const item = { rentab_nominal_1a: 10 };
    const btn = indicadoresUI.criarBotaoMatrizRentabilidade(item, 'XPML11');
    const tr = document.createElement('tr');
    tr.appendChild(btn);
    document.body.appendChild(tr);
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    // linha extra com a matriz deve existir
    const expanded = document.querySelector(`[id="${btn.getAttribute('aria-controls')}"]`);
    expect(expanded).not.toBeNull();
    expect(expanded.textContent).toContain('Nominal');
  });

  test('clicar novamente colapsa (toggle)', () => {
    const item = { rentab_nominal_1a: 10 };
    const btn = indicadoresUI.criarBotaoMatrizRentabilidade(item, 'XPML11');
    document.body.appendChild(btn);
    btn.click();
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector(`[id="${btn.getAttribute('aria-controls')}"]`)).toBeNull();
  });
});

// =====================================================================
// RF-019 — Filtro por classificação + ordenação numérica
// =====================================================================

describe('aplicarFiltroEOrdenacaoPosicoes (RF-019)', () => {
  function makeItem(t, cls, sev, pct, rentabReal1a) {
    return {
      ticker: t, classificacao: cls, severidade: sev,
      dy_vs_5a_pct: pct,
      rentab_real_1a: rentabReal1a !== undefined ? rentabReal1a : (pct !== null ? pct - 100 : null)
    };
  }
  const itens = [
    makeItem('AAA11', 'EM_LINHA', 'CONSISTENTE', 100, 0),
    makeItem('BBB11', 'ABAIXO', 'ATENCAO', 87, -13),
    makeItem('CCC11', 'ABAIXO', 'CRITICO', 60, -40),
    makeItem('DDD11', 'INSUFICIENTE', 'INDEFINIDO', null, null)
  ];

  test('filtro CONSISTENTE retorna só EM_LINHA', () => {
    const out = indicadoresUI.aplicarFiltroEOrdenacaoPosicoes(itens, { classificacao: 'CONSISTENTE' });
    expect(out.map(i => i.ticker)).toEqual(['AAA11']);
  });

  test('filtro CRITICO retorna só ABAIXO+CRITICO', () => {
    const out = indicadoresUI.aplicarFiltroEOrdenacaoPosicoes(itens, { classificacao: 'CRITICO' });
    expect(out.map(i => i.ticker)).toEqual(['CCC11']);
  });

  test('filtro SEM_DADOS retorna só INSUFICIENTE', () => {
    const out = indicadoresUI.aplicarFiltroEOrdenacaoPosicoes(itens, { classificacao: 'SEM_DADOS' });
    expect(out.map(i => i.ticker)).toEqual(['DDD11']);
  });

  test('filtro ATENCAO+CRITICO inclui ambos', () => {
    const out = indicadoresUI.aplicarFiltroEOrdenacaoPosicoes(itens, { classificacao: ['ATENCAO', 'CRITICO'] });
    expect(out.map(i => i.ticker).sort()).toEqual(['BBB11', 'CCC11']);
  });

  test('filtro null/vazio = TODOS (sem filtro)', () => {
    const out = indicadoresUI.aplicarFiltroEOrdenacaoPosicoes(itens, { classificacao: null });
    expect(out).toHaveLength(4);
  });

  test('ordenação numérica ascendente por dy_vs_5a_pct', () => {
    const out = indicadoresUI.aplicarFiltroEOrdenacaoPosicoes(itens, {
      ordem: 'dy_vs_5a_pct', direcao: 'asc'
    });
    // null vai pro fim
    expect(out.map(i => i.ticker)).toEqual(['CCC11', 'BBB11', 'AAA11', 'DDD11']);
  });

  test('ordenação numérica descendente por dy_vs_5a_pct', () => {
    const out = indicadoresUI.aplicarFiltroEOrdenacaoPosicoes(itens, {
      ordem: 'dy_vs_5a_pct', direcao: 'desc'
    });
    expect(out.map(i => i.ticker)).toEqual(['AAA11', 'BBB11', 'CCC11', 'DDD11']);
  });

  test('ordenação por rentab_real_1a ascendente', () => {
    const out = indicadoresUI.aplicarFiltroEOrdenacaoPosicoes(itens, {
      ordem: 'rentab_real_1a', direcao: 'asc'
    });
    expect(out.map(i => i.ticker)).toEqual(['CCC11', 'BBB11', 'AAA11', 'DDD11']);
  });

  test('sem ordem explícita = ordem original (estável)', () => {
    const out = indicadoresUI.aplicarFiltroEOrdenacaoPosicoes(itens, {});
    expect(out.map(i => i.ticker)).toEqual(['AAA11', 'BBB11', 'CCC11', 'DDD11']);
  });

  test('valores null vão para o fim em qualquer ordenação', () => {
    const out = indicadoresUI.aplicarFiltroEOrdenacaoPosicoes(itens, {
      ordem: 'dy_vs_5a_pct', direcao: 'asc', nulosNoFim: true
    });
    expect(out[out.length - 1].ticker).toBe('DDD11');
  });

  test('parseFiltroClassificacaoFromHash aceita múltiplos valores', () => {
    expect(indicadoresUI.parseFiltroClassificacaoFromHash('#posicoes?filtro=CRITICO,ATENCAO'))
      .toEqual(['ATENCAO', 'CRITICO']);
  });

  test('parseFiltroClassificacaoFromHash aceita valor único', () => {
    expect(indicadoresUI.parseFiltroClassificacaoFromHash('#posicoes?filtro=CONSISTENTE'))
      .toEqual(['CONSISTENTE']);
  });

  test('parseFiltroClassificacaoFromHash retorna null quando ausente', () => {
    expect(indicadoresUI.parseFiltroClassificacaoFromHash('#posicoes')).toBeNull();
  });

  test('parseFiltroClassificacaoFromHash ignora valores inválidos', () => {
    expect(indicadoresUI.parseFiltroClassificacaoFromHash('#posicoes?filtro=LIXO,CRITICO'))
      .toEqual(['CRITICO']);
  });

  test('gerarHashFiltro serializa lista de classificações', () => {
    expect(indicadoresUI.gerarHashFiltro(['CRITICO', 'ATENCAO'])).toBe('#posicoes?filtro=ATENCAO,CRITICO');
  });

  test('gerarHashFiltro com lista vazia = hash limpo', () => {
    expect(indicadoresUI.gerarHashFiltro([])).toBe('#posicoes');
  });
});

describe('renderizarFiltrosClassificacaoPosicoes (RF-019 — chips UI)', () => {
  test('renderiza chips clicáveis com aria-pressed', () => {
    const el = indicadoresUI.renderizarFiltrosClassificacaoPosicoes({
      ativo: ['ATENCAO', 'CRITICO']
    });
    expect(el.getAttribute('role')).toBe('group');
    const chips = el.querySelectorAll('button');
    expect(chips.length).toBeGreaterThanOrEqual(4);
    // ATENCAO deve estar pressionado
    const atencaoChip = Array.from(chips).find(c => c.dataset.value === 'ATENCAO');
    expect(atencaoChip.getAttribute('aria-pressed')).toBe('true');
  });

  test('lista os 4 estados canônicos + opção TODOS', () => {
    const el = indicadoresUI.renderizarFiltrosClassificacaoPosicoes({ ativo: [] });
    const chips = el.querySelectorAll('button');
    const values = Array.from(chips).map(c => c.dataset.value).sort();
    expect(values).toEqual(['ATENCAO', 'CONSISTENTE', 'CRITICO', 'SEM_DADOS', 'TODOS'].sort());
  });

  test('chip TODOS limpa o filtro', () => {
    const el = indicadoresUI.renderizarFiltrosClassificacaoPosicoes({ ativo: ['CRITICO'] });
    const todos = el.querySelector('button[data-value="TODOS"]');
    expect(todos).not.toBeNull();
    expect(todos.getAttribute('aria-pressed')).toBe('false');
  });
});

// =====================================================================
// RF-021 — Contadores completos no bloco de alerta
// =====================================================================

describe('renderizarBlocoAlertaDashboard — contadores RF-021', () => {
  test('inclui total_afetado, criticos, atencao, avaliada, sem_dados', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const itens = [
      // 2 CRITICOS
      { ticker: 'AAA11', classificacao: 'ABAIXO', severidade: 'CRITICO', dy_vs_5a_pct: 60 },
      { ticker: 'BBB11', classificacao: 'ACIMA',  severidade: 'CRITICO', dy_vs_5a_pct: 130 },
      // 1 ATENCAO
      { ticker: 'CCC11', classificacao: 'ABAIXO', severidade: 'ATENCAO', dy_vs_5a_pct: 87 },
      // 2 SEM DADOS (mas com posição aberta — entram na contagem avaliada? Não — são INSUFICIENTE)
      { ticker: 'DDD11', classificacao: 'INSUFICIENTE', severidade: 'INDEFINIDO', dy_vs_5a_pct: null },
      { ticker: 'EEE11', classificacao: 'INSUFICIENTE', severidade: 'INDEFINIDO', dy_vs_5a_pct: null },
      // 1 CONSISTENTE (avaliado, sem alerta)
      { ticker: 'FFF11', classificacao: 'EM_LINHA', severidade: 'CONSISTENTE', dy_vs_5a_pct: 100 }
    ];
    indicadoresUI.renderizarBlocoAlertaDashboard(mount, itens);
    const bloco = mount.querySelector('[data-bloco="indicadores-alerta"]');
    expect(bloco).not.toBeNull();
    // Texto deve incluir os 4 contadores
    const titulo = bloco.querySelector('.indicadores-alerta__titulo');
    expect(titulo.textContent).toMatch(/2 crítico/i);
    expect(titulo.textContent).toMatch(/1 atenção/i);
    // atributos data-* com contadores
    expect(bloco.dataset.totalAfetado).toBe('3');     // CRITICO + ATENCAO
    expect(bloco.dataset.criticos).toBe('2');
    expect(bloco.dataset.avaliada).toBe('6');          // todos foram avaliados
    expect(bloco.dataset.semDados).toBe('2');          // 2 INSUFICIENTE
  });
});

// =====================================================================
// RF-022 — Ação "Ver FIIs (N)" no bloco de alerta
// =====================================================================

describe('renderizarBlocoAlertaDashboard — ação Ver FIIs (RF-022)', () => {
  test('inclui botão "Ver FIIs (N)" com href para #posicoes filtrado', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const itens = [
      { ticker: 'AAA11', classificacao: 'ABAIXO', severidade: 'CRITICO', dy_vs_5a_pct: 60 },
      { ticker: 'BBB11', classificacao: 'ABAIXO', severidade: 'CRITICO', dy_vs_5a_pct: 65 }
    ];
    indicadoresUI.renderizarBlocoAlertaDashboard(mount, itens);
    const bloco = mount.querySelector('[data-bloco="indicadores-alerta"]');
    const acao = bloco.querySelector('[data-acao="ver-fiiis"]');
    expect(acao).not.toBeNull();
    expect(acao.tagName).toBe('A');
    expect(acao.getAttribute('href')).toBe('#posicoes?filtro=ATENCAO,CRITICO');
    expect(acao.getAttribute('aria-label')).toContain('2');
    expect(acao.textContent).toContain('Ver FIIs');
    expect(acao.textContent).toContain('(2)');
  });
});

// =====================================================================
// RF-023 — Estado vazio com ação específica
// =====================================================================

describe('renderizarBlocoAlertaDashboard — estado vazio RF-023', () => {
  test('sem FIIs avaliados: mostra "ainda não disponíveis" + ação de resync', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    // só FIIs SEM DADOS (nenhum pode ser avaliado)
    const itens = [
      { ticker: 'AAA11', classificacao: 'INSUFICIENTE', severidade: 'INDEFINIDO', dy_vs_5a_pct: null },
      { ticker: 'BBB11', classificacao: 'INSUFICIENTE', severidade: 'INDEFINIDO', dy_vs_5a_pct: null }
    ];
    const res = indicadoresUI.renderizarBlocoAlertaDashboard(mount, itens);
    // bloco principal de alerta NÃO é renderizado (sem CRITICO/ATENCAO)
    expect(res.renderizado).toBe(false);
    // mas o estado vazio ESPECÍFICO deve aparecer
    const vazio = mount.querySelector('[data-bloco="indicadores-vazio"]');
    expect(vazio).not.toBeNull();
    expect(vazio.textContent.toLowerCase()).toContain('não disponíveis');
    // ação para resync
    const acao = vazio.querySelector('[data-acao="atualizar-indicadores"]');
    expect(acao).not.toBeNull();
    expect(acao.tagName).toBe('BUTTON');
    expect(acao.getAttribute('aria-label').toLowerCase()).toContain('atualizar');
  });

  test('sem FIIs na carteira: também mostra estado vazio', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const res = indicadoresUI.renderizarBlocoAlertaDashboard(mount, []);
    expect(res.renderizado).toBe(false);
    const vazio = mount.querySelector('[data-bloco="indicadores-vazio"]');
    expect(vazio).not.toBeNull();
  });

  test('com FIIs CONSISTENTE: não renderiza alerta nem vazio (estado neutro)', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const itens = [
      { ticker: 'AAA11', classificacao: 'EM_LINHA', severidade: 'CONSISTENTE', dy_vs_5a_pct: 100 }
    ];
    const res = indicadoresUI.renderizarBlocoAlertaDashboard(mount, itens);
    expect(res.renderizado).toBe(false);
    // sem bloco vazio (estado é "tudo ok", não "indisponível")
    expect(mount.querySelector('[data-bloco="indicadores-vazio"]')).toBeNull();
  });
});