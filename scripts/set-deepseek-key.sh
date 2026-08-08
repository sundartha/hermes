#!/bin/bash
# Setzt/ersetzt DEEPSEEK_API_KEY in der .env - ohne den Key je anzuzeigen oder in
# Shell-History/Prozessliste zu leaken (Eingabe via read -s, Uebergabe an awk via
# Umgebungsvariable statt Argument). Prueft den Key vor dem Schreiben live gegen die
# DeepSeek-API (read-only, kostenfrei) und legt ein Backup der .env an.
#
# Aufruf:  bash scripts/set-deepseek-key.sh [--from-clipboard] [pfad/zur/.env]
#   --from-clipboard: Key aus der macOS-Zwischenablage (pbpaste) statt Tastatur-
#   Eingabe lesen - noetig, wenn kein TTY da ist (z.B. Ausfuehrung aus einer
#   Claude-Code-Session), und generell bequemer: Key kopieren, Skript starten.
# Default-Ziel: .env im HAUPT-Repo (auch wenn das Skript aus einem Worktree laeuft).
#
# Schwester von set-anthropic-key.sh und set-elevenlabs-key.sh. Wie bei ElevenLabs
# wird das Key-FORMAT bewusst NICHT geprueft: eine Prefix-Regel wuerde einen gueltigen
# Key ablehnen, sobald der Anbieter das Format aendert. Die Echtheitspruefung ist
# allein der Live-Aufruf - der kann nicht irren.
#
# Warum ausgerechnet /user/balance als Pruefaufruf: er ist read-only und kostenfrei,
# UND er ist genau der Endpunkt, an dem die B1-Messung (scripts/deepseek-b1-messung.mjs)
# ihre Kernzahl erhebt. Ein gruener Check hier belegt vor dem ~50-Minuten-Lauf, dass der
# Endpunkt antwortet - und zeigt nebenbei Waehrung und Nachkommastellen des Guthabens,
# also die Aufloesung, um die es in Messfrage M2a geht.
set -euo pipefail

API_BASE="${DEEPSEEK_API_BASE:-https://api.deepseek.com}"

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
echo "HINWEIS: Ist die .env gerade im Editor offen, danach dort NEU LADEN - sonst"
echo "         ueberschreibt ein Speichern aus dem Editor den frisch gesetzten Key."

# Key beziehen: Zwischenablage (--from-clipboard) oder verdeckte Tastatur-Eingabe.
# Beides landet nie im Terminal, nie in der History, nie in der Prozessliste.
if [ "$FROM_CLIPBOARD" = "1" ]; then
  NEW_KEY=$(pbpaste)
  echo "Key aus der Zwischenablage gelesen."
else
  [ -t 0 ] || { echo "FEHLER: kein TTY fuer verdeckte Eingabe - nutze --from-clipboard (Key vorher kopieren)." >&2; exit 1; }
  read -r -s -p "DEEPSEEK_API_KEY einfuegen (Eingabe bleibt unsichtbar): " NEW_KEY
  echo
fi
NEW_KEY=$(printf '%s' "$NEW_KEY" | tr -d '[:space:]')
# Tolerant gegen "ganze Zeile kopiert": fuehrendes DEEPSEEK_API_KEY= und
# umgebende Anfuehrungszeichen abstreifen.
NEW_KEY=${NEW_KEY#DEEPSEEK_API_KEY=}
NEW_KEY=${NEW_KEY#\"}; NEW_KEY=${NEW_KEY%\"}
NEW_KEY=${NEW_KEY#\'}; NEW_KEY=${NEW_KEY%\'}

[ -n "$NEW_KEY" ] || { echo "FEHLER: leere Eingabe. Abbruch, nichts geschrieben." >&2; exit 1; }

# Live-Pruefung VOR dem Schreiben: ungueltige Keys kommen gar nicht erst in die .env.
CHECK_BODY=$(mktemp -t deepseek-check)
trap 'rm -f "$CHECK_BODY"' EXIT
HTTP=$(curl -s -o "$CHECK_BODY" -w "%{http_code}" --max-time 30 \
  -H "Authorization: Bearer $NEW_KEY" "$API_BASE/user/balance")
if [ "$HTTP" != "200" ]; then
  echo "FEHLER: DeepSeek-API antwortet HTTP $HTTP (erwartet 200). Key beginnt mit '${NEW_KEY:0:3}...', Laenge ${#NEW_KEY}. Abbruch, nichts geschrieben." >&2
  echo "        401 = falscher Key, 402 = Guthaben leer, 429 = Ratenlimit." >&2
  exit 1
fi
echo "API-Check: HTTP 200 - Key ist gueltig."

# Backup, dann Zeile ersetzen (bzw. anhaengen, falls keine existiert). Key geht als
# Umgebungsvariable an awk - nie als Prozess-Argument (waere via ps sichtbar).
BACKUP="$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
cp "$ENV_FILE" "$BACKUP" && chmod 600 "$BACKUP"
export NEW_KEY
awk 'BEGIN{done=0}
  /^DEEPSEEK_API_KEY=/{print "DEEPSEEK_API_KEY=" ENVIRON["NEW_KEY"]; done=1; next}
  {print}
  END{if(!done) print "DEEPSEEK_API_KEY=" ENVIRON["NEW_KEY"]}' "$BACKUP" > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "OK: Key gesetzt (Backup: $BACKUP)."

# Sofort-Nutzen: Guthaben je Waehrung zeigen - der Ausgangswert, gegen den die
# B1-Messung ihr Gesamt-Delta rechnet. Nur Aggregate, kein Key.
echo
echo "DeepSeek-Guthaben (Ausgangswert fuer die B1-Messung):"
python3 - "$CHECK_BODY" <<'PY' || echo "  (Antwort nicht lesbar - Key ist trotzdem gesetzt)"
import json, sys
d = json.load(open(sys.argv[1]))
print(f"  is_available: {d.get('is_available')}")
infos = d.get("balance_infos") or []
if not infos:
    print("  WARNUNG: balance_infos ist leer - die Guthaben-Achse der Messung haette keine Quelle.")
for info in infos:
    total = info.get("total_balance", "?")
    decimals = len(total.split(".")[1]) if "." in str(total) else 0
    print(f"  {info.get('currency','?')}: total={total}  granted={info.get('granted_balance','?')}  "
          f"topped_up={info.get('topped_up_balance','?')}  -> {decimals} Nachkommastellen (M2a-Aufloesung)")
PY
