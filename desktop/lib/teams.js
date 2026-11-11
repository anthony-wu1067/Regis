'use strict';
/* Teams (1.9.7, extended in 1.9.8). A team is an organisation, not a prompt: a mission, one lead, specialists, tools, workflows,
   knowledge, its own memory scope, KPIs and a policy. The four original agents each lead the team with the same id, so everything
   saved under those ids (chats, add-ins, the local-AI switch) still belongs to them.
   Four separate things describe a member, and they are kept apart on purpose:
     role          what the member is responsible for            capabilities   what kind of work they can do
     permissions   what they are ALLOWED to do: never stored on a member; it comes from the team's tools and the approval rules
     persona       how the member comes across (archetype, traits, communication style): presentation only, never authority
   What is stored is only what the owner changed (policy, KPI values); the rest comes from the seeds and from register*(), which is
   the door a later plugin system will use. `table` is { load() -> object, save(object) }. */
const { AGENTS } = require('./agents.js');
const { cleanLimits, LIMITS } = require('./ledger.js');
const err = (code, message) => Object.assign(new Error(message), { code });

const ESCALATION = ['local-only', 'never-automatic', 'when-needed', 'claude-preferred', 'claude-only'];
const DEFAULT_POLICY = { defaultEngine: 'local', complexEngine: 'claude', escalationPolicy: 'when-needed', maxClaudeCallsPerTask: LIMITS.perTask, maxDailyClaudeCost: LIMITS.teamDaily, requireApprovalForExternalWrites: true };
const list = (a, n, m) => (Array.isArray(a) ? a : []).map((x) => String(x).slice(0, m || 60)).filter(Boolean).slice(0, n);
function cleanPersona(p) {
  p = p && typeof p === 'object' ? p : {};
  return { archetype: String(p.archetype || '').slice(0, 60), description: String(p.description || '').slice(0, 300), traits: list(p.traits, 8, 30), communicationStyle: String(p.communicationStyle || '').slice(0, 300), strengths: list(p.strengths, 8, 40) };
}

