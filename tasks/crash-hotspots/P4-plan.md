# P4 — Test-Coverage & server.js-Decomposition (OT-5)

## Orchestrierung (Parallelisierung)

| Feld | Wert |
|---|---|
| Phase | P4 — Test-Coverage & server.js-Decomposition (OT-5) |
| Prerequisite | **P0, P1, P2 nach master gemerged** — P4 fasst `server.js` breit an und muss NACH jedem anderen server.js-Toucher kommen |
| Parallel-safe mit | **keine — LAST, SOLO** (kollidiert mit allem, was `server.js` anfasst) |
| Conflict-Files | `src/server.js` (gesamt), `src/web-auth.js`, `src/mcp-tools.js` |
| Empfohlener Branch | `feat/crash-p4-coverage-decomp` |
| Severity | **Medium** (Enabler / Rekurrenz-Treiber) |
| Verifikation gesamt | `npm test` gruen (Baseline + neue Cases) + Smoke-Test (Server lokal, betroffene Routen via `curl`) |

> **Warum solo + zuletzt:** P4 ist der Rekurrenz-Treiber-Fix. OT-1..OT-4 kommen wieder, weil der eigentliche Failure-Mode-Code (echte OIDC-fetch/parse, mcp-tools-Deref) nirgends asserted ist und bei jedem Refactor blind regrediert. P4 deckt diese ungetesteten External-I/O-Pfade ab UND beginnt, den `server.js`-God-File (944 LOC, 11 Fix-Touches) zu zerlegen, damit kuenftige Aenderungen nicht mehr blind landen. Die Decomposition fasst `server.js` als Ganzes an — deshalb darf P4 erst laufen, wenn P0/P1/P2 gemerged sind, und es laeuft solo.

## Problem

Drei verknuepfte Luecken, alle aus OT-5 (`analysis.md`):

1. **Echte OIDC-fetch/parse haben 0 Coverage.** `makeOidc` (`web-auth.js:180`) ruft intern `fetch` + `r.json()` auf Discovery (`web-auth.js:190`/`192`) und Token (`web-auth.js:240`/`246`), destrukturiert `id_token` aus dem Token-Body (`web-auth.js:246`) und baut `createRemoteJWKSet(new URL(jwks_uri))` (`web-auth.js:206`). In JEDEM bestehenden Test ist `oidc` per Dependency-Injection durch einen Fake ersetzt — der reale Codepfad wird nie ausgefuehrt. Eine malformte/unvollstaendige IdP-Antwort (Discovery ohne `jwks_uri`/`token_endpoint`, Token-Body non-JSON oder leeres `{}` ohne `id_token`) ist ungetestet: `new URL(undefined)` wirft, `jwtVerify(undefined, ...)` wirft, `r.json()` auf non-JSON wirft — alles als unhandled async rejection.

2. **`GET /auth/login` hat kein try/catch** (`web-auth.js:84`, Handler-Body bis `:97`; der erste externe await ist `oidc.authorizeUrl` auf `:95`, das intern `discover()` -> `fetch` triggert). Ist der IdP unerreichbar, rejected `discover()` und die Express-4-Route reicht die Rejection NICHT automatisch an eine Error-Middleware weiter — der Request haengt bis zum Socket-Timeout. **Wichtige Korrektur zur Analyse:** Es existiert bereits eine 4-arg-Error-Middleware in `server.js:115`, aber sie ist (a) **body-parser-spezifisch** — `if (!err.status || err.status < 400 || err.status >= 500) return next(err)` reicht statuslose und 5xx-Fehler explizit durch, faengt also nichts ab; und (b) **vor** den `/auth`-Routen gemountet (`server.js:115` vs. Mount `server.js:144`), waehrend Express-Error-Middleware NACH den Routen liegen muss, um deren Fehler zu sehen. Sie kann `/auth`-Fehler also strukturell nicht fangen. Beides muss adressiert werden.

