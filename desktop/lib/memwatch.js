'use strict';
/* 1.9.10 Is this computer short of memory? Windows' "available" memory (what os.freemem() reports there) below 1 GB, or below 10 %
   of the total. Read at most every 20 s. Used to put hidden tabs and unused chat apps to sleep sooner; nothing is ever closed that
   the owner is looking at or that is playing sound. REGIS_PRESSURE=1 / 0 forces it on / off (tests). */
const os = require('os');
let at = 0, last = false;
function pressure() {
  if (process.env.REGIS_PRESSURE === '1') return true; if (process.env.REGIS_PRESSURE === '0') return false;
  const now = Date.now(); if (now - at < 20000) return last; at = now;
  const free = os.freemem(), total = os.totalmem() || 1; last = free < 1024 ** 3 || free / total < 0.10; return last;
}
function info() { return { freeMB: Math.round(os.freemem() / 1048576), totalMB: Math.round(os.totalmem() / 1048576), pressure: pressure() }; }
module.exports = { pressure, info };
