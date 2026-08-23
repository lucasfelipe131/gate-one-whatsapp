import { randomUUID } from 'node:crypto';

export const GATE_CORE_CONTRACT_VERSION = 1;

export const GATE_CORE_ACTION_CAPABILITIES = Object.freeze({
  'customer.resolve': 'customer.identity.resolve',
  'customer.context.get': 'customer.context.read',
  'subscription.get': 'subscription.read',
  'payment.request': 'payment.request',
  'renewal.request': 'renewal.request',
  'support.case.open': 'support.case.open'
});

export function createCoreRequest({
  action,
  subject,
  input = {},
  requestId = randomUUID(),
  correlationId = randomUUID()
}) {
  const capability = GATE_CORE_ACTION_CAPABILITIES[action];
  if (!capability) throw new Error(`Ação GATE Core não suportada: ${action}`);
  return {
    contract_version: GATE_CORE_CONTRACT_VERSION,
    request_id: requestId,
    correlation_id: correlationId,
    actor: { type: 'SERVICE', id: 'whatsapp', capability },
    action,
    subject,
    input
  };
}

function validateCoreResponse(response, request) {
  if (!response || response.contract_version !== GATE_CORE_CONTRACT_VERSION) {
    throw Object.assign(new Error('Versão de contrato GATE Core incompatível.'), {
      code: 'CONTRACT_VERSION_UNSUPPORTED'
    });
  }
  if (response.request_id !== request.request_id || response.correlation_id !== request.correlation_id) {
    throw Object.assign(new Error('Resposta GATE Core não corresponde à operação solicitada.'), {
      code: 'CORRELATION_MISMATCH'
    });
  }
  if (!['SUCCESS', 'PENDING', 'REQUIRES_ACTION', 'DENIED', 'FAILED'].includes(response.status)) {
    throw new Error('Status de resposta GATE Core inválido.');
  }
  return response;
}

export class GateCoreClient {
  constructor({ baseUrl, secret, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.secret = secret;
    this.fetch = fetchImpl;
  }

  get configured() {
    return Boolean(this.baseUrl && this.secret && this.fetch);
  }

  async #post(path, body) {
    if (!this.configured) throw new Error('Integração interna com o Gate One não configurada.');
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gate-One-Bot-Secret': this.secret
      },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error?.message || data.error || data.message || `Gate One respondeu ${response.status}`);
      error.status = response.status;
      error.code = data.error?.code || null;
      error.retryable = [429, 502, 503, 504].includes(response.status);
      error.response = data;
      throw error;
    }
    return data;
  }

  postLegacy(path, body) {
    return this.#post(path, body);
  }

  async request(action, { subject, input = {}, requestId, correlationId } = {}) {
    const request = createCoreRequest({
      action,
      subject,
      input,
      ...(requestId ? { requestId } : {}),
      ...(correlationId ? { correlationId } : {})
    });
    try {
      return validateCoreResponse(
        await this.#post('/api/v1/core/operations', request),
        request
      );
    } catch (error) {
      if (error.response) return validateCoreResponse(error.response, request);
      throw error;
    }
  }

  resolveCustomer(identity, options = {}) {
    return this.request('customer.resolve', {
      ...options,
      subject: { type: 'customer' },
      input: identity
    });
  }

  getCustomerContext(customerOrIdentity, options = {}) {
    const isCustomerId = typeof customerOrIdentity === 'string';
    const {
      requestId,
      correlationId,
      purpose = 'CONVERSATION',
      channel = 'WHATSAPP',
      requestedScopes,
      recentMessageLimit,
      memoryLimit
    } = options;
    return this.request('customer.context.get', {
      ...(requestId ? { requestId } : {}),
      ...(correlationId ? { correlationId } : {}),
      subject: {
        type: 'customer',
        ...(isCustomerId ? { id: customerOrIdentity } : {})
      },
      input: {
        ...(!isCustomerId ? { identity: customerOrIdentity } : {}),
        purpose,
        channel,
        ...(requestedScopes ? { requested_scopes: requestedScopes } : {}),
        ...(recentMessageLimit !== undefined
          ? { recent_message_limit: recentMessageLimit }
          : {}),
        ...(memoryLimit !== undefined ? { memory_limit: memoryLimit } : {})
      }
    });
  }

  getCustomerContextByIdentity(identity, options = {}) {
    return this.getCustomerContext(identity, options);
  }

  getSubscription(customerId, options = {}) {
    return this.request('subscription.get', {
      ...options,
      subject: { type: 'customer', id: customerId }
    });
  }

  requestPayment(customerId, input = {}, options = {}) {
    return this.request('payment.request', {
      ...options,
      subject: { type: 'customer', id: customerId },
      input
    });
  }

  requestRenewal(customerId, input = {}, options = {}) {
    return this.request('renewal.request', {
      ...options,
      subject: { type: 'customer', id: customerId },
      input
    });
  }

  openSupportCase(customerId, input, options = {}) {
    return this.request('support.case.open', {
      ...options,
      subject: { type: 'customer', id: customerId },
      input
    });
  }
}