3. **`mcp-tools.js`-Handler derefen aus einem still degradierten `{}`.** `api()` (`mcp-tools.js:11`) macht `await res.json().catch(() => ({}))` (`:19`) — bei Parse-Fehler ist das Ergebnis `{}`. Handler greifen danach blind auf verschachtelte Felder: `r.callId` (`:58`), `s.calendar.length`/`s.calendar.map` (`:148`/`:149`), `s.usage.calls`/`s.usage.costEur`/`s.usage.maxBudgetEur` (`:161`). Auf `{}` ist `s.calendar` `undefined` -> `.length` wirft. Der stdio-Pfad (`mcp-server.js`, 14 Zeilen, kein per-handler catch) macht daraus eine unhandled rejection.

4. **OFFEN aus `analysis.md` (Offene Verifikations-Items):** `server.js:649-655` `/api/calls`-catch interpoliert rohe Provider-`err.message` (`server.js:652`: `error: err.message`) in die 500-Response — potenzielles Secret/Param-Leak (CLAUDE.md Rule 4/5). **Verifiziert: noch offen** (kein `P2-plan.md` vorhanden, Stand dieser Session). P4 faltet den Fix ein, falls P2 ihn nicht zuerst loest.

5. **`server.js` God-File** (944 LOC): jede Auth-/Tenant-/Gate-/Signature-Aenderung konvergiert hier; nur Behavior-Coverage via gespawntem Server, kein Unit-Isolat. Refactors landen blind — die strukturelle Ursache, warum OT-1..OT-4 wiederkehren.

## Soll-Zustand (Akzeptanzkriterien)

**AC1 — OIDC discovery un-stubben.** Neue Tests fuehren den **echten** `discover()`-Pfad von `makeOidc` aus, indem nur `fetch` injiziert wird (kein Ersatz von `oidc` als Ganzes). `makeOidc` erhaelt dazu einen optionalen Test-Hook fuer `fetch` (Muster wie der bestehende `_discoveryTtlMs`-Parameter / `_getJwksForTest`-Hook in `web-auth.js:213` — KEIN neues Produktions-Interface, KEIN `globalThis`-Mock). Assertion: Discovery-Antwort ohne `jwks_uri` -> `getJwks()` wirft einen **klaren** Fehler (nicht `TypeError: Invalid URL` aus `new URL(undefined)`), Discovery-HTTP-Fehler (`!r.ok`) -> bestehender `OIDC discovery HTTP <status>`-Throw bleibt.

**AC2 — OIDC token-body un-stubben.** Tests fuehren den echten `exchange()`-fetch/parse aus (injizierter `fetch`, der einen kontrollierten Token-Response liefert). Assertion: Token-Body non-JSON (`r.json()` wirft) und Token-Body leeres `{}` (kein `id_token`) -> definierter, gefangener Fehler statt roher Rejection / `jwtVerify(undefined, ...)`-Crash. Der bestehende `!r.ok`-Throw (`web-auth.js:245`) bleibt unveraendert.

**AC3 — `GET /auth/login` fail-closed.** Der Handler (`web-auth.js:84`) bekommt try/catch um den `oidc.authorizeUrl`-await (`:95`). Bei Rejection: sauberer `5xx` (generische Meldung, **kein** IdP-Detail/Connection-Leak), kein haengender Socket. Symmetrisch fuer den `/auth/callback`-Handler (`web-auth.js:101`), falls dort gleichartige un-gefangene externe awaits liegen.

**AC4 — Express-Error-Net fuer async-Routen.** Eine **catch-all 4-arg-Error-Middleware** (`(err, req, res, next)`) wird **nach** allen `/auth`-, `/admin`- und `/api`-Mounts registriert (also hinter `server.js:183`, vor `app.listen`). Sie liefert bei statuslosem/5xx-Fehler eine generische JSON-`500` (`{ error: "internal error" }`) — **nie** `err.message`, **nie** `err.stack`, **nie** Config/Env. Die bestehende body-parser-Middleware (`server.js:115`) bleibt unveraendert an ihrer Stelle (sie ist korrekt fuer 4xx-Parser-Fehler). **Hinweis:** Express 4 reicht async-Rejections NICHT automatisch an Error-Middleware — entweder per-Route try/catch (AC3) ODER ein `asyncHandler`-Wrapper; AC3+AC4 zusammen decken beide Schichten ab (per-Route sauber, Middleware als Last-Resort-Netz).

