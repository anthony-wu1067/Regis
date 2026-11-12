'use strict';
/* 1.9.1 Alerts above web pages. Browser tabs, docked Office windows and Comm apps are native layers drawn over the Regis page,
   so a meeting alert in the page was hidden behind them. While one of those pages is showing, the page hands its alerts here and
   they are drawn in a small transparent child window that sits over the top-right of the Regis window. */
const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');
const W = 360;

class AlertFloat {
  constructor({ getWin, onAct }) {
    this.getWin = getWin; this.onAct = onAct; this.fw = null; this.state = null; this.h = 0; this.rect = null;
    ipcMain.on('alf:act', (e, id, a) => { if (!this.fw || e.sender !== this.fw.webContents) return; try { this.onAct({ id: String(id), a: String(a) }); } catch (_) {} });
    ipcMain.on('alf:size', (e, h) => { if (!this.fw || e.sender !== this.fw.webContents) return; this.h = Math.round(+h || 0); this.place(); });
  }
  /* list: [{id,kind,label,title,body,link,linkText}], theme colours; rect: the page's area to sit in (CSS pixels, top-right corner) */
  show(list, rect, theme) {
    list = Array.isArray(list) ? list.slice(0, 3).map((a) => ({ id: String(a.id || '').slice(0, 40), label: String(a.label || '').slice(0, 30), title: String(a.title || '').slice(0, 160), body: String(a.body || '').slice(0, 200), link: a.link ? '1' : '', linkText: String(a.linkText || '').slice(0, 30) })) : [];
    this.rect = rect && typeof rect === 'object' ? { top: Math.max(0, +rect.top || 0), right: Math.max(0, +rect.right || 0) } : this.rect;
    if (!list.length) { this.hide(); return false; }
    const win = this.getWin(); if (!win || win.isDestroyed()) return false;
    this.state = { list, theme: theme || {} }; clearTimeout(this.gone);
    if (!this.fw || this.fw.isDestroyed()) {
      this.fw = new BrowserWindow({ parent: win, width: W, height: 140, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
        skipTaskbar: true, hasShadow: false, show: false, focusable: true, backgroundColor: '#00000000', title: 'Regis alerts',
        webPreferences: { preload: path.join(__dirname, 'alert-float-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
      this.fw.setMenu(null);
      this.fw.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      this.fw.webContents.on('will-navigate', (e) => e.preventDefault());
      this.fw.on('closed', () => { this.fw = null; });
      this.fw.loadFile(path.join(__dirname, 'alert-float.html')).then(() => this._push()).catch(() => {});
    } else this._push();
    return true;
  }
  _push() { if (!this.fw || this.fw.isDestroyed() || !this.state) return; try { this.fw.webContents.send('alf:state', this.state); } catch (_) {} }
  place() {
    const win = this.getWin(), fw = this.fw; if (!fw || fw.isDestroyed() || !win || win.isDestroyed()) return;
    if (!this.h || !this.state || !win.isVisible() || win.isMinimized()) { if (fw.isVisible()) fw.hide(); return; }
    const c = win.getContentBounds(), r = this.rect || { top: 60, right: 16 };
    const x = Math.round(c.x + c.width - W - Math.max(8, r.right)), y = Math.round(c.y + Math.max(0, r.top));
    fw.setBounds({ x, y, width: W, height: Math.min(this.h, Math.max(80, c.height - r.top - 8)) });
    if (!fw.isVisible()) fw.showInactive();
  }
  follow() { if (this.fw && !this.fw.isDestroyed() && this.state) this.place(); }
  /* 1.9.10: hidden for a minute with nothing to show: close the window (its process goes with it); the next alert makes a new one */
  hide() { this.state = null; this.h = 0; if (this.fw && !this.fw.isDestroyed()) { try { this.fw.hide(); } catch (_) {} clearTimeout(this.gone); this.gone = setTimeout(() => { if (!this.state) this.destroy(); }, +process.env.REGIS_ALERT_IDLE_MS || 60000); } }
  destroy() { if (this.fw && !this.fw.isDestroyed()) { try { this.fw.destroy(); } catch (_) {} } this.fw = null; }
}
module.exports = { AlertFloat };
