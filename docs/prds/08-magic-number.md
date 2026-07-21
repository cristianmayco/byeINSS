# PRD: Magic Number — Widget por FII e Calculadora Global da Carteira

## 1. Visão Geral

### Resumo
O Magic Number responde à pergunta mais recorrente do investidor de FIIs — "quantas cotas preciso comprar para receber R$ X por mês?" — e já é exibido pelo Investidor10 como widget em cada página de FII. No byeINSS, hoje o investidor precisa fazer a conta manualmente (ou consultar o I10 em outra aba) ao estudar um FII na tela de Posições/Preço-teto e, principalmente, quando planeja quanto precisa investir na carteira inteira para atingir uma renda-alvo. Esta feature entrega **(a)** um widget Magic Number por FII nas telas Posições e Preço-teto e **(b)** uma calculadora global "carteira inteira precisa de N cotas para R$ X/mês", com duas variantes de fórmula (renda via DY anual médio × preço vs renda via último dividendo), estado vazio, modo "alcançável vs sonho" e link direto do resultado para o simulador de compras existentes.

### 3 problemas que resolve
1. **Fricção cognitiva no estudo de FIIs.** O usuário abre Posições, vê DY/preço do FII, quer saber "com 1.000 cotas ganho quanto por mês?". Hoje: calculadora externa ou conta no papel. Com a feature: resposta em &lt; 200 ms, inline, sem trocar de aba.
2. **Falta de visão global para metas de renda.** O investidor sabe que quer R$ 5.000/mês em FIIs mas não sabe — de forma agregada — quantas cotas faltam, em quais FIIs comprar primeiro nem qual a ordem de prioridade sob sua restrição de aporte.
3. **Descolamento entre estudo e ação.** Hoje "quero essa renda mensal" e "qual FII comprar agora" vivem em telas diferentes; o resultado do Magic Number fica sem destino. A feature fecha o loop com um CTA "Distribuir nos top-K FIIs por liquidez/DY" que abre o simulador já preenchido.

### Personas e casos de uso

| Persona | Caso de uso principal |
|---|---|
| **Carlos — conservador, 38 anos, FIRE em 15 anos** | Acompanha Posições do fundo imobiliário. Olha HGLG11, quer saber: "se eu comprar mais 50 cotas, gano quanto por mês?". Aplica o widget, vê "R$ 38/mês", decide. |
| **Renata — investidora em acumulação, 29 anos** | Está em Posições, comparando 8 FIIs. Usa o widget em cada um para ranquear "qual entrega mais renda por real aportado". |
| **Marcos — próximo da FIRE, 52 anos** | Acessa a calculadora global, define meta "R$ 8.000/mês" e quer ver (a) quantas cotas faltam para a meta, (b) capital necessário a preço atual, (c) distribuição ótima entre os FIIs da carteira+watchlist. |
| **Ana — iniciante, 24 anos, primeira posição em FIIs** | Na tela Preço-teto, estuda XPML11. Vê "Magic Number para R$ 500/mês = 142 cotas". Decide se o aporte cabe no orçamento dela. |

---

## 2. Objetivos &amp; Métricas de Sucesso

### Objetivos mensuráveis
1. **Reduzir tempo de resposta à pergunta "quantas cotas para R$ X/mês?"** de ~30 s (cálculo manual off-app) para **&lt; 1 s dentro do app** em 100% dos casos, sem erros de fórmula.
2. **Atingir uso semanal ativo do widget Magic Number por FII em ≥ 40% dos usuários ativos da feature Posições** dentro de 60 dias do release.
3. **Atingir uso mensal da calculadora global em ≥ 25% dos usuários ativos** dentro de 90 dias (proxy: feature awareness de meta de renda).
4. **Zero inconsistência de cálculo**: o número retornado pelo Magic Number deve ser idêntico ao calculado manualmente pelo usuário seguindo a fórmula documentada (DY × preço ou último dividendo), em 100% dos casos testados.
5. **Aumentar conversão widget → simulador** em ≥ 15% dos usos do widget Magic Number (proxy: feature alinhada ao objetivo de FIRE).

### KPIs

