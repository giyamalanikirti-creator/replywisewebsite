// This local interaction uses preset conversations and makes no network requests.
const $ = id => document.getElementById(id);
const fixtures = [
  { id: 'delivery', message: 'Bhai 4 din ho gaye order abhi tak nahi aaya 😡 kya scene hai?', reply: 'Sorry, delay frustrating hai. Main order aur courier status check karke aapko confirmed update share karunga. Bina verify kiye delivery date promise nahi karna chahta.', action: 'Check the order and courier tracking before confirming an update.' },
  { id: 'price', message: 'Iska price kya hai? Mujhe discount bhi de do.', reply: 'Main current price aur available offers check karke aapko confirm karta hoon. Bina verify kiye price ya discount promise nahi karna chahta.', action: 'Verify the current product price and any applicable offers.' },
  { id: 'exchange', message: 'The shirt is too small. Can I exchange it?', reply: 'Sorry the fit wasn’t right. Let me check your order details and the applicable exchange options before confirming the next step.', action: 'Check the order details and applicable exchange policy.' }
];
let messages = [];
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function notice(text) { $('wa-notice').textContent = text; $('wa-notice').hidden = false; }
function render() {
  const inbox = $('wa-inbox'); inbox.replaceChildren();
  for (const message of messages) {
    const card = node('article', undefined, 'wa-message');
    card.append(node('p', `Customer message · ${message.sent ? 'Reply preview ready' : 'Conversation'}`, 'wa-message-meta'), node('p', message.message));
    if (message.sent) {
      card.append(node('p', message.editedReply), node('p', 'Reply preview ready.', 'wa-outcome'));
    } else if (!message.drafted) {
      const draft = node('button', 'Preview reply ✦', 'button'); draft.type = 'button';
      draft.addEventListener('click', () => { message.drafted = true; render(); $('wa-notice').hidden = true; $('wa-reply-' + message.id).focus(); });
      card.append(draft);
    } else {
      const label = node('label', 'Review and edit your reply'); label.htmlFor = 'wa-reply-' + message.id;
      const editor = node('textarea'); editor.id = label.htmlFor; editor.rows = 4; editor.maxLength = 1600; editor.value = message.editedReply;
      const approveLabel = node('label', undefined, 'wa-approve');
      const approve = node('input'); approve.type = 'checkbox';
      approveLabel.append(approve, document.createTextNode('I reviewed this reply.'));
      const send = node('button', 'Save reply preview →', 'button'); send.type = 'button'; send.disabled = true;
      approve.addEventListener('change', () => { send.disabled = !approve.checked || !editor.value.trim(); });
      editor.addEventListener('input', () => { message.editedReply = editor.value; approve.checked = false; send.disabled = true; });
      send.addEventListener('click', () => {
        if (!approve.checked || !editor.value.trim()) return;
        message.sent = true; render(); notice('Reply preview saved.'); $('wa-notice').scrollIntoView({ block: 'nearest' });
      });
      card.append(label, editor, node('p', 'Next step: ' + message.action, 'wa-outcome'), approveLabel, send);
    }
    inbox.append(card);
  }
}
function reset() { messages = fixtures.map(message => ({ ...message, drafted: false, sent: false, editedReply: message.reply })); render(); }
$('wa-connect-button').addEventListener('click', () => {
  reset(); $('wa-connected').hidden = false; $('wa-connect-button').hidden = true; $('wa-connect-button').setAttribute('aria-expanded', 'true');
  $('wa-state').textContent = 'WhatsApp reply workspace';
  $('wa-notice').hidden = true; $('wa-disconnect').focus();
});
$('wa-reset-demo').addEventListener('click', () => { reset(); $('wa-notice').hidden = true; });
$('wa-disconnect').addEventListener('click', () => {
  messages = []; $('wa-inbox').replaceChildren(); $('wa-connected').hidden = true; $('wa-connect-button').hidden = false; $('wa-connect-button').setAttribute('aria-expanded', 'false');
  $('wa-notice').hidden = true; $('wa-connect-button').focus();
});
