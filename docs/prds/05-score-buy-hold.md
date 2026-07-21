# PRD: Score Buy & Hold (FIIs)

## 1. Visão Geral

O **byeINSS** é um app Electron local focado em Fundos Imobiliários (FIIs) que replica, amplia e independe do Investidor10. Hoje o usuário precisa abrir a aba "Checklist" do I10 em cada FII para ver se ele "passa" nos filtros clássicos de Buy &amp; Hold (tempo listado &gt; 5 anos, DY 5y &gt; 8%, liquidez &gt; 700k, cotistas &gt; 20k, PL &gt; 1 bi, vacância &lt; 10%, imóveis ≥ 5). Essa informação é valiosa mas **não está agregada na tabela de Posições** e exige navegação manual por ativo. O **Score Buy &amp; Hold** resolve isso: o app calcula automaticamente um score 0–7 por FII usando dados já capturados pelo scraper, expõe esse score como coluna em "Posições" e mostra, em tooltip, quais checks passam e quais falham — sempre recalculado a partir dos dados vigentes no SQLite, sem depender de snapshot desatualizado de terceiros.

**Três problemas que resolve:**
1. **Decisão lenta de compra/reforço**: o investidor não precisa abrir 4 abas no I10 para cada FII da carteira — o score resume em um número se ele atende aos critérios clássicos de Buy &amp; Hold.
2. **Score desatualizado**: o checklist do I10 é uma página estática. Quando dados mudam (vacância sobe, cotistas caem, liquidez despenca), o app recalcula na hora a partir do SQLite — sem ficar "preso" no snapshot do I10.
3. **Comparabilidade entre FIIs**: hoje Posições ordena por alocação/DY/preço-teto. O score Buy &amp; Hold vira uma **quarta dimensão de ranking** para o investidor Buy &amp; Hold clássico priorizar ativos consistentes.

**Personas e casos de uso:**
- **Maria, investidora Buy &amp; Hold conservadora (35–55 anos)**: usa o score para decidir em quais FIIs da watchlist aportar primeiro. Caso de uso: "Filtrar Posições por score ≥ 5 e DY atual ≥ 10%".
- **Carlos, gestor de carteira própria (30–45 anos)**: quer auditar rapidamente se a carteira está alinhada com a tese Buy &amp; Hold. Caso de uso: ver coluna B&amp;H em Posições + tooltip explicando cada check.
- **Ana, iniciante em FIIs (25–35 anos)**: precisa aprender quais são os critérios clássicos. Caso de uso: tooltip educativo em cada check (ex: "Cotistas &gt; 20k = FII líquido, fácil de entrar/sair").

---

## 2. Objetivos &amp; Métricas de Sucesso

| # | Objetivo | Métrica |
|---|---|---|
| OBJ-01 | Disponibilizar score Buy &amp; Hold (0–7) para todos os FIIs da base | 100% dos FIIs com `tipo='FII'` retornam score pelo endpoint `/api/fiis/scoring/buy-hold` |
| OBJ-02 | Recalcular score automaticamente após atualização de dados | Latência de recálculo &lt; 200ms para 50 FIIs; score reflete valor atual das colunas no SQLite |
| OBJ-03 | Expor score na tabela Posições com tooltip explicativo | Coluna "B&amp;H" renderiza em todas as linhas; tooltip mostra 7 checks (✓/✗) com descrição de cada |
| OBJ-04 | Tornar a lógica auditável e didática | Usuário entende, pelo tooltip, **por que** um FII tem score 4/7 e o que falta |
| OBJ-05 | Manter o app independente do I10 para esse dado | Se o I10 sair do ar, o score continua funcionando com dados do SQLite (próxima atualização) |

**KPI principal:** % de FIIs da carteira com score ≥ 5 exibidos como "Buy &amp; Hold-friendly" na coluna. Meta de uso: ≥ 60% dos usuários ativos clicando no tooltip da coluna em até 30 dias.

---

## 3. Requisitos Funcionais

