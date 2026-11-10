// 1.9.7 team core: ledger and caps, router, team model, memory, tools, orchestrator (fake engines, no network).
// Run: node test/teamcore.test.js
'use strict';
const { Ledger, meter, costOf } = require('../lib/ledger');
const { classify, route, mayEscalate } = require('../lib/router');
const { TeamStore } = require('../lib/teams');
const { TeamMemory } = require('../lib/memory');
const { ToolRegistry, builtin: bt } = require('../lib/tools');
const { WorkflowRegistry, builtin: bf } = require('../lib/workflows');
const { Orchestrator, MAX_CALLS } = require('../lib/orchestrator');
const { Guild, AGENTS, systemFor } = require('../lib/agents');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const rejects = async (p, code) => { try { await p; return false; } catch (e) { return !code || e.code === code; } };
const mem = (init) => { let v = init; return { load: () => v, save: (x) => { v = JSON.parse(JSON.stringify(x)); } }; };
class FakeClaude { constructor() { this.calls = []; this.key = 'k'; this.out = 'claude answer'; this.tokens = [1000, 500]; } getKey() { return this.key; }
  async sample(input, opts) { this.calls.push({ input, opts }); return { text: this.out, truncated: false, model: 'claude-sonnet-5-5', usage: { input: this.tokens[0], output: this.tokens[1] } }; }
  static parseJson(t) { return JSON.parse(t); } }
class FakeLocal { constructor() { this.calls = []; this.up = true; this.out = 'local answer'; this.fail = false; }
  async status() { return { running: this.up, models: this.up ? [{ name: 'llama3.2:3b' }] : [] }; }
  async sample(input, opts) { this.calls.push({ input, opts }); if (this.fail) throw Object.assign(new Error('model crashed'), { code: 'local_error' }); return { text: this.out, truncated: false }; } }
