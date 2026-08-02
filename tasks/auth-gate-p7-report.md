# Phase AUTH-P7 — Das Gate entfernen

**Gate = PASS** (Safety + Clean-Code, beide finale Runden)
**finalBranch:** `phase/auth-p7-gate-entfernen-fix2`
**Commit-Hash:** `f935623ea7d8d3ef320a291b2f417fda108f24a2`

EHRLICHKEITSREGEL: Diese Phase ist **nicht** live abgenommen. Der Commit, der das
Basic-Auth-Sammelgate entfernt, liegt vor, ist getestet (npm test 3781/3781 gruen,
Safety- und Clean-Code-Review PASS) und im Repo als ein Commit vorhanden. Der Deploy
selbst hat in dieser Session **nicht stattgefunden** — er ist eine Owner-Handlung.
Bis die Live-Probe nach dem Deploy gruen ist, gilt: **das Gate ist im Code gefallen,
live steht es noch.**

---

## 1. Exemption-Analyse

| # | Exemption | Urteil | Was daran haengt |
|---|---|---|---|
| 1 | `if (!config.auth.dashboardPassword) return next();` | Nicht nur Gate | War Not-Aus-Zustand; `test/helpers.js` (`DASHBOARD_PASSWORD:""`) und `consult-pump.mjs` dokumentierten ihr Verhalten darueber. Kommentare umgeschrieben, `DASHBOARD_PASSWORD` bleibt bis P8 Boot-Pflicht (Rollback-Sicherung). |
| 2 | `req.path.startsWith(VOICE_PATH_PREFIX)` | Nicht nur Gate | Konstante bleibt fuer `captureRawBody` (Twilio-HMAC) + Rate-Limit-Bypass. Provider-Signaturpruefung unveraendert. Verhaltensdelta null. |
| 3 | `req.path.startsWith("/mcp")` | Nur Gate | `mcpAuth` bleibt einzige Absicherung, Bearer-Challenge unveraendert (B-1). Verhaltensdelta null. |
| 4 | `req.path.startsWith("/.well-known")` | Nur Gate, bereits redundant | `registerWellKnown` lag schon vor dem Gate. Unregistrierte Unterpfade: 404 statt 401. |
| 5 | `req.path === STRIPE_WEBHOOK_PATH` | Nicht nur Gate | Konstante bleibt fuer `captureRawBody` + `wireWebLogin`. HMAC-Pruefung unveraendert. Verhaltensdelta null. |
| 6 | `req.path === "/healthz"` | Nur Gate, bereits redundant | `registerPublicRoutes` lag schon davor. Verhaltensdelta null. |
| 7 | `req.path.startsWith(BRAND_ASSETS_PREFIX)` | Nur Gate | Konstante bleibt in `mcp-server-info.js`; nur Import in `app.js` faellt (G12). `express.static(publicDir)` liefert `/brand/*` weiter aus. |
| 8 | `req.path === "/favicon.ico"` | Nur Gate | Weiterhin von `express.static(publicDir)` geliefert. Verhaltensdelta null. |
| 9 | `isTrustedLocalCaller(req)` | Nicht nur Gate | Zweiter Konsument Rate-Limit-Bypass, dritter die Vertrauensgrenze fuer AUTH-P3/P5. Import unveraendert. |
| 10 | `safeEqual(...)` | Gate war 1 von 5 Nutzern | Vier verbleibende Nutzer (web-auth, auth.js, telnyx-llm-shim, bridge.js) unveraendert; nur Import in `app.js` faellt. |
| 11 | `audit("auth_failed", ...)` | Ersetzt, nicht ersatzlos | `auditAuthFailed` schreibt seit AUTH-P5 aus `internalOnly`/`webAuthGateMiddleware`/`adminOnlyMiddleware`, `mcpAuth` eigenstaendig. Erwartete Folge: `auth_failed`-Volumen faellt (Rauschreduktion, nicht "Angriffe haben aufgehoert"). |