- **RF-001**: O backend deve expor `GET /api/fiis/scoring/buy-hold` que retorna, para cada FII da base, `{ ticker, score, total, checks: [{nome, passou, valor, threshold}] }` calculado a partir dos campos vigentes em `ativos` + tabelas auxiliares.
- **RF-002**: O backend deve expor `GET /api/fiis/scoring/buy-hold/:ticker` que retorna o detalhamento completo do score de um único FII (mesmo schema do item anterior, em objeto único).
- **RF-003**: A função de cálculo deve ser **determinística**: mesmos dados de entrada → mesmo score, sem dependência de timestamp, ordenação de iteração ou cache volátil.
- **RF-004**: Cada check deve ser uma função pura `(ativo_row) -&gt; {passou: boolean, valor: any, threshold: any}`. O score final é a soma dos `passou=true`.
- **RF-005**: O frontend deve renderizar, na tabela "Posições", uma nova coluna "B&amp;H" contendo um chip numérico `score/7` com cor baseada em faixas (ex: 0–2 vermelho, 3–4 amarelo, 5–6 verde claro, 7 verde forte).
- **RF-006**: O chip da coluna "B&amp;H" deve ter `title`/tooltip acessível que liste os 7 checks no formato `✓ Tempo listado &gt; 5a (7.2a) / ✗ DY 5y ≥ 8% (6.4%) / ...`.
- **RF-007**: O score deve ser recalculado on-the-fly na renderização de Posições (sem chamada AJAX obrigatória): o backend já devolve o score junto do payload de Posições (`GET /api/posicoes` enriquecido).
- **RF-008**: Quando um FII não tiver dado suficiente para um check (ex: `numero_cotistas` é NULL porque PRD 02 não foi implementado), o check deve retornar `{passou: false, valor: null, threshold: '...', motivo: 'dado indisponível'}` e **não** contar ponto, mas aparecer no tooltip como "—".
- **RF-009**: A página de detalhe do FII (`/fiis/{ticker}/`) deve mostrar um card "Buy &amp; Hold Score" com os mesmos 7 checks em formato de lista vertical (✓ verde / ✗ vermelho / — cinza), replicando o visual da aba "Checklist" do I10.
- **RF-010**: O endpoint deve aceitar um query param `?recalcular=1` que força o recálculo mesmo se houver cache, útil para debug/devtools.
- **RF-011**: O score e seus checks devem estar disponíveis também via `window.byeINSS.buyHoldScore(ticker)` no renderer (helper de debug/script), exposto pelo backend IPC se necessário.
- **RF-012**: Quando o scraper termina de atualizar dados de um FII, o score desse FII deve ser invalidado no cache (se houver tabela `fii_indicadores_cache`) e recalculado no próximo acesso.

---

## 4. Requisitos Não-Funcionais

- **Performance**: cálculo do score para 50 FIIs deve levar &lt; 100ms em hardware modesto (laptop 2018). Endpoint `/api/fiis/scoring/buy-hold` deve responder em &lt; 300ms com a base cheia.
- **Determinismo**: mesma entrada → mesmo resultado, em qualquer hora/dia. Sem `Math.random`, sem timestamp no output. Recálculo deve ser idempotente.
- **Privacidade**: cálculo é 100% local (Electron + SQLite local). Nenhum dado de score sai da máquina do usuário.
- **Compatibilidade**: deve funcionar em Linux/Windows/macOS (Electron já roda nesses). Função de data "5 anos atrás" usa `Date.now()` mas é só para **exibição do check de tempo listado**, não para o score em si (passou/não-passou é determinístico).
- **Offline-first**: se o usuário abrir o app sem internet, o score continua funcionando (depende só de dados já no SQLite).
- **Acessibilidade (a11y)**: tooltip do chip deve ser acessível via teclado (`tabindex=0`, foco visível, leitor de tela lê o conteúdo do `aria-label` que resume os checks).
- **Resiliência a schema parcial**: se colunas novas (PRD 02) ainda não foram aplicadas, função não pode quebrar — deve marcar checks como "dado indisponível" e seguir.
- **Testabilidade**: cada check deve ter teste unitário isolado (função pura). Cobertura mínima 80% da função `computeBuyHoldScore`.
- **Versionamento da fórmula**: se a lógica dos checks mudar (ex: threshold de liquidez passa de 700k para 1M), o sistema deve registrar `versao_formula` no resultado para auditoria retrospectiva.

---

## 5. Modelo de Dados

