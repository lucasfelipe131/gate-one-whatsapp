function factValue(fact) {
  return fact && Object.hasOwn(fact, 'value') ? fact.value : null;
}

function formatDate(value) {
  if (!value) return null;
  const text = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T12:00:00`)
    : new Date(text);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function firstName(value) {
  return String(value || '').trim().split(/\s+/)[0] || 'cliente';
}

export function customer360FromResponse(response) {
  const snapshot = response?.data;
  if (response?.status !== 'SUCCESS' || snapshot?.contract !== 'ContextSnapshot.v1') return null;
  if (snapshot.customer360?.contract !== 'Customer360.v1') return null;
  return snapshot.customer360;
}

export function isIdentifiedCustomer360(customer360) {
  if (customer360?.resolution?.status !== 'MATCHED') return false;
  return Boolean(
    factValue(customer360.identity?.name) ||
    customer360.subscription?.subscription_id
  );
}

export function contextPurposeForCommand(command) {
  const normalized = String(command || '').trim().toUpperCase();
  if (/^(2|MINHA CONTA|VENCIMENTO|CONTA)$/.test(normalized)) return 'PAYMENT';
  if (/^(3|RENOVAR|RENOVACAO|PIX)$/.test(normalized)) return 'RENEWAL';
  if (/^(PAGAMENTO|PAGUEI|COMPROVANTE)$/.test(normalized)) return 'PAYMENT';
  if (/^(4|ATENDENTE|SUPORTE|HUMANO|FALAR COM ATENDENTE)$/.test(normalized)) return 'SUPPORT';
  return 'CONVERSATION';
}

export function buildContextGreeting(customer360) {
  if (!isIdentifiedCustomer360(customer360)) return null;
  const name = firstName(factValue(customer360.identity?.name));
  const plan = factValue(customer360.subscription?.plan_name);
  const expires = formatDate(factValue(customer360.subscription?.expires_at));
  const lifecycle = factValue(customer360.lifecycle?.state);
  if (plan && expires && lifecycle === 'ACTIVE') {
    return `Oi, ${name}! 👋 Seu plano ${plan} está ativo até ${expires}. Como posso ajudar hoje?`;
  }
  if (plan && expires && ['PAST_DUE', 'CHURNED', 'BLOCKED'].includes(lifecycle)) {
    return `Oi, ${name}! 👋 Encontrei seu plano ${plan}, com vencimento em ${expires}. Pode me contar o que você precisa?`;
  }
  if (plan && expires) {
    return `Oi, ${name}! 👋 Encontrei seu plano ${plan}, válido até ${expires}. Como posso ajudar?`;
  }
  return `Oi, ${name}! 👋 Já localizei seu cadastro. Pode me contar o que você precisa.`;
}

export function buildContextAccountMessage(customer360) {
  if (!isIdentifiedCustomer360(customer360)) return null;
  const name = firstName(factValue(customer360.identity?.name));
  const subscription = customer360.subscription;
  if (!subscription) {
    return `Olá, ${name}! Localizei seu cadastro, mas não há uma assinatura disponível no contexto atual. A equipe pode conferir sem você repetir seus dados.`;
  }
  const plan = factValue(subscription.plan_name) || 'em definição';
  const expires = formatDate(factValue(subscription.expires_at)) || 'em atualização';
  const status = factValue(subscription.status) || 'INDEFINIDO';
  const payment = customer360.financial?.pending_payment
    ? 'Existe um pagamento pendente.'
    : customer360.financial?.confirmed_payment
      ? 'O último pagamento relevante está confirmado.'
      : null;
  const renewal = customer360.renewal?.status
    ? `Renovação: ${customer360.renewal.status}.`
    : null;
  return [
    `Olá, ${name}! Aqui está o contexto atual da sua conta:`,
    `• Plano: ${plan}`,
    `• Validade: ${expires}`,
    `• Status: ${status}`,
    payment ? `• ${payment}` : '',
    renewal ? `• ${renewal}` : '',
    customer360.context_status === 'PARTIAL'
      ? 'Alguns dados ainda estão em atualização; não vou inventar o que falta.'
      : ''
  ].filter(Boolean).join('\n');
}

export function buildPendingOperationReply(customer360) {
  const pending = customer360?.pending_actions || [];
  const renewal = pending.find((item) => item.type === 'RENEWAL');
  if (renewal) {
    return `Sua renovação já está em andamento (${renewal.status}). Não vou iniciar outra operação.`;
  }
  const payment = pending.find((item) => ['PAYMENT', 'CHARGE'].includes(item.type));
  if (payment) {
    return `Já existe um pagamento/cobrança em andamento (${payment.status}). Não vou gerar uma segunda operação.`;
  }
  return null;
}

export function buildPaidContextReply(customer360) {
  if (!customer360) {
    return 'Não consegui consultar o pagamento agora. Seu comprovante pode ser conferido pela equipe, e nenhuma renovação será iniciada sem confirmação oficial.';
  }
  const confirmed = customer360?.financial?.confirmed_payment;
  if (confirmed) {
    const renewal = customer360.renewal?.status;
    return renewal
      ? `O pagamento consta como confirmado e a renovação está em ${renewal}. Não é necessário enviar novamente.`
      : 'O pagamento consta como confirmado. A renovação só será considerada concluída após a etapa operacional.';
  }
  const pending = customer360?.financial?.pending_payment;
  if (pending) {
    return 'O pagamento ainda aparece como pendente. A confirmação oficial vem do provedor; não vou tratá-lo como aprovado antes disso.';
  }
  return 'Ainda não encontrei uma confirmação de pagamento no contexto atual. A equipe pode conferir o comprovante sem iniciar uma renovação automática.';
}

export { factValue };
