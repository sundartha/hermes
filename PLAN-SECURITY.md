# Security-Plan: Vodafone Agent

Sicherheits-Haertung des Telefon-Agenten in drei Phasen, priorisiert nach Risiko.
Kontext: Der Dienst laeuft oeffentlich erreichbar (Render), nimmt echte Anrufe an,
loest echte Anrufe und SMS aus (Kosten!) und speichert Gespraechs-Transkripte.

## Phase 0 - Nummern-Regeln: mehrschichtige Outbound-Gates ✅ (0.1-0.5 umgesetzt)

Ziel: weg von der starren `ALLOWED_NUMBERS`-Allowlist (beliebige normale Nummern
anrufen, z.B. Friseur), ohne die einzige Bremse gegen Notruf-/Premium-/Auslands-
Calls zu verlieren. Loesung: zusaetzliche Gates VOR der Allowlist, die als letztes
Gate scharf bleibt.

`allowlistError()` -> `numberGateError(to)` (`src/server.js`) mit fester
Pruefreihenfolge **Denylist -> E.164 -> Laender-Gate -> Pro-Stunde-Limit ->
Allowlist**:

1. **Notruf-/Premium-Denylist** (hardcoded, kein Env, nicht abschaltbar):
   Kurzwahlen 110/112/911/999 (exakt) + Premium-/Service-Prefixe
   (`+49900/+49137/+49180/+49118`, `+870/+881/+882/+883/+979`). Laeuft bewusst
   vor der Formatpruefung, damit Kurzwahlen als 403 `grund=denylist` statt 400
   erscheinen.
2. **Laender-Gate** `ALLOWED_COUNTRY_CODES` (Default `+49`, `*` = alle).
3. **Pro-Stunde-Limit** `MAX_CALLS_PER_HOUR` (Default 6, eigenes Gleitfenster
   ueber Outbound-Call-Zeitstempel, NICHT der Per-IP-Limiter aus Phase 2.1).
4. **Allowlist** (Bestand) bleibt das letzte Gate.

- Erwartet: gesperrte/falsch-Land-/ueber-Limit-Nummer -> 403/429 mit klarer
  Meldung + `audit place_call_denied grund=<gate>`; normale `+49`-Nummer im Limit
  passiert bis zum Twilio-Call. Allowlist NICHT entfernt/aufgeweicht.
- Verifikation: `test/number-gate.test.js` (Denylist je Prefix/Kurzwahl,
  Land `+49`/`*`, Stundenlimit inkl. Fenster + Outbound-only, Pruefreihenfolge);
  `npm test` pass 91/91, `npm audit --audit-level=high` Exit 0.
- **0.6** (Betreiber-Entscheidung 2026-06-13): KEINE globale Allowlist-Lockerung;
  stattdessen pro Nutzer ueber Rechteprofile (siehe naechster Abschnitt). Die
  globale Allowlist bleibt das harte letzte Gate fuer alle, die nicht per Profil
  ausdruecklich gelockert sind.

## Rechteprofile pro Nutzer (Phase 2 der Roadmap) ✅ (umgesetzt)

Setzt 0.6 um: jeder authentifizierte MCP-Nutzer (OAuth-Identitaet aus `req.auth`)
bekommt ein Rechteprofil. Ein Profil kann die GLOBALE Allowlist fuer diesen
Nutzer lockern - `unrestricted: true` (hebt sie ganz auf) oder eine eigene
`allowedNumbers`-Liste. In ALLEN Faellen bleiben **Denylist, Land-Gate, globales
Pro-Stunde-Limit, Budget, Max-Dauer, Disclosure und Twilio-Signatur unveraenderte
harte Obergrenzen**: ein Profil kann nur WEITER einschraenken, nie ueber die
globalen Limits hinaus erweitern.

- **Identitaet serverseitig, nie aus dem Body**: Der `/mcp`-Handler liest
  `req.auth.email` (verifiziertes JWT) und reicht sie als interner Header
  `X-Internal-Identity` an die localhost-`/api/calls`/`/api/calendar`. Das Gateway
  akzeptiert diesen Header NUR von localhost-Sockets (`isLocalSocket`); von extern
  wird er ignoriert (-> Owner). Body-Felder (`requestedBy`/`email`) gelten nie.
  Fail-closed: ein Token OHNE `email`-Claim wird NICHT zum Owner, sondern bekommt
  ueber `sub` das restriktive `DEFAULT_PROFILE`.
