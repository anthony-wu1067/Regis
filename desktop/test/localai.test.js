// 1.9.4 local AI: a fake Ollama on 127.0.0.1 (no real models, no downloads) and a fake Claude API.
// Run: node_modules/electron/dist/electron test/localai.test.js
const { app, BrowserWindow } = require('electron'); const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'regis-lai-')));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch (_) {} await sleep(150); } return false; };
const claudeCalls = []; const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => { if (!/api\.anthropic\.com/.test(String(u))) return realFetch(u, o); const b = JSON.parse(o.body); claudeCalls.push(b);
  return new Response(JSON.stringify({ content: [{ type: 'text', text: 'claude says hi' }], usage: {}, stop_reason: 'end_turn' }), { status: 200 }); };
/* fake Ollama */
const models = []; const chats = []; let down = false;
const srv = http.createServer((req, res) => { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
  if (down) { res.writeHead(500); return res.end('{"error":"model crashed"}'); }
  if (req.url === '/api/tags') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ models: models.map((n) => ({ name: n, size: 2e9 })) })); }
  if (req.url === '/api/pull') { const j = JSON.parse(body); res.writeHead(200, { 'content-type': 'application/x-ndjson' }); let k = 0;
    const t = setInterval(() => { k += 25; res.write(JSON.stringify({ status: 'pulling', total: 100, completed: k }) + '\n'); if (k >= 100) { clearInterval(t); models.push(j.name); res.end(JSON.stringify({ status: 'success' }) + '\n'); } }, 120); return; }
  if (req.url === '/api/chat') { const j = JSON.parse(body); chats.push(j); res.writeHead(200, { 'content-type': 'application/json' });
    const sys = (j.messages.find((m) => m.role === 'system') || {}).content || ''; const who = (sys.match(/You are (\w+)/) || [])[1] || 'plain';
    return res.end(JSON.stringify({ message: { role: 'assistant', content: j.format === 'json' ? '{"action":"add_todo","title":"Buy matcha","due":"","prio":2}' : 'local ' + who + ' reply' }, done: true, done_reason: 'stop' })); }
  res.writeHead(404); res.end(); }); });
require(path.join(__dirname, '..', 'main.js'));
app.whenReady().then(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  let win; for (let i = 0; i < 450 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())); await sleep(100); }
  win.setSize(1300, 860); win.show(); await sleep(3500);
  const J = (c) => win.webContents.executeJavaScript('(async()=>{' + c + '})()', true);
  const L = 'window.regisBridge.localAI';
  await J('await window.regisBridge.saveKey("sk-test")');
  ok((await J('return await ' + L + '.set({base:"http://evil.example:11434"})')).base === 'http://127.0.0.1:11434', 'only addresses on this computer are accepted');
  await J('await ' + L + '.set({base:' + JSON.stringify(base) + '})');
  let st = await J('return await ' + L + '.status()');
  ok(st.running && st.models.length === 0 && st.suggest.length >= 3, 'Regis finds Ollama running with no models yet, and suggests some');
  await J('document.querySelector(\'#lai-body [data-act="lai-check"]\').click()'); await sleep(600);
  ok(await J('return /Ollama is running/.test(document.getElementById("lai-status").textContent)&&!!document.querySelector(\'#lai-body [data-act="lai-pull"][data-n="llama3.2:3b"]\')'), 'Setup shows it and offers downloads');
  await J('document.querySelector(\'#lai-body [data-act="lai-pull"][data-n="llama3.2:3b"]\').click()');
  ok(await until(() => J('return !!document.getElementById("lai-model")&&document.getElementById("lai-model").value==="llama3.2:3b"')), 'Download fetches the model and picks it');
  st = await J('return await ' + L + '.status()');
  ok(st.prefs.model === 'llama3.2:3b', 'the model is saved as the local model');
  await J('var c=document.querySelector(\'[data-lai-use="midas"]\');c.checked=true;c.dispatchEvent(new Event("change",{bubbles:true}))'); await sleep(400);
  ok((await J('return await ' + L + '.status()')).prefs.use.midas === 'local', 'ticking Midas makes him use the local AI');
  const t = await J('return await ' + L + '.test()');
  ok(/local plain reply/.test(t.text), 'Test the local AI gets an answer (' + t.text + ')');
  // agent chat
  await J('document.querySelector(\'#vsw [data-v="work"]\').click()'); await sleep(800);
  await J('document.querySelector(\'#gd-rail [data-id="midas"]\').click()'); await sleep(500);
  ok(await J('return /Local/.test((document.querySelector("#gd-head .gd-eng")||{}).textContent||"")'), 'Midas\'s chat shows he is on the local AI');
  const c0 = claudeCalls.length;
  await J('var c=document.getElementById("cmd");c.value="margins?";document.getElementById("cmd-form").requestSubmit()');
  ok(await until(() => J('return /local Midas reply/.test(document.getElementById("gd-log").textContent)')), 'Midas answers from the local AI, with his persona');
  ok(claudeCalls.length === c0 && /15,000-unit/.test(chats[chats.length - 1].messages[0].content), 'nothing went to Claude, and the persona went to the local model');
  ok(await J('return /Answered by the local AI/.test(document.getElementById("gd-log").textContent)'), 'the reply says it came from the local AI');
  // fallback
  down = true;
  await J('var c=document.getElementById("cmd");c.value="again";document.getElementById("cmd-form").requestSubmit()');
  ok(await until(() => J('return /claude says hi/.test(document.getElementById("gd-log").textContent)')), 'if the local AI fails, Claude answers instead');
  ok(await J('return /local AI failed/.test(document.getElementById("gd-log").textContent)'), 'and the reply says why');
  down = false;
  // switch back from the chat header
  await J('document.querySelector("#gd-head .gd-eng").click()'); await sleep(500);
  ok((await J('return await ' + L + '.status()')).prefs.use.midas === 'claude' && await J('return /Claude/.test(document.querySelector("#gd-head .gd-eng").textContent)'), 'the header button switches Midas back to Claude');
  // Regis's own commands
  await J('await ' + L + '.set({use:{regis:"local"}})'); const n0 = chats.length, c1 = claudeCalls.length;
  await J('document.querySelector(\'#gd-rail [data-id="regis"]\').click()'); await sleep(300);
  await J('var c=document.getElementById("cmd");c.value="remind me to buy matcha";document.getElementById("cmd-form").requestSubmit()');
  ok(await until(() => J('return /Buy matcha/.test(document.getElementById("cmd-out").textContent)')), 'tell Regis can use the local AI too');
  ok(chats.length > n0 && chats[chats.length - 1].format === 'json' && claudeCalls.length === c1, 'it asked the local model for JSON and not Claude');
  srv.close(); console.log(pass + ' passed, ' + fail + ' failed'); app.exit(fail ? 1 : 0);
});
