#!/bin/bash
cd "$(dirname "$0")"
echo "Close Regis first (menu bar icon, Quit), then press Return."
read -r _
node scripts/drm.js off
echo; read -r -p "Press Return to close."
