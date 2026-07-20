#!/bin/bash
# Setzt/ersetzt ELEVENLABS_API_KEY in der .env - ohne den Key je anzuzeigen oder in
# Shell-History/Prozessliste zu leaken (Eingabe via read -s, Uebergabe an awk via
# Umgebungsvariable statt Argument). Prueft den Key vor dem Schreiben live gegen die
# ElevenLabs-API (read-only, kostenfrei) und legt ein Backup der .env an.
#
# Aufruf:  bash scripts/set-elevenlabs-key.sh [--from-clipboard] [pfad/zur/.env]
#   --from-clipboard: Key aus der macOS-Zwischenablage (pbpaste) statt Tastatur-
#   Eingabe lesen - noetig, wenn kein TTY da ist (z.B. Ausfuehrung aus einer
#   Claude-Code-Session), und generell bequemer: Key kopieren, Skript starten.
# Default-Ziel: .env im HAUPT-Repo (auch wenn das Skript aus einem Worktree laeuft).
#
# Schwester von set-anthropic-key.sh. EIN bewusster Unterschied: dort wird das
# Key-Format hart geprueft (sk-ant-...), hier NICHT. ElevenLabs hat ueber die Zeit
# mehrere Key-Formate ausgegeben; eine Prefix-Pruefung wuerde gueltige Keys
# faelschlich ablehnen. Die Echtheitspruefung ist deshalb allein der Live-Aufruf.
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

# Ziel-.env aufloesen: Argument > Haupt-Repo-Wurzel (git-common-dir zeigt auch aus
# einem Worktree heraus auf das .git des Haupt-Checkouts) > ./ .env
if [ -n "$ENV_ARG" ]; then
  ENV_FILE="$ENV_ARG"
elif COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null); then
  ENV_FILE="$(cd "$(dirname "$COMMON_DIR")" && pwd)/.env"
else
  ENV_FILE="./.env"
fi
[ -f "$ENV_FILE" ] || { echo "FEHLER: $ENV_FILE existiert nicht." >&2; exit 1; }
echo "Ziel: $ENV_FILE"

# Key beziehen: Zwischenablage (--from-clipboard) oder verdeckte Tastatur-Eingabe.
# Beides landet nie im Terminal, nie in der History, nie in der Prozessliste.
if [ "$FROM_CLIPBOARD" = "1" ]; then
  NEW_KEY=$(pbpaste)
  echo "Key aus der Zwischenablage gelesen."
else
  [ -t 0 ] || { echo "FEHLER: kein TTY fuer verdeckte Eingabe - nutze --from-clipboard (Key vorher kopieren)." >&2; exit 1; }
  read -r -s -p "ELEVENLABS_API_KEY einfuegen (Eingabe bleibt unsichtbar): " NEW_KEY
  echo
fi
NEW_KEY=$(printf '%s' "$NEW_KEY" | tr -d '[:space:]')
# Tolerant gegen "ganze Zeile kopiert": fuehrendes ELEVENLABS_API_KEY= und
# umgebende Anfuehrungszeichen abstreifen.
NEW_KEY=${NEW_KEY#ELEVENLABS_API_KEY=}
NEW_KEY=${NEW_KEY#\"}; NEW_KEY=${NEW_KEY%\"}
NEW_KEY=${NEW_KEY#\'}; NEW_KEY=${NEW_KEY%\'}

[ -n "$NEW_KEY" ] || { echo "FEHLER: leere Eingabe. Abbruch, nichts geschrieben." >&2; exit 1; }

# Live-Pruefung VOR dem Schreiben: ungueltige Keys kommen gar nicht erst in die .env.
# /v1/user/subscription ist read-only und verbraucht KEINE Credits.
HTTP=$(curl -s -o /tmp/eleven-check.$$ -w "%{http_code}" \
  -H "xi-api-key: $NEW_KEY" "$API_BASE/v1/user/subscription")
if [ "$HTTP" != "200" ]; then
  echo "FEHLER: ElevenLabs-API antwortet HTTP $HTTP (erwartet 200). Key beginnt mit '${NEW_KEY:0:4}...', Laenge ${#NEW_KEY}. Abbruch, nichts geschrieben." >&2
  rm -f /tmp/eleven-check.$$
  exit 1
fi
echo "API-Check: HTTP 200 - Key ist gueltig."

# Backup, dann Zeile ersetzen (bzw. anhaengen, falls keine existiert). Key geht als
# Umgebungsvariable an awk - nie als Prozess-Argument (waere via ps sichtbar).
BACKUP="$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
cp "$ENV_FILE" "$BACKUP" && chmod 600 "$BACKUP"
export NEW_KEY
awk 'BEGIN{done=0}
  /^ELEVENLABS_API_KEY=/{print "ELEVENLABS_API_KEY=" ENVIRON["NEW_KEY"]; done=1; next}
  {print}
  END{if(!done) print "ELEVENLABS_API_KEY=" ENVIRON["NEW_KEY"]}' "$BACKUP" > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "OK: Key gesetzt (Backup: $BACKUP)."

# Sofort-Nutzen: aktuellen Verbrauch zeigen (der Grund, warum der Key hinterlegt wird).
# Nur Aggregate - kein Key, keine Kunden-Daten.
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
