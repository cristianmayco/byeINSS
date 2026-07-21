import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderDashboardContractAlerts } from '../../renderer/js/contratos-ui.js';

const PAGES_SOURCE = readFileSync(
  new URL('../../renderer/js/pages.js', import.meta.url), 'utf8',
);

const DASHBOARD_HTML = `
  <!doctype html>
  <html lang="pt-BR">
    <body>
      <aside>
        <nav>
          <a href="#dashboard" class="nav-item active" data-route="dashboard">Dashboard</a>
        </nav>
        <span id="server-status"></span>
      </aside>
      <main>
        <section id="page-dashboard" class="page active"></section>
      </main>
      <div id="toast"></div>
    </body>
  </html>
`;

let dom;
let window;
let pagesApi;
let contratosUIStubs;

async function flush(iterations = 16) {
  for (let i = 0; i < iterations; i += 1) await Promise.resolve();
}

function defaultResponses() {
  return {
    '/api/dashboard/resumo': {
      patrimonio: 100000, ganho_capital: 5000, variacao_pct: 5,
      valor_investido: 95000, proventos_12m: 8000, dy_carteira_12m: 8,
      por_tipo: { FII: 60, ACAO: 40 },
      posicoes: [
        { ticker: 'HGLG11', qtd: 100, preco_medio: 150, preco_atual: 165, saldo: 16500, variacao_pct: 10, pct_carteira: 30 },
        { ticker: 'MXRF11', qtd: 0, preco_medio: 0, preco_atual: 10, saldo: 0, variacao_pct: 0, pct_carteira: 0 },
        { ticker: 'BTLG11', qtd: 50, preco_medio: 100, preco_atual: 105, saldo: 5250, variacao_pct: 5, pct_carteira: 10 },
      ],
    },
    '/api/dashboard/evolucao': [],
    '/api/dashboard/proventos-mensais': [],
    '/api/dashboard/alertas': [],
    '/api/dashboard/alertas-vencimento': {
      janela: 24,
      itens: [
        { ticker: 'HGLG11', meses: 18, tipo_reajuste: 'IGPM' },
        { ticker: 'BTLG11', meses: 22, tipo_reajuste: 'IPCA' },
        { ticker: 'MXRF11', meses: 14, tipo_reajuste: 'FIXO' },
      ],
    },
  };
}

