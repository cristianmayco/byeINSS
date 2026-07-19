const express = require('express');
const router = express.Router();

const importI10 = require('../services/import-i10.js');
const importSheets = require('../services/import-sheets.js');

router.post('/investidor10', async (req, res) => {
  try {
    const result = await importI10(req.db, req.body);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/sheets', async (req, res) => {
  try {
    const result = await importSheets(req.db, req.body);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
