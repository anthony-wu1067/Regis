# Regis — all your devices, one project

This folder builds Regis for **desktop (Windows/Mac/Linux)**, the **web / iPhone / iPad (installable web app)** and a native **iPhone/iPad app with widgets** (installed through AltStore). Everything syncs through one private file in **your own Google Drive**, and updates reach every device without reinstalling.

```
desktop/   Electron app (what you already have) + sync + updater
web/       builds the website: web app, desktop update bundle, AltStore source
ios/       Swift app + widgets (XcodeGen project)
.github/   workflow that builds the .ipa and publishes the site  ← the part you click
```

## How it fits together
- **GitHub does the building.** An .ipa can only be compiled on a Mac. You don't need one: a free GitHub account runs the build on GitHub's Macs. You push this folder once and click "Run workflow".
- **Your site is the update channel.** The workflow publishes `https://YOURNAME.github.io/REPO/`: the web app, a feed the desktop app reads, and the AltStore source. The iPhone/iPad app is a shell that opens that site, so changing the site updates every device.
- **Drive is the sync.** Each device keeps its own copy and merges changes through `Regis sync (do not delete).json` in your Drive. Your data goes to no server of mine or anyone else's.

---
## Part 1 — Put it on GitHub (once, ~10 min)
1. Create a free GitHub account if you don't have one. Create a **new public repository** named `regis`. (Public is required for free Pages hosting. The repo holds only code. Your Google secrets and data are never in it.)
2. Upload this folder's contents to it (on the repo page: **Add file → Upload files**, drag everything in, **Commit**; or use `git`).
3. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Repo **Actions** tab → **Build Regis** → **Run workflow**. Takes ~10 minutes. If it turns red, open the failed step and send me the last 30 lines of its log.
5. When green: your site is `https://YOURNAME.github.io/regis/` (also shown in the workflow summary), and **Releases** has `Regis.ipa`.

## Part 2 — Google sign-in for the web / iPhone / iPad (once, ~5 min)
Your existing "Desktop app" credentials keep working on the computer. Browsers and phones need a second, **Web application** credential in the same Google project:
1. console.cloud.google.com → your Regis project → **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
2. **Authorized redirect URIs → Add URI**: `https://YOURNAME.github.io/regis/callback.html` (exactly; Regis' Setup panel also shows it).
3. Copy the Client ID and secret. You'll paste them into Regis on each phone/tablet/browser (stored only on that device).
4. The consent screen should already be **In production** (see desktop README) or sign-in expires every 7 days.

## Part 3 — iPhone & iPad
**Quickest, no AltStore: the installable web app.** In Safari open your site → Share → **Add to Home Screen**. It works offline, syncs, and updates itself. It cannot show home-screen widgets.

**Native app with widgets via AltStore:**
1. Install **AltServer** on your Windows PC or Mac (altstore.io), plug in the iPhone/iPad once, and install **AltStore** to it. Enable Developer Mode on the device (Settings → Privacy & Security).
2. Easiest: on the iPhone/iPad open AltStore → **Browse → Sources → +** and paste `https://YOURNAME.github.io/regis/altstore.json`, then install **Regis**. Alternative: download `Regis.ipa` from the GitHub Release, AltStore → **My Apps → +** → pick it.
3. Open Regis → **Setup**: paste the **Web application** client ID/secret → **Save & connect Google** (a system sign-in sheet opens) → add your Anthropic key if you want AI features → turn on **Sync across my devices**.
4. **Widgets:** long-press the Home Screen → **+** → Regis → pick *Next up*, *To-dos* or *At a glance* (also Lock Screen on iOS 16+).

Free Apple ID limits (Apple's, not Regis'): apps expire after **7 days** unless AltStore refreshes them (it does so automatically when AltServer's computer is on the same Wi-Fi), at most **3 sideloaded apps** at a time, and Regis uses **2 of your 10 weekly App IDs** (app + widget). A paid developer account removes these limits.

## Part 4 — Sync
Open **Setup → Sync across my devices** on every device, signed in to the same Google account, and tick it on. First sync merges what's already on each device (nothing is overwritten). After that changes appear on other devices in about a minute (immediately on "Sync now" or when you reopen the app).
- **Synced:** to-dos, rules, habits, Drive filing rules, outbox, settings (including calendar colors/order).
- **Not synced (by design):** the activity log, sign-in tokens, Anthropic key, Canvas token, and local look-and-feel choices stored in the browser (theme, font, background).
- **Conflicts:** per field, newest edit wins. Editing different fields of the same to-do on two devices keeps both.
- **Scheduled emails** fire only on the device that scheduled them, so you never get duplicates. That device must be on and open at the time.
- **Autopilot** runs per device. If you turn it on in two places, both may act on new mail; keep it on one device.

## Part 5 — Updates (no reinstalling)
| Where | How it updates |
|---|---|
| Web app / Home-Screen app | Fetches the newest site every time it opens online; shows a "Reload now" bar. |
| iPhone/iPad app (AltStore) | The shell loads your site, so interface changes arrive automatically. A new .ipa is only needed when `ios/` changes; AltStore notifies you through the source. |
| Desktop app | Setup → **Updates** → paste your site address once. It downloads new versions (checked every 6 h and at launch), verifies them with SHA-256 and shows "Reload now". If a download is corrupt it silently keeps the old version. Only changes to `main.js`/`preload.js` need a new install. |

**To ship a change:** replace `desktop/page/regis.html` with the new page (each time I give you a new Regis version), then change the version number (`node scripts/set-version.js 1.0.1`, or edit the file `VERSION` and the `version` in `desktop/package.json` by hand), commit and push to `main`. The workflow rebuilds everything (~10 min). Bump the number every time, otherwise devices think nothing changed.

## What I could not test here (please read)
- **The Swift app, widgets and the GitHub workflow were never compiled or run** because the environment I work in has no Xcode or Mac. I reviewed them carefully and everything else (sync engine, web app in real Chromium on iPhone/iPad sizes, desktop app, updater) is tested, but expect the first workflow run to possibly need a fix. Paste me any red error and I'll correct it.
- AltStore's handling of the widget's shared storage (App Groups) relies on AltStore's `ALTAppGroups` support. If widgets stay empty after you've opened the app once, tell me.
- Widgets show what Regis last saw when you opened the app (the app can't run in the background); they roll forward by themselves between events and say "Open Regis to refresh" if data is old.
- Inside the iPhone app, Regis needs a network connection to launch (the Home-Screen web app works offline). Notifications, microphone dictation and the mini/corner mode are desktop-only.
- The **Claude.ai artifact version** of Regis stores data inside Claude and is not part of this sync. Use the desktop/web/iPhone apps for synced data.

## Developing
`cd desktop && npm install && npm test` (desktop + sync + runtime tests) · `cd web && npm install && node build.js && node test/e2e.js` (needs Playwright's Chromium) · the page tests live with the page source.
