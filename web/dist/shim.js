/* Makes the page believe it is inside claude.ai: window.claude.use(db|mcp|sample|user|permissions) + window.regisApp. */
(function () {
  var B = window.regisBridge; if (!B) return;
  var Sync = window.RegisSync, LDB = window.RegisLocalDb;
  var core = null, loading = null, saveT = null, googleOk = false, meta = { syncOn: false, dev: '' }, engine = null, syncCbs = [];
  function persist() { clearTimeout(saveT); saveT = setTimeout(flush, 250); }
  function flush() { clearTimeout(saveT); if (!core) return; B.dbSave({ __rs: 1, docs: core.getState().docs, syncOn: meta.syncOn, dev: meta.dev }).catch(function () {}); }
  window.addEventListener('pagehide', flush); window.addEventListener('beforeunload', flush);
  function ready() {
    if (core) return Promise.resolve();
    return loading || (loading = B.dbLoad().then(function (d) {
      d = d || {}; var state;
      if (d.__rs === 1 && d.docs) { state = { docs: d.docs }; meta.syncOn = !!d.syncOn; meta.dev = d.dev || ''; }
      else state = Sync.fromLegacy(d);                      // first run after upgrading: import existing data
      if (!meta.dev) meta.dev = 'd' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
      core = LDB.create({ state: state, persist: persist, onLocalWrite: function () { if (engine && meta.syncOn) engine.markDirty(); } });
      engine = new Sync.Engine({
        getState: function () { return core.getState(); },
        setState: function (s) { core.replaceState(s); persist(); },
        transport: {
          read: function () { return B.tool('Google Drive', 'regis_sync_read', {}).then(function (r) { return r && r.text != null ? r.text : null; }); },
          write: function (t) { return B.tool('Google Drive', 'regis_sync_write', { text: t }); }
        },
        onStatus: function (st) { syncCbs.forEach(function (cb) { try { cb(fullStatus(st)); } catch (_) {} }); }
      });
      if (meta.syncOn) { engine.start(60000).catch(function () {}); }
      document.addEventListener('visibilitychange', function () { if (!document.hidden && meta.syncOn) engine.sync().catch(function () {}); });
      window.addEventListener('online', function () { if (meta.syncOn) engine.sync().catch(function () {}); });
      if (!persist.first) { persist.first = 1; persist(); }
    }));
  }
  function fullStatus(st) { st = st || (engine ? engine.status() : { state: 'off' }); return Object.assign({ on: meta.syncOn, dev: meta.dev }, st); }
  var dbApi = {
    collection: function (n) { return core.db.collection(n); },
    doc: function (p) { return core.db.doc(p); }
  };
  var db = dbApi;
  window.__regisReady = function () { return ready(); };
  var mcp = {
    callTool: function (server, tool, input) { return B.tool(server, tool, input || {}).then(function (v) { return { payload: v }; }); }
  };
  var sample = function (input, opts) { return B.sample(input, opts && { modelTier: opts.modelTier, model: opts.model }).then(function (r) { if (opts && opts.onText) { try { opts.onText({ text: r.text, delta: r.text }); } catch (_) {} } return r; }); };
  sample.json = function (input, opts) { return B.sample(input, Object.assign({}, opts && { modelTier: opts.modelTier, model: opts.model }, { json: true })).then(function (r) { return r.value; }); };
  sample.limits = function () { return Promise.resolve({ images: false }); };
  var user = { isOwner: function () { return Promise.resolve(true); }, canEdit: function () { return Promise.resolve(true); }, can: function () { return Promise.resolve(true); } };
  var perms = {
    state: function (name) { return B.getStatus().then(function (s) { googleOk = !!s.googleConnected; return name && String(name).indexOf('mcp:') === 0 ? (googleOk ? 'granted' : 'prompt') : 'granted'; }); },
    request: function () { return Promise.resolve({}); }, manage: function () { return Promise.resolve(); }
  };
  var caps = { db: db, mcp: mcp, sample: sample, user: user, permissions: perms };
  window.claude = { use: function (n) { return (n === 'db' ? ready() : Promise.resolve()).then(function () { return caps[n] || null; }); } };
  window.regisApp = {
    getStatus: B.getStatus, saveGoogle: B.saveGoogle, connectGoogle: B.connectGoogle, disconnectGoogle: B.disconnectGoogle,
    saveCanvas: B.saveCanvas, removeCanvas: B.removeCanvas, saveKey: B.saveKey, setOpenAtLogin: B.setOpenAtLogin, notify: B.notify, onCapture: B.onCapture, setMini: B.setMini, getMini: B.getMini, onMini: B.onMini,
    deviceId: function () { return ready().then(function () { return meta.dev; }); },
    syncStatus: function () { return ready().then(function () { return fullStatus(); }); },
    syncSet: function (on) { return ready().then(function () { meta.syncOn = !!on; flush(); if (on) return engine.start(60000).catch(function () {}).then(function () { return fullStatus(); }); engine.stop(); return fullStatus(); }); },
    syncNow: function () { return ready().then(function () { return engine.sync().then(function () { return fullStatus(); }); }); },
    onSync: function (cb) { syncCbs.push(cb); },
    snapshot: B.snapshot, saveUpdateUrl: B.saveUpdateUrl, updateCheck: B.updateCheck, updateApply: B.updateApply, onUpdate: B.onUpdate, openExternal: B.openExternal, spotifyAuth: B.spotifyAuth, drm: B.drm, vaultKey: B.vaultKey || null, onVis: B.onVis || null, favicon: B.favicon || null, downloads: B.downloads || null, office: B.office || null, ext: B.ext || null, comm: B.comm || null, fullscreen: B.fullscreen || null, fsState: B.fsState || null, onFullscreen: B.onFullscreen || null, linkMode: B.linkMode || null, onLink: B.onLink || null, browser: B.browser || null
  };
})();