function mountPages({ apiResponses = {}, contratosUI = {} } = {}) {
  dom = new JSDOM(DASHBOARD_HTML, {
    url: 'http://localhost/#dashboard',
    runScripts: 'outside-only',
  });
  window = dom.window;

  window.brl = v => `R$ ${Number(v || 0).toFixed(2)}`;
  window.pct = v => `${Number(v || 0).toFixed(2)}%`;
  window.escapeHtml = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  window.todayISO = () => '2026-07-20';
  window.toast = vi.fn();
  window.chartsToDestroy = [];
  window.destroyCharts = vi.fn();
  window.Chart = vi.fn(function Chart() { this.destroy = vi.fn(); });
  window.setInterval = vi.fn(() => 0);
  window.clearInterval = vi.fn();
  window.setTimeout = vi.fn(() => 0);
  window.clearTimeout = vi.fn();
  window.confirm = vi.fn(() => true);
  window.console.error = vi.fn();

  window.parseHashRoute = vi.fn((hash) => {
    const h = String(hash || '');
    const match = /^#fii\/([A-Za-z0-9]+)$/.exec(h);
    if (match) return { page: 'fii-detail', nav: 'posicoes', params: { ticker: match[1].toUpperCase() } };
    if (h === '#dashboard') return { page: 'dashboard', nav: 'dashboard', params: {} };
    return { page: 'dashboard', nav: 'dashboard', params: {} };
  });
  window.normalizeFiiTicker = v => String(v || '').trim().toUpperCase();

  const responses = { ...defaultResponses(), ...apiResponses };
  const apiImpl = vi.fn(async (path, options = {}) => {
    if (path in responses) {
      const value = responses[path];
      return typeof value === 'function' ? value(options) : value;
    }
    throw new Error(`Sem stub para ${path}`);
  });
  window.api = apiImpl;
  pagesApi = apiImpl;

  contratosUIStubs = {
    getContractApplicability: vi.fn(() => ({ applicable: true, reason: 'TIJOLO' })),
    deriveContractViewState: vi.fn(() => ({ status: 'success' })),
    formatContractDate: vi.fn(() => '15/01/2027'),
    formatAdjustment: vi.fn(() => 'IGP-M'),
    buildContractUpdatePayload: vi.fn((v) => v),
    createContractCard: vi.fn(() => window.document.createElement('section')),
    openContractEditModal: vi.fn(() => ({ dialog: window.document.createElement('div'), close: () => {} })),
    renderDashboardContractAlerts: contratosUI.renderDashboardContractAlerts
      || vi.fn((container, { items, janela }) => {
        // Stub de referência: cria card real se houver itens
        container.innerHTML = '';
        if (!Array.isArray(items) || items.length === 0) return;

        const card = window.document.createElement('div');
        card.setAttribute('role', 'alert');
        card.setAttribute('aria-live', 'polite');
        card.dataset.janela = String(janela ?? '');

        const title = window.document.createElement('h2');
        title.className = 'alerts-title';
        title.textContent = `${items.length} FIIs com vencimento < ${janela}m`;
        card.appendChild(title);

        const list = window.document.createElement('ul');
        list.className = 'alerts-list';
        items.forEach((item) => {
          const li = window.document.createElement('li');
          li.className = 'alert-item';

          if (typeof item.ticker === 'string' && /^[A-Z]{4}11$/.test(item.ticker)) {
            const a = window.document.createElement('a');
            a.href = `#fii/${item.ticker}`;
            a.textContent = item.ticker;
            li.appendChild(a);
          } else {
            const span = window.document.createElement('span');
            span.textContent = String(item.ticker ?? '');
            span.dataset.inert = 'true';
            li.appendChild(span);
          }

          if (typeof item.meses === 'number' && item.meses < 0) {
            const tag = window.document.createElement('span');
            tag.className = 'alert-tag';
            tag.setAttribute('aria-label', 'Vencimento em data passada ou inconsistente');
            tag.textContent = 'Data passada';
            li.appendChild(tag);
          } else {
            const tag = window.document.createElement('span');
            tag.className = 'alert-tag';
            tag.setAttribute('aria-label', `Reajuste ${item.tipo_reajuste ?? ''}`);
            tag.textContent = `${item.meses ?? '—'}m · ${item.tipo_reajuste ?? '—'}`;
            li.appendChild(tag);
          }
          list.appendChild(li);
        });
        card.appendChild(list);
        container.appendChild(card);
      }),
  };

  window.byeINSSContratosUI = contratosUIStubs;

  window.eval(PAGES_SOURCE);
  return window;
}

beforeEach(() => { dom = undefined; });
afterEach(() => { dom?.window.close(); dom = undefined; });

