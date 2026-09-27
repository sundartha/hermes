# Hermes — autonomer Telefon-Assistent (MCP + echte Telefonie)

Ein echtes, funktionierendes Produkt (keine Simulation): Der Agent hat eine **eigene Rufnummer**, telefoniert **raus** („Ruf beim Friseur an und mach einen Termin") und nimmt **eingehende Anrufe** an (z. B. per Rufumleitung vom Handy). Gesteuert wird er aus **Claude heraus über MCP** — als Custom Connector (HTTP) oder via Claude Desktop (stdio). Nach jedem Gespräch: **Summary + Action Items**, auf Wunsch per SMS.

## Architektur

```
Claude (Chat) ──MCP Streamable HTTP (ngrok)──► /mcp ─┐
Claude Desktop ──MCP stdio──► src/mcp-server.js ─────┤   Gateway (dieser Node-Prozess)
Dashboard (Browser) ──REST──► /api/* ────────────────┘        │
                                                              │ Telnyx REST: originateCall
                                                              ▼
Angerufenes Handy ◄──Mobilfunknetz──► Telnyx ◄──── Budget-Engine: <Gather>/<Say> (STT/TTS de-DE)
                                                         └► Claude Haiku = Gehirn + Tools
```

**Budget-Engine** (die OpenAI-Realtime-Engine ist seit IE6-S2 entfernt):

|                    | `VOICE_ENGINE=budget` (Default)      |
| ------------------ | ------------------------------------ |
| Sprachverarbeitung | Telnyx TeXML STT/TTS (Azure-Stimmen, de-DE) |
| Gesprächsgefühl    | Walkie-Talkie-Takt, 1–3 s Latenz     |
| Kosten pro Call    | ~0,5–2 Cent Claude + Telnyx-Guthaben |
| Voraussetzungen    | nur Claude-Key                       |

Audio läuft **niemals durch MCP**. Call-Records liegen in `data/store.json` (bewusst ohne Datenbank).

## C-Telnyx — AI-Assistant-Engine (Barge-in, optional)

Dritte Voice-Variante (PLAN-TELNYX-AI-ASSISTANT.md): der Telnyx AI Assistant fuehrt die
Turns voll-duplex (STT/VAD/TTS/Barge-in) und ruft pro Turn unseren in-house Custom-LLM-Shim
(`/v1/chat/completions`); Claude-Brain, Ela-Stimme, Offenlegungssatz und die komplette
Safety-Gate-Kette bleiben in-house. Geschaltet ueber `TELNYX_AI_ASSISTANT_ENABLED`
(Default AUS -> Budget-Engine byte-identisch, Shim antwortet 404). Der Assistant wird
reproduzierbar via `scripts/telnyx-assistant-provision.mjs` angelegt (Runbook:
`docs/RUNBOOK-TELNYX-ASSISTANT.md`); der Live-Cutover ist Owner-gated (Flag im Dashboard
NACH verifiziertem Deploy, Rollback = Flag aus).

## Sicherheits-Gates (fest eingebaut)

- **Outbound-Freigabe:** per-Tenant-Verifikation (aktives Abo + KYC). Globaler Not-Aus: `OUTBOUND_FROZEN`.
- **Max-Dauer:** `MAX_CALL_DURATION_S` (Default 180 s, Max 300) beendet jeden Call hart (Provider-Zeitlimit + Timer).
- **Disclosure-Pflicht:** Erster gesprochener Satz bei Outbound ist fest verdrahtet: _„Guten Tag, hier spricht ein KI-Assistent im Auftrag von [Name]. Das Gespräch wird für meinen Auftraggeber zusammengefasst."_
- **Budget-Guard:** die **pro-Tenant-Kostendecke** (`DEFAULT_TENANT_BUDGET_CENTS` bzw. die aus dem Plan abgeleitete `tenant_budget`-Zeile) stoppt neue Calls, Verbrauch live im Dashboard. `MAX_BUDGET_EUR` ist seit KS-P9/E10 **kein Gate mehr**, sondern Plattform-Beobachtung mit Schwellenwarnung (`PLATFORM_SPEND_WARN_PERCENT`).
- **Permissions:** Kalender / Buchen / persönliche Daten / Bankdaten pro Toggle im Dashboard — wirkt sofort auf die Tools des Agenten.

## Kosten

| Posten                     | Kosten                                                       |
| -------------------------- | ------------------------------------------------------------ |
| Telefonie (Telnyx)         | Prepaid-Guthaben: DID-Miete + Minutenpreis                   |
| Budget-Engine komplett     | ~0,5–2 Cent Claude pro Call → 10 € ≈ **hunderte Demo-Calls** |
| ngrok                      | gratis                                                       |

## Setup (~20 Minuten)

### 1. Telnyx-Konto + DID

1. Telnyx-Mission-Control-Portal: Konto anlegen, Guthaben aufladen, eine DID kaufen.
2. **API-Key** (`TELNYX_API_KEY`) und **Ed25519-Public-Key** des Accounts (`TELNYX_PUBLIC_KEY`, Webhook-Signaturprüfung — fail-closed) anlegen bzw. kopieren.
3. **TeXML-Application** anlegen (Voice → TeXML): `voice_url = <PUBLIC_URL>/voice/incoming` (POST). Ihre ID ist `TELNYX_CONNECTION_ID`; die gekaufte Nummer auf diese App routen.
4. **Account-ID** von der Portal-Startseite als `TELNYX_ACCOUNT_SID` eintragen (Pflicht für den Hangup).

Alle vier Werte sind in `.env.example` dokumentiert.

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

Prüft automatisch: Anthropic-Key gültig + Modell verfügbar, aktive Owner-Nummer im Store, `PUBLIC_URL` gesetzt, Land-Gate/Stundenlimit plausibel, MCP-Auth-Modus, ngrok-Tunnel zeigt auf dieses Gateway, MCP-OAuth (bei `MCP_AUTH=oauth`). Erst demoen, wenn alles grün ist.

### 3c. Tests

```bash
npm test          # Regressionsschutz, muss gruen sein
npm run test:gates # i18n-Launch-Testkatalog, darf rot sein (sinkt Richtung 0 bis zum weltweiten Start)
```

Beide Laeufe partitionieren dieselbe Suite automatisch nach Katalog-ID im Testnamen (kein manuell gepflegter Ausschluss) — Details in `CLAUDE.md` unter "Befehle".

### 4. Provider-Webhooks setzen

Telnyx-Portal → Voice → **TeXML Application** (die aus Schritt 1):

- **Voice URL** → `POST` → `https://<ngrok>/voice/incoming`
- **Status Callback** → `POST` → `https://<ngrok>/voice/status`

Die URL hängt an der TeXML-Application, **nicht** an der einzelnen Nummer.

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

Claude ruft `place_call` auf, pollt `get_call_status` (~alle 10 s) und holt bei `completed` das Ergebnis mit `get_call_result`.

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
| `get_call_result`  | `call_id`                                                                                                                                                        | `{result_summary, objective_achieved: true\|false\|unclear}` (Roh-Transkript wird nach der Summary geloescht, `transcript[]` daher leer fuer abgeschlossene Calls) |
| `cancel_call`     | `call_id`                                                                                                                                                        | `{status:"cancelled"}`                                                                                                                                             |
| `get_agent_number`   | —                                                                                                                                                                | `{number}`                                                                                                                                                         |

Bonus-Tools für die Hermes-Demo: `list_calls`, `list_action_items`, `get_agent_status`.

## Demo-Drehbuch (5 Minuten)

1. **Dashboard** (localhost:3000): Agent-Nummer + Live-Status, Permission-Toggles, Budget-Anzeige.
2. **Outbound aus Claude:** Custom Connector zeigen, dann „Ruf +49… an und vereinbare einen Testtermin Samstag vormittag." → Handy klingelt in ~15 s, Disclosure-Satz, Agent verhandelt. Im Dashboard läuft das Live-Transkript.
3. Claude pollt den Status im Chat und präsentiert am Ende die Zusammenfassung + Ergebnis (Roh-Transkript wird aus Datenschutzgründen nicht aufbewahrt).
4. **Inbound:** Kollege ruft deine Handynummer an, du gehst nicht ran → Umleitung → Agent bucht den Termin gegen deinen Kalender. Danach: **SMS mit Summary + Action Items**.
5. **Permissions live:** Kalender-Toggle aus → gleicher Anruf → Agent nimmt nur noch eine Nachricht auf.

## Deploy-Realität (Repo-Split) — ZUERST LESEN

**Render deployt `upstream` (`jonas986/vodafone-agent`), NICHT `origin` (`Antonio20045`).**

- `git push origin master` macht **NICHTS** live.
- Live deployen = zusätzlich `git push upstream master` — ein eigener, bewusster Schritt.
- Live-Stand verifizieren: `gh api repos/jonas986/vodafone-agent/commits/master --jq .sha`
  bzw. nach dem Deploy im Render-Log das `[boot]`-Banner gegen den erwarteten Commit prüfen.
- Vor jeder Aussage über „live": `git fetch --all`, dann origin und upstream **getrennt**
  vermessen (`git rev-list --left-right --count master...upstream/master`). Die beiden
  divergieren aktiv.

## Bekannte Stolpersteine

- **ngrok Free:** URL wechselt bei jedem Start → `PUBLIC_URL` + Connector-Eintrag aktualisieren.
- **Latenz:** Budget-Engine bleibt Turn-basiert (1–3 s).
- **Frische Demo:** `data/store.json` löschen setzt Calls/Items/Budgetzähler zurück.

## Bewusste Prototyp-Abweichungen (vs. Produkt-PRD)

- MCP-Auth: drei Modi über `MCP_AUTH` — Legacy/statisches Bearer-Token (`MCP_AUTH_TOKEN`, leer = `/mcp` nur von localhost), oder `oauth` (OAuth 2.1 Resource Server für den claude.ai-Login-Flow). Setup/Rollout siehe `PLAN-SECURITY.md`.
- Modernes JavaScript (ESM) statt TypeScript: kein Build-Step, maximale Demo-Velocity.
- Kalender = lokaler Speicher mit Beispielterminen statt Google/Outlook.
- Keine Nummern-Provisionierung, kein Multi-User, kein Billing, keine CAMARA-Anbindung, keine Datenbank.
- Spracherkennung (Budget-Engine, `<Gather input="speech">`): Telnyx nutzt `transcriptionEngine="Deepgram"` + `model="deepgram/nova-3"` (neutral gewählt über `STT_PROFILE`, im Telnyx-Renderer übersetzt). Telnyx transkribiert **ohne** `transcriptionEngine` gar nicht (das Weglassen war der Inbound-Audio-Bug: Agent hörte den Angerufenen nie). **Restrisiko:** die de-DE-Reife der Telnyx-in-house-Engine ist live noch unbestätigt; falls Deutsch schlecht erkannt wird, ist `transcriptionEngine="Google"` (akzeptiert `de-DE`) der Fallback — 1-Zeilen-Änderung im Telnyx-Renderer.
- Datenminimierung (DSGVO): Roh-Transkripte werden nach erfolgreicher Zusammenfassung gelöscht — nur Summary + Action Items bleiben gespeichert. `get_call_result` liefert für abgeschlossene Calls kein Volltranskript mehr. Datenresidenz EU (`render.yaml` `region: frankfurt`; Region ist per Blueprint nur für frische Deploys setzbar).
- Consult-Kanal am Call (`CONSULT_ENABLED`, Default aus): Rückfragen während der Klingelzeit laufen als **Stufe 0** über einen kurzen, vom Client gezogenen Long-Poll (`GET /api/calls/:id/consult`) — der MCP-Rückkanal (Sampling/Elicitation/MRTR/Tasks) ist in claude.ai und ChatGPT unbrauchbar. Stufe 1 (Tasks-Extension) bzw. Stufe 2 (MRTR) tauschen später **nur** `src/consult/delivery.js`; Vertrag (`src/consult/ports.js`), Zustand (`call.consults`) und Aufrufer bleiben unberührt.
- Nachschlagen **im** Gespräch (`LOOKUP_ENABLED`, Default aus): das Werkzeug `look_up` schickt eine kurze Sachfrage an **Exa** — ein **neues Secret** (`EXA_API_KEY`) und ein **zweiter Auftragsverarbeiter**. Das durchbricht bewusst die Randbedingung im Kopf von `src/precall-briefing.js` („kein eigener Such-Client, kein zweites Secret"), die für die Vorab-Recherche (AL-P10, Anthropics serverseitiges `web_search`) weiter gilt. **Was rausgeht:** ausschließlich die vom Server gefilterte Sachfrage (`src/research/lookup-guard.js`). **Was nicht rausgeht:** die Rufnummer des Angerufenen, E-Mail-Adressen, Ziffernfolgen ab 5 Stellen und wörtliche Übernahmen aus dem Transkript. Ein Namens-Filter existiert bewusst NICHT (`call.callerName` ist seit der Identitäts-Bindung G1 hart `null`, ein Filter darauf wäre toter Code mit einer falschen Schutzbehauptung) — das Verbot, Personenbezogenes des Gegenübers nachzuschlagen, trägt hier die Tool-Description. Wirksam nur als Schnittmenge mit `ASSISTANT_CONTEXT_ENABLED`, dem Per-Tenant-Recht `allowLookup`, Outbound-Richtung, einem gesetzten Key und der Budget-Engine; Treffer landen ausschließlich als `context.key_facts` im HINTERGRUND-Block. Details und die ehrliche Grenze des Filters: `PLAN-SECURITY.md`.
- DSGVO-Betroffenenrechte (Owner-Tenant): Auskunft/Export (Art. 15/20) als read-only `GET /api/tenant-data/export` (nur fuer den lokalen In-Process-Aufrufer, `internalOnly`; Calls ohne `streamToken`); Recht auf Löschung (Art. 17) als eigenständiges Script `node scripts/erase-tenant.js <tenantId> --confirm` (irreversibel, fail-closed, bewusst kein Netz-Endpunkt). Beide treffen call-verknüpfte Daten (Calls inkl. Transkripte, Action Items, call-verknüpfte Notifications); Einstellungen/Profile/Nummer/Kalender/Budget-Zähler bleiben erhalten.
- **Outbound-Absender ueber ElevenLabs: je Tenant-DID eine eigene Registrierung, globaler Rueckfall bleibt bestehen.** Auf dem ElevenLabs-Anrufweg bestimmt eine bei ElevenLabs registrierte SIP-Nummer (`POST /v1/convai/phone-numbers`), welche Nummer der Angerufene sieht — nicht der Anrufkoerper selbst. Jede aktive Tenant-DID bekommt beim Kauf (hinter `ELEVENLABS_NUMBER_REGISTRATION_ENABLED`, Default aus) ihre eigene Registrierung; fehlt sie (Bestands-DID vor dieser Etappe, oder ein fehlgeschlagenes Anlegen), faellt der Anrufstart **laut** (Log + Metrik + `call.fromRegistrationSource`) auf die eine globale Registrierung (`ELEVENLABS_AGENT_PHONE_NUMBER_ID`) zurueck — das bleibt so, bis jede DID registriert ist. Reparaturlauf: `npm run elevenlabs:nummern`. Details: `PLAN-SECURITY.md` Abschnitt "OUTBOUND-E5", `docs/RUNBOOK-OUTBOUND.md`.
- **Nutzungsbasierte Weiterbelastung: gebaut, bewusst inaktiv.** Der Verbrauchs-Ledger (`usage_event`) und der Melde-Pfad an Stripe (`POST /api/billing/flush-meters`, `flushMeters`, das Feld `stripe_meter_sent`) existieren vollständig — **sie laufen aber nicht.** Es gibt **keine** nutzungsbasierte Weiterbelastung an den Kunden: der Abo-Preis ist endgültig, das Kontingent ist in Minuten definiert, und ein Überzug wird nicht nachberechnet (Owner-Entscheidung vom 2026-08-03). Der Endpunkt hat deshalb bewusst **keinen Auslöser** — kein Cron, kein Sweep-Hook, kein Timer — und wird ausschließlich manuell von einem Betreiber-Konto aufgerufen. Er ist zusätzlich durch einen Stichtag verriegelt: `BILLING_FLUSH_EPOCH` (ISO-8601 mit Zone) ist der älteste Zeitpunkt, der überhaupt gemeldet werden darf; ist die Variable **nicht gesetzt — der ausgelieferte Zustand —, wird nichts gemeldet.** Die Fail-Richtung ist „meldet nichts", niemals „meldet alles". Grund: im Ledger stehen Zeilen aus dem Vorbetrieb (u. a. Inbound-Minuten zu einem alten Worst-Case-Tarif und zwei als Monatsmiete etikettierte Einrichtungsgebühren), ohne Riegel würde ein einziger Aufruf sie alle auf einmal an echte Kunden melden. Der Ledger selbst bleibt vollständig bestehen — er ist unsere **eigene Kostenrechnung und Belegkette**, nicht nur eine Rechnungsgrundlage. Ein Mechanismus, der so aussieht, als liefe er, ist gefährlicher als keiner; deshalb steht das hier und nicht nur im Code.

## Dateien

```
src/server.js      Gateway: Provider-Webhooks, REST-API, MCP ueber HTTP (/mcp), Dashboard-Hosting
src/claude.js      Gespraechslogik Budget-Engine + System-Prompts, Tools, Disclosure, Summary
src/mcp-tools.js   MCP-Tool-Definitionen (gemeinsam fuer HTTP- und stdio-Transport)
src/mcp-server.js  MCP stdio-Einstieg fuer Claude Desktop
src/store.js       JSON-Persistenz: Calls, Transkripte, Action Items, Kalender, Budget
src/config.js      .env-Konfiguration + Validierung
scripts/check-setup.js  Setup-Checker: npm run check
```