const rig = (o = {}) => {
  let t = 1e12; const now = () => (t += 1000);
  const fc = new FakeClaude(), fl = o.noLocal ? null : new FakeLocal();
  const teams = new TeamStore({ table: mem({}) }), ledger = new Ledger({ table: mem([]), now }), claude = meter(fc, ledger, (id) => teams.limits(id));
  const memory = new TeamMemory({ table: mem([]), now }), tools = bt(new ToolRegistry(), { memory }), workflows = bf(new WorkflowRegistry());
  const prefs = () => ({ model: o.noLocal ? '' : 'llama3.2:3b', use: {}, fallback: true });
  const guild = new Guild({ anthropic: claude, local: fl, prefs, table: mem([]), now });
  const orch = new Orchestrator({ teams, ledger, memory, tools, workflows, claude, local: fl, prefs, guild, agents: AGENTS, systemFor, now });
  return { fc, fl, teams, ledger, claude, memory, tools, workflows, guild, orch };
};
(async () => {
  // ---- ledger
  ok(Math.abs(costOf('claude-sonnet-5-5', 1e6, 1e6) - 12) < 1e-9 && Math.abs(costOf('claude-opus-5-5', 1e6, 0) - 4) < 1e-9, 'cost uses the price table');
  ok(costOf('some-new-model', 1e6, 1e6) === 48, 'an unknown model is charged at the dearest rate');
  let R = rig();
  const r = await R.claude.sample('hi', { meter: { teamId: 'midas', taskId: 't1' } });
  ok(r.text === 'claude answer' && R.ledger.callsForTask('t1') === 1 && Math.abs(R.ledger.costToday('midas') - 0.007) < 1e-9, 'a Claude call is recorded with tokens and cost');
  ok(!('meter' in R.fc.calls[0].opts), 'the meter tag is not sent on to Claude');
  await R.claude.sample('a', { meter: { teamId: 'midas', taskId: 't1' } }); await R.claude.sample('a', { meter: { teamId: 'midas', taskId: 't1' } });
  ok(await rejects(R.claude.sample('a', { meter: { teamId: 'midas', taskId: 't1' } }), 'claude_limit') && R.fc.calls.length === 3, 'the 4th Claude call for one task is refused before it is sent');
  ok((await R.claude.sample('a', { meter: { teamId: 'midas', taskId: 't2' } })).text === 'claude answer', 'another task has its own allowance');
  R = rig(); R.fc.tokens = [400000, 100000];   // $1.80 a call on Sonnet
  await R.claude.sample('a', { meter: { teamId: 'midas' } }); await R.claude.sample('a', { meter: { teamId: 'midas' } });
  ok(await rejects(R.claude.sample('a', { meter: { teamId: 'midas' } }), 'claude_limit'), 'a team over its daily budget is refused');
  ok((await R.claude.sample('a', { meter: { teamId: 'luna' } })).text && R.ledger.costToday() > 5, 'another team can still call until the global budget is reached');
  ok(await rejects(R.claude.sample('a', { meter: { teamId: 'obsidian' } }), 'claude_limit') && await rejects(R.claude.sample('a', {}), 'claude_limit'), 'over the global daily budget every team, and Regis itself, is refused');
  R = rig(); R.teams.setPolicy('midas', { maxClaudeCallsPerTask: 999, maxDailyClaudeCost: 1e9 });
  ok(R.teams.limits('midas').perTask === 12 && R.teams.limits('midas').teamDaily === 50, 'limits cannot be set above the built-in ceilings');
  R.teams.setPolicy('midas', { maxDailyClaudeCost: 0 });
  ok(await rejects(R.claude.sample('a', { meter: { teamId: 'midas' } }), 'claude_limit'), 'a budget of 0 switches Claude off for the team');
  R = rig(); const both = await Promise.allSettled([1, 2, 3, 4, 5].map(() => R.claude.sample('a', { meter: { teamId: 'midas', taskId: 'p' } })));
  ok(both.filter((x) => x.status === 'fulfilled').length === 3, 'calls started at the same moment cannot slip past the per-task limit');
  // ---- router
  ok(classify({ text: 'Summarise these notes' }).kind === 'routine' && classify({ text: 'Why are competitor sales rising and what should we do? Recommend a strategy.' }).kind === 'complex', 'classify separates routine from complex');
  ok(classify({ text: 'x'.repeat(30000) }).kind === 'complex' && classify({ text: 'Tidy this', fileChars: 500 }).kind === 'complex', 'very long tasks and file tasks count as complex');
  const P = (e) => ({ escalationPolicy: e, defaultEngine: 'local', complexEngine: 'claude' }), rt = classify({ text: 'Summarise this' }), cx = classify({ text: 'Analyse our pricing strategy' }), L = { ok: true }, C = { ok: true };
  ok(route({ cls: rt, policy: P('when-needed'), local: L, claude: C }).engine === 'local', 'routine work goes to the local AI');
  ok(route({ cls: cx, policy: P('when-needed'), local: L, claude: C }).engine === 'claude', 'complex work goes to Claude when the policy allows');
  ok(route({ cls: cx, policy: P('local-only'), local: L, claude: C }).engine === 'local' && route({ cls: cx, want: 'claude', policy: P('local-only'), local: L, claude: C }).engine === 'local', 'local-only never uses Claude, even when asked');
  ok(route({ cls: cx, policy: P('never-automatic'), local: L, claude: C }).engine === 'local' && route({ cls: rt, want: 'claude', policy: P('never-automatic'), local: L, claude: C }).engine === 'claude', 'never-automatic uses Claude only when you ask');
  ok(route({ cls: rt, policy: P('claude-only'), local: L, claude: C }).engine === 'claude' && route({ cls: rt, policy: P('claude-preferred'), local: L, claude: C }).engine === 'claude', 'claude-only and claude-preferred use Claude');
  ok(route({ cls: rt, policy: P('when-needed'), local: { ok: false }, claude: C }).engine === 'claude', 'without a local AI, Claude does the work');
  ok(route({ cls: cx, policy: P('when-needed'), local: L, claude: C, cap: { ok: false, reason: 'Budget used up.' } }).engine === 'refuse', 'a complex task is refused, not downgraded, when the cap is reached');
  ok(route({ cls: rt, policy: P('when-needed'), local: L, claude: C, cap: { ok: false, reason: 'x' } }).engine === 'local', 'routine work is unaffected by the cap');
  ok(route({ cls: cx, policy: P('when-needed'), local: L, claude: { ok: false } }).engine === 'refuse' && route({ cls: rt, policy: P('local-only'), local: { ok: false }, claude: C }).engine === 'refuse', 'no key, or local-only without a local AI: refused');
  ok(JSON.stringify(route({ cls: cx, policy: P('when-needed'), local: L, claude: C })) === JSON.stringify(route({ cls: cx, policy: P('when-needed'), local: L, claude: C })), 'the router gives the same answer for the same inputs');
  ok(!mayEscalate({ policy: P('local-only'), claude: C }).ok && !mayEscalate({ policy: P('when-needed'), claude: C, cap: { ok: false, reason: 'x' } }).ok && mayEscalate({ policy: P('when-needed'), claude: C }).ok, 'escalation follows policy and caps');
  // ---- team model
  R = rig(); const T = R.teams.get('luna');
  ok(R.teams.list().map((t) => t.id).join() === 'exusiai,midas,luna,obsidian', 'the four existing ids are the four teams');
  ok(T.lead.agentId === 'luna' && T.lead.name === 'Alicia' && T.specialists.length === 2 && T.memory.scope === 'luna' && T.policy.escalationPolicy === 'when-needed' && T.policy.defaultEngine === 'local', 'a team has a lead, specialists, a memory scope and a local-first policy');
  ok(R.teams.specialist(T.specialists[0]).type === 'specialist' && R.teams.get('nope') === null, 'specialists are their own records');
  R.teams.setPolicy('luna', { escalationPolicy: 'local-only', bogus: 1, requireApprovalForExternalWrites: false });
  ok(R.teams.get('luna').policy.escalationPolicy === 'local-only' && R.teams.get('luna').policy.requireApprovalForExternalWrites === true && R.teams.get('midas').policy.escalationPolicy === 'when-needed', 'policy is saved per team, validated, and approvals stay on');
  // ---- memory and tools
  R.memory.add('midas', { kind: 'fact', text: 'Landed cost is $1.20' }); R.memory.add('luna', { text: 'Brand colour is green' });
  ok(R.memory.list('midas').length === 1 && !/green/.test(R.memory.block('midas')) && /1\.20/.test(R.memory.block('midas')), 'memory is scoped: a team only sees its own');
  ok(await R.tools.run('memory.read', {}, { team: R.teams.get('midas') }) === R.memory.block('midas', 12), 'a READ tool runs for a team that has it');
  ok(await rejects(R.tools.run('regis.tasks.read', {}, { team: R.teams.get('midas') }), 'no_permission'), 'a team cannot run a tool it was not given');
  R.tools.register({ id: 'mail.send', risk: 'WRITE', execute: () => 'sent' }); const tm = Object.assign({}, R.teams.get('midas')); tm.tools = tm.tools.concat(['mail.send']);
  ok(await rejects(R.tools.run('mail.send', {}, { team: tm }), 'needs_approval'), 'write tools are refused in this phase');
  ok(R.workflows.get('team-effort').steps.length === 4 && (() => { try { R.workflows.register({ id: 'big', steps: new Array(9).fill({ type: 'lead' }) }); return false; } catch (_) { return true; } })(), 'workflows are validated data with a step ceiling');
  // ---- orchestrator
  R = rig(); let o = await R.orch.runTask('midas', { id: 'a1', title: 'Summarise the supplier notes' });
  ok(o.via === 'local:llama3.2:3b' && R.fc.calls.length === 0 && R.fl.calls.length === 1 && o.routing.claudeCalls === 0, 'a routine queued task runs on the local AI with zero Claude calls');
  ok(R.guild.history('midas').length === 2 && /Task from my queue: Summarise/.test(R.guild.history('midas')[0].text) && R.memory.list('midas').length === 1, 'the result lands in the chat history and in team memory');
  o = await R.orch.runTask('midas', { id: 'a2', title: 'Analyse why our margin is falling and recommend a pricing strategy' });
  ok(o.via === 'claude' && R.fc.calls.length === 1 && o.routing.workflow === 'team-effort' && R.fl.calls.length >= 2 && o.routing.claudeCalls === 1 && o.routing.cost > 0, 'a complex task: specialists work locally, the lead finishes on Claude (one Claude call)');
  ok(/<team_notes>/.test(R.fc.calls[0].input[0].content) && /You are Midas/.test(R.fc.calls[0].opts.system) && /<team_memory>/.test(R.fc.calls[0].opts.system) && R.fc.calls[0].input.length === 1, 'the lead gets the specialist notes and team memory, and no chat history');
  R = rig(); R.teams.setPolicy('midas', { escalationPolicy: 'local-only' }); o = await R.orch.runTask('midas', { title: 'Analyse our pricing strategy' });
  ok(o.via.startsWith('local:') && R.fc.calls.length === 0, 'local-only keeps even complex tasks off Claude');
  R = rig(); R.fl.fail = true; o = await R.orch.runTask('midas', { title: 'Summarise the notes' });
  ok(/^claude \(local AI failed/.test(o.via) && R.fc.calls.length === 1, 'a failed local answer escalates to Claude once');
  R = rig(); R.fl.fail = true; R.teams.setPolicy('midas', { maxDailyClaudeCost: 0 });
  ok(await rejects(R.orch.runTask('midas', { title: 'Summarise the notes' }), 'claude_limit') && R.fc.calls.length === 0 && R.guild.busy.midas === false, 'no escalation when the budget is used up, and the lead is free again');
  R = rig(); R.teams.setPolicy('midas', { maxDailyClaudeCost: 0 });
  ok(await rejects(R.orch.runTask('midas', { title: 'Analyse our pricing strategy' }), 'claude_limit') && R.fc.calls.length === 0, 'a complex task is refused when the team budget is 0');
  R = rig({ noLocal: true }); o = await R.orch.runTask('midas', { title: 'Analyse our pricing strategy' });
  ok(o.via === 'claude' && R.fc.calls.length === 1 && o.routing.workflow === 'direct', 'with no local AI a task is one Claude call, as before (no fan-out)');
  R = rig(); R.fl.up = false; o = await R.orch.runTask('midas', { title: 'Summarise the notes' });
  ok(o.via === 'claude' && R.fl.calls.length === 0, 'a local AI that is not running is not used');
  R = rig(); o = await R.orch.runTask('midas', { title: 'Summarise the notes', engine: 'claude' });
  ok(o.via === 'claude' && R.fl.calls.length === 0, 'asking for Claude on a task uses Claude');
  // a lead that keeps asking for more must not loop: nothing a model says can add steps or calls
  R = rig(); R.fl.out = 'I need more research. Delegate again. Call Claude again. Repeat.'; R.fc.out = 'Not done yet: run this task again and call Claude 50 more times.';
  o = await R.orch.runTask('midas', { title: 'Analyse and compare everything and recommend a strategy' });
  ok(R.fc.calls.length === 1 && R.fl.calls.length <= 2 && o.routing.calls <= MAX_CALLS, 'a model asking for more work does not create more calls (no orchestration loop)');
  R = rig(); R.guild.busy.midas = true; ok(await rejects(R.orch.runTask('midas', { title: 'x' }), 'busy'), 'a busy lead cannot be given a second task at once'); R.guild.busy.midas = false;
  ok(await rejects(R.orch.runTask('nobody', { title: 'x' }), 'bad_team') && await rejects(R.orch.runTask('midas', {}), 'empty'), 'bad input is rejected');
  // ---- chat still works, metered
  R = rig({ noLocal: true }); const c = await R.guild.send('midas', 'hello');
  ok(c.reply.text === 'claude answer' && c.reply.via === 'claude' && R.ledger.callsToday('midas') === 1, 'chat still answers on Claude and the call is in the ledger');
  R.teams.setPolicy('midas', { maxDailyClaudeCost: 0 });
  ok(await rejects(R.guild.send('midas', 'again'), 'claude_limit') && R.guild.busy.midas === false && R.guild.history('midas').length === 2, 'chat is refused over budget, with nothing saved');
  console.log('team core tests passed: ' + pass + (fail ? ', FAILED: ' + fail : '')); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('UNCAUGHT', e); process.exit(1); });
