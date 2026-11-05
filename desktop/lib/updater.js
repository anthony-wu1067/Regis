'use strict';
/* Over-the-air updates for the desktop app. The web site you publish also serves `desktop-bundle.json`:
   the app's interface files (page, runtime, sync) with SHA-256 hashes. The app downloads it, checks every hash,
   keeps it in its data folder and uses it from the next start (or immediately if you press Restart now).
   Changes to the Electron shell itself (main.js, preload.js) still need a new installer; bundles say which shell they need. */
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const SHELL_API = 1;                                     // bump when main.js/preload.js change in a way old bundles can't use
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; } return 0; };
const err = (code, message) => Object.assign(new Error(message), { code });
const SAFE = /^[A-Za-z0-9._-]+$/;

class Updater {
  constructor({ dir, bundledVersion, fetchFn = fetch, shellApi = SHELL_API }) { this.dir = dir; this.bundled = bundledVersion; this.f = fetchFn; this.api = shellApi; fs.mkdirSync(dir, { recursive: true }); }
  /* the staged bundle to run, or null (then the version shipped inside the app is used). Re-verifies hashes every time. */
  current() {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(this.dir, 'current.json'), 'utf8'));
      if (!meta || !SAFE.test(meta.version) || cmp(meta.version, this.bundled) <= 0 || (meta.minShell || 1) > this.api) return null;
      const d = path.join(this.dir, meta.version);
      for (const [name, h] of Object.entries(meta.files || {})) { if (!SAFE.test(name) || sha(fs.readFileSync(path.join(d, name))) !== h) return null; }
      if (!fs.existsSync(path.join(d, 'index.html'))) return null;
      return { version: meta.version, dir: d };
    } catch (_) { return null; }
  }
  clear() { try { fs.rmSync(path.join(this.dir, 'current.json'), { force: true }); } catch (_) {} }
  async check(baseUrl) {
    if (!baseUrl) throw err('no_url', 'Add your Regis site address to receive updates.');
    let u; try { u = new URL('desktop-bundle.json', baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'); } catch (_) { throw err('bad_url', 'That update address isn’t a web address.'); }
    if (u.protocol !== 'https:') throw err('bad_url', 'The update address must start with https://');
    let r; try { r = await this.f(u.href, { cache: 'no-store' }); } catch (e) { throw err('offline', 'Couldn’t reach the update address.'); }
    if (!r.ok) throw err('http', 'Update address answered ' + r.status + '.');
    const b = await r.json().catch(() => null);
    if (!b || !SAFE.test(String(b.version || '')) || !b.files || !b.files['index.html']) throw err('bad_bundle', 'That update file isn’t a Regis bundle.');
    const have = this.current(), running = have ? have.version : this.bundled;
    if (cmp(b.version, running) <= 0) return { status: 'current', version: running };
    if ((b.minShell || 1) > this.api) return { status: 'needs_installer', version: b.version };
    const d = path.join(this.dir, b.version), tmp = d + '.tmp'; fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    const hashes = {};
    for (const [name, f] of Object.entries(b.files)) {
      if (!SAFE.test(name)) throw err('bad_bundle', 'Update contained an unsafe file name.');
      const buf = Buffer.from(String(f.b64 || ''), 'base64');
      if (sha(buf) !== f.sha256) { fs.rmSync(tmp, { recursive: true, force: true }); throw err('bad_hash', 'Update failed its integrity check, so it was not installed.'); }
      fs.writeFileSync(path.join(tmp, name), buf); hashes[name] = f.sha256;
    }
    fs.rmSync(d, { recursive: true, force: true }); fs.renameSync(tmp, d);
    fs.writeFileSync(path.join(this.dir, 'current.json'), JSON.stringify({ version: b.version, minShell: b.minShell || 1, files: hashes }));
    try { fs.readdirSync(this.dir).forEach((x) => { if (SAFE.test(x) && x !== b.version && x !== 'current.json' && fs.statSync(path.join(this.dir, x)).isDirectory()) fs.rmSync(path.join(this.dir, x), { recursive: true, force: true }); }); } catch (_) {}
    return { status: 'staged', version: b.version };
  }
}
module.exports = { Updater, SHELL_API, cmp, sha };
