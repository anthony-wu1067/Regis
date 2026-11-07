// Comm page with a fake chat site (https://chat.test, served inside the app's own session). No real accounts.
// Run: node_modules/electron/dist/electron test/comm.test.js
const { app, BrowserWindow, webContents, net } = require('electron'); const fs = require('fs'), os = require('os'), path = require('path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'regis-comm-')));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch (_) {} await sleep(150); } return false; };
const PAGE = '<!doctype html><title>(2) Chat</title><body style="background:#123;color:#fff"><h1>Chat</h1><script>setTimeout(function(){document.title="(3) Chat"},1500)</script></body>';
app.on('session-created', (ses) => { try { ses.protocol.handle('https', (req) => (new URL(req.url).hostname === 'chat.test' ? new Response(PAGE, { headers: { 'content-type': 'text/html' } }) : net.fetch(req, { bypassCustomProtocolHandlers: true }))); } catch (_) {} });
require(path.join(__dirname, '..', 'main.js'));
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 450 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())); await sleep(100); }
  win.setSize(1300, 840); win.show(); await sleep(3500);
  const J = (c) => win.webContents.executeJavaScript('(async()=>{' + c + '})()', true);
  const st = () => J('return await window.regisBridge.comm.state()');
  const chatWc = () => webContents.getAllWebContents().find((w) => /chat\.test/.test(w.getURL()));
  ok(await J('return !!document.querySelector(\'#vsw [data-v="comm"]\')'), 'Comm is in the page list');
  await J('document.querySelector(\'#vsw [data-v="comm"]\').click()'); await sleep(1200);
  ok(await J('return /Discord/.test(document.getElementById("cm-ph").textContent)&&/Slack/.test(document.getElementById("cm-ph").textContent)&&/iMessage/.test(document.getElementById("cm-ph").textContent)'), 'with no apps, Comm offers Discord, Slack and the others, and explains iMessage');
  await J('document.getElementById("cm-cn").value="Chat";document.getElementById("cm-cu").value="https://chat.test/";document.querySelector("form[data-cm-form]").requestSubmit()');
  ok(await until(async () => { const s = await st(); return s.apps.length === 1 && s.apps[0].name === 'Chat'; }), 'a chat app can be added by its web address');
  ok(await until(() => !!chatWc()), 'it opens in its own view');
  ok(await until(() => J('return /^2|3$/.test((document.querySelector("#cm-side .cm-a em")||{}).textContent||"")')), 'the unread count from the app shows on its icon');
  ok(await until(() => J('return document.getElementById("nav-btn").classList.contains("unread")')), 'the Nav button gets an unread dot');
  ok(await until(async () => (await st()).apps[0].unread === 3), 'the count follows the app (now 3)');
  const id = (await st()).apps[0].id;
  // mute
  await J('document.querySelector(\'#cm-bar [data-act="cm-mute"]\').click()');
  ok(await until(async () => (await st()).apps[0].muted && chatWc().isAudioMuted()), 'Mute silences the app');
  await J('document.querySelector(\'#cm-side [data-act="cm-muteall"]\').click()');
  ok(await until(async () => (await st()).muteAll), 'Mute all mutes every app');
  await J('document.querySelector(\'#cm-side [data-act="cm-muteall"]\').click()'); await J('document.querySelector(\'#cm-bar [data-act="cm-mute"]\').click()');
  ok(await until(async () => { const s = await st(); return !s.muteAll && !s.apps[0].muted && !chatWc().isAudioMuted(); }), 'and both can be turned back on');
  // pop out
  await J('document.querySelector(\'#cm-bar [data-act="cm-pop"]\').click()');
  let fw; ok(await until(() => { fw = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Regis chat'); return !!fw; }), 'Pop out opens a small chat window');
  await J('document.querySelector(\'#vsw [data-v="music"]\').click()'); await sleep(1500);
  ok(fw.isVisible() && fw.contentView.children.some((c) => c.webContents === chatWc()), 'on another page the chat window shows the app');
  const b0 = fw.getBounds(); fw.webContents.executeJavaScript('document.getElementById("min").click()'); await sleep(800);
  ok(fw.getBounds().height <= 40, 'minimise shrinks it to a small bar (' + fw.getBounds().height + 'px)');
  fw.webContents.executeJavaScript('document.getElementById("min").click()'); await sleep(800);
  ok(fw.getBounds().height >= b0.height - 4, 'and it comes back to full size');
  fw.webContents.executeJavaScript('document.getElementById("full").click()');
  ok(await until(() => J('return document.documentElement.dataset.view==="comm"')), '↗ opens the app on the Comm page');
  ok(await until(() => !BrowserWindow.getAllWindows().some((w) => w.getTitle() === 'Regis chat')), 'and closes the floating window');
  // remove
  await J('window.confirm=function(){return true}'); await J('document.querySelector(\'#cm-bar [data-act="cm-menu"]\').click()'); await sleep(300);
  await J('document.querySelector(\'#bw-bmpop [data-act="cm-rm"]\').click()');
  ok(await until(async () => (await st()).apps.length === 0), 'an app can be removed');
  ok(await until(() => !chatWc()), 'and its view is closed');
  console.log(pass + ' passed, ' + fail + ' failed'); app.exit(fail ? 1 : 0);
});
