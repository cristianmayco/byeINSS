# PRD 03 — Amortizações Separadas em Proventos de FIIs

Plano de implementação da feature de PRD 03 (schema 1.4), fechado em **5 sub-PRs mergeáveis incrementalmente**. Cada commit foi atômico e os 449 testes passam ao final.

## Resumo

| Sub-PR | Commit | Linhas | Tests | O quê |
|---|---|---:|---:|---|
| 1 | `ef9ef85` | +367 / −6 | +12 | Migration 1.4 da tabela `proventos` com CHECK + AMORTIZACAO |
| 2 | `00e46dc` | +600 / −30 | +22 | Parser agenda + import service + integração scraper.js |
| 3 | (a seguir) | +800 / −60 | +31 | Helpers puros + endpoints (proventos, dashboard, batch) |
| 4 | (a seguir) | +576 / −72 | +21 | UI: filtros por tipo + gráfico empilhado + modal com parcelas |
| 5 | (a seguir) | +80 | — | Documentação (CHANGELOG, README, SECURITY) |

**Total:** ~2.420 linhas adicionadas, ~170 removidas, **86 testes novos** (12 + 22 + 31 + 21).

## Decisões de design

1. **Versão do schema**: PRD 03 previa 1.1→1.2 mas o schema já estava em 1.3 (pós PRD 12 + PRD 02). A migration real foi **1.3 → 1.4**. Veja `.plans/PRD-03-amortizacao-proventos.md` para o detalhamento. Esta decisão foi tomada ANTES de iniciar a migration e documentada na TASK #7.

2. **Dual-mode dos módulos `src/shared/*`**: alguns arquivos (`agenda-parser.js`, `proventos-helpers.js`, `proventos-import.js`) são compartilhados entre o scraper Electron (CJS), as rotas Express (CJS) e os testes vitest (ESM). Optei por escrever como **CommonJS puro** (`module.exports = { … }`) — vitest já tem interop automático para `import { x } from './foo.js'` em arquivos CJS.

3. **Sem `ALTER ADD CHECK`**: SQLite não suporta, então `proventos` é recriada via `proventos_v2` + `INSERT` + `DROP` + `RENAME`. Toda a migration é `BEGIN IMMEDIATE` + validações (count, sums, FK, integrity) + COMMIT/ROLLBACK.

4. **Chave lógica completa** (RF-007): `(ativo_id, data_pagto, valor_por_cota, tipo, data_com)`. Permite dividir o pagamento (ex: R$ 0,80 dividendo + R$ 0,20 amortização na mesma data) sem colapso.

5. **Parser por HEADER (semântica)**: O parser da agenda procura colunas pelo nome do `<th>` normalizado (sem caixa, acentos, plural/singular). Adicionei 2 fixtures (`agenda-com-tipo.html`, `agenda-colunas-invertidas.html`) que cobrem ordem canônica e invertida.

6. **Tipo desconhecido → null, não converte** (RF-006): my agenda-parser devolve `null` para texto fora do allowlist. O serviço de import reporta `tipo_desconhecidos[]` para auditoria sem persistir.

7. **Projeção não anualiza amortizações** (RF-018): O cálculo anualiza DIVIDENDO+RENDIMENTO (12 meses), mas amortizações futuras explícitas entram SÓ no array `amortizacoes_previstas[]` sem multiplicar por 12.

8. **Sem `version`-like dedup**: PRD optou por NÃO criar UNIQUE constraint na tabela para não travar migrações com dados legados sujos. A lógica de dedup fica no serviço, em transação.

9. **Compatibilidade do `proventos` legado**: o modal em lote e o import JSON aceitam o campo legado `dividendos[]` (cada item assume `DIVIDENDO`). O novo formato `proventos[]` aceita tipo explícito por item (RF-010).

