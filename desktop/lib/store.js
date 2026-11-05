'use strict';
/* Small JSON-file store. Secrets (Google refresh token + client secret, Anthropic key) are encrypted with the OS keychain
   via Electron safeStorage when available; the injected `crypt` makes it testable. */
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir, crypt) {
    this.dir = dir; this.crypt = crypt || { enc: (s) => 'plain:' + Buffer.from(s).toString('base64'), dec: (s) => Buffer.from(s.slice(6), 'base64').toString() };
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'regis-data.json'); this.secFile = path.join(dir, 'regis-secrets.json');
    this.data = this._read(this.file, {}); this.sec = this._read(this.secFile, {}); this.t = null;
  }
  _read(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return d; } }
  getDb() { return this.data.db || {}; }
  setDb(db) { this.data.db = db; this._later(); }
  getMeta(k, d) { return (this.data.meta && this.data.meta[k] !== undefined) ? this.data.meta[k] : d; }
  setMeta(k, v) { (this.data.meta = this.data.meta || {})[k] = v; this._later(); }
  getSecret(k) { const v = this.sec[k]; if (!v) return ''; try { return this.crypt.dec(v); } catch (_) { return ''; } }
  setSecret(k, v) { if (v) this.sec[k] = this.crypt.enc(String(v)); else delete this.sec[k]; fs.writeFileSync(this.secFile, JSON.stringify(this.sec), { mode: 0o600 }); }
  _later() { clearTimeout(this.t); this.t = setTimeout(() => this.flush(), 300); }
  flush() { clearTimeout(this.t); const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.data)); fs.renameSync(tmp, this.file); }
  monthUsage() {
    const m = new Date().toISOString().slice(0, 7); const u = this.getMeta('usage', {});
    return u.month === m ? u : { month: m, tokens: 0, calls: 0 };
  }
  addUsage(tokens) { const u = this.monthUsage(); u.tokens += tokens; u.calls += 1; this.setMeta('usage', u); }
}
module.exports = { Store };
