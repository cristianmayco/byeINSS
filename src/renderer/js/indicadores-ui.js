// src/renderer/js/indicadores-ui.js
// UI para PRD 02 (Indicadores Históricos de DY e Rentabilidade Real):
//
//   - Badge de classificação DY vs 5a (verde/amarelo/vermelho/cinza)
//   - Formatação pt-BR de percentuais
//   - Tooltip acessível explicando a fórmula
//   - Bloco de alerta no Dashboard
//
// Padrão de export: IIFE com namespace `byeINSSIndicadoresUI` (espelha PRD 12).

(function initIndicadoresUI(root, factory) {
  const indicadoresUI = factory(root);

  if (typeof module === 'object' && module.exports) {
    module.exports = indicadoresUI;
  }
  if (root) root.byeINSSIndicadoresUI = indicadoresUI;
})(typeof window !== 'undefined' ? window : globalThis, function createIndicadoresUI(root) {
  'use strict';

  const SEVERIDADE_PARA_COR = Object.freeze({
    CONSISTENTE: 'success',
    ATENCAO: 'warning',
    CRITICO: 'danger',
    INDEFINIDO: 'muted'
  });

  const SEVERIDADE_PARA_LABEL = Object.freeze({
    CONSISTENTE: 'Em linha com a média',
    ATENCAO: 'Atenção',
    CRITICO: 'Crítico',
    INDEFINIDO: 'Sem dado histórico'
  });

  const CLASSIFICACAO_PARA_LABEL = Object.freeze({
    EM_LINHA: 'Em linha',
    ABAIXO: 'Abaixo',
    ACIMA: 'Acima',
    INSUFICIENTE: 'Insuficiente'
  });

  /**
   * Formata número em percentual pt-BR com 1 casa.
   * 9.5 → '9,5%'; null → '—'.
   */
  function formatarPercentual(n, casas = 1) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
    const v = Number(n);
    return v.toFixed(casas).replace('.', ',') + '%';
  }

  /**
   * Renderiza badge da classificação DY vs 5a.
   *
   * @param {object} item            dados do endpoint /api/fiis/indicadores
   * @param {object} [opts]
   * @param {string} [opts.size='sm'] 'sm' | 'md'
   * @returns {HTMLElement}
   */
  function renderizarBadgeDyVs5a(item, opts = {}) {
    const size = opts.size || 'sm';
    const classif = item && item.classificacao ? item.classificacao : 'INSUFICIENTE';
    const sev = item && item.severidade ? item.severidade : 'INDEFINIDO';
    const cor = SEVERIDADE_PARA_COR[sev] || 'muted';
    const labelClassif = CLASSIFICACAO_PARA_LABEL[classif] || classif;
    const pct = item && Number.isFinite(item.dy_vs_5a_pct) ? item.dy_vs_5a_pct : null;
    const pctTxt = pct !== null ? formatarPercentual(pct, 0) : '—';

    const badge = document.createElement('span');
    badge.className = `dy-vs-5a-badge dy-vs-5a-badge--${cor} dy-vs-5a-badge--${size}`;
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-label',
      `DY vs 5 anos: ${labelClassif} (${pctTxt})${item && item.motivo ? '. ' + item.motivo : ''}`);

    const dot = document.createElement('span');
    dot.className = 'dy-vs-5a-badge__dot';
    dot.setAttribute('aria-hidden', 'true');

    const txt = document.createElement('span');
    txt.className = 'dy-vs-5a-badge__txt';
    txt.textContent = `${labelClassif} · ${pctTxt}`;

    badge.appendChild(dot);
    badge.appendChild(txt);

    if (item && item.motivo) {
      badge.title = item.motivo;
    }

    return badge;
  }

  /**
   * Renderiza célula de rentabilidade real 12M com cor condicional
   * (negativo → danger, zero → muted, positivo sem cor).
   */
  function renderizarRentabilidadeReal12M(item) {
    const v = item && item.rentab_real_1a;
    const span = document.createElement('span');
    span.className = 'rentab-real-12m';
    if (v === null || v === undefined || !Number.isFinite(Number(v))) {
      span.classList.add('rentab-real-12m--empty');
      span.textContent = '—';
      span.setAttribute('aria-label', 'Rentabilidade real 12 meses indisponível');
      return span;
    }
    const n = Number(v);
    if (n < 0) span.classList.add('rentab-real-12m--negative');
    else if (n === 0) span.classList.add('rentab-real-12m--zero');
    span.textContent = formatarPercentual(n, 2);
    span.setAttribute('aria-label', `Rentabilidade real 12 meses: ${formatarPercentual(n, 2)}`);
    return span;
  }

  /**
   * Variante HTML-string do badge (para uso em innerHTML existente).
   * Escapa qualquer conteúdo dinâmico (defesa contra XSS).
   */
  function badgeDyVs5aHtml(item) {
    const classif = item && item.classificacao ? item.classificacao : 'INSUFICIENTE';
    const sev = item && item.severidade ? item.severidade : 'INDEFINIDO';
    const cor = SEVERIDADE_PARA_COR[sev] || 'muted';
    const labelClassif = CLASSIFICACAO_PARA_LABEL[classif] || classif;
    const pct = item && Number.isFinite(item.dy_vs_5a_pct) ? item.dy_vs_5a_pct : null;
    const pctTxt = pct !== null ? formatarPercentual(pct, 0) : '—';
    const motivo = item && item.motivo ? String(item.motivo).replace(/"/g, '&quot;') : '';
    const ariaLabel = `DY vs 5 anos: ${labelClassif} (${pctTxt})${motivo ? '. ' + motivo : ''}`;
    return `<span class="dy-vs-5a-badge dy-vs-5a-badge--${cor}" role="status" aria-label="${ariaLabel.replace(/"/g, '&quot;')}"${motivo ? ` title="${motivo}"` : ''}><span class="dy-vs-5a-badge__dot" aria-hidden="true"></span><span class="dy-vs-5a-badge__txt">${labelClassif} · ${pctTxt}</span></span>`;
  }

  function rentabReal12MHtml(item) {
    const v = item && item.rentab_real_1a;
    if (v === null || v === undefined || !Number.isFinite(Number(v))) {
      return '<span class="rentab-real-12m rentab-real-12m--empty" aria-label="Rentabilidade real 12 meses indisponível">—</span>';
    }
    const n = Number(v);
    const cor = n < 0 ? 'rentab-real-12m--negative' : (n === 0 ? 'rentab-real-12m--zero' : '');
    return `<span class="rentab-real-12m ${cor}" aria-label="Rentabilidade real 12 meses: ${formatarPercentual(n, 2)}">${formatarPercentual(n, 2)}</span>`;
  }

  /**
   * Renderiza linha para a tabela de Posições com 2 colunas novas:
   *   - DY vs 5y
   *   - Rent. real 12M
   *
   * @param {object} indicadoresMap  { TICKER: itemFromApi }
   * @returns {function} enhancer que recebe (tr, ativo) e popula as células
   */
  function criarEnhancerDePosicao(indicadoresMap) {
    return function enhancer(tr, ativo) {
      const t = (ativo.ticker || '').toUpperCase();
      const item = indicadoresMap[t] || null;
      // Coluna DY vs 5y
      const tdDy = document.createElement('td');
      tdDy.className = 'col-dy-vs-5a';
      tdDy.appendChild(renderizarBadgeDyVs5a(item));
      tr.appendChild(tdDy);
      // Coluna Rent. real 12M
      const tdRent = document.createElement('td');
      tdRent.className = 'col-rentab-real-12m';
      tdRent.appendChild(renderizarRentabilidadeReal12M(item));
      tr.appendChild(tdRent);
    };
  }

  /**
   * Renderiza o bloco de alerta no Dashboard para FIIs com DY 12M abaixo
   * da média histórica (severidade ATENCAO/CRITICO).
   *
   * @param {HTMLElement} mount    container onde o bloco será inserido
   * @param {object[]} itens       lista de /api/fiis/indicadores
   * @param {object} [opts]
   * @param {number} [opts.maxItens=10]  limite de FIIs listados no bloco
   * @returns {{ renderizado: boolean, total: number }}
   */
  function renderizarBlocoAlertaDashboard(mount, itens, opts = {}) {
    if (!mount) return { renderizado: false, total: 0 };

    const max = opts.maxItens || 10;
    const problematicos = (itens || []).filter(it =>
      it && (it.severidade === 'CRITICO' || it.severidade === 'ATENCAO')
    );

    // Limpa bloco anterior (se houver)
    const existente = mount.querySelector('[data-bloco="indicadores-alerta"]');
    if (existente) existente.remove();

    if (problematicos.length === 0) return { renderizado: false, total: 0 };

    const bloco = document.createElement('section');
    bloco.setAttribute('data-bloco', 'indicadores-alerta');
    bloco.className = 'indicadores-alerta';
    bloco.setAttribute('aria-labelledby', 'indicadores-alerta-titulo');

    const titulo = document.createElement('h3');
    titulo.id = 'indicadores-alerta-titulo';
    titulo.className = 'indicadores-alerta__titulo';
    const criticos = problematicos.filter(p => p.severidade === 'CRITICO').length;
    titulo.textContent = `DY 12M abaixo da média histórica de 5 anos — ${criticos} crítico(s), ${problematicos.length - criticos} atenção`;

    const ul = document.createElement('ul');
    ul.className = 'indicadores-alerta__lista';

    problematicos.slice(0, max).forEach(item => {
      const li = document.createElement('li');
      li.className = `indicadores-alerta__item indicadores-alerta__item--${SEVERIDADE_PARA_COR[item.severidade] || 'muted'}`;
      const link = document.createElement('a');
      link.href = `#fii/${item.ticker}`;
      link.textContent = item.ticker;
      link.setAttribute('aria-label',
        `${item.ticker} — ${SEVERIDADE_PARA_LABEL[item.severidade] || item.severidade} (${formatarPercentual(item.dy_vs_5a_pct, 0)})`);
      const span = document.createElement('span');
      span.className = 'indicadores-alerta__pct';
      span.textContent = formatarPercentual(item.dy_vs_5a_pct, 0);
      li.appendChild(link);
      li.appendChild(span);
      ul.appendChild(li);
    });

    bloco.appendChild(titulo);
    bloco.appendChild(ul);

    if (problematicos.length > max) {
      const mais = document.createElement('p');
      mais.className = 'indicadores-alerta__mais';
      mais.textContent = `+ ${problematicos.length - max} FII(s) adicionais com alerta`;
      bloco.appendChild(mais);
    }

    mount.appendChild(bloco);
    return { renderizado: true, total: problematicos.length };
  }

  return {
    formatarPercentual,
    renderizarBadgeDyVs5a,
    renderizarRentabilidadeReal12M,
    criarEnhancerDePosicao,
    renderizarBlocoAlertaDashboard,
    badgeDyVs5aHtml,
    rentabReal12MHtml,
    SEVERIDADE_PARA_COR,
    SEVERIDADE_PARA_LABEL,
    CLASSIFICACAO_PARA_LABEL
  };
});