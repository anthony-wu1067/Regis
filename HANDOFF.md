# Regis handoff (written 2026-11-10, updated for version 1.9.8)

Start a new session with: **"Read HANDOFF.md, then …your request…"**.
`CLAUDE.md` is loaded automatically in every session and holds the per-version technical notes, so this file does not repeat them. It covers the current state, how to release, how to test, what is still open, and the mistakes not to repeat.

## 1. What Regis is
The owner's personal command centre: mail, calendar, tasks, a built-in browser, Spotify, Office docking, chat apps (Comm), and AI teams. One page, `desktop/page/regis.html` (about 1.2 MB of HTML, CSS and plain JS in a single IIFE), runs in three shells:
- **Desktop:** Electron (castlabs build, for Spotify audio). `desktop/main.js`, `preload.js`, `lib/*`.
- **Web / PWA:** GitHub Pages, built by `web/build.js`. Also the over-the-air page update feed for the desktop app.
- **iPhone:** a small Swift shell in `ios/`.

The owner is not a developer. Explain in plain words, test everything, and never screenshot their real screen.

## 2. Current state
- **Version 1.9.7** is installed on the owner's PC and pushed to GitHub. **Version 1.9.8** (AI teams, Phase 2) is built in this folder with both zips in `release/`; it is **not installed or pushed** until the owner says so.
- Install source folder: `C:\Users\godsp\Downloads\Regis-app` (holds `node_modules` with the castlabs Electron; never delete it).
- User data: `%APPDATA%\Regis` (`regis-data.json`, `regis-secrets.json`, `regis-events.log` = crash log).
- Machine: Windows 11, i5-1335U, 12 GB RAM, Intel Iris Xe. Python is `py` (not `python`). `gh` is not installed.

