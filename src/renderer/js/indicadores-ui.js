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

  // =====================================================================
  // Sub-PR 4 — RF-018, RF-019, RF-021, RF-022, RF-023
  // =====================================================================

  // ----- RF-018: matriz Nominal × Real × {1a, 2a, 5a} -----

  /**
   * Renderiza a matriz de rentabilidade como elemento <table role="grid">.
   * 6 valores: Nominal×{1a,2a,5a} + Real×{1a,2a,5a}.
   *
   * @param {object} item    dados do endpoint /api/fiis/indicadores
   * @returns {HTMLElement}
   */
  function renderizarMatrizRentabilidade(item) {
    const periodos = ['1a', '2a', '5a'];
    const chaves = {
      '1a': { nominal: 'rentab_nominal_1a', real: 'rentab_real_1a' },
      '2a': { nominal: 'rentab_nominal_2a', real: 'rentab_real_2a' },
      '5a': { nominal: 'rentab_nominal_5a', real: 'rentab_real_5a' }
    };

    const table = document.createElement('table');
    table.setAttribute('role', 'grid');
    table.className = 'rentab-matriz';
    table.setAttribute('aria-label', 'Matriz de rentabilidade Nominal vs Real para 1, 2 e 5 anos');

    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    trHead.appendChild(document.createElement('th')); // canto vazio
    for (const label of ['1 ano', '2 anos', '5 anos']) {
      const th = document.createElement('th');
      th.textContent = label;
      trHead.appendChild(th);
    }
    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const tipo of ['nominal', 'real']) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.setAttribute('scope', 'row');
      th.textContent = tipo === 'nominal' ? 'Nominal' : 'Real';
      tr.appendChild(th);
      for (const p of periodos) {
        const td = document.createElement('td');
        const v = item && item[chaves[p][tipo]];
        td.textContent = (v !== null && v !== undefined && Number.isFinite(Number(v)))
          ? formatarPercentual(v, 1)
          : '—';
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }

  /**
   * Cria um botão "Detalhes" que toggle a matriz de rentabilidade.
   * @param {object} item    dados do endpoint
   * @param {string} ticker  identificador único para o aria-controls
   * @returns {HTMLButtonElement}
   */
  function criarBotaoMatrizRentabilidade(item, ticker) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rentab-matriz-toggle';
    btn.setAttribute('aria-expanded', 'false');
    const controlsId = `rentab-matriz-${ticker}`;
    btn.setAttribute('aria-controls', controlsId);
    btn.setAttribute('aria-label', `Ver detalhes de rentabilidade para ${ticker}`);
    btn.textContent = 'Detalhes';
    btn.dataset.ticker = ticker;
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = 'Detalhes';
        const existing = document.getElementById(controlsId);
        if (existing) existing.remove();
      } else {
        btn.setAttribute('aria-expanded', 'true');
        btn.textContent = 'Ocultar';
        const container = document.createElement('tr');
        container.id = controlsId;
        container.className = 'rentab-matriz-row';
        const td = document.createElement('td');
        td.colSpan = 99;
        td.appendChild(renderizarMatrizRentabilidade(item));
        container.appendChild(td);
        btn.insertAdjacentElement('afterend', container);
      }
    });
    return btn;
  }

  // ----- RF-019: filtro por classificação + ordenação numérica -----

  const CLASSIFICACOES_VALIDAS = Object.freeze(['CONSISTENTE', 'ATENCAO', 'CRITICO', 'SEM_DADOS']);

  function parseFiltroClassificacaoFromHash(hash) {
    if (!hash || typeof hash !== 'string') return null;
    const match = String(hash).match(/[?&]filtro=([^&]+)/);
    if (!match) return null;
    let raw;
    try {
      raw = decodeURIComponent(match[1]);
    } catch {
      return null; // URI malformada — descarta silenciosamente
    }
    const valores = raw
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(v => CLASSIFICACOES_VALIDAS.includes(v))
      .sort();
    return valores.length ? valores : null;
  }

  function gerarHashFiltro(lista) {
    if (!Array.isArray(lista) || lista.length === 0) return '#posicoes';
    const sorted = [...lista].map(s => String(s).toUpperCase()).filter(s => CLASSIFICACOES_VALIDAS.includes(s)).sort();
    if (sorted.length === 0) return '#posicoes';
    return `#posicoes?filtro=${sorted.join(',')}`;
  }

  function classificacaoParaSeveridade(cls) {
    if (cls === 'CONSISTENTE') return ['CONSISTENTE'];
    if (cls === 'ATENCAO') return ['ATENCAO'];
    if (cls === 'CRITICO') return ['CRITICO'];
    if (cls === 'SEM_DADOS') return ['INDEFINIDO'];
    return [];
  }

  /**
   * Aplica filtro por classificação + ordenação numérica à lista de itens.
   *
   * @param {object[]} itens
   * @param {object} opts
   * @param {string|string[]} [opts.classificacao]  CONSISTENTE | ATENCAO | CRITICO | SEM_DADOS | array
   * @param {string} [opts.ordem]                   'dy_vs_5a_pct' | 'rentab_real_1a' | null
   * @param {'asc'|'desc'} [opts.direcao]           direção da ordenação
   * @param {boolean} [opts.nulosNoFim=true]        coloca nulls no fim
   * @returns {object[]} nova lista (não muta original)
   */
  function aplicarFiltroEOrdenacaoPosicoes(itens, opts = {}) {
    let arr = Array.isArray(itens) ? [...itens] : [];

    if (opts.classificacao) {
      const classes = Array.isArray(opts.classificacao) ? opts.classificacao : [opts.classificacao];
      const severidades = new Set();
      for (const c of classes) {
        for (const s of classificacaoParaSeveridade(String(c).toUpperCase())) {
          severidades.add(s);
        }
      }
      arr = arr.filter(it => severidades.has((it && it.severidade) || ''));
    }

    if (opts.ordem && ['dy_vs_5a_pct', 'rentab_real_1a'].includes(opts.ordem)) {
      const dir = opts.direcao === 'desc' ? -1 : 1;
      const nulosNoFim = opts.nulosNoFim !== false;
      arr = arr.slice().sort((a, b) => {
        const va = a ? a[opts.ordem] : null;
        const vb = b ? b[opts.ordem] : null;
        const na = (va === null || va === undefined || !Number.isFinite(Number(va)));
        const nb = (vb === null || vb === undefined || !Number.isFinite(Number(vb)));
        if (na && nb) return 0;
        if (na) return nulosNoFim ? 1 : -1;
        if (nb) return nulosNoFim ? -1 : 1;
        return (Number(va) - Number(vb)) * dir;
      });
    }

    return arr;
  }

  /**
   * Renderiza chips de filtro para a tabela Posições.
   *
   * @param {object} opts
   * @param {string[]} [opts.ativo]  classificações pressionadas
   * @returns {HTMLElement}
   */
  function renderizarFiltrosClassificacaoPosicoes(opts = {}) {
    const ativo = new Set((opts.ativo || []).map(s => String(s).toUpperCase()));
    const opcoes = ['TODOS', ...CLASSIFICACOES_VALIDAS];
    const wrap = document.createElement('div');
    wrap.className = 'indicadores-filtros';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Filtrar FIIs por classificação de DY vs 5 anos');

    for (const opt of opcoes) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'indicadores-filtro-chip';
      btn.dataset.value = opt;
      const pressed = opt === 'TODOS' ? ativo.size === 0 : ativo.has(opt);
      btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      btn.textContent = ({
        TODOS: 'Todos',
        CONSISTENTE: 'Consistente',
        ATENCAO: 'Atenção',
        CRITICO: 'Crítico',
        SEM_DADOS: 'Sem dados'
      })[opt] || opt;
      wrap.appendChild(btn);
    }
    return wrap;
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
   * Inclui contadores completos (RF-021), ação "Ver FIIs" (RF-022) e
   * estado vazio informativo (RF-023).
   *
   * @param {HTMLElement} mount    container onde o bloco será inserido
   * @param {object[]} itens       lista de /api/fiis/indicadores
   * @param {object} [opts]
   * @param {number} [opts.maxItens=10]  limite de FIIs listados no bloco
   * @param {function} [opts.onAtualizar]  callback do botão "Atualizar indicadores"
   * @returns {{ renderizado: boolean, total_afetado: number, total_avaliada: number, total_sem_dados: number }}
   */
  function renderizarBlocoAlertaDashboard(mount, itens, opts = {}) {
    if (!mount) return { renderizado: false, total_afetado: 0, total_avaliada: 0, total_sem_dados: 0 };

    const max = opts.maxItens || 10;
    const lista = Array.isArray(itens) ? itens : [];

    // RF-021 — contadores completos
    const problematicos = lista.filter(it => it && (it.severidade === 'CRITICO' || it.severidade === 'ATENCAO'));
    const semDados = lista.filter(it => it && it.severidade === 'INDEFINIDO').length;
    const totalAvaliada = lista.length; // todos foram avaliados (consistente + alerta + sem dados)

    // Limpa blocos anteriores (se houver)
    const existente = mount.querySelector('[data-bloco="indicadores-alerta"]');
    if (existente) existente.remove();
    const vazioExistente = mount.querySelector('[data-bloco="indicadores-vazio"]');
    if (vazioExistente) vazioExistente.remove();

    // RF-023 — estado vazio informativo (sem CRITICO/ATENCAO E com INDEFINIDO na lista OU lista vazia)
    if (problematicos.length === 0) {
      // Heurística: se não há CRITICO/ATENCAO e há INDEFINIDO, OR lista vazia → estado vazio
      const deveRenderizarVazio = semDados > 0 || lista.length === 0;
      if (deveRenderizarVazio) {
        const blocoVazio = document.createElement('section');
        blocoVazio.setAttribute('data-bloco', 'indicadores-vazio');
        blocoVazio.className = 'indicadores-vazio';
        blocoVazio.setAttribute('role', 'status');

        const msg = document.createElement('p');
        msg.className = 'indicadores-vazio__msg';
        msg.textContent = lista.length === 0
          ? 'Nenhum FII na carteira para avaliar indicadores históricos.'
          : 'Indicadores históricos ainda não disponíveis. Atualize os dados do I10 para começar.';
        blocoVazio.appendChild(msg);

        const acao = document.createElement('button');
        acao.type = 'button';
        acao.setAttribute('data-acao', 'atualizar-indicadores');
        acao.className = 'btn btn-primary';
        acao.setAttribute('aria-label', 'Atualizar indicadores históricos agora');
        acao.textContent = 'Atualizar indicadores';
        if (typeof opts.onAtualizar === 'function') {
          acao.addEventListener('click', () => {
            try { opts.onAtualizar(); } catch { /* swallow */ }
          });
        }
        blocoVazio.appendChild(acao);

        mount.appendChild(blocoVazio);
      }
      return { renderizado: false, total: 0, total_afetado: 0, total_avaliada: totalAvaliada, total_sem_dados: semDados };
    }

    // Bloco de alerta principal
    const bloco = document.createElement('section');
    bloco.setAttribute('data-bloco', 'indicadores-alerta');
    bloco.className = 'indicadores-alerta';
    bloco.setAttribute('aria-labelledby', 'indicadores-alerta-titulo');

    const criticos = problematicos.filter(p => p.severidade === 'CRITICO').length;
    const atencao = problematicos.filter(p => p.severidade === 'ATENCAO').length;

    // RF-021 — atributos data-* para os 4 contadores canônicos
    bloco.dataset.totalAfetado = String(problematicos.length);
    bloco.dataset.criticos = String(criticos);
    bloco.dataset.atencao = String(atencao);
    bloco.dataset.avaliada = String(totalAvaliada);
    bloco.dataset.semDados = String(semDados);

    const titulo = document.createElement('h3');
    titulo.id = 'indicadores-alerta-titulo';
    titulo.className = 'indicadores-alerta__titulo';
    titulo.textContent = `DY 12M abaixo da média histórica de 5 anos — ${criticos} crítico(s), ${atencao} atenção (${problematicos.length} de ${totalAvaliada} avaliados)`;
    bloco.appendChild(titulo);

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

    bloco.appendChild(ul);

    if (problematicos.length > max) {
      const mais = document.createElement('p');
      mais.className = 'indicadores-alerta__mais';
      mais.textContent = `+ ${problematicos.length - max} FII(s) adicionais com alerta`;
      bloco.appendChild(mais);
    }

    // RF-022 — ação "Ver FIIs (N)" navegando para #posicoes filtrado
    const acaoVer = document.createElement('a');
    acaoVer.setAttribute('data-acao', 'ver-fiiis');
    acaoVer.className = 'btn btn-secondary indicadores-alerta__acao';
    acaoVer.href = gerarHashFiltro(['ATENCAO', 'CRITICO']);
    acaoVer.textContent = `Ver FIIs (${problematicos.length})`;
    acaoVer.setAttribute('aria-label', `Ver lista de ${problematicos.length} FIIs com DY 12M abaixo da média histórica de 5 anos`);
    bloco.appendChild(acaoVer);

    mount.appendChild(bloco);
    return { renderizado: true, total: problematicos.length, total_afetado: problematicos.length, total_avaliada: totalAvaliada, total_sem_dados: semDados };
  }

  return {
    formatarPercentual,
    renderizarBadgeDyVs5a,
    renderizarRentabilidadeReal12M,
    criarEnhancerDePosicao,
    renderizarBlocoAlertaDashboard,
    badgeDyVs5aHtml,
    rentabReal12MHtml,
    // Sub-PR 4
    renderizarMatrizRentabilidade,
    criarBotaoMatrizRentabilidade,
    aplicarFiltroEOrdenacaoPosicoes,
    renderizarFiltrosClassificacaoPosicoes,
    parseFiltroClassificacaoFromHash,
    gerarHashFiltro,
    SEVERIDADE_PARA_COR,
    SEVERIDADE_PARA_LABEL,
    CLASSIFICACAO_PARA_LABEL,
    CLASSIFICACOES_VALIDAS
  };
});