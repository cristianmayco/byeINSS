# PRD: Vencimento Médio de Contratos + Tipo de Reajuste (FIIs)

## 1. Visão Geral

### Resumo
FIIs de Tijolo dependem de contratos de aluguel com prazos e índices de reajuste. Quando o vencimento médio dos contratos está próximo, o fundo fica exposto a pressões de renegociação (aluguel menor, vacância maior, troca de inquilino). Capturar o vencimento médio e o tipo de reajuste por FII — exibindo isso na página de detalhe e emitindo um alerta quando o vencimento cai abaixo de 24 meses — dá ao investidor uma leitura antecipada de risco operacional que hoje está dispersa (quando aparece) nos "Comunicados" do I10.

### 3 problemas que resolve
1. **Risco de vencimento invisível.** Hoje a tela de detalhe do FII não mostra quando os contratos vencem em média. Um FII com vencimento médio de 18 meses pode virar problema sério em 2027–2028 sem nenhum sinal no app.
2. **Mix de reajuste opaco.** IGP-M, IPCA e fixo X% são tratamentos muito diferentes sob inflação volátil. Sem saber a composição do reajuste, o investidor não consegue modelar receita futura em cenários de estresse (ex.: deflação derruba receita de IGP-M).
3. **Ausência de sinal proativo.** Não existe nenhum alerta no app que diga "este fundo está com pressão de vencimento se aproximando". O dado precisa ser puxado pelo investidor manualmente, indo ao site do fundo ou ao I10.

### Personas e casos de uso
- **Maria (cliente renda-passiva, holding 5+ anos).** Quer saber se seus FIIs de Tijolo têm risco de revisão de aluguel nos próximos 24 meses para decidir aportes ou saídas. Caso de uso: "Abrir o app, ver dashboard, ver 3 FIIs com badge amarelo de vencimento, clicar em 1, ler detalhes."
- **Carlos (cliente tático, screen across 30+ FIIs).** Quer triar candidatos por risco contratual antes de comprar. Caso de uso: "Comparar KNIP11 vs HGLG11 vencimento médio + tipo de reajuste antes de simular uma compra."
- **Ana (analista FIRE).** Projeta renda passiva futura ajustada pela inflação; precisa saber o índice de reajuste para alimentar o cenário "aluguel acima da inflação" vs "aluguel abaixo da inflação".

---

## 2. Objetivos &amp; Métricas de Sucesso

### 3-5 objetivos mensuráveis
1. Capturar e persistir vencimento médio de contratos + tipo de reajuste para ≥ 70% dos FIIs de Tijolo da carteira do usuário na primeira execução do scraper, e ≥ 90% após 3 rodadas de re-scraping.
2. Emitir alerta automático em qualquer FII da carteira com vencimento médio &lt; 24 meses (ou sem vencimento parseável, após fallback), exibido no Dashboard e na página de detalhe.
3. Exibir bloco "Contratos &amp; Reajuste" na página de detalhe do FII com data/meses de vencimento médio, tipo de reajuste e tooltip explicando o significado.
4. Garantir que o scraping desta feature não cause mais de +20% no tempo total de atualização do fundo (orçamento: +500ms por FII).
5. Tratar 100% dos casos de borda mapeados no item 8 sem crash e sem "—" sem explicação.

### KPIs
- **Cobertura:** % de FIIs com `vencimento_medio_contratos` e `tipo_reajuste` preenchidos.
- **Acurácia:** % de FIIs cuja informação persistida confere com a fonte (verificação manual de 10 amostras por release).
- **Latência do scraper:** ms adicionais por FII introduzidos por esta feature.
- **Engagement:** % de usuários que clicam no alerta e chegam na página de detalhe (proxy: telemetria de hash).
- **Alertas acionados:** contagem absoluta de alertas "vencimento &lt; 24m" ativos por mês.

---

## 3. Requisitos Funcionais

