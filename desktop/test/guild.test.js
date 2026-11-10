// 1.9.1: Guild agents (fake Claude API), the overlay, camera/mic prompts (fake meet.test), alerts above web pages, tab groups, address bar.
// Run: node_modules/electron/dist/electron test/guild.test.js   (no real accounts, no network for the Claude parts)
const { app, BrowserWindow, webContents, net } = require('electron'); const fs = require('fs'), os = require('os'), path = require('path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'regis-guild-')));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch (_) {} await sleep(150); } return false; };
/* the Claude API, faked: remembers each request; answers depend on the persona */
const calls = []; const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  if (!/api\.anthropic\.com/.test(String(u))) return realFetch(u, o);
  const b = JSON.parse(o.body); calls.push(b); const who = (b.system || '').match(/You are (\w+)/); const n = who ? who[1] : 'none';
  let text = n + ' heard ' + b.messages.length + ' message(s): ' + b.messages[b.messages.length - 1].content.slice(-40);
  if (n === 'Exusiai') text = 'Plan:\n\n- **one** thing\n\n```tasks\n[{"title":"Call three customers","due":"","prio":1},{"title":"Write the Mom Test script","due":"","prio":2}]\n```';
  if (n === 'Luna') text = 'Here you go.\n\n```jsx\nexport default function LandingPage(){return <main className="p-8">Hi</main>}\n```';
  return new Response(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 5, output_tokens: 5 }, stop_reason: 'end_turn' }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const MEET = '<!doctype html><title>Meet</title><body style="background:#fff"><button id="b">Join</button><p id="r">-</p><script>document.getElementById("b").onclick=function(){navigator.mediaDevices.getUserMedia({audio:true,video:true}).then(function(s){document.getElementById("r").textContent="granted "+s.getTracks().length}).catch(function(e){document.getElementById("r").textContent="denied "+e.name})}</script></body>';
