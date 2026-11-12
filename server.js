const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const PaperTrader = require('./paper_trader');
const { runFibGridBacktest } = require('./backtester');
const telegramService = require('./telegram_service');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 4100;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Paper Trader with 5m default execution (fast testing + high quality)
const bot = new PaperTrader('BTCUSDT', '5m', 25000);
bot.start();

// Connect Telegram Service
telegramService.setBotInstance(bot);
telegramService.startPolling();

// Broadcast live updates to connected web UI clients
bot.subscribe(status => {
  const msg = JSON.stringify({ type: 'STATUS_UPDATE', data: status });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
});

// API Routes
app.get('/api/status', (req, res) => {
  res.json(bot.getStatus());
});

app.post('/api/start', (req, res) => {
  bot.start();
  res.json({ success: true, status: bot.getStatus() });
});

app.post('/api/stop', (req, res) => {
  bot.stop();
  res.json({ success: true, status: bot.getStatus() });
});

app.post('/api/reset', (req, res) => {
  bot.reset();
  res.json({ success: true, status: bot.getStatus() });
});

app.post('/api/set-tf', (req, res) => {
  const { tf } = req.body;
  bot.setExecutionTf(tf);
  res.json({ success: true, status: bot.getStatus() });
});

app.post('/api/set-symbol', (req, res) => {
  const { symbol } = req.body;
  bot.setSymbol(symbol);
  res.json({ success: true, status: bot.getStatus() });
});

app.post('/api/backtest', async (req, res) => {
  try {
    const { symbol = 'BTCUSDT', interval = '5m', limit = 1000 } = req.body;
    const results = await runFibGridBacktest(symbol, interval, limit);
    res.json({ success: true, results });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`🦜 POPAT 3 SMC DUAL-HTF (1D+4H) GRID BOT running on http://localhost:${PORT}`);
});