**Premissa:** o PRD 02 já adicionou em `ativos` as colunas `dy_medio_5a`, `liquidez_diaria`, `numero_cotistas`, `patrimonio_liquido`, `data_listagem`. Se ainda não estiverem presentes, o score funciona mas marca os checks correspondentes como "dado indisponível".

**Schema adicional — apenas o necessário para cache opcional:**

```sql
-- Tabela de cache: evita recomputar 7 checks em todo GET /api/posicoes.
-- Não é obrigatória: se ausente, score é computado on-the-fly.
CREATE TABLE IF NOT EXISTS fii_indicadores_cache (
  ativo_id INTEGER PRIMARY KEY,
  score_buy_hold INTEGER NOT NULL,        -- 0..7
  checks_json TEXT NOT NULL,              -- JSON: [{nome, passou, valor, threshold, motivo}]
  formula_versao TEXT NOT NULL DEFAULT 'v1.0',
  calculo_em TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (ativo_id) REFERENCES ativos(id)
);

CREATE INDEX IF NOT EXISTS idx_fii_cache_score ON fii_indicadores_cache(score_buy_hold DESC);
```

**Política de cache:**
- **Cache hit** (existe linha em `fii_indicadores_cache` e `calculo_em` &lt; 24h): retornar direto.
- **Cache miss** ou stale: recomputar, gravar, retornar.
- **Invalidação explícita**: quando o scraper (`extractFIIDetalhes`) gravar `updated_at` em `ativos` para aquele `id`, deletar a linha correspondente em `fii_indicadores_cache` (próximo acesso recomputa).
- **Não há `ALTER TABLE`**: a feature pode ser ativada/desativada sem migração destrutiva.

**Stored computation vs on-the-fly:** a recomendação é **on-the-fly** (sem tabela de cache) na primeira versão, porque:
1. Custo computacional é desprezível (7 comparações inteiras/real por FII).
2. Elimina problema de invalidação.
3. Resultado é sempre "fresco".

Se profiling mostrar gargalo (&gt;50ms para 200 FIIs), ativar `fii_indicadores_cache` com invalidação via trigger:

```sql
-- Trigger opcional (só criar se tabela cache existir):
CREATE TRIGGER IF NOT EXISTS trg_invalidate_cache_after_ativos_update
AFTER UPDATE OF dy_12m, dy_medio_5a, liquidez_diaria, numero_cotistas,
              patrimonio_liquido, vacancia, num_imoveis, data_listagem
ON ativos
FOR EACH ROW
BEGIN
  DELETE FROM fii_indicadores_cache WHERE ativo_id = NEW.id;
END;
```

---

## 6. APIs / Endpoints

| Método | Rota | Request | Response (200) | Erros |
|---|---|---|---|---|
| GET | `/api/fiis/scoring/buy-hold` | — (opcional `?recalcular=1`) | `[{ ticker, score, total, checks: [...] }, ...]` | 500 se SQLite inacessível |
| GET | `/api/fiis/scoring/buy-hold/:ticker` | path: `ticker` | `{ ticker, score, total, checks: [...], formula_versao, calculo_em }` | 404 se ticker não existe; 400 se ticker inválido |
| GET | `/api/posicoes` (enriquecido) | — (já existe; ganha campo `score_buy_hold` por linha) | `[{ ..., score_buy_hold: { score, total, checks } }, ...]` | — |

**Schema de `checks[]`:**
```json
[
  { "nome": "tempo_listado_gt_5a",  "passou": true,  "valor": 7.2,   "threshold": 5,    "motivo": null,                "label": "Listado &gt; 5 anos" },
  { "nome": "dy_5a_gt_8",           "passou": true,  "valor": 9.1,   "threshold": 8,    "motivo": null,                "label": "DY 5 anos ≥ 8%" },
  { "nome": "liquidez_gt_700k",     "passou": false, "valor": 412000,"threshold": 700000,"motivo": "liquidez abaixo do mínimo","label": "Liquidez ≥ R$ 700k/dia" },
  { "nome": "cotistas_gt_20k",      "passou": true,  "valor": 38421, "threshold": 20000,"motivo": null,                "label": "Cotistas ≥ 20k" },
  { "nome": "pl_gt_1bi",            "passou": true,  "valor": 1.8e9, "threshold": 1e9,  "motivo": null,                "label": "Patrimônio ≥ R$ 1 bi" },
  { "nome": "vacancia_lt_10",       "passou": false, "valor": 14.3,  "threshold": 10,   "motivo": "vacância acima do limite","label": "Vacância &lt; 10%" },
  { "nome": "imoveis_ge_5",         "passou": true,  "valor": 12,    "threshold": 5,    "motivo": null,                "label": "Imóveis ≥ 5" }
]
```

