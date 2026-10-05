import { reportFailure } from '../lib/diagnostics.js';
import { generate } from '../lib/gemini.js';
import { createDatabase } from '../lib/supabase.js';
import { validateInput, AppError, LIMIT_MESSAGE } from '../lib/validation.js';
import { sanitize } from '../lib/sanitize.js';
import { readBody, send } from '../lib/http.js';
export function createHandler({ database = createDatabase(), generator = generate } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'Use POST to generate a reply.' }); }
    let reservation;
    let stage = 'validation';
    try {
      const input = validateInput(await readBody(req));
      stage = 'database_claim';
      const claim = await database.claim(input.visitor_id);
      if (!claim.reservation_id) throw new AppError(429, claim.used >= 5 ? LIMIT_MESSAGE : 'A reply is already being written. Please wait and try again.');
      reservation = claim.reservation_id;
      stage = 'gemini_generation';
      const generation = await generator(input);
      const sanitizedGeneration = { ...generation, result: Object.fromEntries(Object.entries(generation.result).map(([key, value]) => [key, sanitize(value)])) };
      stage = 'database_save';
      const completed = await database.complete(reservation, { ...input, customer_message: sanitize(input.customer_message) }, sanitizedGeneration);
      reservation = null;
      return send(res, 200, { ...sanitizedGeneration.result, used: completed.used, limit: 5 });
    } catch (error) {
      if (!(error instanceof AppError)) reportFailure(stage, error);
      if (reservation) { try { await database.release(reservation); } catch { /* A short-lived reservation expires automatically. */ } }
      return send(res, error instanceof AppError ? error.status : 503, { error: error instanceof AppError ? error.message : "We couldn't generate a reply just now. Please try again." });
    }
  };
}
export default createHandler();
