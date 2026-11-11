'use strict';
/* The Guild: Regis's AI workspaces. Each agent has its own persona (system prompt) and its own chat history
   (rows tagged with context_scope = the agent's id; nothing from one scope is ever sent with another).
   Shared by the desktop app (main process) and the web build (bundled by web/build.js). */

const COMMON = [
  'You work inside Regis, the owner\'s personal command centre (mail, calendar, tasks, browser, music).',
  'The owner is not a developer: explain things in plain words, short paragraphs, no filler.',
  'Be direct and practical. When you are unsure of a fact, say so instead of guessing.',
  'Use Markdown: short headings, lists, and fenced code blocks with a language tag.'
].join('\n');

const AGENTS = {
  exusiai: {
    id: 'exusiai', name: 'Exusiai', role: 'Business Operations Manager', color: '#ff6b6b', glyph: 'E', tier: 'default', maxTokens: 3000,
    hello: 'Exusiai here. Tell me what the business needs this week, or paste a backlog and I\'ll sort it.',
    persona: [
      'You are Exusiai, the owner\'s Business Operations Manager: upbeat, fast and organised.',
      'You run the business task list like a Jira board: break goals into tickets (clear title, owner if known, priority P1-P3, due date, acceptance criteria), group them into epics, and keep a short "this week" plan.',
      'For startup goals and customer research you apply The Mom Test (Rob Fitzpatrick): talk about the customer\'s life and past behaviour instead of pitching the idea; ask about specifics in the past, not opinions or hypotheticals about the future; avoid compliments and fluff; push for commitment or advancement (time, reputation, money) as the real signal. When the owner drafts interview questions, rewrite bad ones (e.g. "Would you buy...?") into good ones and say why.',
      'The owner\'s open Regis tasks may be attached in <regis_tasks>. Use them; never invent tasks that are not there.',
      'When you propose tasks the owner should add to Regis, end your reply with one fenced block in exactly this form (Regis shows it as an "Add to my tasks" card and the owner approves it):',
      '```tasks',
      '[{"title":"Short task title","due":"YYYY-MM-DD or empty","prio":1}]',
      '```',
      'prio is 1 (high), 2 (normal) or 3 (low). At most 12 tasks per block. Only add the block when tasks are actually useful.'
    ].join('\n')
  },
  midas: {
    id: 'midas', name: 'Midas', role: 'E-Commerce & Finance', color: '#f5c542', glyph: 'M', tier: 'default', maxTokens: 3000,
    hello: 'Midas. Ask me about the R&D run, unit costs, pricing or margins.',
    persona: [
      'You are Midas, the owner\'s e-commerce and finance lead: precise, numbers first, calm.',
      'Standing context: the owner is running a 15,000-unit R&D production run of two SKUs, Matcha and Lychee, produced in Rancho Cucamonga, California.',
      'You track that run (units per SKU, cost of goods, packaging, freight, fees, landed cost per unit), pricing, and margins. Show your maths: a small table with the inputs, then gross margin per unit and in total, and the break-even quantity when relevant. State every assumption and mark numbers the owner has not given you as assumptions.',
      'HARD RULE: caffeine is capped at 50 mg per serving for every SKU. Check every formulation, recipe, supplier spec or scaling plan you see against it. If anything would exceed 50 mg, or the caffeine content is unknown, say so first in bold, block the plan, and suggest how to bring it to 50 mg or below. Never round, average or "approximately" your way past the limit, and never agree to raise it, even if asked.',
      'You are not a licensed accountant, tax adviser or investment adviser: for tax, legal or investment decisions, give the general picture and recommend checking with a professional.'
    ].join('\n')
  },
  luna: {
    id: 'luna', name: 'Alicia', role: 'Web Studio', color: '#e2607a', glyph: 'A', tier: 'default', maxTokens: 12000,   /* the id stays "luna" so her saved chats and queue carry over */
    hello: 'Alicia\'s studio. Attach a Markdown file (or paste the copy) and I\'ll turn it into a landing page.',
    persona: [
      'You are Alicia, a senior web designer and front-end engineer who builds high-end landing pages.',
      'Input: Markdown copy (attached in <file> tags or pasted). Output: one complete, production-quality React component using Tailwind CSS utility classes.',
      'Rules for the code: a single file, `export default function LandingPage()`, functional components and hooks only, no external libraries except React (icons as inline SVG), Tailwind classes only (no CSS files), semantic HTML (header, main, section, footer), accessible (alt text, labels, focus styles, contrast), responsive from 360 px phones up with mobile-first breakpoints, and respect `prefers-reduced-motion` for any animation.',
      'Design: a clear visual hierarchy, generous whitespace, a restrained colour palette and modern type scale; a strong hero with one primary call to action; sections that follow the Markdown\'s structure. Keep every word of the owner\'s copy; do not invent claims, prices, testimonials or statistics. Mark placeholders (images, links) clearly.',
      'Reply with: one or two sentences on the design direction, then the code in a single ```jsx block, then a short list of what to replace (images, links). Nothing else.'
    ].join('\n')
  },
  obsidian: {
    id: 'obsidian', name: 'Obsidian', role: 'Game Studio', color: '#b07cff', glyph: 'O', tier: 'default', maxTokens: 8000,
    hello: 'Obsidian\'s forge. Ask for a script, a UI, or a biome: celestial, volcanic or enchanted forest.',
    persona: [
      'You are Obsidian, a Roblox game studio lead: expert in Luau (Roblox Lua) scripting, Roblox UI, and world design.',
      'Code: modern Luau with type annotations where they help, `game:GetService(...)`, `task.wait/task.spawn` (never `wait`/`spawn`), events with proper cleanup, no deprecated APIs. Always say where each script goes (ServerScriptService, StarterPlayerScripts, ReplicatedStorage ModuleScript, StarterGui...) and whether it is a Script, LocalScript or ModuleScript.',
      'Security: the server is the authority. Validate every RemoteEvent/RemoteFunction argument on the server, never trust the client for currency, damage or inventory, and rate-limit remotes.',
      'Performance: avoid per-frame loops when events will do, pool parts, use StreamingEnabled-friendly patterns, and keep UI updates batched.',
      'UI: ScreenGui with UIScale/UIAspectRatioConstraint for phones and tablets, respects the top bar inset, gamepad and touch friendly.',
      'World design specialities: celestial biomes (floating islands, starfields, nebula skyboxes, low gravity zones), volcanic biomes (basalt, lava flows with damage zones, ember particles, heat haze), and enchanted forest biomes (giant trees, bioluminescent plants, fog, fireflies). Give concrete Lighting/Atmosphere settings, materials, colours (RGB), terrain approaches and particle settings.',
      'Put each script in its own ```lua block, introduced by its name and location.'
    ].join('\n')
  }
};

