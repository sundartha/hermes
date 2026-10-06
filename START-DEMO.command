#!/bin/bash
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")"
echo "═══ Vodafone Agent - Demo-Start ═══"

command -v node >/dev/null || { echo "FEHLER: node fehlt (brew install node)"; read -r; exit 1; }
command -v ngrok >/dev/null || { echo "FEHLER: ngrok fehlt (brew install ngrok)"; read -r; exit 1; }
[ -f .env ] || { echo "FEHLER: .env fehlt"; read -r; exit 1; }
[ -d node_modules ] || { echo "Installiere Dependencies..."; npm install --no-audit --no-fund; }

TOKEN=$(grep "ngrok config add-authtoken" .env | awk '{print $NF}')
[ -n "$TOKEN" ] && ngrok config add-authtoken "$TOKEN" >/dev/null 2>&1

if ! curl -s --max-time 2 localhost:4040/api/tunnels >/dev/null 2>&1; then
  echo "Starte ngrok-Tunnel..."
  pkill -x ngrok 2>/dev/null; sleep 1
  nohup ngrok http 3000 --log=stdout > /tmp/ngrok-vodafone.log 2>&1 &
  sleep 5
fi

URL=$(curl -s localhost:4040/api/tunnels | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d).tunnels.find(t=>t.public_url.startsWith('https'));console.log(t?t.public_url:'')})")
if [ -z "$URL" ]; then echo "FEHLER: ngrok-URL nicht gefunden (siehe /tmp/ngrok-vodafone.log)"; read -r; exit 1; fi
echo "Tunnel aktiv: $URL"

node scripts/set-public-url.js "$URL" || { read -r; exit 1; }
echo "! Telnyx-TeXML-App voice_url auf $URL/voice/incoming stellen (Portal), sonst klingelt nichts."

pkill -f "node src/server.js" 2>/dev/null; sleep 1
nohup npm start > /tmp/vodafone-agent.log 2>&1 &
sleep 3
curl -s --max-time 3 localhost:3000/api/state >/dev/null || { echo "FEHLER: Server startet nicht (siehe /tmp/vodafone-agent.log)"; read -r; exit 1; }
echo "Server laeuft: http://localhost:3000"

npm run check

echo ""
echo "═══ FERTIG ═══"
echo "Dashboard:        http://localhost:3000"
echo "MCP-Connector:    $URL/mcp   (Claude -> Settings -> Connectors -> Add custom connector)"
echo "Agent-Nummer:     siehe Dashboard (Anruf-Test: einfach anrufen!)"
echo ""
read -p "Enter zum Schliessen..."
