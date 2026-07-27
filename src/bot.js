import makeWASocket, {  DisconnectReason,  fetchLatestBaileysVersion,  makeCacheableSignalKeyStore,  useMultiFileAuthState} from '@whiskeysockets/baileys';import P from 'pino';import QRCode from 'qrcode'; import { rm } from 'node:fs/promises';const menu = `Olá! 👋 Bem-vindo ao *${process.env.BRAND_NAME || 'Gate One Pro'}*.Responda com uma opção:*1* — Planos e valores*2* — Minha conta e vencimento*3* — Renovar / Pix*4* — Falar com atendenteDigite *MENU* quando quiser ver estas opções novamente.`;export class WhatsAppBot {  constructor() {    this.socket = null;    this.status = 'disconnected';    this.qrDataUrl = null;    this.me = null;    this.lastError = null;    this.connecting = null;  }  snapshot() {    return {      status: this.status,      connected: this.status === 'connected',      qr: this.qrDataUrl,      account: this.me?.id || null,      lastError: this.lastError    };  }  async connect() {    if (this.connecting) return this.connecting;    this.connecting = this.#connect().finally(() => { this.connecting = null; });    return this.connecting;  }  async disconnect() {
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

  async #connect() {    this.status = 'connecting';    this.lastError = null;    const authDir = process.env.AUTH_DIR || '/data/whatsapp-auth';    const { state, saveCreds } = await useMultiFileAuthState(authDir);    const { version } = await fetchLatestBaileysVersion();
