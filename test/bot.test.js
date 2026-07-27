import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPlanCode } from '../src/plans.js';
import {
  isProbableName,
  normalizeBrazilianPhoneDigits,
  phoneFromWhatsAppJid,
  resolveCustomerJid
} from '../src/conversation.js';

test('reconhece todos os planos e valores do catálogo Gate One', () => {
  assert.equal(detectPlanCode('mensal'), 'monthly');
  assert.equal(detectPlanCode('30'), 'monthly');
  assert.equal(detectPlanCode('trimestral'), 'quarterly');
  assert.equal(detectPlanCode('85'), 'quarterly');
  assert.equal(detectPlanCode('semestral'), 'semiannual');
  assert.equal(detectPlanCode('150'), 'semiannual');
  assert.equal(detectPlanCode('anual'), 'annual');
  assert.equal(detectPlanCode('270'), 'annual');
  assert.equal(detectPlanCode('atendente'), null);
});

test('distingue nome de comandos do atendimento', () => {
  assert.equal(isProbableName('Lucas Felipe de Oliveira'), true);
  assert.equal(isProbableName('Ana'), true);
  assert.equal(isProbableName('MENU'), false);
  assert.equal(isProbableName('plano mensal'), false);
  assert.equal(isProbableName('3'), false);
});

test('usa sempre o telefone real quando o WhatsApp alterna entre PN e LID', async () => {
  const aliases = new Map();
  assert.equal(
    await resolveCustomerJid(
      {
        remoteJid: '5511999999999@s.whatsapp.net',
        remoteJidAlt: '123456789012345@lid',
        addressingMode: 'pn'
      },
      aliases
    ),
    '5511999999999@s.whatsapp.net'
  );
  assert.equal(
    await resolveCustomerJid(
      {
        remoteJid: '123456789012345@lid',
        remoteJidAlt: '5511999999999@s.whatsapp.net',
        addressingMode: 'lid'
      },
      aliases
    ),
    '5511999999999@s.whatsapp.net'
  );
  assert.equal(
    await resolveCustomerJid({ remoteJid: '123456789012345@lid' }, aliases),
    '5511999999999@s.whatsapp.net'
  );
});

test('remove o identificador do aparelho ao normalizar o telefone', async () => {
  assert.equal(
    await resolveCustomerJid({ remoteJid: '5511999999999:12@s.whatsapp.net' }),
    '5511999999999@s.whatsapp.net'
  );
  assert.equal(
    phoneFromWhatsAppJid('5555999999999:12@s.whatsapp.net'),
    '5555999999999'
  );
});

test('unifica celular brasileiro com ou sem o nono dígito', async () => {
  assert.equal(
    normalizeBrazilianPhoneDigits('555599998633'),
    '5555999998633'
  );
  assert.equal(
    await resolveCustomerJid({ remoteJid: '555599998633@s.whatsapp.net' }),
    '5555999998633@s.whatsapp.net'
  );
  assert.equal(
    phoneFromWhatsAppJid('555599998633:12@s.whatsapp.net'),
    '5555999998633'
  );
  assert.equal(
    normalizeBrazilianPhoneDigits('555533338633'),
    '555533338633'
  );
});

test('normaliza telefone sem país e rejeita LID como telefone', async () => {
  assert.equal(
    await resolveCustomerJid({ remoteJid: '55999999999@s.whatsapp.net' }),
    '5555999999999@s.whatsapp.net'
  );
  assert.equal(phoneFromWhatsAppJid('123456789012345@lid'), null);
  assert.equal(
    await resolveCustomerJid({ remoteJid: '123456789012345@s.whatsapp.net' }),
    null
  );
});

test('recupera do armazenamento persistente o telefone de um LID após reiniciar', async () => {
  const aliases = new Map();
  const calls = [];
  const resolved = await resolveCustomerJid(
    { remoteJid: '123456789012345@lid' },
    aliases,
    async (lid) => {
      calls.push(lid);
      return '5511999999999:8@s.whatsapp.net';
    }
  );
  assert.equal(resolved, '5511999999999@s.whatsapp.net');
  assert.deepEqual(calls, ['123456789012345@lid']);
  assert.equal(aliases.get('123456789012345@lid'), '5511999999999@s.whatsapp.net');
});
