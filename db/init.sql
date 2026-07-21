-- Schema do banco byeINSS
-- Tipos: 'FII' | 'ACAO' | 'TD' | 'ETF' | 'CRIPTO'

CREATE TABLE IF NOT EXISTS ativos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL DEFAULT 'FII',
  segmento TEXT,
  razao_social TEXT,
  cnpj TEXT,
  gestor TEXT,
  taxa_adm REAL,
  nota INTEGER DEFAULT 5,
  observacao TEXT,
  dy_minimo REAL,             -- % mínimo aceitável (preço-teto)
  preco_teto REAL,            -- preço máximo p/ compra baseado em DY
  preco_muito_bom REAL,       -- gatilho de "muito barato"
  p_vp REAL,                  -- preço / valor patrimonial
  vp_cota REAL,               -- valor patrimonial por cota
  vacancia REAL,              -- % vacância
  num_imoveis INTEGER,
  dy_12m REAL,                -- DY últimos 12 meses
  dy_24m REAL,                -- DY últimos 24 meses
  ultimo_dividendo REAL,      -- último dividendo por cota
  ultimo_pagto TEXT,          -- data do último pagamento
  alvo_pct_carteira REAL DEFAULT 1.76,  -- % ideal na carteira
  ativo INTEGER DEFAULT 1,    -- 1 = posição aberta, 0 = zerado
  -- Migration 1.2: Vencimento médio de contratos (PRD 12)
  vencimento_medio_contratos DATE,
  vencimento_medio_contratos_meses INTEGER
    CHECK (vencimento_medio_contratos_meses IS NULL OR vencimento_medio_contratos_meses >= 0),
  tipo_reajuste TEXT          CHECK (tipo_reajuste IS NULL OR tipo_reajuste IN ('IGPM','IPCA','FIXO','MISTO','OUTRO')),
  reajuste_percentual REAL     CHECK (reajuste_percentual IS NULL OR (reajuste_percentual >= 0 AND reajuste_percentual <= 100)),
  vencimento_medio_origem TEXT CHECK (vencimento_medio_origem IS NULL OR vencimento_medio_origem IN ('main','comunicado','manual','fallback')),
  vencimento_medio_coletado_em TEXT,
  alerta_vencimento INTEGER DEFAULT 0 CHECK (alerta_vencimento IN (0,1)),
  -- Migration 1.3: Indicadores históricos de DY e rentabilidade real (PRD 02)
  dy_medio_5a REAL,                   -- DY médio 5 anos (pontos percentuais)
  rentab_nominal_1a REAL,
  rentab_nominal_2a REAL,
  rentab_nominal_5a REAL,
  rentab_real_1a REAL,
  rentab_real_2a REAL,
  rentab_real_5a REAL,
  dy_medio_5a_fonte TEXT,             -- 'investidor10' | 'manual' | etc.
  dy_medio_5a_atualizado_em TEXT,     -- ISO datetime
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cotacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ativo_id INTEGER NOT NULL,
  data TEXT NOT NULL,         -- ISO date
  preco REAL NOT NULL,
  fonte TEXT DEFAULT 'manual', -- 'manual' | 'i10' | 'api'
  FOREIGN KEY (ativo_id) REFERENCES ativos(id)
);
CREATE INDEX IF NOT EXISTS idx_cotacoes_ativo_data ON cotacoes(ativo_id, data DESC);

CREATE TABLE IF NOT EXISTS lancamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ativo_id INTEGER NOT NULL,
  data TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('COMPRA','VENDA')),
  quantidade INTEGER NOT NULL,
  preco REAL NOT NULL,        -- preço unitário
  corretora TEXT,
  taxa REAL DEFAULT 0,
  observacao TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (ativo_id) REFERENCES ativos(id)
);
CREATE INDEX IF NOT EXISTS idx_lancamentos_ativo_data ON lancamentos(ativo_id, data DESC);

