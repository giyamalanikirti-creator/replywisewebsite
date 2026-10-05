import { IntegrationError } from './diagnostics.js';
export function createDatabase(fetcher = fetch) {
  async function rpc(name, args = {}) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    let validUrl = false;
    try { validUrl = new URL(url).protocol === 'https:'; } catch {}
    if (!validUrl || !key) throw new IntegrationError('SUPABASE_CONFIG');
    let response;
    try { response = await fetcher(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` }, body: JSON.stringify(args), signal: AbortSignal.timeout(8000)
    });
    } catch (error) { throw new IntegrationError(error.name === 'TimeoutError' ? 'SUPABASE_TIMEOUT' : 'SUPABASE_NETWORK'); }
    if (!response.ok) throw new IntegrationError('SUPABASE_HTTP', response.status);
    try { return await response.json(); } catch { throw new IntegrationError('SUPABASE_INVALID_OUTPUT'); }
  }
  return {
    claim: visitor => rpc('replywise_claim', { p_visitor: visitor }),
    release: reservation => rpc('replywise_release', { p_reservation: reservation }),
    complete: (reservation, input, generation) => rpc('replywise_complete', { p_reservation: reservation, p_business: input.business_type, p_input: input.customer_message, p_output: generation.result.reply, p_language: generation.result.detected_language, p_type: generation.result.request_type, p_action: generation.result.follow_up_action, p_input_tokens: generation.input_tokens, p_output_tokens: generation.output_tokens }),
    stats: visitor => rpc('replywise_stats', { p_visitor: visitor || null })
  };
}
