#!/bin/bash
set -euo pipefail

FROM_CLIPBOARD=0
ENV_ARG=""
for arg in "$@"; do
  case "$arg" in
    --from-clipboard) FROM_CLIPBOARD=1 ;;
    *) ENV_ARG="$arg" ;;
  esac
done

if [ -n "$ENV_ARG" ]; then
  ENV_FILE="$ENV_ARG"
elif COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null); then
  ENV_FILE="$(cd "$(dirname "$COMMON_DIR")" && pwd)/.env"
else
  ENV_FILE="./.env"
fi
[ -f "$ENV_FILE" ] || { echo "FEHLER: $ENV_FILE existiert nicht." >&2; exit 1; }
echo "Ziel: $ENV_FILE"

if [ "$FROM_CLIPBOARD" = "1" ]; then
  NEW_KEY=$(pbpaste)
  echo "Key aus der Zwischenablage gelesen."
else
  [ -t 0 ] || { echo "FEHLER: kein TTY fuer verdeckte Eingabe - nutze --from-clipboard (Key vorher kopieren)." >&2; exit 1; }
  read -r -s -p "Neuen ANTHROPIC_API_KEY einfuegen (Eingabe bleibt unsichtbar): " NEW_KEY
  echo
fi
NEW_KEY=$(printf '%s' "$NEW_KEY" | tr -d '[:space:]')
NEW_KEY=${NEW_KEY#ANTHROPIC_API_KEY=}
NEW_KEY=${NEW_KEY#\"}; NEW_KEY=${NEW_KEY%\"}
NEW_KEY=${NEW_KEY#\'}; NEW_KEY=${NEW_KEY%\'}

case "$NEW_KEY" in
  sk-ant-*) ;;
  *)
    echo "FEHLER: Das ist kein Anthropic-Key (beginnt mit '${NEW_KEY:0:6}...', Laenge ${#NEW_KEY}; erwartet sk-ant-...). Abbruch, nichts geschrieben." >&2
    exit 1
    ;;
esac

HTTP=$(curl -s -o /dev/null -w "%{http_code}" https://api.anthropic.com/v1/messages \
  -H "x-api-key: $NEW_KEY" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":1,"messages":[{"role":"user","content":"ok"}]}')
if [ "$HTTP" != "200" ]; then
  echo "FEHLER: Anthropic-API antwortet HTTP $HTTP (erwartet 200). Abbruch, nichts geschrieben." >&2
  exit 1
fi
echo "API-Check: HTTP 200 - Key ist gueltig."

BACKUP="$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
cp "$ENV_FILE" "$BACKUP" && chmod 600 "$BACKUP"
export NEW_KEY
awk 'BEGIN{done=0}
  /^ANTHROPIC_API_KEY=/{print "ANTHROPIC_API_KEY=" ENVIRON["NEW_KEY"]; done=1; next}
  {print}
  END{if(!done) print "ANTHROPIC_API_KEY=" ENVIRON["NEW_KEY"]}' "$BACKUP" > "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo "OK: Key gesetzt (Backup: $BACKUP)."
echo "Gegenprobe aus der Datei:"
FILE_KEY=$(grep '^ANTHROPIC_API_KEY=' "$ENV_FILE" | tail -1 | cut -d= -f2-)
HTTP2=$(curl -s -o /dev/null -w "%{http_code}" https://api.anthropic.com/v1/messages \
  -H "x-api-key: $FILE_KEY" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":1,"messages":[{"role":"user","content":"ok"}]}')
echo "HTTP $HTTP2 $( [ "$HTTP2" = "200" ] && echo '- alles gut, die Conversation-Bench kann laufen.' || echo '- unerwartet, bitte melden.')"
