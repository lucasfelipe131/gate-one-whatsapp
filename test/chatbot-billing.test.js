import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAutonomousTurn,processAutonomousOperation} from '../src/autonomous-operations.js';
const turn = (response_text,response_facts) => ({contract:'GateConversationTurn.v1',handled:true,response_text,response_facts});

test('simulated checkout cannot be delivered as a real payment request',() => {
  const facts = {checkout_url:'https://staging.example/pagamento?status=simulation&charge=fake',simulated:true,payment_status:'PENDING'};
  assert.equal(validateAutonomousTurn(turn(`Pague aqui: ${facts.checkout_url}`,facts)).code,'CHECKOUT_FACT_MISMATCH');
  assert.equal(validateAutonomousTurn(turn(`[Simulação] Mesmo link: ${facts.checkout_url}`,facts)).valid,true);
});
test('human handoff requires a confirmed handoff identifier',() => {
  assert.equal(validateAutonomousTurn(turn('Seu atendimento está encaminhado para a equipe.',{})).code,'HANDOFF_FACT_MISMATCH');
  assert.equal(validateAutonomousTurn(turn('Seu atendimento está encaminhado para a equipe.',{handoff_id:'fake-handoff'})).valid,true);
});
test('channel preserves persisted waiting-payment state and reused checkout from Core',async () => {
  const response = turn('[Simulação] Use o mesmo link: https://staging.example/pagamento',
    {checkout_url:'https://staging.example/pagamento',simulated:true,payment_status:'PENDING'});
  response.conversation_state = 'waiting_payment';
  const result = await processAutonomousOperation({configured:true,processConversation:async () => ({status:'SUCCESS',data:response})},
    {conversationId:'fake-conversation',messageId:'fake-message',phone:'synthetic',text:'e o link?'});
  assert.equal(result.conversation_state,'waiting_payment');
  assert.equal(result.response_facts.checkout_url,response.response_facts.checkout_url);
});