| KPI | Meta | Como medir |
|---|---|---|
| Latência p95 do widget por FII | &lt; 200 ms | Telemetria cliente (performance.now) |
| Latência p95 da calculadora global | &lt; 500 ms | Telemetria cliente |
| Taxa de erro de cálculo (divergência vs fórmula) | 0% | Testes unitários E2E + cálculo em comentário de PR |
| DAU com ≥ 1 clique no widget Magic Number | ≥ 40% | Evento analytics `magic_number_per_fii_open` |
| DAU com ≥ 1 uso da calculadora global | ≥ 25% | Evento analytics `magic_number_global_open` |
| CTR "Distribuir no simulador" a partir do resultado global | ≥ 15% | Funil `global_calculated → simulator_opened_via_magic` |
| Cobertura de FIIs com widget renderizável (não-empty) | ≥ 95% dos FIIs da carteira do usuário | Métrica de qualidade por build |

---

## 3. Requisitos Funcionais

- **RF-001 — Widget Magic Number por FII em Posições.** Cada linha da tabela de Posições de FIIs deve exibir um widget colapsável "Magic Number" com input de renda mensal desejada (default R$ 1.000), que retorna em tempo real (debounce 150 ms) o número de cotas necessárias, o capital estimado a preço atual e o dividend yield implícito usado.
- **RF-002 — Widget Magic Number por FII em Preço-teto.** A mesma UI deve aparecer na tela Preço-teto para FIIs, permitindo comparar rapidamente "cotas para R$ X" contra o "preço-teto" calculado.
- **RF-003 — Toggle de fórmula.** O widget deve permitir escolher entre duas fórmulas: (a) `"dy_medio_12m × preço"` — `cotas = (renda × 12) / (dy_12m% × preço)`; (b) `"último dividendo"` — `cotas = renda / ultimo_dividendo`. A escolha fica persistida por usuário em `localStorage` (chave `magic_number.formula`).
- **RF-004 — Pré-condições e estado vazio.** Se `preco_atual` ou `dy_12m` (ou `ultimo_dividendo`) estiverem ausentes para o FII, o widget exibe estado "—" com tooltip explicativo em vez de quebrar; nunca deve lançar erro visível ao usuário.
- **RF-005 — Calculadora global "Carteira inteira".** Uma nova tela `#magic-number` (linkada no menu lateral e em Posições via CTA "Calcular para a carteira") deve aceitar uma renda mensal desejada e devolver (a) cotas totais necessárias na carteira, (b) capital estimado a preços atuais, (c) projeção mensal/anual de proventos dado o último dividendo, (d) desagregação por FII sugerida (top-K por liquidez × DY) e (e) cotistas-alvo opcional que, se preenchido, mostra % da meta já atingida.
- **RF-006 — Distribuição ótima sugerida.** A calculadora global deve, ao ser executada, retornar um array ranqueado `[{ticker, cotas_sugeridas, peso_pct, motivo}]` priorizando liquidez (`liquidez_diaria`, se disponível) e DY atual, com tiebreak por `numero_cotistas`. A UI exibe como tabela ordenada com barra de progresso visual.
- **RF-007 — CTA "Distribuir no simulador".** O resultado da calculadora global deve possuir um botão que abre o simulador de compras existente já preenchido com a lista `[{ticker, quantidade}]` e o aporte total estimado; se a tela do simulador for removida no futuro, esse CTA fica oculto.
- **RF-008 — Meta persistente de renda.** O usuário pode salvar uma meta de renda mensal (R$/mês) que fica persistida em `localStorage` (`magic_number.meta`) e é usada como default nos widgets e na calculadora global. Pode ser editada num modal "Defina sua meta".
- **RF-009 — Cenário "alcançável vs sonho".** A calculadora global deve comparar "capital necessário" vs "patrimônio atual em FIIs" e classificar a meta em 3 bandas: `ATINGÍVEL` (≤ 0% do patrimônio atual em novas compras), `DESAFIADOR` (próximo 0–25%), `SONHO` (&gt;25% ou &gt; aporte mensal disponível declarado). Banda é exibida como chip colorida.
- **RF-010 — Internacionalização pt-BR.** Todos os textos, formatos de moeda (R$ 1.234,56 com vírgula como decimal), datas e labels devem estar em pt-BR. Sem dependência de tradução multi-idioma nesta entrega.
- **RF-011 — Modo escuro.** O widget e a calculadora devem respeitar o tema escuro já existente no app, com cores semânticas consistentes: verde (ATINGÍVEL), amarelo (DESAFIADOR), vermelho (SONHO).
- **RF-012 — Deep links.** A aba `#magic-number?ticker=HGLG11&amp;renda=2000` deve abrir a calculadora global já com o ticker selecionado no modo "single-FII deep dive"; estados em URL permitem compartilhar cenários.
- **RF-013 — Telemetria mínima.** Cada abertura de widget, cada cálculo e cada uso do CTA "Distribuir no simulador" emite um evento analytics local-first (`magic_number_per_fii_open`, `magic_number_global_open`, `magic_number_simulator_open`) armazenado em SQLite. Sem PII coletada.

