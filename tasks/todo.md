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
- [x] **2.6 Eingabe-Validierung**: `to` strikt E.164 (`^\+[1-9]\d{6,14}$`),
      Laengenlimits (objective 500, briefing/constraints 2000, caller_name 100,
      title 200), Kalender: gueltige Daten + `end > start`.
  - Soll: ungueltig -> 400 mit Fehlertext; gueltig unveraendert.
  - Verifikation: Tests je Grenzfall. Ergebnis: gruen, `npm test` pass 49/49
    (test/api.test.js: Pflichtfelder, 5 ungueltige Nummernformate,
    Normalisierung + Allowlist-403 bleibt, 4 Overlong-Faelle, Kalender-
    Grenzfaelle inkl. end==start, gueltiger Eintrag landet im Store).
    Dashboard-Kompatibilitaet: `{to, goal}` wird weiter akzeptiert.

## Phase 3 (nur autonome Punkte 2-4)

- [x] **3.2 Transkript-Retention**: `RETENTION_DAYS` (Default 30, 0 = aus),
      `store.pruneOldData()` beim Start + periodisch (6h, unref); offene
      Action Items bleiben, erledigte alte werden mit entfernt.
  - Soll: Call mit altem `endedAt` verschwindet samt Transkript; aktiver/
    frischer Call bleibt; offene Action Items bleiben.
  - Verifikation: Unit-Test gegen `store.pruneOldData()` mit praeparierten
    Timestamps (DATA_DIR=Temp). Ergebnis: gruen, `npm test` pass 52/52
    (test/retention.test.js: Loeschung, Persistenz auf Platte, 0=aus).
- [x] **3.3 Audit-Logging**: place_call (mit Quell-IP), place_call_denied
      (Allowlist/Budget), cancel, Settings-Aenderung (nur Keys, keine Werte),
      fehlgeschlagene Auth-Versuche (Basic + MCP) als `[audit]`-Zeile.
  - Soll: je Aktion genau eine `[audit]`-Zeile mit Aktion + IP, keine Secrets.
  - Verifikation: Test faengt stdout des Kindprozesses ab. Ergebnis: gruen,
    `npm test` pass 61/61, 3 Laeufe stabil (test/audit.test.js; Pipe-Flush-
    Race ueber waitForLog-Polling in helpers.js entschaerft; place_call-Pfad
    offline testbar, weil twilio bei leerer SID synchron VOR Netzzugriff wirft).
- [x] **3.4 CI**: GitHub Actions mit Syntax-Check + `npm test` +
      `npm audit --audit-level=high` bei jedem Push.
  - Soll: Workflow-Datei vorhanden; Pipeline scheitert bei rotem Test oder
    High-Severity-Finding.
  - Verifikation: lokal `npm test` gruen + `npm audit --audit-level=high`
    Exit 0; Workflow-Lauf nach Push. Ergebnis: `.github/workflows/ci.yml`
    vorhanden; lokal `npm test` pass 61/61 + `npm audit --audit-level=high`
    -> "found 0 vulnerabilities", Exit 0. Workflow-Lauf #1 nach Push GRUEN
    (Run 27448525604: Syntax-Check, Tests, Dependency-Audit alle success).

## Doku nach Umsetzung

- [x] PLAN-SECURITY.md: Phase 2 + 3.2-3.4 als umgesetzt markiert (mit
      Verweis auf die jeweiligen Testdateien).
- [x] .env.example + render.yaml: `RATE_LIMIT_PER_MIN`, `RETENTION_DAYS`.
- [x] CLAUDE.md / workflow.md / clean-code.md: "kein Test-Framework"-Stellen
      auf node:test umgestellt.

## NICHT anfassen (laut Auftrag)

- OAuth 2.1 fuer /mcp (Phase 3.1) - braucht Betreiber.
- Secrets-Hygiene (Phase 3.5) - braucht Twilio-/Render-Konto.

## Review (Endstand)

- `npm test`: 61 Tests, 0 Fails, ~4s - dreimal in Folge stabil; laeuft ohne
  `.env` und ohne externen Netzzugriff (Sandbox ohne Internet).
- `npm audit --audit-level=high`: "found 0 vulnerabilities", Exit 0.
- Smoke-Test: Server bootet, `/healthz` 200, Dashboard 200 mit allen
  Security-Headern, `/api/state` mit `Cache-Control: no-store`.
- Safety-Gates unveraendert und jetzt regressionsgetestet: Twilio-Signatur,
  Basic-Auth fail-closed (inkl. X-Forwarded-For-Spoof), MCP fail-closed,
  Allowlist (403 nach Validierung), Budget-Gate, Offenlegungssatz unberuehrt.
- Bewusste Abweichungen/Notizen:
  - Rate-Limit-Fenster-Reset (wieder 200 nach 60s) implementiert, aber nicht
    automatisiert getestet (wuerde 60s Testlaufzeit kosten; die definierte
    Verifikation verlangt nur die Folge 200...200,429).
  - Tests, die eine Nicht-localhost-IP brauchen, laufen ueber die externe
    Interface-IP des Hosts und werden uebersprungen, falls keine existiert.
  - media-token.test.js (korrektes Token) loest einen wss-Connect Richtung
    OpenAI aus, der offline fehlschlaegt - der Test haengt nicht davon ab.
  - Calls, die durch einen Crash dauerhaft auf status=active stehen bleiben,
    werden von der Retention nie geloescht (bewusst: endedAt-basiert lt. Plan).

