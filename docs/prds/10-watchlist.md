# PRD: Watchlist de FIIs

## 1. Visão Geral

A Watchlist de FIIs é uma nova superfície do byeINSS dedicada a acompanhar Fundos Imobiliários que o usuário ainda **não possui** na carteira, mas que estão em seu radar de estudo e/ou de oportunidade de compra. Diferente da aba "Posições" (que só mostra FIIs com posição aberta), a Watchlist persiste uma lista pessoal de tickers acompanhados com metadata editorial (data de adição, nota livre) e cruza automaticamente com os indicadores fundamentalistas e técnicos já conhecidos pelo app: preço atual, preço-teto (calculado pelo simulador), DY corrente, score Buy &amp; Hold e variação desde que o ticker foi adicionado.

Os itens adicionados à Watchlist também podem receber **alertas opcionais por item**, começando por DY cruzando um threshold definido pelo usuário (ex: "notificar quando DY 12M ≥ 11%"). Esses alertas são processados em segundo plano (job diário) e empurrados como notificações nativas do Electron quando o app estiver aberto.

**Três problemas que resolve:**
1. **Memória e organização de teses.** O investidor FII estuda dezenas de papéis por mês; sem persistência, teses boas se perdem no histórico do navegador ou do Telegram. A Watchlist formaliza "FIIs que estou de olho" como first-class citizen.
2. **Sinal de entrada disciplinado.** Ao cruzar Watchlist com preço-teto (feature já existente) e DY corrente, o app responde automaticamente "este FII já está no seu preço-teto? DY subiu acima do seu gatilho?". Hoje essa conta é feita manualmente em planilha.
3. **Separação conceitual entre estudo e posição.** O schema atual (`ativos`) só representa FIIs comprados. Forçar watchlist em `ativos` polui a carteira com itens sem transação e quebra o conceito de "posição". Uma tabela dedicada mantém a fronteira limpa e abre caminho para features dependentes (radar DY, alertas).

**Personas e casos de uso:**
- **Persona A — "Acumulador disciplinado".** Investidor que roda screeners semanais, elege 5–10 candidatos, e quer ser avisado quando o preço-teto é atingido ou o DY sobe ao seu gatilho.
- **Persona B — "Estudioso de FIIs".** Mantém lista de 30+ papéis em estudo contínuo (setores, gestoras, mandatos). Usa a nota livre para registrar tese ("esperar vacância &lt; 5%", "revisar após AGE de março").
- **Persona C — "Comparador de oportunidades".** Adiciona FIIs recém-listados para acompanhar maturação (cotistas, vacância, DY) e decidir entrada meses depois.

---

## 2. Objetivos &amp; Métricas de Sucesso

**Objetivos mensuráveis:**
1. **Adoção.** Em até 60 dias após release, ≥ 60% dos usuários ativos têm ≥ 1 item na Watchlist (mínimo de utilidade percebida).
2. **Persistência.** Itens adicionados permanecem na Watchlist por ≥ 30 dias em ≥ 80% dos casos (indica que não é só "testar e esquecer").
3. **Conversão.** ≥ 15% dos usuários que adicionam itens na Watchlist acabam comprando pelo menos 1 deles nos 90 dias seguintes (medido via `transacoes` cruzando `ticker` com `watchlist.adicionado_em`).
4. **Engajamento com alertas.** ≥ 25% dos usuários que adicionam ≥ 1 item ativam alerta de DY para pelo menos 1 ticker; taxa de cliques em notificação entregue ≥ 40%.
5. **Aderência ao preço-teto.** Usuários com Watchlist + preço-teto configurado conseguem identificar ≥ 1 oportunidade (FII abaixo do teto) por mês em ≥ 70% dos meses.

**KPIs:**
- DAU/WAU da aba `#fii-watchlist`.
- Média de itens por Watchlist por usuário.
- Número de alertas configurados / disparados / clicados.
- Tempo médio entre "FII adicionado à Watchlist" e "primeira transação de compra do mesmo ticker".
- CSAT/NPS opcional in-app após 30 dias de uso.

---

## 3. Requisitos Funcionais

