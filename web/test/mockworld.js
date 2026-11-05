'use strict';
/* A believable Google account for screenshots/tests: a few events across the month, unread mail. */
function build() {
  const now = new Date(), day = (o, h, m) => { const d = new Date(now); d.setDate(d.getDate() + o); d.setHours(h, m || 0, 0, 0); return d; };
  const ev = (id, t, o, h, m, mins, extra) => Object.assign({ id, summary: t, start: { dateTime: day(o, h, m).toISOString() }, end: { dateTime: new Date(day(o, h, m).getTime() + mins * 60000).toISOString() }, status: 'confirmed', organizer: { self: true } }, extra || {});
  const events = [ev('e1', 'Robotics build night', 0, now.getHours() + 1, 0, 90, { location: 'Hall 204' }), ev('e2', 'Dentist', 0, 17, 30, 45), ev('e3', 'Study group', 1, 10, 0, 60), ev('e4', 'Team sync', 2, 14, 0, 30), ev('e5', 'Lab report due', 3, 23, 0, 30), ev('e6', 'Flight to NYC', 5, 8, 15, 120), ev('e7', 'Dinner with Sam', 6, 19, 0, 120),
    { id: 'e8', summary: 'Spring break', start: { date: day(8, 0).toISOString().slice(0, 10) }, end: { date: day(10, 0).toISOString().slice(0, 10) }, status: 'confirmed', organizer: { self: true } }];
  const thread = (id, from, subj, snip) => ({ id, messages: [{ id: 'm' + id, threadId: id, internalDate: String(Date.now() - 3600e3), snippet: snip, labelIds: ['INBOX', 'UNREAD', 'CATEGORY_PRIMARY'], payload: { headers: [{ name: 'From', value: from }, { name: 'To', value: 'me@example.com' }, { name: 'Subject', value: subj }] } }] });
  const threads = [thread('t1', 'Prof. Chen <chen@uni.edu>', 'Lab 4 grading update', 'Your lab report has been graded and feedback is available.'), thread('t2', 'Delta <no-reply@delta.com>', 'Your trip receipt', 'Thanks for flying with us. Your receipt is attached.'), thread('t3', 'Sam <sam@example.com>', 'Saturday dinner?', 'Are you still free Saturday night? I booked a table for seven.'), thread('t4', 'GitHub <noreply@github.com>', '[regis] Run completed', 'Build Regis: workflow run succeeded.')];
  return { events, threads };
}
async function install(ctx, drive) {
  const W = build();
  await ctx.route(/googleapis\.com|accounts\.google\.com/, async (route) => {
    const u = new URL(route.request().url()), m = route.request().method();
    const j = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(o) });
    if (m === 'OPTIONS') return j({});
    if (u.hostname === 'oauth2.googleapis.com') return j({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
    if (u.hostname === 'openidconnect.googleapis.com') return j({ email: 'me@example.com' });
    if (drive && u.pathname === '/drive/v3/files' && m === 'GET') return j({ files: drive.id ? [{ id: drive.id, name: 'Regis sync (do not delete).json' }] : [] });
    if (drive && u.pathname === '/drive/v3/files' && m === 'POST') { drive.id = 'F1'; return j({ id: 'F1' }); }
    if (drive && u.pathname.startsWith('/upload/drive/v3/files/') && m === 'PATCH') { drive.text = route.request().postData(); drive.writes = (drive.writes || 0) + 1; return j({}); }
    if (drive && u.pathname.startsWith('/drive/v3/files/') && u.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: drive.text || '' });
    if (u.pathname === '/drive/v3/files') return j({ files: [] });
    if (/\/gmail\/v1\/users\/me\/threads$/.test(u.pathname)) return j({ threads: W.threads.map((t) => ({ id: t.id })), resultSizeEstimate: W.threads.length });
    const tm = u.pathname.match(/\/gmail\/v1\/users\/me\/threads\/([^/]+)$/); if (tm) { const t = W.threads.find((x) => x.id === tm[1]); return t ? j(t) : j({ error: { message: 'nf' } }, 404); }
    if (u.pathname.endsWith('/gmail/v1/users/me/labels')) return j({ labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }, { id: 'Label_1', name: 'School', type: 'user' }] });
    if (u.pathname.includes('/calendar/v3/users/me/calendarList')) return j({ items: [{ id: 'primary', summary: 'Me', primary: true, accessRole: 'owner', backgroundColor: '#8ab4ff' }, { id: 'school', summary: 'School', accessRole: 'owner', backgroundColor: '#f5a97f' }] });
    if (/\/calendar\/v3\/calendars\/[^/]+\/events$/.test(u.pathname)) return j({ items: decodeURIComponent(u.pathname).includes('school') ? [] : W.events });
    return j({ error: { message: 'mock: no route ' + u.pathname } }, 404);
  });
}
module.exports = { install, build };
