// TDD Red Phase — PRD 03 RF-012, RF-013, RF-014 (gráfico empilhado),
// RF-021 (badge), RF-010 (modal em lote com parcelas).

// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import {
  filtrarPorTipos,
  labelTipo,
  corTipo,
  badgeTipo,
  emptyStateProventos,
  renderFiltroTipos,
  lerTiposDoHash,
  serializarTiposParaHash,
  buildChartStackedDataset,
  renderLinhasBatch
} from '../../renderer/js/proventos-ui.js';

afterEach(() => { document.body.replaceChildren(); });

describe('filtrarPorTipos — RF-012', () => {
  const proventos = [
    { ticker: 'HGLG11', tipo: 'DIVIDENDO', valor_por_cota: 0.80, data_pagto: '2026-07-20' },
    { ticker: 'XPML11', tipo: 'AMORTIZACAO', valor_por_cota: 0.20, data_pagto: '2026-07-20' },
    { ticker: 'KNIP11', tipo: 'RENDIMENTO', valor_por_cota: 1.05, data_pagto: '2026-07-25' },
    { ticker: 'BCFF11', tipo: 'BONIFICACAO', valor_por_cota: 0.00, data_pagto: '2026-07-15' }
  ];

  it('null = sem filtro, retorna todos', () => {
    expect(filtrarPorTipos(proventos, null).length).toBe(4);
  });
  it('Set vazio = sem filtro (Todos)', () => {
    expect(filtrarPorTipos(proventos, new Set()).length).toBe(4);
  });
  it('Array com AMORTIZACAO retorna só amortizações', () => {
    expect(filtrarPorTipos(proventos, ['AMORTIZACAO']).map(p => p.tipo))
      .toEqual(['AMORTIZACAO']);
  });
  it('Combinação DISTRIBUIVEIS = DIVIDENDO + RENDIMENTO', () => {
    const r = filtrarPorTipos(proventos, ['DIVIDENDO', 'RENDIMENTO']);
    expect(r.length).toBe(2);
    expect(r.every(p => ['DIVIDENDO', 'RENDIMENTO'].includes(p.tipo))).toBe(true);
  });
});

