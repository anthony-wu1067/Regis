'use strict';
/* Writes the AltStore "source" file. Env: OWNER, REPO, IPA (path to the built .ipa). */
const fs = require('fs'), path = require('path');
const { OWNER, REPO, IPA, OUT } = process.env; if (!OWNER || !REPO || !IPA || !OUT) { console.error('need OWNER, REPO, IPA, OUT'); process.exit(1); }
const root = path.join(__dirname, '..'), version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const site = `https://${OWNER.toLowerCase()}.github.io/${REPO}/`, size = fs.statSync(IPA).size, date = new Date().toISOString().slice(0, 10);
const download = `https://github.com/${OWNER}/${REPO}/releases/download/v${version}/Regis.ipa`;
const desc = 'Your command center for mail, calendar, Drive and your day, with home-screen widgets. The app loads your own Regis site, so most updates arrive without reinstalling.';
const app = { name: 'Regis', bundleIdentifier: 'app.regis.mobile', developerName: OWNER, subtitle: 'Mail, calendar and to-dos in one place', localizedDescription: desc, iconURL: site + 'icon-512.png', tintColor: '8B5CF6',
  versions: [{ version, buildVersion: String(version.split('.').reduce((n, x) => n * 100 + +x, 0)), date, localizedDescription: 'Regis ' + version, downloadURL: download, size, minOSVersion: '16.0' }],
  // legacy single-version fields for older AltStore builds
  version, versionDate: date, versionDescription: 'Regis ' + version, downloadURL: download, size,
  appPermissions: { entitlements: [], privacy: { NSPhotoLibraryUsageDescription: undefined } } };
delete app.appPermissions.privacy.NSPhotoLibraryUsageDescription;
fs.writeFileSync(OUT, JSON.stringify({ name: 'Regis', identifier: 'app.regis.source', subtitle: 'Regis for iPhone and iPad', description: 'Regis builds, signed for you by AltStore.', iconURL: site + 'icon-512.png', website: site, tintColor: '8B5CF6', apps: [app], news: [] }, null, 2));
console.log('altstore source written: ' + OUT);