**AC5 — `mcp-tools.js` Result-Guard.** Vor dem Deref verschachtelter Felder wird das `api()`-Ergebnis validiert: ein Helper (z.B. `requireFields(obj, [...])` oder pro Handler ein expliziter Guard) wirft eine **klare** Tool-Fehlermeldung, wenn ein erwartetes Feld fehlt (`r.callId`, `s.calendar`, `s.usage`). Kein blinder Deref auf `{}`. Die Fehlermeldung leakt keine internen Details (kein roher Gateway-Body).

**AC6 — stdio per-handler catch.** Der stdio-Pfad faengt Tool-Throws ab, sodass ein Handler-Fehler eine saubere MCP-Fehlerantwort wird statt einer process-level unhandled rejection. Umsetzung minimal-invasiv: entweder Wrapper um die Handler in `registerTools` (`mcp-tools.js:42`) ODER ein top-level catch im stdio-Bootstrap (`mcp-server.js`). Gilt fuer beide Transporte (stdio UND HTTP `/mcp`), da `registerTools` geteilt ist.

**AC7 — `server.js` Decomposition (EIN Concern, behavior-preserving).** **Inkrementell, KEIN Full-Rewrite.** Genau **eine** kohaerente Route-Gruppe wird in ein eigenes Modul extrahiert, als Template fuer weitere Extraktion. **Empfehlung: die `/api/*`-REST-Gruppe** (`/api/calls`, `/api/calls/:id/cancel`, `/api/state`, `/api/onboard`, ...) in `src/routes/api.js` als `makeApiRoutes(deps)`-Factory (gleiches DI-Muster wie `makeWebAuthRoutes`/`makeAdminRoutes` — `web-auth.js` ist die bewaehrte Vorlage). Alternative, falls `/api` zu breit verzahnt ist: die `/voice/*`-Telephonie-Gruppe. Verhalten **identisch** — gleiche Pfade, gleiche Gates, gleiche Responses. Die Safety-Gates (Allowlist, Budget, Max-Dauer, Signatur) und der Disclosure-Pfad bleiben unveraendert und im selben Pfad wirksam (CLAUDE.md Absolute Regeln 1/2/3). Restliche `server.js`-Routen bleiben vorerst, wo sie sind — die Extraktion ist laufend und muss solo/zuletzt erfolgen.

**AC8 — `/api/calls`-Leak (OFFEN-Item).** `server.js:652` `error: err.message` wird auf eine generische, provider-freie Meldung umgestellt (z.B. `{ error: "Call konnte nicht gestartet werden" }` + bestehender `hint`), rohe Provider-`err.message` nur ins Server-Log (CLAUDE.md Rule 4/5). **Bedingt:** nur ausfuehren, falls P2 diesen Fix nicht bereits gemerged hat — vor Umsetzung `git log`/`server.js:649-655` pruefen.

**AC9 — Baseline gruen.** Alle bestehenden Tests bleiben gruen. Neue Tests decken AC1-AC8 ab. Smoke-Test beweist AC3 (IdP-down -> sauberer 5xx) und AC7 (extrahierte Route verhaelt sich identisch).

## Lokalisierung (verifiziert 2026-06-16)

