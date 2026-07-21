import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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
          <a href="#posicoes" class="nav-item" data-route="posicoes">Posições</a>
        </nav>
        <span id="server-status"></span>
      </aside>
      <main>
        <section id="page-dashboard" class="page active"></section>
        <section id="page-posicoes" class="page"></section>
        <section id="page-fii-detail" class="page"></section>
        <section id="page-fii-analise" class="page"></section>
        <section id="page-fii-watchlist" class="page"></section>
        <section id="page-fii-historico" class="page"></section>
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
    '/api/ativos?ativo_only=1': [
      { id: 1, ticker: 'HGLG11', tipo: 'FII', segmento: 'Logística', ativo: 1, p_vp: 0.95, vacancia: 8, nota: 7 },
      { id: 2, ticker: 'MXRF11', tipo: 'FII', segmento: 'Papel', ativo: 1, p_vp: 1.0, vacancia: null, nota: 6 },
      { id: 3, ticker: 'PETR4', tipo: 'ACAO', segmento: 'Petróleo', ativo: 1, p_vp: null, vacancia: null, nota: null },
      { id: 4, ticker: 'BTLG11', tipo: 'FII', segmento: 'Logística', ativo: 1, p_vp: 0.92, vacancia: 12, nota: 7 },
    ],
    '/api/ativos': [
      { id: 1, ticker: 'HGLG11', tipo: 'FII', segmento: 'Logística', ativo: 1 },
      { id: 2, ticker: 'MXRF11', tipo: 'FII', segmento: 'Papel', ativo: 1 },
      { id: 3, ticker: 'PETR4', tipo: 'ACAO', segmento: 'Petróleo', ativo: 1 },
      { id: 4, ticker: 'BTLG11', tipo: 'FII', segmento: 'Logística', ativo: 1 },
    ],
    '/api/dashboard/resumo': {
      patrimonio: 100000, ganho_capital: 5000, variacao_pct: 5,
      valor_investido: 95000, proventos_12m: 8000, dy_carteira_12m: 8,
      por_tipo: { FII: 60, ACAO: 40 },
      posicoes: [
        { ticker: 'HGLG11', qtd: 100, preco_medio: 150, preco_atual: 165, saldo: 16500, variacao_pct: 10, pct_carteira: 30 },
        { ticker: 'MXRF11', qtd: 0, preco_medio: 0, preco_atual: 10, saldo: 0, variacao_pct: 0, pct_carteira: 0 },
        { ticker: 'BTLG11', qtd: 50, preco_medio: 100, preco_atual: 105, saldo: 5250, variacao_pct: 5, pct_carteira: 10 },
        { ticker: 'PETR4', qtd: 10, preco_medio: 35, preco_atual: 38, saldo: 380, variacao_pct: 8.57, pct_carteira: 1 },
      ],
    },
    '/api/dashboard/evolucao': [],
    '/api/dashboard/proventos-mensais': [],
    '/api/dashboard/alertas': [],
    '/api/fiis/contratos/HGLG11': {
      ticker: 'HGLG11',
      vencimento_medio_contratos_meses: 18,
      tipo_reajuste: 'IGPM',
      alerta_vencimento: 1,
      origem: 'main',
    },
  };
}

