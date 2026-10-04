import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppBot } from '../src/bot.js';

test('self-registration transport carries the sender and message id with one bounded request', async () => {
  const calls = [];
  const channel = { gateOne: async (...args) => { calls.push(args); return { handled: true, response_text: 'Qual seu nome?', registration_step: 'NAME' }; } };
  const result = await WhatsAppBot.prototype.runSelfRegistration.call(channel, { phone: '5511999999999', text: 'CADASTRO', messageId: 'turn-123' });
  assert.equal(result.registration_step, 'NAME'); assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/integrations/whatsapp/registration');
  assert.deepEqual(calls[0][1], { whatsapp: '5511999999999', text: 'CADASTRO', messageId: 'turn-123' });
  assert.equal(calls[0][2].attempts, 1); assert.equal(calls[0][2].required, true);
});

test('normal requests pass through; malformed registration answers cannot be delivered to a customer', async () => {
  const call = value => WhatsAppBot.prototype.runSelfRegistration.call({ gateOne: async () => value }, { phone: '5511999999999', text: 'vencimento', messageId: 'turn-2' });
  assert.equal((await call({ handled: false })).handled, false);
  await assert.rejects(call({ handled: true }), /REGISTRATION_RESPONSE_INVALID/);
});
