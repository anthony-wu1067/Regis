'use strict';
/* 1.9.8 Team tasks. A task is a first-class record owned by a team and kept in the application's data (not in the page).
   This module is the only place a task's status changes: every change goes through transition(), which checks the move is allowed.
   `table` is { load() -> rows[], save(rows) }, so the rows can move to a database later without changing callers.
   One row: { id, teamId, title, description, status, priority, createdAt, startedAt, completedAt, assignedTo, engine (asked for:
   auto|local|claude), engineUsed, specialistsUsed[], result, note, error, executionId, attempts }. */
const err = (code, message) => Object.assign(new Error(message), { code });
const STATUS = ['queued', 'planning', 'running', 'waiting', 'completed', 'failed', 'cancelled'];
const ACTIVE = ['planning', 'running', 'waiting'], DONE = ['completed', 'failed', 'cancelled'];
/* which moves are allowed */
const NEXT = {
  queued: ['planning', 'cancelled'], planning: ['running', 'waiting', 'failed', 'queued'], running: ['waiting', 'completed', 'failed'], waiting: ['running', 'failed', 'cancelled', 'queued'],
  completed: ['queued'], failed: ['queued'], cancelled: ['queued']
};
const PER_TEAM = 300, PRIO = [1, 2, 3];
const text = (v, n) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, n);
const view = (r) => ({ id: r.id, teamId: r.teamId, title: r.title, description: r.description || '', status: r.status, priority: r.priority, createdAt: r.createdAt, startedAt: r.startedAt || 0, completedAt: r.completedAt || 0,
  assignedTo: r.assignedTo || '', engine: r.engine || 'auto', engineUsed: r.engineUsed || '', specialistsUsed: (r.specialistsUsed || []).slice(), result: r.result || '', note: r.note || '', error: r.error || '', executionId: r.executionId || '', attempts: r.attempts || 0 });

