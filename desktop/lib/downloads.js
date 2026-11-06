'use strict';
/* Downloads for Regis's built-in browser: saved straight to the Downloads folder (like Chrome), listed with progress, kept for later
   (last 40), and offered back when a site or Regis asks you to upload a file ("Easy Files"). Only files Regis itself downloaded,
   or that you pick in the system file dialog, are ever read and handed on. */
const fs = require('fs');
const path = require('path');

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', heic: 'image/heic',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', json: 'application/json', html: 'text/html', md: 'text/markdown', zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const mimeOf = (name) => MIME[String(name || '').split('.').pop().toLowerCase()] || 'application/octet-stream';
const MAX_READ = 150 * 1024 * 1024;

/* a free name in the folder: "report.pdf", then "report (1).pdf", ... */
function freeName(dir, name) {
  const clean = String(name || 'download').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 180) || 'download';
  const ext = path.extname(clean), base = clean.slice(0, clean.length - ext.length);
  let p = path.join(dir, clean), i = 1;
  while (fs.existsSync(p) || fs.existsSync(p + '.part')) p = path.join(dir, base + ' (' + i++ + ')' + ext);
  return p;
}

class Downloads {
  constructor({ dir, load, save, onChange, onDone }) {
    this.dir = dir; this.save = save || (() => {}); this.onChange = onChange || (() => {}); this.onDone = onDone || (() => {});
    this.items = []; this.live = new Map(); this.n = 0; this.t = null;
    try { (load ? load() : []).forEach((x) => { if (x && x.id && x.path) { this.items.push(Object.assign({}, x, { state: x.state === 'progressing' ? 'interrupted' : x.state })); this.n = Math.max(this.n, +String(x.id).replace(/\D/g, '') || 0); } }); } catch (_) {}
  }
  attach(ses) {
    ses.on('will-download', (_e, item) => {
      const id = 'd' + (++this.n), p = freeName(this.dir, item.getFilename());
      try { item.setSavePath(p); } catch (_) {}
      const d = { id, name: path.basename(p), path: p, url: String(item.getURL() || '').slice(0, 600), mime: item.getMimeType() || mimeOf(p), total: item.getTotalBytes() || 0, received: 0, state: 'progressing', paused: false, start: Date.now(), end: 0 };
      this.items.unshift(d); this.live.set(id, item); this._change();
      item.on('updated', (_e2, st) => { d.received = item.getReceivedBytes(); d.total = item.getTotalBytes() || d.total; d.paused = item.isPaused(); d.state = st === 'interrupted' ? 'interrupted' : 'progressing'; this._change(); });
      item.once('done', (_e3, st) => { d.received = item.getReceivedBytes(); d.state = st; d.end = Date.now(); this.live.delete(id); this._change(true); if (st === 'completed') { try { this.onDone(Object.assign({}, d)); } catch (_) {} } });
    });
  }
  _change(now) { clearTimeout(this.t); const run = () => { this.t = null; this.items = this.items.slice(0, 60); try { this.save(this.items.filter((x) => x.state !== 'progressing').slice(0, 40)); } catch (_) {} try { this.onChange(this.list()); } catch (_) {} }; if (now) run(); else this.t = setTimeout(run, 200); }
  list() { return this.items.map((d) => Object.assign({}, d, { exists: d.state === 'completed' ? fs.existsSync(d.path) : true })); }
  _get(id) { return this.items.find((d) => d.id === String(id)); }
  cancel(id) { const it = this.live.get(String(id)); if (it) it.cancel(); return !!it; }
  pause(id) { const it = this.live.get(String(id)); if (it && !it.isPaused()) it.pause(); this._change(); return !!it; }
  resume(id) { const it = this.live.get(String(id)); if (it && it.canResume()) it.resume(); this._change(); return !!it; }
  remove(id) { const d = this._get(id); if (!d) return false; if (this.live.has(d.id)) this.cancel(d.id); this.items = this.items.filter((x) => x !== d); this._change(true); return true; }
  clear() { this.items = this.items.filter((d) => d.state === 'progressing'); this._change(true); return true; }
  pathOf(id) { const d = this._get(id); return d && d.state === 'completed' && fs.existsSync(d.path) ? d.path : ''; }
  /* hand a finished download over as bytes (for uploads); only Regis's own downloads */
  read(id) { const p = this.pathOf(id); if (!p) throw new Error('That file is no longer there.'); return readFile(p); }
}
function readFile(p) {
  const st = fs.statSync(p); if (!st.isFile()) throw new Error('Not a file'); if (st.size > MAX_READ) throw new Error('That file is too big to upload this way (over 150 MB).');
  return { name: path.basename(p), type: mimeOf(p), size: st.size, data: fs.readFileSync(p) };
}
module.exports = { Downloads, readFile, mimeOf, freeName };
