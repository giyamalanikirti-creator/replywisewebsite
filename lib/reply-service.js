import { AppError, LIMIT_MESSAGE } from './validation.js';
import { sanitize } from './sanitize.js';
import { reportFailure } from './diagnostics.js';
export async function createSavedReply(input, { database, generator, complete = database.complete }) {
  let reservation;
  let stage = 'database_claim';
  try {
    const claim = await database.claim(input.visitor_id);
    if (!claim.reservation_id) throw new AppError(429, claim.used >= 5 ? LIMIT_MESSAGE : 'A reply is already being written. Please wait and try again.');
    reservation = claim.reservation_id;
    stage = 'gemini_generation';
    const generation = await generator(input);
    const safe = { ...generation, result: Object.fromEntries(Object.entries(generation.result).map(([key, value]) => [key, sanitize(value)])) };
    stage = 'database_save';
    const saved = await complete(reservation, { ...input, customer_message: sanitize(input.customer_message) }, safe);
    reservation = null;
    return { ...safe.result, used: saved.used, limit: 5 };
  } catch (error) {
    if (!(error instanceof AppError)) reportFailure(stage, error);
    if (reservation) { try { await database.release(reservation); } catch {} }
    throw error;
  }
}