describe('renderDashboard + alertas de vencimento', () => {
  test('chama /api/dashboard/alertas-vencimento junto dos endpoints existentes', async () => {
    mountPages();
    const el = window.document.getElementById('page-dashboard');
    await window.renderDashboard(el);
    await flush();

    const calls = pagesApi.mock.calls.map(c => c[0]);
    expect(calls).toContain('/api/dashboard/alertas-vencimento');
    expect(calls).toContain('/api/dashboard/resumo');
    expect(calls).toContain('/api/dashboard/evolucao');
    expect(calls).toContain('/api/dashboard/proventos-mensais');
    expect(calls).toContain('/api/dashboard/alertas');
  });

  test('falha isolada do endpoint de contratos não derruba KPIs/gráficos', async () => {
    mountPages();
    window.api = vi.fn(async (path) => {
      if (path === '/api/dashboard/alertas-vencimento') throw new Error('boom');
      if (path === '/api/dashboard/resumo') {
        return defaultResponses()['/api/dashboard/resumo'];
      }
      if (path === '/api/dashboard/evolucao') return [];
      if (path === '/api/dashboard/proventos-mensais') return [];
      if (path === '/api/dashboard/alertas') return [];
      throw new Error('Sem stub');
    });

    const el = window.document.getElementById('page-dashboard');
    await window.renderDashboard(el);
    await flush();

    // KPIs continuam existindo mesmo sem o card de vencimentos.
    expect(el.textContent).toMatch(/Patrimônio|Dashboard/i);
    expect(window.console.error).toHaveBeenCalled();
  });

  test('interseita itens com posicoes.qtd > 0 preservando ordem do backend', async () => {
    mountPages();
    const el = window.document.getElementById('page-dashboard');
    await window.renderDashboard(el);
    await flush();

    const calls = contratosUIStubs.renderDashboardContractAlerts.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const args = calls.at(-1);
    const tickersRenderizados = args[1].items.map(i => i.ticker);
    expect(tickersRenderizados).toEqual(['HGLG11', 'BTLG11']);
    expect(tickersRenderizados).not.toContain('MXRF11');
  });

  test('omite card quando não há alerta de posição aberta', async () => {
    mountPages({
      apiResponses: {
        '/api/dashboard/alertas-vencimento': { janela: 24, itens: [] },
      },
    });
    const el = window.document.getElementById('page-dashboard');
    await window.renderDashboard(el);
    await flush();

    const lastCall = contratosUIStubs.renderDashboardContractAlerts.mock.calls.at(-1);
    expect(lastCall[1].items).toEqual([]);
  });

  test('renders sobrepostos descartam a resposta antiga que chega por último', async () => {
    const staleAlert = {
      janela: 24,
      itens: [{ ticker: 'HGLG11', meses: 18, tipo_reajuste: 'IGPM' }],
    };
    const freshAlert = {
      janela: 24,
      itens: [
        { ticker: 'BTLG11', meses: 12, tipo_reajuste: 'IPCA' },
        { ticker: 'HGLG11', meses: 22, tipo_reajuste: 'IGPM' },
      ],
    };

    let resolveStale;
    let resolveFresh;
    const stalePromise = new Promise(resolve => { resolveStale = resolve; });
    const freshPromise = new Promise(resolve => { resolveFresh = resolve; });
    let alertRequestCount = 0;

    mountPages();
    window.api = vi.fn(async path => {
      if (path === '/api/dashboard/alertas-vencimento') {
        alertRequestCount += 1;
        return alertRequestCount === 1 ? stalePromise : freshPromise;
      }
      const defaults = defaultResponses();
      if (path in defaults) return defaults[path];
      throw new Error(`Sem stub para ${path}`);
    });

    const el = window.document.getElementById('page-dashboard');
    contratosUIStubs.renderDashboardContractAlerts.mockClear();
    const firstRender = window.renderDashboard(el);
    await Promise.resolve();
    const secondRender = window.renderDashboard(el);

    resolveFresh(freshAlert);
    await secondRender;
    await flush();

    resolveStale(staleAlert);
    await firstRender;
    await flush();

    const lastCall = contratosUIStubs.renderDashboardContractAlerts.mock.calls.at(-1);
    expect(lastCall[1].items.map(item => item.ticker)).toEqual(['BTLG11', 'HGLG11']);
    expect(el.querySelector('.alerts-title')?.textContent).toMatch(/^2 FIIs/);
  });
});

