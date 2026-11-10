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
- Electron UI tests: `xvfb-run -a node_modules/electron/dist/electron --no-sandbox test/browser.test.js` (51) and `test/spotify.test.js` (10, fake Spotify SDK + Web API via `protocol.handle`), `test/music.test.js` (30: library management, seek, lyrics timing, 300-row scroll smoothness, request rate, 429 handling, space bar), `test/browser-ui.test.js` (16: icons, address bar), `test/fullscreen.test.js` (11), `test/office.test.js` (14), `test/youtube.test.js` (9), `test/extensions.test.js` (18), `test/comm.test.js` (18), `test/tabs.test.js` (29: tab drag/groups/menu, snapshot, find, downloads, Easy Files, history, suggestions, sleep, Alt shortcuts, Office, priority colours, in-app links). `test/browser.test.js` is now 67. `test/guild.test.js` (36: agents with a fake Claude API, overlay, camera/mic prompt on a fake meet.test, alert float, tab-group drag and menu, address bar, pixel transition into the Browser). `test/guild.test.js` (36: agents with a fake Claude API, overlay, camera/mic prompt on a fake meet.test, alert float, tab-group drag and menu, address bar, pixel transition into the Browser).
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
3. Google sign-in in the built-in browser (since 1.7.9): plain Chrome UA everywhere plus a `window.chrome` surface (app, runtime, csi, loadTimes; functions report `[native code]`) injected by `lib/bw-preload.js` in the main world, only on accounts.google.com / accounts.youtube.com since 1.9.1. Never call `wc.setUserAgent` during a navigation: it crashed Electron on the docs.google.com to accounts.google.com redirect (1.7.7/1.7.8). Not yet tested with a real account.

