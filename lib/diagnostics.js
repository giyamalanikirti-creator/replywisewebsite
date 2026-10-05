// Only controlled codes and numeric provider statuses may enter server logs.
// Never log provider bodies, URLs, credentials, prompts or customer messages.
export class IntegrationError extends Error {
  constructor(code, providerStatus) {
    super('Integration unavailable');
    this.code = code;
    this.providerStatus = Number.isInteger(providerStatus) ? providerStatus : undefined;
  }
}
const codes = new Set(['GEMINI_CONFIG', 'GEMINI_HTTP', 'GEMINI_TIMEOUT', 'GEMINI_NETWORK', 'GEMINI_TRUNCATED', 'GEMINI_BLOCKED', 'GEMINI_INVALID_OUTPUT', 'SUPABASE_CONFIG', 'SUPABASE_HTTP', 'SUPABASE_TIMEOUT', 'SUPABASE_NETWORK', 'SUPABASE_INVALID_OUTPUT']);
export function reportFailure(stage, error) {
  const code = error instanceof IntegrationError && codes.has(error.code) ? error.code : 'INTEGRATION_FAILURE';
  const status = error instanceof IntegrationError && Number.isInteger(error.providerStatus) ? error.providerStatus : 'none';
  console.error(`[ReplyWise] stage=${stage} code=${code} provider_status=${status}`);
}