- **RF-001 — Adicionar ticker à Watchlist.** O usuário pode adicionar um ticker FII válido (existente no universo FII ou não) à Watchlist via botão "★ Adicionar à Watchlist" na página de detalhe de qualquer FII ou via modal dedicado de busca. Cada ticker aparece no máximo uma vez na Watchlist.
- **RF-002 — Editar e remover itens.** O usuário pode editar a nota livre e remover o ticker. A remoção é soft-delete opcional (configurável) ou hard-delete (default), sempre reversível enquanto o item não for purgado.
- **RF-003 — Persistir data de adição.** Toda inclusão grava `adicionado_em = datetime('now')` UTC. A data é imutável após a inclusão (não muda se o usuário editar a nota).
- **RF-004 — Exibir indicadores fundamentalistas enriquecidos.** Para cada item da Watchlist, a tabela exibe: preço atual, preço-teto (configurado pelo usuário em "Preço-teto"), DY 12M corrente, score B&amp;H (0–7), variação % desde `adicionado_em`, segmento, vacância. Valores NULL (ex: FII nunca raspado) renderizam como "—" com tooltip "Atualize os dados do FII".
- **RF-005 — Configurar alerta de DY por item.** O usuário pode associar, a cada item, um threshold de DY (`alerta_dy_threshold REAL`, ex: 11.0) e uma direção (`acima` ou `abaixo`, default `acima`). O alerta fica inativo se o threshold for NULL.
- **RF-006 — Job de avaliação de alertas.** Um job em background (a cada 6h enquanto o app estiver aberto) compara `ativos.dy_12m` atual com `watchlist.alerta_dy_threshold` para cada item com alerta ativo. Quando o DY cruza o threshold na direção configurada, dispara notificação nativa.
- **RF-007 — Histórico de alertas disparados.** Toda notificação disparada grava linha em `watchlist_alertas_historico` com timestamp, valor do DY no disparo e o ticker. O usuário pode ver o histórico na aba Watchlist.
- **RF-008 — Importar watchlist do Investidor10 (opcional, v1.1).** Botão "Importar do I10" tenta puxar a lista de favoritos do I10 via sessão autenticada do scraper. Sujeito à disponibilidade — se bloqueado, exibir mensagem clara.
- **RF-009 — Filtros e ordenação na tabela Watchlist.** Filtros por segmento, gestor, presença de alerta ativo, e DY dentro/fora de faixa. Ordenação por qualquer coluna (ticker, preço, DY, variação, data de adição).
- **RF-010 — Exportar/importar Watchlist em JSON.** Botões "Exportar" e "Importar" arquivo `.json` com a estrutura completa (ticker, nota, threshold, direção, data). Útil para backup e migração entre máquinas.
- **RF-011 — Estados vazio e de erro.** Estado empty dedicado com call-to-action "Adicione seu primeiro FII" + link para tela `#fii-analise`. Estado error renderiza mensagem + botão "Tentar novamente" se a falha for recuperável.
- **RF-012 — Indicador visual de "abaixo do preço-teto".** Para itens com preço-teto configurado, a tabela destaca (chip verde) FIIs cujo preço atual ≤ preço-teto. Atalho de decisão.

---

## 4. Requisitos Não-Funcionais

- **Performance.** Lista deve renderizar até 200 itens em &lt; 100ms (sem scrape). Recalcular score B&amp;H de todos os itens em &lt; 500ms. Job de alertas processa até 500 itens com alerta ativo em &lt; 5s.
- **Privacidade e local-first.** Watchlist persiste apenas em SQLite local (arquivo do Electron). Nenhum dado sai da máquina sem ação explícita do usuário (export ou sync opcional).
- **Compatibilidade.** Funciona no Electron já suportado (Linux/Windows/macOS). Migração de schema é não-destrutiva e idempotente: se as tabelas/colunas já existirem, a migration é no-op.
- **Resiliência do scraper.** A view de Watchlist nunca quebra porque um FII falhou ao raspar; marca item com badge "dados desatualizados" e mantém última cotação conhecida.
- **Acessibilidade (a11y).** Navegação completa por teclado (Tab/Enter/Esc), roles ARIA em tabelas e modais, contraste AA em chips de alerta, leitor de tela anuncia DY/preço/variacao explicitamente.
- **i18n.** Strings em pt-BR no MVP. Arquivo de mensagens isolado para viabilizar EN futuro.
- **Logs e auditoria.** Operações de escrita em `watchlist` e `watchlist_alertas_historico` logadas com timestamp e origem (UI, import, job).
- **Limites.** Sem limite rígido de itens, mas UI degrada gracefully com paginação virtual a partir de 100 itens.

