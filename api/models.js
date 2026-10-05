import { DEFAULT_MODEL } from '../lib/gemini.js';
import { send } from '../lib/http.js';
import { IntegrationError, reportFailure } from '../lib/diagnostics.js';
export function createHandler({ fetcher = fetch } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'Use GET to check available models.' }); }
    const configured = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    try {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new IntegrationError('GEMINI_CONFIG');
      const available = [];
      let token;
      for (let page = 0; page < 5; page++) {
        const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
        url.searchParams.set('pageSize', '100');
        if (token) url.searchParams.set('pageToken', token);
        const response = await fetcher(url, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new IntegrationError('GEMINI_HTTP', response.status);
        const data = await response.json();
        for (const model of data.models || []) {
          if (typeof model.name === 'string' && /^models\/gemini-[a-z0-9.-]+$/i.test(model.name) && model.supportedGenerationMethods?.includes('generateContent')) available.push(model.name.slice(7));
        }
        token = data.nextPageToken;
        if (!token) break;
      }
      return send(res, 200, { configured_model: configured, configured_model_available: available.includes(configured), available_flash_models: available.filter(name => name.includes('flash')), list_complete: !token });
    } catch (error) {
      reportFailure('gemini_model_check', error);
      return send(res, 503, { error: 'Could not check Gemini models. Check the server logs for the provider status.' });
    }
  };
}
export default createHandler();