- **RF-001. Coleta do vencimento médio de contratos.** O scraper deve tentar extrair, da página `/fiis/{ticker}/` do I10 (e, em fallback, da página "Comunicados" mais recente), uma data média de vencimento de contratos ou um valor em meses. O resultado deve ser persistido em `ativos.vencimento_medio_contratos` como coluna DATE (data ISO) ou em coluna auxiliar `vencimento_medio_contratos_meses` (INTEGER) quando só houver a forma numérica.
- **RF-002. Coleta do tipo de reajuste.** O scraper deve extrair o índice de reajuste contratual (IGPM, IPCA, Fixo X% ou outro) na mesma página e na seção "Sobre"; persistir em `ativos.tipo_reajuste` como TEXT livre controlado (enum-like na aplicação).
- **RF-003. Alerta quando vencimento &lt; 24 meses.** Após cada atualização de um FII da carteira, o backend deve comparar `vencimento_medio_meses &lt; 24` (ou, quando há data, `data_venc − hoje &lt; 730 dias`) e marcar o FII como `alerta_vencimento = 1`, gerando badge visual e entrada no Dashboard.
- **RF-004. Bloco UI "Contratos &amp; Reajuste".** A página de detalhe do FII deve exibir um bloco novo com: vencimento médio (em meses e/ou data), tipo de reajuste (chip colorido), último valor parseado e timestamp da coleta.
- **RF-005. Estados explícitos.** Quando o scraper não conseguir extrair o dado, o bloco deve exibir estado vazio com mensagem "Informação não disponível no momento" e link "Re-tentar coleta". Não deve mostrar dado inventado.
- **RF-006. Override manual.** O usuário poderá editar manualmente `vencimento_medio_contratos` e `tipo_reajuste` em um modal da página de detalhe; a edição manual desativa o scraping automático para esses campos naquele ticker (flag `manual_override`).
- **RF-007. Re-scraping resiliente.** Caso a página do I10 mude de layout (situações já mapeadas: aparece em Comunicados OU na página individual), o scraper deve tentar múltiplos seletores antes de retornar `null`, com `console.warn` caso todas as tentativas falhem.
- **RF-008. Log de tentativas.** Toda execução do scraper para estes campos deve gerar entrada em log estruturado `{ticker, success, source: 'main'|'comunicado'|'fallback', ts}` para diagnóstico.

---

## 4. Requisitos Não-Funcionais

- **Performance.** Scraping desta feature em um FII não deve adicionar mais de 500ms ao tempo total. Aceita-se timeout duro de 3s por FII; após isso, marca `null` e segue.
- **Privacidade.** Todos os dados são derivados de fonte pública (I10). Nada de scraping autenticado, nada de dados pessoais de inquilinos; apenas agregados (m², contagem, média). Compliance: respeitar `robots.txt` do I10 e não exceder 1 req/s.
- **Compatibilidade.** Deve rodar no Electron local sem dependência nova de backend externo; o schema persiste no SQLite já existente.
- **Resiliência.** Falha no scraping de um FII não pode quebrar o batch. Erro → log + null + segue.
- **Determinismo da UI.** Mesmo dado bruto deve renderizar o mesmo bloco (sem timestamps aleatórios no DOM que quebrem testes).
- **Internacionalização.** Toda string visível no bloco deve estar em português BR; valores em meses/anos calculados a partir de data ISO.
- **Testabilidade.** Lógica de parsing isolada em funções puras com fixtures HTML para regressão.

---

## 5. Modelo de Dados

