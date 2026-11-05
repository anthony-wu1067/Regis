#!/bin/bash
# Mac/Linux: double-click to open Regis (first run: right-click > Open, and run "npm install" once).
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
nohup ./node_modules/.bin/electron . >/dev/null 2>&1 &
