import { describe, expect, test } from 'vitest';
import { normalizeFiiTicker, parseHashRoute } from '../../renderer/js/router.js';

const STATIC_ROUTE_NAMES = [
  'dashboard',
  'posicoes',
  'lancamentos',
  'proventos',
  'preco-teto',
  'simulador',
  'fire',
  'cenarios',
  'importar',
  'config',
];

const DASHBOARD_ROUTE = {
  page: 'dashboard',
  nav: 'dashboard',
  params: {},
};

describe('normalizeFiiTicker', () => {
  test('normaliza um ticker de FII válido para maiúsculas', () => {
    expect(normalizeFiiTicker('HGLG11')).toBe('HGLG11');
  });

  test('normaliza lowercase e espaços nas extremidades', () => {
    expect(normalizeFiiTicker('  hglg11  ')).toBe('HGLG11');
  });

  test('retorna null para ticker vazio ou malformado', () => {
    expect(normalizeFiiTicker('')).toBeNull();
    expect(normalizeFiiTicker('HGLG1')).toBeNull();
    expect(normalizeFiiTicker('HGLG11/OUTRO')).toBeNull();
  });
});

describe('parseHashRoute', () => {
  test('converte a rota de FII em detalhe com navegação em Posições', () => {
    expect(parseHashRoute('#fii/HGLG11', STATIC_ROUTE_NAMES)).toEqual({
      page: 'fii-detail',
      nav: 'posicoes',
      params: { ticker: 'HGLG11' },
    });
  });

  test('normaliza o ticker lowercase dentro da rota de FII', () => {
    expect(parseHashRoute('#fii/hglg11', STATIC_ROUTE_NAMES)).toEqual({
      page: 'fii-detail',
      nav: 'posicoes',
      params: { ticker: 'HGLG11' },
    });
  });

  test('resolve uma rota estática conhecida exatamente', () => {
    expect(parseHashRoute('#dashboard', STATIC_ROUTE_NAMES)).toEqual(DASHBOARD_ROUTE);
  });

  test.each([
    ['rota desconhecida', '#nao-existe'],
    ['ticker inválido', '#fii/not-a-ticker'],
    ['segmento FII ausente', '#fii'],
    ['segmento FII vazio', '#fii/'],
    ['segmento extra', '#fii/HGLG11/extra'],
    ['query string', '#fii/HGLG11?tab=proventos'],
    ['barra codificada no ticker', '#fii/HGLG11%2Fextra'],
  ])('faz fallback seguro para dashboard em caso de %s', (_description, hash) => {
    expect(parseHashRoute(hash, STATIC_ROUTE_NAMES)).toEqual(DASHBOARD_ROUTE);
  });
});