function mountPages({ apiResponses = {}, contratosUI = {}, initialHash = '#dashboard' } = {}) {
  dom = new JSDOM(DASHBOARD_HTML, {
    url: `http://localhost/${initialHash}`,
    runScripts: 'outside-only',
  });
  window = dom.window;

  // Helpers de formatação stubs
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

  // Router stubs (caso pages.js consuma)
  window.parseHashRoute = vi.fn((hash) => {
    const h = String(hash || '');
    const match = /^#fii\/([A-Za-z0-9]+)$/.exec(h);
    if (match) return { page: 'fii-detail', nav: 'posicoes', params: { ticker: match[1].toUpperCase() } };
    if (h === '#dashboard') return { page: 'dashboard', nav: 'dashboard', params: {} };
    if (h === '#posicoes') return { page: 'posicoes', nav: 'posicoes', params: {} };
    return { page: 'dashboard', nav: 'dashboard', params: {} };
  });
  window.normalizeFiiTicker = value => {
    const ticker = String(value || '').trim().toUpperCase();
    return /^[A-Z]{4}11$/.test(ticker) ? ticker : null;
  };

  // Respostas da API
  const responses = { ...defaultResponses(), ...apiResponses };
  const apiImpl = vi.fn(async (path, options = {}) => {
    if (options.method === 'PUT' && path.startsWith('/api/fiis/contratos/')) {
      return {
        ok: true,
        ticker: path.split('/').pop(),
        ...(options.body || {}),
      };
    }
    if (path in responses) {
      const value = responses[path];
      return typeof value === 'function' ? value(options) : value;
    }
    throw new Error(`Sem stub para ${path}`);
  });
  window.api = apiImpl;
  pagesApi = apiImpl;

  // Stubs de UI de contratos — openContractEditModal deve abrir o DOM e devolver
  // handle com dialog+close, e invocar onSave quando o usuário "submete".
  contratosUIStubs = {
    getContractApplicability: contratosUI.getContractApplicability
      || vi.fn(() => ({ applicable: true, reason: 'TIJOLO' })),
    deriveContractViewState: contratosUI.deriveContractViewState
      || vi.fn(() => ({ status: 'success', risk: 'medium' })),
    formatContractDate: contratosUI.formatContractDate
      || vi.fn(() => '15/01/2027'),
    formatAdjustment: contratosUI.formatAdjustment
      || vi.fn(() => 'IGP-M'),
    buildContractUpdatePayload: contratosUI.buildContractUpdatePayload
      || vi.fn((values) => values),
    createContractCard: contratosUI.createContractCard
      || vi.fn(({ contrato, error, onEdit }) => {
        const card = window.document.createElement('section');
        card.setAttribute('role', 'region');
        card.setAttribute('aria-label', 'Vencimento médio de contratos e tipo de reajuste');
        const status = error ? 'error' : contrato?.alerta_vencimento ? 'alert' : 'success';
        card.dataset.status = status;
        card.innerHTML = `<h2>Contratos & Reajuste</h2>
        <div class="contract-status" data-status="${status}">${
          error ? 'Erro ao carregar contratos' : `${contrato?.vencimento_medio_contratos_meses ?? '—'} · ${contrato?.tipo_reajuste ?? '—'}`
        }</div>
        <button type="button" data-action="edit">Editar</button>`;
        card.querySelector('[data-action="edit"]').addEventListener('click', onEdit);
        return card;
      }),
    openContractEditModal: contratosUI.openContractEditModal
      || vi.fn(({ ativo, contrato, trigger, onSave, onSaved }) => {
        const dialog = window.document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.innerHTML = `
          <form data-mock-form>
            <input data-field="meses" type="number" value="${contrato?.vencimento_medio_contratos_meses ?? ''}">
            <input data-field="data" type="date" value="${contrato?.vencimento_medio_contratos ?? ''}">
            <select data-field="tipo_reajuste">
              <option value="IGPM">IGPM</option>
              <option value="IPCA">IPCA</option>
              <option value="FIXO">FIXO</option>
              <option value="OUTRO">OUTRO</option>
            </select>
            <input data-field="reajuste_percentual" type="number" value="${contrato?.reajuste_percentual ?? ''}">
            <button type="submit" data-action="save">Salvar</button>
          </form>
        `;
        window.document.body.appendChild(dialog);

        const form = dialog.querySelector('form');
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const result = await onSave?.({
            vencimento_medio_contratos_meses: Number(form.querySelector('[data-field="meses"]').value) || null,
            vencimento_medio_contratos: form.querySelector('[data-field="data"]').value || null,
            tipo_reajuste: form.querySelector('[data-field="tipo_reajuste"]').value,
            reajuste_percentual: Number(form.querySelector('[data-field="reajuste_percentual"]').value) || null,
          });
          dialog.remove();
          trigger?.focus();
          onSaved?.(result);
        });

        return { dialog, close: () => dialog.remove() };
      }),
  };

  window.byeINSSContratosUI = contratosUIStubs;
  window.navigate = vi.fn();

  // Avalia apenas pages.js (sem app.js auto-init)
  window.eval(PAGES_SOURCE);
  return window;
}