CREATE TABLE IF NOT EXISTS proventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ativo_id INTEGER NOT NULL,
  data_com TEXT,              -- data-com (direito)
  data_pagto TEXT NOT NULL,   -- data pagamento
  valor_por_cota REAL NOT NULL,
  -- Migration 1.4: AMORTIZACAO adicionado (PRD 03).
  -- Tipos: DIVIDENDO | RENDIMENTO | BONIFICACAO | AMORTIZACAO.
  tipo TEXT NOT NULL DEFAULT 'DIVIDENDO'
    CHECK (tipo IN ('DIVIDENDO','RENDIMENTO','BONIFICACAO','AMORTIZACAO')),
  FOREIGN KEY (ativo_id) REFERENCES ativos(id)
);
CREATE INDEX IF NOT EXISTS idx_proventos_ativo_data ON proventos(ativo_id, data_pagto DESC);
CREATE INDEX IF NOT EXISTS idx_proventos_tipo_data ON proventos(tipo, data_pagto DESC);

CREATE TABLE IF NOT EXISTS metas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,         -- APORTE | FIRE | RENDAMENSAL | PATRIMONIO
  descricao TEXT,
  valor_alvo REAL NOT NULL,
  prazo_meses INTEGER,
  aporte_mensal REAL,
  taxa_anual REAL DEFAULT 12.0,
  patrimonio_atual REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Cenários / projetos de planejamento
CREATE TABLE IF NOT EXISTS cenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  descricao TEXT,
  tipo TEXT NOT NULL DEFAULT 'PATRIMONIO', -- PATRIMONIO | RENDA | APOSENTADORIA
  valor_alvo REAL NOT NULL,                 -- ex: R$ 1.000.000 ou R$ 10.000/mês
  prazo_meses INTEGER NOT NULL,
  aporte_inicial REAL DEFAULT 0,
  aporte_mensal REAL NOT NULL,
  taxa_anual REAL DEFAULT 12.0,
  reajuste_aporte_anual REAL DEFAULT 0,    -- % a.a. de aumento
  cor TEXT DEFAULT '#4ade80',
  ativo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

-- Migration 1.2: Framework de migrations versionadas
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  duration_ms INTEGER,
  rows_before INTEGER,
  rows_after INTEGER,
  reversible INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied ON schema_migrations(applied_at DESC);

-- Migration 1.2: Audit log do scraper de contratos (PRD 12)
CREATE TABLE IF NOT EXISTS fii_scraper_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  campo TEXT NOT NULL,
  sucesso INTEGER NOT NULL CHECK (sucesso IN (0,1)),
  origem TEXT,
  erro TEXT,
  ts TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (ticker) REFERENCES ativos(ticker)
);

CREATE INDEX IF NOT EXISTS idx_scraper_log_ticker ON fii_scraper_log(ticker, ts);
CREATE INDEX IF NOT EXISTS idx_ativos_alerta_venc ON ativos(alerta_vencimento) WHERE alerta_vencimento = 1;

-- Valores padrão
INSERT OR IGNORE INTO config (chave, valor) VALUES
  ('taxa_anual_padrao', '12.0'),
  ('alerta_dy_limite', '15.0'),
  ('alerta_concentracao_pct', '10.0'),
  ('dy_minimo_global', '8.0'),
  ('moeda', 'BRL'),
  -- Migration 1.2/1.3 → 1.4: schema versionada (atualizada no INSERT OR REPLACE abaixo)
  ('versao_schema', '1.4'),
  -- Thresholds de preço (em % do preço-teto)
  ('pct_muito_barato', '85.0'),   -- até 85% do preço-teto = muito barato
  ('pct_barato', '100.0'),         -- até 100% = no teto
  ('pct_caro', '115.0'),           -- até 115% = caro
  -- acima de 115% = muito caro
  -- Reajuste anual de aporte
  ('reajuste_aporte_anual', '10.0'),
  ('reajuste_mes_inicio', '1'),    -- 1=janeiro, 2=fevereiro, etc.
  -- IR
  ('aliquota_ir_dividendos', '0.0'),  -- isento para FIIs pessoa física
  -- Migration 1.2: Vencimento de Contratos
  ('vencimento_janela_alerta_meses', '24'),
  -- Migration 1.3: Indicadores históricos de DY e rentabilidade real (PRD 02)
  ('indicador_dy_vs_5a_abaixo_pct', '95');
