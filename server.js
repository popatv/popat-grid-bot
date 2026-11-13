const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const PaperTrader = require('./paper_trader');
const SmcPaperTrader = require('./smc_paper_trader');
const telegramService = require('./telegram_service');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 4100;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. Initialize Strategy 1: POPAT 1 TP Reversal (15M)
const bot1 = new PaperTrader(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'PAXGUSDT'], '15m', 25000, 2.0);
bot1.start();

// 2. Initialize Strategy 2: POPAT 3 SMC Engine (15M)
const bot2 = new SmcPaperTrader(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'PAXGUSDT'], '15m', 25000);
bot2.start();

// Connect Telegram Service for both strategies
telegramService.setBotInstances(bot1, bot2);
telegramService.startPolling();

// Broadcast live updates to connected web UI clients
function broadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

bot1.subscribe(status => broadcast('STATUS_UPDATE_TP', status));
bot2.subscribe(status => broadcast('STATUS_UPDATE_SMC', status));

// API Routes for TP Reversal (Strategy 1)
app.get('/api/status', (req, res) => {
  res.json({
    strategy1_tp: bot1.getStatus(),
    strategy2_smc: bot2.getStatus()
  });
});

app.post('/api/start', (req, res) => {
  bot1.start();
  res.json({ success: true, status: bot1.getStatus() });
});

app.post('/api/stop', (req, res) => {
  bot1.stop();
  res.json({ success: true, status: bot1.getStatus() });
});

app.post('/api/reset', (req, res) => {
  bot1.reset();
  res.json({ success: true, status: bot1.getStatus() });
});

// API Routes for SMC (Strategy 2)
app.post('/api/smc/start', (req, res) => {
  bot2.start();
  res.json({ success: true, status: bot2.getStatus() });
});

app.post('/api/smc/stop', (req, res) => {
  bot2.stop();
  res.json({ success: true, status: bot2.getStatus() });
});

app.post('/api/smc/reset', (req, res) => {
  bot2.reset();
  res.json({ success: true, status: bot2.getStatus() });
});

server.listen(PORT, () => {
  console.log(`🦜 POPAT DUAL-STRATEGY BOT running on port ${PORT}`);
  console.log(`   ├─ Strategy 1: POPAT 1 TP Reversal (15M, 1:2 RR) [BTC, ETH, SOL, GOLD]`);
  console.log(`   └─ Strategy 2: POPAT 3 SMC Engine (Pivot 30 / OTE Golden Pocket) [BTC, ETH, SOL, GOLD]`);
});
