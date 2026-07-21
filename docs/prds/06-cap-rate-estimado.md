# PRD: Coluna "Cap rate (est.)" na Tabela de Posições

## 1. Visão Geral

Esta feature adiciona uma nova coluna **"Cap rate (est.)"** à tabela de Posições do byeINSS, exibindo, para cada FII de Tijolo, o **yield efetivo do imóvel subjacente** estimado a partir de dados já disponíveis localmente (`dy_12m` e `vacancia`). O cálculo usa a fórmula proxy `cap_rate_estimado = dy_12m × (1 − vacancia/100)`, documentada explicitamente em tooltip para evitar interpretação financeira equivocada. FIIs de Papel, FOF e FI-Infra são marcados como `N/A`, pois não possuem portfólio imobiliário direto.

A motivação é responder, em um relance, à pergunta que diferencia um bom FII de Tijolo de uma armadilha de yield: **"este fundo paga yield alto porque o imóvel vale pouco, ou porque a cota está barata?"**. Quando o cap rate estimado fica próximo do DY distribuído, a vacância é baixa e o yield é "real"; quando ele diverge muito para baixo, a vacância está corroendo o rendimento entregue ao cotista.

### Problemas que resolve

1. **Falta de leitura sobre qualidade do yield.** Hoje o investidor só vê DY 12M — número que pode ser inflado por cota despencada ou vacância crescente, sem que o app sinalize isso.
2. **Comparabilidade entre Tijolo.** Cap rate estimado permite comparar HGLG11, XPML11 e BTLG11 em uma métrica comparável (yield do imóvel, não da cota), algo que o I10 não expõe pronto.
3. **Ausência de explicação metodológica.** Adiciona um sinal com **transparência sobre a fórmula** (proxy, não número oficial) via tooltip, evitando que o usuário tome o valor como se fosse cap rate auditado.

### Personas e casos de uso

- **Carlos, investidor FII com 18 meses de experiência:** quer decidir entre comprar mais de um FII de Tijolo que está "DY 13%" e outro que está "DY 11%". Olha cap rate estimado: descobre que o de DY 13% tem vacância 35% e cap rate efetivo 8,5%, enquanto o de DY 11% tem vacância 5% e cap rate efetivo 10,5%. Decide pelo segundo.
- **Renata, focada em renda passiva:** filtra Posições por cap rate estimado ≥ 9% para priorizar FIIs com yield "real" alto, não yield inflado por cotação deprimida.
- **Eduardo, cético:** passa o mouse sobre o cap rate, lê a fórmula proxy, entende a limitação e cruza com a vacância absoluta antes de tomar decisão.

---

## 2. Objetivos &amp; Métricas de Sucesso

### Objetivos mensuráveis

- **OBJ-001.** Exibir `cap_rate_estimado` em % com 1 casa decimal para 100% dos FIIs de Tijolo com `dy_12m` e `vacancia` populados.
- **OBJ-002.** Marcar `N/A` com motivo textual ("Papel", "FOF", "FI-Infra") para todos os FIIs cujo `segmento`/`tipo_detalhe` indique ausência de portfólio físico.
- **OBJ-003.** Tooltip com a fórmula completa visível em até 2 interações (hover ou tap).
- **OBJ-004.** Calcular o valor em ≤ 5 ms por linha para uma carteira de até 200 FIIs (cálculo local trivial; meta de orçamento total de render &lt; 100 ms).
- **OBJ-005.** Permitir **ordenação** da tabela de Posições pela coluna "Cap rate (est.)" tanto crescente quanto decrescente, e filtro por faixa (ex: ≥ 8%).

### KPIs

| KPI | Meta | Como medir |
|---|---|---|
| % de FIIs de Tijolo com cap rate exibido | ≥ 95% | razão entre linhas com valor vs linhas elegíveis |
| Latência de render da tabela com nova coluna | &lt; 100 ms p/ 200 linhas | `performance.now()` em instrumentação |
| Erros `NaN`/`undefined` na coluna | 0 | assertion em testes unitários |
| Adoção (consulta da coluna) | ≥ 30% dos acessos a Posições | tracking de sort/filter na coluna |
| Acurácia da fórmula proxy vs referência | Documentar desvio médio | comparar com cap rate de amostra de 10 FIIs cuja receita por imóvel esteja disponível publicamente |

