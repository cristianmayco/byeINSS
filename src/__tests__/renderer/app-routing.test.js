import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const APP_SOURCE = readFileSync(new URL('../../renderer/js/app.js', import.meta.url), 'utf8');

const DASHBOARD_ROUTE = {
  page: 'dashboard',
  nav: 'dashboard',
  params: {},
};

const RENDERER_NAMES = [
  'renderDashboard',
  'renderPosicoes',
  'renderLancamentos',
  'renderProventos',
  'renderPrecoTeto',
  'renderSimulador',
  'renderFire',
  'renderCenarios',
  'renderImportar',
  'renderConfig',
  'renderFiiDetail',
];

let dom;

function createMarkup() {
  return `
    <!doctype html>
    <html lang="pt-BR">
      <body>
        <aside>
          <nav>
            <a href="#dashboard" class="nav-item active" data-route="dashboard" aria-current="page">Dashboard</a>
            <a href="#posicoes" class="nav-item" data-route="posicoes">Posições</a>
          </nav>
          <span id="server-status"></span>
        </aside>
        <main class="content">
          <section id="page-dashboard" class="page active"></section>
          <section id="page-posicoes" class="page"></section>
          <section id="page-fii-detail" class="page"></section>
        </main>
        <div id="toast"></div>
      </body>
    </html>
  `;
}

function installRendererStubs(window) {
  const renderers = {};

  for (const name of RENDERER_NAMES) {
    const renderer = vi.fn((el, params) => {
      if (!el) return;
      const label = name === 'renderFiiDetail'
        ? `FII ${params?.ticker || ''}`
        : name.replace(/^render/, '');
      el.innerHTML = `<h1 class="page-title" tabindex="-1">${label}</h1>`;
    });
    renderers[name] = renderer;
    window[name] = renderer;
  }

  return renderers;
}

function installRouteStub(window) {
  const parseHashRoute = vi.fn((inputHash) => {
    const hash = String(inputHash || '');
    if (/^#fii\/hglg11$/i.test(hash)) {
      return {
        page: 'fii-detail',
        nav: 'posicoes',
        params: { ticker: 'HGLG11' },
      };
    }
    if (hash === '#dashboard') return DASHBOARD_ROUTE;
    return DASHBOARD_ROUTE;
  });

  window.parseHashRoute = parseHashRoute;
  window.normalizeFiiTicker = value => String(value || '').trim().toUpperCase();
  return parseHashRoute;
}

function mountApp(initialHash) {
  dom = new JSDOM(createMarkup(), {
    url: `http://localhost/${initialHash}`,
    runScripts: 'outside-only',
  });

  const { window } = dom;
  const renderers = installRendererStubs(window);
  const parseHashRoute = installRouteStub(window);

  // The app boot performs a health check and installs a periodic health timer.
  window.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
  }));
  window.electronAPI = {
    getPort: vi.fn(async () => 4317),
  };
  window.setInterval = vi.fn(() => 0);
  window.clearInterval = vi.fn();
  window.setTimeout = vi.fn(() => 0);
  window.clearTimeout = vi.fn();
  window.Chart = vi.fn(function Chart() {
    this.destroy = vi.fn();
  });
  window.confirm = vi.fn(() => true);
  window.console.error = vi.fn();

  window.eval(APP_SOURCE);

  return { window, renderers, parseHashRoute };
}

async function flushAsyncWork(iterations = 12) {
  // Resolve the health check, init navigation, renderer, and focus microtasks.
  for (let i = 0; i < iterations; i += 1) await Promise.resolve();
}

async function dispatchHashNavigation(window, hash) {
  window.history.pushState({}, '', hash);
  window.dispatchEvent(new window.Event('hashchange'));
  await flushAsyncWork();
}

describe('roteamento do renderer', () => {
  beforeEach(() => {
    dom = undefined;
  });

  afterEach(() => {
    dom?.window.close();
    dom = undefined;
  });

  test('hash de FII ativa detalhe, chama o renderer com ticker e destaca Posições', async () => {
    const { window, renderers } = mountApp('#fii/HGLG11');
    await flushAsyncWork();

    const fiiPage = window.document.getElementById('page-fii-detail');
    const posicoes = window.document.querySelector('[data-route="posicoes"]');
    const dashboard = window.document.querySelector('[data-route="dashboard"]');

    expect(fiiPage.classList.contains('active')).toBe(true);
    expect(renderers.renderFiiDetail).toHaveBeenCalledTimes(1);
    expect(renderers.renderFiiDetail).toHaveBeenCalledWith(
      fiiPage,
      { ticker: 'HGLG11' },
    );
    expect(posicoes.classList.contains('active')).toBe(true);
    expect(posicoes.getAttribute('aria-current')).toBe('page');
    expect(dashboard.classList.contains('active')).toBe(false);
    expect(dashboard.getAttribute('aria-current')).toBeNull();
    expect(window.document.activeElement).toBe(fiiPage.querySelector('.page-title'));
  });

  test('navegar para outra rota remove aria-current stale da navegação anterior', async () => {
    const { window } = mountApp('#fii/HGLG11');
    await flushAsyncWork();

    await dispatchHashNavigation(window, '#dashboard');

    const dashboardPage = window.document.getElementById('page-dashboard');
    const dashboard = window.document.querySelector('[data-route="dashboard"]');
    const posicoes = window.document.querySelector('[data-route="posicoes"]');

    expect(dashboardPage.classList.contains('active')).toBe(true);
    expect(dashboard.classList.contains('active')).toBe(true);
    expect(dashboard.getAttribute('aria-current')).toBe('page');
    expect(posicoes.classList.contains('active')).toBe(false);
    expect(posicoes.getAttribute('aria-current')).toBeNull();
  });

  test('rota desconhecida ativa Dashboard sem lançar exceção', async () => {
    const { window } = mountApp('#rota-desconhecida');
    await flushAsyncWork();

    const dashboardPage = window.document.getElementById('page-dashboard');
    const dashboard = window.document.querySelector('[data-route="dashboard"]');

    expect(dashboardPage.classList.contains('active')).toBe(true);
    expect(dashboard.getAttribute('aria-current')).toBe('page');
    expect(window.document.querySelectorAll('.page.active')).toHaveLength(1);
    expect(window.console.error).not.toHaveBeenCalled();
  });
});
