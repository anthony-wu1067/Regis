# Regis: notes for Claude Code

Regis is the owner's personal command centre: mail, calendar, tasks, a built-in browser, and a Spotify player. It ships as an Electron desktop app, a web/PWA build on GitHub Pages, and a small iPhone shell. **One page, `desktop/page/regis.html`, is the whole interface** (about 900 KB of HTML, CSS and plain JS, no framework).

## Read these rules first
- The owner is not a developer. Explain what you changed and how to roll it out, in plain words.
- Build carefully, test everything you add, check security and performance, respect phone notches and safe areas, keep the UI Apple-like and uncluttered on iPhone.
- Every release: bump the version (`node scripts/set-version.js X.Y.Z`; it must increase, or devices ignore the update) and hand over **both** zips: `Regis-project.zip` (GitHub) and `Regis-app.zip` (desktop install). Keep version jumps small.
- Never reproduce song lyrics. Lyrics come from LRCLIB at runtime.

## Layout
- `desktop/` (Electron app): `main.js`, `preload.js`, `lib/` (browser, google, updater, store), `page/regis.html` (the UI), `renderer/shim.js`, `scripts/make-index.js` (builds `renderer/index.html` with the Electron CSP), `scripts/drm.js` (opt-in Widevine build).
- `web/`: `build.js` builds `web/dist` from `desktop/page/regis.html` (web CSP) plus `desktop-bundle.json`, the over-the-air update feed the desktop app downloads.
- `.github/workflows/release.yml`: on push to main it builds web + iOS and publishes GitHub Pages.
- `ios/`: Swift shell that loads the site.

## Build and test
- `cd desktop && node scripts/make-index.js` after editing the page.
- `cd desktop && npm test` (22 + 35 + 11), `cd web && node build.js && npm test` (17).
- Electron UI test: `xvfb-run -a node_modules/electron/dist/electron --no-sandbox test/browser.test.js` (53).
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

## Open problems
1. **In-app Spotify audio stops about 9 seconds in** (fixed in 1.7.7, not yet confirmed on the owner's machine). Cause: castlabs ECS ships only a development VMP signature (`electron.exe.sig`) and Spotify's licence server rejects it, so only the clear lead plays. `scripts/drm.js on|sign` now VMP-signs `node_modules/electron/dist` with castlabs EVS (`pip install castlabs-evs`, `python -m castlabs_evs.vmp sign-pkg`; one-time free EVS account, entered by the owner). Re-sign after every Electron reinstall. If it still fails, read the Playback report.
2. Phone layout was rebuilt in 1.7.6 (bottom tab bar). Only checked in simulated iPhone screenshots, not on a device.
3. Google sign-in in the built-in browser (1.7.7): Firefox identity on accounts.google.com only (`lib/browser.js` headers + per-navigation UA, `lib/bw-preload.js` hides `navigator.userAgentData`). Tested against the live sign-in page's fingerprint, not with a real account.

## Notes from 1.7.8
- Design layer: the block starting "1.7.8 · Regis HUD design layer" at the end of the CSS. It only uses skin tokens, so it works for all skins; tokens `--surf`, `--edge`, `--depth`, `--hud*`, `--rctl`. Tactical and liquid glass keep their own radius.
- Efficiency rules: animate only transform/opacity on HTML elements; no `backdrop-filter` on large surfaces (only with liquid glass); no animated shapes under blur; avoid rounded `overflow:hidden` around moving things. SVG CSS animations are paused and stepped by a 20 Hz driver (search "can't run on the graphics chip").
- `html.away` (window hidden/minimised, sent by main as `win:vis`) pauses every animation and sets idle.
- Perf numbers were measured with an Electron harness reading `app.getAppMetrics()` and CDP `Performance.getMetrics` per page.

## Notes from 1.7.7
- The page switcher `#vsw` is moved to `<body>` at start-up (`vswPin`) and is `position:fixed` on desktop; `bwLayout` measures it for the tab strip's right edge.
- Sidebar shortcuts live in localStorage `regis-bwside2` (`SB`: sites and folders). Bookmarks (`S.marks`, `S.mfold`) render only in the bookmarks bar `#bw-bm`; the folder menu `#bw-bmpop` hides the native tab view while open (listed in `bwOverlay`).
- Vault: `VT.key` = can fill/save, `VT.seen` = master password typed this session. The device key is stored by main (`vault:keyGet/keySet`, safeStorage only) and checked against `meta.kc` before use.
- Electron UI test now also checks the live Google sign-in fingerprint (52 checks; skips that part offline). On Windows run it with `node_modules/electron/dist/electron.exe test/browser.test.js`.
