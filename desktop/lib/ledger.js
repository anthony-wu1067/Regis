'use strict';
/* 1.9.7 Claude ledger and hard caps. Every Claude call Regis makes goes through meter(): the caps are checked BEFORE the
   request is sent and the real token counts are written down after it. The limits live here, in the application; nothing a
   model writes can raise them or skip the check. Shared by the desktop app and the web build.
   One row per call: { id, teamId, taskId, ref, engine, at, model, inputTokens, outputTokens, estimatedCost }.
   taskId is the id the per-task limit counts against (one run of a task); ref is the task it belongs to. Since 1.9.8 calls to the local AI
   are written down too (engine 'local', cost 0) so usage can be reported; they never count against a Claude limit.
   `table` is { load() -> rows[], save(rows) }, like the Guild's, so the rows can move to a database later. */
const err = (code, message, extra) => Object.assign(new Error(message), { code }, extra || {});
/* US dollars per million tokens (input, output). Estimates only: update when Anthropic's prices change.
   Unknown models are charged at the dearest listed rate, so an estimate is never too low. */
const PRICES = {
  'claude-haiku-5-5': [0.10, 0.50], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20],
  'claude-sonnet-5': [2, 10], 'claude-opus-5': [5, 25], 'claude-fable-5-2': [8, 40], 'claude-haiku-4-5': [1, 5]
};
const DEAREST = [8, 40];
const LIMITS = { perTask: 3, teamDaily: 2, globalDaily: 5 };   /* calls per task, dollars per team per day, dollars for all of Regis per day */
const HARD = { perTask: 12, teamDaily: 50, globalDaily: 100 }; /* nothing in the settings can go above these */
const MAX_ROWS = 4000, KEEP_DAYS = 45;
const num = (v, d, lo, hi) => { v = +v; return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
function cleanLimits(l) { l = l || {}; return { perTask: Math.round(num(l.perTask, LIMITS.perTask, 0, HARD.perTask)), teamDaily: num(l.teamDaily, LIMITS.teamDaily, 0, HARD.teamDaily), globalDaily: num(l.globalDaily, LIMITS.globalDaily, 0, HARD.globalDaily) }; }
function costOf(model, inputTokens, outputTokens) { const p = PRICES[model] || DEAREST; return ((+inputTokens || 0) * p[0] + (+outputTokens || 0) * p[1]) / 1e6; }
const dayOf = (t) => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };   /* the owner's local day */
const money = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2);

