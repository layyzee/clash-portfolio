#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "🏰 Launching Balaji Palani's 3D Clash Village Portfolio..."
python3 -m http.server 3003 --bind 127.0.0.1
