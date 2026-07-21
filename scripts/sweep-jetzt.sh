#!/usr/bin/env bash
# Stoesst den Ist-Kosten-Abgleich (cost-truing sweep) auf dem Live-Dienst an.
# Das Passwort wird VERDECKT eingelesen, nie ausgegeben und nie geloggt.
# Nach dem ersten Lauf liegt es in .env (gitignored) und wird wiederverwendet.
set -u
cd "$(dirname "$0")/.."

ENV_FILE=".env"
URL="https://app.sundartha.com/api/billing/cost-truing/sweep"

# Vorhandenen Wert aus .env holen, ohne die Datei zu sourcen (dort stehen andere Secrets).
PW="$(grep -m1 '^DASHBOARD_PASSWORD=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)"

if [ -z "${PW}" ]; then
  printf 'Passwort fuer app.sundartha.com (Benutzer "admin"): ' >&2
  stty -echo 2>/dev/null; read -r PW; stty echo 2>/dev/null
  printf '\n' >&2
  if [ -z "${PW}" ]; then echo "Kein Passwort eingegeben - Abbruch." >&2; exit 1; fi
  printf '\nDASHBOARD_PASSWORD=%s\n' "$PW" >> "$ENV_FILE"
  echo "-> in .env gespeichert (gitignored, kein Commit)" >&2
fi

echo "Stosse Sweep an ..." >&2
CODE="$(curl -s -o /tmp/sweep-out.json -w '%{http_code}' -u "admin:${PW}" -X POST "$URL")"

if [ "$CODE" = "401" ]; then
  echo "HTTP 401 - Passwort falsch. Zeile aus .env entfernen und erneut versuchen:" >&2
  echo "  grep -v '^DASHBOARD_PASSWORD=' .env > .env.tmp && mv .env.tmp .env" >&2
  exit 1
fi
if [ "$CODE" != "200" ]; then echo "HTTP $CODE - unerwartet:" >&2; cat /tmp/sweep-out.json; exit 1; fi

echo "HTTP 200. Ergebnis:"
node -e 'const r=require("/tmp/sweep-out.json");
const L=[["Kandidaten",r.candidates],["gemessen",r.measured],["unvollstaendig",r.incomplete],
["ohne Schaetzung",r.noEstimate],["unbestimmt",r.unavailable],["uebersprungen",r.skippedCalls],
["fehlgeschlagen",r.failed],["Deckungsquote",r.coveragePercent+" %"]];
for(const [k,v] of L) console.log("  "+String(k).padEnd(18)+v);' 2>/dev/null || cat /tmp/sweep-out.json
rm -f /tmp/sweep-out.json
