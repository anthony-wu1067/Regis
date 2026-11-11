'use strict';
/* Puts the team system together the same way in the desktop app and the web build (1.9.7; tasks, executions, usage, personas,
   souls and approvals in 1.9.8). table(key, fallback) -> { load, save } says where each kind of data is kept (the app's data file,
   or the browser's storage). Returns the metered Claude client (use it for EVERY Claude call), the Guild, and `api`: the only
   functions the page may call. The page never touches the stores; it reads one view per team (api.get) and asks for changes. */
const { Guild, agentList, AGENTS, systemFor } = require('./agents.js');
const { Ledger, meter } = require('./ledger.js');
const { TeamStore } = require('./teams.js');
const { TeamMemory } = require('./memory.js');
const { ToolRegistry, builtin: builtinTools } = require('./tools.js');
const { WorkflowRegistry, builtin: builtinFlows } = require('./workflows.js');
const { TaskStore, ACTIVE } = require('./tasks.js');
const { ExecutionStore } = require('./executions.js');
const { SoulStore } = require('./souls.js');
const { ApprovalStore } = require('./approvals.js');
const { Orchestrator } = require('./orchestrator.js');
const err = (code, message) => Object.assign(new Error(message), { code });
const WEEK = 7 * 864e5;

function teamKit({ anthropic, local = null, prefs = () => ({}), table, now = Date.now }) {
  const subs = []; let pend = null;
  /* tell listeners (the page) that a team's state changed; small steps are passed straight on so the Office can react at once */
  const emit = (teamId, ev) => { subs.forEach((f) => { try { f({ teamId: teamId || '', ev: ev || null }); } catch (_) {} }); };
  const teams = new TeamStore({ table: table('teams', {}) }), ledger = new Ledger({ table: table('claudeLedger', []), now });
  const claude = meter(anthropic, ledger, (id) => teams.limits(id));
  const tasks = new TaskStore({ table: table('teamTasks', []), now, onChange: (id) => emit(id, { type: 'tasks' }) });
  const executions = new ExecutionStore({ table: table('teamRuns', []), now, onChange: (id, ev) => emit(id, ev) });
  const souls = new SoulStore({ table: table('teamSouls', {}), now });
  const approvals = new ApprovalStore({ table: table('teamApprovals', []), now, onChange: (id) => emit(id, { type: 'approvals' }) });
  tasks.recover(); executions.recover();
  const guild = new Guild({ anthropic: claude, local, prefs, table: table('guild', []), now,
    soulFor: (agentId) => { const m = teams.member(agentId); return m ? souls.block(m) : ''; },
    onLocal: (e) => { try { ledger.recordLocal(e); } catch (_) {} } });
  const memory = new TeamMemory({ table: table('teamMemory', []), now }), tools = builtinTools(new ToolRegistry({ approvals }), { memory }), workflows = builtinFlows(new WorkflowRegistry());
  const orch = new Orchestrator({ teams, ledger, memory, tools, workflows, tasks, executions, souls, claude, local, prefs, guild, agents: AGENTS, systemFor, now });
  const obj = (x) => (x && typeof x === 'object' ? x : {});
  const need = (id) => { const t = teams.get(String(id || '')); if (!t) throw err('bad_team', 'Unknown team.'); return t; };
  const mine = (teamId, taskId) => { const t = tasks.get(String(taskId || '')); if (!t || t.teamId !== teamId) throw err('no_task', 'That task no longer exists.'); return t; };
  const nameOf = (id) => { const m = teams.member(id); return m ? m.name : id; };

  /* KPI values: typed numbers from the team's data, counted ones from the task list. Nothing is made up: unset means unset. */
  const kpis = (t) => { const v = teams.kpiValues(t.id), c = tasks.counts(t.id), weekAgo = now() - WEEK;
    const auto = (k) => (k === 'q' ? c.queued + c.active : k === 'd7' ? tasks.list(t.id, { status: 'completed' }).filter((x) => x.completedAt > weekAgo).length : k === 'dall' ? c.completed : k === 'margin' ? (+v.price > 0 && +v.cost > 0 ? Math.round((v.price - v.cost) / v.price * 1000) / 10 : null) : null);
    return t.kpis.map((k) => { const set = k.kind !== 'auto' && v[k.key] !== undefined, value = k.kind === 'auto' ? auto(k.key) : (set ? +v[k.key] : k.def);
      return { key: k.key, label: k.label, kind: k.kind, value, limit: k.limit, set: k.kind === 'auto' ? value !== null : (set || k.def !== 0), over: k.limit != null && value != null && value > k.limit }; }); };
  /* the activity feed: plain sentences built from execution records (never invented) */
  const activity = (runs) => { const out = [];
    runs.forEach((r) => { out.push({ at: r.startedAt, kind: 'start', text: 'Started “' + r.title + '”' });
      r.steps.forEach((s) => { const who = nameOf(s.who), eng = s.engine === 'claude' ? 'Claude' : s.engine === 'local' ? 'the local AI' : '';
        if (s.type === 'delegate') out.push({ at: s.at, kind: 'delegate', text: s.note });
        else if (s.type === 'specialist') out.push({ at: s.at, kind: s.ok ? 'specialist' : 'fail', text: s.ok ? who + ' handed in notes (' + eng + ')' : who + ' could not finish: ' + s.note });
        else if (s.type === 'lead' && s.ok) out.push({ at: s.at, kind: 'lead', text: who + ' wrote the result on ' + eng });
        else if (s.type === 'tool') out.push({ at: s.at, kind: s.ok ? 'tool' : 'fail', text: (s.ok ? 'Used the tool ' : 'Tool not run: ') + s.note });
        else if (s.type === 'escalate') out.push({ at: s.at, kind: 'escalate', text: s.note });
        else if (s.type === 'limit') out.push({ at: s.at, kind: 'limit', text: 'Stopped by a limit: ' + s.note });
        else if (s.type === 'memory') out.push({ at: s.at, kind: 'memory', text: s.note }); });
      if (r.status !== 'running') out.push({ at: r.endedAt, kind: r.status === 'completed' ? 'done' : 'fail', text: (r.status === 'completed' ? 'Completed' : r.status === 'refused' ? 'Not run' : 'Failed') + ' “' + r.title + '”' + (r.error ? ': ' + r.error : '') }); });
    return out.sort((a, b) => b.at - a.at).slice(0, 30); };
  /* who is doing what right now, from the orchestrator's live state and the lead's busy flag (chat) */
  const members = (t, runs) => { const lv = orch.live[t.id] || null, chatting = !!guild.busy[t.lead.agentId] && !lv;
    return teams.members(t.id).map((m) => { let status = 'idle', current = '';
      if (lv) { if (lv.who === m.id) { status = 'working'; current = lv.title; } else if (m.type === 'lead') { status = 'waiting'; current = 'Waiting for ' + nameOf(lv.who) + ' on “' + lv.title + '”'; } }
      else if (chatting && m.type === 'lead') { status = 'working'; current = 'Answering in chat'; }
      const recent = []; runs.forEach((r) => r.steps.forEach((s) => { if (s.who === m.id && (s.type === 'specialist' || s.type === 'lead')) recent.push({ at: s.at, text: (s.ok ? '' : 'Could not finish: ') + '“' + r.title + '”' + (s.engine ? ' (' + (s.engine === 'claude' ? 'Claude' : 'local AI') + ')' : '') }); }));
      const so = souls.custom(m.id);
      return Object.assign({}, m, { status, current, recent: recent.sort((a, b) => b.at - a.at).slice(0, 3), soul: { custom: !!so, name: so ? so.name : '', at: so ? so.at : 0 } }); }); };
  const view = (id) => {
    const t = need(id), runs = executions.list(t.id, 15), lv = orch.live[t.id] || null, lim = teams.limits(t.id), ms = members(t, runs);
    return { id: t.id, name: t.name, mission: t.mission, lead: t.lead, policy: t.policy, global: teams.global(), localAI: !!local, memory: t.memory,
      status: lv || guild.busy[t.lead.agentId] ? 'working' : 'idle', live: lv ? Object.assign({ whoName: nameOf(lv.who) }, lv) : null,
      members: ms, specialists: ms.filter((m) => m.type === 'specialist').map((m) => ({ id: m.id, role: m.role, name: m.name, capabilities: m.capabilities })),
      tasks: tasks.list(t.id, { limit: 80 }), counts: tasks.counts(t.id), executions: runs, activity: activity(runs), kpis: kpis(t),
      tools: tools.list(t), workflows: workflows.list(t.id).map((f) => { const mineRuns = runs.filter((r) => r.workflow === f.id); return { id: f.id, name: f.name, trigger: f.trigger.type, steps: f.steps.map((s) => s.type), runs: mineRuns.length, lastRun: mineRuns.length ? mineRuns[0].startedAt : 0, lastStatus: mineRuns.length ? mineRuns[0].status : '' }; }),
      memoryItems: memory.list(t.id, 20).reverse(), approvals: approvals.list(t.id, 'pending'),
      usage: ledger.usage({ teamId: t.id }, lim), usageAll: ledger.usage({}, lim), days: ledger.days(t.id, 7), ledger: ledger.summary(t.id, lim) };
  };
  const api = {
    list: () => teams.list().map((t) => ({ id: t.id, name: t.name, lead: t.lead.name })),
    get: (id) => view(id),
    /* the whole organisation at a glance, for the Office: real state only */
    org: () => teams.list().map((t) => { const lv = orch.live[t.id] || null, c = tasks.counts(t.id); return { id: t.id, name: t.name, lead: t.lead.agentId, status: lv || guild.busy[t.lead.agentId] ? 'working' : 'idle', live: lv ? { who: lv.who, whoName: nameOf(lv.who), step: lv.step, title: lv.title } : null, queued: c.queued,
      members: teams.members(t.id).map((m) => ({ id: m.id, name: m.name, role: m.role, type: m.type, archetype: m.persona.archetype, status: lv ? (lv.who === m.id ? 'working' : m.type === 'lead' ? 'waiting' : 'idle') : (m.type === 'lead' && guild.busy[t.lead.agentId] ? 'working' : 'idle') })) }; }),
    policy: (id, patch) => { need(id); teams.setPolicy(String(id), obj(patch)); emit(String(id), { type: 'policy' }); return view(id); },
    global: (patch) => { const g = teams.setGlobal(obj(patch)); emit('', { type: 'policy' }); return g; },
    /* tasks */
    taskAdd: (id, d) => { const t = need(id); d = obj(d); return tasks.create(t.id, { title: d.title, description: d.description, priority: d.priority, engine: d.engine, assignedTo: t.lead.agentId }); },
    taskEdit: (id, taskId, d) => { mine(need(id).id, taskId); return tasks.update(String(taskId), obj(d)); },
    taskCancel: (id, taskId) => { const t = mine(need(id).id, taskId); if (t.status !== 'queued' && t.status !== 'waiting') throw err('bad_move', 'Only a queued task can be cancelled.'); return tasks.transition(t.id, 'cancelled'); },
    taskRetry: (id, taskId) => { const t = mine(need(id).id, taskId); return tasks.transition(t.id, 'queued'); },
    taskDel: (id, taskId) => { mine(need(id).id, taskId); return tasks.remove(String(taskId)); },
    taskGet: (id, taskId) => { const t = mine(need(id).id, taskId); return Object.assign({}, t, { executions: executions.forTask(t.id), usage: ledger.usage({ ref: t.id }, teams.limits(t.teamId)) }); },
    run: (id, task, extra) => { task = obj(task); extra = obj(extra); return orch.runTask(String(id || ''), { id: task.id, title: task.title, notes: task.notes, engine: task.engine, priority: task.priority }, { tasks: extra.tasks, file: extra.file, addins: extra.addins }); },
    execGet: (id, exId) => { const x = executions.get(String(exId || '')); if (!x || x.teamId !== need(id).id) throw err('no_run', 'That record no longer exists.'); return Object.assign(x, { usageNow: ledger.usage({ taskId: x.id }, teams.limits(x.teamId)) }); },
    /* one-time move of what the page used to keep (1.9.5-1.9.7): tasks and KPI numbers */
    migrate: (id, old) => { const t = need(id), k = 'moved-' + t.id; if (teams.flag(k)) return { tasks: 0, done: true }; old = obj(old); const n = tasks.importOld(t.id, old.tasks);
      Object.keys(obj(old.kpi)).forEach((key) => { try { teams.kpiSet(t.id, key, old.kpi[key]); } catch (_) {} }); teams.setFlag(k); return { tasks: n, done: false }; },
    kpiSet: (id, key, value) => { const t = need(id); teams.kpiSet(t.id, String(key || ''), value); emit(t.id, { type: 'kpi' }); return view(id).kpis; },
    memAdd: (id, text) => { const t = need(id), r = memory.add(t.id, { kind: 'note', text }); emit(t.id, { type: 'memory' }); return r; },
    memDel: (id, mid) => { const r = memory.remove(String(id || ''), String(mid || '')); emit(String(id || ''), { type: 'memory' }); return r; },
    /* souls: text in, text out. The member must belong to the team named. */
    soulGet: (id, memberId) => { const m = teams.member(String(memberId || '')); if (!m || m.teamId !== need(id).id) throw err('bad_member', 'Unknown team member.'); return souls.get(m); },
    soulSet: (id, memberId, file) => { const m = teams.member(String(memberId || '')); if (!m || m.teamId !== need(id).id) throw err('bad_member', 'Unknown team member.'); file = obj(file); const r = souls.set(m, { name: file.name, text: file.text }); emit(m.teamId, { type: 'soul' }); return r; },
    soulDel: (id, memberId) => { const m = teams.member(String(memberId || '')); if (!m || m.teamId !== need(id).id) throw err('bad_member', 'Unknown team member.'); souls.remove(m); emit(m.teamId, { type: 'soul' }); return souls.get(m); },
    /* approvals: this is the owner's own decision, made in the Regis window */
    approve: (id, apId, ok) => { const a = approvals.list(need(id).id).find((x) => x.id === String(apId || '')); if (!a) throw err('no_approval', 'That request no longer exists.'); return approvals.decide(a.id, !!ok, 'owner'); },
    ledger: () => ledger.summary('', teams.limits('regis')),
    usage: () => ({ all: ledger.usage({}, teams.limits('regis')), regis: ledger.usage({ teamId: 'regis' }, teams.limits('regis')), teams: teams.list().map((t) => Object.assign({ id: t.id, name: t.name }, ledger.usage({ teamId: t.id }, teams.limits(t.id)))), days: ledger.days('', 7) })
  };
  /* Regis's own Claude calls (Plan my day, mail rules, the command bar): counted as team "regis"; the caller cannot choose another team */
  const sample = async (input, opts) => { const o = Object.assign({}, obj(opts), { meter: { teamId: 'regis', taskId: '' } }); if (o.json) return { value: await claude.json(input, o) }; const r = await claude.sample(input, o); return { text: r.text, truncated: r.truncated }; };
  return { teams, ledger, claude, guild, memory, tools, workflows, tasks, executions, souls, approvals, orch, api, sample, agentList, onChange: (f) => { if (typeof f === 'function') subs.push(f); } };
}
module.exports = { teamKit };