- **Profile als eigener Store-Key** `profiles` (NICHT unter `settings` -
  `updateSettings`/die Settings-Whitelist fassen sie nicht an). `OWNER_PROFILE`
  (localhost/stdio ohne Identitaet) = permissiv = heutiges Verhalten (globale
  Allowlist greift weiter -> Phase-0-Tests bleiben gruen). `DEFAULT_PROFILE`
  (authentifiziert, aber profillos) = restriktiv (kein Kalender/Booking, kleines
  Stundenlimit, keine Allowlist-Lockerung).
- **Gate-Aenderungen** (`numberGateError(to, profile, requestedBy)`, Reihenfolge
  unveraendert Denylist->E.164->Land->Stunde->Allowlist): Land = Schnittmenge
  global ∩ profil (Profil `*`/leer widened NICHT); Stunde = globales Limit (alle
  Outbound) UND pro-Nutzer `min(global, profil)`; Allowlist = `unrestricted`/
  Profil-`allowedNumbers` heben sie auf, sonst gilt die globale (Bestand).
  `place_call`/`place_call_denied`-Audit traegt `requestedBy=<email|owner>`.
- **Kalender/Booking**: `profile.allowCalendar` gated das `get_calendar`-MCP-Tool
  (wird sonst gar nicht registriert); `profile.allowBooking` gated `POST
  /api/calendar` (Owner/null = erlaubt; vorher fehlte hier jede Pruefung).
- **Verwaltung**: `GET/POST /api/profiles` + `DELETE /api/profiles/:email`, alle
  hinter Basic-Auth (Bestand deckt `/api/*` ab; OAuth-MCP-Nutzer erreichen nur
  `/mcp`, nie `/api/*` -> kein Self-Service, kein MCP-Tool dafuer). Audit
  `profile_update`/`profile_delete` (nur email + Keys, keine Werte).
- **Profil-Schluessel = serverseitige Identitaet**: `req.auth.email`, wenn der IdP
  eine email im Token liefert, SONST `req.auth.sub` (z.B. WorkOS `user_01...`). Die
  Verwaltungs-API erzwingt daher keine Email-Form, nur einen nicht-leeren String
  ohne Whitespace.
- **`PROFILES_JSON`** (Env-Var): Profile werden beim Start aus dieser JSON in den
  Store geseedet (sanitisiert, kaputtes JSON crasht den Start nicht). Noetig, weil
  Render (free plan) ein fluechtiges Dateisystem hat - per-API angelegte Profile
  ueberleben dort keinen Neustart, ueber `PROFILES_JSON` gesetzte schon. Format:
  `{"<email|sub>":{"unrestricted":true,"maxCallsPerHour":6}}`.

- Bewusst akzeptiertes (geerbtes) Risiko: Wie das gesamte `/api/*` (inkl. des
  Call-ausloesenden `/api/calls`) sind auch `/api/profiles` ohne gesetztes
  `DASHBOARD_PASSWORD` offen erreichbar - die dokumentierte Prototyp-Abweichung.
  `assertConfig()` warnt auf Render, wenn das Passwort fehlt. Die Profil-Endpunkte
  sind NICHT schwaecher abgesichert als der Bestand und ein offenes
  `/api/profiles` ist weniger gefaehrlich als ein offenes `/api/calls`: ein
  freigeschaltetes Profil nuetzt nur, wer fuer dessen email ein gueltiges JWT des
  vertrauten IdP besitzt; die harten Gates (Denylist/Land/Stunde/Budget) bleiben
  ohnehin. Kein neuer Angriffsvektor durch Phase 2; scharfes Fail-closed bei
  fehlendem Passwort bleibt fuer einen spaeteren, geraeteweiten Schritt offen.

- Erwartet/Verifikation: `test/profiles.test.js` (node:test, offline) beweist
  (nicht nur "gruen"): Profil-`*` widened das Land-Gate nicht (global `+49`
  blockt `+1`); `unrestricted` ruft eine nicht-gelistete `+49`-Nummer an (bis
  Twilio); globales Stundenlimit bleibt fuer frische Nutzer hart (429); externer
  `X-Internal-Identity` wird ignoriert; `POST /api/settings {profiles}` aendert
  nichts; e2e ueber `/mcp` mit JWT -> `requestedBy=<email>` im Audit, Token ohne
  email -> `requestedBy=<sub>` (kein fail-open zum Owner). `npm test` 113/113,
  `npm audit --audit-level=high` Exit 0.

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
   `test/oauth.test.js` (lokaler Mini-IdP, C1-Matrix). Offen (NICHT autonom): IdP-Account (WorkOS) anlegen,
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

