const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb, getDb } = require('./db.js');

const ativosRouter = require('./routes/ativos.js');
const lancamentosRouter = require('./routes/lancamentos.js');
const proventosRouter = require('./routes/proventos.js');
const cotacoesRouter = require('./routes/cotacoes.js');
const metasRouter = require('./routes/metas.js');
const dashboardRouter = require('./routes/dashboard.js');
const importRouter = require('./routes/import.js');
const configRouter = require('./routes/config.js');
const cenariosRouter = require('./routes/cenarios.js');

let serverPort = null;

async function startServer() {
  await initDb();
  const db = getDb();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  // Disponibiliza o db nos handlers
  app.use((req, _res, next) => { req.db = db; next(); });

  app.use('/api/ativos', ativosRouter);
  app.use('/api/lancamentos', lancamentosRouter);
  app.use('/api/proventos', proventosRouter);
  app.use('/api/cotacoes', cotacoesRouter);
  app.use('/api/metas', metasRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/import', importRouter);
  app.use('/api/config', configRouter);
  app.use('/api/cenarios', cenariosRouter);

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      console.log(`[byeinss] API ouvindo em http://127.0.0.1:${serverPort}`);
      resolve();
    });
  });
}

function getServerPort() { return serverPort; }

module.exports = { startServer, getServerPort };
