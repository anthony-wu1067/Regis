'use strict';
/* 1.9.7 Workflows: a repeatable process written as data (a trigger and a list of steps), not as a prompt.
   This phase stores and validates them and lets the orchestrator run one by hand. Schedules and event triggers can be
   described but nothing fires them yet. Step types: specialist, lead, tool, memory, notify. */
const err = (code, message) => Object.assign(new Error(message), { code });
const STEP = ['specialist', 'lead', 'tool', 'memory', 'notify'], TRIGGER = ['manual', 'schedule', 'event'], MAX_STEPS = 6;

function cleanStep(s) {
  if (!s || !STEP.includes(s.type)) throw err('bad_step', 'Unknown workflow step.');
  const o = { type: s.type };
  if (s.type === 'specialist') o.specialist = String(s.specialist || '');
  if (s.type === 'tool') o.tool = String(s.tool || '');
  if (s.note) o.note = String(s.note).slice(0, 300);
  return o;
}
class WorkflowRegistry {
  constructor() { this.flows = {}; }
  register(d) {
    if (!d || !/^[a-z][a-z0-9-]{1,59}$/.test(d.id || '')) throw err('bad_workflow', 'A workflow needs an id.');
    const steps = (Array.isArray(d.steps) ? d.steps : []).map(cleanStep);
    if (!steps.length || steps.length > MAX_STEPS) throw err('bad_workflow', 'A workflow needs 1 to ' + MAX_STEPS + ' steps.');
    const tr = d.trigger && TRIGGER.includes(d.trigger.type) ? { type: d.trigger.type, schedule: String(d.trigger.schedule || '') } : { type: 'manual', schedule: '' };
    this.flows[d.id] = { id: d.id, teamId: String(d.teamId || ''), name: String(d.name || d.id).slice(0, 80), trigger: tr, steps };
    return this.flows[d.id];
  }
  get(id) { return this.flows[id] || null; }
  list(teamId) { return Object.keys(this.flows).map((k) => this.flows[k]).filter((f) => !teamId || !f.teamId || f.teamId === teamId); }
}
/* the two shapes the orchestrator itself uses for queued tasks; teamId '' = any team */
function builtin(reg) {
  reg.register({ id: 'direct', name: 'Lead answers directly', steps: [{ type: 'lead' }] });
  reg.register({ id: 'team-effort', name: 'Specialists prepare, lead finishes', steps: [{ type: 'specialist' }, { type: 'specialist' }, { type: 'lead' }, { type: 'memory' }] });
  return reg;
}
module.exports = { WorkflowRegistry, builtin, STEP, MAX_STEPS };
