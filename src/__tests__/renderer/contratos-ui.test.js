// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  buildContractUpdatePayload,
  createContractCard,
  deriveContractViewState,
  formatAdjustment,
  formatContractDate,
  getContractApplicability,
  openContractEditModal,
} from '../../renderer/js/contratos-ui.js';

function makeHost({ ticker = 'HGLG11' } = {}) {
  const host = document.createElement('div');
  host.dataset.hostTicker = ticker;
  document.body.appendChild(host);
  return host;
}

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('getContractApplicability', () => {
  test('marca Logística como aplicável (Tijolo)', () => {
    expect(getContractApplicability({ tipo: 'FII', segmento: 'Logística' }))
      .toMatchObject({ applicable: true, reason: 'TIJOLO' });
  });

  test.each([
    ['Papel', { tipo: 'FII', segmento: 'Papel' }, 'PAPEL'],
    ['Recebíveis', { tipo: 'FII', segmento: 'Recebíveis' }, 'PAPEL'],
    ['Crédito', { tipo: 'FII', segmento: 'Crédito' }, 'PAPEL'],
    ['CRI', { tipo: 'FII', segmento: 'CRI' }, 'PAPEL'],
    ['FI-Infra', { tipo: 'FII', segmento: 'FI-Infra' }, 'FI_INFRA'],
    ['Desenvolvimento', { tipo: 'FII', segmento: 'Desenvolvimento' }, 'DESENVOLVIMENTO'],
    ['Híbrido', { tipo: 'FII', segmento: 'Híbrido' }, 'HIBRIDO'],
  ])('marca %s como não aplicável', (_label, ativo, expectedReason) => {
    const result = getContractApplicability(ativo);
    expect(result.applicable).toBe(false);
    expect(result.reason).toBe(expectedReason);
  });

  test('Escritórios é Tijolo aplicável', () => {
    expect(getContractApplicability({ tipo: 'FII', segmento: 'Escritórios' }))
      .toMatchObject({ applicable: true });
  });
});

describe('deriveContractViewState', () => {
  const baseAtivo = { tipo: 'FII', segmento: 'Logística' };

  test('loading antes da primeira resolução', () => {
    expect(deriveContractViewState(baseAtivo, null, { loading: true }))
      .toMatchObject({ status: 'loading' });
  });

  test('success stable quando vencimento distante e sem alerta', () => {
    const future = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(deriveContractViewState(baseAtivo, {
      vencimento_medio_contratos: future, tipo_reajuste: 'IGPM',
    })).toMatchObject({ status: 'success', risk: 'stable' });
  });

  test('alert quando meses abaixo de 24', () => {
    expect(deriveContractViewState(baseAtivo, {
      vencimento_medio_contratos_meses: 18, tipo_reajuste: 'IGPM',
    })).toMatchObject({ status: 'alert', risk: 'medium' });
  });

  test('expired quando vencimento em data passada', () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(deriveContractViewState(baseAtivo, {
      vencimento_medio_contratos: past, tipo_reajuste: 'IPCA',
    })).toMatchObject({ status: 'expired', risk: 'high' });
  });

  test('empty quando contrato ausente', () => {
    expect(deriveContractViewState(baseAtivo, null)).toMatchObject({ status: 'empty' });
  });

  test('partial quando só vencimento ou só reajuste disponíveis', () => {
    expect(deriveContractViewState(baseAtivo, { vencimento_medio_contratos_meses: 30 }))
      .toMatchObject({ status: 'partial', missing: ['tipo_reajuste'] });

    expect(deriveContractViewState(baseAtivo, { tipo_reajuste: 'IPCA' }))
      .toMatchObject({ status: 'partial', missing: ['vencimento'] });
  });

  test('not-applicable para FII de Papel', () => {
    expect(deriveContractViewState(
      { tipo: 'FII', segmento: 'Papel' },
      { vencimento_medio_contratos_meses: 18, tipo_reajuste: 'IGPM' },
    )).toMatchObject({ status: 'not-applicable' });
  });

  test('error com mensagem preservada', () => {
    expect(deriveContractViewState(baseAtivo, null, { error: 'Falha scraper' }))
      .toMatchObject({ status: 'error', message: 'Falha scraper' });
  });

  test('proveniência manual vira flag', () => {
    const view = deriveContractViewState(baseAtivo, {
      vencimento_medio_contratos_meses: 30, tipo_reajuste: 'IGPM', origem: 'manual',
    });
    expect(view).toMatchObject({ status: 'success' });
    expect(view.manual).toBe(true);
  });
});