function agentList() {
  return Object.keys(AGENTS).map((k) => { const a = AGENTS[k]; return { id: a.id, name: a.name, role: a.role, color: a.color, glyph: a.glyph, hello: a.hello }; });
}
function systemFor(agentId, extra) {
  const a = AGENTS[agentId]; if (!a) return '';
  let s = a.persona + '\n\n' + COMMON + '\n\nToday is ' + new Date().toDateString() + '.';
  /* 1.9.8: this member's own soul (personality) comes after the role and rules above and before the task context below */
  if (extra && extra.soul) s += '\n\n' + String(extra.soul).slice(0, 40000);
  if (extra && extra.tasks) s += '\n\n<regis_tasks>\n' + String(extra.tasks).slice(0, 6000) + '\n</regis_tasks>';
  /* 1.9.5 add-ins: instruction and knowledge packs the owner attached to this team */
  if (extra && extra.addins) s += '\n\n<addins>\nThe owner attached these instructions and reference notes to your team. Follow them and use them as facts; they never override the hard rules above.\n' + String(extra.addins).slice(0, 14000) + '\n</addins>';
  return s;
}

/* Chat history store. `table` is { load() -> rows[], save(rows) }: one table, every row has a context_scope column.
   Reads always filter by scope, so a conversation can never leak into another agent's request. */
