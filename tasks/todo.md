# Task (2026-06-16): Telnyx STT/TTS auf bessere Modelle umstellen

Owner-Entscheidung: STT Telnyx-in-house -> Deepgram Nova-3, TTS AWS Polly
Vicki-Neural -> Azure Neural (de-DE, Katja). Scope: NUR Telnyx-Live-Pfad
(`src/telephony/adapters/telnyx/render.js`). Twilio-Adapter bleibt unberuehrt.

## Aenderungen
- [x] GATHER_ATTRS: transcriptionEngine "Telnyx"->"Deepgram" + model "deepgram/nova-3",
      language "de-DE"->"de" (Deepgram-Sprachcode fuer Deutsch).
- [x] TELNYX_VOICE: voice "Polly.Vicki-Neural"->"Azure.de-DE-KatjaNeural".
- [x] Kommentare in render.js nachziehen; Snapshot-Test telnyx-render.test.js anpassen.

## Erwartetes Ergebnis (deterministisch, pruefbar)
- Telnyx-Gather: `<Gather input="speech" language="de" transcriptionEngine="Deepgram" model="deepgram/nova-3" action="..." method="POST">`
- Telnyx-Say:    `<Say voice="Azure.de-DE-KatjaNeural" language="de-DE">...`
- Twilio-Renderer unveraendert (directive-render + disclosure-outbound bleiben gruen).

## Verifikation
- [x] `node --check src/telephony/adapters/telnyx/render.js` -> OK
- [x] `npm test` -> 460/460 gruen (Baseline gehalten)

## NICHT autonom (geparkt, Owner) - workflow.md Regel 7
- Live-Smoke (echter Telnyx-Anruf): Snapshot prueft nur den String, NICHT ob Telnyx
  ihn akzeptiert / ob STT+TTS real funktionieren.
- Account: Deepgram-STT + Azure-NTTS muessen im Telnyx-Portal freigeschaltet sein,
  sonst Risiko stummer Agent (Bug-Klasse 2026-06-15).
- Kosten: Premium-Add-ons; Minutenkosten laufen AUSSERHALB des Budget-Guards.

---

# Todo: Test-Suite + Phase 2 + Phase 3 (autonome Punkte)

## BUGFIX (2026-06-15): Telnyx-Inbound-Audio/STT -- Agent hoert den Angerufenen nicht

Symptom (live, 2 Calls): VOICE_ENGINE=budget, Telnyx-Outbound. Agent-TTS hoerbar,
aber Transkript enthaelt NUR role:agent, nie role:caller; nach Stille wiederholt
der Agent die Begruessung. Reporter-Verdacht (Media-Streaming/both_tracks/WS)
greift NICHT -- der Realtime-Pfad ist gar nicht aktiv (VOICE_ENGINE=budget).

Wurzel: Telnyx `<Gather input="speech">` transkribiert NUR mit explizitem
`transcriptionEngine` (Telnyx-TeXML-Spec). Der Telnyx-Renderer setzte nur
input+language -> Telnyx erkennt nie Sprache -> kein SpeechResult -> /voice/turn
bekommt leeren Body -> agentTurn(null) re-greet (Redirect-Fallback). Twilio-Seite
hat ein STT (speechModel=deepgram_nova-2-general), Telnyx-Seite hatte keins.
Owner-Entscheidung 2026-06-15: transcriptionEngine="Telnyx" (in-house, $0.025/min).

- [x] src/telephony/adapters/telnyx/render.js: transcriptionEngine="Telnyx" in GATHER_ATTRS
      DONE: gerendertes <Gather> = `input="speech" language="de-DE" transcriptionEngine="Telnyx" ...`
      Verify: `node --test test/telnyx-render.test.js` 6/6 gruen (inkl. neuem Regressionstest);
      node -e Render-Smoke zeigt das Attribut im Outbound-Turn-TeXML.
- [x] Restrisiko benannt: de-DE-Reife der Telnyx-in-house-Engine live unbestaetigt
      (Owner-Wahl). Fallback Google = 1-Zeilen-Aenderung. In README-Abweichungen notiert.
