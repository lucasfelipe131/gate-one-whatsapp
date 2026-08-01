import { getContentType, normalizeMessageContent } from '@whiskeysockets/baileys';

const MEDIA_KINDS = new Set(['audio', 'image', 'video', 'pdf', 'document', 'sticker']);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function interactiveText(payload) {
  const params = payload?.nativeFlowResponseMessage?.paramsJson;
  if (!params) return '';
  try {
    const parsed = JSON.parse(params);
    return cleanText(
      parsed?.title ||
      parsed?.display_text ||
      parsed?.id ||
      parsed?.selected_id ||
      ''
    );
  } catch {
    return '';
  }
}

export function inspectInboundMessage(message) {
  const content = normalizeMessageContent(message?.message);
  const type = getContentType(content || {});
  const payload = type ? content?.[type] : null;
  const base = { type: type || 'unknown', kind: 'unknown', text: '', media: null };

  if (!type) return base;
  if (type === 'conversation') {
    return { ...base, kind: 'text', text: cleanText(payload) };
  }

  const textByType = {
    extendedTextMessage: payload?.text,
    buttonsResponseMessage: payload?.selectedDisplayText || payload?.selectedButtonId,
    templateButtonReplyMessage: payload?.selectedDisplayText || payload?.selectedId,
    listResponseMessage:
      payload?.title || payload?.description || payload?.singleSelectReply?.selectedRowId,
    interactiveResponseMessage: interactiveText(payload)
  };
  if (Object.hasOwn(textByType, type)) {
    return { ...base, kind: 'text', text: cleanText(textByType[type]) };
  }

  if (type === 'audioMessage') {
    return {
      ...base,
      kind: 'audio',
      media: {
        mimetype: cleanText(payload?.mimetype) || 'audio/ogg',
        fileName: 'audio-whatsapp.ogg',
        seconds: Number(payload?.seconds || 0),
        ptt: Boolean(payload?.ptt)
      }
    };
  }

  if (type === 'imageMessage' || type === 'videoMessage') {
    const kind = type === 'imageMessage' ? 'image' : 'video';
    return {
      ...base,
      kind,
      text: cleanText(payload?.caption),
      media: {
        mimetype: cleanText(payload?.mimetype) || (kind === 'image' ? 'image/jpeg' : 'video/mp4'),
        fileName: `${kind}-whatsapp.${kind === 'image' ? 'jpg' : 'mp4'}`
      }
    };
  }

  if (type === 'documentMessage') {
    const mimetype = cleanText(payload?.mimetype) || 'application/octet-stream';
    const fileName = cleanText(payload?.fileName) || 'arquivo-whatsapp';
    const isPdf = mimetype.toLowerCase() === 'application/pdf' || /\.pdf$/i.test(fileName);
    return {
      ...base,
      kind: isPdf ? 'pdf' : 'document',
      text: cleanText(payload?.caption),
      media: { mimetype, fileName }
    };
  }

  if (type === 'stickerMessage') {
    return {
      ...base,
      kind: 'sticker',
      media: {
        mimetype: cleanText(payload?.mimetype) || 'image/webp',
        fileName: 'figurinha-whatsapp.webp'
      }
    };
  }

  if (type === 'reactionMessage' || type === 'protocolMessage' || type === 'senderKeyDistributionMessage') {
    return { ...base, kind: 'ignored' };
  }

  return base;
}

export function isMediaMessage(inbound) {
  return MEDIA_KINDS.has(inbound?.kind);
}

export function buildMediaLogText(inbound, transcript = '') {
  const caption = cleanText(inbound?.text);
  if (inbound?.kind === 'audio') {
    const text = cleanText(transcript);
    return text ? `[Áudio transcrito] ${text}` : '[Áudio recebido — aguardando atendimento]';
  }
  if (inbound?.kind === 'pdf') {
    return `[PDF recebido: ${inbound.media?.fileName || 'arquivo.pdf'}]${caption ? ` ${caption}` : ''}`;
  }
  const labels = {
    image: 'Imagem recebida',
    video: 'Vídeo recebido',
    document: `Documento recebido: ${inbound?.media?.fileName || 'arquivo'}`,
    sticker: 'Figurinha recebida'
  };
  const label = labels[inbound?.kind] || 'Mensagem não textual recebida';
  return `[${label}]${caption ? ` ${caption}` : ''}`;
}

export function isLikelyReceipt(inbound) {
  if (inbound?.kind === 'pdf') return true;
  if (!['image', 'document'].includes(inbound?.kind)) return false;
  return /\b(comprovante|pix|pagamento|paguei|recibo)\b/i.test(
    `${inbound?.text || ''} ${inbound?.media?.fileName || ''}`
  );
}