```sql
-- Migration 2.12.a — vencimento médio
ALTER TABLE ativos ADD COLUMN vencimento_medio_contratos DATE;
ALTER TABLE ativos ADD COLUMN vencimento_medio_contratos_meses INTEGER;
ALTER TABLE ativos ADD COLUMN tipo_reajuste TEXT;          -- 'IGPM' | 'IPCA' | 'FIXO' | 'OUTRO' | 'MISTO'
ALTER TABLE ativos ADD COLUMN reajuste_percentual REAL;   -- quando FIXO X%, guarda o X
ALTER TABLE ativos ADD COLUMN vencimento_medio_origem TEXT;  -- 'main' | 'comunicado' | 'manual'
ALTER TABLE ativos ADD COLUMN vencimento_medio_coletado_em TEXT;
ALTER TABLE ativos ADD COLUMN alerta_vencimento INTEGER DEFAULT 0;

-- Migration 2.12.b — histórico de tentativas do scraper (audit)
CREATE TABLE IF NOT EXISTS fii_scraper_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  campo TEXT NOT NULL,                 -- 'vencimento_medio_contratos' | 'tipo_reajuste'
  sucesso INTEGER NOT NULL,
  origem TEXT,                         -- 'main' | 'comunicado' | 'manual'
  erro TEXT,
  ts TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (ticker) REFERENCES ativos(ticker)
);

CREATE INDEX IF NOT EXISTS idx_scraper_log_ticker ON fii_scraper_log(ticker, ts);
CREATE INDEX IF NOT EXISTS idx_ativos_alerta_venc ON ativos(alerta_vencimento) WHERE alerta_vencimento = 1;
```

**Regras de coerência:**
- Pelo menos uma das colunas `vencimento_medio_contratos` (DATE) ou `vencimento_medio_contratos_meses` (INTEGER) deve ser preenchida; não podem ambas ser preenchidas de fontes divergentes sem flag.
- `tipo_reajuste = 'FIXO'` obriga `reajuste_percentual` não-nulo.
- `vencimento_medio_origem = 'manual'` impede sobrescrita por scraping futuro.

---

## 6. APIs / Endpoints

| Método | Rota | Request | Response | Erros |
|---|---|---|---|---|
| GET | `/api/fiis/contratos/:ticker` | path: `ticker` | `{ ticker, vencimento_medio_contratos, vencimento_medio_contratos_meses, tipo_reajuste, reajuste_percentual, origem, coletado_em, alerta_vencimento, meses_ate_vencimento }` | 404 se ticker inexistente |
| PUT | `/api/fiis/contratos/:ticker` | `{ vencimento_medio_contratos?, vencimento_medio_contratos_meses?, tipo_reajuste?, reajuste_percentual? }` | 200 com o objeto atualizado, marca `origem='manual'` | 400 se data e meses conflitantes; 422 se `tipo_reajuste='FIXO'` sem percentual |
| POST | `/api/fiis/scraper/contratos/resync` | `{ tickers?: string[] }` (omitido = todos) | `{ started_at, attempted, succeeded, failed }` | 503 se já há resync em andamento |
| GET | `/api/dashboard/alertas-vencimento` | — | `{ total, itens: [{ticker, meses, tipo_reajuste, snapshot_em}] }` | — |

Erros padrão: 400 (validação), 404 (ticker não existe em `ativos`), 422 (entrada semanticamente errada), 500 (erro inesperado).

---

## 7. UI / UX

### Wireframes ASCII

**Frame 1 — Dashboard com alerta global**
```
+----------------------------------------------------------+
| byeINSS — Dashboard                                      |
+----------------------------------------------------------+
| ATENCAO: 3 FIIs com vencimento de contratos &lt; 24m         |
|   HGLG11 - 18m (IGPM)  ver    KNIP11 - 14m (Fixo 3%)  ver|
|   BTLG11 - 22m (IPCA)  ver                                |
+----------------------------------------------------------+
| Posicoes  |  Carteira  |  Proventos  |  Cenarios ...     |
+----------------------------------------------------------+
```

**Frame 2 — Página de detalhe do FII, bloco novo no sidebar**
```
+----------------------------------------------------------+
| HGLG11 — Cotas: 100 — Preco: R$ 165,40                  |
+---------------------------------+------------------------+
| ... graficos e tabelas ...      | CONTRATOS &amp; REAJUSTE   |
|                                 |                        |
|                                 | Vencimento medio       |
|                                 |  2027-01-15  (~18m)    |
|                                 |  [chip alerta amarelo] |
|                                 |                        |
|                                 | Indice de reajuste     |
|                                 |  [chip IGP-M]          |
|                                 |                        |
|                                 | Coletado: 18/07/26     |
|                                 | Origem: main page      |
|                                 | [Editar] [Re-tentar]   |
+---------------------------------+------------------------+
```

