// Run with: xvfb-run -a npx electron --no-sandbox test/browser.test.js
const { app, BrowserWindow, ipcMain } = require('electron'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'regis-bw-')));
const { BrowserHost, resolveInput, hostBlocked, keyAction, secureUrl, isSignIn, firefoxUA } = require('../lib/browser');
const creds = [];
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await sleep(60); } return false; };
const srv = http.createServer((q, r) => {
  r.setHeader('content-type', 'text/html');
  if (q.url === '/a') r.end('<title>Page A</title><a id=l href="/b">go</a><img src="http://x.doubleclick.net/p.png"><p id=n>' + 'x' + '</p>');
  else if (q.url === '/b') r.end('<title>Page B</title>b');
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
  const win = new BrowserWindow({ width: 1200, height: 800, show: false }); await win.loadURL('data:text/html,<body>shell</body>');
  const states = []; win.webContents.executeJavaScript('0');
  const host = new BrowserHost({ getWin: () => win, onCred: (c) => creds.push(c), onPersist: (u) => { host._persisted = u; } });
  ipcMain.on('bw:cred', (e, d) => host.cred(e.sender, d));
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
  host.show(false); ok(host.attached === null && !win.contentView.children.some((c) => host.tabs.some((t) => t.view === c)), 'hiding removes the view (so Regis dialogs can show)');
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
  // Google sign-in: Regis presents itself as Firefox on Google's sign-in pages only, so Google doesn't call it an insecure embedded browser
  ok(isSignIn('https://accounts.google.com/v3/signin') && isSignIn('https://accounts.youtube.com/x') && !isSignIn('https://www.google.com/') && !isSignIn('https://accounts.google.com.evil.com/') && !isSignIn('http://accounts.google.com/'), 'only https Google sign-in pages get the sign-in identity');
  ok(/^Mozilla\/5\.0 \([^)]*rv:(\d+)\.0\) Gecko\/20100101 Firefox\/\1\.0$/.test(host.ffUa) && !/Chrome|Electron|Safari/.test(host.ffUa), 'sign-in identity is a consistent Firefox one (' + host.ffUa + ')');
  ok(firefoxUA('Mozilla/5.0 (X) Chrome/142.0.0.0 Safari/537.36', 'win32').includes('Firefox/144.0'), 'Firefox version follows the engine version');
  const sent = []; host.ses.webRequest.onSendHeaders({ urls: ['https://accounts.google.com/*'] }, (d) => { if (d.resourceType === 'mainFrame') sent.push(d.requestHeaders); });
  const g = host.open('https://accounts.google.com/signin'); const gt = host._tab(g);
  const loaded = await until(() => gt.view && !gt.loading && /accounts\.google\.com/.test(gt.url) && sent.length > 0, 15000);
  if (!loaded) console.log('SKIP live Google sign-in check (no internet?)');
  else {
    const gwc = gt.view.webContents; await sleep(500);
    const fp = await gwc.executeJavaScript("JSON.stringify({ua:navigator.userAgent,uad:'userAgentData' in navigator})");
    const j = JSON.parse(fp), h = sent[sent.length - 1], hk = Object.keys(h).map((k) => k.toLowerCase());
    ok(/Firefox\//.test(j.ua) && !/Chrome|Electron/.test(j.ua), 'Google sign-in page sees Firefox in navigator.userAgent');
    ok(j.uad === false, 'Google sign-in page sees no navigator.userAgentData (like real Firefox)');
    ok(/Firefox\//.test(h['User-Agent'] || '') && !hk.some((k) => k.startsWith('sec-ch-ua')), 'requests to Google sign-in carry Firefox UA and no Chrome client hints');
    host.go(g, base + '/a'); ok(await until(() => gt.title === 'Page A'), 'leaving Google sign-in works');
    const back = JSON.parse(await gwc.executeJavaScript("JSON.stringify({ua:navigator.userAgent,uad:'userAgentData' in navigator})"));
    ok(/Chrome\//.test(back.ua) && !/Firefox|Electron/.test(back.ua) && back.uad === true, 'other sites see the normal Chrome identity again');
  }
  host.destroy(); srv.close(); console.log(pass + ' passed, ' + fail + ' failed'); app.exit(fail ? 1 : 0);
});
