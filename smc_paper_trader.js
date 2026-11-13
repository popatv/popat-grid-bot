/**
 * POPAT 3 SMC DUAL-HTF PAPER TRADING ENGINE
 * Parallel execution alongside POPAT 1 TP Reversal
 * Independent $25,000 Balance & Trade History
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { calculateSMC } = require('./smc_strategy');
const telegramService = require('./telegram_service');

const SMC_TRADES_FILE = path.join(__dirname, 'smc_paper_trades.json');

class SmcPaperTrader {
  constructor(symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'PAXGUSDT'], executionTf = '15m', initialCapital = 25000) {
    this.symbols = symbols;
    this.executionTf = executionTf;
    this.initialCapital = initialCapital;
    this.balance = initialCapital;
    
    this.positions = {};
    this.symbols.forEach(s => this.positions[s] = null);

    this.smcData = {};
    this.symbols.forEach(s => {
      this.smcData[s] = {
        curPrice: 0,
        trend: 'NEUTRAL',
        swingHigh: null,
        swingLow: null,
        fibLevels: null
      };
    });

    this.lastTradedBarTime = {};
    this.closedTrades = [];
    this.isRunning = false;
    this.pollInterval = null;
    this.listeners = [];

    this.loadState();
  }

  loadState() {
    try {
      if (fs.existsSync(SMC_TRADES_FILE)) {
        const data = JSON.parse(fs.readFileSync(SMC_TRADES_FILE, 'utf8'));
        this.balance = data.balance || this.initialCapital;
        if (data.positions) this.positions = { ...this.positions, ...data.positions };
        this.closedTrades = data.closedTrades || [];
        this.lastTradedBarTime = data.lastTradedBarTime || {};
      }
    } catch (e) {
      console.error('Error loading SMC paper trade state:', e.message);
    }
  }

  saveState() {
    try {
      fs.writeFileSync(SMC_TRADES_FILE, JSON.stringify({
        balance: this.balance,
        positions: this.positions,
        closedTrades: this.closedTrades,
        lastTradedBarTime: this.lastTradedBarTime
      }, null, 2), 'utf8');
    } catch (e) {
      console.error('Error saving SMC paper trade state:', e.message);
    }
  }

  async fetchCandles(symbol) {
    const baseUrls = [
      'https://data-api.binance.vision/api/v3/klines',
      'https://api1.binance.com/api/v3/klines',
      'https://api.binance.com/api/v3/klines'
    ];

    for (const base of baseUrls) {
      try {
        const res = await axios.get(`${base}?symbol=${symbol}&interval=${this.executionTf}&limit=250`, { timeout: 8000 });
        if (Array.isArray(res.data) && res.data.length > 0) {
          return res.data.map(d => ({
            time: d[0],
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5])
          }));
        }
      } catch (e) { }
    }
    return null;
  }

  async tickSymbol(symbol) {
    const candles = await this.fetchCandles(symbol);
    if (!candles || candles.length < 35) return;

    const smc = calculateSMC(candles, { pivotLen: 10, rrRatio: 2.0 });
    const lastCandle = candles[candles.length - 1];
    const curPrice = lastCandle.close;

    this.smcData[symbol] = {
      curPrice,
      trend: smc.trend,
      swingHigh: smc.swingHigh,
      swingLow: smc.swingLow,
      fibLevels: smc.fibLevels,
      lastBOS: smc.lastBOS
    };

    // 1. Monitor Open Position
    const pos = this.positions[symbol];
    if (pos) {
      const isLong = pos.type === 'LONG';
      let closed = false;
      let exitPrice = 0;
      let exitReason = '';

      if (isLong) {
        if (lastCandle.low <= pos.stopLoss) {
          closed = true;
          exitPrice = pos.stopLoss;
          exitReason = 'SL_HIT';
        } else if (lastCandle.high >= pos.takeProfit) {
          closed = true;
          exitPrice = pos.takeProfit;
          exitReason = 'TP_HIT';
        }
      } else {
        if (lastCandle.high >= pos.stopLoss) {
          closed = true;
          exitPrice = pos.stopLoss;
          exitReason = 'SL_HIT';
        } else if (lastCandle.low <= pos.takeProfit) {
          closed = true;
          exitPrice = pos.takeProfit;
          exitReason = 'TP_HIT';
        }
      }

      if (closed) {
        const pnlPct = isLong
          ? (exitPrice - pos.entryPrice) / pos.entryPrice
          : (pos.entryPrice - exitPrice) / pos.entryPrice;
        const pnlUsd = (pos.sizeUsd * pnlPct) - (pos.sizeUsd * 0.0008);

        this.balance += pnlUsd;

        const closedRecord = {
          id: pos.id,
          strategy: 'SMC',
          symbol,
          type: pos.type,
          entryPrice: pos.entryPrice,
          exitPrice,
          pnlUsd,
          pnlPct: pnlPct * 100,
          exitReason,
          entryTime: pos.entryTime,
          exitTime: Date.now(),
          newBalance: this.balance
        };

        this.closedTrades.unshift(closedRecord);
        if (this.closedTrades.length > 50) this.closedTrades.pop();

        console.log(`[SMC TRADE CLOSED] ${pos.type} on ${symbol} at $${exitPrice} | Reason: ${exitReason} | PnL: $${pnlUsd.toFixed(2)}`);

        // Send Telegram alert
        const isWin = pnlUsd > 0;
        const tgMsg = `${isWin ? '💰 *[SMC] TAKE PROFIT HIT!* 🚀' : '🛑 *[SMC] STOP LOSS HIT*'}\n\n` +
          `• Asset: *${symbol}* (${pos.type})\n` +
          `• Entry: $${pos.entryPrice.toFixed(2)} -> Exit: $${exitPrice.toFixed(2)}\n` +
          `• PnL: *${isWin ? '+' : ''}$${pnlUsd.toFixed(2)}* (${(pnlPct * 100).toFixed(2)}%)\n` +
          `• SMC Balance: *$${this.balance.toLocaleString()}*`;
        telegramService.send(tgMsg);

        this.positions[symbol] = null;
        this.saveState();
      }
    }

    // 2. Check for New Entry Signal
    if (!this.positions[symbol] && smc.signal) {
      const sig = smc.signal;
      if (this.lastTradedBarTime[symbol] !== sig.time) {
        const positionSizeUsd = 5000;
        const riskUsd = (Math.abs(sig.entry - sig.sl) / sig.entry) * positionSizeUsd;

        this.positions[symbol] = {
          id: `POS_SMC_${symbol}_${Date.now()}`,
          strategy: 'SMC',
          symbol,
          type: sig.type,
          entryPrice: sig.entry,
          stopLoss: sig.sl,
          takeProfit: sig.tp,
          riskUsd,
          sizeUsd: positionSizeUsd,
          entryTime: Date.now(),
          reason: sig.reason
        };

        this.lastTradedBarTime[symbol] = sig.time;
        this.saveState();

        console.log(`[SMC NEW ENTRY] ${sig.type} on ${symbol} @ $${sig.entry} | SL: $${sig.sl.toFixed(2)} | TP: $${sig.tp.toFixed(2)}`);

        const tgMsg = `${sig.type === 'LONG' ? '🟢' : '🔴'} *🏛️ [SMC ENGINE] NEW ENTRY!* [${symbol}]\n\n` +
          `• Asset: *${symbol}* (15M)\n` +
          `• Direction: *${sig.type}*\n` +
          `• Entry: $${sig.entry.toFixed(2)}\n` +
          `• Stop Loss: $${sig.sl.toFixed(2)}\n` +
          `• Take Profit (1:2 RR): $${sig.tp.toFixed(2)}\n` +
          `• Setup: *${sig.reason}*\n` +
          `• Position Size: $5,000`;
        telegramService.send(tgMsg);
      }
    }
  }

  async tick() {
    if (!this.isRunning) return;
    for (const sym of this.symbols) {
      try {
        await this.tickSymbol(sym);
      } catch (err) {
        console.error(`SMC error scanning ${sym}:`, err.message);
      }
    }
    this.notifyListeners();
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`POPAT 3 SMC Trader started on [${this.symbols.join(', ')}] (15M).`);
    this.tick();
    this.pollInterval = setInterval(() => this.tick(), 15000);
  }

  stop() {
    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log('POPAT 3 SMC Trader stopped.');
    this.notifyListeners();
  }

  reset() {
    this.balance = this.initialCapital;
    this.symbols.forEach(s => this.positions[s] = null);
    this.closedTrades = [];
    this.lastTradedBarTime = {};
    this.saveState();
    console.log('SMC PaperTrader state reset.');
    this.notifyListeners();
  }

  subscribe(cb) {
    this.listeners.push(cb);
  }

  notifyListeners() {
    const status = this.getStatus();
    this.listeners.forEach(cb => {
      try { cb(status); } catch (e) { }
    });
  }

  getStatus() {
    const netPnlUsd = this.balance - this.initialCapital;
    const netPnlPct = (netPnlUsd / this.initialCapital) * 100;

    const activePositionsList = [];
    for (const sym of this.symbols) {
      const pos = this.positions[sym];
      if (pos) {
        const curPrice = this.smcData[sym] ? this.smcData[sym].curPrice : pos.entryPrice;
        const isLong = pos.type === 'LONG';
        const unrealizedPnlPct = isLong
          ? (curPrice - pos.entryPrice) / pos.entryPrice
          : (pos.entryPrice - curPrice) / pos.entryPrice;
        const unrealizedPnlUsd = pos.sizeUsd * unrealizedPnlPct;

        activePositionsList.push({
          ...pos,
          curPrice,
          unrealizedPnlUsd,
          unrealizedPnlPct: unrealizedPnlPct * 100
        });
      }
    }

    const wins = this.closedTrades.filter(t => t.pnlUsd > 0).length;
    const total = this.closedTrades.length;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';

    return {
      strategy: 'SMC',
      symbols: this.symbols,
      executionTf: this.executionTf,
      isRunning: this.isRunning,
      smcData: this.smcData,
      balance: this.balance,
      netPnlUsd,
      netPnlPct: netPnlPct.toFixed(2),
      activePositions: activePositionsList,
      positionsMap: this.positions,
      totalTrades: total,
      winRate,
      closedTrades: this.closedTrades.slice(0, 30)
    };
  }
}

module.exports = SmcPaperTrader;
