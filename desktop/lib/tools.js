'use strict';
/* 1.9.7 Tools: structured abilities a team can use, each with a risk level. In this phase only READ tools can run;
   DRAFT, WRITE and DESTRUCTIVE tools can be registered (so later plugins have a stable shape) but are refused until the
   approval system exists. A team can only run tools listed on the team. */
const err = (code, message) => Object.assign(new Error(message), { code });
const RISK = ['READ', 'DRAFT', 'WRITE', 'DESTRUCTIVE'];

class ToolRegistry {
  constructor() { this.tools = {}; }
  register(d) {
    if (!d || !/^[a-z][a-z0-9_.-]{1,59}$/.test(d.id || '')) throw err('bad_tool', 'A tool needs an id.');
    if (typeof d.execute !== 'function') throw err('bad_tool', 'A tool needs an execute function.');
    const risk = RISK.includes(d.risk) ? d.risk : 'DESTRUCTIVE';   /* unknown risk is treated as the most dangerous */
    this.tools[d.id] = { id: d.id, description: String(d.description || '').slice(0, 300), inputSchema: d.inputSchema || {}, risk, permissions: (d.permissions || []).map(String), execute: d.execute };
    return this.describe(d.id);
  }
  describe(id) { const t = this.tools[id]; return t ? { id: t.id, description: t.description, risk: t.risk, permissions: t.permissions.slice() } : null; }
  list(team) { return Object.keys(this.tools).filter((id) => !team || (team.tools || []).includes(id)).map((id) => this.describe(id)); }
  async run(id, input, ctx) {
    const t = this.tools[id]; if (!t) throw err('no_tool', 'Unknown tool.');
    const team = ctx && ctx.team; if (!team || !(team.tools || []).includes(id)) throw err('no_permission', 'This team may not use that tool.');
    if (t.risk !== 'READ') throw err('needs_approval', 'Tools that draft, write or delete need your approval, which Regis does not have yet.');
    return t.execute(input || {}, ctx);
  }
}
/* the tools Regis itself provides */
function builtin(reg, { memory }) {
  reg.register({ id: 'memory.read', description: 'Read this team’s own memory (newest items).', risk: 'READ', permissions: ['memory.read'], execute: (_i, ctx) => memory.block(ctx.team.id, 12) });
  reg.register({ id: 'regis.tasks.read', description: 'Read the owner’s open Regis tasks (as given with the request).', risk: 'READ', permissions: ['regis.tasks.read'], execute: (_i, ctx) => String((ctx.extra && ctx.extra.tasks) || '').slice(0, 6000) });
  return reg;
}
module.exports = { ToolRegistry, builtin, RISK };