- [x] npm test komplett gruen + node --check.
      DONE: `npm test` 264/264 (vorher 263, +1 Regressionstest), 0 fail. node --check render.js OK.
      OFFEN (nicht autonom testbar): echter Telnyx-Call -> >=1 role:caller-Zeile im Transkript
      (Akzeptanzkriterium). Lokal nicht reproduzierbar (Telnyx-STT = echte Telefonie).



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

## OAuth Rollout-Status (Stand: in Staging end-to-end gruen)

- [x] Schritt A: WorkOS-AuthKit-Account, Application angelegt, DCR + CIMD aktiv,
      MCP Resource Indicator = `https://vodafone-agent.onrender.com/mcp`,
      Issuer = `https://momentous-dune-52-staging.authkit.app` (Staging).
- [x] Rollout D: Code auf master gemergt + von Render deployt; `OAUTH_ISSUER_URL`
      + `MCP_AUTH=oauth` in Render gesetzt. Live verifiziert:
      `/.well-known/oauth-protected-resource` listet Issuer + korrekte `resource`;
      `POST /mcp` ohne Token -> 401 mit `WWW-Authenticate`/`resource_metadata`.
- [x] C3: claude.ai-Connector hinzugefuegt -> WorkOS-Login erschienen ->
      Tools geladen (vom Betreiber bestaetigt).
- [ ] **Offen (Betreiber, vor Dauerbetrieb):** invite-only scharf schalten
      (WorkOS "Sign up" aus, Team per Invite); Staging -> Production-Umgebung
      (eigene authkit.app-Domain, `OAUTH_ISSUER_URL` umstellen).

# Phase 0: Nummern-Regeln - Weg von der starren Allowlist

Ziel des Betreibers: beliebige normale Nummern anrufen (z.B. Friseur), ohne sie
vorher in `ALLOWED_NUMBERS` eintragen zu muessen. OAuth (Phase 1) ist die
Voraussetzung (Identitaet via `req.auth`), ersetzt die Allowlist aber NICHT.
Detailplan: `PLAN-PHASE1-OAUTH.md` (Phasen-Tabelle) bzw. Phase 0 dort.

Leitsatz (Pre-Mortem, unbedingt einhalten): Die Allowlist ist aktuell die
EINZIGE Bremse gegen das Waehlen beliebiger Nummern (Notruf, Premium, Ausland).
Sie darf erst gelockert werden, wenn die Ersatz-Leitplanken (Denylist +
Laender-Gate + Pro-Stunde-Limit) nachweislich greifen - vorher entstehen bei
offener Allowlist Toll-Fraud-/Notruf-/Premium-Risiken.

## Pre-Mortem (vor Umsetzung benannt)

- **Denylist zu scharf**: blockt eine legitime Nummer, die zufaellig wie ein
  Premium-Prefix aussieht. Gegenmassnahme: Prefixe eng fassen (z.B. `+49900`),
  Test deckt ab, dass normale Mobilnummern (`+4915...`) durchkommen.
- **Laender-Gate bricht bestehende Allowlist**: ein erlaubter `+1`-Eintrag faellt
  bei Default `+49` raus. Gegenmassnahme: `scripts/check-setup.js` warnt bei
  Widerspruch zwischen `ALLOWED_NUMBERS` und `ALLOWED_COUNTRY_CODES`.
- **Allowlist zu frueh entfernt**: Toll-Fraud. Gegenmassnahme: Allowlist bleibt
  letztes Gate, solange nicht bewusst (mit invite-only + Phase 2) anders entschieden.
- **Notrufe sind nicht E.164**: `112` etc. kommen evtl. nicht als `+49112`.
  Gegenmassnahme: Denylist prueft sowohl Kurzwahlen (roh) als auch Premium-Prefixe.

## Aufgaben

