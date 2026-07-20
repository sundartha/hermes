# Server-Slim Phase P12 — Report

**Ziel:** `src/routes/mcp.js` extrahieren — das `/mcp`-Trio (`POST /mcp` mit `mcpAuth`, `GET`/`DELETE /mcp` -> 405) aus `src/server.js`, stateless (INV-8: `McpServer`+`StreamableHTTPServerTransport` pro Request, kein Hoisting)
**Gate:** PASS
**finalBranch:** `phase/slim-p12-mcp-routes`
**headCommit (Impl):** `fb4e76b996e498a1ded790f0e032c27a322e136a`

---

## 1. Plan (gekuerzt)

### Verifizierter Ist-Stand

`src/server.js` war zu Phasenbeginn **936 Zeilen** (nicht 2244 — P0-P11 bereits gemerged). Das `/mcp`-Trio steht bei **L719-791** (Plan-Doc nannte veraltet L1997-2069):

- **L723-787:** `app.post("/mcp", mcpAuth, async (req,res) => {...})`
- **L788:** `app.get("/mcp", ...) -> 405`
- **L789-791:** `app.delete("/mcp", ...) -> 405`
- Mount-Nachbarn: davor `app.use(makeOnboardRoutes(...))` (L717), danach `app.use(errorHandler)` (L801). Zielposition unveraendert dazwischen (INV-2: `MCP-Router -> errorHandler`).

**Inject-vs-Import — bindender Repo-Praezedenzfall geprueft:** Alle bereits gemergten Schwester-Router (`voice.js`, `api-read.js`, `api-calls.js`, `api-billing.js`, `api-onboard.js`) importieren pure/statische Helfer, Konstanten und Klassen direkt und injizieren nur `config`/`store`/Laufzeit-Singletons. Daher werden `McpServer`, `StreamableHTTPServerTransport`, `registerTools`, `uiServerExtension`, `HERMES_SERVER_INFO`, `mcpAuth`, `hashEmail`, `ANON_IDENTITY` **direkt importiert** (keine Per-Prozess-Instanzen, INV-7 unberuehrt); injiziert werden **nur** `{ config, store, requestTenant }`. `requestTenant` ist die EINE Wurzel-Instanz (INV-7), bereits an `makeCallRoutes`/`makeReadRoutes` gereicht. Der Handler nutzt kein `audit()` (verifiziert — nur `console.log`/`console.error`), daher ist `audit` keine Dep.

**Unused-Imports nach dem Move (G12) — verifiziert per grep:** `McpServer`, `StreamableHTTPServerTransport`, `registerTools`, `uiServerExtension`, `HERMES_SERVER_INFO`, `hashEmail`, `mcpAuth`, `ANON_IDENTITY` werden in `server.js` ausschliesslich im `/mcp`-Block referenziert -> nach Move alle 0. `BRAND_ASSETS_PREFIX`, `registerWellKnown`, `audit`/`safeEqual`, `requestTenant` bleiben in Gebrauch -> deren Import-Zeilen werden nur gekuerzt, nicht entfernt.

**Keine Test-Aenderung noetig — verifiziert:** Kein Test greift `server.js`-Quelltext nach `/mcp`/`McpServer`-Inhalt ab. Die POST-`/mcp`-Behavior-Suite (`oauth`, `mcp-tools`, `mcp-ui`, `am6-oauth-tenant`, `request-tenant`, `mcp-server-icon`) trifft die Live-HTTP-Route, die an `POST /mcp` bleibt -> gruen ohne Aenderung.

### (1) Neue Datei `src/routes/mcp.js`

Signatur: `export function makeMcpRoutes({ config, store, requestTenant })` -> `express.Router`. Der POST-Handler-Koerper ist eine **byte-identische Kopie** von `server.js` L723-787 (inkl. aller Inline-Kommentare, die die INV-8/AM6/PII-Begruendung tragen). GET/DELETE bleiben byte-identisch (dupliziertes 405-String-Literal absichtlich beibehalten — Dedup ist per HARTE ABGRENZUNG/A2 Folgearbeit, kein Move-Umbau).

