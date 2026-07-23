// TDD Red Phase — PRD 04: Lógica pura de Comparador vs Média do Segmento.
// src/shared/peer.js (a ser criado) deve cobrir:
//   - calcularPvpVsPeer, calcularDyVsPeer, calcularVpaVsPeer (RF-008/009/010)
//   - classificarPeer (RF-011) com precedência do DESFAVORAVEL
//   - precoReferenciaPeer (RF-015)
//   - precoTetoEfetivo (RF-016): MIN, benchmark nunca aumenta o teto base
//   - multiplicadorPeer (RF-021)
//   - mergeSnapshotPeer (whitelist, imutável, null preserva valor válido)
//   - benchmarkVencido + frescuraVencida (RF-007)
//   - simularRebalanceamento (RF-019..023)

import { describe, it, expect } from 'vitest';

describe('peer — lógica pura (PRD 04)', () => {
  describe('calcularPvpVsPeer (RF-008)', () => {
    it('desconto: P/VP 0.85 vs média 0.95 → -10.53%', async () => {
      const { calcularPvpVsPeer } = await import('../../shared/peer.js');
      const r = calcularPvpVsPeer(0.85, 0.95);
      expect(r).not.toBeNull();
      expect(r.desvio_pct).toBeCloseTo(-10.526, 2);
      expect(r.sinal).toBe('desconto');
    });
    it('prêmio: P/VP 1.05 vs média 0.95 → +10.53%', async () => {
      const { calcularPvpVsPeer } = await import('../../shared/peer.js');
      const r = calcularPvpVsPeer(1.05, 0.95);
      expect(r.desvio_pct).toBeCloseTo(10.526, 2);
      expect(r.sinal).toBe('premio');
    });
    it('igual: P/VP == média → 0%', async () => {
      const { calcularPvpVsPeer } = await import('../../shared/peer.js');
      const r = calcularPvpVsPeer(0.95, 0.95);
      expect(r.desvio_pct).toBeCloseTo(0, 5);
      expect(r.sinal).toBe('em_linha');
    });
    it('peer zero → null (sem divisão por zero)', async () => {
      const { calcularPvpVsPeer } = await import('../../shared/peer.js');
      expect(calcularPvpVsPeer(0.95, 0)).toBeNull();
    });
    it('peer null ou negativo → null', async () => {
      const { calcularPvpVsPeer } = await import('../../shared/peer.js');
      expect(calcularPvpVsPeer(0.95, null)).toBeNull();
      expect(calcularPvpVsPeer(0.95, undefined)).toBeNull();
      expect(calcularPvpVsPeer(0.95, -0.5)).toBeNull();
    });
    it('p_vp próprio null → null', async () => {
      const { calcularPvpVsPeer } = await import('../../shared/peer.js');
      expect(calcularPvpVsPeer(null, 0.95)).toBeNull();
      expect(calcularPvpVsPeer(NaN, 0.95)).toBeNull();
    });
  });

  describe('calcularDyVsPeer (RF-009)', () => {
    it('DY acima da média: 10 vs 8 → +25%', async () => {
      const { calcularDyVsPeer } = await import('../../shared/peer.js');
      const r = calcularDyVsPeer(10, 8);
      expect(r.desvio_pct).toBeCloseTo(25, 5);
      expect(r.sinal).toBe('acima');
    });
    it('DY abaixo: 7 vs 10 → -30%', async () => {
      const { calcularDyVsPeer } = await import('../../shared/peer.js');
      const r = calcularDyVsPeer(7, 10);
      expect(r.desvio_pct).toBeCloseTo(-30, 5);
      expect(r.sinal).toBe('abaixo');
    });
    it('DY médio zero → null (RF edge 8)', async () => {
      const { calcularDyVsPeer } = await import('../../shared/peer.js');
      expect(calcularDyVsPeer(9, 0)).toBeNull();
    });
    it('DY próprio ausente → null', async () => {
      const { calcularDyVsPeer } = await import('../../shared/peer.js');
      expect(calcularDyVsPeer(null, 9)).toBeNull();
    });
  });

  describe('calcularVpaVsPeer (RF-010)', () => {
    it('VPA acima: 101.20 vs 96.70 → +4.65%', async () => {
      const { calcularVpaVsPeer } = await import('../../shared/peer.js');
      const r = calcularVpaVsPeer(101.20, 96.70);
      expect(r.desvio_pct).toBeCloseTo(4.65, 1);
      expect(r.uso).toBe('INFORMATIVO');
    });
    it('VPA médio zero → null', async () => {
      const { calcularVpaVsPeer } = await import('../../shared/peer.js');
      expect(calcularVpaVsPeer(101.20, 0)).toBeNull();
    });
  });

  describe('classificarPeer (RF-011)', () => {
    it('P/VP muito abaixo (≤ -5%) E DY não abaixo demais (≥ -5%) → FAVORAVEL', async () => {
      const { classificarPeer } = await import('../../shared/peer.js');
      const r = classificarPeer({ pvp_desvio_pct: -10, dy_desvio_pct: 5 });
      expect(r.classificacao).toBe('FAVORAVEL');
    });
    it('P/VP muito acima (≥ +5%) → DESFAVORAVEL mesmo com DY bom', async () => {
      const { classificarPeer } = await import('../../shared/peer.js');
      const r = classificarPeer({ pvp_desvio_pct: 8, dy_desvio_pct: 20 });
      expect(r.classificacao).toBe('DESFAVORAVEL');
    });
    it('DY muito abaixo (≤ -10%) → DESFAVORAVEL mesmo com P/VP bom', async () => {
      const { classificarPeer } = await import('../../shared/peer.js');
      const r = classificarPeer({ pvp_desvio_pct: -10, dy_desvio_pct: -15 });
      expect(r.classificacao).toBe('DESFAVORAVEL');
    });
    it('P/VP -3%, DY -2% (dentro da banda neutra 5%) → NEUTRO', async () => {
      const { classificarPeer } = await import('../../shared/peer.js');
      const r = classificarPeer({ pvp_desvio_pct: -3, dy_desvio_pct: -2 });
      expect(r.classificacao).toBe('NEUTRO');
    });
    it('null → SEM_DADOS', async () => {
      const { classificarPeer } = await import('../../shared/peer.js');
      expect(classificarPeer({ pvp_desvio_pct: null }).classificacao).toBe('SEM_DADOS');
      expect(classificarPeer({}).classificacao).toBe('SEM_DADOS');
    });
    it('precedência: P/VP borderline + DY bem abaixo → DESFAVORAVEL', async () => {
      const { classificarPeer } = await import('../../shared/peer.js');
      const r = classificarPeer({ pvp_desvio_pct: 4, dy_desvio_pct: -12 });
      expect(r.classificacao).toBe('DESFAVORAVEL');
    });
    it('limiares customizáveis (peer_desvio_neutro_pct=10)', async () => {
      const { classificarPeer } = await import('../../shared/peer.js');
      const r = classificarPeer(
        { pvp_desvio_pct: -12, dy_desvio_pct: 5 },
        { desvio_neutro_pct: 10, dy_desfavoravel_pct: 10 }
      );
      // Com banda 10%, -12% é "muito abaixo" → FAVORAVEL
      expect(r.classificacao).toBe('FAVORAVEL');
    });
  });

  describe('precoReferenciaPeer (RF-015)', () => {
    it('vp_cota 101.20 × pvp_medio 0.95 = 96.14', async () => {
      const { precoReferenciaPeer } = await import('../../shared/peer.js');
      expect(precoReferenciaPeer(101.20, 0.95)).toBeCloseTo(96.14, 2);
    });
    it('inputs ausentes → null', async () => {
      const { precoReferenciaPeer } = await import('../../shared/peer.js');
      expect(precoReferenciaPeer(null, 0.95)).toBeNull();
      expect(precoReferenciaPeer(101.20, null)).toBeNull();
      expect(precoReferenciaPeer(101.20, 0)).toBeNull();
      expect(precoReferenciaPeer(-10, 0.95)).toBeNull();
    });
  });

  describe('precoTetoEfetivo (RF-016)', () => {
    it('teto 170, ref peer 96.14, margem 0% → MIN = 96.14', async () => {
      const { precoTetoEfetivo } = await import('../../shared/peer.js');
      const r = precoTetoEfetivo({ preco_teto: 170, preco_referencia_peer: 96.14, margem_pct: 0 });
      expect(r.teto_efetivo).toBeCloseTo(96.14, 2);
      expect(r.regra_limitante).toBe('PEER_PVP');
      expect(r.benchmark_aplicado).toBe(true);
    });
    it('teto 170, ref peer 200, margem 0% → MIN = 170 (peer não eleva teto)', async () => {
      const { precoTetoEfetivo } = await import('../../shared/peer.js');
      const r = precoTetoEfetivo({ preco_teto: 170, preco_referencia_peer: 200, margem_pct: 0 });
      expect(r.teto_efetivo).toBe(170);
      expect(r.regra_limitante).toBe('DY_BASE');
      expect(r.benchmark_aplicado).toBe(true);
    });
    it('sem preço-teto base → regra FALLBACK_SEM_PEER, sem sinal de compra', async () => {
      const { precoTetoEfetivo } = await import('../../shared/peer.js');
      const r = precoTetoEfetivo({ preco_teto: null, preco_referencia_peer: 96.14, margem_pct: 0 });
      expect(r.teto_efetivo).toBeNull();
      expect(r.regra_limitante).toBe('FALLBACK_SEM_PEER');
      expect(r.benchmark_aplicado).toBe(false);
    });
    it('sem benchmark válido → usa só teto base', async () => {
      const { precoTetoEfetivo } = await import('../../shared/peer.js');
      const r = precoTetoEfetivo({ preco_teto: 170, preco_referencia_peer: null, margem_pct: 0 });
      expect(r.teto_efetivo).toBe(170);
      expect(r.regra_limitante).toBe('DY_BASE');
      expect(r.benchmark_aplicado).toBe(false);
    });
    it('margem 5%: ref_peer 100 × 1.05 = 105 < 170 → 105', async () => {
      const { precoTetoEfetivo } = await import('../../shared/peer.js');
      const r = precoTetoEfetivo({ preco_teto: 170, preco_referencia_peer: 100, margem_pct: 5 });
      expect(r.teto_efetivo).toBeCloseTo(105, 2);
      expect(r.regra_limitante).toBe('PEER_PVP');
    });
  });

  describe('multiplicadorPeer (RF-021)', () => {
    it('FAVORAVEL → 1.15', async () => {
      const { multiplicadorPeer } = await import('../../shared/peer.js');
      expect(multiplicadorPeer('FAVORAVEL')).toBeCloseTo(1.15, 2);
    });
    it('NEUTRO → 1.00', async () => {
      const { multiplicadorPeer } = await import('../../shared/peer.js');
      expect(multiplicadorPeer('NEUTRO')).toBeCloseTo(1.0, 2);
    });
    it('DESFAVORAVEL → 0.75', async () => {
      const { multiplicadorPeer } = await import('../../shared/peer.js');
      expect(multiplicadorPeer('DESFAVORAVEL')).toBeCloseTo(0.75, 2);
    });
    it('SEM_DADOS → 1.00 (fallback neutro, RF-022)', async () => {
      const { multiplicadorPeer } = await import('../../shared/peer.js');
      expect(multiplicadorPeer('SEM_DADOS')).toBeCloseTo(1.0, 2);
    });
  });

  describe('mergeSnapshotPeer (persistência segura)', () => {
    it('null em novo preserva valor anterior (RF-008 / unificação com PRD 02)', async () => {
      const { mergeSnapshotPeer } = await import('../../shared/peer.js');
      const prev = {
        pvp_medio_segmento: 0.95, dy_medio_segmento: 9.10, vpa_medio_segmento: 96.70,
        peer_grupo_nome: 'Logístico', peer_grupo_tipo: 'SEGMENTO',
        peer_fonte: 'investidor10', peer_atualizado_em: '2026-07-10T00:00:00.000Z'
      };
      const novo = {
        pvp_medio_segmento: null, dy_medio_segmento: null, vpa_medio_segmento: null,
        peer_grupo_nome: null, peer_grupo_tipo: null,
        peer_fonte: null, peer_atualizado_em: null
      };
      const out = mergeSnapshotPeer(prev, novo, { fonte: 'investidor10', atualizadoEm: '2026-07-22T00:00:00.000Z' });
      expect(out.pvp_medio_segmento).toBe(0.95);
      expect(out.dy_medio_segmento).toBe(9.10);
      expect(out.peer_grupo_nome).toBe('Logístico');
      expect(out.peer_grupo_tipo).toBe('SEGMENTO');
    });
    it('snapshot completo novo sobrescreve tudo', async () => {
      const { mergeSnapshotPeer } = await import('../../shared/peer.js');
      const novo = {
        pvp_medio_segmento: 1.05, dy_medio_segmento: 8.50, vpa_medio_segmento: 100.00,
        peer_grupo_nome: 'Shoppings', peer_grupo_tipo: 'SEGMENTO'
      };
      const out = mergeSnapshotPeer({ pvp_medio_segmento: 0.95 }, novo, {
        fonte: 'investidor10', atualizadoEm: '2026-07-22T00:00:00.000Z'
      });
      expect(out.pvp_medio_segmento).toBe(1.05);
      expect(out.peer_grupo_nome).toBe('Shoppings');
      expect(out.peer_fonte).toBe('investidor10');
      expect(out.peer_atualizado_em).toBe('2026-07-22T00:00:00.000Z');
    });
    it('imutável: prev e novo não são mutados', async () => {
      const { mergeSnapshotPeer } = await import('../../shared/peer.js');
      const prev = { pvp_medio_segmento: 0.95 };
      const novo = { pvp_medio_segmento: 1.05 };
      const prevClone = { ...prev };
      const novoClone = { ...novo };
      mergeSnapshotPeer(prev, novo, { fonte: 'investidor10' });
      expect(prev).toEqual(prevClone);
      expect(novo).toEqual(novoClone);
    });
    it('zero é valor válido (preservado / aceito)', async () => {
      const { mergeSnapshotPeer } = await import('../../shared/peer.js');
      const out = mergeSnapshotPeer({ dy_medio_segmento: 9.0 }, { dy_medio_segmento: 0 }, {});
      expect(out.dy_medio_segmento).toBe(0);
    });
    it('whitelist: campo fora da whitelist é ignorado', async () => {
      const { mergeSnapshotPeer } = await import('../../shared/peer.js');
      const out = mergeSnapshotPeer(
        {},
        { pvp_medio_segmento: 0.95, hack_injection: 'DROP TABLE', dy_12m_inventado: 99 },
        { fonte: 'investidor10' }
      );
      expect(out.pvp_medio_segmento).toBe(0.95);
      expect(out.hack_injection).toBeUndefined();
      expect(out.dy_12m_inventado).toBeUndefined();
    });
  });

  describe('benchmarkVencido + frescuraVencida (RF-007)', () => {
    it('snapshot há 1 dia → não vencido (validade 168h)', async () => {
      const { benchmarkVencido } = await import('../../shared/peer.js');
      const agora = '2026-07-22T12:00:00.000Z';
      const umDiaAtras = '2026-07-21T12:00:00.000Z';
      expect(benchmarkVencido(umDiaAtras, { validadeHoras: 168, agora })).toBe(false);
    });
    it('snapshot há 8 dias (192h) → vencido', async () => {
      const { benchmarkVencido } = await import('../../shared/peer.js');
      const agora = '2026-07-22T12:00:00.000Z';
      const oitoDias = '2026-07-14T12:00:00.000Z';
      expect(benchmarkVencido(oitoDias, { validadeHoras: 168, agora })).toBe(true);
    });
    it('timestamp ausente → vencido', async () => {
      const { benchmarkVencido } = await import('../../shared/peer.js');
      expect(benchmarkVencido(null, { validadeHoras: 168 })).toBe(true);
      expect(benchmarkVencido(undefined, { validadeHoras: 168 })).toBe(true);
    });
  });

  describe('simularRebalanceamento (RF-019..023)', () => {
    it('aporta 2000 com 1 FII elegível → sugere cotas inteiras, prioriza favorável', async () => {
      const { simularRebalanceamento } = await import('../../shared/peer.js');
      const agora = '2026-07-22T12:00:00.000Z';
      const input = {
        aporte: 2000,
        patrimonio_atual: 100000,
        ativos: [
          { ticker: 'HGLG11', tipo: 'FII', cotacao: 158.30, preco_teto: 170.00, vp_cota: 101.20,
            pvp_medio_segmento: 0.95, dy_medio_segmento: 9.10, pvp_vs_peer_pct: -6.32,
            dy_vs_peer_pct: 7.69, classificacao: 'FAVORAVEL', saldo_atual: 0,
            alvo_pct_carteira: 1.76, ativo: 1, peer_atualizado_em: agora },
          { ticker: 'MXRF11', tipo: 'FII', cotacao: 10.10, preco_teto: 10.50, vp_cota: 10.00,
            pvp_medio_segmento: 1.0, dy_medio_segmento: 10.5, pvp_vs_peer_pct: 0,
            dy_vs_peer_pct: 0, classificacao: 'NEUTRO', saldo_atual: 0,
            alvo_pct_carteira: 1.76, ativo: 1, peer_atualizado_em: agora },
          { ticker: 'XPTO11', tipo: 'FII', cotacao: 200, preco_teto: 150,  // ACIMA_DO_TETO
            vp_cota: 100, pvp_medio_segmento: 1.0, dy_medio_segmento: 10,
            classificacao: 'DESFAVORAVEL', saldo_atual: 0,
            alvo_pct_carteira: 1.76, ativo: 1, peer_atualizado_em: agora }
        ]
      };
      const r = simularRebalanceamento(input);
      expect(r.aporte).toBe(2000);
      expect(r.sugestoes.length).toBeGreaterThan(0);
      // XPTO11 deve ser ignorado por estar acima do teto
      expect(r.ignorados.some(i => i.ticker === 'XPTO11' && i.motivo === 'ACIMA_DO_TETO')).toBe(true);
      // Cada sugestão tem campos obrigatórios
      for (const s of r.sugestoes) {
        expect(s).toHaveProperty('quantidade');
        expect(s).toHaveProperty('valor');
        expect(s).toHaveProperty('classificacao_peer');
        expect(s).toHaveProperty('preco_teto_efetivo');
        expect(s).toHaveProperty('regra_limitante');
      }
    });
    it('aporte zero ou negativo → erro', async () => {
      const { simularRebalanceamento } = await import('../../shared/peer.js');
      expect(() => simularRebalanceamento({ aporte: 0, ativos: [] })).toThrow();
      expect(() => simularRebalanceamento({ aporte: -100, ativos: [] })).toThrow();
      expect(() => simularRebalanceamento({ aporte: 'abc', ativos: [] })).toThrow();
    });
    it('sem cotações válidas → vazio + ignorados SEM_COTACAO', async () => {
      const { simularRebalanceamento } = await import('../../shared/peer.js');
      const r = simularRebalanceamento({
        aporte: 1000, patrimonio_atual: 0,
        ativos: [
          { ticker: 'A', tipo: 'FII', cotacao: null, preco_teto: 100, alvo_pct_carteira: 5, ativo: 1 }
        ]
      });
      expect(r.sugestoes).toEqual([]);
      expect(r.ignorados.some(i => i.motivo === 'SEM_COTACAO')).toBe(true);
    });
    it('sem teto base → SEM_TETO', async () => {
      const { simularRebalanceamento } = await import('../../shared/peer.js');
      const r = simularRebalanceamento({
        aporte: 1000, patrimonio_atual: 0,
        ativos: [
          { ticker: 'A', tipo: 'FII', cotacao: 50, preco_teto: null, alvo_pct_carteira: 5, ativo: 1 }
        ]
      });
      expect(r.ignorados.some(i => i.ticker === 'A' && i.motivo === 'SEM_TETO')).toBe(true);
    });
    it('multiplicador favorável > neutro > desfavorável (RF-021)', async () => {
      const { simularRebalanceamento } = await import('../../shared/peer.js');
      const agora = '2026-07-22T12:00:00.000Z';
      const baseAtivo = { ticker: 'X', tipo: 'FII', cotacao: 10, preco_teto: 100, vp_cota: 10,
        pvp_medio_segmento: 1.0, dy_medio_segmento: 10, ativo: 1, saldo_atual: 0,
        alvo_pct_carteira: 50, peer_atualizado_em: agora };
      const base = { aporte: 1000, patrimonio_atual: 0, ativos: [baseAtivo] };
      const fav = simularRebalanceamento({ ...base,
        ativos: [{ ...base.ativos[0], pvp_vs_peer_pct: -10, dy_vs_peer_pct: 5, classificacao: 'FAVORAVEL' }] });
      const des = simularRebalanceamento({ ...base,
        ativos: [{ ...base.ativos[0], pvp_vs_peer_pct: 8, dy_vs_peer_pct: -15, classificacao: 'DESFAVORAVEL' }] });
      const sugFav = fav.sugestoes[0] || { valor: 0 };
      const sugDes = des.sugestoes[0] || { valor: 0 };
      expect(sugFav.multiplicador_peer).toBeCloseTo(1.15, 2);
      expect(sugDes.multiplicador_peer).toBeCloseTo(0.75, 2);
      // FAVORAVEL recebe mais verba que DESFAVORAVEL (proporcional ao peso)
      if (fav.sugestoes[0] && des.sugestoes[0]) {
        expect(sugFav.valor).toBeGreaterThanOrEqual(sugDes.valor);
      }
    });
    it('apenas FII ativo com quantidade > 0 (escopo)', async () => {
      const { simularRebalanceamento } = await import('../../shared/peer.js');
      const r = simularRebalanceamento({
        aporte: 1000, patrimonio_atual: 0,
        ativos: [
          { ticker: 'ACAO4', tipo: 'ACAO', cotacao: 50, preco_teto: 60, alvo_pct_carteira: 5, ativo: 1 }, // não-FII
          { ticker: 'FIIT0', tipo: 'FII', cotacao: 50, preco_teto: 60, alvo_pct_carteira: 5, ativo: 0 } // inativo
        ]
      });
      expect(r.sugestoes).toEqual([]);
    });
  });
});