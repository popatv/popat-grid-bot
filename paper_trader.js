/**
 * POPAT 1 TP REVERSAL + SMA 30 SLOPE FILTER MULTI-PAIR ENGINE
 * Simultaneously monitors and trades BTCUSDT, ETHUSDT, SOLUSDT, and PAXGUSDT (Gold) in parallel!
 * 15M Execution, 1.7 ATR Stop Loss, Fixed 1:2 RR Take Profit, $5,000 per trade allocation
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { analyzeTpReversal } = require('./strategy');
const telegramService = require('./telegram_service');

const TRADES_FILE = path.join(__dirname, 'paper_trades.json');

class PaperTrader {
  constructor(symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'PAXGUSDT'], executionTf = '15m', initialCapital = 25000) {
    this.symbols = symbols;
    this.executionTf = executionTf;
    this.initialCapital = initialCapital;
    this.balance = initialCapital;
    
    // Multi-pair active positions: { 'BTCUSDT': null, 'ETHUSDT': null, 'SOLUSDT': null, 'PAXGUSDT': null }
    this.positions = {};
    this.symbols.forEach(s => this.positions[s] = null);

    this.marketData = {};
    this.symbols.forEach(s => {
      this.marketData[s] = {
        curPrice: 0,
        sma30: 0,
        sma30Slope: 'FLAT',
        atr: 0
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
      if (fs.existsSync(TRADES_FILE)) {
        const data = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
        this.balance = data.balance || this.initialCapital;
        if (data.positions) {
          this.positions = { ...this.positions, ...data.positions };
        } else if (data.activePosition) {
          this.positions[data.activePosition.symbol || 'BTCUSDT'] = data.activePosition;
        }
        this.closedTrades = data.closedTrades || [];
        this.lastTradedBarTime = data.lastTradedBarTime || {};
      }
    } catch (e) {
      console.error('Error loading paper trade state:', e.message);
    }
  }

  saveState() {
    try {
      fs.writeFileSync(TRADES_FILE, JSON.stringify({
        balance: this.balance,
        positions: this.positions,
        closedTrades: this.closedTrades,
        lastTradedBarTime: this.lastTradedBarTime
      }, null, 2), 'utf8');
    } catch (e) {
      console.error('Error saving paper trade state:', e.message);
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
      } catch (e) {
        // try next endpoint
      }
    }
    return null;
  }

  async tickSymbol(symbol) {
    const candles = await this.fetchCandles(symbol);
    if (!candles || candles.length < 35) return;

    const analysis = analyzeTpReversal(candles, { useSma30Filter: true, slAtrMult: 1.7, rrRatio: 2.0 });
    const lastCandle = candles[candles.length - 1];
    const curPrice = lastCandle.close;

    this.marketData[symbol] = {
      curPrice,
      sma30: analysis.sma30,
      sma30Slope: analysis.sma30Slope,
      atr: analysis.atr
    };

    // 1. Check Active Position for this symbol
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
        const pnlUsd = (pos.sizeUsd * pnlPct) - (pos.sizeUsd * 0.0008); // 0.08% fee

        this.balance += pnlUsd;

        const closedRecord = {
          id: pos.id,
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

        console.log(`[TRADE CLOSED] ${pos.type} on ${symbol} at $${exitPrice} | Reason: ${exitReason} | PnL: $${pnlUsd.toFixed(2)}`);

        if (exitReason === 'TP_HIT') {
          telegramService.sendTakeProfit(closedRecord);
        } else {
          telegramService.sendStopLoss(closedRecord);
        }

        this.positions[symbol] = null;
        this.saveState();
      }
    }

    // 2. If Flat on this symbol, Check for New Entry Signal
    if (!this.positions[symbol] && analysis.latestSignal) {
      const sig = analysis.latestSignal;
      const sigCandleTime = sig.time;

      if (this.lastTradedBarTime[symbol] !== sigCandleTime) {
        const positionSizeUsd = 5000; // $5,000 per trade allocation
        const riskUsd = (sig.risk / sig.entry) * positionSizeUsd;

        this.positions[symbol] = {
          id: `POS_${symbol}_${Date.now()}`,
          symbol,
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

        this.lastTradedBarTime[symbol] = sigCandleTime;
        this.saveState();

        console.log(`[NEW ENTRY] ${sig.type} on ${symbol} @ $${sig.entry} | SL: $${sig.sl.toFixed(2)} | TP: $${sig.tp.toFixed(2)} | Slope: ${sig.sma30Slope}`);
        telegramService.sendPositionEntry(this.positions[symbol]);
      }
    }
  }

  async tick() {
    if (!this.isRunning) return;

    // Concurrently scan all symbols
    for (const sym of this.symbols) {
      try {
        await this.tickSymbol(sym);
      } catch (err) {
        console.error(`Error scanning ${sym}:`, err.message);
      }
    }

    this.notifyListeners();
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`POPAT 1 TP Reversal Multi-Pair Trader started on [${this.symbols.join(', ')}] (15M).`);
    this.tick();
    this.pollInterval = setInterval(() => this.tick(), 15000); // Poll every 15s
  }

  stop() {
    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log('POPAT 1 TP Reversal Multi-Pair Trader stopped.');
    this.notifyListeners();
  }

  reset() {
    this.balance = this.initialCapital;
    this.symbols.forEach(s => this.positions[s] = null);
    this.closedTrades = [];
    this.lastTradedBarTime = {};
    this.saveState();
    console.log('PaperTrader state reset to initial $25,000 balance across all pairs.');
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

    // Build enriched active positions with unrealized PnL
    const activePositionsList = [];
    for (const sym of this.symbols) {
      const pos = this.positions[sym];
      if (pos) {
        const curPrice = this.marketData[sym] ? this.marketData[sym].curPrice : pos.entryPrice;
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
      symbols: this.symbols,
      executionTf: this.executionTf,
      isRunning: this.isRunning,
      marketData: this.marketData,
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

module.exports = PaperTrader;