Modul-Header dokumentiert explizit: **STATELESS (INV-8, KRITISCH)** — `McpServer`+`StreamableHTTPServerTransport` werden PRO REQUEST im Handler gebaut (`sessionIdGenerator: undefined`) mit `res.on("close")`-Cleanup, kein Hoisting/Caching ueber Requests (ein Hoisten braeche den stateless Streamable-HTTP-Vertrag). `/mcp` ist Auth-Gate-exempt (Basic-Auth-Gate ruft `next()` fuer `/mcp*`, INV-3); `mcpAuth` ist die EINZIGE Absicherung auf POST, fail-closed (Default nur localhost). GET/DELETE tragen keine Auth (nur 405).

Handler-Ablauf: `scopedTenant = requestTenant(req)` (AM6, EINMAL aus dem verifizierten JWT); Diagnose-Log mit gehashter E-Mail (`hashEmail`, T-P0-7, kein PII-Klartext im Render-stdout); `identity` aus `req.auth.email || req.auth.sub || ANON_IDENTITY`; `profile = store.resolveProfile(scopedTenant)` (fail-closed, DEFAULT_PROFILE bei fehlendem Tenant-Profil); optionale UI-Extension (`config.mcpUiEnabled`, SEP-1865); `McpServer`+`registerTools`+`StreamableHTTPServerTransport` pro Request, `res.on("close")` schliesst Transport+Server; Fehlerpfad liefert JSON-RPC `-32603` nur wenn `!res.headersSent`.

~110 LOC (Kommentare inklusive). Router am App-Root gemountet, `router.post("/mcp", ...)` matcht `/mcp` byte-identisch wie vormals `app.post`.

### (2) Edits in `src/server.js`

- **Edit A:** Imports von `McpServer`, `StreamableHTTPServerTransport` (L7-8), `registerTools`, `uiServerExtension` (L23-24) komplett entfernt.
- **Edit B:** L25 `HERMES_SERVER_INFO` gestrichen, `BRAND_ASSETS_PREFIX` behalten.
- **Edit C:** L30 `mcpAuth` gestrichen, `registerWellKnown` behalten.
- **Edit D:** L31 `hashEmail` gestrichen, `audit`/`safeEqual` behalten.
- **Edit E:** L93 `ANON_IDENTITY,` aus dem `request-tenant.js`-Importblock entfernt.
- **Edit F:** L115 begleitender Kommentar (C2 stale-comment-Fix) auf "OWNER_ID/TENANT_REJECT" (ohne `ANON_IDENTITY`) korrigiert.
- **Edit G:** nach L70 `import { makeMcpRoutes } from "./routes/mcp.js";` ergaenzt.
- **Edit H:** der Inline-`/mcp`-Block (L719-791) durch `app.use(makeMcpRoutes({ config, store, requestTenant }));` mit Sicherheits-Erklaerkommentar (Mount-Position, INV-2/INV-3/INV-8) ersetzt.

Netto laut Plan-Schaetzung: `server.js` ~-65 Zeilen. `errorHandler` bleibt letztes `app.use`.

### (3) Tests

Bestandssuite reicht fuer den POST-Pfad (byte-identische Behavior-Coverage, keine Aenderung). **EIN neuer Test empfohlen** (`test/mcp-method-not-allowed.test.js`): GET/DELETE `/mcp` -> 405 hatte bislang KEINEN HTTP-Test (nur SMOKE, per grep bestaetigt). Friert den 405-Kontrakt byte-beweisbar ein (Muster P0a/P0b: erst gruen gegen den unveraenderten `server.js`, dann gegen das Modul). Fallback laut Plan: der Test ist Kuer, keine Pflicht (reine Verschiebung).

### (4) Deterministisch pruefbares Ergebnis

