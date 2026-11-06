# Regis: notes for Claude Code

Regis is the owner's personal command centre: mail, calendar, tasks, a built-in browser, and a Spotify player. It ships as an Electron desktop app, a web/PWA build on GitHub Pages, and a small iPhone shell. **One page, `desktop/page/regis.html`, is the whole interface** (about 900 KB of HTML, CSS and plain JS, no framework).

## Read these rules first
- The owner is not a developer. Explain what you changed and how to roll it out, in plain words.
- Build carefully, test everything you add, check security and performance, respect phone notches and safe areas, keep the UI Apple-like and uncluttered on iPhone.
- Every release: bump the version (`node scripts/set-version.js X.Y.Z`; it must increase, or devices ignore the update) and hand over **both** zips: `Regis-project.zip` (GitHub) and `Regis-app.zip` (desktop install). Keep version jumps small.
- Never reproduce song lyrics. Lyrics come from LRCLIB at runtime.

## Packaging
- `scripts/build-app.js [--install] [--no-sign]` makes `desktop/dist/Regis/Regis.exe` (engine from `node_modules/electron/dist`, app in `resources/app`, icon via rcedit) and with `--install` copies it to `%LOCALAPPDATA%\Programs\Regis` and rewrites the Desktop/Start-menu shortcuts. `Setup Regis.bat` and `Install Regis.bat` run it. userData stays `AppData\Roaming
egis`; localStorage for file:// is shared across folders, so settings carry over.
- Renaming/re-iconing the exe invalidates the VMP signature: `drm.js sign` signs `node_modules/electron/dist` and the installed `Regis.exe`.

## Layout
- `desktop/` (Electron app): `main.js`, `preload.js`, `lib/` (browser, google, updater, store), `page/regis.html` (the UI), `renderer/shim.js`, `scripts/make-index.js` (builds `renderer/index.html` with the Electron CSP), `scripts/drm.js` (opt-in Widevine build).
- `web/`: `build.js` builds `web/dist` from `desktop/page/regis.html` (web CSP) plus `desktop-bundle.json`, the over-the-air update feed the desktop app downloads.
- `.github/workflows/release.yml`: on push to main it builds web + iOS and publishes GitHub Pages.
- `ios/`: Swift shell that loads the site.

## Build and test
- `cd desktop && node scripts/make-index.js` after editing the page.
- `cd desktop && npm test` (22 + 35 + 11), `cd web && node build.js && npm test` (17).
- Electron UI tests: `xvfb-run -a node_modules/electron/dist/electron --no-sandbox test/browser.test.js` (51) and `test/spotify.test.js` (9, fake Spotify SDK + Web API via `protocol.handle`), `test/music.test.js` (30: library management, seek, lyrics timing, 300-row scroll smoothness, request rate, 429 handling, space bar), `test/browser-ui.test.js` (16: icons, address bar), `test/tabs.test.js` (26: tab drag/groups/menu, snapshot, find, downloads, Easy Files, history, suggestions, sleep, Alt shortcuts, Office, priority colours, in-app links). `test/browser.test.js` is now 67.
- jsdom suite lives outside the repo (`test/run.js`, about 510 checks) and may not be present.

## Gotchas
- Every `data-act` in the page must also be listed in the click router's `case` list near the end of the script, or the button does nothing.
- Page keys in Appearance are capitalised (`lookOpenPage("Music","Spotify")`).
- The desktop app loads a downloaded update from its data folder if newer than the built-in page. Only `main.js`/`preload.js`/`lib/*` changes need a reinstall.
- Spotify (2026 rules): playlist songs are `/playlists/{id}/items` (field `item`, max 50 per page) and are only readable for playlists the user owns or collaborates on. Folders are not in the API, so Regis keeps its own (localStorage `regis-sp-fold`).
- Widevine: stock Electron cannot play Spotify audio. `scripts/drm.js on` installs the castlabs Electron build (needs Git installed) and VMP-signs it; if the castlabs build is already there it only signs. `Setup Regis.bat` skips `npm install` when `node_modules/electron` is the castlabs build, or it would replace it.
- Over-the-air updates only replace the page. If a release changes `main.js`/`preload.js`/`lib/*`, bump `SHELL_NEED` in the page so the "update the desktop app" bar appears for older installs (`APP.getStatus().shell` is the installed app's version).
- The main script is one IIFE ending in `boot();
})();`. Add new code inside it, before `boot();`, or it can't see the page's functions.
- Don't name CSS custom properties `--rc` (it's the constellation mask image).
- The click router's variables are `act` (the action) and `b` (the button), not `a`. Library rows use `.sp-mv` for an absolutely placed button: don't reuse that class.
- Hover changes during scrolling forced a full layout per frame; the capture scroll listener adds `.scr` to the scrolling element (children get `pointer-events:none` for 150 ms). `content-visibility` on rows made it worse.

