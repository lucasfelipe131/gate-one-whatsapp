import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import P from 'pino';
import QRCode from 'qrcode';
import { rm } from 'node:fs/promises';

const menu = `Olá! 👋 Bem-vindo ao *${process.env.BRAND_NAME || 'Gate One Pro'}*.

Responda com uma opção:
*1* — Planos e valores
*2* — Minha conta e vencimento
*3* — Renovar / Pix
*4* — Falar com atendente

Digite *MENU* quando quiser ver estas opções novamente.`;

export class WhatsAppBot {
  constructor() {
    this.socket = null;
    this.status = 'disconnected';
    this.qrDataUrl = null;
    this.me = null;
    this.lastError = null;
    this.connecting = null;
    this.reconnectTimer = null;
    this.manualDisconnect = false;
  }

  snapshot() {
    return {
      status: this.status,
      connected: this.status === 'connected',
      qr: this.qrDataUrl,
      account: this.me?.id || null,
      lastError: this.lastError
    };
  }

  async connect() {
    if (this.connecting) return this.connecting;
    this.connecting = this.#connect().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async disconnect() {
    this.manualDisconnect = true;
    clearTimeout(this.reconnectTimer);
    if (this.socket) {
      this.socket.end(new Error('Desconectado pelo administrador'));
      this.socket = null;
    }
    await this.#clearAuth();
    this.status = 'disconnected';
    this.me = null;
    this.qrDataUrl = null;
    this.lastError = 'Sessão removida. Gere um novo QR Code.';
  }

  async #clearAuth() {
    const authDir = process.env.AUTH_DIR || '/data/whatsapp-auth';
    await rm(authDir, { recursive: true, force: true });
  }

  async #connect() {
    this.manualDisconnect = false;
    this.status = 'connecting';
    this.lastError = null;
    const authDir = process.env.AUTH_DIR || '/data/whatsapp-auth';
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();
    const socket = makeWASocket({
      version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' })) },
      logger: P({ level: 'silent' }),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      browser: ['Gate One Pro', 'Chrome', '1.0.0']
    });
    this.socket = socket;
    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        this.status = 'awaiting_qr';
        this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 360 });
      }
      if (connection === 'open') {
        this.status = 'connected';
        this.qrDataUrl = null;
        this.me = socket.user;
      }
      if (connection === 'close') {
        this.socket = null;
        this.me = null;
        const code = lastDisconnect?.error?.output?.statusCode;
        if (this.manualDisconnect) {
          this.status = 'disconnected';
          this.qrDataUrl = null;
          this.lastError = 'Sessão removida. Gere um novo QR Code.';
          return;
        }
        if (code === DisconnectReason.loggedOut) {
          await this.#clearAuth();
          this.status = 'disconnected';
          this.qrDataUrl = null;
          this.lastError = 'A sessão anterior foi removida. Gerando um QR Code novo…';
          this.#scheduleReconnect(500);
          return;
        }
        this.status = 'disconnected';
        this.lastError = 'Conexão interrompida. Tentando reconectar…';
        this.#scheduleReconnect(3000);
      }
    });
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const message of messages) await this.#handleMessage(message);
    });
  }

  #scheduleReconnect(delay) {
    if (this.manualDisconnect || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((error) => { this.lastError = error.message; });
    }, delay);
  }

  async #handleMessage(message) {
    if (!this.socket || message.key.fromMe || message.key.remoteJid?.endsWith('@g.us')) return;
    const jid = message.key.remoteJid;
    const text = (message.message?.conversation || message.message?.extendedTextMessage?.text || '').trim();
    if (!text) return;
    const command = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (['OI', 'OLA', 'MENU', 'INICIO', '0'].includes(command)) return this.reply(jid, menu);
    if (['1', 'PLANOS', 'PLANO', 'VALORES'].includes(command)) {
      return this.reply(jid, '*Planos Gate One Pro*\n\n• Mensal — R$ 30,00\n• Trimestral — R$ 80,00\n\nResponda *3* para renovar ou *4* para atendimento.');
    }
    if (['2', 'MINHA CONTA', 'VENCIMENTO', 'CONTA'].includes(command)) {
      const account = await this.lookupCustomer(jid, message.pushName);
      return this.reply(jid, account || 'Não encontrei seu cadastro por este número. Responda *4* para falar com o atendimento.');
    }
    if (['3', 'RENOVAR', 'PIX', 'PAGAMENTO'].includes(command)) {
      const link = await this.createPayment(jid, message.pushName);
      return this.reply(jid, link || 'Vou encaminhar você para o atendimento preparar sua renovação.');
    }
    if (['4', 'ATENDENTE', 'SUPORTE', 'HUMANO'].includes(command)) {
      const support = process.env.SUPPORT_WHATSAPP;
      return this.reply(jid, support ? `Certo! Nosso atendimento vai continuar por aqui. Se preferir, chame também: https://wa.me/${support}` : 'Certo! Um atendente vai continuar seu atendimento por aqui.');
    }
    return this.reply(jid, `Não entendi essa opção.\n\n${menu}`);
  }

  async reply(jid, text) { return this.socket?.sendMessage(jid, { text }); }

  async sendTo(phone, text) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits || !this.socket || this.status !== 'connected') return null;
    return this.socket.sendMessage(`${digits}@s.whatsapp.net`, { text: String(text) });
  }

  async gateOne(path, body) {
    const base = process.env.GATE_ONE_URL;
    const secret = process.env.GATE_ONE_SHARED_SECRET;
    if (!base || !secret) return null;
    const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Gate-One-Bot-Secret': secret }, body: JSON.stringify(body)
    });
    if (!response.ok) return null;
    return response.json();
  }

  async lookupCustomer(jid, name) {
    const data = await this.gateOne('/api/integrations/whatsapp/customer', { whatsapp: jid.replace(/@.+$/, ''), name });
    return data?.message || null;
  }

  async createPayment(jid, name) {
    const data = await this.gateOne('/api/integrations/whatsapp/payment', { whatsapp: jid.replace(/@.+$/, ''), name });
    return data?.message || null;
  }
}