- [x] **0.1 Notruf-/Premium-Denylist** (hardcoded, kein Env) in `src/server.js`:
      Notruf-Kurzwahlen (110, 112, 911, 999), DE-Premium/Service
      (`+49900`, `+49137`, `+49180`, `+49118`), Satellit/Intl-Premium
      (`+870`, `+881`, `+882`, `+883`, `+979`).
  - Soll: `POST /api/calls` an eine dieser Nummern -> 403 mit klarer Meldung,
    `audit place_call_denied ... grund=denylist`; normale Nummer passiert das Gate.
  - Verifikation: `test/number-gate.test.js` - je Prefix/Kurzwahl ein 403-Fall,
    eine normale `+4915...`-Nummer kommt durch (bis zum naechsten Gate).
  - Ergebnis: gruen. `isDenied()` (Kurzwahlen exakt, Premium per `startsWith`)
    laeuft als ERSTES Gate, BEWUSST vor der E.164-Pruefung, damit `112` als
    403 `grund=denylist` (nicht 400 Format) erscheint - das war die einzige
    Abweichung von der in 0.4 notierten Reihenfolge "E.164 -> Denylist" und ist
    durch das 0.1-Soll ("je Kurzwahl ein 403-Fall") erzwungen. Tests: 4 Kurzwahlen,
    4 DE-Premium-, 5 Satellit/Intl-Prefixe -> 403; `+4915112345678` -> 500 (Twilio).
- [x] **0.2 Laender-Gate** `ALLOWED_COUNTRY_CODES` (kommasepariert, Default
      `+49`, `*` = alle) in `config.js` + Gate in `src/server.js`.
  - Soll: Nummer ohne erlaubten Laendercode -> 403; mit erlaubtem -> passiert;
    `*` laesst alle durch.
  - Verifikation: Test - `+49...` ok bei Default, `+1...` -> 403 bei Default,
    beide ok bei `*`.
  - Ergebnis: gruen (`countryAllowed()`, `startsWith` ueber die erlaubten Prefixe).
    `+12025550123` -> 403 `grund=land` bei Default `+49`; bei `*` -> 500 (Twilio).
- [x] **0.3 Pro-Stunde-Call-Limit** `MAX_CALLS_PER_HOUR` (Default 6) in
      `config.js`; Sliding-Window ueber Outbound-Call-Zeitstempel (eigenes Gate,
      NICHT der bestehende Per-IP-Request-Limiter aus Phase 2.1).
  - Soll: N+1-ter Outbound-Call innerhalb 1h -> 403/429 mit klarer Meldung.
  - Verifikation: Test mit Limit 2 -> 3. Call geblockt (Calls im Store seeden
    oder ueber den offline-testbaren place_call-Pfad).
  - Ergebnis: gruen. `store.countOutboundCallsSince()` zaehlt Outbound-Records im
    gleitenden Stundenfenster; `hourlyCallLimitReached()` -> 429 `grund=stundenlimit`.
    Tests: Limit 2 + 2 frische Calls geseedet -> 3. Call 429; 1 Call -> passiert;
    alte Calls (>1h) zaehlen nicht; Inbound zaehlt nicht.
- [x] **0.4 `allowlistError()` -> `numberGateError(to)`** zusammenfuehren,
      Pruefreihenfolge: E.164 (existiert) -> Denylist (0.1) -> Laender-Gate (0.2)
      -> Pro-Stunde-Limit (0.3) -> Allowlist (Bestand, letztes Gate).
  - Soll: alle bisherigen Allowlist-/Budget-Tests bleiben gruen; neue Gates
    greifen in genau dieser Reihenfolge.
  - Verifikation: `npm test` (Altbestand + neue Faelle) gruen.
  - Ergebnis: gruen, `npm test` -> pass 91/91 (74 Altbestand + 17 neu). Tatsaechliche
    Reihenfolge: Denylist -> E.164 -> Land -> Stundenlimit -> Allowlist (Denylist
    vorgezogen, Begruendung s. 0.1). `numberGateError(to)` liefert
    `{status, grund, message}`; die Route auditiert `place_call_denied grund=<gate>`
    fuer 403/429 (400-Formatfehler NICHT). Pruefreihenfolge-Tests belegen:
    Denylist schlaegt Land+Allowlist, Land schlaegt Allowlist, leere Allowlist
    bleibt letztes Gate (403). Altbestand (api/audit) unveraendert gruen.
- [x] **0.5 Doku/Konfig**: `.env.example` + `render.yaml`
      (`ALLOWED_COUNTRY_CODES`, `MAX_CALLS_PER_HOUR`); `scripts/check-setup.js`
      warnt bei Allowlist/Laender-Gate-Widerspruch; PLAN-Status aktualisieren.
  - Verifikation: `node --check`, `npm run check` ohne Crash.
  - Ergebnis: gruen. `.env.example` + `render.yaml` um beide Vars + Denylist-Hinweis
    erweitert; `check-setup.js` meldet Land-Gate + Stundenlimit und FLAGGt eine
    Allowlist-Nummer ohne passende Laendervorwahl als Fehler (verifiziert mit
    `+12025550123`/`+49`). `node --check` aller Dateien ok; `check-setup.js` laeuft
    ohne Crash bis zur Ergebnis-Zeile durch. PLAN-PHASE1-OAUTH.md Phasen-Tabelle
    + PLAN-SECURITY.md Phase 0 aktualisiert.
