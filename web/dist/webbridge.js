/* Browser / iPhone / iPad runtime: implements the same `regisBridge` the Electron preload provides, entirely in the page.
   Data is kept in this browser's storage and (optionally) synced through your Google Drive. */
(function () {
  'use strict';
  var L = window.RegisLib; if (!L) return;
  var NATIVE = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.regis;
  var BASE = location.origin + location.pathname.replace(/[^\/]*$/, '');
  var REDIRECT = BASE + 'callback.html';
  var mem = {};
  function get(k, d) { try { var v = localStorage.getItem(k); return v == null ? (k in mem ? mem[k] : d) : JSON.parse(v); } catch (_) { return k in mem ? mem[k] : d; } }
  function set(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  function sec() { return get('regis-sec', {}); }
  function setSec(p) { var s = sec(); Object.keys(p).forEach(function (k) { if (p[k] === '' || p[k] == null) delete s[k]; else s[k] = p[k]; }); set('regis-sec', s); }
  function err(code, msg) { var e = new Error(msg); e.code = code; return e; }

  var google = new L.Google({ creds: function () { var s = sec(); return { clientId: s.gClientId, clientSecret: s.gSecret, refreshToken: s.gRefresh }; }, fetchFn: function () { return window.fetch.apply(window, arguments); } });
  var claude = new L.Anthropic({ getKey: function () { return sec().anthropicKey || ''; }, browser: true, onUsage: function (t) { var m = new Date().toISOString().slice(0, 7), u = get('regis-usage', {}); if (u.month !== m) u = { month: m, tokens: 0, calls: 0 }; u.tokens += t; u.calls += 1; set('regis-usage', u); }, fetchFn: function () { return window.fetch.apply(window, arguments); } });
  var canvas = new L.Canvas({ creds: function () { var s = sec(); return { host: s.cvHost, token: s.cvToken }; }, fetchFn: function () { return window.fetch.apply(window, arguments); } });

  /* ---- Google sign-in (PKCE). On iPhone/iPad the native shell opens the sign-in sheet; in a browser it is a normal redirect. ---- */
  function b64url(buf) { var s = ''; new Uint8Array(buf).forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function rand(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); }
  async function finishAuth(params) {
    var pk = get('regis-pkce', null); set('regis-pkce', null);
    if (!pk) throw err('bad_state', 'Sign-in was not recognised. Try again.');
    if (params.get('error')) throw err('denied', 'Google sign-in was cancelled.');
    if (params.get('state') !== pk.state) throw err('bad_state', 'Sign-in link did not match. Try again.');
    var s = sec();
    var r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: params.get('code'), client_id: s.gClientId, client_secret: s.gSecret, redirect_uri: pk.redirect, grant_type: 'authorization_code', code_verifier: pk.verifier }).toString() });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw err('auth_failed', (j.error_description || j.error) || 'Google refused the sign-in.');
    if (!j.refresh_token) throw err('auth_failed', 'Google did not return a long-lived sign-in. Remove Regis at myaccount.google.com/permissions and try again.');
    var email = ''; try { var ui = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + j.access_token } }); email = (await ui.json()).email || ''; } catch (_) {}
    setSec({ gRefresh: j.refresh_token, gEmail: email }); google.at = null; return true;
  }
  var authReady = Promise.resolve();
  (function handleRedirect() {
    var q = new URLSearchParams(location.search);
    if ((q.get('code') || q.get('error')) && q.get('state') && get('regis-pkce', null)) {
      authReady = finishAuth(q).catch(function (e) { set('regis-autherr', e.message); }).then(function () { history.replaceState(null, '', location.pathname); });
    }
  })();
  window.__regisAuthDone = function (url) { try { return finishAuth(new URL(url).searchParams); } catch (e) { return Promise.reject(e); } };

  /* ---- updates: the site itself is the update channel; each open fetches the newest files (see sw.js) ---- */
  var loadedVersion = '', updCbs = [];
  var verReady = fetch('version.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) { loadedVersion = j.version || ''; return loadedVersion; }).catch(function () { return ''; });
  function checkUpdate() {
    return fetch('version.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      return verReady.then(function (cur) {
        if (!j.version || !cur || j.version === cur) return { status: 'current', version: cur || j.version || '' };
        if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then(function (g) { if (g) g.update(); }).catch(function () {});
        updCbs.forEach(function (cb) { try { cb(j.version); } catch (_) {} });
        return { status: 'staged', version: j.version };
      });
    });
  }
  setInterval(function () { if (!document.hidden) checkUpdate().catch(function () {}); }, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkUpdate().catch(function () {}); });
  /* 1.9.1 Guild: the same AI workspaces as the desktop app; history in this browser's storage, one table with a context_scope per row */
  /* 1.9.7: the same team system as the desktop app (teams, ledger, caps, orchestrator). There is no local AI in a browser, so Claude is the only engine here; the caps still apply. */
  var kit = L.teamKit ? L.teamKit({ anthropic: claude, table: function (k, d) { return { load: function () { return get('regis-' + (k === 'guild' ? 'guild' : 'tk-' + k), d); }, save: function (v) { set('regis-' + (k === 'guild' ? 'guild' : 'tk-' + k), v); } }; } }) : null;
  var guild = kit ? kit.guild : null, P = function (f) { return function () { var a = arguments; return Promise.resolve().then(function () { return f.apply(null, a); }); }; };
  window.regisBridge = {
    teams: kit ? { get: P(kit.api.get), policy: P(kit.api.policy), global: P(kit.api.global), run: P(kit.api.run), memAdd: P(kit.api.memAdd), memDel: P(kit.api.memDel), ledger: P(kit.api.ledger) } : null,
    guild: guild ? { agents: function () { return Promise.resolve(L.agentList()); }, history: function (id) { return Promise.resolve().then(function () { return guild.history(String(id || '')); }); },
      send: function (id, t, x) { return guild.send(String(id || ''), t, x || {}); }, clear: function (id) { return Promise.resolve().then(function () { return guild.clear(String(id || '')); }); } } : null,
    updateCheck: checkUpdate,
    updateApply: function () { setTimeout(function () { location.reload(); }, 50); return Promise.resolve(true); },
    onUpdate: function (cb) { updCbs.push(cb); },
    dbLoad: function () { return Promise.resolve(get('regis-db', {})); },
    dbSave: function (db) { set('regis-db', db); return Promise.resolve(true); },
    tool: function (server, tool, input) { return server === 'Canvas' ? canvas.callTool(tool, input || {}) : google.callTool(server, tool, input || {}); },
    sample: function (input, opts) { if (kit) return kit.sample(input, opts); opts = opts || {}; if (opts.json) return claude.json(input, opts).then(function (v) { return { value: v }; }); return claude.sample(input, opts); },
    getStatus: function () {
      return Promise.all([authReady, verReady]).then(function () {
        var s = sec(), u = get('regis-usage', {}), m = new Date().toISOString().slice(0, 7), ae = get('regis-autherr', '');
        if (ae) set('regis-autherr', '');
        return { googleConfigured: !!(s.gClientId && s.gSecret), googleConnected: !!s.gRefresh, googleEmail: s.gEmail || '', anthropicKey: !!s.anthropicKey,
          usage: u.month === m ? u : { month: m, tokens: 0, calls: 0 }, canvasConnected: !!(s.cvHost && s.cvToken), canvasHost: (s.cvHost || '').replace(/^https?:\/\//, ''),
          openAtLogin: false, voice: false, web: true, version: loadedVersion, native: !!NATIVE, authError: ae, redirectUri: REDIRECT };
      });
    },
    saveGoogle: function (v) { var p = {}; if (v.clientId) p.gClientId = String(v.clientId).trim(); if (v.clientSecret) p.gSecret = String(v.clientSecret).trim(); setSec(p); return Promise.resolve(true); },
    connectGoogle: async function () {
      var s = sec(); if (!s.gClientId || !s.gSecret) throw err('needs_setup', 'Add your Google client ID and secret first.');
      var verifier = rand(32), state = (NATIVE ? 'n:' : 'w:') + rand(12);
      var challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      set('regis-pkce', { verifier: verifier, state: state, redirect: REDIRECT });
      var url = L.buildAuthUrl({ clientId: s.gClientId, redirectUri: REDIRECT, challenge: challenge, state: state });
      if (NATIVE) {                                          // iOS shell: system sign-in sheet, returns regis://auth?code=…
        return new Promise(function (res, rej) {
          window.__regisAuthResult = function (cb, e) { if (e) return rej(err('denied', 'Google sign-in was cancelled.')); finishAuth(new URL(cb).searchParams).then(res, rej); };
          NATIVE.postMessage({ type: 'auth', url: url });
        });
      }
      location.href = url; return new Promise(function () {});   // leaves the page; comes back to ?code=…
    },
    disconnectGoogle: function () { setSec({ gRefresh: '', gEmail: '' }); google.at = null; return Promise.resolve(true); },
    saveCanvas: async function (v) { var host = L.normHost(v.url), tk = String(v.token || '').trim(); if (!tk) throw err('no_token', 'Paste your Canvas access token.');
      var probe = new L.Canvas({ creds: function () { return { host: host, token: tk }; }, fetchFn: function () { return window.fetch.apply(window, arguments); } }); var who = await probe.whoami(); setSec({ cvHost: host, cvToken: tk }); return who; },
    removeCanvas: function () { setSec({ cvHost: '', cvToken: '' }); return Promise.resolve(true); },
    saveKey: function (k) { setSec({ anthropicKey: String(k || '').trim() }); return Promise.resolve(true); },
    setOpenAtLogin: function () { return Promise.resolve(true); },
    notify: function (title, body) {
      try { if (!('Notification' in window)) return Promise.resolve(false);
        var go = function () { try { new Notification(String(title || 'Regis').slice(0, 120), { body: String(body || '').slice(0, 240) }); } catch (_) {} return true; };
        if (Notification.permission === 'granted') return Promise.resolve(go());
        if (Notification.permission !== 'denied') return Notification.requestPermission().then(function (p) { return p === 'granted' ? go() : false; });
      } catch (_) {} return Promise.resolve(false); },
    snapshot: function (data) { set('regis-snap', data); if (NATIVE) { try { NATIVE.postMessage({ type: 'snapshot', data: data }); } catch (_) {} } return Promise.resolve(true); },
    openExternal: function (u) { window.open(u, '_blank', 'noopener'); return Promise.resolve(true); }
  };
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) { window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); }); }
})();
