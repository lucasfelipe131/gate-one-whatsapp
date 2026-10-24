import test from 'node:test';
import assert from 'node:assert/strict';
import {WhatsAppBot} from '../src/bot.js';

const phone='5511999999701',url='https://gateoneserver-production.up.railway.app/cliente#'+'a'.repeat(43);
const incoming=(text,id=text)=>({key:{id,remoteJid:phone+'@s.whatsapp.net',fromMe:false},message:{conversation:text}});
function sectionUrl(section) {const target=new URL(url);if(section)target.searchParams.set('aba',section);return target.href;}
function runtime({paused=false,sessionState='idle'}={}) {
  const sent=[],calls=[],registration=[],autonomous=[],sessions=[],charges=[];
  const context={automationPaused:paused,sessionState},bot=new WhatsAppBot({logger:{info(){},warn(){}}});
  bot.status='connected';bot.socket={sendMessage:async(jid,payload)=>{sent.push({jid,...payload});return{key:{id:'synthetic'}};}};
  bot.logOutbound=async()=>{};bot.registerInbound=async()=>context;
  bot.runSelfRegistration=async input=>{registration.push(input);return{handled:false};};
  bot.runAutonomousConversation=async input=>{autonomous.push(input);return{handled:false};};
  bot.setSession=async(_phone,state)=>{sessions.push(state);context.sessionState=state;};
  bot.loadCustomerContext=async()=>null;bot.listPlans=async()=> 'Planos legados';bot.lookupCustomer=async()=> 'Conta legada';
  bot.gateCore={configured:false};bot.createPayment=async(...args)=>{charges.push(args);return 'Cobrança sintética';};
  bot.latestContent=async()=>{throw new Error('O catálogo antigo não deve ser enviado no chat.');};
  bot.gateOne=async(path,input)=>{calls.push({path,input});return{portalUrl:url};};
  return{bot,sent,calls,registration,autonomous,sessions,charges};
}

test('PORTAL and CADASTRO aliases send one personal link without creating charges or exposing credentials',async()=>{
  for(const text of ['PORTAL','CADASTRO','6','8','MINHA CONTA','MINHA AREA']){
    const r=runtime();await r.bot.handleMessage(incoming(text));
    assert.equal(r.sent.length,1);assert.ok(r.sent[0].text.includes(url));assert.match(r.sent[0].text,/sem CPF/);
    assert.equal(r.calls.length,1);assert.equal(r.calls[0].path,'/api/integrations/whatsapp/portal');assert.equal(r.calls[0].input.whatsapp,phone);
    assert.equal(r.registration.length,0);assert.equal(r.autonomous.length,0);assert.equal(r.charges.length,0);
    assert.doesNotMatch(r.sent[0].text,/Login:|Senha:|Password:/i);
  }
});

test('installation, notices, news and renewal commands open their section in one reply before any other conversation',async()=>{
  const commands=[['GUIAS','guias'],['INSTALAR','guias'],['COMO INSTALAR','guias'],['AVISOS','avisos'],['NOVIDADES','novidades'],['5','novidades'],['CONTEUDOS','novidades'],['RENOVAR','pagamentos'],['quero renovar','pagamentos'],['QUERO RENOVAR MEU PLANO','pagamentos'],['MEUS PAGAMENTOS','pagamentos'],['MEUSPAGAMENTOS','pagamentos']];
  for(const [text,section] of commands){
    const r=runtime({sessionState:'awaiting_login'});await r.bot.handleMessage(incoming(text));
    assert.equal(r.sent.length,1,text);assert.ok(r.sent[0].text.includes(sectionUrl(section)),text);assert.equal(r.calls.length,1);
    assert.deepEqual(Object.keys(r.calls[0].input).sort(),['messageId','whatsapp']);assert.equal(r.registration.length,0);assert.equal(r.autonomous.length,0);assert.equal(r.charges.length,0);
  }
});

test('natural installation and credential requests open the protected area in one reply without reading or sending account secrets',async()=>{
  const requests=[['como instalar na minha TV Samsung?','guias'],['me ajuda a configurar o IPTV Smarters','guias'],
    ['como trocar a URL no SS IPTV?','guias'],['quero atualizar a lista no ssiptv','guias'],['onde baixar o aplicativo na LG?','guias'],
    ['qual é meu usuário?',null],['esqueci minha senha',null],['me manda o link da área do cliente',null]];
  for(const [text,section] of requests) {
    const r=runtime();await r.bot.handleMessage(incoming(text));
    assert.equal(r.sent.length,1,text);assert.ok(r.sent[0].text.includes(sectionUrl(section)),text);
    assert.equal(r.calls.length,1);assert.equal(r.calls[0].path,'/api/integrations/whatsapp/portal');
    assert.equal(r.autonomous.length,0);assert.equal(r.charges.length,0);
    assert.doesNotMatch(r.sent[0].text,/Login:|Senha:|Password:|username=|password=/i);
  }
});

test('natural requests retain human pause and never steal a payment or human request from the existing flow',async()=>{
  for(const text of ['como trocar a URL no SS IPTV?','esqueci minha senha','me ajuda a instalar na Roku']) {
    const r=runtime({paused:true});await r.bot.handleMessage(incoming(text));
    assert.equal(r.sent.length,0);assert.equal(r.calls.length,0);assert.equal(r.autonomous.length,0);
  }
  for(const text of ['quero falar com atendente para instalar na TV','paguei e quero configurar na LG',
    'quero renovar mensal e ver meu acesso','não quero instalar na Roku']) {
    const r=runtime();r.bot.runAutonomousConversation=async input=>{r.autonomous.push(input);return{handled:true,response_text:'Continuação contextual'};};
    await r.bot.handleMessage(incoming(text));assert.equal(r.calls.length,0,text);assert.equal(r.autonomous.length,1,text);
    assert.equal(r.sent.length,1);assert.equal(r.sent[0].text,'Continuação contextual');
  }
});

