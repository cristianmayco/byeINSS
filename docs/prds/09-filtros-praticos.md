# PRD: Faceted Filters nas Tabelas de Posições e Preço-teto

## 1. Visão Geral

**Resumo.** Este PRD detalha a implementação de filtros facetados (faceted search) nas duas tabelas centrais do byeINSS para o investidor FII: **Posições** (carteira atual) e **Preço-teto** (oportunidades de compra). Hoje ambas exibem todos os FIIs sem nenhum recorte, obrigando o investidor a varrer manualmente linhas que não interessam — algo que se torna inviável a partir de ~30 FIIs listados. A solução entrega uma barra de filtros combináveis (chips toggleáveis) acima de cada tabela, cobrindo os recortes clássicos do investidor pessoa-física em FIIs: tipo (Tijolo/Papel/Misto/FI-Infra/Desenvolvimento), liquidez diária, vacância, DY, P/VP, número de cotistas e segmento. O estado dos filtros é serializado no hash da URL, garantindo que um link possa ser compartilhado, bookmarkado e sobreviva ao refresh do Electron sem precisar de backend.

**3 problemas que resolve.**
1. **Saturação visual da tabela** — Posições e Preço-teto hoje misturam FIIs de Tijolo com FI-Infra, líquidos com ilíquidos, alta vacância com baixa. O investidor perde tempo rolando a lista procurando os FIIs que importam para sua tese.
2. **Análise ad-hoc repetitiva** — sem filtros, o usuário não consegue responder perguntas simples do tipo "quais FIIs da minha carteira têm DY entre 8% e 12% E vacância &lt; 10%?" sem montar manualmente uma planilha à parte.
3. **Compartilhamento de teses** — sem persistência na URL, screenshots e copy-paste manual são o único jeito de mandar uma lista específica para outra pessoa ou guardar entre sessões.

**Personas e casos de uso.**
- **Carlos, 38 anos, CLT, investidor FII Buy &amp; Hold.** Tem 18 FIIs na carteira, foco em Tijolo de Logística e Lajes. Acessa Posições toda semana para conferir DY vs preço. Caso de uso: aplicar filtro "Tijolo + Liquidez &gt; R$ 500k + Vacância &lt; 10%" para ver só o que importa.
- **Renata, 32 anos, analista júnior planejando aporte mensal de R$ 5k.** Usa Preço-teto para decidir onde aportar. Caso de uso: "P/VP &lt; 0,95 + DY &gt; 9% + Cotistas &gt; 20k" para encontrar candidatos robustos.
- **Marcelo, 45 anos, investidor avançado comparando tese com amigo.** Compartilha link com hash específico reproduzindo seu filtro. Caso de uso: copiar URL e mandar no grupo de WhatsApp.
- **Luciana, 28 anos, iniciante.** Está descobrindo o app. Caso de uso: aplicar "Segmento = Logístico" só para explorar o que existe nesse segmento sem se perder.

---

## 2. Objetivos &amp; Métricas de Sucesso

**Objetivos mensuráveis.**
1. **Adoção**: ≥ 60% das sessões em Posições ou Preço-teto usam ao menos 1 chip ativo em até 30 dias pós-release (medido por telemetria local opcional / heurística via hash em log).
2. **Filtros compostos**: ≥ 25% das sessões combinam 2 ou mais filtros.
3. **Persistência**: 100% dos filtros aplicados sobrevivem a refresh (F5) e fechamento/reabertura do app (validado por teste manual e E2E).
4. **Deep link**: 100% das combinações de filtros geram URL única que, ao ser aberta, reproduz o mesmo estado (validado por snapshot de tabela).
5. **Performance**: filtrar uma tabela de até 500 FIIs leva &lt; 50 ms no client-side.

