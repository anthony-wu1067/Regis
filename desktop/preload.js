'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = async (ch, ...a) => { const r = await ipcRenderer.invoke(ch, ...a); if (r && r.ok) return r.value; const e = new Error((r && r.error && r.error.message) || 'Something went wrong'); e.code = r && r.error && r.error.code; throw e; };
contextBridge.exposeInMainWorld('regisBridge', {
  dbLoad: () => call('db:load'), dbSave: (db) => call('db:save', db),
  tool: (server, tool, input) => call('mcp:call', server, tool, input),
  sample: (input, opts) => call('claude:sample', input, opts),
  getStatus: () => call('app:status'), saveGoogle: (v) => call('app:saveGoogle', v), connectGoogle: () => call('app:connectGoogle'),
  disconnectGoogle: () => call('app:disconnectGoogle'), saveCanvas: (v) => call('app:saveCanvas', v), removeCanvas: () => call('app:removeCanvas'), saveKey: (k) => call('app:saveKey', k), setOpenAtLogin: (b) => call('app:openAtLogin', b),
  fullscreen: (on) => call('win:fullscreen', on), fsState: () => call('win:fsState'), onFullscreen: (cb) => { ipcRenderer.on('win:fs', (_e, v) => { try { cb(!!v); } catch (_) {} }); },
  notify: (title, body) => call('app:notify', title, body),
  spotifyAuth: (url) => call('spotify:auth', url), drm: () => call('app:drm'),
  vaultKey: { get: () => call('vault:keyGet'), set: (k) => call('vault:keySet', k) },
  favicon: (u) => call('app:favicon', u),
  linkMode: (inApp) => call('app:linkMode', inApp), onLink: (cb) => { ipcRenderer.on('app:link', (_e, u) => { try { cb(String(u)); } catch (_) {} }); },
  onVis: (cb) => { ipcRenderer.on('win:vis', (_e, v) => { try { cb(!!v); } catch (_) {} }); },
  saveUpdateUrl: (u) => call('app:saveUpdateUrl', u), updateCheck: () => call('app:updateCheck'), updateApply: () => call('app:updateApply'),
  onUpdate: (cb) => { ipcRenderer.on('update:ready', (_e, v) => { try { cb(String(v)); } catch (_) {} }); },
  browser: {
    state: () => call('browser:state'), open: (u) => call('browser:open', u), close: (id) => call('browser:close', id), activate: (id) => call('browser:activate', id),
    go: (id, text) => call('browser:go', id, text), back: (id) => call('browser:back', id), forward: (id) => call('browser:forward', id), reload: (id) => call('browser:reload', id), stop: (id) => call('browser:stop', id),
    onKey: (cb) => { ipcRenderer.on('browser:key', (_e, k) => { try { cb(k); } catch (_) {} }); },
    fill: (id, user, pass) => call('browser:fill', id, user, pass), onCred: (cb) => { ipcRenderer.on('browser:cred', (_e, c) => { try { cb(c); } catch (_) {} }); },
    bounds: (b) => call('browser:bounds', b), show: (v, snap) => call('browser:show', v, snap), shield: (on) => call('browser:shield', on),
    onState: (cb) => { ipcRenderer.on('browser:state', (_e, s) => { try { cb(s); } catch (_) {} }); },
    move: (id, to) => call('browser:move', id, to), duplicate: (id) => call('browser:duplicate', id), reopen: () => call('browser:reopen'), mute: (id, on) => call('browser:mute', id, on),
    find: (id, t, o) => call('browser:find', id, t, o), stopFind: (id) => call('browser:stopFind', id), print: (id) => call('browser:print', id), zoom: (id, lv) => call('browser:zoom', id, lv),
    sleep: (id) => call('browser:sleep', id), setSleep: (m) => call('browser:setSleep', m), viewKeys: (k) => call('browser:viewKeys', k),
    history: (q, n) => call('browser:history', q, n), historyDel: (u) => call('browser:historyDel', u), clear: (o) => call('browser:clear', o), fileGive: (t, c) => call('browser:fileGive', t, c),
    onFind: (cb) => { ipcRenderer.on('browser:find', (_e, r) => { try { cb(r); } catch (_) {} }); },
    onFilePick: (cb) => { ipcRenderer.on('browser:filepick', (_e, r) => { try { cb(r); } catch (_) {} }); },
    onDownloads: (cb) => { ipcRenderer.on('browser:downloads', (_e, l) => { try { cb(l); } catch (_) {} }); },
    onDlDone: (cb) => { ipcRenderer.on('browser:dldone', (_e, d) => { try { cb(d); } catch (_) {} }); }
  },
  office: { recent: () => call('office:recent'), open: (p) => call('office:open', p), show: (p) => call('office:show', p),
    /* 1.8.4: the desktop Word, Excel and PowerPoint docked inside Regis */
    dock: { apps: () => call('office:dockApps'), state: () => call('office:dockState'), show: (v, h, focus) => call('office:dockShow', !!v, h || 0, !!focus), bounds: (r) => call('office:dockBounds', r),
      create: (k) => call('office:dockNew', k), start: (k) => call('office:dockStart', k), pick: (k) => call('office:dockPick', k), open: (p) => call('office:dockOpen', p),
      close: (h) => call('office:dockClose', h), adopt: (h) => call('office:dockAdopt', h), release: (h) => call('office:dockRelease', h), focus: () => call('office:dockFocus'),
      onState: (cb) => { ipcRenderer.on('office:dock', (_e, s) => { try { cb(s); } catch (_) {} }); } } },
  downloads: { list: () => call('dl:list'), open: (id) => call('dl:open', id), show: (id) => call('dl:show', id), cancel: (id) => call('dl:cancel', id), pause: (id) => call('dl:pause', id), resume: (id) => call('dl:resume', id),
    remove: (id) => call('dl:remove', id), clear: () => call('dl:clear'), folder: () => call('dl:folder'), read: (id) => call('dl:read', id) },
  setMini: (on) => call('app:mini', on), getMini: () => call('app:miniState'),
  onMini: (cb) => { ipcRenderer.on('mini:state', (_e, on) => { try { cb(!!on); } catch (_) {} }); },
  onCapture: (cb) => { ipcRenderer.on('capture:add', (_e, list) => { (Array.isArray(list) ? list : []).forEach((t) => { try { cb(String(t)); } catch (_) {} }); }); }
});
