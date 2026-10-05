import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const child = spawn(process.execPath, ['scripts/dev.js'], { env: { ...process.env, PORT: '3100' }, stdio: 'ignore' });
let browser;
try {
  for (let i=0; i<50; i++) { try { if ((await fetch('http://localhost:3100')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  let generations = 0, used = 0;
  const reply = 'TEST FIXTURE: Let me check your order details and share a confirmed update.';
  await page.route('**/api/stats?*', route => route.fulfill({ json: { shops_served: used ? 1 : 0, languages: used ? 1 : 0, most_common_request: used ? 'Delivery delay' : null, used } }));
  await page.route('**/api/generate-reply', async route => {
    generations++;
    const body = route.request().postDataJSON();
    assert.match(body.visitor_id, /^[0-9a-f-]{36}$/);
    await new Promise(r => setTimeout(r, 150));
    if (used >= 5) return route.fulfill({ status: 429, json: { error: "You've tried all 5 demo replies. Thanks for testing ReplyWise!" } });
    used++;
    await route.fulfill({ json: { detected_language: 'Hinglish', request_type: 'Delivery delay', reply, follow_up_action: 'TEST FIXTURE: Check tracking.', used } });
  });
  await page.goto('http://localhost:3100');
  await page.locator('#stats-status').filter({ hasText: 'Live from Supabase' }).waitFor();
  await page.locator('#generate-button').click();
  assert.equal(await page.locator('#form-error').textContent(), 'Paste a customer message first.'); assert.equal(generations, 0);
  await page.locator('#customer-message').fill('Hello');
  await page.locator('#generate-button').click();
  assert.equal(await page.locator('#form-error').textContent(), 'Choose your business type.');
  await page.locator('#use-example').click();
  await page.locator('#generate-button').click();
  await page.locator('#loading-result').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#generate-button').isDisabled(), true);
  await page.locator('#result').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#generated-reply').textContent(), reply);
  await page.locator('#copy-reply').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), reply);
  assert.equal(await page.locator('#copy-status').textContent(), 'Copied!');
  const id = await page.evaluate(() => localStorage.getItem('replywise_visitor_id'));
  await page.locator('#reset').click();
  assert.equal(await page.locator('#customer-message').inputValue(), '');
  assert.equal(await page.locator('#usage').textContent(), '1 of 5 free demo replies used');
  assert.equal(await page.evaluate(() => localStorage.getItem('replywise_visitor_id')), id);
  await page.reload();
  await page.locator('#usage').filter({ hasText: '1 of 5' }).waitFor();
  await mkdir('test-results', { recursive: true });
  for (const [name, width, height] of [['desktop',1440,1000],['tablet',768,1024],['mobile',390,844],['small-mobile',320,740]]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: horizontal overflow`);
    for (const href of ['#try-it','#how-it-works','#why-replywise']) assert.equal(await page.locator(href).count(),1);
    await page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
  }
  await page.route('**/api/generate-reply', route => route.fulfill({ status: 503, json: { error: "We couldn't generate a reply just now. Please try again." } }));
  await page.locator('#use-example').click(); await page.locator('#generate-button').click();
  await page.locator('#form-error').filter({ hasText: "couldn't generate" }).waitFor();
  await page.unroute('**/api/generate-reply');
  await page.route('**/api/generate-reply', route => route.fulfill({ status: 429, json: { error: "You've tried all 5 demo replies. Thanks for testing ReplyWise!" } }));
  used = 5;
  await page.locator('#generate-button').click();
  await page.locator('#form-error').filter({ hasText: 'all 5' }).waitFor();
  await page.waitForFunction(() => document.getElementById('generate-button').disabled);
  assert.equal(await page.locator('#usage').textContent(), '5 of 5 free demo replies used');
  let unlocked = false, waConnected = false, waDraft = false, waSent = false;
  let sendCalls = 0;
  const waId = 'f1234567-1234-4123-8123-123456789abc';
  await page.route('**/api/whatsapp**', async route => {
    const url = new URL(route.request().url());
    const data = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
    const action = data?.action || url.searchParams.get('action');
    if (action === 'login') { unlocked = true; return route.fulfill({ json: { unlocked: true } }); }
    if (!unlocked) return route.fulfill({ status: 401, json: { error: 'Unlock your WhatsApp connection to continue.' } });
    if (action === 'status') return route.fulfill({ json: { connected: waConnected, label: 'TEST account ending 1234', used: waDraft ? 1 : 0 } });
    if (action === 'connect') { waConnected = true; return route.fulfill({ json: { connected: true } }); }
    if (action === 'draft') { waDraft = true; return route.fulfill({ json: { reply: 'TEST WhatsApp draft', used: 1 } }); }
    if (action === 'send') { assert.equal(data.approved, true); assert.equal(data.reply, 'TEST edited reviewed reply'); sendCalls++; waSent = true; return route.fulfill({ json: { sent: true, message: 'WhatsApp accepted the reply. Delivery is not yet confirmed.' } }); }
    if (action === 'inbox') return route.fulfill({ json: { messages: [{ id: waId, message: 'TEST customer order question', received_at: new Date().toISOString(), can_reply: true, too_long: false, state: waSent ? 'sent' : waDraft ? 'draft' : 'new', sent_reply: waSent ? 'TEST edited reviewed reply' : null, draft: waDraft ? { reply: 'TEST WhatsApp draft', follow_up_action: 'TEST verify tracking' } : null }] } });
    if (action === 'logout') { unlocked = false; return route.fulfill({ json: { unlocked: false } }); }
  });
  await page.reload();
  await page.locator('#wa-password').fill('TEST-owner-key');
  await page.locator('#wa-login button').click();
  await page.locator('#wa-connect').waitFor({ state: 'visible' });
  await page.locator('#wa-business').selectOption('Clothing / Fashion');
  await page.locator('#wa-connect button').click();
  await page.locator('.wa-message').waitFor();
  assert.equal(sendCalls, 0);
  await page.locator('.wa-message button').click();
  const sendButton = page.getByRole('button', { name: 'Send reviewed reply' });
  await sendButton.waitFor();
  assert.equal(await sendButton.isDisabled(), true);
  await page.locator('.wa-approve input').check();
  assert.equal(await sendButton.isDisabled(), false);
  await page.locator('.wa-message textarea').fill('TEST edited reviewed reply');
  assert.equal(await sendButton.isDisabled(), true);
  await page.locator('.wa-approve input').check();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'test-results/whatsapp-mobile.png', fullPage: true });
  await sendButton.click();
  await page.locator('#wa-notice').filter({ hasText: 'accepted' }).waitFor();
  assert.equal(sendCalls, 1);
  await page.locator('#wa-lock').click();
  await page.locator('#wa-login').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.wa-message').count(), 0);
  console.info('Browser checks passed: input validation, generation/loading, copy, reset, persistent identity, API errors/cap, four responsive widths, and WhatsApp unlock/connect/draft/edit/approval/send/lock. API fixtures were mocked.');
} finally { await browser?.close(); child.kill(); }
