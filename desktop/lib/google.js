'use strict';
/* Google sign-in (OAuth 2.0 desktop flow with PKCE) and the Gmail / Calendar / Drive calls Regis needs.
   The page was written against Claude's connectors, so every tool here accepts the same input and returns
   the same shape. Pure module: `fetch` and the browser opener are injected so it can be tested. */

const crypto = require('crypto');
const http = require('http');

const SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/gmail.modify',      // read, label, archive, trash, draft, send (never permanent delete)
  'https://www.googleapis.com/auth/calendar.events',   // read and create events
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly', // list your calendars for the merged calendar view
  'https://www.googleapis.com/auth/drive'              // move files you already own into folders
];
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CAL = 'https://www.googleapis.com/calendar/v3';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const SYNC_NAME = 'Regis sync (do not delete).json';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const err = (code, message) => Object.assign(new Error(message), { code });

/* ---------- sign-in ---------- */
function buildAuthUrl({ clientId, redirectUri, challenge, state }) {
  const p = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    code_challenge: challenge, code_challenge_method: 'S256', state,
    access_type: 'offline', prompt: 'consent'
  });
  return AUTH_URL + '?' + p.toString();
}

async function signIn({ clientId, clientSecret, openExternal, fetchFn = fetch, timeoutMs = 5 * 60 * 1000 }) {
  if (!clientId || !clientSecret) throw err('needs_setup', 'Add your Google client ID and secret first (see the README).');
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const server = http.createServer();
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); });
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;

  const codePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(err('timeout', 'Google sign-in timed out. Try again.')), timeoutMs);
    server.on('request', (req, res) => {
      const u = new URL(req.url, redirectUri);
      if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const page = (msg) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><title>Regis</title><body style="font:16px system-ui;background:#0a0713;color:#f1ecff;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${msg}</h2><p>You can close this tab and return to Regis.</p></div>`); };
      if (u.searchParams.get('state') !== state) { page('Sign-in link did not match. Please try again.'); clearTimeout(timer); reject(err('bad_state', 'Sign-in was not recognised. Try again.')); return; }
      if (u.searchParams.get('error')) { page('Google sign-in was cancelled.'); clearTimeout(timer); reject(err('denied', 'Google sign-in was cancelled.')); return; }
      page('Regis is connected to Google.'); clearTimeout(timer); resolve(u.searchParams.get('code'));
    });
  });

  try {
    openExternal(buildAuthUrl({ clientId, redirectUri, challenge, state }));
    const code = await codePromise;
    const r = await fetchFn(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }).toString()
    });
    const j = await r.json();
    if (!r.ok) throw err('auth_failed', (j && (j.error_description || j.error)) || 'Google refused the sign-in.');
    if (!j.refresh_token) throw err('auth_failed', 'Google did not return a long-lived sign-in. Remove Regis at myaccount.google.com/permissions and try again.');
    let email = '';
    try { const ui = await fetchFn('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + j.access_token } }); email = (await ui.json()).email || ''; } catch (_) { /* optional */ }
    return { refreshToken: j.refresh_token, accessToken: j.access_token, expiresIn: j.expires_in, email };
  } finally { server.close(); }
}

/* ---------- authenticated client ---------- */
class Google {
  /* creds(): {clientId, clientSecret, refreshToken} or null */
  constructor({ creds, fetchFn = fetch, now = () => Date.now() }) { this.creds = creds; this.f = fetchFn; this.now = now; this.at = null; this.exp = 0; }

  async token() {
    if (this.at && this.now() < this.exp - 60000) return this.at;
    const c = this.creds();
    if (!c || !c.refreshToken) throw err('needs_setup', 'Connect Google in Setup first.');
    const r = await this.f(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' }).toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (j.error === 'invalid_grant') throw err('needs_reauth', 'Google sign-in expired. Press “Save & connect Google” in Setup again.');
      throw err('server_unavailable', 'Google sign-in failed: ' + (j.error_description || j.error || r.status));
    }
    this.at = j.access_token; this.exp = this.now() + (j.expires_in || 3600) * 1000; return this.at;
  }

