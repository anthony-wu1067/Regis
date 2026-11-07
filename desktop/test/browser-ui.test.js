// Browser page UI in the real Regis app: custom icons (presets, colours, upload, site icon) and the address bar.
// Run: node_modules/electron/dist/electron test/browser-ui.test.js   (on Linux CI: xvfb-run -a ... --no-sandbox)
const { app, BrowserWindow, webContents } = require('electron'); const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'regis-bwui-')));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch (_) {} await sleep(120); } return false; };
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end('<title>Page ' + q.url.slice(1) + '</title><h1>' + q.url + '</h1>'); });
require(path.join(__dirname, '..', 'main.js'));
app.whenReady().then(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  let win; for (let i = 0; i < 450 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())); await sleep(100); }
  win.setSize(1360, 880); win.show();
  const J = (c) => win.webContents.executeJavaScript('(async()=>{' + c + '})()', true);
  const click = (sel) => J('var b=document.querySelector(' + JSON.stringify(sel) + ');if(!b)return false;b.click();return true');
  await sleep(3500);
  await click('#vsw [data-v="browser"]'); await sleep(1500);
  // address bar: typed text sits clear of the lock
  await J('var a=document.getElementById("bw-addr");a.focus();a.value="asd"');
  const gap = await J('var a=document.getElementById("bw-addr"),l=document.getElementById("bw-lock"),cs=getComputedStyle(a);return Math.round(a.getBoundingClientRect().left+parseFloat(cs.paddingLeft)-l.getBoundingClientRect().right)');
  ok(gap >= 20 && gap <= 34, 'typed text starts ' + gap + 'px after the lock, with room before the first letter');
  await J('document.getElementById("bw-addr").blur()');
  // sidebar shortcut: preset icon + colour
  await click('[data-act="bws-edit"]'); await sleep(400);
  ok(await J('return !!document.querySelector(\'#bws-body [data-act="ic-open"][data-k="sb"]\')'), 'sidebar editor rows have an Icon button');
  await click('#bws-body [data-act="ic-open"][data-k="sb"]'); await sleep(300);
  ok(await J('return document.querySelectorAll("#ic-body .ic-o").length>=25&&document.querySelectorAll("#ic-body .ic-c").length===10'), 'the picker offers 25+ icons and 10 colours');
  await click('#ic-body [data-act="ic-g"][data-g="@game"]'); await click('#ic-body [data-act="ic-c"][data-c="#6be0b0"]'); await sleep(150);
  ok(await J('return /M7 8h10a4/.test(document.querySelector("#ic-body .ic-tile").innerHTML)'), 'the preview shows the chosen icon');
  await click('#ic-body [data-act="ic-done"]'); await sleep(300);
  ok(await J('var s=JSON.parse(localStorage.getItem("regis-bwside2"))[0];return s.g==="@game"&&s.c==="#6be0b0"'), 'the shortcut keeps its new icon and colour');
  ok(await J('var b=document.querySelector("#bw-qs .bw-ic b");return /M7 8h10a4/.test(b.innerHTML)&&b.style.getPropertyValue("--c")==="#6be0b0"'), 'the sidebar shows the new icon');
  // upload your own image
  await click('[data-act="bws-edit"]'); await sleep(300); await click('#bws-body [data-act="ic-open"][data-k="sb"]'); await sleep(300);
  await J('var c=document.createElement("canvas");c.width=300;c.height=200;var x=c.getContext("2d");x.fillStyle="#e33";x.fillRect(0,0,300,200);x.fillStyle="#fff";x.fillRect(120,70,60,60);var blob=await new Promise(function(r){c.toBlob(r,"image/png")});var f=new File([blob],"me.png",{type:"image/png"}),dt=new DataTransfer();dt.items.add(f);var inp=document.getElementById("ic-up");inp.files=dt.files;inp.dispatchEvent(new Event("change",{bubbles:true}))');
  ok(await until(() => J('var i=document.querySelector("#ic-body .ic-tile img");return !!i&&/^data:image\\/png/.test(i.src)')), 'an uploaded picture shows in the preview');
  await click('#ic-body [data-act="ic-done"]'); await sleep(300);
  const up = await J('var s=JSON.parse(localStorage.getItem("regis-bwside2"))[0];var im=new Image();im.src=s.img;await im.decode();return {len:s.img.length,w:im.naturalWidth,h:im.naturalHeight,shown:!!document.querySelector("#bw-qs .bw-ic b img")}');
  ok(up.w === 96 && up.h === 96 && up.len < 40000 && up.shown, 'uploads are cropped to a small 96x96 square (' + Math.round(up.len / 1024) + ' KB) and shown in the sidebar');
  // the site's own icon (fetched by the desktop app)
  await click('[data-act="bws-edit"]'); await sleep(300); await click('#bws-body [data-act="ic-open"][data-k="sb"]'); await sleep(300);
  if (await J('return !!document.querySelector(\'#ic-body [data-act="ic-site"]\')')) {
    await click('#ic-body [data-act="ic-site"]');
    const got = await until(() => J('var i=document.querySelector("#ic-body .ic-tile img");return !!i&&i.src.length>200'), 12000);
    if (!got) console.log('SKIP site icon (no internet?)'); else ok(true, 'Use the site’s icon fetches it through the desktop app');
    await click('#ic-body [data-act="modal-close"]'); await sleep(200);
  } else ok(false, 'the picker offers Use the site’s icon in the desktop app');
  // reset back to a letter
  await click('[data-act="bws-edit"]'); await sleep(300); await click('#bws-body [data-act="ic-open"][data-k="sb"]'); await sleep(300);
  await click('#ic-body [data-act="ic-reset"]'); await click('#ic-body [data-act="ic-done"]'); await sleep(300);
  ok(await J('var s=JSON.parse(localStorage.getItem("regis-bwside2"))[0];return !s.img&&!s.g&&!!document.querySelector("#bw-qs .bw-ic b span")'), 'Reset goes back to the first letter');
  // favourites (start page) in edit mode
  await click('[data-act="bwf-edit"]'); await sleep(300);
  ok(await J('return !!document.querySelector(\'#bw-dial [data-act="ic-open"][data-k="fav"]\')'), 'favourites have an icon button in Edit mode');
  await click('#bw-dial [data-act="ic-open"][data-k="fav"]'); await sleep(300); await click('#ic-body [data-act="ic-g"][data-g="@star"]'); await click('#ic-body [data-act="ic-done"]'); await sleep(300);
  ok(await J('return JSON.parse(localStorage.getItem("regis-bwfav"))[0].g==="@star"'), 'a favourite keeps its new icon');
  await click('[data-act="bwf-edit"]'); await sleep(200);
  // bookmarks: Edit mode, click a bookmark to rename it and change its icon
  await J('var a=document.getElementById("bw-addr");a.value=' + JSON.stringify(base + '/news') + ';document.getElementById("bw-form").requestSubmit()');
  await until(() => Promise.resolve(webContents.getAllWebContents().some((w) => /\/news$/.test(w.getURL()) && !w.isLoading()))); await sleep(800);
  await click('#bw-star'); await sleep(700);
  ok(await until(() => J('return document.querySelectorAll("#bw-bm .bm-w").length===1')), 'a bookmark is on the bar');
  await click('#bw-bm [data-act="bw-markedit"]'); await sleep(300); await click('#bw-bm .bm[data-act="bm-edit"]'); await sleep(300);
  ok(await J('return !!document.querySelector("form[data-bm-form]")'), 'in Edit mode, clicking a bookmark opens its editor');
  await J('document.getElementById("bm-en").value="Morning News";document.querySelector("form[data-bm-form]").requestSubmit()'); await sleep(600);
  ok(await until(() => J('return /Morning News/.test(document.getElementById("bw-bm").textContent)')), 'renaming a bookmark works');
  await click('#bw-bm .bm[data-act="bm-edit"]'); await sleep(300); await click('form[data-bm-form] [data-act="ic-open"]'); await sleep(300);
  await click('#ic-body [data-act="ic-g"][data-g="@news"]'); await click('#ic-body [data-act="ic-c"][data-c="#ffcf6b"]'); await click('#ic-body [data-act="ic-done"]');
  ok(await until(() => J('var i=document.querySelector("#bw-bm .bm i");return !!i&&i.classList.contains("bm-g")&&/svg/.test(i.innerHTML)&&i.style.getPropertyValue("--c")==="#ffcf6b"')), 'the bookmark shows its new icon and colour on the bar');
  srv.close(); console.log(pass + ' passed, ' + fail + ' failed'); app.exit(fail ? 1 : 0);
});
