import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCoreRequest,
  GateCoreClient,
  GATE_CORE_ACTION_CAPABILITIES
} from '../src/gate-core-client.js';

const CUSTOMER_ID = '10000000-0000-4000-8000-000000000001';
const REQUEST_ID = '20000000-0000-4000-8000-000000000002';
const CORRELATION_ID = '30000000-0000-4000-8000-000000000003';

test('cria request envelope v1 com actor, capability e correlation ID', () => {
  const request = createCoreRequest({
    action: 'customer.context.get',
    subject: { type: 'customer', id: CUSTOMER_ID },
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID
  });
  assert.equal(request.contract_version, 1);
  assert.equal(request.actor.type, 'SERVICE');
  assert.equal(request.actor.id, 'whatsapp');
  assert.equal(request.actor.capability, GATE_CORE_ACTION_CAPABILITIES['customer.context.get']);
  assert.equal(request.request_id, REQUEST_ID);
  assert.equal(request.correlation_id, CORRELATION_ID);
});

test('cliente preserva IDs e secret na fronteira HTTP v1', async () => {
  const calls = [];
  const client = new GateCoreClient({
    baseUrl: 'https://gate.invalid/',
    secret: 'test-only-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const request = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          contract_version: 1,
          request_id: request.request_id,
          correlation_id: request.correlation_id,
          status: 'SUCCESS',
          data: { customer_id: CUSTOMER_ID },
          error: null
        })
      };
    }
  });
  const response = await client.getCustomerContext(CUSTOMER_ID, {
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID
  });
  assert.equal(response.data.customer_id, CUSTOMER_ID);
  assert.equal(calls[0].url, 'https://gate.invalid/api/v1/core/operations');
  assert.equal(calls[0].options.headers['X-Gate-One-Bot-Secret'], 'test-only-secret');
});

test('rejeita resposta de outra correlação', async () => {
  const client = new GateCoreClient({
    baseUrl: 'https://gate.invalid',
    secret: 'test-only-secret',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        contract_version: 1,
        request_id: REQUEST_ID,
        correlation_id: '40000000-0000-4000-8000-000000000004',
        status: 'SUCCESS',
        data: {},
        error: null
      })
    })
  });
  await assert.rejects(
    client.getCustomerContext(CUSTOMER_ID, {
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID
    }),
    (error) => error.code === 'CORRELATION_MISMATCH'
  );
});

test('não permite ao canal inventar operação fora do contrato', () => {
  assert.throws(
    () => createCoreRequest({
      action: 'renewal.execute',
      subject: { type: 'customer', id: CUSTOMER_ID }
    }),
    /não suportada/
  );
});

test('solicita Customer 360 por identidade, finalidade e scopes pela fronteira v1', async () => {
  const calls = [];
  const client = new GateCoreClient({
    baseUrl: 'https://gate.invalid',
    secret: 'test-only-secret',
    fetchImpl: async (url, options) => {
      const request = JSON.parse(options.body);
      calls.push({ url, request });
      return {
        ok: true,
        json: async () => ({
          contract_version: 1,
          request_id: request.request_id,
          correlation_id: request.correlation_id,
          status: 'SUCCESS',
          data: {
            contract: 'ContextSnapshot.v1',
            context_snapshot_id: '40000000-0000-4000-8000-000000000004',
            customer360: { contract: 'Customer360.v1', customer_id: CUSTOMER_ID }
          },
          error: null
        })
      };
    }
  });
  const response = await client.getCustomerContextByIdentity({
    type: 'WHATSAPP', provider: 'whatsapp', value: '5511999999999'
  }, {
    purpose: 'SUPPORT',
    requestedScopes: ['IDENTITY', 'SUBSCRIPTION', 'SUPPORT'],
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID
  });
  assert.equal(response.data.contract, 'ContextSnapshot.v1');
  assert.equal(calls[0].request.action, 'customer.context.get');
  assert.equal(calls[0].request.actor.capability, 'customer.context.read');
  assert.equal(calls[0].request.subject.id, undefined);
  assert.deepEqual(calls[0].request.input.identity, {
    type: 'WHATSAPP', provider: 'whatsapp', value: '5511999999999'
  });
  assert.equal(calls[0].request.input.purpose, 'SUPPORT');
  assert.deepEqual(calls[0].request.input.requested_scopes, [
    'IDENTITY', 'SUBSCRIPTION', 'SUPPORT'
  ]);
});

test('falha de contexto retorna envelope seguro sem disparar operação financeira', async () => {
  const actions = [];
  const client = new GateCoreClient({
    baseUrl: 'https://gate.invalid',
    secret: 'test-only-secret',
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      actions.push(request.action);
      return {
        ok: false,
        status: 404,
        json: async () => ({
          contract_version: 1,
          request_id: request.request_id,
          correlation_id: request.correlation_id,
          status: 'FAILED',
          data: null,
          error: { code: 'CUSTOMER_NOT_FOUND', message: 'Cliente não encontrado.' }
        })
      };
    }
  });
  const response = await client.getCustomerContextByIdentity({
    type: 'WHATSAPP', provider: 'whatsapp', value: '5511999999999'
  });
  assert.equal(response.error.code, 'CUSTOMER_NOT_FOUND');
  assert.deepEqual(actions, ['customer.context.get']);
});

test('WhatsApp pode solicitar renovação e consultar estado, nunca executar', async () => {
  const actions = [];
  const client = new GateCoreClient({
    baseUrl: 'https://gate.invalid', secret: 'test-only-secret',
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      actions.push(request);
      return {
        ok: true,
        json: async () => ({
          contract_version: 1,
          request_id: request.request_id,
          correlation_id: request.correlation_id,
          status: 'SUCCESS',
          data: { decision: 'PAYMENT_PENDING' },
          error: null
        })
      };
    }
  });
  await client.requestRenewal(CUSTOMER_ID, { subscription_id: CUSTOMER_ID });
  await client.getRenewalStatus(CUSTOMER_ID, { subscription_id: CUSTOMER_ID });
  assert.deepEqual(actions.map((request) => request.action), [
    'renewal.request', 'renewal.status.get'
  ]);
  assert.equal(actions[0].actor.capability, 'renewal.request');
  assert.equal(actions[1].actor.capability, 'renewal.read');
  assert.ok(actions.every((request) => request.actor.type === 'SERVICE'));
});
