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

    if (staticRoutes.has(raw)) {
      return { page: raw, nav: raw, params: {} };
    }

    const parts = raw.split('/');
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
      params: { ticker }
    };
  }

  return { normalizeFiiTicker, parseHashRoute };
});
