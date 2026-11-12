// 1.9.9 white-screen safety net: the graphics process is crashed (chrome://gpucrash) while a coloured site is shown in a Browser tab.
// Checks: the events log says what was on screen, the shown tab gets a fresh frame and ends up at exactly its old size, the window shows
// the site again, and a crashed Regis page reloads itself. What the window shows is read for THIS window only (never the whole screen).
// Run: node_modules/electron/dist/electron test/gpu.test.js
const { app, BrowserWindow, desktopCapturer, webContents, net } = require('electron'); const fs = require('fs'), os = require('os'), path = require('path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'regis-gpu-')));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch (_) {} await sleep(200); } return false; };
const PAGE = '<!doctype html><title>Purple</title><body style="margin:0;background:#6a1b9a;height:100vh"></body>';
app.on('session-created', (ses) => { try { ses.protocol.handle('https', (req) => (new URL(req.url).hostname === 'purple.test' ? new Response(PAGE, { headers: { 'content-type': 'text/html' } }) : net.fetch(req, { bypassCustomProtocolHandlers: true }))); } catch (_) {} });
require(path.join(__dirname, '..', 'main.js'));
const purple = async (win) => { const src = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 500, height: 330 } })).find((s) => s.id === win.getMediaSourceId()); if (!src) return 0;
  const b = src.thumbnail.toBitmap(), s = src.thumbnail.getSize(); let n = 0, all = 0; for (let y = 80; y < s.height - 10; y += 6) for (let x = 140; x < s.width - 10; x += 6) { const i = (y * s.width + x) * 4; all++; if (Math.abs(b[i + 2] - 0x6a) < 24 && b[i + 1] < 50 && Math.abs(b[i] - 0x9a) < 30) n++; } return n / all; };
app.whenReady().then(async () => {
  const log = path.join(app.getPath('userData'), 'regis-events.log'), readLog = () => { try { return fs.readFileSync(log, 'utf8'); } catch (_) { return ''; } };
  let win; for (let i = 0; i < 450 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())); await sleep(100); }
  win.setBounds({ x: 40, y: 40, width: 1100, height: 720 }); win.show(); await sleep(3500);
  const J = (c) => win.webContents.executeJavaScript('(async()=>{' + c + '})()', true);
  await J('document.querySelector(\'#vsw [data-v="browser"]\').click()'); await sleep(1500);
  await J('await window.regisBridge.browser.open("https://purple.test/")');
  let tab; ok(await until(() => { tab = webContents.getAllWebContents().find((w) => /purple\.test/.test(w.getURL())); return tab && !tab.isLoading(); }), 'a coloured site opens in a tab');
  await sleep(1200);
  const view = () => require('electron').BaseWindow.getAllWindows()[0].contentView.children.find((v) => v.webContents === tab);
  const b0 = JSON.stringify(view().getBounds());
  ok(await until(async () => (await purple(win)) > 0.6), 'the window shows the site');
  let painted = 0; tab.on('paint', () => painted++); const inv = tab.invalidate.bind(tab); let invalidated = 0; tab.invalidate = () => { invalidated++; return inv(); };
  const c = new BrowserWindow({ show: false }); c.loadURL('chrome://gpucrash').catch(() => {});
  ok(await until(() => /GPU crashed/.test(readLog())), 'the graphics crash is written to the events log');
  ok(/GPU crashed .*\[window normal, browser tab shown\]/.test(readLog()), 'with what was on screen at the time');
  try { c.destroy(); } catch (_) {}
  ok(await until(() => /repainted after GPU restart \(tab\)/.test(readLog()), 8000), 'Regis then asks the shown tab to redraw');
  ok(invalidated >= 1, 'the tab was told to draw a fresh frame');
  await sleep(4500);
  ok(JSON.stringify(view().getBounds()) === b0, 'and the tab is back at exactly its old size (' + b0 + ')');
  ok(await until(async () => (await purple(win)) > 0.6), 'the window shows the site again');
  ok(!(await J('return !!document.getElementById("bw-snap")&&!document.getElementById("bw-snap").hidden&&getComputedStyle(document.getElementById("bw-snap")).display!=="none"')), 'the live tab is shown, not a still picture');
  // the Regis page's own renderer dies: it reloads by itself
  const pid0 = win.webContents.getOSProcessId(); win.webContents.forcefullyCrashRenderer();
  ok(await until(() => /REGIS-PAGE gone/.test(readLog())), 'a crash of the Regis page is logged');
  ok(await until(() => { try { return win.webContents.getOSProcessId() !== pid0 && !win.webContents.isLoading() && win.webContents.getURL().endsWith('index.html'); } catch (_) { return false; } }, 15000), 'and the page loads again by itself');
  ok(await until(async () => (await J('return !!document.getElementById("vsw")')) === true), 'Regis works again after that');
  console.log(pass + ' passed, ' + fail + ' failed'); app.exit(fail ? 1 : 0);
});