`node --check` beide Dateien; `grep -c "^export" src/server.js` = 0; `grep -cE 'app\.(post|get|delete)\("/mcp"' src/server.js` = 0; `grep -c "makeMcpRoutes" src/server.js` = 2 (Import+Mount); Unused-Import-Beweis (0 Treffer fuer die 8 entfernten Bindungen in `server.js`); Boot-Log-Zeile genau 1x; negative Netto-Bilanz in `git diff --stat src/server.js`; isolierte Phasen-Suite + volle `npm test` (beide Backends) gruen; SMOKE-Rezept mit `GET /mcp` -> 405.

### Invarianten-Abgleich

- **INV-8 (stateless):** `McpServer`+`StreamableHTTPServerTransport` bleiben im Handler pro Request, kein Hoisting.
- **INV-3 (Auth-Exemption):** `/mcp*`-Ausnahme im Basic-Auth-Gate unberuehrt; `mcpAuth` einzige Absicherung, fail-closed.
- **INV-7 (eine Instanz):** nur `requestTenant` injiziert; alle anderen Bausteine sind statische Modul-Bindungen.
- **INV-2 (Mount-Reihenfolge):** Mount exakt zwischen `makeOnboardRoutes` und `errorHandler`.

**Bewusste Abgrenzungen (vorab begruendet):** (a) dupliziertes 405-Literal in GET+DELETE absichtlich beibehalten (Dedup = Folgearbeit); (b) 3 injizierte Deps < 4 (F1 ok, Objekt-Parameter); (c) Dep-Liste weicht bewusst von der SPEC-Wortliste ab (pure Helfer direkt importiert statt injiziert) — gedeckt durch die SPEC-Klausel und den Schwester-Router-Praezedenzfall.

**Blast-Radius:** 1 neue Datei, ~8 chirurgische Edits in `server.js`, 0 Aenderung an `mcp-tools.js`/`mcp-server-info.js`/`auth.js`/`ui/*`, 0 Aenderung an Bestands-Tests, optional 1 neuer Test. Keine neue Dependency, keine neue Env-Var.

---

## 2. Impl-Zusammenfassung

P12 exakt gemaess Plan umgesetzt: das `/mcp`-Trio (POST mit `mcpAuth`, GET/DELETE -> 405) wurde byte-identisch aus `src/server.js` (L719-791) nach `src/routes/mcp.js` (`makeMcpRoutes`-Factory, DI-Muster wie `makeBillingRoutes`/`makeVoiceRoutes`) verschoben. `server.js` schrumpft von **936 auf 868 Zeilen** (-68, netto -65 laut Plan-Schaetzung). Alle 8 geplanten Edits (Import-Streichungen `McpServer`/`StreamableHTTPServerTransport`/`registerTools`/`uiServerExtension`/`HERMES_SERVER_INFO`/`mcpAuth`/`hashEmail`/`ANON_IDENTITY`, Kommentar-Fix C2, Router-Import + Mount) exakt durchgefuehrt. INV-8 (stateless, `McpServer`+Transport PRO REQUEST, `res.on("close")`-Cleanup), INV-3 (`/mcp` bleibt Auth-Gate-exempt) und INV-2 (Mount-Position zwischen `makeOnboardRoutes` und `errorHandler`) verifiziert unveraendert.

Ein neuer Spawn-Test (`test/mcp-method-not-allowed.test.js`) friert den bisher nur per SMOKE gedeckten 405-Kontrakt fuer GET/DELETE `/mcp` ein (Plan-Empfehlung "hoechstens EIN neuer Test"). Alle deterministischen Plan-Checks (grep-c export=0, mcp-Trio in server.js=0, makeMcpRoutes-Refs=3 inkl. Kommentar, Boot-Log-Zeile genau 1x, `node --check`) bestanden.

**Smoke-Test** (echter Server, freier Port): GET/DELETE `/mcp` -> 405 mit korrektem Body, POST `/mcp` mit Accept-Header -> 200 (voller MCP-initialize-Roundtrip).