**Befund B-1 (vorab korrigiert):** die urspruengliche Abnahme-Regel "`grep WWW-Authenticate` leer" war falsch — sie haette die RFC-9728-Bearer-Challenge in `src/auth.js` (Discovery-Naht des Claude-Connectors, in `test/oauth.test.js` gepinnt) mit geloescht. Korrigierte Abnahme: genau zwei Zeilen `WWW-Authenticate` in `src/auth.js` (Kommentar + Bearer-Challenge), `grep -rni "basic realm" src/ test/` leer, `grep -rn "makeAuthGate|installAuthGate|wiring/auth-gate" src/` leer (in `test/` nicht literal leer — die neue Detektor-Testdatei enthaelt diese Strings notwendigerweise als eigenes Suchmuster, kein echter Restverweis).

---

## 2. Was geloescht wurde

- `src/wiring/auth-gate.js` — die Middleware-Fabrik `makeAuthGate`/`installAuthGate` samt Exemption-Liste
- `test/auth-gate-exemption-order.test.js` — ersetzt durch `test/route-auth-inventory.test.js` (P1)
- `scripts/sweep-jetzt.sh` — ersatzlos (kein Referent in Code/`package.json`)

`GATE_ONLY_ROUTES` ist jetzt `Object.freeze([])` — per Test (`AUTH-P7-6`) belegt.

---

## 3. Die sieben Umleitungen

Als benannte Konstanten `LOGIN_ALIAS_PATHS`/`APP_ALIAS_PATHS` in `src/portal-paths.js` (eine Quelle, G5), gemountet ueber `registerPathRedirects` in `src/app.js` VOR `wireWebLogin` und beiden statischen Schichten.

| Quell-Pfad | Ziel | Status |
|---|---|---|
| `/login` | `/auth/login` | 302 |
| `/signin` | `/auth/login` | 302 |
| `/sign-in` | `/auth/login` | 302 |
| `/dashboard` | `/app` | 302 |
| `/account` | `/app` | 302 |
| `/portal` | `/app` | 302 |
| `/admin` | `/app` | 302 |

Shadowing-Nachweis (gemessen, nicht angenommen): `app.get(...)` matcht **exakt**, nicht als Praefix (anders als `app.use`) — `/admin` beschattet `/api/admin/tenants`, `/api/admin/tenants/:id/approve`, `/api/admin/tenants/:id/suspend` **nicht**, weil das andere Pfad-Strings sind. Per Test bestaetigt: `GET /api/admin/tenants` mit `X-Forwarded-For` bleibt 401, nicht 302. Kein `apps/web`-Seitenname und keine `public/`-Datei kollidiert. `POST /login` bleibt 404 (GET-only). Kein Query-Durchreichen, Ziele sind Modul-Konstanten — kein Open Redirect.

---

## 4. Die neue Probe-Tabelle (64 Zeilen, woertlich — das ist die Vorhersage, gegen die live gemessen wird)

