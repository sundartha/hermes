#!/usr/bin/env bash
# ---- Live-Probe der Routen-Absicherung (PLAN-AUTH-GATE P2) ------------------------
# Fragt JEDE Route der laufenden Instanz OHNE Sitzung und ohne Credentials ab und
# vergleicht Statuscode und antwortende Sicherung mit einer im Skript stehenden
# Erwartung. Genau das ist der Punkt: was ein Fremder ohne Login sieht. Gegenstueck zum
# Inventar-Test (test/route-auth-inventory.test.js), der denselben Routenbestand
# statisch prueft - die Probe misst den DEPLOYTEN Zustand, der Test den Quellstand.
#
# ZIEL-PIN (W7): URL UND erwarteter Commit sind Pflichtargumente. Ohne den Pin laeuft
# die Probe gruen gegen Staging oder einen alten Deploy, waehrend Produktion offen
# steht. Erste Handlung ist deshalb GET /healthz; weicht der Commit ab -> Abbruch,
# Exit 2, KEINE weitere Anfrage.
#
# 404 IST KEIN ERFOLG (W6). Fuer sitzungspflichtige Routen zaehlt nur 401/403. Ein 404
# heisst, dass guardedBoot (src/boot-guard.js, fail-open) den Web-Login-Block
# verschluckt hat und die Route gar nicht gemountet ist - /healthz bliebe dabei 200 und
# der Ausfall unsichtbar.
# ABER: solange das Basic-Auth-Gate steht, sieht man diesen 404 gar nicht. Das Gate
# haengt VOR dem 404-Handler und beantwortet jeden unbekannten Pfad mit 401 - eine
# fehlende Route ist damit von einer geschuetzten nicht zu unterscheiden. Deshalb
# prueft die Probe zusaetzlich, WER geantwortet hat: die Basic-Challenge
# (WWW-Authenticate: Basic) ist der Fingerabdruck des Gates. Traegt eine Route, die vom
# Sitzungs-Cookie geschuetzt sein SOLL, ploetzlich diese Challenge, dann ist der
# Web-Login-Block nicht gemountet - genau der Zustand, den W6 meint, nur heute schon
# sichtbar.
#
# SICHERHEITSZUSAGEN:
#   - keine Credentials, kein Cookie, kein Token - weder als Argument noch im Skript.
#   - Antwort-KOERPER werden verworfen (-o /dev/null): dort koennten Tenant-Daten
#     stehen. Ausgewertet werden nur Statuszeile und Kopfzeilen.
#   - POST-Zeilen senden einen leeren JSON-Koerper ({}): jede Pflichtfeld-Pruefung
#     schlaegt VOR jedem Seiteneffekt fehl (src/routes/api-onboard.js, api-calls.js).
#     Es wird nichts gekauft, nichts angerufen, nichts geschrieben.
#   - EIN Durchlauf, kein Retry. Der Endpunkt ist Produktion.
#   - Der Lauf erzeugt auth_failed-Zeilen im Server-Log. Das ist erwartet.
#
# Aufruf:  scripts/probe-auth.sh <basis-url> <erwarteter-commit> [modus]
#   modus = ist-aufnahme (Vorgabe) | nach-p7
# Exit:    0 = alle Erwartungen erfuellt · 1 = mindestens eine Abweichung
#          2 = Abbruch vor der Messung (Argumente, /healthz, Commit, Rate-Limit)
set -uo pipefail

MODUS_IST_AUFNAHME="ist-aufnahme"
MODUS_NACH_P7="nach-p7"

# Platzhalter fuer Pfad-Parameter (:id) und Wildcards (*). Bewusst ein Wert, den es
# nicht gibt: die Probe darf keinen echten Datensatz treffen.
PLATZHALTER="probe-nicht-vorhanden-12345"
# Kuerzeste Commit-Angabe, die noch eindeutig genug ist (git-Konvention).
MIN_SHA_LAENGE=7
# Der Endpunkt liegt hinter dem IP-Rate-Limiter (src/middleware.js). Ein 429 macht die
# Messung unbrauchbar - dann lieber abbrechen als Falschmeldungen produzieren.
HTTP_RATE_LIMIT=429
# curl meldet einen fehlgeschlagenen Verbindungsaufbau als Code 000.
KEINE_ANTWORT="000"
ZEITLIMIT_S=15
VERBINDUNGSLIMIT_S=10
# Macht den Lauf in fremden Zugriffslogs als Probe erkennbar (kein Angriff).
KENNUNG="hermes-probe-auth"

