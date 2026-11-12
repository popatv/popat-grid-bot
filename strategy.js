/**
 * POPAT 3 SMC FIBONACCI MARKET MAKER ENGINE
 * Exact Mathematical Parity with POPAT 3 SMC.pine & smcEngine.js
 * 
 * Core Features:
 * 1. Pivot 30 Macro Swing High & Low Detection (ta.pivothigh / ta.pivotlow len=30)
 * 2. Dynamic BOS / CHoCH Break of Structure Engine
 * 3. Exact Pine Script Fibonacci Anchoring:
 *    - BULL: fibStartPrice = btmy (0.0 Floor), fibEndPrice = topy (1.0 Ceiling)
 *    - BEAR: fibStartPrice = topy (0.0 Ceiling), fibEndPrice = btmy (1.0 Floor)
 * 4. Institutional Grid Levels:
 *    - 0.000: Structural Invalidation Floor/Ceiling (Hard Stop Loss)
 *    - 0.382: Shallow Retrace
 *    - 0.500: Equilibrium (Fair Value Grid Order 1 - 20% size)
 *    - 0.618: Golden Ratio Pocket (Grid Order 2 - 35% size)
 *    - 0.750: Institutional OTE Reload (Grid Order 3 - 25% size)
 *    - 0.786: Deep Liquidity Sweep (Grid Order 4 - 20% size)
 *    - 1.000: End Point / S-R Flip (Breakeven + Trail SL trigger)
 *    - 1.272: TP1 Expansion (Close 35%)
 *    - 1.445: TP2 Mid Expansion (Close 35%)
 *    - 1.618: TP3 Golden Expansion (Close 30%)
 * 5. Multi-Timeframe Dual HTF Guardian:
 *    - HTF 1 (Daily 1D): Institutional Macro Super-Trend
 *    - HTF 2 (4H): Swing Momentum & Structure Filter
 *    - LTF (1m, 5m, 15m): Rapid Precision Execution Grid
 */