**Testergebnis:** isolierte Phasen-Suite (oauth/mcp-tools/mcp-ui/request-tenant/am6-oauth-tenant/mcp-method-not-allowed) 81/81 gruen. Volle `npm test` (json-Default, inkl. aller pglite-in-process-Tests ueber `test/pg-helpers.js`) **2293/2293 gruen**.

**Dateien:**
- neu: `src/routes/mcp.js`, `test/mcp-method-not-allowed.test.js`
- geaendert: `src/server.js`

**Tests:** `test/mcp-method-not-allowed.test.js` (neu, 2 Tests: GET/DELETE `/mcp` -> 405). Testergebnis: 2293 pass / 0 fail.

### Deviations (Impl, final)

1. `STORE_BACKEND=pg npm test` (Plan-Schritt 6, Wrapper-Invocation) zeigt 32 fehlschlagende Testdateien mit `[store] FATAL: pg-Backend nicht initialisierbar`. Root-Cause verifiziert (**kein Zusammenhang zu P12**): diese Dateien (z.B. `test/tenant-erasure.test.js`, `test/store-integrity.test.js`, `test/retention.test.js`) importieren `../src/store.js` dynamisch OHNE `STORE_BACKEND` selbst zu ueberschreiben, um explizit den json-Pfad zu testen. Wird `STORE_BACKEND=pg` fuer den GESAMTEN `npm test`-Lauf gesetzt, vererbt sich das auf diesen dynamischen Import -> `store.js` versucht einen echten `pg.Pool` gegen ein leeres `DATABASE_URL` -> faellt fail-closed mit `process.exit(1)`. Verifiziert per `git diff --stat master -- <betroffene Dateien>` = leer (byte-identisch zu `master`, von P12 nicht beruehrt). Die eigentliche pglite-in-process-Abdeckung (`test/pg-helpers.js::makePgTestStore`, PGlite direkt instanziiert, umgeht `store.js` komplett) laeuft bereits INNERHALB des normalen `npm test`-Laufs (ohne `STORE_BACKEND`-Wrapper) mit und ist darin gruen (in den 2293 bestandenen Tests enthalten, u.a. "Fassade pg.js (pglite)"-Tests). `testsPass`/`testPassCount`/`testFailCount` beziehen sich daher auf den regulaeren `npm test`-Lauf (die im Repo gueltige Definition von "beide Backends gruen", CLAUDE.md-Befehlsliste nennt nur `npm test` ohne `STORE_BACKEND`-Praefix).

### Clean-Code-Selbstcheck (Impl)

G5 (Duplizierung): keine neue Duplizierung eingefuehrt — die einzige bewusst beibehaltene Duplizierung (405-String-Literal in GET+DELETE) ist Bestand aus dem Original und laut SPEC/Plan explizit Nicht-Ziel dieser Phase. G12 (unused Imports): verifiziert per grep — alle 8 aus `server.js` entfernten Bindungen haben in `server.js` keine Restreferenz mehr ausser in erklaerenden Kommentaren. C2 (ueberholte Kommentare): der Kommentar bei `OWNER_ID`/`TENANT_REJECT` wurde synchron zur entfernten `ANON_IDENTITY`-Bindung aktualisiert. C5/G9 (toter/auskommentierter Code): keiner eingefuehrt. F1 (Argumente): `makeMcpRoutes` nimmt ein Objekt-Parameter `{ config, store, requestTenant }` — 3 injizierte Deps, konform mit dem Schwester-Router-Praezedenzfall. P15 (Konstruktion trennen): Router wird einmalig am Modul-Top-Level konstruiert und gemountet, keine Lazy-Init im Handler. G34/G30: POST-Handler ist 1:1-Kopie des Originals — keine neue Vermengung von Ebenen. Magic Numbers: keine neuen. ESM/kein Build-Step/Kommentare deutsch ohne Umlaute: eingehalten.

---

## 3. Safety-Urteil

**approved: true** — alle Kernkriterien erfuellt:

- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `scopeRespected`: true
- `behaviorAsIntended`: true

