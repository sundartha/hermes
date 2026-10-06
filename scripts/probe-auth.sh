#!/usr/bin/env bash
set -uo pipefail

MODUS_IST_AUFNAHME="ist-aufnahme"
MODUS_NACH_P7="nach-p7"

PLATZHALTER="probe-nicht-vorhanden-12345"
MIN_SHA_LAENGE=7
HTTP_RATE_LIMIT=429
KEINE_ANTWORT="000"
ZEITLIMIT_S=15
VERBINDUNGSLIMIT_S=10
KENNUNG="hermes-probe-auth"

EXIT_ABWEICHUNG=1
EXIT_ABBRUCH=2

ERWARTUNGEN=$(
  cat <<'TABELLE'
oeffentlich|GET|/healthz|200|keine|Keep-Alive und Deploy-Wahrheit, vor jeder Auth-Schicht gemountet
oeffentlich|GET|/api/plans|200|keine|oeffentlicher Tarifkatalog, registerPublicRoutes
oeffentlich|GET|/.well-known/oauth-protected-resource|200|keine|OAuth-Metadata, registerWellKnown
oeffentlich|GET|/.well-known/oauth-protected-resource/mcp|200|keine|OAuth-Metadata (MCP-Variante)
oeffentlich|GET|/.well-known/openai-apps-challenge|404|keine|Domain-Ownership-Token nicht gesetzt; Route existiert (O-4)
oeffentlich|GET|/.well-known/security.txt|200|keine|RFC-9116-Kontakt, statischer Text
fehlt|POST|/v1/chat/completions|404|keine|in IE6-S1 geloescht (Assistant-Shim); 404 unabhaengig von Env
oeffentlich|GET|/auth/login|302|keine|Einstieg in den OIDC-Login
oeffentlich|GET|/auth/callback|302|keine|ohne state-Cookie -> Neustart des Flows
oeffentlich|POST|/auth/logout|204|keine|ohne Sitzung wirkungslos
oeffentlich|POST|/webhooks/stripe|400|keine|HMAC-Pruefung schlaegt fehl (PAYMENT_ENABLED aus waere 404)
oeffentlich|POST|/webhooks/elevenlabs/consult|403|keine|Werkzeug-Token fehlt -> 403, auch bei leerem ELEVENLABS_TOOL_TOKEN
oeffentlich|POST|/webhooks/elevenlabs/lookup|403|keine|Werkzeug-Token fehlt -> 403, gleiche Bauart wie consult (Thema B)
oeffentlich|POST|/webhooks/elevenlabs/init|403|keine|Init-Token fehlt -> 403, auch bei leerem ELEVENLABS_INIT_WEBHOOK_TOKEN (IEL-B6)
oeffentlich|GET|/intern/anrufe-laufend|401|keine|Deploy-Token fehlt -> 401, auch bei leerem HERMES_DEPLOY_TOKEN (Paket 15)
oeffentlich|GET|/tenant.html|302|keine|Altpfad-Umleitung auf /app
oeffentlich|GET|/login|302|keine|AUTH-P7-Umleitung auf /auth/login
oeffentlich|GET|/signin|302|keine|AUTH-P7-Umleitung auf /auth/login
oeffentlich|GET|/sign-in|302|keine|AUTH-P7-Umleitung auf /auth/login
oeffentlich|GET|/dashboard|302|keine|AUTH-P7-Umleitung auf /app
oeffentlich|GET|/account|302|keine|AUTH-P7-Umleitung auf /app
oeffentlich|GET|/portal|302|keine|AUTH-P7-Umleitung auf /app
oeffentlich|GET|/admin|302|keine|AUTH-P7-Umleitung auf /app (beschattet /api/admin/* NICHT)
oeffentlich|GET|/app/*|200|keine|SPA-Fallback auf die App-Shell
oeffentlich|GET|/voice/tts/:token|404|keine|Einmal-Token ungueltig; Route existiert
oeffentlich|GET|/newsletter/confirm|400|keine|Kein/ungueltiger Bestaetigungs-Token; neutrale Fehlseite
oeffentlich|GET|/newsletter/unsubscribe|400|keine|Kein/ungueltiger Abmelde-Token; neutrale Fehlseite
oeffentlich|POST|/api/cookie-consent|400|keine|Kein Origin/kein gueltiger Einwilligungs-Datensatz; schreibt nichts
oeffentlich|POST|/voice/incoming|403|keine|Provider-Signatur fail-closed
oeffentlich|POST|/voice/turn|403|keine|Provider-Signatur fail-closed
oeffentlich|POST|/voice/outbound|403|keine|Provider-Signatur fail-closed
oeffentlich|POST|/voice/status|403|keine|Provider-Signatur fail-closed
oeffentlich|POST|/voice/el-rueckfall|403|keine|Provider-Signatur fail-closed
oeffentlich|POST|/voice/el-bein|403|keine|Provider-Signatur fail-closed
oeffentlich|GET|/mcp|405|keine|Transport ist POST-only
oeffentlich|DELETE|/mcp|405|keine|Transport ist POST-only
sitzung|POST|/mcp|401|mcpauth|mcpAuth fail-closed (Bearer-Challenge, keine Basic-)
sitzung|GET|/api/state|403|internal|internalOnly: kein lokaler In-Process-Aufrufer
sitzung|GET|/api/calls/:id|403|internal|internalOnly: kein lokaler In-Process-Aufrufer
sitzung|POST|/api/calls|403|internal|internalOnly - loest echte Anrufe aus
sitzung|POST|/api/calls/:id/cancel|403|internal|internalOnly
sitzung|GET|/api/calls/:id/consult|403|internal|internalOnly
sitzung|POST|/api/calls/:id/consult/answer|403|internal|internalOnly
sitzung|GET|/api/tenant-data/export|403|internal|internalOnly - Transkripte
sitzung|POST|/api/inbox/poll|403|internal|internalOnly - Gespraechsergebnisse
sitzung|POST|/api/billing/setup-checkout|403|internal|internalOnly (AUTH-P7, P9 loescht) - Geld-Route
sitzung|GET|/api/billing/checkout-return|403|internal|internalOnly (AUTH-P7, P9 loescht)
sitzung|POST|/api/billing/flush-meters|401|webauth|webAuth vor adminOnly - 401 vor 403, Geld-Route
sitzung|POST|/api/billing/cost-truing/sweep|401|webauth|webAuth vor adminOnly - 401 vor 403
sitzung|GET|/api/billing/cost-drift|401|webauth|webAuth vor adminOnly - 401 vor 403
sitzung|GET|/api/billing/platform-costs|401|webauth|webAuth vor adminOnly - 401 vor 403
sitzung|POST|/api/onboard|401|webauth|webAuth vor adminOnly - kauft Nummern
sitzung|POST|/api/onboard/retry|401|webauth|webAuth vor adminOnly - kauft Nummern
sitzung|GET|/api/portal/state|401|webauth|Sitzungs-Cookie fehlt
sitzung|GET|/api/self-service/state|401|webauth|Sitzungs-Cookie fehlt
sitzung|POST|/api/self-service/settings|401|webauth|Sitzungs-Cookie fehlt
sitzung|POST|/api/self-service/private-number|401|webauth|Sitzungs-Cookie fehlt
sitzung|GET|/api/self-service/billing/status|401|webauth|Sitzungs-Cookie fehlt
sitzung|POST|/api/self-service/billing/setup-checkout|401|webauth|Geld-Route, Sitzungs-Cookie fehlt
sitzung|POST|/api/self-service/billing/subscribe|401|webauth|Geld-Route, Sitzungs-Cookie fehlt
sitzung|GET|/api/self-service/billing/return|401|webauth|Sitzungs-Cookie fehlt
sitzung|GET|/api/admin/deploy-info|401|webauth|webAuth vor adminOnly - 401 vor 403
sitzung|GET|/api/admin/tenants|401|webauth|webAuth vor adminOnly - 401 vor 403
sitzung|POST|/api/admin/tenants/:id/approve|401|webauth|webAuth vor adminOnly - 401 vor 403
sitzung|POST|/api/admin/tenants/:id/suspend|401|webauth|webAuth vor adminOnly - 401 vor 403
statisch|GET|/|200|keine|Marketing-Startseite aus WEB_DIST_DIR
statisch|GET|/app/|200|keine|App-Shell aus WEB_DIST_DIR
statisch|GET|/favicon.ico|200|keine|Marken-Asset aus public/
statisch|GET|/brand/hermes-icon.png|200|keine|Marken-Asset aus public/
fehlt|GET|/diese-route-gibt-es-nicht-12345|404|keine|Express-404 - nichts maskiert ihn mehr
fehlt|POST|/api/settings|404|keine|in AUTH-P4 geloescht; ab AUTH-P7 sichtbar 404
fehlt|POST|/api/action-items/:id/toggle|404|keine|in AUTH-P4 geloescht; ab AUTH-P7 sichtbar 404
fehlt|POST|/api/calendar|404|keine|in AUTH-P4 geloescht; ab AUTH-P7 sichtbar 404
fehlt|GET|/api/profiles|404|keine|in AUTH-P4 geloescht; ab AUTH-P7 sichtbar 404
fehlt|POST|/api/profiles|404|keine|in AUTH-P4 geloescht; haette das Verifikations-Gate ausgehebelt
fehlt|DELETE|/api/profiles/:tenantId|404|keine|in AUTH-P4 geloescht; ab AUTH-P7 sichtbar 404
TABELLE
)

abbruch() {
  echo "ABBRUCH: $1" >&2
  exit "$EXIT_ABBRUCH"
}

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Aufruf: $0 <basis-url> <erwarteter-commit> [$MODUS_NACH_P7|$MODUS_IST_AUFNAHME]" >&2
  echo "  Beispiel: $0 https://app.sundartha.com a1b2c3d $MODUS_NACH_P7" >&2
  exit "$EXIT_ABBRUCH"
fi

BASIS_URL="${1%/}"
ERWARTETER_COMMIT="$2"
MODUS="${3:-$MODUS_NACH_P7}"

case "$MODUS" in
  "$MODUS_IST_AUFNAHME" | "$MODUS_NACH_P7") ;;
  *) abbruch "unbekannter Modus '$MODUS' (erlaubt: $MODUS_IST_AUFNAHME, $MODUS_NACH_P7)" ;;
esac
if [ "${#ERWARTETER_COMMIT}" -lt "$MIN_SHA_LAENGE" ]; then
  abbruch "Commit '$ERWARTETER_COMMIT' ist kuerzer als $MIN_SHA_LAENGE Zeichen - zu unspezifisch fuer einen Ziel-Pin"
fi

KOPFZEILEN="$(mktemp)"
trap 'rm -f "$KOPFZEILEN"' EXIT

status_von() {
  local methode="$1" url="$2"
  local -a argumente=(
    -sS -o /dev/null -D "$KOPFZEILEN" -w '%{http_code}'
    --connect-timeout "$VERBINDUNGSLIMIT_S" --max-time "$ZEITLIMIT_S"
    -A "$KENNUNG" -X "$methode"
  )
  if [ "$methode" != "GET" ]; then
    argumente+=(-H "Content-Type: application/json" -d '{}')
  fi
  curl "${argumente[@]}" "$url" 2>/dev/null || printf '%s' "$KEINE_ANTWORT"
}

hat_basic_challenge() {
  grep -qiE '^www-authenticate:[[:space:]]*basic' "$KOPFZEILEN"
}

probe_pfad() {
  printf '%s' "$1" | sed -e "s#:[A-Za-z][A-Za-z0-9_]*#$PLATZHALTER#g" -e "s#\*#$PLATZHALTER#g"
}

GESUNDHEIT="$(curl -sS --connect-timeout "$VERBINDUNGSLIMIT_S" --max-time "$ZEITLIMIT_S" \
  -A "$KENNUNG" -w '\n%{http_code}' "$BASIS_URL/healthz" 2>/dev/null)" ||
  abbruch "GET $BASIS_URL/healthz nicht erreichbar"

GESUNDHEIT_STATUS="$(printf '%s' "$GESUNDHEIT" | tail -n 1)"
[ "$GESUNDHEIT_STATUS" = "200" ] || abbruch "GET /healthz lieferte $GESUNDHEIT_STATUS statt 200"

GEMELDETER_COMMIT="$(printf '%s' "$GESUNDHEIT" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p')"
[ -n "$GEMELDETER_COMMIT" ] || abbruch "/healthz nennt keinen Commit - Ziel-Pin nicht pruefbar"

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
