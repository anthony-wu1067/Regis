// 1.9.10 memory housekeeping: no Spotify player at start-up, the Music player frame comes and goes, hidden tabs are throttled while the
// Regis page is not, extra hidden tabs sleep, unused chat apps close, the alert window and idle Office helpers go away.
// Fake sites only. Timings are sped up with REGIS_SLEEP_SCALE / REGIS_HOUSEKEEP_MS / REGIS_COMM_IDLE_MS / REGIS_ALERT_IDLE_MS.
// Run: node_modules/electron/dist/electron test/memory.test.js
process.env.REGIS_SLEEP_SCALE = '30'; process.env.REGIS_HOUSEKEEP_MS = '1500'; process.env.REGIS_COMM_IDLE_MS = '3000'; process.env.REGIS_ALERT_IDLE_MS = '1500'; process.env.REGIS_PRESSURE = '0';
const { app, BrowserWindow, webContents, net } = require('electron'); const fs = require('fs'), os = require('os'), path = require('path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'regis-memt-')));
app.commandLine.appendSwitch('remote-debugging-port', '9341');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch (_) {} await sleep(200); } return false; };
const SITE = (n) => '<!doctype html><title>Site ' + n + '</title><body>site ' + n + '</body>';
app.on('session-created', (ses) => { try { ses.protocol.handle('https', (req) => { const u = new URL(req.url), m = u.hostname.match(/^site(\d+)\.test$/);
  if (m) return new Response(SITE(m[1]), { headers: { 'content-type': 'text/html' } });
  if (u.hostname === 'chat.test') return new Response('<!doctype html><title>Chat</title><body>chat</body>', { headers: { 'content-type': 'text/html' } });
  if (u.hostname === 'open.spotify.com') return new Response('<!doctype html><title>Spotify embed</title><body>player</body>', { headers: { 'content-type': 'text/html' } });
  return net.fetch(req, { bypassCustomProtocolHandlers: true }); }); } catch (_) {} });