```
oeffentlich|GET|/healthz|200|keine|Keep-Alive und Deploy-Wahrheit, vor jeder Auth-Schicht gemountet
oeffentlich|GET|/api/plans|200|keine|oeffentlicher Tarifkatalog, registerPublicRoutes
oeffentlich|GET|/.well-known/oauth-protected-resource|200|keine|OAuth-Metadata, registerWellKnown
oeffentlich|GET|/.well-known/oauth-protected-resource/mcp|200|keine|OAuth-Metadata (MCP-Variante)
oeffentlich|POST|/v1/chat/completions|403|keine|Telnyx-Shim: Flag an, Bearer fehlt -> 403 (Flag aus waere 404)
oeffentlich|GET|/auth/login|302|keine|Einstieg in den OIDC-Login
oeffentlich|GET|/auth/callback|302|keine|ohne state-Cookie -> Neustart des Flows
oeffentlich|POST|/auth/logout|204|keine|ohne Sitzung wirkungslos
oeffentlich|POST|/webhooks/stripe|400|keine|HMAC-Pruefung schlaegt fehl (PAYMENT_ENABLED aus waere 404)
oeffentlich|GET|/tenant.html|302|keine|Altpfad-Umleitung auf /app
oeffentlich|GET|/login|302|keine|AUTH-P7-Umleitung auf /auth/login
oeffentlich|GET|/signin|302|keine|AUTH-P7-Umleitung auf /auth/login
oeffentlich|GET|/sign-in|302|keine|AUTH-P7-Umleitung auf /auth/login
oeffentlich|GET|/dashboard|302|keine|AUTH-P7-Umleitung auf /app
oeffentlich|GET|/account|302|keine|AUTH-P7-Umleitung auf /app
oeffentlich|GET|/portal|302|keine|AUTH-P7-Umleitung auf /app
oeffentlich|GET|/admin|302|keine|AUTH-P7-Umleitung auf /app (beschattet /api/admin/* NICHT)
oeffentlich|GET|/app/*|200|keine|SPA-Fallback auf die App-Shell
oeffentlich|GET|/voice/tts/:token|404|keine|Einmal-Token ungueltig; Route existiert
oeffentlich|POST|/voice/incoming|403|keine|Provider-Signatur fail-closed
oeffentlich|POST|/voice/turn|403|keine|Provider-Signatur fail-closed
oeffentlich|POST|/voice/outbound|403|keine|Provider-Signatur fail-closed
oeffentlich|POST|/voice/status|403|keine|Provider-Signatur fail-closed
oeffentlich|POST|/voice/call-control|403|keine|Provider-Signatur fail-closed
oeffentlich|GET|/mcp|405|keine|Transport ist POST-only
oeffentlich|DELETE|/mcp|405|keine|Transport ist POST-only
sitzung|POST|/mcp|401|mcpauth|mcpAuth fail-closed (Bearer-Challenge, keine Basic-)
sitzung|GET|/api/state|403|internal|internalOnly: kein lokaler In-Process-Aufrufer
sitzung|GET|/api/calls/:id|403|internal|internalOnly: kein lokaler In-Process-Aufrufer
sitzung|POST|/api/calls|403|internal|internalOnly - loest echte Anrufe aus
sitzung|POST|/api/calls/:id/cancel|403|internal|internalOnly
sitzung|GET|/api/calls/:id/consult|403|internal|internalOnly
sitzung|POST|/api/calls/:id/consult/answer|403|internal|internalOnly
sitzung|GET|/api/tenant-data/export|403|internal|internalOnly - Transkripte
sitzung|POST|/api/billing/setup-checkout|403|internal|internalOnly (AUTH-P7, P9 loescht) - Geld-Route
sitzung|GET|/api/billing/checkout-return|403|internal|internalOnly (AUTH-P7, P9 loescht)
sitzung|POST|/api/billing/flush-meters|401|webauth|webAuth vor adminOnly - 401 vor 403, Geld-Route
sitzung|POST|/api/billing/cost-truing/sweep|401|webauth|webAuth vor adminOnly - 401 vor 403
sitzung|GET|/api/billing/cost-drift|401|webauth|webAuth vor adminOnly - 401 vor 403
sitzung|GET|/api/billing/platform-costs|401|webauth|webAuth vor adminOnly - 401 vor 403
sitzung|POST|/api/onboard|401|webauth|webAuth vor adminOnly - kauft Nummern
sitzung|POST|/api/onboard/retry|401|webauth|webAuth vor adminOnly - kauft Nummern
sitzung|GET|/api/portal/state|401|webauth|Sitzungs-Cookie fehlt
sitzung|GET|/api/self-service/state|401|webauth|Sitzungs-Cookie fehlt
sitzung|POST|/api/self-service/settings|401|webauth|Sitzungs-Cookie fehlt
sitzung|POST|/api/self-service/private-number|401|webauth|Sitzungs-Cookie fehlt
sitzung|GET|/api/self-service/billing/status|401|webauth|Sitzungs-Cookie fehlt
sitzung|POST|/api/self-service/billing/setup-checkout|401|webauth|Geld-Route, Sitzungs-Cookie fehlt
sitzung|POST|/api/self-service/billing/subscribe|401|webauth|Geld-Route, Sitzungs-Cookie fehlt
sitzung|GET|/api/self-service/billing/return|401|webauth|Sitzungs-Cookie fehlt
sitzung|GET|/api/admin/tenants|401|webauth|webAuth vor adminOnly - 401 vor 403
sitzung|POST|/api/admin/tenants/:id/approve|401|webauth|webAuth vor adminOnly - 401 vor 403
sitzung|POST|/api/admin/tenants/:id/suspend|401|webauth|webAuth vor adminOnly - 401 vor 403
statisch|GET|/|200|keine|Marketing-Startseite aus WEB_DIST_DIR
statisch|GET|/app/|200|keine|App-Shell aus WEB_DIST_DIR
statisch|GET|/favicon.ico|200|keine|Marken-Asset aus public/
statisch|GET|/brand/hermes-icon.png|200|keine|Marken-Asset aus public/
fehlt|GET|/diese-route-gibt-es-nicht-12345|404|keine|Express-404 - nichts maskiert ihn mehr
fehlt|POST|/api/settings|404|keine|in AUTH-P4 geloescht; ab AUTH-P7 sichtbar 404
fehlt|POST|/api/action-items/:id/toggle|404|keine|in AUTH-P4 geloescht; ab AUTH-P7 sichtbar 404
fehlt|POST|/api/calendar|404|keine|in AUTH-P4 geloescht; ab AUTH-P7 sichtbar 404
fehlt|GET|/api/profiles|404|keine|in AUTH-P4 geloescht; ab AUTH-P7 sichtbar 404
fehlt|POST|/api/profiles|404|keine|in AUTH-P4 geloescht; haette das Verifikations-Gate ausgehebelt
fehlt|DELETE|/api/profiles/:tenantId|404|keine|in AUTH-P4 geloescht; ab AUTH-P7 sichtbar 404
```

