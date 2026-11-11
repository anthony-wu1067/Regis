'use strict';
/* Tools (1.9.7, approvals in 1.9.8): structured abilities a team can use, each with a risk level. A team can only run tools
   listed on the team. What may run is decided here, by the tool's risk, never by who is asking or how they are described:
     READ, DRAFT   run by themselves (a draft changes nothing outside Regis)
     WRITE         runs only when the owner approved that exact tool and input (ApprovalStore); otherwise a request is filed
     DESTRUCTIVE   never runs in this version */
const err = (code, message, extra) => Object.assign(new Error(message), { code }, extra || {});
const RISK = ['READ', 'DRAFT', 'WRITE', 'DESTRUCTIVE'];
const HOW = { READ: 'Runs by itself (only reads)', DRAFT: 'Runs by itself (drafts only, changes nothing outside Regis)', WRITE: 'Needs your approval every time', DESTRUCTIVE: 'Blocked in this version' };

class ToolRegistry {
  constructor({ approvals = null } = {}) { this.tools = {}; this.approvals = approvals; }
  register(d) {
    if (!d || !/^[a-z][a-z0-9_.-]{1,59}$/.test(d.id || '')) throw err('bad_tool', 'A tool needs an id.');
    if (typeof d.execute !== 'function') throw err('bad_tool', 'A tool needs an execute function.');
    const risk = RISK.includes(d.risk) ? d.risk : 'DESTRUCTIVE';   /* unknown risk is treated as the most dangerous */
    this.tools[d.id] = { id: d.id, name: String(d.name || d.id).slice(0, 60), description: String(d.description || '').slice(0, 300), capability: String(d.capability || '').slice(0, 60), inputSchema: d.inputSchema || {}, risk, permissions: (d.permissions || []).map(String), execute: d.execute };
    return this.describe(d.id);
  }
  describe(id) { const t = this.tools[id]; return t ? { id: t.id, name: t.name, description: t.description, capability: t.capability, risk: t.risk, permissions: t.permissions.slice(), availability: HOW[t.risk], available: t.risk !== 'DESTRUCTIVE' } : null; }
  list(team) { return Object.keys(this.tools).filter((id) => !team || (team.tools || []).includes(id)).map((id) => this.describe(id)); }
  async run(id, input, ctx) {
    const t = this.tools[id]; if (!t) throw err('no_tool', 'Unknown tool.');
    const team = ctx && ctx.team; if (!team || !(team.tools || []).includes(id)) throw err('no_permission', 'This team may not use that tool.');
    input = input || {};
    if (t.risk === 'DESTRUCTIVE') throw err('blocked', 'Tools that delete or destroy are blocked in this version of Regis.');
    if (t.risk === 'WRITE') {
      if (!this.approvals) throw err('needs_approval', 'This tool writes outside Regis and needs your approval, which is not available here.');
      if (!this.approvals.consume(team.id, id, input)) {
        const req = this.approvals.request({ teamId: team.id, memberId: ctx.memberId, toolId: id, risk: 'WRITE', input, summary: (ctx.summary || t.description), executionId: ctx.executionId });
        throw err('needs_approval', 'This needs your approval first. Regis did not run it.', { approvalId: req.id });
      }
    }
    return t.execute(input, ctx);
  }
}
/* the tools Regis itself provides: both only read */
function builtin(reg, { memory }) {
  reg.register({ id: 'memory.read', name: 'Team memory', description: 'Read this team’s own memory (newest items).', capability: 'Recall', risk: 'READ', permissions: ['memory.read'], execute: (_i, ctx) => memory.block(ctx.team.id, 12) });
  reg.register({ id: 'regis.tasks.read', name: 'Your Regis tasks', description: 'Read your open Regis tasks (as given with the request).', capability: 'Task list', risk: 'READ', permissions: ['regis.tasks.read'], execute: (_i, ctx) => String((ctx.extra && ctx.extra.tasks) || '').slice(0, 6000) });
  return reg;
}
module.exports = { ToolRegistry, builtin, RISK };
