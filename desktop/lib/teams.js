'use strict';
/* 1.9.7 Teams. A team is an organisation, not a prompt: it has a mission, one lead, specialists, tools, workflows, knowledge,
   its own memory scope, KPIs and a policy. The four original agents each lead the team with the same id, so everything saved
   under those ids (chats, queue, add-ins, local-AI switch) still belongs to them.
   What is stored is only what the owner changed (policy, limits); the rest comes from the seeds below and from register*(),
   which is the door a later plugin system will use. `table` is { load() -> object, save(object) }. */
const { AGENTS } = require('./agents.js');
const { cleanLimits, LIMITS } = require('./ledger.js');
const err = (code, message) => Object.assign(new Error(message), { code });

const ESCALATION = ['local-only', 'never-automatic', 'when-needed', 'claude-preferred', 'claude-only'];
const DEFAULT_POLICY = { defaultEngine: 'local', complexEngine: 'claude', escalationPolicy: 'when-needed', maxClaudeCallsPerTask: LIMITS.perTask, maxDailyClaudeCost: LIMITS.teamDaily, requireApprovalForExternalWrites: true };

/* specialists: narrow workers the lead can hand a step to. They have no chat of their own. */
const SPECIALISTS = {};
function registerSpecialist(d) {
  if (!d || !/^[a-z][a-z0-9-]{1,39}$/.test(d.id || '')) throw err('bad_specialist', 'A specialist needs an id (lower-case letters, digits, dashes).');
  SPECIALISTS[d.id] = { id: d.id, team: String(d.team || ''), type: 'specialist', role: String(d.role || d.id).slice(0, 80), instructions: String(d.instructions || '').slice(0, 4000),
    capabilities: (Array.isArray(d.capabilities) ? d.capabilities : []).map((c) => String(c).toLowerCase().slice(0, 30)).slice(0, 12) };
  return SPECIALISTS[d.id];
}
[
  { id: 'ops-researcher', team: 'exusiai', role: 'Operations Researcher', capabilities: ['research', 'summarize', 'classify'], instructions: 'Gather the facts the lead needs for a business operations task: what is known, what is missing, and which of the owner\'s open tasks are relevant. Never invent facts or tasks.' },
  { id: 'ops-planner', team: 'exusiai', role: 'Planner', capabilities: ['plan', 'prioritize', 'breakdown'], instructions: 'Break a goal into a short ordered list of concrete steps with a priority (P1-P3) and what "done" looks like for each.' },
  { id: 'cost-analyst', team: 'midas', role: 'Cost Analyst', capabilities: ['analyze', 'calculate', 'compare'], instructions: 'Lay out the numbers for a cost, pricing or margin question as a small table of inputs and results. Show the arithmetic. Mark every number the owner did not give as an assumption.' },
  { id: 'market-researcher', team: 'midas', role: 'Market Researcher', capabilities: ['research', 'summarize'], instructions: 'Summarise what is known about the market, competitors or suppliers relevant to the task, and list what would need checking. Say plainly when you do not know.' },
  { id: 'copy-editor', team: 'luna', role: 'Copy Editor', capabilities: ['summarize', 'draft', 'structure'], instructions: 'Turn the supplied copy into a clear page outline: sections in order, the one main call to action, and any gaps. Keep the owner\'s words; do not invent claims.' },
  { id: 'ux-reviewer', team: 'luna', role: 'UX Reviewer', capabilities: ['review', 'analyze'], instructions: 'List the accessibility, responsiveness and hierarchy points the page must get right for this brief, as a short checklist.' },
  { id: 'systems-designer', team: 'obsidian', role: 'Systems Designer', capabilities: ['plan', 'analyze', 'breakdown'], instructions: 'Outline the game system the task needs: which scripts, where each one lives in Roblox, what data they share and what the server must validate.' },
  { id: 'code-reviewer', team: 'obsidian', role: 'Code Reviewer', capabilities: ['review', 'analyze'], instructions: 'List the security and performance pitfalls to avoid for this script or system (remote validation, rate limits, per-frame work), as a short checklist.' }
].forEach(registerSpecialist);

const SEED = {
  exusiai: { name: 'Business Operations', mission: 'Keep the business organised: turn goals into prioritised work and learn from customers.', specialists: ['ops-researcher', 'ops-planner'], tools: ['memory.read', 'regis.tasks.read'] },
  midas: { name: 'E-Commerce & Finance', mission: 'Know the numbers: unit costs, pricing and margins for the production run, within the caffeine limit.', specialists: ['cost-analyst', 'market-researcher'], tools: ['memory.read'] },
  luna: { name: 'Web Studio', mission: 'Turn the owner\'s copy into high-quality, accessible landing pages.', specialists: ['copy-editor', 'ux-reviewer'], tools: ['memory.read'] },
  obsidian: { name: 'Game Studio', mission: 'Design and script secure, fast Roblox experiences.', specialists: ['systems-designer', 'code-reviewer'], tools: ['memory.read'] }
};

