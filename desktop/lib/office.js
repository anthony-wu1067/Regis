'use strict';
/* Office dock (Windows): the real Word, Excel and PowerPoint desktop apps shown inside Regis.
   A small PowerShell helper (office-dock.ps1) takes the Office window's frame off, makes Regis its owner (so it stays on top of Regis,
   minimises with it and has no separate taskbar button) and keeps it over the Office page. Office itself runs as normal, so every
   ribbon command, dialog and keyboard shortcut is the real thing. When Regis quits, or the helper stops, the windows get their frames back. */
const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const { screen, shell, dialog } = require('electron');

const KINDS = {
  word: { exe: 'winword.exe', prog: 'Word.Application', ext: /\.(docx?|docm|dotx?|rtf|odt)$/i, filters: [{ name: 'Word documents', extensions: ['docx', 'doc', 'docm', 'rtf', 'odt', 'dotx'] }] },
  excel: { exe: 'excel.exe', prog: 'Excel.Application', ext: /\.(xlsx?|xlsm|xlsb|csv|ods|xltx?)$/i, filters: [{ name: 'Excel workbooks', extensions: ['xlsx', 'xls', 'xlsm', 'xlsb', 'csv', 'ods', 'xltx'] }] },
  powerpoint: { exe: 'powerpnt.exe', prog: 'PowerPoint.Application', ext: /\.(pptx?|pptm|ppsx?|potx?|odp)$/i, filters: [{ name: 'PowerPoint presentations', extensions: ['pptx', 'ppt', 'pptm', 'ppsx', 'potx', 'odp'] }] }
};
const kindOf = (p) => Object.keys(KINDS).find((k) => KINDS[k].ext.test(String(p || ''))) || null;
/* the program each app's App Paths registry key points at (null when not installed) */
function findExe(name) {
  try {
    for (const hive of ['HKLM', 'HKCU']) {
      const out = cp.execFileSync('reg.exe', ['query', hive + '\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\' + name, '/ve'], { encoding: 'utf8', windowsHide: true, timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
      const m = out.match(/REG_SZ\s+(.+)/); if (m) { const p = m[1].trim().replace(/^"|"$/g, ''); if (fs.existsSync(p)) return p; }
    }
  } catch (_) {}
  return null;
}

class OfficeDock {
  constructor(getWin, script) {
    this.getWin = getWin; this.script = script; this.ps = null; this.ready = null; this.n = 0; this.wait = new Map(); this.buf = '';
    this.docs = new Map();            // hwnd -> { h, k, pid, t, docked }
    this.active = 0; this.visible = false; this.rect = null; this.expect = null; this.onState = null; this.timer = 0; this.lastKey = '';
    this.exes = null;
  }
  available() { return process.platform === 'win32'; }
  apps() { if (!this.exes) { this.exes = {}; Object.keys(KINDS).forEach((k) => { this.exes[k] = findExe(KINDS[k].exe); }); } return this.exes; }
  _start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const ps = cp.spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      this.ps = ps; let ok = false;
      const fail = (e) => { if (!ok) reject(e); this._dead(); };
      ps.on('error', fail); ps.on('exit', () => fail(new Error('The Office helper stopped.')));
      ps.stderr.on('data', () => {});
      ps.stdout.setEncoding('utf8');
      ps.stdout.on('data', (d) => {
        this.buf += d; let i;
        while ((i = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); if (!line) continue;
          let o; try { o = JSON.parse(line); } catch (_) { continue; }
          if (o.ready) { ok = true; resolve(); continue; }
          const w = this.wait.get(o.id); if (w) { this.wait.delete(o.id); clearTimeout(w.t); if (o.r && o.r.err) w.no(new Error(o.r.err)); else w.yes(o.r); }
        }
      });
      setTimeout(() => { if (!ok) { try { ps.kill(); } catch (_) {} fail(new Error('The Office helper did not start.')); } }, 20000);
    });
    return this.ready;
  }
  _dead() { this.ps = null; this.ready = null; this.buf = ''; for (const w of this.wait.values()) { clearTimeout(w.t); w.no(new Error('The Office helper stopped.')); } this.wait.clear(); this.docs.forEach((d) => { d.docked = false; }); this._emit(); }
  async _cmd(o, ms) {
    await this._start(); if (!this.ps) throw new Error('The Office helper stopped.');
    o.id = ++this.n;
    return new Promise((yes, no) => { const t = setTimeout(() => { this.wait.delete(o.id); no(new Error('Office took too long to answer.')); }, ms || 15000); this.wait.set(o.id, { yes, no, t }); this.ps.stdin.write(JSON.stringify(o) + '\n'); });
  }
  _owner() { const w = this.getWin(); if (!w || w.isDestroyed()) return 0; const b = w.getNativeWindowHandle(); return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0); }
  /* stage rectangle (page pixels inside the window) -> physical screen pixels */
  _screenRect() {
    const w = this.getWin(); if (!w || w.isDestroyed() || !this.rect) return null;
    const cb = w.getContentBounds(), z = w.webContents.getZoomFactor ? w.webContents.getZoomFactor() : 1;
    const r = { x: Math.round(cb.x + this.rect.x * z), y: Math.round(cb.y + this.rect.y * z), width: Math.round(this.rect.width * z), height: Math.round(this.rect.height * z) };
    try { return screen.dipToScreenRect(w, r); } catch (_) { return r; }
  }
  state() {
    const docs = [...this.docs.values()].map((d) => ({ h: d.h, k: d.k, t: d.t, docked: d.docked }));
    return { apps: this.apps(), docs, active: this.active, visible: this.visible, waiting: this.expect ? this.expect.k : '' };
  }
  _emit() { const s = this.state(), key = JSON.stringify(s); if (key === this.lastKey) return; this.lastKey = key; if (this.onState) try { this.onState(s); } catch (_) {} }
  /* look at the open Office windows: dock new ones Regis opened (or that belong to an app already docked), drop closed ones */
  async scan() {
    if (!this.ps && !this.docs.size && !this.expect) return this.state();
    let list; try { list = await this._cmd({ op: 'list' }, 8000); } catch (_) { return this.state(); }
    const seen = new Set(), owner = this._owner();
    for (const w of list || []) {
      seen.add(w.h); let d = this.docs.get(w.h);
      const title = String(w.t || '').replace(/\s+[-–—]\s+(Word|Excel|PowerPoint)$/i, '').trim() || ({ word: 'Word', excel: 'Excel', powerpoint: 'PowerPoint' })[w.k];
      if (!d) {
        const mine = (this.expect && this.expect.k === w.k && Date.now() < this.expect.until && !this.expect.before.has(w.h)) || [...this.docs.values()].some((x) => x.docked && x.pid === w.pid);
        d = { h: w.h, k: w.k, pid: w.pid, t: title, docked: !!w.docked }; this.docs.set(w.h, d);
        if (mine && owner) { try { d.docked = !!(await this._cmd({ op: 'dock', h: w.h, owner })); } catch (_) {} if (d.docked) { this.active = w.h; if (this.expect && this.expect.k === w.k) this.expect = null; await this.place(true); } }
      } else { d.t = title; d.docked = !!w.docked; }
    }
    /* the last file of an app closed: if that app now has nothing open, let it quit instead of idling in the background */
    const had = {}; this.docs.forEach((d) => { if (d.docked) had[d.k] = 1; });
    for (const h of [...this.docs.keys()]) if (!seen.has(h)) { this.docs.delete(h); if (this.active === h) { const next = [...this.docs.values()].find((x) => x.docked); this.active = next ? next.h : 0; if (next) await this.place(false); } }
    Object.keys(had).forEach((k) => { if (![...this.docs.values()].some((d) => d.k === k)) this._cmd({ op: 'quitIdle', k }, 20000).catch(() => {}); });
    if (this.expect && Date.now() > this.expect.until) this.expect = null;
    /* Office keeps its own title bar now, so it could be dragged away: put it back */
    if (this.visible) await this.place(false);
    this._emit(); return this.state();
  }
  _loop() { clearTimeout(this.timer); const busy = this.visible || this.expect; if (!this.ps && !busy) return; this.timer = setTimeout(() => { this.scan().catch(() => {}).then(() => this._loop()); }, busy ? 800 : 4000); }
  /* show the active document over the stage (or hide them all) */
  async place(focus) {
    if (!this.ps) return false; const r = this._screenRect(); const w = this.getWin(); const winOk = w && !w.isDestroyed() && w.isVisible() && !w.isMinimized();
    for (const d of this.docs.values()) {
      if (!d.docked) continue; const show = this.visible && winOk && d.h === this.active && !!r;
      try { await this._cmd({ op: 'place', h: d.h, x: r ? r.x : 0, y: r ? r.y : 0, w: r ? r.width : 0, hh: r ? r.height : 0, show, focus: !!(show && focus) }); } catch (_) {}
    }
    return true;
  }
  async show(v, h, focus) { this.visible = !!v; if (h && this.docs.has(+h)) this.active = +h; if (this.visible) { await this._start(); if (!this.rescued) { this.rescued = true; await this.rescue(); await this.scan(); } } await this.place(!!focus); this._emit(); this._loop(); return this.state(); }
  bounds(r) { if (!r) return; const n = { x: Math.round(+r.x || 0), y: Math.round(+r.y || 0), width: Math.max(0, Math.round(+r.width || 0)), height: Math.max(0, Math.round(+r.height || 0)) }; const k = JSON.stringify(n); if (k === JSON.stringify(this.rect)) return; this.rect = n; this._soon(); }
  /* window moved or resized: follow it (at most once a frame) */
  _soon() { if (this.pt) return; this.pt = setTimeout(() => { this.pt = 0; this.place(false).catch(() => {}); }, 16); }
  follow() { this._soon(); }
  async _expect(k) { await this._start(); const l = await this._cmd({ op: 'list' }); this.expect = { k, until: Date.now() + 45000, before: new Set((l || []).map((w) => w.h)) }; this._emit(); this._loop(); }
  /* new blank document in the desktop app */
  async create(k) {
    if (!KINDS[k]) throw new Error('Unknown app.'); if (!this.apps()[k]) throw new Error(({ word: 'Word', excel: 'Excel', powerpoint: 'PowerPoint' })[k] + ' isn’t installed on this PC.');
    await this._expect(k);
    try { await this._cmd({ op: 'new', k }, 60000); } catch (e) { cp.spawn(this.apps()[k], [], { detached: true, stdio: 'ignore', windowsHide: false }).unref(); }
    this.scan().catch(() => {}); return true;
  }
  /* the app's own start screen (templates, recent files) */
  async start(k) { if (!this.apps()[k]) throw new Error('That app isn’t installed on this PC.'); await this._expect(k); cp.spawn(this.apps()[k], [], { detached: true, stdio: 'ignore' }).unref(); return true; }
  async openPath(p) { const k = kindOf(p); if (!k) throw new Error('That isn’t a Word, Excel or PowerPoint file.'); if (!fs.existsSync(p)) throw new Error('That file is no longer there.'); await this._expect(k); const e = await shell.openPath(p); if (e) { this.expect = null; throw new Error(e); } return k; }
  async pick(k) { const w = this.getWin(); const r = await dialog.showOpenDialog(w, { properties: ['openFile', 'multiSelections'], filters: KINDS[k] ? KINDS[k].filters.concat([{ name: 'All files', extensions: ['*'] }]) : [{ name: 'Office files', extensions: ['docx', 'doc', 'xlsx', 'xls', 'csv', 'pptx', 'ppt'] }] }); if (r.canceled || !r.filePaths.length) return false; for (const p of r.filePaths.slice(0, 8)) await this.openPath(p); return true; }
  async close(h) { if (!this.docs.has(+h)) return false; await this._cmd({ op: 'close', h: +h }); setTimeout(() => this.scan().catch(() => {}), 700); return true; }
  async adopt(h) { const d = this.docs.get(+h); const owner = this._owner(); if (!d || !owner) return false; d.docked = !!(await this._cmd({ op: 'dock', h: d.h, owner })); if (d.docked) { this.active = d.h; await this.place(true); } this._emit(); return d.docked; }
  async release(h) { const d = this.docs.get(+h); if (!d) return false; await this._cmd({ op: 'undock', h: d.h }); d.docked = false; if (this.active === d.h) { const n = [...this.docs.values()].find((x) => x.docked); this.active = n ? n.h : 0; await this.place(false); } this._emit(); return true; }
  async focus() { if (!this.visible || !this.active) return false; return this._cmd({ op: 'place', h: this.active, ...this._placeArgs(), show: true, focus: true }).catch(() => false); }
  _placeArgs() { const r = this._screenRect() || { x: 0, y: 0, width: 0, height: 0 }; return { x: r.x, y: r.y, w: r.width, hh: r.height }; }
  /* give every docked window its frame back (quit, or the user turns the dock off); also rescues windows left frameless by a crash */
  async releaseAll() { clearTimeout(this.timer); if (!this.ps) return; try { await this._cmd({ op: 'bye' }, 5000); } catch (_) {} try { this.ps.stdin.end(); } catch (_) {} }
  async rescue() { try { await this._cmd({ op: 'rescue' }, 8000); } catch (_) {} }
  stop() { clearTimeout(this.timer); if (this.ps) { try { this.ps.stdin.end(); } catch (_) {} } }
}

module.exports = { OfficeDock, kindOf };