---

## 5. Modelo de Dados

```sql
-- ============================================================
-- Migration: Watchlist de FIIs
-- ============================================================

-- Tabela principal de watchlist
CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL UNIQUE,
  adicionado_em TEXT NOT NULL DEFAULT (datetime('now')), -- ISO 8601 UTC
  nota TEXT,                                             -- nota livre do usuário (markdown simples)
  alerta_dy_threshold REAL,                              -- NULL = sem alerta
  alerta_dy_direcao TEXT NOT NULL DEFAULT 'acima'        -- 'acima' | 'abaixo'
    CHECK (alerta_dy_direcao IN ('acima','abaixo')),
  alerta_ativo INTEGER NOT NULL DEFAULT 1               -- soft toggle sem perder config
    CHECK (alerta_ativo IN (0,1)),
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ticker) REFERENCES ativos(ticker) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_watchlist_ticker ON watchlist(ticker);
CREATE INDEX IF NOT EXISTS idx_watchlist_alerta ON watchlist(alerta_ativo, alerta_dy_threshold)
  WHERE alerta_ativo = 1;

-- Histórico de alertas disparados (append-only)
CREATE TABLE IF NOT EXISTS watchlist_alertas_historico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watchlist_id INTEGER NOT NULL,
  ticker TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('DY_ACIMA','DY_ABAIXO')),
  dy_no_disparo REAL NOT NULL,
  threshold REAL NOT NULL,
  disparado_em TEXT NOT NULL DEFAULT (datetime('now')),
  lido INTEGER NOT NULL DEFAULT 0 CHECK (lido IN (0,1)),
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_walerts_watchlist ON watchlist_alertas_historico(watchlist_id, disparado_em DESC);
CREATE INDEX IF NOT EXISTS idx_walerts_nao_lidos ON watchlist_alertas_historico(lido, disparado_em DESC)
  WHERE lido = 0;

-- Trigger para manter atualizado_em sincronizado
CREATE TRIGGER IF NOT EXISTS trg_watchlist_updated
AFTER UPDATE ON watchlist
BEGIN
  UPDATE watchlist SET atualizado_em = datetime('now') WHERE id = NEW.id;
END;

-- View materializada (ou simples) com join em ativos para a UI
DROP VIEW IF EXISTS v_watchlist_indicadores;
CREATE VIEW v_watchlist_indicadores AS
SELECT
  w.id,
  w.ticker,
  a.preco_atual,
  a.dy_12m,
  a.p_vp,
  a.segmento,
  a.vacancia,
  w.adicionado_em,
  w.nota,
  w.alerta_dy_threshold,
  w.alerta_dy_direcao,
  w.alerta_ativo,
  CASE
    WHEN a.preco_atual IS NULL THEN NULL
    ELSE ROUND(((a.preco_atual - (
      SELECT preco_atual FROM ativos a2
      WHERE a2.ticker = w.ticker AND a2.atualizado_em IS NOT NULL
    )) / NULLIF(a.preco_atual, 0)) * 100, 2)
  END AS variacao_pct_desde_adicao
FROM watchlist w
LEFT JOIN ativos a ON a.ticker = w.ticker;
```

> **Nota:** a `variacao_pct_desde_adicao` da view é um esqueleto. A implementação correta persiste o preço do FII no momento da adição à Watchlist em uma tabela auxiliar `watchlist_preco_inicial (watchlist_id, preco, capturado_em)` para garantir cálculo determinístico. Caso decidido simplificar, basta usar `a.preco_atual` × aproximação — mas a precisão fica comprometida.

**Recomendação (implementação preferida):**

