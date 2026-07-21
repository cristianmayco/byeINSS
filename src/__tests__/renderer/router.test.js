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
    ['barra codificada no ticker', '#fii/HGLG11%2Fextra'],
  ])('faz fallback seguro para dashboard em caso de %s', (_description, hash) => {
    expect(parseHashRoute(hash, STATIC_ROUTE_NAMES)).toEqual(DASHBOARD_ROUTE);
  });

  // PRD 02 sub-PR 4 (RF-019 / RF-022): #posicoes com query string deve
  // navegar para Posições, NÃO para Dashboard.
  // PRD 03 amplia: a query string também é parseada e devolvida em params
  // (ex: #proventos?tipos=AMORTIZACAO → params.tipos='AMORTIZACAO').
  test('#posicoes com query string navega para Posições', () => {
    expect(parseHashRoute('#posicoes?filtro=ATENCAO,CRITICO', STATIC_ROUTE_NAMES)).toEqual({
      page: 'posicoes',
      nav: 'posicoes',
      params: { filtro: 'ATENCAO,CRITICO' },
    });
  });

  test('#posicoes sem query string continua navegando para Posições', () => {
    expect(parseHashRoute('#posicoes', STATIC_ROUTE_NAMES)).toEqual({
      page: 'posicoes',
      nav: 'posicoes',
      params: {},
    });
  });

  test('#posicoes?filtro=inválido ainda navega para Posições (filtro descartado)', () => {
    // PRD 03: o parser do router aceita a query MAS a CAMADA de página
    // (renderPosicoes) é responsável por validar/descartar valores inválidos.
    expect(parseHashRoute('#posicoes?filtro=junk', STATIC_ROUTE_NAMES)).toEqual({
      page: 'posicoes',
      nav: 'posicoes',
      params: { filtro: 'junk' },
    });
  });

  test('#proventos?tipos=AMORTIZACAO,DIVIDENDO retorna params.tipos (PRD 03 RF-013)', () => {
    expect(parseHashRoute('#proventos?tipos=AMORTIZACAO,DIVIDENDO', STATIC_ROUTE_NAMES)).toEqual({
      page: 'proventos',
      nav: 'proventos',
      params: { tipos: 'AMORTIZACAO,DIVIDENDO' },
    });
  });

  test('#fii/HGLG11?tipo=PRUMADO mantém ticker E tem params.tipo', () => {
    expect(parseHashRoute('#fii/HGLG11?tipo=PRUMADO', STATIC_ROUTE_NAMES)).toEqual({
      page: 'fii-detail',
      nav: 'posicoes',
      params: { ticker: 'HGLG11', tipo: 'PRUMADO' },
    });
  });
});
