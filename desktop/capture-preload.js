'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('captureBridge', {
  submit: (t) => ipcRenderer.invoke('capture:submit', t),
  close: () => ipcRenderer.invoke('capture:close')
});