## Open problems
1. **In-app Spotify audio stops about 9 seconds in** (fixed in 1.7.7, not yet confirmed on the owner's machine). Cause: castlabs ECS ships only a development VMP signature (`electron.exe.sig`) and Spotify's licence server rejects it, so only the clear lead plays. `scripts/drm.js on|sign` now VMP-signs `node_modules/electron/dist` with castlabs EVS (`pip install castlabs-evs`, `python -m castlabs_evs.vmp sign-pkg`; one-time free EVS account, entered by the owner). Re-sign after every Electron reinstall. If it still fails, read the Playback report.
2. Phone layout was rebuilt in 1.7.6 (bottom tab bar). Only checked in simulated iPhone screenshots, not on a device.
3. Google sign-in in the built-in browser (since 1.7.9): plain Chrome UA everywhere plus a `window.chrome` surface (app, runtime, csi, loadTimes; functions report `[native code]`) injected by `lib/bw-preload.js` in the main world. Never call `wc.setUserAgent` during a navigation: it crashed Electron on the docs.google.com to accounts.google.com redirect (1.7.7/1.7.8). Not yet tested with a real account.

## Notes from 1.8.2
- Pages: `NAV.pages` (v, n, key, ic) is the registry; `navRender` builds `#vsw` and `#tabbar`; `NAV.hide` (localStorage `regis-navhide`) moves pages under ⋯. A new page needs a registry entry, a `.mview` section, `html[data-view=X]` show/hide rules (Office copies Music's top-bar rules), and an `applyView` hook. Alt+letter goes through `keyAction.views` in main (set by `APP.browser.viewKeys`).
- Engine (`lib/browser.js`): tab views stay attached and are shown with `setVisible`; `show(false, wantSnap)` returns a JPEG snapshot the page puts in `#bw-snap`. Sleeping tabs drop their WebContents (`sleep`, `_wake`, `_sleepIdle`, option `bwsleep`). New: move, duplicate, reopen (closed stack), mute, find (`found-in-page`), print, zoom, clearData, favicons via the tab session, history callback (main keeps `bwHistory`).
- `lib/downloads.js`: will-download saves to Downloads with free names; main exposes `dl:*`. Easy Files: `bw-preload.js` intercepts file-input clicks, main keeps one-time tokens (`filePend`) and only reads downloads it tracked or files picked in the system dialog. The page also intercepts its own file inputs (`efOpen`).
- Links: main forwards web links to the page (`app:link`) when `linkMode(true)`; the page opens them with `appGo`.
- Office: `office:recent` scans Documents/Downloads/Desktop/OneDrive (depth 3, max 6000 entries, newest 200); `office:open`/`office:show` only accept paths from the last scan. Deeper Microsoft 365 integration (OneDrive file list, editing, recent files) needs Microsoft Graph with an Azure app registration and sign-in; not built.

## Notes from 1.8.1
- Spotify rate limits: `spApi` checks `spHeld()` first (hold time from Retry-After, or 15 s doubling to 10 min; localStorage `regis-sp-hold`) and serves stale cache (`SPC`, `spCacheTtl`, persisted subset in `regis-sp-cache`) during holds or network errors. Writes mark related cache entries stale (`t=0`), never delete them. Polling: `spTick` every 5/15/30 s, never while `html.away` or hidden. `spFromSdk` builds `SP.st` from the SDK state.
- `test/music.test.js` (30) covers request counts (open 30 s, minimised 30 s), a 429 with restart, and the space bar.

## Notes from 1.8.0
- Music: `spLibAct` handles the library actions (`sp-tm` song menu, `sp-pnew/pledit/pldel/plfol/plunf/pllink`, `sp-fren`); playlist songs go through `spItems` (tries `/items`, falls back to `/tracks`); new playlists `POST /me/playlists` with a `/users/{id}/playlists` fallback. Forms use `data-sp-form`.
- Progress bar: `spBarLoop` (rAF while playing and visible). Lyrics: `spLyNext` schedules the exact next line change; lead is option `lyoff` (default 350 ms); poll position is anchored at the request midpoint.
- Icons: items carry `g` ("@key" into `BWI`), `c` (colour) and optional `img` (96 px PNG data URL); `icOpen({k:"sb"|"fav"|"mark",...})`. Site icons come from main (`app:favicon`, Google s2, images only).

## Notes from 1.7.9
- Spotify rescue: `spRescue` (first `playback_error`, or the 1 s stall watchdog on `getCurrentState`) pauses the SDK, transfers to another device with `play:true`, and sets localStorage `regis-sp-drmbad` keyed by the engine signature's mtime (`getStatus().drmSig`); `spPlay2` then avoids the Regis device.

## Notes from 1.7.8
- Design layer: the block starting "1.7.8 · Regis HUD design layer" at the end of the CSS. It only uses skin tokens, so it works for all skins; tokens `--surf`, `--edge`, `--depth`, `--hud*`, `--rctl`. Tactical and liquid glass keep their own radius.
- Efficiency rules: animate only transform/opacity on HTML elements; no `backdrop-filter` on large surfaces (only with liquid glass); no animated shapes under blur; avoid rounded `overflow:hidden` around moving things. Never animate parts inside an SVG: give the part its own SVG layer and animate the layer (`liftStatic`, `liftOver`, the home dial builder's `mk(..., "lift ...")`). Don't use `steps()` for motion (1.7.8 did; it looked laggy).
- `html.away` (window hidden/minimised, sent by main as `win:vis`) pauses every animation and sets idle.
- Perf numbers were measured with an Electron harness reading `app.getAppMetrics()` and CDP `Performance.getMetrics` per page.

## Notes from 1.7.7
- The page switcher `#vsw` is moved to `<body>` at start-up (`vswPin`) and is `position:fixed` on desktop; `bwLayout` measures it for the tab strip's right edge.
- Sidebar shortcuts live in localStorage `regis-bwside2` (`SB`: sites and folders). Bookmarks (`S.marks`, `S.mfold`) render only in the bookmarks bar `#bw-bm`; the folder menu `#bw-bmpop` hides the native tab view while open (listed in `bwOverlay`).
- Vault: `VT.key` = can fill/save, `VT.seen` = master password typed this session. The device key is stored by main (`vault:keyGet/keySet`, safeStorage only) and checked against `meta.kc` before use.
- Electron UI test now also checks the live Google sign-in fingerprint (52 checks; skips that part offline). On Windows run it with `node_modules/electron/dist/electron.exe test/browser.test.js`.
