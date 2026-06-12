# Security-Plan: Vodafone Agent

Sicherheits-Haertung des Telefon-Agenten in drei Phasen, priorisiert nach Risiko.
Kontext: Der Dienst laeuft oeffentlich erreichbar (Render), nimmt echte Anrufe an,
loest echte Anrufe und SMS aus (Kosten!) und speichert Gespraechs-Transkripte.

## Phase 1 - Kritisch: Authentifizierung & Webhook-Sicherheit ✅ (umgesetzt)

Lücken, die ohne Zugangsdaten von aussen ausnutzbar sind:

1. **Twilio-Signaturpruefung fuer `/voice/*`** ✅
   Problem: Die Webhooks waren komplett ungeschuetzt. Jeder, der die URL kennt,
   konnte gefaelschte Anrufe/Transkripte einspeisen, Gespraechs-Turns ausloesen
   (Claude-API-Kosten!) und Status-Callbacks faelschen.
   Fix: Alle `/voice/*`-Requests werden gegen den `X-Twilio-Signature`-Header
   validiert (HMAC mit `TWILIO_AUTH_TOKEN`, `twilio.validateRequest`).
   Opt-out nur fuer lokale Tests via `SKIP_TWILIO_SIGNATURE_CHECK=true`.

2. **Basic-Auth-Bypass via Header-Spoofing geschlossen** ✅
   Problem: `trust proxy: true` + Localhost-Ausnahme auf Basis von `req.ip`
   bedeutete: Ein Angreifer konnte mit `X-Forwarded-For: 127.0.0.1` den
   kompletten Passwortschutz von Dashboard + API umgehen.
   Fix: `trust proxy` auf `1` begrenzt (genau ein Proxy: Render); die
   Localhost-Ausnahme prueft jetzt die echte Socket-Adresse
   (`req.socket.remoteAddress`), die nicht spoofbar ist.

3. **`/mcp` fail-closed statt fail-open** ✅
   Problem: Ohne gesetztes `MCP_AUTH_TOKEN` war der MCP-Endpunkt oeffentlich -
   jeder konnte damit Anrufe starten (Toll Fraud, begrenzt nur durch Allowlist).
   Fix: Ohne Token ist `/mcp` nur noch von localhost erreichbar. In render.yaml
   wird das Token automatisch generiert (`generateValue: true`).

4. **Timing-sichere Credential-Vergleiche** ✅
   Problem: Basic-Auth-Passwort und MCP-Bearer-Token wurden mit `===`
   verglichen (Timing-Seitenkanal).
   Fix: Vergleich via `crypto.timingSafeEqual`.

## Phase 2 - Wichtig: Missbrauchs- und Eingabe-Haertung (offen, autonom umsetzbar)

Jeder Punkt traegt sein deterministisches Soll-Ergebnis (**Erwartet**) und die
**Verifikation** (Feedback-Loop, gegen die selbststaendig iteriert wird) -
siehe `.claude/refs/workflow.md` Regel 7. Verifikation jeweils gegen einen
lokal gestarteten Server (`PORT=3999`, Test-Env wie in den bestehenden Tests).

1. **Rate-Limiting** fuer alle Nicht-Twilio-Routen (in-house, ohne neue
   Dependency; localhost-Socket ausgenommen, Limit via `RATE_LIMIT_PER_MIN`).
   - Erwartet: Request N+1 innerhalb von 60s von derselben (Nicht-localhost-)IP
     liefert HTTP 429 mit JSON-Error; Request nach Fenster-Ende wieder 200.
   - Verifikation: Testfall, der das Limit auf einen kleinen Wert setzt und die
     Statuscode-Folge 200...200,429 asserted.
2. **Body-Size-Limits** (100 kb) fuer `express.json()`/`urlencoded()`.
   - Erwartet: POST mit >100 kb Body liefert HTTP 413, gueltige kleine Bodies
     unveraendert 2xx.
   - Verifikation: curl/Test mit 200-kb-Payload -> 413.
3. **`/media`-WebSocket absichern**: zufaelliges `streamToken` pro Call als
   Stream-Parameter im TwiML, Pruefung beim `start`-Event in `bridge.js`.
   WICHTIG: `/api/state` und `/api/calls/:id` duerfen das Token NICHT ausgeben.
   - Erwartet: `start`-Event mit falschem/fehlendem Token -> Socket wird
     getrennt, kein OpenAI-Connect; korrektes Token -> Stream laeuft.
     Kein API-Response enthaelt `streamToken`.
   - Verifikation: WS-Testclient gegen /media (beide Faelle) + Assertion, dass
     `JSON.stringify` der API-Antworten kein `streamToken` enthaelt.