require(path.join(__dirname, '..', 'main.js'));
const targets = async () => { try { return await (await fetch('http://127.0.0.1:9341/json/list')).json(); } catch (_) { return []; } };
app.whenReady().then(async () => { try {
  let win; for (let i = 0; i < 450 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())); await sleep(100); }
  win.setSize(1300, 860); win.show(); await sleep(4500);
  const J = (c) => win.webContents.executeJavaScript('(async()=>{' + c + '})()', true);
  // ---- Spotify
  ok(!(await targets()).some((t) => /open\.spotify\.com|sdk\.scdn\.co/.test(t.url)), 'no Spotify player is loaded at start-up');
  ok(!app.getAppMetrics().some((p) => /CdmServiceBroker/.test(p.serviceName || '')), 'and the DRM (Widevine) process is not running');
  ok(!(await J('return !!document.querySelector("#mu-frame iframe")')), 'the Music player frame does not exist yet');
  await J('document.querySelector(\'#vsw [data-v="music"]\').click()');
  ok(await until(async () => (await J('return !!document.querySelector("#mu-frame iframe")')) && (await targets()).some((t) => /open\.spotify\.com\/embed/.test(t.url))), 'opening Music loads the player');
  await J('document.querySelector(\'#vsw [data-v="home"]\').click()');
  ok(await until(async () => !(await J('return !!document.querySelector("#mu-frame iframe")')) && !(await targets()).some((t) => /open\.spotify\.com/.test(t.url))), 'leaving Music (with nothing playing) removes it again');
  await J('document.querySelector(\'#vsw [data-v="music"]\').click()');
  ok(await until(() => J('return !!document.querySelector("#mu-frame iframe")')), 'and it comes back when Music is opened again');
  ok((await J('return typeof window.regisBridge.audible')) === 'function' && (await J('return await window.regisBridge.audible()')) === false, 'Regis can tell whether its page is playing sound (it is not)');
  await J('document.querySelector(\'#vsw [data-v="home"]\').click()'); await sleep(500);
  // ---- throttling: hidden tabs slow down, the Regis page does not
  await J('document.querySelector(\'#vsw [data-v="browser"]\').click()'); await sleep(1500);
  const ids = []; const openTab = async (i) => { ids.push(await J('return await window.regisBridge.browser.open("https://site' + i + '.test/")')); };
  await openTab(1); await openTab(2); await until(() => webContents.getAllWebContents().filter((w) => /site\d\.test/.test(w.getURL()) && !w.isLoading()).length === 2);
  const hidden = webContents.getAllWebContents().find((w) => /site1\.test/.test(w.getURL()));
  const tick = (wc) => Promise.race([wc.executeJavaScript('new Promise(function(r){var n=0,i=setInterval(function(){n++},100);setTimeout(function(){clearInterval(i);r(n)},3000)})'), sleep(9000).then(() => -1)]);
  const ht = await tick(hidden); ok(ht >= 0 && ht <= 6, 'a hidden tab is slowed down like in Chrome (' + ht + ' timer ticks in 3 s instead of 30)');
  win.minimize(); await sleep(800); const mt = await tick(win.webContents); win.restore(); await sleep(500);
  ok(mt >= 25, 'the Regis page keeps full speed even when minimised, so music keeps playing (' + mt + ' ticks in 3 s)');
  // ---- at most 4 hidden tabs stay awake (sped up: 2 minutes -> 4 s)
  for (let i = 3; i <= 7; i++) { await openTab(i); await sleep(300); }
  ok(await until(() => webContents.getAllWebContents().filter((w) => /site\d\.test/.test(w.getURL())).length <= 5, 15000), 'with 7 tabs open, only the shown tab and the 4 most recent hidden ones stay awake');
  const st = await J('return await window.regisBridge.browser.state()'), awake = st.tabs.filter((t) => !t.asleep).map((t) => t.url);
  ok(awake.some((u) => /site7/.test(u)) && !awake.some((u) => /site1\.test/.test(u)) && st.tabs.length === 8, 'the oldest ones sleep, the tabs themselves stay in the strip');
  // ---- chat apps: one not set to keep running closes when unused
  await J('document.querySelector(\'#vsw [data-v="comm"]\').click()'); await sleep(800);
  const cid = await J('return await window.regisBridge.comm.add({name:"Chat",url:"https://chat.test/"})');
  ok(await until(() => webContents.getAllWebContents().some((w) => /chat\.test/.test(w.getURL()))), 'a chat app opens');
  const s1 = await J('return await window.regisBridge.comm.state()'); const a1 = s1.apps.find((a) => a.id === cid);
  ok(a1 && a1.live && a1.mb > 0, 'Regis knows how much memory the chat app uses (' + (a1 && a1.mb) + ' MB)');
  await J('await window.regisBridge.comm.bg(' + JSON.stringify(cid) + ',false)');
  await J('document.querySelector(\'#vsw [data-v="home"]\').click()');
  ok(await until(() => !webContents.getAllWebContents().some((w) => /chat\.test/.test(w.getURL())), 15000), 'switched to "not kept running", it closes a while after you leave it');
  await J('document.querySelector(\'#vsw [data-v="comm"]\').click()');
  ok(await until(() => webContents.getAllWebContents().some((w) => /chat\.test/.test(w.getURL()))), 'and opens again when you go back to it');
  await J('await window.regisBridge.comm.bg(' + JSON.stringify(cid) + ',true)'); await J('document.querySelector(\'#vsw [data-v="home"]\').click()'); await sleep(6000);
  ok(webContents.getAllWebContents().some((w) => /chat\.test/.test(w.getURL())), 'an app kept running for notifications is never closed');
  // ---- alert window and Office helper (main-process parts, checked directly)
  const { AlertFloat } = require('../lib/alert-float.js'); const af = new AlertFloat({ getWin: () => win, onAct: () => {} });
  af.show([{ id: 'a', t: 'Test alert', kind: 'event' }], { top: 60, right: 16 }, {}); await sleep(1500);
  ok(af.fw && !af.fw.isDestroyed(), 'an alert window is made when there is something to show');
  af.hide(); ok(await until(() => !af.fw, 6000), 'and closed (with its process) a little after there is nothing to show');
  const { OfficeDock } = require('../lib/office.js'); const od = new OfficeDock(() => win, 'none.ps1'); let ended = 0;
  od.ps = { stdin: { end: () => { ended++; } } }; od.lastBusy = Date.now() - 11 * 60000;
  ok(od.idle(10 * 60000) === true && ended === 1, 'an Office helper with nothing docked for 10 minutes is stopped');
  od.ps = { stdin: { end: () => { ended++; } } }; od.docs.set(1, { h: 1 }); od.lastBusy = 0;
  ok(od.idle(10 * 60000) === false && ended === 1, 'but never while a window is docked');
  ok(typeof (await J('return await window.regisBridge.memory()')).freeMB === 'number', 'Regis can read how much memory the computer has free');
  // ---- short of memory: every hidden tab sleeps (sped up: 3 minutes -> 6 s); the shown tab never does
  await J('document.querySelector(\'#vsw [data-v="browser"]\').click()'); await sleep(800);
  await J('return await window.regisBridge.browser.open("https://site8.test/")'); await sleep(1500); await J('await window.regisBridge.browser.activate(' + ids[ids.length - 1] + ')');
  process.env.REGIS_PRESSURE = '1';
  ok(await until(() => webContents.getAllWebContents().filter((w) => /site\d\.test/.test(w.getURL())).length === 1, 20000), 'when the computer is short of memory, every hidden tab sleeps and only the shown one stays');
  process.env.REGIS_PRESSURE = '0';
  console.log(pass + ' passed, ' + fail + ' failed'); app.exit(fail ? 1 : 0);
  } catch (e) { console.log('UNCAUGHT', e && e.stack || e); app.exit(1); }
});
