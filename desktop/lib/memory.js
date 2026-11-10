'use strict';
/* 1.9.7 Team memory: what a team has learned and should keep (decisions, facts, results), as opposed to chat history
   (what was recently said). One table, every row has a scope (the team id); reads always filter by scope, so one team
   never sees another team's memory. `table` is { load() -> rows[], save(rows) }. */
const err = (code, message) => Object.assign(new Error(message), { code });
const KINDS = ['fact', 'decision', 'result', 'preference', 'rule', 'note'];
const PER_TEAM = 200, MAX_TEXT = 600;

class TeamMemory {
  constructor({ table, now = Date.now } = {}) { this.table = table || { load: () => this._mem || [], save: (r) => { this._mem = r; } }; this.now = now; }
  _rows() { const r = this.table.load(); return Array.isArray(r) ? r : []; }
  list(scope, n) { scope = String(scope || ''); const l = this._rows().filter((r) => r && r.scope === scope); return (n ? l.slice(-n) : l).map((r) => ({ id: r.id, kind: r.kind, text: r.text, at: r.at, taskId: r.taskId || '' })); }
  add(scope, item) {
    scope = String(scope || ''); const text = String((item && item.text) || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    if (!scope) throw err('bad_scope', 'Memory needs a team.'); if (!text) throw err('empty', 'Nothing to remember.');
    const row = { id: Math.random().toString(36).slice(2, 10), scope, kind: KINDS.includes(item.kind) ? item.kind : 'note', text, at: this.now(), taskId: String(item.taskId || '').slice(0, 60) };
    let rows = this._rows(); rows.push(row);
    /* keep the newest PER_TEAM for this team; other teams' rows are untouched */
    const mine = rows.filter((r) => r && r.scope === scope); if (mine.length > PER_TEAM) { const drop = new Set(mine.slice(0, mine.length - PER_TEAM).map((r) => r.id)); rows = rows.filter((r) => !drop.has(r.id)); }
    this.table.save(rows); return { id: row.id, kind: row.kind, text: row.text, at: row.at, taskId: row.taskId };
  }
  remove(scope, id) { scope = String(scope || ''); const rows = this._rows(), keep = rows.filter((r) => !(r && r.scope === scope && r.id === id)); this.table.save(keep); return keep.length !== rows.length; }
  /* the text handed to a lead: newest few items, clearly marked as notes rather than instructions */
  block(scope, n) { const l = this.list(scope, n || 8); return l.length ? l.map((m) => '- (' + m.kind + ') ' + m.text).join('\n') : ''; }
}
module.exports = { TeamMemory, KINDS };
