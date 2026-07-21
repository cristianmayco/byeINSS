// === PÁGINAS ===

let dashboardRenderSequence = 0;

// ============ DASHBOARD ============
async function renderDashboard(el) {
  const renderSequence = ++dashboardRenderSequence;
  const contractAlertsRequest = api('/api/dashboard/alertas-vencimento')
    .catch(error => {
      console.error(error);
      return { janela: 24, itens: [] };
    });
  const indicadoresRequest = api('/api/fiis/indicadores')
    .catch(error => {
      console.error(error);
      return { data: [] };
    });
  const [resumo, evolucao, proventos, alertas, alertasVencimento, indicadoresResp] = await Promise.all([
    api('/api/dashboard/resumo'),
    api('/api/dashboard/evolucao'),
    api('/api/dashboard/proventos-mensais'),
    api('/api/dashboard/alertas'),
    contractAlertsRequest,
    indicadoresRequest
  ]);
  if (renderSequence !== dashboardRenderSequence) return;

  const lucro = resumo.ganho_capital;
  const lucroClass = lucro >= 0 ? 'positive' : 'negative';
  const dyClass = resumo.dy_carteira_12m >= 8 ? 'positive' : 'negative';

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Dashboard</div>
        <div class="page-subtitle">Visão geral da sua carteira</div>
      </div>
    </div>

    <div id="dashboard-contract-alerts"></div>
    <div id="dashboard-indicadores-alerta"></div>

    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Patrimônio</div>
        <div class="kpi-value">${brl(resumo.patrimonio)}</div>
        <div class="kpi-delta ${lucroClass}">${lucro >= 0 ? '+' : ''}${brl(lucro)} (${pct(resumo.variacao_pct)})</div>
      </div>
      <div class="kpi"><div class="kpi-label">Investido</div>
        <div class="kpi-value">${brl(resumo.valor_investido)}</div>
      </div>
      <div class="kpi"><div class="kpi-label">Proventos 12M</div>
        <div class="kpi-value">${brl(resumo.proventos_12m)}</div>
        <div class="kpi-delta">${pct(resumo.dy_carteira_12m)} DY da carteira</div>
      </div>
      <div class="kpi"><div class="kpi-label">DY Carteira 12M</div>
        <div class="kpi-value ${dyClass}">${pct(resumo.dy_carteira_12m)}</div>
        <div class="kpi-delta">${resumo.posicoes.length} posições abertas</div>
      </div>
    </div>

    <div class="card-row">
      <div class="card">
        <div class="card-title">Evolução patrimonial</div>
        <div class="chart-container"><canvas id="chart-evolucao"></canvas></div>
      </div>
      <div class="card">
        <div class="card-title">Proventos mensais (12M)</div>
        <div class="chart-container"><canvas id="chart-proventos"></canvas></div>
      </div>
    </div>

    <div class="card-row">
      <div class="card">
        <div class="card-title">Composição por tipo</div>
        <div class="chart-container"><canvas id="chart-tipos"></canvas></div>
      </div>
      <div class="card">
        <div class="card-title">⚠️ Alertas</div>
        ${alertas.length ? `<div class="alerts-list">${alertas.map(a => `
          <div class="alert ${a.tipo}">
            <span class="alert-icon">${
              a.tipo === 'OPORTUNIDADE' ? '🟢' :
              a.tipo === 'PRECO_TETO' ? '🎯' : '⚠️'
            }</span>
            <span>${escapeHtml(a.msg)}</span>
          </div>`).join('')}</div>` : '<div class="muted">Nenhum alerta.</div>'}
      </div>
    </div>
  `;

  const openTickers = new Set(
    (resumo.posicoes || [])
      .filter(position => Number(position.qtd) > 0)
      .map(position => position.ticker)
  );
  const contractItems = (alertasVencimento.itens || [])
    .filter(item => openTickers.has(item.ticker));
  window.byeINSSContratosUI.renderDashboardContractAlerts(
    document.getElementById('dashboard-contract-alerts'),
    { items: contractItems, janela: alertasVencimento.janela || 24 }
  );

  // PRD 02 — Bloco de alerta de indicadores históricos (DY vs 5a).
  // Cruza com posições em aberto (mesma lógica que contratos).
  const indicadoresItens = (indicadoresResp && indicadoresResp.data ? indicadoresResp.data : [])
    .filter(it => openTickers.has(it.ticker));
  if (window.byeINSSIndicadoresUI) {
    window.byeINSSIndicadoresUI.renderizarBlocoAlertaDashboard(
      document.getElementById('dashboard-indicadores-alerta'),
      indicadoresItens,
      {
        maxItens: 10,
        // RF-023 — callback do botão "Atualizar indicadores" no estado vazio
        onAtualizar: () => {
          api('/api/fiis/scraper/indicadores/resync', { method: 'POST', body: {} })
            .then(() => window.location.reload())
            .catch(err => {
              console.error('falha ao atualizar indicadores:', err);
              const toast = document.getElementById('toast');
              if (toast) {
                toast.textContent = 'Falha ao atualizar indicadores. Verifique os logs.';
                toast.classList.add('show');
                setTimeout(() => toast.classList.remove('show'), 4000);
              }
            });
        }
      }
    );
  }

  // Gráfico de evolução
  chartsToDestroy.push(new Chart(document.getElementById('chart-evolucao'), {
    type: 'line',
    data: {
      labels: evolucao.map(e => e.mes),
      datasets: [
        { label: 'Patrimônio', data: evolucao.map(e => e.patrimonio), borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.1)', tension: 0.3, fill: true },
        { label: 'Investido', data: evolucao.map(e => e.investido), borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.05)', tension: 0.3, borderDash: [4,4] }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#8b95a4' } } },
      scales: { x: { ticks: { color: '#8b95a4' }, grid: { color: '#2a323d' } }, y: { ticks: { color: '#8b95a4', callback: v => 'R$ ' + (v/1000).toFixed(0) + 'k' }, grid: { color: '#2a323d' } } }
    }
  }));

  // Proventos
  chartsToDestroy.push(new Chart(document.getElementById('chart-proventos'), {
    type: 'bar',
    data: {
      labels: proventos.map(p => p.mes),
      datasets: [{ label: 'Proventos', data: proventos.map(p => p.total), backgroundColor: '#4ade80' }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: '#8b95a4' }, grid: { color: '#2a323d' } }, y: { ticks: { color: '#8b95a4', callback: v => 'R$ ' + v.toFixed(0) }, grid: { color: '#2a323d' } } }
    }
  }));

  // Tipos
  chartsToDestroy.push(new Chart(document.getElementById('chart-tipos'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(resumo.por_tipo),
      datasets: [{ data: Object.values(resumo.por_tipo), backgroundColor: ['#4ade80','#38bdf8','#fbbf24','#a78bfa','#f87171'] }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#8b95a4' } } } }
  }));
}

// ============ DETALHE DO FII ============
async function renderFiiDetail(el, { ticker } = {}) {
  const normalizedTicker = window.normalizeFiiTicker(ticker);
  el.replaceChildren();

  const header = document.createElement('div');
  header.className = 'page-header';
  const headerContent = document.createElement('div');
  const back = document.createElement('a');
  back.className = 'detail-back-link';
  back.href = '#posicoes';
  back.textContent = '← Voltar para Posições';
  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = normalizedTicker || (ticker ? `FII ${String(ticker)}` : 'Detalhe do FII');
  const subtitle = document.createElement('p');
  subtitle.className = 'page-subtitle';
  subtitle.textContent = 'Indicadores operacionais do fundo';
  headerContent.append(back, title, subtitle);
  header.appendChild(headerContent);
  el.appendChild(header);

  if (!normalizedTicker) {
    const state = document.createElement('div');
    state.className = 'empty-state';
    state.textContent = ticker
      ? `Ticker de FII inválido ou indisponível: ${String(ticker)}`
      : 'Ticker do FII não informado.';
    el.appendChild(state);
    return;
  }

  const summaryMount = document.createElement('div');
  summaryMount.className = 'fii-detail-summary loading-inline';
  summaryMount.textContent = 'Carregando resumo do FII…';
  const contractMount = document.createElement('div');
  contractMount.className = 'contract-card-mount loading-inline';
  contractMount.textContent = 'Carregando dados de contratos…';
  el.append(summaryMount, contractMount);

  const contractRequest = api(`/api/fiis/contratos/${encodeURIComponent(normalizedTicker)}`)
    .then(contrato => ({ contrato, error: null }))
    .catch(error => ({ contrato: null, error }));

  let ativos;
  try {
    ativos = await api('/api/ativos?ativo_only=1');
  } catch (error) {
    summaryMount.className = 'empty-state';
    summaryMount.textContent = 'Não foi possível carregar o resumo deste FII.';
    contractMount.replaceChildren();
    console.error(error);
    return;
  }

  const ativo = ativos.find(item => item.ticker === normalizedTicker && item.tipo === 'FII');
  if (!ativo) {
    summaryMount.className = 'empty-state';
    summaryMount.textContent = `FII ${normalizedTicker} não encontrado entre os ativos cadastrados.`;
    contractMount.remove();
    await contractRequest;
    return;
  }

  renderFiiSummary(summaryMount, ativo);
  const contractResult = await contractRequest;

  function renderContractCard(contrato, error = null) {
    contractMount.className = 'contract-card-mount';
    const card = window.byeINSSContratosUI.createContractCard({
      ativo,
      contrato,
      error: error?.message || error,
      onEdit: () => {
        const trigger = contractMount.querySelector('[data-action="edit"]');
        window.byeINSSContratosUI.openContractEditModal({
          ativo,
          contrato,
          trigger,
          background: document.querySelector('.content') || document.querySelector('main'),
          onSave: payload => api(`/api/fiis/contratos/${encodeURIComponent(normalizedTicker)}`, {
            method: 'PUT',
            body: payload
          }),
          onSaved: updated => {
            renderContractCard(updated);
            contractMount.querySelector('[data-action="edit"]')?.focus();
            toast('Dados de contratos atualizados');
          }
        });
      }
    });
    contractMount.replaceChildren(card);
  }

  renderContractCard(contractResult.contrato, contractResult.error);
}

function renderFiiSummary(mount, ativo) {
  mount.replaceChildren();
  mount.className = 'fii-detail-summary card';

  const fields = [
    ['Ticker', ativo.ticker],
    ['Segmento', ativo.segmento || 'Não informado'],
    ['Quantidade', Number(ativo.qtd_total || 0).toLocaleString('pt-BR')],
    ['Preço médio', brl(ativo.preco_medio)],
    ['Preço atual', brl(ativo.preco_atual)]
  ];

  for (const [label, value] of fields) {
    const item = document.createElement('div');
    item.className = 'fii-summary-item';
    const itemLabel = document.createElement('span');
    itemLabel.className = 'fii-summary-label';
    itemLabel.textContent = label;
    const itemValue = document.createElement('strong');
    itemValue.textContent = String(value);
    item.append(itemLabel, itemValue);
    mount.appendChild(item);
  }
}

// ============ POSIÇÕES ============
async function renderPosicoes(el) {
  const [ativos, resumo, indicadoresResp] = await Promise.all([
    api('/api/ativos?ativo_only=1'),
    api('/api/dashboard/resumo'),
    api('/api/fiis/indicadores').catch(() => ({ data: [] }))
  ]);
  const byTicker = Object.fromEntries(resumo.posicoes.map(p => [p.ticker, p]));
  // PRD 02: map { TICKER → item } para popular colunas DY vs 5y / Rent. real 12M
  const indicadoresByTicker = {};
  (indicadoresResp && indicadoresResp.data ? indicadoresResp.data : []).forEach(it => {
    indicadoresByTicker[(it.ticker || '').toUpperCase()] = it;
  });

  // PRD 02 sub-PR 4 (RF-019) — filtro de classificação via hash + ordenação por dy_vs_5a_pct
  const filtroAtivo = window.byeINSSIndicadoresUI
    ? window.byeINSSIndicadoresUI.parseFiltroClassificacaoFromHash(location.hash)
    : null;
  // Mapa ticker → item para aplicar filtro
  const allIndicadoresItens = Object.values(indicadoresByTicker);
  const itensFiltrados = window.byeINSSIndicadoresUI
    ? window.byeINSSIndicadoresUI.aplicarFiltroEOrdenacaoPosicoes(allIndicadoresItens, {
        classificacao: filtroAtivo,
        ordem: 'dy_vs_5a_pct',
        direcao: 'asc',
        nulosNoFim: true
      })
    : allIndicadoresItens;
  const tickersFiltrados = filtroAtivo
    ? new Set(itensFiltrados.map(i => (i.ticker || '').toUpperCase()))
    : null;

  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Posições</div><div class="page-subtitle">${ativos.length} ativos na carteira</div></div>
      <button class="btn btn-primary" onclick="openAtivoModal()">+ Adicionar ativo</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <div id="posicoes-filtros-indicadores"></div>
        <table>
          <thead><tr>
            <th>Ticker</th><th>Tipo</th><th>Segmento</th>
            <th>Qtd</th><th>PM</th><th>Atual</th>
            <th>Saldo</th><th>Var %</th>
            <th>P/VP</th><th>Vac.</th>
            <th>DY vs 5y</th><th>Rent. real 12M</th>
            <th>%Cart</th><th>%Ideal</th>
            <th>Nota</th><th>Ações</th>
          </tr></thead>
          <tbody>
            ${ativos.filter(a => {
              const qtd = byTicker[a.ticker]?.qtd || 0;
              if (qtd <= 0) return false;
              // Aplica filtro de classificação se ativo
              if (tickersFiltrados) {
                return tickersFiltrados.has((a.ticker || '').toUpperCase());
              }
              return true;
            }).map(a => {
              const p = byTicker[a.ticker] || {};
              const indicador = indicadoresByTicker[(a.ticker || '').toUpperCase()] || null;
              const varClass = p.variacao_pct >= 0 ? 'pos' : 'neg';
              const pvpClass = a.p_vp < 0.85 ? 'pos' : a.p_vp > 1.15 ? 'neg' : 'muted';
              const vacClass = a.vacancia > 20 ? 'neg' : a.vacancia > 10 ? 'pos' : 'muted';
              const safeTicker = escapeHtml(a.ticker);
              const safeType = escapeHtml(a.tipo);
              const safeSegment = escapeHtml(a.segmento || '—');
              const normalizedTicker = window.normalizeFiiTicker(a.ticker);
              const tickerCell = a.tipo === 'FII' && normalizedTicker
                ? `<a class="ticker-link" href="#fii/${encodeURIComponent(normalizedTicker)}" aria-label="Ver detalhes de ${normalizedTicker}"><strong>${safeTicker}</strong></a>`
                : `<strong>${safeTicker}</strong>`;
              const safeId = Number.isSafeInteger(Number(a.id)) ? Number(a.id) : null;
              const editButton = safeId == null
                ? ''
                : `<button class="btn btn-sm btn-secondary" onclick="openAtivoModal(${safeId})">Editar</button>`;
              const dyBadge = window.byeINSSIndicadoresUI && a.tipo === 'FII'
                ? window.byeINSSIndicadoresUI.badgeDyVs5aHtml(indicador)
                : '<span class="muted">—</span>';
              const rentCell = window.byeINSSIndicadoresUI && a.tipo === 'FII'
                ? window.byeINSSIndicadoresUI.rentabReal12MHtml(indicador)
                : '<span class="muted">—</span>';
              // PRD 02 sub-PR 4 (RF-018) — botão "Detalhes" abre matriz de rentabilidade
              const detailButton = (window.byeINSSIndicadoresUI && a.tipo === 'FII' && indicador)
                ? `<button type="button" class="btn btn-sm btn-secondary rentab-matriz-toggle-inline" data-rentab-matriz-ticker="${escapeHtml(a.ticker)}" aria-label="Ver detalhes de rentabilidade para ${safeTicker}">Detalhes</button>`
                : '';
              return `<tr>
                <td>${tickerCell}</td>
                <td><span class="tag blue">${safeType}</span></td>
                <td class="muted">${safeSegment}</td>
                <td>${p.qtd || 0}</td>
                <td>${brl(p.preco_medio)}</td>
                <td>${brl(p.preco_atual)}</td>
                <td>${brl(p.saldo)}</td>
                <td class="${varClass}">${pct(p.variacao_pct)}</td>
                <td class="${pvpClass}">${a.p_vp ? a.p_vp.toFixed(2) : '—'}</td>
                <td class="${vacClass}">${a.vacancia != null ? a.vacancia.toFixed(1) + '%' : '—'}</td>
                <td class="col-dy-vs-5a">${dyBadge}</td>
                <td class="col-rentab-real-12m">${rentCell}</td>
                <td>${pct(p.pct_carteira)}</td>
                <td>${pct(a.alvo_pct_carteira)}</td>
                <td>${a.nota || '—'}</td>
                <td>${detailButton}${editButton}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div id="modal-container"></div>
  `;

  // PRD 02 sub-PR 4 (RF-019) — chips de filtro de classificação
  if (window.byeINSSIndicadoresUI) {
    const mountFiltros = document.getElementById('posicoes-filtros-indicadores');
    if (mountFiltros) {
      const chips = window.byeINSSIndicadoresUI.renderizarFiltrosClassificacaoPosicoes({ ativo: filtroAtivo });
      mountFiltros.appendChild(chips);
      chips.querySelectorAll('button[data-value]').forEach(btn => {
        btn.addEventListener('click', () => {
          const v = btn.dataset.value;
          if (v === 'TODOS') {
            location.hash = '#posicoes';
            return;
          }
          const atual = window.byeINSSIndicadoresUI.parseFiltroClassificacaoFromHash(location.hash) || [];
          let novo;
          if (atual.includes(v)) {
            novo = atual.filter(x => x !== v);
          } else {
            novo = [...atual, v];
          }
          location.hash = window.byeINSSIndicadoresUI.gerarHashFiltro(novo);
        });
      });
    }
  }

  // PRD 02 sub-PR 4 (RF-018) — listeners dos botões "Detalhes" inline
  if (window.byeINSSIndicadoresUI) {
    el.querySelectorAll('button[data-rentab-matriz-ticker]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ticker = btn.dataset.rentabMatrizTicker;
        const ind = indicadoresByTicker[(ticker || '').toUpperCase()];
        if (!ind) return;
        const tr = btn.closest('tr');
        const controlsId = `rentab-matriz-${ticker}`;
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
          td.appendChild(window.byeINSSIndicadoresUI.renderizarMatrizRentabilidade(ind));
          container.appendChild(td);
          tr.insertAdjacentElement('afterend', container);
        }
      });
    });
  }
}

window.openAtivoModal = function(id = null) {
  const isEdit = !!id;
  const html = `
    <div class="modal-backdrop" onclick="closeModal(event)" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);display:grid;place-items:center;z-index:50;">
      <div class="card" style="width:480px;max-width:90vw;" onclick="event.stopPropagation()">
        <div class="card-title">${isEdit ? 'Editar ativo' : 'Novo ativo'}</div>
        <div class="form-grid">
          <div class="form-row"><label class="form-label">Ticker</label><input id="m-ticker" ${isEdit ? 'disabled' : ''}></div>
          <div class="form-row"><label class="form-label">Tipo</label>
            <select id="m-tipo"><option>FII</option><option>ACAO</option><option>TD</option><option>ETF</option><option>CRIPTO</option></select></div>
          <div class="form-row"><label class="form-label">Segmento</label><input id="m-segmento"></div>
          <div class="form-row"><label class="form-label">Nota</label><input id="m-nota" type="number" min="0" max="10"></div>
          <div class="form-row"><label class="form-label">DY mínimo %</label><input id="m-dy" type="number" step="0.1"></div>
          <div class="form-row"><label class="form-label">Preço-teto R$</label><input id="m-pt" type="number" step="0.01"></div>
          <div class="form-row"><label class="form-label">Preço muito bom R$</label><input id="m-pmb" type="number" step="0.01"></div>
          <div class="form-row"><label class="form-label">% Ideal carteira</label><input id="m-ideal" type="number" step="0.01" value="1.76"></div>
          <div class="form-row" style="grid-column:1/-1;"><label class="form-label">Observação</label><textarea id="m-obs" rows="2"></textarea></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
          <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveAtivo(${id})">Salvar</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modal-container').innerHTML = html;
  if (isEdit) {
    api(`/api/ativos/${id}`).then(a => {
      document.getElementById('m-tipo').value = a.tipo || 'FII';
      document.getElementById('m-segmento').value = a.segmento || '';
      document.getElementById('m-nota').value = a.nota || '';
      document.getElementById('m-dy').value = a.dy_minimo || '';
      document.getElementById('m-pt').value = a.preco_teto || '';
      document.getElementById('m-pmb').value = a.preco_muito_bom || '';
      document.getElementById('m-ideal').value = a.alvo_pct_carteira || 1.76;
      document.getElementById('m-obs').value = a.observacao || '';
    });
  } else {
    document.getElementById('m-ticker').focus();
  }
};

