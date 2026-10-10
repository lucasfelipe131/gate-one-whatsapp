const FORBIDDEN_CONFIRMATIONS = Object.freeze([
  {
    fact: 'payment_status',
    allowed: 'CONFIRMED',
    pattern: /pagamento\s+(foi |esta |consta |ja )?(confirmado|aprovado)|pagamento caiu/i,
    code: 'PAYMENT_FACT_MISMATCH'
  },
  {
    fact: 'renewal_status',
    allowed: 'COMPLETED',
    pattern: /renovad[oa]\s+com sucesso|renova[cç][aã]o\s+(foi |est[aá] |j[aá] )?(conclu[ií]da|finalizada)/i,
    code: 'RENEWAL_FACT_MISMATCH'
  }
]);

export function validateAutonomousTurn(turn) {
  if (turn?.contract !== 'GateConversationTurn.v1' || turn?.handled !== true) {
    return { valid: false, code: 'AUTONOMOUS_CONTRACT_INVALID' };
  }
  const text = String(turn.response_text || '').trim();
  if (turn.suppress_reply === true) {
    const handoff = turn.response_facts?.handoff_id;
    const pending = turn.outcome === 'HANDOFF_PENDING' || turn.duplicate === true;
    return handoff && pending && turn.conversation_state === 'human_handoff' && !text
      ? { valid: true, code: null }
      : { valid: false, code: 'AUTONOMOUS_SUPPRESSION_INVALID' };
  }
  if (!text) return { valid: false, code: 'AUTONOMOUS_RESPONSE_EMPTY' };
  const facts=turn.response_facts || {};
  if (facts.checkout_url && (!/^https?:\/\//i.test(facts.checkout_url) ||
      (facts.simulated === true && !text.includes('[Simulação]')))) return {valid:false,code:'CHECKOUT_FACT_MISMATCH'};
  if (/encaminhado para a equipe|Registrei o atendimento/i.test(text) && !facts.handoff_id) return {valid:false,code:'HANDOFF_FACT_MISMATCH'};
  if (/caso (foi |est[aá] )?resolvido|problema (foi |est[aá] )?resolvido|servi[cç]o (voltou|normalizado)/i.test(text) &&
      (!['RESOLVED','CLOSED'].includes(facts.case_status) || !['VERIFIED','HUMAN_VERIFIED'].includes(facts.verification_result))) return {valid:false,code:'SUPPORT_FACT_MISMATCH'};
  if (/a[cç][aã]o foi (executada|registrada)/i.test(text) && !facts.action_performed) return {valid:false,code:'SUPPORT_ACTION_MISMATCH'};
  for (const rule of FORBIDDEN_CONFIRMATIONS) {
    if (turn.response_facts?.[rule.fact] !== rule.allowed && rule.pattern.test(text)) {
      return { valid: false, code: rule.code };
    }
  }
  if (!turn.response_facts?.expiration && /\b\d{2}\/\d{2}\/\d{4}\b/.test(text)) {
    return { valid: false, code: 'EXPIRATION_FACT_MISMATCH' };
  }
  return { valid: true, code: null };
}

export async function processAutonomousOperation(gateCore, {
  conversationId,
  messageId,
  phone,
  text,
  contentType = 'TEXT',
  planCode = null,
  correlationId
}) {
  if (!gateCore?.configured) return null;
  const response = await gateCore.processConversation({
    conversation_id: conversationId,
    message: {
      id: messageId,
      text: String(text || ''),
      content_type: String(contentType || 'TEXT').toUpperCase()
    },
    identity: { type: 'WHATSAPP', provider: 'whatsapp', value: phone },
    ...(planCode ? { plan_code: planCode } : {})
  }, correlationId ? { correlationId } : {});
  if (response?.status !== 'SUCCESS') return null;
  const validation = validateAutonomousTurn(response.data);
  if (!validation.valid) {
    return {
      handled: true,
      response_text: 'Não consegui validar a resposta com os dados oficiais. Vou manter o estado seguro e tentar novamente.',
      response_facts: {},
      response_status: 'SAFE_FALLBACK',
      outcome: validation.code,
      conversation_state: null
    };
  }
  return response.data;
}
