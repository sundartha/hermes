# Phase W3 — Auth scharf schalten: Login/Registrierung end-to-end

**Status:** Gate = PASS
**finalBranch:** `phase/w3-auth`
**headCommit:** `e68fea80e24e2649db573f3989367534044677e0`
**Tests:** 899/899 (json/Default-Backend), Exit 0; pglite-Pfad der beruehrten Dateien 46/46

## Ziel

Login/Registrierung des Kunden-Portals end-to-end lokal scharf schalten: die rohe
403-/Basic-Auth-Sackgasse fuer frisch eingeloggte (noch suspendierte) Tenants
schliessen und sie stattdessen auf eine "Choose your plan"-Landeseite mit Logout
fuehren. Aktivierung selbst (`active`) bleibt W4.

## Plan (gekuerzt)

**Befund (code-gegroundet auf master):** Die schwere Auth-Arbeit existierte bereits.
`/auth/login`, `/auth/callback`, `/auth/logout` (`src/web-auth.js` `makeWebAuthRoutes`)
funktionieren — voller OIDC-Auth-Code-+-PKCE-Flow inkl. nonce/state/CSRF, fail-closed,
`safeEqual`/HMAC, `/auth`-Rate-Limiter — gegated durch
`config.sessionSecret && config.storeBackend === "pg"`. Daran wird NICHTS geaendert
(Invariante Auth fail-closed). Alle W3-Env-Vars stehen schon in `.env.example` und
`render.yaml`. Die suspended-403-UX in `public/tenant.html` (`refresh()`) inkl.
verdrahtetem Logout-Button existiert bereits.

**Die einzige echte Bug-Wurzel — die "403-Sackgasse":** Letzte Zeile des
Callback-Happy-Path war `res.redirect(302, "/")`. `/` wird von `public/index.html`
bedient — dem Owner-Dashboard hinter Basic-Auth. Ein frisch eingeloggter Kunde
(Tenant `suspended`) landete auf einer Seite hinter `admin:DASHBOARD_PASSWORD`
-> Browser-Basic-Auth-Prompt = die rohe Sackgasse. Die Self-Service-Shell
`tenant.html`, die den suspended-Zustand sauber rendert, erreichte er nie.
Zweitens trug die `tenant.html`-403-Copy noch die alte Admin-Approval-Botschaft
("wartet auf Freigabe") statt Q-APPROVAL ("Choose your plan").

**Geplanter Blast-Radius (chirurgisch, keine neuen Dateien):**
- `src/web-auth.js`: Post-Login-Redirect-Ziel parametrisieren — injiziertes
  `deps.postLoginPath`, Default `"/"` (byte-identisch zum Bestand).
- `src/server.js`: benannte Konstante `CUSTOMER_PORTAL_PATH = "/tenant.html"`, die
  zugleich die Basic-Auth-Exemption und `postLoginPath` speist (eine Quelle statt
  zwei driftende Literale); `postLoginPath` nur gesetzt bei
  `selfServiceEnabled && multiTenant` (gleicher Flag-Gate wie die Exemption), sonst
  Default `/` (fail-safe).
- `public/tenant.html`: 403-Copy auf "Choose your plan to activate your account."
- `.env.example`: knapper Dev-Login-Hinweis (pg/pglite + Fake-IdP), reiner Doku-Edit.
- `render.yaml`: voraussichtlich 0 Diff.
- Tests: 2 in `test/web-auth.test.js` (Redirect mit/ohne `postLoginPath`), 1 in
  `test/i9-self-service.test.js` (suspended-403 + No-Leak).

**Kein Auto-Approve** (Aktivierung = W4), kein Backend-Auth-Mechanismus angefasst.

## Implementierungs-Zusammenfassung

Die 403-/Basic-Auth-Sackgasse fuer frisch eingeloggte Tenants ist geschlossen.
Wurzel war `res.redirect(302, "/")` im OIDC-Callback. Fix: `makeWebAuthRoutes`
bekommt injiziertes `postLoginPath` (Default `"/"` = byte-identisch); `server.js`
reicht `/tenant.html` (neue Konstante `CUSTOMER_PORTAL_PATH`) durch, gegated mit
`selfServiceEnabled && multiTenant` — derselbe Flag wie die Basic-Auth-Exemption,
die jetzt ueber dieselbe Konstante laeuft (garantiert kongruent). `tenant.html`-403-Copy
auf "Choose your plan to activate your account." (Q-APPROVAL). Kein
Auth-Mechanismus/Auto-Approve angefasst; Tenant bleibt suspended. `.env.example`
Dev-Login-Hinweis ergaenzt.

- `node --check` gruen auf allen beruehrten JS-Dateien.
- `npm test` (json-Default): 899/899 gruen inkl. 2 neuer Redirect-Tests.
- `STORE_BACKEND=pg` in-process-Tests: 46/46 gruen (web-auth + i9-self-service).
- Grep-Gate gruen: `res.redirect(302, "/")` aus `src/web-auth.js` entfernt.
- Committet als `e68fea8` (node_modules-Symlink NICHT committet).

**Dateien editiert (6):** `src/web-auth.js`, `src/server.js`, `public/tenant.html`,
`.env.example`, `test/web-auth.test.js`, `test/i9-self-service.test.js`.
**Dateien neu:** keine. Keine neue npm-Dependency; `package.json`/lock unberuehrt.
Diff-Umfang ca. +71/-3.

**Tests hinzugefuegt/geaendert:**
- `test/web-auth.test.js`: +2 Tests (Callback redirectet mit `postLoginPath` ins
  Portal; ohne `postLoginPath` Default `/` byte-identisch).
- `test/i9-self-service.test.js`: bestehender (f2) suspended-403-Test um
  No-Leak-Assertion erweitert (Body traegt kein `calls`/`settings`).

