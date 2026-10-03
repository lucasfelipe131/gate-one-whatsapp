import test from 'node:test';
import assert from 'node:assert/strict';
import { isHumanSupportCommand } from '../src/conversation.js';

test('encaminha pedidos naturais para uma pessoa e respeita negações', () => {
  for (const text of ['quero falar com uma pessoa', 'preciso de um atendente',
    'posso conversar com alguém?', 'chame a equipe', '4', 'falar com atendente']) {
    assert.equal(isHumanSupportCommand(text), true, text);
  }
  for (const text of ['não quero falar com uma pessoa', 'não preciso de atendente',
    'minha irmã precisa pagar', 'já falei com o atendente ontem', 'quero renovar']) {
    assert.equal(isHumanSupportCommand(text), false, text);
  }
});