**KPIs.**
- `taxa_uso_filtros` = sessões_com_hash_contendo_filtros / sessões_total.
- `taxa_combinacao` = sessões_com_≥2_chips / sessões_total.
- `taxa_persistencia` = (hash_antes == hash_depois_refresh) / refreshes.
- `p95_latencia_filtro` = tempo_do_input_ao_render (medido no console em dev).
- `taxa_compartilhamento_url` = cliques_em_copiar_url / sessões (proxy de "vale a pena compartilhar").

---

## 3. Requisitos Funcionais

- **RF-001 — Barra de filtros facetados**: o app deve renderizar, acima das tabelas de Posições e Preço-teto, uma barra horizontal de chips agrupados por categoria (Tipo, Liquidez, Vacância, DY, P/VP, Cotistas, Segmento), cada chip clicável e toggleável.
- **RF-002 — Filtros combináveis (AND lógico)**: múltiplos chips ativos devem se combinar via AND; linhas da tabela só aparecem se passarem por todos os filtros ativos.
- **RF-003 — Filtros numéricos com range**: filtros numéricos (Liquidez, Vacância, DY, P/VP, Cotistas) devem aceitar ranges do tipo "≥ X", "≤ X" ou "entre X e Y", com input numérico direto ou slider.
- **RF-004 — Filtros categóricos multi-seleção**: filtros categóricos (Tipo, Segmento) devem permitir seleção múltipla via chips toggleáveis, combinados por OR dentro da categoria e AND entre categorias.
- **RF-005 — Persistência em URL hash**: o estado dos filtros ativos deve ser serializado em `#/rota?f=tijolo&amp;liq&gt;=1000000&amp;vac&lt;10&amp;dy=8-12&amp;pvp&lt;=0.95&amp;cot&gt;=20000&amp;seg=logistico` (formato a refinar — ver §5), atualizado em tempo real ao toggle.
- **RF-006 — Deep link reproduz estado**: ao carregar uma URL com filtros no hash, a tabela deve renderizar já filtrada no primeiro paint, sem flicker.
- **RF-007 — Botão "Limpar filtros"**: deve existir um botão claro para zerar todos os chips e voltar à visão sem filtros.
- **RF-008 — Contador de resultados**: a tabela deve mostrar quantos FIIs estão sendo exibidos após o filtro (ex: "12 de 487 FIIs").
- **RF-009 — Estado vazio elegante**: se os filtros zerarem os resultados, mostrar mensagem "Nenhum FII atende a esses filtros" com botão "Limpar filtros".
- **RF-010 — Chips removíveis individualmente**: cada chip ativo deve ter um "×" interno para desativar só aquele filtro.
- **RF-011 — Persistência entre rotas**: o estado dos filtros em Posições deve ser independente do estado em Preço-teto (cada rota tem seu próprio hash).
- **RF-012 — Filtros específicos por tabela**: Posições e Preço-teto compartilham o conjunto de filtros, mas cada tabela aplica o filtro sobre o conjunto de FIIs relevante (Posições = apenas FIIs da carteira; Preço-teto = todos os FIIs com preço-teto calculado).
- **RF-013 — Tooltip explicativo**: cada chip deve ter tooltip explicando a métrica e a fonte (ex: "Liquidez diária média em R$, fonte: Investidor10").
- **RF-014 — Valores distintos disponíveis como preset**: ao abrir o dropdown de um filtro categórico, mostrar os valores únicos existentes nos dados (ex: para Segmento, listar apenas os segmentos que aparecem nos FIIs carregados).
- **RF-015 — Ordenação estável**: a tabela filtrada deve manter a ordenação original (definida pelo usuário ou default).

---

## 4. Requisitos Não-Funcionais