## Multi-Tenant-Fundament (Sub-Projekt B: Auth + Tenant-Foundation) ✅ (umgesetzt)

Umbau vom owner-only-Prototyp zum Multi-Tenant-SaaS (Privatkunden zuerst, B2C).
B legt das Fundament: wer darf rein, wie werden Kunden hart getrennt, welche
Zugriffe sind erlaubt. Spec: `docs/superpowers/specs/2026-06-15-auth-tenant-foundation-design.md`,
adversarial geprueft via `/council` (`~/Larry/drafts/2026-06-15_council_auth-tenant-foundation.md`).

**Zwei-Pfad-Architektur.** Der synchrone Owner-Spiegel-Store (`store.js`, Agent-/
Operator-Runtime) bleibt unveraendert; `bridge.js` (HEIKLE STELLE) nicht angefasst.
NEU: `src/store/portal.js` = async, per-Request, RLS-wrapped Kunden-Read-Pfad.

1. **Erzwungener RLS-Wrapper** (`portalStore.withTenant`): jede tenant-gescopte
   DB-Arbeit laeuft in EINER Transaktion mit `SET LOCAL app.current_tenant` (txn-
   lokal -> pgBouncer-Transaction-Pooling-sicher). Kein Query ohne vorheriges
   SET LOCAL. Zwei Linien: app-seitiger `tenant_id`-Filter (primaer) + RLS
   (sekundaer). Resolver-Tabelle `account` ist bewusst RLS-exempt (laeuft vor der GUC).
   - Erwartet: Kunde A sieht nie Daten von B/Owner; abgebrochene Txn (ROLLBACK)
     laesst die GUC nicht auf den naechsten Request leaken.
   - Verifikation: `test/portal-rls-killer.test.js` (Isolation A/B, leerer Tenant,
     Transkript-Leak-Schutz, Error-Injection-GUC-Reset; unprivilegierte `app_user`-
     Rolle, weil pglite-als-Superuser RLS sonst umgeht).
2. **Browser-Login = OIDC Authorization-Code + PKCE, in-house** (kein Provider-SDK
   -> kein Lock-in; nur OIDC-Claims queren die Schicht). Issuer = WorkOS AuthKit
   (`OAUTH_ISSUER_URL`, mit `/mcp` geteilt). `id_token` via `jose` gegen die JWKS
   geprueft inkl. `issuer` UND `audience=OIDC_CLIENT_ID`. CSRF ueber signierten
   `oauth_state`-Cookie; PKCE-Verifier signiert. Session-Cookie httpOnly + Secure
   + SameSite=Lax, signiert (HMAC, `SESSION_SECRET`). Niemals Tokens loggen.
   - Erwartet: state-Mismatch/fehlend -> 400 (kein Account/Session); exchange-Fehler
     -> 401 ohne Detail-/Token-Leak im Body; Erfolg -> signiertes Session-Cookie + Redirect.
   - Verifikation: `test/web-auth.test.js` (PKCE/Cookie-Signatur + Router-Flow),
     `test/web-auth-pg.test.js` (`makeAccounts`/`makeSessions` gegen das echte Schema).
3. **Tenancy + Lifecycle**: `tenant.status` (suspended -> active via Admin -> closed).
   Account-Modell offen + E-Mail-Verifikation (Provider) + Approval-Gate; Erst-Login
   legt Tenant `suspended` an. Single-User pro Tenant (B2C); Schema traegt Mehr-User
   spaeter (`account.tenant_id` nicht unique), wird jetzt nicht gebaut.
4. **webAuth (fail-closed, READ-only)**: prueft signiertes Session-Cookie ->
   Session (`invalidated_at IS NULL AND expires_at > now()`) -> Account-Status
   `active`. Kein Cookie/abgelaufen/invalidiert -> 401; suspended/closed -> 403.
   `/api/portal/*` ist owner-Basic-Auth-exempt (vor der Basic-Auth-Schicht
   registriert) und ausschliesslich ueber webAuth gesichert; aktiv NUR bei
   `SESSION_SECRET` + `STORE_BACKEND=pg` (sonst Block uebersprungen, fail-closed).
   - Verifikation: `test/web-auth-middleware.test.js` (no-cookie/invalidiert/
     abgelaufen -> 401, suspended -> 403, aktiv -> req.tenant); `test/portal-route.test.js`
     (ohne Session 401; aktive Kunden-Session sieht nur eigene leere Calls, kein Owner-Leak).
