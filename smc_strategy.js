/**
 * POPAT 3 NORMAL SNIPER SMC ENGINE (Pivot 10 + OTE Golden Pocket + Volume Confirmation)
 * Single-Entry Sniper Execution (No Grid) with 1:2 RR Take Profit
 * Rules:
 * 1. Pivot 10 Swing High/Low Structure Detection
 * 2. Break of Structure (BOS)
 * 3. Optimal Trade Entry (OTE 0.618 - 0.786 Golden Pocket Retest)
 * 4. Volume Expansion Filter (Volume >= 1.1x 20-period Volume SMA)
 * 5. Reversal Confirmation Candle (Rejection wick + strong close)
 * 6. Stop Loss: Invalidation beyond Swing High / Low (+ 0.3 ATR buffer)
 * 7. Take Profit: Fixed 1:2 Risk-to-Reward (R:R)
 */

function computeSMA(candles, length) {
  const sma = new Array(candles.length).fill(null);
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= length) sum -= candles[i - length].close;
    if (i >= length - 1) sma[i] = sum / length;
  }
  return sma;
}

function computeVolumeSMA(candles, length = 20) {
  const vSma = new Array(candles.length).fill(0);
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].volume;
    if (i >= length) sum -= candles[i - length].volume;
    if (i >= length - 1) vSma[i] = sum / length;
  }
  return vSma;
}

function computeATR(candles, period = 14) {
  const tr = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, prevC = candles[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
  }
  const atr = new Array(candles.length).fill(null);
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  atr[period] = sum / period;
  for (let i = period + 1; i < candles.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

function calculateSMC(candles, options = {}) {
  const pivotLen = options.pivotLen || 10; // Pivot 10 as specified by user
  const rrRatio = options.rrRatio || 2.0;
  const n = candles ? candles.length : 0;

  if (!candles || n < pivotLen * 2 + 5) {
    return {
      trend: 'NEUTRAL',
      swingHigh: null,
      swingLow: null,
      fibLevels: null,
      signal: null,
      lastBOS: null
    };
  }

  const volSma = computeVolumeSMA(candles, 20);
  const atr = computeATR(candles, 14);

  let topy = null;
  let btmy = null;
  let trend = 'NEUTRAL';
  let top_crossed = false;
  let btm_crossed = false;
  let lastBOS = null;

  const signals = [];

  for (let i = pivotLen * 2; i < n; i++) {
    const p = i - pivotLen;
    const c = candles[i];
    const prevC = candles[i - 1];

    // Pivot High (len=10)
    let isPh = true;
    for (let j = p - pivotLen; j <= p + pivotLen; j++) {
      if (candles[j].high > candles[p].high) {
        isPh = false;
        break;
      }
    }
    if (isPh) {
      topy = candles[p].high;
      top_crossed = false;
    }

    // Pivot Low (len=10)
    let isPl = true;
    for (let j = p - pivotLen; j <= p + pivotLen; j++) {
      if (candles[j].low < candles[p].low) {
        isPl = false;
        break;
      }
    }
    if (isPl) {
      btmy = candles[p].low;
      btm_crossed = false;
    }

    // BOS Structure Check
    if (topy !== null && c.close > topy && !top_crossed) {
      trend = 'BULL';
      top_crossed = true;
      lastBOS = { type: 'BULLISH_BOS', price: topy, barIndex: i, time: c.time };
    } else if (btmy !== null && c.close < btmy && !btm_crossed) {
      trend = 'BEAR';
      btm_crossed = true;
      lastBOS = { type: 'BEARISH_BOS', price: btmy, barIndex: i, time: c.time };
    }

    // Check OTE Sniper Entry Trigger
    if (topy !== null && btmy !== null && topy > btmy) {
      const range = topy - btmy;
      const curAtr = atr[i] || (c.high - c.low);
      const volOk = volSma[i] > 0 && c.volume >= volSma[i] * 1.1;

      if (trend === 'BULL') {
        const fib618 = topy - range * 0.618;
        const fib786 = topy - range * 0.786;
        const touchedOte = prevC.low <= fib618 && prevC.low >= btmy;
        const reversalBar = c.close > c.open && c.close > prevC.high;

        if (touchedOte && reversalBar && volOk) {
          const entry = c.close;
          const sl = btmy - curAtr * 0.3;
          const risk = entry - sl;
          if (risk > 0 && risk < curAtr * 4) {
            signals.push({
              barIndex: i,
              time: c.time,
              type: 'LONG',
              entry,
              sl,
              tp: entry + risk * rrRatio,
              risk,
              reason: 'SMC Bullish OTE Retest + Volume Reversal'
            });
          }
        }
      } else if (trend === 'BEAR') {
        const fib618 = btmy + range * 0.618;
        const fib786 = btmy + range * 0.786;
        const touchedOte = prevC.high >= fib618 && prevC.high <= topy;
        const reversalBar = c.close < c.open && c.close < prevC.low;

        if (touchedOte && reversalBar && volOk) {
          const entry = c.close;
          const sl = topy + curAtr * 0.3;
          const risk = sl - entry;
          if (risk > 0 && risk < curAtr * 4) {
            signals.push({
              barIndex: i,
              time: c.time,
              type: 'SHORT',
              entry,
              sl,
              tp: entry - risk * rrRatio,
              risk,
              reason: 'SMC Bearish OTE Retest + Volume Reversal'
            });
          }
        }
      }
    }
  }

  // Calculate Fibonacci levels for UI
  let fibLevels = null;
  if (topy !== null && btmy !== null && topy > btmy) {
    const range = topy - btmy;
    if (trend === 'BULL') {
      fibLevels = {
        direction: 'BULL',
        invalidation_0: btmy,
        golden_618: topy - range * 0.618,
        ote_786: topy - range * 0.786,
        breakout_100: topy
      };
    } else {
      fibLevels = {
        direction: 'BEAR',
        invalidation_0: topy,
        golden_618: btmy + range * 0.618,
        ote_786: btmy + range * 0.786,
        breakout_100: btmy
      };
    }
  }

  const lastSignal = signals.length > 0 ? signals[signals.length - 1] : null;
  const isSignalOnLatest = lastSignal && (lastSignal.barIndex === n - 1 || lastSignal.barIndex === n - 2);

  return {
    trend,
    swingHigh: topy,
    swingLow: btmy,
    fibLevels,
    signal: isSignalOnLatest ? lastSignal : null,
    allSignals: signals,
    lastBOS,
    atr: atr[n - 1]
  };
}

module.exports = {
  calculateSMC,
  computeSMA,
  computeVolumeSMA,
  computeATR
};