describe('formatContractDate', () => {
  test('formata data ISO em pt-BR sem mudar dia por fuso', () => {
    const out = formatContractDate('2027-01-15');
    expect(out).toMatch(/15\/01\/2027/);
  });

  test('retorna em-dash para entrada nula', () => {
    expect(formatContractDate(null)).toBe('—');
    expect(formatContractDate('')).toBe('—');
  });
});

describe('formatAdjustment', () => {
  test('enum IGPM vira "IGP-M"', () => {
    expect(formatAdjustment({ tipo_reajuste: 'IGPM' })).toMatch(/IGP-M/);
  });

  test('FIXO com percentual numérico', () => {
    const out = formatAdjustment({ tipo_reajuste: 'FIXO', reajuste_percentual: 3.5 });
    expect(out).toMatch(/Fixo/i);
    expect(out).toMatch(/3[.,]5/);
  });

  test('OUTRO usa label controlado e nunca emite markup livre', () => {
    const out = formatAdjustment({ tipo_reajuste: 'OUTRO', outro_indice: 'INPC <script>' });
    expect(out).toBe('Outro índice');
    expect(out).not.toMatch(/<script>/);
  });

  test('texto hostil não altera o label controlado', () => {
    const out = formatAdjustment({ tipo_reajuste: 'OUTRO', outro_indice: '<img src=x onerror=alert(1)>' });
    expect(out).toBe('Outro índice');
  });
});

describe('buildContractUpdatePayload', () => {
  test('data e meses são mutuamente exclusivos (data zera meses)', () => {
    const payload = buildContractUpdatePayload({
      data: '2027-01-15', meses: 18, tipo_reajuste: 'IGPM',
    });
    expect(payload.vencimento_medio_contratos).toBe('2027-01-15');
    expect(payload.vencimento_medio_contratos_meses).toBeNull();
  });

  test('sair de FIXO limpa percentual stale', () => {
    const payload = buildContractUpdatePayload({
      meses: 24, tipo_reajuste: 'IGPM', percentual: 3.5,
    });
    expect(payload.reajuste_percentual).toBeNull();
  });

  test('preserva FIXO com percentual', () => {
    const payload = buildContractUpdatePayload({
      meses: 24, tipo_reajuste: 'FIXO', percentual: 4,
    });
    expect(payload.tipo_reajuste).toBe('FIXO');
    expect(payload.reajuste_percentual).toBe(4);
  });

  test('campos fora do contrato REST não são enviados', () => {
    const payload = buildContractUpdatePayload({
      meses: 24, tipo_reajuste: 'OUTRO', outro_indice: '<b>injetado</b>',
    });
    expect(payload).not.toHaveProperty('outro_indice');
    expect(Object.keys(payload)).toEqual([
      'vencimento_medio_contratos',
      'vencimento_medio_contratos_meses',
      'tipo_reajuste',
      'reajuste_percentual',
    ]);
  });
});