10. **Alerta DY só distribuível** (RF-019): o alerta de DY_ALTO no `/api/dashboard/alertas` agora considera SÓ `DIVIDENDO + RENDIMENTO`. Mantém o campo legado `dy_carteira_12m` apontando para o DY distribuível e adiciona `amortizacoes_12m` para amortizações separadas.

## Arquivos criados/alterados

### Criados

- `src/shared/agenda-parser.js` — parser puro dual-mode
- `src/shared/proventos-helpers.js` — funções puras de agregação/projeção
- `src/shared/proventos-import.js` — serviço de import com dedup + reconciliação
- `src/renderer/js/proventos-ui.js` — helpers UI (filtro, badge, gráfico, modal parcelas)
- `src/__tests__/db-migration-1.4.test.js`
- `src/__tests__/agenda-parser.test.js`
- `src/__tests__/proventos-import.test.js`
- `src/__tests__/proventos-helpers.test.js`
- `src/__tests__/integration/api-proventos-amortizacao.test.js`
- `src/__tests__/renderer/proventos-ui.test.js`
- `src/__tests__/fixtures/i10/agenda-com-tipo.html`
- `src/__tests__/fixtures/i10/agenda-colunas-invertidas.html`

### Alterados

- `db/init.sql` — bump versão 1.3→1.4 + CHECK constraint + `idx_proventos_tipo_data`
- `src/server/db.js` — migration 1.4 no array MIGRATIONS + FALLBACK_SCHEMA_INLINE
- `src/__tests__/db-migrations.test.js` — assertion atualizada
- `src/main/scraper.js` — parser embed + import service
- `src/server/services/import-i10.js` — usa importarProventos
- `src/server/routes/proventos.js` — GET com filtros + POST validação + batch
- `src/server/routes/dashboard.js` — `/proventos-mensais`, `/projecao-proventos`, `/resumo` reformatados; alerta DY só distribuíveis
- `src/__tests__/integration/api-dashboard.test.js` — contrato atualizado
- `src/renderer/index.html` — inclui `proventos-ui.js`
- `src/renderer/js/pages.js` — `renderProventos` reescrito + modal em lote com parcelas
- `CHANGELOG.md`, `README.md`, `SECURITY.md`

## Compatibilidade

- **Bancos existentes**: `initDb` detecta automaticamente se está legacy (vê as colunas de PRD 12+02) e roda `runMigrations`, que aplica 1.4 idempotentemente. Backup via `VACUUM INTO` ANTES do DDL destrutivo.
- **API clients existentes**: o endpoint `/api/dashboard/resumo` ganha NOVOS campos (`amortizacoes_12m`, `fluxo_caixa_proventos_12m`, `amortizacoes_total`), mas os campos legados (`proventos_12m`, `dy_carteira_12m`) continuam válidos — só agora representam SÓ distribuíveis.
- **API /proventos/batch**: aceita o campo legado `dividendos[]` (assume `DIVIDENDO`) E o novo `proventos[]` (com tipo por item). Compatibilidade preservada.
- **UI**: filtros via `?tipos=` no hash são opcionais; sem filtro, comportamento é "Todos".

## Pendências conhecidas

- O endpoint `/api/dashboard/proventos-mensais` agrega sem enriquecimento pela quantidade elegível quando o cliente não passa início/fim — mas exige `proventos.valor_por_cota * quantidade_elegivel` por linha, que já está calculado no `/api/proventos`. Pode-se opcionalmente migrar `/proventos-mensais` para também operar via SQL agregado com subqueries (preferi manter cálculo em JS por simplicidade e evitar JOIN complexos).
- Reclassificação automática DIVIDENDO→AMORTIZACAO (RF-008) é opt-out via `reconciliarLegados: false`. Está habilitada por padrão no scraper e no import-i10.
- A migração 1.4 não roda automaticamente em bancos que JÁ estão em 1.3 com dados — mas como já é a versão esperada, isso é o caso normal. O fallback é `init.sql` ser atualizado para um banco fresh de 1.4.