/* specialists: narrow workers the lead hands a step to. They have a name and a persona, but no chat of their own. */
const SPECIALISTS = {};
function registerSpecialist(d) {
  if (!d || !/^[a-z][a-z0-9-]{1,39}$/.test(d.id || '')) throw err('bad_specialist', 'A specialist needs an id (lower-case letters, digits, dashes).');
  SPECIALISTS[d.id] = { id: d.id, team: String(d.team || ''), type: 'specialist', name: String(d.name || d.role || d.id).slice(0, 40), role: String(d.role || d.id).slice(0, 80), instructions: String(d.instructions || '').slice(0, 4000),
    capabilities: list(d.capabilities, 12, 30).map((c) => c.toLowerCase()), persona: cleanPersona(d.persona) };
  return SPECIALISTS[d.id];
}
[
  { id: 'ops-researcher', team: 'exusiai', name: 'Nora', role: 'Operations Researcher', capabilities: ['research', 'summarize', 'classify'],
    persona: { archetype: 'The Fact-Finder', description: 'Collects what is actually known before anyone plans, and says plainly what is missing.', traits: ['thorough', 'plain-spoken', 'patient'], communicationStyle: 'Short lists of facts, each marked known or missing.', strengths: ['gathering facts', 'spotting gaps', 'sorting information'] },
    instructions: 'Gather the facts the lead needs for a business operations task: what is known, what is missing, and which of the owner\'s open tasks are relevant. Never invent facts or tasks.' },
  { id: 'ops-planner', team: 'exusiai', name: 'Felix', role: 'Planner', capabilities: ['plan', 'prioritize', 'breakdown'],
    persona: { archetype: 'The Organiser', description: 'Turns a loose goal into ordered steps with a clear finish line for each.', traits: ['structured', 'decisive', 'practical'], communicationStyle: 'Numbered steps, each with a priority and what done looks like.', strengths: ['breaking work down', 'prioritising', 'sequencing'] },
    instructions: 'Break a goal into a short ordered list of concrete steps with a priority (P1-P3) and what "done" looks like for each.' },
  { id: 'cost-analyst', team: 'midas', name: 'Iris', role: 'Cost Analyst', capabilities: ['analyze', 'calculate', 'compare'],
    persona: { archetype: 'The Numbers Person', description: 'Trusts arithmetic over impressions and shows every step of it.', traits: ['exact', 'sceptical', 'calm'], communicationStyle: 'A small table of inputs and results, with assumptions marked.', strengths: ['unit economics', 'comparisons', 'checking sums'] },
    instructions: 'Lay out the numbers for a cost, pricing or margin question as a small table of inputs and results. Show the arithmetic. Mark every number the owner did not give as an assumption.' },
  { id: 'market-researcher', team: 'midas', name: 'Theo', role: 'Market Researcher', capabilities: ['research', 'summarize'],
    persona: { archetype: 'The Curious Analyst', description: 'Looks for patterns in the market and is comfortable saying "I don\'t know".', traits: ['curious', 'observant', 'honest about gaps'], communicationStyle: 'Clear and evidence-first; says what would need checking.', strengths: ['market context', 'competitor notes', 'summarising'] },
    instructions: 'Summarise what is known about the market, competitors or suppliers relevant to the task, and list what would need checking. Say plainly when you do not know.' },
  { id: 'copy-editor', team: 'luna', name: 'June', role: 'Copy Editor', capabilities: ['summarize', 'draft', 'structure'],
    persona: { archetype: 'The Clear Writer', description: 'Finds the one thing a page has to say and arranges everything else around it.', traits: ['concise', 'faithful to the source', 'orderly'], communicationStyle: 'Outlines in the reader\'s order, in the owner\'s own words.', strengths: ['structure', 'outlines', 'spotting gaps in copy'] },
    instructions: 'Turn the supplied copy into a clear page outline: sections in order, the one main call to action, and any gaps. Keep the owner\'s words; do not invent claims.' },
  { id: 'ux-reviewer', team: 'luna', name: 'Marco', role: 'UX Reviewer', capabilities: ['review', 'analyze'],
    persona: { archetype: 'The Careful Critic', description: 'Reads a brief as the least patient visitor on the smallest phone would.', traits: ['observant', 'user-minded', 'direct'], communicationStyle: 'Short checklists, most important first.', strengths: ['accessibility', 'responsive layout', 'visual hierarchy'] },
    instructions: 'List the accessibility, responsiveness and hierarchy points the page must get right for this brief, as a short checklist.' },
  { id: 'systems-designer', team: 'obsidian', name: 'Ren', role: 'Systems Designer', capabilities: ['plan', 'analyze', 'breakdown'],
    persona: { archetype: 'The Architect', description: 'Draws the whole system before anyone writes a line of it.', traits: ['methodical', 'big-picture', 'precise'], communicationStyle: 'Components, where each lives, and what they pass to each other.', strengths: ['system outlines', 'data flow', 'server authority'] },
    instructions: 'Outline the game system the task needs: which scripts, where each one lives in Roblox, what data they share and what the server must validate.' },
  { id: 'code-reviewer', team: 'obsidian', name: 'Vera', role: 'Code Reviewer', capabilities: ['review', 'analyze'],
    persona: { archetype: 'The Sceptic', description: 'Assumes every remote will be abused and every loop will run too often, until shown otherwise.', traits: ['sceptical', 'security-minded', 'blunt'], communicationStyle: 'A short list of risks, each with the fix.', strengths: ['exploit prevention', 'performance pitfalls', 'review'] },
    instructions: 'List the security and performance pitfalls to avoid for this script or system (remote validation, rate limits, per-frame work), as a short checklist.' }
].forEach(registerSpecialist);