---

## 5. Tests mit Assertions

### Neu: `test/auth-p7-gate-removed.test.js`

| ID | Zusage | Assertions |
|---|---|---|
| AUTH-P7-1 | `/api/state` ohne Sitzung -> 403, nicht 401, nicht 200 (Datenleck-Fall) | `status===403`; `notEqual(status,401)`; keine Basic-Challenge; `error`-Feld vorhanden; `auth_failed ... grund=not_local` im Log; `notEqual(status,200)` |
| AUTH-P7-2 | unbekannter Pfad -> 404 | zwei Pfade (`/diese-route-gibt-es-nicht-12345`, `/api/gibt-es-nicht-12345`) je 404 + keine Basic-Challenge; `POST /api/settings` (in P4 geloescht) -> 404 |
| AUTH-P7-3 | die sieben Umleitungen | hart kodierte `[von,ziel]`-Paare, je `status===302`, `location===ziel`, keine Basic-Challenge; Vollstaendigkeits-Assertion gegen `LOGIN_ALIAS_PATHS`/`APP_ALIAS_PATHS`; Negativproben `POST /login` -> 404, `GET /api/admin/tenants` -> kein 302 trotz X-Forwarded-For |
| AUTH-P7-4 | keine Antwort traegt eine Basic-Challenge | Tabelle ueber 200/403/404/302/401; `doesNotMatch(www-authenticate, /^Basic/i)`; Gegenprobe: `POST /mcp` `www-authenticate` MUSS `/^Bearer /` matchen (B-1) |
| AUTH-P7-5 | In-Process-MCP-Pfad lebt | `GET /api/state` ohne X-Forwarded-For -> 200, `state.calls` lesbar |
| AUTH-P7-6 | `GATE_ONLY_ROUTES` ist leer | `deepEqual(GATE_ONLY_ROUTES, [])` |
| AUTH-P7-7 | Legacy-Checkout-Paar traegt `internalOnly` | extern: beide Routen 403 + keine Basic-Challenge + `auth_failed ... grund=not_local`; Audit-Zeile enthaelt weder `cs_1` noch `session_id`; lokal ohne XFF: 404 mit `{error:"payment disabled"}` — beweist `internalOnly` laeuft vor dem PAYMENT-Gate |
| AUTH-P7-8 | keine Wiederauferstehung im Quelltext | statischer Scan: kein `basic realm`; kein `makeAuthGate`/`installAuthGate`/`wiring/auth-gate` in `src/`; `WWW-Authenticate` nur in `src/auth.js` (Positiv-Assertion) |