- [ ] **0.6 Entscheidung Allowlist-Lockerung (Betreiber, NICHT autonom)**:
      Soll bei aktivem 0.1-0.3 + invite-only eine leere `ALLOWED_NUMBERS`
      bedeuten "Laender-Gate regelt" statt "Outbound gesperrt"? Bewusst
      entscheiden und dokumentieren; danach ggf. das letzte Gate optional machen.
      Komplettes Wegfallen pro Nutzer erst mit Phase 2 (Rechteprofile).
  - **Betreiber-Entscheidung (2026-06-13): auf Phase 2 vertagt.** Bis dahin
    bleibt die Allowlist das harte letzte Gate (leer = Outbound gesperrt) - KEINE
    Lockerung autonom. Architektur ist vorbereitet: die Lockerung waere die letzte
    Verzweigung in `numberGateError()` (leere Allowlist -> kein 403). Umsetzung
    dann pro Nutzer mit den Rechteprofilen (Phase 2), nicht global.

## Verifikation Gesamt (Phase 0)

- `npm test` gruen (inkl. `test/number-gate.test.js`), `npm audit
  --audit-level=high` Exit 0, Smoke-Test: gesperrte Nummer -> 403, normale
  Nummer im erlaubten Land -> kommt durch (mit leerer Allowlist nur, falls 0.6
  so entschieden).

# Phase 2: Rechteprofile pro Nutzer

Setzt 0.6 um: pro authentifiziertem MCP-Nutzer (OAuth-Identitaet aus `req.auth`)
ein Rechteprofil. Ein Profil kann eine eigene `allowedNumbers`-Liste haben UND
optional `unrestricted: true` (hebt die GLOBALE Allowlist fuer diesen Nutzer auf).
In ALLEN Faellen bleiben Denylist, Land-Gate, Pro-Stunde-Limit, Budget, Max-Dauer,
Disclosure und Twilio-Signatur unveraenderte HARTE Obergrenzen (ein Profil kann
nur einschraenken, nie ueber die globalen Limits hinaus erweitern).

Identitaet ist serverseitig und NIE aus dem Request-Body: das `/mcp`-handle hat
`req.auth.email` (verifiziertes JWT); sie wird als interner Header
`X-Internal-Identity` an die localhost-`/api/calls` gereicht. Das Gateway
akzeptiert diesen Header NUR von localhost-Sockets (sonst spoofbar) und ignoriert
Body-Felder wie `requestedBy`/`email` immer.

## Pre-Mortem (Risiken, vor Umsetzung benannt)

- **Profil erweitert ueber globale Limits hinaus** (z.B. `unrestricted` umgeht
  versehentlich auch Denylist/Land/Stunde -> Toll-Fraud/Notruf). Gegenmassnahme:
  `unrestricted`/Profil-Allowlist heben AUSSCHLIESSLICH die Allowlist auf; alle
  anderen Gates laufen davor und unveraendert. Land = Schnittmenge(global, profil)
  (Profil `*` widened NICHT), Stunde = global UND min(global, profil). Tests (c)/(d)
  beweisen das.
- **`X-Internal-Identity` von extern spoofbar** -> Privilege Escalation. Gegen-
  massnahme: Header nur von `isLocalSocket(req)` akzeptiert; Body-Identitaet immer
  ignoriert. Test (b) beweist: externer Header wird ignoriert (Owner-Verhalten).
- **Fail-open bei Token ohne `email`-Claim** -> `email||null` waere `null` =
  Owner = volle Rechte. Gegenmassnahme: Identitaet = `req.auth.email || req.auth.sub`
  (nur wenn `req.auth` fehlt -> null -> Owner; das ist stdio/localhost-Legacy).
  Authentifiziert ohne Profil -> DEFAULT_PROFILE (restriktiv), nicht Owner.