/* KPI definitions: kind auto = worked out by Regis (from the task list, or from other KPIs); the others are numbers the owner types */
const K = (key, label, kind, def, limit) => ({ key, label, kind, def: def === undefined ? 0 : def, limit: limit === undefined ? null : limit });
const SEED = {
  exusiai: { name: 'Business Operations', mission: 'Keep the business organised: turn goals into prioritised work and learn from customers.', specialists: ['ops-researcher', 'ops-planner'], tools: ['memory.read', 'regis.tasks.read'],
    leadPersona: { archetype: 'The Energetic Organiser', description: 'Keeps the whole board moving: sorts, prioritises and hands work out quickly.', traits: ['upbeat', 'fast', 'organised'], communicationStyle: 'Brisk and practical; ends with what happens next.', strengths: ['prioritising', 'delegating', 'customer research'] },
    kpis: [K('q', 'In the queue', 'auto'), K('d7', 'Done this week', 'auto'), K('iv', 'Customer interviews', 'num'), K('goal', 'Weekly goal', 'pct')] },
  midas: { name: 'E-Commerce & Finance', mission: 'Know the numbers: unit costs, pricing and margins for the production run, within the caffeine limit.', specialists: ['cost-analyst', 'market-researcher'], tools: ['memory.read'],
    leadPersona: { archetype: 'The Calm Controller', description: 'Numbers first, no drama. Will not round his way past a limit.', traits: ['precise', 'calm', 'unbending on rules'], communicationStyle: 'Inputs, then the sum, then the conclusion; assumptions marked.', strengths: ['margins and pricing', 'cost tracking', 'guarding the caffeine cap'] },
    kpis: [K('units', 'Units in the R&D run', 'num', 15000), K('cost', 'Landed cost per unit', 'usd'), K('price', 'Price per unit', 'usd'), K('margin', 'Gross margin', 'auto'), K('caf', 'Caffeine per serving', 'mg', 0, 50)] },
  luna: { name: 'Web Studio', mission: 'Turn the owner\'s copy into high-quality, accessible landing pages.', specialists: ['copy-editor', 'ux-reviewer'], tools: ['memory.read'],
    leadPersona: { archetype: 'The Exacting Designer', description: 'A senior designer who cares about hierarchy, whitespace and keeping every word of the brief.', traits: ['tasteful', 'meticulous', 'confident'], communicationStyle: 'One or two lines on direction, then the work.', strengths: ['landing pages', 'visual hierarchy', 'accessible front-end code'] },
    kpis: [K('q', 'Pages in the queue', 'auto'), K('d7', 'Pages shipped this week', 'auto'), K('dall', 'Pages shipped in total', 'auto'), K('rev', 'Revisions asked for', 'num')] },
  obsidian: { name: 'Game Studio', mission: 'Design and script secure, fast Roblox experiences.', specialists: ['systems-designer', 'code-reviewer'], tools: ['memory.read'],
    leadPersona: { archetype: 'The Studio Veteran', description: 'Has shipped enough games to distrust the client and respect the frame budget.', traits: ['experienced', 'security-minded', 'exact'], communicationStyle: 'Says where each script goes and why, then gives the code.', strengths: ['Luau scripting', 'server authority', 'world design'] },
    kpis: [K('q', 'Scripts in the queue', 'auto'), K('d7', 'Delivered this week', 'auto'), K('biome', 'Biomes designed', 'num'), K('bugs', 'Open bugs', 'num')] }
};

function cleanPolicy(p, base) {
  const b = Object.assign({}, DEFAULT_POLICY, base || {}); p = p && typeof p === 'object' ? p : {};
  const eng = (v, d) => (v === 'local' || v === 'claude' ? v : d);
  const lim = cleanLimits({ perTask: p.maxClaudeCallsPerTask !== undefined ? p.maxClaudeCallsPerTask : b.maxClaudeCallsPerTask, teamDaily: p.maxDailyClaudeCost !== undefined ? p.maxDailyClaudeCost : b.maxDailyClaudeCost });
  return { defaultEngine: eng(p.defaultEngine, b.defaultEngine), complexEngine: eng(p.complexEngine, b.complexEngine),
    escalationPolicy: ESCALATION.includes(p.escalationPolicy) ? p.escalationPolicy : b.escalationPolicy,
    maxClaudeCallsPerTask: lim.perTask, maxDailyClaudeCost: lim.teamDaily, requireApprovalForExternalWrites: true };   /* approvals cannot be switched off */
}

