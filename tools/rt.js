// electron rt.js <testFile> <logFile>: runs a test with console output in a file
const fs = require('fs'); const LOG = process.argv[3]; fs.writeFileSync(LOG, '');
console.log = (...a) => fs.appendFileSync(LOG, a.join(' ') + '\n'); console.error = console.log;
process.on('uncaughtException', (e) => { console.log('UNCAUGHT ' + (e && e.stack || e)); });
const T = require('path').resolve(process.argv[2]); process.argv.splice(2, 2); require(T);
