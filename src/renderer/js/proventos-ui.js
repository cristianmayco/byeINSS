// Helper UI puro para a tela de Proventos (PRD 03 RF-012 a RF-016, RF-021).
// Mantém a lógica separável do DOM para que seja testável em jsdom sem
// precisar montar todo o Express/Electron.

const TIPOS_VALIDOS = new Set(['DIVIDENDO', 'RENDIMENTO', 'BONIFICACAO', 'AMORTIZACAO']);

/**
 * Filtra proventos pelo conjunto de tipos. `null`/vazio = sem filtro.
 * @param {Array} proventos
 * @param {Set<string>|Array<string>} tiposSelecionados
 * @returns {Array}
 */
export function filtrarPorTipos(proventos, tiposSelecionados) {
  if (!tiposSelecionados) return proventos || [];
  const set = tiposSelecionados instanceof Set ? tiposSelecionados : new Set(tiposSelecionados);
  if (set.size === 0) return proventos || [];
  return (proventos || []).filter(p => set.has((p.tipo || '').toUpperCase()));
}

/**
 * Label canônico para um tipo, em português.
 */
export function labelTipo(tipo) {
  const t = String(tipo || '').toUpperCase();
  if (t === 'DIVIDENDO') return 'Dividendo';
  if (t === 'RENDIMENTO') return 'Rendimento';
  if (t === 'AMORTIZACAO') return 'Amortização';
  if (t === 'BONIFICACAO') return 'Bonificação';
  return t || 'Desconhecido';
}

/**
 * Cor associada ao tipo. Texto + borda (RF a11y: nunca diferencia apenas por cor).
 */
export function corTipo(tipo) {
  const t = String(tipo || '').toUpperCase();
  if (t === 'DIVIDENDO') return { bg: '#0f5132', fg: '#86efac', border: '#22c55e' };
  if (t === 'RENDIMENTO') return { bg: '#1e3a8a', fg: '#93c5fd', border: '#3b82f6' };
  if (t === 'AMORTIZACAO') return { bg: '#7c2d12', fg: '#fdba74', border: '#f97316' };
  if (t === 'BONIFICACAO') return { bg: '#4b5563', fg: '#d1d5db', border: '#9ca3af' };
  return { bg: '#374151', fg: '#9ca3af', border: '#6b7280' };
}

/**
 * Renderiza um badge de tipo HTML — combina texto + cor (acessível, RF a11y).
 */
export function badgeTipo(tipo) {
  const t = String(tipo || '').toUpperCase();
  if (!TIPOS_VALIDOS.has(t)) {
    return `<span class="tipo-badge tipo-desconhecido" role="status" aria-label="Tipo desconhecido" style="background:#374151;color:#9ca3af;border:1px dashed #6b7280;padding:2px 8px;border-radius:4px;font-size:11px;">Desconhecido</span>`;
  }
  const c = corTipo(t);
  return `<span class="tipo-badge" role="status" aria-label="Tipo ${labelTipo(t)}" style="background:${c.bg};color:${c.fg};border:1px solid ${c.border};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${labelTipo(t)}</span>`;
}

/**
 * Renderiza o estado vazio apropriado para a tela de Proventos.
 */
export function emptyStateProventos(tiposSelecionados) {
  const temFiltro = tiposSelecionados && (
    tiposSelecionados instanceof Set ? tiposSelecionados.size > 0 : tiposSelecionados.length > 0
  );
  if (temFiltro) {
    return `<tr><td colspan="6" class="empty-state">Nenhum provento encontrado para os tipos e período selecionados.</td></tr>`;
  }
  return `<tr><td colspan="6" class="empty-state">Sem proventos registrados. Use "Atualizar dividendos do mês" ou importe a agenda do I10.</td></tr>`;
}

/**
 * Renderiza a toolbar de filtros por tipo.
 * @param {Set<string>|Array<string>} tiposAtivos tipos atualmente selecionados (vazio = "Todos")
 */
export function renderFiltroTipos(tiposAtivos) {
  const set = tiposAtivos instanceof Set ? tiposAtivos : new Set(tiposAtivos || []);
  const opcoes = [
    { value: '__all', label: 'Todos' },
    { value: 'DIVIDENDO', label: 'Dividendos' },
    { value: 'RENDIMENTO', label: 'Rendimentos' },
    { value: 'AMORTIZACAO', label: 'Amortizações' },
    { value: 'BONIFICACAO', label: 'Bonificações' }
  ];
  return opcoes.map(o => {
    const ativo = (o.value === '__all' && set.size === 0) || set.has(o.value);
    return `<button type="button" class="btn-filtro-tipo" data-tipo="${o.value}"
      aria-pressed="${ativo}"
      style="background:${ativo ? '#1e293b' : 'transparent'};border:1px solid ${ativo ? '#3b82f6' : '#374151'};color:${ativo ? '#93c5fd' : '#94a3b8'};padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;">
      ${o.label}
    </button>`;
  }).join(' ');
}