5. **Admin (admin-allowlist, fail-closed)**: `POST /api/admin/tenants/:id/{approve,
   suspend}` hinter webAuth + `adminOnly` (`ADMIN_EMAILS` ODER role=admin). Suspend
   invalidiert SOFORT alle Sessions des Tenants (gesperrter Kunde liest nicht bis
   Cookie-Expiry weiter). Jede Aktion -> `audit_log`.
   - Verifikation: `test/admin-approval.test.js` (Nicht-Admin 403; approve -> active
     + Audit; suspend -> suspended + Session-Invalidierung + Audit; no-session 401).
6. **Audit + DSGVO**: `audit_log` immutable append-only; `tenant_id` BEWUSST KEIN FK
   (ueberdauert Tenant-Loeschung, Art. 15). `ON DELETE CASCADE` auf `account`/
   `session` (Art. 17, atomare Loeschung).
   - Verifikation: `test/schema-foundation.test.js` (CASCADE entfernt account/
     session, `audit_log` ueberdauert), `test/audit-store.test.js`.

**OIDC-/RLS-Hardening (umgesetzt 2026-06-16, Review + Fix-Workflow):**
- **F1 email_verified**: `claimsFromPayload` uebernimmt `email` nur bei `email_verified === true`
  (Strikt-Gleichheit, kein Truthy-Cast) -> Admin-Allowlist nur ueber verifizierte Adressen.
  Test `test/web-auth.test.js` (T-F1-01..07).
- **F2 nonce**: `/auth/login` erzeugt signiertes `oidc_nonce`-Cookie + `nonce`-Param; `/auth/callback`
  erzwingt es, `exchange()` bindet das `id_token` timing-sicher (`nonceMatches`). Test T-F2-01..05.
- **F3 jwks-Rotation**: `discover()` setzt `jwksCache=null` beim TTL-Refresh -> `jwks_uri`-Rotation
  greift ohne Prozess-Neustart. Test `test/web-auth-oidc.test.js`.
- **F4 WITH CHECK**: alle `tenant_isolation`-Policies tragen zusaetzlich `WITH CHECK` -> auch
  INSERT/UPDATE sind tenant-isoliert (nicht nur SELECT/USING). Test `test/rls-with-check.test.js`.

