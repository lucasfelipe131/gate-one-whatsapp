import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import P from 'pino';
import QRCode from 'qrcode';
import { rm } from 'node:fs/promises';
import { detectPlanCode } from './plans.js';
import {
  isProbableName,
  normalizeCommand,
  phoneFromWhatsAppJid,
  resolveCustomerJid
} from './conversation.js';
import {
  buildMediaLogText,
  inspectInboundMessage,
  isLikelyReceipt,
  isMediaMessage
} from './media.js';

const MAX_MEDIA_BYTES = 12 * 1024 * 1024;

const menu = `Bem-vindo ao *${process.env.BRAND_NAME || 'Gate One Pro'}*. 👋

Responda com uma opção:
*1* — Planos e valores
*2* — Minha conta e vencimento
*3* — Renovar e escolher um plano
*4* — Falar com atendente
*5* — Novidades do IPTV

Digite *MENU* quando quiser ver estas opções novamente.`;

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      timer.unref?.();
    })
  ]);
}

function wait(delayMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    timer.unref?.();
  });
}

function firstName(value) {
  return String(value || '').trim().split(/\s+/)[0] || 'cliente';
}

function normalizeGateOnePhone(value) {
  const fromJid = phoneFromWhatsAppJid(value);
  if (fromJid) return fromJid;
  let digits = String(value || '')
    .replace(/@.+$/, '')
    .replace(/:\d+$/, '')
    .replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.startsWith('55') && [12, 13].includes(digits.length) ? digits : null;
}

