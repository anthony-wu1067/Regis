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

## 1.7.8 HUD redesign, efficiency, and making 1.7.7's fixes actually land

- **Why 1.7.7 didn't seem to work:** the page updated over the air, but the desktop app itself was still 1.7.6, so the Google fix and the new "Enable Spotify audio" never ran. Regis now shows a bar when the installed desktop app is older than the page, with the steps to update it.
- **Setup Regis keeps the Spotify audio engine.** Before, unzipping a new version and running Setup quietly replaced it with the standard engine. *Enable Spotify audio* also skips the 100 MB download when the engine is already there and goes straight to signing.
- **Google sign-in, stronger:** on Google's sign-in pages Regis now also hides Chrome-only traces (`window.chrome`, Chrome's vendor string), so it matches real Firefox throughout.
- **New look (every page, every colour skin):** one shape and size scale for panels, buttons, fields and tabs; layered depth with a lit top edge and HUD corner marks; panel headers whose rule draws itself in; panels and cards glide in when a page opens; a light runs along a panel's edge on hover; a hairline "system rail" with a travelling light; a slow scan of light over the background; pop-in dialogs and drop-down menus; matching scrollbars and focus rings. Reduced-motion and Lite are respected.
- **Lighter on the computer** (measured in the app): in Full mode Home went from 47 to 59 fps with half the graphics load, Workspace's graphics load dropped from 15% to 5%, Music from 13% to 3%. In Balanced, Home's main-thread work roughly halved. The biggest wins: background glows that only move instead of re-blurring every frame, no live glass blur behind 30 panels, the clock's sweep no longer forcing the dial to redraw, the dial and satellite rings stepped 5-20 times a second instead of 60, and batched star fields.
- **Pauses when minimised or in the tray.** The desktop app keeps running in the background (for Spotify), which also kept every animation running. Now everything stops while the window is hidden.
- Updating: install `Regis-app.zip` once (the desktop app files changed), then run `Enable Spotify audio`.

## 1.7.7 Spotify audio signing, Google sign-in, bookmarks bar, Vault autofill

- **Spotify audio stopping after ~9 seconds: fixed at the cause.** The castlabs Widevine build only carries a *development* signature, and Spotify's licence server refuses it: you hear the few unencrypted seconds at the start of a song, then silence, glitchy seeking and "Playback error" on several songs. `Enable Spotify audio` now also **VMP-signs** Regis with castlabs' free EVS service. First run: it installs the castlabs signing tool (needs Python 3) and asks you to create or sign in to a free castlabs EVS account in that window, then signs and verifies. Run it again after any reinstall (or `npm run drm:sign`).
- **Google sign-in in the Browser works.** Google blocked it as an "insecure browser" because it saw a Chrome identity whose hints didn't list Google Chrome. On Google's sign-in pages only, Regis now presents itself as Firefox (matching headers and page script). Every other site still sees normal Chrome.
- **Bookmarks bar** under the address bar, like Chrome or Opera GX. Folders open a menu (open one, open all, edit). Bookmarks that don't fit go under ». Turn it off in Appearance → Browser → Bookmarks bar.
- **Sidebar shortcuts are their own thing.** The Edit button at the bottom of the sidebar opens *Sidebar shortcuts*: add any site (it fills in the page you're on), quick-add favourites, reorder, and make **folders** that open and close in the sidebar like a drawer.
- **Vault fills and saves without your master password** in the desktop app. After you unlock once on a computer, the Vault key is kept in Windows' protected storage (DPAPI; Keychain on Mac), the same way Chrome keeps passwords. Seeing or editing what's inside still asks for the master password. Turn this off in Appearance → Vault & privacy → Fill and save without unlocking.
- **The page switcher (Home / Workspace / Music / Browser) stays in one fixed spot** at the top right on every page.
- Fixed: a just-saved login could be counted twice, which stopped it filling by itself.
- Updating: install `Regis-app.zip` once (`main.js`, `preload.js` and `lib/` changed), then run `Enable Spotify audio` again.

## 1.7.6 iPhone overhaul, folder multi-select, playlist songs fix

- **Spotify audio troubleshooting.** New *Playback report* (speaker button, then "Playback report") lists what the player did, so a stop at ~9 seconds can be diagnosed. Regis now controls its own web player directly when it is the active device, follows player events instead of guessing, backs off when Spotify rate-limits, and no longer fights the progress bar while you seek.
- **Real shuffle.** With shuffle on, starting a playlist, album or Liked Songs begins at a random song each time.
- **Desktop shell:** window throttling is switched off so audio is not starved when the window is covered. This needs `Regis-app.zip` reinstalled.
- **Project zip now includes `desktop/`** (the page and shared code the GitHub build reads). Upload it together with the rest so the website and update feed always carry the newest page.

- **iPhone layout:** the four pages (Home, Workspace, Music, Browser) now switch from an iOS-style bottom tab bar, so nothing important sits under the camera notch. The top is just a bell and a menu button (Daily brief and Appearance moved into the menu). Titles are large and left-aligned, Workspace sections are quiet pills, the Browser address bar sits clear of the notch, and Music has a slim Apple-Music-style mini player.
- **Folder multi-select:** in the Music library, tap the tick button, pick playlists (or use Unsorted / All, or the circle on a folder), then Move to… a folder or a new one.

- **Desktop update fix:** the app no longer throws away a downloaded update (and falls back to the old built-in page) when an embedded frame fails to load at start-up. Reinstall Regis-app.zip once to get this fix.

- **Playback errors:** if Spotify’s player fails on several songs in a row, Regis now pauses it and shows one message with the likely cause, instead of a chain of identical errors while Spotify skips ahead.

### Playlist songs fix

- Spotify renamed its playlist-songs endpoint in 2026 and only lets personal apps read playlists you own or collaborate on. Regis now uses the new endpoint (with the old one as a fallback), loads up to 500 songs, and explains clearly when a playlist belongs to someone else.
- Play commands are de-duplicated so a double tap can't restart a song. The web player now reports playback errors and blocked autoplay instead of failing silently.

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
