# Onboarding für Mitarbeiter

Willkommen beim **Hermes** – ein autonomer Telefon-Assistent (Telnyx + Claude) mit MCP-Anbindung an Claude. Lies zuerst die `README.md` (Architektur, Demo-Drehbuch), dann hier weiter.

## Was läuft wo

| Komponente               | Ort                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| Produktion (24/7)        | https://vodafone-agent.onrender.com – deployt automatisch bei jedem Push auf `master`    |
| Dashboard                | https://vodafone-agent.onrender.com (User `admin`, Passwort bekommst du von Jonas)       |
| MCP-Connector für Claude | `https://vodafone-agent.onrender.com/mcp` (Settings → Connectors → Add custom connector) |
| Hosting                  | Render.com Free Tier, Region Frankfurt, Service `vodafone-agent` (Account: Jonas)        |
| Telefonie                | Telnyx, TeXML-Application hält die Voice-URL (Account: Jonas)                            |

## Lokal entwickeln

```bash
git clone https://github.com/jonas986/vodafone-agent.git
cd vodafone-agent
npm install
cp .env.example .env   # Werte bekommst du PRIVAT von Jonas (Signal/persönlich - NIE per Git/Issue/Chat-Tool)
npm start              # http://localhost:3000
npm run check          # prüft Keys, Owner-Nummer, Tunnel
```

Für lokale Telefonie-Tests brauchst du einen eigenen Tunnel (ngrok) ODER du testest gegen die Render-Instanz. `node scripts/set-public-url.js <url>` setzt nur `PUBLIC_URL` in der `.env`; die **TeXML-Voice-URL** biegst du im Telnyx-Portal von Hand auf deine Tunnel-URL um. Achtung: es gibt nur EINE TeXML-Application – wer sie umbiegt, klaut die Produktion. Danach zurückstellen auf `https://vodafone-agent.onrender.com/voice/incoming`.

## Regeln (wichtig)

1. **Niemals Secrets committen.** `.env`, `data/`, `.twilio-recovery-code` sind gitignored – so lassen. Keine Keys in Code, Logs oder Markdown. Vor jedem Commit: `git diff --staged` auf Keys prüfen.
2. **Outbound-Freigabe**: per-Tenant-Verifikation (aktives Abo + KYC). Globaler Not-Aus: `OUTBOUND_FROZEN`.
3. **Budget-Guard**: Claude-Kosten sind auf `MAX_BUDGET_EUR` gedeckelt. Modell ist Haiku – bitte nicht ohne Absprache auf teurere Modelle wechseln.
4. Deploy = `git push` (Render baut automatisch). Auf dem Mac von Jonas gibt es dafür `DEPLOY.command`.

## Code-Landkarte

```
src/server.js      Gateway: Provider-Webhooks, REST-API, MCP über HTTP (/mcp), Auth, Dashboard-Hosting
src/claude.js      Gesprächslogik (Budget-Engine): System-Prompts, Tools, Disclosure, Summary
src/mcp-tools.js   MCP-Tool-Definitionen (place_call, get_call_status, get_transcript, ...)
src/mcp-server.js  MCP stdio-Variante für Claude Desktop
src/store.js       JSON-Persistenz (auf Render ephemer - reset bei jedem Deploy)
src/config.js      Konfiguration aus Env-Vars
public/tenant.html Dashboard (Navy-Design, Polling auf /api/state)
scripts/           check-setup.js (npm run check), set-public-url.js
```

## Sinnvolle nächste Aufgaben

- Persistenz: `store.js` auf eine echte DB heben (z. B. Render Postgres free / Supabase free)
- Google/Outlook-Kalender statt lokalem Demo-Kalender
- OAuth 2.1 für /mcp: Code steht (`MCP_AUTH=oauth`, Resource Server). Offen ist
  nur noch der Betreiber-Teil — IdP-Account (WorkOS) + scharf schalten. Anleitung:
  `PLAN-SECURITY.md` (Phase 1, OAuth). Bis dahin schützt `/mcp` die fail-closed-Default (localhost)
  bzw. `MCP_AUTH_TOKEN`.
