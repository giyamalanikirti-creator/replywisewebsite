const $ = id => document.getElementById(id);
const form = $('reply-form');
const input = $('customer-message');
const business = $('business-type');
const button = $('generate-button');
let visitor;
let used = 0;
let busy = false;
let latestReply = '';
let copyTimer;
const validUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
try {
  visitor = localStorage.getItem('replywise_visitor_id');
  if (!validUuid(visitor)) { visitor = crypto.randomUUID(); localStorage.setItem('replywise_visitor_id', visitor); }
} catch {
  visitor = crypto.randomUUID();
  $('usage').hidden = false;
  $('usage').textContent = 'Browser storage is unavailable. Your demo session lasts until you close this page.';
}
function showError(message) { $('form-error').textContent = message; $('form-error').hidden = false; }
function updateUsage(value) {
  used = value;
  $('usage').textContent = `${used} of 5 free demo replies used`;
  $('usage').hidden = used === 0;
  button.disabled = busy || used >= 5;
  button.classList.toggle('limit', used >= 5);
}
function setBusy(value) {
  busy = value;
  button.disabled = value || used >= 5;
  button.textContent = value ? 'Writing your reply…' : 'Generate my reply ✦';
  $('output-panel').setAttribute('aria-busy', String(value));
  $('loading-result').hidden = !value;
  input.disabled = value; business.disabled = value; $('use-example').disabled = value; $('reset').disabled = value;
  if (value) { $('result').hidden = true; $('empty-result').hidden = true; }
}
async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(55000) });
  let data;
  try { data = await response.json(); } catch { throw new Error("We couldn't generate a reply just now. Please try again."); }
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}
async function refreshStats() {
  try {
    const stats = await fetchJson(`/api/stats?visitor_id=${encodeURIComponent(visitor)}`);
    $('shops-stat').textContent = stats.shops_served.toLocaleString();
    $('languages-stat').textContent = stats.languages.toLocaleString();
    $('common-stat').textContent = stats.most_common_request || 'No requests yet';
    $('stats-status').textContent = 'Live from Supabase';
    updateUsage(stats.used);
  } catch {
    $('stats-status').textContent = 'Live stats are temporarily unavailable.';
  }
}
input.addEventListener('input', () => { $('char-count').textContent = `${input.value.length} / 1,000`; input.removeAttribute('aria-invalid'); });
business.addEventListener('change', () => business.removeAttribute('aria-invalid'));
$('use-example').addEventListener('click', () => {
  input.value = 'Bhai 4 din ho gaye order abhi tak nahi aaya 😡 kya scene hai?';
  business.value = 'Clothing / Fashion';
  input.dispatchEvent(new Event('input')); input.focus();
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  $('form-error').hidden = true;
  if (!input.value.trim()) { showError('Paste a customer message first.'); input.setAttribute('aria-invalid', 'true'); return input.focus(); }
  if (!business.value) { showError('Choose your business type.'); business.setAttribute('aria-invalid', 'true'); return business.focus(); }
  if (used >= 5) return showError("You've tried all 5 demo replies. Thanks for testing ReplyWise!");
  latestReply = ''; clearTimeout(copyTimer); $('copy-status').textContent = '';
  setBusy(true);
  try {
    const data = await fetchJson('/api/generate-reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_message: input.value, business_type: business.value, visitor_id: visitor }) });
    $('detected-language').textContent = data.detected_language;
    $('request-type').textContent = data.request_type;
    $('generated-reply').textContent = data.reply;
    $('follow-up').textContent = data.follow_up_action;
    latestReply = data.reply;
    $('result').hidden = false;
    updateUsage(data.used);
    await refreshStats();
  } catch (error) {
    showError(error.name === 'TimeoutError' ? "We couldn't generate a reply just now. Please try again." : error.message);
    $('empty-result').hidden = false;
    await refreshStats();
  } finally { setBusy(false); }
});
$('copy-reply').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(latestReply); $('copy-status').textContent = 'Copied!'; clearTimeout(copyTimer); copyTimer = setTimeout(() => { $('copy-status').textContent = ''; }, 2200); }
  catch { $('copy-status').textContent = 'Copy unavailable. Select the reply to copy it.'; }
});
$('reset').addEventListener('click', () => {
  if (busy) return;
  input.value = ''; input.dispatchEvent(new Event('input'));
  latestReply = ''; $('result').hidden = true; $('empty-result').hidden = false;
  $('form-error').hidden = true; $('copy-status').textContent = ''; clearTimeout(copyTimer);
  input.removeAttribute('aria-invalid'); business.removeAttribute('aria-invalid'); input.focus();
});
refreshStats();
