import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppBot } from '../src/bot.js';

const now = 1_800_000_000_000;
const minute = 60_000;
const jid = '5511999999001@s.whatsapp.net';

function incoming(id, timestamp = now / 1000, content = { conversation: 'MENU' }, key = {}) {
  return { key: { id, remoteJid: jid, fromMe: false, ...key },
    messageTimestamp: timestamp, message: content };
}

function harness({ startedAt = now, paused = false } = {}) {
  const sent = [], received = [], humanActivities = [], sessions = [];
  const bot = new WhatsAppBot({ logger: { error() {}, warn() {} } });
  bot.messageRecoveryStartedAt = startedAt;
  bot.socket = { sendMessage: async (to, payload) => {
    sent.push({ to, ...payload }); return { key: { id: `sent:${sent.length}` } };
  } };
  bot.status = 'connected';
  bot.registerInbound = async (_phone, _name, text, id) => {
    received.push({ text, id }); return { automationPaused: paused, sessionState: 'idle' };
  };
  bot.runSelfRegistration = async () => ({ handled: false });
  bot.setSession = async (_phone, state) => { sessions.push(state); };
  bot.logOutbound = async () => {};
  bot.recordHumanActivity = async (whatsapp, messageId, occurredAt) => {
    humanActivities.push({ whatsapp, messageId, occurredAt }); return { ok: true, recorded: true };
  };
  const upsert = (type, messages, options = {}) =>
    bot.handleMessagesUpsert({ type, messages }, { receivedAt: now, ...options });
  return { bot, sent, received, humanActivities, sessions, upsert };
}

test('live notify still replies when the provider does not include a timestamp', async () => {
  const h = harness();
  const message = incoming('live');
  delete message.messageTimestamp;
  await h.upsert('notify', [message]);
  assert.equal(h.received.length, 1);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].text, /Planos e valores/);
});

test('offline append replies for recent messages received during startup and reconnect', async () => {
  const h = harness();
  await h.upsert('append', [
    incoming('offline-startup', (now - 4 * minute) / 1000),
    incoming('offline-long', { toNumber: () => (now - minute) / 1000 }),
    incoming('offline-string', String(now / 1000))
  ]);
  assert.equal(h.received.length, 3);
  assert.equal(h.sent.length, 3);

  const reconnect = harness({ startedAt: now - 60 * minute });
  await reconnect.upsert('append', [incoming('offline-reconnect', (now - 14 * minute) / 1000)]);
  assert.equal(reconnect.sent.length, 1);
});

test('offline replay excludes history before startup lookback and messages older than fifteen minutes', async () => {
  const startup = harness();
  await startup.upsert('append', [incoming('before-start-window', (now - 6 * minute) / 1000)]);
  assert.equal(startup.received.length, 0);
  assert.equal(startup.sent.length, 0);

  const reconnect = harness({ startedAt: now - 60 * minute });
  await reconnect.upsert('append', [incoming('old-history', (now - 16 * minute) / 1000)]);
  assert.equal(reconnect.received.length, 0);
  assert.equal(reconnect.sent.length, 0);
});

test('offline append requires an id and a valid recent provider timestamp', async () => {
  const h = harness();
  const missingTimestamp = incoming('missing-timestamp');
  delete missingTimestamp.messageTimestamp;
  await h.upsert('append', [missingTimestamp, incoming('invalid', 'invalid'),
    incoming('zero', 0), incoming('future', (now + 2 * minute) / 1000),
    incoming('', now / 1000)]);
  assert.equal(h.received.length, 0);
  assert.equal(h.sent.length, 0);
});

test('notify and append redelivery of the same message produces exactly one reply', async () => {
  const h = harness();
  const first = incoming('append-first');
  await Promise.all([h.upsert('append', [first]), h.upsert('notify', [first])]);
  const second = incoming('notify-first');
  await Promise.all([h.upsert('notify', [second]), h.upsert('append', [second])]);
  assert.equal(h.received.length, 2);
  assert.equal(h.sent.length, 2);
  assert.equal(h.bot.messageQueues.size, 0);
});

test('groups, broadcasts, protocol, reactions and history stubs never enter the bot or human activity', async () => {
  const h = harness();
  const excluded = [
    incoming('group', now / 1000, undefined, { remoteJid: '123@g.us' }),
    incoming('status', now / 1000, undefined, { remoteJid: 'status@broadcast' }),
    incoming('newsletter', now / 1000, undefined, { remoteJid: '123@newsletter' }),
    incoming('protocol', now / 1000, { protocolMessage: { type: 0 } }),
    incoming('reaction', now / 1000, { reactionMessage: { text: '👍' } }),
    { key: { id: 'history-stub', remoteJid: jid, fromMe: false }, messageTimestamp: now / 1000 }
  ];
  for (const type of ['append', 'notify']) await h.upsert(type, excluded);
  await h.upsert('append', [incoming('unknown-history', now / 1000, { messageContextInfo: {} }),
    incoming('empty-history', now / 1000, { conversation: '' })]);
  assert.equal(h.received.length, 0);
  assert.equal(h.sent.length, 0);
  assert.equal(h.humanActivities.length, 0);
});

test('recovered append respects the persisted human handoff pause', async () => {
  const h = harness({ paused: true });
  await h.upsert('append', [incoming('paused-offline', now / 1000, { conversation: 'oi' })]);
  assert.equal(h.received.length, 1);
  assert.equal(h.sent.length, 0);
});

test('messages from replaced sockets and unsupported event types remain ignored', async () => {
  const h = harness();
  await h.upsert('append', [incoming('old-socket')], { socket: {} });
  await h.upsert('append', [incoming('old-generation')], { generation: h.bot.connectionGeneration - 1 });
  await h.upsert('history', [incoming('unsupported-type')]);
  assert.equal(h.received.length, 0);
  assert.equal(h.sent.length, 0);
});