window.closeModal = function(ev) {
  if (ev && ev.target !== ev.currentTarget) return;
  document.getElementById('modal-container').innerHTML = '';
};

window.saveAtivo = async function(id) {
  const body = {
    ticker: document.getElementById('m-ticker').value,
    tipo: document.getElementById('m-tipo').value,
    segmento: document.getElementById('m-segmento').value,
    nota: parseInt(document.getElementById('m-nota').value) || 5,
    dy_minimo: parseFloat(document.getElementById('m-dy').value) || null,
    preco_teto: parseFloat(document.getElementById('m-pt').value) || null,
    preco_muito_bom: parseFloat(document.getElementById('m-pmb').value) || null,
    alvo_pct_carteira: parseFloat(document.getElementById('m-ideal').value) || 1.76,
    observacao: document.getElementById('m-obs').value
  };
  try {
    if (id) await api(`/api/ativos/${id}`, { method: 'PUT', body });
    else await api('/api/ativos', { method: 'POST', body });
    toast(id ? 'Ativo atualizado' : 'Ativo criado');
    closeModal();
    navigate('posicoes');
  } catch (e) {
    toast(e.message, 'error');
  }
};

// ============ LANÇAMENTOS ============
async function renderLancamentos(el) {
  const [lanc, ativos] = await Promise.all([
    api('/api/lancamentos'),
    api('/api/ativos')
  ]);
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Lançamentos</div><div class="page-subtitle">Compras e vendas (consolidam posição)</div></div>
      <button class="btn btn-primary" onclick="openLancamentoModal()">+ Novo lançamento</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Data</th><th>Tipo</th><th>Ativo</th><th>Qtd</th><th>Preço</th><th>Total</th><th>Corretora</th><th>Obs</th><th></th></tr></thead>
          <tbody>${lanc.length ? lanc.map(l => `
            <tr>
              <td>${l.data}</td>
              <td><span class="tag ${l.tipo === 'COMPRA' ? 'green' : 'red'}">${l.tipo}</span></td>
              <td><strong>${l.ticker}</strong></td>
              <td>${l.quantidade}</td>
              <td>${brl(l.preco)}</td>
              <td>${brl(l.quantidade * l.preco)}</td>
              <td class="muted">${l.corretora || '—'}</td>
              <td class="muted">${l.observacao || ''}</td>
              <td><button class="btn btn-sm btn-danger" onclick="delLancamento(${l.id})">×</button></td>
            </tr>`).join('') : '<tr><td colspan="9" class="empty-state">Nenhum lançamento.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div id="modal-container"></div>
  `;
  window._ativosCache = ativos;
}

window.openLancamentoModal = function() {
  const ativos = window._ativosCache || [];
  const html = `
    <div class="modal-backdrop" onclick="closeModal(event)" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);display:grid;place-items:center;z-index:50;">
      <div class="card" style="width:480px;max-width:90vw;" onclick="event.stopPropagation()">
        <div class="card-title">Novo lançamento</div>
        <div class="form-grid">
          <div class="form-row"><label class="form-label">Ativo</label>
            <select id="m-ativo">${ativos.map(a => `<option value="${a.id}">${a.ticker}</option>`).join('')}</select></div>
          <div class="form-row"><label class="form-label">Tipo</label>
            <select id="m-tipo"><option>COMPRA</option><option>VENDA</option></select></div>
          <div class="form-row"><label class="form-label">Data</label><input id="m-data" type="date" value="${todayISO()}"></div>
          <div class="form-row"><label class="form-label">Quantidade</label><input id="m-qtd" type="number"></div>
          <div class="form-row"><label class="form-label">Preço unit.</label><input id="m-preco" type="number" step="0.01"></div>
          <div class="form-row"><label class="form-label">Corretora</label><input id="m-corretora"></div>
          <div class="form-row" style="grid-column:1/-1;"><label class="form-label">Observação</label><input id="m-obs"></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
          <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveLancamento()">Salvar</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modal-container').innerHTML = html;
};

