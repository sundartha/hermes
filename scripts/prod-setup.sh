#!/usr/bin/env bash
# Live-Erst-Setup gegen die Render-Prod-Postgres (Owner-Removal P2b).
# Kapselt bootstrap-tenant + grant-admin und fragt die External DATABASE_URL
# INTERAKTIV + VERSTECKT ab (nicht in Shell-History, nicht in Prozess-Args, nicht im Chat).
# SSL: Render-External erzwingt SSL -> die URL bekommt automatisch sslmode=require
# angehaengt, falls sie noch keinen sslmode traegt (sonst scheitert die Verbindung).
#
# Reihenfolge:
#   1) scripts/prod-setup.sh number [+e164] [telnyx]   # Bootstrap-Tenant + Nummer
#   2) Render: Manual Deploy / Restart                        # Dienst bootet jetzt durch
#   3) einmal per WorkOS einloggen                            # erzeugt deinen Account-Row
#   4) scripts/prod-setup.sh admin <deine-email>             # Account -> Admin
set -euo pipefail
cd "$(dirname "$0")/.."

cmd="${1:-}"

# DATABASE_URL beschaffen (env hat Vorrang; sonst versteckte Eingabe) + sslmode sichern.
load_db_url() {
  if [[ -z "${DATABASE_URL:-}" ]]; then
    printf 'Render External DATABASE_URL einfuegen (Eingabe versteckt, Enter zum Abschluss):\n' >&2
    read -rs DATABASE_URL
    printf '\n' >&2
  fi
  if [[ -z "${DATABASE_URL:-}" ]]; then
    printf '[prod-setup] Keine DATABASE_URL -> Abbruch.\n' >&2
    exit 1
  fi
  # sslmode=require anhaengen, falls nicht vorhanden (Render-External erzwingt SSL).
  if [[ "$DATABASE_URL" != *"sslmode="* ]]; then
    if [[ "$DATABASE_URL" == *"?"* ]]; then
      DATABASE_URL="${DATABASE_URL}&sslmode=require"
    else
      DATABASE_URL="${DATABASE_URL}?sslmode=require"
    fi
  fi
  export DATABASE_URL
  export STORE_BACKEND=pg
  # Host nur zur Kontrolle ausgeben (KEIN Passwort): alles bis zum @ maskieren.
  local masked="${DATABASE_URL##*@}"
  printf '[prod-setup] Ziel-DB-Host: %s\n' "${masked%%\?*}" >&2
}

case "$cmd" in
  number)
    e164="${2:-+18643028341}"
    provider="${3:-telnyx}"
    load_db_url
    printf '[prod-setup] Schritt 1: bootstrap-tenant %s %s gegen Prod-DB ...\n' "$e164" "$provider" >&2
    npm run bootstrap-tenant -- "$e164" "$provider"
    cat >&2 <<EOF

[prod-setup] OK. Naechste Schritte:
  2) Render: Manual Deploy / Restart  -> Dienst bootet jetzt durch (Boot-Gate gruen)
  3) einmal per WorkOS einloggen       -> erzeugt deinen Account
  4) scripts/prod-setup.sh admin <deine-email>
EOF
    ;;
  admin)
    email="${2:-}"
    if [[ -z "$email" ]]; then
      printf 'Nutzung: scripts/prod-setup.sh admin <email>\n' >&2
      exit 1
    fi
    load_db_url
    printf '[prod-setup] Schritt 4: grant-admin %s gegen Prod-DB ...\n' "$email" >&2
    npm run grant-admin -- "$email"
    ;;
  *)
    cat >&2 <<EOF
Live-Erst-Setup (Owner-Removal P2b) gegen Render-Prod-Postgres.

  scripts/prod-setup.sh number [+e164] [telnyx]
      Schritt 1: legt Bootstrap-Tenant + aktive Nummer an.
      Default: +18643028341 telnyx (deine Telnyx-DID; NICHT die +49-Privatnummer).
      Bricht den Boot-Refusal -> danach Render-Restart.

  scripts/prod-setup.sh admin <email>
      Schritt 4 (ERST nach WorkOS-Login): macht den Account zum Admin.

DATABASE_URL wird interaktiv + versteckt abgefragt (oder vorab: export DATABASE_URL=...).
sslmode=require wird automatisch ergaenzt. Bei SSL-/Zertifikatsfehler:
sslmode=no-verify an die URL haengen.
EOF
    exit 1
    ;;
esac
