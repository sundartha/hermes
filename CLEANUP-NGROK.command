#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
echo "═══ ngrok-Aufraeumen ═══"
pkill -x ngrok 2>/dev/null && echo "✓ laufender Tunnel beendet" || echo "- kein Tunnel aktiv"
if command -v ngrok >/dev/null; then
  brew uninstall ngrok 2>/dev/null && echo "✓ ngrok deinstalliert (brew)" || echo "! brew uninstall fehlgeschlagen - manuell: brew uninstall ngrok"
else
  echo "- ngrok nicht (mehr) installiert"
fi
rm -rf "$HOME/Library/Application Support/ngrok" && echo "✓ ngrok-Konfiguration (inkl. Authtoken-Datei) geloescht"
cd "$(dirname "$0")"
sed -i '' '/ngrok config add-authtoken/d; /---- ngrok/d' .env 2>/dev/null && echo "✓ Token-Zeile aus .env entfernt"
echo ""
echo "WICHTIG: Den Authtoken zusaetzlich online widerrufen:"
echo "  https://dashboard.ngrok.com/agents/authtokens -> Token loeschen"
echo "(Das uebernimmt Claude im Browser, oder du machst es selbst.)"
echo ""
read -p "Enter zum Schliessen..."