beforeEach(() => {
  dom = undefined;
});

afterEach(() => {
  dom?.window.close();
  dom = undefined;
});

describe('renderFiiDetail', () => {
  test('mostra estado de loading imediato antes das promises resolverem', async () => {
    let resolveAtivos;
    let resolveContratos;
    mountPages();
    window.api = vi.fn((path) => {
      if (path.startsWith('/api/ativos')) return new Promise(r => { resolveAtivos = r; });
      if (path.startsWith('/api/fiis/contratos/')) return new Promise(r => { resolveContratos = r; });
      return Promise.resolve([]);
    });

    const el = window.document.getElementById('page-fii-detail');
    const renderPromise = window.renderFiiDetail(el, { ticker: 'HGLG11' });
    await flush(2);

    expect(el.textContent).toMatch(/loading|carregando|spinner/i);

    resolveAtivos([{ ticker: 'HGLG11', tipo: 'FII', segmento: 'Logística' }]);
    resolveContratos({ vencimento_medio_contratos_meses: 18, tipo_reajuste: 'IGPM' });
    await renderPromise;
  });

  test('pede /api/ativos?ativo_only=1 e /api/fiis/contratos/HGLG11', async () => {
    mountPages();
    const el = window.document.getElementById('page-fii-detail');
    await window.renderFiiDetail(el, { ticker: 'HGLG11' });
    await flush();

    const calls = pagesApi.mock.calls.map(c => c[0]);
    expect(calls).toContain('/api/ativos?ativo_only=1');
    expect(calls.some(p => p.startsWith('/api/fiis/contratos/HGLG11'))).toBe(true);
  });

  test('FII ativo mostra resumo com dados', async () => {
    mountPages();
    const el = window.document.getElementById('page-fii-detail');
    await window.renderFiiDetail(el, { ticker: 'HGLG11' });
    await flush();

    expect(el.textContent).toMatch(/HGLG11/);
    expect(el.textContent).toMatch(/contrato|reajuste|vencimento/i);
  });

  test('FII ativo com quantidade zero é permitido (apenas resumo)', async () => {
    mountPages({
      apiResponses: {
        '/api/fiis/contratos/MXRF11': {
          ticker: 'MXRF11', tipo_reajuste: 'IPCA', vencimento_medio_contratos_meses: 60,
        },
      },
    });
    const el = window.document.getElementById('page-fii-detail');
    await window.renderFiiDetail(el, { ticker: 'MXRF11' });
    await flush();

    expect(el.textContent).toMatch(/MXRF11/);
    expect(window.console.error).not.toHaveBeenCalled();
  });

  test('ticker inválido cai em estado seguro sem crash', async () => {
    mountPages();
    window.api = vi.fn(async (path) => {
      if (path === '/api/ativos?ativo_only=1') return [];
      if (path.startsWith('/api/fiis/contratos/')) throw new Error('404 not found');
      return [];
    });

    const el = window.document.getElementById('page-fii-detail');
    await window.renderFiiDetail(el, { ticker: 'INVALID' });
    await flush();

    expect(el.textContent).toMatch(/INVALID|não encontrad|indispon/i);
    expect(window.api).not.toHaveBeenCalled();
  });

  test('não-FII cai em estado seguro', async () => {
    mountPages();
    const el = window.document.getElementById('page-fii-detail');
    await window.renderFiiDetail(el, { ticker: 'PETR4' });
    await flush();

    expect(el.textContent).toMatch(/PETR4|não encontrad|indispon|sem dados/i);
  });

  test('rota ausente (sem ticker) cai em estado seguro', async () => {
    mountPages();
    const el = window.document.getElementById('page-fii-detail');
    await window.renderFiiDetail(el, {});
    await flush();

    expect(el.textContent).toMatch(/não encontrad|indispon|ticker/i);
    expect(window.api).not.toHaveBeenCalled();
  });

  test('falha no GET de contrato mantém resumo e exibe erro local', async () => {
    mountPages();
    window.api = vi.fn(async (path) => {
      if (path === '/api/ativos?ativo_only=1') {
        return [{ ticker: 'HGLG11', tipo: 'FII', segmento: 'Logística' }];
      }
      if (path.startsWith('/api/fiis/contratos/')) throw new Error('Servidor indisponível');
      return [];
    });

    const el = window.document.getElementById('page-fii-detail');
    await window.renderFiiDetail(el, { ticker: 'HGLG11' });
    await flush();

    expect(el.textContent).toMatch(/HGLG11/);
    expect(el.textContent).toMatch(/erro|falha|indispon/i);
  });

  test('PUT bem-sucedido via modal: clica Editar, submete e re-renderiza sem navegar', async () => {
    mountPages();
    const el = window.document.getElementById('page-fii-detail');
    await window.renderFiiDetail(el, { ticker: 'HGLG11' });
    await flush();

    // A renderização inicial deve ter inserido um botão Editar no card.
    const editBtn = el.querySelector('[data-action="edit"]');
    expect(editBtn).toBeTruthy();
    editBtn.click();
    await flush();

    // O stub de openContractEditModal deve ter criado o <form>.
    const dialog = window.document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();

    // Ajusta valores e submete — isso invoca onSave dentro do stub
    const meses = dialog.querySelector('[data-field="meses"]');
    meses.value = '24';
    meses.dispatchEvent(new window.Event('input', { bubbles: true }));

    const tipo = dialog.querySelector('[data-field="tipo_reajuste"]');
    tipo.value = 'IPCA';
    tipo.dispatchEvent(new window.Event('change', { bubbles: true }));

    const submit = dialog.querySelector('[data-action="save"]');
    submit.click();
    await flush();

    // PUT deve ter sido chamado com PUT/method
    const putCall = pagesApi.mock.calls.find(
      ([path, options]) => options?.method === 'PUT' && path.startsWith('/api/fiis/contratos/HGLG11'),
    );
    expect(putCall).toBeTruthy();

    // O stub de createContractCard recebeu o contrato atualizado e re-renderizou.
    const lastCall = contratosUIStubs.createContractCard.mock.calls.at(-1);
    expect(lastCall[0].contrato.tipo_reajuste).toBe('IPCA');
    expect(lastCall[0].contrato.vencimento_medio_contratos_meses).toBe(24);

    // O save atualiza o card localmente, sem forçar uma navegação completa.
    expect(window.navigate).not.toHaveBeenCalled();
  });

  test('após salvar, foco volta para o novo botão Editar', async () => {
    mountPages();
    const el = window.document.getElementById('page-fii-detail');
    await window.renderFiiDetail(el, { ticker: 'HGLG11' });
    await flush();

    const firstEdit = el.querySelector('[data-action="edit"]');
    firstEdit.click();
    await flush();

    const dialog = window.document.querySelector('[role="dialog"]');
    const meses = dialog.querySelector('[data-field="meses"]');
    meses.value = '24';
    meses.dispatchEvent(new window.Event('input', { bubbles: true }));
    const tipo = dialog.querySelector('[data-field="tipo_reajuste"]');
    tipo.value = 'IPCA';
    tipo.dispatchEvent(new window.Event('change', { bubbles: true }));
    dialog.querySelector('[data-action="save"]').click();
    await flush();

    const newEdit = el.querySelector('[data-action="edit"]');
    expect(newEdit).toBeTruthy();
    expect(newEdit).not.toBe(firstEdit);
    expect(window.document.body.contains(firstEdit)).toBe(false);
    expect(window.document.body.contains(newEdit)).toBe(true);
    expect(window.document.activeElement).toBe(newEdit);
  });

  test('Editar reabre com o contrato atualizado, não o estado inicial', async () => {
    mountPages();
    const el = window.document.getElementById('page-fii-detail');
    await window.renderFiiDetail(el, { ticker: 'HGLG11' });
    await flush();

    contratosUIStubs.openContractEditModal.mockClear();
    el.querySelector('[data-action="edit"]').click();
    await flush();

    const firstOptions = contratosUIStubs.openContractEditModal.mock.calls.at(-1)[0];
    expect(firstOptions.contrato.vencimento_medio_contratos_meses).toBe(18);
    expect(firstOptions.contrato.tipo_reajuste).toBe('IGPM');

    const dialog = window.document.querySelector('[role="dialog"]');
    const meses = dialog.querySelector('[data-field="meses"]');
    meses.value = '24';
    meses.dispatchEvent(new window.Event('input', { bubbles: true }));
    const tipo = dialog.querySelector('[data-field="tipo_reajuste"]');
    tipo.value = 'IPCA';
    tipo.dispatchEvent(new window.Event('change', { bubbles: true }));
    dialog.querySelector('[data-action="save"]').click();
    await flush();

    contratosUIStubs.openContractEditModal.mockClear();
    el.querySelector('[data-action="edit"]').click();
    await flush();

    const secondOptions = contratosUIStubs.openContractEditModal.mock.calls.at(-1)[0];
    expect(secondOptions.contrato.vencimento_medio_contratos_meses).toBe(24);
    expect(secondOptions.contrato.tipo_reajuste).toBe('IPCA');
  });
});

