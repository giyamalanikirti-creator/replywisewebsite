import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/models.js';
test('model check lists only generateContent Flash model names and keeps credentials private', async () => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'fixture-not-a-real-key';
  try {
    const res = { setHeader() {}, end(value) { this.data = JSON.parse(value); } };
    await createHandler({ fetcher: async (url, options) => {
      assert.equal(options.headers['x-goog-api-key'], 'fixture-not-a-real-key');
      assert.equal(url.searchParams.has('key'), false);
      return { ok: true, json: async () => ({ models: [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-embedding', supportedGenerationMethods: ['embedContent'] }
      ] }) };
    } })({ method: 'GET' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.data.configured_model_available, true);
    assert.deepEqual(res.data.available_flash_models, ['gemini-2.5-flash']);
    assert.doesNotMatch(JSON.stringify(res.data), /fixture-not-a-real-key/);
  } finally { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; }
});