**Erros padronizados:**
- `400 Bad Request`: ticker malformado (regex `^[A-Z]{4}\d{1,2}$`).
- `404 Not Found`: ticker não consta em `ativos`.
- `500 Internal Error`: falha no SQLite ou lógica inesperada (logado em stderr do main process).

---

## 7. UI / UX

### Wireframe — Tabela Posições (com coluna B&amp;H)

```
+----------------------------------------------------------------------------------+
| Posições                  [Filtros ▾]  [Ordenar: Alocação | DY | B&amp;H ▾]          |
+----------------------------------------------------------------------------------+
| Ticker | Qtde | PM  | DY 12m | P/VP | Vac% | B&amp;H | Preço-teto | Ações          |
+----------------------------------------------------------------------------------+
| HGLG11 |  80  | 158 |  9.2%  | 0.94 |  3.1 | 7/7 |  R$ 165,20 | [Comprar][X] |
|        |      |     |        |      |      | ^tooltip: ✓ Listado 7a, ✓ DY 5a 9.5%,|
|        |      |     |        |      |      |  ✓ Liq 1.2M, ✓ Cotistas 62k, ✓ PL 2.4bi,|
|        |      |     |        |      |      |  ✓ Vac 3.1%, ✓ 12 imóveis               |
|--------|------|-----|--------|------|------|-----|------------|----------------|
| XPML11 |  50  | 105 | 10.1%  | 0.97 | 12.4 | 5/7 |  R$ 100,00 | [Comprar][X] |
|        |      |     |        |      |      | ^tooltip: ✓ Listado 6a, ✗ DY 5a 7.2%,|
|        |      |     |        |      |      |  ✓ Liq 850k, ✓ Cotistas 41k, ✓ PL 1.6bi,|
|        |      |     |        |      |      |  ✗ Vac 12.4%, ✓ 18 imóveis               |
|--------|------|-----|--------|------|------|-----|------------|----------------|
| IRDM11 |  30  |  72 | 13.8%  | 1.05 |  5.0 | 3/7 |  R$  68,50 | [Comprar][X] |
|        |      |     |        |      |      | ^tooltip: ✗ Listado 3.5a (IPO recente),|
|        |      |     |        |      |      |  ✓ DY 5a 9.8%, ✓ Liq 720k, ✗ Cotistas 14k,|
|        |      |     |        |      |      |  ✗ PL 480M, ✓ Vac 5.0%, ✗ 4 imóveis       |
+----------------------------------------------------------------------------------+
```

### Wireframe — Card na página de detalhe do FII (`/fiis/{ticker}/`)

```
+----------------------------------------------------+
| HGLG11 — Buy &amp; Hold Score            7 / 7  (forte) |
+----------------------------------------------------+
| ✓ Listado &gt; 5 anos                    7.2 anos     |
| ✓ DY 5 anos ≥ 8%                       9.5%        |
| ✓ Liquidez ≥ R$ 700k/dia              R$ 1.210.000 |
| ✓ Cotistas ≥ 20k                       62.481      |
| ✓ Patrimônio ≥ R$ 1 bi                R$ 2,4 bi   |
| ✓ Vacância &lt; 10%                       3.1%        |
| ✓ Imóveis ≥ 5                          12 imóveis  |
|----------------------------------------------------|
| Fórmula: v1.0 | Última atualização: 19/07/2026    |
+----------------------------------------------------+
```

### Wireframe — Estado de dado indisponível

```
+----------------------------------------------------+
| HCRD11 — Buy &amp; Hold Score            3 / 7  (fraco) |
+----------------------------------------------------+
| ✓ Listado &gt; 5 anos                    6.1 anos     |
| ✓ DY 5 anos ≥ 8%                       8.7%        |
| ✗ Liquidez ≥ R$ 700k/dia              R$ 380.000  |
| ✓ Cotistas ≥ 20k                       24.110      |
| — Patrimônio ≥ R$ 1 bi                dado indisponível |
| ✓ Vacância &lt; 10%                       7.2%        |
| ✗ Imóveis ≥ 5                          3 imóveis   |
+----------------------------------------------------+
```