class TaskStore {
  constructor({ table, now = Date.now, onChange = null } = {}) { this.table = table || { load: () => this._mem || [], save: (r) => { this._mem = r; } }; this.now = now; this.onChange = onChange; }
  _rows() { const r = this.table.load(); return Array.isArray(r) ? r : []; }
  _save(rows, teamId) { this.table.save(rows); if (this.onChange) { try { this.onChange(teamId); } catch (_) {} } }
  _id() { return 't' + Math.random().toString(36).slice(2, 9) + this.now().toString(36).slice(-3); }
  get(id) { const r = this._rows().find((x) => x && x.id === id); return r ? view(r) : null; }
  /* a team's tasks: active first, then queued (by priority, then age), then finished (newest first) */
  list(teamId, opts) {
    opts = opts || {}; let l = this._rows().filter((r) => r && r.teamId === teamId); if (opts.status) l = l.filter((r) => [].concat(opts.status).includes(r.status));
    const rank = (r) => (ACTIVE.includes(r.status) ? 0 : r.status === 'queued' ? 1 : 2);
    l.sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? (a.priority - b.priority) || (a.createdAt - b.createdAt) : (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt)));
    return (opts.limit ? l.slice(0, opts.limit) : l).map(view);
  }
  counts(teamId) { const c = { queued: 0, active: 0, completed: 0, failed: 0, cancelled: 0 }; this._rows().forEach((r) => { if (!r || r.teamId !== teamId) return; if (ACTIVE.includes(r.status)) c.active++; else if (c[r.status] !== undefined) c[r.status]++; }); return c; }
  create(teamId, d) {
    d = d || {}; const title = text(d.title, 300); if (!teamId) throw err('bad_team', 'A task needs a team.'); if (!title) throw err('empty', 'The task has no title.');
    const row = { id: this._id(), teamId: String(teamId), title, description: text(d.description !== undefined ? d.description : d.notes, 8000), status: 'queued', priority: PRIO.includes(+d.priority) ? +d.priority : 2, createdAt: +d.createdAt || this.now(),
      startedAt: 0, completedAt: 0, assignedTo: text(d.assignedTo, 40), engine: d.engine === 'claude' || d.engine === 'local' ? d.engine : 'auto', engineUsed: '', specialistsUsed: [], result: '', note: '', error: '', executionId: '', attempts: 0 };
    let rows = this._rows(); rows.push(row);
    /* keep the newest PER_TEAM per team: only finished tasks are ever dropped */
    const mine = rows.filter((r) => r && r.teamId === row.teamId);
    if (mine.length > PER_TEAM) { const old = mine.filter((r) => DONE.includes(r.status)).sort((a, b) => (a.completedAt || a.createdAt) - (b.completedAt || b.createdAt)).slice(0, mine.length - PER_TEAM).map((r) => r.id); rows = rows.filter((r) => !old.includes(r.id)); }
    this._save(rows, row.teamId); return view(row);
  }
  /* the single door for status changes */
  transition(id, status, patch) {
    const rows = this._rows(), r = rows.find((x) => x && x.id === id); if (!r) throw err('no_task', 'That task no longer exists.');
    if (!STATUS.includes(status) || !(NEXT[r.status] || []).includes(status)) throw err('bad_move', 'A ' + r.status + ' task cannot become ' + status + '.');
    patch = patch || {}; r.status = status;
    if (status === 'planning') { r.startedAt = this.now(); r.completedAt = 0; r.error = ''; r.result = ''; r.note = ''; r.engineUsed = ''; r.specialistsUsed = []; r.attempts = (r.attempts || 0) + 1; }
    if (status === 'queued') { r.startedAt = 0; r.completedAt = 0; r.error = text(patch.error, 400); }
    if (DONE.includes(status)) r.completedAt = this.now();
    if (patch.executionId !== undefined) r.executionId = text(patch.executionId, 80);
    if (patch.engineUsed !== undefined) r.engineUsed = text(patch.engineUsed, 60);
    if (patch.specialistsUsed !== undefined) r.specialistsUsed = (patch.specialistsUsed || []).map((s) => text(s, 40)).slice(0, 8);
    if (patch.result !== undefined) r.result = text(patch.result, 400);
    if (patch.note !== undefined) r.note = text(patch.note, 300);
    if (patch.error !== undefined && status !== 'queued') r.error = text(patch.error, 400);
    if (patch.assignedTo !== undefined) r.assignedTo = text(patch.assignedTo, 40);
    this._save(rows, r.teamId); return view(r);
  }
  /* things the owner may edit while a task waits in the queue */
  update(id, d) { const rows = this._rows(), r = rows.find((x) => x && x.id === id); if (!r) throw err('no_task', 'That task no longer exists.'); if (r.status !== 'queued') throw err('bad_move', 'Only a queued task can be edited.');
    d = d || {}; if (d.title !== undefined) { const t = text(d.title, 300); if (t) r.title = t; } if (d.description !== undefined) r.description = text(d.description, 8000); if (PRIO.includes(+d.priority)) r.priority = +d.priority; if (d.engine === 'claude' || d.engine === 'local' || d.engine === 'auto') r.engine = d.engine;
    this._save(rows, r.teamId); return view(r); }
  remove(id) { const rows = this._rows(), r = rows.find((x) => x && x.id === id); if (!r) return false; if (ACTIVE.includes(r.status)) throw err('bad_move', 'A task that is running cannot be removed.'); this._save(rows.filter((x) => x !== r), r.teamId); return true; }
  /* tasks from the page's old storage (1.9.5-1.9.7), brought in once; anything that was mid-run becomes failed */
  importOld(teamId, old) {
    const rows = this._rows(); let n = 0;
    (Array.isArray(old) ? old : []).slice(0, PER_TEAM).forEach((o) => { const title = text(o && o.title, 300); if (!title) return; const st = o.st === 'q' ? 'queued' : o.st === 'd' ? 'completed' : 'failed';
      rows.push({ id: this._id() + n, teamId: String(teamId), title, description: text(o.notes, 8000), status: st, priority: 2, createdAt: +o.at || this.now(), startedAt: 0, completedAt: st === 'queued' ? 0 : (+o.done || this.now()), assignedTo: String(teamId),
        engine: o.eng === 'claude' || o.eng === 'local' ? o.eng : 'auto', engineUsed: '', specialistsUsed: [], result: st === 'completed' ? text(o.res, 400) : '', note: text(o.rt, 300), error: st === 'failed' ? text(o.res || 'It did not finish.', 400) : '', executionId: '', attempts: st === 'queued' ? 0 : 1 }); n++; });
    if (n) this._save(rows, teamId); return n;
  }
  /* at start-up: nothing can still be running, so anything left mid-run is marked failed (honest, and it can be run again) */
  recover() { const rows = this._rows(); let n = 0; rows.forEach((r) => { if (r && ACTIVE.includes(r.status)) { r.status = 'failed'; r.completedAt = this.now(); r.error = 'Regis was closed while this task was running.'; n++; } }); if (n) this.table.save(rows); return n; }
}
module.exports = { TaskStore, STATUS, ACTIVE, DONE, NEXT };