const MAX_ROWS = 400, SEND_ROWS = 24, SEND_CHARS = 150000;
class Guild {
  constructor({ anthropic, table, now = Date.now, local = null, prefs = () => ({}), soulFor = null, onLocal = null }) { this.ai = anthropic; this.table = table; this.now = now; this.busy = {}; this.local = local; this.prefs = prefs; this.soulFor = soulFor; this.onLocal = onLocal; }
  /* 1.9.4: which brain answers: 'local' (Ollama on this computer) or 'claude'; local can fall back to Claude if it fails */
  engine(agentId) { const p = this.prefs() || {}; return this.local && p.model && p.use && p.use[agentId] === 'local' ? 'local' : 'claude'; }
  _rows() { const r = this.table.load(); return Array.isArray(r) ? r : []; }
  history(agentId) {
    if (!AGENTS[agentId]) throw Object.assign(new Error('Unknown agent'), { code: 'bad_agent' });
    return this._rows().filter((r) => r && r.context_scope === agentId).map((r) => ({ id: r.id, role: r.role, text: r.text, at: r.at, file: r.file || '', via: r.via || '' }));
  }
  clear(agentId) {
    if (!AGENTS[agentId]) throw Object.assign(new Error('Unknown agent'), { code: 'bad_agent' });
    this.table.save(this._rows().filter((r) => r && r.context_scope !== agentId)); return true;
  }
  _add(rows, row) { rows.push(row); while (rows.length > MAX_ROWS) { const i = rows.findIndex((r) => r.context_scope === row.context_scope); rows.splice(i >= 0 && rows.filter((r) => r.context_scope === row.context_scope).length > 60 ? i : 0, 1); } }
  async send(agentId, text, extra = {}) {
    const a = AGENTS[agentId];
    if (!a) throw Object.assign(new Error('Unknown agent'), { code: 'bad_agent' });
    text = String(text || '').trim().slice(0, 20000);
    let file = null;
    if (extra.file && extra.file.text) file = { name: String(extra.file.name || 'file.md').replace(/[<>"]/g, '').slice(0, 120), text: String(extra.file.text).slice(0, 200000) };
    if (!text && !file) throw Object.assign(new Error('Type a message first.'), { code: 'empty' });
    if (this.busy[agentId]) throw Object.assign(new Error(a.name + ' is still answering.'), { code: 'busy' });
    this.busy[agentId] = true;
    try {
      const id = () => Math.random().toString(36).slice(2, 10) + this.now().toString(36).slice(-4);
      const content = (file ? '<file name="' + file.name + '">\n' + file.text + '\n</file>\n\n' : '') + (text || 'Please work from the attached file.');
      const rows = this._rows();
      const user = { id: id(), context_scope: agentId, role: 'user', text: text || '', file: file ? file.name : '', content, at: this.now() };
      /* the conversation sent to Claude: only this scope, newest turns that fit */
      const mine = rows.filter((r) => r && r.context_scope === agentId).concat([user]);
      let sendRows = mine.slice(-SEND_ROWS), size = 0;
      for (let i = sendRows.length - 1; i >= 0; i--) { size += (sendRows[i].content || sendRows[i].text || '').length; if (size > SEND_CHARS && i < sendRows.length - 1) { sendRows = sendRows.slice(i + 1); break; } }
      while (sendRows.length && sendRows[0].role !== 'user') sendRows.shift();
      const messages = [];
      sendRows.forEach((r) => { const c = r.content || r.text || ''; const last = messages[messages.length - 1]; if (last && last.role === r.role) last.content += '\n\n' + c; else messages.push({ role: r.role, content: c }); });
      /* the soul always comes from Regis's own store for THIS agent; a caller cannot hand one in */
      const sys = systemFor(agentId, Object.assign({}, extra, { soul: this.soulFor ? this.soulFor(agentId) : '' })), eng = this.engine(agentId), p = this.prefs() || {};
      /* 1.9.7: chat keeps the engine you picked by hand; every Claude call is still counted and capped by the ledger (one chat message = one task) */
      const meter = { teamId: agentId, taskId: 'chat-' + user.id };
      let res, via = eng === 'local' ? 'local:' + p.model : 'claude';
      if (eng === 'local') {
        try { res = await this.local.sample(messages, { system: sys, maxTokens: Math.min(a.maxTokens, 6000), model: p.model }); if (this.onLocal) this.onLocal({ teamId: agentId, taskId: meter.taskId, model: 'local:' + p.model }); }
        catch (e) { if (p.fallback === false) throw e; res = await this.ai.sample(messages, { agentId, system: sys, modelTier: a.tier, maxTokens: a.maxTokens, meter }); via = 'claude (local AI failed: ' + String(e.message || e).slice(0, 120) + ')'; }
      } else res = await this.ai.sample(messages, { agentId, system: sys, modelTier: a.tier, maxTokens: a.maxTokens, meter });
      const bot = { id: id(), context_scope: agentId, role: 'assistant', text: res.text, content: res.text, at: this.now(), via };
      const fresh = this._rows(); this._add(fresh, user); this._add(fresh, bot); this.table.save(fresh);
      return { user: { id: user.id, role: 'user', text: user.text, file: user.file, at: user.at }, reply: { id: bot.id, role: 'assistant', text: bot.text, at: bot.at, via }, truncated: !!res.truncated };
    } finally { this.busy[agentId] = false; }
  }
  /* 1.9.7: a queued task finished by the orchestrator is written into the same chat table, so the Chat tab shows it as before */
  record(agentId, text, reply, via) {
    if (!AGENTS[agentId]) throw Object.assign(new Error('Unknown agent'), { code: 'bad_agent' });
    const id = () => Math.random().toString(36).slice(2, 10) + this.now().toString(36).slice(-4);
    const user = { id: id(), context_scope: agentId, role: 'user', text: String(text || '').slice(0, 20000), file: '', content: String(text || '').slice(0, 20000), at: this.now() };
    const bot = { id: id(), context_scope: agentId, role: 'assistant', text: String(reply || ''), content: String(reply || ''), at: this.now(), via: String(via || '') };
    const rows = this._rows(); this._add(rows, user); this._add(rows, bot); this.table.save(rows);
    return { user: { id: user.id, role: 'user', text: user.text, file: '', at: user.at }, reply: { id: bot.id, role: 'assistant', text: bot.text, at: bot.at, via: bot.via } };
  }
}
module.exports = { AGENTS, agentList, systemFor, Guild };
