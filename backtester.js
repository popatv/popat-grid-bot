/**
 * POPAT 3 SMC DUAL-HTF FIBONACCI GRID QUANT BACKTESTER
 * Multi-Timeframe Institutional Simulation:
 * - Macro HTF 1 (Daily 1D): Institutional Super-Trend (POPAT 3 SMC Pivot 30)
 * - Macro HTF 2 (4-Hour 4H): Momentum & Structure Filter (POPAT 3 SMC Pivot 30)
 * - LTF Execution (1m / 5m / 15m): Grid Limit Orders (0.50, 0.618, 0.75, 0.786), SL (0.0), S/R Flip (1.0), TP (1.272, 1.445, 1.618)
 */

const axios = require('axios');
const { calculatePivot30SMC, checkDualHtfConfluence, generateFibGridPlan } = require('./strategy');

async function fetchCandles(symbol = 'BTCUSDT', interval = '15m', limit = 1000) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await axios.get(url, { timeout: 12000 });
    return res.data.map(d => ({
      time: Math.floor(d[0] / 1000),
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5])
    }));
  } catch (err) {
    console.error(`Failed to fetch ${interval} candles:`, err.message);
    throw err;
  }
}

async function runFibGridBacktest(symbol = 'BTCUSDT', ltfInterval = '15m', limit = 1000) {
  console.log(`\n========================================================================`);
  console.log(`🚀 DUAL-HTF (1D + 4H) FIBONACCI GRID BACKTEST (${symbol} | LTF: ${ltfInterval})`);
  console.log(`========================================================================`);

  console.log(`1. Fetching Daily (1D), 4-Hour (4H), and Execution (${ltfInterval}) candles...`);
  const [candles1d, candles4h, candlesLtf] = await Promise.all([
    fetchCandles(symbol, '1d', 300),
    fetchCandles(symbol, '4h', 500),
    fetchCandles(symbol, ltfInterval, limit)
  ]);

  console.log(`   - Daily (1D) Candles:   ${candles1d.length} bars`);
  console.log(`   - 4-Hour (4H) Candles:  ${candles4h.length} bars`);
  console.log(`   - Execution (${ltfInterval}):      ${candlesLtf.length} bars`);

  const initialCapital = 25000;
  let balance = initialCapital;
  let peakBalance = initialCapital;
  let maxDrawdown = 0;
  const closedTrades = [];

  // Active Grid Position State
  let activeGrid = null;
  const lookback = 40; // Warmup for LTF SMC
  let htfFilteredTrades = 0;
  let rangeFilteredTrades = 0;

  for (let i = lookback; i < candlesLtf.length; i++) {
    const curLtf = candlesLtf[i];
    const subCandlesLtf = candlesLtf.slice(0, i + 1);

    // Synchronize Daily & 4H candles up to the current LTF timestamp
    const subCandles1d = candles1d.filter(c => c.time <= curLtf.time);
    const subCandles4h = candles4h.filter(c => c.time <= curLtf.time);

    const smc1d = subCandles1d.length >= 25 ? calculatePivot30SMC(subCandles1d, { len: 14 }) : null;
    const smc4h = subCandles4h.length >= 35 ? calculatePivot30SMC(subCandles4h, { len: 20 }) : null;

    // Check Dual-HTF Confluence (Daily + 4H)
    const htfConfluence = checkDualHtfConfluence(smc1d, smc4h);

    // 1. MANAGE ACTIVE GRID POSITION
    if (activeGrid) {
      const isBull = activeGrid.trend === 'BULL';

      // A. Check Pending Limit Order Fills
      for (let oIdx = activeGrid.pendingOrders.length - 1; oIdx >= 0; oIdx--) {
        const order = activeGrid.pendingOrders[oIdx];
        let filled = false;

        if (isBull && curLtf.low <= order.price) {
          filled = true;
        } else if (!isBull && curLtf.high >= order.price) {
          filled = true;
        }

        if (filled) {
          const filledAmount = order.allocatedUsd;
          const oldTotal = activeGrid.totalPositionSizeUsd;
          const newTotal = oldTotal + filledAmount;

          if (newTotal > 0) {
            activeGrid.weightedEntryPrice = ((activeGrid.weightedEntryPrice * oldTotal) + (order.price * filledAmount)) / newTotal;
          }
          activeGrid.totalPositionSizeUsd = newTotal;
          activeGrid.fills.push({ ...order, fillPrice: order.price, fillTime: curLtf.time });
          activeGrid.pendingOrders.splice(oIdx, 1);
        }
      }

      // If we have fills, check SL, Breakeven, and TPs
      if (activeGrid.fills.length > 0) {
        let positionClosed = false;
        let exitReason = '';
        let exitPrice = 0;

        // B. Check Structural Invalidation Stop Loss (0.0 Floor/Ceiling)
        if (isBull && curLtf.close < activeGrid.stopLoss) {
          exitReason = 'SL_0.0_INVALIDATION';
          exitPrice = curLtf.close;
          positionClosed = true;
        } else if (!isBull && curLtf.close > activeGrid.stopLoss) {
          exitReason = 'SL_0.0_INVALIDATION';
          exitPrice = curLtf.close;
          positionClosed = true;
        }

        // C. Check 1.0 S-R Flip Level (Breakeven + Lock)
        if (!positionClosed && !activeGrid.srFlipTriggered) {
          if (isBull && curLtf.high >= activeGrid.srFlipLevel) {
            activeGrid.srFlipTriggered = true;
            activeGrid.stopLoss = activeGrid.weightedEntryPrice * 1.0008; // Breakeven + fee cover
          } else if (!isBull && curLtf.low <= activeGrid.srFlipLevel) {
            activeGrid.srFlipTriggered = true;
            activeGrid.stopLoss = activeGrid.weightedEntryPrice * 0.9992;
          }
        }

        // D. Check TP Ladder Targets
        if (!positionClosed) {
          for (let tpIdx = activeGrid.tpLadders.length - 1; tpIdx >= 0; tpIdx--) {
            const tp = activeGrid.tpLadders[tpIdx];
            let hit = false;
            if (isBull && curLtf.high >= tp.price) hit = true;
            if (!isBull && curLtf.low <= tp.price) hit = true;

            if (hit) {
              const portionSizeUsd = activeGrid.totalPositionSizeUsd * tp.exitPct;
              const pnlPct = isBull
                ? (tp.price - activeGrid.weightedEntryPrice) / activeGrid.weightedEntryPrice
                : (activeGrid.weightedEntryPrice - tp.price) / activeGrid.weightedEntryPrice;
              const pnlUsd = portionSizeUsd * pnlPct - (portionSizeUsd * 0.0008); // Binance fees

              balance += pnlUsd;
              activeGrid.closedPnlUsd = (activeGrid.closedPnlUsd || 0) + pnlUsd;
              activeGrid.tpLadders.splice(tpIdx, 1);
            }
          }

          if (activeGrid.tpLadders.length === 0) {
            positionClosed = true;
            exitReason = 'ALL_FIB_TPS_HIT';
            exitPrice = isBull ? curLtf.high : curLtf.low;
          }
        }

        // Finalize Closed Trade
        if (positionClosed) {
          const remainingUsd = activeGrid.totalPositionSizeUsd;
          let finalTradePnl = activeGrid.closedPnlUsd || 0;

          if (exitReason.startsWith('SL')) {
            const slPnlPct = isBull
              ? (exitPrice - activeGrid.weightedEntryPrice) / activeGrid.weightedEntryPrice
              : (activeGrid.weightedEntryPrice - exitPrice) / activeGrid.weightedEntryPrice;
            finalTradePnl += remainingUsd * slPnlPct - (remainingUsd * 0.0008);
            balance += remainingUsd * slPnlPct - (remainingUsd * 0.0008);
          }

          closedTrades.push({
            trend: activeGrid.trend,
            entryPrice: activeGrid.weightedEntryPrice,
            exitPrice,
            exitReason,
            fillsCount: activeGrid.fills.length,
            pnlUsd: Math.round(finalTradePnl * 100) / 100,
            pnlPct: Math.round((finalTradePnl / activeGrid.totalPositionSizeUsd) * 10000) / 100,
            srFlipSaved: activeGrid.srFlipTriggered,
            time: curLtf.time
          });

          if (balance > peakBalance) peakBalance = balance;
          const dd = ((peakBalance - balance) / peakBalance) * 100;
          if (dd > maxDrawdown) maxDrawdown = dd;

          activeGrid = null;
        }
      }
    }

    // 2. SCAN FOR NEW SETUP IF IDLE
    if (!activeGrid) {
      // DUAL-HTF GUARDIAN CHECK:
      // Only proceed if 1D and 4H agree!
      if (!htfConfluence.permitted) {
        htfFilteredTrades++;
        continue;
      }

      const smcLtf = calculatePivot30SMC(subCandlesLtf, { len: ltfInterval === '1m' ? 25 : 30 });
      if (smcLtf && smcLtf.goldenZone) {
        // LTF must align with Dual-HTF Confluence Bias
        if (smcLtf.trend !== htfConfluence.bias) {
          htfFilteredTrades++;
          continue;
        }

        // Plan generation with minimum range threshold (0.15% to easily beat 0.08% fees)
        const minRangeReq = ltfInterval === '1m' ? 0.20 : ltfInterval === '5m' ? 0.25 : 0.35;
        const plan = generateFibGridPlan(smcLtf, balance, 0.08, minRangeReq);

        if (plan && plan.tooSmallRange) {
          rangeFilteredTrades++;
          continue; // Block microscopic micro-spread chop
        }

        if (plan) {
          const isBull = plan.trend === 'BULL';
          const inSetupRange = isBull
            ? curLtf.close > plan.structureFloor && curLtf.close <= plan.srFlipLevel * 1.015
            : curLtf.close < plan.structureFloor && curLtf.close >= plan.srFlipLevel * 0.985;

          if (inSetupRange) {
            activeGrid = {
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
              entryBarTime: curLtf.time
            };
          }
        }
      }
    }
  }

  // Summary Metrics
  const totalTrades = closedTrades.length;
  const winningTrades = closedTrades.filter(t => t.pnlUsd > 0);
  const losingTrades = closedTrades.filter(t => t.pnlUsd <= 0);
  const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;
  const totalNetProfitUsd = balance - initialCapital;
  const totalNetProfitPct = (totalNetProfitUsd / initialCapital) * 100;
  const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnlUsd, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnlUsd, 0));
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? 'Infinity' : '0.00';

  console.log(`\n========================================================================`);
  console.log(`📊 PERFORMANCE REPORT: ${symbol} (${ltfInterval}) with DUAL-HTF (1D + 4H)`);
  console.log(`========================================================================`);
  console.log(`Initial Sim Capital:       $${initialCapital.toLocaleString()}`);
  console.log(`Final Sim Balance:         $${Math.round(balance).toLocaleString()} (${totalNetProfitPct >= 0 ? '+' : ''}${totalNetProfitPct.toFixed(2)}%)`);
  console.log(`Completed Trades:          ${totalTrades}`);
  console.log(`Winning Trades:            ${winningTrades.length} (${winRate.toFixed(1)}% Win Rate)`);
  console.log(`Losing Trades:             ${losingTrades.length}`);
  console.log(`Profit Factor:             ${profitFactor}`);
  console.log(`Max Drawdown:              ${maxDrawdown.toFixed(2)}%`);
  console.log(`🛡️ Dual-HTF (1D+4H) Saves:  ${htfFilteredTrades} counter-trend traps blocked`);
  console.log(`⚠️ Low-Range Chop Filtered: ${rangeFilteredTrades} micro-whipsaws avoided`);
  console.log(`========================================================================\n`);

  if (closedTrades.length > 0) {
    console.log(`Sample Trades Breakdown:`);
    closedTrades.slice(-8).forEach((t, idx) => {
      console.log(`[Trade #${idx + 1}] ${t.trend} | Entry: $${t.entryPrice.toFixed(2)} | Exit: $${t.exitPrice.toFixed(2)} | Reason: ${t.exitReason} | Fills: ${t.fillsCount} | PnL: $${t.pnlUsd} (${t.pnlPct}%) | BE Saved: ${t.srFlipSaved}`);
    });
  }

  return {
    symbol,
    ltfInterval,
    initialCapital,
    finalBalance: Math.round(balance),
    totalNetProfitUsd: Math.round(totalNetProfitUsd * 100) / 100,
    totalNetProfitPct: parseFloat(totalNetProfitPct.toFixed(2)),
    totalTrades,
    winRate: parseFloat(winRate.toFixed(1)),
    profitFactor,
    maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
    htfFilteredTrades,
    rangeFilteredTrades,
    trades: closedTrades
  };
}

if (require.main === module) {
  const targetTf = process.argv[2] || '15m';
  runFibGridBacktest('BTCUSDT', targetTf, 1000).catch(err => {
    console.error('Backtest error:', err);
  });
}

module.exports = {
  runFibGridBacktest
};
