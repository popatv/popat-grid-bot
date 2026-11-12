/**
 * POPAT 3 SMC TELEGRAM NOTIFICATION & COMMAND SERVICE
 * Real-time Mobile Alerts for Order Fills, TP/SL, and Dual-HTF Confluence
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

  // --- PRE-FORMATTED INSTITUTIONAL EVENT ALERTS ---

  async sendWelcome(name = 'Trader') {
    const msg = `🦜 *POPAT 3 SMC DUAL-HTF GRID BOT ACTIVATED!* 🚀\n\n` +
      `નમસ્તે ${name}!\n` +
      `તમારો @popatgridbot સફળતાપૂર્વક કનેક્ટ થઈ ગયો છે.\n\n` +
      `⚙️ *Current Engine Setup:*\n` +
      `• Execution Timeframe: *5-Minute (5M)*\n` +
      `• Dual-HTF Filter: *Daily (1D) + 4-Hour (4H) Confluence*\n` +
      `• Grid Bids: *0.50 EQ, 0.618 Golden Pocket, 0.75 OTE, 0.786 Deep*\n` +
      `• S/R Flip: *1.0 Level (Auto-Breakeven lock)*\n` +
      `• TP Ladders: *1.272, 1.445, 1.618 Golden Extensions*\n\n` +
      `📱 *હવે જ્યારે પણ નવો ટ્રેડ પડશે કે પ્રોફિટ બુક થશે ત્યારે સીધો મેસેજ અહીં મળશે!*`;
    await this.send(msg);
  }

  async sendOrderFill(order, totalSize, weightedEntry, trend) {
    const isBull = trend === 'BULL';
    const msg = `${isBull ? '🟢' : '🔴'} *GRID ORDER FILLED!* [${trend}]\n\n` +
      `📍 *Level:* ${order.label}\n` +
      `💵 *Filled Price:* $${order.fillPrice.toFixed(2)}\n` +
      `📦 *Order Size:* $${order.allocatedUsd.toFixed(2)} (${Math.round(order.weight * 100)}%)\n` +
      `⚖️ *Weighted Entry:* $${weightedEntry.toFixed(2)}\n` +
      `💼 *Total Active Position:* $${totalSize.toFixed(2)}`;
    await this.send(msg);
  }

  async sendBreakevenLock(entryPrice, levelPrice) {
    const msg = `🛡️ *S/R FLIP RECLAIMED - BREAKEVEN LOCKED!* ✅\n\n` +
      `માર્કેટે 1.0 End Point લેવલ ($${levelPrice.toFixed(2)}) ક્રોસ કરી લીધું છે.\n` +
      `🔒 Stop Loss ને એન્ટ્રી પ્રાઈસ ($${entryPrice.toFixed(2)}) પર શિફ્ટ કરી દેવાયો છે.\n` +
      `*આ ટ્રેડ હવે ૧૦૦% રિસ્ક-ફ્રી છે!* 🎯`;
    await this.send(msg);
  }

  async sendTakeProfit(tp, pnlUsd, pnlPct) {
    const msg = `💰 *TAKE PROFIT HIT!* 🚀\n\n` +
      `🎯 *Target:* ${tp.label} ($${tp.price.toFixed(2)})\n` +
      `💵 *Realized Profit:* +$${pnlUsd.toFixed(2)} (+${pnlPct.toFixed(2)}%)\n` +
      `🎉 પ્રોફિટ એકાઉન્ટમાં ક્રેડિટ થઈ ગયો છે!`;
    await this.send(msg);
  }

  async sendStopLoss(slPrice, pnlUsd, pnlPct) {
    const msg = `⚠️ *STRUCTURAL STOP LOSS TRIGGERED*\n\n` +
      `🛑 *Exit Price:* $${slPrice.toFixed(2)} (0.0 Invalidation)\n` +
      `📉 *Net PnL:* $${pnlUsd.toFixed(2)} (${pnlPct.toFixed(2)}%)\n` +
      `મૂડીનું રક્ષણ કરવા માટે પોઝિશન ક્લોઝ કરવામાં આવી છે.`;
    await this.send(msg);
  }

  async sendStatus(status) {
    const msg = `📊 *POPAT 3 SMC BOT STATUS*\n\n` +
      `• Status: *${status.isRunning ? 'RUNNING 🟢' : 'STOPPED 🛑'}*\n` +
      `• Execution TF: *${(status.executionTf || '5m').toUpperCase()}*\n` +
      `• Live BTC Price: *$${status.curPrice.toFixed(2)}*\n` +
      `• Virtual Balance: *$${status.balance.toLocaleString()}*\n` +
      `• Net PnL: *${status.netPnlUsd >= 0 ? '+' : ''}$${status.netPnlUsd.toFixed(2)} (${status.netPnlPct}%)*\n` +
      `• HTF Confluence: *${status.htfStatus ? status.htfStatus.daily + ' 1D + ' + status.htfStatus.fourHour + ' 4H' : 'N/A'}*\n` +
      `• Active Grid: *${status.activeGrid ? status.activeGrid.trend + ' (' + status.activeGrid.fills.length + ' fills)' : 'Scanning (Flat)'}*`;
    await this.send(msg);
  }

  // --- TELEGRAM POLLING FOR LIVE COMMANDS (/start, /status, /stop, /startbot) ---
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

              // If chat ID not registered yet or updated
              if (this.chatId !== incomingChatId) {
                this.setChatId(incomingChatId);
                console.log(`Telegram Chat ID registered: ${incomingChatId} (${firstName})`);
              }

              // Handle Commands
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
