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


## 1.4 features
- **Views**: Home (executive dial), Workspace, Browser. Keys H / W / T (TV).
- **TV mode**: Home view -> TV button, or open the web app with `?tv=1`. Cast the browser tab / screen via Chromecast, AirPlay or HDMI; Esc exits.
- **.ics import**: Calendar -> Import .ics, name + colour. Pencil icon renames/removes.
- **Idle pause**: Appearance -> Performance. Animations pause after N idle minutes.
- **Browser** (desktop app only): own tab strip, shield counter, Google sign-in persisted. Needs the desktop installer re-run once (main.js/preload.js changed).

## 1.5 customisation
Appearance now has Home screen, Home clock, Browser, Layout & density, Panels & chrome, Colour & glow, Time & format, Motion & effects and Phone sections, plus a search box and "Reset customisations". Settings are stored on the device (`regis-opts`).

## 1.6 look, Vault and browser
- **Look**: Appearance → Panels & chrome has *Design style* (Refined is the quieter default, Expressive keeps the neon), *Depth* (Layered 3D or Flat), *Depth strength*, *Tilt on hover*, and the Regis constellation switches and brightness.
- **Vault** (Connect & Setup → Vault, or the Vault button in the header): logins and private notes encrypted in the page with a key made from your master password (PBKDF2 250,000 rounds, then AES-GCM). Only scrambled text is saved to the synced `vault` collection. The master password is never stored; if it is forgotten the Vault cannot be recovered. Auto-lock time is in Appearance → Vault & privacy.
- **Browser (desktop app)**: signing in to a site offers to save it; matching sign-in pages fill from the unlocked Vault. Bookmarks can live in folders; tabs can be grouped (the ⊞ on a tab) and collapsed. Sidebar names are off by default, hover shows them.
- Updating the desktop app: install `Regis-app.zip` once, because `main.js`, `preload.js` and the new `lib/bw-preload.js` changed.

## 1.7.5 (continued) Lyrics card and Spotify audio inside Regis

- **Lyrics** now live in a small card in the right-hand column of Music (five lines, the current one highlighted). The expand button (or the lyrics button in the player bar) opens the full lyrics page in the main pane, time-synced; click a line to jump there. On phones the player bar button opens that page directly.
- **Copy-protected audio on desktop.** Standard Electron has no Widevine, so Regis could only remote-control other Spotify devices. To let Regis play audio itself, double-click `Enable Spotify audio` (.bat on Windows, .command on Mac) in the Regis app folder, with Regis closed. It installs the castlabs build of Electron, which includes Widevine. Restart Regis, then pick "Regis" in the Music device menu. `Disable Spotify audio` goes back. Reinstall Regis-app.zip once for this release (shell files changed).
- Caveat: that build is development-signed. Widevine and Spotify acceptance depend on your machine and could not be tested in the build environment.
- The web/PWA version already plays audio through the Spotify Web Player in the browser.

## 1.7.5 Music upgrade, Home fit, header
- Music search: typing shows a Spotify-style suggestion list (words, songs, artists, albums, playlists) with arrow-key navigation. The page only changes when you press Enter or pick a result.
- Lyrics (free, from LRCLIB): player bar and Now Playing have a Lyrics button; synced lines highlight as the song plays and you can click a line to jump there. Songs without lyrics say so.
- Playlists: all of them load now (not just the first 50). Spotify's API doesn't expose your folders, so Regis has its own: the folder icon in Your Library makes one and the ⋯ on a playlist moves it in. They are saved on this device.
- Audio: on the web the Regis web player now starts by itself and becomes your speaker when nothing else is playing. The desktop app cannot play audio itself (it controls Spotify on another device; the device button shows which). The bar shows the current device.
- Music has its own Appearance button, plus "Tint from artwork" and "Compact lists" switches. Cleaner depth: artwork-tinted glow, glowing section markers, lifted cards, slimmer seek/volume bars.
- Header: Alerts now sits next to Daily brief. The More menu no longer has it.
- Home: no scrolling, the dial fits the window, and the boxes around the hour/minute/second numbers are gone.
- Browser: the view switcher's Home button is no longer clipped by the tab strip.