**Frame 3 — Estado vazio**
```
| CONTRATOS &amp; REAJUSTE                                      |
| Informacao nao disponivel no momento.                     |
| O I10 nem sempre publica este dado.                       |
| [Re-tentar coleta]                                       |
```

**Frame 4 — Modal de edição manual**
```
+--------------------------------------------+
| Editar dados de contratos              [x] |
+--------------------------------------------+
| Vencimento medio:                         |
| [data    ] OU [meses: __]                  |
| Tipo de reajuste: ( ) IGPM ( ) IPCA       |
|                  ( ) Fixo: [___] %         |
| ( ) Outro: [____________________]          |
|                                            |
| [Cancelar]                  [Salvar]      |
+--------------------------------------------+
```

### Estados
- **Loading:** spinner dentro do bloco enquanto o endpoint retorna.
- **Success (com alerta):** bloco com chip amarelo/vermelho, vencimento + tipo de reajuste.
- **Success (sem alerta):** bloco neutro, vencimento &gt; 24m.
- **Empty (sem dado parseado):** mensagem "Informação não disponível no momento" + botão "Re-tentar coleta".
- **Empty (FII de Papel/Desenvolvimento/FI-Infra):** bloco oculto ou exibido como "Não aplicável (fundo de Papel)".
- **Error (timeout scraper):** ícone de aviso + "Última coleta falhou em DATA — re-tentar".
- **Override manual ativo:** badge "Editado manualmente" no canto do bloco.

### Acessibilidade (a11y)
- Bloco deve ter `role="region"` e `aria-label="Vencimento médio de contratos e tipo de reajuste"`.
- Alerta do Dashboard deve usar `role="alert"` e `aria-live="polite"` para leitores de tela.
- Chips devem ter `aria-label` descritivo (ex.: "Alerta amarelo: vencimento em 18 meses").
- Modal de edição manual: trap de foco, fechamento por Esc, labels explícitos para inputs.
- Contraste mínimo AA em todos os chips.

---

## 8. Casos de Borda

1. **FII listado há menos de 6 meses.** Pode ainda não ter portefeuille estabilizado nem Comunicado com cronograma. Mostrar empty state, não inventar.
2. **FII de Papel / FI-Infra / Desenvolvimento / Híbrido.** Conceitualmente "vencimento de contratos" não se aplica. Bloquear bloco ou exibir "Não aplicável (fundo de X)".
3. **Vencimento em meses sem data.** Aceitar INTEGER e renderizar "≈ 18 meses" sem calcular data futura.
4. **Vencimento em data passada (contratos já venceram).** Tratar como dado inconsistente, re-tentar scrape; se persistir, exibir "Vencimento em data passada — revisar manualmente".
5. **Tipo de reajuste "Misto" (parte IGP-M, parte IPCA).** Permitir valor textual `MISTO` no campo `tipo_reajuste` e tooltip "Combinação de índices — ver relatório".
6. **Tipo de reajuste "Outro" (ex.: INPC, IPC-FIPE).** Persistir como `OUTRO` e exibir texto livre capturado do I10.
7. **Página do I10 mudou de layout (selectors invalidados).** Pipeline deve tentar 3+ seletores em ordem e logar `success=false` se todos falharem. Backend deve devolver dado antigo (último coletado) e exibir toast "Coleta pode estar desatualizada".
8. **Dois Comunicados com números divergentes no mesmo mês.** Preferir o Comunicado com data mais recente; persistir qual origem em `vencimento_medio_origem`.
9. **Override manual + scraping que retornaria valor diferente.** Não sobrescrever; flag `origem='manual'` e log.
10. **Multi-tenant de Carteira Compartilhada.** Caso entre em v2 (leitura compartilhada): versões distintas do mesmo FII em carteiras diferentes devem enxergar o mesmo dado persistido.

---

## 9. Dependências

