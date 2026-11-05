'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = async (ch, ...a) => { const r = await ipcRenderer.invoke(ch, ...a); if (r && r.ok) return r.value; const e = new Error((r && r.error && r.error.message) || 'Something went wrong'); e.code = r && r.error && r.error.code; throw e; };
contextBridge.exposeInMainWorld('regisBridge', {
  dbLoad: () => call('db:load'), dbSave: (db) => call('db:save', db),
  tool: (server, tool, input) => call('mcp:call', server, tool, input),
  sample: (input, opts) => call('claude:sample', input, opts),
  getStatus: () => call('app:status'), saveGoogle: (v) => call('app:saveGoogle', v), connectGoogle: () => call('app:connectGoogle'),
  disconnectGoogle: () => call('app:disconnectGoogle'), saveCanvas: (v) => call('app:saveCanvas', v), removeCanvas: () => call('app:removeCanvas'), saveKey: (k) => call('app:saveKey', k), setOpenAtLogin: (b) => call('app:openAtLogin', b),
  notify: (title, body) => call('app:notify', title, body),
  saveUpdateUrl: (u) => call('app:saveUpdateUrl', u), updateCheck: () => call('app:updateCheck'), updateApply: () => call('app:updateApply'),
  onUpdate: (cb) => { ipcRenderer.on('update:ready', (_e, v) => { try { cb(String(v)); } catch (_) {} }); },
  browser: {
    state: () => call('browser:state'), open: (u) => call('browser:open', u), close: (id) => call('browser:close', id), activate: (id) => call('browser:activate', id),
    go: (id, text) => call('browser:go', id, text), back: (id) => call('browser:back', id), forward: (id) => call('browser:forward', id), reload: (id) => call('browser:reload', id), stop: (id) => call('browser:stop', id),
    fill: (id, user, pass) => call('browser:fill', id, user, pass), onCred: (cb) => { ipcRenderer.on('browser:cred', (_e, c) => { try { cb(c); } catch (_) {} }); },
    bounds: (b) => call('browser:bounds', b), show: (v) => call('browser:show', v), shield: (on) => call('browser:shield', on),
    onState: (cb) => { ipcRenderer.on('browser:state', (_e, s) => { try { cb(s); } catch (_) {} }); }
  },
  setMini: (on) => call('app:mini', on), getMini: () => call('app:miniState'),
  onMini: (cb) => { ipcRenderer.on('mini:state', (_e, on) => { try { cb(!!on); } catch (_) {} }); },
  onCapture: (cb) => { ipcRenderer.on('capture:add', (_e, list) => { (Array.isArray(list) ? list : []).forEach((t) => { try { cb(String(t)); } catch (_) {} }); }); }
});