function cleanPolicy(p, base) {
  const b = Object.assign({}, DEFAULT_POLICY, base || {}); p = p && typeof p === 'object' ? p : {};
  const eng = (v, d) => (v === 'local' || v === 'claude' ? v : d);
  const lim = cleanLimits({ perTask: p.maxClaudeCallsPerTask !== undefined ? p.maxClaudeCallsPerTask : b.maxClaudeCallsPerTask, teamDaily: p.maxDailyClaudeCost !== undefined ? p.maxDailyClaudeCost : b.maxDailyClaudeCost });
  return { defaultEngine: eng(p.defaultEngine, b.defaultEngine), complexEngine: eng(p.complexEngine, b.complexEngine),
    escalationPolicy: ESCALATION.includes(p.escalationPolicy) ? p.escalationPolicy : b.escalationPolicy,
    maxClaudeCallsPerTask: lim.perTask, maxDailyClaudeCost: lim.teamDaily, requireApprovalForExternalWrites: true };   /* approvals cannot be switched off in this phase */
}

class TeamStore {
  constructor({ table } = {}) { this.table = table || { load: () => this._mem || {}, save: (o) => { this._mem = o; } }; this.extra = {}; }
  _data() { const d = this.table.load(); return d && typeof d === 'object' && !Array.isArray(d) ? d : {}; }
  ids() { return Object.keys(SEED).filter((k) => AGENTS[k]).concat(Object.keys(this.extra)); }
  /* a team defined in code (later: by a plugin). Not stored; it must be registered again at start-up. */
  register(t) { if (!t || !/^[a-z][a-z0-9-]{1,39}$/.test(t.id || '') || SEED[t.id]) throw err('bad_team', 'A team needs a new id.'); this.extra[t.id] = t; return this.get(t.id); }
  get(id) {
    id = String(id || ''); const seed = SEED[id] && AGENTS[id] ? SEED[id] : this.extra[id]; if (!seed) return null;
    const a = AGENTS[seed.lead && seed.lead.agentId ? seed.lead.agentId : id] || null, st = (this._data().teams || {})[id] || {};
    return { id, name: seed.name, mission: seed.mission || '',
      lead: { agentId: a ? a.id : id, type: 'lead', name: a ? a.name : seed.name, role: a ? a.role : 'Lead' },
      specialists: (seed.specialists || []).filter((s) => SPECIALISTS[s]), tools: (seed.tools || []).slice(), workflows: (seed.workflows || []).slice(), knowledge: (seed.knowledge || []).slice(),
      memory: { scope: id }, kpis: [], policy: cleanPolicy(st.policy, seed.policy) };
  }
  list() { return this.ids().map((id) => this.get(id)); }
  specialist(id) { return SPECIALISTS[id] || null; }
  setPolicy(id, patch) {
    const t = this.get(id); if (!t && id !== 'regis') throw err('bad_team', 'Unknown team.');
    const d = this._data(); d.teams = d.teams || {}; const cur = (d.teams[id] && d.teams[id].policy) || {};
    d.teams[id] = Object.assign({}, d.teams[id], { policy: cleanPolicy(Object.assign({}, cur, patch || {}), t ? null : null) }); this.table.save(d);
    return d.teams[id].policy;
  }
  /* "regis" is everything outside the teams (Plan my day, mail rules, the command bar): it has limits but no lead */
  policy(id) { const t = this.get(id); if (t) return t.policy; return cleanPolicy(((this._data().teams || {})[String(id || 'regis')] || {}).policy); }
  global() { return { maxDailyClaudeCost: cleanLimits({ globalDaily: (this._data().global || {}).maxDailyClaudeCost }).globalDaily }; }
  setGlobal(patch) { const d = this._data(); d.global = { maxDailyClaudeCost: cleanLimits({ globalDaily: patch && patch.maxDailyClaudeCost }).globalDaily }; this.table.save(d); return d.global; }
  /* what the ledger enforces for a team */
  limits(id) { const p = this.policy(id); return { perTask: p.maxClaudeCallsPerTask, teamDaily: p.maxDailyClaudeCost, globalDaily: this.global().maxDailyClaudeCost }; }
}
module.exports = { TeamStore, SPECIALISTS, registerSpecialist, DEFAULT_POLICY, ESCALATION, cleanPolicy };