describe('renderPosicoes com links FII', () => {
  test('tickers FII com posição aberta viram links seguros #fii/TICKER', async () => {
    mountPages({ initialHash: '#posicoes' });
    const el = window.document.getElementById('page-posicoes');
    await window.renderPosicoes(el);
    await flush();

    const html = el.innerHTML;
    expect(html).toMatch(/href=["']#fii\/HGLG11["']/i);
    expect(html).toMatch(/href=["']#fii\/BTLG11["']/i);
  });

  test('FII com quantidade zero não vira link', async () => {
    mountPages({ initialHash: '#posicoes' });
    const el = window.document.getElementById('page-posicoes');
    await window.renderPosicoes(el);
    await flush();

    expect(el.innerHTML).not.toMatch(/href=["']#fii\/MXRF11["']/i);
  });

  test('não-FIIs permanecem como texto, sem link', async () => {
    mountPages({ initialHash: '#posicoes' });
    const el = window.document.getElementById('page-posicoes');
    await window.renderPosicoes(el);
    await flush();

    expect(el.innerHTML).not.toMatch(/href=["']#fii\/PETR4["']/i);
    expect(el.textContent).toMatch(/PETR4/);
  });

  test('ticker hostil não injeta markup', async () => {
    mountPages({
      initialHash: '#posicoes',
      apiResponses: {
        '/api/ativos?ativo_only=1': [
          { id: 1, ticker: '<img src=x onerror=alert(1)>', tipo: 'FII', segmento: 'Logística', ativo: 1 },
        ],
        '/api/dashboard/resumo': {
          patrimonio: 0, ganho_capital: 0, variacao_pct: 0,
          valor_investido: 0, proventos_12m: 0, dy_carteira_12m: 0,
          por_tipo: {},
          posicoes: [{
            ticker: '<img src=x onerror=alert(1)>', qtd: 1, preco_medio: 1,
            preco_atual: 1, saldo: 1, variacao_pct: 0, pct_carteira: 0,
          }],
        },
      },
    });
    const el = window.document.getElementById('page-posicoes');
    await window.renderPosicoes(el);
    await flush();

    expect(el.querySelector('img')).toBeNull();
  });

  test('segmento hostil não injeta markup', async () => {
    mountPages({
      initialHash: '#posicoes',
      apiResponses: {
        '/api/ativos?ativo_only=1': [
          { id: 1, ticker: 'HGLG11', tipo: 'FII', segmento: '<script>alert(1)</script>', ativo: 1 },
        ],
      },
    });
    const el = window.document.getElementById('page-posicoes');
    await window.renderPosicoes(el);
    await flush();

    expect(el.querySelector('script')).toBeNull();
  });
});