EXIT_ABWEICHUNG=1
EXIT_ABBRUCH=2

# ---- Erwartungstabelle ------------------------------------------------------------
# Spalten: ART|METHODE|PFAD|STATUS|ANTWORTET|BEGRUENDUNG
#
# PFAD ist der Express-Pfad und damit derselbe Schluessel wie in src/route-policy.js -
# EINE Wahrheit, maschinell gepinnt durch test/probe-auth-table.test.js. Die konkrete
# Probe-URL entsteht daraus, indem :param und * durch den Platzhalter ersetzt werden.
#
# ART - die Sicherheitsaussage, die ueber alle Phasen gleich bleibt:
#   sitzung     - darf ohne Sitzung NICHT bedienbar sein (401/403; 404 = Durchfall, W6)
#   oeffentlich - bewusst ohne Sitzung erreichbar; steht in PUBLIC_ROUTES
#   statisch    - statisch ausgeliefert, keine Express-Route (darum nicht im Inventar)
#   fehlt       - darf es nicht geben (Negativkontrolle)
#
# ANTWORTET - welche Schicht die Antwort geben soll. Nur "gate" sendet die
# Basic-Challenge; jeder andere Wert verlangt, dass sie FEHLT:
#   gate     - src/wiring/auth-gate.js (die Sammelsicherung, die dieser Plan aufloest)
#   webauth  - webAuthGateMiddleware (Sitzungs-Cookie)
#   mcpauth  - src/auth.js (Bearer/OAuth; sendet eine Bearer-Challenge, keine Basic-)
#   keine    - Route bzw. Asset antwortet selbst
#
# STATUS ist der IST-Stand des heutigen Deploys, nicht der Zielzustand.
# H10: diese Werte werden IM SELBEN COMMIT geaendert wie die Phase, die sie aendert -
# eine Probe, die nach einem Deploy "halt anders" ist, trainiert die Geste, rote
# Sicherheitsproben wegzuklicken.
ERWARTUNGEN=$(
  cat <<'TABELLE'
oeffentlich|GET|/healthz|200|keine|Keep-Alive und Deploy-Wahrheit, Gate-exempt
oeffentlich|GET|/api/plans|200|keine|oeffentlicher Tarifkatalog, vor dem Gate gemountet
oeffentlich|GET|/.well-known/oauth-protected-resource|200|keine|OAuth-Metadata, Gate-exempt
oeffentlich|GET|/.well-known/oauth-protected-resource/mcp|200|keine|OAuth-Metadata, Gate-exempt
oeffentlich|POST|/v1/chat/completions|403|keine|Telnyx-Shim: Flag an, Bearer fehlt -> 403 (Flag aus waere 404)
oeffentlich|GET|/auth/login|302|keine|Einstieg in den OIDC-Login
oeffentlich|GET|/auth/callback|302|keine|ohne state-Cookie -> Neustart des Flows
oeffentlich|POST|/auth/logout|204|keine|ohne Sitzung wirkungslos
oeffentlich|POST|/webhooks/stripe|400|keine|HMAC-Pruefung schlaegt fehl (PAYMENT_ENABLED aus waere 404)
oeffentlich|GET|/tenant.html|302|keine|Altpfad-Umleitung auf /app
oeffentlich|GET|/app/*|200|keine|SPA-Fallback auf die App-Shell
oeffentlich|GET|/voice/tts/:token|404|keine|Einmal-Token ungueltig; Route existiert
oeffentlich|POST|/voice/incoming|403|keine|Provider-Signatur fail-closed
oeffentlich|POST|/voice/turn|403|keine|Provider-Signatur fail-closed
oeffentlich|POST|/voice/outbound|403|keine|Provider-Signatur fail-closed
oeffentlich|POST|/voice/status|403|keine|Provider-Signatur fail-closed
oeffentlich|POST|/voice/call-control|403|keine|Provider-Signatur fail-closed
oeffentlich|GET|/mcp|405|keine|Transport ist POST-only
oeffentlich|DELETE|/mcp|405|keine|Transport ist POST-only
sitzung|POST|/mcp|401|mcpauth|mcpAuth fail-closed
sitzung|GET|/api/state|401|gate|Basic-Auth-Gate (P5: internalOnly -> 403)
sitzung|GET|/api/calls/:id|401|gate|Basic-Auth-Gate (P5: internalOnly)
sitzung|POST|/api/calls|401|gate|Basic-Auth-Gate (P5: internalOnly) - loest echte Anrufe aus
sitzung|POST|/api/calls/:id/cancel|401|gate|Basic-Auth-Gate (P5: internalOnly)
sitzung|GET|/api/calls/:id/consult|401|gate|Basic-Auth-Gate (P5: internalOnly)
sitzung|POST|/api/calls/:id/consult/answer|401|gate|Basic-Auth-Gate (P5: internalOnly)
sitzung|GET|/api/tenant-data/export|401|gate|Basic-Auth-Gate (P5: internalOnly) - Transkripte
sitzung|POST|/api/billing/flush-meters|401|gate|Basic-Auth-Gate (P6) - Geld-Route
sitzung|POST|/api/billing/setup-checkout|401|gate|Basic-Auth-Gate (P9) - Geld-Route
sitzung|GET|/api/billing/checkout-return|401|gate|Basic-Auth-Gate (P9)
sitzung|POST|/api/billing/cost-truing/sweep|401|gate|Basic-Auth-Gate (P6)
sitzung|GET|/api/billing/cost-drift|401|gate|Basic-Auth-Gate (P6)
sitzung|GET|/api/billing/platform-costs|401|gate|Basic-Auth-Gate (P6)
sitzung|POST|/api/onboard|401|gate|Basic-Auth-Gate (P6) - kauft Nummern
sitzung|POST|/api/onboard/retry|401|gate|Basic-Auth-Gate (P6) - kauft Nummern
sitzung|GET|/api/portal/state|401|webauth|Sitzungs-Cookie fehlt
sitzung|GET|/api/self-service/state|401|webauth|Sitzungs-Cookie fehlt
sitzung|POST|/api/self-service/settings|401|webauth|Sitzungs-Cookie fehlt
sitzung|POST|/api/self-service/private-number|401|webauth|Sitzungs-Cookie fehlt
sitzung|GET|/api/self-service/billing/status|401|webauth|Sitzungs-Cookie fehlt
sitzung|POST|/api/self-service/billing/setup-checkout|401|webauth|Geld-Route, Sitzungs-Cookie fehlt
sitzung|POST|/api/self-service/billing/subscribe|401|webauth|Geld-Route, Sitzungs-Cookie fehlt
sitzung|GET|/api/self-service/billing/return|401|webauth|Sitzungs-Cookie fehlt
sitzung|GET|/api/admin/tenants|401|webauth|webAuth vor adminOnly - 401 vor 403
sitzung|POST|/api/admin/tenants/:id/approve|401|webauth|webAuth vor adminOnly - 401 vor 403
sitzung|POST|/api/admin/tenants/:id/suspend|401|webauth|webAuth vor adminOnly - 401 vor 403
statisch|GET|/|200|keine|Marketing-Startseite aus WEB_DIST_DIR
statisch|GET|/app/|200|keine|App-Shell aus WEB_DIST_DIR
statisch|GET|/favicon.ico|200|keine|Marken-Asset, Gate-exempt
statisch|GET|/brand/hermes-icon.png|200|keine|Marken-Asset, Gate-exempt
fehlt|GET|/diese-route-gibt-es-nicht-12345|401|gate|heute vom Gate maskiert; ab P7 muss hier 404 stehen
fehlt|GET|/login|401|gate|kein Login-Ziel auf dem Gateway; heute vom Gate maskiert
fehlt|GET|/dashboard|401|gate|kein Dashboard-Ziel auf dem Gateway; heute vom Gate maskiert
fehlt|POST|/api/settings|401|gate|in P4 geloescht; heute vom Gate mit 401 maskiert, ab P7 404
fehlt|POST|/api/action-items/:id/toggle|401|gate|in P4 geloescht; heute vom Gate mit 401 maskiert, ab P7 404
fehlt|POST|/api/calendar|401|gate|in P4 geloescht; heute vom Gate mit 401 maskiert, ab P7 404
fehlt|GET|/api/profiles|401|gate|in P4 geloescht; heute vom Gate mit 401 maskiert, ab P7 404
fehlt|POST|/api/profiles|401|gate|in P4 geloescht; haette das Verifikations-Gate ausgehebelt; ab P7 404
fehlt|DELETE|/api/profiles/:tenantId|401|gate|in P4 geloescht; heute vom Gate mit 401 maskiert, ab P7 404
TABELLE
)

# ---- Argumente --------------------------------------------------------------------
abbruch() {
  echo "ABBRUCH: $1" >&2
  exit "$EXIT_ABBRUCH"
}

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Aufruf: $0 <basis-url> <erwarteter-commit> [$MODUS_IST_AUFNAHME|$MODUS_NACH_P7]" >&2
  echo "  Beispiel: $0 https://app.sundartha.com a1b2c3d $MODUS_IST_AUFNAHME" >&2
  exit "$EXIT_ABBRUCH"
fi

BASIS_URL="${1%/}"
ERWARTETER_COMMIT="$2"
MODUS="${3:-$MODUS_IST_AUFNAHME}"

case "$MODUS" in
  "$MODUS_IST_AUFNAHME" | "$MODUS_NACH_P7") ;;
  *) abbruch "unbekannter Modus '$MODUS' (erlaubt: $MODUS_IST_AUFNAHME, $MODUS_NACH_P7)" ;;
esac
if [ "${#ERWARTETER_COMMIT}" -lt "$MIN_SHA_LAENGE" ]; then
  abbruch "Commit '$ERWARTETER_COMMIT' ist kuerzer als $MIN_SHA_LAENGE Zeichen - zu unspezifisch fuer einen Ziel-Pin"
fi

KOPFZEILEN="$(mktemp)"
trap 'rm -f "$KOPFZEILEN"' EXIT

# ---- Anfragen ----------------------------------------------------------------------
# Schreibt die Kopfzeilen nach $KOPFZEILEN, verwirft den Koerper und gibt NUR den
# Statuscode aus. Ein Retry findet bewusst nicht statt.
status_von() {
  local methode="$1" url="$2"
  local -a argumente=(
    -sS -o /dev/null -D "$KOPFZEILEN" -w '%{http_code}'
    --connect-timeout "$VERBINDUNGSLIMIT_S" --max-time "$ZEITLIMIT_S"
    -A "$KENNUNG" -X "$methode"
  )
  # Leerer JSON-Koerper: alle Pflichtfeld-Pruefungen greifen vor jedem Seiteneffekt.
  if [ "$methode" != "GET" ]; then
    argumente+=(-H "Content-Type: application/json" -d '{}')
  fi
  curl "${argumente[@]}" "$url" 2>/dev/null || printf '%s' "$KEINE_ANTWORT"
}

# Der Fingerabdruck des Basic-Auth-Gates. Die Bearer-Challenge von mcpAuth ist
# ausdruecklich etwas anderes und zaehlt hier nicht mit.
hat_basic_challenge() {
  grep -qiE '^www-authenticate:[[:space:]]*basic' "$KOPFZEILEN"
}

# :param und * -> Platzhalter. Die Tabelle traegt den Express-Pfad (Schluessel wie in
# src/route-policy.js), angefragt wird eine konkrete, garantiert unbelegte URL.
probe_pfad() {
  printf '%s' "$1" | sed -e "s#:[A-Za-z][A-Za-z0-9_]*#$PLATZHALTER#g" -e "s#\*#$PLATZHALTER#g"
}

# ---- Ziel-Pin (W7) ------------------------------------------------------------------
GESUNDHEIT="$(curl -sS --connect-timeout "$VERBINDUNGSLIMIT_S" --max-time "$ZEITLIMIT_S" \
  -A "$KENNUNG" -w '\n%{http_code}' "$BASIS_URL/healthz" 2>/dev/null)" ||
  abbruch "GET $BASIS_URL/healthz nicht erreichbar"

GESUNDHEIT_STATUS="$(printf '%s' "$GESUNDHEIT" | tail -n 1)"
[ "$GESUNDHEIT_STATUS" = "200" ] || abbruch "GET /healthz lieferte $GESUNDHEIT_STATUS statt 200"

GEMELDETER_COMMIT="$(printf '%s' "$GESUNDHEIT" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p')"
[ -n "$GEMELDETER_COMMIT" ] || abbruch "/healthz nennt keinen Commit - Ziel-Pin nicht pruefbar"

# Praefix-Vergleich in beide Richtungen: die kuerzere Angabe muss Praefix der laengeren
# sein (Kurz-SHA gegen vollen SHA und umgekehrt).
case "$GEMELDETER_COMMIT" in "$ERWARTETER_COMMIT"*) PIN_OK=1 ;; *) PIN_OK=0 ;; esac
case "$ERWARTETER_COMMIT" in "$GEMELDETER_COMMIT"*) PIN_OK=1 ;; esac
[ "$PIN_OK" = "1" ] ||
  abbruch "Ziel-Pin verletzt: $BASIS_URL faehrt $GEMELDETER_COMMIT, erwartet war $ERWARTETER_COMMIT"

echo "Ziel:   $BASIS_URL"
echo "Commit: $GEMELDETER_COMMIT (Pin erfuellt)"
echo "Modus:  $MODUS"
if [ "$MODUS" = "$MODUS_IST_AUFNAHME" ]; then
  echo "        Basic-Challenge wird je Zeile gegen die Spalte ANTWORTET geprueft."
else
  echo "        Basic-Challenge MUSS ueberall fehlen - das Gate ist gefallen (P7)."
fi
echo

# ---- Messung -------------------------------------------------------------------------
# Bewertung des Statuscodes. Gibt "OK" oder eine Begruendung aus, die sagt, was der
# Unterschied bedeutet - nicht nur, dass es einer ist.
bewerte_status() {
  local art="$1" erwartet="$2" ist="$3"
  if [ "$ist" = "$erwartet" ]; then
    printf 'OK'
    return
  fi
  if [ "$ist" = "$KEINE_ANTWORT" ]; then
    printf 'ABWEICHUNG (keine Antwort - Zeitlimit oder Verbindungsfehler)'
    return
  fi
  if [ "$art" = "sitzung" ]; then
    case "$ist" in
      404) printf 'DURCHFALL (W6: Route nicht gemountet - guardedBoot fail-open; 404 ist KEIN Schutz)' ;;
      2*) printf 'OFFEN (antwortet ohne Sitzung)' ;;
      401 | 403) printf 'ABWEICHUNG (geschuetzt, aber anders als erwartet - Tabelle im Phasen-Commit nachziehen)' ;;
      *) printf 'ABWEICHUNG' ;;
    esac
    return
  fi
  printf 'ABWEICHUNG'
}

# Bewertung der antwortenden Schicht anhand der Basic-Challenge. Im Modus nach-p7 darf
# es sie nirgends mehr geben; davor entscheidet die Spalte ANTWORTET.
bewerte_challenge() {
  local antwortet="$1" hat_challenge="$2"
  if [ "$MODUS" = "$MODUS_NACH_P7" ]; then
    [ "$hat_challenge" = "1" ] && printf 'ABWEICHUNG (Basic-Challenge vorhanden - das Gate lebt noch)'
    return
  fi
  if [ "$antwortet" = "gate" ] && [ "$hat_challenge" = "0" ]; then
    printf 'ABWEICHUNG (keine Basic-Challenge - das Gate deckt diese Route nicht mehr)'
    return
  fi
  if [ "$antwortet" != "gate" ] && [ "$hat_challenge" = "1" ]; then
    if [ "$antwortet" = "keine" ]; then
      printf 'DURCHFALL (das Gate hat geantwortet, obwohl die Route selbst antworten sollte - nicht gemountet oder Exemption gebrochen, W6)'
    else
      printf 'DURCHFALL (das Gate hat geantwortet, nicht %s - die Route ist nicht gemountet, W6)' "$antwortet"
    fi
  fi
}

GEPRUEFT=0
ABWEICHUNGEN=0

printf '%-11s %-6s %-46s %6s %6s %-8s %s\n' "ART" "METH" "PFAD" "ERWART" "IST" "ANTWORT" "BEFUND"
while IFS='|' read -r art methode pfad erwartet antwortet grund; do
  [ -n "${art:-}" ] || continue
  url="$BASIS_URL$(probe_pfad "$pfad")"
  ist="$(status_von "$methode" "$url")"
  if [ "$ist" = "$HTTP_RATE_LIMIT" ]; then
    abbruch "Rate-Limit ($HTTP_RATE_LIMIT) bei $methode $pfad - Messung unvollstaendig und damit wertlos. Eine Minute warten, dann EINEN neuen Lauf."
  fi
  if hat_basic_challenge; then challenge=1; else challenge=0; fi

  befund="$(bewerte_status "$art" "$erwartet" "$ist")"
  challenge_befund="$(bewerte_challenge "$antwortet" "$challenge")"
  if [ -n "$challenge_befund" ]; then
    [ "$befund" = "OK" ] && befund="$challenge_befund" || befund="$befund + $challenge_befund"
  fi

  GEPRUEFT=$((GEPRUEFT + 1))
  case "$befund" in OK) ;; *) ABWEICHUNGEN=$((ABWEICHUNGEN + 1)) ;; esac
  printf '%-11s %-6s %-46s %6s %6s %-8s %s\n' \
    "$art" "$methode" "$pfad" "$erwartet" "$ist" "$antwortet" "$befund"
done <<<"$ERWARTUNGEN"

echo
echo "$GEPRUEFT Routen geprueft, $ABWEICHUNGEN Abweichung(en)."
[ "$ABWEICHUNGEN" -eq 0 ] || exit "$EXIT_ABWEICHUNG"