- **Schema atual de `ativos` precisa ser migrável** (presumido já possível; migration é aditiva, não destrutiva).
- **`extractFIIDetalhes` precisa existir e estar estável** (`src/main/scraper.js`); esta feature adiciona novos ramos de parsing.
- **Endpoint GET `/api/ativos/:ticker`** (presumido existente) precisa incluir os campos novos no payload, ou um endpoint específico `/api/fiis/contratos/:ticker` deve ser criado.
- **Renderer da página de detalhe de FII** precisa ter ponto de injeção (sidebar ou nova seção) — sem isso a feature existe mas o usuário não vê nada.
- **Sistema de alertas (Dashboard)** precisa suportar nova fonte de alerta sem refatoração; ou será criado um card lateral no MVP.
- **Item 2.2 (campos `tipo_detalhe` e `segmento_detalhe`)** ajuda a classificar FIIs como Tijolo para exibir o bloco, mas não é dependência bloqueante — pode-se usar `segmento` atual como proxy inicial.

---

## 10. Esforço Estimado

| Área | Dias | Notas |
|---|---|---|
| Schema (migration 2.12.a + 2.12.b + testes) | 0.5 | Idempotente, testável em SQLite |
| Scraper: tentativa em página principal | 1.0 | DOM heuristics + 3+ seletores + fallback Comunicado |
| Scraper: fallback Comunicados | 0.5 | Heurística frágil — múltiplas tentativas |
| Backend: endpoints `/api/fiis/contratos/*` | 0.5 | CRUD + validação 422 |
| Backend: pipeline de alerta (≤24m) | 0.3 | SELECT + UPSERT `alerta_vencimento` |
| UI: bloco "Contratos &amp; Reajuste" | 0.8 | Render, estados, badges |
| UI: alerta no Dashboard | 0.3 | Novo card-lateral |
| UI: modal de edição manual | 0.5 | Form, validação cliente |
| Testes (unit + fixtures DOM + E2E) | 1.0 | Cobertura de 10 RFs |
| QA manual + tuning de seletores | 0.5 | 10 FIIs de Tijolo da carteira |
| **Total** | **~6.0 dias** | ~1.2 semanas corridas com folga |

---

## 11. Riscos &amp; Mitigações

1. **Instabilidade do DOM do I10 (seletores quebram a cada release do site).** Mitigação: pipeline com múltiplos seletores + tabela `fii_scraper_log` para detectar regressões, monitor de health-check semanal, e flag `manual_override` para o usuário corrigir.
2. **Cobertura baixa inicial (muitos FIIs sem Comunicado público).** Mitigação: aceitar valor parcial (só tipo de reajuste, ou só vencimento) e mostrar os dois campos independentemente; empty state explícito.
3. **Falsos positivos em alertas (fundo "jovem" com vencimento curto é normal).** Mitigação: tooltip da alerta explica contexto + sugerir combinar com `num_imoveis` e `vacancia`; não bloquear ação do usuário.
4. **Tempo adicional de scraping agride o orçamento total.** Mitigação: cache local de último parse por 7 dias; scraping seletivo nas atualizações automáticas, completo apenas sob demanda (`resync`).
5. **Conflito entre dado manual e dado scrapeado.** Mitigação: flag `manual_override` forte, com log de tentativas de scraping nesse ticker exibido no UI.

---

## 12. Out of Scope

- Análise contratual por **ativo individual** (caixa 1, caixa 2, endereço, inquilino por inquilino). Fora do escopo — só agregado médio.
- Alerta automático de **vacância crescente** combinado com vencimento curto (sinal composto). Pode ser v2.
- **Simulador de receita futura** ajustada por índice (IGP-M vs IPCA vs fixo). Pode ser v2; hoje o dado só alimenta a tabela.
- **Histórico de vencimentos ao longo do tempo** (snapshots mensais). Pode entrar em "Histórico de dividendos" do item 2.1.
- Suporte a **CRIs, CRAs e outras categorias** além de FIIs.
- **Notificação push ou e-mail.** Apenas in-app no MVP. Sem integração com sistema operacional.
- **Integração com fontes alternativas** (Funds Explorer, Status Invest). Apenas I10 no MVP.
- **Análise comparativa** "este fundo vence antes vs peers do mesmo segmento" — fora do MVP, pode ser v2.
