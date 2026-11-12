/**
 * POPAT 3 SMC DUAL-HTF FIBONACCI GRID LIVE PAPER TRADING ENGINE
 * Real-time Binance Feed simulation with zero real money risk ($25,000 Prop Sim Balance)
 * Multi-Timeframe Confluence: Daily (1D) + 4-Hour (4H) Guardians -> Execution (1m / 5m / 15m)
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { calculatePivot30SMC, checkDualHtfConfluence, generateFibGridPlan } = require('./strategy');
const telegramService = require('./telegram_service');

const TRADES_FILE = path.join(__dirname, 'paper_trades.json');

class PaperTrader {
  constructor(symbol = 'BTCUSDT', executionTf = '5m', initialCapital = 25000) {
    this.symbol = symbol;
    this.executionTf = executionTf; // '1m' | '5m' | '15m'
    this.initialCapital = initialCapital;
    this.balance = initialCapital;
    this.activeGrid = null;
    this.closedTrades = [];
    this.candlesLtf = [];
    this.candles4h = [];
    this.candles1d = [];
    this.isRunning = false;
    this.pollInterval = null;
    this.lastCheckedBarTime = null;
    this.listeners = [];
    this.lastGridPlan = null;
    this.htfStatus = {
      daily: 'BULL',
      fourHour: 'BULL',
      confluence: 'BULL',
      permitted: true,
      reason: 'Dual-HTF Confluence'
    };
    this.ltfStatus = { trend: 'BULL', levels: [] };

    this.loadState();
  }

  loadState() {
    try {
      if (fs.existsSync(TRADES_FILE)) {
        const data = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
        this.balance = data.balance || this.initialCapital;
        this.activeGrid = data.activeGrid || null;
        this.closedTrades = data.closedTrades || [];
      }
    } catch (e) {
      console.error('Error loading paper trade state:', e.message);
    }
  }

  saveState() {
    try {
      fs.writeFileSync(TRADES_FILE, JSON.stringify({
        balance: this.balance,
        activeGrid: this.activeGrid,
        closedTrades: this.closedTrades
      }, null, 2), 'utf8');
    } catch (e) {
      console.error('Error saving paper trade state:', e.message);
    }
  }

  setExecutionTf(newTf) {
    if (['1m', '5m', '15m'].includes(newTf)) {
      this.executionTf = newTf;
      this.lastCheckedBarTime = null;
      console.log(`Execution timeframe switched to: ${newTf}`);
      this.tick();
    }
  }

  async fetchCandles() {
    try {
      const [resLtf, res4h, res1d] = await Promise.all([
        axios.get(`https://api.binance.com/api/v3/klines?symbol=${this.symbol}&interval=${this.executionTf}&limit=120`, { timeout: 8000 }),
        axios.get(`https://api.binance.com/api/v3/klines?symbol=${this.symbol}&interval=4h&limit=100`, { timeout: 8000 }),
        axios.get(`https://api.binance.com/api/v3/klines?symbol=${this.symbol}&interval=1d&limit=100`, { timeout: 8000 })
      ]);

      const mapKlines = (data) => data.map(d => ({
        time: Math.floor(d[0] / 1000),
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5])
      }));

      this.candlesLtf = mapKlines(resLtf.data);
      this.candles4h = mapKlines(res4h.data);
      this.candles1d = mapKlines(res1d.data);
    } catch (e) {
      console.error('PaperTrader fetch error:', e.message);
    }
  }

  async tick() {
    await this.fetchCandles();
    if (this.candlesLtf.length < 30 || this.candles4h.length < 30 || this.candles1d.length < 25) return;

    const smc1d = calculatePivot30SMC(this.candles1d, { len: 14 });
    const smc4h = calculatePivot30SMC(this.candles4h, { len: 20 });
    const smcLtf = calculatePivot30SMC(this.candlesLtf, { len: this.executionTf === '1m' ? 25 : 30 });

    if (!smc1d || !smc4h || !smcLtf) return;

    const htfConfluence = checkDualHtfConfluence(smc1d, smc4h);
    this.htfStatus = {
      daily: smc1d.trend,
      fourHour: smc4h.trend,
      confluence: htfConfluence.bias,
      permitted: htfConfluence.permitted,
      reason: htfConfluence.reason
    };

    this.ltfStatus = {
      executionTf: this.executionTf,
      trend: smcLtf.trend,
      levels: smcLtf.levelsList,
      goldenZone: smcLtf.goldenZone,
      fibStart: smcLtf.fibStartPrice,
      fibEnd: smcLtf.fibEndPrice,
      range: smcLtf.range
    };

    const curLiveCandle = this.candlesLtf[this.candlesLtf.length - 1];
    const curPrice = curLiveCandle.close;

    // 1. MANAGE ACTIVE GRID POSITION
    if (this.activeGrid) {
      this.manageActiveGrid(curLiveCandle);
    }

    // 2. SCAN FOR NEW SETUP IF IDLE
    if (!this.activeGrid && smcLtf.goldenZone) {
      // DUAL-HTF GUARDIAN CHECK (Daily + 4H)
      if (htfConfluence.permitted && smcLtf.trend === htfConfluence.bias) {
        const minRangeReq = this.executionTf === '1m' ? 0.20 : this.executionTf === '5m' ? 0.25 : 0.35;
        const plan = generateFibGridPlan(smcLtf, this.balance, 0.08, minRangeReq);
        this.lastGridPlan = plan;

        if (plan && !plan.tooSmallRange) {
          const isBull = plan.trend === 'BULL';
          const inSetupRange = isBull
            ? curPrice > plan.structureFloor && curPrice <= plan.srFlipLevel * 1.015
            : curPrice < plan.structureFloor && curPrice >= plan.srFlipLevel * 0.985;

          if (inSetupRange) {
            this.activeGrid = {
              id: 'GRID_' + Date.now(),
              trend: plan.trend,
              pendingOrders: [...plan.gridOrders],
              fills: [],
              weightedEntryPrice: 0,
              totalPositionSizeUsd: 0,
              stopLoss: plan.stopLoss.price,
              srFlipLevel: plan.srFlipLevel,
              srFlipTriggered: false,
              tpLadders: [...plan.takeProfits],
              closedPnlUsd: 0,
              startTime: curLiveCandle.time
            };
            this.saveState();
          }
        }
      } else {
        this.lastGridPlan = {
          trend: smcLtf.trend,
          htfBias: htfConfluence.bias,
          blockedByHtf: true,
          message: `Dual-HTF Guardian: ${htfConfluence.reason}`
        };
      }
    }

    this.notify();
  }

  manageActiveGrid(curCandle) {
    const isBull = this.activeGrid.trend === 'BULL';

    // A. Check Order Fills
    for (let i = this.activeGrid.pendingOrders.length - 1; i >= 0; i--) {
      const order = this.activeGrid.pendingOrders[i];
      let filled = false;
      if (isBull && curCandle.low <= order.price) filled = true;
      if (!isBull && curCandle.high >= order.price) filled = true;

      if (filled) {
        const filledAmount = order.allocatedUsd;
        const oldTotal = this.activeGrid.totalPositionSizeUsd;
        const newTotal = oldTotal + filledAmount;

        if (newTotal > 0) {
          this.activeGrid.weightedEntryPrice = ((this.activeGrid.weightedEntryPrice * oldTotal) + (order.price * filledAmount)) / newTotal;
        }
        this.activeGrid.totalPositionSizeUsd = newTotal;
        this.activeGrid.fills.push({ ...order, fillPrice: order.price, fillTime: curCandle.time });
        this.activeGrid.pendingOrders.splice(i, 1);
        this.saveState();

        // Telegram Notification for Grid Fill
        telegramService.sendOrderFill(
          order,
          this.activeGrid.totalPositionSizeUsd,
          this.activeGrid.weightedEntryPrice,
          this.activeGrid.trend
        );
      }
    }

    // B. Check Stops and Profit Targets
    if (this.activeGrid.fills.length > 0) {
      let positionClosed = false;
      let exitReason = '';
      let exitPrice = 0;

      // Invalidation SL (0.0 Floor/Ceiling)
      if (isBull && curCandle.close < this.activeGrid.stopLoss) {
        exitReason = 'SL_0.0_INVALIDATION';
        exitPrice = curCandle.close;
        positionClosed = true;
      } else if (!isBull && curCandle.close > this.activeGrid.stopLoss) {
        exitReason = 'SL_0.0_INVALIDATION';
        exitPrice = curCandle.close;
        positionClosed = true;
      }

      // S/R Flip Breakeven Trigger
      if (!positionClosed && !this.activeGrid.srFlipTriggered) {
        if (isBull && curCandle.high >= this.activeGrid.srFlipLevel) {
          this.activeGrid.srFlipTriggered = true;
          this.activeGrid.stopLoss = this.activeGrid.weightedEntryPrice * 1.0008; // BE + Fee Buffer
          this.saveState();
          telegramService.sendBreakevenLock(this.activeGrid.weightedEntryPrice, this.activeGrid.srFlipLevel);
        } else if (!isBull && curCandle.low <= this.activeGrid.srFlipLevel) {
          this.activeGrid.srFlipTriggered = true;
          this.activeGrid.stopLoss = this.activeGrid.weightedEntryPrice * 0.9992;
          this.saveState();
          telegramService.sendBreakevenLock(this.activeGrid.weightedEntryPrice, this.activeGrid.srFlipLevel);
        }
      }

      // Take Profits
      if (!positionClosed) {
        for (let tpIdx = this.activeGrid.tpLadders.length - 1; tpIdx >= 0; tpIdx--) {
          const tp = this.activeGrid.tpLadders[tpIdx];
          let hit = false;
          if (isBull && curCandle.high >= tp.price) hit = true;
          if (!isBull && curCandle.low <= tp.price) hit = true;

          if (hit) {
            const portionSizeUsd = this.activeGrid.totalPositionSizeUsd * tp.exitPct;
            const pnlPct = isBull
              ? (tp.price - this.activeGrid.weightedEntryPrice) / this.activeGrid.weightedEntryPrice
              : (this.activeGrid.weightedEntryPrice - tp.price) / this.activeGrid.weightedEntryPrice;
            const pnlUsd = portionSizeUsd * pnlPct - (portionSizeUsd * 0.0008);

            this.balance += pnlUsd;
            this.activeGrid.closedPnlUsd = (this.activeGrid.closedPnlUsd || 0) + pnlUsd;
            this.activeGrid.tpLadders.splice(tpIdx, 1);
            this.saveState();

            telegramService.sendTakeProfit(tp, pnlUsd, pnlPct * 100);
          }
        }

        if (this.activeGrid.tpLadders.length === 0) {
          positionClosed = true;
          exitReason = 'ALL_FIB_TPS_HIT';
          exitPrice = isBull ? curCandle.high : curCandle.low;
        }
      }

      // Finalize Close
      if (positionClosed) {
        const remainingUsd = this.activeGrid.totalPositionSizeUsd;
        let finalTradePnl = this.activeGrid.closedPnlUsd || 0;

        if (exitReason.startsWith('SL')) {
          const slPnlPct = isBull
            ? (exitPrice - this.activeGrid.weightedEntryPrice) / this.activeGrid.weightedEntryPrice
            : (this.activeGrid.weightedEntryPrice - exitPrice) / this.activeGrid.weightedEntryPrice;
          finalTradePnl += remainingUsd * slPnlPct - (remainingUsd * 0.0008);
          this.balance += remainingUsd * slPnlPct - (remainingUsd * 0.0008);

          telegramService.sendStopLoss(exitPrice, finalTradePnl, slPnlPct * 100);
        }

        this.closedTrades.unshift({
          trend: this.activeGrid.trend,
          entryPrice: this.activeGrid.weightedEntryPrice,
          exitPrice,
          exitReason,
          fillsCount: this.activeGrid.fills.length,
          pnlUsd: Math.round(finalTradePnl * 100) / 100,
          pnlPct: Math.round((finalTradePnl / this.activeGrid.totalPositionSizeUsd) * 10000) / 100,
          srFlipSaved: this.activeGrid.srFlipTriggered,
          time: curCandle.time
        });

        this.activeGrid = null;
        this.saveState();
      }
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.tick();
    this.pollInterval = setInterval(() => this.tick(), 8000); // Poll every 8s
    console.log(`POPAT 3 SMC Dual-HTF PaperTrader started (${this.symbol} | Exec: ${this.executionTf}).`);
    this.notify();
  }

  stop() {
    this.isRunning = false;
    if (this.pollInterval) clearInterval(this.pollInterval);
    console.log(`POPAT 3 SMC Dual-HTF PaperTrader STOPPED.`);
    this.notify();
  }

  reset() {
    this.balance = this.initialCapital;
    this.activeGrid = null;
    this.closedTrades = [];
    this.saveState();
    this.notify();
  }

  subscribe(callback) {
    this.listeners.push(callback);
  }

  notify() {
    const curPrice = this.candlesLtf.length > 0 ? this.candlesLtf[this.candlesLtf.length - 1].close : 0;
    const payload = {
      isRunning: this.isRunning,
      symbol: this.symbol,
      executionTf: this.executionTf,
      curPrice,
      balance: Math.round(this.balance * 100) / 100,
      initialCapital: this.initialCapital,
      netPnlUsd: Math.round((this.balance - this.initialCapital) * 100) / 100,
      netPnlPct: Math.round(((this.balance - this.initialCapital) / this.initialCapital) * 10000) / 100,
      activeGrid: this.activeGrid,
      closedTrades: this.closedTrades.slice(0, 15),
      htfStatus: this.htfStatus,
      ltfStatus: this.ltfStatus,
      lastGridPlan: this.lastGridPlan
    };
    this.listeners.forEach(cb => cb(payload));
  }

  getStatus() {
    const curPrice = this.candlesLtf.length > 0 ? this.candlesLtf[this.candlesLtf.length - 1].close : 0;
    return {
      isRunning: this.isRunning,
      symbol: this.symbol,
      executionTf: this.executionTf,
      curPrice,
      balance: Math.round(this.balance * 100) / 100,
      initialCapital: this.initialCapital,
      netPnlUsd: Math.round((this.balance - this.initialCapital) * 100) / 100,
      netPnlPct: Math.round(((this.balance - this.initialCapital) / this.initialCapital) * 10000) / 100,
      activeGrid: this.activeGrid,
      closedTrades: this.closedTrades.slice(0, 15),
      htfStatus: this.htfStatus,
      ltfStatus: this.ltfStatus,
      lastGridPlan: this.lastGridPlan
    };
  }
}

module.exports = PaperTrader;