window.saveLancamento = async function() {
  const body = {
    ativo_id: parseInt(document.getElementById('m-ativo').value),
    tipo: document.getElementById('m-tipo').value,
    data: document.getElementById('m-data').value,
    quantidade: parseInt(document.getElementById('m-qtd').value),
    preco: parseFloat(document.getElementById('m-preco').value),
    corretora: document.getElementById('m-corretora').value,
    observacao: document.getElementById('m-obs').value
  };
  try {
    await api('/api/lancamentos', { method: 'POST', body });
    toast('Lançamento salvo');
    closeModal();
    navigate('lancamentos');
  } catch (e) { toast(e.message, 'error'); }
};

window.delLancamento = async function(id) {
  if (!confirm('Excluir lançamento?')) return;
  await api(`/api/lancamentos/${id}`, { method: 'DELETE' });
  toast('Excluído');
  navigate('lancamentos');
};

// ============ PROVENTOS ============
// PRD 03: KPIs separados (distribuíveis 12M vs amortizações 12M),
// filtros por tipo, gráfico empilhado Chart.js, badges de tipo
// (texto + cor + role=status), projeção distribuível separada de
// amortizações futuras explícitas.

// PRD 03: proventos-ui.js é carregado via <script src> (NÃO módulo),
// então não exporta no escopo bare. Helpers ficam em window.ProventosUI.
// Desempacotamos no escopo do módulo (e não por função) para que tanto
// renderProventos quanto openProvBatchModal possam chamá-los bare.
const _pui = (typeof window !== 'undefined' && window.ProventosUI) || {};
const renderFiltroTipos = _pui.renderFiltroTipos || (() => '');
const badgeTipo = _pui.badgeTipo || (() => '');
const emptyStateProventos = _pui.emptyStateProventos || (() => '');
const buildChartStackedDataset = _pui.buildChartStackedDataset || (() => ({ labels: [], datasets: [] }));
const renderLinhasBatch = _pui.renderLinhasBatch || (() => '');
const serializarTiposParaHash = _pui.serializarTiposParaHash || (() => '');
const lerTiposDoHash = _pui.lerTiposDoHash || (() => new Set());