### Lista de estados

| Estado | Onde | Comportamento |
|---|---|---|
| **loading** | Coluna B&amp;H durante fetch inicial | Renderizar `—` em texto cinza, sem chip |
| **empty** (carteira vazia) | Tabela Posições inteira | Manter comportamento atual; coluna B&amp;H some se não há linhas |
| **error** (SQLite off) | Coluna B&amp;H | Mostrar `!` em tooltip "Erro ao calcular score. Verifique o banco local." |
| **success (parcial)** | Card na página do FII | Mostra `score/total` real; checks com dado indisponível marcados `—` cinza |
| **success (completo)** | Coluna B&amp;H | Chip colorido + tooltip com 7 checks |
| **stale cache** | n/a (cache invalidado por trigger) | Recalcula no próximo GET; usuário não vê estado stale |

### Acessibilidade (a11y)

- Chip da coluna `B&amp;H`: `&lt;button&gt;` ou `&lt;span tabindex="0" role="button"&gt;` com `aria-label="Score Buy &amp; Hold: 7 de 7"`.
- Tooltip: usa `&lt;details&gt;`/`&lt;summary&gt;` semântico OU popover com `aria-describedby` apontando para um `&lt;div role="tooltip"&gt;` oculto até focus/hover.
- Cor nunca é o único indicador: ícone `✓`/`✗`/`—` sempre presente ao lado do número.
- Contraste mínimo WCAG AA (4.5:1) para os 4 estados de cor do chip (vermelho, amarelo, verde claro, verde forte) sobre fundo branco/preto.
- Navegação por `Tab` permite chegar na célula, `Enter`/`Space` "expande" tooltip detalhado (alternativa ao hover).
- Foco visível: outline de 2px na célula focada.

---

## 8. Casos de Borda

1. **FII com IPO há exatamente 5 anos**: regra usa `&lt;` (estrito), não `≤`. FII listado em `2021-07-19`, avaliado em `2026-07-19`: tempo = 5.0a → **não passa** o check (precisa ser &gt; 5a). Documentar na fórmula.
2. **Campo `data_listagem` ausente** (FII sem data de IPO registrada): check `tempo_listado_gt_5a` retorna `{passou: false, motivo: 'data de listagem desconhecida'}`. Não é exceção silenciosa — aparece no tooltip.
3. **Liq muito variável**: usar valor atual de `liquidez_diaria`. Se o usuário quiser média de N dias, isso é feature separada (fora do escopo). Documentar no tooltip.
4. **Cotistas exatamente 20.000**: passa (`≥ 20k`, inclusivo). Documentar.
5. **PL exatamente R$ 1 bi**: passa (`≥ 1e9`, inclusivo).
6. **Vacância = 10.0%**: **não passa** (`&lt; 10`, estrito). Documentar.
7. **Num_imóveis = 5**: passa (`≥ 5`, inclusivo).
8. **DY 5y = 7.99%**: não passa (`≥ 8`). Mostra valor no tooltip para o usuário ver que está "quase lá".
9. **FII de Papel/FII-Infra sem `num_imoveis`**: campo é NULL. Check `imoveis_ge_5` retorna `{passou: false, valor: null, motivo: 'sem imóveis (FII de papel)'}`. Aparece como `—` no tooltip.
10. **Vacância NULL** (FII de Papel): check `vacancia_lt_10` retorna `{passou: true, valor: null, motivo: 'não se aplica (papel)'}`. Por default passa, mas mostra "—" no tooltip (FIIs de papel não têm vacância física). **Decisão a confirmar com usuário**.
11. **Ticker com scrape falhado** (`ativos.dy_12m` é NULL ou stale há meses): score calculado com dados possivelmente antigos. Backend loga warning mas não bloqueia.
12. **Re-rodar scraper durante renderização de Posições**: idempotência do cálculo garante que o resultado é estável enquanto os dados não mudam.
13. **Base com 0 FIIs**: endpoint retorna `[]`; UI renderiza estado vazio atual sem mudanças.
14. **Ticker inexistente em `/api/fiis/scoring/buy-hold/:ticker`**: retorna 404 com `{error: 'ticker não encontrado', ticker: 'XXXX11'}`.
15. **Score igual para dois FIIs na ordenação**: desempate por ticker ASC (estável).
16. **Cache stale por &gt; 24h mas dados não mudaram**: retorna cache mesmo assim (lógica "dados não mudaram" precisa de `updated_at` em `ativos` — comparação com `calculo_em` do cache).
17. **Discrepância de fórmula entre app e I10** (I10 muda threshold sem avisar): campo `formula_versao` permite rastrear qual versão o usuário está rodando; tooltip mostra "Fórmula: v1.0".

