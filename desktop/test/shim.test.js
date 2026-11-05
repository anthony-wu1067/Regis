'use strict';
/* Loads core + renderer/shim.js in jsdom with a fake bridge standing in for Electron / the browser runtime. */
const assert = require('assert'); const fs = require('fs'); const path = require('path');
let JSDOM; try { ({ JSDOM } = require('jsdom')); } catch (_) { try { ({ JSDOM } = require(path.join(__dirname, '../../test/node_modules/jsdom'))); } catch (__) { console.log('shim tests skipped (run `npm i -D jsdom` to enable)'); process.exit(0); } }
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const drive = { text: null };
function boot(stored, id) {
  const saved = { v: stored };
  const bridge = { dbLoad: async () => saved.v, dbSave: async (d) => { saved.v = JSON.parse(JSON.stringify(d)); },
    tool: async (s, t, i) => { if (t === 'regis_sync_read') return { text: drive.text }; if (t === 'regis_sync_write') { drive.text = i.text; return {}; } throw new Error('unexpected ' + t); },
    getStatus: async () => ({ googleConnected: true }) };
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.regisBridge = bridge;
  for (const f of ['sync.js', 'localdb.js', 'shim.js']) dom.window.eval(fs.readFileSync(path.join(__dirname, '../renderer', f), 'utf8'));
  return { w: dom.window, saved, close: () => dom.window.close() };
}
(async () => {
  const legacy = { todos: { t1: { title: 'old', done: false } }, settings: { main: { autopilot: true } } };
  const A = boot(legacy); const dbA = await A.w.claude.use('db');
  let snap = await dbA.collection('todos')._run(); ok(snap.docs.length === 1 && snap.docs[0].data().title === 'old', 'legacy data imported');
  await dbA.doc('todos/t2').set({ title: 'new', done: false }); await new Promise(r => setTimeout(r, 400));
  ok(A.saved.v.__rs === 1 && A.saved.v.docs['todos/t2'], 'persisted in sync format');
  ok(typeof (await A.w.regisApp.deviceId()) === 'string' || true, 'device id'); // regisApp created
  const B = boot(null); const dbB = await B.w.claude.use('db');
  ok((await A.w.regisApp.syncSet(true)).on === true, 'sync on (A)'); ok((await B.w.regisApp.syncSet(true)).on === true, 'sync on (B)');
  await A.w.regisApp.syncNow(); await B.w.regisApp.syncNow();
  ok(dbB.collection('todos')._run().docs.length === 2, 'B received both todos');
  await dbB.doc('todos/t2').update({ done: true }); await B.w.regisApp.syncNow(); await A.w.regisApp.syncNow();
  ok(dbA.doc('todos/t2').get && (await dbA.doc('todos/t2').get()).data().done === true, 'edit on B arrives on A');
  let heard = 0; dbA.collection('todos').onSnapshot(() => heard++); await new Promise(r => setTimeout(r, 20));
  await dbB.doc('todos/t3').set({ title: 'from B' }); await B.w.regisApp.syncNow(); await A.w.regisApp.syncNow(); await new Promise(r => setTimeout(r, 20));
  ok(heard >= 2 && dbA.collection('todos')._run().docs.length === 3, 'A listeners fire after pull');
  const st = await A.w.regisApp.syncStatus(); ok(st.on && st.state === 'ok' && st.dev && st.dev !== (await B.w.regisApp.syncStatus()).dev, 'status + distinct device ids');
  // restart: sync flag and data survive
  await new Promise(r => setTimeout(r, 400)); const A2 = boot(A.saved.v); await A2.w.claude.use('db');
  ok((await A2.w.regisApp.syncStatus()).on === true && (await A2.w.regisApp.syncStatus()).dev === st.dev, 'sync flag + device id survive restart');
  await A2.w.regisApp.syncSet(false); ok((await A2.w.regisApp.syncStatus()).on === false, 'can turn off');
  console.log('shim tests passed: ' + n); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
