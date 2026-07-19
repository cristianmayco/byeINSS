// Cliente HTTP simples apontando para a API local do Electron
const API_BASE = 'http://127.0.0.1:0'; // preenchido em runtime
let _apiBase = null;

async function apiCall(path, options = {}) {
  if (!_apiBase) {
    // Fallback: tenta descobrir via Electron preload
    if (window.electronAPI?.getPort) {
      const port = await window.electronAPI.getPort();
      _apiBase = `http://127.0.0.1:${port}`;
    } else {
      // Tenta porta padrão (modo dev/script)
      _apiBase = 'http://127.0.0.1:4317';
    }
  }
  const url = `${_apiBase}${path}`;
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || `HTTP ${r.status}`);
  }
  return r.json();
}
// Alias para compatibilidade com código existente
const api = apiCall;

function brl(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
}
function pct(v, digits = 2) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + '%';
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function todayISO() { return new Date().toISOString().slice(0,10); }

function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  setTimeout(() => { el.className = 'toast'; }, 2800);
}

// Roteamento
const routes = {
  dashboard: renderDashboard,
  posicoes: renderPosicoes,
  lancamentos: renderLancamentos,
  proventos: renderProventos,
  'preco-teto': renderPrecoTeto,
  simulador: renderSimulador,
  fire: renderFire,
  cenarios: renderCenarios,
  importar: renderImportar,
  config: renderConfig
};

let chartsToDestroy = [];

function destroyCharts() { chartsToDestroy.forEach(c => c.destroy()); chartsToDestroy = []; }

async function navigate(route) {
  destroyCharts();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.route === route));
  const fn = routes[route] || routes.dashboard;
  const el = document.getElementById(`page-${route}`);
  el.classList.add('active');
  try {
    await fn(el);
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div>${escapeHtml(e.message)}</div></div>`;
    console.error(e);
  }
}

document.querySelectorAll('.nav-item').forEach(n => {
  n.addEventListener('click', (e) => {
    e.preventDefault();
    const route = n.dataset.route;
    location.hash = route;
  });
});

window.addEventListener('hashchange', () => navigate(location.hash.slice(1) || 'dashboard'));

// Health check + boot
async function checkHealth() {
  try {
    await api('/api/health');
    document.getElementById('server-status').textContent = 'API online';
    document.getElementById('server-status').classList.add('online');
  } catch {
    document.getElementById('server-status').textContent = 'API offline';
    document.getElementById('server-status').classList.add('offline');
  }
}

// Inicialização
(async function init() {
  await checkHealth();
  setInterval(checkHealth, 10000);
  const initial = location.hash.slice(1) || 'dashboard';
  navigate(initial);
})();
