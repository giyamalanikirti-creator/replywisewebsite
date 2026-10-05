import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const visitor = 'f1234567-1234-4123-8123-123456789abc';
test('real PostgreSQL schema: repeatability, roles, reservations, fifth cap, stored tokens and aggregates', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    const sql = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
    await db.exec(sql); await db.exec(sql);
    const rpc = async (query, params = []) => (await db.query(query, params)).rows[0].result;
    const stats = () => rpc('select replywise_stats($1) as result', [visitor]);
    assert.deepEqual(await stats(), { shops_served: 0, languages: 0, most_common_request: null, used: 0 });
    await db.exec('set role anon;');
    await assert.rejects(db.query('select * from replywise_requests'), /permission denied/);
    await assert.rejects(db.query('select replywise_stats(null)'), /permission denied/);
    await db.exec('reset role;');
    let claim = await rpc('select replywise_claim($1) as result', [visitor]);
    assert.ok(claim.reservation_id);
    const duplicate = await rpc('select replywise_claim($1) as result', [visitor]);
    assert.equal(duplicate.reservation_id, null);
    await rpc('select replywise_release($1) as result', [claim.reservation_id]);
    assert.equal((await stats()).used, 0);
    for (let n=1;n<=5;n++) {
      claim = await rpc('select replywise_claim($1) as result', [visitor]);
      assert.equal(claim.used, n-1);
      const completed = await rpc('select replywise_complete($1,$2,$3,$4,$5,$6,$7,$8,$9) as result', [claim.reservation_id, 'Clothing / Fashion', 'TEST input', 'TEST output', n === 1 ? 'Hindi' : 'English', 'Delivery delay', 'TEST check tracking', 123, 45]);
      assert.equal(completed.used, n);
    }
    assert.equal((await rpc('select replywise_claim($1) as result', [visitor])).reservation_id, null);
    assert.deepEqual(await stats(), { shops_served: 1, languages: 2, most_common_request: 'Delivery delay', used: 5 });
    const rows = (await db.query('select * from replywise_requests')).rows;
    assert.equal(rows.length,5); assert.equal(rows[0].input_tokens,123); assert.equal(rows[0].output_tokens,45);
    assert.ok(rows[0].id && rows[0].created_at && rows[0].visitor_id);
    assert.equal((await db.query('select * from replywise_reservations')).rows.length,0);
  } finally { await db.close(); }
});
