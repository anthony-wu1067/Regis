// Chrome extensions in the Regis Browser, with a real extension (Dark Reader) from the Chrome Web Store. Skips when offline.
// Run: node_modules/electron/dist/electron test/extensions.test.js
const { app, BrowserWindow, webContents, net } = require('electron'); const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'regis-ext-')));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch (_) {} await sleep(200); } return false; };
const DR = 'eimadpbcbfnmbkopoojfekhnkhdbieeh';
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<title>Plain</title><body style="background:#fff;color:#000"><h1>Plain page</h1></body>'); });
require(path.join(__dirname, '..', 'main.js'));
app.whenReady().then(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const online = await net.fetch('https://clients2.google.com/generate_204').then((r) => r.status < 400).catch(() => false);
  let win; for (let i = 0; i < 450 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())); await sleep(100); }
  if (!online) { console.log('SKIP offline'); console.log('0 passed, 0 failed'); app.exit(0); return; }
  win.setSize(1300, 840); win.show(); await sleep(3500);
  const J = (c) => win.webContents.executeJavaScript('(async()=>{' + c + '})()', true);
  const tabWc = (re) => webContents.getAllWebContents().find((w) => re.test(w.getURL()));
  await J('document.querySelector(\'#vsw [data-v="browser"]\').click()'); await sleep(1500);
  ok(await J('return !document.getElementById("bw-extb").hidden'), 'the toolbar has an Extensions (puzzle) button');
  await J('document.getElementById("bw-extb").click()'); await sleep(400);
  ok(await J('return /Manage extensions/.test(document.getElementById("bw-bmpop").textContent)'), 'it opens a menu with Manage extensions and the Chrome Web Store');
  await J('document.querySelector(\'#bw-bmpop [data-act="ext-manage"]\').click()'); await sleep(500);
  ok(await J('return !!document.getElementById("ext-link")&&!document.getElementById("modal").hidden'), 'Manage extensions opens, with a box for a Web Store link');
  await J('document.getElementById("ext-link").value="https://chromewebstore.google.com/detail/dark-reader/' + DR + '";document.querySelector("form[data-ext-form]").requestSubmit()');
  ok(await until(() => J('return /Dark Reader/.test(document.getElementById("ext-man").textContent)'), 60000), 'pasting the Web Store link installs Dark Reader');
  ok(await J('return !document.querySelector(\'#bw-exts [data-id="' + DR + '"]\')&&!document.getElementById("bw-extb").hidden'), 'a new extension does not put an icon in the toolbar by itself (only the puzzle button shows)');
  await J('document.getElementById("bw-extb").click()'); await sleep(400);
  ok(await J('var p=document.querySelector(\'#bw-bmpop [data-act="ext-pin"][data-id="' + DR + '"]\');return !!p&&p.getAttribute("aria-pressed")==="false"'), 'the Extensions menu lists it with a pin that is off');
  await J('document.querySelector(\'#bw-bmpop [data-act="ext-pin"][data-id="' + DR + '"]\').click()'); await sleep(400);
  ok(await J('return !!document.querySelector(\'#bw-exts [data-id="' + DR + '"]\')&&JSON.parse(localStorage.getItem("regis-extpin"))["' + DR + '"]===1&&document.querySelector(\'#bw-bmpop [data-act="ext-pin"][data-id="' + DR + '"]\').getAttribute("aria-pressed")==="true"'), 'pinning it shows its icon in the toolbar, and Regis remembers');
  await J('document.querySelector(\'#bw-bmpop [data-act="ext-pin"][data-id="' + DR + '"]\').click()'); await sleep(400);
  ok(await J('return !document.querySelector(\'#bw-exts [data-id="' + DR + '"]\')'), 'unpinning hides the icon again (the extension keeps working)');
  await J('document.querySelector(\'#bw-bmpop [data-act="ext-pin"][data-id="' + DR + '"]\').click()'); await sleep(300); await J('document.getElementById("bw-extb").click()'); await sleep(300);
  ok(fs.existsSync(path.join(app.getPath('userData'), 'extensions', DR, 'manifest.json')), 'it is stored in Regis\'s data folder');
  await J('var b=document.querySelector(\'#modal [data-act="modal-close"]\');if(b)b.click()'); await sleep(500);
  await J('var a=document.getElementById("bw-addr");a.value=' + JSON.stringify(base + '/plain') + ';document.getElementById("bw-form").requestSubmit()');
  let tab; ok(await until(async () => { tab = tabWc(/\/plain$/); return tab && await tab.executeJavaScript('!!document.querySelector("style.darkreader")'); }), 'it works on web pages (the page is dark)');
  ok(tab && /rgb\(\s*(\d|[1-5]\d),/.test(await tab.executeJavaScript('getComputedStyle(document.body).backgroundColor')), 'the white page now has a dark background');
  // the toolbar button opens its popup, which knows the open tab
  await J('document.querySelector(\'#bw-exts [data-id="' + DR + '"]\').click()');
  let pop; ok(await until(() => { pop = webContents.getAllWebContents().find((w) => w.getURL().indexOf('chrome-extension://' + DR + '/') === 0 && /popup/.test(w.getURL())); return !!pop; }), 'pressing its icon opens the Dark Reader popup (with its Web Store id)');
  ok(pop && await until(async () => /127\.0\.0\.1/.test(await pop.executeJavaScript('document.body.innerText'))), 'the popup knows which site is open in the tab');
  if (pop) { const bw = BrowserWindow.fromWebContents(pop); if (bw && !bw.isDestroyed()) bw.close(); } await sleep(400);
  // off: no longer applied after reload
  await J('document.getElementById("bw-extb").click()'); await sleep(300);
  await J('document.querySelector(\'#bw-bmpop [data-act="ext-on"][data-id="' + DR + '"]\').click()'); await sleep(1200);
  ok(await J('return !document.querySelector(\'#bw-exts [data-id="' + DR + '"]\')'), 'turning it off takes it out of the toolbar');
  tab.reload(); await sleep(2500);
  ok(!(await tab.executeJavaScript('!!document.querySelector("style.darkreader")')), 'and pages are left alone');
  // Web Store page: Add to Regis button
  await J('var a=document.getElementById("bw-addr");a.value="https://chromewebstore.google.com/detail/google-translate/aapbdbdomjkkjkaonfhkkikfgjllcleb";document.getElementById("bw-form").requestSubmit()');
  ok(await until(() => J('var b=document.getElementById("bw-extadd");return !b.hidden&&b.textContent==="Add to Regis"')), 'a Chrome Web Store page shows "Add to Regis"');
  await J('document.getElementById("bw-extadd").click()');
  ok(await until(() => J('return (await window.regisBridge.ext.list()).some(function(e){return e.id==="aapbdbdomjkkjkaonfhkkikfgjllcleb"})'), 60000) && await J('return !document.querySelector(\'#bw-exts [data-id="aapbdbdomjkkjkaonfhkkikfgjllcleb"]\')'), 'pressing it installs that extension, without adding a toolbar icon');
  ok(await until(() => J('var b=document.getElementById("bw-extadd");return b.disabled&&/Added/.test(b.textContent)')), 'the button then says Added to Regis');
  // remove
  await J('window.confirm=function(){return true}');
  await J('document.getElementById("bw-extb").click()'); await sleep(300); await J('document.querySelector(\'#bw-bmpop [data-act="ext-manage"]\').click()'); await sleep(500);
  await J('document.querySelector(\'#ext-man [data-act="ext-rm"][data-id="' + DR + '"]\').click()');
  ok(await until(() => J('return !/Dark Reader/.test(document.getElementById("ext-man").textContent)')), 'Remove uninstalls it');
  ok(!fs.existsSync(path.join(app.getPath('userData'), 'extensions', DR)), 'and deletes its files');
  // websites can't ask for Regis's tabs
  ok(await tab.executeJavaScript('typeof window.__regisTabs==="undefined"&&typeof window.__regisExt==="undefined"'), 'web pages don\'t get the extension helpers');
  console.log(pass + ' passed, ' + fail + ' failed'); srv.close(); app.exit(fail ? 1 : 0);
});