| Stelle | Datei:Zeile | Aktuell |
|---|---|---|
| `makeOidc`-Factory | `src/web-auth.js:180` | `export function makeOidc(config, { _discoveryTtlMs = DISCOVERY_TTL_MS } = {})` |
| Discovery-fetch | `src/web-auth.js:190` | `const r = await fetch(\`${config.oauthIssuerUrl}/.well-known/openid-configuration\`)` |
| Discovery-`r.json()` | `src/web-auth.js:192` | `discoveryCache = await r.json();` |
| `jwks_uri`-Deref + `new URL` | `src/web-auth.js:204`/`206` | `const { jwks_uri } = await discover();` / `createRemoteJWKSet(new URL(jwks_uri))` |
| Token-fetch | `src/web-auth.js:240` | `const r = await fetch(token_endpoint, { ... })` |
| Token-`r.json()` + `id_token`-Destructure | `src/web-auth.js:246` | `const { id_token } = await r.json();` |
| `_getJwksForTest`-Hook (DI-Vorbild) | `src/web-auth.js:213` | `_getJwksForTest: getJwks,` |
| `GET /auth/login`-Handler | `src/web-auth.js:84` | `router.get("/auth/login", async (req, res) => {` (Body bis `:97`) |
| erster externer await im Handler | `src/web-auth.js:95` | `const url = await oidc.authorizeUrl({ ... });` |
| `GET /auth/callback`-Handler | `src/web-auth.js:101` | `router.get("/auth/callback", async (req, res) => {` |
| `api()`-degrade-to-`{}` | `src/mcp-tools.js:19` | `const json = await res.json().catch(() => ({}));` |
| Handler-Deref `r.callId` | `src/mcp-tools.js:58` | `return text({ call_id: r.callId, status: "dialing" });` |
| Handler-Deref `s.calendar` | `src/mcp-tools.js:148`/`149` | `if (!s.calendar.length) ...` / `s.calendar.map(...)` |
| Handler-Deref `s.usage` | `src/mcp-tools.js:161` | `\`Calls bisher: ${s.usage.calls}\nKI-Kosten: ${s.usage.costEur...}\`` |
| `registerTools` (geteilt stdio+HTTP) | `src/mcp-tools.js:42` | `export function registerTools(server, { identity = null, allowCalendar = true } = {})` |
| stdio-Bootstrap (kein catch) | `src/mcp-server.js:10`-`13` | `registerTools(server);` ... `await server.connect(transport);` |
| body-parser-Error-Middleware (bestehend) | `src/server.js:115` | `app.use((err, _req, res, next) => { if (!err.status || err.status < 400 || err.status >= 500) return next(err); ... })` |
| `/auth`-Mount | `src/server.js:144` | `app.use(makeWebAuthRoutes({ ... }))` |
| `/admin`-Mount | `src/server.js:172` | `app.use(makeAdminRoutes({ ... }))` |
| Self-Service-Mount | `src/server.js:183` | `app.use(makeSelfServiceRoutes({ ... }))` |
| `/api/calls`-catch-Leak (OFFEN) | `src/server.js:649`-`655` | `} catch (err) { ... res.status(500).json({ error: err.message, hint: ... }) }` (Leak in `:652`) |
| `server.js`-Gesamt-LOC | `src/server.js` | **944 LOC** (wc -l) |

## Test-Cases (node:test)

Bestehende Test-Struktur: `test/*.test.js`, `node:test` ohne Netz/`.env`. OIDC-Unit-Tests gegen `makeOidc` mit injiziertem `fetch`-Fake (Muster wie `_discoveryTtlMs`/`_getJwksForTest`). mcp-tools-Tests mit injiziertem/gemocktem `api()` bzw. `fetch`. Integrationstest fuer `/auth/login` startet den Server als Kindprozess (`PORT=0`, `DATA_DIR`-Override).

### T-P4-01: OIDC malformed-discovery -> klarer Fehler, kein `new URL(undefined)`
**Given:** `makeOidc` mit injiziertem `fetch`, der eine 200-Discovery OHNE `jwks_uri` liefert.
**When:** `getJwks()` (via `_getJwksForTest`) wird aufgerufen.
**Then:** wirft einen klaren, identifizierbaren Fehler (kein roher `TypeError: Invalid URL`); kein unhandled rejection.

### T-P4-02: OIDC discovery-HTTP-Fehler -> bestehender Throw bleibt
**Given:** injizierter `fetch` liefert `{ ok: false, status: 503 }` fuer Discovery.
**When:** `discover()` laeuft.
**Then:** wirft `OIDC discovery HTTP 503` (Verhalten aus `web-auth.js:191` unveraendert).

### T-P4-03: OIDC malformed-token-body (non-JSON) -> gefangen
**Given:** injizierter `fetch` liefert fuer den Token-Endpoint `{ ok: true, json: () => Promise.reject(new Error("not json")) }`.
**When:** `exchange({ ... })` laeuft.
**Then:** definierter, gefangener Fehler statt roher Rejection; `jwtVerify` wird nie mit `undefined` aufgerufen.

### T-P4-04: OIDC token-body leeres `{}` (kein id_token) -> gefangen
**Given:** injizierter `fetch` liefert Token-Body `{}` (kein `id_token`).
**When:** `exchange({ ... })` laeuft.
**Then:** klarer Fehler (fehlendes `id_token`), kein `jwtVerify(undefined, ...)`-Crash.

