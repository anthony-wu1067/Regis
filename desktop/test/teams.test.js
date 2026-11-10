// 1.9.5: team dashboards (queue, KPIs, add-ins), the office, wall colours, "/" from a web page, the Web Store button.
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
const STORE = '<!doctype html><title>Store</title><body style="background:#fff"><h1>Extension</h1></body>';
app.on('session-created', (ses) => { try { ses.protocol.handle('https', (req) => { const u = new URL(req.url); if (u.hostname === 'site.test') return new Response(SITE, { headers: { 'content-type': 'text/html' } }); if (u.hostname === 'chromewebstore.google.com') return new Response(STORE, { headers: { 'content-type': 'text/html' } }); return net.fetch(req, { bypassCustomProtocolHandlers: true }); }); } catch (_) {} });
require(path.join(__dirname, '..', 'main.js'));
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 450 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())); await sleep(100); }
  win.setSize(1300, 900); win.show(); await sleep(3500);
  const J = (c) => win.webContents.executeJavaScript('(async()=>{' + c + '})()', true);
  await J('await window.regisBridge.saveKey("sk-test");localStorage.setItem("regis-perf","bal");location.reload()'); await sleep(4500);
  await J('document.querySelector(\'#vsw [data-v="work"]\').click()'); await sleep(900);
  ok(await until(() => J('return document.querySelectorAll("#gd-rail .gd-av svg.chb-head").length===4')), 'each team has its own drawn icon in the rail');
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
  ok(await J('return document.querySelectorAll("#gof-chs .gof-ch .chb").length===4&&document.querySelectorAll(\'#gof-items .gof-it[data-t="desk"]\').length===4'), 'the office shows the four team leads and a desk each');
  const x0 = await J('return [].map.call(document.querySelectorAll("#gof-chs .gof-ch"),function(e){return e.getBoundingClientRect().left|0}).join()');
  await J('document.querySelector(\'#tm-body [data-act="tm-runall"]\').click()');
  ok(await until(() => J('return !!document.querySelector("#tm-body .st-w")&&document.querySelector(\'.gof-ch[data-id="midas"]\').classList.contains("busy")')), 'Run the queue starts the first task');
  ok(await until(() => J('return document.querySelector(\'.gof-ch[data-id="midas"]\').classList.contains("work")&&document.querySelector(\'.gof-it[data-owner="midas"]\').classList.contains("on")'), 9000), 'Midas walks to his desk and works there (screen on)');
  ok(/<addins>[\s\S]*Always quote prices in euros/.test(calls[calls.length - 1].system) && /Task from my queue: /.test(calls[calls.length - 1].messages.slice(-1)[0].content), 'the task and the add-in reach the agent');
  slow = 300;
  ok(await until(() => J('return document.querySelectorAll("#tm-body .st-d").length===2&&!document.querySelector("#tm-body .st-q")'), 15000), 'the queue runs to the end and tasks move to Finished');
  ok(await J('return /Finished: Task from my queue/.test(document.querySelector("#tm-body .st-d .tm-res").textContent)'), 'each finished task shows the start of its result');
  ok(await until(() => J('return !document.querySelector(\'.gof-ch[data-id="midas"]\').classList.contains("work")')), 'and he leaves the desk when done');
  await sleep(7000);
  const x1 = await J('return [].map.call(document.querySelectorAll("#gof-chs .gof-ch"),function(e){return e.getBoundingClientRect().left|0}).join()');
  ok(x0 !== x1, 'the team leads walk around (' + x0 + ' -> ' + x1 + ')');
  // edit office
  await J('document.querySelector(\'[data-act="gof-edit"]\').click()'); await sleep(300);
  const n0 = await J('return document.querySelectorAll("#gof-items .gof-it").length');
  await J('document.querySelector(\'#gof-cat [data-act="gof-add"][data-t="lamp"]\').click()'); await sleep(300);
  ok(await J('return document.querySelectorAll("#gof-items .gof-it").length') === n0 + 1 && await J('return JSON.parse(localStorage.getItem("regis-office")).items.some(function(i){return i.t==="lamp"})'), 'Edit office adds furniture and saves it');
  const lr = await J('var e=document.querySelector(\'#gof-items .gof-it[data-t="lamp"]\').getBoundingClientRect();return [e.left+e.width/2,e.top+e.height/2]');
  const lx0 = await J('return JSON.parse(localStorage.getItem("regis-office")).items.find(function(i){return i.t==="lamp"}).x');
  win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(lr[0]), y: Math.round(lr[1]), button: 'left', clickCount: 1 });
  for (let k = 1; k <= 8; k++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(lr[0] + (lr[0] > 600 ? -15 : 15) * k), y: Math.round(lr[1]), button: 'left' }); await sleep(25); }
  win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(lr[0] + (lr[0] > 600 ? -120 : 120)), y: Math.round(lr[1]), button: 'left', clickCount: 1 }); await sleep(300);
  ok(Math.abs(await J('return JSON.parse(localStorage.getItem("regis-office")).items.find(function(i){return i.t==="lamp"}).x') - lx0) > 40, 'dragging moves furniture');
  await J('var c=document.getElementById("gof-wall");c.value="#335544";c.dispatchEvent(new Event("input",{bubbles:true}))'); await sleep(200);
  ok(await J('return JSON.parse(localStorage.getItem("regis-office")).wall==="#335544"'), 'the wall colour can be changed');
  await J('document.querySelector(\'#gof-items .gof-it[data-t="lamp"] .gof-x\').click()'); await sleep(300);
  ok(await J('return !document.querySelector(\'#gof-items .gof-it[data-t="lamp"]\')&&document.querySelectorAll(\'#gof-items .gof-it[data-t="desk"] .gof-x\').length===0'), 'furniture can be removed (desks stay)');
  await J('document.querySelector(\'[data-act="gof-edit"]\').click()');
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
  // Web Store button
  await J('await window.regisBridge.browser.open("https://chromewebstore.google.com/detail/test-extension/abcdefghijklmnopabcdefghijklmnop")');
  let st; ok(await until(() => { st = webContents.getAllWebContents().find((w) => /chromewebstore/.test(w.getURL())); return st && !st.isLoading(); }), 'a Web Store extension page opens');
  ok(await until(() => st.executeJavaScript('[].some.call(document.querySelectorAll("button"),function(b){return b.textContent==="Add to Regis"})')), 'Regis adds an "Add to Regis" button to it');
  await st.executeJavaScript('[].find.call(document.querySelectorAll("button"),function(b){return b.textContent==="Add to Regis"}).click()');
  ok(await until(() => st.executeJavaScript('[].some.call(document.querySelectorAll("button"),function(b){return b.textContent!=="Add to Regis"&&b.textContent!=="Adding…"})'), 20000), 'pressing it asks Regis to install and reports back (a made-up extension, so it reports it could not)');
  console.log(pass + ' passed, ' + fail + ' failed'); app.exit(fail ? 1 : 0);
});
