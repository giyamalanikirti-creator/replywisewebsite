import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('WhatsApp PostgreSQL migration: permissions, deduplication, atomic draft logging, quota, send locks, 24-hour window and disconnect',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon;create role authenticated;create role service_role;');
  await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
  const sql=await readFile(new URL('../supabase/whatsapp.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
  const rpc=async(query,params=[])=>(await db.query(query,params)).rows[0].result;
  await db.exec('set role anon');await assert.rejects(db.query('select * from replywise_whatsapp_messages'),/permission denied/);await assert.rejects(db.query('select replywise_wa_inbox()'),/permission denied/);await db.exec('reset role');
  await rpc('select replywise_wa_connect($1,$2,$3) as result',['123456789','Business ending 1234','Clothing / Fashion']);
  const account=await rpc('select replywise_wa_status() as result');assert.equal(account.connected,true);
  const now=new Date().toISOString();
  const receive=()=>rpc('select replywise_wa_receive($1,$2,$3,$4,$5,$6) as result',['123456789','wamid.incoming',now,'encrypted-fixture','Where is my order?',false]);
  await receive();await receive();
  const inbox=await rpc('select replywise_wa_inbox() as result');assert.equal(inbox.length,1);assert.equal(inbox[0].recipient_encrypted,undefined);
  const id=inbox[0].id;
  const reservation=await rpc('select replywise_claim($1) as result',[account.visitor_id]);
  const saved=await rpc('select replywise_wa_complete($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result',[id,reservation.reservation_id,'Clothing / Fashion','Where is my order?','I will check the details.','English','Order status','Verify tracking.',123,40]);assert.equal(saved.used,1);
  assert.equal((await db.query('select * from replywise_requests')).rows.length,1);assert.equal((await rpc('select replywise_wa_inbox() as result'))[0].state,'draft');
  const send=await rpc('select replywise_wa_claim_send($1) as result',[id]);assert.equal(send.recipient_encrypted,'encrypted-fixture');assert.equal(await rpc('select replywise_wa_claim_send($1) as result',[id]),null);
  await rpc('select replywise_wa_finish_send($1,$2,$3,$4) as result',[id,'send_unknown',null,null]);assert.equal(await rpc('select replywise_wa_claim_send($1) as result',[id]),null);
  await db.query("update replywise_whatsapp_messages set state='draft',received_at=now()-interval '25 hours' where id=$1",[id]);assert.equal(await rpc('select replywise_wa_claim_send($1) as result',[id]),null);
  await rpc('select replywise_wa_disconnect() as result');assert.equal((await rpc('select replywise_wa_status() as result')).connected,false);assert.equal((await rpc('select replywise_wa_inbox() as result')).length,0);
  assert.equal((await db.query('select * from replywise_requests')).rows.length,1);
  for(let n=0;n<10;n++)assert.equal(await rpc('select replywise_wa_login_gate() as result'),true);assert.equal(await rpc('select replywise_wa_login_gate() as result'),false);
 }finally{await db.close();}
});