- **Profile landen unter `settings`** und werden von `updateSettings`/der
  Settings-Whitelist anfassbar/leakbar. Gegenmassnahme: eigener Top-Level-Key
  `profiles`; `updateSettings` faesst ihn nicht an. Test (e) beweist:
  `POST /api/settings {profiles:...}` aendert nichts.
- **Owner-Verhalten bricht (Phase-0-Tests rot)**: localhost ohne Identitaet muss
  weiter exakt wie heute laufen. Gegenmassnahme: OWNER_PROFILE = permissiv
  (globale Allowlist greift weiter, kein Zusatz-Limit, Kalender/Booking erlaubt);
  `resolveProfile(null) === OWNER_PROFILE`. Altbestand bleibt gruen.
- **Selbst-Bedienung der Profile durch MCP-Nutzer**: `/api/profiles` hinter
  Basic-Auth; OAuth-MCP-Nutzer erreichen nur `/mcp`, nicht `/api/*` -> kein
  Self-Service. Kein MCP-Tool fuer Profilverwaltung.

## Aufgaben

- [x] **2.1 Store (`src/store.js`)**: Top-Level-Key `profiles` ({} in `defaults()`
      + Migration in `load()`); `OWNER_PROFILE` (permissiv) / `DEFAULT_PROFILE`
      (restriktiv) als Konstanten; `resolveProfile(email)` (null->Owner, bekannt->
      DEFAULT+stored, unbekannt->DEFAULT); `setProfile/deleteProfile/listProfiles`;
      `sanitizeProfile()` (Whitelist+Typ wie `updateSettings`, inkl. `string[]`-
      Pruefung + Nummern-Normalisierung); `countOutboundCallsSince(sinceIso,
      requestedBy=null)` um `requestedBy`-Filter erweitern; `createCall` speichert
      `requestedBy`.
  - Ergebnis: gruen. `resolveProfile(null)`=OWNER (permissiv), Unbekannt=DEFAULT
    (restriktiv) ueber das Gate-Verhalten in `test/profiles.test.js` belegt;
    `sanitizeProfile`-Whitelist + Nummern-Normalisierung per Profil-Verwaltungs-
    Test (`junk`/falscher Typ verworfen, `+49 151 ...` -> `+491511234567`);
    `countOutboundCallsSince(requestedBy)` per pro-Nutzer-Stundenlimit-Test.
- [x] **2.2 Gateway-Gates (`src/server.js`)**: `internalIdentity(req)` (nur
      localhost, sonst null; Body ignoriert); `numberGateError(to, profile,
      requestedBy)` - Reihenfolge Denylist->E.164->Land->Stunde->Allowlist, aber
      Land=Schnittmenge(global,profil), Stunde=global UND min(global,profil) pro
      Nutzer, Allowlist=`unrestricted`/Profil-Allowlist heben sie auf, sonst global;
      `/api/calls` resolved Profil + `requestedBy`, Audit `place_call`/
      `place_call_denied` um `requestedBy=<email|owner>` ergaenzt.
  - Ergebnis: gruen. (c) `+1` bei global `+49` trotz Profil-`*` -> 403 `land`;
    unrestricted -> nicht-gelistete `+49` -> 500. (d) global erschoepft ->
    frischer Nutzer 429. (b) externer `X-Internal-Identity` ignoriert (403 statt
    500). Altbestand (number-gate/audit/api) unveraendert gruen.
- [x] **2.3 MCP-Identitaet (`src/mcp-tools.js`, `src/server.js`)**:
      `registerTools(server, {identity, allowCalendar})`; `call()`-Closure reicht
      `X-Internal-Identity` durch; `/mcp` uebergibt `identity = req.auth ?
      (req.auth.email||req.auth.sub) : null` + `allowCalendar` aus resolvtem Profil;
      `get_calendar`-Tool nur wenn `allowCalendar`; stdio bleibt `registerTools(server)`.
  - Ergebnis: gruen. e2e (single `tools/call`, stateless - kein initialize noetig):
    JWT(email) -> Audit `place_call ... requestedBy=alice@team.test`; JWT ohne
    email -> `requestedBy=subonly-9` (NICHT owner), `assert !requestedBy=owner`.