/**
 * Lê o conjunto de tipos a partir do hash da URL (?tipos=DIVIDENDO,AMORTIZACAO).
 * Tipos inválidos são IGNORADOS (RF-013).
 * @param {string} hashRaw
 */
export function lerTiposDoHash(hashRaw) {
  if (!hashRaw || typeof hashRaw !== 'string') return new Set();
  const hash = hashRaw.startsWith('#') ? hashRaw.slice(1) : hashRaw;
  const queryStr = hash.includes('?') ? hash.split('?')[1] : '';
  const params = new URLSearchParams(queryStr);
  const raw = params.get('tipos');
  if (!raw) return new Set();
  const arr = String(raw).split(',').map(s => s.trim().toUpperCase()).filter(t => TIPOS_VALIDOS.has(t));
  return new Set(arr);
}

/**
 * Serializa o conjunto de tipos para o query string do hash.
 * @param {Set<string>|Array<string>} tipos
 */
export function serializarTiposParaHash(tipos) {
  const arr = tipos instanceof Set ? [...tipos] : (tipos || []);
  const validos = arr.map(s => String(s).toUpperCase()).filter(t => TIPOS_VALIDOS.has(t));
  if (validos.length === 0) return '';
  return `?tipos=${validos.join(',')}`;
}

/**
 * Monta o dataset Chart.js para gráfico mensal empilhado por tipo.
 * @param {Array<{mes:string, por_tipo: object}>} serieMensal
 * @returns {{labels: string[], datasets: Array<{label: string, data: number[], backgroundColor: string}>}}
 */
export function buildChartStackedDataset(serieMensal) {
  const labels = (serieMensal || []).map(s => s.mes);
  return {
    labels,
    datasets: [
      { key: 'DIVIDENDO', label: 'Dividendos', color: '#22c55e' },
      { key: 'RENDIMENTO', label: 'Rendimentos', color: '#3b82f6' },
      { key: 'AMORTIZACAO', label: 'Amortizações', color: '#f97316' },
      { key: 'BONIFICACAO', label: 'Bonificações', color: '#9ca3af' }
    ].map(d => ({
      label: d.label,
      data: (serieMensal || []).map(s => Number(s.por_tipo?.[d.key] || 0)),
      backgroundColor: d.color
    }))
  };
}

/**
 * Renderiza o bloco de "atualizar proventos em lote" com seleção de TIPO por linha.
 * Lista de linhas inclui parcela_id para permitir múltiplas parcelas do mesmo FII (RF-010).
 * @param {Array<{parcela_id, ticker, tipo, valor_por_cota}>} linhas
 */
export function renderLinhasBatch(linhas) {
  if (!linhas || linhas.length === 0) {
    return '<tr class="linhas-vazia"><td colspan="4" class="muted">Nenhuma parcela. Use "Adicionar parcela" para começar.</td></tr>';
  }
  return linhas.map((l, i) => `
    <tr data-parcela-id="${l.parcela_id}">
      <td><strong>${l.ticker}</strong></td>
      <td>
        <select data-campo="tipo" data-parcela="${l.parcela_id}"
          style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:4px;border-radius:4px;font-size:12px;">
          ${['DIVIDENDO','RENDIMENTO','AMORTIZACAO','BONIFICACAO'].map(t =>
            `<option value="${t}" ${l.tipo === t ? 'selected' : ''}>${labelTipo(t)}</option>`
          ).join('')}
        </select>
      </td>
      <td>
        <input data-campo="valor" data-parcela="${l.parcela_id}"
          type="number" step="0.0001" value="${l.valor_por_cota}"
          style="width:100%;padding:4px 8px;background:#0f172a;border:1px solid #334155;color:#e2e8f0;border-radius:4px;font-size:12px;">
      </td>
      <td>
        <button type="button" data-campo="remover" data-parcela="${l.parcela_id}"
          style="background:transparent;border:1px solid #ef4444;color:#fca5a5;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;">
          Remover
        </button>
      </td>
    </tr>
  `).join('');
}

export const TIPOS_VALIDOS_LIST = ['DIVIDENDO', 'RENDIMENTO', 'BONIFICACAO', 'AMORTIZACAO'];