async function renderProventos(el, params) {
  // 1) Ler filtros do hash (RF-013) — params.tipos já vem do router se houver.
  const tiposAtivos = (params && params.tipos)
    ? new Set(String(params.tipos).split(',').map(s => s.toUpperCase()))
    : new Set();
  const temFiltro = tiposAtivos.size > 0;
  const tiposParamQS = temFiltro
    ? `?tipos=${[...tiposAtivos].join(',')}`
    : '';
  const inicioFiltro = (params && params.inicio) || '';
  const fimFiltro = (params && params.fim) || '';

  // 2) Carregar dados em paralelo.
  // 2) Carregar dados em paralelo.
  const provsParams = new URLSearchParams();
  if (temFiltro) {
    for (const t of tiposAtivos) provsParams.append('tipos', t);
  }
  if (inicioFiltro) provsParams.set('inicio', inicioFiltro);
  if (fimFiltro) provsParams.set('fim', fimFiltro);
  const provsQS = provsParams.toString();
  const urlProvs = `/api/proventos${provsQS ? '?' + provsQS : ''}`;
  const urlMensal = `/api/dashboard/proventos-mensais${provsQS ? '?' + provsQS : ''}`;
  const [proventos, ativos, projecao, serieMensal, resumo] = await Promise.all([
    api(urlProvs),
    api('/api/ativos'),
    api('/api/dashboard/projecao-proventos'),
    api(urlMensal),
    api('/api/dashboard/resumo').catch(() => null)
  ]);

  // 3) KPIs (RF-016): distribuíveis 12M, amortizações 12M, projeção 12M.
  const distribuiveis12m = Number(resumo?.proventos_12m || 0);
  const amortizacoes12m = Number(resumo?.amortizacoes_12m || 0);
  const projecaoDistribuivel12m = Number(projecao.total_distribuivel_anual || 0);

  // 4) Render.
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Proventos</div>
      <div class="page-subtitle">Renda distribuível, amortizações e projeção anual (PRD 03)</div></div>
      <button class="btn btn-primary" onclick="openProvBatchModal()">📋 Atualizar proventos do mês</button>
    </div>

    <div class="filter-bar" style="margin:12px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center;" role="group" aria-label="Filtros por tipo">
      <span style="font-size:12px;color:#94a3b8;margin-right:4px;">Tipos:</span>
      <span id="filtro-tipos-proventos">${renderFiltroTipos(tiposAtivos)}</span>
      ${temFiltro ? `<a href="#proventos" class="btn-filtro-tipo"
        style="background:transparent;border:1px dashed #f97316;color:#fdba74;padding:6px 12px;border-radius:6px;font-size:12px;text-decoration:none;">
        Limpar filtros
      </a>` : ''}
    </div>

    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">Distribuíveis 12M</div>
        <div class="kpi-value">${brl(distribuiveis12m)}</div>
        <div class="kpi-delta">Dividendos + Rendimentos</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Amortizações 12M</div>
        <div class="kpi-value">${brl(amortizacoes12m)}</div>
        <div class="kpi-delta">Devolução de capital</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Projeção distribuível 12M</div>
        <div class="kpi-value pos">${brl(projecaoDistribuivel12m)}</div>
        <div class="kpi-delta">${(projecao.detalhes || []).filter(d => !d.sem_base_recorrente).length} FIIs com base</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">📊 Proventos mensais por tipo</div>
      <div style="display:flex;gap:14px;font-size:11px;color:#94a3b8;margin:6px 0;">
        <span><span style="color:#22c55e;">■</span> Dividendos</span>
        <span><span style="color:#3b82f6;">■</span> Rendimentos</span>
        <span><span style="color:#f97316;">■</span> Amortizações</span>
        <span><span style="color:#9ca3af;">■</span> Bonificações</span>
      </div>
      <div class="chart-container"><canvas id="chart-proventos" aria-label="Gráfico mensal empilhado de proventos por tipo" role="img"></canvas></div>
      <div class="visually-hidden" id="chart-proventos-text-table">
        ${(serieMensal || []).map(m =>
          `${m.mes}: distribuíveis ${brl(m.distribuiveis)}, amortizações ${brl(m.amortizacoes)}, bonificações ${brl(m.bonificacoes)}`
        ).join(' | ')}
      </div>
    </div>

    <div class="card-row">
      <div class="card">
        <div class="card-title">Histórico recente</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Pagto</th><th>Ticker</th><th>Valor/cota</th><th>Qtd elegível</th><th>Total</th><th>Tipo</th></tr></thead>
          <tbody>
            ${proventos.length ? proventos.slice(0, 30).map(p => `
              <tr>
                <td>${escapeHtml(p.data_pagto)}</td>
                <td><strong>${escapeHtml(p.ticker)}</strong></td>
                <td>${brl(p.valor_por_cota)}</td>
                <td>${p.quantidade_elegivel || 0}</td>
                <td>${brl(p.valor_total || 0)}</td>
                <td>${badgeTipo(p.tipo)}</td>
              </tr>
            `).join('') : emptyStateProventos(tiposAtivos)}
          </tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-title">📈 Projeção recorrente (próximos 12 meses)</div>
        <div class="table-wrap"><table>
          <thead><tr><th>FII</th><th>Qtd</th><th>Últ. distribuível</th><th>Mensal</th><th>Anual</th><th>DY dist.</th></tr></thead>
          <tbody>
            ${(projecao.detalhes || []).length ? projecao.detalhes.map(d => `
              <tr title="${d.sem_base_recorrente ? 'Sem base recorrente' : (d.desatualizado ? 'Base desatualizada (>90d)' : '')}">
                <td><strong>${escapeHtml(d.ticker)}</strong></td>
                <td>${d.qtd}</td>
                <td>${d.ultimo_distribuivel_por_cota ? brl(d.ultimo_distribuivel_por_cota) + ' (' + escapeHtml(d.ultimo_pagto_distribuivel || '—') + ')' : '<span class="muted">Sem base</span>'}</td>
                <td class="pos">${brl(d.mensal_distribuivel)}</td>
                <td class="pos">${brl(d.anual_distribuivel)}</td>
                <td>${pct(d.dy_anual_distribuivel)}</td>
              </tr>
            `).join('') : '<tr><td colspan="6" class="empty-state">Sem proventos registrados.</td></tr>'}
          </tbody>
        </table></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">🔄 Amortizações previstas (próximos 12 meses)</div>
      <p class="muted" style="font-size:12px;margin:6px 0;">Apenas eventos explícitos da agenda; <strong>não</strong> anualiza amortizações passadas.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>FII</th><th>Pagamento</th><th>Valor/cota</th><th>Qtd estimada</th><th>Total estimado</th></tr></thead>
        <tbody>
          ${(projecao.amortizacoes_previstas || []).length ? projecao.amortizacoes_previstas.map(a => `
            <tr>
              <td><strong>${escapeHtml(a.ticker)}</strong> ${badgeTipo('AMORTIZACAO')}</td>
              <td>${escapeHtml(a.data_pagto)}</td>
              <td>${brl(a.valor_por_cota)}</td>
              <td>${a.quantidade_estimada}</td>
              <td>${brl(a.valor_total_estimado)}</td>
            </tr>
          `).join('') : '<tr><td colspan="5" class="empty-state">Nenhuma amortização prevista na agenda.</td></tr>'}
        </tbody>
      </table></div>
    </div>
    <div id="modal-container"></div>
  `;

  // 5) Bind nos botões de filtro (RF-012).
  // Importante: usar location.hash em vez de navigate() direto, porque
  // navigate() não atualiza location.hash e o usuário esperaria ver a
  // URL refletir o filtro atual (PRD 03 RF-013). Setar hash dispara o
  // listener 'hashchange' em app.js que re-renderiza.
  el.querySelectorAll('.btn-filtro-tipo[data-tipo]').forEach(b => {
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      const t = b.dataset.tipo;
      let qs;
      if (t === '__all') {
        qs = '';
      } else if (tiposAtivos.has(t)) {
        const n = new Set(tiposAtivos); n.delete(t);
        qs = serializarTiposParaHash(n);
      } else {
        const n = new Set(tiposAtivos); n.add(t);
        qs = serializarTiposParaHash(n);
      }
      const targetHash = '#proventos' + qs;
      if (location.hash !== targetHash) {
        location.hash = targetHash;
      } else {
        // Já estamos nessa URL — re-renderiza explicitamente.
        navigate(targetHash);
      }
    });
  });

  // 6) Chart.js empilhado — destrói antes para evitar leak (RF-004 performance).
  const canvas = el.querySelector('#chart-proventos');
  if (canvas && typeof Chart !== 'undefined') {
    const ds = buildChartStackedDataset(serieMensal || []);
    const stacked = new Chart(canvas, {
      type: 'bar',
      data: { labels: ds.labels, datasets: ds.datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: prefersReducedMotion() ? false : { duration: 250 },
        scales: {
          x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
          y: { stacked: true, ticks: { color: '#94a3b8', callback: v => brl(v) }, grid: { color: '#1e293b' } }
        },
        plugins: {
          legend: { labels: { color: '#cbd5e1' } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${brl(ctx.parsed.y)}`,
              footer: (items) => {
                const total = items.reduce((s, i) => s + Number(i.parsed.y || 0), 0);
                return `Total: ${brl(total)}`;
              }
            }
          }
        }
      }
    });
    chartsToDestroy.push(stacked);
  }

  window._ativosCache = ativos;
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// PRD 03 RF-010: modal em lote com múltiplas parcelas por FII (uma linha por
// ticker + tipo). Permite registrar dividendo + amortização na mesma data.
window.openProvBatchModal = function() {
  const ativos = (window._ativosCache || []).filter(a => a.ativo);
  const hoje = todayISO();
  // Calcula o último provento por ticker para usar como sugestão
  api('/api/proventos').then(proventos => {
    const ultimos = {};
    proventos.forEach(p => {
      if (!ultimos[p.ticker] || p.data_pagto > ultimos[p.ticker].data_pagto) {
        ultimos[p.ticker] = p;
      }
    });
    // Pré-popula com uma linha por ticker (assume DIVIDENDO);
    // o usuário pode adicionar parcelas extras (RF-010).
    const iniciais = ativos.map(a => ({
      parcela_id: 'p_' + a.ticker,
      ticker: a.ticker,
      tipo: (ultimos[a.ticker] && ultimos[a.ticker].tipo) || 'DIVIDENDO',
      valor_por_cota: ultimos[a.ticker] ? ultimos[a.ticker].valor_por_cota : 0
    }));
    const html = `
      <div class="modal-backdrop" onclick="closeModal(event)" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);display:grid;place-items:center;z-index:50;overflow:auto;padding:20px;">
        <div class="card" style="width:760px;max-width:95vw;max-height:90vh;overflow:auto;" onclick="event.stopPropagation()">
          <div class="card-title">📋 Atualizar proventos do mês</div>
          <p class="muted" style="margin-bottom:12px;">Registre as parcelas por FII e tipo. É permitido registrar mais de um tipo para o mesmo FII e data (ex: dividendo + amortização).</p>
          <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
            <div><label class="form-label">Data pagamento</label><input id="b-pagto" type="date" value="${hoje}"></div>
            <div><label class="form-label">Data-com (opcional)</label><input id="b-com" type="date"></div>
          </div>
          <table style="font-size:12px;">
            <thead><tr><th>FII</th><th>Tipo</th><th>Valor por cota</th><th>Ação</th></tr></thead>
            <tbody id="batch-linhas">${renderLinhasBatch(iniciais)}</tbody>
          </table>
          <div style="display:flex;gap:8px;margin-top:12px;align-items:center;justify-content:space-between;">
            <div>
              <select id="batch-ticker-novo"
                style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:6px 10px;border-radius:6px;font-size:12px;">
                ${ativos.map(a => `<option value="${escapeHtml(a.ticker)}">${escapeHtml(a.ticker)}</option>`).join('')}
              </select>
              <button type="button" class="btn btn-secondary" id="batch-add"
                style="margin-left:6px;padding:6px 12px;">+ Adicionar parcela</button>
            </div>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
            <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
            <button class="btn btn-primary" onclick="saveProvBatch()">Salvar proventos</button>
          </div>
        </div>
      </div>`;
    document.getElementById('modal-container').innerHTML = html;
    const tbody = document.getElementById('batch-linhas');
    document.getElementById('batch-add').onclick = () => {
      const tk = document.getElementById('batch-ticker-novo').value;
      const nova = { parcela_id: 'p_' + Date.now(), ticker: tk, tipo: 'DIVIDENDO', valor_por_cota: 0 };
      // Anexa evitando duplicar existente
      if ([...tbody.querySelectorAll('tr')].some(tr => tr.dataset.ticker === tk && tr.querySelector('select[data-campo=tipo]').value === 'DIVIDENDO')) {
        // já existe uma linha DIVIDENDO para esse ticker — permite coexistir (RF-010)
      }
      const html = renderLinhasBatch([nova]);
      tbody.insertAdjacentHTML('beforeend', html);
      bindLinhasEvents(tbody);
    };
    bindLinhasEvents(tbody);
  });
};

