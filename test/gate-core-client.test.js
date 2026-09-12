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
