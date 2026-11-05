/* Regis sync core: a small CRDT-style store (per-field last-writer-wins with tombstones) plus the engine that
   exchanges it with a JSON file in the user's Google Drive. Pure and dependency-free (works in Node, Electron
   renderer, browsers and the iOS web view). UMD: exposes RegisSync. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.RegisSync = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DAY = 86400000, KEEP = 30 * DAY;
  var LOCAL_ONLY = ['activity'];                    // per-device log: not synced

  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function canon(x) {                               // stable stringify (sorted keys)
    if (x === null || typeof x !== 'object') return JSON.stringify(x);
    if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
    return '{' + Object.keys(x).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(x[k]); }).join(',') + '}';
  }
  /* doc record: { e: lastSetTime, d: deleteTime, f: {key: time}, v: {key: value} }.  Alive iff e > d. */
  function blank() { return { e: 0, d: 0, f: {}, v: {} }; }
  function alive(r) { return !!r && r.e > r.d; }
  function localOnly(path, lo) { return (lo || LOCAL_ONLY).indexOf(String(path).split('/')[0]) >= 0; }

  function mergeRec(a, b) {
    var o = { e: Math.max(a.e, b.e), d: Math.max(a.d, b.d), f: {}, v: {} };
    var keys = {}; Object.keys(a.f).forEach(function (k) { keys[k] = 1; }); Object.keys(b.f).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var ta = a.f[k] || 0, tb = b.f[k] || 0, win;
      if (ta > tb) win = a; else if (tb > ta) win = b;
      else { var sa = k in a.v ? canon(a.v[k]) : '\u0000', sb = k in b.v ? canon(b.v[k]) : '\u0000'; win = sa >= sb ? a : b; }   // tie: deterministic
      o.f[k] = Math.max(ta, tb);
      if (k in win.v) o.v[k] = clone(win.v[k]);
    });
    return o;
  }
  function merge(A, B) {                            // A, B: {docs:{path:rec}}; commutative, associative, idempotent
    var out = { docs: {} }, paths = {};
    Object.keys(A.docs).forEach(function (p) { paths[p] = 1; }); Object.keys(B.docs).forEach(function (p) { paths[p] = 1; });
    Object.keys(paths).forEach(function (p) { out.docs[p] = mergeRec(A.docs[p] || blank(), B.docs[p] || blank()); });
    return out;
  }
  function gc(S, now) {
    Object.keys(S.docs).forEach(function (p) {
      var r = S.docs[p];
      if (!alive(r) && r.d && now - r.d > KEEP) { delete S.docs[p]; return; }
      Object.keys(r.f).forEach(function (k) { if (!(k in r.v) && now - r.f[k] > KEEP) delete r.f[k]; });
    });
  }
  /* legacy {coll:{id:doc}} -> state (stamped at time 1 so any real edit wins) */
  function fromLegacy(db) {
    var S = { docs: {} };
    Object.keys(db || {}).forEach(function (c) { var col = db[c]; if (!col || typeof col !== 'object') return;
      Object.keys(col).forEach(function (id) { var d = col[id]; if (!d || typeof d !== 'object') return; var r = blank(); r.e = 1;
        Object.keys(d).forEach(function (k) { if (d[k] !== undefined) { r.f[k] = 1; r.v[k] = clone(d[k]); } }); S.docs[c + '/' + id] = r; }); });
    return S;
  }
  function parseRemote(text) {
    if (!text) return { docs: {} };
    var j = JSON.parse(text);
    if (!j || typeof j !== 'object' || !j.docs || typeof j.docs !== 'object') throw new Error('Sync file is not a Regis sync file');
    return { docs: j.docs };
  }
  function serialize(S, lo) {                       // what goes to Drive: everything except local-only collections
    var o = { regis: 'sync', v: 1, docs: {} };
    Object.keys(S.docs).forEach(function (p) { if (!localOnly(p, lo)) o.docs[p] = S.docs[p]; });
    return canon(o);
  }

  /* ---------- engine ---------- */
  /* opts: { getState(): state, setState(state), transport:{read():Promise<string|null>, write(text):Promise}, now(), onStatus(s), localOnly:[...] } */
  function Engine(opts) {
    this.o = opts; this.st = { state: 'off', last: 0, error: '', pushed: 0, pulled: 0 }; this.busy = null; this.dirty = false; this.t = null;
  }
  Engine.prototype.status = function () { return Object.assign({}, this.st); };
  Engine.prototype._set = function (p) { Object.assign(this.st, p); try { this.o.onStatus && this.o.onStatus(this.status()); } catch (_) {} };
  Engine.prototype.markDirty = function (delay) {   // local write happened: push soon
    var self = this; this.dirty = true; clearTimeout(this.t);
    this.t = setTimeout(function () { self.sync().catch(function () {}); }, delay === undefined ? 2500 : delay);
  };
  Engine.prototype.sync = function () {
    var self = this; if (this.busy) { this.again = true; return this.busy; }
    this._set({ state: 'syncing', error: '' });
    this.busy = (async function () {
      try {
        var lo = self.o.localOnly, now = self.o.now ? self.o.now() : Date.now();
        var remoteText = await self.o.transport.read();
        var remote = parseRemote(remoteText);
        var local = self.o.getState(), merged = merge(local, remote);
        gc(merged, now);
        var changedLocal = serialize(merged, lo) !== serialize(local, lo);
        self.dirty = false;
        if (changedLocal) { self.o.setState(merged); self._set({ pulled: self.st.pulled + 1 }); }
        var out = serialize(merged, lo);
        if (out !== (remoteText ? serialize(remote, lo) : '')) { await self.o.transport.write(out); self._set({ pushed: self.st.pushed + 1 }); }
        self._set({ state: 'ok', last: now, error: '' });
      } catch (e) { self._set({ state: 'error', error: (e && e.message) || String(e) }); throw e; }
      finally { self.busy = null; if (self.again) { self.again = false; self.markDirty(500); } }
    })();
    return this.busy;
  };
  Engine.prototype.start = function (pollMs) {
    var self = this; this.stop(); this._set({ state: 'idle' });
    this.poll = setInterval(function () { self.sync().catch(function () {}); }, pollMs || 60000);
    return this.sync();
  };
  Engine.prototype.stop = function () { clearInterval(this.poll); clearTimeout(this.t); this._set({ state: 'off', error: '' }); };

  return { blank: blank, alive: alive, merge: merge, mergeRec: mergeRec, gc: gc, fromLegacy: fromLegacy, parseRemote: parseRemote, serialize: serialize, canon: canon, clone: clone, localOnly: localOnly, Engine: Engine, LOCAL_ONLY: LOCAL_ONLY };
});
