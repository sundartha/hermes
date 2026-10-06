#!/bin/bash
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")"
URL="https://vodafone-agent.onrender.com"
echo "═══ Vodafone Agent - Deploy ═══"

command -v git >/dev/null || { echo "FEHLER: git fehlt"; read -r; exit 1; }

echo "Tests laufen..."
npm test || { echo "FEHLER: Tests rot. Kein Deploy."; read -r; exit 1; }
echo "✓ Tests gruen"

if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -m "chore: deploy $(date '+%Y-%m-%d %H:%M')"
  echo "✓ Aenderungen committet"
else
  echo "- Keine neuen Aenderungen, pushe vorhandene Commits"
fi

git push || { echo "FEHLER: git push fehlgeschlagen (gh auth login?)"; read -r; exit 1; }
echo "✓ Gepusht. Render baut jetzt (dauert ~1-2 Min.)..."

sleep 45
for i in $(seq 1 20); do
  CODE=$(curl -s --max-time 8 -o /dev/null -w "%{http_code}" "$URL/healthz" 2>/dev/null)
  [ "$CODE" = "200" ] && { echo "✓ Service ist live"; break; }
  echo "  ...warte ($i/20, healthz=$CODE)"
  sleep 10
done

DASH=$(curl -s --max-time 8 -o /dev/null -w "%{http_code}" "$URL/" 2>/dev/null)
if [ "$DASH" = "401" ]; then
  echo "✓ Dashboard passwortgeschuetzt (401 ohne Login)"
else
  echo "! Dashboard antwortet mit HTTP $DASH (evtl. baut Render noch - in 1 Min. nochmal klicken)"
fi

echo ""
echo "Dashboard:     $URL  (User: admin, Passwort: siehe DASHBOARD_PASSWORD in .env)"
echo "MCP-Connector: $URL/mcp"
echo ""
read -p "Enter zum Schliessen..."
