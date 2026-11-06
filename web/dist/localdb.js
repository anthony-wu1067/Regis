/* Regis local database: the same surface as claude.ai's `db` capability (collection/doc/query/onSnapshot), stored as
   RegisSync state so every write is merge-able across devices. UMD: exposes RegisLocalDb.create(opts). */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(require('./sync.js')); else root.RegisLocalDb = factory(root.RegisSync); })(typeof self !== 'undefined' ? self : this, function (Sync) {
  'use strict';
  /* opts: { state: Sync state, persist(state), now(), onLocalWrite() } */
  function create(opts) {
    var S = opts.state, subs = [], now = opts.now || Date.now;
    function tick() { var t = now(); if (t <= tick.last) t = tick.last + 1; tick.last = t; return t; }
    tick.last = 0;
    function rid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
    function split(path) { var i = path.indexOf('/'); return [path.slice(0, i), path.slice(i + 1)]; }
    function rec(path, make) { var r = S.docs[path]; if (!r && make) r = S.docs[path] = Sync.blank(); return r; }
    function wrote(coll) { opts.persist && opts.persist(S); opts.onLocalWrite && opts.onLocalWrite(); notify(coll); }
    function notify(coll) { subs.slice().forEach(function (s) { if (!coll || s.c === coll) s.run(); }); }
    function valuesOf(path) { var r = S.docs[path]; return Sync.alive(r) ? Sync.clone(r.v) : undefined; }
    function snapDoc(c, id) { return { id: id, exists: true, data: function () { return valuesOf(c + '/' + id); } }; }
    function ids(c) { var pre = c + '/'; return Object.keys(S.docs).filter(function (p) { return p.indexOf(pre) === 0 && p.indexOf('/', pre.length) < 0 && Sync.alive(S.docs[p]); }).map(function (p) { return p.slice(pre.length); }); }

    function applySet(path, data, replace) {
      var r = rec(path, true), t = tick(), keys = Object.keys(data || {});
      if (!Sync.alive(r)) { r.v = {}; }              // resurrecting / creating: start from a clean value set
      keys.forEach(function (k) { if (data[k] === undefined) return; var nv = Sync.clone(data[k]);
        if (!(k in r.v) || Sync.canon(r.v[k]) !== Sync.canon(nv) || !r.f[k]) { r.v[k] = nv; r.f[k] = t; } });
      if (replace) Object.keys(r.v).forEach(function (k) { if (!(k in data) || data[k] === undefined) { delete r.v[k]; r.f[k] = t; } });
      r.e = t; if (r.d >= r.e) r.e = r.d + 1;
    }
    function docRef(path) {
      var sp = split(path), c = sp[0], id = sp[1];
      return {
        id: id, path: path,
        set: function (d) { return Promise.resolve().then(function () { applySet(path, d, true); wrote(c); }); },
        update: function (d) { return Promise.resolve().then(function () { if (!Sync.alive(S.docs[path])) { var e = new Error('not found'); e.code = 'not_found'; throw e; } applySet(path, d, false); wrote(c); }); },
        delete: function () { return Promise.resolve().then(function () { var r = S.docs[path]; if (r) { r.d = Math.max(tick(), r.e + 1); r.v = {}; wrote(c); } }); },
        get: function () { return Promise.resolve().then(function () { return Sync.alive(S.docs[path]) ? snapDoc(c, id) : { id: id, exists: false, data: function () { return undefined; } }; }); },
        acquire: function (o) { return Promise.resolve().then(function () { var cur = valuesOf(path), n = now(); if (cur && cur.until > n && cur.holder !== o.holder) { var e = new Error('held'); e.code = 'lock_held'; throw e; } applySet(path, { holder: o.holder, until: n + (o.ttlMs || 30000) }, true); wrote(c); }); },
        release: function () { return Promise.resolve().then(function () { var r = S.docs[path]; if (r) { r.d = Math.max(tick(), r.e + 1); r.v = {}; wrote(c); } }); }
      };
    }
    function query(c, q) {
      q = q || { order: null, lim: 0, wh: [] };
      return {
        orderBy: function (f, d) { return query(c, Object.assign({}, q, { order: [f, d || 'asc'] })); },
        limit: function (n) { return query(c, Object.assign({}, q, { lim: n })); },
        where: function (f, op, v) { return query(c, Object.assign({}, q, { wh: q.wh.concat([[f, op, v]]) })); },
        doc: function (id) { return docRef(c + '/' + (id || rid())); },
        _run: function () {
          var rows = ids(c);
          q.wh.forEach(function (w) { rows = rows.filter(function (id) { var v = S.docs[c + '/' + id].v[w[0]]; return w[1] === '==' ? v === w[2] : w[1] === '!=' ? v !== w[2] : true; }); });
          if (q.order) { var f = q.order[0], s = q.order[1] === 'desc' ? -1 : 1; rows.sort(function (a, b) { var x = S.docs[c + '/' + a].v[f], y = S.docs[c + '/' + b].v[f]; return (x < y ? -1 : x > y ? 1 : 0) * s; }); }
          if (q.lim) rows = rows.slice(0, q.lim);
          return { docs: rows.map(function (id) { return snapDoc(c, id); }) };
        },
        onSnapshot: function (ok, bad) {
          var self = this, s = { c: c, run: function () { try { ok(self._run()); } catch (e) { if (bad) bad(e); } } };
          subs.push(s); setTimeout(function () { s.run(); }, 0);
          return function () { subs = subs.filter(function (x) { return x !== s; }); };
        }
      };
    }
    return {
      db: { collection: function (n) { return query(n); }, doc: docRef },
      replaceState: function (next) { S = next; notify(); },     // after a sync merge: re-run every listener
      getState: function () { return S; }
    };
  }
  return { create: create };
});