describe('renderDashboardContractAlerts (DOM real)', () => {
  function mountHelper() {
    mountPages();
    return renderDashboardContractAlerts;
  }

  test('lista vazia: container fica vazio/oculto, helper não insere card', () => {
    const helper = mountHelper();
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);

    helper(container, { items: [], janela: 24 });

    expect(container.children.length).toBe(0);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  test('com itens: cria card role=alert aria-live=polite com headline contendo count + janela', () => {
    const helper = mountHelper();
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);

    helper(container, {
      janela: 24,
      items: [
        { ticker: 'HGLG11', meses: 18, tipo_reajuste: 'IGPM' },
        { ticker: 'BTLG11', meses: 22, tipo_reajuste: 'IPCA' },
      ],
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert.getAttribute('aria-live')).toBe('polite');
    expect(alert.querySelector('.alerts-title').textContent).toMatch(/2/);
    expect(alert.querySelector('.alerts-title').textContent).toMatch(/24/);
  });

  test('preserva ordem dos itens vinda do input', () => {
    const helper = mountHelper();
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);

    helper(container, {
      janela: 24,
      items: [
        { ticker: 'AAAA11', meses: 10, tipo_reajuste: 'IGPM' },
        { ticker: 'BBBB11', meses: 5, tipo_reajuste: 'IPCA' },
        { ticker: 'CCCC11', meses: 2, tipo_reajuste: 'FIXO' },
      ],
    });

    const links = container.querySelectorAll('a');
    expect(Array.from(links).map(a => a.textContent)).toEqual(['AAAA11', 'BBBB11', 'CCCC11']);
  });

  test('apenas tickers estritos ^[A-Z]{4}11$ viram link #fii/TICKER', () => {
    const helper = mountHelper();
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);

    helper(container, {
      janela: 24,
      items: [
        { ticker: 'HGLG11', meses: 18, tipo_reajuste: 'IGPM' },
        { ticker: 'PETR4', meses: 6, tipo_reajuste: 'IGPM' },
        { ticker: 'hglg11', meses: 6, tipo_reajuste: 'IGPM' },
        { ticker: 'HGLG1111', meses: 6, tipo_reajuste: 'IGPM' },
        { ticker: '12345', meses: 6, tipo_reajuste: 'IGPM' },
      ],
    });

    const links = container.querySelectorAll('a');
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe('#fii/HGLG11');
    expect(container.textContent).toMatch(/PETR4/);
    expect(container.querySelector('img')).toBeNull();
  });

  test('ticker hostil permanece como texto, sem elementos executáveis', () => {
    const helper = mountHelper();
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);

    helper(container, {
      janela: 24,
      items: [
        { ticker: '<img src=x onerror=alert(1)>', meses: 6, tipo_reajuste: 'IGPM' },
      ],
    });

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('img');
  });

  test('meses negativos viram chip textual com aria-label "Data passada ou inconsistente"', () => {
    const helper = mountHelper();
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);

    helper(container, {
      janela: 24,
      items: [{ ticker: 'HGLG11', meses: -3, tipo_reajuste: 'IGPM' }],
    });

    const chips = container.querySelectorAll('.alert-tag');
    expect(chips.length).toBeGreaterThan(0);
    const chip = chips[0];
    expect(chip.textContent).toMatch(/passada|inconsistent/i);
    expect(chip.getAttribute('aria-label')).toMatch(/passada|inconsistente/i);
    expect(chips[0].getAttribute('aria-label')).not.toBe('');
  });

  test('chips de tipo descrevem o índice via aria-label (não dependem só de cor)', () => {
    const helper = mountHelper();
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);

    helper(container, {
      janela: 24,
      items: [{ ticker: 'HGLG11', meses: 18, tipo_reajuste: 'IGPM' }],
    });

    const chip = container.querySelector('.alert-tag');
    expect(chip).toBeTruthy();
    expect(chip.getAttribute('aria-label')).toMatch(/IGP-M|IGPM|reajuste/i);
    expect(chip.textContent).toMatch(/IGP-M|IGPM/);
  });
});