## 1.7.4 No focus glow on text boxes
Typing boxes (address bar, search, forms, command bar) no longer get a glowing ring or colour change when focused. Buttons keep their keyboard focus ring. Page-only change.

## 1.7.3 Browser tabs no longer dark
The slim header was drawn on top of the tab strip and tinted every tab with a dark film. The header now sits underneath, and tabs, the + button and the strip have lighter surfaces with clearer text. Page-only change; no reinstall.

## 1.7.2 Music fills the whole page
The Music page now works like the Browser page: it takes the full window under the slim header, laid out like Spotify. Left: Home and Search, and Your Library (Playlists / Albums / Artists chips, a filter box, Liked Songs pinned). Centre: back and forward buttons, a global search bar, quick tiles on Home, Show all on each shelf, a Top result card in search, genre tiles, and big headers with a sticky song table. Right: a Now playing panel with the next song (toggle it from the player bar). The player bar is docked along the bottom. On a phone the library collapses into a nav strip. No new setup: your Client ID and sign-in stay as they were. Only the page changes, so the web and desktop update from GitHub; the desktop app needs no reinstall for this release.

## 1.7.1 Spotify, grouped Appearance, browser favourites
Music page is now a full Spotify client (Home, Search, Liked Songs, Library, Queue, playlists, albums, artists, now-playing bar, devices). Setup: developer.spotify.com/dashboard, Create app, add redirect URIs `http://127.0.0.1:8888/callback` (desktop app) and your web address (web/phone, shown on the Music page), tick Web API and Web Playback SDK, copy the Client ID into Music, press Connect Spotify. Premium needed for playback. Chat page removed. Appearance is grouped under Misc, Home, Workspace, Music, Browser (More menu, Reorder pages). Browser: editable favourites and sidebar sites, centred icons, // Regis clock back, background options with depth. Desktop app needs reinstalling (new Spotify sign-in code).

## 1.7 Apple-style browser, liquid glass everywhere, one-colour clock
Browser (Refined look): squircle sidebar icons, Safari-style tab capsules, a centred address field, frosted toolbar, and a start page with app-icon Favourites. Liquid glass now frosts every surface (panels, cards, browser, bars, menus, buttons). Clock: one colour for arcs, star web (three depth shades) and pointer; hour is white; new options Clock colour, Spin the arcs and Arc spin time. Appearance header tidied. Also: "Done today" can be hidden, finished subtasks can be hidden, Steps are now Subtasks, and Spotify and Discord are quick sites in the Browser. Updating from 1.6.1: install Regis-app.zip once (desktop shell files changed), upload the project zip, reload.

## Also in this release: pixel transitions, living tiles, Apple-style polish
Home → Workspace → Browser now dissolve in as pixel blocks; going back, the view you leave breaks up first. New switches (Appearance): Pixel transitions, Mouse tracking (parallax/tilt/light), Clock gleam. The minutes ring on the revolver clock spins the opposite way. Workspace tiles have slab edges, hover lift, tilt and a pointer-following highlight. Status words are back beside Regis. Web/phone: reload only. Desktop: no reinstall needed (no shell files changed).

## Also in this release: clean header, holographic depth, Vault recovery
- Header: Daily brief and Appearance first, then Full screen (F11) and a More menu (Quick capture, Alerts, Refresh, Vault, Connect & Setup). The Mini button is gone; mini mode is still on the tray menu and Ctrl+Shift+M.
- Browser: Ctrl+T / Ctrl+W / Ctrl+L / Ctrl+R / Ctrl+D / Ctrl+Tab, Ctrl +/- zoom, a right-click menu, and a friendly page when a site can't be reached. Passwords only fill on https pages.
- Vault recovery: a random data key is locked by your password and again by a recovery code. The code is emailed (via Gmail) to the recovery address when you create the Vault; "Forgot password?" uses it to set a new password. Regis never stores the code or the password.
- Depth: Appearance → Panels & chrome → Depth now has Holographic (default), Layered (the 1.6 look) and Flat.
- Phone: the screen is pinned horizontally, and the browser view stays below the notch.
- Updating the desktop app: install `Regis-app.zip` once (main.js and preload.js changed).