describe('createContractCard (DOM real)', () => {
  const baseAtivo = { tipo: 'FII', segmento: 'Logística', ticker: 'HGLG11' };

  test('retorna HTMLElement com role=region e aria-label exato', () => {
    const card = createContractCard({
      ativo: baseAtivo,
      contrato: { vencimento_medio_contratos_meses: 30, tipo_reajuste: 'IGPM' },
    });

    expect(card).toBeInstanceOf(window.HTMLElement);
    expect(card.tagName.toLowerCase()).toBe('section');
    expect(card.getAttribute('role')).toBe('region');
    expect(card.getAttribute('aria-label'))
      .toBe('Vencimento médio de contratos e tipo de reajuste');
    expect(card.dataset.status).toBe('success');
    document.body.appendChild(card);
  });

  test('partial exibe valores parciais com rótulo explícito', () => {
    const host = makeHost();
    const card = createContractCard({
      ativo: baseAtivo,
      contrato: { vencimento_medio_contratos_meses: 30 },
    });
    host.appendChild(card);

    expect(card.dataset.status).toBe('partial');
    expect(card.textContent).toMatch(/30/);
    expect(card.textContent).toMatch(/vencimento|reajuste/i);
  });

  test('proveniência manual adiciona badge textual', () => {
    const host = makeHost();
    const card = createContractCard({
      ativo: baseAtivo,
      contrato: {
        vencimento_medio_contratos_meses: 30, tipo_reajuste: 'IGPM', origem: 'manual',
      },
    });
    host.appendChild(card);

    expect(card.textContent).toMatch(/manual|editado/i);
  });

  test('empty desabilita honestamente o botão re-tentar', () => {
    const host = makeHost();
    const card = createContractCard({ ativo: baseAtivo, contrato: null });
    host.appendChild(card);

    expect(card.dataset.status).toBe('empty');
    const retry = card.querySelector('[data-action="retry"]');
    expect(retry).toBeTruthy();
    expect(retry.hasAttribute('disabled')).toBe(true);
    expect(retry.getAttribute('aria-disabled')).toBe('true');
  });

  test('botão Editar dispara callback onEdit com o ativo', () => {
    const host = makeHost();
    const onEdit = vi.fn();
    const card = createContractCard({
      ativo: baseAtivo,
      contrato: { vencimento_medio_contratos_meses: 30, tipo_reajuste: 'IGPM' },
      onEdit,
    });
    host.appendChild(card);

    const editBtn = card.querySelector('[data-action="edit"]');
    expect(editBtn).toBeTruthy();
    editBtn.click();

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(baseAtivo);
  });

  test('hostile ticker e segmento permanecem como texto, sem elementos executáveis', () => {
    const host = makeHost();
    const card = createContractCard({
      ativo: {
        tipo: 'FII',
        segmento: '<script>alert(1)</script>',
        ticker: '<img src=x onerror=alert(2)>',
      },
      contrato: {
        vencimento_medio_contratos_meses: 30,
        tipo_reajuste: 'OUTRO',
        outro_indice: '<svg onload=boom>',
      },
    });
    host.appendChild(card);

    expect(card.querySelector('script')).toBeNull();
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('svg')).toBeNull();
  });

  describe('tooltip de ajuda (a11y)', () => {
    function getHelpTrigger(card) {
      const candidates = Array.from(
        card.querySelectorAll('[data-action="help"], [aria-describedby], button[aria-label*="ajuda" i]'),
      );
      return candidates.find(el => el.getAttribute('aria-describedby')) || null;
    }

    test.each([
      ['success stable', { vencimento_medio_contratos_meses: 30, tipo_reajuste: 'IGPM' }, 'success'],
      ['alert', { vencimento_medio_contratos_meses: 18, tipo_reajuste: 'IGPM', alerta_vencimento: 1 }, 'alert'],
    ])('card %s expõe ajuda focável que explica os indicadores', (_label, contrato, status) => {
      const host = makeHost();
      const card = createContractCard({ ativo: baseAtivo, contrato });
      host.appendChild(card);

      expect(card.dataset.status).toBe(status);
      const trigger = getHelpTrigger(card);
      expect(trigger).toBeTruthy();
      expect(trigger.matches('a, button, [tabindex]:not([tabindex="-1"])')).toBe(true);

      const describedById = trigger.getAttribute('aria-describedby');
      const tooltip = card.ownerDocument.getElementById(describedById);
      expect(tooltip).toBeTruthy();
      expect(card.contains(tooltip)).toBe(true);
      expect(tooltip.getAttribute('role')).toBe('tooltip');
      expect(tooltip.textContent.toLowerCase()).toMatch(/vencimento\s+m[eé]dio/);
      expect(tooltip.textContent.toLowerCase()).toMatch(/tipo\s+de\s+reajuste|reajuste/);
    });
  });
});

