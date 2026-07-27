import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WhatsAppBot } from './bot.js';

const app = Fastify({ logger: false });
const here = dirname(fileURLToPath(import.meta.url));
const bot = new WhatsAppBot();
const adminToken = process.env.ADMIN_TOKEN;
if (!adminToken || adminToken.length < 24) app.log.warn('ADMIN_TOKEN deve ter ao menos 24 caracteres antes do uso em produção.');

await app.register(fastifyStatic, { root: join(here, '..', 'public'), prefix: '/' });
app.addHook('onRequest', async (request, reply) => {
  if (!request.url.startsWith('/api/')) return;
  const provided = request.headers['x-admin-token'];
  if (!adminToken || provided !== adminToken) return reply.code(401).send({ error: 'Não autorizado.' });
});
app.get('/', (_, reply) => reply.sendFile('index.html'));
app.get('/health', async () => ({ ok: true, whatsapp: bot.snapshot().status }));
app.get('/api/status', async () => bot.snapshot());
app.post('/api/connect', async () => { await bot.connect(); return bot.snapshot(); });
app.post('/api/disconnect', async () => { await bot.disconnect(); return bot.snapshot(); });

const port = Number(process.env.PORT || 3001);
await app.listen({ port, host: '0.0.0.0' });