- **Performance**: filtro client-side em até 500 FIIs deve completar em &lt; 50 ms (p95) no Electron + Chromium atual; debounce de input numérico em 150 ms para evitar recompute excessivo.
- **Privacidade**: todo o estado dos filtros fica 100% local — Electron não envia hash nem URL para nenhum servidor externo; o app é offline-first.
- **Compatibilidade**: deve funcionar em Electron ≥ 28 (Chromium 120+) rodando em Windows 10/11, macOS 12+, Ubuntu 22.04+. Nenhum recurso web experimental deve ser usado sem fallback.
- **Persistência local opcional**: caso o usuário queira lembrar dos filtros por padrão, oferecer toggle em Configurações para salvar última combinação usada no `localStorage` (não obrigatório).
- **Acessibilidade**: chips devem ser navegáveis por teclado (Tab/Shift+Tab), toggleáveis com Enter/Space, com `aria-pressed` corretamente refletido.
- **Tamanho de URL**: o hash serializado não deve exceder 1 KB para qualquer combinação razoável; URL completa da view Posições filtrada deve caber em SMS/tweet sem problemas.
- **Compatibilidade com histórico de hash existente**: a presença do novo hash não pode quebrar deep links antigos (rotas como `#posicoes` sem query string continuam funcionando).
- **Idempotência**: aplicar o mesmo filtro duas vezes seguidas produz o mesmo estado.
- **Sem dependência de backend**: filtros rodam 100% no renderer; o servidor Electron só é chamado uma vez no load inicial da tabela.

---

## 5. Modelo de Dados

**Mudança de schema?** **Nenhuma**. Esta feature é puramente de UI e estado de URL. Os dados já estão todos disponíveis na tabela `ativos` (campos `tipo`, `segmento`, `dy_12m`, `p_vp`, `vacancia`, `num_imoveis`, `liquidez_diaria`, `numero_cotistas`).

**Estrutura do hash na URL.**

Formato proposto: query string padrão (`?chave=valor&amp;chave2=valor2`) dentro do hash. Decodificação determinística.

| Chave | Tipo | Operador | Exemplo |
|---|---|---|---|
| `tipo` | csv | OR dentro / AND fora | `tipo=tijolo,papel` |
| `seg` | csv | OR dentro / AND fora | `seg=logistico,lajes` |
| `liq` | range | `&gt;=`, `&lt;=`, `-` | `liq=1000000-` (≥ 1M) ou `liq=-500000` (≤ 500k) ou `liq=500000-2000000` |
| `vac` | range | idem | `vac=0-10` |
| `dy` | range | idem | `dy=8-12` |
| `pvp` | range | idem | `pvp=0.8-0.95` |
| `cot` | range | idem | `cot=20000-` |

**Exemplo de URL completa:**
```
app://byeINSS/#/posicoes?tipo=tijolo&amp;liq=1000000-&amp;vac=0-10&amp;dy=8-12&amp;cot=20000-
```

**Modelo interno (renderer state).**
```js
{
  filters: {
    tipo: new Set(['tijolo']),                  // categórico multi
    seg: new Set(['logistico', 'lajes']),       // categórico multi
    liq: { min: 1_000_000, max: null },         // range numérico
    vac: { min: 0, max: 10 },                   // range numérico
    dy: { min: 8, max: 12 },                    // range numérico
    pvp: { min: null, max: 0.95 },              // range numérico
    cot: { min: 20_000, max: null },            // range numérico
  },
  source: 'posicoes' | 'preco-teto'             // de qual tabela veio
}
```

**Serialização / parse.**
- Função `serializeFilters(state) -&gt; string` converte o objeto acima para query string.
- Função `parseFilters(queryString) -&gt; state` faz o inverso, com validação e fallback silencioso para valores inválidos (ex: `dy=abc` é ignorado).
- Listener de `hashchange` mantém o estado em sincronia com back/forward do Electron e refresh.

---

## 6. APIs / Endpoints

Como filtros rodam no client-side, **não há novos endpoints REST**. Os endpoints já existentes são suficientes:

| Método | Rota | Uso |
|---|---|---|
| GET | `/api/ativos?tipo=FII` | Carrega lista completa de FIIs no load inicial da tabela |
| GET | `/api/posicoes` | Posições (carteira) para a tabela de Posições |
| GET | `/api/preco-teto` | FIIs com preço-teto calculado para a tabela de Preço-teto |

