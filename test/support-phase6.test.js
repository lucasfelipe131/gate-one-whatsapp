import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAutonomousTurn,processAutonomousOperation } from '../src/autonomous-operations.js';
const turn=(text,facts)=>({contract:'GateConversationTurn.v1',handled:true,response_text:text,response_facts:facts});
test('support refuses resolution without verified official facts',()=>{assert.equal(validateAutonomousTurn(turn('O caso foi resolvido.',{case_status:'OPEN'})).code,'SUPPORT_FACT_MISMATCH');});
test('support accepts verified Core resolution',()=>{assert.equal(validateAutonomousTurn(turn('O caso foi resolvido e o resultado foi verificado.',{case_status:'RESOLVED',verification_result:'VERIFIED'})).valid,true);});
test('support refuses invented executed action',()=>{assert.equal(validateAutonomousTurn(turn('A ação foi executada.',{})).code,'SUPPORT_ACTION_MISMATCH');});
test('support keeps waiting-customer state without claiming resolution',()=>{assert.equal(validateAutonomousTurn(turn('A ação foi registrada, mas preciso de sua confirmação.',{case_status:'WAITING_CUSTOMER',action_performed:'REFRESH_SYNTHETIC_SESSION'})).valid,true);});
test('support uses the same Core conversation pipeline and preserves exception facts',async()=>{
  let calls=0;const result=await processAutonomousOperation({configured:true,processConversation:async input=>{calls++;assert.equal(input.message.text,'não está funcionando');return {status:'SUCCESS',data:turn('Registrei o atendimento para uma pessoa continuar.',{case_status:'HUMAN_REQUIRED',exception_id:'fake-exception',handoff_id:'fake-exception'})};}},{conversationId:'fake',messageId:'fake-msg',phone:'synthetic',text:'não está funcionando'});
  assert.equal(calls,1);assert.equal(result.response_facts.exception_id,'fake-exception');assert.doesNotMatch(result.response_text,/Escolha uma opção/);
});
test('support unsafe Core result becomes safe fallback instead of delivery',async()=>{
  const result=await processAutonomousOperation({configured:true,processConversation:async()=>({status:'SUCCESS',data:turn('Seu problema foi resolvido.',{case_status:'OPEN'})})},{conversationId:'fake',messageId:'fake-msg',phone:'synthetic',text:'erro'});assert.equal(result.response_status,'SAFE_FALLBACK');
});
