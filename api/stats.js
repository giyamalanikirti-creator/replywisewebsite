import { createDatabase } from '../lib/supabase.js';
import { validateVisitor, AppError } from '../lib/validation.js';
import { send } from '../lib/http.js';
export function createHandler({ database = createDatabase() } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'Use GET to read usage statistics.' }); }
    try {
      const id = new URL(req.url, 'http://localhost').searchParams.get('visitor_id');
      const stats = await database.stats(id ? validateVisitor(id) : null);
      return send(res, 200, stats);
    } catch (error) {
      return send(res, error instanceof AppError ? error.status : 503, { error: error instanceof AppError ? error.message : 'Live stats are temporarily unavailable.' });
    }
  };
}
export default createHandler();
