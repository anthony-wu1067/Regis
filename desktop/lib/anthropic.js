'use strict';
/* Claude API client. Replaces the "ask Claude" capability the page uses inside claude.ai.
   Billing is separate from a Claude chat plan: it is pay-per-use on your own API key. */
const MODELS = { quick: 'claude-haiku-5-5', default: 'claude-sonnet-5-5', complex: 'claude-opus-5-5' };
const err = (code, message) => Object.assign(new Error(message), { code });

class Anthropic {
  constructor({ getKey, onUsage = () => {}, fetchFn = fetch, browser = false }) { this.getKey = getKey; this.onUsage = onUsage; this.f = fetchFn; this.browser = browser; }
  async sample(input, opts = {}) {
    const key = this.getKey();
    if (!key) throw err('needs_setup', 'Add your Anthropic API key in Setup to use Claude features.');
    const messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
    const model = opts.model || MODELS[opts.modelTier || 'default'] || MODELS.default;
    /* 1.9.1 Guild: an agentId picks that agent's persona as the system prompt (callers may pass a ready-made one) */
    let sys = opts.system ? String(opts.system) : '';
    if (!sys && opts.agentId) { try { sys = require('./agents.js').systemFor(String(opts.agentId)); } catch (_) { sys = ''; } if (!sys) throw err('bad_agent', 'Unknown agent.'); }
    const r = await this.f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: Object.assign({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, this.browser ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}),
      body: JSON.stringify(Object.assign({ model, max_tokens: opts.maxTokens || 4096, messages }, sys ? { system: sys } : {}))
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = (j.error && j.error.message) || ('HTTP ' + r.status);
      if (r.status === 401) throw err('needs_setup', 'Anthropic rejected the API key. Paste it again in Setup.');
      if (r.status === 429) throw err('rate_limited', 'Claude is rate-limited right now. Try again in a minute.');
      throw err('upstream_error', m);
    }
    const u = j.usage || {};
    this.onUsage((u.input_tokens || 0) + (u.output_tokens || 0));
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { text, truncated: j.stop_reason === 'max_tokens' };
  }
  static parseJson(text) {
    let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(t); } catch (_) { /* fall through */ }
    const a = t.search(/[\[{]/), b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw err('bad_json', 'Claude returned something that was not JSON.');
  }
  async json(input, opts) { const r = await this.sample(input, opts); return Anthropic.parseJson(r.text); }
}
module.exports = { Anthropic, MODELS };