---

## 3. Requisitos Funcionais

- **RF-001.** O sistema deve calcular `cap_rate_estimado = dy_12m × (1 − vacancia / 100)` no momento da renderização da tabela de Posições, sem chamada de rede.
- **RF-002.** O sistema deve exibir o resultado em formato percentual com 1 casa decimal (ex: `9,4%`), alinhado à direita, com cabeçalho `Cap rate (est.)`.
- **RF-003.** Para FIIs cujo `segmento` ou `tipo_detalhe` classifique como Papel, FOF, FI-Infra ou Desenvolvimento (sem imóveis geradores de receita), o sistema deve exibir `N/A` em vez de número, com tooltip explicando o motivo (ex: "FII de Papel — não há portfólio físico para calcular cap rate").
- **RF-004.** O sistema deve exibir, ao passar o mouse sobre qualquer célula da coluna, um tooltip contendo: (a) a fórmula `cap_rate = dy_12m × (1 − vacancia/100)`, (b) os valores de `dy_12m` e `vacancia` usados, e (c) a frase "Valor estimado — não é cap rate oficial".
- **RF-005.** Se `dy_12m` for `NULL` ou `vacancia` for `NULL`, o sistema deve exibir `—` (em-dash) com tooltip "dados insuficientes (última atualização: DATA)".
- **RF-006.** O sistema deve permitir ordenar a tabela de Posições pela coluna "Cap rate (est.)" em ordem crescente e decrescente; linhas `N/A` e `—` vão para o fim em ambas as direções.
- **RF-007.** O sistema deve persistir o valor calculado em `ativos.cap_rate_estimado` (REAL) após cada atualização de `dy_12m` ou `vacancia` pelo scraper, para evitar recálculo a cada render.
- **RF-008.** A coluna deve respeitar a configuração de **modo escuro/claro** do app e o **tema de cores** já usado para colunas numéricas de DY e Vacância.
- **RF-009.** O sistema deve permitir ordenar/filtrar a coluna simultaneamente com as demais (DY, P/VP, segmento), mantendo o estado de ordenação global da tabela.
- **RF-010.** Em viewports móveis (largura &lt; 768 px), a coluna deve ser ocultável por toggle de "Colunas avançadas" e, quando visível, deve caber em no máximo 80 px de largura.

---

## 4. Requisitos Não-Funcionais

- **RNF-001 — Performance.** Renderização da tabela de Posições com até 200 linhas deve completar em &lt; 100 ms incluindo cálculo e ordenação. Recálculo só ocorre se `cap_rate_estimado` estiver `NULL` no banco.
- **RNF-002 — Privacidade.** Todo cálculo é 100% local. Nenhum dado de FII sai do dispositivo. Não há chamada externa para validar o número.
- **RNF-003 — Compatibilidade.** Compatível com Electron ≥ 25, Node ≥ 18, better-sqlite3 já em uso. Frontend vanilla JS — sem nova dependência de framework.
- **RNF-004 — Determinismo.** Dado `dy_12m` e `vacancia` fixos, o valor de cap rate deve ser idêntico em qualquer execução. Sem randomness, sem fuso-horário-dependente.
- **RNF-005 — Auditabilidade.** O valor de `cap_rate_estimado` é derivado, mas persistido com `updated_at` que reflete a última vez que `dy_12m`/`vacancia` mudou. Tooltip mostra esses timestamps.
- **RNF-006 — Internacionalização.** Strings visíveis (rótulo "Cap rate (est.)", "N/A", tooltips) devem ir para o arquivo de i18n existente; português como idioma default.
- **RNF-007 — Acessibilidade.** Tooltip deve ser acessível por teclado (focus + ativação) e leitor de tela deve ler a fórmula completa, não só "Cap rate 9,4%".
- **RNF-008 — Manutenibilidade.** Cálculo centralizado em uma única função `calcCapRateEstimado(dy_12m, vacancia, tipo_detalhe, segmento)` no módulo utilitário de indicadores; reusada por backend (persistência) e frontend (fallback de render).
- **RNF-009 — Robustez numérica.** Entradas inválidas (`NaN`, `null`, `&lt; 0`, `&gt; 100`) nunca produzem `NaN` na UI; sempre exibem `—` ou `N/A`.