export class WhatsAppBot {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.socket = null;
    this.status = 'disconnected';
    this.qrDataUrl = null;
    this.me = null;
    this.lastError = null;
    this.connecting = null;
    this.reconnectTimer = null;
    this.manualDisconnect = false;
    this.connectionGeneration = 0;
    this.reconnectAttempts = 0;
    this.connectedAt = null;
    this.lastDisconnectAt = null;
    this.phoneByLid = new Map();
    this.processedMessageIds = new Map();
  }

  snapshot() {
    return {
      status: this.status,
      connected: this.status === 'connected',
      qr: this.qrDataUrl,
      account: this.me?.id || null,
      lastError: this.lastError,
      reconnectAttempts: this.reconnectAttempts,
      connectedAt: this.connectedAt,
      lastDisconnectAt: this.lastDisconnectAt
    };
  }

  async connect() {
    if (this.socket && ['connecting', 'awaiting_qr', 'connected'].includes(this.status)) {
      return this.snapshot();
    }
    if (this.connecting) return this.connecting;
    this.connecting = this.#connect()
      .catch((error) => {
        this.status = 'disconnected';
        this.lastError = `Não foi possível conectar: ${error.message}`;
        throw error;
      })
      .finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async disconnect() {
    this.manualDisconnect = true;
    this.connectionGeneration += 1;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket) {
      this.socket.end(new Error('Desconectado pelo administrador'));
      this.socket = null;
    }
    await this.#clearAuth();
    this.status = 'disconnected';
    this.me = null;
    this.qrDataUrl = null;
    this.connectedAt = null;
    this.reconnectAttempts = 0;
    this.lastError = 'Sessão removida. Gere um novo QR Code.';
  }

  async #clearAuth() {
    const authDir = process.env.AUTH_DIR || '/data/whatsapp-auth';
    await rm(authDir, { recursive: true, force: true });
  }

  async #connect() {
    this.manualDisconnect = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const generation = ++this.connectionGeneration;
    this.status = 'connecting';
    this.lastError = null;
    const authDir = process.env.AUTH_DIR || '/data/whatsapp-auth';
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    let version;
    try {
      ({ version } = await withTimeout(
        fetchLatestBaileysVersion(),
        8000,
        'a consulta da versão do WhatsApp demorou demais'
      ));
    } catch {
      // Baileys possui uma versão compatível embutida. O serviço não deve
      // ficar preso em "Conectando" quando a consulta externa oscilar.
      version = undefined;
    }
    const socket = makeWASocket({
      ...(version ? { version } : {}),
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
      // A socket replaced during a reconnect may still emit a late "close".
      // Ignore it so it cannot tear down the current healthy connection.
      if (generation !== this.connectionGeneration || socket !== this.socket) return;
      if (qr) {
        this.status = 'awaiting_qr';
        this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 360 });
      }
      if (connection === 'open') {
        this.status = 'connected';
        this.qrDataUrl = null;
        this.me = socket.user;
        this.connectedAt = new Date().toISOString();
        this.reconnectAttempts = 0;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (connection === 'close') {
        if (generation !== this.connectionGeneration || socket !== this.socket) return;
        this.socket = null;
        this.me = null;
        this.connectedAt = null;
        this.lastDisconnectAt = new Date().toISOString();
        this.qrDataUrl = null;
        const code =
          lastDisconnect?.error?.output?.statusCode ??
          lastDisconnect?.error?.data?.statusCode ??
          lastDisconnect?.error?.statusCode;
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
          this.reconnectAttempts = 0;
          this.#scheduleReconnect(1000);
          return;
        }
        this.status = 'disconnected';
        this.lastError = 'Conexão interrompida. Tentando reconectar…';
        this.reconnectAttempts += 1;
        const delay = Math.min(30000, 2000 * (2 ** Math.min(this.reconnectAttempts - 1, 4)));
        this.#scheduleReconnect(delay);
      }
    });
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (generation !== this.connectionGeneration || socket !== this.socket) return;
      if (type !== 'notify') return;
      for (const message of messages) {
        try {
          await this.#handleMessage(message);
        } catch (error) {
          this.lastError = `Falha ao atender uma mensagem: ${error.message}`;
          this.logger?.error?.(
            {
              error: error.message,
              messageId: String(message.key?.id || '').slice(0, 120)
            },
            'Falha ao atender mensagem do WhatsApp'
          );
          const jid = message.key?.remoteJid;
          if (jid && !message.key?.fromMe) {
            await this.reply(
              jid,
              'Tive uma instabilidade ao consultar seu cadastro. Aguarde alguns segundos e envie *MENU*. Se continuar, digite *ATENDENTE*.'
            ).catch(() => {});
          }
        }
      }
    });
  }

  #scheduleReconnect(delay) {
    if (this.manualDisconnect || this.reconnectTimer) return;
    const generation = this.connectionGeneration;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manualDisconnect || generation !== this.connectionGeneration) return;
      this.connect().catch((error) => { this.lastError = error.message; });
    }, delay);
  }

  async #downloadInboundMedia(message) {
    const buffer = await withTimeout(
      downloadMediaMessage(
        message,
        'buffer',
        {},
        {
          logger: P({ level: 'silent' }),
          reuploadRequest: this.socket?.updateMediaMessage
        }
      ),
      30_000,
      'o download da mídia demorou demais'
    );
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
      throw new Error('O WhatsApp não entregou o conteúdo da mídia.');
    }
    if (buffer.length > MAX_MEDIA_BYTES) {
      throw new Error('A mídia excede o limite de 12 MB do atendimento automático.');
    }
    return buffer;
  }

  #reviewPhone() {
    return normalizeGateOnePhone(
      process.env.RECEIPT_REVIEW_WHATSAPP || process.env.SUPPORT_WHATSAPP
    );
  }

  async #forwardMediaForReview({ buffer, inbound, customerPhone, displayName }) {
    const reviewPhone = this.#reviewPhone();
    if (!reviewPhone || !this.socket || this.status !== 'connected') return false;
    const reviewJid = `${reviewPhone}@s.whatsapp.net`;
    const label = isLikelyReceipt(inbound) ? 'Possível comprovante' : 'Mídia de atendimento';
    const caption = [
      `📎 *${label} — Gate One Pro*`,
      `Cliente: ${String(displayName || 'não informado').slice(0, 120)}`,
      `WhatsApp: ${customerPhone}`,
      inbound.text ? `Legenda: ${String(inbound.text).slice(0, 500)}` : ''
    ].filter(Boolean).join('\n');
    if (inbound.kind === 'image') {
      await this.socket.sendMessage(reviewJid, { image: buffer, caption });
      return true;
    }
    if (inbound.kind === 'video') {
      await this.socket.sendMessage(reviewJid, {
        video: buffer,
        mimetype: inbound.media?.mimetype || 'video/mp4',
        caption
      });
      return true;
    }
    if (inbound.kind === 'audio') {
      await this.socket.sendMessage(reviewJid, { text: caption });
      await this.socket.sendMessage(reviewJid, {
        audio: buffer,
        mimetype: inbound.media?.mimetype || 'audio/ogg',
        ptt: Boolean(inbound.media?.ptt)
      });
      return true;
    }
    if (inbound.kind === 'pdf' || inbound.kind === 'document') {
      await this.socket.sendMessage(reviewJid, {
        document: buffer,
        mimetype: inbound.media?.mimetype || 'application/octet-stream',
        fileName: inbound.media?.fileName || 'arquivo-whatsapp',
        caption
      });
      return true;
    }
    return false;
  }

  async #handleAttachment({ message, inbound, jid, customerPhone, messageId }) {
    const logText = buildMediaLogText(inbound);
    const context = await this.registerInbound(
      customerPhone,
      message.pushName,
      logText,
      messageId || undefined
    );
    if (context?.duplicate) return;

    let forwarded = false;
    try {
      const buffer = await this.#downloadInboundMedia(message);
      forwarded = await this.#forwardMediaForReview({
        buffer,
        inbound,
        customerPhone,
        displayName: context?.customer?.name || message.pushName
      });
    } catch (error) {
      this.logger?.warn?.(
        { error: error.message, mediaKind: inbound.kind, messageId },
        'Mídia registrada, mas não encaminhada ao atendimento'
      );
    }

    if (!context?.needsName) await this.setSession(customerPhone, 'support');
    const namePrompt = context?.needsName
      ? '\n\nPara vincular corretamente ao cadastro, responda agora com seu *nome*.'
      : '';
    const forwardingText = forwarded
      ? 'encaminhei para a equipe conferir'
      : 'registrei para a equipe conferir';

    if (isLikelyReceipt(inbound)) {
      return this.reply(
        jid,
        `✅ Recebi seu comprovante/arquivo e ${forwardingText}. A renovação só será feita depois da confirmação do pagamento.${namePrompt}`,
        customerPhone
      );
    }
    return this.reply(
      jid,
      `✅ Recebi sua ${inbound.kind === 'image' ? 'imagem' : inbound.kind === 'video' ? 'vídeo' : 'arquivo'} e ${forwardingText}.${namePrompt}`,
      customerPhone
    );
  }

  async #handleMessage(message) {
    if (!this.socket || message.key.fromMe || message.key.remoteJid?.endsWith('@g.us')) return;
    const jid = message.key.remoteJid;
    const messageId = String(message.key.id || '');
    if (messageId && this.#alreadyProcessed(messageId)) return;
    const customerJid = await resolveCustomerJid(
      message.key,
      this.phoneByLid,
      (lidJid) => this.socket?.signalRepository?.lidMapping?.getPNForLID(lidJid)
    );
    if (!customerJid) {
      return this.reply(
        jid,
        'Não consegui confirmar seu número nesta mensagem. Envie *MENU* novamente para eu tentar identificar seu cadastro.'
      );
    }
    const customerPhone = phoneFromWhatsAppJid(customerJid);
    if (!customerPhone) {
      return this.reply(
        jid,
        'Não consegui confirmar seu número nesta mensagem. Envie *MENU* novamente para eu tentar identificar seu cadastro.'
      );
    }
    const inbound = inspectInboundMessage(message);
    if (inbound.kind === 'ignored') return;
    if (isMediaMessage(inbound) && inbound.kind !== 'audio') {
      return this.#handleAttachment({ message, inbound, jid, customerPhone, messageId });
    }

    let text = inbound.text;
    let inboundLogText = text;
    if (inbound.kind === 'audio') {
      let buffer;
      try {
        buffer = await this.#downloadInboundMedia(message);
        const transcription = await this.transcribeAudio(customerPhone, buffer, inbound.media);
        text = String(transcription?.text || '').trim();
      } catch (error) {
        this.logger?.warn?.(
          { error: error.message, messageId },
          'Áudio recebido, mas a transcrição não foi concluída'
        );
      }
      inboundLogText = buildMediaLogText(inbound, text);
      if (!text) {
        const context = await this.registerInbound(
          customerPhone,
          message.pushName,
          inboundLogText,
          messageId || undefined
        );
        if (context?.duplicate) return;
        let forwarded = false;
        if (buffer) {
          forwarded = await this.#forwardMediaForReview({
            buffer,
            inbound,
            customerPhone,
            displayName: context?.customer?.name || message.pushName
          }).catch(() => false);
        }
        if (!context?.needsName) await this.setSession(customerPhone, 'support');
        const namePrompt = context?.needsName
          ? '\n\nPara vincular ao cadastro, responda também com seu *nome* em texto.'
          : '';
        return this.reply(
          jid,
          `🎧 Recebi seu áudio. Não consegui transcrevê-lo agora, mas ${forwarded ? 'encaminhei' : 'registrei'} para o atendimento humano.${namePrompt}`,
          customerPhone
        );
      }
    }

    if (!text) {
      const unknownText = `[Mensagem do WhatsApp recebida: ${inbound.type}]`;
      const context = await this.registerInbound(
        customerPhone,
        message.pushName,
        unknownText,
        messageId || undefined
      );
      if (context?.duplicate) return;
      return this.reply(
        jid,
        'Recebi sua mensagem, mas este formato não permite leitura automática. Envie em *texto*, *áudio*, *imagem* ou *PDF*, ou digite *ATENDENTE*.',
        customerPhone
      );
    }
    const context = await this.registerInbound(
      customerPhone,
      message.pushName,
      inboundLogText,
      messageId || undefined
    );
    if (context?.duplicate) return;
    const respond = (content) => this.reply(jid, content, customerPhone);
    const command = normalizeCommand(text);

    if (context?.sessionState === 'awaiting_login') {
      const confirmation = await this.confirmLogin(customerPhone, text);
      if (confirmation?.matched) {
        return respond(
          `Cadastro confirmado, ${firstName(confirmation.name)}! Recuperei seu plano e o histórico dos atendimentos.\n\n${menu}`
        );
      }
      return respond(
        'Não encontrei esse login no cadastro indicado. Confira o login/ID do Gate One e envie novamente, ou digite *ATENDENTE*.'
      );
    }

    if (context?.needsName) {
      if (context.sessionState === 'awaiting_name' && isProbableName(text)) {
        const confirmation = await this.confirmName(customerPhone, text);
        if (confirmation?.needsLogin) {
          return respond(
            `Obrigado, ${firstName(confirmation.name)}. Encontrei um cadastro antigo com esse nome.\n\nPara confirmar que ele é seu e recuperar os atendimentos anteriores, qual é o seu *login/ID do Gate One*?`
          );
        }
        if (confirmation?.name) {
          return respond(`Obrigado, ${firstName(confirmation.name)}! Seu cadastro foi identificado.\n\n${menu}`);
        }
        return respond(
          'Recebi seu nome, mas não consegui salvá-lo agora. Aguarde alguns segundos e envie o nome novamente.'
        );
      }
      return respond(
        `Olá! Antes de começar, quero deixar seu atendimento organizado.\n\nQual é o seu *nome*?`
      );
    }

    if (['OI', 'OLA', 'MENU', 'INICIO', '0'].includes(command)) {
      const account = await this.lookupCustomer(customerPhone, message.pushName);
      const greeting = account || `Olá, ${firstName(message.pushName)}!`;
      return respond(`${greeting}\n\n${menu}`);
    }
    if (['1', 'PLANOS', 'PLANO', 'VALORES'].includes(command)) {
      const plans = await this.listPlans();
      return respond(
        plans ||
          '*Planos Gate One Pro*\n\n• Mensal — R$ 30,00\n• Trimestral — R$ 85,00\n• Semestral — R$ 150,00\n• Anual — R$ 270,00\n\nResponda com o nome do plano para gerar o pagamento.'
      );
    }
    if (['2', 'MINHA CONTA', 'VENCIMENTO', 'CONTA'].includes(command)) {
      const account = await this.lookupCustomer(customerPhone, message.pushName);
      return respond(account || 'Não encontrei seu cadastro por este número. Responda *4* para falar com o atendimento.');
    }
    if (['3', 'RENOVAR', 'PIX', 'PAGAMENTO'].includes(command)) {
      await this.setSession(customerPhone, 'awaiting_plan');
      const plans = await this.listPlans();
      return respond(
        `Perfeito! Escolha o plano que deseja renovar:\n\n${plans || '• *MENSAL* — R$ 30,00\n• *TRIMESTRAL* — R$ 85,00\n• *SEMESTRAL* — R$ 150,00\n• *ANUAL* — R$ 270,00'}`
      );
    }
    const planCode = detectPlanCode(command);
    if (planCode) {
      const link = await this.createPayment(customerPhone, message.pushName, planCode);
      return respond(
        link ||
          'Não encontrei uma assinatura vinculada a este número. Responda *4* para falar com o atendimento.'
      );
    }
    if (['5', 'NOVIDADES', 'CONTEUDOS', 'CONTEUDO', 'LANCAMENTOS'].includes(command)) {
      const content = await this.latestContent();
      return respond(
        content ||
          'As novidades ainda estão sendo sincronizadas. Tente novamente mais tarde ou digite *ATENDENTE*.'
      );
    }
    if (['HISTORICO', 'MEUS PROBLEMAS', 'PROBLEMAS', 'ATENDIMENTOS'].includes(command)) {
      const history = await this.customerHistory(customerPhone);
      return respond(history || 'Ainda não encontrei atendimentos anteriores vinculados a este número.');
    }
    if (['4', 'ATENDENTE', 'SUPORTE', 'HUMANO'].includes(command)) {
      const support = process.env.SUPPORT_WHATSAPP;
      await this.setSession(customerPhone, 'support');
      return respond(support ? `Certo! Seu histórico ficou registrado para o atendimento. Nossa equipe vai continuar por aqui. Se preferir, chame também: https://wa.me/${support}` : 'Certo! Seu histórico ficou registrado e um atendente vai continuar por aqui.');
    }
    if (context?.supportMessage) return respond(context.supportMessage);
    const assistant = await this.askAssistant(customerPhone, text);
    return respond(assistant || `Não entendi essa opção.\n\n${menu}`);
  }

  async reply(jid, text, customerJid = jid) {
    const sent = await this.socket?.sendMessage(jid, { text });
    this.logOutbound(customerJid, text, sent?.key?.id).catch(() => {});
    return sent;
  }

  #alreadyProcessed(messageId) {
    const now = Date.now();
    for (const [id, timestamp] of this.processedMessageIds) {
      if (now - timestamp > 30 * 60 * 1000) this.processedMessageIds.delete(id);
    }
    if (this.processedMessageIds.has(messageId)) return true;
    this.processedMessageIds.set(messageId, now);
    if (this.processedMessageIds.size > 2000) {
      const oldest = this.processedMessageIds.keys().next().value;
      if (oldest) this.processedMessageIds.delete(oldest);
    }
    return false;
  }

  async sendTo(phone, text) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits || !this.socket || this.status !== 'connected') return null;
    return this.socket.sendMessage(`${digits}@s.whatsapp.net`, { text: String(text) });
  }

  async gateOne(
    path,
    body,
    { required = false, timeoutMs = 12_000, attempts = 3 } = {}
  ) {
    const base = process.env.GATE_ONE_URL;
    const secret = process.env.GATE_ONE_SHARED_SECRET;
    if (!base || !secret) {
      if (required) throw new Error('Integração interna com o Gate One não configurada.');
      return null;
    }
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await withTimeout(
          fetch(`${base.replace(/\/$/, '')}${path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Gate-One-Bot-Secret': secret
            },
            body: JSON.stringify(body)
          }),
          timeoutMs,
          'a consulta ao cadastro demorou demais'
        );
        const data = await response.json().catch(() => ({}));
        if (response.ok) return data;
        lastError = new Error(
          data.error || data.message || `Gate One respondeu ${response.status}`
        );
        if (![429, 502, 503, 504].includes(response.status)) break;
      } catch (error) {
        lastError = error;
      }
      if (attempt < attempts - 1) await wait(300 * (attempt + 1));
    }
    this.lastError = `Falha na integração ${path}: ${lastError?.message || 'erro desconhecido'}`;
    if (required) throw lastError || new Error('Gate One indisponível.');
    return null;
  }

  async registerInbound(phone, displayName, text, messageId) {
    return this.gateOne('/api/integrations/whatsapp/inbound', {
      whatsapp: phone,
      displayName,
      text,
      messageId
    }, { required: true });
  }

  async transcribeAudio(phone, buffer, media = {}) {
    return this.gateOne('/api/integrations/whatsapp/transcribe', {
      whatsapp: phone,
      audioBase64: buffer.toString('base64'),
      mimetype: media.mimetype || 'audio/ogg',
      fileName: media.fileName || 'audio-whatsapp.ogg'
    }, {
      required: true,
      timeoutMs: 50_000,
      // A resposta pode se perder depois de a transcrição ter sido cobrada.
      // Não repetimos automaticamente esta chamada.
      attempts: 1
    });
  }

  async confirmName(phone, name) {
    return this.gateOne('/api/integrations/whatsapp/name', {
      whatsapp: phone,
      name
    }, { required: true });
  }

  async confirmLogin(phone, login) {
    return this.gateOne('/api/integrations/whatsapp/login', {
      whatsapp: phone,
      login
    }, { required: true });
  }

  async setSession(phone, state, data = {}) {
    return this.gateOne('/api/integrations/whatsapp/session', {
      whatsapp: phone,
      state,
      data
    });
  }

  async logOutbound(phone, text, messageId) {
    const normalizedPhone = normalizeGateOnePhone(phone);
    if (!normalizedPhone) return null;
    return this.gateOne('/api/integrations/whatsapp/outbound', {
      whatsapp: normalizedPhone,
      text,
      ...(messageId ? { messageId } : {})
    });
  }

  async lookupCustomer(phone, name) {
    const data = await this.gateOne('/api/integrations/whatsapp/customer', { whatsapp: phone, name });
    return data?.message || null;
  }

  async listPlans() {
    const data = await this.gateOne('/api/integrations/whatsapp/plans', {});
    return data?.message || null;
  }

  async createPayment(phone, name, planCode = null) {
    const data = await this.gateOne('/api/integrations/whatsapp/payment', {
      whatsapp: phone,
      name,
      ...(planCode ? { planCode } : {})
    });
    return data?.message || null;
  }

  async latestContent() {
    const data = await this.gateOne('/api/integrations/whatsapp/content', {});
    return data?.message || null;
  }

  async customerHistory(phone) {
    const data = await this.gateOne('/api/integrations/whatsapp/history', {
      whatsapp: phone
    });
    return data?.message || null;
  }

  async askAssistant(phone, question) {
    const data = await this.gateOne('/api/integrations/whatsapp/assistant', {
      whatsapp: phone,
      question
    });
    return data?.message || null;
  }
}