class Ledger {
  constructor({ table, now = Date.now } = {}) { this.table = table || { load: () => this._mem || [], save: (r) => { this._mem = r; } }; this.now = now; this.open = {}; }
  _rows() { const r = this.table.load(); return Array.isArray(r) ? r : []; }
  _today() { const d = dayOf(this.now()); return this._rows().filter((r) => r && dayOf(r.at) === d); }
  record(e) {
    e = e || {}; const model = String(e.model || '');
    const row = { id: Math.random().toString(36).slice(2, 10), teamId: String(e.teamId || 'regis').slice(0, 40), taskId: String(e.taskId || '').slice(0, 80), ref: String(e.ref || '').slice(0, 60), engine: e.engine === 'local' ? 'local' : 'claude', at: this.now(), model,
      inputTokens: Math.max(0, Math.round(+e.inputTokens || 0)), outputTokens: Math.max(0, Math.round(+e.outputTokens || 0)) };
    row.estimatedCost = row.engine === 'local' ? 0 : Math.round(costOf(model, row.inputTokens, row.outputTokens) * 1e6) / 1e6;
    const old = this.now() - KEEP_DAYS * 864e5; let rows = this._rows().filter((r) => r && r.at > old); rows.push(row); if (rows.length > MAX_ROWS) rows = rows.slice(-MAX_ROWS);
    this.table.save(rows); return row;
  }
  /* a call to the local AI: free, but worth knowing about */
  recordLocal(e) { return this.record(Object.assign({}, e, { engine: 'local', inputTokens: 0, outputTokens: 0 })); }
  callsForTask(taskId) { if (!taskId) return 0; return this._rows().filter((r) => r && r.engine !== 'local' && r.taskId === taskId).length + (this.open['t:' + taskId] || 0); }
  costToday(teamId) { return this._today().filter((r) => r.engine !== 'local' && (!teamId || r.teamId === teamId)).reduce((s, r) => s + (r.estimatedCost || 0), 0); }
  callsToday(teamId) { return this._today().filter((r) => r.engine !== 'local' && (!teamId || r.teamId === teamId)).length; }
  /* totals for any set of rows */
  _sum(rows) { const o = { local: { calls: 0 }, claude: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 } }; rows.forEach((r) => { if (r.engine === 'local') o.local.calls++; else { o.claude.calls++; o.claude.inputTokens += r.inputTokens || 0; o.claude.outputTokens += r.outputTokens || 0; o.claude.cost += r.estimatedCost || 0; } }); o.claude.cost = Math.round(o.claude.cost * 1e6) / 1e6; return o; }
  /* usage report. scope: {} = all of Regis today, { teamId } = one team today, { ref } = one task (all its runs), { taskId } = one run */
  usage(scope, limits) {
    scope = scope || {}; const L = cleanLimits(limits); let rows;
    if (scope.taskId) rows = this._rows().filter((r) => r && r.taskId === scope.taskId); else if (scope.ref) rows = this._rows().filter((r) => r && r.ref === scope.ref); else rows = this._today().filter((r) => !scope.teamId || r.teamId === scope.teamId);
    const o = this._sum(rows); if (scope.taskId || scope.ref) { if (scope.taskId) o.callsLeft = Math.max(0, L.perTask - this.callsForTask(scope.taskId)); return o; }
    const all = this.costToday(), team = scope.teamId ? this.costToday(scope.teamId) : all;
    o.caps = { perTask: L.perTask, teamDaily: L.teamDaily, globalDaily: L.globalDaily };
    o.left = { team: Math.max(0, Math.round((L.teamDaily - team) * 1e6) / 1e6), global: Math.max(0, Math.round((L.globalDaily - all) * 1e6) / 1e6) };
    o.blocked = scope.teamId ? (team >= L.teamDaily ? 'team' : all >= L.globalDaily ? 'global' : '') : (all >= L.globalDaily ? 'global' : ''); return o;
  }
  /* the last n days, per day: for a small history chart or table */
  days(teamId, n) { const out = []; const rows = this._rows(); for (let i = (n || 7) - 1; i >= 0; i--) { const d = dayOf(this.now() - i * 864e5), s = this._sum(rows.filter((r) => r && dayOf(r.at) === d && (!teamId || r.teamId === teamId))); out.push({ day: d, local: s.local.calls, claude: s.claude.calls, cost: s.claude.cost }); } return out; }
  /* may this call be made? -> { ok } or { ok:false, code, reason }. Calls that are in flight count too, so two at once can't slip past. */
  check(meta, limits) {
    meta = meta || {}; const L = cleanLimits(limits), team = String(meta.teamId || 'regis');
    if (meta.taskId && this.callsForTask(meta.taskId) >= L.perTask) return { ok: false, code: 'task_calls', reason: 'This task has used its ' + L.perTask + ' Claude call' + (L.perTask === 1 ? '' : 's') + '.' };
    if (L.perTask === 0 && meta.taskId) return { ok: false, code: 'task_calls', reason: 'Claude calls are switched off for tasks (limit 0).' };
    if (this.costToday(team) >= L.teamDaily) return { ok: false, code: 'team_daily', reason: 'Today’s Claude budget for this team (' + money(L.teamDaily) + ') is used up.' };
    if (this.costToday() >= L.globalDaily) return { ok: false, code: 'global_daily', reason: 'Today’s Claude budget for all of Regis (' + money(L.globalDaily) + ') is used up.' };
    return { ok: true };
  }
  summary(teamId, limits) {
    const L = cleanLimits(limits);
    return { teamId: teamId || '', team: { cost: this.costToday(teamId), calls: this.callsToday(teamId), cap: L.teamDaily }, all: { cost: this.costToday(), calls: this.callsToday(), cap: L.globalDaily }, perTask: L.perTask,
      recent: this._rows().filter((r) => r && r.engine !== 'local' && (!teamId || r.teamId === teamId)).slice(-12).reverse() };
  }
}

/* Wraps the Claude client. Same sample()/json() as Anthropic, plus opts.meter = { teamId, taskId }.
   getLimits(teamId) -> { perTask, teamDaily, globalDaily } comes from the team's policy, read fresh on every call. */
function meter(anthropic, ledger, getLimits) {
  const sample = async (input, opts = {}) => {
    const m = Object.assign({ teamId: 'regis', taskId: '' }, opts.meter || {});
    const c = ledger.check(m, getLimits ? getLimits(m.teamId) : null);
    if (!c.ok) throw err('claude_limit', c.reason + ' Regis did not call Claude.', { limit: c.code });
    const k = m.taskId ? 't:' + m.taskId : ''; if (k) ledger.open[k] = (ledger.open[k] || 0) + 1;
    try {
      const o = Object.assign({}, opts); delete o.meter;
      const r = await anthropic.sample(input, o);
      const u = r.usage || {}; const row = ledger.record({ teamId: m.teamId, taskId: m.taskId, ref: m.ref, model: r.model || o.model || '', inputTokens: u.input, outputTokens: u.output });
      return Object.assign({}, r, { cost: row.estimatedCost, tokens: { input: row.inputTokens, output: row.outputTokens } });
    } finally { if (k) { ledger.open[k] -= 1; if (ledger.open[k] <= 0) delete ledger.open[k]; } }
  };
  const parse = anthropic.constructor && anthropic.constructor.parseJson;
  return { sample, json: async (input, opts) => { const r = await sample(input, opts); return parse ? parse(r.text) : JSON.parse(r.text); }, raw: anthropic };
}
module.exports = { Ledger, meter, costOf, cleanLimits, PRICES, LIMITS, HARD, money };
