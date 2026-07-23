// src/shared/radar-dy-ui.js
//
// Helpers puros de formatação para a badge "Radar DY" em Posições + alerta
// consolidado no Dashboard (PRD 07). Sem DOM — testáveis com vitest puro.
//
// Funções públicas:
//   - formatarBadgeRadar(item)            → { texto, classe, ariaLabel, icone }
//   - formatarAlertaConsolidado(items)    → string pt-BR para o card do Dashboard
//   - formatarTendencia(tendencia)        → "Em queda" | "Estável" | "Em alta" | "—"

'use strict';

const ICONES = { VERMELHO: '⚠', AMARELO: '!', NORMAL: '✓', SEM_DADOS: '—' };

const TEXTOS = {
  VERMELHO: 'Crítico',
  AMARELO: 'Atenção',
  NORMAL: 'Normal',
  SEM_DADOS: 'Sem dados'
};

const CORES = {
  VERMELHO: 'badge-radar-vermelho',
  AMARELO: 'badge-radar-amarelo',
  NORMAL: 'badge-radar-normal',
  SEM_DADOS: 'badge-radar-sem-dados'
};

const TENDENCIA_TEXTOS = {
  EM_QUEDA: 'Em queda',
  ESTAVEL: 'Estável',
  EM_ALTA: 'Em alta',
  INDETERMINADA: '—'
};

function formatarRatio(ratio) {
  if (!Number.isFinite(ratio)) return '—';
  return ratio.toFixed(2).replace('.', ',') + '×';
}

function formatarBadgeRadar(item) {
  if (!item || typeof item !== 'object') {
    return { texto: '—', classe: CORES.SEM_DADOS, ariaLabel: 'Sem dados de DY', icone: ICONES.SEM_DADOS };
  }
  const nivel = item.nivel || 'SEM_DADOS';
  const ratio = Number.isFinite(item.ratio) ? formatarRatio(item.ratio) : '';
  const texto = ratio ? `${TEXTOS[nivel]} · ${ratio}` : TEXTOS[nivel];

  let ariaLabel = `${TEXTOS[nivel]}.`;
  if (Number.isFinite(item.ratio)) {
    ariaLabel += ` Razão DY 12M / DY 5 anos = ${formatarRatio(item.ratio)}.`;
  }
  if (Number.isFinite(item.dy_12m) && Number.isFinite(item.dy_medio_5a)) {
    ariaLabel += ` DY 12 meses ${item.dy_12m.toFixed(2).replace('.', ',')}%; DY médio 5 anos ${item.dy_medio_5a.toFixed(2).replace('.', ',')}%.`;
  }

  return {
    texto,
    classe: CORES[nivel] || CORES.SEM_DADOS,
    ariaLabel,
    icone: ICONES[nivel] || ICONES.SEM_DADOS
  };
}

function formatarAlertaConsolidado(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { titulo: 'Nenhum DY suspeito', mensagem: 'Nenhum DY suspeito nos FIIs elegíveis.', itens: [], total: 0 };
  }
  const vermelhos = items.filter(i => i.nivel === 'VERMELHO');
  const amarelos = items.filter(i => i.nivel === 'AMARELO');
  const total = vermelhos.length + amarelos.length;
  let mensagem;
  if (vermelhos.length > 0) {
    mensagem = `${vermelhos.length} FII(s) com DY 12M acima de ${(1.5).toFixed(2).replace('.', ',')}× da média de 5 anos — ${amarelos.length > 0 ? `mais ${amarelos.length} em atenção` : 'revisar antes de aportar'}.`;
  } else if (amarelos.length > 0) {
    mensagem = `${amarelos.length} FII(s) em atenção — DY 12M acima de ${(1.25).toFixed(2).replace('.', ',')}× da média de 5 anos.`;
  } else {
    mensagem = 'Nenhum DY suspeito nos FIIs elegíveis.';
  }
  return {
    titulo: total > 0 ? 'Radar de DY da carteira' : 'Radar de DY',
    mensagem,
    itens: items.filter(i => i.nivel === 'VERMELHO' || i.nivel === 'AMARELO'),
    total
  };
}

function formatarTendencia(tendencia) {
  return TENDENCIA_TEXTOS[tendencia] || TENDENCIA_TEXTOS.INDETERMINADA;
}

module.exports = {
  formatarBadgeRadar,
  formatarAlertaConsolidado,
  formatarTendencia,
  formatarRatio,
  TEXTOS,
  CORES,
  ICONES
};