test('MENU contains four choices and its numeric selections open the customer area, guides and notices',async()=>{
  for(const [choice,section] of [['1',null],['2','guias'],['3','avisos']]){
    const r=runtime();await r.bot.handleMessage(incoming('MENU','open-menu'));
    const menu=r.sent[0].text;assert.deepEqual(menu.match(/^\*[1-4]\*/gm),['*1*','*2*','*3*','*4*']);assert.doesNotMatch(menu,/^\*[5-8]\*/m);
    assert.match(menu,/Área do cliente/);assert.match(menu,/Guias de instalação/);assert.match(menu,/Avisos e novidades/);
    await r.bot.handleMessage(incoming(choice,'menu-choice'));
    assert.equal(r.sent.length,2);assert.ok(r.sent[1].text.includes(sectionUrl(section)));assert.equal(r.calls.length,1);assert.equal(r.charges.length,0);
  }
});

test('numeric choices 1 to 3 preserve legacy meanings outside the menu state',async()=>{
  for(const state of ['idle','awaiting_plan'])for(const choice of ['1','2','3']){
    const r=runtime({sessionState:state});await r.bot.handleMessage(incoming(choice));
    assert.equal(r.calls.some(call=>call.path==='/api/integrations/whatsapp/portal'),false,`${state}:${choice}`);
    assert.equal(r.sent.length,1);assert.match(r.sent[0].text,choice==='2'?/Conta legada/:/Planos legados/);assert.equal(r.charges.length,0);
  }
});

test('human support remains the fourth menu choice and paused human attendance stays silent for all portal commands',async()=>{
  const human=runtime({sessionState:'menu'});await human.bot.handleMessage(incoming('4'));
  assert.equal(human.sent.length,1);assert.match(human.sent[0].text,/equipe/);assert.equal(human.calls.length,0);assert.deepEqual(human.sessions,['support']);
  for(const text of ['PORTAL','CADASTRO','GUIAS','INSTALAR','AVISOS','NOVIDADES','RENOVAR','1','2','3']){
    const r=runtime({paused:true,sessionState:'menu'});await r.bot.handleMessage(incoming(text));
    assert.equal(r.sent.length,0);assert.equal(r.calls.length,0);assert.equal(r.registration.length,0);assert.equal(r.autonomous.length,0);assert.equal(r.charges.length,0);
  }
});

test('explicit plans and payment-method conversation keep the existing financial flow',async()=>{
  for(const text of ['quero renovar mensal','RENOVAR TRIMESTRAL','PIX','CARTÃO','BOLETO']){
    const r=runtime({sessionState:'menu'});const handled=[];
    r.bot.runAutonomousConversation=async input=>{handled.push(input);return{handled:true,response_text:'Fluxo financeiro preservado'};};
    await r.bot.handleMessage(incoming(text));
    assert.equal(handled.length,1);assert.equal(r.sent.length,1);assert.equal(r.sent[0].text,'Fluxo financeiro preservado');assert.equal(r.calls.length,0);
    if(text.includes('mensal'))assert.equal(handled[0].planCode,'monthly');if(text.includes('TRIMESTRAL'))assert.equal(handled[0].planCode,'quarterly');
  }
});

test('the personal payment section accompanies the existing checkout in one reply',async()=>{
  const r=runtime();
  r.bot.runAutonomousConversation=async()=>({handled:true,response_text:'Formas: Pix e Boleto. https://www.mercadopago.com.br/synthetic',response_facts:{checkout_url:'https://www.mercadopago.com.br/synthetic'}});
  await r.bot.handleMessage(incoming('quero renovar mensal','payment-link'));
  assert.equal(r.sent.length,1);assert.match(r.sent[0].text,/Formas: Pix e Boleto/);assert.ok(r.sent[0].text.includes(sectionUrl('pagamentos')));
  assert.equal(r.calls.length,1);assert.equal(r.calls[0].path,'/api/integrations/whatsapp/portal');assert.equal(r.calls[0].input.messageId,'payment-link:payment');
});

test('the chatbot rejects arbitrary sections and unsafe portal URLs while preserving the secret fragment',async()=>{
  const r=runtime();
  for(const section of ['../../admin','https://attacker.example','guias&next=bad','PASSWORD',{},1])assert.equal(await r.bot.customerPortalLink(phone,'invalid',section),null);
  assert.equal(r.calls.length,0);
  for(const portalUrl of ['https://attacker.example/cliente#'+'a'.repeat(43),'https://gateoneserver-production.up.railway.app/cliente#short','http://gateoneserver-production.up.railway.app/cliente#'+'a'.repeat(43),'https://user:password@gateoneserver-production.up.railway.app/cliente#'+'a'.repeat(43),'https://gateoneserver-production.up.railway.app/cliente?next=bad#'+'a'.repeat(43),'https://gateoneserver-production.up.railway.app/admin#'+'a'.repeat(43)]){
    r.bot.gateOne=async()=>({portalUrl});assert.equal(await r.bot.customerPortalLink(phone,'invalid','guias'),null);
  }
  r.bot.gateOne=async()=>({portalUrl:url});const valid=await r.bot.customerPortalLink(phone,'valid','guias');assert.equal(valid,sectionUrl('guias'));assert.equal(new URL(valid).hash,new URL(url).hash);
});