### Deviations
- Plan nannte fuer den End-to-End-Test die Route `/api/portal/state`; die
  tatsaechliche Self-Service-Shell-Route ist `/api/self-service/state`. Der Test
  prueft daher `/api/self-service/state`.
- Plan schlug einen NEUEN suspended-403-Test vor; die Suite enthielt bereits (f2)
  mit exakt diesem Szenario. Statt zu duplizieren (S2/S4) wurde die W3-No-Leak-Garantie
  als zwei Assertions in den bestehenden (f2)-Test gezogen — selbe Coverage, keine
  Duplizierung.
- `STORE_BACKEND=pg`-Vollsuite: 831 pass / 12 fail. Die 12 Failures sind ausschliesslich
  Spawn-Integrationstests, die ein echtes Postgres (`DATABASE_URL`) brauchen
  ("pg-Backend nicht initialisierbar, AggregateError") — identische Baseline wie
  master/W1-Report, KEINE in `web-auth*`/`i9-self-service`, durch W3 nicht erhoeht.

### Smoke
Nicht moeglich: voller Server-Boot wird durch Safety-/Boot-Guards verweigert ohne
real-shaped Env (`TWILIO_ACCOUNT_SID`/`AUTH_TOKEN` + geseedete aktive Owner-Nummer via
`seed-owner-number`). Diese Gates sind korrektes fail-closed-Verhalten, kein W3-Defekt.
Die beruehrte Route-Logik ist vollstaendig automatisiert abgedeckt (Redirect-Ziel via
`web-auth.test.js`; `/tenant.html`-Exemption + suspended-403 via `i9-self-service.test.js`,
auch unter `STORE_BACKEND=pg`).

## Safety-Urteil: APPROVED

- `testsPassIndependently`: true (json 899/899, Exit 0; pg 831/843 — die 12 Fails
  identisch auf master, environmental/pre-existing, keine W3-Regression; beruehrte
  Dateien isoliert 46/46).
- `safetyGatesIntact`: true — `numberGateError`/Allowlist/Denylist/Land/Budget/Max-Dauer
  + Twilio/Telnyx-Signaturpruefung komplett unberuehrt (`claude.js`, `bridge.js`,
  `telephony/`, onboarding, billing nicht im Diff).
- `disclosureIntact`: true — `disclosureSentence` byte-identisch.
- `authFailClosedIntact`: true — keine Aenderung an PKCE/state/nonce/`safeEqual`/HMAC/
  Rate-Limiter/Cookie-Flags. Beide Aenderungspunkte (`postLoginPath` +
  Basic-Auth-Exemption via `CUSTOMER_PORTAL_PATH`) hinter `selfServiceEnabled && multiTenant`;
  beide Flags default false -> `postLoginPath` undefined -> Redirect bleibt `/` ->
  byte-identisch. Callback loescht PKCE/state/nonce-Cookies vor Redirect.
- `noSecretsLeaked`: true — 403-Self-Service-Body traegt keine Tenant-Daten
  (neuer Test asserted no `calls`/`settings`).
- `scopeRespected`: true — 6 Dateien, +71/-3, keine neue Dependency, kein neuer
  Calls/SMS/Geld-Endpunkt, nur 2 bestehende Middleware-Bloecke editiert. Kein
  Auto-Approve (Tenant bleibt suspended).
- **Blockers:** keine.
- **Concerns:** pg-Backend lokal nicht ausfuehrbar (12 Fails = DB unerreichbar,
  pre-existing/environmental, auf master identisch); Remote-Self-Service-OAuth bleibt
  deferred (`req.auth` nur auf `/mcp`, bekannt aus I9, nicht W3-Scope).

## Clean-Code-Audit: PASS (blocker: false)

- **S1:** keine.
- **S2:** keine.
- **S3 (2 kosmetisch):**
  - G25/G16 · `src/web-auth.js:88` & `src/server.js` — Default-Redirect-Pfad `"/"`
    als nackter String-Literal an zwei Stellen ohne benannte Konstante, anders als
    das sauber eingefuehrte `CUSTOMER_PORTAL_PATH`. Minor, da `"/"` selbsterklaerend.
    Fix optional: `OWNER_DASHBOARD_PATH`-Konstante oder bewusst belassen.
  - N3/Sprache · `public/tenant.html:262` — neuer User-String
    "Choose your plan to activate your account." ist Englisch, waehrend die uebrige
    `tenant.html`-Copy deutsch ist (Sprach-Inkonsistenz). Fix optional: deutsche
    Formulierung oder i18n-Entscheidung dokumentieren.
- **S4:** keine.

**Verdict:** PASS — keine S1/S2. Sauberer, eng begrenzter Fix mit DI-Default fail-safe.
DIP/Testbarkeit sauber (`postLoginPath` per Injection, Default byte-identisch); beide
Verhaltenszweige je ein fokussierter Test, beide gruen (28/28 web-auth, 18/18 i9).
Basic-Auth-Exemption fuer `/tenant.html` bleibt an denselben Flags gekoppelt;
`CUSTOMER_PORTAL_PATH` ersetzt nur das gleichwertige Literal (kein neuer exempter Pfad,
Regel 3 AUTH FAIL-CLOSED gewahrt). Magic String korrekt zu benannter Konstante gehoben;
Kommentare erklaeren das Warum; kein toter/auskommentierter Code; `.env.example`
dokumentiert. Empfehlung: mergebar; S3 optional vorher glaetten.

## Fix-Runden

Keine. Erstes Review-Ergebnis bereits Gate = PASS (Safety APPROVED, Clean-Code PASS,
keine S1/S2-Blocker); nur 2 optionale kosmetische S3-Nits offen gelassen.
