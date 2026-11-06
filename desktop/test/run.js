'use strict';
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');
const { Canvas, normHost } = require('../lib/canvas'); const { Google, signIn, zonedToUtc, SCOPES } = require('../lib/google'); const { Anthropic } = require('../lib/anthropic'); const { Store } = require('../lib/store');
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } }
const res = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

function fakeGoogle(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = new URL(url); calls.push({ url: u, init, method: init.method || 'GET' });
    if (u.href.startsWith('https://oauth2.googleapis.com/token')) return res(200, { access_token: 'AT', expires_in: 3600 });
    for (const [k, v] of Object.entries(routes)) if ((init.method || 'GET') + ' ' + u.origin + u.pathname === k) return typeof v === 'function' ? v(u, init) : res(200, v);
    return res(404, { error: { message: 'no route ' + u.pathname } });
  };
  return { f, calls, g: new Google({ creds: () => ({ clientId: 'id', clientSecret: 's', refreshToken: 'rt' }), fetchFn: f }) };
}
const H = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
const GM = 'https://gmail.googleapis.com/gmail/v1/users/me';

(async () => {
  await t('zonedToUtc handles offsets and DST', () => {
    assert.strictEqual(zonedToUtc('2026-11-03T09:00:00', 'America/New_York').toISOString(), '2026-11-03T14:00:00.000Z');
    assert.strictEqual(zonedToUtc('2026-07-03T09:00', 'America/New_York').toISOString(), '2026-07-03T13:00:00.000Z');
    assert.strictEqual(zonedToUtc('2026-11-03T09:00', 'UTC').toISOString(), '2026-11-03T09:00:00.000Z');
  });
  await t('gmail search returns thin+enriched thread shape', async () => {
    const { g } = fakeGoogle({
      ['GET ' + GM + '/threads']: { threads: [{ id: 't1' }], resultSizeEstimate: 1 },
      ['GET ' + GM + '/threads/t1']: { id: 't1', messages: [{ id: 'm1', threadId: 't1', internalDate: '1780000000000', snippet: 'hi', labelIds: ['INBOX', 'UNREAD'], payload: { headers: H({ From: 'A <a@x.com>', To: 'me@x.com, b@y.org', Subject: 'Hello' }) } }] }
    });
    const r = await g.callTool('Gmail', 'search_threads', { query: 'is:unread', pageSize: 5 });
    assert.strictEqual(r.threads[0].messages[0].subject, 'Hello');
    assert.deepStrictEqual(r.threads[0].messages[0].toRecipients, ['me@x.com', 'b@y.org']);
    assert.deepStrictEqual(r.threads[0].messages[0].labelIds, ['INBOX', 'UNREAD']);
  });
  await t('gmail metadata headers are sent as repeated params (sender/subject were blank otherwise) and snippets are unescaped', async () => {
    let u1;
    const { g } = fakeGoogle({
      ['GET ' + GM + '/threads']: { threads: [{ id: 't1' }] },
      ['GET ' + GM + '/threads/t1']: (u) => { u1 = u; return res(200, { id: 't1', messages: [{ id: 'm1', threadId: 't1', snippet: 'there&#39;s no &amp; more &quot;x&quot;', payload: { headers: H({ From: 'A <a@x.com>', Subject: 'Hi' }) } }] }); }
    });
    const r = await g.callTool('Gmail', 'search_threads', { query: 'x' });
    assert.deepStrictEqual(u1.searchParams.getAll('metadataHeaders'), ['From', 'To', 'Subject']);
    assert.strictEqual(u1.searchParams.get('format'), 'metadata');
    assert.strictEqual(r.threads[0].messages[0].snippet, 'there\'s no & more "x"');
    assert.strictEqual(r.threads[0].messages[0].sender, 'A <a@x.com>');
  });
  await t('send_message builds a valid base64url RFC822 message with reply threading', async () => {
    let sent;
    const { g } = fakeGoogle({
      ['GET ' + GM + '/messages/orig']: { threadId: 'T9', payload: { headers: H({ 'Message-ID': '<abc@mail>' }) } },
      ['POST ' + GM + '/messages/send']: (u, init) => { sent = JSON.parse(init.body); return res(200, { id: 'n1', threadId: 'T9' }); }
    });
    const r = await g.callTool('Gmail', 'send_message', { to: ['a@x.com'], subject: 'Héllo', body: 'Line1\nLine2', replyToMessageId: 'orig' });
    assert.strictEqual(r.id, 'n1'); assert.strictEqual(sent.threadId, 'T9');
    const raw = Buffer.from(sent.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    assert(/^To: a@x\.com\r\n/.test(raw)); assert(/Subject: =\?UTF-8\?B\?/.test(raw)); assert(/In-Reply-To: <abc@mail>/.test(raw));
    const bodyB64 = raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''); assert.strictEqual(Buffer.from(bodyB64, 'base64').toString(), 'Line1\nLine2');
  });
  await t('subject newlines cannot inject headers', () => {
    const raw = Buffer.from(Google.mime({ to: ['a@x.com'], subject: 'x\r\nBcc: evil@z.com', body: 'b' }).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    assert(!/^Bcc:/m.test(raw));
  });
  await t('label, trash, create_label (409 reuses existing)', async () => {
    const seen = [];
    const { g } = fakeGoogle({
      ['POST ' + GM + '/threads/t1/modify']: (u, i) => { seen.push(JSON.parse(i.body)); return res(200, {}); },
      ['POST ' + GM + '/threads/t1/trash']: () => { seen.push('trash'); return res(200, {}); },
      ['POST ' + GM + '/labels']: () => res(409, { error: { message: 'exists' } }),
      ['GET ' + GM + '/labels']: { labels: [{ id: 'Label_1', name: 'Receipts', type: 'user' }] }
    });
    await g.callTool('Gmail', 'label_thread', { threadId: 't1', labelIds: ['L1'] }); await g.callTool('Gmail', 'unlabel_thread', { threadId: 't1', labelIds: ['INBOX'] }); await g.callTool('Gmail', 'trash_thread', { threadId: 't1' });
    assert.deepStrictEqual(seen, [{ addLabelIds: ['L1'] }, { removeLabelIds: ['INBOX'] }, 'trash']);
    assert.strictEqual((await g.callTool('Gmail', 'create_label', { displayName: 'receipts' })).labelId, 'Label_1');
  });
  await t('calendar list/create use correct time zone handling', async () => {
    let q, body;
    const { g } = fakeGoogle({
      ['GET https://www.googleapis.com/calendar/v3/calendars/primary/events']: (u) => { q = u.searchParams; return res(200, { items: [{ id: 'e1', summary: 'Standup', hangoutLink: 'https://meet/x' }] }); },
      ['POST https://www.googleapis.com/calendar/v3/calendars/primary/events']: (u, i) => { body = JSON.parse(i.body); return res(200, { id: 'e2' }); }
    });
    const l = await g.callTool('Google Calendar', 'list_events', { startTime: '2026-11-03T00:00:00', endTime: '2026-11-03T23:59:59', timeZone: 'America/Chicago' });
    assert.strictEqual(q.get('timeMin'), '2026-11-03T06:00:00.000Z'); assert.strictEqual(l.events[0].conferenceUrl, 'https://meet/x');
    await g.callTool('Google Calendar', 'create_event', { summary: 'Gym', startTime: '2026-11-03T17:00:00', endTime: '2026-11-03T18:00:00', timeZone: 'America/Chicago', description: 'Added by Regis' });
    assert.deepStrictEqual(body.start, { dateTime: '2026-11-03T17:00:00', timeZone: 'America/Chicago' }); assert.strictEqual(body.summary, 'Gym');
  });
  await t('create_event: other calendar, repeat, Meet link, all-day', async () => {
    let b, u2;
    const { g } = fakeGoogle({ ['POST https://www.googleapis.com/calendar/v3/calendars/club%40group.calendar.google.com/events']: (u, i) => { u2 = u; b = JSON.parse(i.body); return res(200, { id: 'z' }); } });
    await g.callTool('Google Calendar', 'create_event', { summary: 'Build night', startTime: '2026-11-05T18:00:00', endTime: '2026-11-05T20:00:00', calendarId: 'club@group.calendar.google.com', recurrenceData: ['RRULE:FREQ=WEEKLY'], addGoogleMeetUrl: true, location: 'Lab' });
    assert.deepStrictEqual(b.recurrence, ['RRULE:FREQ=WEEKLY']); assert.strictEqual(b.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet'); assert.strictEqual(u2.searchParams.get('conferenceDataVersion'), '1'); assert.strictEqual(b.location, 'Lab');
    await g.callTool('Google Calendar', 'create_event', { summary: 'Holiday', startTime: '2026-11-11', endTime: '2026-11-12', allDay: true, calendarId: 'club@group.calendar.google.com' });
    assert.deepStrictEqual(b.start, { date: '2026-11-11' });
  });
  await t('update_event patches the right event, keeps untouched fields out', async () => {
    let b, m, u2;
    const { g } = fakeGoogle({ ['PATCH https://www.googleapis.com/calendar/v3/calendars/club%40g.com/events/ev%2F1']: (u, i) => { u2 = u; b = JSON.parse(i.body); return res(200, { id: 'ev/1' }); } });
    await g.callTool('Google Calendar', 'update_event', { eventId: 'ev/1', calendarId: 'club@g.com', summary: 'New', startTime: '2026-11-05T14:20:00', endTime: '2026-11-05T15:05:00', timeZone: 'America/New_York', location: '' });
    assert.strictEqual(b.summary, 'New'); assert.strictEqual(b.location, ''); assert.strictEqual(b.description, undefined); assert.deepStrictEqual(b.start, { dateTime: '2026-11-05T14:20:00', timeZone: 'America/New_York' });
    await assert.rejects(() => g.callTool('Google Calendar', 'update_event', { summary: 'x' }));
  });
  await t('drive search translates query and update_file moves (add+remove parents)', async () => {
    let sq, patch;
    const { g } = fakeGoogle({
      ['GET https://www.googleapis.com/drive/v3/files']: (u) => { sq = u.searchParams.get('q'); return res(200, { files: [{ id: 'f1', name: 'a.pdf', mimeType: 'application/pdf', parents: ['root'], capabilities: { canMoveItemWithinDrive: false }, owners: [{ me: true }] }] }); },
      ['GET https://www.googleapis.com/drive/v3/files/f1']: { parents: ['root'] },
      ['PATCH https://www.googleapis.com/drive/v3/files/f1']: (u) => { patch = u.searchParams; return res(200, { id: 'f1', parents: ['F'] }); }
    });
    const r = await g.callTool('Google Drive', 'search_files', { query: "parentId = 'root' and owner = 'me'" });
    assert(sq.includes("'root' in parents") && sq.includes("'me' in owners") && sq.includes('trashed = false'));
    assert.strictEqual(r.files[0].capabilities.canMoveItemWithinDrive, false); assert.strictEqual(r.files[0].title, 'a.pdf');
    const u = await g.callTool('Google Drive', 'update_file', { fileId: 'f1', parentId: 'F' });
    assert.strictEqual(patch.get('addParents'), 'F'); assert.strictEqual(patch.get('removeParents'), 'root'); assert.strictEqual(u.parentId, 'F');
  });
  await t('unsupported tools are rejected; 401 refreshes token once; invalid_grant -> needs_reauth', async () => {
    const { g } = fakeGoogle({}); await assert.rejects(() => g.callTool('Gmail', 'delete_everything', {}), (e) => e.code === 'not_in_manifest');
    let n = 0; const g2 = new Google({ creds: () => ({ clientId: 'i', clientSecret: 's', refreshToken: 'r' }), fetchFn: async (url) => url.includes('oauth2') ? res(200, { access_token: 'T' + (++n), expires_in: 3600 }) : (n < 2 ? res(401, {}) : res(200, { labels: [] })) });
    assert.deepStrictEqual(await g2.callTool('Gmail', 'list_labels', {}), { labels: [] });
    const g3 = new Google({ creds: () => ({ clientId: 'i', clientSecret: 's', refreshToken: 'r' }), fetchFn: async () => res(400, { error: 'invalid_grant' }) });
    await assert.rejects(() => g3.callTool('Gmail', 'list_labels', {}), (e) => e.code === 'needs_reauth');
    const g4 = new Google({ creds: () => null, fetchFn: async () => { throw new Error('x'); } });
    await assert.rejects(() => g4.callTool('Gmail', 'list_labels', {}), (e) => e.code === 'needs_setup');
  });
  await t('OAuth loopback sign-in end to end (PKCE, state check, token exchange)', async () => {
    let tokenBody;
    const f = async (url, init) => { if (url.includes('token')) { tokenBody = new URLSearchParams(init.body); return res(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }); } return res(200, { email: 'me@x.com' }); };
    const out = await signIn({ clientId: 'cid', clientSecret: 'sec', fetchFn: f, openExternal: (url) => {
      const u = new URL(url); assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256'); assert(u.searchParams.get('scope').includes('gmail.modify'));
      const cb = new URL(u.searchParams.get('redirect_uri')); cb.searchParams.set('code', 'CODE'); cb.searchParams.set('state', u.searchParams.get('state'));
      setTimeout(() => http.get(cb.toString(), (r) => r.resume()), 20); } });
    assert.strictEqual(out.refreshToken, 'RT'); assert.strictEqual(out.email, 'me@x.com'); assert.strictEqual(tokenBody.get('code'), 'CODE'); assert(tokenBody.get('code_verifier').length >= 43);
  });
  await t('OAuth rejects a mismatched state', async () => {
    await assert.rejects(() => signIn({ clientId: 'c', clientSecret: 's', fetchFn: async () => res(200, {}), openExternal: (url) => {
      const u = new URL(url); const cb = new URL(u.searchParams.get('redirect_uri')); cb.searchParams.set('code', 'X'); cb.searchParams.set('state', 'WRONG'); setTimeout(() => http.get(cb.toString(), (r) => r.resume()), 20); } }), (e) => e.code === 'bad_state');
  });
  await t('Anthropic client: tiers, usage, json extraction, errors', async () => {
    let used = 0, body; const a = new Anthropic({ getKey: () => 'k', onUsage: (n) => { used += n; }, fetchFn: async (u, i) => { body = JSON.parse(i.body); return res(200, { content: [{ type: 'text', text: 'Sure:\n```json\n{"a":1}\n```' }], usage: { input_tokens: 10, output_tokens: 5 } }); } });
    assert.deepStrictEqual(await a.json('x', { modelTier: 'quick' }), { a: 1 }); assert.strictEqual(body.model, 'claude-haiku-5-5'); assert.strictEqual(used, 15);
    await assert.rejects(() => new Anthropic({ getKey: () => '' }).sample('x'), (e) => e.code === 'needs_setup');
    await assert.rejects(() => new Anthropic({ getKey: () => 'k', fetchFn: async () => res(401, {}) }).sample('x'), (e) => e.code === 'needs_setup');
  });
  await t('Store: persists data, secrets not in data file, monthly usage', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'regis-')); const s = new Store(d);
    s.setDb({ todos: { a: { title: 'x' } } }); s.setSecret('anthropicKey', 'sk-ant-SECRET'); s.addUsage(100); s.addUsage(50); s.flush();
    const s2 = new Store(d); assert.strictEqual(s2.getDb().todos.a.title, 'x'); assert.strictEqual(s2.getSecret('anthropicKey'), 'sk-ant-SECRET'); assert.strictEqual(s2.monthUsage().tokens, 150);
    assert(!fs.readFileSync(path.join(d, 'regis-data.json'), 'utf8').includes('SECRET'));
  });
  await t('Canvas: planner items map to assignment shape, token sent only to school host', async () => {
    const seen = [];
    const f = async (url, init) => { seen.push({ url: new URL(url), auth: init.headers.Authorization }); return res(200, [
      { plannable_id: 11, plannable_type: 'assignment', context_name: 'CHEM 201', html_url: '/courses/1/assignments/11', plannable: { title: 'Problem Set 6', due_at: '2026-11-03T23:59:00Z', points_possible: 20 }, submissions: { submitted: false, missing: true } },
      { plannable_id: 12, plannable_type: 'quiz', context_name: 'HIST 110', html_url: '/courses/2/quizzes/12', plannable: { title: 'Quiz 4', due_at: '2026-11-05T15:00:00Z' }, submissions: { submitted: true }, planner_override: { marked_complete: false } },
      { plannable_id: 13, plannable_type: 'planner_note', plannable: { title: 'Read ch. 7', todo_date: '2026-11-04T05:00:00Z' } },
      { plannable_id: 14, plannable_type: 'assignment', plannable: null }]); };
    const c = new Canvas({ creds: () => ({ host: 'https://school.instructure.com', token: 'TK' }), fetchFn: f });
    const { items } = await c.callTool('list_assignments', { days: 21, pastDays: 7 });
    assert.strictEqual(items.length, 3); assert.strictEqual(items[0].url, 'https://school.instructure.com/courses/1/assignments/11'); assert(items[0].missing && !items[0].complete);
    assert(items[1].submitted && items[1].complete); assert.strictEqual(items[2].dueAt, '2026-11-04T05:00:00Z'); assert.strictEqual(items[0].points, 20);
    assert.strictEqual(seen[0].url.origin, 'https://school.instructure.com'); assert.strictEqual(seen[0].auth, 'Bearer TK'); assert(seen[0].url.searchParams.get('start_date'));
  });
  await t('Canvas: errors for bad token, not connected, bad URL', async () => {
    const mk = (st) => new Canvas({ creds: () => ({ host: 'https://s.instructure.com', token: 't' }), fetchFn: async () => res(st, {}) });
    await assert.rejects(() => mk(401).whoami(), (e) => e.code === 'auth'); await assert.rejects(() => mk(500).callTool('list_assignments', {}), (e) => e.code === 'http_500');
    await assert.rejects(() => new Canvas({ creds: () => ({ host: '', token: '' }) }).whoami(), (e) => e.code === 'not_connected');
    assert.strictEqual(normHost('school.instructure.com/courses'), 'https://school.instructure.com'); assert.throws(() => normHost('http://x.com'), (e) => e.code === 'bad_url'); assert.throws(() => normHost(''), (e) => e.code === 'bad_url');
  });
  await t('Gmail get_thread full: decodes plain body, cc, attachments names', async () => {
    const b64 = (x) => Buffer.from(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    const { g, calls } = fakeGoogle({ ['GET ' + GM + '/threads/t9']: { id: 't9', messages: [{ id: 'm1', threadId: 't9', internalDate: '1780000000000', snippet: 's', labelIds: ['INBOX'], payload: { mimeType: 'multipart/mixed', headers: H({ From: 'A <a@x.com>', To: 'me@x.com', Cc: 'c@y.org', Subject: 'Hi' }), parts: [{ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64('Hello there\nSecond line') } }, { mimeType: 'text/html', body: { data: b64('<p>Hello</p>') } }] }, { mimeType: 'application/pdf', filename: 'notes.pdf', body: { attachmentId: 'x' } }] } }] } });
    const r = await g.callTool('Gmail', 'get_thread', { threadId: 't9', messageFormat: 'PLAIN_TEXT' }); const m = r.messages[0];
    assert.strictEqual(m.plaintextBody, 'Hello there\nSecond line'); assert.deepStrictEqual(m.ccRecipients, ['c@y.org']); assert.strictEqual(m.attachments[0].filename, 'notes.pdf'); assert.strictEqual(calls.find((c) => c.url.pathname.endsWith('/threads/t9')).url.searchParams.get('format'), 'full');
    const thin = await g.callTool('Gmail', 'get_thread', { threadId: 't9', messageFormat: 'MINIMAL' }); assert.strictEqual(thin.messages[0].plaintextBody, undefined);
  });
  await t('Calendar: list_calendars + list_events on another calendar with paging', async () => {
    const CALB = 'https://www.googleapis.com/calendar/v3';
    const { g, calls } = fakeGoogle({ ['GET ' + CALB + '/users/me/calendarList']: { items: [{ id: 'me@x.com', summary: 'Me', primary: true, selected: true, backgroundColor: '#111' }, { id: 'club@group.calendar.google.com', summary: 'Club', backgroundColor: '#222' }] },
      ['GET ' + CALB + '/calendars/club%40group.calendar.google.com/events']: (u) => res(200, { items: [{ id: 'e1', summary: 'Build night', start: { dateTime: '2026-11-03T18:00:00-05:00' }, end: { dateTime: '2026-11-03T20:00:00-05:00' } }], nextPageToken: u.searchParams.get('pageToken') ? undefined : 'NP' }) });
    const cl = await g.callTool('Google Calendar', 'list_calendars', {}); assert.strictEqual(cl.calendars.length, 2); assert(cl.calendars[0].primary);
    const a = await g.callTool('Google Calendar', 'list_events', { startTime: '2026-01-01T00:00:00', endTime: '2027-01-01T00:00:00', timeZone: 'America/New_York', calendarId: 'club@group.calendar.google.com', pageSize: 250 });
    assert.strictEqual(a.nextPageToken, 'NP'); assert.strictEqual(a.events[0].summary, 'Build night');
    const b = await g.callTool('Google Calendar', 'list_events', { startTime: '2026-01-01T00:00:00', endTime: '2027-01-01T00:00:00', timeZone: 'America/New_York', calendarId: 'club@group.calendar.google.com', pageToken: 'NP' }); assert.strictEqual(b.nextPageToken, undefined);
    assert.strictEqual(calls[calls.length - 1].url.searchParams.get('pageToken'), 'NP');
  });
  await t('mini mode: corner square, always on top, and back again', () => {
    const { Mini, SIZE, MARGIN } = require('../lib/mini');
    const mk = (b) => { const w = { b: Object.assign({}, b), top: false, min: null, max: false, vis: true, getBounds() { return Object.assign({}, this.b); }, setBounds(x) { this.b = Object.assign({}, x); }, setAlwaysOnTop(v) { this.top = v; }, setMinimumSize(a, c) { this.min = [a, c]; }, isMaximized() { return this.max; }, maximize() { this.max = true; }, unmaximize() { this.max = false; }, isDestroyed() { return false; }, isVisible() { return this.vis; }, show() { this.vis = true; }, isFullScreen() { return false; }, setVisibleOnAllWorkspaces() {} }; return w; };
    const screen = { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }), getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }] };
    const win = mk({ x: 100, y: 80, width: 1280, height: 860 }); const m = new Mini(() => win, screen);
    assert.strictEqual(m.enter(), true);
    assert.deepStrictEqual(win.b, { x: 1920 - SIZE.w - MARGIN, y: 1040 - SIZE.h - MARGIN, width: SIZE.w, height: SIZE.h });
    assert(win.top && win.min[0] < 400);
    assert.strictEqual(m.enter(), true); assert.strictEqual(win.b.width, SIZE.w);
    win.b = { x: 500, y: 300, width: 340, height: 400 }; // user dragged it
    assert.strictEqual(m.exit(), false);
    assert.deepStrictEqual(win.b, { x: 100, y: 80, width: 1280, height: 860 }); assert(!win.top && win.min[0] === 420);
    m.enter(); assert.deepStrictEqual(win.b, { x: 500, y: 300, width: 340, height: 400 }, 'remembers where you put it');
    m.exit(); win.max = true; m.enter(); assert.strictEqual(win.max, false); m.exit(); assert.strictEqual(win.max, true, 'maximised window is restored');
    const gone = mk({ x: 0, y: 0, width: 800, height: 600 }); const m2 = new Mini(() => gone, screen); m2.enter(); gone.b = { x: 5000, y: 5000, width: 340, height: 400 }; m2.exit(); m2.enter();
    assert.strictEqual(gone.b.x, 1920 - SIZE.w - MARGIN, 'off-screen position falls back to the corner');
    assert.strictEqual(new Mini(() => null, screen).enter(), false);
  });
  await t('OAuth scopes include calendar list (merged calendars)', () => { assert(SCOPES.some((x) => x.includes('calendarlist'))); });
  await t('a failed iframe or cancelled load must not discard a staged update', () => { const m = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8'); assert(/isMainFrame/.test(m) && /code === -3/.test(m) && !/once\('did-fail-load', \(\) => \{ updater\.clear/.test(m)); });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
