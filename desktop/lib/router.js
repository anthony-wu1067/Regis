'use strict';
/* 1.9.7 Model router. Decides which brain does a piece of work: 'local' (Ollama on this computer), 'claude', or 'refuse'.
   It is plain code with fixed rules: no model is asked, so no model can talk its way into spending money. The same inputs
   always give the same answer. The Claude caps are checked again at the moment of the call (ledger.meter). */
const LOCAL_CHARS = 20000;   /* about what an 8k-token local context can hold along with its answer */
const COMPLEX = /\b(strateg\w*|analy[sz]\w*|compar\w*|why|recommend\w*|forecast\w*|evaluat\w*|trade-?offs?|decide|decision|research\w*|investigat\w*|diagnos\w*|architect\w*|design\w*|plan|roadmap|landing page|component|script|luau|react|refactor\w*|debug\w*|negotiat\w*|synthes\w*|business case|go-to-market)\b/i;
const ROUTINE = /\b(summar\w*|classif\w*|categor\w*|extract\w*|format\w*|reformat\w*|list|sort|tidy|rewrite|rephrase|shorten|proofread|translate|convert|calculate|work out|add up|total|tag|label|rename|draft|remind\w*|title|bullet\w*)\b/i;

/* what kind of work is this? -> { kind: 'routine'|'complex', level 1..5, caps: [...], why } */
function classify(task) {
  task = task || {}; const text = String(task.text || ''), chars = text.length + (+task.fileChars || 0);
  const caps = []; const has = (re, c) => { if (re.test(text)) caps.push(c); };
  has(/\b(research\w*|investigat\w*|find out|look into|competitor\w*|market)\b/i, 'research'); has(/\b(analy[sz]\w*|compar\w*|calculate|margin\w*|cost\w*|pric\w*|forecast\w*)\b/i, 'analyze');
  has(/\b(plan|roadmap|break ?down|prioriti[sz]\w*|steps)\b/i, 'plan'); has(/\b(review|check|audit|critique)\b/i, 'review'); has(/\b(summar\w*|draft|outline|rewrite)\b/i, 'summarize');
  if (chars > LOCAL_CHARS) return { kind: 'complex', level: 5, caps, why: 'too long for the local AI to read in one go' };
  if (task.fileChars) return { kind: 'complex', level: 5, caps, why: 'it works from an attached file' };
  const cx = COMPLEX.test(text), rt = ROUTINE.test(text);
  if (cx && !rt) return { kind: 'complex', level: caps.length > 1 ? 4 : 3, caps, why: 'it asks for analysis, planning or building' };
  if (cx && rt) return chars > 600 ? { kind: 'complex', level: 3, caps, why: 'a longer task that mixes routine and analytical work' } : { kind: 'routine', level: 2, caps, why: 'mostly routine work' };
  if (chars > 1500) return { kind: 'complex', level: 3, caps, why: 'a long, open request' };
  return { kind: 'routine', level: 1, caps, why: rt ? 'routine work (summarising, sorting, drafting)' : 'a short, simple request' };
}

/* inputs: cls (from classify), want ('auto'|'local'|'claude': what the owner asked for on this task), policy (the team's),
   local { ok }, claude { ok, reason }, cap { ok, reason } (ledger.check). -> { engine, reason } */
function route(o) {
  o = o || {}; const cls = o.cls || { kind: 'routine' }, pol = o.policy || {}, esc = pol.escalationPolicy || 'when-needed';
  const local = !!(o.local && o.local.ok), keyOk = !!(o.claude && o.claude.ok), capOk = !o.cap || o.cap.ok !== false;
  const claudeWhy = !keyOk ? ((o.claude && o.claude.reason) || 'there is no Anthropic API key') : !capOk ? o.cap.reason : '';
  const claude = (why) => (claudeWhy ? { engine: 'refuse', reason: 'This needs Claude (' + why + '), but ' + claudeWhy.replace(/\.$/, '') + '. Regis did not call Claude.' } : { engine: 'claude', reason: why });
  const useLocal = (why) => ({ engine: 'local', reason: why });
  if (esc === 'local-only') return local ? useLocal('this team is set to local only') : { engine: 'refuse', reason: 'This team is set to local only, and the local AI isn’t available.' };
  if (o.want === 'claude') return claude('you asked for Claude');
  if (o.want === 'local') return local ? useLocal('you asked for the local AI') : { engine: 'refuse', reason: 'You asked for the local AI, but it isn’t available.' };
  if (esc === 'claude-only') return claude('this team is set to Claude only');
  if (esc === 'claude-preferred') return claudeWhy && local ? useLocal('Claude is preferred, but ' + claudeWhy.replace(/\.$/, '')) : claude('this team prefers Claude');
  if (esc === 'never-automatic') return local ? useLocal('this team only uses Claude when you ask') : { engine: 'refuse', reason: 'This team only uses Claude when you ask for it, and the local AI isn’t available.' };
  /* when-needed */
  if (!local) return claude('the local AI isn’t available');
  if (cls.kind === 'complex' && pol.complexEngine !== 'local') return claude(cls.why || 'a complex task');
  if (pol.defaultEngine === 'claude') return claude('this team’s default is Claude');
  return useLocal(cls.why || 'routine work');
}
/* after a local attempt that failed a mechanical check: may Claude take over, once? */
function mayEscalate(o) {
  const esc = (o.policy && o.policy.escalationPolicy) || 'when-needed';
  if (o.want === 'local' || esc === 'local-only' || esc === 'never-automatic') return { ok: false, reason: 'this team’s settings keep the task on the local AI' };
  if (!(o.claude && o.claude.ok)) return { ok: false, reason: 'there is no Anthropic API key' };
  if (o.cap && o.cap.ok === false) return { ok: false, reason: o.cap.reason };
  return { ok: true };
}
module.exports = { classify, route, mayEscalate, LOCAL_CHARS };
