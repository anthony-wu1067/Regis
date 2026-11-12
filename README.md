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

## 1.9.10 Uses less memory

Measured in a clean test copy: Regis starts at about 730 MB instead of 1,080 MB (4 processes instead of 6), and is about 300 MB lighter with tabs open too.

- **Spotify player only when used.** The player is no longer loaded at start-up. It loads when you open Music or press play, and the embedded player goes away when you leave Music, unless it is playing. This also stops the DRM (Widevine) process from starting at launch.
- **Hidden tabs slow down, like in Chrome.** Before, every tab you weren't looking at kept running at full speed. The Regis window itself still runs at full speed, so music keeps playing when it is minimised.
- **Fewer awake tabs.** At most 4 hidden tabs stay awake; older ones sleep after 2 minutes (they stay in the tab strip and reload when you open them). When the laptop is short of memory (under 1 GB free), every hidden tab sleeps after 3 minutes. A tab playing sound never sleeps.
- **Chat apps:** each app's menu now shows how much memory it uses. Turn off "Keep running for notifications" for an app you don't need notifications from, and it closes 5 minutes after you leave it, then opens again when you go back. Your Discord, Instagram and Teams are all set to keep running, so nothing changes for them until you switch one off.
- **Small things:** the alert window closes a minute after there is nothing to show, the site-icon cache is smaller, and the Office and Phone Link helpers stop after 10 idle minutes.
- **Update the desktop app once** (`Regis-app.zip`).

## 1.9.9 White-screen safety net