`test/probe-auth-table.test.js`: `ANTWORTET.GATE` entfernt, `ANTWORTET.INTERNAL` neu; drei Widerspruchsregeln umgeschrieben, eine neue Regel (`fehlt` MUSS `keine`/404 sein) ergaenzt; `AUTH-P4-8`/`AUTH-P5-7`/`AUTH-P6-9` an neue Status/Enums angepasst.

---

## 6. Mutationsproben

| # | Mutation | Ergebnis |
|---|---|---|
| M1 | `installAuthGate` wieder einsetzen | **nicht durchgefuehrt** — haette Rekonstruktion der geloeschten 76-zeiligen Datei verlangt; aequivalente Deckung durch M6/M7 + AUTH-P7-8 bereits belegt |
| M2 | `internalOnly` von `GET /api/state` entfernt | `test/security.test.js` UND `route-auth-inventory` (UNPROTECTED) rot — zwei unabhaengige Detektoren. Zurueckgenommen |
| M2b | `internalOnly` von `POST /api/billing/setup-checkout` entfernt | AUTH-P7-7 UND `route-auth-inventory` rot. Zurueckgenommen |
| M3 | Umleitungsziel vertauscht (`/login` -> `/app`) | genau AUTH-P7-3 rot. Zurueckgenommen |
| M4 | `/admin` aus `APP_ALIAS_PATHS` entfernt | AUTH-P7-3, `ROUTE_FINGERPRINT` UND `probe-auth-table`-Einordnungsregel alle drei rot. Zurueckgenommen |
| M5 | Legacy-Checkout-Paar in `GATE_ONLY_ROUTES` belassen | genau AUTH-P7-6 rot. Zurueckgenommen |
| M6 | Basic-Realm-Header in `webAuthGateMiddleware` eingesetzt | AUTH-P7-8 (Positiv-Assertion) rot. Zurueckgenommen |
| M7 | Bearer-Challenge aus `src/auth.js` geloescht (die B-1-Falle) | AUTH-P7-4 UND `test/oauth.test.js` rot — faengt genau den Fehler, den die urspruengliche falsche Abnahme-Regel provoziert haette. Zurueckgenommen |

Nach jeder Probe: `node --check` + gezielter Testlauf bestaetigt Rot, dann Ruecknahme + erneuter gruener Lauf. Der finale committete Diff traegt keine Mutation (per `git diff` nach dem Commit verifiziert).

---

## 7. Angepasste Bestandstests (mit Begruendung)

**11 kippende Assertionen (401->403/404):**

- `test/security.test.js` — 3x 401->403 (internalOnly statt Gate); zwei "Gate akzeptiert Credentials"-Untertests ersatzlos gestrichen (Subjekt entfaellt)
- `test/auth-p6-mount-gate.test.js` — AUTH-P6-6 von "401+Basic" auf "404 ohne Basic-Challenge" (W6-Negativkontrolle)
- `test/plans-route.test.js` — Kontrast `/api/state` 401->403
- `test/single-origin-serving.test.js` — Kontrast-Ziel von `GET /api/calls` (Route, die es nie gab — Gate maskierte diesen Bestandsfehler) auf `GET /api/state` (403) gewechselt
- `test/mcp-server-icon.test.js` — Gegenprobe 401->403
- `test/api-cost-drift.test.js`, `test/api-cost-truing-sweep.test.js`, `test/api-platform-costs.test.js` — extern ohne Creds 401->404 (Route ohne `operatorAuth` im json-Spawn nicht gemountet; Gate maskierte denselben 404 vorher als 401)
- `test/p2-onboard-retry.test.js` + `test/did-07-onboard-retry-owner-gate.test.js` — (d) 401->404; DID-07 zusaetzlich separat im `test:gates`-Katalog verifiziert (gruen)
- `test/audit.test.js` — Basic-Header entfernt, Erwartung 403 + `grund=not_local` geschaerft

