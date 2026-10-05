import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/generate-reply.js';
import { createHandler as statsHandler } from '../api/stats.js';
import { validateInput, validateOutput } from '../lib/validation.js';
import { generate, SYSTEM_PROMPT } from '../lib/gemini.js';
import { sanitize } from '../lib/sanitize.js';
import { IntegrationError, reportFailure, geminiHttpError } from '../lib/diagnostics.js';
const visitor = 'f1234567-1234-4123-8123-123456789abc';
const body = { visitor_id: visitor, customer_message: 'Where is my order?', business_type: 'Clothing / Fashion' };
const result = { detected_language: 'English', request_type: 'Order status', reply: 'Let me check your order details and share a confirmed update.', follow_up_action: 'Check order tracking.' };
function response() { return { headers: {}, setHeader(k,v) { this.headers[k] = v; }, end(value) { this.data = JSON.parse(value); } }; }
async function call(handler, overrides = {}) {
  const res = response();
  await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, body, ...overrides }, res);
  return res;
}
test('validates message, business and UUID; invalid values never reach generation', async () => {
  let calls = 0;
  const handler = createHandler({ database: { claim: () => { calls++; } }, generator: () => { calls++; } });
  for (const invalid of [{ ...body, customer_message: '' }, { ...body, customer_message: 'x'.repeat(1001) }, { ...body, business_type: 'Fake' }, { ...body, visitor_id: 'bad' }]) {
    assert.equal((await call(handler, { body: invalid })).statusCode, 400);
  }
  assert.equal(calls, 0); assert.deepEqual(validateInput(body), body);
});
test('requires POST and JSON; rejects malformed JSON', async () => {
  const handler = createHandler();
  assert.equal((await call(handler, { method: 'GET' })).statusCode, 405);
  assert.equal((await call(handler, { headers: {} })).statusCode, 400);
  assert.equal((await call(handler, { body: '{' })).statusCode, 400);
});
test('redacts obvious emails and phone numbers, preserves short amounts', () => {
  assert.equal(sanitize('Email owner@example.com or +91 98765 43210; ₹500.'), 'Email [email removed] or [phone removed]; ₹500.');
  assert.equal(sanitize('Call 9876543210'), 'Call [phone removed]');
});
test('requires all four nonempty structured output fields', () => {
  assert.deepEqual(validateOutput(result), result);
  assert.throws(() => validateOutput({ ...result, reply: '' }));
  assert.throws(() => validateOutput({ ...result, detected_language: 42 }));
  assert.throws(() => validateOutput(null));
});
test('stores sanitized data and real supplied token metadata before responding', async () => {
  let saved;
  const handler = createHandler({ database: { claim: async () => ({ reservation_id: 'reservation' }), complete: async (...args) => { saved = args; return { used: 1 }; } }, generator: async () => ({ result, input_tokens: 123, output_tokens: 41 }) });
  const res = await call(handler, { body: { ...body, customer_message: 'Email me owner@example.com' } });
  assert.equal(res.statusCode, 200); assert.equal(res.data.used, 1);
  assert.equal(saved[1].customer_message, 'Email me [email removed]');
  assert.equal(saved[2].input_tokens, 123); assert.equal(saved[2].output_tokens, 41);
});
test('five successful calls consume slots; sixth does not call Gemini', async () => {
  let used = 0, calls = 0;
  const handler = createHandler({ database: { claim: async () => ({ used, reservation_id: used < 5 ? 'reservation' : null }), complete: async () => ({ used: ++used }) }, generator: async () => { calls++; return { result, input_tokens: null, output_tokens: null }; } });
  for (let i=0; i<5; i++) assert.equal((await call(handler)).statusCode, 200);
  const sixth = await call(handler);
  assert.equal(sixth.statusCode, 429); assert.match(sixth.data.error, /all 5/); assert.equal(calls, 5);
});
test('in-flight reservation rejects a duplicate without generation', async () => {
  const handler = createHandler({ database: { claim: async () => ({ used: 1, reservation_id: null }) }, generator: () => { throw new Error('Must not run'); } });
  assert.match((await call(handler)).data.error, /already being written/);
});
test('provider error releases reservation and never leaks raw error', async () => {
  let released = false;
  const handler = createHandler({ database: { claim: async () => ({ reservation_id: 'r' }), release: async () => { released = true; } }, generator: async () => { throw new Error('private-provider-error'); } });
  const res = await call(handler); assert.equal(res.statusCode, 503); assert.equal(released, true); assert.doesNotMatch(res.data.error, /private/);
});
test('database completion failure does not present an unlogged reply', async () => {
  const handler = createHandler({ database: { claim: async () => ({ reservation_id: 'r' }), complete: async () => { throw new Error('secret-db-error'); }, release: async () => {} }, generator: async () => ({ result }) });
  const res = await call(handler); assert.equal(res.statusCode, 503); assert.equal(res.data.reply, undefined);
});
test('database failure before claim does not call Gemini', async () => {
  let calls = 0;
  const handler = createHandler({ database: { claim: async () => { throw new Error('unavailable'); } }, generator: () => { calls++; } });
  assert.equal((await call(handler)).statusCode, 503); assert.equal(calls, 0);
});
test('stats reads database aggregate and anonymous usage', async () => {
  const aggregate = { shops_served: 12, languages: 3, most_common_request: 'Complaint', used: 2 };
  const handler = statsHandler({ database: { stats: async id => { assert.equal(id, visitor); return aggregate; } } });
  const res = await call(handler, { method: 'GET', url: `/api/stats?visitor_id=${visitor}` });
  assert.deepEqual(res.data, aggregate);
  assert.equal((await call(handler, { method: 'GET', url: '/api/stats?visitor_id=bad' })).statusCode, 400);
});
test('stats failures return unavailable, never fabricated zeros', async () => {
  const handler = statsHandler({ database: { stats: async () => { throw new Error('db'); } } });
  const res = await call(handler, { method: 'GET', url: '/api/stats' });
  assert.equal(res.statusCode, 503); assert.equal(res.data.shops_served, undefined);
});
test('Gemini request is server-side, structured, token limited and guarded', async () => {
  process.env.GEMINI_API_KEY = 'test-only-key';
  try {
    const generation = await generate(body, async (url, options) => {
      assert.match(url, /gemini-3.5-flash-lite:generateContent/);
      const request = JSON.parse(options.body);
      assert.equal(request.generationConfig.maxOutputTokens, 200);
      assert.deepEqual(request.generationConfig.thinkingConfig, { thinkingLevel: 'MINIMAL' });
      assert.equal(request.generationConfig.responseMimeType, 'application/json');
      assert.equal(request.systemInstruction.parts[0].text, SYSTEM_PROMPT);
      assert.doesNotMatch(request.contents[0].parts[0].text, /visitor_id/);
      return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result) }] } }], usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 70 } }) };
    });
    assert.equal(generation.input_tokens, 300); assert.equal(generation.output_tokens, 70);
    await assert.rejects(generate(body, async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS' }] }) })), error => error.code === 'GEMINI_TRUNCATED');
    await assert.rejects(generate(body, async () => ({ ok: false })), error => error.code === 'GEMINI_HTTP');
  } finally { delete process.env.GEMINI_API_KEY; }
});

