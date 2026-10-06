#!/bin/bash
set -euo pipefail

API_BASE="${ELEVENLABS_API_BASE:-https://api.elevenlabs.io}"

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
  read -r -s -p "ELEVENLABS_API_KEY einfuegen (Eingabe bleibt unsichtbar): " NEW_KEY
  echo
fi
NEW_KEY=$(printf '%s' "$NEW_KEY" | tr -d '[:space:]')
NEW_KEY=${NEW_KEY#ELEVENLABS_API_KEY=}
NEW_KEY=${NEW_KEY#\"}; NEW_KEY=${NEW_KEY%\"}
NEW_KEY=${NEW_KEY#\'}; NEW_KEY=${NEW_KEY%\'}

[ -n "$NEW_KEY" ] || { echo "FEHLER: leere Eingabe. Abbruch, nichts geschrieben." >&2; exit 1; }

HTTP=$(curl -s -o /tmp/eleven-check.$$ -w "%{http_code}" \
  -H "xi-api-key: $NEW_KEY" "$API_BASE/v1/user/subscription")
if [ "$HTTP" != "200" ]; then
  echo "FEHLER: ElevenLabs-API antwortet HTTP $HTTP (erwartet 200). Key beginnt mit '${NEW_KEY:0:4}...', Laenge ${#NEW_KEY}. Abbruch, nichts geschrieben." >&2
  rm -f /tmp/eleven-check.$$
  exit 1
fi
echo "API-Check: HTTP 200 - Key ist gueltig."

BACKUP="$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
cp "$ENV_FILE" "$BACKUP" && chmod 600 "$BACKUP"
export NEW_KEY
awk 'BEGIN{done=0}
  /^ELEVENLABS_API_KEY=/{print "ELEVENLABS_API_KEY=" ENVIRON["NEW_KEY"]; done=1; next}
  {print}
  END{if(!done) print "ELEVENLABS_API_KEY=" ENVIRON["NEW_KEY"]}' "$BACKUP" > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "OK: Key gesetzt (Backup: $BACKUP)."

echo
echo "Aktueller ElevenLabs-Stand:"
python3 - /tmp/eleven-check.$$ <<'PY' || echo "  (Antwort nicht lesbar - Key ist trotzdem gesetzt)"
import json, sys
d = json.load(open(sys.argv[1]))
used, limit = d.get("character_count"), d.get("character_limit")
print(f"  Tarif:      {d.get('tier','?')}")
print(f"  Verbraucht: {used} von {limit} Zeichen" + (f"  ({used/limit*100:.1f} %)" if used is not None and limit else ""))
reset = d.get("next_character_count_reset_unix")
if reset:
    import datetime
    print(f"  Reset am:   {datetime.datetime.utcfromtimestamp(reset).strftime('%Y-%m-%d')} (UTC)")
PY
rm -f /tmp/eleven-check.$$