**Self-Service-Login-Konvergenz (#3, umgesetzt 2026-06-16, `feat/self-service-web-session`):**
- Self-Service (`/api/self-service/*`) ist jetzt **web-session-only**: hinter `webAuthMw`
  (OIDC-Browser-Login, Feature B), `tenant = req.tenant.tenantId`. Der fruehere
  `X-Internal-Identity`-Pfad ist ENTFERNT. Routen NUR im Web-Login-Block registriert
  (`SESSION_SECRET` + `STORE_BACKEND=pg` + `SELF_SERVICE_ENABLED` + `MULTI_TENANT`) ->
  ohne diese Infra 404 (fail-closed; `assertConfig`-Hinweis). Factory
  `makeSelfServiceRoutes` (`src/self-service-routes.js`); View-Helfer store-parametrisiert
  in `src/store/views.js` (DIP/G5, eine Quelle fuer server.js + Factory + Test).
- Fail-closed belegt: ohne Session 401, suspendierter Tenant 403, kein Owner-/streamToken-
  Leak. Tests `test/i9-self-service.test.js` (pglite + Session-Cookie, a–f) +
  `test/self-service-flag-gate.test.js` (json → 404). `public/tenant.html` von Bearer-
  Paste/localStorage auf `/auth/login`-Redirect + Cookie umgebaut.

## Crash-Backstop & Boot-Entkopplung (P0/OT-1, umgesetzt 2026-06-16, `feat/crash-p0-backstop`)

Ein Node-Prozess bedient ALLE gleichzeitigen Calls + das Web-Stack: ein entkommener
Throw/Reject killte bisher jeden laufenden Call. P0 installiert ein globales Crash-Netz
und entkoppelt den Boot-Pfad. Plan: `tasks/crash-hotspots/P0-plan.md`.

- **Globales Crash-Netz** (`src/process-guards.js`, erste Importzeile in `server.js` +
  `mcp-server.js`, vor `store.js` -> ESM-Eval-Order). `unhandledRejection` UND
  `uncaughtException` werden **secret-frei** geloggt (nur `err.message`/`err.stack`, nie
  config/Connection-String/Env). Tests `test/process-guards.test.js` (T-P0-01..03, 07).
- **Bewusste Abweichung (AC4, akzeptiertes Risiko):** `uncaughtException` -> **loggen +
  weiterlaufen** (kein `process.exit`). `process.exit` wuerde alle gleichzeitigen Calls
  killen. Abweichung vom Node-Default (Zustand nach `uncaughtException` laut Doku
  undefiniert) - der Guard ist nur das Last-Resort-Netz; der echte Fix sind quellseitige
  try/catch (P3). Lautes `[guard]`-Logging macht den Vorfall sichtbar.
- **Boot-Entkopplung Web-Login (AC5):** der Portal-/Web-Login-Block laeuft in
  `guardedBoot` (`src/boot-guard.js`). Faellt `createPortalRunner` (F5-Rollen-Assertion
  ODER Portal-DB-Fehler) oder ein Wiring-Schritt, wird der Fehler laut + secret-frei
  gefangen -> die Web-Login/Portal-Routen werden NICHT gemountet (existieren nicht ->
  404), **aber `/voice`, `/healthz`, `/mcp` und das Owner-Dashboard laufen weiter**.
  Portal-pg-Fail toetet die Telefonie nicht mehr. **Sicherheits-Check:** die Owner-Basic-
  Auth-Schicht liegt NACH dem Block (ausserhalb `guardedBoot`) -> bleibt aktiv, auch wenn
  der Portal-Block uebersprungen wird. Test `test/boot-guard.test.js` (T-P0-05, HTTP-Level:
  Portal-Fault -> `/healthz` 200, `/auth/login` 404, Server lebt).
- **pg-Store bleibt HARTE Dependency (AC6):** unerreichbare pg-DB beim Boot -> klarer,
  secret-freier Fatal (`[store] FATAL ...`, exit 1) statt roher Rejection oder stillem
  json-Fallback (Backend-Split-Brain/Daten-Inkonsistenz-Risiko). Test
  `test/boot-decoupling.test.js` (T-P0-06: exit 1, kein Connection-String im Log).
- **Pool-Leak-Fix (AC7):** `createPortalRunner` zieht `pool.connect()` in den try-Block ->
  bei connect-Fehler laeuft `pool.end()` (kein Pool-Leak); Pool ist injizierbar (DI, Prod-
  Pfad unveraendert). Test `test/portal-pool-assertion.test.js` (T-P0-04).
- **CLAUDE.md-Gates unangetastet:** Allowlist/Budget/Disclosure/Twilio-Signatur nicht
  beruehrt - nur Crash-Verhalten + Boot-Robustheit.

**Bewusst akzeptierte Abweichungen / Deployment-Anforderungen:**
- **DB-Rolle**: Der `DATABASE_URL`-Nutzer MUSS non-superuser + NOBYPASSRLS sein,
  sonst greift FORCE-RLS NICHT (Superuser umgeht RLS). Harte Deployment-Anforderung.
  **F5 (umgesetzt):** `createPortalRunner()` prueft die Rolle fail-closed beim
  Startup (`assertNoBypassRls`, `src/portal-pool.js`) - Superuser ODER `rolbypassrls`
  -> `Error` mit `[F5]`-Prefix, Prozess startet nicht. Test:
  `test/portal-pool-assertion.test.js` (Stub TC1-TC5 + PGlite-Rauchtest TC6).
- **Killer-Test als Release-Gate**: pglite ist single-connection und kann pgBouncer-
  Transaction-Pooling NICHT reproduzieren. Der CI-Test beweist Isolation + GUC-Reset
  auf einer Verbindung; der ECHTE Killer-Test (2 Tenants, 50 parallele Requests,
  injizierte Txn-Fehler, reale Render-Topologie) ist ein manuelles Gate vor jedem
  Deploy: `docs/RELEASE-GATE-killer-test.md`.
- **Kosten/Write owner-only bis Sub-Projekt D**: Kunden-web-auth = READ. `place_call`/
  `onboard` bleiben owner-only; `PROVISIONING_ENABLED` bleibt `false`. Ein frisch
  freigegebener Kunde hat einen isolierten, aber leeren Tenant (Pre-Mortem-
  Kostenexplosion zu).
- **Login-Happy-Path (echter IdP + Postgres)** ist ein Staging-Smoke; CI deckt die
  Komposition in-process via pglite + fakes ab.

**Definition-of-Done (Council-Kriterien):**
- [x] Isolations-/Error-Injection-Test (CI) gruen + Release-Gate-Doku fuer echtes Pooling
- [x] kein Request sieht Fremddaten (portal-route + portal-rls-killer)
- [x] Login/Registrierung rate-limited (`LOGIN_RATE_LIMIT_PER_MIN`, eigener Limiter auf `/auth`)
- [x] Session-Invalidierung (suspend killt Tenant-Sessions sofort)
- [x] CASCADE-Loeschung getestet (audit ueberdauert)
- [x] fail-closed-Tests (no-session 401, suspended 403, Remote nie Owner via `internalIdentity`)
- [x] Regression: bestehende Server-/Gateway-Suiten unveraendert gruen (json-Mode-Block uebersprungen)

Offen (nicht autonom, Betreiber): WorkOS-AuthKit-Account + OIDC-Client + Redirect-URI
konfigurieren, `SESSION_SECRET`/`OIDC_CLIENT_*`/`ADMIN_EMAILS` in Render setzen,
Postgres mit non-superuser-App-Rolle + pgBouncer (transaction mode) bereitstellen,
echten Killer-Test fahren. Portal-UI (Sub-Projekt C), Marketing/Pricing (A),
Billing/Real-Provisioning (D) sind separater Scope.

## Store-Integritaet (P1/OT-3, umgesetzt 2026-06-16, `feat/crash-p1-store-integrity`)

Der JSON-Store (`src/store/json.js`) ist der einzige Persistenz-Pfad fuer Calls, Tenants,
Usage/Budget-Counter, Profile und Nummern. P1 haertet ihn quellseitig (P0 = globales Netz,
P1 = Quelle). Plan: `tasks/crash-hotspots/P1-plan.md`.

- **Atomic write (AC1, `save()`):** Schreibt nie mehr in-place. Stattdessen Temp-File IM
  SELBEN Verzeichnis (`<FILE>.tmp-<pid>-<rand>`) -> `fsyncSync` -> `renameSync` ueber
  `store.json`. Ein Crash/Kill/SIGTERM mid-write hinterlaesst hoechstens ein verwaistes
  `.tmp`-File, NIE ein truncated `store.json`. Schuetzt insb. den Budget-/Usage-Counter
  (CLAUDE.md Regel 1) gegen truncated-write-Verlust.
- **Single-Writer-Guard (AC2, `withStoreLock`):** Prozess-lokaler Promise-Chain-Mutex.
  Serialisiert read-modify-write-Sequenzen mit einem `await` zwischen `load()` und `save()`,
  damit kein Lost Update entsteht. Angewendet auf die `/api/onboard`-Saves.
- **Korruption wird NIE still verschluckt (AC3, `load()`):** Trennt hart First-Boot
  (`ENOENT` -> Defaults, kein Alarm) von Korruption (File vorhanden, `JSON.parse` wirft ->
  Rename nach `<FILE>.corrupt-<ISO-ts>` + LAUTES `[store] KORRUPT`-Log + Defaults). Andere
  Read-Fehler (z.B. `EACCES`) werden re-thrown (P0-Netz faengt sichtbar), NIE als First-Boot
  fehlinterpretiert. Der frueher nackte `catch{}` (stiller `makeDefaultState`-Wipe, der das
  forensisch rettbare File ueberschrieb) ist weg.
- **`POST /api/onboard` save-Haertung (AC4):** Die zwei Request-Pfad-Saves (requested/
  Dry-Run + Job-Spur) laufen je in `store.withStoreLock(...)` + `.catch` -> bei Save-I/O-
  Fehler **behandelter 503** `{error:"Persistenz fehlgeschlagen"}` statt unhandled async
  rejection. mem/disk-Divergenz wird geloggt.
- **CLAUDE.md-Gates unangetastet:** Allowlist/Disclosure/Signatur nicht beruehrt; das
  Budget-Gate wird durch AC1/AC2 GESTAERKT (kein Counter-Rollback durch truncated/lost write).

**Bewusst akzeptierte Abweichungen / Restrisiken:**
- **`withStoreLock` lebt in der Fassade (`src/store.js`), NICHT im json-Backend** (Plan-
  Skizze sah json.js vor). Grund: der Mutex ist eine JS-Nebenlaeufigkeits-Eigenschaft des
  EINEN Node-Prozesses und backend-unabhaengig. In `store.js` ist `store.withStoreLock` auch
  im pg-Pfad definiert; eine Bindung aus dem Backend (das pg-Backend exportiert es nicht)
  waere `undefined` -> TypeError in `/api/onboard`. Single source, kein Duplikat.
- **Prozess-lokaler Mutex genuegt nur bei 1 Instanz.** Alle Caller teilen im selben Node-
  Prozess das Modul-globale `state`; ein In-Process-Mutex reicht. Ein Multi-Prozess-Deploy
  braeuchte einen File-Lock (z.B. `proper-lockfile`/`flock`) ODER das pg-Backend mit DB-
  Transaktionen. **Heute n/a: Render free plan = 1 Instanz.** Bewusst akzeptiertes Prototyp-
  Risiko - bei Skalierung auf >1 Instanz MUSS einer der beiden Wege her.
- **`renameSync`-Atomaritaet nur same-FS:** das `.tmp` liegt IMMER im selben Verzeichnis wie
  `store.json` -> gleiches Filesystem -> POSIX-atomarer Rename, kein `EXDEV`. (Genau darum
  NICHT `os.tmpdir()`.)
- **`.corrupt`-Rename schlaegt selbst fehl (EACCES, read-only FS):** Der Rename ist in
  eigenem try/catch (Dienst crasht nicht). Schlaegt er fehl, ueberschreibt das folgende
  Default-`save()` das korrupte File trotzdem -> Datenverlust des korrupten Inhalts. Bewusst
  akzeptiert: Dienst-Ueberleben hat Vorrang, das laute `[store] KORRUPT`-Log sichert die Spur.
- **Scope-Grenze `withStoreLock`:** NUR `/api/onboard` ist gewrappt. `place_call`
  (`/api/calls`) und `/api/billing/flush-meters` haben zwar ein `await` zwischen `load()` und
  `save()`, mutieren aber KEINEN Counter ueber ein vor dem `await` gelesenes lokales
  Zwischenergebnis (place_call: `save()` haengt nur `tw.sid` an; flush-meters: markiert per
  Referenz auf dem geteilten Singleton). Unter dem Shared-Singleton- + synchronen-
  `writeFileSync`-Modell entsteht dort kein klassischer Lost Update. Der
  `runProvisioningDrain`-Worker (P6, fire-and-forget, eigenes try/catch) bleibt ebenfalls
  ungewrappt (P1-Scope = Request-Pfad). Fuer zukuenftige counter-RMW-ueber-await-Sequenzen
  ist `withStoreLock` der Baustein.

Verifikation: `npm test` 478 gruen (471 Baseline + 7 neue T-P1-01..06, 0 Drop);
`test/store-integrity.test.js` + `test/onboard-persist-failure.test.js`. Smoke (echtes
`src/server.js`): korruptes `store.json` -> `[store] KORRUPT`-Log + `.corrupt`-Backup
(Inhalt erhalten) + valides neues `store.json`; zwei parallele `/api/onboard` -> beide
persistiert (kein Lost Update).

## Safety-Gates fail-closed (P2/OT-4, umgesetzt 2026-06-17, `feat/crash-p2-failclosed-gates`)

Die unheimlichste Crash-Klasse failt nicht laut, sondern lautlos OPEN: ein Safety-/Kosten-Gate
schaltet sich ohne Signal ab (z.B. `costEur >= NaN` ist IMMER false -> Budget-Guard blockt nie).
P2 ersetzt stilles OPEN durch lautes Refusal. Plan: `tasks/crash-hotspots/P2-plan.md`.

- **`numEnv()`-Helper + `Number.isFinite`-Guards (AC1/AC2, `config.js`):** Alle 12 numerischen
  Env-Parses (inkl. der P6-Geldwerte `numberSetupFeeCents`, `voiceMinuteCostCents`) laufen ueber
  `numEnv(name, raw, {fallback, min, max, integer})`. NaN/Infinity (`parseFloat("acht")`) oder
  Bereichsverletzung (negativer Gate-Wert) sind kein stiller no-op mehr, sondern landen in
  `fatalConfigErrors[]`. Schliesst u.a. das `Math.min(NaN,300)`-Loch bei `maxCallDurationS`.
  `0` bleibt gueltiger Not-Aus (`maxCallsPerHour`/`maxNumbers`); leere/abwesende Var faellt auf
  den dokumentierten Default zurueck (nur gesetzt-aber-ungueltig ist fatal).
- **`assertConfig` faellt bei Fatal (AC3):** liest `configFatalErrors()` zusaetzlich zu den
  Presence-Checks (`missing[]`), gibt eine actionable Diagnose (Var + Erwartung, NIE ein Secret-
  Wert) aus und liefert `false` bei (a) fehlender Pflicht-Safety-Config ODER (b) ungueltiger
  numerischer Config. Der P6-Payment-Guard (`NUMBER_SETUP_FEE_CENTS > 0 ganzzahlig`) bleibt als
  config-Wert-Invariante erhalten (von `config-payment-guard.test.js` direkt gepinnt) - numEnv
  subsumiert nur die Env-Parse-Schicht, kein zweiter Pfad.
- **Boot ehrt das Ergebnis (AC4, `server.js`):** bei `!ok` kein `app.listen`, kein
  `attachMediaBridge`, klare `[boot] Start abgebrochen`-Zeile auf stderr, `process.exit(1)`.
  `store.load()` + Retention laufen davor unveraendert (baut auf P0's diagnostiziertem-Exit-
  Muster auf). Lieber kein Dienst als ein Dienst mit lautlos abgeschaltetem Budget-Gate (R4).
- **Originate-Fehler-Response ohne rohe Provider-Message (AC5, `server.js`):** der 500-Body von
  `POST /api/calls` gibt nur noch `{error:"Anruf konnte nicht gestartet werden.", hint:...}`; die
  rohe Provider-Message wird serverseitig secret-frei geloggt (wie die P0-Guards), nicht an den
  Client geleakt (Regel 4/5). Kein weiterer 500-Pfad in `server.js` leakt `err.message` (geprueft).
- **disclosureSentence-Regressionstest (AC6, `claude.js` UNVERAENDERT):** ein Lock-Test nagelt den
  fest verdrahteten Offenlegungssatz (Regel 2) als PFLICHT-ersten-Satz im Outbound-Prompt fest,
  damit ein Refactor ihn nicht still droppen/umordnen kann.

**Bewusst akzeptierte Abweichungen / Folgen:**
- **Strenger als bisher: fehlende Pflicht-Config verweigert jetzt den Boot.** `TWILIO_*`,
  `PUBLIC_URL`, `OAUTH_ISSUER_URL` (bei `MCP_AUTH=oauth`), `DATABASE_URL` (bei `STORE_BACKEND=pg`),
  `STRIPE_SECRET_KEY` (bei `PAYMENT_ENABLED`) fehlend -> exit 1 statt warn-but-boot. Vier
  Bestands-Tests, die den alten warn-but-boot fuer einen Offline-Trick ausnutzten, wurden
  angepasst (TEST-only, kein Source-Verhalten aufgeweicht): `number-gate`/`audit`/`profiles`
  nutzen jetzt eine nicht-`AC`-`TWILIO_ACCOUNT_SID` (`"x"`: synchroner Offline-Throw des Twilio-
  Clients, aber nicht-leer -> bootet); `voice-signature` ist von Spawn auf Unit umgestellt
  (`verifyInboundSignature` ohne PUBLIC_URL -> `false`), weil ein laufender Server mit leerer
  PUBLIC_URL nicht mehr herstellbar ist; `oauth.test.js` #94 prueft jetzt Boot-Refusal statt
  warn-but-boot.
- **Render-Restart-Loop bei Fehlkonfiguration ist gewollt:** eine Boot-Refusal-Loop = Config-
  Fehler (eindeutige `[boot]`-Zeile im Log), nicht Code-Bug. Ein Dienst ohne Budget-Gate ist
  teurer als ein nicht-startender (R4). Vor Render-Rollout einmal mit der echten Env-Liste lokal
  gegen den Boot testen.
- **T-P2-11 ist offline ueber den Telnyx-Mock-Seam umgesetzt** (Mock antwortet mit Fehlerstatus ->
  Adapter wirft secret-frei -> generischer 500-Body). Kein Defer nach P4 noetig.

Verifikation: `npm test` 490 gruen (478 Baseline + 12 neue T-P2-01..11, 0 Drop);
`test/config-failclosed.test.js`, `test/boot-failclosed.test.js`, `test/disclosure-regression.test.js`,
`test/place-call-error.test.js`. Smoke (echtes `src/server.js`): `MAX_BUDGET_EUR=acht` -> exit 1
+ `[boot] Start abgebrochen` (nennt MAX_BUDGET_EUR, kein "Gateway laeuft"); Gegenprobe gueltige
Config -> `/healthz` 200 `{"ok":true}`.
