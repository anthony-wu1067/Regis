// Run with: xvfb-run -a npx electron --no-sandbox test/browser.test.js
const { app, BrowserWindow, ipcMain } = require('electron'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'regis-bw-')));
const { BrowserHost, resolveInput, hostBlocked, keyAction, secureUrl, isSignIn } = require('../lib/browser');
const creds = [];
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await sleep(60); } return false; };
const srv = http.createServer((q, r) => {
  r.setHeader('content-type', 'text/html');
  if (q.url === '/a') r.end('<title>Page A</title><a id=l href="/b">go</a><img src="http://x.doubleclick.net/p.png"><p id=n>' + 'x' + '</p>');
  else if (q.url === '/b') r.end('<title>Page B</title>b');
  else if (q.url === '/words') r.end('<title>Words</title><p>apple banana apple cherry apple</p>');
  else if (q.url === '/up') r.end('<title>Upload</title><input id=f type=file multiple><script>document.getElementById("f").addEventListener("change",function(){document.title="got:"+[].map.call(this.files,function(x){return x.name+"/"+x.size}).join(",")})</script>');
  else if (q.url === '/file.txt') { r.setHeader('content-type', 'text/plain'); r.setHeader('content-disposition', 'attachment; filename="notes.txt"'); r.end('hello regis'); return; }
  else if (q.url === '/login') r.end('<title>Login</title><form id=f onsubmit="return false"><input id=u name=username type=text><input id=p type=password></form><input id=hid type=password style="display:none">');
  else r.end('<title>Other</title>');
});
app.whenReady().then(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  // address-bar logic
  ok(resolveInput('example.com') === 'https://example.com', 'domain gets https');
  ok(resolveInput('https://a.b/c?d=1') === 'https://a.b/c?d=1', 'full URL kept');
  ok(/^https:\/\/www\.google\.com\/search\?q=hello%20world$/.test(resolveInput('hello world')), 'words become a Google search');
  ok(resolveInput('localhost:3000/x') === 'http://localhost:3000/x', 'localhost allowed');
  ok(/google\.com\/search/.test(resolveInput('javascript:alert(1)')) && /google\.com\/search/.test(resolveInput('file:///etc/passwd')), 'javascript: and file: never navigate');
  ok(resolveInput('') === '', 'empty stays empty');
  ok(hostBlocked('x.doubleclick.net') && !hostBlocked('google.com') && !hostBlocked('notdoubleclick.net'), 'shield host matching');
  const win = new BrowserWindow({ width: 1200, height: 800, show: true }); await win.loadURL('data:text/html,<body>shell</body>');
  const states = []; win.webContents.executeJavaScript('0');
  const finds = [], picks = [], hist = []; const host = new BrowserHost({ getWin: () => win, onCred: (c) => creds.push(c), onPersist: (u) => { host._persisted = u; }, onFind: (r) => finds.push(r), onFilePick: (r) => picks.push(r), onHistory: (h) => hist.push(h) });
  ipcMain.on('bw:cred', (e, d) => host.cred(e.sender, d));
  ipcMain.on('bw:filepick', (e, d) => host.filePick(e.sender, d));
  host.init();
  const a = host.open(''); ok(host.snapshot().tabs.length === 1 && host.snapshot().tabs[0].blank, 'new tab starts blank (start page)');
  host.show(true); host.setBounds({ x: 60, y: 120, width: 900, height: 600 }); ok(host.attached === null, 'blank tab attaches no web view');
  host.go(a, base + '/a'); ok(await until(() => host.snapshot().tabs[0].title === 'Page A'), 'page loads and title is read');
  ok(host.attached !== null && win.contentView.children.length >= 1 && win.contentView.children.includes(host.attached), 'web view is laid over the stage');
  const b0 = host.attached.getBounds(); ok(b0.x === 60 && b0.y === 120 && b0.width === 900 && b0.height === 600, 'view follows the stage bounds');
  ok(await until(() => host.blocked >= 1), 'ad/tracker request blocked and counted by the shield (' + host.blocked + ')');
  host.setShield(false); const before = host.blocked; host.reload(a); await sleep(800); ok(host.blocked === before, 'shield off lets requests through uncounted');
  host.setShield(true);
  const wc = host.tabs[0].view.webContents;
  ok(await wc.executeJavaScript('typeof require + "|" + typeof process + "|" + typeof window.regisBridge') === 'undefined|undefined|undefined', 'sites cannot reach Node or Regis');
  ok(!/Electron\//.test(await wc.executeJavaScript('navigator.userAgent')), 'user agent looks like Chrome (needed for Google sign-in)');
  host.go(a, base + '/b'); ok(await until(() => host.snapshot().tabs[0].title === 'Page B'), 'navigate to another page');
  ok(await until(() => host.snapshot().tabs[0].canBack), 'back becomes available'); host.back(a);
  ok(await until(() => host.snapshot().tabs[0].title === 'Page A'), 'back works');
  ok(await until(() => host.snapshot().tabs[0].canFwd), 'forward becomes available'); host.forward(a);
  ok(await until(() => host.snapshot().tabs[0].title === 'Page B'), 'forward works');
  await wc.executeJavaScript("window.open('/other')", true); ok(await until(() => host.tabs.length === 2), 'window.open opens a new tab inside Regis'); 
  ok(host.active === host.tabs[1].id, 'new tab becomes active');
  host.activate(a); ok(host.active === a && host.attached === host.tabs[0].view, 'switching tabs swaps the view');
  const shot = await host.show(false); ok(host.attached === null && host.tabs.every((t) => !t.view || t.vis === false), 'hiding makes the page invisible (so Regis dialogs can show)'); ok(/^data:image\/jpeg;base64,/.test(shot.snap || ''), 'hiding hands Regis a snapshot of the page to show meanwhile (no blank flash)');
  host.show(true);
  ok(await until(() => Array.isArray(host._persisted), 4000) && Array.isArray(host._persisted) && host._persisted.length >= 1 && host._persisted.every((u) => /^https?:/.test(u)), 'open tabs are remembered');
  // password manager: detect a login form, fill it, and notice a submitted login
  host.go(a, base + '/login'); ok(await until(() => host.snapshot().tabs[0].title === 'Login'), 'login page loads');
  ok(await until(() => host.snapshot().tabs[0].login === true, 5000), 'a visible password field is noticed (hidden ones are ignored)');
  const fr = await host.fill(a, 'sam@example.com', 's3cret!'); const lwc = host.tabs[0].view.webContents;
  ok(fr.user && fr.pass && await lwc.executeJavaScript('document.getElementById("u").value + "|" + document.getElementById("p").value') === 'sam@example.com|s3cret!', 'autofill puts the username and password in the form');
  ok(await lwc.executeJavaScript('document.getElementById("hid").value') === '', 'autofill leaves hidden password fields alone');
  await lwc.executeJavaScript('document.getElementById("f").requestSubmit()', true);
  ok(await until(() => creds.length === 1), 'submitting a login reports it to Regis');
  ok(creds[0] && creds[0].host === '127.0.0.1' && creds[0].user === 'sam@example.com' && creds[0].pass === 's3cret!', 'the report has host, username and password');
  ok(await lwc.executeJavaScript('typeof window.ipcRenderer + typeof require') === 'undefinedundefined', 'the page still cannot see the preload');
  // shortcuts, zoom, error page, secure-only autofill
  ok(keyAction({ type: 'keyDown', key: 't', control: true }) === 'newtab' && keyAction({ type: 'keyDown', key: 'l', meta: true }) === 'addr' && keyAction({ type: 'keyDown', key: 'Tab', control: true, shift: true }) === 'prevtab' && keyAction({ type: 'keyDown', key: 'ArrowLeft', alt: true }) === 'back' && keyAction({ type: 'keyUp', key: 't', control: true }) === null && keyAction({ type: 'keyDown', key: 'a' }) === null, 'shortcut keys map to actions');
  ok(secureUrl('https://a.com') && secureUrl('http://localhost:3000/x') && secureUrl('http://127.0.0.1/') && !secureUrl('http://a.com') && !secureUrl('http://localhost.evil.com/'), 'autofill is allowed only on https or this computer');
  const keys = []; host.onKey = (k) => keys.push(k); ok(host.key('newtab', host.active) === true && keys[0] === 'newtab', 'new-tab shortcut is passed to Regis');
  host.key('zoomin', host.active); ok(host.tabs[0].view.webContents.getZoomLevel() === 0.5, 'zoom in works'); host.key('zoom0', host.active); ok(host.tabs[0].view.webContents.getZoomLevel() === 0, 'zoom resets');
  host.open(base + '/a'); host.open(base + '/b'); const n0 = host.tabs.length; const act0 = host.active; host.key('nexttab'); ok(host.active !== act0 && host.tabs.length === n0, 'next-tab shortcut switches tabs');
  const dead = host.open('http://127.0.0.1:9/nothing'); ok(await until(() => { const t = host.snapshot().tabs.find((x) => x.id === dead); return t && /reach/.test(t.title); }, 6000), 'an unreachable page shows a friendly error page');
  ok(host.snapshot().tabs.find((x) => x.id === dead).url === 'http://127.0.0.1:9/nothing', 'the address bar keeps the real address on the error page');
  host.close(dead); host.tabs.slice(2).forEach((t) => host.close(t.id));
  host.close(host.tabs[1].id); ok(host.tabs.length === 1, 'tab closes');
  host.close(a); ok(host.tabs.length === 1 && host.snapshot().tabs[0].blank, 'closing the last tab leaves a fresh blank one');
  host.restore([base + '/a', base + '/b']); ok(host.tabs.length === 1, 'restore does nothing once tabs exist');
  // Google sign-in: one plain Chrome identity everywhere, plus the window.chrome object real Chrome has
  ok(isSignIn('https://accounts.google.com/v3/signin') && !isSignIn('https://www.google.com/') && !isSignIn('https://accounts.google.com.evil.com/') && !isSignIn('http://accounts.google.com/'), 'sign-in page detection');
  host.go(host.active, base + '/a'); await until(() => host.snapshot().tabs.find((x) => x.id === host.active).title === 'Page A');
  const lwc2 = host._tab(host.active).view.webContents;
  const loc = JSON.parse(await lwc2.executeJavaScript("JSON.stringify({chrome:typeof window.chrome,keys:window.chrome?Object.keys(window.chrome).sort():[],nat:Function.prototype.toString.call(window.chrome.loadTimes),ts:Function.prototype.toString.call(Function.prototype.toString),own:(function x(){return 1}).toString(),lt:typeof window.chrome.loadTimes().requestTime})"));
  ok(loc.chrome === 'object' && loc.keys.join() === 'app,csi,loadTimes,runtime', 'pages get window.chrome with app, csi, loadTimes and runtime');
  ok(/\[native code\]/.test(loc.nat) && /\[native code\]/.test(loc.ts) && /return 1/.test(loc.own) && loc.lt === 'number', 'those functions look built-in, and normal functions still show their own source');
  const sent = []; host.ses.webRequest.onSendHeaders({ urls: ['https://accounts.google.com/*'] }, (d) => { if (d.resourceType === 'mainFrame') sent.push(d.requestHeaders); });
  const gone = []; app.on('render-process-gone', (_e, _w, d) => gone.push(d.reason)); app.on('child-process-gone', (_e, d) => gone.push(d.type + ':' + d.reason));
  const g = host.open('https://docs.google.com/document/u/0/'); const gt = host._tab(g);
  const loaded = await until(() => gt.view && !gt.loading && /accounts\.google\.com/.test(gt.url) && sent.length > 0, 20000);
  if (!loaded) console.log('SKIP live Google check (no internet?)');
  else {
    ok(gone.length === 0, 'opening Google Docs (which redirects to sign-in) does not crash anything');
    const j = JSON.parse(await gt.view.webContents.executeJavaScript("JSON.stringify({ua:navigator.userAgent,chrome:typeof window.chrome,keys:window.chrome?Object.keys(window.chrome).length:0,vendor:navigator.vendor,wd:navigator.webdriver})"));
    ok(/Chrome\/\d+/.test(j.ua) && !/Electron|regis/i.test(j.ua) && j.vendor === 'Google Inc.' && j.wd === false, 'Google sign-in page sees plain Chrome (' + j.ua.replace(/^.*\) /, '') + ')');
    ok(j.chrome === 'object' && j.keys >= 4, 'Google sign-in page sees a full window.chrome');
    ok(!/Electron|regis/i.test(sent[sent.length - 1]['User-Agent'] || ''), 'requests to Google carry no Electron or app name');
  }
  // 1.8.2 engine: tab order, duplicate, reopen, mute, find, history, sleeping tabs, downloads, Easy Files, shortcuts
  ok(keyAction({ type: 'keyDown', key: 't', control: true, shift: true }) === 'reopen' && keyAction({ type: 'keyDown', key: 'f', control: true }) === 'find' && keyAction({ type: 'keyDown', key: '2', control: true }) === 'tab2' && keyAction({ type: 'keyDown', key: 'm', alt: true }) === 'view-m' && keyAction({ type: 'keyDown', key: 'q', alt: true }) === null, 'new shortcuts: Ctrl+Shift+T, Ctrl+F, Ctrl+1-9, Alt+page letter (other Alt keys stay with the site)');
  const t1 = host.tabs[0].id; host.go(t1, base + '/a'); await until(() => host._tab(t1).title === 'Page A');
  const t2 = host.open(base + '/b'), t3 = host.open(base + '/words'); await until(() => host._tab(t3).title === 'Words');
  host.move(t3, 0); ok(host.tabs[0].id === t3, 'a tab can be moved to another position');
  const d = host.duplicate(t2); await until(() => host._tab(d) && host._tab(d).title === 'Page B'); ok(host.tabs.findIndex((x) => x.id === d) === host.tabs.findIndex((x) => x.id === t2) + 1, 'duplicate opens a copy right after the tab');
  host.close(d); const back = host.reopen(); ok(back && /\/b$/.test(host._tab(back).url), 'Ctrl+Shift+T brings back the closed tab');
  ok(host.mute(t2, true) === true && host._tab(t2).muted && host.tabs[0].view.webContents.isAudioMuted() === false && host._tab(t2).view.webContents.isAudioMuted(), 'a tab can be muted on its own');
  host.activate(t3); host.find(t3, 'apple'); ok(await until(() => finds.some((r) => r.tab === t3 && r.matches === 3)), 'find in page counts the matches (3)');
  host.find(t3, 'apple', { next: true }); host.stopFind(t3);
  ok(hist.some((h) => /\/words$/.test(h.u)), 'visited pages are recorded for history and suggestions');
  host.activate(t1); host._tab(t2).last = Date.now() - 3600e3; host.sleepMin = 30; const n = host._sleepIdle();
  ok(n >= 1 && host._tab(t2).asleep && !host._tab(t2).view && host.snapshot().tabs.find((x) => x.id === t2).asleep, 'an unused tab goes to sleep and frees its memory');
  host.activate(t2); ok(!!host._tab(t2).view && !host._tab(t2).asleep, 'opening a sleeping tab wakes it'); ok(await until(() => host._tab(t2).title === 'Page B'), 'and it reloads its page');
  host.sleepMin = 0;
  // downloads
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regis-dl-')); const { Downloads } = require('../lib/downloads'); const done = [];
  const dl = new Downloads({ dir, onDone: (x) => done.push(x) }); dl.attach(host.ses);
  host._wc(t1).downloadURL(base + '/file.txt'); ok(await until(() => done.length === 1, 8000), 'a download finishes');
  const fl = dl.list()[0]; ok(fl && fl.name === 'notes.txt' && fs.readFileSync(fl.path, 'utf8') === 'hello regis' && path.dirname(fl.path) === dir, 'it is saved to the downloads folder under its own name');
  host._wc(t1).downloadURL(base + '/file.txt'); await until(() => done.length === 2, 8000); ok(dl.list()[0].name === 'notes (1).txt', 'a second copy does not overwrite the first');
  // Easy Files: the site's file box asks Regis first, then gets exactly the picked file
  const tu = host.open(base + '/up'); await until(() => host._tab(tu).title === 'Upload'); await sleep(300);
  await host._wc(tu).executeJavaScript('document.getElementById("f").click()', true);
  ok(await until(() => picks.some((r) => r.tab === tu && r.multiple === true)), "opening a site's upload box asks Regis first (Easy Files)");
  const pk = picks.find((r) => r.tab === tu), f = dl.read(fl.id);
  pk.wc.send('bw:files', { token: pk.token, files: [{ name: f.name, type: f.type, data: new Uint8Array(f.data) }] });
  ok(await until(() => host._tab(tu).title === 'got:notes.txt/11'), 'the picked download lands in the site\'s upload box (' + host._tab(tu).title + ')');
  host.destroy(); srv.close(); console.log(pass + ' passed, ' + fail + ' failed'); app.exit(fail ? 1 : 0);
});