  async api(method, url, { query, body } = {}) {
    const u = new URL(url);
    if (query) Object.entries(query).forEach(([k, v]) => { if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, String(x))); /* Gmail wants repeated params, not a comma list */ else if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v)); });
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await this.f(u.toString(), { method, headers: Object.assign({ Authorization: 'Bearer ' + await this.token() }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
      if (r.status === 401 && attempt === 0) { this.at = null; continue; }
      const text = await r.text(); let j = {}; try { j = text ? JSON.parse(text) : {}; } catch (_) { j = { raw: text }; }
      if (r.ok) return j;
      const m = (j.error && (j.error.message || j.error)) || ('HTTP ' + r.status);
      if (r.status === 401) throw err('needs_reauth', 'Google rejected the sign-in. Connect again in Setup.');
      if (r.status === 429 || r.status >= 500) throw err('server_unavailable', 'Google is busy: ' + m);
      const e = err('tool_error', String(m)); e.status = r.status; throw e;
    }
  }

  /* plain-text request/response (Drive file content) */
  async raw(method, url, { query, body, contentType } = {}) {
    const u = new URL(url); if (query) Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null) u.searchParams.set(k, String(v)); });
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await this.f(u.toString(), { method, headers: Object.assign({ Authorization: 'Bearer ' + await this.token() }, body !== undefined ? { 'Content-Type': contentType || 'text/plain' } : {}), body });
      if (r.status === 401 && attempt === 0) { this.at = null; continue; }
      const text = await r.text();
      if (r.ok) return text;
      if (r.status === 401) throw err('needs_reauth', 'Google rejected the sign-in. Connect again in Setup.');
      if (r.status === 429 || r.status >= 500) throw err('server_unavailable', 'Google is busy (' + r.status + ')');
      throw err('tool_error', 'Drive error ' + r.status + ': ' + text.slice(0, 160));
    }
  }

  async _syncFile() {
    const r = await this.api('GET', `${DRIVE}/files`, { query: { q: `name = '${SYNC_NAME}' and trashed = false and 'me' in owners`, fields: 'files(id,name,modifiedTime)', spaces: 'drive', orderBy: 'createdTime', pageSize: 5, supportsAllDrives: true, includeItemsFromAllDrives: true } });
    return (r.files || [])[0] || null;
  }

  /* ----- helpers ----- */
  static header(msg, name) { const h = (msg.payload && msg.payload.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase()); return h ? h.value : ''; }
  static addrs(v) { return (String(v || '').match(/[^\s<>,;"]+@[^\s<>,;"]+\.[^\s<>,;"]+/g) || []); }
  static shapeMessage(m) {
    const H = (n) => Google.header(m, n);
    return { id: m.id, threadId: m.threadId, sender: H('From'), subject: H('Subject'), toRecipients: Google.addrs(H('To')),
      date: m.internalDate ? new Date(+m.internalDate).toISOString() : '', snippet: Google.unescape(m.snippet || ''), labelIds: m.labelIds || [],
      viewUrl: 'https://mail.google.com/mail/u/0/#all/' + m.threadId };
  }
  static unescape(t) { return String(t).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&(quot|amp|lt|gt|apos|nbsp);/g, (_, n) => ({ quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' })[n]); }
  static decode(d) { try { return Buffer.from(String(d || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (_) { return ''; } }
  static bodyOf(payload) {
    const out = { text: '', html: '', files: [] };
    (function walk(p) { if (!p) return; const mt = p.mimeType || '';
      if (p.filename) out.files.push({ filename: p.filename, mimeType: mt });
      else if (mt === 'text/plain' && p.body && p.body.data) out.text += Google.decode(p.body.data);
      else if (mt === 'text/html' && p.body && p.body.data) out.html += Google.decode(p.body.data);
      (p.parts || []).forEach(walk); })(payload);
    return out;
  }
  static shapeMessageFull(m) {
    const base = Google.shapeMessage(m), b = Google.bodyOf(m.payload), H = (n) => Google.header(m, n);
    return Object.assign(base, { ccRecipients: Google.addrs(H('Cc')), plaintextBody: b.text.trim(), htmlBody: b.text ? '' : b.html, attachments: b.files });
  }
  static shapeThread(t, full) {
    const ms = (t.messages || []).map(full ? Google.shapeMessageFull : Google.shapeMessage);
    return { id: t.id, messageCount: ms.length, messages: ms, viewUrl: 'https://mail.google.com/mail/u/0/#all/' + t.id };
  }
  static mime({ to, cc, bcc, subject, body, htmlBody, inReplyTo, references }) {
    const enc = (s) => /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
    const lines = [];
    if (to && to.length) lines.push('To: ' + to.join(', '));
    if (cc && cc.length) lines.push('Cc: ' + cc.join(', '));
    if (bcc && bcc.length) lines.push('Bcc: ' + bcc.join(', '));
    lines.push('Subject: ' + enc(String(subject || '').replace(/[\r\n]+/g, ' ')));
    if (inReplyTo) { lines.push('In-Reply-To: ' + inReplyTo); lines.push('References: ' + (references ? references + ' ' : '') + inReplyTo); }
    lines.push('MIME-Version: 1.0');
    lines.push('Content-Type: ' + (htmlBody ? 'text/html' : 'text/plain') + '; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: base64');
    const b64 = Buffer.from(htmlBody || body || '', 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
    return b64url(lines.join('\r\n') + '\r\n\r\n' + b64);
  }
  async replyHeaders(messageId) {
    if (!messageId) return {};
    try {
      const m = await this.api('GET', `${GMAIL}/messages/${encodeURIComponent(messageId)}`, { query: { format: 'metadata', metadataHeaders: 'Message-ID' } });
      return { threadId: m.threadId, inReplyTo: Google.header(m, 'Message-ID') };
    } catch (_) { return {}; }
  }

  /* ----- tools (names and shapes mirror the Claude connectors the page was built against) ----- */
  async callTool(server, tool, input = {}) {
    const fn = (this.tools[server] || {})[tool];
    if (!fn) throw err('not_in_manifest', `${server} · ${tool} isn't supported in the desktop app.`);
    return fn.call(this, input);
  }
}

/* concurrency-limited map */
async function pmap(list, n, fn) { const out = new Array(list.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k]); } })); return out; }

/* local wall-clock time in an IANA zone -> UTC instant */
function zonedToUtc(local, tz) {
  const m = String(local).match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/); if (!m) return new Date(local);
  const want = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const offsetAt = (ms) => { const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms; };
  let guess = want - offsetAt(want); guess = want - offsetAt(guess); return new Date(guess);
}
const sysTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; } };

Google.prototype.tools = {
  Gmail: {
    async search_threads({ query = '', pageSize = 20, pageToken }) {
      const list = await this.api('GET', GMAIL + '/threads', { query: { q: query, maxResults: Math.min(50, pageSize || 20), pageToken } });
      const ids = (list.threads || []).map((t) => t.id);
      const full = await pmap(ids, 6, (id) => this.api('GET', `${GMAIL}/threads/${id}`, { query: { format: 'metadata', metadataHeaders: ['From', 'To', 'Subject'] } }).catch(() => null));
      return { resultCountEstimate: list.resultSizeEstimate || ids.length, threads: full.filter(Boolean).map(Google.shapeThread), nextPageToken: list.nextPageToken };
    },
    async get_thread({ threadId, messageFormat }) {
      const full = messageFormat === 'FULL_CONTENT' || messageFormat === 'PLAIN_TEXT';
      return Google.shapeThread(await this.api('GET', `${GMAIL}/threads/${encodeURIComponent(threadId)}`, { query: full ? { format: 'full' } : { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Subject'] } }), full);
    },
    async list_labels() { const r = await this.api('GET', GMAIL + '/labels'); return { labels: (r.labels || []).map((l) => ({ labelId: l.id, name: l.name, labelType: l.type })) }; },
    async create_label({ displayName }) {
      try { const l = await this.api('POST', GMAIL + '/labels', { body: { name: displayName, labelListVisibility: 'labelShow', messageListVisibility: 'show' } }); return { labelId: l.id, name: l.name }; }
      catch (e) { if (e.status === 409) { const r = await this.api('GET', GMAIL + '/labels'); const l = (r.labels || []).find((x) => x.name.toLowerCase() === String(displayName).toLowerCase()); if (l) return { labelId: l.id, name: l.name }; } throw e; }
    },
    async label_thread({ threadId, labelIds }) { await this.api('POST', `${GMAIL}/threads/${encodeURIComponent(threadId)}/modify`, { body: { addLabelIds: labelIds } }); return {}; },
    async unlabel_thread({ threadId, labelIds }) { await this.api('POST', `${GMAIL}/threads/${encodeURIComponent(threadId)}/modify`, { body: { removeLabelIds: labelIds } }); return {}; },
    async trash_thread({ threadId }) { await this.api('POST', `${GMAIL}/threads/${encodeURIComponent(threadId)}/trash`); return {}; },
    async create_draft(input) {
      const rh = await this.replyHeaders(input.replyToMessageId);
      const raw = Google.mime({ ...input, inReplyTo: rh.inReplyTo });
      const d = await this.api('POST', GMAIL + '/drafts', { body: { message: Object.assign({ raw }, rh.threadId ? { threadId: rh.threadId } : {}) } });
      return { id: d.id };
    },
    async send_message(input) {
      const rh = await this.replyHeaders(input.replyToMessageId);
      const raw = Google.mime({ ...input, inReplyTo: rh.inReplyTo });
      const m = await this.api('POST', GMAIL + '/messages/send', { body: Object.assign({ raw }, rh.threadId ? { threadId: rh.threadId } : {}) });
      return { id: m.id, threadId: m.threadId };
    }
  },
  'Google Calendar': {
    async list_calendars() {
      const r = await this.api('GET', CAL + '/users/me/calendarList', { query: { maxResults: 100, minAccessRole: 'reader' } });
      return { calendars: (r.items || []).map((c) => ({ id: c.id, summary: c.summaryOverride || c.summary, backgroundColor: c.backgroundColor, primary: !!c.primary, selected: !!c.selected, accessRole: c.accessRole })) };
    },
    async list_events({ startTime, endTime, timeZone, pageSize = 100, calendarId, pageToken }) {
      const tz = timeZone || sysTz();
      const r = await this.api('GET', CAL + '/calendars/' + encodeURIComponent(calendarId || 'primary') + '/events', { query: { timeMin: zonedToUtc(startTime, tz).toISOString(), timeMax: zonedToUtc(endTime, tz).toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: Math.min(250, pageSize), timeZone: tz, pageToken } });
      return { nextPageToken: r.nextPageToken, events: (r.items || []).map((e) => Object.assign({}, e, { conferenceUrl: e.hangoutLink || ((e.conferenceData && e.conferenceData.entryPoints || []).find((p) => p.entryPointType === 'video') || {}).uri || '' })) };
    },
    async update_event({ eventId, calendarId, summary, startTime, endTime, timeZone, description, location, allDay, addGoogleMeetUrl }) {
      if (!eventId) throw Object.assign(new Error('Missing event id'), { code: 'invalid' });
      const tz = timeZone || sysTz(), body = {};
      if (summary !== undefined) body.summary = summary;
      if (description !== undefined) body.description = description;
      if (location !== undefined) body.location = location;
      if (startTime) {
        if (allDay === true) { body.start = { date: String(startTime).slice(0, 10) }; body.end = { date: String(endTime || startTime).slice(0, 10) }; }
        else { body.start = { dateTime: String(startTime).slice(0, 19), timeZone: tz }; if (endTime) body.end = { dateTime: String(endTime).slice(0, 19), timeZone: tz }; }
      }
      if (addGoogleMeetUrl) body.conferenceData = { createRequest: { requestId: 'regis-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
      return this.api('PATCH', CAL + '/calendars/' + encodeURIComponent(calendarId || 'primary') + '/events/' + encodeURIComponent(eventId), { body, query: addGoogleMeetUrl ? { conferenceDataVersion: 1 } : undefined });
    },
    async create_event({ summary, startTime, endTime, timeZone, description, location, allDay, calendarId, recurrenceData, addGoogleMeetUrl }) {
      const tz = timeZone || sysTz();
      const body = { summary, description, location };
      if (Array.isArray(recurrenceData) && recurrenceData.length) body.recurrence = recurrenceData;
      if (addGoogleMeetUrl) body.conferenceData = { createRequest: { requestId: 'regis-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
      if (allDay) { body.start = { date: String(startTime).slice(0, 10) }; body.end = { date: String(endTime || startTime).slice(0, 10) }; }
      else { body.start = { dateTime: String(startTime).slice(0, 19), timeZone: tz }; body.end = { dateTime: String(endTime).slice(0, 19), timeZone: tz }; }
      return this.api('POST', CAL + '/calendars/' + encodeURIComponent(calendarId || 'primary') + '/events', { body, query: addGoogleMeetUrl ? { conferenceDataVersion: 1 } : undefined });
    }
  },
  'Google Drive': {
    async search_files({ query = '', pageSize = 50, pageToken }) {
      /* the page uses the connector's query words; translate them to Drive's */
      let q = String(query).replace(/parentId\s*=\s*'([^']+)'/g, "'$1' in parents").replace(/owner\s*=\s*'me'/g, "'me' in owners");
      if (!/trashed/.test(q)) q += (q ? ' and ' : '') + 'trashed = false';
      const r = await this.api('GET', DRIVE + '/files', { query: { q, pageSize: Math.min(100, pageSize), pageToken, orderBy: 'modifiedTime desc',
        fields: 'nextPageToken,files(id,name,mimeType,parents,webViewLink,capabilities(canMoveItemWithinDrive),owners(me))' } });
      return { files: (r.files || []).map((f) => ({ id: f.id, title: f.name, mimeType: f.mimeType, parentId: (f.parents || [])[0] || '', viewUrl: f.webViewLink || '',
        capabilities: { canMoveItemWithinDrive: !(f.capabilities && f.capabilities.canMoveItemWithinDrive === false) }, owner: (f.owners || [])[0] && f.owners[0].me ? 'me' : '' })), nextPageToken: r.nextPageToken };
    },
    /* Regis cross-device sync: one private JSON file in your Drive. */
    async regis_sync_read() {
      const f = await this._syncFile();
      if (!f) return { text: null };
      return { text: await this.raw('GET', `${DRIVE}/files/${encodeURIComponent(f.id)}`, { query: { alt: 'media', supportsAllDrives: true } }), fileId: f.id };
    },
    async regis_sync_write({ text }) {
      if (typeof text !== 'string' || !text) throw err('tool_error', 'Nothing to write.');
      const f = await this._syncFile();
      if (f) { await this.raw('PATCH', `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(f.id)}`, { query: { uploadType: 'media', supportsAllDrives: true }, body: text, contentType: 'application/json' }); return { fileId: f.id }; }
      const made = await this.api('POST', `${DRIVE}/files`, { query: { supportsAllDrives: true, fields: 'id' }, body: { name: SYNC_NAME, mimeType: 'application/json', description: 'Regis keeps your tasks, rules and settings in sync across devices here. Safe to leave alone.' } });
      await this.raw('PATCH', `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(made.id)}`, { query: { uploadType: 'media', supportsAllDrives: true }, body: text, contentType: 'application/json' });
      return { fileId: made.id };
    },
    async update_file({ fileId, parentId, title, starred }) {
      const q = { supportsAllDrives: true, fields: 'id,parents' };
      if (parentId) {
        const cur = await this.api('GET', `${DRIVE}/files/${encodeURIComponent(fileId)}`, { query: { fields: 'parents', supportsAllDrives: true } });
        q.addParents = parentId; q.removeParents = (cur.parents || []).join(',');
      }
      const body = {}; if (title) body.name = title; if (typeof starred === 'boolean') body.starred = starred;
      const f = await this.api('PATCH', `${DRIVE}/files/${encodeURIComponent(fileId)}`, { query: q, body });
      return { id: f.id, parentId: (f.parents || [])[0] || '' };
    }
  }
};

module.exports = { Google, signIn, buildAuthUrl, zonedToUtc, SCOPES };
