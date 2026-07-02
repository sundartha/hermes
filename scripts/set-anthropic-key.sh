#!/bin/bash
# Setzt/ersetzt ANTHROPIC_API_KEY in der .env - ohne den Key je anzuzeigen oder in
# Shell-History/Prozessliste zu leaken (Eingabe via read -s, Uebergabe an awk via
# Umgebungsvariable statt Argument). Prueft den Key vor dem Schreiben live gegen
# die Anthropic-API (Minimal-Request, ~0 Kosten) und legt ein Backup der .env an.
#
# Aufruf:  bash scripts/set-anthropic-key.sh [--from-clipboard] [pfad/zur/.env]
#   --from-clipboard: Key aus der macOS-Zwischenablage (pbpaste) statt Tastatur-
#   Eingabe lesen - noetig, wenn kein TTY da ist (z.B. Ausfuehrung aus einer
#   Claude-Code-Session), und generell bequemer: Key kopieren, Skript starten.
# Default-Ziel: .env im HAUPT-Repo (auch wenn das Skript aus einem Worktree laeuft).
set -euo pipefail

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
  read -r -s -p "Neuen ANTHROPIC_API_KEY einfuegen (Eingabe bleibt unsichtbar): " NEW_KEY
  echo
fi
NEW_KEY=$(printf '%s' "$NEW_KEY" | tr -d '[:space:]')

case "$NEW_KEY" in
  sk-ant-*) ;;
  *) echo "FEHLER: Key beginnt nicht mit sk-ant- (Laenge ${#NEW_KEY}). Abbruch, nichts geschrieben." >&2; exit 1 ;;
esac

# Live-Pruefung VOR dem Schreiben: ungueltige Keys kommen gar nicht erst in die .env.
HTTP=$(curl -s -o /dev/null -w "%{http_code}" https://api.anthropic.com/v1/messages \
  -H "x-api-key: $NEW_KEY" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":1,"messages":[{"role":"user","content":"ok"}]}')
if [ "$HTTP" != "200" ]; then
  echo "FEHLER: Anthropic-API antwortet HTTP $HTTP (erwartet 200). Abbruch, nichts geschrieben." >&2
  exit 1
fi
echo "API-Check: HTTP 200 - Key ist gueltig."

# Backup, dann Zeile ersetzen (bzw. anhaengen, falls keine existiert). Key geht als
# Umgebungsvariable an awk - nie als Prozess-Argument (waere via ps sichtbar).
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