4. **Settings-Whitelist**: `POST /api/settings` akzeptiert nur bekannte Keys
   mit passendem Typ (Abgleich gegen die Default-Settings in `store.js`).
   - Erwartet: unbekannter Key oder falscher Typ wird ignoriert (Response und
     Store unveraendert); bekannte Keys mit korrektem Typ werden uebernommen.
   - Verifikation: Testfall POSTet `{evil: "x", allowBooking: "nein"}` ->
     beides nicht im Store; `{allowBooking: false}` -> uebernommen.
5. **Security-Header**: `X-Content-Type-Options: nosniff`, `X-Frame-Options:
   DENY`, `Referrer-Policy`, CSP fuers Dashboard (Inline + Google Fonts
   erlaubt), `Cache-Control: no-store` fuer `/api/*`.
   - Erwartet: Header auf `/` und `/api/state` exakt gesetzt.
   - Verifikation: Testfall prueft die Response-Header.
6. **Eingabe-Validierung** der API-Routen: `to` strikt E.164
   (`^\+[1-9]\d{6,14}$` nach Normalisierung), Laengenlimits fuer Freitexte
   (objective 500, briefing/constraints 2000, caller_name 100, title 200),
   Kalender: gueltige Datumswerte und `end > start`.
   - Erwartet: ungueltige Eingaben -> HTTP 400 mit Fehlertext, gueltige
     unveraendert; keine bestehende gueltige Nutzung bricht.
   - Verifikation: Testfaelle je Grenzfall (ungueltige Nummer, Overlong-String,
     `end < start`).

## Phase 3 - Ausbau: Betrieb & Datenschutz (offen)

Autonom umsetzbar (mit Soll-Ergebnis + Verifikation):

2. **Transkript-Retention** (DSGVO): Calls/Notifications aelter als
   `RETENTION_DAYS` (Default 30, 0 = aus) beim Start und periodisch loeschen;
   offene Action Items bleiben erhalten.
   - Erwartet: Call mit `endedAt` aelter als Cutoff verschwindet samt
     Transkript aus dem Store; aktiver/frischer Call bleibt.
   - Verifikation: Unit-Test gegen `store.pruneOldData()` mit praeparierten
     Timestamps (DATA_DIR auf Temp-Verzeichnis).
3. **Audit-Logging**: Outbound-Call-Ausloesung (mit Quell-IP), Cancel,
   Settings-Aenderung und fehlgeschlagene Auth-Versuche als `[audit]`-Logzeile.
   - Erwartet: jede dieser Aktionen erzeugt genau eine `[audit]`-Zeile mit
     Aktion + IP; keine Secrets im Log.
   - Verifikation: Test faengt stdout des Kindprozess-Servers ab und prueft
     auf die `[audit]`-Zeilen.
4. **Dependency-Scanning**: `npm audit` + Tests + Syntax-Check in CI
   (GitHub Actions, bei jedem Push).
   - Erwartet: Workflow-Datei vorhanden; Pipeline scheitert bei rotem Test
     oder High-Severity-Audit-Finding.
   - Verifikation: lokal `npm test` gruen + `npm audit --audit-level=high`
     Exit-Code 0; Workflow-Lauf nach Push gruen.

NICHT autonom (braucht Accounts/Entscheidungen des Betreibers):

1. **OAuth 2.1 fuer `/mcp`** statt statischem Bearer-Token (MCP-Spec-konform) -
   braucht Identity-Provider-Account und Connector-Konfiguration in Claude.
5. **Secrets-Hygiene**: Token-Rotation dokumentieren, Twilio-Subaccount mit
   minimalen Rechten - braucht Zugriff auf Twilio-/Render-Konto.

## Voraussetzung fuer die Verifikation: Test-Suite ✅ (umgesetzt)

Phase 2/3 setzen eine automatisierte Verifikation voraus. Dafuer (vor oder mit
Phase 2) eine Test-Suite mit Node-Bordmitteln einfuehren - `node:test`, keine
neuen Dependencies:

- `DATA_DIR`-Env-Override in `config.js`, damit Tests `data/store.json` nicht
  anfassen. ✅
- Integrationstests starten den Server als Kindprozess und testen per `fetch`
  (Twilio-Signatur, MCP-Auth, Allowlist, Validierung). ✅
  (`test/helpers.js` + `test/*.test.js`; Server mit `PORT=0`, echter Port wird
  aus dem Log geparst; Nicht-localhost-Faelle laufen ueber die externe
  Interface-IP des Hosts.)
- Erwartet: `npm test` laeuft gruen in unter 60s, ohne Netz-Zugriff nach aussen
  und ohne `.env`. ✅
- Verifikation: `npm test` selbst.
