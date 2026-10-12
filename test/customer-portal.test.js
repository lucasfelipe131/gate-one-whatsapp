import test from 'node:test';
import assert from 'node:assert/strict';
import {WhatsAppBot} from '../src/bot.js';
const phone='5511999999701',url='https://gateoneserver-production.up.railway.app/cliente#'+'a'.repeat(43);
function runtime(paused=false) {const sent=[],calls=[];const bot=new WhatsAppBot({logger:{info(){},warn(){}}});bot.status='connected';bot.socket={sendMessage:async(jid,payload)=>{sent.push({jid,...payload});return{key:{id:'synthetic'}};}};bot.logOutbound=async()=>{};bot.registerInbound=async()=>({automationPaused:paused,sessionState:'idle'});bot.runSelfRegistration=async()=>({handled:false});bot.gateOne=async(path,input)=>{calls.push({path,input});return{portalUrl:url};};return{bot,sent,calls};}
test('PORTAL and CADASTRO send one personal link without creating a charge or exposing login in chat',async()=>{
  for(const text of ['PORTAL','CADASTRO','6','8','MINHA CONTA','MEUS PAGAMENTOS']){const {bot,sent,calls}=runtime();await bot.handleMessage({key:{id:text,remoteJid:phone+'@s.whatsapp.net',fromMe:false},message:{conversation:text}});assert.equal(sent.length,1);assert.ok(sent[0].text.includes(url));assert.match(sent[0].text,/sem CPF/);assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/integrations/whatsapp/portal');assert.equal(calls[0].input.whatsapp,phone);}
});
test('human handoff stays silent even for portal requests',async()=>{const{bot,sent,calls}=runtime(true);await bot.handleMessage({key:{id:'hold',remoteJid:phone+'@s.whatsapp.net',fromMe:false},message:{conversation:'PORTAL'}});assert.equal(sent.length,0);assert.equal(calls.length,0);});

test('the personal portal accompanies the payment link in one reply',async()=>{
  const{bot,sent,calls}=runtime();
  bot.runAutonomousConversation=async()=>({handled:true,response_text:'Formas: Pix e Boleto. https://www.mercadopago.com.br/synthetic',response_facts:{checkout_url:'https://www.mercadopago.com.br/synthetic'}});
  await bot.handleMessage({key:{id:'payment-link',remoteJid:phone+'@s.whatsapp.net',fromMe:false},message:{conversation:'quero renovar mensal'}});
  assert.equal(sent.length,1);assert.match(sent[0].text,/Formas: Pix e Boleto/);assert.ok(sent[0].text.includes(url));
  assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/integrations/whatsapp/portal');assert.equal(calls[0].input.messageId,'payment-link:payment');
});
test('the chatbot rejects portal links from another host or with an invalid secret fragment',async()=>{const{bot}=runtime();for(const portalUrl of ['https://attacker.example/cliente#'+'a'.repeat(43),'https://gateoneserver-production.up.railway.app/cliente#short']){bot.gateOne=async()=>({portalUrl});assert.equal(await bot.customerPortalLink(phone,'invalid'),null);}});
