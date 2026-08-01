import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMediaLogText,
  inspectInboundMessage,
  isLikelyReceipt,
  isMediaMessage
} from '../src/media.js';

test('lê texto comum, resposta de botão e legenda de imagem', () => {
  assert.deepEqual(
    inspectInboundMessage({ message: { conversation: '  MENU  ' } }),
    { type: 'conversation', kind: 'text', text: 'MENU', media: null }
  );
  assert.equal(
    inspectInboundMessage({
      message: { buttonsResponseMessage: { selectedDisplayText: 'Renovar' } }
    }).text,
    'Renovar'
  );
  const image = inspectInboundMessage({
    message: {
      imageMessage: { caption: 'Comprovante do Pix', mimetype: 'image/jpeg' }
    }
  });
  assert.equal(image.kind, 'image');
  assert.equal(image.text, 'Comprovante do Pix');
  assert.equal(isLikelyReceipt(image), true);
});

test('desembrulha mensagem temporária e reconhece áudio', () => {
  const inbound = inspectInboundMessage({
    message: {
      ephemeralMessage: {
        message: {
          audioMessage: {
            mimetype: 'audio/ogg; codecs=opus',
            seconds: 18,
            ptt: true
          }
        }
      }
    }
  });
  assert.equal(inbound.kind, 'audio');
  assert.equal(inbound.media.seconds, 18);
  assert.equal(inbound.media.ptt, true);
  assert.equal(isMediaMessage(inbound), true);
  assert.equal(
    buildMediaLogText(inbound, 'Quero renovar meu plano.'),
    '[Áudio transcrito] Quero renovar meu plano.'
  );
});

test('reconhece comprovante PDF mesmo sem texto ou legenda', () => {
  const inbound = inspectInboundMessage({
    message: {
      documentMessage: {
        mimetype: 'application/pdf',
        fileName: 'comprovante-mercado-pago.pdf'
      }
    }
  });
  assert.equal(inbound.kind, 'pdf');
  assert.equal(inbound.text, '');
  assert.equal(isLikelyReceipt(inbound), true);
  assert.equal(
    buildMediaLogText(inbound),
    '[PDF recebido: comprovante-mercado-pago.pdf]'
  );
});

test('não trata reações e eventos internos como solicitações do cliente', () => {
  assert.equal(
    inspectInboundMessage({ message: { reactionMessage: { text: '👍' } } }).kind,
    'ignored'
  );
  assert.equal(
    inspectInboundMessage({ message: { protocolMessage: { type: 0 } } }).kind,
    'ignored'
  );
});
