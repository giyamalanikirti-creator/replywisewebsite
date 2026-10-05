import { generate } from '../lib/gemini.js';
import { createDatabase } from '../lib/supabase.js';
import { validateInput, AppError } from '../lib/validation.js';
import { readBody, send } from '../lib/http.js';
import { createSavedReply } from '../lib/reply-service.js';
export function createHandler({ database = createDatabase(), generator = generate } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'Use POST to generate a reply.' }); }
    try {
      const input = validateInput(await readBody(req));
      return send(res, 200, await createSavedReply(input, { database, generator }));
    } catch (error) {
      return send(res, error instanceof AppError ? error.status : 503, { error: error instanceof AppError ? error.message : "We couldn't generate a reply just now. Please try again." });
    }
  };
}
export default createHandler();