---

## 5. Modelo de Dados

### Mudança de schema

```sql
-- Adicionar coluna em ativos para persistir o valor calculado
ALTER TABLE ativos ADD COLUMN cap_rate_estimado REAL;

-- Bump de versão do schema
UPDATE config SET valor = '1.2' WHERE chave = 'versao_schema';
```

### Atualização da migração

A migration é **aditiva** (sem quebrar versões anteriores). Como o app roda SQLite local com `better-sqlite3`, o `ALTER TABLE ADD COLUMN` executa em operação única e sem necessidade de recriar a tabela.

### Campo calculado vs. stored?

- **Stored (persistente)**, em `ativos.cap_rate_estimado`.
- **Justificativa:** evita recálculo a cada render; permite indexação futura se necessário; mantém auditoria via `updated_at`.
- **Recálculo:** disparado por trigger no backend sempre que `dy_12m` ou `vacancia` forem atualizados pelo scraper (`extractFIIDetalhes` em `src/main/scraper.js`). Lógica:

```js
// Em src/server/utils/indicadores.js (ou similar)
function calcCapRateEstimado(dy_12m, vacancia, tipo_detalhe, segmento) {
  if (isFIISemImovel(tipo_detalhe, segmento)) return null; // → renderiza N/A
  if (dy_12m == null || vacancia == null) return null;     // → renderiza —
  if (dy_12m < 0 || vacancia < 0 || vacancia > 100) return null;
  return round1(dy_12m * (1 - vacancia / 100));
}
```

### Critério "FII sem imóvel"

Lista de `tipo_detalhe` que recebem `N/A`:
- `Papel` (CRIs, LFs, etc.)
- `FOF` (Fundo de Fundos)
- `FI-Infra`
- `Desenvolvimento` (imóveis em construção, yield ainda não estabilizado)
- `Outro` (fallback conservador)

Lista de `segmento` (fallback caso `tipo_detalhe` não esteja populado):
- Qualquer valor contendo (case-insensitive) `Papel`, `CRI`, `Recebíveis`, `Fundos`, `Infra`.

Caso `tipo_detalhe` esteja populado como `Tijolo` ou `Misto`, exibir valor numérico (mesmo em Misto, onde há componente físico relevante).

---

## 6. APIs / Endpoints

| Método | Rota | Request | Response | Erros |
|---|---|---|---|---|
| `GET` | `/api/posicoes` | query params: `ordenacao=cap_rate_est%20desc`, `filtro_cap_rate_min=8` | `200` com lista de posições incluindo `cap_rate_estimado` (number \| null) | `500` em falha de DB |
| `PATCH` | `/api/ativos/:id/indicadores` | body: `{ dy_12m: number, vacancia: number }` | `200 { cap_rate_estimado: number \| null }` (recalculado e persistido) | `400` se entradas inválidas; `404` se ativo não existe |

### Detalhes

**`GET /api/posicoes` (atualização)**
- A query SQL existente deve ser estendida para incluir `a.cap_rate_estimado` no `SELECT`.
- Suporte a `ordenacao` aceita `cap_rate_est_asc` e `cap_rate_est_desc`.
- Suporte a `filtro_cap_rate_min` e `filtro_cap_rate_max` (em %).

**`PATCH /api/ativos/:id/indicadores` (novo)**
- Usado internamente pelo scraper após `extractFIIDetalhes`.
- Não exposto a UI (chamada server-internal).
- Recalcula `cap_rate_estimado` via `calcCapRateEstimado` e persiste.
- Atualiza `updated_at`.

### Compatibilidade
- Clientes existentes que não enviam `filtro_cap_rate_*` continuam funcionando — coluna apenas passou a ser retornada.

---

## 7. UI / UX

### Wireframes (ASCII)

**Frame 1 — Tabela Posições (desktop, com nova coluna)**

