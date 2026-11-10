// 1.9.5/1.9.6: team dashboards (queue, KPIs, add-ins), the base (rooms, lift, animated team leads), wall colours, "/" from a web page and on a new tab,
// the Web Store button, and tabs Regis reopens by itself staying quiet.
// Run: node_modules/electron/dist/electron test/teams.test.js   (fake Claude API; fake sites served inside the app)
const { app, BrowserWindow, webContents, net } = require('electron'); const fs = require('fs'), os = require('os'), path = require('path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'regis-teams-')));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch (_) {} await sleep(150); } return false; };
const calls = []; const realFetch = globalThis.fetch; let slow = 7000;
globalThis.fetch = async (u, o) => { if (!/api\.anthropic\.com/.test(String(u))) return realFetch(u, o); const b = JSON.parse(o.body); calls.push(b); await sleep(slow);
  return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Finished: ' + b.messages[b.messages.length - 1].content.slice(0, 60) }], usage: {}, stop_reason: 'end_turn' }), { status: 200 }); };
const SITE = '<!doctype html><title>Site</title><body style="background:#fff"><h1 id="h">Site</h1><input id="q"></body>';
const STORE = '<!doctype html><title>Store</title><body style="background:#fff"><div id="strip"><span>Switch to Chrome to install extensions and themes</span><a href="#">Install Chrome</a></div><h1>Extension</h1><div id="row"><button id="gbtn" disabled>Add to Chrome</button></div></body>';
const wav = (() => { const n = 8000 * 30, b = Buffer.alloc(44 + n); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(40 * Math.sin(i / 6)); return b; })();
const TUNE = '<!doctype html><title>Tune</title><body style="background:#fff"><h1>Tune</h1><audio id="a" autoplay loop src="/a.wav"></audio></body>';
app.on('session-created', (ses) => { try { ses.protocol.handle('https', (req) => { const u = new URL(req.url); if (u.hostname === 'site.test') return new Response(SITE, { headers: { 'content-type': 'text/html' } }); if (u.hostname === 'tune.test') return u.pathname === '/a.wav' ? new Response(wav, { headers: { 'content-type': 'audio/wav' } }) : new Response(TUNE, { headers: { 'content-type': 'text/html' } }); if (u.hostname === 'chromewebstore.google.com') return new Response(STORE, { headers: { 'content-type': 'text/html' } }); return net.fetch(req, { bypassCustomProtocolHandlers: true }); }); } catch (_) {} });
require(path.join(__dirname, '..', 'main.js'));
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 450 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())); await sleep(100); }
  win.setSize(1300, 900); win.show(); await sleep(3500);
  const J = (c) => win.webContents.executeJavaScript('(async()=>{' + c + '})()', true);
  await J('await window.regisBridge.saveKey("sk-test");localStorage.setItem("regis-perf","bal");location.reload()'); await sleep(4500);
  await J('document.querySelector(\'#vsw [data-v="work"]\').click()'); await sleep(900);
  ok(await until(() => J('return document.querySelectorAll("#gd-rail .gd-av svg").length===5')), 'the rail has an icon for Regis and one for each team (halo, ingot, pen, diamond)');
  ok(await J('var b=document.querySelector(\'#gd-rail [data-id="regis"]\'),s=b.querySelector("svg"),r=b.getBoundingClientRect(),q=s.getBoundingClientRect();return Math.abs((r.left+r.width/2)-(q.left+q.width/2))<1&&Math.abs((r.top+r.height/2)-(q.top+q.height/2))<1'), 'Regis\'s icon sits in the middle of its button');
  ok(await J('return /Alicia/.test(document.querySelector(\'#gd-rail [data-id="luna"]\').getAttribute("aria-label"))&&!/Luna/.test(document.getElementById("gd-rail").innerHTML)'), 'Luna is now called Alicia');
  await J('document.querySelector(\'#gd-rail [data-id="midas"]\').click()'); await sleep(900);
  ok(await J('return document.getElementById("gd-chat").dataset.tab==="dash"&&getComputedStyle(document.getElementById("gd-log")).display==="none"&&!!document.querySelector("#tm-body .tm-kpis")'), 'opening a team shows its dashboard');
  ok(await J('return /15,000/.test(document.querySelector("#tm-body .tm-kpis").textContent)&&/Caffeine/.test(document.querySelector("#tm-body .tm-kpis").textContent)'), 'Midas\'s KPIs are his own (units in the run, caffeine)');
  // KPI edit + limit
  await J('document.querySelector(\'#tm-body [data-act="tm-kpi"][data-k="caf"]\').click()'); await sleep(300);
  await J('document.getElementById("tm-kv").value="62";document.querySelector(\'form[data-tm-form="kpi"]\').requestSubmit()'); await sleep(300);
  ok(await J('var k=document.querySelector(\'#tm-body [data-k="caf"]\');return k.classList.contains("bad")&&/62 mg/.test(k.textContent)&&/over the 50 mg limit/.test(k.textContent)'), 'caffeine over 50 mg turns red');
  for (const [k, v] of [['cost', '2'], ['price', '5']]) { await J('document.querySelector(\'#tm-body [data-act="tm-kpi"][data-k="' + k + '"]\').click()'); await sleep(250); await J('document.getElementById("tm-kv").value="' + v + '";document.querySelector(\'form[data-tm-form="kpi"]\').requestSubmit()'); await sleep(250); }
  ok(await J('return /60%/.test(document.querySelector("#tm-body .tm-kpis").textContent)'), 'gross margin is worked out from cost and price (60%)');
  // add-in
  await J('document.querySelector(\'#tm-body [data-act="tm-adnew"]\').click()'); await sleep(300);
  await J('document.getElementById("tm-an").value="Price list";document.getElementById("tm-at").value="Always quote prices in euros.";document.querySelector(\'form[data-tm-form="addin"]\').requestSubmit()'); await sleep(300);
  ok(await J('return /Price list/.test(document.querySelector("#tm-body .tm-ad").textContent)'), 'an add-in can be added to the team');
  // queue
  for (const t of ['Work out landed cost', 'Compare freight quotes']) { await J('document.getElementById("tm-title").value=' + JSON.stringify(t) + ';document.querySelector(\'form[data-tm-form="task"]\').requestSubmit()'); await sleep(200); }
  ok(await J('return document.querySelectorAll("#tm-body .st-q").length===2&&/Run the queue \\(2\\)/.test(document.getElementById("tm-body").textContent)'), 'tasks go into the team\'s queue');
  // office
  ok(await J('return document.querySelectorAll("#gof-chs .gof-ch .chb").length===4&&document.querySelectorAll("#gof-base .gof-rm").length===6&&!!document.getElementById("gof-car")&&document.querySelectorAll("#gof-base .gof-hall").length===6'), 'the base shows the four team leads, five rooms plus the terrace, hallways and the lift');
  ok(await J('return [].every.call(document.querySelectorAll(".gof-rm"),function(r){return r.dataset.img==="-1"||/^url\\("data:image\\/webp/.test(getComputedStyle(r).backgroundImage)})&&[].every.call(document.querySelectorAll(".gof-ch .chb-b"),function(e){return /^url\\("data:image\\/webp/.test(getComputedStyle(e).backgroundImage)})'), 'every room and every character has its picture');
  ok(await J('return [].every.call(document.querySelectorAll(".gof-ch"),function(e){return e.querySelectorAll(".chb-ll,.chb-lr,.chb-b,.chb-h,.chb-lid").length===5&&(e.classList.contains("happy")||getComputedStyle(e.querySelector(".chb-lid")).animationName==="chbBlink")})&&!!document.querySelector(\'.gof-ch[data-id="exusiai"] .chb-o\')'), 'each character is layered (legs, body, head, eyelids that blink) and Exusiai has her halo');
  ok(await J('return /Alicia/.test(document.querySelector(\'.gof-ch[data-id="luna"] .gof-nm\').textContent)&&/Alicia.s office/.test(document.getElementById("gof-base").textContent)'), 'Alicia has her own office');
  await J('document.querySelector(\'#gof-zs [data-r="4"]\').click()'); await sleep(900);
  ok(await J('var v=document.getElementById("gof-vp").getBoundingClientRect(),r=document.querySelector(\'.gof-rm[data-r="4"]\').getBoundingClientRect();return r.width>v.width*.85&&r.left>=v.left-2&&r.right<=v.right+2&&localStorage.getItem("regis-gofzoom")==="4"'), 'pressing a room\'s name zooms in on it (and Regis remembers it)');
  await J('document.querySelector(\'#gof-zs [data-r=""]\').click()'); await sleep(900);
  ok(await J('var v=document.getElementById("gof-vp").getBoundingClientRect(),b=document.getElementById("gof-base").getBoundingClientRect();return Math.abs(b.width-v.width)<3'), 'Whole base zooms back out');
  const x0 = await J('return [].map.call(document.querySelectorAll("#gof-chs .gof-ch"),function(e){return e.getBoundingClientRect().left|0}).join()');
  await J('document.querySelector(\'#tm-body [data-act="tm-runall"]\').click()');
  ok(await until(() => J('return !!document.querySelector("#tm-body .st-w")&&document.querySelector(\'.gof-ch[data-id="midas"]\').classList.contains("busy")')), 'Run the queue starts the first task');
  ok(await until(() => J('var e=document.querySelector(\'.gof-ch[data-id="midas"]\'),r=document.querySelector(\'.gof-rm[data-r="4"]\').getBoundingClientRect(),c=e.getBoundingClientRect();return e.classList.contains("work")&&e.classList.contains("sit")&&c.left>r.left&&c.right<r.right&&c.bottom>r.top&&c.bottom<r.bottom+4'), 14000), 'Midas hurries to the desk in his own office and works there');
  ok(/<addins>[\s\S]*Always quote prices in euros/.test(calls[calls.length - 1].system) && /Task from my queue: /.test(calls[calls.length - 1].messages.slice(-1)[0].content), 'the task and the add-in reach the agent');
  slow = 300;
  ok(await until(() => J('return document.querySelectorAll("#tm-body .st-d").length===2&&!document.querySelector("#tm-body .st-q")'), 15000), 'the queue runs to the end and tasks move to Finished');
  ok(await J('return /Finished: Task from my queue/.test(document.querySelector("#tm-body .st-d .tm-res").textContent)'), 'each finished task shows the start of its result');
  ok(await until(() => J('return !document.querySelector(\'.gof-ch[data-id="midas"]\').classList.contains("work")')), 'and he leaves the desk when done');
  await sleep(7000);
  const x1 = await J('return [].map.call(document.querySelectorAll("#gof-chs .gof-ch"),function(e){return e.getBoundingClientRect().left|0}).join()');
  ok(x0 !== x1, 'the team leads walk around (' + x0 + ' -> ' + x1 + ')');
  // chat tab still works
  await J('document.querySelector(\'#gd-head [data-act="gd-tab"][data-t="chat"]\').click()'); await sleep(300);
  ok(await J('return getComputedStyle(document.getElementById("gd-log")).display!=="none"&&/Finished: Task from my queue/.test(document.getElementById("gd-log").textContent)'), 'the Chat tab shows the conversation, including the queued tasks');
  // wall colours + rename
  ok(await J('return !!document.getElementById("bw-c1")&&!!document.getElementById("bw-c2")&&/Waterwall/.test(document.querySelector(\'[data-act="bg"][data-v="tide"]\').textContent)&&!/Calm wall/.test(document.body.textContent)'), 'Appearance has Firewall and Waterwall colours, and Calm wall is now Waterwall');
  await J('var c=document.getElementById("bw-c1");c.value="#22cc66";c.dispatchEvent(new Event("change",{bubbles:true}))'); await sleep(200);
  ok(await J('return JSON.parse(localStorage.getItem("regis-bwfx")).c1==="#22cc66"'), 'a wall colour is saved');
  // "/" from inside a web page
  await J('document.querySelector(\'#vsw [data-v="browser"]\').click()'); await sleep(1500);
  await J('await window.regisBridge.browser.open("https://site.test/")');
  let sw; ok(await until(() => { sw = webContents.getAllWebContents().find((w) => /site\.test/.test(w.getURL())); return sw && !sw.isLoading(); }), 'a site opens');
  await sleep(800); sw.focus(); sw.sendInputEvent({ type: 'mouseDown', x: 200, y: 200, button: 'left', clickCount: 1 }); sw.sendInputEvent({ type: 'mouseUp', x: 200, y: 200, button: 'left', clickCount: 1 }); await sleep(200);
  sw.sendInputEvent({ type: 'keyDown', keyCode: '/' }); sw.sendInputEvent({ type: 'char', keyCode: '/' }); sw.sendInputEvent({ type: 'keyUp', keyCode: '/' });
  ok(await until(() => J('return document.activeElement&&document.activeElement.id==="bw-addr"'), 4000), '"/" on a web page jumps to the address bar');
  ok(win.webContents.isFocused(), 'and the keyboard is in Regis, ready to type');
  await sw.executeJavaScript('document.getElementById("q").focus()'); sw.focus(); await sleep(200);
  sw.sendInputEvent({ type: 'keyDown', keyCode: '/' }); sw.sendInputEvent({ type: 'char', keyCode: '/' }); sw.sendInputEvent({ type: 'keyUp', keyCode: '/' }); await sleep(400);
  ok(await sw.executeJavaScript('document.getElementById("q").value') === '/', 'but inside a text box on the site, "/" still types a slash');
  // "/" on a new tab: the keyboard comes back to Regis and lands in the search box
  sw.focus(); await sleep(150); await J('await window.regisBridge.browser.open("")'); await sleep(700);
  ok(win.webContents.isFocused(), 'opening a new tab gives the keyboard back to Regis (the website no longer keeps it)');
  await J('if(document.activeElement)document.activeElement.blur()'); await sleep(100);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '/' }); win.webContents.sendInputEvent({ type: 'char', keyCode: '/' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: '/' }); await sleep(300);
  ok(await J('return document.activeElement&&document.activeElement.id==="bw-sq"&&document.getElementById("rov").hidden'), '"/" on a new tab puts the cursor in the search box');
  for (const ch of 'cats') { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: ch }); win.webContents.sendInputEvent({ type: 'char', keyCode: ch }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: ch }); }
  await sleep(300); ok(await J('return document.getElementById("bw-sq").value==="cats"'), 'and typing goes into it');
  await J('document.getElementById("bw-sq").value=""');
  // a tab Regis reopens by itself (after sleeping, or at start-up) must not start playing
  const tuneId = await J('return await window.regisBridge.browser.open("https://tune.test/")');
  let tw; ok(await until(() => { tw = webContents.getAllWebContents().find((w) => /tune\.test/.test(w.getURL())); return tw && !tw.isLoading(); }), 'a page with sound opens');
  ok(await until(() => tw.executeJavaScript('!document.getElementById("a").paused')) && !tw.isAudioMuted(), 'a page you opened yourself plays as usual');
  await J('await window.regisBridge.browser.open("https://site.test/two")'); await sleep(600);
  ok(await J('return await window.regisBridge.browser.sleep(' + tuneId + ')'), 'the tab can be put to sleep');
  await J('await window.regisBridge.browser.activate(' + tuneId + ')');
  ok(await until(() => { tw = webContents.getAllWebContents().find((w) => /tune\.test/.test(w.getURL())); return tw && !tw.isLoading(); }), 'waking it loads the page again');
  await sleep(1500);
  ok(await tw.executeJavaScript('document.getElementById("a").paused') && tw.isAudioMuted(), 'but it stays paused and silent until you touch it');
  tw.sendInputEvent({ type: 'mouseDown', x: 300, y: 300, button: 'left', clickCount: 1 }); tw.sendInputEvent({ type: 'mouseUp', x: 300, y: 300, button: 'left', clickCount: 1 }); await sleep(400);
  ok(!tw.isAudioMuted() && await tw.executeJavaScript('document.getElementById("a").play().then(function(){return !document.getElementById("a").paused})', true), 'after a click the sound is back and it can play');
  await J('await window.regisBridge.browser.close(' + tuneId + ')');
  // Web Store button
  await J('await window.regisBridge.browser.open("https://chromewebstore.google.com/detail/test-extension/abcdefghijklmnopabcdefghijklmnop")');
  let st; ok(await until(() => { st = webContents.getAllWebContents().find((w) => /chromewebstore/.test(w.getURL())); return st && !st.isLoading(); }), 'a Web Store extension page opens');
  ok(await until(() => st.executeJavaScript('[].some.call(document.querySelectorAll("button"),function(b){return b.textContent==="Add to Regis"})')), 'Regis adds an "Add to Regis" button to it');
  ok(await st.executeJavaScript('var g=document.getElementById("gbtn"),b=document.querySelector("[data-regis-add]");getComputedStyle(g).display==="none"&&b.parentElement===g.parentElement&&getComputedStyle(b).position!=="fixed"&&!b.disabled&&getComputedStyle(document.getElementById("strip")).display==="none"'), 'it replaces the greyed-out "Add to Chrome" button, and the "Switch to Chrome" strip is hidden');
  await st.executeJavaScript('[].find.call(document.querySelectorAll("button"),function(b){return b.textContent==="Add to Regis"}).click()');
  ok(await until(() => st.executeJavaScript('[].some.call(document.querySelectorAll("button"),function(b){return b.textContent!=="Add to Regis"&&b.textContent!=="Adding…"})'), 20000), 'pressing it asks Regis to install and reports back (a made-up extension, so it reports it could not)');
  console.log(pass + ' passed, ' + fail + ' failed'); app.exit(fail ? 1 : 0);
});