# Phase 3.1: OAuth 2.1 fuer /mcp (autonomer Code-Anteil)

Detailplan: `PLAN-PHASE1-OAUTH.md` (urspruenglich auf Branch inspiring-gates,
gegen die aeltere Code-Struktur geschrieben - hier an den aktuellen Stand
angepasst). Umgesetzt wird der vollstaendig autonom test- und verifizierbare
Code-Anteil (Schritt B + Testmatrix C1, plus C2 als lokaler Self-Test).
NICHT autonom und ausdruecklich geparkt: IdP-Account anlegen (Schritt A,
WorkOS) und der End-to-End-Test gegen claude.ai (C3) - braucht einen Menschen
mit Account.

Leitplanke: Der in Phase 1 gesetzte Fail-closed-Default von `/mcp`
(ohne Token nur localhost) bleibt unveraendert. OAuth ist ein zusaetzlicher
Modus hinter `MCP_AUTH`, kein neuer Default.

- [x] **B2 Config**: `MCP_AUTH` (Modus: leer=Legacy/fail-closed, `off`, `token`,
      `oauth`), `OAUTH_ISSUER_URL`, `OAUTH_AUDIENCE` in `config.js`;
      `assertConfig()` meldet fehlende `OAUTH_ISSUER_URL` bei `MCP_AUTH=oauth`.
  - Soll: bei `MCP_AUTH=oauth` ohne `OAUTH_ISSUER_URL` schreibt der Start eine
    `[Konfiguration unvollstaendig]`-Zeile mit `OAUTH_ISSUER_URL`.
  - Ergebnis: gruen. `test/oauth.test.js` ("ohne OAUTH_ISSUER_URL: Start meldet
    fehlende Konfig") prueft die Logzeile per waitForLog.
- [x] **B3 `src/auth.js`**: `mcpAuth`-Middleware (Modi off/token/oauth +
      Legacy-Fallback) + `registerWellKnown(app)` (RFC 9728 Protected Resource
      Metadata unter `/.well-known/oauth-protected-resource[/mcp]`). JWT-Pruefung
      via `jose` (Remote-JWKS, iss/aud/exp, clockTolerance 30s). Niemals Tokens
      loggen.
  - Soll (Modus oauth): kein Token -> 401 + `WWW-Authenticate` mit
    `resource_metadata="..."`; Muell-/abgelaufenes/falsche-aud-/falsch-signiertes
    Token -> 401; gueltig signiertes Token -> kein 401 (req.auth.email im Log).
  - Soll (Well-known): `GET /.well-known/oauth-protected-resource` -> 200 JSON
    mit `authorization_servers:[<issuer>]`, OHNE Basic-Auth-Prompt.
  - Ergebnis: gruen. `test/oauth.test.js`, lokaler Mini-IdP (jose RS256-Keypair,
    HTTP-Server liefert openid-configuration + JWKS), 8 Subtests inkl. beider
    Well-known-Pfade.
- [x] **B4 `server.js`**: `/.well-known` von Basic-Auth ausgenommen;
      `registerWellKnown(app)`; `app.post("/mcp", mcpAuth, ...)`, Inline-Token-
      Check entfernt; `[mcp]`-Logzeile mit `req.auth?.email`.
  - Soll: Regression - Legacy-Verhalten (kein `MCP_AUTH`, kein Token) bleibt
    exakt: extern 401, localhost ok; mit `MCP_AUTH_TOKEN` -> Bearer noetig.
  - Ergebnis: gruen. `test/security.test.js` (fail-closed + Token-Faelle) und
    `test/audit.test.js` unveraendert gruen; neue Faelle in `test/oauth.test.js`.
- [x] **B5 Doku/Konfig**: `.env.example` + `render.yaml` (`MCP_AUTH`,
      `OAUTH_ISSUER_URL`, `OAUTH_AUDIENCE`); `scripts/check-setup.js` prueft bei
      `MCP_AUTH=oauth` Issuer-Erreichbarkeit + Well-known + 401-ohne-Token;
      README/ONBOARDING Connector-Login-Hinweis; PLAN-SECURITY.md Status;
      Detailplan `PLAN-PHASE1-OAUTH.md` auf den Branch geholt + Status-Banner.
  - Soll: `node --check` aller geaenderten Dateien gruen; `npm run check`
    laeuft ohne Crash auch mit `MCP_AUTH=oauth`.
  - Ergebnis: gruen. `node --check` ok; `node scripts/check-setup.js` mit
    `MCP_AUTH=oauth` laeuft sauber durch (meldet IdP/Gateway korrekt als
    nicht erreichbar, kein Crash).
- [x] **Gesamt-Verifikation**: `npm test` gruen (Altbestand + neue OAuth-Tests),
      `npm audit --audit-level=high` Exit 0.
  - Ergebnis: `npm test` -> pass 72/72 (vorher 61, +11 OAuth), ~6s;
    `npm audit --audit-level=high` -> "found 0 vulnerabilities".

## Geparkt (nicht autonom, braucht Betreiber)

- Schritt A: WorkOS-AuthKit-Account, DCR aktivieren, invite-only, Issuer-URL.
- C3: End-to-End gegen claude.ai (Connector neu, Login-Fenster, Tool-Call).
- Rollout-Schritte D (MCP_AUTH=oauth in Render scharf schalten).
