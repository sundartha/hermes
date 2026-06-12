# Todo: Test-Suite + Phase 2 + Phase 3 (autonome Punkte)

Branch: `claude/plan-security-phase-one-n5dl1h`. Vorgehen nach workflow.md Regel 7:
jeder Punkt hat Soll-Ergebnis + Verifikation, wird erst abgehakt, wenn die
Verifikation in dieser Session gruen war (Befehl + Output daneben).

## Pre-Mortem (Risiken, vor Umsetzung benannt)

- **Rate-Limit blockiert das Dashboard** (pollt alle 2,5s = ~24 Req/min plus
  Interaktionen). Gegenmassnahme: Default 120/min, localhost-Socket ausgenommen.
- **CSP bricht das Dashboard**: index.html nutzt Inline-`<style>`/`<script>`,
  Inline-Event-Handler (`onclick=`) und Google Fonts. Gegenmassnahme: CSP mit
  `'unsafe-inline'` fuer script/style + fonts.googleapis.com/fonts.gstatic.com,
  Verifikation via Header-Test + Smoke-Test des Dashboards.
- **streamToken bricht echte Realtime-Calls**, wenn TwiML-Parametername und
  Bridge-Pruefung nicht uebereinstimmen. Gegenmassnahme: beide Pfade (falsches
  und korrektes Token) im WS-Test.
- **Retention loescht aktive Calls oder offene Action Items**. Gegenmassnahme:
  Unit-Test deckt genau diese Faelle ab (aktiver Call bleibt, offenes Item bleibt).
- **Validierung bricht das Dashboard**: index.html sendet `{to, goal}` (nicht
  `objective`) - Validierung muss beide Feldnamen abdecken.
- **Tests flaky in CI** (Portkonflikte bei parallelen Testdateien).
  Gegenmassnahme: `PORT=0` + tatsaechlichen Port aus Server-Log parsen.
- **Tests haengen an .env des Entwicklers** (dotenv fuellt ungesetzte Vars).
  Gegenmassnahme: Test-Helper setzt ALLE relevanten Env-Vars explizit.

## 0. Test-Suite (Voraussetzung)

- [x] `DATA_DIR`-Override in `config.js`; Server loggt tatsaechlichen Port
      (fuer `PORT=0` in Tests); `npm test` = `node --test "test/*.test.js"`
      (Verzeichnis-Argument funktioniert in Node 22 nicht, Glob schon).
- [x] Helper (`test/helpers.js`): Server als Kindprozess mit explizitem Env,
      Store-Seeding, externe Interface-IP fuer Nicht-localhost-Requests.
- [x] Phase-1-Regressionstests: Twilio-Signatur (gueltig 200/fehlend 403),
      Basic-Auth extern 401 + `X-Forwarded-For: 127.0.0.1`-Spoof bleibt 401,
      MCP ohne Token von extern 401, mit falschem Bearer 401.
- Soll: `npm test` gruen in <60s, ohne Netz, ohne `.env`.
- Verifikation: `npm test`.
- Ergebnis: `npm test` -> `# pass 17, # fail 0`, duration ~2,2s (Stand nach
  Schritt 0; Endstand siehe Review unten).

## Phase 2

- [x] **2.1 Rate-Limiting** (in-house, `RATE_LIMIT_PER_MIN`, Default 120,
      localhost-Socket ausgenommen, /voice ausgenommen).
  - Soll: Request N+1 in 60s von Nicht-localhost-IP -> 429 mit JSON-Error.
  - Verifikation: Test mit Limit 3 -> Folge 200,200,200,429. Ergebnis: gruen,
    `npm test` pass 21/21 (test/rate-limit.test.js: 429-Folge inkl. JSON-Error,
    localhost ausgenommen, /voice ausgenommen). Fenster-Reset nach 60s ist
    implementiert, aber bewusst nicht automatisiert getestet (60s Laufzeit;
    die definierte Verifikation verlangt nur die 200...200,429-Folge).
- [x] **2.2 Body-Size-Limits** 100kb fuer json/urlencoded + JSON-Fehlerhandler.
  - Soll: POST >100kb -> 413; kleine Bodies unveraendert 2xx.
  - Verifikation: Test mit 200kb-Payload -> 413. Ergebnis: gruen, `npm test`
    pass 25/25 (test/api.test.js: 413 fuer json + urlencoded, 200 fuer klein).