describe('openContractEditModal (DOM real)', () => {
  function setup(opts = {}) {
    const trigger = document.createElement('button');
    trigger.textContent = 'abrir';
    document.body.appendChild(trigger);
    trigger.focus();

    const background = document.createElement('main');
    background.id = 'app-bg';
    document.body.appendChild(background);

    const handle = openContractEditModal({
      ativo: { tipo: 'FII', segmento: 'Logística', ticker: 'HGLG11' },
      contrato: opts.contrato ?? { vencimento_medio_contratos_meses: 30, tipo_reajuste: 'IGPM' },
      trigger,
      background,
      onSave: opts.onSave ?? vi.fn(async () => ({})),
    });

    return { trigger, background, handle };
  }

  test('retorna um HTMLElement com role=dialog e aria-modal=true', () => {
    const { handle } = setup();
    const dialog = handle.dialog;
    expect(dialog).toBeInstanceOf(window.HTMLElement);
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
  });

  test('foco inicial vai para o primeiro campo editável', () => {
    const { handle } = setup();
    const dateInput = handle.dialog.querySelector('input[type="date"]');
    expect(dateInput).toBeTruthy();
    expect(document.activeElement).toBe(dateInput);
  });

  test('Tab e Shift+Tab permanecem dentro do modal', () => {
    const { handle } = setup();
    const dialog = handle.dialog;
    const focusables = dialog.querySelectorAll('input, select, textarea, button');
    expect(focusables.length).toBeGreaterThan(1);

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    dialog.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'Tab', bubbles: true, cancelable: true,
    }));
    expect(document.activeElement).toBe(first);

    first.focus();
    dialog.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'Tab', shiftKey: true, bubbles: true, cancelable: true,
    }));
    expect(document.activeElement).toBe(last);
  });

  test('Escape fecha o modal e restaura foco no trigger', () => {
    const { trigger, handle } = setup();
    const dialog = handle.dialog;

    dialog.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.body.contains(dialog)).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  test('background fica inert enquanto modal aberto e libera ao fechar', () => {
    const { background, handle } = setup();
    expect(background.hasAttribute('inert')).toBe(true);
    handle.close();
    expect(background.hasAttribute('inert')).toBe(false);
  });

  test('data e meses são exclusivos — preencher data limpa meses', () => {
    const { handle } = setup();
    const dialog = handle.dialog;
    const dataInput = dialog.querySelector('input[type="date"]');
    const mesesInput = dialog.querySelector('input[data-field="meses"]');
    expect(dataInput && mesesInput).toBeTruthy();

    mesesInput.value = '18';
    mesesInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    mesesInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    dataInput.value = '2027-01-15';
    dataInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    dataInput.dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(mesesInput.value).toBe('');
  });

  test('FIXO mostra campo percentual required; trocar para IGPM esconde e limpa', () => {
    const { handle } = setup({
      contrato: { vencimento_medio_contratos_meses: 24, tipo_reajuste: 'IGPM' },
    });
    const dialog = handle.dialog;
    const tipoSelect = dialog.querySelector('select[data-field="tipo_reajuste"]');
    const percentInput = dialog.querySelector('input[data-field="reajuste_percentual"]');
    expect(percentInput).toBeTruthy();

    tipoSelect.value = 'FIXO';
    tipoSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(percentInput.hasAttribute('required')).toBe(true);

    percentInput.value = '3.5';
    tipoSelect.value = 'IGPM';
    tipoSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(
      percentInput.value === ''
      || percentInput.disabled
      || percentInput.hidden,
    ).toBeTruthy();
  });

  test('botão submit fica desabilitado enquanto pending', async () => {
    let resolveSave;
    const onSave = vi.fn(() => new Promise(r => { resolveSave = r; }));
    const { handle } = setup({ onSave });
    const dialog = handle.dialog;
    const submit = dialog.querySelector('button[type="submit"], [data-action="save"]');
    expect(submit.disabled).toBe(false);

    submit.click();
    expect(submit.disabled).toBe(true);

    resolveSave({ ok: true });
    await flush();
  });

  test('submit inválido foca um campo do modal e emite alert inline', () => {
    const { handle } = setup({ contrato: {} });
    const dialog = handle.dialog;
    const submit = dialog.querySelector('button[type="submit"], [data-action="save"]');
    submit.click();

    const alertEl = dialog.querySelector('[role="alert"]');
    expect(alertEl).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  test('submit válido chama onSave com payload, fecha modal e propaga resultado', async () => {
    const onSave = vi.fn(async () => ({
      ok: true,
      contrato: { vencimento_medio_contratos_meses: 24, tipo_reajuste: 'IPCA' },
    }));
    const { handle } = setup({ onSave });
    const dialog = handle.dialog;

    const mesesInput = dialog.querySelector('input[data-field="meses"]');
    mesesInput.value = '24';
    mesesInput.dispatchEvent(new window.Event('input', { bubbles: true }));

    const tipoSelect = dialog.querySelector('select[data-field="tipo_reajuste"]');
    tipoSelect.value = 'IPCA';
    tipoSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

    const submit = dialog.querySelector('button[type="submit"], [data-action="save"]');
    submit.click();
    await flush();

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload).toBeTruthy();
    expect(payload.vencimento_medio_contratos_meses).toBe(24);
    expect(payload.tipo_reajuste).toBe('IPCA');
    expect(payload.reajuste_percentual).toBeNull();

    await flush();
    expect(document.body.contains(dialog)).toBe(false);
  });
});