/**
 * POPAT 1 TP REVERSAL TELEGRAM NOTIFICATION & COMMAND SERVICE
 * Real-time Mobile Alerts for Sniper Reversal Entries, 1:2 RR TP Hits, and Stop Loss across BTC, ETH, SOL, GOLD
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'telegram_config.json');

class TelegramService {
  constructor(token = '9027908557:AAEQf4oopnhrX6wKeJeMBJ0gNGKokIDAyL8') {
    this.token = token;
    this.chatId = null;
    this.pollingOffset = 0;
    this.isPolling = false;
    this.botInstance = null;

    this.loadConfig();
  }

  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        this.chatId = data.chatId || null;
        if (this.chatId) {
          console.log(`Telegram Chat ID loaded: ${this.chatId}`);
        }
      }
    } catch (e) {
      console.error('Error loading telegram config:', e.message);
    }
  }

  saveConfig() {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({
        token: this.token,
        chatId: this.chatId
      }, null, 2), 'utf8');
    } catch (e) {
      console.error('Error saving telegram config:', e.message);
    }
  }

  setChatId(id) {
    this.chatId = id;
    this.saveConfig();
  }

  setBotInstance(bot) {
    this.botInstance = bot;
  }

  async send(text) {
    if (!this.chatId) {
      console.log('Telegram message skipped (Chat ID not set yet).');
      return;
    }
    try {
      await axios.post(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        chat_id: this.chatId,
        text,
        parse_mode: 'Markdown'
      }, { timeout: 8000 });
    } catch (err) {
      console.error('Failed to send Telegram message:', err.message);
    }
  }

  // --- PRE-FORMATTED ALERTS ---

  async sendWelcome(name = 'Trader') {
    const msg = `🦜 *POPAT 1 TP REVERSAL (BTC + ETH + SOL + GOLD) ACTIVATED!* 🚀\n\n` +
      `નમસ્તે ${name}!\n` +
      `તમારો @popatgridbot હવે *BTC, ETH, SOL અને GOLD (PAXG)* ચારેય એસેટ્સ પર એકસાથે લાઈવ સ્કેનિંગ અને ટ્રેડિંગ માટે તૈયાર છે!\n\n` +
      `⚙️ *નવી Strategy Details:*\n` +
      `• Pairs: *BTC, ETH, SOL, PAXG/Gold (15M)*\n` +
      `• Entry Trigger: *7th Bar Moti Exhaustion TP + 1.2x ATR Distance*\n` +
      `• Trend Filter: *SMA 30 Slope*\n` +
      `  - *SHORT*: TP Above Candle + SMA 30 Sloping DOWN\n` +
      `  - *LONG*: TP Below Candle + SMA 30 Sloping UP\n` +
      `• Stop Loss: *1.7 ATR Beyond Candle Wick*\n` +
      `• Take Profit: *Fixed 1:2 Risk-to-Reward (R:R)*\n` +
      `• Allocation: *$5,000 per trade* (Total: $25,000)\n\n` +
      `📱 *કોઈપણ પેર પર સિગ્નલ બનશે એટલે તુરંત એન્ટ્રી, 1:2 TP અને SL નો મેસેજ અહીં પહોંચી જશે!*`;
    await this.send(msg);
  }

  async sendPositionEntry(pos) {
    const isLong = pos.type === 'LONG';
    const entry = Number(pos.entryPrice || 0);
    const sl = Number(pos.stopLoss || 0);
    const tp = Number(pos.takeProfit || 0);
    const riskUsd = Number(pos.riskUsd || 0);
    const potentialProfit = riskUsd * 2;
    const isGold = pos.symbol === 'PAXGUSDT';
    const pairLabel = isGold ? 'PAXGUSDT (Gold)' : pos.symbol;

    const msg = `${isLong ? '🟢' : '🔴'} *🎯 POPAT 1 TP REVERSAL ENTRY!* [${isGold ? '🥇 ' : ''}${pairLabel}]\n\n` +
      `🪙 *Asset:* *${pairLabel}* (15M)\n` +
      `🧭 *Direction:* *${pos.type}*\n` +
      `💵 *Entry Price:* $${entry.toFixed(2)}\n` +
      `🛑 *Stop Loss (1.7 ATR):* $${sl.toFixed(2)}\n` +
      `🎯 *Take Profit (1:2 RR):* $${tp.toFixed(2)}\n` +
      `📈 *SMA 30 Slope:* Sloping *${pos.sma30Slope}* ✅ (Filter Passed)\n` +
      `📦 *Position Size:* $${Number(pos.sizeUsd || 5000).toLocaleString()}\n` +
      `⚖️ *Risk : Reward:* 1 : 2 (Risk: -$${riskUsd.toFixed(2)} | Target: +$${potentialProfit.toFixed(2)})\n\n` +
      `*Sniper Reversal Trade Active on ${pairLabel}!* 🏹`;
    await this.send(msg);
  }

  async sendTakeProfit(trade) {
    const isLong = trade.type === 'LONG';
    const entry = Number(trade.entryPrice || 0);
    const exit = Number(trade.exitPrice || 0);
    const profit = Number(trade.pnlUsd || 0);
    const pct = Number(trade.pnlPct || 0);
    const bal = Number(trade.newBalance || 0);
    const isGold = trade.symbol === 'PAXGUSDT';
    const pairLabel = isGold ? 'PAXGUSDT (Gold)' : trade.symbol;

    const msg = `💰 *🎯 TAKE PROFIT HIT (1:2 RR)!* 🚀\n\n` +
      `${isLong ? '🟢' : '🔴'} *Asset:* *${pairLabel}* (${trade.type})\n` +
      `💵 *Entry Price:* $${entry.toFixed(2)}\n` +
      `🏁 *Exit Price:* $${exit.toFixed(2)}\n` +
      `🎉 *Realized Profit:* *+$${profit.toFixed(2)}* (+${pct.toFixed(2)}%)\n` +
      `🏦 *New Account Balance:* *$${bal.toLocaleString()}*\n\n` +
      `*1:2 Target Successfully Achieved on ${pairLabel}!* 🥂`;
    await this.send(msg);
  }

  async sendStopLoss(trade) {
    const isLong = trade.type === 'LONG';
    const entry = Number(trade.entryPrice || 0);
    const exit = Number(trade.exitPrice || 0);
    const loss = Number(trade.pnlUsd || 0);
    const pct = Number(trade.pnlPct || 0);
    const bal = Number(trade.newBalance || 0);
    const isGold = trade.symbol === 'PAXGUSDT';
    const pairLabel = isGold ? 'PAXGUSDT (Gold)' : trade.symbol;

    const msg = `🛑 *STOP LOSS TRIGGERED*\n\n` +
      `${isLong ? '🟢' : '🔴'} *Asset:* *${pairLabel}* (${trade.type})\n` +
      `💵 *Entry Price:* $${entry.toFixed(2)}\n` +
      `🏁 *Exit Price:* $${exit.toFixed(2)} (1.7 ATR)\n` +
      `📉 *Net PnL:* *-$${Math.abs(loss).toFixed(2)}* (${pct.toFixed(2)}%)\n` +
      `🏦 *New Account Balance:* *$${bal.toLocaleString()}*\n\n` +
      `મૂડી સુરક્ષિત રાખવા માટે પોઝિશન નિયમ મુજબ ક્લોઝ કરવામાં આવી છે.`;
    await this.send(msg);
  }

  async sendStatus(status) {
    const balance = Number(status.balance || 0);
    const netPnlUsd = Number(status.netPnlUsd || 0);
    const mData = status.marketData || {};

    let pairsText = '';
    ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'PAXGUSDT'].forEach(s => {
      const d = mData[s] || {};
      const pos = status.positionsMap ? status.positionsMap[s] : null;
      const slopeIcon = d.sma30Slope === 'DOWN' ? '🔻' : d.sma30Slope === 'UP' ? '🔺' : '➖';
      const label = s === 'PAXGUSDT' ? '🥇 Gold (PAXG)' : s;
      
      let pStatus = '⚪ FLAT (Scanning)';
      if (pos) {
        pStatus = `${pos.type === 'LONG' ? '🟢 LONG' : '🔴 SHORT'} @ $${Number(pos.entryPrice).toFixed(2)} (TP: $${Number(pos.takeProfit).toFixed(2)})`;
      }

      pairsText += `• *${label}:* $${Number(d.curPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} | SMA 30: ${d.sma30Slope || 'FLAT'} ${slopeIcon}\n  └ Status: ${pStatus}\n`;
    });

    const msg = `📊 *POPAT 1 MULTI-ASSET (15M) STATUS*\n\n` +
      `• Status: *${status.isRunning ? 'RUNNING 🟢' : 'STOPPED 🛑'}*\n` +
      `• Timeframe: *15M Live Binance Feed*\n` +
      `• Virtual Balance: *$${balance.toLocaleString()}*\n` +
      `• Net Realized PnL: *${netPnlUsd >= 0 ? '+' : ''}$${netPnlUsd.toFixed(2)}*\n` +
      `• Closed Trades: *${status.totalTrades || 0}* (Win Rate: *${status.winRate || '0.0'}%*)\n\n` +
      `🪙 *Monitored Assets:*\n${pairsText}`;
    await this.send(msg);
  }

  // --- TELEGRAM POLLING FOR LIVE COMMANDS ---
  startPolling() {
    if (this.isPolling) return;
    this.isPolling = true;

    const poll = async () => {
      if (!this.isPolling) return;
      try {
        const res = await axios.get(`https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.pollingOffset}&timeout=5`, { timeout: 10000 });
        if (res.data.result && res.data.result.length > 0) {
          for (const u of res.data.result) {
            this.pollingOffset = u.update_id + 1;
            if (u.message && u.message.chat) {
              const incomingChatId = u.message.chat.id;
              const text = (u.message.text || '').trim();
              const firstName = (u.message.from && u.message.from.first_name) || 'Trader';

              if (this.chatId !== incomingChatId) {
                this.setChatId(incomingChatId);
                console.log(`Telegram Chat ID registered: ${incomingChatId} (${firstName})`);
              }

              if (text === '/start' || text.toLowerCase() === 'hi' || text.toLowerCase() === 'hello') {
                await this.sendWelcome(firstName);
              } else if (text === '/status' && this.botInstance) {
                await this.sendStatus(this.botInstance.getStatus());
              } else if (text === '/stop' && this.botInstance) {
                this.botInstance.stop();
                await this.send(`🛑 *Bot execution has been PAUSED via Telegram!*`);
              } else if (text === '/startbot' && this.botInstance) {
                this.botInstance.start();
                await this.send(`🟢 *Bot execution has been RESUMED via Telegram!*`);
              } else if (text === '/balance' && this.botInstance) {
                const s = this.botInstance.getStatus();
                await this.send(`💰 *Account Balance:* $${s.balance.toLocaleString()} | *PnL:* ${s.netPnlUsd >= 0 ? '+' : ''}$${s.netPnlUsd.toFixed(2)}`);
              }
            }
          }
        }
      } catch (err) { }
      setTimeout(poll, 2500);
    };

    poll();
    console.log('Telegram command polling started.');
  }

  stopPolling() {
    this.isPolling = false;
  }
}

module.exports = new TelegramService();
