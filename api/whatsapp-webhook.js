import { createDatabase } from '../lib/supabase.js';
import { AppError } from '../lib/validation.js';
import { verificationMatches, verifyWebhook, encryptRecipient } from '../lib/whatsapp-security.js';
import { whatsappConfig } from '../lib/whatsapp.js';
import { sanitize } from '../lib/sanitize.js';
import { send } from '../lib/http.js';
// Meta signs the exact bytes. Do not let Vercel parse or rewrite the body.
export const config = { api: { bodyParser: false } };
async function rawBody(req) {
  const chunks=[]; let length=0;
  for await (const chunk of req) {
    const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    length+=buffer.length;
    if(length>256000) throw new AppError(413,'Webhook payload too large.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
export function createHandler({ database=createDatabase() }={}) {
  return async function handler(req,res) {
    try {
      if(req.method==='GET') {
        const params=new URL(req.url,'http://localhost').searchParams;
        const challenge=params.get('hub.challenge');
        if(params.get('hub.mode')!=='subscribe'||!verificationMatches(params.get('hub.verify_token'))||!/^\d{1,100}$/.test(challenge||'')) throw new AppError(403,'Webhook verification failed.');
        res.setHeader('Content-Type','text/plain');res.setHeader('Cache-Control','no-store');res.statusCode=200;return res.end(challenge);
      }
      if(req.method!=='POST') {res.setHeader('Allow','GET, POST');return send(res,405,{error:'Use GET or POST.'});}
      const raw=await rawBody(req);
      if(!verifyWebhook(raw,req.headers['x-hub-signature-256'])) throw new AppError(401,'Invalid webhook signature.');
      let payload;try{payload=JSON.parse(raw.toString('utf8'));}catch{throw new AppError(400,'Invalid webhook payload.');}
      if(payload.object!=='whatsapp_business_account') return send(res,200,{received:true});
      const {phoneId}=whatsappConfig();
      const account=await database.waStatus();
      if(!account?.connected||account.phone_id!==phoneId) return send(res,200,{received:true});
      for(const entry of (Array.isArray(payload.entry)?payload.entry:[])) {
        for(const change of (Array.isArray(entry.changes)?entry.changes:[])) {
          const value=change.value;
          if(change.field!=='messages'||value?.metadata?.phone_number_id!==phoneId) continue;
          for(const message of (Array.isArray(value.messages)?value.messages:[])) {
            if(message.type!=='text'||typeof message.text?.body!=='string'||!message.text.body.trim()) continue;
            if(typeof message.id!=='string'||message.id.length>300||!/^\d{6,20}$/.test(message.from||'')||!/^\d{10}$/.test(String(message.timestamp||''))) continue;
            const received=new Date(Number(message.timestamp)*1000);
            if(!Number.isFinite(received.getTime())||received.getTime()>Date.now()+300000||received.getTime()<Date.now()-7*86400000) continue;
            await database.waReceive({p_phone_id:phoneId,p_meta_id:message.id,p_received_at:received.toISOString(),p_recipient:encryptRecipient(message.from),p_message:sanitize(message.text.body).slice(0,1000),p_too_long:message.text.body.length>1000});
          }
        }
      }
      return send(res,200,{received:true});
    } catch(error) {
      return send(res,error instanceof AppError?error.status:503,{error:error instanceof AppError?error.message:'Could not store the WhatsApp event. Retry later.'});
    }
  };
}
export default createHandler();
