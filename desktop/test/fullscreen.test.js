// Full screen in the real Regis app: the button, F11 inside a web page, F11 after leaving the Browser.
// Run: node_modules/electron/dist/electron test/fullscreen.test.js   (on Linux CI: xvfb-run -a ... --no-sandbox)
const { app, BrowserWindow, webContents } = require('electron'); const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'regis-fs-')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const out = [];
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<title>P</title><input id=i>'); });
require(path.join(__dirname, '..', 'main.js'));
app.whenReady().then(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  let win; for (let i = 0; i < 450 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())); await sleep(100); }
  win.show(); win.focus(); await sleep(3500);
  const J = (c) => win.webContents.executeJavaScript('(async()=>{' + c + '})()', true);
  const F11 = (wc) => { wc.sendInputEvent({ type: 'keyDown', keyCode: 'F11' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'F11' }); };
  const reset = async () => { if (win.isFullScreen()) { win.setFullScreen(false); await sleep(1300); } };
  await J('document.getElementById("btn-fs").click()'); await sleep(1500);
  out.push((win.isFullScreen() ? 'PASS' : 'FAIL') + ' the full-screen button makes the window truly full screen');
  out.push((await J('return document.getElementById("btn-fs").getAttribute("aria-pressed")') === 'true' ? 'PASS' : 'FAIL') + ' the button shows it is on');
  await J('document.getElementById("btn-fs").click()'); await sleep(1500); out.push((!win.isFullScreen() ? 'PASS' : 'FAIL') + ' pressing it again leaves full screen'); await reset();
  await J('document.querySelector(\'#vsw [data-v="browser"]\').click()'); await sleep(1500);
  await J('var a=document.getElementById("bw-addr");a.value=' + JSON.stringify(base + '/p') + ';document.getElementById("bw-form").requestSubmit()'); await sleep(2500);
  const tab = webContents.getAllWebContents().find((w) => /\/p$/.test(w.getURL())); tab.focus(); await sleep(300);
  F11(tab); await sleep(1500); out.push((win.isFullScreen() ? 'PASS' : 'FAIL') + ' F11 works while typing inside a web page'); await reset();
  await J('document.querySelector(\'#vsw [data-v="music"]\').click()'); await sleep(1500);
  out.push((win.webContents.isFocused() ? 'PASS' : 'FAIL') + ' leaving the Browser gives the keyboard back to Regis');
  F11(win.webContents); await sleep(1500); out.push((win.isFullScreen() ? 'PASS' : 'FAIL') + ' F11 works on Music after using the Browser'); await reset();
  // a video going full screen fills the whole screen; leaving it restores Regis the way it was
  await J('document.querySelector(\'#vsw [data-v="browser"]\').click()'); await sleep(1200);
  const vt = webContents.getAllWebContents().find((w) => /\/p$/.test(w.getURL()));
  const vfsOn = () => vt.executeJavaScript('document.documentElement.requestFullscreen().then(function(){return true},function(){return false})', true);
  const vfsOff = () => vt.executeJavaScript('document.exitFullscreen().then(function(){return true},function(){return false})', true);
  const fills = () => { const v = require('electron').BrowserWindow.fromWebContents(win.webContents); const cb = win.getContentBounds(); const vv = win.contentView.children.find((c) => c.webContents === vt); const b = vv ? vv.getBounds() : null; return b && b.x === 0 && b.y === 0 && b.width === cb.width && b.height === cb.height; };
  await vfsOn(); await sleep(1500);
  out.push((win.isFullScreen() ? 'PASS' : 'FAIL') + ' a video going full screen makes the window full screen');
  out.push((fills() ? 'PASS' : 'FAIL') + ' and the video fills the whole window, not just the browser area');
  await vfsOff(); await sleep(1500);
  out.push((!win.isFullScreen() ? 'PASS' : 'FAIL') + ' leaving the video\'s full screen leaves the window full screen too (Regis wasn\'t full screen before)');
  out.push((!fills() ? 'PASS' : 'FAIL') + ' and the page goes back into the browser area');
  win.setFullScreen(true); await sleep(1500); await vfsOn(); await sleep(1500); await vfsOff(); await sleep(1500);
  out.push((win.isFullScreen() ? 'PASS' : 'FAIL') + ' when Regis was already full screen, leaving the video\'s full screen keeps Regis full screen');
  await reset();
  out.forEach((l) => console.log(l)); const nf = out.filter((l) => /^FAIL/.test(l)).length;
  console.log((out.length - nf) + ' passed, ' + nf + ' failed'); srv.close(); app.exit(nf ? 1 : 0);
});
