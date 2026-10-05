import { AppError } from './validation.js';
export const DEFAULT_META_VERSION = 'v23.0';
export class WhatsAppSendError extends AppError {
  constructor(ambiguous) { super(503, ambiguous ? 'Send status is uncertain. Check WhatsApp before sending again; automatic retry is blocked to avoid duplicates.' : 'WhatsApp rejected this message. Check the account setup and try again.'); this.ambiguous = ambiguous; }
}
export function whatsappConfig() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_API_VERSION || DEFAULT_META_VERSION;
  if (!token || !/^\d{5,30}$/.test(phoneId || '') || !/^v\d{1,2}\.0$/.test(version)) throw new AppError(503, 'WhatsApp connection needs server setup. See the setup guide.');
  return { token, phoneId, version };
}
export function createWhatsApp(fetcher = fetch) {
  return {
    async verifyAccount() {
      const { token, phoneId, version } = whatsappConfig();
      let response;
      try { response = await fetcher(`https://graph.facebook.com/${version}/${phoneId}?fields=display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }); }
      catch { throw new AppError(503, 'Could not reach WhatsApp. Please try again.'); }
      if (!response.ok) throw new AppError(503, 'WhatsApp could not verify this account. Check the access token and phone number ID in server settings.');
      const data = await response.json();
      if (String(data.id) !== phoneId) throw new AppError(503, 'WhatsApp returned an unexpected account. Check the phone number ID.');
      const lastFour = String(data.display_phone_number || '').replace(/\D/g, '').slice(-4);
      return { phoneId, label: `WhatsApp Business${lastFour ? ' · ending ' + lastFour : ''}` };
    },
    async send(recipient, reply) {
      const { token, phoneId, version } = whatsappConfig();
      if (!/^\d{6,20}$/.test(recipient)) throw new AppError(503, 'The saved customer destination is invalid.');
      let response;
      try { response = await fetcher(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type: 'text', text: { preview_url: false, body: reply } })
      }); } catch { throw new WhatsAppSendError(true); }
      if (!response.ok) throw new WhatsAppSendError(response.status >= 500);
      let data;
      try { data = await response.json(); } catch { throw new WhatsAppSendError(true); }
      const id = data.messages?.[0]?.id;
      if (typeof id !== 'string' || id.length > 300) throw new WhatsAppSendError(true);
      return id;
    }
  };
}
