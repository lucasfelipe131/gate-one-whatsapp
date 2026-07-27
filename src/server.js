import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WhatsAppBot } from './bot.js';

const app = Fastify({ logger: false });
const here = dirname(fileURLToPath(import.meta.url));
const bot = new WhatsAppBot();
const adminToken = process.env.ADMIN_TOKEN;
const notifySecret = process.env.GATE_ONE_NOTIFY_SECRET;
if (!adminToken || adminToken.length < 24) app.log.warn('ADMIN_TOKEN deve ter ao menos 24 caracteres antes do uso em produção.');

await app.register(fastifyStatic, { root: join(here, '..', 'public'), prefix: '/' });
app.addHook('onRequest', async (request, reply) => {
  if (!request.url.startsWith('/api/')) return;
  // Gate One posts payment notices with its own one-purpose secret. It must
  // not require the browser administrator token.
  if (request.url === '/api/gate-one/notify') return;
  const provided = request.headers['x-admin-token'];
  if (!adminToken || provided !== adminToken) return reply.code(401).send({ error: 'Não autorizado.' });
});
app.get('/', (_, reply) => reply.sendFile('index.html'));
app.get('/health', async () => ({ ok: true, whatsapp: bot.snapshot().status }));
app.get('/api/status', async () => bot.snapshot());
app.post('/api/connect', async () => { await bot.connect(); return bot.snapshot(); });
app.post('/api/disconnect', async () => { await bot.disconnect(); return bot.snapshot(); });
// Called only by the Gate One main service after Mercado Pago confirms a payment.
app.post('/api/gate-one/notify', async (request, reply) => {
  const provided = String(request.headers['x-gate-one-notify-secret'] || '');
  if (!notifySecret || provided !== notifySecret) return reply.code(401).send({ error: 'Não autorizado.' });
  const body = request.body || {};
  if (!body.to || !body.text) return reply.code(400).send({ error: 'Destino e mensagem são obrigatórios.' });
  const sent = await bot.sendTo(body.to, body.text);
  if (!sent) return reply.code(503).send({ error: 'WhatsApp ainda não está conectado.' });
  return { ok: true };
});

const port = Number(process.env.PORT || 3001);
await app.listen({ port, host: '0.0.0.0' });
bot.connect().catch((error) => {
  app.log.error({ error: error.message }, 'Falha na conexão automática do WhatsApp');
});