function bindLinhasEvents(tbody) {
  tbody.querySelectorAll('button[data-campo=remover]').forEach(btn => {
    btn.onclick = () => btn.closest('tr').remove();
  });
  tbody.querySelectorAll('tr').forEach(tr => {
    const select = tr.querySelector('select[data-campo=tipo]');
    if (select) tr.dataset.ticker = select.closest('tr').querySelector('strong')?.textContent || '';
  });
}

window.preencherUltimos = function() {
  document.querySelectorAll('#batch-linhas tr input[data-campo=valor]').forEach(inp => {
    if (inp.placeholder && inp.placeholder !== '0') inp.value = inp.placeholder;
  });
};

window.saveProvBatch = async function() {
  const data_pagto = document.getElementById('b-pagto').value;
  const data_com = document.getElementById('b-com').value || null;
  const proventos = [];
  document.querySelectorAll('#batch-linhas tr').forEach(tr => {
    const tk = tr.querySelector('strong')?.textContent;
    const tipo = tr.querySelector('select[data-campo=tipo]')?.value;
    const v = parseFloat(tr.querySelector('input[data-campo=valor]')?.value);
    if (tk && tipo && v > 0) {
      proventos.push({ ticker: tk, valor_por_cota: v, tipo });
    }
  });
  if (!proventos.length) { toast('Preencha ao menos um valor', 'error'); return; }
  try {
    const r = await api('/api/proventos/batch', { method: 'POST', body: { data_pagto, data_com, proventos } });
    toast(`✓ ${r.inseridos} salvos, ${r.duplicados} duplicados, ${r.reclassificados || 0} reclassificados, ${r.ignorados} ignorados`);
    closeModal();
    navigate('proventos');
  } catch (e) { toast(e.message, 'error'); }
};

window.openProvModal = function() {
  const ativos = window._ativosCache || [];
  const html = `
    <div class="modal-backdrop" onclick="closeModal(event)" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);display:grid;place-items:center;z-index:50;">
      <div class="card" style="width:380px;max-width:90vw;" onclick="event.stopPropagation()">
        <div class="card-title">Novo provento</div>
        <div class="form-grid">
          <div class="form-row"><label class="form-label">Ativo</label>
            <select id="m-ativo">${ativos.map(a => `<option value="${a.id}">${a.ticker}</option>`).join('')}</select></div>
          <div class="form-row"><label class="form-label">Data pagamento</label><input id="m-pagto" type="date" value="${todayISO()}"></div>
          <div class="form-row"><label class="form-label">Data-com (opcional)</label><input id="m-com" type="date"></div>
          <div class="form-row"><label class="form-label">Valor por cota</label><input id="m-valor" type="number" step="0.0001"></div>
          <div class="form-row"><label class="form-label">Tipo</label>
            <select id="m-tipo"><option>DIVIDENDO</option><option>RENDIMENTO</option><option>AMORTIZACAO</option><option>BONIFICACAO</option></select></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
          <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveProv()">Salvar</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modal-container').innerHTML = html;
};

window.saveProv = async function() {
  try {
    await api('/api/proventos', { method: 'POST', body: {
      ativo_id: parseInt(document.getElementById('m-ativo').value),
      data_pagto: document.getElementById('m-pagto').value,
      data_com: document.getElementById('m-com').value || null,
      valor_por_cota: parseFloat(document.getElementById('m-valor').value),
      tipo: document.getElementById('m-tipo').value
    }});
    toast('Provento salvo');
    closeModal();
    navigate('proventos');
  } catch (e) { toast(e.message, 'error'); }
};

// ============ PREÇO-TETO ============
async function renderPrecoTeto(el) {
  const ativos = await api('/api/ativos?ativo_only=1');
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Preço-teto & alertas</div><div class="page-subtitle">Sinal de compra baseado em DY mínimo</div></div>
    </div>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Ticker</th><th>Atual</th><th>Preço-teto</th><th>Muito bom</th><th>DY mínimo</th>
          <th>Sinal</th><th>Ações</th>
        </tr></thead>
        <tbody>${ativos.map(a => {
          let sinal = '<span class="tag">—</span>';
          if (!a.preco_atual || !a.preco_teto) {
            // Sem cotação ou sem preço-teto definido: não há como classificar
            sinal = a.preco_teto
              ? '<span class="tag">— sem cotação</span>'
              : '<span class="tag">— defina o teto</span>';
          } else if (a.preco_muito_bom && a.preco_atual <= a.preco_muito_bom) {
            sinal = '<span class="tag green">🟢 MUITO BARATO</span>';
          } else if (a.preco_atual <= a.preco_teto) {
            sinal = '<span class="tag yellow">🎯 NO TETO</span>';
          } else if (a.preco_atual <= a.preco_teto * 1.1) {
            sinal = '<span class="tag yellow">🟡 PRÓXIMO DO TETO</span>';
          } else {
            sinal = '<span class="tag red">🔴 CARO</span>';
          }
          return `<tr>
            <td><strong>${a.ticker}</strong></td>
            <td>${a.preco_atual ? brl(a.preco_atual) : '—'}</td>
            <td>${a.preco_teto ? brl(a.preco_teto) : '—'}</td>
            <td>${a.preco_muito_bom ? brl(a.preco_muito_bom) : '—'}</td>
            <td>${a.dy_minimo ? pct(a.dy_minimo) : '—'}</td>
            <td>${sinal}</td>
            <td><button class="btn btn-sm btn-secondary" onclick="openAtivoModal(${a.id})">Editar</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>
    <div id="modal-container"></div>
  `;
}

// ============ SIMULADOR ============
async function renderSimulador(el) {
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Simulador de aportes</div><div class="page-subtitle">Projeção de patrimônio com juros compostos</div></div>
    </div>
    <div class="card">
      <div class="form-grid">
        <div class="form-row"><label class="form-label">Aporte inicial (R$)</label><input id="s-inicial" type="number" value="5000"></div>
        <div class="form-row"><label class="form-label">Aporte mensal (R$)</label><input id="s-mensal" type="number" value="1000"></div>
        <div class="form-row"><label class="form-label">Meses</label><input id="s-meses" type="number" value="120"></div>
        <div class="form-row"><label class="form-label">Taxa anual %</label><input id="s-taxa" type="number" step="0.1" value="12"></div>
        <div class="form-row" style="align-self:end;"><button class="btn btn-primary" id="btn-simular">Simular</button></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Resultado</div>
      <div id="sim-result"></div>
      <div class="chart-container" style="margin-top:16px;"><canvas id="chart-sim"></canvas></div>
    </div>
  `;
  document.getElementById('btn-simular').onclick = simular;
  simular();
}