Não há mudança nos contratos desses endpoints. Os filtros são aplicados em cima dos arrays JSON retornados, no renderer.

---

## 7. UI / UX

### Wireframes em ASCII

**Frame 1: Tabela de Posições SEM filtros (estado inicial).**

```
┌─────────────────────────────────────────────────────────────────┐
│ byeINSS                                                         │
├─────────────────────────────────────────────────────────────────┤
│  [Dashboard] [Posições] [Preço-teto] [Proventos] [Simulador]    │
├─────────────────────────────────────────────────────────────────┤
│  Posições                                                       │
│                                                                 │
│  Filtros: [Tipo ▾] [Liquidez ▾] [Vacância ▾] [DY ▾] [P/VP ▾]   │
│           [Cotistas ▾] [Segmento ▾]            [Limpar tudo]   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Ticker │ Nome        │ Qtd  │ Preço │ DY  │ P/VP │ Vac  │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ HGLG11 │ CSHG Logist │  50  │ 165,20│ 9,2%│ 0,94 │  4%  │   │
│  │ MXRF11 │ Maxi Renda  │ 200  │  10,30│12,1%│ 0,98 │  —   │   │
│  │ ...      (18 linhas no total)                           │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Frame 2: Tabela com 3 chips ativos (estado filtrado).**

```
┌─────────────────────────────────────────────────────────────────┐
│  Filtros: [Tipo ▾] [Liquidez ▾] [Vacância ▾] [DY ▾] [P/VP ▾]   │
│           [Cotistas ▾] [Segmento ▾]            [Limpar tudo]   │
│                                                                 │
│  Ativos: [Tipo: Tijolo ×] [Vac: ≤10% ×] [Liq: ≥R$1M ×] [+]    │
│                                                                 │
│  Exibindo 5 de 18 FIIs                                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ HGLG11 │ CSHG Logist │  50  │ 165,20│ 9,2%│ 0,94 │  4%  │   │
│  │ BTLG11 │ BTG Logístic│  30  │ 102,40│ 9,5%│ 0,91 │  6%  │   │
│  │ ...                                                       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Frame 3: Dropdown aberto do filtro "DY".**

```
  DY 12M                                                          ▾
  ┌─────────────────────────────────────────────┐
  │ Mínimo  [  8,00  ] %                        │
  │ Máximo  [ 12,00  ] %                        │
  │                                             │
  │  Sugestões rápidas:                         │
  │   • Conservador: 8% – 10%                   │
  │   • Balanceado: 9% – 11%                    │
  │   • Agressivo:  10% – 13%                   │
  │                                             │
  │  [Limpar]                  [Aplicar]        │
  └─────────────────────────────────────────────┘
```

**Frame 4: Estado vazio.**

