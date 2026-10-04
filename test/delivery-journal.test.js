import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeliveryJournal } from '../src/delivery-journal.js';

test('durable WhatsApp delivery prevents repeats across requests, concurrency and restart',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'gate-delivery-'));
  let sends=0;
  const bot={snapshot:()=>({status:'connected'}),sendTo:async()=>{sends++;return {key:{id:'synthetic-message'}};}};
  const body={to:'5511999999999',text:'Mensagem sintética',deliveryKey:'synthetic-key'};
  try {
    const journal=new DeliveryJournal({directory,bot});
    const results=await Promise.allSettled([journal.deliver(body),journal.deliver(body)]);
    assert.equal(sends,1);assert.ok(results.some(r=>r.status==='fulfilled'));
    const restarted=new DeliveryJournal({directory,bot});
    assert.equal((await restarted.deliver(body)).duplicate,true);assert.equal(sends,1);
    await assert.rejects(restarted.deliver({...body,text:'Outro conteúdo'}),/DELIVERY_KEY_CONFLICT/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('an uncertain provider send is never repeated after restart; disconnected sends reserve nothing',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'gate-delivery-'));
  let sends=0,connected=false;
  const bot={snapshot:()=>({status:connected?'connected':'disconnected'}),sendTo:async()=>{sends++;throw new Error('connection lost after send');}};
  const body={to:'5511999999999',text:'Teste sintético',deliveryKey:'uncertain-key'};
  try {
    const journal=new DeliveryJournal({directory,bot});
    await assert.rejects(journal.deliver(body),/WHATSAPP_NOT_CONNECTED/);assert.deepEqual(await readdir(directory),[]);
    connected=true;await assert.rejects(journal.deliver(body),/connection lost/);
    await assert.rejects(new DeliveryJournal({directory,bot}).deliver(body),/DELIVERY_REQUIRES_REVIEW/);
    assert.equal(sends,1);
  } finally {await rm(directory,{recursive:true,force:true});}
});
