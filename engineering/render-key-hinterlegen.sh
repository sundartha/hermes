#!/usr/bin/env bash
# Hinterlegt den Render-API-Key für Engineering. Du tippst ihn unsichtbar ein.
# Er landet nur in ~/.config/openclaw-konten/render.env (Rechte 600), nie in Git, Log oder Chat.
set -euo pipefail
ZIEL="$HOME/.config/openclaw-konten/render.env"
mkdir -p "$(dirname "$ZIEL")"
printf 'Render-API-Key (Eingabe bleibt unsichtbar): '
read -rs KEY; echo
[ -n "$KEY" ] || { echo "Nichts eingegeben, abgebrochen."; exit 1; }
# Nur-Lesen-Test gegen Render (ein Dienst abfragen, nichts ändern)
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "https://api.render.com/v1/services?limit=1")
if [ "$CODE" != "200" ]; then
  echo "Render lehnt den Key ab (HTTP $CODE). Nichts gespeichert."; exit 1
fi
umask 077
printf 'RENDER_API_KEY=%s\n' "$KEY" > "$ZIEL"
chmod 600 "$ZIEL"
unset KEY
echo "Gespeichert in $ZIEL (Rechte 600). Der Key wurde von Render akzeptiert."