### What exists (newest first)
| Version | What it added |
|---|---|
| 1.9.8 | AI teams Phase 2 (spec: the owner's "phase 2 implementation.pdf"): persistent tasks and run history in the app, usage reporting, one reusable team dashboard, named members with personas, soul.md upload, approval foundation, the Office tab in the left rail driven by real state; extension icons only when pinned |
| 1.9.7 | AI teams Phase 1 (see `AI_TEAM_ARCHITECTURE.md`): team model under the four leads, specialists, team memory, tool and workflow registries, deterministic local-first router for queued tasks, Claude ledger with hard per-task / per-team / global caps on every Claude path, team card on the dashboard |
| 1.9.6 | The base (five rooms, terrace, hallways, lift), the owner's own character pictures with blinks, walking and desk work, Luna renamed Alicia, rail icons, "/" on a new tab, no autoplay in reopened tabs, in-place "Add to Regis" on the Web Store |
| 1.9.5 | Team dashboards (KPIs, task queue, add-ins), the office with walking chibi team leads and furniture editing, team face icons, wall colour pickers, Calm wall renamed Waterwall, "/" from inside a web page, "Add to Regis" on the Chrome Web Store, shimmer fix, GPU-crash fix |
| 1.9.4 | Local AI through Ollama (Setup card, model download, Claude/Local per agent, fallback to Claude) |
| 1.9.3 | Installer survives leftover/stuck Regis processes; backgrounds rebuild themselves (heartbeat) |
| 1.9.2 | Blackwall dials: how often, sharpness, size |
| 1.9.1 | AI teams (Exusiai, Midas, Luna, Obsidian), Alt+Space overlay, camera/mic prompts, alert float window, tab-group drag and menu, downloads redesign, Google AI Mode fix, Spotify request budget |
| 1.9.0 | Calendar fix, iMessage via Phone Link in Comm, GPU reset recovery, crash log |
| 1.8.x | Comm page, Office docking, extensions, browser engine, Spotify library, presets, full screen |

## 3. Release procedure (every release)
Run from `C:\Users\godsp\Downloads\Regis-project`. Use Git Bash.

1. Edit `desktop/page/regis.html` (and `main.js`/`preload.js`/`lib/*` if needed).
2. If `main.js`, `preload.js` or `lib/*` changed: set `SHELL_NEED="X.Y.Z"` in the page (search `SHELL_NEED=`), so older installs see the "update the desktop app" bar.
3. `node scripts/set-version.js X.Y.Z` (must go up; keep jumps small).
4. `cd desktop && node scripts/make-index.js` then `cd ../web && node build.js`.
5. Tests (section 4).
6. Notes: add a `## X.Y.Z …` block to `README.md` (plain words) and a `## Notes from X.Y.Z` block to `CLAUDE.md` (technical). **Write these with a script file, never inside a bash heredoc or `node -e`: backticks get executed by the shell and mangle the text.**
7. `py tools/install.py` copies `desktop/` into `Downloads\Regis-app` (keeps its `node_modules` and Electron version) after backing the old copy up to `release/backup-installed-<old version>.zip`.
8. `py tools/zipit.py` builds `release/Regis-project.zip` and `release/Regis-app.zip`. Hand both to the owner.
9. **Install** (only when the owner says so; it closes their Regis): `cd /c/Users/godsp/Downloads/Regis-app && echo Y | node scripts/build-app.js --install`, then start `%LOCALAPPDATA%\Programs\Regis\Regis.exe` and check `resources\app\package.json` shows the new version.
10. **Push** only after the owner says "Yes, push it": `git add -A && git commit` (message ends with the `Co-Authored-By` line the session gives), `git push origin main`.
11. Check the build: poll `https://api.github.com/repos/anthony-wu1067/Regis/actions/runs?branch=main&per_page=1` until `status` is `completed`, then confirm `https://anthony-wu1067.github.io/Regis/version.json` shows the new version. If the Pages deploy step fails with "No artifacts named github-pages" it is GitHub's fault: push an empty commit to re-run (ask first).

`release/` is git-ignored. It holds about 18 old `backup-installed-*.zip` files of roughly 160 MB each (about 3 GB); old ones can be deleted if the owner wants the space.

## 4. Testing
The Electron engine lives in `Downloads\Regis-app\node_modules`. If `desktop/node_modules` is missing, link it (PowerShell): `cmd /c mklink /J "C:\Users\godsp\Downloads\Regis-project\desktop\node_modules" "C:\Users\godsp\Downloads\Regis-app\node_modules"`.

Run a UI suite with its output in a file (from `desktop/`):
```bash
timeout 420 node_modules/electron/dist/electron.exe ../tools/rt.js test/teams.test.js /path/to/log.txt; grep -E '^FAIL| passed' /path/to/log.txt
```
Suites and expected counts: `orch` 35, `guild` 36, `teams` 64, `localai` 16, `browser` 67, `tabs` 29, `browser-ui` 16, `comm` 18, `fullscreen` 11, `extensions` 21 (needs network), `youtube` 9, `spotify` 10, `music` 30 (slow, about 6 minutes; give it `timeout 900`), `office` 14 (opens desktop PowerPoint: skip unless needed). Unit tests: `cd desktop && npm test` (22 + 35 + 11 + 50 + 79). The web tests need Playwright, which is not installed.

Known test quirks:
- Each suite uses its own temp profile, so the owner's running Regis is not touched. Several suites can run one after another in the background.
- `browser.test.js` sometimes does not exit after printing its summary; the timeout ends it. Read the log, not the exit code.
- `browser.test.js` "hiding hands Regis a snapshot" currently fails on this laptop even with old code (graphics state); not a regression.
- One-off timing failures happen (a tab-drag check, the fake-camera "remembered" check). Rerun before investigating.
- Page functions are inside the IIFE: tests must click buttons or use `window.regisBridge.*`, never call page functions.
- Graphics crash test: `DESK=$(pwd) node_modules/electron/dist/electron.exe ../tools/rt.js ../tools/gpucrash.js log.txt` crashes the GPU process five times and prints the wall's brightness spread (`sd` near 3-4 means blank).
- Window-only captures (`win.webContents.capturePage()`) are fine. Never capture the whole screen.

## 5. Things the owner cares about
- Plain-language explanations, and being told what was and was not tested.
- "Yes, push it" before any push; "Yes, install it" before closing their Regis.
- Regis should feel fast: no forced layouts after page changes, animate only transform/opacity, pause animations when hidden.
- Characters: since 1.9.6 the four team leads and the rooms are **the owner's own pictures** (`tools/art/`, embedded by `py tools/art.py`). To change a look, replace the picture, re-measure the outlines in `CHB` and run the script.
- Shortcuts: Alt+Space = Regis overlay; "/" = overlay (address bar in the Browser, command bar on Workspace); Alt+1..9 = pages.

## 6. Open items (ask the owner which to do)
1. **Confirm on the real app:** background no longer vanishes after long browsing (the cause was repeated GPU process crashes, exit -1073740791, logged in `regis-events.log`; updating the Intel graphics driver may stop the crashes themselves); "Add to Regis" on a real Web Store page; real Ollama (only a fake was tested); Google sign-in with a real account.
2. **Connectors for the teams** (Jira, Shopify, etc.): not built. Add-ins are text instructions only. Each service needs its own connector and the owner's login.
3. **Screen sharing** in meetings (`setDisplayMediaRequestHandler`): not built; camera and microphone work.
4. **Home clock arrow alignment:** the owner reported it off-centre; every arrow measured centred. Needs a screenshot from them.
5. **Chibi polish:** the owner may want changes to a character's look, more furniture, or the chibis doing more (sitting on the sofa, getting coffee).
6. **CLAUDE.md is large** (loaded every session). To save tokens, the per-version "Notes from …" sections could move to a `docs/NOTES.md` that is read only when needed, keeping rules, layout, gotchas and open problems in `CLAUDE.md`. Not done; ask first.
7. Older open problems are in `CLAUDE.md` ("Open problems"): Spotify in-app audio unconfirmed, phone layout untested on a device.

## 7. Mistakes made this session (do not repeat)
- **Name clashes.** Short names collide in the single page: Comm's `.cm` hid the calendar; the office's `of-`/`OF`/`ofAct` broke the Word/Excel page. Before adding a class, id, global or function, grep the page for it. Current prefixes: `gd*`/`GD` agents, `tm*`/`TM` team dashboards, `gof*`/`GOF` chibi office, `chb*`/`CHB` chibis, `lai*`/`LAI` local AI, `cmx-` Comm, `of*`/`OF` and `ofd*` belong to Office.
- **Shell quoting.** Backslashes and backticks get lost in `node -e "…"` and heredocs (regexes lost their `\.`, notes were executed as commands). Put anything non-trivial in a script file made with the Write tool, or use the Edit tool.
- **Region patches.** When patching by index (`s[:a] + … + s[b:]`), check which marker comes first in the file; CSS is above the script.
- **Throttling Spotify** hurt more than it helped: waiting for a request budget delayed Play, froze lyrics and left long playlists on "Loading". Only the timed poll may be skipped.
- **Tampering with built-ins on every website** (`Function.prototype.toString`) tripped Google's bot check. Keep page-world injections to the pages that need them.
- **The owner's desktop app can silently stay old.** Check `%LOCALAPPDATA%\Programs\Regis\resources\app\package.json` when a fix "doesn't work"; the page updates over the air but `main.js`/`lib` only change on install.
- **Usage limits** cut sessions mid-task. Finish and package small pieces; say plainly what is done and what is not.
