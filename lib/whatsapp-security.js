import { createHash, createHmac, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { AppError } from './validation.js';
const COOKIE = 'replywise_whatsapp_owner';
function encryptionKey() {
  const value = process.env.WHATSAPP_ENCRYPTION_KEY;
  if (!/^[a-f0-9]{64}$/i.test(value || '')) throw new AppError(503, 'WhatsApp connection needs server setup. See the setup guide.');
  return Buffer.from(value, 'hex');
}
function ownerPassword() {
  const value = process.env.WHATSAPP_OWNER_PASSWORD;
  if (!value || value.length < 24) throw new AppError(503, 'WhatsApp connection needs server setup. See the setup guide.');
  return value;
}
export function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError(403, 'Please use the ReplyWise website to make this change.');
  if (req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin); } catch { throw new AppError(403, 'Invalid request origin.'); }
    if (origin.host !== req.headers.host) throw new AppError(403, 'Please use the ReplyWise website to make this change.');
  }
}
export function passwordMatches(candidate) {
  if (typeof candidate !== 'string' || candidate.length > 512) return false;
  const hash = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(ownerPassword()), hash(candidate));
}
function signature(value) {
  return createHmac('sha256', encryptionKey()).update('replywise-owner\0').update(ownerPassword()).update(value).digest('base64url');
}
export function sessionCookie({ logout = false } = {}) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 8 * 60 * 60 * 1000, nonce: randomBytes(16).toString('hex') })).toString('base64url');
  const value = logout ? '' : `${payload}.${signature(payload)}`;
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${logout ? 0 : 28800}${process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
export function requireOwner(req) {
  const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='));
  const token = cookie?.slice(COOKIE.length + 1);
  if (!token || token.length > 500) throw new AppError(401, 'Unlock your WhatsApp connection to continue.');
  const [payload, sig, extra] = token.split('.');
  const expected = signature(payload || '');
  if (extra || typeof sig !== 'string' || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new AppError(401, 'Please unlock your WhatsApp connection again.');
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw new AppError(401, 'Please unlock your WhatsApp connection again.'); }
  if (!Number.isSafeInteger(data.exp) || data.exp <= Date.now()) throw new AppError(401, 'Your owner session expired. Unlock the connection again.');
}
export function encryptRecipient(recipient) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from('replywise-whatsapp-recipient'));
  const ciphertext = Buffer.concat([cipher.update(recipient, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(value => value.toString('base64url')).join('.');
}
export function decryptRecipient(value) {
  const [iv, tag, ciphertext] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !ciphertext || iv.length !== 12 || tag.length !== 16 || !ciphertext.length) throw new Error('Invalid encrypted recipient');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv, { authTagLength: 16 });
  decipher.setAAD(Buffer.from('replywise-whatsapp-recipient'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
export function requireWebhookSetup() {
  if (!process.env.META_APP_SECRET || !process.env.WHATSAPP_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN.length < 24) throw new AppError(503, 'WhatsApp webhook needs server setup. See the setup guide.');
}
export function verifyWebhook(raw, header) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) throw new AppError(503, 'WhatsApp webhook is not configured.');
  if (typeof header !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(header)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(header.slice(7), 'hex'));
}
export function verificationMatches(value) {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!expected || typeof value !== 'string') return false;
  const hash = input => createHash('sha256').update(input).digest();
  return timingSafeEqual(hash(expected), hash(value));
}
