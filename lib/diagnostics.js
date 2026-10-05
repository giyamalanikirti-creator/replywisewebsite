// Only controlled codes and numeric provider statuses may enter server logs.
// Never log provider bodies, URLs, credentials, prompts or customer messages.
export class IntegrationError extends Error {
  constructor(code, providerStatus, providerReason) {
    super('Integration unavailable');
    this.code = code;
    this.providerStatus = Number.isInteger(providerStatus) ? providerStatus : undefined;
    this.providerReason = reasons.has(providerReason) ? providerReason : 'UNKNOWN';
  }
}
const reasons = new Set(['MODEL_UNAVAILABLE', 'NOT_FOUND', 'NON_GOOGLE_RESPONSE', 'INVALID_ARGUMENT', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'UNAVAILABLE', 'INTERNAL']);
const codes = new Set(['GEMINI_CONFIG', 'GEMINI_HTTP', 'GEMINI_TIMEOUT', 'GEMINI_NETWORK', 'GEMINI_TRUNCATED', 'GEMINI_BLOCKED', 'GEMINI_INVALID_OUTPUT', 'SUPABASE_CONFIG', 'SUPABASE_HTTP', 'SUPABASE_TIMEOUT', 'SUPABASE_NETWORK', 'SUPABASE_INVALID_OUTPUT']);
export function reportFailure(stage, error) {
  const code = error instanceof IntegrationError && codes.has(error.code) ? error.code : 'INTEGRATION_FAILURE';
  const status = error instanceof IntegrationError && Number.isInteger(error.providerStatus) ? error.providerStatus : 'none';
  const reason = error instanceof IntegrationError && reasons.has(error.providerReason) ? error.providerReason : 'UNKNOWN';
  console.error(`[ReplyWise] stage=${stage} code=${code} provider_status=${status} provider_reason=${reason}`);
}

export async function geminiHttpError(response) {
  let payload;
  try { payload = await response.json(); } catch {}
  let reason = 'UNKNOWN';
  if (payload?.error && typeof payload.error === 'object') {
    if (reasons.has(payload.error.status)) reason = payload.error.status;
    // Inspect locally but never return or log the provider message.
    const message = typeof payload.error.message === 'string' ? payload.error.message : '';
    if (response.status === 404 && /model/i.test(message) && /not found|not supported|does not exist|unavailable/i.test(message)) reason = 'MODEL_UNAVAILABLE';
  } else if (response.status === 404) reason = 'NON_GOOGLE_RESPONSE';
  return new IntegrationError('GEMINI_HTTP', response.status, reason);
}
