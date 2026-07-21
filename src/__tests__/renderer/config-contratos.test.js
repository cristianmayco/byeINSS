import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const PAGES_SOURCE = readFileSync(
  new URL('../../renderer/js/pages.js', import.meta.url), 'utf8',
);

const CONFIG_HTML = `
  <!doctype html>
  <html lang="pt-BR">
    <body>
      <aside>
        <nav>
          <a href="#config" class="nav-item" data-route="config">Config</a>
        </nav>
      </aside>
      <main>
        <section id="page-config" class="page"></section>
      </main>
      <div id="toast"></div>
    </body>
  </html>
`;

let dom;
let window;
let pagesApi;
let lastPutBody;

async function flush(iterations = 12) {
  for (let i = 0; i < iterations; i += 1) await Promise.resolve();
}

function mountConfig({ apiResponses = {}, contratosUI = {} } = {}) {
  dom = new JSDOM(CONFIG_HTML, {
    url: 'http://localhost/#config',
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

  window.parseHashRoute = vi.fn((hash) => ({ page: 'config', nav: 'config', params: {} }));
  window.normalizeFiiTicker = v => String(v || '').trim().toUpperCase();

  const responses = {
    '/api/config': {
      pct_muito_barato: 0.7, pct_barato: 0.9, pct_caro: 1.1,
      reajuste_aporte_anual: 10, reajuste_mes_inicio: 1, taxa_anual_padrao: 12,
      alerta_concentracao_pct: 25, alerta_dy_limite: 18,
      vencimento_janela_alerta_meses: 24,
      ...(apiResponses['/api/config'] || {}),
    },
    ...apiResponses,
  };

  lastPutBody = null;
  const apiImpl = vi.fn(async (path, options = {}) => {
    if (path === '/api/config' && options.method === 'PUT') {
      lastPutBody = options.body || null;
      return { ok: true };
    }
    if (path in responses) return responses[path];
    throw new Error(`Sem stub para ${path}`);
  });
  window.api = apiImpl;
  pagesApi = apiImpl;

  window.byeINSSContratosUI = {
    getContractApplicability: vi.fn(() => ({ applicable: true })),
    deriveContractViewState: vi.fn(() => ({ status: 'success' })),
    formatContractDate: vi.fn(() => '—'),
    formatAdjustment: vi.fn(() => '—'),
    buildContractUpdatePayload: vi.fn((v) => v),
    createContractCard: vi.fn(() => window.document.createElement('section')),
    openContractEditModal: vi.fn(() => ({ dialog: window.document.createElement('div'), close: () => {} })),
    renderDashboardContractAlerts: vi.fn(),
    ...contratosUI,
  };

  window.eval(PAGES_SOURCE);
  return window;
}

beforeEach(() => { dom = undefined; });
afterEach(() => { dom?.window.close(); dom = undefined; });

describe('renderConfig — janela de alerta de vencimento', () => {
  test('carrega valor do backend no input #c-vencimento-janela como number com min=1 step=1 e label associado', async () => {
    mountConfig({ apiResponses: { '/api/config': { vencimento_janela_alerta_meses: 36 } } });
    const el = window.document.getElementById('page-config');
    await window.renderConfig(el);
    await flush();

    const input = el.querySelector('#c-vencimento-janela');
    expect(input).toBeTruthy();
    expect(input.tagName.toLowerCase()).toBe('input');
    expect(input.getAttribute('type')).toBe('number');
    expect(input.getAttribute('min')).toBe('1');
    expect(input.getAttribute('step')).toBe('1');
    expect(input.value).toBe('36');

    const label = el.querySelector('label[for="c-vencimento-janela"]');
    expect(label).toBeTruthy();
    expect(label.textContent.trim().length).toBeGreaterThan(0);

    const help = el.querySelector('[aria-describedby="#c-vencimento-janela-help"], #c-vencimento-janela-help, [data-help-for="c-vencimento-janela"]');
    expect(help).toBeTruthy();
  });

  test('valor numérico positivo no PUT', async () => {
    mountConfig();
    const el = window.document.getElementById('page-config');
    await window.renderConfig(el);
    await flush();

    const input = el.querySelector('#c-vencimento-janela');
    input.value = '18';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));

    const btn = el.querySelector('#btn-save-config');
    btn.click();
    await flush();

    expect(lastPutBody).toBeTruthy();
    expect(lastPutBody.vencimento_janela_alerta_meses).toBe(18);
    expect(input.getAttribute('aria-invalid')).not.toBe('true');
  });

  test.each([
    ['zero', '0'],
    ['negativo', '-5'],
    ['fracionário', '12.5'],
    ['vazio', ''],
    ['não-numérico', 'abc'],
  ])('valor %s bloqueia PUT, marca aria-invalid=true, foca o campo e mostra erro', async (_label, value) => {
    mountConfig();
    const el = window.document.getElementById('page-config');
    await window.renderConfig(el);
    await flush();

    const input = el.querySelector('#c-vencimento-janela');
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));

    const btn = el.querySelector('#btn-save-config');
    btn.click();
    await flush();

    expect(lastPutBody).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(window.document.activeElement).toBe(input);
    expect(window.toast).toHaveBeenCalled();
  });

  test('após valor inválido e depois valor válido, save limpa aria-invalid e mostra sucesso', async () => {
    mountConfig();
    const el = window.document.getElementById('page-config');
    await window.renderConfig(el);
    await flush();

    const input = el.querySelector('#c-vencimento-janela');
    const btn = el.querySelector('#btn-save-config');

    input.value = 'abc';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    btn.click();
    await flush();
    expect(input.getAttribute('aria-invalid')).toBe('true');

    input.value = '24';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    btn.click();
    await flush();

    expect(input.getAttribute('aria-invalid')).not.toBe('true');
    expect(lastPutBody.vencimento_janela_alerta_meses).toBe(24);
    expect(window.toast).toHaveBeenCalledWith(expect.stringMatching(/salv/i));
  });

  test('valores hostis do backend não injetam atributos nem elementos no campo tocado', async () => {
    mountConfig({
      apiResponses: {
        '/api/config': { vencimento_janela_alerta_meses: '\" onerror=\"alert(1)' },
      },
    });
    const el = window.document.getElementById('page-config');
    await window.renderConfig(el);
    await flush();

    const input = el.querySelector('#c-vencimento-janela');
    expect(input.getAttribute('onerror')).toBeNull();
    expect(input.outerHTML).not.toMatch(/onerror=/);
    expect(el.querySelector('script')).toBeNull();
  });
});