```
┌─────────────────────────────────────────────────────────────────┐
│  Ativos: [Tipo: Tijolo ×] [Vac: ≤5% ×] [Liq: ≥R$5M ×]           │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                                                          │   │
│  │            Nenhum FII atende a esses filtros.             │   │
│  │                                                          │   │
│  │     Tente afrouxar os critérios ou limpar tudo.           │   │
│  │                                                          │   │
│  │                  [ Limpar filtros ]                       │   │
│  │                                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Lista de estados

- **Loading**: enquanto a tabela inicial carrega (≤ 300 ms típico), exibe skeleton com linhas placeholder; filtros ficam disabled.
- **Empty (sem filtros)**: tabela vazia porque usuário não tem FIIs na carteira → mensagem existente "Adicione sua primeira transação".
- **Empty (com filtros)**: ver Frame 4 acima — empty state dedicado de filtros.
- **Error**: falha ao carregar `/api/ativos` ou `/api/posicoes` → toast de erro + filtros desabilitados + botão "Tentar novamente".
- **Success (sem filtro)**: tabela cheia, sem chips ativos, contador "Exibindo N de N".
- **Success (filtrado)**: tabela reduzida, chips ativos visíveis, contador "Exibindo X de N".

### Acessibilidade (a11y)

- Cada chip deve ser um `&lt;button&gt;` com `aria-pressed="true|false"` e `aria-label="Filtro: Tipo = Tijolo (ativo)"`.
- Inputs numéricos dentro do dropdown devem ter `&lt;label for="..."&gt;` associado.
- Navegação por Tab na ordem: Tipo → Liquidez → Vacância → DY → P/VP → Cotistas → Segmento → Limpar tudo → primeira linha da tabela.
- Foco visível (outline) em todos os elementos interativos.
- Combobox de valores categóricos deve suportar `aria-expanded`, `aria-controls`, e `role="listbox"`/`role="option"` no dropdown.
- Mensagens de empty state devem ter `role="status"` para serem anunciadas por screen readers.
- Contraste mínimo 4.5:1 em texto de chip e tooltip (mesmo padrão visual já existente no app).
- Suporte a `prefers-reduced-motion`: animações de toggle de chip devem respeitar essa media query.

---

## 8. Casos de Borda

1. **FIIs com campos nulos**: se um FII não tem `vacancia` (ex: Papel, FI-Infra), ele aparece em filtros que pedem `vac &lt; X` apenas se considerarmos null como "passa" (default: passa para `vac &lt; X` apenas se null; NÃO aparece em `vac &gt;= X`).
2. **Liquidez zero ou nula**: FIIs recém-listados podem ter `liquidez_diaria = 0`. Filtro `liq &gt;= 1M` deve escondê-los corretamente, sem warning visual.
3. **Range invertido por erro do usuário**: se usuário digita mínimo = 20 e máximo = 10, a UI deve detectar, impedir aplicar e mostrar mensagem inline.
4. **Milhares de combinações no hash**: parsing deve ser robusto a hashes truncados por apps de mensagem (ex: `?tipo=tijolo&amp;liq=1000` chega sem o resto → aplicar o que veio, ignorar o resto).
5. **Refresh durante aplicação de filtro**: idempotência — se o usuário dá F5 com filtro ativo, a tabela re-renderiza filtrada no primeiro paint, sem flash de "tudo" antes.
6. **Múltiplas abas com filtros diferentes**: cada tab do Electron é independente (hash por tab) — filtros não devem vazar entre tabs.
7. **FII com `segmento` preenchido mas `tipo_detalhe` ausente**: filtros por tipo devem usar fallback ao `tipo` genérico (FII) caso `tipo_detalhe` seja null. Documentar essa regra na tooltip.
8. **Segmentos com acentuação ou variações de capitalização**: `Logístico`, `logistico`, `LOGÍSTICO` devem normalizar para o mesmo bucket antes de comparar.
9. **URL com filtro inválido**: `dy=abc` → ignora silenciosamente o filtro de DY, mantém os outros; exibe console warning em dev.
10. **Estado vazio sem FIIs cadastrados**: usuário novo com 0 transações em Posições. Filtros devem ficar disabled com tooltip "Adicione FIIs à carteira para usar filtros".
11. **Muitos filtros ativos simultâneos**: suportar até 10+ chips ativos; layout deve quebrar linha se não couber horizontalmente (wrap), com scroll horizontal se necessário.
12. **Filtro salvo em localStorage vs URL**: se ambos divergem (ex: usuário limpou localStorage mas mantém hash), URL ganha prioridade no load.

---

## 9. Dependências

- **Schema `ativos`**: já contém os campos necessários (`tipo`, `segmento`, `dy_12m`, `p_vp`, `vacancia`, `num_imoveis`, `liquidez_diaria`, `numero_cotistas`). Não bloqueia.
- **Endpoint `/api/ativos`**: já retorna lista completa. Não bloqueia.
- **Endpoint `/api/posicoes`**: já existe. Não bloqueia.
- **Endpoint `/api/preco-teto`**: precisa existir (verificar status; pode já estar pronto em Fases anteriores do roadmap).
- **Sistema de hash routing atual**: o app já usa hash para navegação interna (rotas `#/posicoes`, `#/preco-teto`). Não bloqueia, mas é pré-requisito técnico.
- **Sistema de design / tokens visuais**: usar os chips e cores já existentes no app para manter consistência. Não bloqueia.
- **Nenhuma feature de dados** (2.1 a 2.6 do `fii-features.md`) é hard-blocker. A feature funciona mesmo sem `tipo_detalhe` ou `dy_medio_5a`, apenas com menos opções de filtro nessas categorias.