```sql
CREATE TABLE IF NOT EXISTS watchlist_preco_inicial (
  watchlist_id INTEGER PRIMARY KEY,
  preco_inicial REAL NOT NULL,
  capturado_em TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE
);
```

E popular automaticamente em um `AFTER INSERT ON watchlist` trigger que lê `ativos.preco_atual` na hora da inserção (ou NULL se FII nunca raspado).

---

## 6. APIs / Endpoints

| Método | Rota | Request Body / Query | Response 200 | Erros |
|---|---|---|---|---|
| GET | `/api/watchlist` | `?segmento=Logistico&amp;alerta=1&amp;ordenarPor=dy_12m&amp;ordem=desc` | `[{ id, ticker, adicionado_em, nota, preco_atual, dy_12m, p_vp, variacao_pct_desde_adicao, alerta_dy_threshold, alerta_dy_direcao, alerta_ativo }]` | 500 erro interno |
| GET | `/api/watchlist/:ticker` | — | `{ id, ticker, adicionado_em, nota, preco_inicial, preco_atual, dy_12m, segmento, alertas_historico: [...] }` | 404 não está na Watchlist |
| POST | `/api/watchlist` | `{ ticker: "HGLG11", nota?: "aguardar DY &lt; 10", alerta_dy_threshold?: 11.0, alerta_dy_direcao?: "acima" }` | `{ id, ticker, adicionado_em, alerta_ativo: true }` | 400 ticker inválido / 409 já existe |
| PATCH | `/api/watchlist/:ticker` | `{ nota?: "atualizado", alerta_dy_threshold?: 12.0, alerta_dy_direcao?: "abaixo", alerta_ativo?: false }` | item atualizado | 404 não existe / 400 payload inválido |
| DELETE | `/api/watchlist/:ticker` | — | `{ removed: true, ticker }` | 404 não existe |
| POST | `/api/watchlist/import` | `multipart/form-data` arquivo `.json` ou `body: { items: [...] }` | `{ imported: N, skipped: M }` | 400 JSON inválido / 422 schema inválido |
| GET | `/api/watchlist/export` | — | `Content-Type: application/json` com array completo | 500 |
| GET | `/api/watchlist/alertas/historico` | `?limit=50` | `[{ id, ticker, tipo, dy_no_disparo, threshold, disparado_em, lido }]` | 500 |
| POST | `/api/watchlist/alertas/marcar-lido/:id` | — | `{ ok: true }` | 404 |
| POST | `/api/watchlist/alertas/avaliar` | — (job interno, exposto para debug) | `{ avaliados: N, disparados: M }` | 500 |

**Convenções:**
- Todos retornos em JSON UTF-8.
- Erros no formato `{ error: { code: string, message: string, details?: object } }`.
- Códigos: `INVALID_TICKER`, `ALREADY_EXISTS`, `NOT_FOUND`, `BAD_PAYLOAD`, `INTERNAL`.

---

## 7. UI / UX

### Wireframes ASCII

**Frame 1 — Aba Watchlist (estado populated)**

```
+----------------------------------------------------------------------------+
| byeINSS   [Dashboard] [Posições] [Watchlist*] [Preço-teto] [Proventos] ... |
+----------------------------------------------------------------------------+
| Watchlist  (47 itens)                              [+ Adicionar] [Importar]|
| Filtros: [Segmento ▾] [Só com alerta ☑] [DY ≥ ___]   Ordenar por: [DY ▾] |
+----------------------------------------------------------------------------+
| ★ Ticker  | Segmento  | Preço    | Preço-teto | DY 12M | B&amp;H | Var.   | ⚑ |
| HGLG11    | Logístico | R$ 168,40| R$ 175,00  | 9,8%   | 6/7 | +1,2%  | ★ |
|           | nota: "esperar IPCA acima do teto"                          | ⓘ |
| XPML11    | Shopping  | R$ 105,10| R$ 110,00  | 10,4%  | 5/7 | -2,1%  | ★ |
|           | ⚠ alerta DY ≥ 10.5%                                         | ⓘ |
| VISC11    | Lajes Corp| R$ 109,80| —          | 9,2%   | 4/7 | +5,4%  | ★ |
| ...                                                                        |
+----------------------------------------------------------------------------+
| Legenda: ★ alerta ativo   ⓘ nota    [✏] editar   [🗑] remover                |
+----------------------------------------------------------------------------+
```