**Unabhaengige Verifikation:** Phasen-spezifisch (`oauth`, `mcp-tools`, `mcp-ui`, `request-tenant`, `am6-oauth-tenant` + neuer `mcp-method-not-allowed`): 81 pass / 0 fail. Volle Suite (`NODE_ENV=test node --test test/*.test.js`): 2293 pass / 0 fail (inkl. 126 pglite/pg-Backend-Tests -> beide Backends gruen, kein `p5-gate-proof`-Flake aufgetreten). Live-Smoke (Server geseedet via `OWNER_NUMBER_SEED`): `GET /mcp` -> 405 mit exaktem Body `{"error":"POST only (stateless transport)"}`, `DELETE /mcp` -> 405 gleicher Body, `POST /mcp` erreicht den Transport (406 Content-Negotiation, unveraendert), `PUT /mcp` -> 404, Boot-Banner genau 1x. `node --check` auf `mcp.js`/`server.js`/Test alle OK.

**Blockers:** keine.

**Concerns (nicht blockierend):**
1. Injizierte Dep-Liste ist `{config, store, requestTenant}` statt der volleren SPEC-Skizze; die stateless/pure Bausteine (`McpServer`/`Transport`/`registerTools`/`uiServerExtension`/`HERMES_SERVER_INFO`/`mcpAuth`/`hashEmail`/`ANON_IDENTITY`) werden direkt aus ihren Quellmodulen importiert. Vom SPEC ausdruecklich erlaubt ("exakte Dep-Liste aus echtem Code ableiten") und konsistent mit `makeVoiceRoutes`; Verhalten byte-identisch. Kein Blocker.

**Verdict:** APPROVED — P12 ist eine saubere, byte-identische reine Verschiebung des `/mcp`-Trios nach `src/routes/mcp.js`. Genau 3 Dateien geaendert (neues Modul, `server.js` Netto-Reduktion, EIN neuer Test), keine neue npm-Dependency, keine verbotenen Dateien beruehrt. INV-2 (Mount-Position nach `makeOnboardRoutes` vor `errorHandler`), INV-3 (`/mcp` Auth-Gate-exempt, `mcpAuth` einzige POST-Absicherung fail-closed), INV-6 (Boot-Log genau 1), INV-7 (EINE `requestTenant`-Instanz injiziert), INV-8 (`McpServer`+Transport pro Request im Handler, `sessionIdGenerator:undefined`, `res.on("close")`-Cleanup, kein Hoisting), INV-10 (0 Exports) alle intakt. Safety-Gates, Disclosure (`claude.js`/`bridge.js` untouched), Secrets (E-Mail weiter gehasht) unangetastet. Alle Tests gruen, Live-HTTP-Verhalten byte-identisch verifiziert.

---

## 4. Clean-Code-Audit (S1-S4)

**Verdict: PASS**, `blocker: false`.