class TeamStore {
  constructor({ table } = {}) { this.table = table || { load: () => this._mem || {}, save: (o) => { this._mem = o; } }; this.extra = {}; }
  _data() { const d = this.table.load(); return d && typeof d === 'object' && !Array.isArray(d) ? d : {}; }
  _seed(id) { return SEED[id] && AGENTS[id] ? SEED[id] : this.extra[id] || null; }
  ids() { return Object.keys(SEED).filter((k) => AGENTS[k]).concat(Object.keys(this.extra)); }
  /* a team defined in code (later: by a plugin). Not stored; it must be registered again at start-up. */
  register(t) { if (!t || !/^[a-z][a-z0-9-]{1,39}$/.test(t.id || '') || SEED[t.id]) throw err('bad_team', 'A team needs a new id.'); this.extra[t.id] = t; return this.get(t.id); }
  get(id) {
    id = String(id || ''); const seed = this._seed(id); if (!seed) return null;
    const a = AGENTS[seed.lead && seed.lead.agentId ? seed.lead.agentId : id] || null, st = (this._data().teams || {})[id] || {};
    return { id, name: seed.name, mission: seed.mission || '',
      lead: { id: a ? a.id : id, agentId: a ? a.id : id, type: 'lead', name: a ? a.name : seed.name, role: a ? a.role : 'Lead', persona: cleanPersona(seed.leadPersona) },
      specialists: (seed.specialists || []).filter((s) => SPECIALISTS[s]), tools: (seed.tools || []).slice(), workflows: (seed.workflows || []).slice(), knowledge: (seed.knowledge || []).slice(),
      memory: { scope: id }, kpis: (seed.kpis || []).map((k) => Object.assign({}, k)), policy: cleanPolicy(st.policy, seed.policy) };
  }
  list() { return this.ids().map((id) => this.get(id)); }
  specialist(id) { return SPECIALISTS[id] || null; }
  /* every member of a team as one shape: the lead first. Member ids: the lead's is the team/agent id, a specialist's is its own id. */
  members(teamId) {
    const t = this.get(teamId); if (!t) return [];
    const a = AGENTS[t.lead.agentId] || {};
    return [{ id: t.lead.id, teamId: t.id, type: 'lead', name: t.lead.name, role: t.lead.role, capabilities: ['lead', 'plan', 'delegate', 'review'], persona: t.lead.persona, color: a.color || '' }]
      .concat(t.specialists.map((s) => { const x = SPECIALISTS[s]; return { id: x.id, teamId: t.id, type: 'specialist', name: x.name, role: x.role, capabilities: x.capabilities.slice(), persona: x.persona, color: '' }; }));
  }
  member(memberId) { memberId = String(memberId || ''); for (const id of this.ids()) { const m = this.members(id).find((x) => x.id === memberId); if (m) return m; } return null; }
  setPolicy(id, patch) {
    const t = this.get(id); if (!t && id !== 'regis') throw err('bad_team', 'Unknown team.');
    const d = this._data(); d.teams = d.teams || {}; const cur = (d.teams[id] && d.teams[id].policy) || {};
    d.teams[id] = Object.assign({}, d.teams[id], { policy: cleanPolicy(Object.assign({}, cur, patch || {})) }); this.table.save(d);
    return d.teams[id].policy;
  }
  /* KPI numbers the owner typed (the definitions come from the team) */
  kpiValues(id) { const v = ((this._data().teams || {})[String(id || '')] || {}).kpi; return v && typeof v === 'object' ? Object.assign({}, v) : {}; }
  kpiSet(id, key, value) {
    const t = this.get(id); if (!t) throw err('bad_team', 'Unknown team.'); const def = t.kpis.find((k) => k.key === key); if (!def || def.kind === 'auto') throw err('bad_kpi', 'That number cannot be set.');
    let n = +value; if (!isFinite(n) || n < 0) n = 0; n = Math.min(n, 1e12);
    const d = this._data(); d.teams = d.teams || {}; d.teams[id] = Object.assign({}, d.teams[id]); d.teams[id].kpi = Object.assign({}, d.teams[id].kpi, { [key]: n }); this.table.save(d); return n;
  }
  /* "regis" is everything outside the teams (Plan my day, mail rules, the command bar): it has limits but no lead */
  policy(id) { const t = this.get(id); if (t) return t.policy; return cleanPolicy(((this._data().teams || {})[String(id || 'regis')] || {}).policy); }
  global() { return { maxDailyClaudeCost: cleanLimits({ globalDaily: (this._data().global || {}).maxDailyClaudeCost }).globalDaily }; }
  setGlobal(patch) { const d = this._data(); d.global = { maxDailyClaudeCost: cleanLimits({ globalDaily: patch && patch.maxDailyClaudeCost }).globalDaily }; this.table.save(d); return d.global; }
  /* what the ledger enforces for a team */
  limits(id) { const p = this.policy(id); return { perTask: p.maxClaudeCallsPerTask, teamDaily: p.maxDailyClaudeCost, globalDaily: this.global().maxDailyClaudeCost }; }
  /* one-time flags (for bringing old page data across) */
  flag(k) { return !!(this._data().flags || {})[k]; }
  setFlag(k) { const d = this._data(); d.flags = Object.assign({}, d.flags, { [k]: 1 }); this.table.save(d); }
}
module.exports = { TeamStore, SPECIALISTS, registerSpecialist, DEFAULT_POLICY, ESCALATION, cleanPolicy, cleanPersona };