**Frame 2 — Modal "Adicionar à Watchlist"**

```
+------------------------------------------------------------+
| Adicionar à Watchlist                                  [X] |
+------------------------------------------------------------+
| Ticker: [ HGLG11    ]  (autocomplete dropdown)            |
|                                                            |
| Nota (opcional):                                           |
| [ Acompanhar para entrada se DY &gt; 10% e P/VP &lt; 0.95   ]    |
|                                                            |
| Alerta de DY (opcional):                                   |
| ☑ Ativar alerta                                           |
|   Notificar quando DY 12M for [acima ▾] de [ 11.0 ] %      |
|                                                            |
|                              [Cancelar]  [Adicionar ★]    |
+------------------------------------------------------------+
```

**Frame 3 — Estado vazio**

```
+----------------------------------------------------------------------------+
| Watchlist  (0 itens)                                                      |
+----------------------------------------------------------------------------+
|                                                                            |
|                          ☆ Nenhum FII na Watchlist ainda                    |
|                                                                            |
|     Adicione FIIs que você está estudando ou quer comprar quando           |
|     atingirem seu preço-teto ou DY desejado.                                |
|                                                                            |
|           [ + Adicionar FII ]   [ Ir para Análise Fundamentalista ]        |
|                                                                            |
+----------------------------------------------------------------------------+
```

**Frame 4 — Detalhe expandido (linha clicada)**

```
| XPML11    | Shopping  | R$ 105,10| R$ 110,00  | 10,4%  | 5/7 | -2,1%  | ★ |
|           | nota: "aguardando AGE março/2026 para definir entrada"        | ⓘ |
|           | alerta: DY ≥ 10.5% (último disparo: 2026-03-12 às 09:14)     | ↗ |
|           | preço inicial: R$ 107,35  | preço-teto: R$ 110,00            |   |
|           | abaixo do teto? SIM (4,5%)   | score B&amp;H detalhado:           |   |
|           |  ✓ tempo listado &gt; 5a                                       |   |
|           |  ✓ DY 5y ≥ 8%                                               |   |
|           |  ✓ liq ≥ 700k                                              |   |
|           |  ✗ cotistas &lt; 20k (atual: 12.340)                           |   |
|           |                                            [Editar] [Remover] |   |
```

### Estados (lista mestra)

| Estado | Critério | UI |
|---|---|---|
| **loading** | Aguardando GET inicial | Skeleton table (3 linhas) + spinner discreto |
| **empty** | `items.length === 0` e sem erro | Ilustração + CTA "Adicionar FII" |
| **error** | Fetch falhou | Banner vermelho com mensagem + botão "Tentar novamente" |
| **success** | `items.length &gt; 0` | Tabela completa |
| **partial-data** | Alguns FIIs nunca raspados | Linhas com badge "dados desatualizados" e tooltip |
| **alerta-disparado** | Item com `alertas_historico` não lido nos últimos 7 dias | Linha com borda esquerda amarela + ícone sino |

### Acessibilidade (a11y)

- Tabela com `&lt;table role="grid"&gt;`, headers com `aria-sort` quando ordenável.
- Chips de alerta com `role="status"` + `aria-live="polite"` quando o valor muda.
- Modal de adicionar com `role="dialog"`, `aria-modal="true"`, focus trap.
- Botões de ação (editar, remover) com `aria-label` explícito ("Editar XPML11").
- Contraste mínimo AA em todos os chips de status.
- Navegação completa por teclado: setas para navegar linhas, Enter para expandir, Esc para fechar modal/detalhe.

---

## 8. Casos de Borda