test('diagnostic logs contain controlled codes only, never raw secrets or customer data', () => {
  const original = console.error;
  const logs = [];
  console.error = line => logs.push(line);
  try {
    reportFailure('gemini_generation', new IntegrationError('GEMINI_HTTP', 429));
    reportFailure('database_save', new Error('secret-key-and-customer-content'));
    reportFailure('database_save', new IntegrationError('untrusted-sensitive-code', 401));
    assert.match(logs[0], /code=GEMINI_HTTP provider_status=429/);
    assert.match(logs[1], /code=INTEGRATION_FAILURE/);
    assert.doesNotMatch(logs.join(' '), /secret-key|customer-content|untrusted-sensitive/);
  } finally { console.error = original; }
});

test('Gemini 404 diagnostics distinguish model errors from non-Google responses without revealing provider text', async () => {
  const error = await geminiHttpError({ status: 404, json: async () => ({ error: { status: 'NOT_FOUND', message: 'models/test is not found. sensitive-text' } }) });
  assert.equal(error.providerReason, 'MODEL_UNAVAILABLE');
  assert.doesNotMatch(error.message, /sensitive-text/);
  const nonGoogle = await geminiHttpError({ status: 404, json: async () => { throw new Error('HTML response'); } });
  assert.equal(nonGoogle.providerReason, 'NON_GOOGLE_RESPONSE');
  const unknown = await geminiHttpError({ status: 404, json: async () => ({ error: { status: 'private-secret', message: 'private-secret' } }) });
  assert.equal(unknown.providerReason, 'UNKNOWN');
});

test('retries a v1beta 404 once on stable v1 with identical safety settings and shared deadline', async () => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-only-key';
  const calls = [];
  try {
    const generated = await generate(body, async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return { ok: false, status: 404 };
      return { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result) }] } }] }) };
    });
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/v1beta\/models\//);
    assert.match(calls[1].url, /\/v1\/models\//);
    assert.equal(calls[0].options.body, calls[1].options.body);
    assert.equal(calls[0].options.signal, calls[1].options.signal);
    assert.equal(JSON.parse(calls[1].options.body).generationConfig.maxOutputTokens, 200);
    assert.equal(generated.result.reply, result.reply);
    let count = 0;
    await assert.rejects(generate(body, async () => { count++; return { ok: false, status: 429 }; }), error => error.providerStatus === 429);
    assert.equal(count, 1);
  } finally { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; }
});
