import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WhatsAppBot } from '../src/bot.js';
import { DeliveryJournal } from '../src/delivery-journal.js';
import { processAutonomousOperation } from '../src/autonomous-operations.js';

test('the WhatsApp handler routes plan selection to Core and delivers one automatic confirmation across replay and restart',async()=>{
  const phone='5511999999002',sent=[],inputs=[];
  let sessionState='idle';
  const bot=new WhatsAppBot({logger:{warn(){},info(){}}});
  bot.status='connected';
  bot.socket={sendMessage:async(jid,payload)=>{sent.push({jid,...payload});return {key:{id:`synthetic-${sent.length}`}};}};
  bot.logOutbound=async()=>{};
  bot.registerInbound=async()=>({sessionState,automationPaused:false});
  bot.runSelfRegistration=async()=>({handled:false});
  bot.setSession=async(_phone,state)=>{sessionState=state;};
  bot.loadCustomerContext=async()=>{throw new Error('must use Core for plan choice');};
  bot.createPayment=async()=>{throw new Error('must not use legacy checkout');};
  const checkout='https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=synthetic';
  const core={configured:true,processConversation:async input=>{
    inputs.push(input);
    let data;
    if(input.message.text==='quero renovar') data={conversation_state:'awaiting_plan',response_facts:{},response_text:'Escolha o plano: Mensal, Trimestral, Semestral ou Anual.'};
    else if(input.message.text==='trimestral') {
      assert.equal(input.plan_code,'quarterly');
      data={conversation_state:'waiting_payment',response_facts:{checkout_url:checkout,plan_name:'Trimestral',amount_cents:8500,simulated:false},response_text:`Plano Trimestral — R$ 85,00. ${checkout}`};
    } else data={conversation_state:'waiting_payment',response_facts:{payment_status:'PENDING'},response_text:'Aguardando a confirmação oficial do pagamento.'};
    return {status:'SUCCESS',data:{contract:'GateConversationTurn.v1',handled:true,...data}};
  }};
  bot.runAutonomousConversation=input=>processAutonomousOperation(core,{...input,conversationId:`whatsapp:${phone}`});
  const receive=(text,id)=>bot.handleMessage({key:{id,remoteJid:`${phone}@s.whatsapp.net`,fromMe:false},message:{conversation:text}});
  await receive('quero renovar','choose');
  assert.equal(sessionState,'awaiting_plan'); assert.doesNotMatch(sent[0].text,/https:/);
  await receive('trimestral','plan'); assert.equal(sessionState,'waiting_payment');
  assert.ok(sent[1].text.includes(checkout));
  await receive('paguei','receipt'); assert.match(sent[2].text,/Aguardando/); assert.doesNotMatch(sent[2].text,/foi confirmado/);
  assert.equal(inputs.length,3);
  const directory=await mkdtemp(join(tmpdir(),'gate-payment-flow-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir())+'\\') || resolve(directory).startsWith(resolve(tmpdir())+'/'));
  try {
    const notice={to:phone,text:'Seu pagamento de R$ 85,00 foi confirmado. Plano: Trimestral. A renovação aguarda a verificação operacional.',deliveryKey:'synthetic-payment-confirmed'};
    await new DeliveryJournal({directory,bot}).deliver(notice);
    assert.equal((await new DeliveryJournal({directory,bot}).deliver(notice)).duplicate,true);
    assert.equal(sent.filter(m=>m.text===notice.text).length,1);
    assert.equal(sent.length,4);
  } finally {await rm(directory,{recursive:true,force:true});}
});
