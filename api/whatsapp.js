import { AppError, BUSINESS_TYPES, validateVisitor } from '../lib/validation.js';
import { createDatabase } from '../lib/supabase.js';
import { generate } from '../lib/gemini.js';
import { createSavedReply } from '../lib/reply-service.js';
import { createWhatsApp, WhatsAppSendError, whatsappConfig } from '../lib/whatsapp.js';
import { requireOwner, sameOrigin, passwordMatches, sessionCookie, decryptRecipient, requireWebhookSetup } from '../lib/whatsapp-security.js';
import { readBody, send } from '../lib/http.js';
import { sanitize } from '../lib/sanitize.js';
function messageId(id) { try { return validateVisitor(id); } catch { throw new AppError(400, 'Choose a valid customer message.'); } }
export function createHandler({ database = createDatabase(), generator = generate, whatsapp = createWhatsApp() } = {}) {
  return async function handler(req, res) {
    if (!['GET','POST'].includes(req.method)) { res.setHeader('Allow','GET, POST'); return send(res,405,{error:'Use GET or POST.'}); }
    try {
      let action, body;
      if (req.method === 'POST') {
        sameOrigin(req);
        body = await readBody(req);
        if (!body || typeof body !== 'object') throw new AppError(400,'Send a valid JSON request.');
        action = body.action;
      } else action = new URL(req.url,'http://localhost').searchParams.get('action') || 'status';
      if (req.method === 'POST' && action === 'login') {
        if (!(await database.waLoginGate())) throw new AppError(429,'Too many unlock attempts. Please wait 15 minutes.');
        if (!passwordMatches(body.password)) throw new AppError(401,'That owner access key is incorrect.');
        res.setHeader('Set-Cookie',sessionCookie());
        return send(res,200,{unlocked:true});
      }
      requireOwner(req);
      if (req.method === 'POST' && action === 'logout') { res.setHeader('Set-Cookie',sessionCookie({logout:true})); return send(res,200,{unlocked:false}); }
      if (req.method === 'GET' && action === 'status') {
        const state = await database.waStatus();
        return send(res,200,{connected:!!state?.connected,label:state?.label || null,business_type:state?.business_type || null,used:state?.used || 0,limit:5});
      }
      if (req.method === 'POST' && action === 'connect') {
        if (!BUSINESS_TYPES.includes(body.business_type)) throw new AppError(400,'Choose your business type.');
        requireWebhookSetup();
        const account = await whatsapp.verifyAccount();
        await database.waConnect(account.phoneId,account.label,body.business_type);
        return send(res,200,{connected:true,label:account.label});
      }
      if (req.method === 'POST' && action === 'disconnect') { await database.waDisconnect(); return send(res,200,{connected:false}); }
      const account = await database.waStatus();
      if (!account?.connected) throw new AppError(409,'Connect your WhatsApp Business account first.');
      if (account.phone_id !== whatsappConfig().phoneId) throw new AppError(409,'The configured WhatsApp account changed. Reconnect it before continuing.');
      if (req.method === 'GET' && action === 'inbox') return send(res,200,{messages:await database.waInbox()});
      if (req.method === 'POST' && action === 'draft') {
        const id = messageId(body.message_id);
        const message = await database.waMessage(id);
        if (!message) throw new AppError(404,'This customer message is no longer available.');
        if (!message.can_reply) throw new AppError(409,'The 24-hour reply window has closed. Reply through your supported WhatsApp workflow instead.');
        if (message.too_long) throw new AppError(400,'This message exceeds the 1,000-character demo limit. Use a shorter message in the main tool.');
        if (message.state === 'draft' || message.state === 'send_failed') return send(res,200,{...message.draft,used:account.used,limit:5});
        if (message.state !== 'new') throw new AppError(409,'This message has already been sent or is awaiting confirmation.');
        const result = await createSavedReply({customer_message:message.message,business_type:account.business_type,visitor_id:account.visitor_id}, {
          database,generator,complete:(reservation,input,generation)=>database.waComplete(id,reservation,input,generation)
        });
        return send(res,200,result);
      }
      if (req.method === 'POST' && action === 'send') {
        const id = messageId(body.message_id);
        if (body.approved !== true) throw new AppError(400,'Review the facts and approve the reply before sending.');
        if (typeof body.reply !== 'string' || !body.reply.trim() || body.reply.length > 1600) throw new AppError(400,'Enter a reply within 1,600 characters.');
        // Validate prerequisites before taking the non-retryable send reservation.
        whatsappConfig();
        const claimed = await database.waClaimSend(id);
        if (!claimed) throw new AppError(409,'This reply is already being sent, was sent, or its 24-hour window has closed. Refresh the inbox.');
        let metaId;
        try { metaId = await whatsapp.send(decryptRecipient(claimed.recipient_encrypted),body.reply.trim()); }
        catch (error) {
          const uncertain = !(error instanceof WhatsAppSendError) || error.ambiguous;
          try { await database.waFinishSend(id,uncertain?'send_unknown':'send_failed',null,null); } catch {}
          throw uncertain ? new WhatsAppSendError(true) : error;
        }
        try {
          if (!(await database.waFinishSend(id,'sent',metaId,sanitize(body.reply.trim())))) throw new Error('Send record missing');
        } catch { throw new WhatsAppSendError(true); }
        return send(res,200,{sent:true,message:'WhatsApp accepted the reply. Delivery is not yet confirmed.'});
      }
      throw new AppError(400,'Unknown WhatsApp action.');
    } catch (error) {
      return send(res,error instanceof AppError?error.status:503,{error:error instanceof AppError?error.message:'WhatsApp is temporarily unavailable. Check server settings and the WhatsApp SQL setup.'});
    }
  };
}
export default createHandler();
