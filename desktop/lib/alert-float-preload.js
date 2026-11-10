'use strict';
/* The alert float: receives the alerts to draw, sends back one of four actions or its height. Nothing else is exposed. */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('regisAlerts', {
  act: (id, a) => { if (['join', 'show', 'snooze', 'dismiss'].includes(a)) ipcRenderer.send('alf:act', String(id || '').slice(0, 40), a); },
  size: (h) => ipcRenderer.send('alf:size', Math.max(0, Math.min(900, +h || 0))),
  onState: (cb) => { ipcRenderer.on('alf:state', (_e, s) => { try { cb(s); } catch (_) {} }); }
});
