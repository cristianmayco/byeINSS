(function initContratosUI(root, factory) {
  const contratosUI = factory(root);

  if (typeof module === 'object' && module.exports) {
    module.exports = contratosUI;
  }
  if (root) root.byeINSSContratosUI = contratosUI;
})(typeof window !== 'undefined' ? window : globalThis, function createContratosUI(root) {
  'use strict';

  const TIPOS_REAJUSTE = new Set(['IGPM', 'IPCA', 'FIXO', 'MISTO', 'OUTRO']);
  const REGION_LABEL = 'Vencimento médio de contratos e tipo de reajuste';
  let modalSequence = 0;
  let tooltipSequence = 0;

  function normalizeText(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .trim();
  }

  function getContractApplicability(ativo = {}) {
    if (normalizeText(ativo.tipo) !== 'FII') {
      return { applicable: false, reason: 'NAO_FII' };
    }

    const segmento = normalizeText(ativo.segmento);
    if (/\b(PAPEL|RECEBIVEIS|CREDITO|CRI)\b/.test(segmento)) {
      return { applicable: false, reason: 'PAPEL' };
    }
    if (/\bFI[\s-]*INFRA\b|\bINFRAESTRUTURA\b/.test(segmento)) {
      return { applicable: false, reason: 'FI_INFRA' };
    }
    if (/\bDESENVOLVIMENTO\b/.test(segmento)) {
      return { applicable: false, reason: 'DESENVOLVIMENTO' };
    }
    if (/\bHIBRIDO\b/.test(segmento)) {
      return { applicable: false, reason: 'HIBRIDO' };
    }
    return { applicable: true, reason: 'TIJOLO' };
  }

  function monthsUntil(value) {
    if (!value) return null;
    const raw = String(value);
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;

    const targetYear = Number(match[1]);
    const targetMonth = Number(match[2]);
    const targetDay = Number(match[3]);
    const now = new Date();
    let months = (targetYear - now.getFullYear()) * 12 +
      (targetMonth - (now.getMonth() + 1));
    if (targetDay < now.getDate()) months -= 1;

    // Testes e callers futuros podem fornecer timestamp ISO completo. Se ele já
    // passou, preserve o estado "expired" mesmo dentro do mesmo dia-calendário.
    if (months === 0 && raw.length > 10) {
      const instant = Date.parse(raw);
      if (Number.isFinite(instant) && instant < Date.now()) return -1;
    }
    return months;
  }

  function deriveContractViewState(ativo, contrato, options = {}) {
    const applicability = getContractApplicability(ativo);
    if (!applicability.applicable) {
      return { status: 'not-applicable', risk: 'none', reason: applicability.reason, manual: false };
    }
    if (options.loading) return { status: 'loading', risk: 'none', manual: false };
    if (options.error) {
      return { status: 'error', risk: 'none', message: String(options.error), manual: false };
    }

    const hasDate = Boolean(contrato?.vencimento_medio_contratos);
    const hasMonths = Number.isFinite(contrato?.vencimento_medio_contratos_meses);
    const hasAdjustment = Boolean(contrato?.tipo_reajuste);
    const manual = (contrato?.vencimento_medio_origem || contrato?.origem) === 'manual';

    if (!contrato || (!hasDate && !hasMonths && !hasAdjustment)) {
      return { status: 'empty', risk: 'none', manual };
    }

    const missing = [];
    if (!hasDate && !hasMonths) missing.push('vencimento');
    if (!hasAdjustment) missing.push('tipo_reajuste');

    const months = Number.isFinite(contrato.meses_ate_vencimento)
      ? contrato.meses_ate_vencimento
      : hasDate
        ? monthsUntil(contrato.vencimento_medio_contratos)
        : contrato.vencimento_medio_contratos_meses;

    if (Number.isFinite(months) && months < 0) {
      return { status: 'expired', risk: 'high', months, missing, manual };
    }
    if (missing.length) {
      return { status: 'partial', risk: 'unknown', months, missing, manual };
    }
    if (contrato.alerta_vencimento === true || contrato.alerta_vencimento === 1 ||
        (Number.isFinite(months) && months < 24)) {
      return { status: 'alert', risk: 'medium', months, missing, manual };
    }
    return { status: 'success', risk: 'stable', months, missing, manual };
  }

  function formatContractDate(value) {
    const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
  }

  function formatAdjustment(contrato = {}) {
    switch (contrato.tipo_reajuste) {
      case 'IGPM': return 'IGP-M';
      case 'IPCA': return 'IPCA';
      case 'FIXO': {
        const percentual = Number(contrato.reajuste_percentual);
        return Number.isFinite(percentual)
          ? `Fixo ${percentual.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
          : 'Fixo';
      }
      case 'MISTO': return 'Misto';
      case 'OUTRO': return 'Outro índice';
      default: return 'Não informado';
    }
  }

  function buildContractUpdatePayload(values = {}) {
    const data = String(values.data ?? '').trim() || null;
    const rawMonths = values.meses;
    const months = rawMonths === '' || rawMonths == null ? null : Number(rawMonths);
    const tipo = TIPOS_REAJUSTE.has(values.tipo_reajuste) ? values.tipo_reajuste : null;
    const rawPercentage = values.percentual;
    const percentage = tipo === 'FIXO' && rawPercentage !== '' && rawPercentage != null
      ? Number(rawPercentage)
      : null;

    return {
      vencimento_medio_contratos: data,
      vencimento_medio_contratos_meses: data ? null : (Number.isFinite(months) ? months : null),
      tipo_reajuste: tipo,
      reajuste_percentual: Number.isFinite(percentage) ? percentage : null
    };
  }

  function element(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function appendField(doc, list, label, value) {
    const wrapper = element(doc, 'div', 'contract-field');
    wrapper.appendChild(element(doc, 'dt', 'contract-field-label', label));
    wrapper.appendChild(element(doc, 'dd', 'contract-field-value', value));
    list.appendChild(wrapper);
  }

  function originLabel(contrato = {}) {
    const origin = contrato.vencimento_medio_origem || contrato.origem;
    return {
      main: 'Página principal',
      comunicado: 'Comunicado',
      fallback: 'Fonte alternativa',
      manual: 'Edição manual'
    }[origin] || 'Não informada';
  }

  function collectedLabel(value) {
    if (!value) return 'Não informado';
    const date = formatContractDate(value);
    return date === '—' ? 'Não informado' : date;
  }

  function createContractCard({ ativo = {}, contrato = null, loading = false, error = null, onEdit } = {}) {
    const doc = ativo.ownerDocument || root.document;
    if (!doc) throw new Error('Documento indisponível para renderizar contratos');

    const view = deriveContractViewState(ativo, contrato, { loading, error });
    const card = element(doc, 'section', `contract-card contract-card--${view.status}`);
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', REGION_LABEL);
    card.dataset.status = view.status;

    const header = element(doc, 'div', 'contract-card-header');
    header.appendChild(element(doc, 'h2', 'contract-card-title', 'Contratos & Reajuste'));
    tooltipSequence += 1;
    const tooltipId = `contract-help-${tooltipSequence}`;
    const help = element(doc, 'button', 'contract-help-trigger', '?');
    help.type = 'button';
    help.dataset.action = 'help';
    help.setAttribute('aria-label', 'Ajuda sobre contratos e reajuste');
    help.setAttribute('aria-describedby', tooltipId);
    const tooltip = element(
      doc,
      'span',
      'contract-tooltip',
      'Vencimento médio indica o prazo agregado dos contratos; tipo de reajuste informa o índice usado para atualizar os aluguéis.'
    );
    tooltip.id = tooltipId;
    tooltip.setAttribute('role', 'tooltip');
    header.append(help, tooltip);
    if (view.manual) {
      const manual = element(doc, 'span', 'contract-badge contract-badge--manual', 'Editado manualmente');
      manual.setAttribute('aria-label', 'Dados editados manualmente');
      header.appendChild(manual);
    }
    card.appendChild(header);

    if (view.status === 'loading') {
      card.setAttribute('aria-busy', 'true');
      card.appendChild(element(doc, 'p', 'contract-state', 'Carregando dados de contratos…'));
      return card;
    }

    if (view.status === 'not-applicable') {
      card.appendChild(element(doc, 'p', 'contract-state', `Não aplicável a este fundo (${ativo.segmento || 'segmento informado'}).`));
      return card;
    }

    if (view.status === 'error') {
      const message = element(doc, 'p', 'contract-state contract-state--error', 'Não foi possível carregar os dados de contratos.');
      message.setAttribute('role', 'alert');
      card.appendChild(message);
      return card;
    }

    if (view.status === 'empty') {
      card.appendChild(element(doc, 'p', 'contract-state', 'Informação não disponível no momento.'));
      card.appendChild(element(doc, 'p', 'contract-help', 'O Investidor10 nem sempre publica este dado. A coleta automática será disponibilizada em uma próxima atualização.'));
      const actions = element(doc, 'div', 'contract-actions');
      const retry = element(doc, 'button', 'btn btn-secondary', 'Re-tentar coleta');
      retry.type = 'button';
      retry.dataset.action = 'retry';
      retry.disabled = true;
      retry.setAttribute('aria-disabled', 'true');
      actions.appendChild(retry);
      if (typeof onEdit === 'function') actions.appendChild(createEditButton(doc, ativo, onEdit));
      card.appendChild(actions);
      return card;
    }

    const status = element(doc, 'div', `contract-risk contract-risk--${view.risk}`);
    if (view.status === 'expired') {
      status.textContent = 'Vencimento em data passada — revise manualmente';
      status.setAttribute('aria-label', 'Dado inconsistente: vencimento em data passada');
    } else if (view.status === 'alert') {
      status.textContent = `Atenção: vencimento${Number.isFinite(view.months) ? ` em ${view.months} meses` : ' próximo'}`;
      status.setAttribute('aria-label', status.textContent);
    } else {
      status.textContent = view.status === 'partial' ? 'Dados parciais' : 'Sem alerta de vencimento';
    }
    card.appendChild(status);

    const fields = element(doc, 'dl', 'contract-fields');
    let expiration = 'Não informado';
    if (contrato?.vencimento_medio_contratos) {
      expiration = formatContractDate(contrato.vencimento_medio_contratos);
      if (Number.isFinite(contrato.meses_ate_vencimento)) {
        expiration += ` (≈ ${contrato.meses_ate_vencimento} meses)`;
      }
    } else if (Number.isFinite(contrato?.vencimento_medio_contratos_meses)) {
      expiration = `≈ ${contrato.vencimento_medio_contratos_meses} meses`;
    }
    appendField(doc, fields, 'Vencimento médio', expiration);
    appendField(doc, fields, 'Índice de reajuste', formatAdjustment(contrato));
    appendField(doc, fields, 'Coletado em', collectedLabel(contrato?.coletado_em));
    appendField(doc, fields, 'Origem', originLabel(contrato));
    card.appendChild(fields);

    if (typeof onEdit === 'function') {
      const actions = element(doc, 'div', 'contract-actions');
      actions.appendChild(createEditButton(doc, ativo, onEdit));
      card.appendChild(actions);
    }
    return card;
  }

  function createEditButton(doc, ativo, onEdit) {
    const edit = element(doc, 'button', 'btn btn-secondary', 'Editar');
    edit.type = 'button';
    edit.dataset.action = 'edit';
    edit.addEventListener('click', () => onEdit(ativo));
    return edit;
  }

  function openContractEditModal({ ativo = {}, contrato = {}, trigger = null, background = null, onSave, onSaved, document: suppliedDocument } = {}) {
    const doc = suppliedDocument || root.document;
    if (!doc) throw new Error('Documento indisponível para abrir modal');

    const previousFocus = trigger || doc.activeElement;
    const appBackground = background || doc.querySelector('.content') || doc.querySelector('main');
    const backgroundWasInert = appBackground?.hasAttribute('inert') || false;
    if (appBackground) appBackground.setAttribute('inert', '');

    modalSequence += 1;
    const titleId = `contract-modal-title-${modalSequence}`;
    const descriptionId = `contract-modal-description-${modalSequence}`;

    const overlay = element(doc, 'div', 'modal-backdrop contract-modal-backdrop');
    const dialog = element(doc, 'div', 'contract-modal');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', titleId);
    dialog.setAttribute('aria-describedby', descriptionId);

    const closeButton = element(doc, 'button', 'contract-modal-close', 'Fechar');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Fechar edição de contratos');
    dialog.appendChild(closeButton);

    const title = element(doc, 'h2', 'contract-modal-title', `Editar contratos de ${ativo.ticker || 'FII'}`);
    title.id = titleId;
    dialog.appendChild(title);
    const description = element(doc, 'p', 'contract-modal-description', 'Informe uma data ou uma quantidade de meses e o tipo de reajuste.');
    description.id = descriptionId;
    dialog.appendChild(description);

    const form = element(doc, 'form', 'contract-form');
    form.noValidate = true;

    const dateRow = createLabeledInput(doc, 'Data de vencimento médio', 'date', 'vencimento-data');
    dateRow.input.dataset.field = 'data';
    dateRow.input.value = String(contrato.vencimento_medio_contratos || '').slice(0, 10);
    form.appendChild(dateRow.row);

    const monthsRow = createLabeledInput(doc, 'Vencimento médio em meses', 'number', 'vencimento-meses');
    monthsRow.input.dataset.field = 'meses';
    monthsRow.input.min = '0';
    monthsRow.input.step = '1';
    monthsRow.input.value = Number.isFinite(contrato.vencimento_medio_contratos_meses)
      ? String(contrato.vencimento_medio_contratos_meses)
      : '';
    form.appendChild(monthsRow.row);

    const typeRow = element(doc, 'div', 'form-row');
    const typeLabel = element(doc, 'label', 'form-label', 'Tipo de reajuste');
    const typeSelect = element(doc, 'select');
    typeSelect.id = `contrato-tipo-${modalSequence}`;
    typeSelect.dataset.field = 'tipo_reajuste';
    typeLabel.htmlFor = typeSelect.id;
    for (const [value, label] of [['', 'Não informado'], ['IGPM', 'IGP-M'], ['IPCA', 'IPCA'], ['FIXO', 'Fixo'], ['MISTO', 'Misto'], ['OUTRO', 'Outro índice']]) {
      const option = element(doc, 'option', '', label);
      option.value = value;
      typeSelect.appendChild(option);
    }
    typeSelect.value = TIPOS_REAJUSTE.has(contrato.tipo_reajuste) ? contrato.tipo_reajuste : '';
    typeRow.append(typeLabel, typeSelect);
    form.appendChild(typeRow);

    const percentRow = createLabeledInput(doc, 'Percentual fixo', 'number', 'reajuste-percentual');
    percentRow.input.dataset.field = 'reajuste_percentual';
    percentRow.input.min = '0';
    percentRow.input.max = '100';
    percentRow.input.step = '0.01';
    percentRow.input.value = Number.isFinite(contrato.reajuste_percentual)
      ? String(contrato.reajuste_percentual)
      : '';
    form.appendChild(percentRow.row);

    const errorBox = element(doc, 'div', 'form-error');
    errorBox.setAttribute('role', 'alert');
    errorBox.setAttribute('aria-live', 'assertive');
    errorBox.hidden = true;
    form.appendChild(errorBox);

    const actions = element(doc, 'div', 'contract-modal-actions');
    const cancelButton = element(doc, 'button', 'btn btn-secondary', 'Cancelar');
    cancelButton.type = 'button';
    const submitButton = element(doc, 'button', 'btn btn-primary', 'Salvar');
    submitButton.type = 'submit';
    submitButton.dataset.action = 'save';
    actions.append(cancelButton, submitButton);
    form.appendChild(actions);
    dialog.appendChild(form);
    overlay.appendChild(dialog);
    doc.body.appendChild(overlay);

    function updateFixedField() {
      const fixed = typeSelect.value === 'FIXO';
      percentRow.row.hidden = !fixed;
      percentRow.input.disabled = !fixed;
      percentRow.input.required = fixed;
      if (!fixed) percentRow.input.value = '';
    }

    dateRow.input.addEventListener('input', () => {
      if (dateRow.input.value) monthsRow.input.value = '';
    });
    dateRow.input.addEventListener('change', () => {
      if (dateRow.input.value) monthsRow.input.value = '';
    });
    monthsRow.input.addEventListener('input', () => {
      if (monthsRow.input.value) dateRow.input.value = '';
    });
    monthsRow.input.addEventListener('change', () => {
      if (monthsRow.input.value) dateRow.input.value = '';
    });
    typeSelect.addEventListener('change', updateFixedField);
    updateFixedField();

    const handle = { dialog, close, result: null };

    function close() {
      dialog.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      if (appBackground && !backgroundWasInert) appBackground.removeAttribute('inert');
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    }

    function focusableElements() {
      return Array.from(dialog.querySelectorAll('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'))
        .filter(node => !node.closest('[hidden]'));
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = focusableElements();
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && doc.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && doc.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function showError(message, field) {
      errorBox.textContent = message;
      errorBox.hidden = false;
      if (field) {
        field.setAttribute('aria-invalid', 'true');
        field.focus();
      }
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      errorBox.hidden = true;
      [dateRow.input, monthsRow.input, typeSelect, percentRow.input]
        .forEach(field => field.removeAttribute('aria-invalid'));

      const date = dateRow.input.value;
      const monthsValue = monthsRow.input.value;
      if (!date && monthsValue === '') {
        showError('Informe a data ou a quantidade de meses.', dateRow.input);
        return;
      }
      if (monthsValue !== '' && (!Number.isInteger(Number(monthsValue)) || Number(monthsValue) < 0)) {
        showError('Meses deve ser um inteiro maior ou igual a zero.', monthsRow.input);
        return;
      }
      if (!typeSelect.value) {
        showError('Selecione o tipo de reajuste.', typeSelect);
        return;
      }
      if (typeSelect.value === 'FIXO' &&
          (percentRow.input.value === '' || Number(percentRow.input.value) < 0 || Number(percentRow.input.value) > 100)) {
        showError('Informe um percentual fixo entre 0 e 100.', percentRow.input);
        return;
      }

      const payload = buildContractUpdatePayload({
        data: date,
        meses: monthsValue,
        tipo_reajuste: typeSelect.value,
        percentual: percentRow.input.value
      });

      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      let result;
      try {
        result = await onSave?.(payload);
      } catch (error) {
        showError(readableError(error));
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        return;
      }

      handle.result = result;
      close();
      onSaved?.(result);
    });

    closeButton.addEventListener('click', close);
    cancelButton.addEventListener('click', close);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });
    dialog.addEventListener('keydown', onKeyDown);

    dateRow.input.focus();
    return handle;
  }

  function createLabeledInput(doc, labelText, type, idPrefix) {
    const row = element(doc, 'div', 'form-row');
    const label = element(doc, 'label', 'form-label', labelText);
    const input = element(doc, 'input');
    input.type = type;
    input.id = `${idPrefix}-${modalSequence}`;
    label.htmlFor = input.id;
    row.append(label, input);
    return { row, label, input };
  }

  function readableError(error) {
    const raw = String(error?.message || error || 'Não foi possível salvar os dados.');
    try {
      const parsed = JSON.parse(raw);
      return parsed.error || 'Não foi possível salvar os dados.';
    } catch {
      return raw;
    }
  }

  function renderDashboardContractAlerts(container, { items = [], janela = 24 } = {}) {
    if (!container) return;
    const doc = container.ownerDocument || root.document;
    container.replaceChildren();

    if (!Array.isArray(items) || items.length === 0) {
      container.hidden = true;
      return;
    }

    container.hidden = false;
    const panel = element(doc, 'section', 'contract-alerts-panel');
    panel.setAttribute('role', 'alert');
    panel.setAttribute('aria-live', 'polite');

    const title = element(
      doc,
      'h2',
      'alerts-title',
      `${items.length} ${items.length === 1 ? 'FII' : 'FIIs'} com vencimento em menos de ${janela} meses`
    );
    panel.appendChild(title);

    const list = element(doc, 'ul', 'contract-alerts-list alerts-list');
    for (const item of items) {
      const row = element(doc, 'li', 'contract-alert-item alert-item');
      const ticker = String(item?.ticker ?? '');
      if (/^[A-Z]{4}11$/.test(ticker)) {
        const link = element(doc, 'a', 'ticker-link', ticker);
        link.href = `#fii/${encodeURIComponent(ticker)}`;
        link.setAttribute('aria-label', `Ver detalhes de ${ticker}`);
        row.appendChild(link);
      } else {
        row.appendChild(element(doc, 'span', 'contract-alert-ticker', ticker));
      }

      const chip = element(doc, 'span', 'alert-tag');
      if (Number.isFinite(item?.meses) && item.meses < 0) {
        chip.textContent = 'Data passada ou inconsistente';
        chip.setAttribute('aria-label', 'Vencimento em data passada ou inconsistente');
      } else {
        const months = Number.isFinite(item?.meses) ? `${item.meses} meses` : 'Prazo não informado';
        const adjustment = formatAdjustment({ tipo_reajuste: item?.tipo_reajuste });
        chip.textContent = `${months} · ${adjustment}`;
        chip.setAttribute('aria-label', `Vencimento: ${months}; reajuste: ${adjustment}`);
      }
      row.appendChild(chip);
      list.appendChild(row);
    }

    panel.appendChild(list);
    container.appendChild(panel);
  }

  return {
    getContractApplicability,
    deriveContractViewState,
    formatContractDate,
    formatAdjustment,
    buildContractUpdatePayload,
    createContractCard,
    openContractEditModal,
    renderDashboardContractAlerts
  };
});