- **What the white screen was:** your laptop's Intel graphics driver (version 32.0.101.5763, from July 2024) keeps failing. Windows recorded 223 graphics-driver failures ("live dumps") in ten days, starting before Regis was first run on this laptop, and Regis's own graphics process crashed 92 times in three days. Last night's white screen lines up with one of them (12:31 AM). It is not caused by a page or a tab.
- **The real fix is on your side: update the Intel graphics driver** (Intel Driver & Support Assistant, or the laptop maker's support page). Regis cannot do that for you.
- **What Regis now does when it happens:** after the graphics process restarts, Regis makes the window, the tab you are looking at and any chat app on screen draw themselves again, so a blank window should come back by itself within a few seconds. If the Regis page itself ever crashes, it reloads instead of staying blank.
- **Better evidence next time:** `regis-events.log` (in your Regis data folder) now also notes what was on screen when the graphics process crashed, and when the window stops or starts responding. No addresses or content are written.
- **Update the desktop app once** (`Regis-app.zip`).

## 1.9.8 AI teams, Phase 2: team dashboards, task and run history, personas, soul.md, the Office

- **Every team has a full dashboard**, and all four use the same one, filled with that team's data. Sections: Overview, Tasks, Members, Tools & workflows, Memory, Activity, AI usage & limits. The header shows the team, its mission, the lead, whether it is working, its routing rule and today's Claude spend.
- **Tasks are kept by Regis itself now**, not by the page. Each task has a status (queued, planning, running, waiting, completed, failed, cancelled), a priority, who it is assigned to, the engine, and its result. Your old queue and KPI numbers are moved over automatically the first time you open each team. A task that was running when Regis closed is marked as not finished.
- **Run history.** Every run of a task leaves a record: when, the lead, which specialists, the engine and why, Claude calls, estimated cost, time taken, whether it escalated or hit a limit, and each step. Press Details on a task. This is separate from the chat.
- **Usage.** Local AI calls are counted now too. You can see calls, tokens and estimated cost for all of Regis, per team, per task and per run, plus the last 7 days. The limits are unchanged: 3 Claude calls per task, $2 per team per day, $5 for Regis per day.
- **Members with personas.** Each lead and specialist is a named member with a role, a persona, capabilities, a status and recent work: Nora and Felix (Exusiai), Iris and Theo (Midas), June and Marco (Alicia), Ren and Vera (Obsidian). Specialists still have no chat of their own.
- **soul.md.** On a member's card press Upload soul.md to give them a personality file (Markdown, up to about 24 KB). View shows it, Remove goes back to the default. A soul changes how a member sounds and works. It cannot change rules, permissions, tools, spending limits or routing, because Regis never reads it for settings.
- **Office.** The animated base moved out of the dashboards into its own entry at the bottom of the left rail (the coffee cup). It shows the real state: who is working on what, which specialist has been given a part, and idle when idle. Clicking a character opens that team.
- **Approvals (foundation only).** Tools now follow one rule: read and draft tools run by themselves, a tool that writes outside Regis needs your approval each time, and destructive tools are blocked. No writing tools exist yet, so the approval list is empty.
- **Browser extensions:** an extension no longer puts its icon in the toolbar by itself. Open the puzzle button and press the pin next to an extension to show or hide its icon. Hidden extensions keep working.
- **Not built** (later phases): plugins and outside services, scheduled workflows, creating your own teams, editing personas in the app.
- **Update the desktop app once** (`Regis-app.zip`).
- Tested with a fake Claude and a fake local AI. Not tested with a real Ollama model or on a phone.

## 1.9.7 AI teams, Phase 1: real teams, local-first, and hard Claude limits

The plan this follows is in `AI_TEAM_ARCHITECTURE.md`. This is Phase 1 only (the foundation).

- **Each lead now heads a team.** Exusiai, Midas, Alicia and Obsidian each have a mission, two specialists, a team memory and a policy. Nothing you saved before is lost; the chat works exactly as it did.
- **Queued tasks are routed by Regis, not by the AI.** When you press Run, fixed rules decide who does the work:
  - routine work (summaries, sorting, drafts, simple sums) stays on the local AI and costs nothing;
  - complex work (analysis, strategy, planning, building pages or scripts, very long tasks, tasks with a file) goes to Claude, if the team's settings allow it. When the local AI is available, the team's specialists first prepare notes locally and the lead finishes with one Claude call;
  - if the local AI fails, Claude takes over once.
  - Next to the task box you can pick Auto, Local AI or Claude for a single task. Each finished task says who did it, why, and roughly what it cost.
- **Hard limits on Claude, enforced by Regis itself.** Defaults: 3 Claude calls per task, $2 a day per team, $5 a day for all of Regis. When a limit is reached, Claude is simply not called and you are told why. This covers every Claude call: team chats, queued tasks, and Regis's own commands (Plan my day, mail rules, the command bar). Change the limits on the team card; they cannot go above 12 calls, $50 per team and $100 overall.
- **The team card** (on each team's Dashboard, under Add-ins): who is on the team, today's Claude spend, the routing rule (Local first / Local unless I ask / Local only / Prefer Claude / Claude only), the limits, and the team's memory, which you can add to or prune. Finished tasks leave a short note there, and the lead reads those notes before the next task.
- **Things that changed on purpose:** a queued task no longer carries the whole chat history to the AI (cheaper; it gets the team memory instead). Regis's own Claude features can now be refused once the daily limit is reached.
- **Costs are estimates** from token counts and a price list inside Regis. Call counts are exact.
- **Update the desktop app once** (`Regis-app.zip`): this changes the app itself.
- Not built yet (later phases): plugins, scheduled workflows, tools that send or change anything, creating your own teams.
- Tested with a fake Claude and a fake local AI: 50 unit checks and a 34-check run in the real app, plus every existing suite. **Not tested with a real Ollama model**: how good a small local model's answers are on this laptop is for you to judge.

## 1.9.6 The base, your own characters, and browser fixes

- **Your characters:** the four team leads now use the pictures you sent (Exusiai, Midas, Alicia, Obsidian). **Luna is renamed Alicia**; her chats, queue and add-ins carry over.
- **They move:** they breathe, blink, tilt their heads, smile with closed eyes, walk with moving legs, hurry when work arrives, sit behind their own desk while working, get thought bubbles at the things they visit, and say hello when they meet. Exusiai's halo floats.
- **The base:** the single office is now a building seen from the side, like a base in a strategy game: the Common area and a terrace on the top floor, Exusiai's and Alicia's offices on the middle floor, Obsidian's and Midas's on the bottom floor. Short hallways lead to a lift in the middle, and the characters ride it between floors (one at a time).
  - Press a room, or its name above the base, to zoom in. Press it again or **Whole base** to zoom out. Regis remembers your choice.
  - The old furniture editing (add or drag furniture, wall and floor colours) is gone, because the rooms are now your pictures.
- **Icons in the left rail:** Exusiai is a halo, Midas a gold ingot, Alicia a pen, Obsidian a diamond. Regis's star is centred again.
- **Browser, "/" on a new tab:** pressing "/" on a new tab now puts the cursor in the search box (it used to open the Regis overlay), and a new tab always gets the keyboard, so you can type straight away.
- **Browser, no surprise videos:** a tab that Regis reopens by itself (when the app starts, or when a sleeping tab wakes) stays paused and silent until you click or type in it.
- **Chrome extensions:** on a Chrome Web Store page, the greyed-out "Add to Chrome" button is replaced by a working **Add to Regis** button in the same place, and the "Switch to Chrome" strip is hidden. Big extensions install now (Adblock Plus unpacks to 318 MB, over the old 300 MB limit).
- **Update the desktop app once** (`Regis-app.zip`): the browser fixes live in the app itself, not in the page.
- Tested: the team test suite (42 checks) plus a real install of Adblock Plus from the real Web Store in a throwaway profile. Not tested on a phone, and not with a real YouTube video (a test page that plays sound by itself was used).

## 1.9.5 Team dashboards, the office, and fixes

- **Team dashboards:** opening Exusiai, Midas, Luna or Obsidian now shows a Dashboard (the chat is one tab over).
  - **KPIs** that fit each team. Midas: units in the run, landed cost, price, gross margin (worked out for you) and caffeine per serving, which turns red over 50 mg. Click a number to change it.
  - **Queue:** add tasks, press Run (or Run the queue) and the team lead works through them one at a time. Finished tasks show the start of the result; Open jumps to the chat.
  - **Add-ins:** extra instructions or reference notes a team always keeps in mind (brand voice, price list, style guide). Type them or load a Markdown/text file; tick to switch on or off.
  - Suggested-task cards in a chat have a second button, Queue for the team.
- **The office:** a room at the top of each dashboard where the four team leads walk around as chibi characters (original drawings). Whoever is working walks to their desk, the screen lights up and a typing bubble appears. **Edit office** lets you add, drag and remove furniture and pick the wall and floor colours.
- **Team icons:** each team's button in the rail is now its lead's face.
- **Backgrounds no longer vanish.** The cause is found: the graphics process on this laptop crashes several times an evening while browsing, and after a few crashes the browser engine stopped using the graphics card, which blanked the Firewall and Waterwall backgrounds. Regis now keeps the graphics process restarting, and has a plain fallback wall if the graphics card is refused anyway.
- **Calm wall is now Waterwall**, and both walls have a colour picker (Appearance > Background).
- **"/" in the Browser** now works when the keyboard is inside a web page (outside a text box): it jumps to the address bar.
- **Chrome Web Store:** extension pages get an **Add to Regis** button (the store's own button only works in Chrome).
- **Greeting shimmer** really shows now: the default look had a second off-switch.
- Updating: the desktop app changed, so run *Install Regis* once.

## 1.9.4 Local AI (Ollama)

- **Local AI:** Regis can use AI models that run on your own computer through Ollama (a free app from ollama.com). Nothing leaves the computer and there is no per-use cost.
  - Setup > Local AI shows whether Ollama is running, downloads a model for you (with progress), and has a Test button.
  - Tick who uses it: Regis's own commands, Exusiai, Midas, Luna, Obsidian. Each agent's chat also has a Claude / Local switch.
  - If the local AI fails, Claude answers instead (you can turn that off). Each reply says which one answered.
  - Regis only talks to Ollama on this computer, never another address.
  - On an ordinary laptop small models answer at a few words a second; Claude stays better for long code.
- Desktop app only (not the web or iPhone version). Updating: run *Install Regis* once.

## 1.9.3 Installer that works, backgrounds that rebuild themselves

- **Install Regis works again.** It was blocked by an empty leftover Regis process and kept saying Regis was open, so the desktop app stayed on 1.8.9 (which also hid the AI agents). It now ignores leftovers and, if Regis really is open, offers to close it: type Y and press Enter.
- **Backgrounds rebuild themselves.** The background checks in every few seconds; if it stops drawing or loses its drawing surface (after a graphics reset), Regis throws it away and builds a new one. This works even with an older desktop app.
- The "update the desktop app" steps in Regis are up to date.

## 1.9.2 Blackwall dials

- **Blackwall dials** (Appearance > Background, shown with the Firewall or Calm wall background):
  - **How often:** spikes and ripples now come less often by default (60%). Lower is calmer, 200% is busier.
  - **Sharpness:** 0 gives smooth swells; turning it up makes the shards harder-edged and more star-pointed.
  - **Size:** how high and wide the spikes and ripples rise.
- Updating: if Regis says your desktop app is older than the page, unzip *Regis-app.zip* over your Regis-app folder and run *Install Regis* once.

## 1.9.1 The Guild: AI workspaces, plus browser, alert and background fixes

- **AI workspaces (the Guild).** The Workspace page has a rail on the left, like Discord: Regis (your normal workspace) and four agents, each with its own personality and its own chat history. Nothing from one agent's chat is ever sent with another's.
  - **Exusiai** (business operations): plans the week like a Jira board and coaches customer interviews with The Mom Test. She sees your open Regis tasks, and her suggested tasks come back as a card with "Add to my tasks".
  - **Midas** (e-commerce and finance): knows about the 15,000-unit Matcha and Lychee R&D run in Rancho Cucamonga, shows his maths for margins, and blocks anything over 50 mg of caffeine per serving.
  - **Luna** (web studio): attach a Markdown file (paper-clip button) and she returns a React + Tailwind landing page, with Copy and Save buttons.
  - **Obsidian** (game studio): Roblox Luau scripts, UI, and celestial, volcanic and enchanted-forest biomes.
  - While an agent is open, the "tell Regis" bar is its message box. Agents use your Anthropic API key (Setup), billed per use.
- **Regis overlay:** press **Alt+Space** anywhere (or **/** on any page except the Workspace) for a "tell Regis" bar over whatever you're doing. Tab picks who you're talking to, or start with "@midas", "@luna" and so on.
- **Camera and microphone in the Browser:** Teams, Meet and Zoom can now use them. The site asks first in a bar above the page (Allow or Block, remembered per site if you like). Browser menu > Camera and microphone lists your answers.
- **Google AI Mode in the Browser takes typing again.** Since 1.7.9, Regis changed a built-in browser function on every website so that Google sign-in would accept it. Google's bot check treated that as tampering: Search showed its "unusual traffic" page and the AI box ignored typing. The change now runs only on Google's sign-in pages.
- **Meeting alerts are no longer hidden behind web pages:** on the Browser, Office and Comm pages they float above the page.
- **Tab groups:** drag a group's name to move the whole group. Right-click it to rename it, change its colour, collapse it, ungroup it, close it, or open a new tab in it.
- **Address bar:** the first click selects the whole address, like Chrome.
- **Downloads:** a cleaner list grouped into In progress, Today and Earlier, with coloured file-type icons. The buttons appear when you hover.
- **Backgrounds:** they pause while the Browser, Office or Comm covers them, and are redrawn when you come back. Their animation can no longer get stuck after a graphics reset.
- **Blackwall:** sharper, faster shards with more glitches. New **Blackwall Calm** (preset, colour and "Calm wall" background): blue ripples and a soft hologram haze, no glitches.
- **Schedule:** more room between Open windows, Tomorrow and the events.
- **Page change into the Browser** plays the pixel transition again: the blocks reveal the last picture of your tab, then the live page appears.
- **Greeting shimmer** now plays in Balanced mode too: one sweep when the Workspace opens.
- **Spotify:** a request budget of about 24 a minute. the timed "what's playing" check is skipped when it runs out, the same request is never sent twice at once, and anything you tap still goes straight away. This keeps Regis under Spotify's limit.
- Updating: the desktop app changed, so run *Install Regis* once.

## 1.9.0 Calendar back, iMessage in Comm, backgrounds survive

- **Calendar month view is back.** The Comm page added in 1.8.9 used a style name the calendar's month grid already used, which hid the grid. Comm's styles have their own names now.
- **iMessage in Comm:** "Add iMessage (Phone Link)" puts Microsoft's Phone Link app (which talks to your iPhone over Bluetooth) right inside the Comm page, the same way Office docks Word and Excel. The page walks you through pairing the first time. Phone Link keeps running, so new messages pop up on any page; "Open on its own" gives it its own window again.
- **Backgrounds come back after the graphics card resets** (this can happen after heavy websites in the Browser): Regis now notices and redraws them, including the Milky Way in Cosmos, which used to stay blank. A small log of crashes is kept in Regis's data folder (regis-events.log) so a repeat can be confirmed.
- Updating: the desktop app changed, so run *Install Regis* once.

## 1.8.9 Comm page, smooth scrolling, quicker Browser start

- **Comm page:** Discord, Slack, WhatsApp, Messenger, Telegram, Teams, Google Messages, Instagram, LinkedIn, X, or any web chat, inside Regis. Add and remove apps; each keeps its own sign-in and keeps running in the background so unread counts and notifications arrive (the Nav button gets a red dot). Mute one app or all of Comm (no pop-ups or sounds). **Pop out** floats a chat in a small window above every page; drag it, minimise it to a bar, or send it back to Comm. iMessage can't run inside Regis (Apple doesn't offer it on the web or Windows); Comm links to Microsoft Phone Link, which can.
- **Scrolling is smooth:** every scroll step used to make the whole page re-style itself (the scroll position was written onto the page root), taking most of the computer's time. Now only the two things that use it get it. Pop-up windows (emails, dialogs) no longer blur the whole moving screen behind them.
- **Browser:** links opened with "Open link in new tab" or a middle-click open behind the current tab. At start-up only the tab you're on loads; the others wait (with their titles) until you open them, and the tab strip appears straight away. Press "/" to jump to the address bar. Notifications in the Browser are small chips that keep out of the way.
- **Using a website no longer makes Regis think you're idle** (which paused its animations), and backgrounds redraw themselves if the graphics card resets.
- **Page shortcuts are Alt + 1, 2, 3...** in the order Nav shows the pages.
- **Blackwall** is a calm, solid pin wall with only a few small, organically shaped pushes at a time that swell and sink back.
- **Appearance:** sections fold again (Regis remembers which you closed). The alert count no longer sits on the ⋯ button.
- Updating: the desktop app changed, so run *Install Regis* once.

## 1.8.8 Blackwall pin wall, pixel transition back

- **Blackwall** is now a wall of pins facing you, like a pin-art toy, drawn by the graphics chip at full sharpness. Rogue AIs are bulges of random place, size and shape that swell, roll across and sink back; the pins they push come forward, grow, spread and catch the light, so you see them in 3D. Mainly red, with hues slowly drifting towards magenta or orange. Glitches tear bands sideways, split the colours, flicker blocks and sweep a scan line. No rain. It runs at a steady 60 frames a second at 1920x1080 (the old one dropped to about 38 on Home).
- **The pixel transition is back:** the new page dissolves in from pixels. It covers only the page area under the top bar and has no "out" half, so the app never blanks; the Browser still opens instantly.
- The note under the Browser start page ("Your Google sign-in is remembered...") is gone.
- No reinstall needed: this update arrives by itself.

## 1.8.7 Smooth again, page transitions back, Blackwall as a pixel wall

- **Lag fixed:** 1.8.6 made every page change freeze Regis for a moment (the Nav label measured itself, which forced the whole page to be laid out again, and the page animation did the same). Both are gone; a page change now costs about half as much as before.
- **Home is smoother on big screens:** the Home clock's nine layers each had their own shadow, four of them moving, so the graphics card redrew them every frame. The clock now has one shadow (Home went from about 38 to 55 frames a second at 1920x1080 with Blackwall).
- **Page transitions are back and visible:** the new page slides and fades in while a light line sweeps across in the direction you're going. Nothing blanks.
- **Blackwall** is now a vast wall of glowing pixels in red and blue stripes, sweeping away in perspective, rippling in waves. Rogue AIs push bulges through it and tear pixels off; the far end frays into drifting pixels; stray code still types itself out. It is drawn at a quarter resolution and scaled up with hard edges, which gives the chunky look and keeps it cheap.
- No reinstall needed: this update arrives by itself.

## 1.8.6 Nav button, calmer Appearance, no more blanking, true video full screen

- **Nav:** the page switcher is now one **Nav** button at the top right (it shows the page you're on). Press it and the pages slide out to its left; pick one and it tucks away. Alt + first letter still switches pages any time.
- **No more blank app** when opening pages: with Balanced or Full effects, changing pages used to cover the whole window for up to half a second (that's what blanked when a link opened in the Browser). The new page now simply fades and slides in; the top bar and background stay put, and the Browser shows its page straight away.
- **Video full screen:** a video's full-screen button now fills the whole screen, and leaving it puts Regis back the way it was (still full screen if it was before).
- **Browser tabs** sit closer together with a holographic look: glassy tabs with lit edges, a glowing line under the open tab, and neon group labels whose colour runs along their tabs. The address bar and the start-page search have more room before the first letter.
- **Blackwall** now has rogue-AI tendrils that wander, lunge and glitch across the screen, and stray hacking code that types itself out and drifts away.
- **Appearance** is split into tabs (Theme, Effects, Home, Workspace, Music, Browser, More), so each shows only its own settings; search still looks through everything. **TV mode** moved here (Home tab), and the Home page no longer shows the shortcut hint. The Pages section (it had gone missing) is back under More.
- **Spotify:** the repeat button cycles off, repeat all, and **repeat this song** (shown with a small 1), and it changes straight away.
- **Subtasks:** selecting them to copy picks up only their words, not the tick boxes, Edit or ✕, and dragging across one no longer opens it for editing.
- Updating: the desktop app changed (video full screen), so run *Install Regis* once.

## 1.8.5 Extensions, ad-free YouTube, new presets, Office ribbon back

- **Chrome extensions in the Regis Browser:** press the puzzle button > Manage extensions and paste a Chrome Web Store link, or open an extension's page in the Chrome Web Store and press **Add to Regis**. Installed extensions show in the toolbar; press one to open its popup. Turn them on or off, open their options or remove them in the same place. Tested with Dark Reader and Google Translate. A few Chrome-only parts aren't available (the blocking rules some ad blockers use; signing in through Chrome), and Regis says so for an extension that needs them.
- **YouTube without ads** while the Browser's Shield is on: ad data is removed before the player sees it, any ad that still starts is muted and skipped, and ad boxes are hidden.
- **Three presets** in Appearance > Colour: **Cyberpunk** (neon city with rain and holo tags), **Blackwall** (red firewall lattice with drifting shards) and **Holo HUD** (gold and cyan rings and readouts). Each sets the colours and an animated background, drawn off the main thread. The colours and backgrounds can also be picked on their own.
- **Office:** the ribbon, title row and status bar are back, so the key tips (Alt) and every Office shortcut work. Regis now keeps Office's own title bar instead of removing it. An Office app Regis opened also quits once its last file is closed, instead of idling in the background.
- **Spotify Up next** shows the next song, not the one playing.
- Updating: the desktop app changed, so run *Install Regis* once.

## 1.8.4 Office inside Regis, Chrome-style tabs, smoother Home

- **Office page (desktop app on Windows):** the real Word, Excel and PowerPoint, docked inside Regis. A sidebar switches between Files and the three apps; open documents show as tabs along the top. New, Open… and Templates start or open documents straight into Regis, and every Office keyboard shortcut works because it is the actual desktop app (Keys in the sidebar lists the common ones). Pop out moves a document back to its own window; Office files you opened elsewhere can be brought in. When Regis quits, documents become normal windows again, so nothing is lost.
- **Browser tabs move like Chrome's:** press a tab to select it, drag and it follows the pointer while the others slide aside; drop between grouped tabs (or on the group name) to join a group, pull it past the group's end to leave. Tabs slide when one opens or closes, shrink down to their icon when many are open, and a middle click closes one.
- **Home stays smooth:** the animated backgrounds (constellation and Milky Way) now draw on their own thread. Before, they kept the page busy around 60 times a second, which made Home slower the longer it stayed open. Work on the main thread dropped by about 85 to 95 percent.
- **No more white flash** when leaving the Browser with a white website open: the site is hidden before Regis switches pages.
- **Tidier screens:** the mail filter isn't cut off, the Home hint shows the Alt shortcuts, panel headers stay on one line on the phone, the Music setup only shows the address that applies, and the Browser's Appearance button is an icon like its neighbours.
- Updating: the desktop app changed, so run *Install Regis* once.

## 1.8.3 True full screen

- **Full screen hides the Windows title bar again**, from the full-screen button, F11 (fn+F11), or the Browser's ⋯ menu.
- Why F11 had stopped working: since 1.8.2 browser tabs stay loaded behind the scenes, and after using the Browser the keyboard could stay with a hidden web page that ignored F11. Now F11 also works inside web pages, and leaving the Browser hands the keyboard back to Regis (which also keeps Alt+letter and the space bar working).
- The full-screen button never had the desktop window's full screen (the function wasn't passed to the page), so it used a weaker web-page version. Fixed, and the button shows when it's on.
- Updating: the desktop app changed, so run *Install Regis* once.

## 1.8.2 A fuller browser, Office page, scalable page switcher

- **Tabs:** drag to reorder; drag onto a group's name (or a tab in a group) to join it, anywhere else to leave. The ⊞ button is gone: right-click a tab for New tab, Reload, Duplicate, Mute, Bookmark, Copy link, Add to group, Put to sleep, Close, Close others, Close to the right, Reopen closed tab. Tabs show the site's icon and a speaker when they play sound (click it to mute).
- **Sleeping tabs:** tabs you haven't opened for a while (30 min by default; Appearance > Browser) give their memory back and reload when you open them. Tabs playing sound stay awake.
- **No more blank flashes:** when a menu or dialog covers the page, a snapshot of the page stays underneath, and switching tabs no longer detaches and re-attaches pages.
- **Downloads** (Ctrl+J or the arrow in the address bar): saved to your Downloads folder, with progress, pause/resume/cancel, open and show in folder. **Easy Files:** when a website or Regis asks for a file, your recent downloads come first, plus Browse this computer.
- **Also new:** Find in page (Ctrl+F), History (Ctrl+H) and address-bar suggestions from history and bookmarks, Clear browsing data, Print (Ctrl+P), zoom indicator, Ctrl+1 to 9 for tabs, Ctrl+Shift+T to reopen, spelling suggestions, Save/Copy image and Inspect on right-click.
- **Alt + first letter** switches pages from anywhere, even inside a web page: Alt+H Home, Alt+W Workspace, Alt+M Music, Alt+B Browser, Alt+O Office.
- **Page switcher** is built from one list of pages, so new pages slot in: icons with names (icons only once there are more than five in the bar), pages can be moved under a ⋯ menu in Appearance > Pages, and the phone tab bar shows up to five with More beyond that.
- **Office page:** new Word, Excel and PowerPoint files on the web (word.new, excel.new, powerpoint.new, saved to OneDrive), Microsoft 365 home and OneDrive in the Regis Browser, and the Office files in Documents, Downloads, Desktop and OneDrive listed newest first, opened in your desktop Office apps.
- **Priority colours are back** on email (HIGH red, MED amber, LOW green) and tasks (P1/P2/P3), with a matching edge on each row.
- **Links in emails open in the Regis Browser** (Appearance > Browser > Open links in the Regis Browser to change it).
- Updating: the desktop app changed, so run *Install Regis* once.

## 1.8.1 Spotify stays within its limits, space bar

- **"Spotify needs a break" fixed at the cause.** Spotify allows personal apps only a modest number of requests. Regis checked Spotify every 5 seconds even while minimised or in the tray (about 17,000 times a day), and after every player event. Now: nothing while minimised or hidden, every 5 s only while something plays elsewhere, every 15 s when paused, every 30 s when Regis itself plays (its own player tells it what's on). Library, Home sections, playlists and albums are reused for 5 to 15 minutes instead of being fetched each time.
- **When Spotify still says "slow down"**, Regis now sends nothing until the time Spotify gives (it used to keep asking, which made Spotify extend the pause), remembers it across restarts, shows one note with the time it will be back, and keeps your library and pages on screen from what it saw last. Music already playing keeps going.
- **The bottom bar always shows the song** when Regis itself is playing: it follows Regis's own player directly.
- **Space bar** plays and pauses on the Music page (not while you're typing).

## 1.8.0 Spotify-style library, smooth scrolling and lyrics, custom icons

- **Music library like the Spotify app.** New playlist (the + in Your Library), Edit details (name, description, public or private), Delete, Save to / Remove from Library, Copy link. Every song has a ⋯ menu (also on right-click): Add to queue, Add to playlist (or a new one), Remove from this playlist, Like, Go to album or artist, Copy link. Folders can be renamed (✎).
- **Seek bar:** the coloured fill follows the knob instantly while you drag, and moves smoothly while a song plays instead of jumping once a second.
- **Lyrics:** the Lyrics button opens them and a second press closes them (it lights up while open). Lines now switch exactly on time (they were checked only every 0.35 s, and the network delay wasn't counted), and light up 0.35 s early so they're on screen as the words start. Adjust it in Appearance → Spotify → Lyrics timing.
- **Smooth scrolling everywhere.** Long lists scrolled at about 30 fps because rows sliding under the mouse kept changing their hover look, forcing a full-page layout every frame. Hover now pauses while you scroll: a 300-song playlist scrolls at a steady 60 fps.
- **Custom icons** for sidebar shortcuts, favourites and bookmarks: 26 preset icons, 10 colours or any colour, your own picture (shrunk to a small square), or the site's own icon (desktop app). Sidebar: Edit, then Icon. Favourites: Edit favourites, then ✎. Bookmarks bar: Edit, then click a bookmark to rename it, change its icon or delete it.
- The address bar text no longer starts right against the lock.
- Updating: the desktop app changed (site icons), so run *Install Regis* once.

## 1.7.9 Regis.exe, Google Docs crash, dependable Spotify, smooth motion

- **Regis is now a real app: `Regis.exe`.** Like a game folder: it installs to `AppData\Local\Programs\Regis`, and the Desktop and Start-menu shortcuts point at `Regis.exe` itself (no more "electron.exe has been changed or moved"). *Setup Regis* builds and installs it; *Install Regis* rebuilds it after an update. Your data and settings are kept.
- **Google Docs no longer crashes Regis.** 1.7.7 switched the browser identity during Google's redirect to sign-in, which crashed the engine. That's gone: every site sees one plain Chrome identity, and pages get the `window.chrome` object real Chrome has. A missing `window.chrome` is what Google uses to call a browser "not secure". Tested against the live Google Docs sign-in page, not with a real account.
- **Spotify is dependable even when Regis's own player can't play.** On the first playback error Regis pauses its player straight away (no more skipping five songs), and if audio silently stops it notices within about 3 seconds. Either way it moves playback to your Spotify app or phone on the same song and keeps going there, until the audio engine is signed. *Enable Spotify audio* now signs the installed `Regis.exe` as well.
- **Smooth animations.** 1.7.8 stepped the dial rings a few times a second to save work, which looked laggy and could freeze a ring. Instead, every rotating or pulsing part now has its own layer that the graphics chip turns at 60 fps: the clock's star squares and number rings, the satellite rings, the header dial orbit, and the Today ring. Both squares of the clock's star turn again (one was switched off in Balanced). Old "stepped" timings for the ticker and dial sweep are gone too. Balanced mode also got lighter: Home 180 to 57 ms of main-thread work per second, Workspace about 100 to 44.
- Updating: run *Setup Regis* (or *Install Regis*) once, then *Enable Spotify audio*.

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
