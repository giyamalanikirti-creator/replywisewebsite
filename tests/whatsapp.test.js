import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { createHandler } from '../api/whatsapp.js';
import { createHandler as webhookHandler } from '../api/whatsapp-webhook.js';
import { createWhatsApp, WhatsAppSendError } from '../lib/whatsapp.js';
import { sessionCookie, requireOwner, encryptRecipient, decryptRecipient } from '../lib/whatsapp-security.js';
const id='f1234567-1234-4123-8123-123456789abc';
const result={detected_language:'English',request_type:'Order status',reply:'Let me check your order details and share an update.',follow_up_action:'Verify tracking.'};
function setup() {
  Object.assign(process.env,{WHATSAPP_OWNER_PASSWORD:'fixture-owner-key-more-than-24-characters',WHATSAPP_ENCRYPTION_KEY:'ab'.repeat(32),WHATSAPP_ACCESS_TOKEN:'fixture-meta-token',WHATSAPP_PHONE_NUMBER_ID:'123456789',WHATSAPP_VERIFY_TOKEN:'fixture-webhook-verification',META_APP_SECRET:'fixture-app-secret'});
}
function response() {return {headers:{},setHeader(k,v){this.headers[k]=v;},end(value){try{this.data=JSON.parse(value);}catch{this.data=value;}}};}
async function call(handler,body,overrides={}) {
 const res=response();
 await handler({method:'POST',url:'/api/whatsapp',headers:{host:'localhost','content-type':'application/json',cookie:sessionCookie().split(';')[0]},body,...overrides},res);return res;
}
test('owner authentication, encrypted recipients and invalid/tampered sessions',()=>{
 setup();const cookie=sessionCookie();assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
 requireOwner({headers:{cookie:cookie.split(';')[0]}});
 assert.throws(()=>requireOwner({headers:{cookie:cookie.replace('replywise_whatsapp_owner=','replywise_whatsapp_owner=x')}}));
 assert.throws(()=>requireOwner({headers:{}}));
 const ciphertext=encryptRecipient('919876543210');assert.doesNotMatch(ciphertext,/919876543210/);assert.equal(decryptRecipient(ciphertext),'919876543210');
 assert.throws(()=>decryptRecipient('invalid.cipher.text'));
});
test('unauthenticated inbox and cross-origin owner mutations are rejected before data reads',async()=>{
 setup();let reads=0;const handler=createHandler({database:{waStatus:()=>{reads++;}}});
 const unauth=await call(handler,null,{method:'GET',url:'/api/whatsapp?action=inbox',headers:{}});assert.equal(unauth.statusCode,401);
 const csrf=await call(handler,{action:'disconnect'},{headers:{host:'localhost',origin:'https://attacker.example','content-type':'application/json'}});assert.equal(csrf.statusCode,403);assert.equal(reads,0);
});
test('owner login is gated and only a correct password produces a cookie',async()=>{
 setup();const handler=createHandler({database:{waLoginGate:async()=>true}});
 assert.equal((await call(handler,{action:'login',password:'wrong'})).statusCode,401);
 const success=await call(handler,{action:'login',password:process.env.WHATSAPP_OWNER_PASSWORD});assert.equal(success.statusCode,200);assert.match(success.headers['Set-Cookie'],/HttpOnly/);
 assert.equal((await call(createHandler({database:{waLoginGate:async()=>false}}),{action:'login',password:process.env.WHATSAPP_OWNER_PASSWORD})).statusCode,429);
});
test('connect verifies Meta account before saving it; private status excludes internal visitor and phone IDs',async()=>{
 setup();let saved;
 const handler=createHandler({database:{waConnect:async(...args)=>{saved=args;},waStatus:async()=>({connected:true,label:'Ending 1234',visitor_id:id,phone_id:'123456789',used:1})},whatsapp:{verifyAccount:async()=>({phoneId:'123456789',label:'Ending 1234'})}});
 assert.equal((await call(handler,{action:'connect',business_type:'Clothing / Fashion'})).statusCode,200);assert.equal(saved[2],'Clothing / Fashion');
 const status=await call(handler,null,{method:'GET',url:'/api/whatsapp?action=status'});assert.equal(status.data.visitor_id,undefined);assert.equal(status.data.phone_id,undefined);
});
test('WhatsApp drafting uses the same server-side five-generation cap, with no automatic sends',async()=>{
 setup();let generated=0;let saved=0;
 const db={waStatus:async()=>({connected:true,phone_id:'123456789',visitor_id:id,business_type:'Clothing / Fashion',used:5}),waMessage:async()=>({message:'Where is my order?',state:'new',can_reply:true}),claim:async()=>({used:5,reservation_id:null}),waComplete:()=>{saved++;}};
 const handler=createHandler({database:db,generator:()=>{generated++;}});
 const res=await call(handler,{action:'draft',message_id:id});assert.equal(res.statusCode,429);assert.equal(generated,0);assert.equal(saved,0);
 db.claim=async()=>({used:0,reservation_id:'reservation'});db.waComplete=async()=>{saved++;return{used:1};};
 const handler2=createHandler({database:db,generator:async()=>{generated++;return{result,input_tokens:123,output_tokens:50};}});
 const draft=await call(handler2,{action:'draft',message_id:id});assert.equal(draft.statusCode,200);assert.equal(generated,1);assert.equal(saved,1);
});
test('sending requires approval, uses saved encrypted destination and blocks repeat sends',async()=>{
 setup();let count=0;let accepted=false;let finished;
 const database={waStatus:async()=>({connected:true,phone_id:'123456789'}),waClaimSend:async()=>{if(accepted)return null;accepted=true;return{recipient_encrypted:encryptRecipient('919876543210')};},waFinishSend:async(...args)=>{finished=args;return true;}};
 const handler=createHandler({database,whatsapp:{send:async(recipient,reply)=>{count++;assert.equal(recipient,'919876543210');assert.equal(reply,'Reviewed reply');return'wamid.outgoing';}}});
 assert.equal((await call(handler,{action:'send',message_id:id,reply:'Reviewed reply'})).statusCode,400);assert.equal(count,0);
 assert.equal((await call(handler,{action:'send',message_id:id,reply:'Reviewed reply',approved:true})).statusCode,200);assert.equal(finished[1],'sent');
 assert.equal((await call(handler,{action:'send',message_id:id,reply:'Reviewed reply',approved:true})).statusCode,409);assert.equal(count,1);
});
test('ambiguous Meta send failures stay non-retryable and do not leak provider error bodies',async()=>{
 setup();let state;
 const handler=createHandler({database:{waStatus:async()=>({connected:true,phone_id:'123456789'}),waClaimSend:async()=>({recipient_encrypted:encryptRecipient('919876543210')}),waFinishSend:async(_id,s)=>{state=s;}},whatsapp:{send:async()=>{throw new Error('private-meta-body');}}});
 const res=await call(handler,{action:'send',message_id:id,reply:'Reviewed reply',approved:true});assert.equal(state,'send_unknown');assert.match(res.data.error,/uncertain/);assert.doesNotMatch(res.data.error,/private-meta/);
});
test('signed webhook validates raw bytes, redacts input and encrypts sender; invalid signature does not write',async()=>{
 setup();let saved;
 const payload={object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'123456789'},messages:[{type:'text',id:'wamid.incoming',from:'919876543210',timestamp:String(Math.floor(Date.now()/1000)),text:{body:'Email me owner@example.com about my order.'}}]}}]}]};
 const raw=Buffer.from(JSON.stringify(payload));const signature='sha256='+createHmac('sha256',process.env.META_APP_SECRET).update(raw).digest('hex');
 const handler=webhookHandler({database:{waStatus:async()=>({connected:true,phone_id:'123456789'}),waReceive:async value=>{saved=value;}}});
 const req=Readable.from([raw]);Object.assign(req,{method:'POST',headers:{'x-hub-signature-256':signature}});const res=response();await handler(req,res);assert.equal(res.statusCode,200);
 assert.equal(saved.p_message,'Email me [email removed] about my order.');assert.equal(decryptRecipient(saved.p_recipient),'919876543210');assert.doesNotMatch(JSON.stringify(res.data),/919876543210|owner@example.com/);
 saved=null;const invalid=Readable.from([raw]);Object.assign(invalid,{method:'POST',headers:{'x-hub-signature-256':'sha256='+'00'.repeat(32)}});const rejected=response();await handler(invalid,rejected);assert.equal(rejected.statusCode,401);assert.equal(saved,null);
});
test('Meta webhook challenge is verified; mismatched token is rejected',async()=>{
 setup();const handler=webhookHandler();const res=response();await handler({method:'GET',url:'/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=fixture-webhook-verification&hub.challenge=123',headers:{}},res);assert.equal(res.statusCode,200);assert.equal(res.data,123);
 const invalid=response();await handler({method:'GET',url:'/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123',headers:{}},invalid);assert.equal(invalid.statusCode,403);
});
test('Meta sends use only server credentials, distinguish rejected sends from uncertain ones',async()=>{
 setup();const whatsapp=createWhatsApp(async(url,options)=>{assert.match(url,/\/123456789\/messages$/);const payload=JSON.parse(options.body);assert.equal(payload.to,'919876543210');assert.equal(payload.text.body,'Reviewed reply');return{ok:true,json:async()=>({messages:[{id:'wamid.outgoing'}]})};});
 assert.equal(await whatsapp.send('919876543210','Reviewed reply'),'wamid.outgoing');
 await assert.rejects(createWhatsApp(async()=>({ok:false,status:400})).send('919876543210','reply'),error=>error instanceof WhatsAppSendError&&!error.ambiguous);
 await assert.rejects(createWhatsApp(async()=>{throw new Error('network');}).send('919876543210','reply'),error=>error instanceof WhatsAppSendError&&error.ambiguous);
});