test('manual outgoing notify and append record provider time once without replying', async () => {
  const h = harness({ startedAt: now - 60 * minute });
  const manual = incoming('human-text', (now - minute) / 1000,
    { conversation: 'Olá, vou verificar seu acesso.' }, { fromMe: true });
  await Promise.all([h.upsert('notify', [manual]), h.upsert('append', [manual])]);
  await h.upsert('append', [incoming('human-audio', now / 1000,
    { audioMessage: { mimetype: 'audio/ogg', seconds: 2 } }, { fromMe: true })]);
  assert.deepEqual(h.humanActivities, [
    { whatsapp: '5511999999001', messageId: 'human-text', occurredAt: new Date(now - minute).toISOString() },
    { whatsapp: '5511999999001', messageId: 'human-audio', occurredAt: new Date(now).toISOString() }
  ]);
  assert.equal(h.received.length, 0);
  assert.equal(h.sent.length, 0);
  assert.equal(h.bot.messageQueues.size, 0);
});

test('bot reply and notification echoes are reserved before send and never count as human activity', async () => {
  const h = harness();
  h.bot.socket.sendMessage = async (to, payload, options) => {
    h.sent.push({ to, ...payload });
    assert.ok(options.messageId);
    await h.upsert('append', [incoming(options.messageId, now / 1000,
      payload, { fromMe: true, remoteJid: to })]);
    return { key: { id: options.messageId } };
  };
  await h.bot.reply(jid, 'Resposta automática');
  await h.bot.sendTo('5511999999001', 'Aviso automático');
  assert.equal(h.sent.length, 2);
  assert.equal(h.humanActivities.length, 0);
  assert.equal(h.received.length, 0);
});

test('outgoing replay from a previous process and stale or missing timestamps never reset handoff', async () => {
  const startup = harness();
  await startup.upsert('append', [incoming('old-auto-echo', (now - minute) / 1000,
    { conversation: 'Resposta antiga' }, { fromMe: true })]);
  const reconnect = harness({ startedAt: now - 60 * minute });
  const missingTimestamp = incoming('missing-human-time', now / 1000, undefined, { fromMe: true });
  delete missingTimestamp.messageTimestamp;
  for (const type of ['notify', 'append']) await reconnect.upsert(type, [missingTimestamp,
    incoming('stale-human', (now - 16 * minute) / 1000, undefined, { fromMe: true })]);
  assert.equal(startup.humanActivities.length, 0);
  assert.equal(reconnect.humanActivities.length, 0);
});

test('customer inbound messages do not count as human activity', async () => {
  const h = harness();
  await h.upsert('notify', [incoming('customer-message')]);
  assert.equal(h.received.length, 1);
  assert.equal(h.humanActivities.length, 0);
});

test('failed activity recording stays observable and can retry on redelivery without a customer reply', async () => {
  const h = harness();
  let attempts = 0;
  h.bot.recordHumanActivity = async () => {
    if (++attempts === 1) throw new Error('Core temporariamente indisponível');
    return { ok: true, recorded: true };
  };
  const message = incoming('human-retry', now / 1000, undefined, { fromMe: true });
  await h.upsert('notify', [message]);
  assert.match(h.bot.lastError, /registrar atividade humana/);
  await h.upsert('notify', [message]);
  await h.upsert('append', [message]);
  assert.equal(attempts, 2);
  assert.equal(h.sent.length, 0);
});

test('human activity uses the authenticated integration endpoint with bounded retries', async () => {
  const bot = new WhatsAppBot();
  const calls = [];
  bot.gateOne = async (...args) => { calls.push(args); return { ok: true, recorded: true }; };
  const occurredAt = new Date(now).toISOString();
  await bot.recordHumanActivity('5511999999001', 'manual-provider-id', occurredAt);
  assert.deepEqual(calls, [['/api/integrations/whatsapp/human-activity',
    { whatsapp: '5511999999001', messageId: 'manual-provider-id', occurredAt },
    { required: true, attempts: 2, timeoutMs: 8000 }]]);
});

test('ordinary attachment review uses support_media rather than pausing the bot for a human handoff', async () => {
  const h = harness();
  h.bot.loadCustomerContext = async () => null;
  await h.upsert('notify', [incoming('ordinary-media', now / 1000,
    { imageMessage: { caption: 'Minha tela', mimetype: 'image/jpeg' } })]);
  assert.deepEqual(h.sessions, ['support_media']);
  assert.equal(h.sent.length, 1);
});

test('audio without a transcript also leaves automatic assistance available in support_media', async () => {
  const h = harness();
  h.bot.loadCustomerContext = async () => null;
  await h.upsert('notify', [incoming('audio-fallback', now / 1000,
    { audioMessage: { mimetype: 'audio/ogg', seconds: 2 } })]);
  assert.deepEqual(h.sessions, ['support_media']);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].text, /Recebi seu áudio/);
});

test('human activity commits in the customer queue before a following inbound checks handoff expiration', async () => {
  const h = harness();
  let activityRecorded = false;
  h.bot.recordHumanActivity = async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    activityRecorded = true;
    return { ok: true, recorded: true };
  };
  h.bot.registerInbound = async () => {
    assert.equal(activityRecorded, true);
    return { automationPaused: true, sessionState: 'human_handoff' };
  };
  await Promise.all([
    h.upsert('notify', [incoming('human-before-customer', now / 1000, undefined, { fromMe: true })]),
    h.upsert('notify', [incoming('customer-after-human')])
  ]);
  assert.equal(activityRecorded, true);
  assert.equal(h.sent.length, 0);
  assert.equal(h.bot.messageQueues.size, 0);
});