Diff ist eine verifiziert reine Verschiebung: normalisierter Textvergleich (Einrueckung entfernt) des alten `app.post`/`app.get`/`app.delete`-Blocks aus `server.js` gegen den neuen `router.post`/`get`/`delete`-Block in `src/routes/mcp.js` zeigt Null inhaltliche Abweichung (Kommentare, Logik, Fehlertexte, Statuscodes byte-identisch). Mount-Position in `server.js` unveraendert (nach `makeOnboardRoutes`, vor `errorHandler`) — grep-verifiziert. Der Basic-Auth-Gate-Exempt-Check (`req.path.startsWith("/mcp")`) liegt ausserhalb des Diffs und bleibt unangetastet — `/mcp` bleibt einzig durch `mcpAuth` (fail-closed) abgesichert. Alle aus `server.js` entfernten Imports (`McpServer`, `StreamableHTTPServerTransport`, `registerTools`, `uiServerExtension`, `HERMES_SERVER_INFO`, `mcpAuth`, `hashEmail`, `ANON_IDENTITY`) sind in `server.js` mit 0 verbleibenden Referenzen (grep-verifiziert) und tauchen alle korrekt in den neuen Imports von `routes/mcp.js` wieder auf; `BRAND_ASSETS_PREFIX` bleibt korrekt (weiterhin genutzt) importiert. `node --check` auf `server.js` und `routes/mcp.js` sauber. Volle Testsuite: 2293/2293 gruen (ein Lauf, keine Flakes beobachtet). Der neue Test `test/mcp-method-not-allowed.test.js` deckt eine vorher tatsaechlich fehlende Luecke ab (GET/DELETE `/mcp` -> 405 hatte laut Kommentar nur SMOKE-Coverage, keinen HTTP-Test) und ueberschneidet sich nicht mit bestehenden `/mcp`-Tests (`am6-oauth-tenant`, `auth-mcp-bypass`, `security`, `mcp-tools` etc. decken andere Aspekte ab) — kein Test-Duplikat. DI-Konvention (`config`/`store`/`requestTenant` injiziert, restliche stateless/pure Bausteine direkt importiert) folgt exakt dem in P9/P11 etablierten Import-vs-Inject-Muster (G11/G24 konsistent). `requestTenant` bleibt die eine Wurzel-Instanz aus `server.js` (INV-7), keine Re-Instanziierung. Keine Secrets/PII im Diff, keine Magic Numbers neu eingefuehrt, kein toter Code, keine abgeschalteten Sicherungen.

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3 (nicht blockierend):**
  - G5 (carry-over, informativ) · `src/routes/mcp.js:82-85` (`router.get`/`router.delete`) · Die 405-Handler fuer GET/DELETE `/mcp` duplizieren woertlich den Fehlertext "POST only (stateless transport)" — existierte bereits identisch in `master` (`app.get`/`app.delete`) und wurde nur mitverschoben, nicht neu eingefuehrt oder verschaerft. Fix (optional, spaetere Phase, keine Regression dieser Phase): gemeinsame Konstante/Helper fuer die 405-Antwort extrahieren.
- **S4 (informativ):**
  - G30 (carry-over, informativ) · `src/routes/mcp.js:35-97` (`router.post("/mcp", ...)`) · Der POST-Handler buendelt Tenant-Aufloesung, Audit-Logging, Identitaets-/Profil-Aufloesung, `McpServer`-Aufbau, Tool-Registrierung, Transport-Wiring und Error-Handling in einer Funktion — per Diff-Vergleich (Einrueckung normalisiert) byte-identisch aus `server.js` mitverschoben, nicht durch P12 eingefuehrt. Fix (optionale Folge-Phase, analog P11s dokumentierter `attachOrHangup`-Notiz): einzelne Schritte in benannte Helper extrahieren, falls eine spaetere Phase ohnehin dort arbeitet; fuer eine reine Verschiebungsphase kein Fix gefordert.

**passNotes:** Diff ist eine verifiziert reine Verschiebung (siehe oben). Mount-Position unveraendert. Alle entfernten Imports 0 Restreferenzen, alle korrekt in `routes/mcp.js` wiederverwendet. `node --check` sauber. Volle Testsuite 2293/2293, keine Flakes. Neuer Test deckt eine echte, vorher fehlende Luecke ab, kein Duplikat. DI-Konvention konsistent mit P9/P11. Keine Secrets/PII, keine Magic Numbers, kein toter Code, keine abgeschalteten Sicherungen.

**topTodos:**
1. Nicht blockierend, fuer eine spaetere Phase vormerken: gemeinsamen 405-Response-Helper fuer GET/DELETE `/mcp` extrahieren (S3, vorbestehend).
2. Nicht blockierend: falls eine kuenftige Phase ohnehin in `routes/mcp.js` arbeitet, den POST-Handler in benannte Teilschritte zerlegen (Identity-Resolution, Server-Aufbau) — analog zur in P11 dokumentierten `attachOrHangup`-Folgearbeit (S4, vorbestehend).
3. Keine weiteren kritischen To-dos — Phase ist sauber genug zum Mergen.

---

## 5. Fix-Runden

Keine — es gab keine Blocker (S1/S2 leer), daher keine Fix-Runde noetig. Phase in einem Durchgang PASS.