- [x] **2.4 Booking-Gate (`src/server.js`)**: `POST /api/calendar` prueft
      `profile.allowBooking` (Owner/null = erlaubt, DEFAULT_PROFILE = 403).
  - Ergebnis: gruen. Owner 200, DEFAULT-Profil 403 (`/allowBooking/`),
    `allowBooking=true` 200. `audit booking_denied` bei Ablehnung.
- [x] **2.5 Verwaltung (`src/server.js`)**: `GET /api/profiles`,
      `POST /api/profiles` (`{email, ...felder}` -> sanitize+set), `DELETE
      /api/profiles/:email`, alle hinter Basic-Auth (Bestand deckt `/api/*`);
      Audit `profile_update`/`profile_delete` (nur email+keys, keine Werte).
  - Ergebnis: gruen (Test + Smoke). POST sanitisiert + audit `keys=`, GET listet,
    DELETE 200/404; Nummern-Wert nicht im Log.
- [x] **2.6 Tests**: `test/profiles.test.js` (node:test, offline); `startIdp`
      aus `test/oauth.test.js` nach `test/helpers.js` extrahiert + wiederverwendet.
      Offline-Twilio-Trick (`TWILIO_ACCOUNT_SID:""` -> durchgelassen 500, Sperre
      403/429). Keine neuen Env-Vars (Profile sind Daten).
  - Ergebnis: `npm test` -> pass 113/113 (vorher 91, +22), `npm audit
    --audit-level=high` -> "found 0 vulnerabilities", Exit 0.
- [x] **2.7 Doku**: `PLAN-SECURITY.md` Rechteprofile als umgesetzt; keine neuen
      Env-Vars (Profile sind Daten) -> `.env.example`/`render.yaml` unveraendert.
  - Ergebnis: `node --check` aller geaenderten Dateien gruen.
- [x] **2.8 Review**: unabhaengiger Subagent / `/security-review` adversarial gegen
      Absolute Regeln + Pre-Mortem (kein Profil ueber globale Limits, requestedBy
      nicht spoofbar, Tests beweisen Verhalten). Findings einarbeiten.
  - Ergebnis: Verdikt "safe to ship: YES" gegen alle 6 Absoluten Regeln; alle
    must-prove-Eigenschaften vom Code erzwungen + von Tests belegt. 3 S3-Findings:
    (1) theoretischer Fail-open bei Token OHNE email UND sub -> behoben:
    ANON_IDENTITY-Sentinel statt null/Owner (-> DEFAULT_PROFILE); neuer Test
    "JWT ohne email UND sub -> requestedBy=anon". (2) `/api/profiles` ohne
    DASHBOARD_PASSWORD offen = geerbte, dokumentierte Prototyp-Abweichung (gilt
    fuer ganz `/api/*`, inkl. `/api/calls`) -> bewusst akzeptiert + in
    PLAN-SECURITY.md begruendet (kein neuer Vektor; scharfes Fail-closed bleibt
    fuer spaeter offen). (3) Anti-Spoof-Subtest uebersprungen ohne externe IP
    (Projekt-Konvention, wie audit/security.test) -> zusaetzlicher IMMER laufender
    Test "Body-Felder gelten nicht als Identitaet" ergaenzt. `npm test` 115/115
    (2x stabil), `npm audit --audit-level=high` Exit 0.

## Nachtrag (Produktion, nach Live-Test mit WorkOS)

- WorkOS-Access-Token traegt KEINE email -> Identitaet = `req.auth.sub`
  (`user_01...`). Profil-Schluessel daher = email ODER sub; Verwaltungs-API
  akzeptiert jetzt jede nicht-leere Identitaet ohne Whitespace (vorher `@`-Pflicht).
- Render free plan = fluechtiges Dateisystem -> per-API angelegte Profile sind nach
  jedem Neustart weg. Loesung: **`PROFILES_JSON`** (Env-Var) seedet Profile beim
  Start (sanitisiert, fail-safe bei kaputtem JSON). Smoke-Test mit echtem sub:
  geseedet -> Call passiert die Allowlist (500), ohne Identitaet -> 403.