function calculatePivot30SMC(candles, options = {}) {
  const defaultLen = options.len || 30;
  if (!candles || candles.length < 15) {
    return null;
  }

  const n = candles.length;
  // Adaptive pivot length for low candle counts
  const len = n < defaultLen * 2
    ? Math.max(3, Math.min(defaultLen, Math.floor(n / 4)))
    : defaultLen;

  let os = candles[Math.min(10, n - 1)].close >= candles[0].close ? 1 : 0; // 1 = BULL, 0 = BEAR
  let topy = null;
  let topx = null;
  let btmy = null;
  let btmx = null;
  let top_crossed = false;
  let btm_crossed = false;

  let fibStartPrice = null;
  let fibEndPrice = null;
  let fibStartIndex = null;
  let lastFibDirection = 1; // 1 = BULL, 0 = BEAR

  const swings = [];
  const structures = [];

  // Bar-by-bar execution mirroring Pine Script
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const p = i - len;

    if (p >= len && p + len <= i) {
      // Pivot High (Macro 30)
      let isPh = true;
      const phVal = candles[p].high;
      for (let j = p - len; j <= p + len; j++) {
        if (candles[j].high > phVal) {
          isPh = false;
          break;
        }
      }
      if (isPh) {
        topy = phVal;
        topx = p;
        top_crossed = false;
        swings.push({ index: p, time: candles[p].time, price: topy, type: 'HIGH' });
      }

      // Pivot Low (Macro 30)
      let isPl = true;
      const plVal = candles[p].low;
      for (let j = p - len; j <= p + len; j++) {
        if (candles[j].low < plVal) {
          isPl = false;
          break;
        }
      }
      if (isPl) {
        btmy = plVal;
        btmx = p;
        btm_crossed = false;
        swings.push({ index: p, time: candles[p].time, price: btmy, type: 'LOW' });
      }
    }

    // Structure Breaks (BOS / CHoCH)
    const bullMajorBreak = topy !== null && c.close > topy && !top_crossed;
    const bearMajorBreak = btmy !== null && c.close < btmy && !btm_crossed;

    if (bullMajorBreak) {
      const isChoch = os === 0;
      os = 1;
      top_crossed = true;
      structures.push({
        index: i,
        time: c.time,
        price: topy,
        type: isChoch ? 'CHoCH' : 'BOS',
        direction: 'BULL'
      });

      // Update Fibonacci anchors upon Bullish break
      fibStartPrice = btmy !== null ? btmy : c.low;
      fibEndPrice = topy !== null ? topy : c.high;
      fibStartIndex = btmx !== null ? btmx : i;
      lastFibDirection = 1;
    }

    if (bearMajorBreak) {
      const isChoch = os === 1;
      os = 0;
      btm_crossed = true;
      structures.push({
        index: i,
        time: c.time,
        price: btmy,
        type: isChoch ? 'CHoCH' : 'BOS',
        direction: 'BEAR'
      });

      // Update Fibonacci anchors upon Bearish break
      fibStartPrice = topy !== null ? topy : c.high;
      fibEndPrice = btmy !== null ? btmy : c.low;
      fibStartIndex = topx !== null ? topx : i;
      lastFibDirection = 0;
    }
  }

  // Active Fibonacci synchronization
  if (topy !== null && btmy !== null) {
    if (os === 1) {
      fibStartPrice = btmy;
      fibEndPrice = topy;
      fibStartIndex = btmx || 0;
      lastFibDirection = 1;
    } else {
      fibStartPrice = topy;
      fibEndPrice = btmy;
      fibStartIndex = topx || 0;
      lastFibDirection = 0;
    }
  }

  // Fallback if pivots not yet locked
  if (fibStartPrice === null || fibEndPrice === null) {
    let macroHigh = -Infinity;
    let macroLow = Infinity;
    for (let k = 0; k < n; k++) {
      if (candles[k].high > macroHigh) macroHigh = candles[k].high;
      if (candles[k].low < macroLow) macroLow = candles[k].low;
    }
    const isBullAdv = candles[n - 1].close >= (macroHigh + macroLow) / 2;
    fibStartPrice = isBullAdv ? macroLow : macroHigh;
    fibEndPrice = isBullAdv ? macroHigh : macroLow;
    lastFibDirection = isBullAdv ? 1 : 0;
  }

  // Compute all Exact POPAT 3 SMC Fibonacci Levels
  const rng = fibEndPrice - fibStartPrice;
  const fibRatios = [
    { ratio: 0.000, label: '0.0 (Start / Floor)', isStopLoss: true },
    { ratio: 0.236, label: '0.236 (Shallow)', isInfo: true },
    { ratio: 0.382, label: '0.382 (Mild Retrace)', isInfo: true },
    { ratio: 0.500, label: '0.500 (EQ Fair Value)', isGridOrder: true, weight: 0.20 },
    { ratio: 0.618, label: '0.618 (Golden Pocket)', isGridOrder: true, weight: 0.35 },
    { ratio: 0.750, label: '0.750 (Institutional OTE)', isGridOrder: true, weight: 0.25 },
    { ratio: 0.786, label: '0.786 (Deep Liquidity Sweep)', isGridOrder: true, weight: 0.20 },
    { ratio: 1.000, label: '1.0 (End / S-R Flip)', isBreakevenTrigger: true },
    { ratio: 1.272, label: '1.272 (TP1 Expansion)', isTakeProfit: true, exitPct: 0.35 },
    { ratio: 1.445, label: '1.445 (TP2 Mid Expansion)', isTakeProfit: true, exitPct: 0.35 },
    { ratio: 1.618, label: '1.618 (TP3 Golden Target)', isTakeProfit: true, exitPct: 0.30 },
    { ratio: 2.000, label: '2.000 (TP4 Macro Target)', isTakeProfit: false }
  ];

  const levels = {};
  const levelsList = [];
  for (const f of fibRatios) {
    const price = Math.round((fibStartPrice + rng * f.ratio) * 100) / 100;
    const item = { ...f, price };
    levels[f.ratio.toString()] = item;
    levels[f.ratio.toFixed(1)] = item;
    levels[f.ratio.toFixed(3)] = item;
    levelsList.push(item);
  }

  const currentPrice = candles[n - 1].close;
  const rangeAbs = Math.abs(rng);

  return {
    trend: os === 1 ? 'BULL' : 'BEAR',
    os,
    fibStartPrice,
    fibEndPrice,
    fibStartIndex,
    range: rangeAbs,
    levels,
    levelsList,
    swingHigh: topy,
    swingLow: btmy,
    goldenZone: {
      top: Math.max(levels['0.618'].price, levels['0.786'].price),
      bottom: Math.min(levels['0.618'].price, levels['0.786'].price)
    },
    currentPrice,
    lastStructure: structures.length > 0 ? structures[structures.length - 1] : null
  };
}

