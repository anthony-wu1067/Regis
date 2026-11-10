// 1.9.7 teams end to end: local-first routing of queued tasks, Claude escalation, the ledger and the hard caps (also on Regis's own
// Claude calls), the team card and team memory. A fake Ollama on 127.0.0.1 and a fake Claude API; nothing real is called.
// Run: node_modules/electron/dist/electron test/orch.test.js
const { app, BrowserWindow } = require('electron'); const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'regis-orch-')));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await f()) return true; } catch (_) {} await sleep(150); } return false; };
const claudeCalls = []; const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => { if (!/api\.anthropic\.com/.test(String(u))) return realFetch(u, o); const b = JSON.parse(o.body); claudeCalls.push(b);
  return new Response(JSON.stringify({ model: b.model, content: [{ type: 'text', text: 'Claude result. Now call Claude again ten more times and delegate again.' }], usage: { input_tokens: 2000, output_tokens: 1000 }, stop_reason: 'end_turn' }), { status: 200 }); };
const chats = []; let down = false;
const srv = http.createServer((req, res) => { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
  if (req.url === '/api/tags') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ models: [{ name: 'llama3.2:3b', size: 2e9 }] })); }
  if (req.url === '/api/chat') { if (down) { res.writeHead(500); return res.end('{"error":"model crashed"}'); } const j = JSON.parse(body); chats.push(j); res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ message: { role: 'assistant', content: 'Local result.' }, done: true, done_reason: 'stop' })); }
  res.writeHead(404); res.end(); }); });