1. **Adicionar ticker que não existe no universo FII.** Front valida regex `^[A-Z]{4}\d{2}$` antes de submeter; back valida contra lista conhecida de FIIs. Se inválido, retorna 400 `INVALID_TICKER` com mensagem clara.
2. **Adicionar ticker que está na carteira (já tem posição).** Permitido, mas com aviso visual "Você já tem posição em XXX". Justificativa: usuário pode querer comparar FIIs que já possui com alternativas.
3. **Re-adicionar ticker removido.** DELETE remove a linha; re-adicionar é INSERT novo (id novo, `adicionado_em` resetado). Histórico de alertas antigos fica acessível via `ticker` mesmo sem `watchlist_id` (FK cascade é proposital só para itens ativos).
4. **FII nunca raspado (sem dados em `ativos`).** Linha renderiza com todos os indicadores como "—". Adicionar à Watchlist não dispara scrape automático; usuário precisa atualizar manualmente (botão "Atualizar dados").
5. **DY threshold definido antes do FII ter `dy_12m` populado.** Job de alertas pula o item com log `INFO skipped: ticker sem dy_12m`. Quando o scraper popular, próxima execução avalia.
6. **Job de alertas roda com app recém-aberto e muitos itens disparam.** Rate limit: máximo 5 notificações por minuto. Demais são enfileiradas em `watchlist_alertas_historico` e exibidas como "ver histórico" sem notificação nativa.
7. **Threshold editado após alerta já ter disparado.** Não dispara novamente a menos que o DY cruze de volta o threshold (histerese de 0.2pp para evitar spam).
8. **Nota com mais de 2000 caracteres.** Limite no DB (`CHECK (length(nota) &lt;= 2000)`). UI mostra contador.
9. **Import de JSON com tickers duplicados no array.** Backend deduplica e pula os repetidos, retornando `{ imported: N, skipped: M, duplicates: [...] }`.
10. **Import de JSON de versão futura (campos desconhecidos).** Aceita e ignora campos extras; nunca falha por "schema desconhecido".
11. **Remoção do FII da watchlist enquanto modal de edição está aberto.** UI deve detectar 404 ao PATCH e fechar modal com toast "Item removido".
12. **Job de alertas e edição simultânea do threshold.** Operações serializadas via lock de linha no SQLite; em caso de conflito, segunda escrita vence e log `WARN race condition on watchlist:ID`.
13. **Sincronização com preço-teto.** Se usuário apaga o preço-teto de um ticker, item da Watchlist mostra "—" na coluna, sem erro.
14. **Backup/restore do SQLite.** Watchlist deve sobreviver a backup-and-restore íntegro (testado em CI). Migration é idempotente — rodar `init.sql` em DB com tabelas já existentes não corrompe.

---

## 9. Dependências

Features e infraestrutura que precisam estar prontas **antes** ou **em paralelo**:

- **Tabela `ativos` completa com colunas de enriquecimento** (feature 2.2 do roadmap: `dy_12m`, `p_vp`, `segmento`, `vacancia`, `preco_atual`, `dy_medio_5a`, `liquidez_diaria`, `numero_cotistas`).
- **Score Buy &amp; Hold calculável** (feature 2.5): exposto como endpoint ou função pura importável do back.
- **Preço-teto por ticker** (já existe como feature — só precisa estar consistentemente exposto por endpoint, ex: `/api/preco-teto/:ticker`).
- **Scraper capaz de atualizar cotação de FII sob demanda** (botão "Atualizar dados" na linha).
- **Sistema de notificações nativas do Electron** já configurado (ou wrapper leve sobre `new Notification`).
- **Job scheduler em background** (pode ser um `setInterval` no main process do Electron ou um `node-cron` se já estiver no projeto).

**Dependências desejáveis (não bloqueantes):**
- Score B&amp;H (2.5) — se ainda não estiver, mostrar coluna como "—" e tooltip.
- DY 5y médio (2.2) — variação desde adição já funciona sem.

---

## 10. Esforço Estimado

**Total: 4–5 dias úteis para um dev full-stack familiarizado com o codebase.**

