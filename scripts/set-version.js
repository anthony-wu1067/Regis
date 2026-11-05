'use strict';
/* node scripts/set-version.js 1.2.0 — bumps every place the version lives. Push to main and the workflow publishes it. */
const fs = require('fs'), path = require('path');
const v = process.argv[2]; if (!/^\d+\.\d+\.\d+$/.test(v || '')) { console.error('Usage: node scripts/set-version.js 1.2.0'); process.exit(1); }
const root = path.join(__dirname, '..'), [a, b, c] = v.split('.').map(Number), build = a * 10000 + b * 100 + c;
fs.writeFileSync(path.join(root, 'VERSION'), v + '\n');
const pj = path.join(root, 'desktop/package.json'); const j = JSON.parse(fs.readFileSync(pj, 'utf8')); j.version = v; fs.writeFileSync(pj, JSON.stringify(j, null, 2) + '\n');
const yp = path.join(root, 'ios/project.yml'); let y = fs.readFileSync(yp, 'utf8');
y = y.replace(/MARKETING_VERSION: ".*"/, 'MARKETING_VERSION: "' + v + '"').replace(/CURRENT_PROJECT_VERSION: ".*"/, 'CURRENT_PROJECT_VERSION: "' + build + '"'); fs.writeFileSync(yp, y);
console.log('version set to ' + v + ' (iOS build ' + build + ')');
