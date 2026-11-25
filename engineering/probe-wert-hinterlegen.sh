#!/usr/bin/env bash
# Erzeugt den geheimen Probe-Wert, trägt ihn als GitHub-Secret STAGING_PROBE_TOKEN ein
# und legt ihn in die Zwischenablage (für Render). Der Wert wird nie angezeigt.
set -euo pipefail

REPO="sundartha/hermes"
NAME="STAGING_PROBE_TOKEN"

command -v gh >/dev/null || { echo "gh fehlt (brew install gh)"; exit 1; }
command -v openssl >/dev/null || { echo "openssl fehlt"; exit 1; }
command -v pbcopy >/dev/null || { echo "pbcopy fehlt (nur auf dem Mac)"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Nicht bei GitHub angemeldet: erst 'gh auth login'"; exit 1; }

WERT="$(openssl rand -hex 24)"   # 48 Zeichen, mindestens 32 verlangt
printf '%s' "$WERT" | gh secret set "$NAME" -R "$REPO"
printf '%s' "$WERT" | pbcopy
unset WERT

gh secret list -R "$REPO" | grep -q "^$NAME" && echo "GitHub-Secret $NAME ist eingetragen." || { echo "Eintrag nicht gefunden"; exit 1; }
echo "Der Wert liegt jetzt in der Zwischenablage. Weiter bei Render: Environment, Add, Name HERMES_PROBE_TOKEN, Wert mit Cmd+V einfügen."
