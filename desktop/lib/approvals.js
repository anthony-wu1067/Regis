'use strict';
/* 1.9.8 Approvals: the boundary between what a team may do by itself and what needs the owner's yes.
     READ         runs by itself                        DRAFT   runs by itself: a draft changes nothing outside Regis
     WRITE        runs only with an approval the owner gave for that exact tool and input, and only once
     DESTRUCTIVE  never runs in this version, approved or not
   An approval is a record: who asked, which tool, what input (a fingerprint of it), and the owner's decision. Only decide() can
   approve, and it is only reachable from the owner's own click in Regis: no model output, soul or tool can approve anything.
   `table` is { load() -> rows[], save(rows) }. */
const err = (code, message) => Object.assign(new Error(message), { code });
const TTL = 24 * 3600 * 1000, MAX = 200;
function fingerprint(toolId, input) {   /* small stable hash of the tool and its exact input (not security-critical: approvals never leave this computer) */
  const s = String(toolId) + '\n' + JSON.stringify(input === undefined ? null : input, Object.keys(input && typeof input === 'object' ? input : {}).sort()); let h = 5381, g = 52711;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h = (h * 33) ^ c; g = (g * 33) ^ c; } return (h >>> 0).toString(36) + (g >>> 0).toString(36);
}
const view = (r) => ({ id: r.id, teamId: r.teamId, memberId: r.memberId || '', toolId: r.toolId, risk: r.risk, summary: r.summary || '', status: r.status, createdAt: r.createdAt, decidedAt: r.decidedAt || 0, executionId: r.executionId || '' });

class ApprovalStore {
  constructor({ table, now = Date.now, onChange = null } = {}) { this.table = table || { load: () => this._mem || [], save: (r) => { this._mem = r; } }; this.now = now; this.onChange = onChange; }
  _rows() { const now = this.now(), r = this.table.load(), rows = Array.isArray(r) ? r : []; rows.forEach((x) => { if (x && x.status === 'pending' && now - x.createdAt > TTL) x.status = 'expired'; }); return rows; }
  _save(rows, teamId) { this.table.save(rows.slice(-MAX)); if (this.onChange) { try { this.onChange(teamId); } catch (_) {} } }
  /* a team asks for permission; returns the pending request (or the one already waiting for the same thing) */
  request(d) {
    d = d || {}; if (!d.teamId || !d.toolId) throw err('bad_request', 'An approval needs a team and a tool.');
    if (d.risk !== 'WRITE') throw err('bad_request', d.risk === 'DESTRUCTIVE' ? 'Tools that delete or destroy cannot be approved in this version.' : 'Only tools that write need approval.');
    const fp = fingerprint(d.toolId, d.input), rows = this._rows(), same = rows.find((r) => r.status === 'pending' && r.teamId === d.teamId && r.fp === fp); if (same) return view(same);
    const row = { id: 'ap' + Math.random().toString(36).slice(2, 9), teamId: String(d.teamId), memberId: String(d.memberId || '').slice(0, 40), toolId: String(d.toolId).slice(0, 60), risk: 'WRITE', fp, summary: String(d.summary || '').replace(/\s+/g, ' ').slice(0, 400), status: 'pending', createdAt: this.now(), decidedAt: 0, executionId: String(d.executionId || '').slice(0, 80) };
    rows.push(row); this._save(rows, row.teamId); return view(row);
  }
  /* the owner's decision. `by` must be 'owner': the only caller that passes it is the page's own approve/deny button handler. */
  decide(id, ok, by) { if (by !== 'owner') throw err('not_owner', 'Only the owner can decide an approval.'); const rows = this._rows(), r = rows.find((x) => x.id === id); if (!r) throw err('no_approval', 'That request no longer exists.'); if (r.status !== 'pending') throw err('decided', 'That request was already ' + r.status + '.');
    r.status = ok ? 'approved' : 'denied'; r.decidedAt = this.now(); this._save(rows, r.teamId); return view(r); }
  /* use up an approval for exactly this tool and input; true only once */
  consume(teamId, toolId, input) { const fp = fingerprint(toolId, input), rows = this._rows(), r = rows.find((x) => x.status === 'approved' && x.teamId === teamId && x.toolId === toolId && x.fp === fp); if (!r) return false; r.status = 'used'; this._save(rows, teamId); return true; }
  list(teamId, status) { return this._rows().filter((r) => r && (!teamId || r.teamId === teamId) && (!status || r.status === status)).slice(-40).reverse().map(view); }
}
module.exports = { ApprovalStore, fingerprint };
