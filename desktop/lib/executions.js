'use strict';
/* 1.9.8 Execution history: one record for each time a team worked on a task. It answers "what did this team do, when, who was
   involved, which engine, how many Claude calls, what did it cost, did it succeed, did it escalate or hit a limit".
   This is NOT the conversation: chat rows stay in the Guild's table. `table` is { load() -> rows[], save(rows) }.
   One row: { id, teamId, taskId, title, lead, startedAt, endedAt, durationMs, status (running|completed|failed|refused), workflow,
   kind, level, engine, reason, escalated, limit, specialists[], tools[], steps[{at,type,who,engine,ms,ok,note}], usage{localCalls,
   claudeCalls,inputTokens,outputTokens,cost}, result, error }. */
const err = (code, message) => Object.assign(new Error(message), { code });
const STEP = ['plan', 'route', 'delegate', 'specialist', 'tool', 'lead', 'escalate', 'memory', 'limit', 'error', 'done'];
const PER_TEAM = 200, MAX_STEPS = 40;
const text = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const copy = (r) => JSON.parse(JSON.stringify(r));

class ExecutionStore {
  constructor({ table, now = Date.now, onChange = null } = {}) { this.table = table || { load: () => this._mem || [], save: (r) => { this._mem = r; } }; this.now = now; this.onChange = onChange; }
  _rows() { const r = this.table.load(); return Array.isArray(r) ? r : []; }
  _save(rows, teamId, ev) { this.table.save(rows); if (this.onChange) { try { this.onChange(teamId, ev); } catch (_) {} } }
  start(d) {
    d = d || {}; if (!d.teamId) throw err('bad_team', 'An execution needs a team.');
    const row = { id: text(d.id, 80) || 'x' + Math.random().toString(36).slice(2, 9) + this.now().toString(36), teamId: String(d.teamId), taskId: text(d.taskId, 60), title: text(d.title, 300), lead: text(d.lead, 40), startedAt: this.now(), endedAt: 0, durationMs: 0,
      status: 'running', workflow: '', kind: '', level: 0, engine: '', reason: '', escalated: false, limit: '', specialists: [], tools: [], steps: [], usage: { localCalls: 0, claudeCalls: 0, inputTokens: 0, outputTokens: 0, cost: 0 }, result: '', error: '' };
    let rows = this._rows(); rows.push(row);
    const mine = rows.filter((r) => r && r.teamId === row.teamId); if (mine.length > PER_TEAM) { const drop = new Set(mine.filter((r) => r.status !== 'running').slice(0, mine.length - PER_TEAM).map((r) => r.id)); rows = rows.filter((r) => !drop.has(r.id)); }
    this._save(rows, row.teamId, { type: 'start', executionId: row.id, taskId: row.taskId }); return row.id;
  }
  _edit(id, fn, ev) { const rows = this._rows(), r = rows.find((x) => x && x.id === id); if (!r) return null; fn(r); this._save(rows, r.teamId, Object.assign({ executionId: id, taskId: r.taskId }, ev || {})); return r; }
  /* facts about the run as they become known (workflow, classification, engine...) */
  set(id, patch) { return this._edit(id, (r) => { ['workflow', 'kind', 'engine', 'reason', 'limit'].forEach((k) => { if (patch[k] !== undefined) r[k] = text(patch[k], 300); }); if (patch.level !== undefined) r.level = +patch.level || 0; if (patch.escalated !== undefined) r.escalated = !!patch.escalated; }, { type: 'set' }); }
  step(id, s) {
    s = s || {}; const type = STEP.includes(s.type) ? s.type : 'error';
    return this._edit(id, (r) => {
      if (r.steps.length < MAX_STEPS) r.steps.push({ at: this.now(), type, who: text(s.who, 40), engine: text(s.engine, 40), ms: Math.max(0, Math.round(+s.ms || 0)), ok: s.ok !== false, note: text(s.note, 240) });
      if (type === 'specialist' && s.who && !r.specialists.includes(s.who)) r.specialists.push(text(s.who, 40));
      if (type === 'tool' && s.tool && !r.tools.includes(s.tool)) r.tools.push(text(s.tool, 60));
      if (type === 'escalate') r.escalated = true;
      if (type === 'limit') r.limit = text(s.note, 300);
      const u = s.usage; if (u) { r.usage.localCalls += +u.localCalls || 0; r.usage.claudeCalls += +u.claudeCalls || 0; r.usage.inputTokens += +u.inputTokens || 0; r.usage.outputTokens += +u.outputTokens || 0; r.usage.cost = Math.round((r.usage.cost + (+u.cost || 0)) * 1e6) / 1e6; }
    }, { type: 'step', step: type, who: text(s.who, 40), phase: s.phase || 'end' });
  }
  /* a step that has begun (so the Office can show who is working right now); not stored as a step */
  begin(id, who, type) { const r = this._rows().find((x) => x && x.id === id); if (r && this.onChange) { try { this.onChange(r.teamId, { type: 'step', step: type, who: text(who, 40), phase: 'begin', executionId: id, taskId: r.taskId }); } catch (_) {} } }
  finish(id, status, d) { d = d || {}; return this._edit(id, (r) => { r.status = ['completed', 'failed', 'refused'].includes(status) ? status : 'failed'; r.endedAt = this.now(); r.durationMs = Math.max(0, r.endedAt - r.startedAt); if (d.result !== undefined) r.result = text(d.result, 400); if (d.error !== undefined) r.error = text(d.error, 400); }, { type: 'finish', status }); }
  get(id) { const r = this._rows().find((x) => x && x.id === id); return r ? copy(r) : null; }
  list(teamId, n) { const l = this._rows().filter((r) => r && (!teamId || r.teamId === teamId)); return (n ? l.slice(-n) : l).reverse().map(copy); }
  forTask(taskId) { return this._rows().filter((r) => r && r.taskId === taskId).reverse().map(copy); }
  /* at start-up nothing is running any more */
  recover() { const rows = this._rows(); let n = 0; rows.forEach((r) => { if (r && r.status === 'running') { r.status = 'failed'; r.endedAt = this.now(); r.durationMs = Math.max(0, r.endedAt - r.startedAt); r.error = 'Regis was closed while this was running.'; n++; } }); if (n) this.table.save(rows); return n; }
}
module.exports = { ExecutionStore, STEP };
