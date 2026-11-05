'use strict';
/* Mini mode: shrink the window to a small always-on-top square in a corner of the screen, and put it back. */
const SIZE = { w: 340, h: 400 }, MARGIN = 16, FULL_MIN = { w: 420, h: 600 }, MINI_MIN = { w: 250, h: 220 };

class Mini {
  constructor(getWin, screen) { this.getWin = getWin; this.screen = screen; this.on = false; this.normal = null; this.mini = null; this.wasMax = false; }
  corner(bounds) {
    const wa = this.screen.getDisplayMatching(bounds).workArea;
    return { x: wa.x + wa.width - SIZE.w - MARGIN, y: wa.y + wa.height - SIZE.h - MARGIN, width: SIZE.w, height: SIZE.h };
  }
  visible(b) { return this.screen.getAllDisplays().some((d) => { const w = d.workArea; return b.x < w.x + w.width && b.x + b.width > w.x && b.y < w.y + w.height && b.y + b.height > w.y; }); }
  enter() {
    const win = this.getWin(); if (!win || win.isDestroyed() || this.on) return this.on;
    this.wasMax = win.isMaximized(); if (this.wasMax) win.unmaximize();
    if (win.isFullScreen && win.isFullScreen()) win.setFullScreen(false);
    this.normal = win.getBounds();
    win.setMinimumSize(MINI_MIN.w, MINI_MIN.h);
    win.setBounds(this.mini && this.visible(this.mini) ? this.mini : this.corner(this.normal));
    win.setAlwaysOnTop(true, 'floating');
    if (win.setVisibleOnAllWorkspaces) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (!win.isVisible()) win.show();
    this.on = true; return true;
  }
  exit() {
    const win = this.getWin(); if (!this.on) return false;
    this.on = false;
    if (!win || win.isDestroyed()) return false;
    this.mini = win.getBounds();
    win.setAlwaysOnTop(false);
    if (win.setVisibleOnAllWorkspaces) win.setVisibleOnAllWorkspaces(false);
    win.setMinimumSize(FULL_MIN.w, FULL_MIN.h);
    if (this.normal) win.setBounds(this.normal);
    if (this.wasMax) win.maximize();
    return false;
  }
  set(on) { return on ? this.enter() : this.exit(); }
  toggle() { return this.set(!this.on); }
  reset() { this.on = false; }
}
module.exports = { Mini, SIZE, MARGIN };