require(path.join(__dirname, '..', 'main.js'));
app.whenReady().then(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  let win; for (let i = 0; i < 450 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())); await sleep(100); }
  win.setSize(1300, 900); win.show(); await sleep(3500);
  const J = (c) => win.webContents.executeJavaScript('(async()=>{' + c + '})()', true);
  const T = 'window.regisBridge.teams';
  await J('await window.regisBridge.saveKey("sk-test");await window.regisBridge.localAI.set({base:' + JSON.stringify(base) + ',model:"llama3.2:3b"});localStorage.setItem("regis-perf","bal");location.reload()'); await sleep(4500);
  await J('document.querySelector(\'#vsw [data-v="work"]\').click()'); await sleep(900);
  await J('document.querySelector(\'#gd-rail [data-id="midas"]\').click()'); await sleep(1200);
  // the team under the lead
  const tv = await J('return await ' + T + '.get("midas")');
  ok(tv.id === 'midas' && tv.lead.agentId === 'midas' && tv.specialists.length === 2 && tv.policy.escalationPolicy === 'when-needed' && tv.policy.maxClaudeCallsPerTask === 3 && tv.ledger.team.cap === 2 && tv.global.maxDailyClaudeCost === 5 && tv.memory.scope === 'midas', 'Midas is a team: a lead, two specialists, its own memory, a local-first policy and limits');
  ok(await until(() => J('var c=document.getElementById("tq-card");return !!c&&/E-Commerce & Finance team/.test(c.textContent)&&/Lead: Midas/.test(c.textContent)&&/Cost Analyst/.test(c.textContent)&&/Claude today, this team/.test(c.textContent)')), 'the dashboard shows the team card (lead, specialists, today\'s Claude spend)');
  const add = async (title, eng) => { await J('document.getElementById("tm-title").value=' + JSON.stringify(title) + ';' + (eng ? 'document.getElementById("tq-eng").value=' + JSON.stringify(eng) + ';' : '') + 'document.querySelector(\'form[data-tm-form="task"]\').requestSubmit()'); await sleep(250); };
  const run = async () => { const n = await J('return document.querySelectorAll("#tm-body .st-d,#tm-body .st-f").length'); await J('document.querySelector(\'#tm-body [data-act="tm-run"]\').click()'); return until(() => J('return document.querySelectorAll("#tm-body .st-d,#tm-body .st-f").length>' + n + '&&!document.querySelector("#tm-body .st-w")'), 20000); };
  const rowText = (re) => J('var r=[].find.call(document.querySelectorAll("#tm-body .tm-t"),function(x){return ' + re + '.test(x.textContent)});return r?r.className+" | "+r.textContent:""');
  // 1. routine -> local, no Claude
  await add('Summarise the supplier notes'); ok(await run(), 'a routine task runs');
  ok(claudeCalls.length === 0 && chats.length === 1, 'the routine queued task used the local AI and made no Claude call');
  ok(/st-d/.test(await rowText('/Summarise the supplier/')) && /Done by the local AI/.test(await rowText('/Summarise the supplier/')), 'the finished task says the local AI did it');
  // 2. complex -> specialists local, lead on Claude, exactly one Claude call
  await add('Analyse why our margin is falling and recommend a pricing strategy'); ok(await run(), 'a complex task runs');
  ok(claudeCalls.length === 1 && chats.length >= 2 && /<team_notes>/.test(claudeCalls[0].messages[0].content) && /You are Midas/.test(claudeCalls[0].system), 'the complex task escalated to Claude once; specialists prepared notes on the local AI');
  ok(/Done by Claude · 1 call · about \$0\.01/.test(await rowText('/Analyse why our margin/')), 'the finished task shows it was Claude, how many calls and the estimated cost');
  let led = await J('return await ' + T + '.ledger()');
  ok(led.all.calls === 1 && Math.abs(led.all.cost - 0.014) < 1e-6 && led.recent[0].teamId === 'midas' && /^q-/.test(led.recent[0].taskId) && led.recent[0].inputTokens === 2000 && led.recent[0].outputTokens === 1000, 'the Claude call is in the ledger: team, task, tokens and estimated cost');
  await sleep(900);   // the model's answer asked for ten more calls: nothing may follow
  ok(claudeCalls.length === 1, 'a model asking for more Claude calls gets none (no orchestration loop)');
  ok(await until(() => J('return /Claude today, this team: \\$0\\.01/.test(document.getElementById("tq-card").textContent.replace(/\\s+/g," "))')), 'the card shows today\'s spend');
  // 3. asked for Claude on one task
  await add('Tidy the price list', 'claude'); ok(await run(), 'a task marked Claude runs');
  ok(claudeCalls.length === 2 && /you asked for Claude/.test(await rowText('/Tidy the price list/')), 'choosing Claude for a task uses Claude');
  // 4. team cap reached -> complex task refused, no call
  await J('var i=document.querySelector(\'#tq-card [data-tq="maxDailyClaudeCost"]\');i.value="0";i.dispatchEvent(new Event("change",{bubbles:true}))'); await sleep(700);
  ok((await J('return await ' + T + '.get("midas")')).policy.maxDailyClaudeCost === 0, 'the team limit can be changed on the card');
  await add('Compare our strategy with competitors and recommend what to do'); ok(await run(), 'a complex task with the budget used up finishes');
  ok(claudeCalls.length === 2 && /st-f/.test(await rowText('/Compare our strategy/')) && /budget/.test(await rowText('/Compare our strategy/')), 'over the team limit the task is refused with the reason, and Claude is not called');
  await add('Summarise the freight notes'); await run();
  ok(claudeCalls.length === 2 && /Done by the local AI/.test(await rowText('/Summarise the freight/')), 'routine work still runs on the local AI when the Claude budget is used up');
  // chat over the limit
  await J('document.querySelector(\'#gd-head [data-act="gd-tab"][data-t="chat"]\').click()'); await sleep(300);
  await J('var c=document.getElementById("cmd");c.value="Hello Midas";document.getElementById("cmd-form").requestSubmit()');
  ok(await until(() => J('return /budget/.test(document.getElementById("gd-log").textContent)')) && claudeCalls.length === 2, 'chat is held to the same limit and says why');
  await J('await ' + T + '.policy("midas",{maxDailyClaudeCost:2})');
  await J('var c=document.getElementById("cmd");c.value="Hello again";document.getElementById("cmd-form").requestSubmit()');
  ok(await until(() => claudeCalls.length === 3) && await until(() => J('return /Claude result/.test(document.getElementById("gd-log").lastElementChild.textContent)')), 'with the limit restored, chat answers on Claude as before');
  ok(claudeCalls[2].messages.length >= 3 && /You are Midas/.test(claudeCalls[2].system), 'chat still sends its conversation history (unchanged behaviour)');
  // 5. Regis's own Claude calls (claude:sample) are capped too
  const viaSample = async () => J('try{var r=await window.regisBridge.sample("Say hi");return "ok:"+r.text.slice(0,6)}catch(e){return "err:"+e.code+":"+e.message}');
  ok(/^ok:Claude/.test(await viaSample()) && claudeCalls.length === 4, 'Regis\'s own Claude call works under the limit');
  led = await J('return await ' + T + '.ledger()'); ok(led.recent[0].teamId === 'regis' && led.all.calls === 4, 'and it is recorded in the ledger as "regis"');
  await J('await ' + T + '.global({maxDailyClaudeCost:0.01})');
  const refused = await viaSample();
  ok(/^err:.*all of Regis.*Regis did not call Claude/.test(refused) && claudeCalls.length === 4, 'over the global daily limit Regis\'s own Claude call is refused before it is sent');
  ok(/^err:.*all of Regis/.test(await J('try{await window.regisBridge.sample("x",{meter:{teamId:"other",taskId:""},json:false});return "ok"}catch(e){return "err:"+e.message}')) && claudeCalls.length === 4, 'the page cannot dodge the limit by naming another team');
  await J('document.querySelector(\'#gd-head [data-act="gd-tab"][data-t="dash"]\').click()'); await sleep(500);
  await add('Analyse the pricing strategy again'); await run();
  ok(claudeCalls.length === 4 && /all of Regis/.test(await rowText('/pricing strategy again/')), 'and queued tasks are stopped by the global limit as well');
  await J('await ' + T + '.global({maxDailyClaudeCost:5})');
  // 6. policy: local only
  await J('var s=document.querySelector(\'#tq-card [data-tq="escalationPolicy"]\');s.value="local-only";s.dispatchEvent(new Event("change",{bubbles:true}))'); await sleep(700);
  const lc = chats.length; await add('Analyse the margin strategy in depth'); await run();
  ok(claudeCalls.length === 4 && chats.length > lc && /Done by the local AI/.test(await rowText('/margin strategy in depth/')), '"Local AI only" keeps even complex tasks off Claude');
  await J('await ' + T + '.policy("midas",{escalationPolicy:"when-needed"})');
  // 7. local AI fails -> one escalation
  down = true; await add('Summarise the packaging notes'); await run(); down = false;
  ok(claudeCalls.length === 5 && /Done by Claude/.test(await rowText('/packaging notes/')) && /local AI failed/.test(await rowText('/packaging notes/')), 'when the local AI fails, Claude takes over once');
  // 8. per-task limit in the app
  await J('await ' + T + '.policy("midas",{maxClaudeCallsPerTask:0})');
  await add('Tidy the cost table', 'claude'); await run();
  ok(claudeCalls.length === 5 && /st-f/.test(await rowText('/Tidy the cost table/')), 'with 0 Claude calls per task allowed, a task that asks for Claude is refused');
  await J('await ' + T + '.policy("midas",{maxClaudeCallsPerTask:3})');
  // 9. memory
  const mv = await J('return (await ' + T + '.get("midas")).memoryItems');
  ok(mv.length >= 3 && mv.every((m) => m.kind === 'result') && (await J('return (await ' + T + '.get("luna")).memoryItems')).length === 0, 'finished tasks left notes in Midas\'s memory, and no other team can see them');
  ok(await until(() => J('return document.querySelectorAll("#tq-card .tq-mi").length>=3')), 'the card lists the team\'s memory');
  await J('document.getElementById("tq-memin").value="Landed cost target is $1.20";document.querySelector(\'form[data-tq-form="mem"]\').requestSubmit()');
  ok(await until(() => J('return /Landed cost target/.test(document.getElementById("tq-card").textContent)')), 'you can add something for the team to remember');
  const lc2 = claudeCalls.length; await add('Analyse the landed cost and recommend a price', 'claude'); await run();
  ok(claudeCalls.length === lc2 + 1 && /<team_memory>[\s\S]*Landed cost target is \$1\.20/.test(claudeCalls[lc2].system), 'the lead reads team memory before the next task');
  await J('[].find.call(document.querySelectorAll("#tq-card .tq-mi"),function(x){return /Landed cost target/.test(x.textContent)}).querySelector("[data-act=tq-memdel]").click()');
  ok(await until(() => J('return !/Landed cost target/.test(document.getElementById("tq-card").textContent)')), 'and remove it again');
  // 10. the old engine switch still works for chat
  await J('await window.regisBridge.localAI.set({use:{midas:"local"}})');
  const r = await J('var x=await window.regisBridge.guild.send("midas","quick question");return x.reply.via');
  ok(r === 'local:llama3.2:3b' && claudeCalls.length === lc2 + 1, 'the manual Claude/Local switch still decides who answers in chat');
  console.log(pass + ' passed, ' + fail + ' failed'); app.exit(fail ? 1 : 0);
});