```
+----------------------------------------------------------------------------+
| byeINSS  /  Posições                                          [+ Ativo]    |
+----------------------------------------------------------------------------+
| Filtros: [Tijolo] [Liquidez &gt; 1M] [Vacância &lt; 10%] [DY 8-12%]   [▾ Mais]   |
+----------------------------------------------------------------------------+
| Ticker  | Qtd  | PM   | DY 12M | Cap rate (est.) | P/VP | Vac. | Seg.      |
+----------------------------------------------------------------------------+
| HGLG11  | 80   | 165  |  9,8%  |   9,5%          | 0,95 |  3%  | Logístico |
| XPML11  | 50   | 102  | 10,2%  |   8,7%          | 0,89 | 15%  | Shoppings |
| BTLG11  | 120  | 98   |  9,1%  |   8,9%          | 0,92 |  2%  | Logístico |
| MXRF11  | 500  | 10   | 12,5%  |   N/A (Papel)   | 1,01 |  —   | Papel     |
| HFOF11  | 200  | 80   | 10,0%  |   N/A (FOF)     | 0,97 |  —   | FOF       |
| BDIV11  | —    | —    |   —    |   — (s/ dados)  |  —   |  —   | —         |
+----------------------------------------------------------------------------+
| Total: 5 posições · DY médio: 10,2% · Cap rate médio: 8,9%                |
+----------------------------------------------------------------------------+
```

**Frame 2 — Tooltip expandido (hover na célula de cap rate)**

```
+--------------------------------------------------+
|  Cap rate estimado — HGLG11                      |
+--------------------------------------------------+
|  Fórmula: cap_rate = dy_12m × (1 − vacância/100)|
|                                                  |
|  dy_12m:    9,8%                                 |
|  vacância:  3,0%                                 |
|  cálculo:   9,8 × (1 − 0,03) = 9,5%             |
|                                                  |
|  ⚠ Valor estimado. Não é cap rate oficial.       |
|  Última atualização: 18/07/2026                  |
+--------------------------------------------------+
```

**Frame 3 — Tooltip para N/A (hover em MXRF11)**

```
+----------------------------------------------+
|  Cap rate — MXRF11                           |
+----------------------------------------------+
|  N/A — FII de Papel                          |
|                                              |
|  Este fundo não possui portfólio físico,     |
|  portanto não há cap rate aplicável.         |
+----------------------------------------------+
```

**Frame 4 — Mobile (largura &lt; 768 px)**

```
+----------------------------------------+
| Posições                       [≡]      |
+----------------------------------------+
| ▼ HGLG11                               |
|   Qtd: 80 · PM: R$ 165                 |
|   DY 12M: 9,8% · Cap rate: 9,5%        |
|   P/VP: 0,95 · Vacância: 3%            |
|                              [+] [⋮]   |
+----------------------------------------+
| ▼ XPML11                               |
|   Qtd: 50 · PM: R$ 102                 |
|   DY 12M: 10,2% · Cap rate: 8,7%       |
|   P/VP: 0,89 · Vacância: 15%           |
|                              [+] [⋮]   |
+----------------------------------------+
| ...                                    |
+----------------------------------------+
|  [☐] Cap rate (est.)  ← toggle visib. |
+----------------------------------------+
```

### Estados da UI

| Estado | Descrição | Visual |
|---|---|---|
| **Loading** | Coluna existe mas dados ainda não chegaram | `—` em todas as linhas |
| **Empty** | Sem FIIs na carteira | Coluna oculta, sem header |
| **Error** | DB não acessível | `—` + tooltip "erro ao carregar" |
| **Success (Tijolo com dados)** | Valor numérico | `9,5%` |
| **Success (Tijolo sem dados)** | Faltam `dy_12m` ou `vacancia` | `—` + tooltip "dados insuficientes" |
| **N/A (Papel/FOF)** | Sem portfólio físico | `N/A` cinza + tooltip explicativo |

### Acessibilidade (a11y)

