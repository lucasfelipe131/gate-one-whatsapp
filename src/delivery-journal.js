import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const fail=code=>Object.assign(new Error(code),{code});
const hash=value=>createHash('sha256').update(value).digest('hex');
async function persist(path,value) {
  const file=await open(path,'wx',0o600);
  try {await file.writeFile(JSON.stringify(value));await file.sync();} finally {await file.close();}
}
async function syncDirectory(directory) {
  if(process.platform==='win32') return;
  const handle=await open(directory,'r');
  try {await handle.sync();} finally {await handle.close();}
}

// The WhatsApp protocol has no application idempotency key. Reserve on the
// persistent volume before sending; a process death during send requires review.
export class DeliveryJournal {
  constructor({directory,bot}) {this.directory=directory;this.bot=bot;}
  async deliver({to,text,deliveryKey}) {
    const phone=String(to||'').replace(/\D/g,'');
    if(!/^\d{10,15}$/.test(phone)||typeof text!=='string'||!text.trim()||text.length>6000) throw fail('INVALID_DELIVERY');
    const digest=hash(JSON.stringify({to:phone,text}));
    const key=deliveryKey||`legacy-${digest}`;
    if(typeof key!=='string'||! /^[a-zA-Z0-9:_-]{1,180}$/.test(key)) throw fail('INVALID_DELIVERY_KEY');
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const path=join(this.directory,hash(key)+'.json');
    let reserved=false;
    try {
      const previous=JSON.parse(await readFile(path,'utf8'));
      if(previous.digest!==digest) throw fail('DELIVERY_KEY_CONFLICT');
      if(previous.state==='SENT'&&previous.providerId) return {ok:true,providerId:previous.providerId,duplicate:true};
      throw fail('DELIVERY_REQUIRES_REVIEW');
    } catch(error) {
      if(error.code!=='ENOENT') throw error;
    }
    if(this.bot.snapshot().status!=='connected') throw fail('WHATSAPP_NOT_CONNECTED');
    try {
      await persist(path,{state:'SENDING',digest,createdAt:new Date().toISOString()});
      await syncDirectory(this.directory);
      reserved=true;
    } catch(error) {
      if(error.code==='EEXIST') throw fail('DELIVERY_REQUIRES_REVIEW');
      throw error;
    }
    const sent=await this.bot.sendTo(phone,text);
    if(!sent) {
      if(reserved) await unlink(path);
      throw fail('WHATSAPP_NOT_CONNECTED');
    }
    const providerId=sent.key?.id;
    if(!providerId) throw fail('DELIVERY_REQUIRES_REVIEW');
    const temporary=path+'.'+randomUUID()+'.tmp';
    await persist(temporary,{state:'SENT',digest,providerId,completedAt:new Date().toISOString()});
    await rename(temporary,path);
    await syncDirectory(this.directory);
    return {ok:true,providerId,duplicate:false};
  }
}
