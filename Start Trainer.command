#!/bin/zsh
set -e

PORT=8766
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"

echo ""
echo "Grammar Sprint is starting…"
echo "Mac:  http://localhost:$PORT"
if [[ -n "$IP" ]]; then
  echo "iPad: http://$IP:$PORT  (same Wi-Fi required)"
fi
echo ""
echo "Press Ctrl+C to stop the local server."
echo ""

(sleep 1; open "http://localhost:$PORT") &
python3 -m http.server "$PORT" --bind 0.0.0.0
