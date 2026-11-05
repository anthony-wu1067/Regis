'use strict';
const assert = require('assert'); const Sync = require('../core/sync.js'); const L = require('../core/localdb.js');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
let clock = 1000; const now = () => ++clock;
const drive = { text: null, writes: 0 };
const transport = { read: async () => drive.text, write: async (t) => { drive.text = t; drive.writes++; } };
function device(name, legacy) {
  const d = { name, state: legacy ? Sync.fromLegacy(legacy) : { docs: {} } };
  d.ldb = L.create({ state: d.state, now, persist: () => {}, onLocalWrite: () => d.eng.markDirty(1e9) });
  d.eng = new Sync.Engine({ getState: () => d.ldb.getState(), setState: (s) => d.ldb.replaceState(s), transport, now });
  d.db = d.ldb.db;
  d.list = async (c) => (await Promise.resolve(d.db.collection(c)._run())).docs.map((x) => Object.assign({ id: x.id }, x.data()));
  return d;
}
(async () => {
  const A = device('A'), B = device('B');
  // create on A, appears on B
  const id = A.db.collection('todos').doc().id;
  await A.db.doc('todos/' + id).set({ text: 'buy milk', done: false, due: '2026-11-05' });
  await A.eng.sync(); await B.eng.sync();
  let t = await B.list('todos'); ok(t.length === 1 && t[0].text === 'buy milk', 'todo reaches B');
  // concurrent edits to DIFFERENT fields both survive
  await A.db.doc('todos/' + id).update({ done: true });
  await B.db.doc('todos/' + id).update({ text: 'buy oat milk' });
  await A.eng.sync(); await B.eng.sync(); await A.eng.sync();
  t = await A.list('todos'); ok(t[0].done === true && t[0].text === 'buy oat milk', 'field-level merge: ' + JSON.stringify(t));
  ok(Sync.serialize(A.ldb.getState()) === Sync.serialize(B.ldb.getState()), 'both devices converge');
  // concurrent edits to SAME field: later wins on both
  await A.db.doc('todos/' + id).update({ text: 'first' });
  await B.db.doc('todos/' + id).update({ text: 'second' });
  await A.eng.sync(); await B.eng.sync(); await A.eng.sync();
  ok((await A.list('todos'))[0].text === 'second' && (await B.list('todos'))[0].text === 'second', 'later write wins');
  // delete propagates, and a stale device does not resurrect
  await B.db.doc('todos/' + id).delete(); await B.eng.sync(); await A.eng.sync();
  ok((await A.list('todos')).length === 0, 'delete propagates');
  await A.eng.sync(); ok((await B.list('todos')).length === 0, 'no resurrection');
  // removed field propagates (set without a key)
  const rid = 'r1'; await A.db.doc('rules/' + rid).set({ name: 'x', label: 'L', extra: 1 }); await A.eng.sync(); await B.eng.sync();
  await B.db.doc('rules/' + rid).set({ name: 'x', label: 'L' }); await B.eng.sync(); await A.eng.sync();
  ok(!('extra' in (await A.list('rules'))[0]), 'removed field propagates');
  // activity is device-local
  await A.db.doc('activity/a1').set({ text: 'local' }); await A.eng.sync(); await B.eng.sync();
  ok((await B.list('activity')).length === 0, 'activity stays local');
  ok(!/activity/.test(drive.text), 'activity not uploaded');
  // legacy import: existing desktop data on first sync merges with other device's data by union
  const C = device('C', { todos: { z1: { text: 'old desktop todo', done: false } }, settings: { main: { theme: 'x' } } });
  await C.eng.sync(); ok((await C.list('todos')).some((x) => x.id === 'z1') && (await C.list('rules')).length === 1, 'legacy data kept + remote pulled');
  await A.eng.sync(); ok((await A.list('todos')).some((x) => x.id === 'z1'), 'legacy data reaches others');
  // edit after legacy import beats imported value
  await A.db.doc('settings/main').update({ theme: 'new' }); await A.eng.sync(); await C.eng.sync();
  ok((await C.list('settings'))[0].theme === 'new', 'real edits beat imported values');
  // no needless writes
  const w = drive.writes; await A.eng.sync(); await B.eng.sync(); ok(drive.writes === w, 'idle sync writes nothing');
  // subscriptions fire after pull
  let fired = 0; B.db.collection('todos').onSnapshot(() => fired++); await new Promise((r) => setTimeout(r, 5));
  const f0 = fired; await A.db.doc('todos/n1').set({ text: 'n' }); await A.eng.sync(); await B.eng.sync(); await new Promise((r) => setTimeout(r, 5));
  ok(fired > f0, 'listeners notified by sync');
  // transport failure surfaces and recovers
  const rd = transport.read; transport.read = async () => { throw new Error('offline'); };
  let failed = false; try { await A.eng.sync(); } catch (_) { failed = true; } ok(failed && A.eng.status().state === 'error', 'error status');
  transport.read = rd; await A.eng.sync(); ok(A.eng.status().state === 'ok', 'recovers');
  // corrupted remote is refused, not overwritten
  const saved = drive.text; drive.text = '{"nope":1}'; let bad = false; try { await A.eng.sync(); } catch (_) { bad = true; } ok(bad && drive.text === '{"nope":1}', 'foreign file never overwritten'); drive.text = saved;
  // lost update heals
  const X = device('X'), Y = device('Y'); drive.text = null;
  await X.db.doc('todos/p').set({ text: 'p' }); await Y.db.doc('todos/q').set({ text: 'q' });
  const r1 = transport.read; const snap = null;
  await X.eng.sync(); const textAfterX = drive.text; transport.read = async () => null; await Y.eng.sync(); transport.read = r1; // Y overwrote X's write (simulated race)
  await X.eng.sync(); await Y.eng.sync(); ok((await Y.list('todos')).length === 2 && (await X.list('todos')).length === 2, 'lost update heals on next sync');
  // Drive transport through lib/google.js with an in-memory Drive
  const { Google } = require('../lib/google'); const files = {}; let nid = 0; const log = [];
  const R = (st, b, txt) => ({ ok: st < 400, status: st, json: async () => b, text: async () => txt !== undefined ? txt : JSON.stringify(b) });
  const fetchFn = async (url, init = {}) => { const u = new URL(url); const m = init.method || 'GET'; log.push(m + ' ' + u.pathname + u.search);
    if (u.hostname === 'oauth2.googleapis.com') return R(200, { access_token: 'AT', expires_in: 3600 });
    if (m === 'GET' && u.pathname === '/drive/v3/files' && !u.searchParams.get('alt')) { const q = u.searchParams.get('q'); const hit = Object.entries(files).filter(([, f]) => q.includes(f.name)).map(([id, f]) => ({ id, name: f.name })); return R(200, { files: hit }); }
    if (m === 'POST' && u.pathname === '/drive/v3/files') { const id = 'F' + (++nid); files[id] = { name: JSON.parse(init.body).name, text: '' }; return R(200, { id }); }
    if (m === 'PATCH' && u.pathname.startsWith('/upload/drive/v3/files/')) { files[decodeURIComponent(u.pathname.split('/').pop())].text = init.body; return R(200, {}); }
    if (m === 'GET' && u.searchParams.get('alt') === 'media') return R(200, null, files[decodeURIComponent(u.pathname.split('/').pop())].text);
    return R(404, { error: { message: 'no route ' + u.pathname } }); };
  const g = new Google({ creds: () => ({ clientId: 'i', clientSecret: 's', refreshToken: 'r' }), fetchFn });
  ok((await g.callTool('Google Drive', 'regis_sync_read', {})).text === null, 'no sync file yet');
  await g.callTool('Google Drive', 'regis_sync_write', { text: '{"a":1}' }); ok(Object.keys(files).length === 1, 'file created once');
  await g.callTool('Google Drive', 'regis_sync_write', { text: '{"a":2}' }); ok(Object.keys(files).length === 1 && (await g.callTool('Google Drive', 'regis_sync_read', {})).text === '{"a":2}', 'file updated in place and read back');
  // ---- over-the-air updater ----
  { const { Updater, sha } = require('../lib/updater'); const os = require('os'), fs = require('fs'), path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-')); const mk = (v, extra = {}) => { const files = { 'index.html': '<html>v' + v + '</html>', 'shim.js': '//' + v }; const o = {}; for (const [k, t] of Object.entries(files)) o[k] = { sha256: sha(Buffer.from(t)), b64: Buffer.from(t).toString('base64') }; return Object.assign({ version: v, minShell: 1, files: o }, extra); };
    let served = mk('1.0.1'); const f = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(served)) });
    const up = new Updater({ dir, bundledVersion: '1.0.0', fetchFn: f });
    ok(up.current() === null, 'no staged update at first');
    ok((await up.check('https://x.github.io/regis/')).status === 'staged' && up.current().version === '1.0.1', 'newer bundle is downloaded and verified');
    ok(fs.readFileSync(path.join(up.current().dir, 'index.html'), 'utf8') === '<html>v1.0.1</html>', 'files written');
    ok((await up.check('https://x.github.io/regis/')).status === 'current', 'same version: nothing to do');
    ok(up.pending('1.0.0') && up.pending('1.0.0').version === '1.0.1' && up.pending('1.0.1') === null, 'a downloaded bundle is still reported as pending until it is on screen');
    served = mk('1.0.2'); served.files['shim.js'].sha256 = '0'.repeat(64);
    let bad = null; try { await up.check('https://x.github.io/regis'); } catch (e) { bad = e; } ok(bad && bad.code === 'bad_hash' && up.current().version === '1.0.1', 'tampered bundle refused, old one kept');
    served = mk('1.1.0', { minShell: 2 }); ok((await up.check('https://x.github.io/regis/')).status === 'needs_installer', 'bundle needing a newer shell is not installed');
    fs.appendFileSync(path.join(up.current().dir, 'shim.js'), 'x'); ok(up.current() === null, 'corrupted staged files fall back to the built-in version');
    let e2 = null; try { await up.check('http://insecure.example/'); } catch (e) { e2 = e; } ok(e2 && e2.code === 'bad_url', 'http addresses refused');
    served = { version: '../evil', files: { 'index.html': {} } }; let e3 = null; try { await up.check('https://x.github.io/regis/'); } catch (e) { e3 = e; } ok(e3 && e3.code === 'bad_bundle', 'path tricks refused');
    const up2 = new Updater({ dir, bundledVersion: '1.0.1', fetchFn: f }); ok(up2.current() === null, 'bundle not newer than the app is ignored'); }
  // tombstone gc
  const S = { docs: { 'todos/g': { e: 1, d: 5, f: { a: 1 }, v: {} } } }; Sync.gc(S, 5 + 31 * 86400000); ok(!S.docs['todos/g'], 'old tombstones collected');
  // merge algebra
  const m1 = { docs: { 'a/1': { e: 5, d: 0, f: { x: 5 }, v: { x: 1 } } } }, m2 = { docs: { 'a/1': { e: 6, d: 0, f: { x: 6, y: 6 }, v: { x: 2, y: 3 } } } };
  ok(Sync.canon(Sync.merge(m1, m2)) === Sync.canon(Sync.merge(m2, m1)), 'merge commutative'); ok(Sync.canon(Sync.merge(m1, Sync.merge(m1, m2))) === Sync.canon(Sync.merge(m1, m2)), 'merge idempotent');
  console.log('sync tests passed: ' + n); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
