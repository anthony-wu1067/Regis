'use strict';
/* The floating chat window's title bar: four buttons and the app's name/unread count. Nothing else is exposed. */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('regisFloat', {
  act: (a) => { if (['min', 'restore', 'open', 'close'].includes(a)) ipcRenderer.send('cmf:act', a); },
  onState: (cb) => { ipcRenderer.on('cmf:state', (_e, s) => { try { cb(s); } catch (_) {} }); }
});
