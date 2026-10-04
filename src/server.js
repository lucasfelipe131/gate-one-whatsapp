import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WhatsAppBot } from './bot.js';
import { DeliveryJournal } from './delivery-journal.js';
import { createHash,timingSafeEqual } from 'node:crypto';

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: ['req.headers.x-admin-token', 'req.headers.x-gate-one-notify-secret']
  }
});
const here = dirname(fileURLToPath(import.meta.url));
const bot = new WhatsAppBot({ logger: app.log });
const deliveries=new DeliveryJournal({bot,directory:join(dirname(process.env.AUTH_DIR||'./auth'),'whatsapp-deliveries')});
const sameSecret=(a,b)=>Boolean(a&&b)&&timingSafeEqual(createHash('sha256').update(String(a)).digest(),createHash('sha256').update(String(b)).digest());
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
  if (!sameSecret(notifySecret,provided)) return reply.code(401).send({ error: 'Não autorizado.' });
  const body = request.body || {};
  if (!body.to || !body.text) return reply.code(400).send({ error: 'Destino e mensagem são obrigatórios.' });
  try {return await deliveries.deliver(body);} catch(error) {
    const code=error.code||'QR_TRANSPORT_UNCERTAIN';
    const status=['INVALID_DELIVERY','INVALID_DELIVERY_KEY'].includes(code)?400:
      ['DELIVERY_REQUIRES_REVIEW','DELIVERY_KEY_CONFLICT'].includes(code)?409:503;
    app.log.warn({code},'Entrega automática interrompida');
    return reply.code(status).send({ok:false,code});
  }
});

const port = Number(process.env.PORT || 3001);
await app.listen({ port, host: '0.0.0.0' });
if(process.env.GATE_MIGRATION_HOLD!=='true') bot.connect().catch((error) => {
  app.log.error({ error: error.message }, 'Falha na conexão automática do WhatsApp');
});