---

## 4. Requisitos Não-Funcionais

- **Performance.** Cálculo client-side puro em JS; latência p95 do widget por FII &lt; 200 ms; latência p95 da calculadora global (até 100 FIIs) &lt; 500 ms em máquina de referência (Chromium 120+, i5 8th gen). Sem chamada de rede para renderizar.
- **Privacidade.** Todos os cálculos são locais. Nenhum dado de cotações, posição ou meta de renda é enviado para servidor externo. `localStorage` é usado somente para preferências (fórmula escolhida, meta). Telemetria fica no SQLite local, sem sync.
- **Compatibilidade.** Funciona em macOS, Windows e Linux via Electron; último Chrome/Chromium estável.
- **Acessibilidade (WCAG 2.1 AA).** Inputs com `aria-label`, contraste mínimo 4.5:1, navegação por teclado (Tab/Shift-Tab/Enter), `role="status"` para resultados announced via screen reader, sem dependência exclusiva de cor (texto + ícone + cor).
- **Resiliência.** Tratamento gracioso de `null`/`undefined` em todos os campos; nunca propagar `NaN`/`Infinity` para a UI. Arredondamento de cotas com `Math.ceil` (nunca sugere comprar 0,4 cota quando precisa de 1).
- **Determinismo.** Mesma fórmula + mesmos inputs ⇒ mesmo output. Sem uso de `Date.now()` no cálculo do número em si (só no evento de telemetria).
- **Auditabilidade de cálculo.** Tooltip "??" ao lado de cada número exibe a fórmula exata aplicada e os inputs (DY %, preço, último dividendo) com timestamp do `ativos.updated_at` para que o usuário saiba "dados de DD/MM".
- **Cobertura de testes.** ≥ 90% de cobertura unitária na função pura `computeMagicNumber()` + cenários E2E (Playwright) cobrindo happy path, dados faltantes e toggle de fórmula.
- **Segurança.** Sem persistência de valores monetários em logs/sentry; valores são arredondados a R$ antes de emitir telemetria para evitar ruído.
- **Manutenibilidade.** Função pura extraída em `src/shared/magicNumber.js`, reutilizada tanto pelo widget por FII quanto pela calculadora global — single source of truth.

---

## 5. Modelo de Dados

Não há mudança de schema no SQLite. O Magic Number é **função pura** sobre dados já existentes.

### Função de cálculo (referência para implementação)

```js
// src/shared/magicNumber.js (puro, sem I/O)
export function computeMagicNumber({
  rendaMensalDesejada,   // number, R$
  dyAnualMedio,          // number, % (ex: 9.5 para 9,5%)
  precoAtual,            // number, R$/cota
  ultimoDividendo,       // number, R$/cota (mensal)
  formula = 'dy_preco',  // 'dy_preco' | 'ultimo_dividendo'
  cotasJaPossuidas = 0
}) {
  if (!isFinite(rendaMensalDesejada) || rendaMensalDesejada <= 0) {
    return { error: 'renda_invalida' };
  }

  let cotasNecessarias, capitalEstimado, inputsUsados, dyImplicito;

  if (formula === 'ultimo_dividendo') {
    if (!ultimoDividendo || ultimoDividendo <= 0) {
      return { error: 'sem_ultimo_dividendo' };
    }
    cotasNecessarias = rendaMensalDesejada / ultimoDividendo;
    capitalEstimado = cotasNecessarias * precoAtual;
    dyImplicito = ultimoDividendo / precoAtual * 100;
    inputsUsados = { ultimoDividendo, precoAtual };
  } else {
    // dy_preco
    if (!dyAnualMedio || dyAnualMedio <= 0 || !precoAtual || precoAtual <= 0) {
      return { error: 'sem_dy_ou_preco' };
    }
    const dyAnualDecimal = dyAnualMedio / 100;
    // renda anual = cotas * preco * dy_anual_decimal
    // renda mensal = renda_anual / 12
    // => cotas = (renda_mensal * 12) / (dy_anual_decimal * preco)
    cotasNecessarias = (rendaMensalDesejada * 12) / (dyAnualDecimal * precoAtual);
    capitalEstimado = cotasNecessarias * precoAtual;
    dyImplicito = dyAnualMedio;
    inputsUsados = { dyAnualMedio, precoAtual };
  }

  const cotasFaltantes = Math.max(0, Math.ceil(cotasNecessarias) - cotasJaPossuidas);
  const capitalFaltante = cotasFaltantes * precoAtual;

  return {
    error: null,
    formula,
    cotasNecessarias: Math.ceil(cotasNecessarias),
    capitalEstimado: roundBRL(capitalEstimado),
    cotasFaltantes,
    capitalFaltante: roundBRL(capitalFaltante),
    dyImplicito: roundPct(dyImplicito),
    inputsUsados,
    versaoFormula: '1.0.0'
  };
}

function roundBRL(v) { return Math.round(v * 100) / 100; }
function roundPct(v) { return Math.round(v * 100) / 100; } // ex: 9.47
```