- [x] **2.3 `/media`-WebSocket**: zufaelliges `streamToken` pro Call im TwiML,
      Pruefung beim `start`-Event; `/api/state` + `/api/calls/:id` geben es NICHT aus.
  - Soll: falsches/fehlendes Token -> Socket getrennt, kein OpenAI-Connect;
    korrektes Token -> Stream laeuft; kein API-Response enthaelt `streamToken`.
  - Verifikation: WS-Testclient beide Faelle + JSON.stringify-Assertion.
    Ergebnis: gruen, `npm test` pass 32/32 (test/media-token.test.js: trennen
    bei falschem/fehlendem Token, Call-Record bleibt aktiv, offen bei korrektem
    Token, kein API-Leak, TwiML traegt das Token). safeEqual nach src/util.js
    extrahiert (Bridge + Server teilen den timing-sicheren Vergleich).
- [x] **2.4 Settings-Whitelist** gegen Default-Settings in `store.js` (Key + Typ).
  - Soll: `{evil:"x", allowBooking:"nein"}` -> beides ignoriert;
    `{allowBooking:false}` -> uebernommen.
  - Verifikation: Testfall POSTet genau das. Ergebnis: gruen, `npm test`
    pass 35/35 (test/api.test.js: Response UND Store unveraendert bzw.
    uebernommen).
- [x] **2.5 Security-Header**: nosniff, X-Frame-Options DENY, Referrer-Policy,
      CSP (Inline + Google Fonts), `Cache-Control: no-store` fuer `/api/*`.
  - Soll: Header auf `/` und `/api/state` exakt gesetzt.
  - Verifikation: Header-Test. Ergebnis: gruen, `npm test` pass 39/39
    (test/headers.test.js: Header exakt auf / und /api/state, no-store nur
    fuer /api/*).
- [ ] **2.6 Eingabe-Validierung**: `to` strikt E.164 (`^\+[1-9]\d{6,14}$`),
      Laengenlimits (objective 500, briefing/constraints 2000, caller_name 100,
      title 200), Kalender: gueltige Daten + `end > start`.
  - Soll: ungueltig -> 400 mit Fehlertext; gueltig unveraendert.
  - Verifikation: Tests je Grenzfall. Ergebnis: (offen)

## Phase 3 (nur autonome Punkte 2-4)

- [ ] **3.2 Transkript-Retention**: `RETENTION_DAYS` (Default 30, 0 = aus),
      `store.pruneOldData()` beim Start + periodisch; offene Action Items bleiben.
  - Soll: Call mit altem `endedAt` verschwindet samt Transkript; aktiver/
    frischer Call bleibt; offene Action Items bleiben.
  - Verifikation: Unit-Test gegen `store.pruneOldData()` mit praeparierten
    Timestamps (DATA_DIR=Temp). Ergebnis: (offen)
- [ ] **3.3 Audit-Logging**: place_call (mit Quell-IP), cancel, Settings-
      Aenderung, fehlgeschlagene Auth-Versuche als `[audit]`-Zeile.
  - Soll: je Aktion genau eine `[audit]`-Zeile mit Aktion + IP, keine Secrets.
  - Verifikation: Test faengt stdout des Kindprozesses ab. Ergebnis: (offen)
- [ ] **3.4 CI**: GitHub Actions mit Syntax-Check + `npm test` +
      `npm audit --audit-level=high` bei jedem Push.
  - Soll: Workflow-Datei vorhanden; Pipeline scheitert bei rotem Test oder
    High-Severity-Finding.
  - Verifikation: lokal `npm test` gruen + `npm audit --audit-level=high`
    Exit 0; Workflow-Lauf nach Push. Ergebnis: (offen)

## Doku nach Umsetzung

- [ ] PLAN-SECURITY.md: Phase 2 + 3.2-3.4 als umgesetzt markieren.
- [ ] .env.example + render.yaml: `RATE_LIMIT_PER_MIN`, `RETENTION_DAYS`.
- [ ] CLAUDE.md / workflow.md / clean-code.md: "kein Test-Framework"-Stellen
      auf node:test umstellen.

## NICHT anfassen (laut Auftrag)

- OAuth 2.1 fuer /mcp (Phase 3.1) - braucht Betreiber.
- Secrets-Hygiene (Phase 3.5) - braucht Twilio-/Render-Konto.
