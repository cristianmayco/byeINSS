// src/shared/peer-ui.js
//
// Helpers puros de formatação para as 3 colunas peer em Posições (PRD 04).
// Sem dependência de DOM — testáveis com vitest puro.
//
// Funções públicas:
//   - formatarDesvioPvp(peer)              → string pt-BR para coluna "P/VP vs peer"
//   - formatarDesvioDy(peer)               → string pt-BR para coluna "DY vs peer"
//   - formatarDesvioVpa(peer)              → string pt-BR para coluna "VPA vs peer"
//   - formatarChipClassificacao(peer)      → { texto, classe } para chip colorido
//   - chipClassificacaoAcessivel(peer)     → string para aria-label
//   - aplicarFiltroPeer(itens, filtro)    → aplica filtro por classificação
//   - ordenarPorDesvio(itens, campo, dir)  → ordena por desvio_pct numérico

'use strict';

// Faixas em pt-BR (vírgula decimal)
function formatarPct(n, casas = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const sinal = n > 0 ? '+' : n < 0 ? '−' : ''; // − é o "minus" Unicode (mais legível)
  const valor = Math.abs(n).toFixed(casas).replace('.', ',');
  return `${sinal}${valor}%`;
}

function formatarMoeda(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return 'R$ ' + n.toFixed(2).replace('.', ',');
}

function formatarNumeroBr(n, casas = 2) {
  if (!Number.isFinite(n)) return null;
  return n.toFixed(casas).replace('.', ',');
}

function formatarDesvioPvp(peer) {
  if (!peer || !peer.pvp || peer.pvp.desvio_pct === null || peer.pvp.desvio_pct === undefined) {
    return { texto: '—', titulo: 'Sem benchmark disponível' };
  }
  const pct = peer.pvp.desvio_pct;
  return {
    texto: formatarPct(pct, 1),
    titulo: `P/VP do FII ${formatarNumeroBr(peer.pvp.fii)} vs média do segmento ${formatarNumeroBr(peer.pvp.peer)}`
  };
}

function formatarDesvioDy(peer) {
  if (!peer || !peer.dy_12m || peer.dy_12m.desvio_pct === null || peer.dy_12m.desvio_pct === undefined) {
    return { texto: '—', titulo: 'Sem benchmark disponível' };
  }
  const pct = peer.dy_12m.desvio_pct;
  return {
    texto: formatarPct(pct, 1),
    titulo: `DY 12M do FII ${formatarNumeroBr(peer.dy_12m.fii)}% vs média do segmento ${formatarNumeroBr(peer.dy_12m.peer)}%`
  };
}

function formatarDesvioVpa(peer) {
  if (!peer || !peer.vpa || peer.vpa.desvio_pct === null || peer.vpa.desvio_pct === undefined) {
    return { texto: '—', titulo: 'Sem benchmark disponível' };
  }
  const pct = peer.vpa.desvio_pct;
  return {
    texto: formatarPct(pct, 1),
    titulo: `VPA do FII ${formatarMoeda(peer.vpa.fii)} vs média ${formatarMoeda(peer.vpa.peer)} (informativo)`
  };
}

function formatarChipClassificacao(peer) {
  if (!peer || !peer.classificacao || peer.classificacao === 'SEM_DADOS') {
    return { texto: 'Sem dados', classe: 'chip-sem-dados' };
  }
  switch (peer.classificacao) {
    case 'FAVORAVEL':
      return { texto: 'Favorável', classe: 'chip-favoravel' };
    case 'DESFAVORAVEL':
      return { texto: 'Desfavorável', classe: 'chip-desfavoravel' };
    case 'NEUTRO':
    default:
      return { texto: 'Neutro', classe: 'chip-neutro' };
  }
}

// Texto acessível para aria-describedby / aria-label
function chipClassificacaoAcessivel(peer) {
  if (!peer || !peer.classificacao || peer.classificacao === 'SEM_DADOS') {
    return 'Sem dados de benchmark do segmento.';
  }
  const motivos = {
    FAVORAVEL: 'Comparação favorável com o segmento.',
    DESFAVORAVEL: 'Comparação desfavorável com o segmento.',
    NEUTRO: 'Comparação neutra com o segmento.'
  };
  return motivos[peer.classificacao] || motivos.NEUTRO;
}

// Filtro por classificação (pode ser array de strings ou string CSV).
function aplicarFiltroPeer(itens, filtro) {
  if (!filtro) return itens;
  const filtros = Array.isArray(filtro) ? filtro
    : String(filtro).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (filtros.length === 0) return itens;
  return itens.filter(it => filtros.includes(String(it.classificacao || '').toUpperCase()));
}

// Ordenação por desvio numérico (pvp/dy/vpa); SEM_DADOS vai para o fim.
function ordenarPorDesvio(itens, campo, direcao = 'asc') {
  const dir = direcao === 'desc' ? -1 : 1;
  return [...itens].sort((a, b) => {
    const va = a && a[campo] && Number.isFinite(a[campo].desvio_pct) ? a[campo].desvio_pct : null;
    const vb = b && b[campo] && Number.isFinite(b[campo].desvio_pct) ? b[campo].desvio_pct : null;
    if (va === null && vb === null) return 0;
    if (va === null) return 1;  // SEM_DADOS no fim
    if (vb === null) return -1;
    if (va === vb) return 0;
    return va < vb ? -1 * dir : 1 * dir;
  });
}

module.exports = {
  formatarPct,
  formatarMoeda,
  formatarDesvioPvp,
  formatarDesvioDy,
  formatarDesvioVpa,
  formatarChipClassificacao,
  chipClassificacaoAcessivel,
  aplicarFiltroPeer,
  ordenarPorDesvio
};