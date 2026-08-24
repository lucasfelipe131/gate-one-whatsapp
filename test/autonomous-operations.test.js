import assert from 'node:assert/strict';
import test from 'node:test';
import {
  processAutonomousOperation,
  validateAutonomousTurn
} from '../src/autonomous-operations.js';

function turn(overrides = {}) {
  return {
    contract: 'GateConversationTurn.v1',
    handled: true,
    response_text: 'Ainda não identifiquei a confirmação oficial.',
    response_facts: { payment_status: 'PENDING', renewal_status: null, expiration: null },
    response_status: 'VALIDATED',
    outcome: 'RESOLVED',
    ...overrides
  };
}

test('aceita resposta validada contra fatos autoritativos', () => {
  assert.deepEqual(validateAutonomousTurn(turn()), { valid: true, code: null });
});

test('defesa no canal bloqueia confirmação financeira contraditória', () => {
  const result = validateAutonomousTurn(turn({ response_text: 'Seu pagamento foi confirmado.' }));
  assert.deepEqual(result, { valid: false, code: 'PAYMENT_FACT_MISMATCH' });
});

test('defesa no canal bloqueia conclusão de renewal durante processing', () => {
  const result = validateAutonomousTurn(turn({
    response_text: 'Sua renovação foi concluída.',
    response_facts: { payment_status: 'CONFIRMED', renewal_status: 'PROCESSING', expiration: null }
  }));
  assert.deepEqual(result, { valid: false, code: 'RENEWAL_FACT_MISMATCH' });
});

test('expiration ausente não permite inventar data', () => {
  const result = validateAutonomousTurn(turn({ response_text: 'Seu vencimento é 30/09/2026.' }));
  assert.deepEqual(result, { valid: false, code: 'EXPIRATION_FACT_MISMATCH' });
});

test('transport envia texto, áudio e mídia para o mesmo pipeline do Core', async () => {
  const inputs = [];
  const gateCore = {
    configured: true,
    async processConversation(input) {
      inputs.push(input);
      return { status: 'SUCCESS', data: turn() };
    }
  };
  for (const contentType of ['TEXT', 'AUDIO', 'IMAGE', 'PDF', 'DOCUMENT']) {
    const result = await processAutonomousOperation(gateCore, {
      conversationId: 'whatsapp:5511999999999',
      messageId: `message-${contentType}`,
      phone: '5511999999999',
      text: contentType === 'TEXT' ? 'paguei' : 'comprovante',
      contentType
    });
    assert.equal(result.handled, true);
  }
  assert.deepEqual(inputs.map((item) => item.message.content_type), [
    'TEXT', 'AUDIO', 'IMAGE', 'PDF', 'DOCUMENT'
  ]);
  assert.ok(inputs.every((item) => item.identity.value === '5511999999999'));
});

test('resposta inválida usa fallback seguro antes do WhatsApp', async () => {
  const gateCore = {
    configured: true,
    async processConversation() {
      return {
        status: 'SUCCESS',
        data: turn({ response_text: 'Pagamento confirmado com sucesso.' })
      };
    }
  };
  const result = await processAutonomousOperation(gateCore, {
    conversationId: 'whatsapp:5511999999999', messageId: 'unsafe',
    phone: '5511999999999', text: 'paguei'
  });
  assert.equal(result.response_status, 'SAFE_FALLBACK');
  assert.doesNotMatch(result.response_text, /pagamento confirmado/i);
});

test('sem Core configurado preserva compatibility adapter', async () => {
  assert.equal(await processAutonomousOperation({ configured: false }, {
    conversationId: 'x', messageId: 'y', phone: '5511999999999', text: 'oi'
  }), null);
});
