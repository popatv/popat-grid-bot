const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const PaperTrader = require('./paper_trader');
const telegramService = require('./telegram_service');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 4100;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Multi-Pair Paper Trader for BTC, ETH, SOL, and Gold (PAXG) concurrently on 15m
const bot = new PaperTrader(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'PAXGUSDT'], '15m', 25000);
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

server.listen(PORT, () => {
  console.log(`🦜 POPAT 1 MULTI-PAIR (BTC + ETH + SOL + GOLD/PAXG) BOT running on port ${PORT}`);
});