- Header da coluna com `aria-sort` refletindo estado (`ascending`, `descending`, `none`).
- Tooltips devem ser focáveis via `Tab` e ativáveis via `Enter`/`Espaço` (não apenas hover).
- Leitor de tela lê: "Cap rate estimado, 9 vírgula 5 por cento, FII HGLG11" para valores numéricos, e "Cap rate estimado, não se aplica, FII de Papel" para `N/A`.
- Contraste mínimo AA (4.5:1) para texto, AA Large (3:1) para valores numéricos.
- Suporte a navegação por teclado na tabela sem armadilha de foco.
- Não usar somente cor para indicar N/A — usar texto literal.

---

## 8. Casos de Borda

1. **FII de Papel com DY alto (MXRF11, 12,5%).** Sem portfólio físico → `N/A` com tooltip "FII de Papel — não há portfólio físico". Usuário pode ainda comparar DY direto entre Papel e Tijolo em outra coluna.
2. **FII com vacância 100% (imóvel totalmente vago).** Cap rate = `dy_12m × 0 = 0%`. Exibe `0,0%` com tooltip "vacância 100% — imóvel totalmente vago, cap rate efetivo zero".
3. **FII com vacância &gt; 100% (dado sujo do scraper).** Tratar como `null` → exibe `—` com tooltip "vacância inválida (&gt;100%)".
4. **FII de Misto (Tijolo + Papel).** Regra: se houver qualquer componente físico, exibir número. Tooltip diz "Misto: considera portfólio total; cap rate efetivo pode ser menor se houver vacância em parte do portfólio".
5. **FII de Desenvolvimento (em construção).** Sem receita estabilizada → `N/A` "Desenvolvimento: imóvel em construção, sem receita recorrente".
6. **`dy_12m` ou `vacancia` nulos por scrape falho.** Exibe `—` + tooltip "dados insuficientes (última atualização: DD/MM/AAAA)".
7. **`dy_12m` negativo (impossível, mas dado sujo).** Tratar como `null` → `—` + tooltip.
8. **FII listado há &lt; 6 meses.** Vacância e DY podem ser instáveis. Exibe valor normalmente, mas tooltip adiciona "FII listado em MM/AAAA — dado volátil, interprete com cautela".
9. **FII com mais de 100 imóveis mas vacância 0% e DY baixo.** Cap rate ≈ DY. Comportamento esperado. Sem alerta especial.
10. **Ordenação com mistura Tijolo/Papel/FOF.** `N/A` vão para o fim em ordem ascendente e descendente (N/A nunca está "no topo"). Comportamento determinístico.
11. **FII de FI-Infra.** Marcado como `N/A` mesmo que "infraestrutura" lembre Tijolo — conceitualmente é projeto de infraestrutura com receita atrelada, sem "imóvel" no sentido clássico.

---

## 9. Dependências

### Features que devem existir antes

- **Schema atual de `ativos`** com `dy_12m`, `vacancia`, `segmento`, `tipo_detalhe` populados pelo scraper (`extractFIIDetalhes` em `src/main/scraper.js`). — **Já existe**.
- **`tipo_detalhe` em `ativos`** — **Pendente (item 2.2 do fii-features.md)**. Sem isso, fallback para `segmento` cobre 80% dos casos, mas com falsos positivos possíveis (ex: "Híbrido" pode ser Misto com 50% Tijolo).
- **`updated_at` em `ativos`** — **Já existe**; usado para auditoria no tooltip.
- **Tabela de Posições funcional com ordenação** — **Já existe** em `src/renderer/js/pages.js` (`renderPosicoes`).
- **Sistema de tooltips reutilizável** — verificar se já existe; caso contrário, criar componente leve.

### Features que se beneficiam desta (downstream)

- **Item 2.4 (Comparador vs média do segmento):** cap rate estimado pode ser desvio vs média do segmento, análogo ao P/VP vs peer.
- **Item 2.5 (Score Buy &amp; Hold):** pode adicionar check "cap rate ≥ 8%" como sinal adicional.
- **Filtros práticos (item 2.7):** "Cap rate ≥ X%" é candidato natural a faceted filter.

---

## 10. Esforço Estimado

### Breakdown por área