describe('labelTipo + corTipo + badgeTipo — RF-021 (texto+cor)', () => {
  it('label canônico em português', () => {
    expect(labelTipo('DIVIDENDO')).toBe('Dividendo');
    expect(labelTipo('AMORTIZACAO')).toBe('Amortização');
    expect(labelTipo('BONIFICACAO')).toBe('Bonificação');
    expect(labelTipo('RENDIMENTO')).toBe('Rendimento');
  });
  it('corTipo devolve palette por tipo', () => {
    expect(corTipo('DIVIDENDO').border).toMatch(/^#/);
    expect(corTipo('AMORTIZACAO').border).toMatch(/^#/);
  });
  it('badgeTipo inclui texto + cor + role=status (RF a11y)', () => {
    const b = badgeTipo('DIVIDENDO');
    expect(b).toContain('Dividendo');
    expect(b).toContain('role="status"');
    expect(b).toContain('aria-label="Tipo Dividendo"');
    expect(b).toMatch(/background:/);
  });
  it('badgeTipo para tipo desconhecido → "Desconhecido"', () => {
    const b = badgeTipo('XYZ');
    expect(b).toContain('Desconhecido');
  });
});

describe('emptyStateProventos — distingue geral de filtro', () => {
  it('empty geral quando não há tipos selecionados', () => {
    const html = emptyStateProventos(new Set());
    expect(html).toMatch(/Sem proventos registrados/);
  });
  it('empty do filtro quando há tipos selecionados', () => {
    const html = emptyStateProventos(new Set(['AMORTIZACAO']));
    expect(html).toMatch(/Nenhum provento encontrado/);
  });
});

describe('renderFiltroTipos — RF-012, a11y aria-pressed', () => {
  it('5 botões: Todos / Dividendos / Rendimentos / Amortizações / Bonificações', () => {
    const html = renderFiltroTipos(new Set());
    expect(html.match(/data-tipo="/g).length).toBe(5);
    expect(html).toContain('Todos');
    expect(html).toContain('Dividendos');
    expect(html).toContain('Amortizações');
  });
  it('marca aria-pressed=true para tipos ativos', () => {
    const html = renderFiltroTipos(new Set(['AMORTIZACAO']));
    expect(html).toContain('data-tipo="AMORTIZACAO"');
    // AMORTIZACAO deve ter aria-pressed=true
    const amortBlock = html.match(/data-tipo="AMORTIZACAO"[^>]+aria-pressed="([^"]+)"/);
    expect(amortBlock?.[1]).toBe('true');
  });
  it('Quando set vazio, "Todos" recebe aria-pressed=true', () => {
    const html = renderFiltroTipos(new Set());
    expect(html).toMatch(/data-tipo="__all"[^>]+aria-pressed="true"/);
  });
});

describe('hash parsing — RF-013', () => {
  it('lerTiposDoHash: tipos inválidos são ignorados silenciosamente', () => {
    const s = lerTiposDoHash('#proventos?tipos=DIVIDENDO,XYZ,JCP');
    expect([...s]).toEqual(['DIVIDENDO']);
  });
  it('lerTiposDoHash: combinação válida → Set com múltiplos', () => {
    const s = lerTiposDoHash('#proventos?tipos=DIVIDENDO,AMORTIZACAO');
    expect(s.has('DIVIDENDO')).toBe(true);
    expect(s.has('AMORTIZACAO')).toBe(true);
    expect(s.size).toBe(2);
  });
  it('serializarTiposParaHash: vazio → string vazia', () => {
    expect(serializarTiposParaHash(new Set())).toBe('');
  });
  it('serializarTiposParaHash: serializa como query string', () => {
    expect(serializarTiposParaHash(new Set(['DIVIDENDO', 'AMORTIZACAO'])))
      .toBe('?tipos=DIVIDENDO,AMORTIZACAO');
  });
});

describe('buildChartStackedDataset — RF-014 gráfico empilhado', () => {
  it('gera 4 datasets (4 tipos) com labels de mês', () => {
    const serie = [
      { mes: '2026-07', por_tipo: { DIVIDENDO: 80, RENDIMENTO: 32, AMORTIZACAO: 20, BONIFICACAO: 0 } },
      { mes: '2026-08', por_tipo: { DIVIDENDO: 50, RENDIMENTO: 0, AMORTIZACAO: 15, BONIFICACAO: 10 } }
    ];
    const d = buildChartStackedDataset(serie);
    expect(d.labels).toEqual(['2026-07', '2026-08']);
    expect(d.datasets).toHaveLength(4);
    expect(d.datasets[0].label).toBe('Dividendos');
    expect(d.datasets[2].label).toBe('Amortizações');
    expect(d.datasets[2].data).toEqual([20, 15]);
  });

  it('tolera série vazia', () => {
    const d = buildChartStackedDataset([]);
    expect(d.labels).toEqual([]);
    expect(d.datasets).toHaveLength(4);
  });
});

describe('renderLinhasBatch — RF-010 modal em lote com parcelas', () => {
  it('permite duas parcelas para o mesmo FII (RF-010)', () => {
    const linhas = [
      { parcela_id: 'p1', ticker: 'HGLG11', tipo: 'DIVIDENDO', valor_por_cota: 0.80 },
      { parcela_id: 'p2', ticker: 'HGLG11', tipo: 'AMORTIZACAO', valor_por_cota: 0.20 }
    ];
    const html = renderLinhasBatch(linhas);
    expect(html).toContain('HGLG11');
    // Duas parcelas → 2 <tr>
    expect(html.match(/data-parcela-id="/g).length).toBe(2);
    expect(html).toMatch(/data-parcela="p1"/);
    expect(html).toMatch(/data-parcela="p2"/);
    // Select com 4 opções por linha
    const selects = html.match(/<select /g);
    expect(selects.length).toBe(2);
  });
  it('lista vazia → empty state', () => {
    const html = renderLinhasBatch([]);
    expect(html).toMatch(/Nenhuma parcela/);
  });

  it('SECURITY: escapar ticker e parcela_id contra XSS injection', () => {
    const evil = '" onerror=alert(1) data-x="';
    const linhas = [
      { parcela_id: `p${evil}`, ticker: `EVIL<script>alert('x')</script>`, tipo: 'DIVIDENDO', valor_por_cota: 0.5 }
    ];
    const html = renderLinhasBatch(linhas);
    // O ticker malicioso não pode vazar como atributo nem como conteúdo aberto de tag
    expect(html).not.toMatch(/<script>alert\('x'\)<\/script>/);
    // Aspas no parcela_id devem estar escapadas
    expect(html).toMatch(/data-parcela-id="p&quot; onerror=alert\(1\) data-x=&quot;/);
    // O ticker aparece no strong, mas escapado
    expect(html).toContain('EVIL&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;');
  });
});

describe('ProventosUI — exposição global window.ProventosUI (fix Playwright #2)', () => {
  it('executado como <script> regular define window.ProventosUI', async () => {
    // Reproduz exatamente o que acontece quando o renderer carrega
    // <script src="js/proventos-ui.js">: nenhum export ESM, mas o
    // IIFE deve anexar a API em window.ProventosUI.
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const code = fs.readFileSync(
      path.join(__dirname, '..', '..', 'renderer', 'js', 'proventos-ui.js'),
      'utf8'
    );
    const scriptEl = document.createElement('script');
    scriptEl.textContent = code;
    document.head.appendChild(scriptEl);

    expect(window.ProventosUI).toBeDefined();
    expect(typeof window.ProventosUI.renderFiltroTipos).toBe('function');
    expect(typeof window.ProventosUI.badgeTipo).toBe('function');
    expect(typeof window.ProventosUI.buildChartStackedDataset).toBe('function');
    expect(typeof window.ProventosUI.renderLinhasBatch).toBe('function');
    expect(typeof window.ProventosUI.escapeHtml).toBe('function');

    // Funciona end-to-end: usado do jeito que pages.js faz
    const filtros = window.ProventosUI.renderFiltroTipos(new Set(['AMORTIZACAO']));
    expect(filtros).toContain('data-tipo="AMORTIZACAO"');
    expect(filtros).toMatch(/aria-pressed="true"/);
  });
});