---

## 10. Esforço Estimado

Total: **3 dias úteis (1 dev full-stack Electron)**.

| Área | Dias | Detalhe |
|---|---|---|
| Design de chips + dropdowns | 0.5 | Componentes visuais reutilizáveis: `&lt;chip&gt;`, `&lt;range-input&gt;`, `&lt;multi-select&gt;` |
| Lógica de filtro (front) | 0.5 | `applyFilters(state, lista) -&gt; listaFiltrada`, com testes unitários |
| Serialização / parse de hash | 0.5 | `serializeFilters`, `parseFilters`, listener de `hashchange` |
| Integração nas 2 tabelas | 0.5 | Acoplar ao `renderPosicoes` e `renderPrecoTeto` |
| Acessibilidade + testes E2E | 0.5 | Navegação por teclado, aria-labels, testes de refresh e deep link |
| QA manual + ajustes | 0.5 | Validação de todos os 12 casos de borda + 5 cenários principais |

---

## 11. Riscos &amp; Mitigações

1. **Risco: URL hash muito longa com 10+ filtros.**
   - Mitigação: projetar serialização compacta desde o início (ex: usar apenas 1 letra por filtro, suprimir defaults) e validar tamanho máximo. Se passar de 1 KB, considerar mover estado para `sessionStorage` com hash guardando apenas um ID.

2. **Risco: Performance ruim com 500+ FIIs.**
   - Mitigação: filtros rodam em memória com `Array.prototype.filter` (rápido para esse volume); debounce de 150 ms em inputs numéricos; virtualizar tabela se passar de 200 linhas (já pode ser padrão atual do app).

3. **Risco: Inconsistência entre filtros salvos em `localStorage` vs URL.**
   - Mitigação: definir URL como fonte da verdade no load; localStorage apenas como conveniência para "último filtro usado" opt-in.

4. **Risco: Usuário não entende o que cada filtro faz.**
   - Mitigação: tooltip explicativo + primeiro uso mostra tour curto (tooltips com seta) sobre os 3 principais filtros (Tipo, Liquidez, DY).

5. **Risco: Filtros "respiram" dados de schema ainda não populado.**
   - Mitigação: ao exibir dropdown de Segmento/Tipo, mostrar apenas valores que existem nos FIIs atualmente carregados (não listar opções vazias).

---

## 12. Out of Scope

- ❌ Filtros salvos por nome / combinações favoritas ("minhas telas de filtro"). Pode ser fase futura.
- ❌ Filtros em outras tabelas além de Posições e Preço-teto (Proventos, FIRE, Simulador ficam de fora nesta entrega).
- ❌ Filtros baseados em dados ainda não capturados (DY médio 5y, rentabilidade real, cap rate estimado, score Buy &amp; Hold). Esses viriam em fase posterior, reaproveitando a infraestrutura aqui entregue.
- ❌ Export da lista filtrada (CSV, PDF). Pode ser evolução natural depois.
- ❌ Filtros no servidor / backend — assumimos 100% client-side nesta entrega.
- ❌ Filtros para outros tipos de ativo (ações, BDR, ETFs) — fora do foco FII-only do app.
- ❌ Sincronização de filtros entre dispositivos — app é 100% local.
- ❌ Histórico de filtros usados / analytics de quais filtros são mais populares.
