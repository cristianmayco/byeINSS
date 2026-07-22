(function initRouter(root, factory) {
  const router = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = router;
  }
  if (root) {
    root.byeINSSRouter = router;
    root.normalizeFiiTicker = router.normalizeFiiTicker;
    root.parseHashRoute = router.parseHashRoute;
  }
})(typeof window !== 'undefined' ? window : null, function createRouter() {
  'use strict';

  const FII_TICKER_RE = /^[A-Z]{4}11$/;

  function normalizeFiiTicker(value) {
    const ticker = String(value ?? '').trim().toUpperCase();
    return FII_TICKER_RE.test(ticker) ? ticker : null;
  }

  function dashboardRoute() {
    return { page: 'dashboard', nav: 'dashboard', params: {} };
  }

  function parseHashRoute(hash, staticRouteNames = []) {
    const raw = String(hash ?? '').replace(/^#/, '');
    const staticRoutes = new Set(staticRouteNames);

    // Extrai path (antes do '?') e query string (depois do '?')
    const qIdx = raw.indexOf('?');
    const path = qIdx === -1 ? raw : raw.slice(0, qIdx);
    const queryStr = qIdx === -1 ? '' : raw.slice(qIdx + 1);
    const params = {};
    if (queryStr) {
      for (const part of queryStr.split('&')) {
        if (!part) continue;
        const eq = part.indexOf('=');
        const k = decodeURIComponent(eq === -1 ? part : part.slice(0, eq));
        const v = eq === -1 ? '' : decodeURIComponent(part.slice(eq + 1));
        if (k) params[k] = v;
      }
    }

    if (staticRoutes.has(path)) {
      return { page: path, nav: path, params };
    }

    // PRD 01: #fii-historico/[A-Z]{4}11 — rota dedicada ao histórico de
    // dividendos. Verificada ANTES do split('/') para não cair no fallback
    // do fii-detail. Pattern aceita 1-2 dígitos no final (ex.: HGLG11, XPML11).
    const histMatch = raw.match(/^fii-historico\/([A-Z]{4}\d{1,2})(\?.*)?$/);
    if (histMatch) {
      const decodedTicker = histMatch[1].toUpperCase();
      if (normalizeFiiTicker(decodedTicker)) {
        return {
          page: 'fii-historico',
          nav: 'posicoes',
          params: { ...params, ticker: decodedTicker }
        };
      }
    }

    const parts = path.split('/');
    if (parts.length !== 2 || parts[0] !== 'fii') {
      return dashboardRoute();
    }

    let decodedTicker;
    try {
      decodedTicker = decodeURIComponent(parts[1]);
    } catch {
      return dashboardRoute();
    }

    if (decodedTicker.includes('/') || decodedTicker.includes('?') || decodedTicker.includes('#')) {
      return dashboardRoute();
    }

    const ticker = normalizeFiiTicker(decodedTicker);
    if (!ticker) return dashboardRoute();

    return {
      page: 'fii-detail',
      nav: 'posicoes',
      params: { ...params, ticker }
    };
  }

  return { normalizeFiiTicker, parseHashRoute };
});