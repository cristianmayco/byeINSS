// TDD Red Phase — escrito ANTES de src/shared/contratos.js existir
// Cobre RF-001 a RF-005 do PRD 12 (lógica pura de alerta + parse de inputs).

import { describe, it, expect } from 'vitest';
import {
  calcularAlertaVencimento,
  parseTipoReajuste,
  validarDadosContratos,
  TIPOS_REAJUSTE
} from '../../shared/contratos.js';

describe('calcularAlertaVencimento', () => {
  it('alerta = false quando vencimento em data futura > 24m', () => {
    const hoje = '2026-07-20';
    const futuroLonge = '2029-01-15'; // ~30 meses
    const r = calcularAlertaVencimento({ dataVenc: futuroLonge, meses: null, hoje });
    expect(r.alerta_24m).toBe(false);
    expect(r.vencido).toBe(false);
    expect(r.meses_ate_vencimento).toBeGreaterThan(24);
  });

  it('alerta = true quando dataVenc < 24m no futuro', () => {
    const hoje = '2026-07-20';
    const dataCurta = '2027-08-15'; // ~13 meses
    const r = calcularAlertaVencimento({ dataVenc: dataCurta, meses: null, hoje });
    expect(r.alerta_24m).toBe(true);
    expect(r.vencido).toBe(false);
    expect(r.meses_ate_vencimento).toBeLessThan(24);
  });

  it('alerta = true quando meses = 18 (sem data)', () => {
    const r = calcularAlertaVencimento({ dataVenc: null, meses: 18, hoje: '2026-07-20' });
    expect(r.alerta_24m).toBe(true);
    expect(r.meses_ate_vencimento).toBe(18);
  });

  it('alerta = false quando meses = 36', () => {
    const r = calcularAlertaVencimento({ dataVenc: null, meses: 36, hoje: '2026-07-20' });
    expect(r.alerta_24m).toBe(false);
    expect(r.meses_ate_vencimento).toBe(36);
  });

  it('limite 24m exato NÃO aciona alerta (boundary)', () => {
    const r = calcularAlertaVencimento({ dataVenc: null, meses: 24, hoje: '2026-07-20' });
    expect(r.alerta_24m).toBe(false); // exatamente 24 = estável
  });

  it('limite 23m aciona alerta (boundary)', () => {
    const r = calcularAlertaVencimento({ dataVenc: null, meses: 23, hoje: '2026-07-20' });
    expect(r.alerta_24m).toBe(true);
  });

  it('data passada marca vencido=true e alerta=true', () => {
    const r = calcularAlertaVencimento({ dataVenc: '2025-01-01', meses: null, hoje: '2026-07-20' });
    expect(r.vencido).toBe(true);
    expect(r.alerta_24m).toBe(true);
  });

  it('sem nenhum input retorna estado vazio sem alerta', () => {
    const r = calcularAlertaVencimento({ dataVenc: null, meses: null, hoje: '2026-07-20' });
    expect(r.alerta_24m).toBe(false);
    expect(r.vencido).toBe(false);
    expect(r.meses_ate_vencimento).toBeNull();
    expect(r.disponivel).toBe(false);
  });

  it('precedência: dataVenc sobrescreve meses quando ambos informados (RF coerência)', () => {
    // PRD 12: "pelo menos uma das colunas ... não podem ambas ser preenchidas de fontes divergentes sem flag"
    // Quando ambos vierem, usa dataVenc e ignora meses.
    const hoje = '2026-07-20';
    const r = calcularAlertaVencimento({ dataVenc: '2029-01-15', meses: 18, hoje });
    // data vence em ~30m → sem alerta (meses 18 é ignorado por regra de precedência)
    expect(r.alerta_24m).toBe(false);
    expect(r.meses_ate_vencimento).toBeGreaterThan(24);
  });
});

describe('parseTipoReajuste', () => {
  it('aceita IGPM (maiúsculas)', () => {
    expect(parseTipoReajuste('IGPM').tipo).toBe('IGPM');
  });

  it('normaliza variações (IGP-M, IGP M, IGP-m)', () => {
    expect(parseTipoReajuste('IGP-M').tipo).toBe('IGPM');
    expect(parseTipoReajuste('IGP M').tipo).toBe('IGPM');
    expect(parseTipoReajuste('igp-m').tipo).toBe('IGPM');
  });

  it('normaliza variações IPCA', () => {
    expect(parseTipoReajuste('IPCA').tipo).toBe('IPCA');
    expect(parseTipoReajuste('ipca').tipo).toBe('IPCA');
    expect(parseTipoReajuste('IPCA-15').tipo).toBe('IPCA');
  });

  it('FIXO exige percentual', () => {
    const r = parseTipoReajuste('Fixo 3%');
    expect(r.tipo).toBe('FIXO');
    expect(r.percentual).toBe(3.0);
  });

  it('FIXO sem percentual retorna erro', () => {
    const r = parseTipoReajuste('Fixo');
    expect(r.erro).toBeTruthy();
    expect(r.erro).toMatch(/percentual/i);
  });

  it('MISTO retorna tipo=MISTO, sem percentual', () => {
    expect(parseTipoReajuste('Misto').tipo).toBe('MISTO');
  });

  it('texto livre cai em OUTRO', () => {
    const r = parseTipoReajuste('INPC');
    expect(r.tipo).toBe('OUTRO');
    expect(r.texto_original).toBe('INPC');
  });

  it('enum de TIPOS_REAJUSTE contém 5 valores', () => {
    expect(TIPOS_REAJUSTE).toEqual(expect.arrayContaining(['IGPM', 'IPCA', 'FIXO', 'MISTO', 'OUTRO']));
  });
});

describe('validarDadosContratos', () => {
  it('rejeita quando dataVenc e meses conflitantes (RF coerência)', () => {
    const r = validarDadosContratos({
      vencimento_medio_contratos: '2029-01-15',
      vencimento_medio_contratos_meses: 18
    });
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/conflit/i);
  });

  it('aceita só dataVenc', () => {
    const r = validarDadosContratos({ vencimento_medio_contratos: '2029-01-15' });
    expect(r.ok).toBe(true);
  });

  it('aceita só meses', () => {
    const r = validarDadosContratos({ vencimento_medio_contratos_meses: 30 });
    expect(r.ok).toBe(true);
  });

  it('aceita sem nenhum (estado vazio)', () => {
    const r = validarDadosContratos({});
    expect(r.ok).toBe(true);
  });

  it('FIXO exige percentual (422)', () => {
    const r = validarDadosContratos({ tipo_reajuste: 'FIXO' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(422);
  });

  it('FIXO com percentual aceita', () => {
    const r = validarDadosContratos({ tipo_reajuste: 'FIXO', reajuste_percentual: 3.0 });
    expect(r.ok).toBe(true);
  });

  it('tipo_reajuste inválido rejeita (400)', () => {
    const r = validarDadosContratos({ tipo_reajuste: 'NAO_EXISTE' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });
});
