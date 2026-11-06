// Browser page (tabs, menus, shortcuts, find, downloads, Easy Files, history, suggestions, sleep), the page navigator, the Office page,
// priority colours and in-app links, in the real Regis app with throwaway folders.
// Run: node_modules/electron/dist/electron test/tabs.test.js   (on Linux CI: xvfb-run -a ... --no-sandbox)
const { app, BrowserWindow, webContents } = require('electron'); const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'regis-tabs-'));
['userData', 'downloads', 'documents', 'desktop'].forEach((k) => { const d = path.join(T, k); fs.mkdirSync(d, { recursive: true }); app.setPath(k, d); });
['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'].forEach((k) => { delete process.env[k]; });
fs.writeFileSync(path.join(T, 'documents', 'Budget 2026.xlsx'), 'x'); fs.writeFileSync(path.join(T, 'documents', 'Essay.docx'), 'x'); fs.writeFileSync(path.join(T, 'desktop', 'Pitch.pptx'), 'x');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch (_) {} await sleep(120); } return false; };
const srv = http.createServer((q, r) => {
  if (q.url === '/file.txt') { r.setHeader('content-type', 'text/plain'); r.setHeader('content-disposition', 'attachment; filename="notes.txt"'); r.end('hello regis'); return; }
  r.setHeader('content-type', 'text/html; charset=utf-8');
  if (q.url === '/words') r.end('<title>Words</title><p>apple banana apple cherry apple</p>');
  else if (q.url === '/up') r.end('<title>Upload</title><input id=f type=file><script>document.getElementById("f").addEventListener("change",function(){document.title="got:"+[].map.call(this.files,function(x){return x.name+"/"+x.size}).join(",")})</script>');
  else r.end('<title>Page ' + q.url.slice(1) + '</title><h1>' + q.url + '</h1>');
});
require(path.join(__dirname, '..', 'main.js'));
app.whenReady().then(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  let win; for (let i = 0; i < 450 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())); await sleep(100); }
  win.setSize(1360, 880); win.show();
  const J = (c) => win.webContents.executeJavaScript('(async()=>{' + c + '})()', true);
  const click = (sel) => J('var b=document.querySelector(' + JSON.stringify(sel) + ');if(!b)return false;b.click();return true');
  const tabsOrder = () => J('return [].map.call(document.querySelectorAll("#bw-tabs .bw-tab"),function(t){return t.querySelector("span").textContent})');
  const tabWc = (re) => webContents.getAllWebContents().find((w) => re.test(w.getURL()));
  const go = async (u) => { await J('var a=document.getElementById("bw-addr");a.value=' + JSON.stringify(u) + ';document.getElementById("bw-form").requestSubmit()'); await until(() => { const w = tabWc(new RegExp(u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')); return w && !w.isLoading(); }); await sleep(500); };
  await sleep(3500);
  // navigator
  ok(await J('return document.querySelectorAll("#vsw [data-act=view]").length===5&&!!document.querySelector(\'#vsw [data-v="office"]\')'), 'the page switcher lists all five pages, Office included');
  await click('#vsw [data-v="browser"]'); await sleep(1500);
  await go(base + '/a'); await J('document.querySelector(\'[data-act="bw-new"]\').click()'); await sleep(400); await go(base + '/b'); await J('document.querySelector(\'[data-act="bw-new"]\').click()'); await sleep(400); await go(base + '/words');
  ok((await tabsOrder()).join('|') === 'Page a|Page b|Words', 'three tabs open (' + (await tabsOrder()).join(', ') + ')');
  ok(await J('return !document.querySelector("#bw-tabs .bw-tab .g")&&document.querySelector("#bw-tabs .bw-tab").getAttribute("draggable")==="true"'), 'tabs are draggable and the group button is gone');
  // drag "Words" before "Page a"
  await J('var ts=document.querySelectorAll("#bw-tabs .bw-tab"),src=ts[2],dst=ts[0],dt=new DataTransfer(),r=dst.getBoundingClientRect();src.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:dt}));dst.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,clientX:r.left+4,clientY:r.top+8,dataTransfer:dt}));dst.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,clientX:r.left+4,clientY:r.top+8,dataTransfer:dt}));src.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:dt}))');
  ok(await until(async () => (await tabsOrder()).join('|') === 'Words|Page a|Page b'), 'dragging a tab moves it (' + (await tabsOrder()).join(', ') + ')');
  // right-click menu, make a group, drag another tab into it
  await J('var t=document.querySelectorAll("#bw-tabs .bw-tab")[1],r=t.getBoundingClientRect();t.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+10}))'); await sleep(300);
  ok(await J('var p=document.getElementById("bw-bmpop");return !p.hidden&&["Duplicate","Mute tab","Add to group","Close other tabs","Close tabs to the right","Reopen closed tab"].every(function(x){return p.textContent.indexOf(x)>=0})'), 'right-clicking a tab opens the tab menu');
  await click('#bw-bmpop [data-act="bwt-grp"]'); await sleep(200); await click('#bw-bmpop [data-act="bwt-newg"]'); await sleep(300);
  await J('document.getElementById("tg-name").value="Research";document.querySelector(\'form[data-vt-form="tgrp"]\').requestSubmit()'); await sleep(500);
  ok(await J('return /Research/.test(document.getElementById("bw-tabs").textContent)'), 'Add to group > New group makes a group');
  await J('var ts=document.querySelectorAll("#bw-tabs .bw-tab"),src=[].find.call(ts,function(t){return /Page b/.test(t.textContent)}),gh=document.querySelector("#bw-tabs .bw-gh"),dt=new DataTransfer();src.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:dt}));gh.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:dt}));gh.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:dt}));src.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:dt}))');
  ok(await until(() => J('var tg=JSON.parse(localStorage.getItem("regis-tg"));return Object.keys(tg.m).length===2')), 'dragging a tab onto a group name adds it to the group');
  // duplicate from the menu
  const n0 = await J('return document.querySelectorAll("#bw-tabs .bw-tab").length');
  await J('var t=[].find.call(document.querySelectorAll("#bw-tabs .bw-tab"),function(x){return /Words/.test(x.textContent)}),r=t.getBoundingClientRect();t.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+10}))'); await sleep(250); await click('#bw-bmpop [data-act="bwt-dup"]');
  ok(await until(() => J('return document.querySelectorAll("#bw-tabs .bw-tab").length===' + (n0 + 1))), 'Duplicate opens a copy of the tab');
  // panels over the page show a snapshot instead of a blank
  await J('var t=[].find.call(document.querySelectorAll("#bw-tabs .bw-tab"),function(x){return /Words/.test(x.textContent)});t.click()'); await sleep(800);
  await click('[data-act="bw-menu"]');
  ok(await until(() => J('var s=document.getElementById("bw-snap");return !s.hidden&&/^data:image\\/jpeg/.test(s.src)')), 'while a menu covers the page, a snapshot of it shows underneath (no blank flash)');
  await J('document.body.click()'); await sleep(400);
  // find in page
  await J('document.dispatchEvent(new KeyboardEvent("keydown",{key:"f",ctrlKey:true,bubbles:true}))'); await sleep(300);
  ok(await J('return !document.getElementById("bw-find").hidden'), 'Ctrl+F opens the find bar');
  await J('var q=document.getElementById("bw-fq");q.value="apple";q.dispatchEvent(new Event("input",{bubbles:true}))');
  ok(await until(() => J('return /of 3/.test(document.getElementById("bw-fn").textContent)')), 'find counts matches (' + await J('return document.getElementById("bw-fn").textContent') + ')');
  await J('document.getElementById("bw-fq").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'); await sleep(200);
  ok(await J('return document.getElementById("bw-find").hidden'), 'Esc closes it');
  // downloads panel
  tabWc(/\/words$/).downloadURL(base + '/file.txt');
  ok(await until(() => J('return regisApp.downloads.list().then(function(l){return l.length===1&&l[0].state==="completed"})')), 'a download completes into the Downloads folder');
  await J('document.dispatchEvent(new KeyboardEvent("keydown",{key:"j",ctrlKey:true,bubbles:true}))'); await sleep(400);
  ok(await J('var p=document.getElementById("bw-bmpop");return !p.hidden&&/notes\\.txt/.test(p.textContent)&&!!p.querySelector(\'[data-act="dl-open"]\')'), 'Ctrl+J shows Downloads with Open and Show in folder');
  await J('document.body.click()'); await sleep(300);
  // Easy Files on a website
  await J('document.querySelector(\'[data-act="bw-new"]\').click()'); await sleep(400); await go(base + '/up');
  await tabWc(/\/up$/).executeJavaScript('document.getElementById("f").click()', true);
  ok(await until(() => J('var m=document.getElementById("modal");return !m.hidden&&/Upload to/.test(document.getElementById("mdl-t").textContent)&&/notes\\.txt/.test(m.textContent)')), 'a website’s upload box opens Regis’s picker with recent downloads');
  await click('#mdl-b [data-act="ef-pick"]'); await click('#mdl-b [data-act="ef-use"]');
  ok(await until(() => Promise.resolve(tabWc(/\/up$/).getTitle() === 'got:notes.txt/11')), 'the chosen download is uploaded to the site');
  // history and suggestions
  await J('document.dispatchEvent(new KeyboardEvent("keydown",{key:"h",ctrlKey:true,bubbles:true}))'); await sleep(500);
  ok(await until(() => J('return /Words/.test(document.getElementById("hi-l").textContent)&&/Page a/.test(document.getElementById("hi-l").textContent)')), 'Ctrl+H lists visited pages');
  await click('[data-act="modal-close"]'); await sleep(300);
  await J('var a=document.getElementById("bw-addr");a.focus();a.value="wor";a.dispatchEvent(new Event("input",{bubbles:true}))');
  ok(await until(() => J('var s=document.getElementById("bw-sug");return !s.hidden&&/Words/.test(s.textContent)')), 'typing in the address bar suggests pages from history');
  await J('var a=document.getElementById("bw-addr");a.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));a.blur()'); await sleep(300);
  // sleeping tabs
  const sid = await J('return BW_TEST_ID=null,regisApp.browser.state().then(function(s){var t=s.tabs.find(function(x){return /\\/b$/.test(x.url)});return t&&t.id})');
  await J('return regisApp.browser.sleep(' + sid + ')'); await sleep(400);
  ok(await until(() => J('return !!document.querySelector("#bw-tabs .bw-tab.zz")')), 'a tab can be put to sleep (shown dimmed)');
  // Alt + page letter, from inside a web page
  const w = tabWc(/\/up$/); w.focus(); w.sendInputEvent({ type: 'keyDown', keyCode: 'M', modifiers: ['alt'] }); w.sendInputEvent({ type: 'keyUp', keyCode: 'M', modifiers: ['alt'] });
  ok(await until(() => J('return document.documentElement.getAttribute("data-view")==="music"')), 'Alt+M from inside a web page goes to Music');
  await J('document.dispatchEvent(new KeyboardEvent("keydown",{key:"o",altKey:true,bubbles:true}))');
  ok(await until(() => J('return document.documentElement.getAttribute("data-view")==="office"')), 'Alt+O goes to the Office page');
  // Office page
  ok(await until(() => J('var t=document.getElementById("of-list").textContent;return /Budget 2026\\.xlsx/.test(t)&&/Essay\\.docx/.test(t)&&/Pitch\\.pptx/.test(t)')), 'Office lists Word, Excel and PowerPoint files from Documents and Desktop');
  await click('#of-f [data-k="x"]'); await sleep(200);
  ok(await J('var t=document.getElementById("of-list").textContent;return /Budget/.test(t)&&!/Essay/.test(t)'), 'the Excel filter shows only workbooks');
  ok(await J('return document.querySelectorAll(".of-new .of-app").length===3'), 'Office has new Word, Excel and PowerPoint buttons');
  // priority colours
  const col = await J('var d=document.createElement("div");d.innerHTML=\'<div class="mrow" data-lv="high"></div><span class="chip warn">MED</span><span class="chip low">LOW</span>\';document.getElementById("app").appendChild(d);var a=getComputedStyle(d.querySelector(".mrow"),"::before").backgroundColor,b=getComputedStyle(d.querySelector(".chip.warn")).color,c=getComputedStyle(d.querySelector(".chip.low")).color,bad=getComputedStyle(document.documentElement).getPropertyValue("--bad");d.remove();return [a,b,c]');
  ok(col[0] !== 'rgba(0, 0, 0, 0)' && col[1] !== col[2], 'priority colours are back (high edge ' + col[0] + ', medium ' + col[1] + ', low ' + col[2] + ')');
  // a link inside Regis (like one in an email) opens in the Regis Browser
  await click('#vsw [data-v="work"]'); await sleep(1200);
  await J('var a=document.createElement("a");a.href=' + JSON.stringify(base + '/from-mail') + ';a.target="_blank";a.textContent="link";document.getElementById("app").appendChild(a);a.click();a.remove()');
  ok(await until(() => J('return document.documentElement.getAttribute("data-view")==="browser"') && Promise.resolve(!!tabWc(/\/from-mail$/))), 'links in Regis open in the Regis Browser');
  srv.close(); console.log(pass + ' passed, ' + fail + ' failed'); app.exit(fail ? 1 : 0);
});