### T-P4-05: `/auth/login` bei IdP-down -> sauberer 5xx, kein Hang
**Given:** Server-Kindprozess mit `oauthIssuerUrl` auf einen nicht-erreichbaren Host (oder injiziertem `oidc.authorizeUrl`, das rejected).
**When:** `curl`/`fetch` auf `GET /auth/login`.
**Then:** Response-Status `5xx` innerhalb Test-Timeout (Request haengt NICHT bis Socket-Timeout); Body enthaelt **keine** IdP-/Connection-Details.

### T-P4-06: mcp-tools malformed-api-response -> handled, kein Deref-Crash
**Given:** `api()` (bzw. injizierter `fetch`) liefert `{}` (Parse-Fail-Degradation) fuer `GET /api/state`.
**When:** der `get_calendar`- bzw. usage-Tool-Handler laeuft.
**Then:** klare Tool-Fehlermeldung statt `TypeError: Cannot read properties of undefined (reading 'length')`; kein unhandled rejection.

### T-P4-07: stdio tool-throw -> saubere Fehlerantwort, keine unhandled rejection
**Given:** ein Tool-Handler wirft (z.B. via T-P4-06-Bedingung) auf dem stdio-Pfad.
**When:** das Tool wird aufgerufen.
**Then:** der Throw wird als MCP-Tool-Fehler zurueckgegeben; der Prozess loggt keinen `unhandledRejection`.

### T-P4-08: extrahierte Route — Behavior-Paritaet
**Given:** die nach AC7 extrahierte Route-Gruppe (z.B. `makeApiRoutes`) gemountet wie zuvor.
**When:** dieselben Requests wie vor der Extraktion (gleiche Pfade, gleiche Bodies, Gate-Treffer + Gate-Ablehnung).
**Then:** identische Status-Codes und Response-Shapes wie die Baseline (Snapshot/Vergleich gegen das Verhalten vor dem Refactor). Safety-Gates greifen unveraendert.

### T-P4-09: `/api/calls`-Originate-Fehler leakt keine Provider-`err.message` (bedingt, falls nicht durch P2)
**Given:** der Originate-Pfad wirft (gemockter Twilio/Telnyx-Client wirft mit Provider-Detail).
**When:** `POST /api/calls`.
**Then:** Response-Body enthaelt eine generische Meldung, **nicht** die rohe `err.message`; das Provider-Detail erscheint nur im Server-Log.

## Betroffene Dateien

| Datei | Typ | Aenderung |
|---|---|---|
| `src/web-auth.js` | Source | (1) optionaler `fetch`-Test-Hook in `makeOidc` (Muster `_discoveryTtlMs`); (2) try/catch in `GET /auth/login` (`:84`) + ggf. `/auth/callback` (`:101`); (3) klare Fehler statt roher Crashes bei fehlendem `jwks_uri`/`id_token` |
| `src/server.js` | Source | (1) catch-all 4-arg-Error-Middleware NACH den Mounts (hinter `:183`); (2) AC7-Extraktion einer Route-Gruppe in neues Modul; (3) AC8 `/api/calls`-Leak (`:652`, bedingt) |
| `src/routes/api.js` (neu) | Source | extrahierte `makeApiRoutes(deps)`-Factory (AC7); DI-Muster wie `makeWebAuthRoutes` |
| `src/mcp-tools.js` | Source | (1) Result-Guard vor Deref (`:58`/`:148`/`:161`); (2) per-handler Throw-Schutz im geteilten `registerTools` (`:42`) |
| `src/mcp-server.js` | Source | top-level catch im stdio-Bootstrap (`:10`-`13`), falls Schutz nicht in `registerTools` liegt |
| `test/web-auth.test.js` | Test | T-P4-01 bis T-P4-05 |
| `test/mcp-tools.test.js` (ggf. neu) | Test | T-P4-06, T-P4-07 |
| `test/api-routes.test.js` (ggf. neu) | Test | T-P4-08, T-P4-09 |

## Verifikation

