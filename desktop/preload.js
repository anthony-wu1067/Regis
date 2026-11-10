'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = async (ch, ...a) => { const r = await ipcRenderer.invoke(ch, ...a); if (r && r.ok) return r.value; const e = new Error((r && r.error && r.error.message) || 'Something went wrong'); e.code = r && r.error && r.error.code; throw e; };
contextBridge.exposeInMainWorld('regisBridge', {
  dbLoad: () => call('db:load'), dbSave: (db) => call('db:save', db),
  tool: (server, tool, input) => call('mcp:call', server, tool, input),
  sample: (input, opts) => call('claude:sample', input, opts),
  getStatus: () => call('app:status'), saveGoogle: (v) => call('app:saveGoogle', v), connectGoogle: () => call('app:connectGoogle'),
  disconnectGoogle: () => call('app:disconnectGoogle'), saveCanvas: (v) => call('app:saveCanvas', v), removeCanvas: () => call('app:removeCanvas'), saveKey: (k) => call('app:saveKey', k), setOpenAtLogin: (b) => call('app:openAtLogin', b),
  onGpuReset: (cb) => { ipcRenderer.on('app:gpuReset', () => { try { cb(); } catch (_) {} }); },
  fullscreen: (on) => call('win:fullscreen', on), fsState: () => call('win:fsState'), onFullscreen: (cb) => { ipcRenderer.on('win:fs', (_e, v) => { try { cb(!!v); } catch (_) {} }); },
  notify: (title, body) => call('app:notify', title, body),
  spotifyAuth: (url) => call('spotify:auth', url), drm: () => call('app:drm'),
  vaultKey: { get: () => call('vault:keyGet'), set: (k) => call('vault:keySet', k) },
  favicon: (u) => call('app:favicon', u),
  linkMode: (inApp) => call('app:linkMode', inApp), onLink: (cb) => { ipcRenderer.on('app:link', (_e, u) => { try { cb(String(u)); } catch (_) {} }); },
  onVis: (cb) => { ipcRenderer.on('win:vis', (_e, v) => { try { cb(!!v); } catch (_) {} }); },
  saveUpdateUrl: (u) => call('app:saveUpdateUrl', u), updateCheck: () => call('app:updateCheck'), updateApply: () => call('app:updateApply'),
  onUpdate: (cb) => { ipcRenderer.on('update:ready', (_e, v) => { try { cb(String(v)); } catch (_) {} }); },
  /* 1.9.1 Guild: AI workspaces (each agent has its own persona and its own history) */
  /* 1.9.4 local AI (Ollama) */
  localAI: { status: () => call('ai:localStatus'), set: (p) => call('ai:localSet', p), pull: (name) => call('ai:localPull', name), test: () => call('ai:localTry'), onPull: (cb) => { ipcRenderer.on('ai:pull', (_e, p) => { try { cb(p); } catch (_) {} }); } },
  teams: { get: (id) => call('team:get', id), policy: (id, p) => call('team:policy', id, p), global: (p) => call('team:global', p), run: (id, task, extra) => call('team:run', id, task, extra || {}), memAdd: (id, text) => call('team:memAdd', id, text), memDel: (id, mid) => call('team:memDel', id, mid), ledger: () => call('team:ledger') },
  guild: { agents: () => call('guild:agents'), history: (id) => call('guild:history', id), send: (id, text, extra) => call('guild:send', id, text, extra || {}), clear: (id) => call('guild:clear', id) },
  /* 1.9.1 the Regis overlay (global shortcut) and alerts that float above web pages */
  onOverlay: (cb) => { ipcRenderer.on('app:overlay', () => { try { cb(); } catch (_) {} }); },
  alertFloat: { show: (list, rect) => call('alert:float', list, rect || null), onAct: (cb) => { ipcRenderer.on('alert:act', (_e, a) => { try { cb(a); } catch (_) {} }); } },
  /* 1.8.9 Comm page: chat apps */
  comm: { state: () => call('comm:state'), add: (a) => call('comm:add', a), remove: (id, wipe) => call('comm:remove', id, !!wipe), mute: (id, on) => call('comm:mute', id, !!on), bg: (id, on) => call('comm:bg', id, !!on),
    reload: (id) => call('comm:reload', id), show: (v, id) => call('comm:show', !!v, id || null), bounds: (b) => call('comm:bounds', b), float: (id, min) => call('comm:float', id, min), overlay: (on) => call('comm:overlay', !!on),
    phoneLink: () => call('comm:phoneLink'), plInstalled: () => call('comm:plInstalled'), plState: () => call('comm:plState'), native: (v, r) => call('comm:native', !!v, r || null), plOpen: () => call('comm:plOpen'), onPl: (cb) => { ipcRenderer.on('comm:pl', (_e, s) => { try { cb(s); } catch (_) {} }); }, onOpen: (cb) => { ipcRenderer.on('comm:open', (_e, id) => { try { cb(String(id || '')); } catch (_) {} }); }, onState: (cb) => { ipcRenderer.on('comm:state', (_e, s) => { try { cb(s); } catch (_) {} }); } },
  /* 1.8.5 Chrome extensions in the Regis Browser */
  ext: { list: () => call('ext:list'), install: (link) => call('ext:install', link), installPick: (folder) => call('ext:installPick', !!folder), on: (id, v) => call('ext:on', id, !!v), remove: (id) => call('ext:remove', id),
    popup: (id, at) => call('ext:popup', id, at), options: (id) => call('ext:options', id), onList: (cb) => { ipcRenderer.on('ext:list', (_e, l) => { try { cb(l); } catch (_) {} }); }, onShowBrowser: (cb) => { ipcRenderer.on('ext:showBrowser', () => { try { cb(); } catch (_) {} }); } },
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
    onDlDone: (cb) => { ipcRenderer.on('browser:dldone', (_e, d) => { try { cb(d); } catch (_) {} }); },
    onPerm: (cb) => { ipcRenderer.on('browser:perm', (_e, p) => { try { cb(p); } catch (_) {} }); }, permAnswer: (id, allow, remember) => call('browser:permAnswer', id, !!allow, !!remember),
    perms: () => call('browser:perms'), permForget: (host) => call('browser:permForget', host)
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