async function simular() {
  const body = {
    aporte_inicial: parseFloat(document.getElementById('s-inicial').value) || 0,
    aporte_mensal: parseFloat(document.getElementById('s-mensal').value) || 0,
    meses: parseInt(document.getElementById('s-meses').value) || 12,
    taxa_anual: parseFloat(document.getElementById('s-taxa').value) || 12
  };
  const r = await api('/api/dashboard/simular', { method: 'POST', body });
  document.getElementById('sim-result').innerHTML = `
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Patrimônio final</div><div class="kpi-value">${brl(r.patrimonio_final)}</div></div>
      <div class="kpi"><div class="kpi-label">Total aportado</div><div class="kpi-value">${brl(r.total_aportado)}</div></div>
      <div class="kpi"><div class="kpi-label">Rendimento</div><div class="kpi-value pos">${brl(r.rendimento)}</div></div>
    </div>
  `;
  chartsToDestroy.forEach(c => { if (c.canvas?.id === 'chart-sim') c.destroy(); });
  const chart = new Chart(document.getElementById('chart-sim'), {
    type: 'line',
    data: {
      labels: r.serie.map(s => s.mes + 'm'),
      datasets: [
        { label: 'Patrimônio', data: r.serie.map(s => s.patrimonio), borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.1)', fill: true, tension: 0.3 },
        { label: 'Aportado', data: r.serie.map(s => s.aportado), borderColor: '#38bdf8', borderDash: [4,4], tension: 0.3 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#8b95a4' } } },
      scales: { x: { ticks: { color: '#8b95a4' }, grid: { color: '#2a323d' } }, y: { ticks: { color: '#8b95a4', callback: v => 'R$ ' + (v/1000).toFixed(0) + 'k' }, grid: { color: '#2a323d' } } }
    }
  });
  chartsToDestroy.push(chart);
}

// ============ FIRE ============
async function renderFire(el) {
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">FIRE — Independência Financeira</div><div class="page-subtitle">Patrimônio necessário para viver de renda</div></div>
    </div>
    <div class="card">
      <div class="form-grid">
        <div class="form-row"><label class="form-label">Renda mensal desejada (R$)</label><input id="f-renda" type="number" value="10000"></div>
        <div class="form-row"><label class="form-label">Taxa de retirada anual %</label><input id="f-retirada" type="number" step="0.1" value="4"></div>
        <div class="form-row"><label class="form-label">Rentabilidade anual %</label><input id="f-rend" type="number" step="0.1" value="12"></div>
        <div class="form-row" style="align-self:end;"><button class="btn btn-primary" id="btn-fire">Calcular</button></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Resultado</div>
      <div id="fire-result"></div>
      <div class="chart-container" style="margin-top:16px;"><canvas id="chart-fire"></canvas></div>
    </div>
  `;
  document.getElementById('btn-fire').onclick = calcularFire;
  calcularFire();
}

async function calcularFire() {
  const body = {
    renda_mensal_desejada: parseFloat(document.getElementById('f-renda').value) || 5000,
    taxa_retirada: parseFloat(document.getElementById('f-retirada').value) || 4,
    taxa_anual: parseFloat(document.getElementById('f-rend').value) || 12
  };
  const r = await api('/api/dashboard/fire', { method: 'POST', body });
  document.getElementById('fire-result').innerHTML = `
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Patrimônio necessário</div><div class="kpi-value">${brl(r.patrimonio_necessario)}</div></div>
      <div class="kpi"><div class="kpi-label">Renda mensal</div><div class="kpi-value">${brl(r.renda_mensal_desejada)}</div></div>
      <div class="kpi"><div class="kpi-label">Tempo até FIRE (sem aporte)</div><div class="kpi-value">${r.meses_ate_meta ? (r.meses_ate_meta/12).toFixed(1) + ' anos' : '—'}</div></div>
    </div>
  `;
  chartsToDestroy.forEach(c => { if (c.canvas?.id === 'chart-fire') c.destroy(); });
  const chart = new Chart(document.getElementById('chart-fire'), {
    type: 'line',
    data: {
      labels: r.serie.map(s => s.ano + 'a'),
      datasets: [{ label: 'Patrimônio projetado', data: r.serie.map(s => s.patrimonio), borderColor: '#4ade80', fill: true, backgroundColor: 'rgba(74,222,128,0.1)', tension: 0.3 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#8b95a4' } } },
      scales: { x: { ticks: { color: '#8b95a4' }, grid: { color: '#2a323d' } }, y: { ticks: { color: '#8b95a4', callback: v => 'R$ ' + (v/1000).toFixed(0) + 'k' }, grid: { color: '#2a323d' } } }
    }
  });
  chartsToDestroy.push(chart);
}

// ============ IMPORTAR ============
async function renderImportar(el) {
  const temScraper = !!(window.electronAPI?.scraperOpen);
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Importar dados</div><div class="page-subtitle">${temScraper ? 'Login embutido ou JSON manual' : 'Cole JSON ou importe da planilha'}</div></div>
    </div>
    ${temScraper ? `
    <div class="card" style="border-color: var(--primary);">
      <div class="card-title">🪟 Login embutido no Investidor10</div>
      <p class="muted" style="margin-bottom:12px;">Abre um navegador seguro dentro do app, você loga com sua conta, e os dados são extraídos automaticamente. Suas credenciais ficam isoladas no app.</p>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-primary" id="btn-scraper-open">1. Abrir navegador de login</button>
        <button class="btn btn-secondary" id="btn-scraper-check">2. Verificar se está logado</button>
        <button class="btn btn-primary" id="btn-scraper-import">3. Extrair e importar carteira</button>
        <button class="btn btn-primary" id="btn-scraper-enrich">4. Enriquecer com dados fundamentalistas</button>
        <button class="btn btn-primary" id="btn-scraper-agenda">5. Importar agenda de dividendos</button>
        <button class="btn btn-danger" id="btn-scraper-close">Fechar navegador</button>
      </div>
      <div id="scraper-status" style="margin-top:12px;"></div>
    </div>` : ''}
    <div class="card">
      <div class="card-title">Investidor10 (JSON manual)</div>
      <p class="muted" style="margin-bottom:8px;">Formato: <code>{ ativos: [...], cotacoes: {...}, proventos: [...] }</code></p>
      <textarea id="imp-i10" rows="10" style="width:100%;font-family:monospace;font-size:12px;"></textarea>
      <div style="margin-top:12px;"><button class="btn btn-primary" id="btn-imp-i10">Importar JSON</button></div>
      <div id="imp-i10-result" style="margin-top:12px;"></div>
    </div>
    <div class="card">
      <div class="card-title">Planilha PREÇO-TETO</div>
      <p class="muted" style="margin-bottom:8px;">Formato: <code>{ linhas: [{ ticker, valor_atual, preco_teto, preco_muito_bom, dy }] }</code></p>
      <textarea id="imp-sh" rows="10" style="width:100%;font-family:monospace;font-size:12px;"></textarea>
      <div style="margin-top:12px;"><button class="btn btn-primary" id="btn-imp-sh">Importar Planilha</button></div>
      <div id="imp-sh-result" style="margin-top:12px;"></div>
    </div>
  `;

  if (temScraper) {
    document.getElementById('btn-scraper-open').onclick = async () => {
      try {
        await window.electronAPI.scraperOpen('https://investidor10.com.br/wallet/my-wallet/pro');
        document.getElementById('scraper-status').innerHTML = '<div class="tag blue">Janela aberta. Faça login no Investidor10.</div>';
      } catch (e) { toast(e.message, 'error'); }
    };
    document.getElementById('btn-scraper-check').onclick = async () => {
      try {
        const r = await window.electronAPI.scraperCheck();
        document.getElementById('scraper-status').innerHTML = `<div class="tag ${r.isWallet ? 'green' : 'yellow'}">URL: ${r.url} ${r.isWallet ? '✓ logado' : '(aguarde login)'}</div>`;
      } catch (e) { toast(e.message, 'error'); }
    };
    document.getElementById('btn-scraper-import').onclick = async () => {
      try {
        const r = await window.electronAPI.scraperExtractAndImport();
        document.getElementById('scraper-status').innerHTML = `<div class="tag green">✓ ${r.extraido} ativos extraídos — ${r.importados.ativosImportados} importados, ${r.importados.cotacoesImportadas} cotações, ${r.importados.lancamentosImportados} lançamentos</div>`;
        toast('Importação concluída');
      } catch (e) { toast(e.message, 'error'); document.getElementById('scraper-status').innerHTML = `<div class="tag red">${e.message}</div>`; }
    };
    document.getElementById('btn-scraper-close').onclick = async () => {
      await window.electronAPI.scraperClose();
      document.getElementById('scraper-status').innerHTML = '';
    };
    document.getElementById('btn-scraper-enrich').onclick = async () => {
      document.getElementById('scraper-status').innerHTML = '<div class="tag yellow">⏳ Visitando página de cada FII... (pode demorar 30-60s)</div>';
      try {
        const r = await window.electronAPI.scraperEnriquecerTodos();
        let msg = `<div class="tag green">✓ ${r.sucessos}/${r.total} FIIs enriquecidos</div>`;
        if (r.resultados.some(x => !x.ok)) {
          msg += '<div style="margin-top:8px;font-size:11px;color:var(--text-dim);">Falhas: ' + r.resultados.filter(x => !x.ok).map(x => x.ticker + ' (' + x.erro + ')').join(', ') + '</div>';
        }
        document.getElementById('scraper-status').innerHTML = msg;
        toast('Enriquecimento concluído');
      } catch (e) {
        document.getElementById('scraper-status').innerHTML = `<div class="tag red">${e.message}</div>`;
        toast(e.message, 'error');
      }
    };
    document.getElementById('btn-scraper-agenda').onclick = async () => {
      document.getElementById('scraper-status').innerHTML = '<div class="tag yellow">⏳ Lendo agenda de dividendos...</div>';
      try {
        const r = await window.electronAPI.scraperAgendaDividendos();
        document.getElementById('scraper-status').innerHTML = `<div class="tag green">✓ ${r.total} lidos, ${r.inseridos} novos importados, ${r.ignorados} já existentes/ignorados</div>`;
        toast('Agenda importada');
      } catch (e) {
        document.getElementById('scraper-status').innerHTML = `<div class="tag red">${e.message}</div>`;
        toast(e.message, 'error');
      }
    };
  }

  document.getElementById('btn-imp-i10').onclick = async () => {
    try {
      const body = JSON.parse(document.getElementById('imp-i10').value || '{}');
      const r = await api('/api/import/investidor10', { method: 'POST', body });
      document.getElementById('imp-i10-result').innerHTML = `<div class="tag green">${r.ativosImportados} ativos, ${r.cotacoesImportadas} cotações, ${r.lancamentosImportados} lançamentos, ${r.proventosImportados} proventos</div>`;
      toast('Importação concluída');
    } catch (e) { toast(e.message, 'error'); }
  };
  document.getElementById('btn-imp-sh').onclick = async () => {
    try {
      const body = JSON.parse(document.getElementById('imp-sh').value || '{}');
      const r = await api('/api/import/sheets', { method: 'POST', body });
      document.getElementById('imp-sh-result').innerHTML = `<div class="tag green">${r.criados} criados, ${r.atualizados} atualizados</div>`;
      toast('Importação concluída');
    } catch (e) { toast(e.message, 'error'); }
  };
}

// ============ CONFIG ============
async function renderConfig(el) {
  const cfg = await api('/api/config');
  const v = k => cfg[k] || '';
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Configurações</div><div class="page-subtitle">Personalize os alertas, sinais e simulações</div></div>
    </div>

    <div class="card">
      <div class="card-title">🎯 Thresholds de preço (sinais de compra)</div>
      <p class="muted" style="margin-bottom:12px;">Defina faixas baseadas em % do preço-teto de cada FII. A página "Preço-teto" usa essas regras para classificar.</p>
      <div class="form-grid">
        <div class="form-row"><label class="form-label">Muito barato até (% do preço-teto)</label>
          <input id="c-pct-mb" type="number" step="0.1" value="${v('pct_muito_barato')}">
          <small class="muted">Abaixo deste % = 🟢 muito barato</small></div>
        <div class="form-row"><label class="form-label">Barato até (% do preço-teto)</label>
          <input id="c-pct-b" type="number" step="0.1" value="${v('pct_barato')}">
          <small class="muted">Abaixo deste % = 🎯 no teto</small></div>
        <div class="form-row"><label class="form-label">Caro até (% do preço-teto)</label>
          <input id="c-pct-c" type="number" step="0.1" value="${v('pct_caro')}">
          <small class="muted">Acima do anterior e até este = 🔴 caro</small></div>
        <div class="form-row"><label class="form-label">Acima deste %</label>
          <input disabled value="muito caro">
          <small class="muted">Calculado automaticamente</small></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">📈 Reajuste anual de aporte</div>
      <p class="muted" style="margin-bottom:12px;">Para o Simulador e Cenários: o aporte mensal cresce automaticamente este percentual todo ano.</p>
      <div class="form-grid">
        <div class="form-row"><label class="form-label">Reajuste anual %</label>
          <input id="c-reajuste" type="number" step="0.1" value="${v('reajuste_aporte_anual')}">
          <small class="muted">Ex: 10 = 10% a.a. (acompanha inflação)</small></div>
        <div class="form-row"><label class="form-label">Mês de início (1=jan, 12=dez)</label>
          <input id="c-mes-inicio" type="number" min="1" max="12" value="${v('reajuste_mes_inicio')}">
          <small class="muted">Em que mês do ano o primeiro reajuste acontece</small></div>
        <div class="form-row"><label class="form-label">Taxa anual padrão %</label>
          <input id="c-taxa" type="number" step="0.1" value="${v('taxa_anual_padrao')}">
          <small class="muted">Rentabilidade esperada (default 12%)</small></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">⚠️ Alertas</div>
      <div class="form-grid">
        <div class="form-row"><label class="form-label">Concentração máxima por ativo (%)</label>
          <input id="c-conc" type="number" step="0.1" value="${v('alerta_concentracao_pct')}">
          <small class="muted">Posição acima disso gera alerta amarelo</small></div>
        <div class="form-row"><label class="form-label">DY 12M máximo para alerta (%)</label>
          <input id="c-dy" type="number" step="0.1" value="${v('alerta_dy_limite')}">
          <small class="muted">DY acima disso = amarelo (possível unsustainable)</small></div>
        <div class="form-row"><label class="form-label" for="c-vencimento-janela">Janela de alerta de vencimento (meses)</label>
          <input id="c-vencimento-janela" type="number" min="1" step="1" aria-describedby="c-vencimento-janela-help">
          <small class="muted" id="c-vencimento-janela-help">Gera alerta quando o vencimento for inferior a este valor. Padrão: 24 meses.</small></div>
      </div>
    </div>

    <div class="card" style="border-color: var(--primary);">
      <button class="btn btn-primary" id="btn-save-config">💾 Salvar configurações</button>
      <span id="config-status" role="status" aria-live="polite" style="margin-left:12px;"></span>
    </div>
  `;
  const alertWindowInput = document.getElementById('c-vencimento-janela');
  const alertWindowValue = Number(cfg.vencimento_janela_alerta_meses);
  alertWindowInput.value = Number.isInteger(alertWindowValue) && alertWindowValue > 0
    ? String(alertWindowValue)
    : '';
  document.getElementById('btn-save-config').onclick = saveConfig;
}

async function saveConfig() {
  const alertWindowInput = document.getElementById('c-vencimento-janela');
  const alertWindow = Number(alertWindowInput.value);
  const configStatus = document.getElementById('config-status');

  if (!Number.isInteger(alertWindow) || alertWindow <= 0) {
    alertWindowInput.setAttribute('aria-invalid', 'true');
    alertWindowInput.focus();
    configStatus.setAttribute('role', 'alert');
    configStatus.textContent = 'Informe uma janela em meses inteiros maior que zero.';
    toast('Janela de vencimento inválida', 'error');
    return;
  }

  alertWindowInput.removeAttribute('aria-invalid');
  configStatus.setAttribute('role', 'status');
  configStatus.textContent = '';

  const body = {
    pct_muito_barato: parseFloat(document.getElementById('c-pct-mb').value),
    pct_barato: parseFloat(document.getElementById('c-pct-b').value),
    pct_caro: parseFloat(document.getElementById('c-pct-c').value),
    reajuste_aporte_anual: parseFloat(document.getElementById('c-reajuste').value),
    reajuste_mes_inicio: parseInt(document.getElementById('c-mes-inicio').value),
    taxa_anual_padrao: parseFloat(document.getElementById('c-taxa').value),
    alerta_concentracao_pct: parseFloat(document.getElementById('c-conc').value),
    alerta_dy_limite: parseFloat(document.getElementById('c-dy').value),
    vencimento_janela_alerta_meses: alertWindow
  };
  try {
    await api('/api/config', { method: 'PUT', body });
    configStatus.textContent = '✓ salvo';
    configStatus.className = 'tag green';
    toast('Configurações salvas');
  } catch (e) { toast(e.message, 'error'); }
}

// ============ CENÁRIOS ============
async function renderCenarios(el) {
  const cenarios = await api('/api/cenarios');
  const cfg = await api('/api/config');
  const reajusteDefault = parseFloat(cfg.reajuste_aporte_anual || 10);

  // Simular cada cenário
  const resultados = await Promise.all(cenarios.map(async c => {
    try { return { ...c, sim: await api(`/api/cenarios/${c.id}/simular`, { method: 'POST', body: {} }) }; }
    catch (e) { return { ...c, erro: e.message }; }
  }));

  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">🎯 Cenários & Projetos</div><div class="page-subtitle">Compare diferentes planos de aportes e metas</div></div>
      <button class="btn btn-primary" onclick="openCenarioModal()">+ Novo cenário</button>
    </div>

    ${cenarios.length === 0 ? `
      <div class="empty-state">
        <div class="empty-state-icon">🎯</div>
        <h3>Nenhum cenário ainda</h3>
        <p class="muted">Crie planos como "Aposentar com R$ 10k/mês em 20 anos" ou "Juntar R$ 1M em 10 anos"</p>
        <button class="btn btn-primary" onclick="openCenarioModal()">+ Criar primeiro cenário</button>
      </div>
    ` : `
    <div class="card-row">
      ${resultados.map(r => {
        const cor = r.cor || '#4ade80';
        const atingiu = r.sim?.atingiu_meta;
        const meses = r.sim?.meses_para_meta;
        return `
        <div class="card" style="border-left:4px solid ${cor};">
          <div style="display:flex;justify-content:space-between;align-items:start;">
            <div>
              <div style="font-size:16px;font-weight:600;">${escapeHtml(r.nome)}</div>
              <div class="muted" style="font-size:12px;margin:2px 0 8px;">${r.descricao || r.tipo}</div>
            </div>
            <div>
              <button class="btn btn-sm btn-secondary" onclick="openCenarioModal(${r.id})">✎</button>
              <button class="btn btn-sm btn-danger" onclick="delCenario(${r.id})">×</button>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0;font-size:13px;">
            <div><span class="muted">Meta:</span> <strong>${brl(r.valor_alvo)}</strong></div>
            <div><span class="muted">Prazo:</span> <strong>${r.prazo_meses} meses</strong></div>
            <div><span class="muted">Aporte:</span> <strong>${brl(r.aporte_mensal)}/mês</strong></div>
            <div><span class="muted">Reajuste:</span> <strong>${r.reajuste_aporte_anual}% a.a.</strong></div>
            <div><span class="muted">Taxa:</span> <strong>${r.taxa_anual}% a.a.</strong></div>
            <div><span class="muted">Inicial:</span> <strong>${brl(r.aporte_inicial)}</strong></div>
          </div>
          ${r.sim ? `
            <div style="padding-top:12px;border-top:1px solid var(--border);">
              <div style="display:flex;justify-content:space-between;align-items:baseline;">
                <div>
                  <div class="muted" style="font-size:11px;">Patrimônio final</div>
                  <div style="font-size:20px;font-weight:700;color:${atingiu ? 'var(--positive)' : 'var(--warn)'};">${brl(r.sim.patrimonio_final)}</div>
                </div>
                <div style="text-align:right;">
                  ${atingiu
                    ? `<div class="tag green">✓ Atinge em ${meses} meses</div>`
                    : `<div class="tag yellow">⚠ Não atinge</div>`}
                </div>
              </div>
              <div class="muted" style="font-size:12px;margin-top:6px;">
                Total aportado: ${brl(r.sim.total_aportado)} · Rendimento: ${brl(r.sim.rendimento)}
              </div>
            </div>
          ` : ''}
        </div>`;
      }).join('')}
    </div>
    `}

    <div id="modal-container"></div>
  `;
}

window.openCenarioModal = async function(id = null) {
  const cfg = await api('/api/config');
  let c = { nome:'', descricao:'', tipo:'PATRIMONIO', valor_alvo:'', prazo_meses:120, aporte_inicial:0,
            aporte_mensal:'', taxa_anual: cfg.taxa_anual_padrao || 12, reajuste_aporte_anual: cfg.reajuste_aporte_anual || 10, cor:'#4ade80' };
  if (id) c = await api(`/api/cenarios/${id}`);
  const html = `
    <div class="modal-backdrop" onclick="closeModal(event)" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);display:grid;place-items:center;z-index:50;">
      <div class="card" style="width:520px;max-width:95vw;" onclick="event.stopPropagation()">
        <div class="card-title">${id ? 'Editar cenário' : 'Novo cenário'}</div>
        <div class="form-grid">
          <div class="form-row" style="grid-column:1/-1;"><label class="form-label">Nome</label>
            <input id="cn-nome" value="${c.nome}" placeholder="Ex: Aposentar com R$ 10k/mês"></div>
          <div class="form-row" style="grid-column:1/-1;"><label class="form-label">Descrição (opcional)</label>
            <input id="cn-desc" value="${c.descricao || ''}"></div>
          <div class="form-row"><label class="form-label">Tipo</label>
            <select id="cn-tipo">
              <option ${c.tipo==='PATRIMONIO'?'selected':''} value="PATRIMONIO">Patrimônio (acumular)</option>
              <option ${c.tipo==='RENDA'?'selected':''} value="RENDA">Renda passiva (FIRE)</option>
              <option ${c.tipo==='APOSENTADORIA'?'selected':''} value="APOSENTADORIA">Aposentadoria</option>
            </select></div>
          <div class="form-row"><label class="form-label">Cor</label>
            <input id="cn-cor" type="color" value="${c.cor}"></div>
          <div class="form-row"><label class="form-label">Valor alvo (R$)</label>
            <input id="cn-alvo" type="number" step="0.01" value="${c.valor_alvo}"></div>
          <div class="form-row"><label class="form-label">Prazo (meses)</label>
            <input id="cn-prazo" type="number" min="1" value="${c.prazo_meses}"></div>
          <div class="form-row"><label class="form-label">Aporte mensal (R$)</label>
            <input id="cn-mensal" type="number" step="0.01" value="${c.aporte_mensal}"></div>
          <div class="form-row"><label class="form-label">Aporte inicial (R$)</label>
            <input id="cn-inicial" type="number" step="0.01" value="${c.aporte_inicial}"></div>
          <div class="form-row"><label class="form-label">Reajuste anual %</label>
            <input id="cn-reajuste" type="number" step="0.1" value="${c.reajuste_aporte_anual}"></div>
          <div class="form-row"><label class="form-label">Rentabilidade anual %</label>
            <input id="cn-taxa" type="number" step="0.1" value="${c.taxa_anual}"></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
          <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="saveCenario(${id})">Salvar</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modal-container').innerHTML = html;
};

window.saveCenario = async function(id) {
  // Ler valores
  const get = (id) => document.getElementById(id);
  const v = {
    nome: get('cn-nome')?.value?.trim() || '',
    descricao: get('cn-desc')?.value?.trim() || '',
    tipo: get('cn-tipo')?.value || 'PATRIMONIO',
    cor: get('cn-cor')?.value || '#4ade80',
    valor_alvo: parseFloat(get('cn-alvo')?.value),
    prazo_meses: parseInt(get('cn-prazo')?.value),
    aporte_mensal: parseFloat(get('cn-mensal')?.value),
    aporte_inicial: parseFloat(get('cn-inicial')?.value) || 0,
    reajuste_aporte_anual: parseFloat(get('cn-reajuste')?.value) || 0,
    taxa_anual: parseFloat(get('cn-taxa')?.value) || 12
  };

  // Validação local detalhada
  const erros = [];
  if (!v.nome) erros.push('Nome é obrigatório');
  if (!v.valor_alvo || v.valor_alvo <= 0) erros.push('Valor alvo deve ser > 0');
  if (!v.prazo_meses || v.prazo_meses <= 0) erros.push('Prazo deve ser > 0 meses');
  if (!v.aporte_mensal || v.aporte_mensal <= 0) erros.push('Aporte mensal deve ser > 0');
  if (erros.length) {
    toast('⚠ ' + erros.join(' · '), 'error');
    // Destaca campos com erro
    [['cn-nome', !v.nome], ['cn-alvo', !v.valor_alvo || v.valor_alvo <= 0], ['cn-prazo', !v.prazo_meses], ['cn-mensal', !v.aporte_mensal || v.aporte_mensal <= 0]].forEach(([id, err]) => {
      const el = get(id);
      if (el) el.style.borderColor = err ? 'var(--danger)' : '';
    });
    return;
  }

  // Limpa highlights
  ['cn-nome','cn-alvo','cn-prazo','cn-mensal'].forEach(id => {
    const el = get(id); if (el) el.style.borderColor = '';
  });

  try {
    if (id) {
      await api(`/api/cenarios/${id}`, { method: 'PUT', body: v });
    } else {
      await api('/api/cenarios', { method: 'POST', body: v });
    }
    toast('✓ Cenário salvo');
    closeModal();
    await navigate('cenarios');
  } catch (e) {
    toast('Erro: ' + e.message, 'error');
    console.error('Erro ao salvar cenário:', e);
  }
};

window.delCenario = async function(id) {
  if (!confirm('Excluir cenário?')) return;
  await api(`/api/cenarios/${id}`, { method: 'DELETE' });
  toast('Excluído');
  navigate('cenarios');
};