## Notes from 1.9.1
- Guild: `lib/agents.js` (personas `AGENTS`, `systemFor`, class `Guild`). One table of rows `{id, context_scope, role, text, content, at}` (desktop: store meta `guild`; web: localStorage `regis-guild`); every read filters by `context_scope`. There is no SQLite in Regis. `Anthropic.sample` takes `opts.system` or `opts.agentId`. IPC `guild:agents/history/send/clear`. Page: `GD`, `gdInit`, `gdPick`, `gdSend`, `gdMd` (escape first, then a small Markdown subset; ```tasks blocks become an "Add to my tasks" card). `#app.gd-on` swaps the grid for `#gd-chat`, and `#cmd` sends to the open agent.
- Overlay: `OVERLAY_KEYS` in main (Alt+Space, then Ctrl+Alt+Space) -> `app:overlay` -> page `ovOpen` (`#rov`, built at start-up, listed in `bwOverlay` and the overlay observers). "/" opens it on every page except Workspace (in the Browser, "/" still focuses the address bar).
- Camera/mic: `BrowserHost._askMedia` -> `onPerm` -> page `#bw-perm` bar -> `browser:permAnswer`. Saved answers are in store meta `bwPerms` `{host:{audio,video}}`. The check handler says yes unless the site is blocked (meeting sites query first). Screen sharing (`setDisplayMediaRequestHandler`) is not built.
- Alerts over native views: `lib/alert-float.js` (a transparent child window, text only, actions join/show/snooze/dismiss -> `alert:act`). Page: `AF`, `afOn` (views in `FXNAT`), `afSync` on every view change.
- Backgrounds: the worker's `raf` has a 400 ms timer fallback (worker rAF can stop for good). `cfg().run` is false on `FXNAT` views. `sync` sends `{heal:true}` after more than 20 s on a native page or more than 60 s hidden. Blackwall shader uniform `uM` (0 Blackwall shards, 1 Calm wall ripples). Background/skin/preset key `tide`.
- Browser pixel transition: `setView` sets `BW.pxHold` (bwSync keeps the native view hidden), shows `BW.lastSnap` (captured when leaving the Browser, only when `pxOK()`), and runs `pxRun("in")`.
- Spotify: `spApi` dedupes in-flight GETs (`SPB.fly`), with a token budget `spTok` (14 burst, 1 per 2.5 s). Only the timed poll (`spTick` -> `spPoll(1)` -> spApi 5th argument `bg`) is ever skipped, and only below 1 token (the count never goes below 0); polls after an action are never skipped, and /me/player is never shared between callers (its answer anchors the lyric clock); nothing else ever waits. Stricter versions broke Play and Up next (spotify.test, stale state) and made long playlists sit on Loading (music.test).
- Shimmer: `html.bal` disabled it; `greetShim()` adds `#greet.shim1` (one 4.2 s sweep) on entering Workspace.
- `bw-preload.js` injects the `window.chrome` surface only on accounts.google.com/youtube.com. Overriding `Function.prototype.toString` on every page sent Google Search to /sorry (bot check) and broke AI Mode input. Checked by A/B with a fresh profile.
- Test: `test/guild.test.js` (fake Claude API by patching `globalThis.fetch` before `main.js` loads; fake meet.test with `use-fake-device-for-media-stream`).

## Notes from 1.9.0
- Class names: the calendar month grid uses `.cm`, `.cm-h`, `.cm-g`. Comm uses `cmx-*` (section `.cmx`, ids `#cmx-stage` etc., `data-cmx-form`). Search the CSS for a name before adding a short one.
- Graphics resets: main listens to `child-process-gone` (type GPU) -> `app:gpuReset` -> page `APP.onGpuReset` -> worker `{heal:true}` -> `healed()` (rebuilds Cosmos with `coBuild`, scenes, WebGL). The canvas `contextrestored` events never fired for the worker canvases. `<userData>/regis-events.log` records child-process crashes.
- Phone Link: a second `OfficeDock` (`plDock`, kinds `['phonelink']`) docks the Phone Link window (class WinUIDesktopWin32WindowClass in PhoneExperienceHost; `KindOf` in `office-dock.ps1`). Comm app `{native:'phonelink'}` has no web view; the page calls `APP.comm.native(on, rect)` (`cmPl`). An already-open Phone Link window is adopted while `expect` is set. `comm:plState` returns the dock state (and the helper's window list) for debugging.

## Notes from 1.8.9
- Comm: `lib/comm.js` (`CommHost`): one WebContentsView per app, session `persist:comm-<id>` (Chrome UA, notifications allowed unless muted, audio muted when muted), unread from the title (`unreadOf`). Apps in store meta `comm`. Background apps start 6 s after launch, staggered. Pop-out = a frameless child BrowserWindow (`comm-float.html` + `comm-float-preload.js`, `cmf:act`); the app's view moves between the main window and the float (`_put`/`_detach`); hidden while that app is open on the Comm page. Page: `CM`, `cmInit` (at boot, for unread and overlays), `cmEnter`/`cmLeave`, `cmAct`, presets `CMP`. Test: `test/comm.test.js` (18, fake https://chat.test via `session-created` + `protocol.handle`).
- Scrolling: never set inherited custom properties on `<html>` per frame (`--sp` re-styled the whole page on every scroll step; it now goes on `.sbar` and `.bg`). `.mdl` has no backdrop blur.
- Browser: `open(url, bg)` (background tabs after the opener; `background-tab` disposition and the "Open link in new tab" menu). `restore` loads only the first tab; the rest are asleep with saved titles (`bwTabs` is now `[{u,t}]`). The page shows the last tab strip from localStorage `regis-bwcache` at once and no longer waits 440 ms before showing the page. Tab input calls `onActive` -> `win:vis` so Regis doesn't go idle while you browse.
- Alt + 1..9 = `navOrder()` (Nav order, then pages under ⋯); `keyAction` returns `view-N`.
- Backgrounds: `fxCore` listens for `contextrestored` / `webglcontextrestored` and rebuilds (`healed`).
- Appearance groups are `<details>` again; closed ones in localStorage `regis-lkclosed`.

## Notes from 1.8.8
- Blackwall: WebGL point grid on its own canvas `#bwgl` (transferred to the worker with the others; `gcv`). `glOK` compiles `VS`/`FS`; `glGrid` builds the pin grid (spacing 7-11 px); `glDraw` animates 8 bulges (`bwBulge`, one rolling wave `bwRoll`) passed as `uB`/`uC` uniforms; the vertex shader evaluates the field three times for a normal (lighting), pushes pins outward from the centre, and does glitch bands (`uGl`, `uGs`), flicker blocks (`uBk`) and the scan line (`uScan`). Colour split during glitches = two passes with `colorMask` and `uOff`. `#fx` above it only draws the drifting code. No rain.
- Page change: `setView` runs `pxRun("in", ...)` again (content area only: the canvas starts 44 px down on desktop). `viewAnim`/`#vscan` are unused.
- Cosmos checked from a fresh start, after presets, and in Lite/Balanced/Full: it draws.

## Notes from 1.8.7
- Never read layout (offsetWidth, getBoundingClientRect) right after switching views: `navCur` did, forcing a full style+layout (~65 ms) on every page change. Find these with a trace that includes `disabled-by-default-devtools.timeline.stack` and group Layout/UpdateLayoutTree by `beginData.stackTrace`.
- Don't toggle classes on `<html>` for short effects: it restyles the whole document (~50 ms). `viewAnim` puts `.vin`/`.vb` on the `#app` sections and `#vscan` (the sweep line), two rAFs after the switch.
- Home dial: only `#hm-dial` has the d3 drop-shadow; shadows on the other lifted layers made ~13 render passes a frame.
- Blackwall: pixel wall rendered into a quarter-size buffer (`SC.R/G/B` additive, fade for trails, `putImageData`, `drawImage` with smoothing off, `lighter`). AIs are moving gaussian bulges (`SC.ai`), torn pixels `SC.fly`, rain `SC.rain`, code `SC.cb`.

## Notes from 1.8.6
- Page changes: `pxRun` (full-window pixel dissolve) is no longer used by `setView`; it covered the top bar too and read as the app blanking. `setView` applies the view, then adds `html.vin` (+`vback`) for a 0.26 s content-only `viewIn`. The Browser gets no animation (`.bw-main` fade removed). `blank.js`-style check: film the window with desktopCapturer and flag frames with almost no luminance spread.
- Video full screen (`lib/browser.js`): `enter-html-full-screen` remembers whether the window was already full screen (`vfs.was`), makes it full screen and sizes the tab view to the whole content area (`_vfsFit`, also from `setBounds`/`_attach` while `vfs`); `leave-html-full-screen` restores the stage bounds and only leaves full screen if it wasn't before. `test/fullscreen.test.js` is 11.
- Nav: `#nav-btn` (made by `navBtnInit`, after `vswPin`) toggles `html.navx`; `#vsw` is hidden unless `navx` and sits left of the button (`--navw`). `bwLayout` measures `#nav-btn`. Alt+letter is unaffected.
- Appearance: `lookPages` now builds category tabs (`LKC`, `.lk-cats`, `.lk-cat`, `lookCat`, localStorage `regis-lkcat`); groups are always open. `lookGroups` keeps every section (it used to drop anything not in its `oo` list) and reads headings inside `.lk-h2` too. TV mode lives in Appearance (group "TV"); `hm-foot` and the `hfoot` option are gone.
- Tabs CSS: the "1.8.6 holographic tab strip" block (scoped `html #bw-tabs ...`).
- Blackwall scene: tendrils (`SC.td`, chain-following points, lunges, spikes) and typing code blocks (`bwCode`, `BWC`).
- Spotify repeat: `spRepUi` shows off / all / one (`#sp-rp.one`); the toggle updates `SP.st.repeat_state` at once.

## Notes from 1.8.5
- Extensions: `lib/extensions.js` (`Extensions`). Web Store installs download the CRX from `clients2.google.com/service/update2/crx`, strip the CRX header (`crxZip`), unzip with the built-in mini unzip, and put the CRX3 public key into `manifest.key` (`crxKey`) so the id matches the store. Stored in `<userData>/extensions/<id>` with `list.json`; loaded with `session.extensions.loadExtension` into the browser partition before tabs restore (`browser:state` awaits `extReady`). `activeTab` extensions get `<all_urls>` (Electron never grants activeTab). A generated session preload (`_regis-ext-preload.js`, frame + service-worker) adds `SHIM` stand-ins (action, contextMenus, alarms, notifications, fontSettings, extension.isAllowed*, tabs.create/windows.create -> Regis, tabs.query/get -> Regis's tabs via `ext:tabs`). Service workers have no `location` in the preload realm: the preload asks the worker with `executeInMainWorld`. Only chrome-extension:// senders get tab info. Popup = frameless child BrowserWindow under the toolbar icon (`ext:popup`), options = own window. Test: `test/extensions.test.js` (18, needs network).
- YouTube: `ytClean` in `lib/bw-preload.js` (main world, youtube.com only, Shield on via `bw:shieldOn` sendSync) prunes adPlacements/playerAds/adSlots in JSON.parse, Response.json and ytInitial*, hides ad boxes, mutes/skips `.ad-showing`. Sandboxed preloads can't require local files, so it's inline. Test: `test/youtube.test.js` (9, fake youtube.com via `protocol.handle`).
- Office: docking keeps WS_CAPTION (without it Office shows its full-screen look: no ribbon, no title row); the scan re-places docked windows. `hid` tracks windows Regis hid, so a window the app hid itself (PowerPoint keeps its frame after the last file closes) is released (`Forget`). `quitIdle` quits an app with no open files after its last docked file closes. `test/office.test.js` (14) defaults to PowerPoint (`OFFICE_APP`), skips an app that is already running, and checks the ribbon through COM when `SNAP` points at a ribbon script.
- Presets: skins `cyber`, `blackwall`, `holo` plus scene backgrounds of the same names drawn by `fxCore` (`scInit`/`scDraw`, `SCN`). `applyPreset` sets both and switches Lite to Balanced. Appearance groups sections by their heading (`lookGroups` map), so a new section heading must be in that map or it disappears.
- Spotify: `spQClean` drops leading queue entries equal to the playing song; `spQNext` asks again while `currently_playing` is stale.

## Notes from 1.8.4
- Office dock: `lib/office.js` (`OfficeDock`) drives `lib/office-dock.ps1`, a long-lived PowerShell helper (Add-Type C#, one JSON line per command). Docking = strip caption/frame, WS_EX_TOOLWINDOW, owner = the Regis HWND (not WS_CHILD), then SetWindowPos over the page's `#ofd-stage` (page sends bounds; main converts with `dipToScreenRect`). Only window classes OpusApp/XLMAIN/PPTFrameClass are touched. New documents use COM (`Word.Application` etc.); files open via `shell.openPath` and are adopted when a new window of that app appears within 45 s (`expect`) or comes from an already-docked process. `before-quit` undocks everything first; `rescue` restores frameless Office windows left by a crash. Docked windows are hidden whenever the Office view isn't shown or a Regis overlay is open (`ofdSync`, called from `bwSync` and view changes). Test: `test/office.test.js` (13, needs desktop Excel; skips otherwise). Never take full-screen captures in tests: the owner's own screen ends up in them.
- Backgrounds: `fxCore` renders aurora and cosmos in a Worker with OffscreenCanvas (`initFx`; falls back to the page if OffscreenCanvas is missing). Paced by setTimeout then rAF; a bare rAF loop that skips frames still costs a full style recalc each frame.
- Leaving the Browser or Office hides the native view first (`setView` waits for `show(false,false)` or `ofdSync`, max 250 ms) so a white site can't flash over the next page. `browserLeave` no longer captures a snapshot.
- Tabs: pointer-driven drag (`TD`, `bwTabsSet` with FLIP, `bwTabsFit` adds `.nar` below 92 px). Clicks on tabs are swallowed (press selects); keyboard clicks (`detail===0`) still go through the router.

## Notes from 1.8.3
- Full screen: the shim must pass `fullscreen`, `fsState` and `onFullscreen` to the page (it didn't, so the button used HTML full screen). F11 is `keyAction` 'fullscreen' inside tabs; `BrowserHost.show(false)` refocuses the main webContents so a hidden tab never keeps the keyboard. `test/fullscreen.test.js` (11).
- The 300-row scroll check in `test/music.test.js` fails when another Regis is running on the same machine (the unchanged 1.8.2 page failed the same way); close Regis before running it.

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