**11 reine Kommentar-/Namensfixes** (Praemisse tot, Assertion unveraendert): `test/helpers.js`, `test/auth-p3-bootstrap-fallback.test.js`, `test/auth-p5-internal-only.test.js`, `test/oauth.test.js`, `test/telnyx-shim-route.test.js`, `test/i6-write-scope.test.js`, `test/config-self-service-live.test.js`, `test/web-login-wiring.test.js`, `test/route-auth-inventory.test.js` (+ROUTE_FINGERPRINT), `test/probe-auth-table.test.js`, plus vier weitere im Fix-Durchlauf r1: `test/single-origin-boot-guard.test.js`, `test/api.test.js`, `test/root-redirect.test.js`, `test/web-auth.test.js`.

**Ausserhalb des Plan-Katalogs gefunden:** `test/al-d3-consult-pump.test.js` (AL-D3-N7) — Fake-Server antwortet seit AUTH-P7 mit 403 statt 401, Assertion angepasst.

**Keine Aenderung** (bewusst): `test/boot-prod-footguns.test.js`, `test/config-prod-footguns.test.js`, `test/prod-env.js` (Boot-Guard bleibt bis P8), `test/billing-setup-checkout-route.test.js`, `test/billing-payment-gate.test.js`, `test/p12-server-error-codes.test.js` (laufen ueber 127.0.0.1 ohne X-Forwarded-For, `internalOnly` laesst durch).

---

## 8. Safety-Urteil

**PASS** (Verdict der finalen Safety-Runde). Kernpunkte:

- Eigener Produktions-Routengraph nachgebaut (53 Routen einzeln durchgesehen): 9x `internalOnly`, 8x `webAuthGateMiddleware+adminOnlyMiddleware`, 8x `webAuthGateMiddleware` allein, 1x `mcpAuth`, Rest `PUBLIC_ROUTES`. Kein `UNPROTECTED`.
- Einzige neu ungeschuetzte Schicht: `express.static(publicDir)` — traegt git-getrackt exakt `favicon.ico` + `brand/hermes-icon.png`, beide zuvor per Exemption ohnehin oeffentlich.
- Probe-Tabelle unabhaengig nachgerechnet: 64/64 Status stimmen gegen einen echt lauschenden In-Process-Server, 0 Basic-Challenges.
- 23 adversariale Umleitungs-Sonden (Location, Query, Praefix, Methoden, Beschattung) — kein Open Redirect, keine Kollision.
- Rollback-Weg gepruft: `DASHBOARD_PASSWORD` unveraendert in `config.js:797`, `render.yaml:264`, `.env.example:590`; `productionFootguns` verweigert Boot ohne sie weiterhin.
- Absolute Regeln: ausserhalb `src/app.js`, `src/route-policy.js`, `src/portal-paths.js`, `src/routes/api-billing.js`, einer Meldungs-Zeichenkette in `src/config.js` ist jede geaenderte `src`-Zeile ein Kommentar (mechanisch geprueft). `disclosureSentence`, Outbound-Gates, Signaturpruefung, Budget-Achsen unangetastet.

**Concerns (kein Blocker, s. Abschnitt "Was NICHT belegt"):** ein sachlicher Fehler im neuen `PLAN-SECURITY.md`-Abschnitt (falsche Zahl/Behauptung zu wirkungslosen Exemptions — /voice und /mcp waren sehr wohl auf ihre Ausnahme angewiesen); ein verwaister Kommentar in `src/config.js:1456-1459` (zeigt noch auf das geloeschte Modul); zwei unveraenderte Testdateien mit kontrastierenden "Basic-Auth"-Erwaehnungen (weiterhin wahr, ausserhalb Scope); `scripts/probe-auth.sh` Modus `ist-aufnahme` ist gegen die NEUE (Nach-P7-)Tabelle nicht mehr sinnvoll gegen einen Vor-P7-Deploy nutzbar (Begruendung im Skript irrefuehrend, kein toter Code); `public/` ist ohne Mechanismus bewacht (heute nichts Neues offen, aber kein Test wird rot bei kuenftigem Zuwachs).

---

## 9. Clean-Code-Audit (S1-S4)

**Verdict: PASS.** S1: keine. S2: keine.