- Tool-Beschreibung von `place_call` entschaerft (nicht mehr "muss in der Allowlist
  stehen", sondern "Server-Safety-Gates entscheiden"). `npm test` 121/121.

---

# Onboarding ohne Payment + Telnyx-Outbound (2026-06-15, feat/onboarding-no-payment)

Ziel (Auftraggeber, woertlich): "alles funktioniert, nur bezahlen ueberspringen".
Fundament (Commit 1254e77): State-Machine + Cost-Cap (offline, JSON+Schema). Hier:
Telnyx-Outbound, NumberProvisioning, Onboarding-Route, pg-Persistenz der neuen
Entitaeten, cross-tenant Inbound-Routing. Stripe ersetzt durch MAX_NUMBERS-Notbremse.

## Verifizierte Telnyx-API (Doku 2026-06-15, live UNBESTAETIGT -> live mit Owner fixen)
- Outbound initiate: POST {base}/v2/texml/calls/{connection_id}, form From/To/Url/
  StatusCallback..., Bearer; Antwort = Twilio-kompatible Call-Resource (sid=CallSid).
- Hangup: POST {base}/v2/texml/Accounts/{account_sid}/Calls/{call_sid}, form Status=completed.
  -> braucht account_sid (Config TELNYX_ACCOUNT_SID) + connection_id (TELNYX_CONNECTION_ID).

## A) Telnyx-Outbound-Adapter  [erste Live-Test-Scheibe]
- [ ] src/telephony/adapters/telnyx/voice.js: originateCall + endCall (TeXML-API, fetch, kein Key-Leak)
      Erwartet: originate -> richtige URL+From/To/Url, returns {sid}; endCall -> Accounts/.../Calls Status=completed
      Verify: test/telnyx-voice.test.js (global.fetch gestubbt) gruen
- [ ] registry.voiceControl(provider): telnyx->telnyxVoice, Default twilio byte-identisch
      Verify: telephony-contract.test.js / registry-unit gruen
- [ ] config.js + .env.example + render.yaml: TELNYX_CONNECTION_ID, TELNYX_ACCOUNT_SID (optional)
- [ ] server.js /api/calls: outbound provider=telnyx wenn TELNYX_NUMBER gesetzt; from=telnyxNumber;
      createCall provider; originate ueber voiceControl(provider). endCall (cancel + max-dauer-timer)
      provider-aware (call.provider). Outbound-Max-Dauer-Timer ARMEN (Telnyx-TimeLimit unbestaetigt
      -> Timer ist der echte Cap, Absolute Regel Max-Dauer).
      Verify: server-spawn-Test mit lokalem Telnyx-Mock (TELNYX_API_BASE) -> 200 dialing,
      call.provider=telnyx, from=telnyx-Nummer, Mock erhielt From/To/Url. Twilio-Pfad byte-identisch.
- [ ] Beide Backends gruen (npm test selbst gezaehlt), node --check.

## D) pg-Persistenz neuer Entitaeten + cross-tenant Inbound-Routing
- [ ] flush/hydrate: tenants[], numberAssignments[], number.status/provider_number_id/id (heute fehlt)
- [ ] findTenantByNumber auf status='active' gaten (fail-closed) + cross-tenant hydrate
      Verify: store-pg-*.test.js (pglite, eigene Datei) round-trip + cross-tenant read

## B) NumberProvisioning (Adapter + Port) -- KEIN Live-Kauf ohne Owner-Freigabe pro Order
- [ ] adapters/telnyx/numbers.js: searchNumbers/orderNumber/configureNumber/releaseNumber + Port
- [ ] An State-Machine: requested->provisioning->order->activate; Fehlerpfad failNumber+release; Idempotency-Key
      Verify: unit (fetch gestubbt) + state-machine-Integration

## C) Onboarding-Route POST /api/onboard (Auth + Gates)
- [ ] registerTenant -> requestNumber (Cap) -> provision -> activate; KEIN offener ungegateter Geld-Endpunkt
      Verify: server-spawn-Test (Cap blockt, Auth noetig)

## Absolute Regeln (Erinnerung)
- MAX_NUMBERS Notbremse Pflicht (ersetzt Stripe), kein unbegrenzter Auto-Kauf, neue Endpunkte
  hinter Auth + Gates. Disclosure fest verdrahtet. Outbound nur ALLOWED_NUMBERS. Secrets nie loggen.

---

# #3 Self-Service-Login-Konvergenz (web-session-only, 2026-06-16, feat/self-service-web-session)

Self-Service (`/api/self-service/*`) vom `X-Internal-Identity`-Pfad auf den OIDC-
Web-Session-Pfad (Feature B, `webAuthMw`) umstellen. Bearer-Paste in tenant.html
entfaellt. Plan: `~/.claude/plans/moonlit-honking-wave.md`. Workflow-Regel 7: jeder
Punkt mit Soll + Verifikation, abgehakt erst bei gruener Verifikation in der Session.

## Pre-Mortem (vor Umsetzung)
- Falscher Tenant: `tenantId` NUR aus webAuthMw (Session->account->tenant_id), kein
  User-Input; Lese-Pfad `exportTenantData`-gefiltert. Test (a) belegt kein Leak.
- Session-Bypass: Routen nur hinter webAuthMw (401 fail-closed), nur im pg-Block,
  kein X-Internal-Identity mehr. Test (f) belegt 401/403.
- Stilles 404 bei Fehlkonfig (selfService an, kein pg): assertConfig-Warnung + Doku.
- Absolute Regeln unberuehrt: Safety-Gates/disclosure/Audio-Bridge nicht angefasst;
  Self-Service schreibt nie Owner-Bucket (tenant = t_<sub>).

## Aufgaben
- [x] **1. RED**: `test/i9-self-service.test.js` neu (pg In-Process, Session-Cookie,
      Template portal-route.test.js) + Flag-Gate (json->404).
  - Ergebnis: RED bestaetigt — i9 ERR_MODULE_NOT_FOUND (self-service-routes.js fehlt),
    flag-gate 200!=404 (alte Inline-Route lief noch).
- [x] **2. views.js + server.js Helfer**: `src/store/views.js` (publicCall,
      findActiveNumber, activeNumberFor, upcomingCalendar(store,tenantId)); server.js
      importiert, lokale Defs raus, `upcomingCalendar(store,tenant)` am /api/state.
  - Ergebnis: NUMBER_STATUS-Import aus server.js entfernt (nur findActiveNumber nutzte
    ihn). node --check OK, Bestandssuite gruen.
- [x] **3. self-service-routes.js + wiring**: makeSelfServiceRoutes({store,webAuthMw,
      audit}); im pg-Block hinter selfServiceEnabled&&multiTenant; alter Inline-Block
      + ungenutzter Import raus.
  - Ergebnis: neue Tests GRUEN — `node --test i9-self-service + flag-gate` 14/14.
- [x] **4. tenant.html**: Cookie-Login statt Bearer (401->Anmelden, 403->Freigabe,
      200->Logout). Ergebnis: authHeader/TOKEN_KEY/localStorage/connect entfernt
      (grep CLEAN); fetch same-origin schickt Cookie automatisch.
- [x] **5. config + Doku**: assertConfig-Warnung; render.yaml, PLAN-SECURITY.md,
      MERGE-RECONCILIATION (#3 done). Ergebnis: erledigt. AUSNAHME: `.env.example`
      ist durch ein `.env*`-Deny (Secrets-Guard) nicht editierbar -> Kommentar-Update
      dort als manueller 1-Zeilen-Follow-up offen (cosmetic).
- [x] **6. GREEN + Commit**: volle Suite gruen, kein Skip/Disable, commit.
  - Ergebnis: `npm test` -> tests 414, pass 414, fail 0, skipped 0 (~33s).

## Review (Endstand)
- `npm test`: 414 Tests, 0 fail, 0 skipped, ~33s. node --check auf alle geaenderten
  src-Dateien (config/server/views/self-service-routes) sauber.
- Count-Delta zur Baseline (427) ist rein strukturell: die alte i9-Datei nutzte
  nested `t.test` (Parent+Child gezaehlt), die neue flache `test()` — keine verlorene
  Coverage (alle Faelle a–f + Flag-Gate abgedeckt).
- Absolute Regeln unberuehrt: Safety-Gates (numberGateError/Allowlist/Budget),
  disclosureSentence, Audio-Bridge nicht angefasst; Auth fail-closed (webAuthMw 401/403,
  Routen nur im pg-Block); timing-sichere Vergleiche (web-auth.js unveraendert); kein
  neues Env (Gating ueber vorhandene Flags).
- OFFEN (manuell): `.env.example`-Kommentar bei SELF_SERVICE_ENABLED auf web-session
  praezisieren (Tool-Deny auf `.env*`).
