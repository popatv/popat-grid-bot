/**
 * POPAT 1 TP REVERSAL + SMA 30 SLOPE FILTER ENGINE
 * Exact Mathematical Parity with POPAT_1_TP_REVERSAL_BTC15M.pine & full_4_5_months_backtest.js
 * 
 * Strategy Rules:
 * 1. Timeframe: 15-Minute (15M)
 * 2. Moti Candle: Body >= 1.1 * ATR(14) OR Body >= 1.5 * BodySMA(14)
 * 3. TP Exhaustion Label: 7 bars after Moti candle (Rolloff trigger)
 * 4. Distance Filter: Price extended >= 1.2 * ATR away from SMA 30
 *    - Bullish Moti -> TP Above candle (Bull exhaustion)
 *    - Bearish Moti -> TP Below candle (Bear exhaustion)
 * 5. SMA 30 Slope Trend Filter (Eliminates 90%+ false trades):
 *    - SHORT ENTRY: TP Above candle AND SMA 30 sloping DOWN (sma30[i] < sma30[i-1])
 *    - LONG ENTRY:  TP Below candle AND SMA 30 sloping UP   (sma30[i] > sma30[i-1])
 * 6. Risk & Execution:
 *    - Single sniper entry at candle close
 *    - Stop Loss: 1.7 * ATR beyond candle High (Short) or Low (Long)
 *    - Take Profit: Fixed 1:2 Risk-to-Reward (R:R)
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

function computeATR(candles, period = 14) {
  const tr = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const prevC = candles[i - 1].close;
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

function computeBodySMA(candles, period = 14) {
  const bodySma = new Array(candles.length).fill(null);
  let bodySum = 0;
  for (let i = 0; i < candles.length; i++) {
    const b = Math.abs(candles[i].close - candles[i].open);
    bodySum += b;
    if (i >= period) bodySum -= Math.abs(candles[i - period].close - candles[i - period].open);
    if (i >= period - 1) bodySma[i] = bodySum / period;
  }
  return bodySma;
}

/**
 * Run historical analysis on 15M candles and return current indicators + latest signal
 */
function analyzeTpReversal(candles, options = {}) {
  const useSma30Filter = options.useSma30Filter !== false; // Default true
  const slAtrMult = options.slAtrMult || 1.7;
  const rrRatio = options.rrRatio || 2.0;
  const tpMotiThresh = options.tpMotiThresh || 1.1;
  const tpSma30DistMult = options.tpSma30DistMult || 1.2;
  const sma7Len = 7;

  if (!candles || candles.length < 35) {
    return {
      signal: null,
      status: 'INSUFFICIENT_DATA',
      sma30: null,
      sma30Slope: 'FLAT',
      atr: null
    };
  }

  const sma30 = computeSMA(candles, 30);
  const atr = computeATR(candles, 14);
  const bodySma = computeBodySMA(candles, 14);

  let moti7BarIdx = null;
  let moti7IsBull = true;
  let moti7BodyVal = 0.0;

  const signals = [];

  for (let i = 35; i < candles.length; i++) {
    const c = candles[i];
    const curAtr = atr[i];
    const curSma30 = sma30[i];

    if (!curAtr || !curSma30) continue;

    const curBarBody = Math.abs(c.close - c.open);
    const curIsMoti = (curBarBody >= curAtr * tpMotiThresh) || (bodySma[i] && curBarBody >= bodySma[i] * 1.5);

    if (moti7BarIdx !== null && (i - moti7BarIdx > sma7Len)) {
      moti7BarIdx = null;
      moti7BodyVal = 0.0;
    }

    if (curIsMoti) {
      if (moti7BarIdx === null || (i - moti7BarIdx >= sma7Len) || (curBarBody >= moti7BodyVal * 0.85)) {
        moti7BarIdx = i;
        moti7IsBull = c.close >= c.open;
        moti7BodyVal = curBarBody;
      }
    }

    const tpRolloffTrigger = (moti7BarIdx !== null) && (i - moti7BarIdx === sma7Len);
    const isFarFromSma30 = moti7IsBull
      ? ((c.close - curSma30) >= (curAtr * tpSma30DistMult))
      : ((curSma30 - c.close) >= (curAtr * tpSma30DistMult));

    let tpAbove = false;
    let tpBelow = false;

    if (tpRolloffTrigger && isFarFromSma30) {
      if (moti7IsBull) tpAbove = true;
      else tpBelow = true;
    }

    const prevSma30 = sma30[i - 1];
    const sma30SlopeDn = curSma30 < prevSma30;
    const sma30SlopeUp = curSma30 > prevSma30;

    const allowShort = tpAbove && (!useSma30Filter || sma30SlopeDn);
    const allowLong  = tpBelow && (!useSma30Filter || sma30SlopeUp);

    if (allowShort) {
      const entry = c.close;
      const sl = c.high + (curAtr * slAtrMult);
      const risk = sl - entry;
      const tp = entry - (risk * rrRatio);
      signals.push({
        barIndex: i,
        time: c.time,
        type: 'SHORT',
        entry,
        sl,
        tp,
        risk,
        atr: curAtr,
        sma30: curSma30,
        sma30Slope: 'DOWN'
      });
    } else if (allowLong) {
      const entry = c.close;
      const sl = c.low - (curAtr * slAtrMult);
      const risk = entry - sl;
      const tp = entry + (risk * rrRatio);
      signals.push({
        barIndex: i,
        time: c.time,
        type: 'LONG',
        entry,
        sl,
        tp,
        risk,
        atr: curAtr,
        sma30: curSma30,
        sma30Slope: 'UP'
      });
    }
  }

  const lastIdx = candles.length - 1;
  const curSma30 = sma30[lastIdx];
  const prevSma30 = sma30[lastIdx - 1];
  const curAtr = atr[lastIdx];
  const slope = curSma30 > prevSma30 ? 'UP' : curSma30 < prevSma30 ? 'DOWN' : 'FLAT';

  // Check if the most recent closed candle has a signal
  const latestSignal = signals.length > 0 ? signals[signals.length - 1] : null;
  const isSignalOnLatestBar = latestSignal && (latestSignal.barIndex === lastIdx || latestSignal.barIndex === lastIdx - 1);

  return {
    latestSignal: isSignalOnLatestBar ? latestSignal : null,
    allSignals: signals,
    sma30: curSma30,
    sma30Slope: slope,
    atr: curAtr,
    lastCandle: candles[lastIdx]
  };
}

module.exports = {
  analyzeTpReversal,
  computeSMA,
  computeATR,
  computeBodySMA
};