| Área | Dias | Detalhes |
|---|---|---|
| Schema + migrations | 0.5 | DDL (3 tabelas + 1 view + 2 triggers + índices), idempotência, teste de migration em DB limpo e DB versionado. |
| Backend (rotas + service) | 1.0 | CRUD + import/export + endpoint de alertas disparados; validação com `zod` ou `joi`; testes unitários do service. |
| Job de alertas | 0.5 | Job em background (6h), rate limit, histerese, logs, hook de notificação nativa. |
| UI — tabela principal | 1.0 | Render, filtros, ordenação, modal de add/edit, estado empty/loading/error, a11y. |
| UI — detalhe expandido + indicador "abaixo do teto" | 0.5 | Linha expansível com score B&amp;H detalhado, preço inicial vs atual. |
| Import / Export JSON | 0.5 | Upload, validação de schema, feedback de duplicados; download com nome `watchlist-YYYYMMDD.json`. |
| QA manual + ajustes | 0.5 | Smoke tests dos fluxos críticos, ajuste de estados de borda, polish visual. |

**Sem dependência do Import do I10** (RF-008). Se incluído, +1 dia para autenticação e parsing da página de favoritos do I10.

---

## 11. Riscos &amp; Mitigações

1. **Risco: Scraper do I10 quebrar a tabela inteira.** Se `ativos.preco_atual` estiver NULL para muitos tickers, a Watchlist renderiza majoritariamente "—", frustrando a UX.
   - **Mitigação:** Badges explícitos "dados desatualizados" + botão "Atualizar agora" por linha. Feature degrada gracefully — a nota livre e o ticker sempre aparecem.

2. **Risco: Alertas virem spam.** Threshold mal calibrado pode disparar a cada scrape.
   - **Mitigação:** Histerese de 0.2pp (só re-dispara se DY cruzar de volta o threshold); rate limit de 5 notificações/minuto; flag `alerta_ativo` que usuário pode desligar sem perder config.

3. **Risco: Schema novo conflitar com futuro import em massa.** Se um dia decidirmos sincronizar Watchlist com outro app, schema tem que ser extensível.
   - **Mitigação:** Campos opcionais (NULL permitido) para tudo exceto chaves; JSON de import tolerante a campos extras.

4. **Risco: Tabela crescer indefinidamente sem purga.** Usuário pode acumular dezenas de FIIs antigos sem limpeza.
   - **Mitigação:** Não implementar auto-purge no MVP. Adicionar (em v1.1) sugestão suave "FII na Watchlist há &gt; 180 dias sem alteração — ainda relevante?" como banner dismissível.

5. **Risco: Job de alertas drenar CPU/IO em DBs grandes.** Com Watchlist &gt; 500 itens e scrape simultâneo, pode competir com outras features.
   - **Mitigação:** Job roda a cada 6h (não em tempo real); execução em série (sem paralelismo); possibilidade futura de mover para worker thread dedicada.

---

## 12. Out of Scope

Para manter o escopo do MVP focado e entregável em ~5 dias, ficam **fora** desta versão:

- ❌ Sincronização cloud / multi-device (a Watchlist é estritamente local-first; sync opcional fica para v1.1+).
- ❌ Alertas por **e-mail**, **Telegram**, **push mobile** ou **webhook**. Apenas notificação nativa do Electron enquanto o app estiver aberto.
- ❌ Múltiplas watchlists por usuário (ex: "Dividendos altos", "Tijolo shoppings"). Apenas uma watchlist no MVP.
- ❌ Alertas além de DY: preço-teto cruzado, variação diária &gt; X%, novo dividendo histórico. Esses ficam para v1.1 com a tabela `watchlist_alertas` extensível.
- ❌ Compartilhamento social de watchlists (exportar via link público). Apenas export/import JSON local.
- ❌ Tags ou pastas customizadas. Apenas a nota livre (texto) serve como pseudo-tag.
- ❌ Recomendações automáticas de FIIs para adicionar (ex: "FIIs do segmento X com DY alto que você não tem"). Fica para a feature de Análise Fundamentalista (2.5).
- ❌ Integração nativa com a API do Investidor10 para puxar watchlist do usuário logado lá (RF-008 fica como nice-to-have de v1.1).
- ❌ Versão mobile / web. App Electron desktop apenas.
- ❌ Notificações sonoras customizadas ou badges no dock com contador de alertas não lidos. Apenas notificação padrão do SO.
