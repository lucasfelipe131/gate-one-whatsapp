import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  buildContextAccountMessage,
  buildContextGreeting,
  buildPaidContextReply,
  buildPendingOperationReply,
  buildRenewalStatusReply,
  contextPurposeForCommand,
  customer360FromResponse,
  isIdentifiedCustomer360
} from '../src/customer-context.js';

const CUSTOMER_ID = '10000000-0000-4000-8000-000000000001';

function fact(value) {
  return {
    value,
    source: 'test',
    source_id: CUSTOMER_ID,
    observed_at: '2026-08-22T12:00:00.000Z',
    freshness: 'CURRENT'
  };
}

function customer360(overrides = {}) {
  return {
    contract: 'Customer360.v1',
    customer_id: CUSTOMER_ID,
    resolution: { status: 'MATCHED', matched_by: { type: 'WHATSAPP', provider: 'whatsapp' } },
    context_status: 'COMPLETE',
    identity: { name: fact('João Cliente'), identities: [] },
    lifecycle: { state: fact('ACTIVE'), recent_transition: null },
    subscription: {
      subscription_id: '20000000-0000-4000-8000-000000000002',
      plan_name: fact('Mensal'),
      expires_at: fact('2026-09-22'),
      status: fact('ACTIVE')
    },
    pending_actions: [],
    missing_fields: [],
    ...overrides
  };
}

test('cliente identificado recebe saudação natural sem nome ou menu repetido', () => {
  const context = customer360();
  assert.equal(isIdentifiedCustomer360(context), true);
  const greeting = buildContextGreeting(context);
  assert.match(greeting, /Oi, João!/);
  assert.match(greeting, /Mensal/);
  assert.match(greeting, /22\/09\/2026/);
  assert.doesNotMatch(greeting, /qual.*nome|MENU/i);
});

test('conta usa apenas dados presentes e declara contexto parcial', () => {
  const message = buildContextAccountMessage(customer360({ context_status: 'PARTIAL' }));
  assert.match(message, /Plano: Mensal/);
  assert.match(message, /Status: ACTIVE/);
  assert.match(message, /não vou inventar/i);
});

test('pagamento e renovação pendentes impedem operação duplicada', () => {
  assert.match(buildPendingOperationReply(customer360({
    pending_actions: [{ type: 'PAYMENT', status: 'PENDING', reference_id: 'payment-1' }]
  })), /segunda operação/i);
  assert.match(buildPendingOperationReply(customer360({
    pending_actions: [{ type: 'RENEWAL', status: 'PROCESSING', reference_id: 'renewal-1' }]
  })), /renovação já está em andamento/i);
});

test('PAGUEI distingue confirmado, pendente e contexto indisponível', () => {
  assert.match(buildPaidContextReply(customer360({
    financial: { confirmed_payment: { status: 'CONFIRMED' }, pending_payment: null },
    renewal: { status: 'PROCESSING' }
  })), /confirmado.*PROCESSING/i);
  assert.match(buildPaidContextReply(customer360({
    financial: { confirmed_payment: null, pending_payment: { status: 'PENDING' } }
  })), /ainda aparece como pendente/i);
  assert.match(buildPaidContextReply(null), /Não consegui consultar/i);
});

test('finalidade é escolhida antes da resposta sem criar regra financeira no canal', () => {
  assert.equal(contextPurposeForCommand('oi'), 'CONVERSATION');
  assert.equal(contextPurposeForCommand('minha conta'), 'PAYMENT');
  assert.equal(contextPurposeForCommand('renovar'), 'RENEWAL');
  assert.equal(contextPurposeForCommand('paguei'), 'PAYMENT');
  assert.equal(contextPurposeForCommand('atendente'), 'SUPPORT');
});

test('extrai somente snapshots v1 bem-sucedidos', () => {
  const context = customer360();
  assert.equal(customer360FromResponse({
    status: 'SUCCESS',
    data: { contract: 'ContextSnapshot.v1', customer360: context }
  }), context);
  assert.equal(customer360FromResponse({ status: 'FAILED', data: null }), null);
});

test('status estruturado não antecipa sucesso em PROCESSING ou VERIFYING', () => {
  assert.match(buildRenewalStatusReply({
    status: 'SUCCESS', data: {
      decision: 'RENEWAL_ALREADY_IN_PROGRESS', renewal_status: 'PROCESSING'
    }
  }), /em processamento.*PROCESSING/i);
  assert.doesNotMatch(buildRenewalStatusReply({
    status: 'SUCCESS', data: {
      decision: 'RENEWAL_ALREADY_IN_PROGRESS', renewal_status: 'VERIFYING'
    }
  }), /concluída|sucesso/i);
  assert.match(buildRenewalStatusReply({
    status: 'SUCCESS', data: { decision: 'ALREADY_RENEWED', renewal_status: 'COMPLETED' }
  }), /concluída e verificada/i);
});

test('paguei sem fonte oficial permanece pendente e falhas são conservadoras', () => {
  assert.match(buildRenewalStatusReply({
    status: 'SUCCESS', data: { decision: 'PAYMENT_PENDING' }
  }), /fonte financeira oficial/i);
  assert.match(buildRenewalStatusReply({
    status: 'FAILED', error: { code: 'CONTEXT_UNAVAILABLE' }
  }), /Nenhum resultado será inventado/i);
  assert.match(buildRenewalStatusReply({
    status: 'FAILED', error: { code: 'CUSTOMER_NOT_FOUND' }
  }), /Não localizei/i);
});

test('bot solicita contexto pela nova fronteira, preserva fallback e não executa renovação nova', async () => {
  const source = await readFile(new URL('../src/bot.js', import.meta.url), 'utf8');
  assert.match(source, /getCustomerContextByIdentity/);
  assert.match(source, /fallback legado preservado/);
  assert.match(source, /buildPendingOperationReply\(customer360\)/);
  assert.match(source, /postLegacy/);
  assert.doesNotMatch(source, /renewal\.execute|executeRenewal/);
});