const BLANK = (t) => '<!doctype html><title>' + t + '</title><body style="background:#fff"><h1>' + t + '</h1></body>';
app.on('session-created', (ses) => { try { ses.protocol.handle('https', (req) => { const h = new URL(req.url).hostname; if (h === 'meet.test') return new Response(MEET, { headers: { 'content-type': 'text/html' } }); if (/^p\d\.test$/.test(h)) return new Response(BLANK(h), { headers: { 'content-type': 'text/html' } }); return net.fetch(req, { bypassCustomProtocolHandlers: true }); }); } catch (_) {} });
require(path.join(__dirname, '..', 'main.js'));
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 450 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())); await sleep(100); }
  win.setSize(1300, 860); win.show(); await sleep(3500);
  const J = (c) => win.webContents.executeJavaScript('(async()=>{' + c + '})()', true);
  await J('await window.regisBridge.saveKey("sk-test");localStorage.setItem("regis-perf","bal");location.reload()'); await sleep(4000);
  await J('document.querySelector(\'#vsw [data-v="work"]\').click()'); await sleep(900);

  // ---- Guild ----
  ok(await until(() => J('var r=document.getElementById("gd-rail");return r&&!r.hidden&&r.querySelectorAll(".gd-av").length===5')), 'the Workspace has a rail with Regis and four agents');
  const railBox = await J('var r=document.getElementById("gd-rail").getBoundingClientRect(),g=document.querySelector("main.grid").getBoundingClientRect();return [r.right,g.left]');
  ok(railBox[0] <= railBox[1], 'the rail sits left of the workspace, not over it (' + railBox.map(Math.round) + ')');
  await J('document.querySelector(\'#gd-rail [data-id="midas"]\').click()'); await sleep(400);
  ok(await J('return document.getElementById("app").classList.contains("gd-on")&&/Midas/.test(document.getElementById("cmd").placeholder)&&getComputedStyle(document.querySelector("main.grid")).display==="none"'), 'picking Midas swaps the workspace for his chat and the bar says "Message Midas"');
  await J('var c=document.getElementById("cmd");c.value="What is my margin?";document.getElementById("cmd-form").requestSubmit()');
  ok(await until(() => J('return /Midas heard 1/.test(document.getElementById("gd-log").textContent)')), 'Midas answers, with his persona as the system prompt');
  const c0 = calls[calls.length - 1];
  ok(/15,000-unit/.test(c0.system) && /50 mg/.test(c0.system) && c0.messages.length === 1, 'his persona has the R&D run and the caffeine cap');
  await J('var c=document.getElementById("cmd");c.value="And per SKU?";document.getElementById("cmd-form").requestSubmit()');
  ok(await until(() => J('return /Midas heard 3/.test(document.getElementById("gd-log").textContent)')), 'the second message carries his own history');
  await J('document.querySelector(\'#gd-rail [data-id="luna"]\').click()'); await sleep(500);
  ok(await J('return !/Midas/.test(document.getElementById("gd-log").textContent)&&/Luna/.test(document.getElementById("gd-head").textContent)'), 'switching to Luna clears the chat view');
  await J('var c=document.getElementById("cmd");c.value="Build it";document.getElementById("cmd-form").requestSubmit()');
  ok(await until(() => J('return !!document.querySelector("#gd-log .gd-code")')), 'Luna\'s code comes back in a code block with Copy and Save');
  const cl = calls[calls.length - 1];
  ok(/You are Luna/.test(cl.system) && cl.messages.length === 1 && !JSON.stringify(cl.messages).includes('margin'), 'Luna\'s request has none of Midas\'s conversation');
  const rows = await J('return await window.regisBridge.guild.history("midas")');
  ok(rows.length === 4 && rows.every((r) => r.role === 'user' || r.role === 'assistant'), 'Midas\'s history is kept apart (' + rows.length + ' rows)');
  const raw = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'regis-data.json'), 'utf8')).meta.guild;
  ok(raw.every((r) => ['midas', 'luna'].includes(r.context_scope)), 'every saved row has a context_scope column');
  await J('document.querySelector(\'#gd-rail [data-id="exusiai"]\').click()'); await sleep(400);
  await J('var c=document.getElementById("cmd");c.value="Plan the week";document.getElementById("cmd-form").requestSubmit()');
  ok(await until(() => J('return !!document.querySelector("#gd-log .gd-tasks")')), 'Exusiai\'s suggested tasks show as a card');
  ok(/<regis_tasks>/.test(calls[calls.length - 1].system), 'Exusiai gets the open task list');
  await J('document.querySelector(\'#gd-log [data-act="gd-tasks"]\').click()');
  ok(await until(async () => JSON.stringify(await J('return await window.regisBridge.dbLoad()')).includes('Call three customers')), 'Add to my tasks puts them in Regis');
  ok(await J('return /<b>one<\\/b>/.test(document.getElementById("gd-log").innerHTML)&&!document.querySelector("#gd-log script")'), 'replies are rendered as safe Markdown');
  await J('document.querySelector(\'#gd-rail [data-id="regis"]\').click()'); await sleep(300);
  ok(await J('return !document.getElementById("app").classList.contains("gd-on")&&getComputedStyle(document.querySelector("main.grid")).display!=="none"'), 'Regis brings the normal workspace back');

  // ---- overlay ----
  await J('document.querySelector(\'#vsw [data-v="music"]\').click()'); await sleep(700);
  win.webContents.send('app:overlay', false); await sleep(300);
  ok(await J('var o=document.getElementById("rov");return o&&!o.hidden&&document.activeElement.id==="rov-in"'), 'the global shortcut opens the Regis overlay over any page, ready to type');
  await J('var i=document.getElementById("rov-in");i.value="@obsidian lava biome";document.getElementById("rov-form").requestSubmit()');
  ok(await until(() => J('return document.documentElement.dataset.view==="work"&&/Obsidian heard 1/.test(document.getElementById("gd-log").textContent)')), '"@obsidian …" in the overlay goes to Obsidian on the Workspace') || console.log('  view', await J('return document.documentElement.dataset.view+" | "+document.getElementById("gd-head").textContent+" | "+document.getElementById("gd-log").textContent.slice(0,300)'));
  await J('document.querySelector(\'#gd-rail [data-id="regis"]\').click()');
  await J('document.querySelector(\'#vsw [data-v="home"]\').click()'); await sleep(600);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '/' }); win.webContents.sendInputEvent({ type: 'char', keyCode: '/' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: '/' }); await sleep(300);
  ok(await J('return !document.getElementById("rov").hidden'), '/ opens it too');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await sleep(200);
  ok(await J('return document.getElementById("rov").hidden'), 'Escape closes it');

  // ---- camera / microphone ----
  await J('document.querySelector(\'#vsw [data-v="browser"]\').click()'); await sleep(1500);
  await J('await window.regisBridge.browser.open("https://meet.test/")');
  let mw; ok(await until(() => { mw = webContents.getAllWebContents().find((w) => /meet\.test/.test(w.getURL())); return mw && !mw.isLoading(); }), 'a meeting site opens');
  await sleep(600); mw.executeJavaScript('document.getElementById("b").click()', true);
  ok(await until(() => J('var b=document.getElementById("bw-perm");return !b.hidden&&/meet\\.test/.test(b.textContent)&&/camera and microphone/.test(b.textContent)')), 'its camera + microphone request asks you in a bar above the page');
  await J('document.querySelector(\'#bw-perm [data-act="bp-yes"]\').click()');
  ok(await until(() => mw.executeJavaScript('document.getElementById("r").textContent').then((t) => /^granted/.test(t))), 'Allow gives the site the camera and microphone');
  mw.executeJavaScript('document.getElementById("r").textContent="-";document.getElementById("b").click()', true);
  ok(await until(() => mw.executeJavaScript('document.getElementById("r").textContent').then((t) => /^granted/.test(t))) && await J('return document.getElementById("bw-perm").hidden'), 'the answer is remembered for that site') || console.log('  got', await mw.executeJavaScript('document.getElementById("r").textContent'), await J('return document.getElementById("bw-perm").hidden+" "+document.getElementById("bw-perm").textContent'));
  ok((await J('return await window.regisBridge.browser.perms()')).some((x) => x.host === 'meet.test' && x.video === 'allow'), 'and listed under Camera and microphone');

  // ---- alerts above the web page ----
  await J('await window.regisBridge.alertFloat.show([{id:"a1",label:"Event",title:"Standup",body:"Starts in 2 min",link:1,linkText:"Join call"}],{top:120,right:16,theme:{ac:"#ff2b3d"}})');
  let af; ok(await until(() => { af = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Regis alerts'); return af && af.isVisible(); }), 'an alert window shows above the web page');
  const ab = af.getBounds(), wb = win.getContentBounds();
  ok(ab.x + ab.width <= wb.x + wb.width && ab.y >= wb.y && ab.height > 60, 'inside the Regis window, top-right (' + [ab.x - wb.x, ab.y - wb.y, ab.width, ab.height] + ')');
  ok(await af.webContents.executeJavaScript('/Standup/.test(document.body.textContent)&&/Join call/.test(document.body.textContent)'), 'with the meeting and a Join button');
  await J('await window.regisBridge.alertFloat.show([],null)');
  ok(await until(() => !af.isVisible()), 'and it goes away when there are none');

  // ---- tab groups ----
  for (const h of ['p1', 'p2', 'p3']) await J('await window.regisBridge.browser.open("https://' + h + '.test/")');
  await sleep(1500);
  const ids = await J('return (await window.regisBridge.browser.state()).tabs.map(function(t){return t.id})');
  const [, , t2, t3] = ids.slice(-4); // the last three are p1..p3
  await J('localStorage.setItem("regis-tg",JSON.stringify({g:[{id:"g1",n:"Work",c:"#7aa2ff",k:0}],m:{"' + t2 + '":"g1","' + t3 + '":"g1"}}));location.reload()'); await sleep(5000);
  await J('document.querySelector(\'#vsw [data-v="browser"]\').click()'); await sleep(2000);
  const gh = await J('var h=document.querySelector("#bw-tabs .bw-gh");if(!h)return null;var r=h.getBoundingClientRect(),f=document.querySelector("#bw-tabs .bw-tab").getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,f.left+6]');
  ok(!!gh, 'the group shows as a header in the tab strip');
  if (gh) {
    win.webContents.sendInputEvent({ type: 'contextMenu', x: Math.round(gh[0]), y: Math.round(gh[1]) });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(gh[0]), y: Math.round(gh[1]), button: 'right', clickCount: 1 }); win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(gh[0]), y: Math.round(gh[1]), button: 'right', clickCount: 1 }); await sleep(400);
    ok(await J('var p=document.getElementById("bw-bmpop");return !p.hidden&&!!p.querySelector(\'[data-act="bwg-ren"]\')&&!!p.querySelector(\'[data-act="bwg-col"]\')'), 'right-clicking the group opens its menu (rename, colours, ungroup, close)');
    await J('document.querySelector(\'#bw-bmpop [data-act="bwg-ren"]\').click()'); await sleep(300);
    await J('document.getElementById("tg-rn").value="Clients";document.querySelector(\'form[data-tg-form="ren"]\').requestSubmit()'); await sleep(300);
    ok(await J('return /Clients/.test(document.querySelector("#bw-tabs .bw-gh").textContent)'), 'Rename renames it');
    const before = await J('return (await window.regisBridge.browser.state()).tabs.map(function(t){return t.id})');
    const x0 = Math.round(gh[0]), y0 = Math.round(gh[1]), x1 = Math.round(gh[2]);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 });
    for (let k = 1; k <= 12; k++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x0 + (x1 - x0) * k / 12), y: y0, button: 'left' }); await sleep(30); }
    win.webContents.sendInputEvent({ type: 'mouseUp', x: x1, y: y0, button: 'left', clickCount: 1 }); await sleep(1200);
    const after = await J('return (await window.regisBridge.browser.state()).tabs.map(function(t){return t.id})');
    ok(after[0] === t2 && after[1] === t3 && after.length === before.length, 'dragging the group to the front moves both its tabs there (' + before + ' -> ' + after + ')');
    ok(await J('var g=JSON.parse(localStorage.getItem("regis-tg")).g[0];return g.k===0'), 'and the drag does not fold the group');
  }

  // ---- address bar ----
  await J('var a=document.getElementById("bw-addr");a.blur();a.value="https://p1.test/"');
  const ar = await J('var r=document.getElementById("bw-addr").getBoundingClientRect();return [r.left+40,r.top+r.height/2]');
  win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(ar[0]), y: Math.round(ar[1]), button: 'left', clickCount: 1 }); win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(ar[0]), y: Math.round(ar[1]), button: 'left', clickCount: 1 }); await sleep(200);
  ok(await J('var a=document.getElementById("bw-addr");return a.selectionStart===0&&a.selectionEnd===a.value.length&&a.value.length>0'), 'the first click in the address bar selects the whole address');

  // ---- pixel transition into the Browser ----
  await J('document.querySelector(\'#vsw [data-v="home"]\').click()'); await sleep(900);
  await J('document.querySelector(\'#vsw [data-v="browser"]\').click()'); await sleep(90);
  console.log('(effects: '+await J('return document.documentElement.className')+')');
  const pxOn = await J('var p=document.getElementById("px");return !!p&&p.style.display==="block"');
  ok(pxOn || !(await J('return !window.matchMedia("(prefers-reduced-motion: reduce)").matches')), 'going into the Browser plays the pixel transition');
  await sleep(800);

  console.log(pass + ' passed, ' + fail + ' failed'); app.exit(fail ? 1 : 0);
});