```bash
node --check src/web-auth.js
node --check src/server.js
node --check src/mcp-tools.js
node --check src/mcp-server.js
node --check src/routes/api.js
npm test            # Baseline + T-P4-01..T-P4-09 gruen

# Smoke-Test AC3 (IdP-down -> sauberer 5xx, kein Hang):
PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true OAUTH_ISSUER_URL=http://127.0.0.1:1 \
  SESSION_SECRET=test STORE_BACKEND=pg npm start &
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" --max-time 5 http://localhost:3999/auth/login
# Erwartung: 5xx, time_total << 5s (kein Socket-Hang); Body ohne IdP-Detail

# Smoke-Test AC7 (extrahierte Route identisch):
curl -s http://localhost:3999/healthz   # ok:true
# betroffene /api-Route vor/nach Extraktion gegen gleiche Eingabe vergleichen
```

CLAUDE.md `Vor Edits`: bei Funktions-Aenderungen `grep` nach allen Callern (`registerTools` wird von Budget-Engine UND Realtime-Bridge genutzt; die extrahierte Route von server.js + Tests). Nach Edits `node --check` + `npm test`. Bei sicherheitsrelevanten Aenderungen (`/api/calls`-Leak, Error-Middleware) `PLAN-SECURITY.md` aktualisieren.

## Risiken / Pre-Mortem (1 Jahr in der Zukunft, P4 war falsch)

- **Decomposition driftet das Verhalten.** Eine extrahierte Route verhaelt sich subtil anders (Reihenfolge der Middleware, `this`/Closure-Bindung, vergessenes Gate) -> ein Safety-Gate oder der Disclosure-Pfad ist im neuen Modul nicht mehr wirksam. **Mitigation:** kleinster Schritt (EINE Gruppe), Behavior-Paritaets-Test (T-P4-08) gegen Baseline-Snapshot, Gate-Treffer + Gate-Ablehnung explizit asserten; `git diff` zeigt reine Verschiebung, keine Logik-Aenderung. CLAUDE.md Absolute Regeln 1/2/3 sind nicht verhandelbar.
- **Un-stubbing legt latente Bugs offen.** Die echten OIDC-fetch/parse-Tests koennten existierende Bugs aufdecken (z.B. `new URL(undefined)` statt klarer Fehler). **Das ist gewollt** — Bug fixen, nicht den Test weichspuelen. Der Fix gehoert in dieselbe Phase (AC1/AC2 verlangen klare Fehler).
- **Error-Middleware maskiert echte Fehler.** Ein zu breites catch-all-Net verschluckt Bugs als generische 500 und macht Debugging blind (das auth-`catch{}`-Anti-Pattern aus der Analyse). **Mitigation:** Middleware loggt `err.stack` server-seitig **laut** (nur Log, nie Response), liefert dem Client nur generisch. Per-Route try/catch (AC3) bleibt die primaere Schicht; die Middleware ist Last-Resort.
- **Async-Rejection entkommt der Middleware trotzdem.** Express 4 reicht unhandled async-Rejections NICHT an 4-arg-Middleware — wer nur die Middleware baut und die per-Route-try/catch weglaesst, hat AC3 nicht erfuellt und der Hang bleibt. **Mitigation:** AC3 (per-Route) UND AC4 (Middleware) sind beide Pflicht; T-P4-05 beweist, dass der Hang weg ist.
- **mcp-tools-Guard aendert Tool-Vertrag.** Ein zu strikter `requireFields`-Guard wirft auch bei legitim-leeren Antworten (leerer Kalender ist valide: `s.calendar = []`, nicht `undefined`). **Mitigation:** Guard prueft Existenz/Typ (`Array.isArray(s.calendar)`), nicht Nicht-Leere; leerer Kalender bleibt der bestehende `"Kalender ist leer."`-Pfad (`mcp-tools.js:148`).
- **P4 laeuft nicht zuletzt -> Merge-Konflikt-Chaos.** Laeuft P4 parallel zu P0/P1/P2, kollidiert die `server.js`-Decomposition mit jedem anderen server.js-Diff. **Mitigation:** Orchestrierung-Tabelle ist bindend — P4 ist LAST, SOLO; Prerequisite P0+P1+P2 gemerged.
- **CLAUDE.md-Gates/Secrets unangetastet:** P4 fasst Allowlist/Budget/Disclosure/Signatur inhaltlich NICHT an — nur Coverage, Error-Handling und strukturelle Verschiebung. Secret-Disziplin (Rule 4/5) wird durch AC4/AC8 sogar verschaerft.