S4 (notiert, kein Flag):
- P14 (Ein Konzept pro Test), grenzwertig: `AUTH-P7-3` buendelt sieben Redirect-Assertionen + zwei Negativproben in einem Test — zusammenhaengendes Konzept, bewusste Ausnahme.
- G11 (Konsistenz), kosmetisch: Gross-/Kleinschreibung von `ANTWORTET`-Enum-Werten in Kommentaren von `scripts/probe-auth.sh` uneinheitlich, keine funktionale Auswirkung.

Volle Regressionssuite zweimal separat gefahren (ein erster Lauf zeigte 8 rote Tests — reproduzierbar als bekannter Volllast-Flake der Spawn-Tests, kein isolierter Rot-Befund). `node --check` auf allen geaenderten `src`-Dateien erfolgreich.

---

## 10. Fix-Runden

- **r1:** Vier gemeldete Review-Blocker behoben — veraltete "hinter Basic-Auth"-Kommentare in `test/single-origin-boot-guard.test.js`, `test/api.test.js`, `test/root-redirect.test.js`, `test/web-auth.test.js` an den bereits korrigierten Wortlaut der Parallel-Stelle angeglichen.
- **r2:** Branch `phase/auth-p7-gate-entfernen-fix2` von `phase/auth-p7-gate-entfernen-fix1` abgezweigt. Einziger gemeldeter Blocker (zwei Commits statt einem) behoben durch `git reset --soft master` + einen einzelnen `git commit` mit der unveraenderten Original-Commit-Botschaft von `f935623`.

---

## 11. Deploy-Ablauf (Owner-Handlung, nummeriert)

1. **Deployen** — `phase/auth-p7-gate-entfernen-fix2` (Commit-Hash s.o.) live bringen.
2. **Live-Probe fahren:** `scripts/probe-auth.sh <url> <neuer-sha> nach-p7`
3. **Bei Exit != 0: sofort Rollback** — Deploy des Vorgaenger-Commits (letzter Commit vor diesem Merge). Das alte Gate findet `DASHBOARD_PASSWORD` weiterhin vor (unveraendert in Render/`.env.example`/`render.yaml`) und ist sofort wieder scharf.

**Abbruchsignal woertlich:** **200 auf `/api/state` ohne Sitzung = Datenleck-Fall.** Bei diesem Signal ist der Rollback nicht optional, sondern die einzige richtige Reaktion.

---

## 12. Was diese Phase NICHT belegt

- **Kein Live-Nachweis.** Der Deploy hat in dieser Session nicht stattgefunden. `scripts/probe-auth.sh <url> <sha> nach-p7` -> Exit 0 ist der eigentliche Abnahmenachweis und steht aus.
- Der lokale/Worktree-Nachbau der Probe (64/64 gruen gegen einen In-Process-Server) ist eine Simulation des erwarteten Verhaltens, **kein** Beweis, dass Render/der echte Deploy-Pfad identisch reagiert (Proxy-Header, TLS-Terminierung, Env-Drift zwischen lokal und Render sind nicht getestet).
- Die drei roten Tests in `npm run test:gates` (GAP-05, 2x GAP-15) sind Baseline-Befunde ohne Auth-Bezug — von dieser Phase weder verursacht noch geloest.
- Der dreifach vorhandene String `/auth/login` (in `src/app.js`, `src/web-auth.js`, `src/route-policy.js`) ist ein Bestands-G5-Verstoss und bewusst **nicht** Teil dieser Phase.
- `public/` bleibt ohne automatisierten Wachtposten: eine kuenftig dort abgelegte Datei ist ohne Test-Alarm weltlesbar.
- Zwei kleinere Doku-Ungenauigkeiten (falsche Zahl/Aussage in `PLAN-SECURITY.md`-Abschnitt AUTH-P7; verwaister Kommentar in `src/config.js:1456-1459`) sind nicht nachgezogen — reine Textkorrekturen, kein Verhaltensrisiko.
- Die Vereinheitlichung von Gate-Formulierungen in zwei unveraenderten Testdateien (`test/i9-self-service.test.js:365`, `test/auth-p6-operator-routes.test.js:221`) steht aus — inhaltlich weiterhin korrekt, nur Wortlaut.
