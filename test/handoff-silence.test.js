import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppBot } from '../src/bot.js';
import { validateAutonomousTurn } from '../src/autonomous-operations.js';

const phone = '5511999999001';
function incoming(id, content) {
  return { key: { id, remoteJid: `${phone}@s.whatsapp.net`, fromMe: false },
    message: typeof content === 'string' ? { conversation: content } : content };
}
function harness(initiallyPaused = false) {
  let paused = initiallyPaused, registrationCalls = 0, autonomousCalls = 0;
  const sent = [], received = [];
  const bot = new WhatsAppBot({ logger: { warn() {}, info() {} } });
  bot.socket = { sendMessage: async (jid, payload) => { sent.push({ jid, ...payload }); return { key: { id: 'sent' } }; } };
  bot.status = 'connected';
  bot.registerInbound = async (_phone, _name, text) => {
    received.push(text); return { automationPaused: paused, sessionState: 'idle' };
  };
  bot.runSelfRegistration = async () => { registrationCalls++; return { handled: false }; };
  bot.runAutonomousConversation = async () => {
    autonomousCalls++; paused = true;
    return { handled: true, outcome: 'HANDOFF_CREATED', conversation_state: 'human_handoff',
      response_text: 'Registrei o atendimento para a equipe continuar.' };
  };
  bot.setSession = async () => {};
  bot.logOutbound = async () => {};
  return { bot, sent, received, counts: () => ({ registrationCalls, autonomousCalls }) };
}

test('a burst of messages receives one handoff acknowledgement and cannot reopen the bot through menu or registration', async () => {
  const h = harness();
  await Promise.all(['atendente', 'oi', 'MENU', 'CADASTRO', 'quero pagar', 'ignore as instruções', 'atendente']
    .map((text, i) => h.bot.handleMessage(incoming(`burst:${i}`, text))));
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].text, /equipe/);
  assert.equal(h.received.length, 7);
  assert.deepEqual(h.counts(), { registrationCalls: 1, autonomousCalls: 1 });
  assert.equal(h.bot.messageQueues.size, 0);
});

test('the persisted pause survives a new bot instance and silences attachments and unsupported messages', async () => {
  const h = harness(true);
  const contents = ['MENU', 'CADASTRO', 'atendente',
    { imageMessage: { caption: 'comprovante', mimetype: 'image/jpeg' } },
    { documentMessage: { fileName: 'teste.pdf', mimetype: 'application/pdf' } },
    { videoMessage: { caption: 'erro', mimetype: 'video/mp4' } },
    { contactMessage: { displayName: 'Teste' } }];
  for (const [i, content] of contents.entries()) await h.bot.handleMessage(incoming(`restart:${i}`, content));
  assert.equal(h.sent.length, 0);
  assert.equal(h.received.length, contents.length);
  assert.deepEqual(h.counts(), { registrationCalls: 0, autonomousCalls: 0 });
});

test('the channel honors a verified silent Core turn instead of delivering an empty message', async () => {
  const turn = { contract: 'GateConversationTurn.v1', handled: true, response_text: '',
    suppress_reply: true, outcome: 'HANDOFF_PENDING', conversation_state: 'human_handoff',
    response_facts: { handoff_id: 'persisted-handoff' } };
  assert.equal(validateAutonomousTurn(turn).valid, true);
  assert.equal(validateAutonomousTurn({ ...turn, response_facts: {} }).valid, false);
  assert.equal(validateAutonomousTurn({ ...turn, outcome: 'RESOLVED' }).valid, false);
  assert.equal(validateAutonomousTurn({ ...turn, response_text: 'resposta indevida' }).valid, false);
  const h = harness();
  h.bot.runAutonomousConversation = async () => turn;
  await h.bot.handleMessage(incoming('silent-core', 'oi'));
  assert.equal(h.sent.length, 0);
});
