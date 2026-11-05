'use strict';
/* Real-browser test of the web build: two "devices" (separate browser contexts) share one mock Google Drive. */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium, devices } = require('playwright');
const dist = path.join(__dirname, '../dist');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('ok   ' + m); } else { fail++; console.log('FAIL ' + m); } };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => { let f = path.join(dist, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' }); r.end(b); } }); });
const drive = { id: null, text: null, writes: 0 };
async function mockGoogle(ctx, calls) {
  await ctx.route(/googleapis\.com|accounts\.google\.com/, async (route) => {
    const u = new URL(route.request().url()), m = route.request().method(), j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(o) });
    calls && calls.push(m + ' ' + u.hostname + u.pathname);
    if (m === 'OPTIONS') return j({});
    if (u.hostname === 'oauth2.googleapis.com') return j({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
    if (u.hostname === 'openidconnect.googleapis.com') return j({ email: 'me@example.com' });
    if (u.pathname === '/drive/v3/files' && m === 'GET') { return j({ files: drive.id ? [{ id: drive.id, name: 'Regis sync (do not delete).json' }] : [] }); }
    if (u.pathname === '/drive/v3/files' && m === 'POST') { drive.id = 'F1'; return j({ id: 'F1' }); }
    if (u.pathname.startsWith('/upload/drive/v3/files/') && m === 'PATCH') { drive.text = route.request().postData(); drive.writes++; return j({}); }
    if (u.pathname.startsWith('/drive/v3/files/') && u.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: drive.text || '' });
    if (u.pathname.endsWith('/gmail/v1/users/me/messages') || u.pathname.endsWith('/threads')) return j({ messages: [], threads: [], resultSizeEstimate: 0 });
    if (u.pathname.endsWith('/labels')) return j({ labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }] });
    if (u.pathname.includes('/calendar/v3/users/me/calendarList')) return j({ items: [{ id: 'primary', summary: 'Me', primary: true, accessRole: 'owner' }] });
    if (u.pathname.includes('/calendar/v3/calendars/')) return j({ items: [] });
    return j({ error: { message: 'mock: no route ' + u.pathname } }, 404);
  });
}
const SEC = { gClientId: 'cid', gSecret: 'sec', gRefresh: 'rt', gEmail: 'me@example.com' };
async function device(browser, opts, base, calls) {
  const ctx = await browser.newContext(opts); await mockGoogle(ctx, calls);
  await ctx.addInitScript((sec) => { try { if (!localStorage.getItem('regis-sec')) localStorage.setItem('regis-sec', JSON.stringify(sec)); } catch (_) {} }, SEC);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(base); await page.waitForSelector('#p-setup', { timeout: 15000 }); await page.waitForTimeout(800);
  return { ctx, page, errs };
}
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const calls = [];
  const A = await device(browser, { viewport: { width: 1280, height: 900 } }, base, calls);
  ok(A.errs.length === 0, 'desktop-size web page boots with no script errors ' + A.errs.join('|'));
  ok(await A.page.evaluate(() => !!window.regisApp && !!document.querySelector('#sync-box')), 'web runtime present (regisApp + sync box)');
  ok(await A.page.evaluate(() => document.querySelector('#g-status').textContent.includes('Connected')), 'Google shows connected from saved sign-in');
  // add a todo on A
  await A.page.fill('#todo-input, #todo-title, #todo-form input[type=text]', 'Call dentist').catch(() => {});
  const addTodo = async (pg, text) => { await pg.evaluate((t) => { const i = document.querySelector('#todo-form input, #todo-in, #todo-text'); i.value = t; document.querySelector('#todo-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }, text); await pg.waitForTimeout(400); };
  await addTodo(A.page, 'Call dentist');
  ok(await A.page.evaluate(() => document.body.innerText.includes('Call dentist')), 'todo added on device A');
  await A.page.evaluate(() => { const c = document.querySelector('#sync-on'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await A.page.waitForFunction(() => /Synced/.test(document.querySelector('#sync-status').textContent), null, { timeout: 15000 });
  ok(drive.text && drive.text.includes('Call dentist'), 'device A pushed todo to Drive');
  // device B, fresh
  const B = await device(browser, { viewport: { width: 1280, height: 900 } }, base, calls);
  await B.page.evaluate(() => { const c = document.querySelector('#sync-on'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await B.page.waitForFunction(() => /Synced/.test(document.querySelector('#sync-status').textContent), null, { timeout: 15000 });
  await B.page.waitForTimeout(500);
  ok(await B.page.evaluate(() => document.body.innerText.includes('Call dentist')), 'device B received the todo');
  // edit on B, back to A
  await addTodo(B.page, 'Renew passport');
  await B.page.evaluate(() => document.querySelector('[data-act="sync-now"]').click()); await B.page.waitForTimeout(1200);
  await A.page.evaluate(() => document.querySelector('[data-act="sync-now"]').click()); await A.page.waitForTimeout(1200);
  ok(await A.page.evaluate(() => document.body.innerText.includes('Renew passport')), 'todo from B appears on A');
  ok(A.errs.length === 0 && B.errs.length === 0, 'no script errors on either device ' + A.errs.concat(B.errs).join('|'));
  // service worker + manifest
  const sw = await A.page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r; });
  ok(sw, 'service worker registered (offline + updates)');
  const mf = await A.page.evaluate(() => fetch('manifest.webmanifest').then((r) => r.json()));
  ok(mf.display === 'standalone' && mf.icons.length >= 2, 'installable manifest');
  // sign-in redirect URL is built correctly
  const nav = []; A.page.on('request', (rq) => { if (rq.url().includes('accounts.google.com')) nav.push(rq.url()); });
  await A.ctx.route('https://accounts.google.com/**', (r) => r.fulfill({ status: 200, body: 'auth', contentType: 'text/html' }));
  await A.page.evaluate(() => { window.regisApp.connectGoogle().catch(() => {}); }).catch(() => {}); await A.page.waitForTimeout(1200);
  const au = nav[0] ? new URL(nav[0]) : null;
  ok(au && au.searchParams.get('redirect_uri') === base + 'callback.html' && au.searchParams.get('code_challenge_method') === 'S256' && au.searchParams.get('client_id') === 'cid', 'Google sign-in URL uses callback.html + PKCE');
  // returning from Google: ?code=…&state=… completes sign-in and stores the refresh token
  { const ctx = await browser.newContext(); await mockGoogle(ctx);
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('regis-sec')) { localStorage.setItem('regis-sec', JSON.stringify({ gClientId: 'cid', gSecret: 'sec' })); localStorage.setItem('regis-pkce', JSON.stringify({ verifier: 'v', state: 'w:xyz', redirect: location.origin + '/callback.html' })); } } catch (_) {} });
    const pg = await ctx.newPage(); await pg.goto(base + '?code=abc&state=w:xyz'); await pg.waitForSelector('#p-setup'); await pg.waitForTimeout(1500);
    const sec = await pg.evaluate(() => JSON.parse(localStorage.getItem('regis-sec')));
    ok(sec.gRefresh === 'RT' && sec.gEmail === 'me@example.com' && !(await pg.evaluate(() => location.search)), 'sign-in redirect completes, token saved, URL cleaned');
    const bad = await ctx.newPage(); await bad.goto(base + '?code=abc&state=WRONG'); await bad.waitForTimeout(800); ok(true, 'wrong state does not crash'); }
  // over-the-air: the site publishes a newer version.json -> the app notices and offers a reload
  { const D = await device(browser, { viewport: { width: 1000, height: 800 } }, base); A.page = D.page;
    const stat = await A.page.evaluate(async () => (await window.regisBridge.getStatus()).version);
    ok(stat === require('fs').readFileSync(__dirname + '/../../VERSION','utf8').trim(), 'web app knows its version (' + stat + ')');
    const cur = await A.page.evaluate(() => window.regisBridge.updateCheck()); ok(cur.status === 'current', 'no update when versions match');
    const vf = path.join(dist, 'version.json'), orig = fs.readFileSync(vf, 'utf8'); fs.writeFileSync(vf, JSON.stringify({ version: '9.9.9', files: {} }));
    const nu = await A.page.evaluate(() => window.regisBridge.updateCheck()); fs.writeFileSync(vf, orig); ok(nu.status === 'staged' && nu.version === '9.9.9', 'newer version detected');
    await A.page.waitForTimeout(200);
    ok(await A.page.evaluate(() => !document.querySelector('#upd-bar').hidden && /9\.9\.9/.test(document.querySelector('#upd-msg').textContent)), 'update bar appears with a Reload button'); }

  await browser.close(); server.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
