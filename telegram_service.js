/**
 * POPAT 1 TP REVERSAL TELEGRAM NOTIFICATION & COMMAND SERVICE
 * Real-time Mobile Alerts for Sniper Reversal Entries, 1:2 RR TP Hits, and Stop Loss
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
    this.botInstance = null; // reference to PaperTrader

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
    const msg = `🦜 *POPAT 1 TP REVERSAL + SMA 30 BOT ACTIVATED!* 🚀\n\n` +
      `નમસ્તે ${name}!\n` +
      `તમારો @popatgridbot નવી 15M TP Reversal Strategy સાથે કનેક્ટ થઈ ગયો છે.\n\n` +
      `⚙️ *નવી Strategy Details (13,000 Candles Tested):*\n` +
      `• Timeframe: *15-Minute (15M)*\n` +
      `• Entry Trigger: *7th Bar Moti Exhaustion TP + 1.2x ATR Distance*\n` +
      `• Trend Filter: *SMA 30 Slope (Eliminates 90%+ false trades)*\n` +
      `  - *SHORT*: TP Above Candle + SMA 30 Sloping DOWN\n` +
      `  - *LONG*: TP Below Candle + SMA 30 Sloping UP\n` +
      `• Stop Loss: *1.7 ATR Beyond Candle Wick*\n` +
      `• Take Profit: *Fixed 1:2 Risk-to-Reward (R:R)*\n` +
      `• Position Size: *$5,000 Virtual Allocation*\n\n` +
      `📱 *હવે જ્યારે પણ નવો ટ્રેડ પડશે, 1:2 TP હિટ થશે કે SL વાગશે ત્યારે તુરંત મેસેજ અહીં મળશે!*`;
    await this.send(msg);
  }

  async sendPositionEntry(pos) {
    const isLong = pos.type === 'LONG';
    const entry = Number(pos.entryPrice || 0);
    const sl = Number(pos.stopLoss || 0);
    const tp = Number(pos.takeProfit || 0);
    const riskUsd = Number(pos.riskUsd || 0);
    const potentialProfit = riskUsd * 2;

    const msg = `${isLong ? '🟢' : '🔴'} *🎯 POPAT 1 TP REVERSAL ENTRY!* [${pos.type}]\n\n` +
      `🪙 *Pair:* ${pos.symbol} (15M)\n` +
      `💵 *Entry Price:* $${entry.toFixed(2)}\n` +
      `🛑 *Stop Loss (1.7 ATR):* $${sl.toFixed(2)}\n` +
      `🎯 *Take Profit (1:2 RR):* $${tp.toFixed(2)}\n` +
      `📈 *SMA 30 Slope:* Sloping *${pos.sma30Slope}* ✅ (Filter Passed)\n` +
      `📦 *Position Size:* $${Number(pos.sizeUsd || 5000).toLocaleString()}\n` +
      `⚖️ *Risk : Reward:* 1 : 2 (Risk: -$${riskUsd.toFixed(2)} | Target: +$${potentialProfit.toFixed(2)})\n\n` +
      `*Sniper Reversal Trade Active!* 🏹`;
    await this.send(msg);
  }

  async sendTakeProfit(trade) {
    const isLong = trade.type === 'LONG';
    const entry = Number(trade.entryPrice || 0);
    const exit = Number(trade.exitPrice || 0);
    const profit = Number(trade.pnlUsd || 0);
    const pct = Number(trade.pnlPct || 0);
    const bal = Number(trade.newBalance || 0);

    const msg = `💰 *🎯 TAKE PROFIT HIT (1:2 RR)!* 🚀\n\n` +
      `${isLong ? '🟢' : '🔴'} *Trade:* ${trade.type} on ${trade.symbol}\n` +
      `💵 *Entry Price:* $${entry.toFixed(2)}\n` +
      `🏁 *Exit Price:* $${exit.toFixed(2)}\n` +
      `🎉 *Realized Profit:* *+$${profit.toFixed(2)}* (+${pct.toFixed(2)}%)\n` +
      `🏦 *New Account Balance:* *$${bal.toLocaleString()}*\n\n` +
      `*1:2 Target Successfully Achieved!* 🥂`;
    await this.send(msg);
  }

  async sendStopLoss(trade) {
    const isLong = trade.type === 'LONG';
    const entry = Number(trade.entryPrice || 0);
    const exit = Number(trade.exitPrice || 0);
    const loss = Number(trade.pnlUsd || 0);
    const pct = Number(trade.pnlPct || 0);
    const bal = Number(trade.newBalance || 0);

    const msg = `🛑 *STOP LOSS TRIGGERED*\n\n` +
      `${isLong ? '🟢' : '🔴'} *Trade:* ${trade.type} on ${trade.symbol}\n` +
      `💵 *Entry Price:* $${entry.toFixed(2)}\n` +
      `🏁 *Exit Price:* $${exit.toFixed(2)} (1.7 ATR)\n` +
      `📉 *Net PnL:* *-$${Math.abs(loss).toFixed(2)}* (${pct.toFixed(2)}%)\n` +
      `🏦 *New Account Balance:* *$${bal.toLocaleString()}*\n\n` +
      `મૂડી સુરક્ષિત રાખવા માટે પોઝિશન નિયમ મુજબ ક્લોઝ કરવામાં આવી છે.`;
    await this.send(msg);
  }

  async sendStatus(status) {
    const curPrice = Number(status.curPrice || 0);
    const balance = Number(status.balance || 0);
    const netPnlUsd = Number(status.netPnlUsd || 0);
    const pos = status.activePosition;

    let posText = '🔎 *Scanning 15M Candles (Flat)*';
    if (pos) {
      const isLong = pos.type === 'LONG';
      const uPnl = Number(pos.unrealizedPnlUsd || 0);
      posText = `${isLong ? '🟢 LONG' : '🔴 SHORT'} @ $${Number(pos.entryPrice).toFixed(2)}\n` +
        `  • SL: $${Number(pos.stopLoss).toFixed(2)} | TP (1:2): $${Number(pos.takeProfit).toFixed(2)}\n` +
        `  • Unrealized PnL: *${uPnl >= 0 ? '+' : ''}$${uPnl.toFixed(2)}*`;
    }

    const msg = `📊 *POPAT 1 TP REVERSAL (15M) STATUS*\n\n` +
      `• Active Pair: *${status.symbol}*\n` +
      `• Status: *${status.isRunning ? 'RUNNING 🟢' : 'STOPPED 🛑'}*\n` +
      `• Timeframe: *15M*\n` +
      `• Live Price: *$${curPrice.toFixed(2)}*\n` +
      `• SMA 30: *$${Number(status.sma30 || 0).toFixed(2)}* (Slope: *${status.sma30Slope || 'FLAT'}*)\n` +
      `• Virtual Balance: *$${balance.toLocaleString()}*\n` +
      `• Net Realized PnL: *${netPnlUsd >= 0 ? '+' : ''}$${netPnlUsd.toFixed(2)}*\n` +
      `• Total Trades: *${status.totalTrades || 0}* (Win Rate: *${status.winRate || '0.0'}%*)\n\n` +
      `📌 *Active Position:*\n${posText}`;
    await this.send(msg);
  }

  // --- TELEGRAM POLLING FOR LIVE COMMANDS (/start, /status, /stop, /startbot, /btc, /eth, /sol) ---
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
              } else if (text === '/btc' && this.botInstance) {
                this.botInstance.setSymbol('BTCUSDT');
                await this.send(`🪙 *Switched active monitoring to BTC/USDT (15M)!*`);
              } else if (text === '/eth' && this.botInstance) {
                this.botInstance.setSymbol('ETHUSDT');
                await this.send(`🪙 *Switched active monitoring to ETH/USDT (15M)!*`);
              } else if (text === '/sol' && this.botInstance) {
                this.botInstance.setSymbol('SOLUSDT');
                await this.send(`🪙 *Switched active monitoring to SOL/USDT (15M)!*`);
              }
            }
          }
        }
      } catch (err) {
        // Suppress temporary network/timeout blips
      }
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
