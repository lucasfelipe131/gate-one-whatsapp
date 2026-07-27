import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPlanCode } from '../src/plans.js';
import { isProbableName } from '../src/conversation.js';

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