### Função da calculadora global

```js
export function computeGlobalMagicNumber({
  rendaMensalDesejada,
  fiis,                   // [{ ticker, dy12m, precoAtual, ultimoDividendo, liquidezDiaria, numeroCotistas, cotasJaPossuidas, patrimonioEmFII }]
  patrimonioAtualEmFIIs,
  aporteMensalDisponivel,
  topK = 5
}) {
  // Para cada FII: cotas necessárias usando fórmula default (configurável globalmente)
  const enriched = fiis.map(f => {
    const mn = computeMagicNumber({
      rendaMensalDesejada,
      dyAnualMedio: f.dy12m,
      precoAtual: f.precoAtual,
      ultimoDividendo: f.ultimoDividendo,
      cotasJaPossuidas: f.cotasJaPossuidas
    });
    return { ...f, magic: mn };
  }).filter(f => !f.magic.error && f.magic.capitalEstimado > 0);

  // Score = liquidez_normalizada * 0.6 + dy_normalizado * 0.4
  const ranked = rankByLiquidityAndDY(enriched).slice(0, topK);

  const capitalTotal = ranked.reduce((acc, f) => acc + f.magic.capitalEstimado, 0);
  const banda =
    capitalTotal <= 0 ? 'ATINGÍVEL' :
    aporteMensalDisponivel && capitalTotal / aporteMensalDisponivel <= 12 ? 'ATINGÍVEL' :
    capitalTotal <= patrimonioAtualEmFIIs * 1.25 ? 'DESAFIADOR' : 'SONHO';

  return { ranked, capitalTotal: roundBRL(capitalTotal), banda };
}
```

### Tabela SQLite nova (somente telemetria)

```sql
CREATE TABLE IF NOT EXISTS magic_number_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento TEXT NOT NULL,           -- 'per_fii_open' | 'global_open' | 'simulator_open' | ...
  ticker TEXT,                    -- NULL para eventos globais
  formula TEXT,                   -- 'dy_preco' | 'ultimo_dividendo'
  renda_mensal REAL,
  ativo_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_mn_events_evento ON magic_number_events(evento);
CREATE INDEX idx_mn_events_created ON magic_number_events(created_at);
```

### Persistência de preferências (localStorage)

| Chave | Tipo | Default | Descrição |
|---|---|---|---|
| `magic_number.formula` | `'dy_preco' \| 'ultimo_dividendo'` | `'dy_preco'` | Fórmula default |
| `magic_number.meta` | `number` (R$/mês) | `1000` | Meta de renda persistida |
| `magic_number.topK` | `number` | `5` | Quantos FIIs no ranking global |

---

## 6. APIs / Endpoints

Como o cálculo é client-side, não há endpoints HTTP obrigatórios. Para auditoria e futuras integrações, expomos:

