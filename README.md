# Hermes — autonomer Telefon-Assistent (MCP + echte Telefonie)

Ein echtes, funktionierendes Produkt (keine Simulation): Der Agent hat eine **eigene Rufnummer**, telefoniert **raus** („Ruf beim Friseur an und mach einen Termin") und nimmt **eingehende Anrufe** an (z. B. per Rufumleitung vom Handy). Gesteuert wird er aus **Claude heraus über MCP** — als Custom Connector (HTTP) oder via Claude Desktop (stdio). Nach jedem Gespräch: **Summary + Action Items**, auf Wunsch per SMS.

## Architektur

```
Claude (Chat) ──MCP Streamable HTTP (ngrok)──► /mcp ─┐
Claude Desktop ──MCP stdio──► src/mcp-server.js ─────┤   Gateway (dieser Node-Prozess)
Dashboard (Browser) ──REST──► /api/* ────────────────┘        │
                                                              │ Twilio REST: calls.create
                                                              ▼
Angerufenes Handy ◄──Mobilfunknetz──► Twilio ◄──┬── Budget-Engine: <Gather>/<Say> (STT/TTS de-DE)
                                                │        └► Claude Haiku = Gehirn + Tools
                                                └── Realtime-Engine: Media-Streams-WS /media
                                                         └► OpenAI Realtime (g711_ulaw 1:1,
                                                             Barge-in, end_call-Tool)
```

**Zwei Voice-Engines, gleicher Agent** (gleiche Persona, gleiche Tools, gleiche Permissions, gleiche Summaries):

|                    | `VOICE_ENGINE=budget` (Default)      | `VOICE_ENGINE=realtime`             |
| ------------------ | ------------------------------------ | ----------------------------------- |
| Sprachverarbeitung | Twilio STT/TTS (Polly Neural, de-DE) | OpenAI Realtime, Speech-to-Speech   |
| Gesprächsgefühl    | Walkie-Talkie-Takt, 1–3 s Latenz     | natürlich, unterbrechbar (Barge-in) |
| Kosten pro Call    | ~0,5–2 Cent Claude + Twilio-Guthaben | zusätzlich ~0,30–0,50 €/min OpenAI  |
| Voraussetzungen    | nur Claude-Key                       | OpenAI-Key mit Guthaben             |

Audio läuft **niemals durch MCP**. Realtime nutzt G.711 μ-law 8 kHz **1:1 durchgereicht** (kein Transcoding). Call-Records liegen in `data/store.json` (bewusst ohne Datenbank).

## Sicherheits-Gates (fest eingebaut)

- **Outbound-Freigabe:** per-Tenant-Verifikation (aktives Abo + KYC). Globaler Not-Aus: `OUTBOUND_FROZEN`.
- **Max-Dauer:** `MAX_CALL_DURATION_S` (Default 180 s, Max 300) beendet jeden Call hart (Twilio `timeLimit` + Timer).
- **Disclosure-Pflicht:** Erster gesprochener Satz bei Outbound ist fest verdrahtet: _„Guten Tag, hier spricht ein KI-Assistent im Auftrag von [Name]. Das Gespräch wird für meinen Auftraggeber zusammengefasst."_
- **Budget-Guard:** `MAX_BUDGET_EUR` stoppt neue Calls, Verbrauch live im Dashboard.
- **Permissions:** Kalender / Buchen / persönliche Daten / Bankdaten pro Toggle im Dashboard — wirkt sofort auf die Tools des Agenten.

## Kosten

| Posten                     | Kosten                                                       |
| -------------------------- | ------------------------------------------------------------ |
| Twilio Trial               | **gratis** (~15 $ Startguthaben, Rufnummer inklusive)        |
| Budget-Engine komplett     | ~0,5–2 Cent Claude pro Call → 10 € ≈ **hunderte Demo-Calls** |
| Realtime-Engine (optional) | + ~0,30–0,50 €/min vom OpenAI-Guthaben                       |
| ngrok                      | gratis                                                       |

## Setup (~20 Minuten)

### 1. Twilio-Trial-Account (gratis)

1. https://www.twilio.com/try-twilio (keine Kreditkarte nötig)
2. Console → **Get a Trial Number**. Eine **US-Nummer (+1)** geht sofort und ruft deutsche Handys an; eine deutsche Nummer braucht einen Adressnachweis (Bundesnetzagentur, 1–2 Tage) — fürs Erste unnötig.
3. **Trial-Einschränkung:** Anrufe/SMS nur an **verifizierte Nummern** → Console → Phone Numbers → **Verified Caller IDs** → alle Demo-Handys eintragen. (Alternativ: Account-Upgrade ~20 €, dann entfällt auch die Trial-Ansage am Gesprächsbeginn.)
4. `Account SID` + `Auth Token` kopieren.

### 2. Projekt starten

```bash
cd vodafone-agent
npm install
cp .env.example .env    # ausfüllen: Keys, Nummern, ALLOWED_NUMBERS!
npm start               # Gateway + Dashboard auf http://localhost:3000
```

### 3. ngrok (gratis)

```bash
ngrok http 3000
```

Angezeigte URL als `PUBLIC_URL` in `.env` eintragen, Server neu starten. (Free-URLs wechseln bei jedem ngrok-Start → dann `PUBLIC_URL` **und** den Connector in Claude aktualisieren.)

### 3b. Setup pruefen (empfohlen, vor jeder Demo)

```bash
npm run check
```

Prüft automatisch: Keys gültig, Twilio-Nummer + Webhooks korrekt, Allowlist-/Owner-Nummern im Trial verifiziert, ngrok-Tunnel zeigt auf dieses Gateway, OpenAI-Key (bei realtime). Erst demoen, wenn alles grün ist.

### 4. Twilio-Webhooks setzen

Console → Phone Numbers → deine Nummer → **Voice Configuration**:

- **A call comes in** → Webhook, `POST` → `https://<ngrok>/voice/incoming`
- **Call status changes** → `POST` → `https://<ngrok>/voice/status`

### 5. MCP mit Claude verbinden — Variante A: Custom Connector (empfohlen)

claude.ai oder Claude Desktop → **Settings → Connectors → Add custom connector**:

- URL: `https://<ngrok>/mcp`
- **`MCP_AUTH=oauth`** (empfohlen fürs Hosting): Beim Hinzufügen erscheint das
  Login-Fenster des IdP — anmelden, danach sind die Tools sichtbar. Einrichtung:
  `PLAN-SECURITY.md` (Phase 1, OAuth).
- **`MCP_AUTH_TOKEN`** (Legacy): taugt nur für curl-Tests — claude.ai kann kein
  statisches Bearer-Token senden. Ohne Token/OAuth ist `/mcp` nur von localhost erreichbar.

Danach sind die Tools im Chat sichtbar. Prompt-Beispiel:

> „Ruf +49172… an und vereinbare einen Testtermin für Samstag vormittag. Halte mich über den Fortschritt auf dem Laufenden."

Claude ruft `place_call` auf, pollt `get_call_status` (~alle 10 s) und holt bei `completed` das Ergebnis mit `get_transcript`.

### Variante B: Claude Desktop (stdio)

```json
{
  "mcpServers": {
    "vodafone-agent": {
      "command": "node",
      "args": ["/ABSOLUTER/PFAD/zu/vodafone-agent/src/mcp-server.js"]
    }
  }
}
```

### 6. Rufumleitung vom eigenen Handy (Inbound-Use-Case)

Umleitung „bei Nichtannahme" auf die Agent-Nummer: `**61*<AGENT-NUMMER>#` anrufen (aus: `##61#`).
Du gehst nicht ran → Agent übernimmt → du bekommst SMS mit Summary + Action Items.

## MCP-Tools (Verträge)

| Tool              | Parameter                                                                                                                                                        | Rückgabe                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `place_call`      | `to` (E.164; serverseitige Safety-Gates), `objective` (Pflicht), `briefing?`, `constraints?`, `language?` (Default de), `max_duration_s?` (Default 180, Max 300), `caller_name?` | `{call_id, status:"dialing"}`                                                                                                                                      |
| `get_call_status` | `call_id`                                                                                                                                                        | `{status: dialing\|in_progress\|completed\|failed\|cancelled, duration_s, last_transcript_lines[]}`                                                                |
| `get_transcript`  | `call_id`                                                                                                                                                        | `{result_summary, objective_achieved: true\|false\|unclear}` (Roh-Transkript wird nach der Summary geloescht, `transcript[]` daher leer fuer abgeschlossene Calls) |
| `cancel_call`     | `call_id`                                                                                                                                                        | `{status:"cancelled"}`                                                                                                                                             |
| `get_my_number`   | —                                                                                                                                                                | `{number}`                                                                                                                                                         |

Bonus-Tools für die Hermes-Demo: `list_calls`, `list_action_items`, `get_calendar`, `get_agent_status`.

## Demo-Drehbuch (5 Minuten)

1. **Dashboard** (localhost:3000): Agent-Nummer + Live-Status, Permission-Toggles, Budget-Anzeige.
2. **Outbound aus Claude:** Custom Connector zeigen, dann „Ruf +49… an und vereinbare einen Testtermin Samstag vormittag." → Handy klingelt in ~15 s, Disclosure-Satz, Agent verhandelt. Im Dashboard läuft das Live-Transkript.
3. Claude pollt den Status im Chat und präsentiert am Ende die Zusammenfassung + Ergebnis (Roh-Transkript wird aus Datenschutzgründen nicht aufbewahrt).
4. **Inbound:** Kollege ruft deine Handynummer an, du gehst nicht ran → Umleitung → Agent bucht den Termin gegen deinen Kalender. Danach: **SMS mit Summary + Action Items**.
5. **Permissions live:** Kalender-Toggle aus → gleicher Anruf → Agent nimmt nur noch eine Nachricht auf.

## Bekannte Stolpersteine

- **Twilio Trial:** nur verifizierte Zielnummern; Ansage vor jedem Gespräch (Upgrade ~20 € entfernt beides). Eingehend darf jeder anrufen.
- **ngrok Free:** URL wechselt bei jedem Start → `PUBLIC_URL` + Connector-Eintrag aktualisieren.
- **Latenz:** `TWILIO_EDGE=frankfurt` ist gesetzt, hält den EU-Pfad kurz. Budget-Engine bleibt Turn-basiert (1–3 s); für natürliches Unterbrechen Realtime-Engine nutzen.
- **Realtime-Engine:** braucht `OPENAI_API_KEY` mit Guthaben; Modell per `REALTIME_MODEL` (Default `gpt-realtime`, Fallback `gpt-4o-realtime-preview`).
- **Frische Demo:** `data/store.json` löschen setzt Calls/Items/Budgetzähler zurück.

## Bewusste Prototyp-Abweichungen (vs. Produkt-PRD)

- MCP-Auth: drei Modi über `MCP_AUTH` — Legacy/statisches Bearer-Token (`MCP_AUTH_TOKEN`, leer = `/mcp` nur von localhost), oder `oauth` (OAuth 2.1 Resource Server für den claude.ai-Login-Flow). Setup/Rollout siehe `PLAN-SECURITY.md`.
- Modernes JavaScript (ESM) statt TypeScript: kein Build-Step, maximale Demo-Velocity.
- Kalender = lokaler Speicher mit Beispielterminen statt Google/Outlook.
- Keine Nummern-Provisionierung, kein Multi-User, kein Billing, keine CAMARA-Anbindung, keine Datenbank.
- Spracherkennung (Budget-Engine, `<Gather input="speech">`): Twilio nutzt `speechModel=deepgram_nova-2-general`, Telnyx den eigenen `transcriptionEngine="Telnyx"` (in-house, günstiger als Google) — provider-spezifisch im jeweiligen Renderer fest verdrahtet. Telnyx transkribiert **ohne** `transcriptionEngine` gar nicht (das Weglassen war der Inbound-Audio-Bug: Agent hörte den Angerufenen nie). **Restrisiko:** die de-DE-Reife der Telnyx-in-house-Engine ist live noch unbestätigt; falls Deutsch schlecht erkannt wird, ist `transcriptionEngine="Google"` (akzeptiert `de-DE`) der Fallback — 1-Zeilen-Änderung im Telnyx-Renderer.
- Datenminimierung (DSGVO): Roh-Transkripte werden nach erfolgreicher Zusammenfassung gelöscht — nur Summary + Action Items bleiben gespeichert. `get_transcript` liefert für abgeschlossene Calls kein Volltranskript mehr. Datenresidenz EU (`render.yaml` `region: frankfurt`; Region ist per Blueprint nur für frische Deploys setzbar).
- DSGVO-Betroffenenrechte (Owner-Tenant): Auskunft/Export (Art. 15/20) als read-only `GET /api/tenant-data/export` (hinter Basic-Auth, Calls ohne `streamToken`); Recht auf Löschung (Art. 17) als eigenständiges Script `node scripts/erase-tenant.js <tenantId> --confirm` (irreversibel, fail-closed, bewusst kein Netz-Endpunkt). Beide treffen call-verknüpfte Daten (Calls inkl. Transkripte, Action Items, call-verknüpfte Notifications); Einstellungen/Profile/Nummer/Kalender/Budget-Zähler bleiben erhalten.

## Dateien

```
src/server.js      Gateway: Twilio-Webhooks, REST-API, MCP ueber HTTP (/mcp), Dashboard-Hosting
src/bridge.js      Realtime-Audio-Bridge: Twilio Media Streams <-> OpenAI Realtime (Barge-in, end_call)
src/claude.js      Gespraechslogik Budget-Engine + System-Prompts, Tools, Disclosure, Summary
src/mcp-tools.js   MCP-Tool-Definitionen (gemeinsam fuer HTTP- und stdio-Transport)
src/mcp-server.js  MCP stdio-Einstieg fuer Claude Desktop
src/store.js       JSON-Persistenz: Calls, Transkripte, Action Items, Kalender, Budget
src/config.js      .env-Konfiguration + Validierung
public/tenant.html Dashboard (Navy-Design, Live-Polling)
scripts/check-setup.js  Setup-Checker: npm run check
```