/**
 * Institutional Dual HTF Confluence Guardian (Daily 1D + 4H)
 * Strict Rule: Only permits trades when both Daily and 4H agree on the Macro Structure.
 */
function checkDualHtfConfluence(dailySMC, fourHourSMC) {
  if (!dailySMC || !fourHourSMC) {
    return { permitted: false, bias: 'NEUTRAL', reason: 'HTF data warming up' };
  }

  if (dailySMC.trend === 'BULL' && fourHourSMC.trend === 'BULL') {
    return { permitted: true, bias: 'BULL', reason: 'Daily + 4H Bullish Confluence Locked' };
  }

  if (dailySMC.trend === 'BEAR' && fourHourSMC.trend === 'BEAR') {
    return { permitted: true, bias: 'BEAR', reason: 'Daily + 4H Bearish Confluence Locked' };
  }

  return {
    permitted: false,
    bias: 'CONFLICT',
    reason: `HTF Divergence: Daily is ${dailySMC.trend} but 4H is ${fourHourSMC.trend}. Blocked!`
  };
}

/**
 * Institutional Market Maker Fibonacci Grid Plan
 * Generates exact limit orders, invalidation stop-loss, and multi-tier take-profit ladders.
 */
function generateFibGridPlan(smcData, totalCapital = 25000, riskPerSetupPct = 0.05, minRangePct = 0.15) {
  if (!smcData) return null;

  // Filter out microscopic micro-whipsaws where range is too small to cover fees
  const rangePct = (smcData.range / smcData.currentPrice) * 100;
  if (rangePct < minRangePct) {
    return { tooSmallRange: true, rangePct, minRangePct };
  }

  const isBull = smcData.trend === 'BULL';
  const allocatableCapital = totalCapital * riskPerSetupPct;

  const gridOrders = [];
  const takeProfits = [];
  const stopLoss = {
    price: smcData.levels['0.0'].price,
    label: isBull ? '0.0 Structural Floor Stop' : '0.0 Structural Ceiling Stop',
    ratio: 0.0
  };

  // 4 Institutional Limit Orders inside Discount / Premium Zone
  const orderLevels = ['0.5', '0.618', '0.75', '0.786'];
  for (const key of orderLevels) {
    const lvl = smcData.levels[key];
    if (lvl) {
      gridOrders.push({
        ratio: lvl.ratio,
        price: lvl.price,
        label: lvl.label,
        weight: lvl.weight,
        allocatedUsd: Math.round(allocatableCapital * lvl.weight * 100) / 100,
        type: isBull ? 'LIMIT_BUY' : 'LIMIT_SELL'
      });
    }
  }

  // 3 Take Profit Extension Targets
  const tpLevels = ['1.272', '1.445', '1.618'];
  for (const key of tpLevels) {
    const lvl = smcData.levels[key];
    if (lvl) {
      takeProfits.push({
        ratio: lvl.ratio,
        price: lvl.price,
        label: lvl.label,
        exitPct: lvl.exitPct,
        type: isBull ? 'LIMIT_SELL' : 'LIMIT_BUY'
      });
    }
  }

  return {
    trend: smcData.trend,
    currentPrice: smcData.currentPrice,
    structureFloor: smcData.fibStartPrice,
    structureCeiling: smcData.fibEndPrice,
    srFlipLevel: smcData.levels['1.0'].price,
    stopLoss,
    gridOrders,
    takeProfits,
    goldenZone: smcData.goldenZone,
    rangePct: parseFloat(rangePct.toFixed(2))
  };
}

module.exports = {
  calculatePivot30SMC,
  checkDualHtfConfluence,
  generateFibGridPlan
};