| Método | Rota | Request | Response (200) | Erros |
|---|---|---|---|---|
| GET | `/api/fiis/magic-number/preview` | `?ticker=HGLG11&amp;renda=2000&amp;formula=dy_preco` | `{ ticker, cotas_necessarias, capital_estimado, dy_implicito, versao_formula }` | 422 `{error:'sem_dy_ou_preco'}`, 404 `{error:'ticker_nao_encontrado'}` |
| POST | `/api/fiis/magic-number/calculate` | `{ renda_mensal, formula?, top_k?, usar_watchlist? }` | `{ capital_total, banda, ranked: [...], gerado_em }` | 422 `{error:'sem_fiis'}` |
| POST | `/api/fiis/magic-number/prefill-simulator` | `{ ranked: [{ticker, cotas_sugeridas}] }` | `{ simulator_session_id, redirect_to }` | 422 `{error:'ranked_vazio'}` |
| GET | `/api/fiis/:ticker/dy-preco-snapshot` | — | `{ dy_12m, preco_atual, ultimo_dividendo, atualizado_em }` | 404 se ticker inexistente |

Todos os endpoints são thin-wrappers sobre `computeMagicNumber()` no backend (mantém auditoria/log centralizados) mas o front pode chamá-los ou invocar a função pura local — a UI prioriza cálculo local para latência.

---

## 7. UI / UX

### Wireframes (ASCII)

