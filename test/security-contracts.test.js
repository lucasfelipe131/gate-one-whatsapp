import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('serviço mantém secrets separados e redigidos', async () => {
  const [server, bot, coreClient] = await Promise.all([
    readFile(new URL('../src/server.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/bot.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/gate-core-client.js', import.meta.url), 'utf8')
  ]);
  assert.match(server, /req\.headers\.x-admin-token/);
  assert.match(server, /req\.headers\.x-gate-one-notify-secret/);
  assert.match(bot, /GATE_ONE_SHARED_SECRET/);
  assert.match(coreClient, /X-Gate-One-Bot-Secret/);
  assert.doesNotMatch(`${server}\n${bot}\n${coreClient}`, /(?:token|secret)\s*=\s*['"][A-Za-z0-9_-]{24,}['"]/i);
});

test('health não expõe estado de autenticação bruto', async () => {
  const source = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(source, /app\.get\('\/health'/);
  assert.doesNotMatch(source, /\/health[\s\S]{0,300}(?:creds|cookies|storageState)/);
});
