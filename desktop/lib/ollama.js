'use strict';
/* 1.9.4 Local AI: talks to Ollama (https://ollama.com), which runs open models on this computer. Nothing leaves the computer.
   Only addresses on this computer are accepted, so a setting can never send your chats somewhere else. */
const err = (code, message) => Object.assign(new Error(message), { code });
const DEFAULT_BASE = 'http://127.0.0.1:11434';
function localBase(u) {
  let x; try { x = new URL(String(u || DEFAULT_BASE)); } catch (_) { return DEFAULT_BASE; }
  if (!/^https?:$/.test(x.protocol) || !/^(127\.0\.0\.1|localhost|\[::1\])$/i.test(x.hostname)) return DEFAULT_BASE;
  return x.protocol + '//' + x.host;
}
/* models known to fit an ordinary laptop (about 2-3 GB each); shown as suggestions when none is installed */
const SUGGEST = [
  { name: 'llama3.2:3b', note: 'Meta Llama 3.2, 3B: good all-rounder, about 2 GB' },
  { name: 'gemma3:4b', note: 'Google Gemma 3, 4B: a bit smarter, about 3.3 GB' },
  { name: 'qwen2.5-coder:3b', note: 'Qwen 2.5 Coder, 3B: for code (Luna, Obsidian), about 1.9 GB' }
];

class Ollama {
  constructor({ getBase = () => DEFAULT_BASE, fetchFn = fetch } = {}) { this.getBase = getBase; this.f = fetchFn; this.pulls = new Map(); }
  base() { return localBase(this.getBase()); }
  async _req(path, body, ms) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || 15000);
    try {
      const r = await this.f(this.base() + path, body === undefined ? { signal: ctl.signal } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
      return r;
    } catch (e) {
      if (e && e.name === 'AbortError') throw err('local_timeout', 'The local AI took too long to answer.');
      throw err('local_offline', 'Local AI isn’t running. Install Ollama from ollama.com, or open it if it is installed.');
    } finally { clearTimeout(t); }
  }
  /* is Ollama running, and which models does it have */
  async status() {
    try {
      const r = await this._req('/api/tags', undefined, 2500); if (!r.ok) return { running: false, models: [], suggest: SUGGEST };
      const j = await r.json().catch(() => ({}));
      const models = (j.models || []).map((m) => ({ name: String(m.name || m.model || ''), size: +m.size || 0 })).filter((m) => m.name);
      return { running: true, models, suggest: SUGGEST };
    } catch (_) { return { running: false, models: [], suggest: SUGGEST }; }
  }
  /* same shape as Anthropic.sample: messages [{role, content}], opts {system, maxTokens, model} -> {text, truncated} */
  async sample(input, opts = {}) {
    const model = String(opts.model || '').trim(); if (!model) throw err('local_nomodel', 'Pick a local model in Setup › Local AI first.');
    const msgs = (typeof input === 'string' ? [{ role: 'user', content: input }] : input).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));
    if (opts.system) msgs.unshift({ role: 'system', content: String(opts.system) });
    const body = { model, messages: msgs, stream: false, options: { num_predict: Math.min(8192, opts.maxTokens || 2048), num_ctx: 8192 } };
    if (opts.json) body.format = 'json';
    const r = await this._req('/api/chat', body, 10 * 60 * 1000);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = String(j.error || ('HTTP ' + r.status));
      if (r.status === 404 || /not found/i.test(m)) throw err('local_nomodel', 'The local model “' + model + '” isn’t downloaded. Download it in Setup › Local AI.');
      throw err('local_error', 'Local AI: ' + m.slice(0, 200));
    }
    const text = String((j.message && j.message.content) || '').replace(/^<think>[\s\S]*?<\/think>\s*/, '');
    return { text, truncated: j.done_reason === 'length' };
  }
  /* download a model; onProgress({status, pct}) while it runs */
  async pull(name, onProgress) {
    name = String(name || '').trim();
    if (!/^[a-z0-9][a-z0-9._\-\/]*(:[a-z0-9._\-]+)?$/i.test(name) || name.length > 120) throw err('bad_model', 'That doesn’t look like a model name (for example llama3.2:3b).');
    if (this.pulls.has(name)) return this.pulls.get(name);
    const run = (async () => {
      const r = await this._req('/api/pull', { name, stream: true }, 6 * 60 * 60 * 1000);
      if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw err('local_error', 'Couldn’t download ' + name + (j.error ? ': ' + j.error : '.')); }
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '', last = 0;
      for (;;) {
        const { done, value } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
          let j; try { j = JSON.parse(line); } catch (_) { continue; }
          if (j.error) throw err('local_error', 'Couldn’t download ' + name + ': ' + j.error);
          const pct = j.total ? Math.round((j.completed || 0) / j.total * 100) : null, now = Date.now();
          if (onProgress && (now - last > 400 || j.status === 'success')) { last = now; try { onProgress({ name, status: String(j.status || ''), pct }); } catch (_) {} }
        }
      }
      return true;
    })();
    this.pulls.set(name, run);
    try { return await run; } finally { this.pulls.delete(name); }
  }
}
module.exports = { Ollama, localBase, DEFAULT_BASE, SUGGEST };