#### Wireframe 1 — Widget por FII em Posições (estado padrão)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Posições                                                          [⚙ Filtros]│
├───────────────────────────────────────────────────────────────────────────┤
│ Ticker │ Qtd │ Preço │ DY 12M │ Dividendo/mês │ Magic #              │ ... │
├────────┼─────┼───────┼────────┼───────────────┼───────────────────────┼─────┤
│ HGLG11 │ 50  │ R$165 │ 9,40% │ R$ 12,93      │ [▼ Magic #]          │     │
│        │     │       │        │               │  Meta: [R$ 1000 ]    │     │
│        │     │       │        │               │  Fórmula: [DY×preço▾]│     │
│        │     │       │        │               │  → 774 cotas         │     │
│        │     │       │        │               │  → R$ 127.710 inv.   │     │
│        │     │       │        │               │  [Calcular p/ carteira]│   │
├────────┼─────┼───────┼────────┼───────────────┼───────────────────────┼─────┤
│ XPML11 │ 30  │ R$105 │ 10,10%│ R$ 8,83       │ [▶ Magic #] (fechado)│     │
└────────┴─────┴───────┴────────┴───────────────┴───────────────────────┴─────┘
```

#### Wireframe 2 — Widget por FII (estado expandido com toggle)

```
┌───────────────────────────────────────────────────────────────┐
│ Magic Number — HGLG11                                  [✕]   │
├───────────────────────────────────────────────────────────────┤
│ Renda mensal desejada: [R$ 2.000  ]  (default da meta)       │
│                                                               │
│ Fórmula de cálculo:                                          │
│   ( ) DY 12M × Preço atual         [documentação da fórmula] │
│   (•) Último dividendo (mais conservador)                    │
│                                                               │
│ Resultado:                                                    │
│   Cotas necessárias:        243                               │
│   Capital estimado:         R$ 40.095,00                      │
│   DY implícito usado:       9,40%                             │
│   Suas cotas atuais:        50   (faltam 193)                 │
│   Capital faltante:         R$ 31.815,00                      │
│                                                               │
│ Dados usados (atualizados em 18/07/2026):                    │
│   DY 12M: 9,40% │ Preço: R$ 165,00 │ Último div: R$ 12,93   │
│                                                               │
│ [Distribuir no simulador]   [Ver p/ carteira inteira]        │
└───────────────────────────────────────────────────────────────┘
```

#### Wireframe 3 — Calculadora global (tela dedicada)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Magic Number — Carteira Inteira                          [Defina sua meta ⚙]│
├─────────────────────────────────────────────────────────────────────────────┤
│ Meta de renda mensal: [R$ 8.000  ]  ●ATINGÍVEL                            │
│ Aporte mensal disponível: [R$ 3.000]  Patrimônio atual em FIIs: R$ 145.000 │
│ Fórmula: [DY 12M × Preço ▾]    Top-K: [5 ▾]    ☐ Incluir watchlist        │
│                                                                             │
│ [Calcular]                                                                  │
│                                                                             │
│ ┌─ Resultado ────────────────────────────────────────────────────────────┐  │
│ │ Capital necessário: R$ 1.156.400                                       │  │
│ │ Cotas totais sugeridas: 7.392                                          │  │
│ │ Banda: ●DESAFIADOR (~8x aporte mensal, ~7 meses de aportes)            │  │
│ │ Cobertura atual: ~19% — faltam ~R$ 936.400 a preço atual               │  │
│ │                                                                          │  │
│ │ Sugestão de distribuição (Top-5):                                       │  │
│ │ ┌────────┬───────┬───────────┬─────────┬─────────────────────────┐     │  │
│ │ │ Ticker │ Cotas │   Peso    │ Capital │          Motivo         │     │  │
│ │ ├────────┼───────┼───────────┼─────────┼─────────────────────────┤     │  │
│ │ │ HGLG11 │  420  │ ████ 28%  │R$ 69.300│ Liq R$ 8M/dia, DY 9,4% │     │  │
│ │ │ XPML11 │  900  │ █████ 24% │R$ 94.500│ Liq R$ 7M/dia, DY 10,1%│     │  │
│ │ │ BTLG11 │  680  │ ████ 18%  │R$ 81.600│ Liq R$ 5M/dia, DY 9,0% │     │  │
│ │ │ MXRF11 │ 3.200 │ ████ 16%  │R$ 41.600│ Liq R$ 12M/dia, DY 11% │     │  │
│ │ │ VISC11 │  450  │ ████ 14%  │R$ 81.000│ Liq R$ 2M/dia, DY 9,2% │     │  │
│ │ └────────┴───────┴───────────┴─────────┴─────────────────────────┘     │  │
│ │                                                                          │  │
│ │ [Distribuir no simulador de compras]                                    │  │
│ └──────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Wireframe 4 — Estado empty (sem FIIs na carteira)

```
┌────────────────────────────────────────────────────────────┐
│ Magic Number — Carteira Inteira                            │
├────────────────────────────────────────────────────────────┤
│                                                            │
│   Você ainda não tem FIIs na carteira.                     │
│                                                            │
│   Adicione sua primeira posição para usar esta calculadora.│
│                                                            │
│   [Ir para Posições]   [Adicionar transação]              │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Lista de estados

| Estado | Quando | UI |
|---|---|---|
| `loading` | Primeiro render, antes dos dados do `ativos` chegarem | Skeleton com 2 linhas pulsando + texto "Calculando…" |
| `success` | Dados OK + fórmula válida | Resultado numérico + tooltip de fórmula + banda colorida |
| `success-zero` | Renda desejada = 0 ou cota já suficiente | Mensagem "Você já atinge essa meta com X cotas atuais" |
| `empty-fii-list` (só global) | Carteira sem FIIs | Wireframe 4 |
| `empty-ticker-data` (só per-FII) | FII sem `preco_atual` ou `dy_12m` | "—" + tooltip "dados indisponíveis para este FII" |
| `error-formula` | Inputs inválidos (renda ≤ 0) | Inline error abaixo do input: "Informe uma renda mensal ≥ 0" |
| `error-fallback` | Crash inesperado (defensivo) | Card vermelho com botão "Tentar novamente" + log local |

### Acessibilidade (a11y)

- Inputs com `&lt;label for&gt;` associado e `aria-describedby` apontando para o bloco de ajuda da fórmula.
- Resultados em `&lt;output aria-live="polite"&gt;` para anunciar mudanças sem interromper leitura.
- Banda colorida nunca é o único indicador: também há ícone (✓ ⚠ ✕) e texto ("ATINGÍVEL"/"DESAFIADOR"/"SONHO").
- Navegação por Tab: input de renda → toggle fórmula → botão Calcular → links de ação.
- Contraste mínimo 4.5:1 nas cores semânticas (testado em dark e light mode).
- Suporte a `prefers-reduced-motion`: barra de progresso da distribuição sugerida anima só se o usuário permitir motion.
- Foco visível custom (`outline: 2px solid var(--accent)` em vez do default).
- Foco inicial ao abrir widget vai direto para o input de renda mensal, não para o cabeçalho.

---

## 8. Casos de Borda

1. **DY 12M ausente e `ultimo_dividendo` presente.** O widget deve sugerir automaticamente a fórmula `"ultimo_dividendo"` e exibir nota explicativa "DY 12M não disponível para este FII — usando último dividendo". Fórmula preferida pelo usuário é respeitada se escolhida explicitamente.
2. **DY 12M presente e `ultimo_dividendo` ausente.** Default `"dy_preco"`; sem fallback automático para `"ultimo_dividendo"` (não tem como); exibe "—" com tooltip.
3. **DY = 0** (FII recém-listado que ainda não pagou proventos). `computeMagicNumber` retorna `error: 'sem_dy_ou_preco'`. UI exibe "—" + tooltip "FII ainda não distribuiu proventos nos últimos 12 meses".
4. **`preco_atual = 0` ou ausente.** Equivalente ao item 3; sem cálculo; tooltip "cotação indisponível".
5. **FII com `renda_mensal_desejada` super alta (ex: R$ 100.000/mês) para um FII pequeno.** Cálculo produz cotas excessivas (ex: 80.000). UI mostra o número sem censura + tooltip "valor patrimonial estimado superior à emissão atual do fundo" se o número de cotas ultrapassar 30% do `numero_cotas_emitidas`.
6. **Carteira vazia.** Calculadora global entra no estado `empty-fii-list` (Wireframe 4) com CTA para adicionar posição.
7. **`watchlist` ligada mas vazia.** Toggle "Incluir watchlist" fica desabilitado com tooltip "Adicione FIIs à sua watchlist para incluí-los no cálculo global".
8. **Meta de renda já atingida pelas posições atuais.** UI entra em `success-zero` com mensagem "Parabéns — sua carteira atual já gera ~R$ X/mês (X% acima da meta)".
9. **FII em Posições mas `cotas_para_renda` resulta em `cotas_ja_possuidas &gt; cotas_necessarias`.** Exibe "Você já atinge essa renda com este FII" + mostra quantas cotas a mais poderiam ser vendidas para reduzir exposição sem perder a meta.
10. **DY 12M zerado por causa de amortização total (FII em liquidação).** `proventos.tipo = AMORTIZACAO` 100% — UI marca FII com badge "⚠ proventos = amortização" para não confundir DY com distribuição real recorrente.
11. **Toggle de fórmula recarregado entre abas.** Persistência em `localStorage` deve funcionar entre reloads e entre Profiles do Electron.
12. **Dois usuários no mesmo app (raro, mas se suportado)** — `localStorage` é por-profile, então não há cross-contamination.

---

## 9. Dependências

| Dependência | Por quê | Status |
|---|---|---|
| Schema existente: `ativos.dy_12m`, `ativos.ultimo_dividendo`, `cotacoes.preco_atual` | Inputs da função de cálculo | ✅ Já presente |
| Tabela `proventos` com `tipo` suportando `AMORTIZACAO` | Distinguir DY "real" vs amortização (RF-004, EC-10) | ⚠ Depende da feature 2.3 do roadmap FII |
| `ativos.liquidez_diaria`, `ativos.numero_cotistas`, `ativos.tipo_detalhe` | Ranking Top-K da calculadora global (RF-006) | ⚠ Depende da feature 2.2 do roadmap FII |
| Tela de simulador de compras existente | CTA "Distribuir no simulador" (RF-007) | ✅ Já existe |
| Tema dark/light do app | Modo escuro (RF-011) | ✅ Já existe |
| `localStorage` no Electron renderer | Persistência de preferências | ✅ Já existe |
| Analytics local (SQLite) | Telemetria (RF-013) | ⚠ Criar tabela nova (RNF mínimo) |

Se as features 2.2 e 2.3 ainda não estiverem prontas no momento do release desta feature, a calculadora global **roda em modo degradado**: Top-K usa apenas DY + preço (sem liquidez), e DY "real" trata amortização como dividendo comum (com tooltip indicando limitação).

---

## 10. Esforço Estimado

Estimativas em **dias úteis** (1 dev full-stack Electron, ritmo saudável).

| Área | Atividade | Dias |
|---|---|---|
| **Backend (função pura + endpoints)** | `src/shared/magicNumber.js` (cobre widget per-FII + global) + testes unitários | 1.0 |
| | Endpoints REST `/api/fiis/magic-number/*` | 0.5 |
| | Migration da tabela `magic_number_events` | 0.2 |
| **Scraper** | Nenhum novo scraping; usa dados existentes | 0.0 |
| **UI - widget por FII** | Componente colapsável em Posições | 1.0 |
| | Componente colapsável em Preço-teto (reuso 90%) | 0.3 |
| **UI - calculadora global** | Tela `#magic-number` | 1.5 |
| | Tabela de distribuição sugerida + barra de progresso | 0.7 |
| | Integração com simulador (CTA "Distribuir") | 0.5 |
| **UX/UI polish** | Dark mode, a11y, animações, estados (loading/empty/error) | 1.0 |
| **Testes** | Unitários função pura | 0.5 |
| | E2E Playwright: widget per-FII + global + CTA simulador | 1.0 |
| **Telemetria &amp; métricas** | Hook de eventos + tabela SQLite + leitura no painel | 0.5 |
| **QA + code review + buffer** | — | 1.3 |
| **TOTAL** | — | **9.0 dias** |

Observações:
- A função pura é a peça mais valiosa do release (single source of truth). Vale ≥ 1/3 do esforço.
- Reuso entre Posições e Preço-teto reduz ~0.7 dia vs implementar duas UIs paralelas.
- Telemetria SQLite adiciona 0.5 dia mas destrava decisões de roadmap futuras.

---

## 11. Riscos &amp; Mitigações

1. **Risco: usuário interpreta "Magic Number" como "número mágico de Fibonacci" sem contexto.** *Mitigação:* tooltip obrigatória "?" com explicação em texto corrido + link para artigo/glossário in-app. Texto do botão é "Magic Number (cotas para renda mensal)" e não apenas "Magic Number".
2. **Risco: fórmula com `dy_12m` superestima renda futura (corte iminente).** *Mitigação:* toggle explícito "Último dividendo (conservador)" + nota de rodapé sobre o que cada fórmula assume; opcionalmente integrar com feature 2.9 ("Radar de corte") num PR futuro.
3. **Risco: calculadora global gera Top-K tendencioso para FIIs já na carteira, ignorando diversificação real.** *Mitigação:* (a) ordenar por liquidez × DY **mas com peso de diversificação** (penalizar concentração &gt; 30% do patrimônio num único ticker); (b) tooltip "esta é uma sugestão mecânica, diversifique por tipo_detalhe e segmento"; (c) flag visual se a distribuição proposta concentra &gt; 50% num único tipo.
4. **Risco: telemetria local cresce sem controle.** *Mitigação:* rotina de retenção que purga `magic_number_events` com mais de 90 dias; rodar diariamente em background.
5. **Risco: erro silencioso ao arredondar cotas para baixo — usuário compra 1/3 do necessário.** *Mitigação:* arredondamento **sempre para cima** (`Math.ceil`) com nota clara "arredondado para cima — compre ao menos X cotas". Coverage 100% no teste de borda.
6. **Risco: meta de renda armazenada em `localStorage` confunde usuário em outro device.** *Mitigação:* este app é local-first; usuário sabe que `localStorage` é device-scoped. Documentar no primeiro uso.

---

## 12. Out of Scope

Para esta entrega, **NÃO** estão no escopo:

- ❌ **Cálculo de IR sobre dividendos**. O Magic Number mostra proventos brutos.
- ❌ **Projeção de dividendos com correção monetária (IGPM/IPCA)**. DY e último dividendo são tratados como nominais.
- ❌ **Simulação de aportes mensais sucessivos** (ex: "quanto juntar em 5 anos para meta?"). Apenas capital total a preço atual. (Pode ser evolução em outra feature.)
- ❌ **Cálculo em outras classes de ativos** (ações, BDRs, cripto). Foco 100% FIIs.
- ❌ **Otimização fiscal** (qual FII paga menos IR, etc).
- ❌ **Integração com APIs externas de cotação em tempo real**. Cotações vêm do scraper já existente.
- ❌ **Modo compartilhado entre dispositivos** (sync de meta de renda na nuvem).
- ❌ **Suporte multi-moeda** (cotação em USD).
- ❌ **Notificações push do tipo "atingiu 80% da meta"**. Pode ser evolução via feature de notificações.
- ❌ **Wizard "me ajude a definir a meta"**. Modal opcional "Defina sua meta" é só um input numérico.
- ❌ **Detecção automática de FIIs sub-avaliados** para sugestão ("esses FIIs estão baratos vs DY 5y e dariam renda mais rápido"). É uma feature à parte (cruzamento com feature 2.2/2.9 do roadmap).
