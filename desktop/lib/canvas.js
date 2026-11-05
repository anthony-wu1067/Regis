'use strict';
/* Canvas LMS client. Uses a personal access token against the school's own Canvas host only.
   list_assignments -> { items:[{id,title,course,dueAt,points,url,type,submitted,complete,excused,missing}] } */
function normHost(u) {
  let s = String(u || '').trim(); if (!s) { const e = new Error('Enter your school’s Canvas address, like https://yourschool.instructure.com'); e.code = 'bad_url'; throw e; }
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let x; try { x = new URL(s); } catch (_) { const e = new Error('That doesn’t look like a web address.'); e.code = 'bad_url'; throw e; }
  if (x.protocol !== 'https:') { const e = new Error('Canvas addresses must start with https://'); e.code = 'bad_url'; throw e; }
  return x.origin;
}
class Canvas {
  constructor({ creds, fetchFn }) { this.creds = creds; this.f = fetchFn || fetch; }
  async _get(path, qs) {
    const { host, token } = this.creds();
    if (!host || !token) { const e = new Error('Canvas isn’t connected yet.'); e.code = 'not_connected'; throw e; }
    const u = new URL(path, host); Object.entries(qs || {}).forEach(([k, v]) => u.searchParams.append(k, v));
    const r = await this.f(u.href, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    if (r.status === 401) { const e = new Error('Canvas rejected the token. Create a new one in Canvas → Account → Settings.'); e.code = 'auth'; throw e; }
    if (!r.ok) { const e = new Error('Canvas returned an error (' + r.status + ').'); e.code = 'http_' + r.status; throw e; }
    return r.json();
  }
  async whoami() { const me = await this._get('/api/v1/users/self'); return { name: me.short_name || me.name || '' }; }
  async callTool(tool, input) {
    if (tool === 'whoami') return this.whoami();
    if (tool !== 'list_assignments') { const e = new Error('Unknown Canvas tool ' + tool); e.code = 'unknown_tool'; throw e; }
    const days = Math.min(Math.max(+input.days || 21, 1), 120), past = Math.min(Math.max(+input.pastDays || 0, 0), 60), now = Date.now();
    const rows = await this._get('/api/v1/planner/items', { start_date: new Date(now - past * 864e5).toISOString(), end_date: new Date(now + days * 864e5).toISOString(), per_page: '100' });
    const items = (Array.isArray(rows) ? rows : []).filter((r) => r && r.plannable).map((r) => {
      const p = r.plannable || {}, sub = r.submissions && typeof r.submissions === 'object' ? r.submissions : {}, o = r.planner_override || {};
      const link = r.html_url ? (/^https?:/.test(r.html_url) ? r.html_url : new URL(r.html_url, this.creds().host).href) : '';
      return {
        id: String(r.plannable_id || p.id), title: p.title || p.name || 'Untitled', course: r.context_name || '', dueAt: p.due_at || p.todo_date || r.plannable_date || null,
        points: p.points_possible == null ? null : p.points_possible, url: link, type: r.plannable_type || 'assignment',
        submitted: !!(sub.submitted || sub.graded), complete: !!(o.marked_complete || sub.submitted || sub.graded), excused: !!sub.excused, missing: !!sub.missing
      };
    });
    return { items };
  }
}
module.exports = { Canvas, normHost };
