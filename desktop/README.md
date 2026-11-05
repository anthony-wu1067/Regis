# Regis — desktop app

Regis runs as its own window on your computer (Windows, Mac or Linux), outside Claude. It talks to Gmail, Google Calendar and Google Drive **directly** and uses the Claude API for briefs, commands and "Plan my day". Closing the window hides it to the system tray so Autopilot and scheduled sends keep running; use the tray icon → Quit to stop it. Your computer must be on for those to run.

## One-time setup (about 15 minutes)

### 1. Install the app (Windows)
1. Install Node.js 20+ from nodejs.org (only needed for this one-time setup).
2. Unzip this folder somewhere you will keep it (for example `Documents\Regis`).
3. Double-click **Setup Regis.bat**. It installs what Regis needs and puts a **Regis** shortcut on your Desktop and in the Start menu.
4. From then on, just open the shortcut. No terminal, no Node.js. (You can pin it to the taskbar.) Turn on "Open at login" in Regis → Setup if you want it to start with your computer.
   - Don't move or delete the unzipped folder; the shortcut points to it. If you do move it, double-click Setup Regis.bat again.
   - `Regis.vbs` in the folder also opens the app directly.
   - If the shortcut or setup shows an error, double-click **Regis (show errors).bat**: it opens Regis in a window that keeps the message on screen. Setup also writes `setup-log.txt`. Start-up crashes are saved as `regis-error.log` in Regis's data folder.
   - Want a real installer instead? Run `npm run dist` and use the file in `dist/`.

**Mac/Linux:** run `npm install` once in the folder, then double-click `Regis.command` (first time: right-click → Open), or run `npm start`.

### 2. Connect Google (free)
1. Go to https://console.cloud.google.com and create a project (name it Regis).
2. **APIs & Services → Library**: enable **Gmail API**, **Google Calendar API**, **Google Drive API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform): choose **External**, fill the app name (Regis) and your email, add yourself as a **Test user**.
   - Then press **Publish app** (status "In production"). If you leave it in "Testing", Google expires the sign-in every 7 days. In production it shows an "unverified app" warning only to you; click Advanced → Go to Regis. That is normal for a personal app.
4. **Credentials → Create credentials → OAuth client ID → Application type: Desktop app.** Copy the Client ID and Client secret.
5. In Regis open **Setup**, paste both, press **Save & connect Google**. Your browser opens; approve access. Done.

Permissions requested: Gmail modify (read, label, archive, trash, draft, send; it cannot permanently delete), Calendar events, Drive. Tokens are stored encrypted by your operating system keychain.

### 3. Turn on Claude features
Create a key at https://console.anthropic.com → API keys and paste it in Regis → Setup → **Save key**. This is separate pay-per-use billing from a Claude chat plan (typically cents per day for personal use). Regis shows the tokens it used this month.

### 4. Voice ("Plan my day")
Press the mic, say what you have to do today, press Stop. Speech is transcribed **on your computer** (Whisper); the first use downloads a ~75 MB model, so you need internet once. Allow the microphone if your OS asks. Then Claude turns it into tasks and calendar events; you tick what to add and press **Add**.

### 5. Canvas (school assignments), optional
1. In Canvas, open **Account → Settings**, scroll to **Approved Integrations** and click **+ New Access Token**. Name it "Regis" and copy the token.
2. In Regis, open **Setup**, find **Canvas**, paste your school's address (like `https://yourschool.instructure.com`) and the token, then press **Save & connect Canvas**.
3. Assignments, quizzes and discussions due in the next three weeks (and the last week) appear in **School**. "Add to my to-dos" turns one into a task.

The token is encrypted on your computer and only ever sent to your school's Canvas address. If your school has turned off student tokens, ask your Canvas admin; Regis can't work around that.

### What's new in this version
- **Calendar:** now a Canvas-style panel built into the page (Week, Month, Agenda, Year). Tick the calendars you want merged; click any event, to-do or assignment for details. **Reconnect Google once** (Setup → Disconnect → Connect) so Regis can list your other calendars; until then it only shows your main one.
- **Email:** click an email's subject or *Read* to see the whole message.
- **To-do groups:** make groups like Academic or Startup, assign tasks, and pick *All* to see everything together.
- **Gravion:** the built-in Gravion is a close match, not the exact font. To get the exact one, download the Gravion font file, then Appearance → Typeface → *Choose File*. Regis remembers it.
- **My photo:** Appearance → Background → My photo lets you use any picture as the background.
- **Custom colour:** Appearance → Custom, drag on the wheel.

## Notes
- Your data (tasks, rules, activity) lives in `regis-data.json` in the app's user-data folder.
- Data in the Claude-hosted version of Regis does not carry over; the two are separate.
- If Google says the sign-in expired, press Save & connect again.
- Tests: `npm test` (connection code against fake Google/Claude responses).

## Alerts, quick capture, habits (v14)

- **Alerts**: the Alerts button (top bar and floating bar) shows a history and lets you choose what Regis tells you about: events (default 10 minutes before), a morning and evening task summary, assignments due within 24 hours, important new email, and an evening habit reminder. When Regis is minimised or in the tray, the same alerts also appear as normal desktop notifications. Nothing to set up.
- **Quick capture from anywhere**: press `Ctrl+Shift+Space` (`Cmd+Shift+Space` on a Mac) in any app. A small box appears, type a task, press Enter. It understands words like `tomorrow`, `fri`, `11/5`, `in 3 days`, `every week`, `!high` and `#group`. Inside the page, press `Q`. If another app already owns that shortcut, use the tray menu's "Quick capture" instead.
- **Email to to-do**: the "+ To-do" button on any email, or "Add to to-dos" while reading one. The task keeps a chip that opens the original email.
- **Steps (subtasks)**, **repeating tasks** and the **Habits** panel are built in and need no setup.


## Mini mode, calendar colours, other inboxes

- **Mini mode**: press **Mini** at the top of Regis (or `Ctrl+Shift+M` / `Cmd+Shift+M` from anywhere, or the tray icon menu). The window becomes a small always-on-top square in the bottom-right corner showing the time, what's next on your calendar, your tasks due today (tick them off) and a box to add a task. Drag it wherever you like (Regis remembers the spot). **Expand** or the same shortcut brings the full window back at its old size.
- **Calendars**: in the Calendar panel's left list, click a colour dot to pick a colour for that calendar and use the ▲ ▼ buttons to reorder. "Reset colours & order" undoes it. Colours and order are saved in your settings.
- **Mail views**: the dropdown above the mail list switches between Needs you (ranked unread), Inbox, Primary, Promotions, Social, Updates, Forums, All unread, Starred, Important, Sent and any of your own labels. The search box runs a normal Gmail search (`from:`, `newer_than:7d`, `has:attachment`, ...).

## Sync, iPhone/iPad and updates
See the project README one level up (`regis-project/README.md`). In short: **Setup → Sync across my devices** syncs to-dos, rules and settings through a private file in your Drive, and **Setup → Updates** (paste your site address once) lets this app update itself without reinstalling. Existing data is imported automatically the first time you open this version.
