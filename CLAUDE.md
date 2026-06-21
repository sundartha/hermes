# CLAUDE.md — Hermes

Autonomer Telefon-KI-Agent: Twilio Voice + Claude (Haiku) + MCP-Server.  
Node.js (ESM), Express, kein Build/TS. Nimmt echte Anrufe an (Kosten!).

## Critical

- **Safety-Gates** (ALLOWED_NUMBERS, MAX_BUDGET_EUR, Twilio-Signatur) niemals entfernen/aufweichen
- **Offenlegung** bei Outbound (`disclosureSentence`) fest verdrahtet, kein KI-Ermessen
- **Auth fail-closed**: Neue Endpunkte default hinter Auth; Credential-Vergleiche timing-sicher (`safeEqual`)
- **Keine Secrets** committen/loggen/leaken — nur `.env` oder Render-Dashboard
- **Audio** NIEMALS durch MCP — nur Transkripte/Status
- **Nur implementieren** was gefragt wurde
- **Nie raten** — bei Unsicherheit fragen

## Workflow

Nicht-trivial (3+ Schritte oder architektonische Entscheidung): `.claude/refs/workflow.md` lesen + befolgen (Pflicht).  
Calls/SMS/Auth/Budget = automatisch nicht-trivial.

## Code-Qualität

Nicht-triviale Änderungen: `.claude/refs/clean-code.md` lesen + befolgen (Pflicht).  
Trivial (kein Lesen nötig): Tippfehler, Formatting, Imports sortieren, reines Umbenennen.

## Architektur

- `src/server.js` — Twilio-Webhooks, REST-API, MCP Streamable HTTP, Auth
- `src/bridge.js` — Audio-Bridge Twilio ↔ OpenAI Realtime
- `src/claude.js` — Gesprächslogik, System-Prompts, Tool-Loop
- `src/mcp-tools.js` / `src/mcp-server.js` — MCP-Tool-Definitionen + stdio-Transport
- `src/store.js` — JSON-Persistenz (`data/store.json`, gitignored)
- `src/config.js` — alle Konfig aus `.env`
- `public/` — Dashboard (statisches HTML/JS)

## Before Edits

1. Datei zuerst lesen
2. `grep` nach allen Callern (Tools werden von Budget-Engine UND Realtime-Bridge genutzt)
3. `node --check src/<file>.js`, dann `npm test`
4. Sicherheits-Änderungen: `PLAN-SECURITY.md` aktualisieren

## Pre-Mortem

Vor jeder Entscheidung: **"Ein Jahr später — was ist schiefgelaufen?"** (ungewollte Anrufe, Kostenexplosion, Datenleck). Risiken vorher benennen: entschärfen oder dokumentiert akzeptieren.

## Konventionen

ESM, Deutsch ohne Umlaute (ue/oe/ae), wenige Dependencies. Env-Vars in `config.js` + `.env.example`.

## Befehle

```
Start:       npm start
MCP (stdio): npm run mcp
Tests:       npm test               (node:test, offline)
Syntax:      node --check src/server.js
Lokal:       PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start + curl
```

## Referenzen

- `.claude/refs/workflow.md`
- `.claude/refs/clean-code.md`
- `PLAN-SECURITY.md`, `README.md`, `.env.example`, `render.yaml`
