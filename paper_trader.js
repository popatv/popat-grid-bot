/**
 * POPAT 1 TP REVERSAL + SMA 30 SLOPE FILTER LIVE PAPER TRADING ENGINE
 * Real-time Binance Feed simulation with zero real money risk ($25,000 Sim Balance)
 * Single-Entry Sniper Execution with 1.7 ATR Stop Loss and Fixed 1:2 RR Take Profit
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { analyzeTpReversal } = require('./strategy');
const telegramService = require('./telegram_service');

const TRADES_FILE = path.join(__dirname, 'paper_trades.json');

class PaperTrader {
  constructor(symbol = 'BTCUSDT', executionTf = '15m', initialCapital = 25000) {
    this.symbol = symbol;
    this.executionTf = executionTf; // Default 15m
    this.initialCapital = initialCapital;
    this.balance = initialCapital;
    this.activePosition = null;
    this.closedTrades = [];
    this.candles15m = [];
    this.isRunning = false;
    this.pollInterval = null;
    this.lastTradedBarTime = null;
    this.listeners = [];
    this.curPrice = 0;
    this.sma30 = 0;
    this.sma30Slope = 'FLAT';
    this.atr = 0;

    this.loadState();
  }

  loadState() {
    try {
      if (fs.existsSync(TRADES_FILE)) {
        const data = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
        this.balance = data.balance || this.initialCapital;
        this.activePosition = data.activePosition || null;
        this.closedTrades = data.closedTrades || [];
        this.lastTradedBarTime = data.lastTradedBarTime || null;
      }
    } catch (e) {
      console.error('Error loading paper trade state:', e.message);
    }
  }

  saveState() {
    try {
      fs.writeFileSync(TRADES_FILE, JSON.stringify({
        balance: this.balance,
        activePosition: this.activePosition,
        closedTrades: this.closedTrades,
        lastTradedBarTime: this.lastTradedBarTime
      }, null, 2), 'utf8');
    } catch (e) {
      console.error('Error saving paper trade state:', e.message);
    }
  }

  setSymbol(newSymbol) {
    const valid = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    if (valid.includes(newSymbol)) {
      this.symbol = newSymbol;
      this.activePosition = null;
      this.lastTradedBarTime = null;
      console.log(`PaperTrader active symbol switched to: ${newSymbol}`);
      this.tick();
    }
  }

  setExecutionTf(newTf) {
    if (['5m', '15m', '1h'].includes(newTf)) {
      this.executionTf = newTf;
      this.lastTradedBarTime = null;
      console.log(`Execution timeframe switched to: ${newTf}`);
      this.tick();
    }
  }

  async fetchCandles() {
    const baseUrls = [
      'https://data-api.binance.vision/api/v3/klines',
      'https://api1.binance.com/api/v3/klines',
      'https://api.binance.com/api/v3/klines'
    ];

    const fetchKlines = async (interval, limit) => {
      let lastErr = null;
      for (const base of baseUrls) {
        try {
          const res = await axios.get(`${base}?symbol=${this.symbol}&interval=${interval}&limit=${limit}`, { timeout: 8000 });
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
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error('All Binance kline endpoints failed');
    };

    try {
      this.candles15m = await fetchKlines(this.executionTf, 250);
      if (this.candles15m.length > 0) {
        this.curPrice = this.candles15m[this.candles15m.length - 1].close;
      }
    } catch (e) {
      console.error('Error fetching candles:', e.message);
    }
  }

  async tick() {
    if (!this.isRunning) return;

    await this.fetchCandles();
    if (!this.candles15m || this.candles15m.length < 35) return;

    const analysis = analyzeTpReversal(this.candles15m, { useSma30Filter: true, slAtrMult: 1.7, rrRatio: 2.0 });
    this.sma30 = analysis.sma30;
    this.sma30Slope = analysis.sma30Slope;
    this.atr = analysis.atr;

    const lastCandle = this.candles15m[this.candles15m.length - 1];
    const prevCandle = this.candles15m[this.candles15m.length - 2];
    this.curPrice = lastCandle.close;

    // 1. Monitor Open Position for SL or 1:2 TP Hit
    if (this.activePosition) {
      const pos = this.activePosition;
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
        // SHORT
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
        const pnlUsd = (pos.sizeUsd * pnlPct) - (pos.sizeUsd * 0.0008); // 0.08% simulated fee

        this.balance += pnlUsd;

        const closedRecord = {
          id: pos.id,
          symbol: pos.symbol,
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

        console.log(`[TRADE CLOSED] ${pos.type} on ${pos.symbol} at $${exitPrice} | Reason: ${exitReason} | PnL: $${pnlUsd.toFixed(2)}`);

        if (exitReason === 'TP_HIT') {
          telegramService.sendTakeProfit(closedRecord);
        } else {
          telegramService.sendStopLoss(closedRecord);
        }

        this.activePosition = null;
        this.saveState();
      }
    }

    // 2. If Flat, Evaluate New Entry Signal
    if (!this.activePosition && analysis.latestSignal) {
      const sig = analysis.latestSignal;
      const sigCandleTime = sig.time;

      if (this.lastTradedBarTime !== sigCandleTime) {
        const positionSizeUsd = 5000; // $5,000 virtual allocation
        const riskUsd = (sig.risk / sig.entry) * positionSizeUsd;

        this.activePosition = {
          id: `POS_${Date.now()}`,
          symbol: this.symbol,
          type: sig.type, // 'SHORT' or 'LONG'
          entryPrice: sig.entry,
          stopLoss: sig.sl,
          takeProfit: sig.tp,
          riskUsd,
          sizeUsd: positionSizeUsd,
          entryTime: Date.now(),
          sma30Slope: sig.sma30Slope,
          atr: sig.atr
        };

        this.lastTradedBarTime = sigCandleTime;
        this.saveState();

        console.log(`[NEW ENTRY] ${sig.type} on ${this.symbol} @ $${sig.entry} | SL: $${sig.sl.toFixed(2)} | TP: $${sig.tp.toFixed(2)} | Slope: ${sig.sma30Slope}`);
        telegramService.sendPositionEntry(this.activePosition);
      }
    }

    this.notifyListeners();
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`POPAT 1 TP Reversal PaperTrader started (${this.symbol} | Exec: ${this.executionTf}).`);
    this.tick();
    this.pollInterval = setInterval(() => this.tick(), 15000); // Poll every 15s
  }

  stop() {
    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log('POPAT 1 TP Reversal PaperTrader stopped.');
    this.notifyListeners();
  }

  reset() {
    this.balance = this.initialCapital;
    this.activePosition = null;
    this.closedTrades = [];
    this.lastTradedBarTime = null;
    this.saveState();
    console.log('PaperTrader state reset to initial $25,000 balance.');
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

    let activePosStatus = null;
    if (this.activePosition) {
      const pos = this.activePosition;
      const isLong = pos.type === 'LONG';
      const unrealizedPnlPct = isLong
        ? (this.curPrice - pos.entryPrice) / pos.entryPrice
        : (pos.entryPrice - this.curPrice) / pos.entryPrice;
      const unrealizedPnlUsd = pos.sizeUsd * unrealizedPnlPct;

      activePosStatus = {
        ...pos,
        curPrice: this.curPrice,
        unrealizedPnlUsd,
        unrealizedPnlPct: unrealizedPnlPct * 100
      };
    }

    const wins = this.closedTrades.filter(t => t.pnlUsd > 0).length;
    const total = this.closedTrades.length;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';

    return {
      symbol: this.symbol,
      executionTf: this.executionTf,
      isRunning: this.isRunning,
      curPrice: this.curPrice,
      sma30: this.sma30,
      sma30Slope: this.sma30Slope,
      atr: this.atr,
      balance: this.balance,
      netPnlUsd,
      netPnlPct: netPnlPct.toFixed(2),
      activePosition: activePosStatus,
      totalTrades: total,
      winRate,
      closedTrades: this.closedTrades.slice(0, 20)
    };
  }
}

module.exports = PaperTrader;