---

## 9. Dependências

Esta feature **bloqueia-se em**:

| Dependência | Status esperado | Bloqueante? |
|---|---|---|
| **PRD 02 (item 2.2 do fii-features.md)** — adicionar colunas `dy_medio_5a`, `liquidez_diaria`, `numero_cotistas`, `patrimonio_liquido`, `data_listagem` em `ativos` | Schema + scraper enriquecido | **Sim**: sem isso, 4 dos 7 checks retornam "dado indisponível". Score ainda funciona, mas é subutilizado. |
| **Scraper `extractFIIDetalhes`** com parser para os novos campos | Implementação em `src/main/scraper.js` | **Sim** (acoplado ao PRD 02) |
| Tabela `ativos` com coluna `created_at` (já existe em `init.sql`) | Pronto | Não |
| Colunas já existentes: `vacancia`, `num_imoveis`, `dy_12m` | Pronto (linhas 18–22 de `init.sql`) | Não |
| Frontend com tabela Posições funcional | Pronto (`src/renderer/js/pages.js`) | Não |
| IPC pattern entre main e renderer (`byeinSS.api.*`) | Pronto | Não |
| Helper de tooltip nativo (`title` attribute ou lib de popover) | Decisão de design | Não (pode usar `title=` HTML puro na v1) |

**Dependências futuras (não bloqueantes):**
- Histórico de dividendos (PRD item 2.1) pode ser usado no futuro para refinar o check "DY 5y ≥ 8%" com DY efetivo calculado da série histórica em vez do `dy_medio_5a` do I10.
- Comparador vs segmento (PRD 2.4) pode virar um **8º check** no futuro: "P/VP abaixo da média do segmento".

---

## 10. Esforço Estimado

Estimativa em **dias úteis** (1 dev full-stack Electron/Node + SQL):

| Área | Tarefa | Dias |
|---|---|---|
| **Schema** | Migration `fii_indicadores_cache` (opcional) + trigger de invalidação | 0.2 |
| **Backend** | Função `computeBuyHoldScore(ativoRow)` em `src/main/scoring.js` com 7 checks puros | 0.5 |
| **Backend** | Endpoints `GET /api/fiis/scoring/buy-hold` e `GET /api/fiis/scoring/buy-hold/:ticker` | 0.3 |
| **Backend** | Enriquecer `GET /api/posicoes` com campo `score_buy_hold` por linha | 0.2 |
| **Backend** | Invalidação de cache no fim do `extractFIIDetalhes` | 0.1 |
| **Frontend** | Renderização da coluna "B&amp;H" em `renderPosicoes` + chip colorido | 0.3 |
| **Frontend** | Tooltip nativo (`title=` com 7 linhas) + acessibilidade (tabindex/aria) | 0.2 |
| **Frontend** | Card "Buy &amp; Hold Score" na página de detalhe do FII | 0.3 |
| **Testes** | Suite unitária dos 7 checks (funções puras, fácil de mockar `ativoRow`) | 0.4 |
| **Testes** | Teste de integração dos endpoints | 0.2 |
| **QA** | Validação manual em 10 FIIs (HGLG11, XPML11, IRDM11, MXRF11, etc.) conferindo com checklist do I10 | 0.2 |
| **Docs** | Inline JSDoc na função + tooltip explicando fórmula | 0.1 |
| **TOTAL** | | **~3.0 dias** |

Buffer para imprevistos / polimento: **+0.5 dia** → **3.5 dias corridos**.

---

## 11. Riscos &amp; Mitigações

| # | Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|---|
| R-01 | **PRD 02 não foi implementado**: 4 de 7 checks retornam "dado indisponível", score fica artificialmente baixo e o usuário acha a feature "bugada". | Alta | Médio | Documentar explicitamente que score depende dos campos do PRD 02. Feature degrada gracefully (mostra `—` em vez de quebrar). Adicionar banner na primeira renderização: "score Buy &amp; Hold parcial: 4 checks dependem de dados ainda não importados (PRD 02)". |
| R-02 | **Discrepância de score com I10**: o app marca HGLG11 como 5/7 mas o I10 marca como 6/7. Usuário desconfia da lógica. | Média | Médio | Tooltip exibe **valor + threshold** de cada check (ex: "Liquidez R$ 380k &lt; R$ 700k"). Usuário pode auditar e discordar com base nos números. Documentar que a fórmula é fiel à aba "Checklist" do I10, mas arredondamentos/divergências de fonte de dados podem gerar diferença de ±1 ponto. |
| R-03 | **Performance em base grande** (1000+ FIIs): recálculo on-the-fly a cada GET `/api/posicoes` fica lento. | Baixa | Baixo | Ativar `fii_indicadores_cache` com TTL de 24h + invalidação via trigger. Medir: se &gt; 50ms para 200 FIIs, cache é obrigatório. |
| R-04 | **Vacância NULL em FIIs de Papel**: tratar como `passou=true` é tecnicamente errado (não se aplica). Tratar como `passou=false` quebra a UX (papel "pune" o score. | Média | Médio | Decisão: tratar `vacancia IS NULL AND tipo='FII' AND tipo_detalhe IN ('Papel','FI-Infra')` como **"não se aplica"**, excluindo do denominador (score fica sobre 6 checks no caso). Marcar essa decisão na `formula_versao` (v1.1 se mudar). **Validar com usuário antes de implementar.** |
| R-05 | **Mudança de critério do I10**: I10 muda "Liquidez &gt; 700k" para "Liquidez &gt; 1M" em 2027. App fica desatualizado. | Baixa | Baixo | Constantes de threshold ficam em um único arquivo `src/main/scoring-thresholds.js`. `formula_versao` no payload permite o usuário saber qual versão está rodando. Documentar processo de bump de versão quando I10 mudar. |
| R-06 | **Cache desatualizado por race condition**: scraper termina, UI lê cache antes da invalidação. | Baixa | Baixo | Invalidação atômica via trigger SQL: DELETE no mesmo `BEGIN/COMMIT` da UPDATE em `ativos`. UI sempre lê após COMMIT do scraper (já é o padrão atual). |

---

## 12. Out of Scope

Explicitamente **fora** do escopo desta feature:

1. **Qualquer score que não seja Buy &amp; Hold** (ex: score "Crescimento", "Dividendo Yields", "Tijolo vs Papel"). O usuário pediu só o checklist B&amp;H.
2. **Replicar todos os ~17 outros sinais do I10** (rentabilidade real, comparação vs segmento, magic number, etc.) — esses são PRDs separados (2.1, 2.2, 2.4, 2.11).
3. **Recomendar compra/venda**: o score é informativo. Nenhuma lógica de "se score ≥ 6, sugiro comprar R$ X".
4. **Backtest histórico** ("se você tivesse usado esse score em 2020, teria ganhado X%").
5. **Score personalizado por usuário** (cada um com seus próprios thresholds). Thresholds são fixos e iguais ao I10 na v1.
6. **Histórico de score** ao longo do tempo (ex: "em 2024 esse FII tinha score 7, hoje tem 5"). Sem snapshots, sem gráfico de evolução. Apenas score atual.
7. **Notificações push** ("FII X caiu de score 7 para 4"). Sem integração com sistema de notificações do OS.
8. **Integração com APIs externas** além do scraper já existente. Cálculo é 100% local sobre o SQLite.
9. **Suporte a ações, BDRs, ETFs, CRIPTO**: o score é exclusivo para FIIs (todos os checks são métricas de FII). Linhas com `tipo != 'FII'` retornam 404 ou são filtradas no endpoint.
10. **Filtro automático por score** ("mostrar só FIIs com score ≥ 5"). A coluna existe, o filtro fica para a feature 2.7 do fii-features (filtros práticos). Aqui só entregamos a coluna + tooltip.
11. **Exportação do score** (CSV/Excel do score por FII). Sem exportação.
12. **Score ponderado** (alguns checks valem mais que outros). Todos valem 1 ponto na v1.
