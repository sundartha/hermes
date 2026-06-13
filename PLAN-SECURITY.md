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

## Phase 2 - Wichtig: Missbrauchs- und Eingabe-Haertung ✅ (umgesetzt)

Jeder Punkt traegt sein deterministisches Soll-Ergebnis (**Erwartet**) und die
**Verifikation** (Feedback-Loop, gegen die selbststaendig iteriert wird) -
siehe `.claude/refs/workflow.md` Regel 7. Verifikation laeuft automatisiert
in der Test-Suite (`npm test`, Server als Kindprozess mit Test-Env).

1. **Rate-Limiting** fuer alle Nicht-Twilio-Routen (in-house, ohne neue
   Dependency; localhost-Socket ausgenommen, Limit via `RATE_LIMIT_PER_MIN`,
   Default 120/min). ✅ (`src/middleware.js`, Fixed Window pro IP)
   - Erwartet: Request N+1 innerhalb von 60s von derselben (Nicht-localhost-)IP
     liefert HTTP 429 mit JSON-Error; Request nach Fenster-Ende wieder 200.
   - Verifikation: `test/rate-limit.test.js` (Limit 3 -> Folge 200,200,200,429;
     localhost und /voice ausgenommen).
2. **Body-Size-Limits** (100 kb) fuer `express.json()`/`urlencoded()`. ✅
   - Erwartet: POST mit >100 kb Body liefert HTTP 413, gueltige kleine Bodies
     unveraendert 2xx.
   - Verifikation: `test/api.test.js` (200-kb-Payload -> 413, json + urlencoded).
3. **`/media`-WebSocket absichern**: zufaelliges `streamToken` pro Call als
   Stream-Parameter im TwiML, Pruefung beim `start`-Event in `bridge.js`.
   WICHTIG: `/api/state` und `/api/calls/:id` duerfen das Token NICHT ausgeben. ✅
   (timing-sicherer Vergleich via `src/util.js`; API-Antworten laufen durch
   `publicCall()` in `server.js`)
   - Erwartet: `start`-Event mit falschem/fehlendem Token -> Socket wird
     getrennt, kein OpenAI-Connect; korrektes Token -> Stream laeuft.
     Kein API-Response enthaelt `streamToken`.
   - Verifikation: `test/media-token.test.js` (WS-Testclient beide Faelle,
     kein API-Leak, TwiML traegt das Token, abgelehnter Stream beendet den
     Call-Record nicht).
4. **Settings-Whitelist**: `POST /api/settings` akzeptiert nur bekannte Keys
   mit passendem Typ (Abgleich gegen die Default-Settings in `store.js`). ✅
   - Erwartet: unbekannter Key oder falscher Typ wird ignoriert (Response und
     Store unveraendert); bekannte Keys mit korrektem Typ werden uebernommen.
   - Verifikation: `test/api.test.js` (`{evil: "x", allowBooking: "nein"}` ->
     beides nicht im Store; `{allowBooking: false}` -> uebernommen).
5. **Security-Header**: `X-Content-Type-Options: nosniff`, `X-Frame-Options:
   DENY`, `Referrer-Policy`, CSP fuers Dashboard (Inline + Google Fonts
   erlaubt), `Cache-Control: no-store` fuer `/api/*`. ✅ (`src/middleware.js`)
   - Erwartet: Header auf `/` und `/api/state` exakt gesetzt.
   - Verifikation: `test/headers.test.js`.
6. **Eingabe-Validierung** der API-Routen: `to` strikt E.164
   (`^\+[1-9]\d{6,14}$` nach Normalisierung), Laengenlimits fuer Freitexte
   (objective 500, briefing/constraints 2000, caller_name 100, title 200),
   Kalender: gueltige Datumswerte und `end > start`. ✅
   - Erwartet: ungueltige Eingaben -> HTTP 400 mit Fehlertext, gueltige
     unveraendert; keine bestehende gueltige Nutzung bricht (Dashboard sendet
     weiterhin `{to, goal}`).
   - Verifikation: `test/api.test.js` (ungueltige Nummern, Overlong-Strings,
     `end <= start`, Allowlist-403 greift weiterhin nach der Validierung).

## Phase 3 - Ausbau: Betrieb & Datenschutz (Punkte 2-4 umgesetzt)

Autonom umsetzbar (mit Soll-Ergebnis + Verifikation):

2. **Transkript-Retention** (DSGVO): Calls/Notifications aelter als
   `RETENTION_DAYS` (Default 30, 0 = aus) beim Start und periodisch loeschen;
   offene Action Items bleiben erhalten. ✅ (`store.pruneOldData()`, Sweep
   alle 6h; erledigte Action Items aelter als Cutoff werden mit entfernt)
   - Erwartet: Call mit `endedAt` aelter als Cutoff verschwindet samt
     Transkript aus dem Store; aktiver/frischer Call bleibt.
   - Verifikation: `test/retention.test.js` (praeparierte Timestamps,
     DATA_DIR auf Temp-Verzeichnis, Persistenz auf Platte, 0 = aus).
3. **Audit-Logging**: Outbound-Call-Ausloesung (mit Quell-IP), Cancel,
   Settings-Aenderung und fehlgeschlagene Auth-Versuche als `[audit]`-Logzeile. ✅
   (zusaetzlich `place_call_denied` fuer Allowlist-/Budget-Ablehnungen;
   Settings-Audit loggt nur Keys, keine Werte)
   - Erwartet: jede dieser Aktionen erzeugt genau eine `[audit]`-Zeile mit
     Aktion + IP; keine Secrets im Log.
   - Verifikation: `test/audit.test.js` (faengt stdout des Kindprozess-Servers
     ab, prueft Zeilen-Anzahl und Secret-Freiheit).
4. **Dependency-Scanning**: `npm audit` + Tests + Syntax-Check in CI
   (GitHub Actions, bei jedem Push). ✅ (`.github/workflows/ci.yml`)
   - Erwartet: Workflow-Datei vorhanden; Pipeline scheitert bei rotem Test
     oder High-Severity-Audit-Finding.
   - Verifikation: lokal `npm test` gruen + `npm audit --audit-level=high`
     Exit-Code 0; Workflow-Lauf nach Push gruen.

Teilweise autonom (Code umgesetzt, Betrieb braucht den Betreiber):

1. **OAuth 2.1 fuer `/mcp`** statt statischem Bearer-Token (MCP-Spec-konform).
   ⚙️ Code umgesetzt: Resource Server hinter Feature-Flag `MCP_AUTH=oauth`
   (`src/auth.js`, JWT-Verifikation via `jose`/Remote-JWKS, RFC-9728
   Protected-Resource-Metadata), Default bleibt fail-closed. Verifikation:
   `test/oauth.test.js` (lokaler Mini-IdP, C1-Matrix). Detailplan + Rollout:
   `PLAN-PHASE1-OAUTH.md`. Offen (NICHT autonom): IdP-Account (WorkOS) anlegen,
   `MCP_AUTH=oauth` scharf schalten, End-to-End-Test gegen claude.ai.

NICHT autonom (braucht Accounts/Entscheidungen des Betreibers):
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
