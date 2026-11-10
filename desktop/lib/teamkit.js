'use strict';
/* 1.9.7 Puts the team system together the same way in the desktop app and the web build.
   table(key, fallback) -> { load, save } says where each kind of data is kept (the app's data file, or the browser's storage).
   Returns the metered Claude client (use it for EVERY Claude call), the Guild, and `api`: the functions the page may call. */
const { Guild, agentList, AGENTS, systemFor } = require('./agents.js');
const { Ledger, meter } = require('./ledger.js');
const { TeamStore } = require('./teams.js');
const { TeamMemory } = require('./memory.js');
const { ToolRegistry, builtin: builtinTools } = require('./tools.js');
const { WorkflowRegistry, builtin: builtinFlows } = require('./workflows.js');
const { Orchestrator } = require('./orchestrator.js');
const err = (code, message) => Object.assign(new Error(message), { code });

function teamKit({ anthropic, local = null, prefs = () => ({}), table, now = Date.now }) {
  const teams = new TeamStore({ table: table('teams', {}) }), ledger = new Ledger({ table: table('claudeLedger', []), now });
  const claude = meter(anthropic, ledger, (id) => teams.limits(id));
  const guild = new Guild({ anthropic: claude, local, prefs, table: table('guild', []), now });
  const memory = new TeamMemory({ table: table('teamMemory', []), now }), tools = builtinTools(new ToolRegistry(), { memory }), workflows = builtinFlows(new WorkflowRegistry());
  const orch = new Orchestrator({ teams, ledger, memory, tools, workflows, claude, local, prefs, guild, agents: AGENTS, systemFor, now });
  const obj = (x) => (x && typeof x === 'object' ? x : {});
  const view = (id) => {
    const t = teams.get(String(id || '')); if (!t) throw err('bad_team', 'Unknown team.');
    return Object.assign({}, t, { specialists: t.specialists.map((s) => { const x = teams.specialist(s); return { id: x.id, role: x.role, capabilities: x.capabilities }; }), tools: tools.list(t),
      workflows: workflows.list(t.id).map((f) => ({ id: f.id, name: f.name, trigger: f.trigger.type })), global: teams.global(), ledger: ledger.summary(t.id, teams.limits(t.id)), memoryItems: memory.list(t.id, 12).reverse(), localAI: !!local });
  };
  const api = {
    get: (id) => view(id),
    policy: (id, patch) => { if (!teams.get(String(id || ''))) throw err('bad_team', 'Unknown team.'); teams.setPolicy(String(id), obj(patch)); return view(id); },
    global: (patch) => teams.setGlobal(obj(patch)),
    run: (id, task, extra) => { task = obj(task); extra = obj(extra); return orch.runTask(String(id || ''), { id: task.id, title: task.title, notes: task.notes, engine: task.engine }, { tasks: extra.tasks, file: extra.file, addins: extra.addins }); },
    memAdd: (id, text) => { if (!teams.get(String(id || ''))) throw err('bad_team', 'Unknown team.'); return memory.add(String(id), { kind: 'note', text }); },
    memDel: (id, mid) => memory.remove(String(id || ''), String(mid || '')),
    ledger: () => ledger.summary('', teams.limits('regis'))
  };
  /* Regis's own Claude calls (Plan my day, mail rules, the command bar): counted as team "regis"; the caller cannot choose another team */
  const sample = async (input, opts) => { const o = Object.assign({}, obj(opts), { meter: { teamId: 'regis', taskId: '' } }); if (o.json) return { value: await claude.json(input, o) }; const r = await claude.sample(input, o); return { text: r.text, truncated: r.truncated }; };
  return { teams, ledger, claude, guild, memory, tools, workflows, orch, api, sample, agentList };
}
module.exports = { teamKit };
