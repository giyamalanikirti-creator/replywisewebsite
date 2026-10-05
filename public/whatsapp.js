const $ = id => document.getElementById(id);
const inbox = $('wa-inbox');
let connected = false;
let busy = false;
function clearFeedback() { $('wa-error').hidden = true; $('wa-notice').hidden = true; }
function error(message) { $('wa-error').textContent = message; $('wa-error').hidden = false; }
function notice(message) { $('wa-notice').textContent = message; $('wa-notice').hidden = false; }
function lock() {
  $('wa-owner').hidden = true; $('wa-login').hidden = false; inbox.replaceChildren(); connected = false;
  $('wa-password').value = '';
}
async function api(action, body) {
  const response = await fetch(`/api/whatsapp${body ? '' : '?action=' + encodeURIComponent(action)}`, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin', signal: AbortSignal.timeout(55000),
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, action }) } : {})
  });
  let data; try { data = await response.json(); } catch { throw new Error('WhatsApp is temporarily unavailable. Please try again.'); }
  if (!response.ok) { if (response.status === 401 && action !== 'login') lock(); throw new Error(data.error || 'WhatsApp is temporarily unavailable.'); }
  return data;
}
async function operation(button, task) {
  if (busy) return;
  busy = true; clearFeedback();
  const label = button.textContent;
  button.disabled = true; button.textContent = 'Please wait…';
  try { await task(); }
  catch (cause) { error(cause.name === 'TimeoutError' ? 'The request timed out. Refresh messages before trying again.' : cause.message); }
  finally { button.textContent = label; button.disabled = false; busy = false; }
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function renderMessage(message) {
  const card = element('article', undefined, 'wa-message');
  const statuses = { new: 'Awaiting a draft', draft: 'Ready for your review', sending: 'Send in progress', sent: 'Accepted by WhatsApp', send_failed: 'Send rejected — review before retrying', send_unknown: 'Send uncertain — check WhatsApp; retry is blocked' };
  card.append(element('p', `${new Date(message.received_at).toLocaleString()} · ${statuses[message.state] || 'Customer message'}`, 'wa-message-meta'));
  card.append(element('p', message.message));
  if (message.too_long) card.append(element('p', 'Message clipped to 1,000 characters. Use a shorter message in the main tool.', 'wa-outcome'));
  if (!message.can_reply) { card.append(element('p', 'The 24-hour reply window has closed.', 'wa-outcome')); return card; }
  if (message.state === 'new' && !message.too_long) {
    const draftButton = element('button', 'Draft my reply ✦', 'button'); draftButton.type = 'button';
    draftButton.addEventListener('click', () => operation(draftButton, async () => { await api('draft', { message_id: message.id }); await loadState(); }));
    card.append(draftButton); return card;
  }
  if (message.state === 'sent') { if (message.sent_reply) card.append(element('p', message.sent_reply)); return card; }
  if (!message.draft || !['draft','send_failed'].includes(message.state)) return card;
  const label = element('label', 'Review and edit your reply'); label.htmlFor = 'wa-reply-' + message.id;
  const textarea = element('textarea'); textarea.id = label.htmlFor; textarea.value = message.draft.reply; textarea.maxLength = 1600; textarea.rows = 4;
  const next = element('p', 'Next step: ' + message.draft.follow_up_action, 'wa-outcome');
  const approveLabel = element('label', undefined, 'wa-approve');
  const approve = element('input'); approve.type = 'checkbox';
  approveLabel.append(approve, document.createTextNode('I checked the facts and approve sending this reply to the customer.'));
  const sendButton = element('button', 'Send reviewed reply →', 'button'); sendButton.type = 'button'; sendButton.disabled = true;
  approve.addEventListener('change', () => { sendButton.disabled = !approve.checked; });
  textarea.addEventListener('input', () => { approve.checked = false; sendButton.disabled = true; });
  sendButton.addEventListener('click', () => operation(sendButton, async () => {
    if (!approve.checked) return;
    const result = await api('send', { message_id: message.id, reply: textarea.value, approved: true });
    await loadState(); notice(result.message);
  }));
  card.append(label, textarea, next, approveLabel, sendButton); return card;
}
async function loadInbox() {
  const data = await api('inbox');
  inbox.replaceChildren();
  if (!data.messages.length) inbox.append(element('p', 'No new text messages yet. Send a message to your connected business number, then refresh here.', 'wa-empty'));
  else for (const message of data.messages) inbox.append(renderMessage(message));
}
async function loadState() {
  const state = await api('status'); connected = state.connected;
  $('wa-login').hidden = true; $('wa-owner').hidden = false;
  $('wa-connect').hidden = connected; $('wa-connected').hidden = !connected;
  $('wa-state').textContent = connected ? `Connected · ${state.label}` : 'Your connection is unlocked. Connect your business account below.';
  $('wa-quota').textContent = `${state.used} of 5 WhatsApp demo drafts used. Sending a reviewed draft uses no extra AI request.`;
  if (connected) await loadInbox();
}
$('wa-login').addEventListener('submit', event => {
  event.preventDefault();
  operation(event.submitter, async () => {
    const password = $('wa-password').value;
    if (!password) throw new Error('Enter your private owner access key.');
    await api('login', { password }); $('wa-password').value = ''; await loadState();
  });
});
$('wa-connect').addEventListener('submit', event => {
  event.preventDefault();
  operation(event.submitter, async () => {
    const business_type = $('wa-business').value;
    if (!business_type) throw new Error('Choose your business type.');
    await api('connect', { business_type }); await loadState(); notice('Account connected. Send a new customer text message to test the webhook.');
  });
});
$('wa-refresh').addEventListener('click', event => operation(event.currentTarget, loadState));
$('wa-lock').addEventListener('click', event => operation(event.currentTarget, async () => { await api('logout', {}); lock(); notice('Owner connection locked. Incoming messages can still be received.'); }));
$('wa-disconnect').addEventListener('click', event => {
  if (!confirm('Disconnect WhatsApp and delete imported messages and encrypted recipients? Previously saved AI generations remain in usage history.')) return;
  operation(event.currentTarget, async () => { await api('disconnect', {}); inbox.replaceChildren(); await loadState(); notice('Disconnected. Remove the webhook subscription in Meta too if you want to stop event delivery.'); });
});
// A session may survive refresh; never show private data before server validation.
loadState().catch(() => lock());