| Área | Atividade | Esforço (dias) |
|---|---|---|
| **Backend / DB** | Migration `ALTER TABLE ativos ADD COLUMN cap_rate_estimado` + bump `versao_schema` | 0,1 |
| **Backend / Scraper** | Adicionar recálculo de `cap_rate_estimado` em `extractFIIDetalhes` após popular `dy_12m`/`vacancia` | 0,2 |
| **Backend / API** | Estender `GET /api/posicoes` com `cap_rate_estimado`, ordenação e filtros por faixa | 0,3 |
| **Backend / Util** | Função `calcCapRateEstimado` + `isFIISemImovel` + testes unitários (10 cenários de borda) | 0,3 |
| **Frontend / UI** | Nova coluna na tabela Posições + header com sort | 0,4 |
| **Frontend / Tooltip** | Componente de tooltip com fórmula + valores + timestamp | 0,3 |
| **Frontend / Filtros** | Integração com filtros existentes (faceted) | 0,2 |
| **Frontend / Mobile** | Toggle de "Colunas avançadas" + layout responsivo | 0,2 |
| **QA / Testes** | Casos de borda manuais + regressão visual + verificação de `N/A` vs numérico | 0,3 |
| **Documentação** | Comentários em código + atualização do `docs/fii-features.md` | 0,1 |
| **TOTAL** | | **~2,4 dias** |

### Premissas
- Equipe: 1 dev full-stack.
- `tipo_detalhe` ainda não populado (item 2.2 não entregue): fallback usa `segmento` com cobertura estimada 80%.
- Sem dependência de fornecedor externo (cálculo é 100% local).

---

## 11. Riscos &amp; Mitigações

| # | Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|---|
| 1 | **Usuário interpretar cap rate estimado como cap rate oficial.** Confunde proxy com número auditado e toma decisão errada. | Alta | Alto | Tooltip proeminente com fórmula + aviso "Valor estimado — não é cap rate oficial". Linguagem clara no header da coluna: "Cap rate (est.)". |
| 2 | **`tipo_detalhe` ainda não populado.** Sem ele, fallback por `segmento` erra casos como "Híbrido" (Misto com componente de Papel). | Média | Médio | Documentar a imprecisão. Tarefa do item 2.2 é blocker suave — feature funciona sem, com cobertura menor. |
| 3 | **Vacância stale (scraper não rodou há meses).** Cap rate calculado sobre dado velho gera falsa confiança. | Média | Médio | Tooltip mostra `updated_at` da última atualização. Cor da célula pode esmaecer se `updated_at &gt; 7 dias`. |
| 4 | **Performance degrada com muitas linhas.** Cálculo por linha em JS pode pesar em carteira 500+ FIIs. | Baixa | Baixo | Persistir em coluna (`cap_rate_estimado`) → render não recalcula, só lê. Validação com 500 linhas sintéticas. |
| 5 | **FIIs recém-listados com dado instável.** DY 12M inflado por base curta, vacância oscilante → cap rate enganoso. | Média | Médio | Tooltip inclui aviso "FII listado em MM/AAAA — dado volátil". Sem corte automático (decisão do usuário). |

---

## 12. Out of Scope

- ❌ **Cálculo de cap rate oficial** (com receita por imóvel e valor patrimonial por imóvel separados). Requereria scraping de páginas de "Portfólio" e "Comunicados" por FII, frágil e fora do MVP.
- ❌ **Comparação automática entre cap rate estimado do FII e média do segmento.** Pertence ao item 2.4 do `fii-features.md` (Comparador vs média do segmento).
- ❌ **Score Buy &amp; Hold usando cap rate estimado.** Pertence ao item 2.5.
- ❌ **Cap rate histórico (série temporal).** Apenas o valor atual persistido; sem linha do tempo.
- ❌ **Suporte a ativos não-FII.** Foco FII-only. Ações, ETFs, cripto continuam sem essa coluna (não faz sentido conceitualmente).
- ❌ **Integração com API externa de cap rate** (ex: FundsExplorer, StatusInvest). Local-first permanece o princípio.
- ❌ **Re-cálculo retroativo em lote na primeira execução após deploy.** Não é bloqueador — `updated_at` da coluna só é setado quando o scraper roda de novo. Aceitável para uma feature 100% local.
- ❌ **Tradução da fórmula para outras línguas além de PT-BR.** i18n fica pronto (estrutura), mas conteúdo adicional fica para fase futura.
