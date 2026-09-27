# Schnitt S4: Mandantentrennung unabhaengig von MULTI_TENANT

Blocker: P0-7 (Kategorie B), dazu GP-01/GP-02 aus `tasks/openai-audit/07-autorisierung-isolation.md` | Anforderungs-IDs: T-5, T-12 (eigene Autorisierungs-Policy hinter der Token-Pruefung), T-28 (Client-Hinweise nie fuer Autorisierung), O-19 (Durchsatzdecke je Nutzer) | Kategorie: B

## Ist-Zustand

Die Trennung haengt an **fuenf** Stellen am Flag `config.tenancy.multiTenant`, Default `false` (`src/config.js:1621`):

| # | Stelle | Flag AN | Flag AUS |
|---|---|---|---|
| 1 | `src/routes/_tenant.js:145` `if (!config.tenancy.multiTenant) return operatorChannelTenant(req);` | Aufloesung ueber `req.tenant` (:146) -> `internalTenant` (:150) -> `req.auth.sub` (:152) | ALLES davon verworfen; Loopback ohne XFF -> `BOOTSTRAP_TENANT_ID` (:98-99), extern -> `TENANT_REJECT` |
| 2 | `src/routes/api-read.js:70` `config.tenancy.multiTenant ? store.exportTenantData(tenantId) : s` | `GET /api/state` liefert `calls/actionItems/notifications` EINES Tenants (`tenantCallScope`, `src/store/state-ops.js:529-531`) | liefert den Roh-State ALLER Mandanten |
| 3 | `src/routes/api-read.js:105` `config.tenancy.multiTenant && !tenantOwnsCall(...)` | fremder Call -> 404 | fremder Call -> 200 inkl. Transkript-Projektion |
| 4 | `src/routes/api-calls.js:319` `callVisibleTo = Boolean(call) && (!config.tenancy.multiTenant \|\| tenantOwnsCall(call, tenantId))` | Besitzpruefung greift an `:586` (`GET .../consult`), `:619` (`POST .../consult/answer`), `:644` (`POST .../cancel`) | immer `true` -> fremdes Gespraech lesbar, beschreibbar (`call.context.key_facts`) und abbrechbar |
| 5 | `src/routes/mcp.js:61` `const scopedTenant = requestTenant(req)` | Wert wird als `X-Internal-Tenant` weitergereicht (`src/mcp-tools.js:59`) | derselbe Aufruf laeuft durch #1 und liefert am Gateway `TENANT_REJECT`; der interne Hop (`src/mcp-tools.js:56-66`, echtes Loopback ohne XFF, `src/wiring/internal-only.js:24-28`) faellt in #1 erneut und landet auf `BOOTSTRAP` — der am Tor aufgeloeste `reject` wird nie gelesen |

`/mcp` hat keinen Torschluss: `scopedTenant` wird geloggt (`src/routes/mcp.js:63-69`) und als Profil-Schluessel benutzt (`:76`), aber NIE gegen `TENANT_REJECT` geprueft; die Ablehnung faellt erst je Route (`src/routes/_tenant.js:171-177`).

Der Lookup dahinter ist global: `getCall` kennt kein Tenant-Argument (`src/store/state-ops.js:496-498`). Request-Pfad-Leser von `getCall` sind genau vier: `src/routes/api-read.js:99`, `src/routes/api-calls.js:584/618/643`. Die uebrigen elf Fundstellen sind Provider-/Lebenszyklus-Pfade (`src/routes/voice.js:192/311/610/683/736`, `src/telephony/call-termination.js:69`, `call-lifecycle.js:129/206/278`, `webhook-idempotenz.js:191/198`) — dort gibt es keinen Request-Tenant und darf keiner erzwungen werden.

**Herkunft des Flags (gefunden, nicht vermutet).** Eingefuehrt mit `9fd2670 feat(i4): resolveTenant-Seam ... + MULTI_TENANT-Flag (Default aus)` (16.06.2026) als **Rampe einer Phasenkette**, nicht als Sicherheitsentscheidung: der Kommentar an der Definition sagt es woertlich — "DEFAULT AUS (fail-closed): requestTenant === BOOTSTRAP_TENANT_ID -> Owner byte-identisch, kein Tenant-Scoping. Erst true (nach allen dichten Scope-Gates I5/I6/I7) loest die Auth-Achse den Request-Tenant auf" (`src/config.js:1616-1621`). Dasselbe Motiv an jeder Konsumstelle: "damit Legacy-Calls ohne tenantId bei Flag aus byte-identisch (200) bleiben" (`src/routes/api-read.js:102-104`), "aus -> ungefiltert wie im Bestand (byte-identisch)" (`:57-59`), "aus -> ungefiltert wie im Bestand (byte-identisch, auch fuer Calls ohne tenantId)" (`src/routes/api-calls.js:314-318`). Das Flag war die Rueckfahrkarte einer Umbaukette (I4-I7), die abgeschlossen ist. Die Kette hat ihre eigene Gegen-Praezedenz gesetzt: `takeInboxEntries` scopet UNKONDITIONAL, mit Begruendung im Code — "TENANT-SCOPE UNKONDITIONAL: tenantCallScope, OHNE das config.tenancy.multiTenant-Gate ... ein Gate, das keinen Fall deckt, waere nur eine Tuer" (`src/store/state-ops.js:816-819`).

**Live-Stand (gemessen 18.09.2026, read-only, unauthentifiziert):**

| Probe | Ergebnis | Schluss |
|---|---|---|
| `GET https://app.sundartha.com/api/self-service/state` | **401**, `content-type: application/json`, kein `www-authenticate` | Route ist GEMOUNTET |
| `GET https://app.sundartha.com/api/self-service/definitely-not-a-route` | 404, `content-type: text/html` | Gegenprobe: unbekannte Pfade sehen anders aus; das 401 ist kein Gate-Artefakt |
| `POST https://app.sundartha.com/mcp` | 401 | deckt `MCP_AUTH=oauth` (PLAN-SECURITY.md:2057-2058 misst dasselbe am 02.08.2026) |

Self-Service ist NUR gemountet, wenn `isSelfServiceLive(cfg) = selfServiceEnabled && multiTenant` wahr ist (`src/config.js:2435`, Mount `src/wiring/web-login.js:321-325`). Daraus folgt zwingend: **live ist `MULTI_TENANT=true`.** Das deckt sich mit `render.yaml:14-17` ("DASHBOARD-MANAGED ... autoDeploy/healthCheckPath/MULTI_TENANT/SELF_SERVICE weichen live ab" — der Blueprint-Wert `"false"` in `render.yaml:678-679` ist also ausdruecklich NICHT der Live-Wert). Damit ist Punkt 20 der Liste "nicht am Repo entscheidbar" (`tasks/OPENAI-MCP-READINESS.md:565`) beantwortet: P0-7 ist live **schlafend**, nicht wirksam. Gefaehrlich bleibt der Default — er gilt fuer jeden frischen Service, jeden Rollback, Staging und lokal.

**Testlage.** Alle Trennungsbeweise laufen mit `env: { MULTI_TENANT: "true" }` (`test/read-scope-tenant.test.js:113/142/174`, `test/i6-write-scope.test.js:39/80`, `test/am6-oauth-tenant.test.js:31`). `test/helpers.js:337` pinnt `MULTI_TENANT: "false"` in `BASE_ENV` — die gesamte Bestandssuite laeuft also im kollabierten Zustand, und drei Tests pinnen genau die zu beseitigende Eigenschaft als SOLL: `test/read-scope-tenant.test.js:199-223`, `test/api-read-parity.test.js:146-156` und `:281-295`, dazu `test/request-tenant-unit.test.js:234-248` ("Selbst mit gesetztem auth/tenant kurzschliesst der Flag-Check zuerst") und `:468-480` sowie `test/tenant-resolver-parity.test.js:119-127` (3x parametrisiert). Es gibt **keinen** Test, der die Trennung mit dem Default-Wert prueft.

## Soll-Zustand

1. `grep -rn "multiTenant" src/routes/` liefert **0** Treffer (heute 5, davon 1 Kommentar).
2. `requestTenant` loest die Identitaet in derselben Rangfolge auf, unabhaengig von jeder Env-Variable; ein identitaetsloser Request faellt weiterhin ueber `operatorChannelTenant` auf Bootstrap NUR fuer den vertrauenswuerdigen lokalen In-Process-Aufrufer.
3. Mit `MULTI_TENANT` nicht gesetzt (Default) sieht Tenant A weder Liste, noch Call, noch Consult, noch Cancel von Tenant B.
4. `POST /mcp` mit gueltigem Token, dessen `sub` keinem Tenant zugeordnet ist, endet mit HTTP 403 — vor `registerTools`, also ohne Werkzeugliste.
5. Der Default von `MULTI_TENANT` wird NICHT umgedreht (Begruendung unter Aenderungen, A0).

## Aenderungen

**A0 (Entscheidung, keine Code-Zeile): der Default wird nicht umgedreht, das Flag wird entkoppelt.**
Warum nicht flippen: (a) live ist der Wert schon `true` (Probe oben) — ein Flip aendert live nichts und beseitigt den Blocker nicht; (b) ein Flip laesst die Kopplung stehen, der Blocker ist danach exakt eine Env-Variable entfernt — genau der Befund; (c) `MULTI_TENANT=true` als Default wuerde `isSelfServiceLive` (`src/config.js:2435`) einen Faktor kosten, ohne dass Self-Service dadurch angeht (`SELF_SERVICE_ENABLED` bleibt `false`), also eine Nebenwirkung ohne Gegenwert. Nach A1-A4 steuert das Flag nur noch Self-Service-Reife (`config.js:2435`) und eine Achse des Konfig-Fingerprints (`src/config-fingerprint.js:30`). Ein **Boot-Riegel gegen `MULTI_TENANT=false`** (Empfehlung PP-D7-02/GP-01) wird NICHT gebaut: nach A1-A4 schwaecht der Wert nichts mehr, und ein fataler Boot-Refusal fuer einen harmlosen Wert widerspricht der Regel, die im Repo schon steht — "jeder Treffer dort ist FATAL - ein Not-Aus, der den Boot verweigert, ist kein Not-Aus" (`src/config.js:1941-1943`).

**A1 — `src/routes/_tenant.js`: Zeile 145 entfernen** (`if (!config.tenancy.multiTenant) return operatorChannelTenant(req);`), zusammen mit dem Rangfolge-Punkt (1) im Kommentarblock (`:130-135`) und dem A4-Kompat-Hinweis auf das Singleton (`:113-115`). `config` bleibt Parameter der Factory (andere Nutzung ist nicht vorhanden, aber der DI-Vertrag `makeTenantResolver({ store, config })` ist an mehreren Stellen verdrahtet — nicht anfassen).
Warum so: der identitaetslose Pfad bleibt vollstaendig erhalten, weil `:165` denselben `operatorChannelTenant(req)`-Aufruf traegt (`if (!req.auth && !internal) return operatorChannelTenant(req)`). Belegte Folge je Aufrufer: stdio-MCP (`src/mcp-server.js:26-28` uebergibt weder `identity` noch `scopedTenant` -> `src/mcp-tools.js:58-60` setzt keinen Header) und jedes `scripts/*` ueber Loopback bleiben auf Bootstrap — byte-identisch. Was sich aendert, ist genau der Missbrauchsfall: ein am Tor auf `reject` aufgeloester Wert (`src/routes/mcp.js:61`) wird auf dem internen Hop nicht mehr verworfen, und eine Browser-Session (`req.tenant`, gesetzt nur von `webAuthMiddleware`) wird nicht mehr zu Bootstrap heruntergebrochen.

**A2 — `src/routes/api-read.js:70`: unbedingt scopen.** `const scoped = store.exportTenantData(tenantId);`. Kommentar `:56-59` und `:102-104` entsprechend kuerzen (kein "Flag aus"-Fall mehr).
Warum so: `exportTenantData` liefert genau die drei Felder, die die Route aus `scoped` liest — `calls`, `actionItems`, `notifications` (`src/store/state-ops.js:583-593`); `settings`/`calendar`/`usage`/`agent` kommen unveraendert aus `tenantContext`/`usageOf`/`activeNumberFor` und sind schon tenant-gebunden. Kein neuer Store-Aufruf, keine neue Funktion.

**A3 — `src/routes/api-read.js:105` und `src/routes/api-calls.js:319`: Flag-Bedingung streichen.** `if (!tenantOwnsCall(call, requestTenant(req))) return res.status(404)...` bzw. `return Boolean(call) && tenantOwnsCall(call, tenantId);`.
Warum so und nicht als Datenzugriffsschicht (`getCallFor(tenantId, id)`, Empfehlung PP-D7-04): die vier Request-Pfad-Leser von `getCall` sind vollstaendig aufgezaehlt (Ist-Zustand) und werden durch A3 alle vier gedeckt; die elf uebrigen Fundstellen sind Provider-/Timer-Pfade, denen ein Tenant-Argument nur eine Pflicht-Luege beschaffen wuerde. Ein `getCall`-Export-Entzug kostet 15 Aufrufstellen und bringt an dieser Stelle **kein** zusaetzlich gedecktes Szenario. Der Rueckfall-Schutz kommt statt dessen aus A6 (Inventar-Test) — billiger und deckt auch kuenftige Routen.

**A4 — `src/routes/mcp.js`: Torschluss nach `const scopedTenant = requestTenant(req)` (`:61`).** Ist `scopedTenant === TENANT_REJECT`, dann `audit("auth_failed", req, "path=/mcp grund=kein_tenant")` (Muster `src/auth.js:102/108`) und `return res.status(403).json({ error: "Keine Tenant-Zuordnung fuer diese Identitaet." })` — derselbe Wortlaut wie `requireTenant` (`src/routes/_tenant.js:173`), damit es EINEN Text gibt. Steht VOR `new McpServer`/`registerTools` (`:89-102`).
Warum so: die Tenant-Autorisierung liegt heute auf N Routen verteilt; jede neue interne Route muss die Regel erneut mitbringen (GP-01). HTTP-Status statt JSON-RPC-Fehler, weil derselbe Endpunkt schon HTTP-Statuscodes ohne JSON-RPC-Huelle beantwortet (`src/auth.js:102-118` 401, `src/routes/mcp.js:128-130` 405). `TENANT_REJECT` ist aus `src/routes/_tenant.js` zu importieren (der Handler kennt heute nur `ANON_IDENTITY`) bzw. ueber das injizierte Resolver-Objekt zu fuehren — kein zweites Literal `"reject"`.

**A5 — neuer Test `test/s4-mandantentrennung-default.test.js`.** Spawn-Server OHNE `MULTI_TENANT` im `env`-Override (also mit `BASE_ENV`-Wert `"false"`, `test/helpers.js:337`), `MCP_AUTH=oauth`, zwei geseedete Tenants mit `idpSubject` (Muster `test/read-scope-tenant.test.js:113` + `test/am6-oauth-tenant.test.js:31`, Test-IdP-Helfer wiederverwenden). Faelle: (a) A sieht in `/api/state` nur eigene Calls; (b) `GET /api/calls/<B-id>` -> 404, ebenso ueber `twilioSid`; (c) `GET /api/calls/<B-id>/consult` -> 404; (d) `POST /api/calls/<B-id>/consult/answer` -> 404; (e) `POST /api/calls/<B-id>/cancel` -> 404; (f) Legacy-Call ohne `tenantId` ist fuer niemanden sichtbar; (g) Token mit unbekanntem `sub` -> `POST /mcp` 403 und keine Werkzeugliste.
Warum eigene Datei: der Beweis muss ohne Flag-Setzung gelten; ihn in die bestehenden Dateien zu haengen, wuerde die dortige "Flag an"-Aussage verwaessern. Kennung **nicht** mit Katalog-Praefix (`GAP-`/`PROMPT-`/`ABNAHME-`) beginnen, sonst wandert die Datei in den `test:gates`-Lauf, wo Rot erlaubt ist (Lehre `catalog-id-prefix-misroutes-tests`).

**A6 — Inventar-Test (Rueckfall-Riegel), in dieselbe Datei.** Liest `src/routes/api-read.js`, `src/routes/api-calls.js`, `src/routes/_tenant.js`, `src/routes/mcp.js` von Platte und behauptet `0` Vorkommen von `multiTenant`. Muster: `test/route-auth-inventory.test.js` (Datei-Inventar als Test ist Repo-Praxis).
Warum so: der Befund ist "Trennung an einem Env-Flag". Ein Test, der die Abwesenheit dieses Flags im Routen-Verzeichnis festnagelt, faengt den Rueckfall unabhaengig davon, welche Route ihn begeht.

**A7 — Bestandstests umschreiben (keine Assertion abschwaechen, alle invertieren):**

| Datei:Zeile | heute gepinnt | danach |
|---|---|---|
| `test/read-scope-tenant.test.js:199-223` | "Flag aus: Legacy-Call OHNE tenantId bleibt sichtbar ... /api/calls/:id = 200" | Legacy-Call unsichtbar, `/api/calls/:id` -> 404 |
| `test/api-read-parity.test.js:146-156` | `body.calls.length === 2` ("Flag aus -> ungefilterte Bestandsliste") | `=== 1` (nur der Bootstrap-Call) |
| `test/api-read-parity.test.js:281-295` | "Flag aus: fremder Call -> 200" | 404 |
| `test/request-tenant-unit.test.js:234-248` | "Selbst mit gesetztem auth/tenant kurzschliesst der Flag-Check zuerst"; `store.calls` leer | `auth.sub` -> abgeleiteter Tenant, `req.tenant` -> dessen `tenantId`; Lookup findet statt |
| `test/request-tenant-unit.test.js:468-480` | `requireTenant` mit `tenant:{tenantId:"B"}` -> `BOOTSTRAP` | -> `"B"`, kein 403 |
| `test/tenant-resolver-parity.test.js:119-127` (3x, je Factory) | "Flag aus -> Owner (byte-identisch, kein Lookup)" | Flag-Achse entfaellt; Fall wird zu "bekannter sub -> tenantId, unabhaengig vom Flag" (der `withMultiTenant`-Helfer `:26-33` bleibt fuer die uebrigen Faelle) |

`test/auth-p3-bootstrap-fallback.test.js` AUTH-P3-4/-5/-8 (`:119/:128/:164`) bleiben gruen: sie fahren den identitaetslosen Pfad, der ueber `:165` unveraendert auf `operatorChannelTenant` laeuft. `test/api-read-parity.test.js:224-241` (Slice-Grenzen, `multiTenant:false`) bleibt voraussichtlich gruen, weil der Mock-Store `exportTenantData` mit Listen derselben Laenge liefert (`:72-76`) — im Lauf bestaetigen, nicht annehmen.

**A8 — Doku.** `PLAN-SECURITY.md`: Eintrag "S4 — Mandantentrennung vom Flag entkoppelt" mit dem Satz, dass RLS keine Anfrage-Grenze ist (`src/store/pg.js:974-991` hydriert alle Mandanten in EINEN Spiegel, `:200`/`:210` lesen nur diesen) und die Anwendungs-Filterung ab jetzt die einzige, unbedingte Grenze. `.env.example:312-315` und `render.yaml:677-679`: Kommentar korrigieren — `MULTI_TENANT` steuert kein Tenant-Scoping mehr, nur noch Self-Service-Reife. Pflicht nach CLAUDE.md ("Bei sicherheitsrelevanten Aenderungen: PLAN-SECURITY.md aktualisieren").

## Erwartungsergebnis und Verifikation

| Aenderung | deterministisches Erwartungsergebnis | Verifikationsbefehl/Testdatei |
|---|---|---|
| A1 | `requestTenant` mit `auth.sub` eines geseedeten Tenants liefert dessen `tenantId`, auch wenn `MULTI_TENANT` ungesetzt ist; identitaetsloser Loopback-Request ohne XFF liefert weiter `BOOTSTRAP_TENANT_ID` | `NODE_ENV=test node --test test/request-tenant-unit.test.js test/tenant-resolver-parity.test.js test/auth-p3-bootstrap-fallback.test.js` |
| A2 | Server ohne `MULTI_TENANT`-Override, zwei Tenants geseedet: `GET /api/state` als A enthaelt keine `call.id` von B; ein Call ohne `tenantId` erscheint in keiner der beiden Antworten | `test/s4-mandantentrennung-default.test.js` Faelle (a)/(f) |
| A3 | Ohne `MULTI_TENANT`-Override: `GET /api/calls/<B-id>` = 404, `GET /api/calls/<B-twilioSid>` = 404, `GET /api/calls/<B-id>/consult` = 404, `POST /api/calls/<B-id>/consult/answer` = 404, `POST /api/calls/<B-id>/cancel` = 404; B's Datensatz bleibt unveraendert (`context.key_facts` unberuehrt, `status` weiter `active`) | `test/s4-mandantentrennung-default.test.js` Faelle (b)-(e) |
| A4 | `POST /mcp` mit gueltig signiertem Token, dessen `sub` kein Tenant traegt: HTTP 403, Body `{"error":"Keine Tenant-Zuordnung fuer diese Identitaet."}`, Antwort enthaelt kein `"tools"`; derselbe Request mit bekanntem `sub`: 200 | `test/s4-mandantentrennung-default.test.js` Fall (g) |
| A6 | `grep -c multiTenant` ueber `src/routes/*.js` = 0 | `test/s4-mandantentrennung-default.test.js` Inventar-Fall; Gegenprobe von Hand: `grep -rn "multiTenant" src/routes/` |
| A1-A7 gesamt | Suite gruen, Zahl der Tests >= Vorlauf (kein stiller Verlust) | `npm test -- --test-concurrency=4` (Parallelitaets-Rennen ohne diesen Flag, Lehre `sec-testbank-parallel-race`), davor Baseline-Lauf auf `master` zum Vergleich |
| Syntax | 0 Ausgabe | `for f in src/routes/_tenant.js src/routes/api-read.js src/routes/api-calls.js src/routes/mcp.js; do node --check "$f"; done` |
| Smoke (lokal, ohne echten Anruf) | `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start`, dann `curl -s localhost:3999/healthz` = 200 und `curl -s localhost:3999/api/state` liefert 200 mit den Bootstrap-Listen (Loopback ohne XFF -> Betreiber-Kanal unveraendert) | manuell, Ergebnis im Phasen-Report |
| Live nach Deploy | `GET https://app.sundartha.com/api/self-service/state` weiter 401 (Self-Service unveraendert gemountet), `POST /mcp` ohne Token weiter 401 | dieselben zwei `curl`-Proben wie oben, read-only |

## Blast Radius

- **Dateien:** 4 Quelldateien (`src/routes/_tenant.js`, `api-read.js`, `api-calls.js`, `mcp.js`), 5 Code-Stellen + 1 Torschluss; 4 Testdateien angepasst (7 Faelle, davon 3 parametrisiert), 1 Testdatei neu; 3 Doku-Dateien.
- **Aufrufer von `requestTenant`/`requireTenant`** (die Menge, die A1 beruehrt): `src/routes/api-read.js`, `api-calls.js`, `api-tenant-write.js`, `api-billing.js`, `api-inbox.js`, `routes/mcp.js`, `src/telephony/outbound-gates.js:680`. Wirkung in der Gate-Kette: `ctx.tenantId` ist nicht mehr per Flag auf Bootstrap gepinnt, damit feuert `tenant_reject` (`outbound-gates.js:687-696`) erstmals auch bei ungesetztem Flag, und Stundendecke (`:364-369`), Pro-Ziel-Cap (`:374-378`), Kostendecke (`:875-877`) und Reserve (`:907`) zaehlen auf die echte Achse statt auf eine gemeinsame. Das ist Verschaerfung, nicht Lockerung — kein Gate wird entfernt oder umgangen.
- **Was kaputtgehen KANN, mit Gegenmassnahme:**
  1. **Ein MCP-Aufrufer ohne Tenant wird sichtbar abgewiesen statt still auf den Owner zu fallen.** Das ist der Zweck; betrieblich heisst es: `MCP_AUTH` != `oauth` schaltet den Connector tot (kein `req.auth` -> extern -> `TENANT_REJECT`). Das ist heute schon so dokumentiert (PLAN-SECURITY.md:2098-2100, AUTH-P3-Restrisiko 2) und live nicht der Fall (`MCP_AUTH=oauth` gemessen).
  2. **Lokale Entwicklung ueber die LAN-IP** (nicht Loopback) verliert den Bootstrap-Fallback — galt aber schon vor A1 fuer jeden Request mit XFF (Lehre `local-loopback-bypasses-auth-gate`). Smoke-Tests ueber `localhost` fahren, wie bisher.
  3. **Ein geseedeter Store ohne `idpSubject` am Bootstrap-Tenant** liefert nach A1 fuer den OAuth-`sub` `TENANT_REJECT` statt Bootstrap. Live gedeckt durch `OWNER_IDP_SUBJECT` (`render.yaml:363-366`, Seed-Weg) und durch das gemessene Live-`MULTI_TENANT=true`, unter dem genau dieser Pfad heute schon laeuft. In Tests: Seed mit `idpSubject` (Muster `test/am6-oauth-tenant.test.js`).
  4. **`test/helpers.js:337` (`MULTI_TENANT: "false"` in `BASE_ENV`) bleibt stehen** — nach A1-A3 ist der Wert fuer die Trennung bedeutungslos, die Zeile schuetzt aber weiter gegen `.env`-Leak in Spawn-Tests (Lehre `test-base-env-drift`). Nicht entfernen.
  5. Die ~40 Tests, die `MULTI_TENANT: "true"` explizit setzen, bleiben gruen (der Wert wird fuer die Trennung nur noch nicht mehr gelesen); sie werden NICHT im Zuge dieses Schnitts entruempelt (Scope).
- **Flags/Live-Konfiguration:** kein neuer Env-Schluessel, keine Aenderung eines Live-Werts, keine DB-Aenderung, kein Backfill (Begruendung unten), keine neue Dependency, kein neuer Endpunkt, keine Aenderung an `src/route-policy.js` (`/mcp` bleibt in der Oeffentlich-Liste, die Auth-Lage aendert sich nicht — sie wird strenger).
- **Backfill: nicht noetig, zweifach belegt.** (1) Live ist `MULTI_TENANT=true` (Probe oben), die Filterung laeuft dort also schon — ein Call ohne `tenantId` ist heute bereits unsichtbar; A2/A3 machen den Default gleich, nicht die Live-Semantik. (2) Die dokumentierte Praemisse "alle aktiven Accounts sind wir selbst" (`PLAN-SECURITY.md:3586-3590`) traegt zusaetzlich: es gibt keinen fremden Datenbestand, dem etwas verloren gehen koennte. **UNKNOWN:** die exakte Tenant-/Call-Zahl in der Produktions-DB wurde fuer dieses Spec nicht gelesen; sie aendert die Aussage nicht, weil beide Zustaende (vorher live / nachher) dieselbe Filterung fahren.
- **Nicht behoben und ausdruecklich benannt (ausserhalb dieses Schnitts):** RLS ist keine Anfrage-Grenze (`src/store/pg.js:974-991`, P1-20); `newId` nutzt `Math.random` (`src/store/state-ops.js:195-197`, P1/P2); `call_id` wird roh in die interne URL interpoliert (`src/mcp-tools.js:880/882/934/971/1023/1061`, P2); ein Prozess auf demselben Host kann `X-Internal-Tenant` auf `/mcp` setzen, weil `trustedLocalHeader` ihn von jedem Loopback-Aufrufer ohne XFF annimmt (`src/routes/_tenant.js:54-58`) — Topologie-Annahme, unveraendert durch diesen Schnitt (PP-D7-08).

## Beruehrte absolute Regeln

- **Regel 1 (Safety-Gates):** beruehrt, ausschliesslich verschaerfend. Die pro-Tenant-Kostendecke, das Stundenlimit, der Pro-Ziel-Cap und die Reserve rechnen nach A1 auf der echten Tenant-Achse statt auf einer gemeinsamen Bootstrap-Achse (`src/telephony/outbound-gates.js:364-378/875-877/907`); `tenant_reject` (`:687-696`) wird erstmals unabhaengig vom Flag wirksam. Kein Gate wird entfernt, aufgeweicht oder per Default umgangen.
- **Regel 3 (Auth fail-closed):** beruehrt, verschaerfend. A4 fuegt einen Torschluss hinzu, kein neuer Endpunkt, keine neue Ausnahme; `src/route-policy.js` bleibt unveraendert.
- **Regel 6 (Scope):** eingehalten — kein Rename und keine Entfernung des Env-Schluessels, kein Umbau der Store-Schicht, keine Entruempelung fremder Tests.
- **Keine Aufweichung geplant.** Regel 2 (Offenlegung), 4 (Secrets), 5 (kein Audio ueber MCP), 7 (Debug) unberuehrt.

## Abhaengigkeiten

- **Keine Vorbedingung aus einem anderen Schnitt.** A1-A6 sind code-lokal und einzeln mergefaehig; der Schnitt setzt keinen anderen voraus.
- **Auf den Auth-Schnitt (MCP_AUTH=oauth verbindlich, P0-3/P0-8) wirkt dieser Schnitt zurueck:** nach A1/A4 ist der Token-Modus fuer `/mcp` nicht mehr "alles als Owner", sondern tot. Wer dort einen Boot-Riegel gegen `MCP_AUTH != oauth` baut, baut die passende Haerte; wer den Token-Modus wiederbeleben will, muss eine Identitaet daraus ableiten (heute setzt `src/auth.js:104-112` kein `req.auth`).
- **Auf T-15 (Mixed Auth: `initialize`/`tools/list` ohne Auth) wirkt A4 zurueck:** wird `/mcp` je teil-unauthentifiziert, darf der Tenant-Torschluss nicht am POST haengen, sondern muss vor `tools/call` stehen. Diese Regel gehoert in den Protokoll-Schnitt, nicht hierher.
- **Owner-Entscheidung, nicht Teil dieses Schnitts:** ob `MULTI_TENANT` danach umbenannt (z.B. `SELF_SERVICE_TENANT_AXIS`) oder entfernt wird. Praezedenz und Formulierung stehen in CLAUDE.md zu `SKIP_TWILIO_SIGNATURE_CHECK`: "Ein Rename ist eine eigene Entscheidung." Kosten einer Entfernung, falls entschieden: `src/config.js:1621/2265/2435`, `src/config-fingerprint.js:30`, `test/gap-36-healthz-fingerprint.test.js:84/102`, `test/config-self-service-live.test.js` (5 Faelle), `test/helpers.js:337`, `render.yaml:677-679`, `.env.example:312-315` — plus ein einmal geaenderter `/healthz`-Fingerprint.
- **Betrieblich:** der Deploy laeuft ueber den Upstream (Memory `deploy-repo-split`); `git push origin` macht nichts live.

## Offene Fragen

1. Soll nach diesem Schnitt ein neuer OAuth-`sub` ohne Tenant ueber `/mcp` automatisch provisioniert werden, oder bleibt 403 mit Verweis auf das Web-Onboarding? Heute liefert `resolveTenant` fuer unbekannte `sub` `null` -> `TENANT_REJECT` (`src/store/state-ops.js:5287-5296`); A4 macht das nur frueher und deutlicher sichtbar. Produktfrage, keine Code-Aussage — und fuer eine oeffentliche ChatGPT-Integration die wahrscheinlich naechste, die beantwortet werden muss.
2. Exakte Tenant-/Call-Zahl in der Produktions-DB (UNKNOWN, s. Blast Radius). Wenn der Owner sie vor dem Merge sehen will: read-only ueber `psql "$(cat ~/.config/hermes/db-url)"` mit gesetztem `app.current_tenant` (FORCE-RLS, Memory `hermes-db-forensik`) — nicht Teil der Umsetzung.
3. Der Live-Wert von `MULTI_TENANT` ist hier indirekt belegt (Self-Service-Mount), nicht direkt gelesen. Wer Gewissheit will, liest ihn im Render-Dashboard; die Ableitung waere nur falsch, wenn `isSelfServiceLive` live anders aussaehe als im Repo-Code.

## Pre-Mortem

Geprueft am Code, Stand `master` d054c95 (18.09.2026). Die Bestandsbehauptungen des Specs
tragen: die fuenf Flag-Stellen (`src/config.js:1621`, `src/routes/_tenant.js:145`,
`api-read.js:70/105`, `api-calls.js:319`), die vier Request-Pfad-Leser von `getCall`
(`api-read.js:99`, `api-calls.js:584/618/643`), `getCall` ohne Tenant-Argument
(`state-ops.js:496-498`), `exportTenantData` mit genau den drei gelesenen Feldern
(`state-ops.js:583-593`), der unkonditionale Inbox-Scope (`state-ops.js:816-819`),
`test/helpers.js:337`, die vier zu invertierenden Teststellen.

Zwei Praezisierungen am Ist-Zustand, gleiche Schlussfolgerung: (a) `BOOTSTRAP_TENANT_ID`
ist der String `"owner"` (`src/store/defaults.js:15`) und damit truthy, also setzt der
interne Hop den Header IMMER (`mcp-tools.js:59`) — bei Flag aus mit dem Wert `"reject"`
fuer externe Aufrufer; verworfen wird er erst eine Zeile spaeter durch `_tenant.js:145`.
(b) `/api/state` und die drei Call-Routen sind `internalOnly` (`wiring/internal-only.js:24-28`),
`apps/web` ruft keine davon — der EINE erreichbare Weg in den Leck-Pfad ist `/mcp`.
Das macht A4 nicht nebensaechlich, sondern zum Kern des Schnitts.

### PM-1 — Der live verbundene Connector ist tot (schwerste Folge, offen)

A4 + A1 -> extern kommt jeder `/mcp`-Request mit `X-Forwarded-For`, also ist
`isTrustedLocalCaller` false (`_tenant.js:44`) und `operatorChannelTenant` liefert
`TENANT_REJECT` (`:99`), sobald kein `req.auth` existiert. `req.auth` setzt AUSSCHLIESSLICH
`verifyOauth` (`src/auth.js:85`); die Modi `token`, Legacy `""` und `off` lassen durch,
ohne eine Identitaet zu setzen (`src/auth.js:96-118`) -> A4 antwortet 403 auf JEDEM
`/mcp`-Request -> Schaden: kein Werkzeug mehr, `check_inbox` inklusive; der Owner erfaehrt
von keinem Anruf.
Deckung: **OFFEN**, und der Beleg des Specs traegt nicht. Zeile 29 liest aus `POST /mcp`
= 401 den Modus `oauth` ab — `mcpAuth` antwortet aber in JEDEM Modus 401 ohne Token:
oauth ueber `deny401` (`auth.js:63-71`, Body `Kein Token`, Header `WWW-Authenticate`),
token/legacy ueber `auth.js:103/110/114` (Body `unauthorized`, KEIN `WWW-Authenticate`).
Der Status unterscheidet die Modi nicht, Body und Header tun es. Das Spec nennt den
Ausfall betrieblich (Blast Radius 1), stuetzt sein "live nicht der Fall" aber auf diese
nicht-unterscheidende Probe.

### PM-2 — Das Leck bleibt offen, der Riegel-Test ist gruen (offen)

Spec Zeile 118 erklaert A1-A6 fuer "einzeln mergefaehig". Wird A2+A3 ohne A1 gemergt,
liefert `requestTenant` am internen Hop weiter BOOTSTRAP (`_tenant.js:145`), A2 scopet
also auf `"owner"`, A3 vergleicht gegen `"owner"` -> jeder gueltige Token sieht weiter
die Calls und Transkripte des Owner-Tenants — waehrend A6 gruen meldet, weil `multiTenant`
aus den Routen verschwunden ist. Umgekehrt liefert A1 ohne A2 an einen jetzt korrekt
aufgeloesten Fremd-Tenant weiter den ungefilterten `s` (`api-read.js:70`).
Schaden: Transkript-Leck bleibt, mit Gruen-Signal. Deckung: **OFFEN** — das Spec behauptet
das Gegenteil. A1+A2+A3 sind EIN Commit; A6 ist kein Beweis, weil er ohne A1 erfuellbar ist.

### PM-3 — Der Offenlegungssatz entfaellt, wo er vorher fiel (offen, Regel 2)

A1 -> `ctx.tenantId = requestTenant(ctx.req)` (`outbound-gates.js:680`) ist nicht mehr auf
BOOTSTRAP gepinnt -> `resolveCallPrivacyFlags` fuettert genau diesen Wert in
`ownerSelfCallGranted` (`api-calls.js:204-212`) und in `tenantPrivateNumber(ctx.tenantId)`
(`:197`). In jeder Umgebung, deren `OWNER_SELF_CALL_TENANT_IDS` eine ECHTE tenantId nennt,
war die Ausnahme bei Flag aus strukturell inert (tenantId immer `"owner"`,
`tenantDarfAusloesen` false, `callee-is-owner.js:60-64`) und wird durch A1 erstmals scharf:
der Anruf spricht den verkuerzten Owner-Satz. Umgekehrt faellt sie fuer eine auf `"owner"`
gepinnte Liste weg.
Schaden: ein Dritter am Apparat hoert nicht den vollen Pflichtsatz (Art. 50), oder der
Owner hoert ihn ploetzlich doch. Deckung: **OFFEN** — Spec Zeile 114 nennt Regel 2
ausdruecklich "unberuehrt". Die Ausnahme bleibt innerhalb ihrer Owner-Bedingungen, aber
welche tenantId das Praedikat SIEHT, aendert dieser Schnitt.

### PM-4 — Roh-Transkripte ueberleben at rest (offen)

Dieselbe Zeile -> `diagnosticRetentionGranted({ to, ownNumber: tenantPrivateNumber(ctx.tenantId) })`
(`api-calls.js:197-203`) haengt BEWUSST nicht an der Allowlist und nicht am
Offenlegungsschalter (`diagnostic-retention.js:55-67`) -> nach A1 entscheidet die vom
Tenant selbst gesetzte, NICHT eigentums-verifizierte Nummer (`state-ops.js:2127-2136`,
setzbar von jedem eingeloggten Tenant, `self-service-routes.js:501`), ob das Roh-Transkript
den Summary-Abschluss ueberlebt (`keepsTranscriptForDiagnosis`, `diagnostic-retention.js:70-73`).
Schaden: wer eine fremde Nummer eintraegt und sie anruft, konserviert das Roh-Transkript
eines Dritten at rest und liest es ueber den eigenen Art.-15-Export. Deckung: **OFFEN** —
im Spec nicht erwaehnt.

### PM-5 — Aggregierte Kosten ohne Plattform-Bremse (teilweise gedeckt)

A1 -> Stundenlimit, Pro-Ziel-Cap, Kostendecke und Reserve rechnen je Tenant
(`outbound-gates.js:364-378/875-877/907`); ein Tenant ohne Budget-Zeile faellt auf die
Default-Decke bzw. den Plattform-Cap (`state-ops.js` `effectiveCapCents`) — fail-open ist
das nicht.
Aber: das Aggregat ist N x Tenant-Decke, und die Plattform-Achse ist seit E10 nur noch
Beobachtung (CLAUDE.md). Der einzige Aggregat-Bremsklotz bleibt Abo+KYC vor Outbound.
Schaden: Kostenweglauf ueber die Breite statt ueber die Tiefe. Deckung: **TEILWEISE** —
Zeile 98/111 wertet das einseitig als "Verschaerfung, nicht Lockerung". Pro Tenant stimmt
das; gegenueber dem geteilten Bootstrap-Topf ist es eine Lockerung und gehoert als
akzeptiertes Risiko benannt.

### PM-6 — 200 mit leeren Listen statt "nicht autorisiert" (offen)

A1+A2 -> `/api/state` ruft `requestTenant`, NICHT `requireTenant` (`api-read.js:64`). Mit
`TENANT_REJECT` antwortet die Route 200 mit `exportTenantData("reject")` (leer) und
`tenantContext("reject")`, wobei `settingsFor` per `||=` einen `reject`-Settings-Bucket im
Spiegel anlegt (`state-ops.js` `settingsFor`).
Schaden: ein Owner, dessen `sub` gewechselt hat (Memory `tenant-number-proliferation`),
sieht eine leere, gesunde Antwort und liest sie als "keine Anrufe" — stiller Ausfall statt
Fehler. Der Bucket wird nicht persistiert (`flush` iteriert `state.tenants`, `pg.js:1770`),
bleibt aber Spiegel-Muell. Deckung: **OFFEN**; inkonsistent zu `/api/tenant-data/export:120`,
das an derselben Stelle `requireTenant` (403) nutzt.

### PM-7 — Bestandsanrufe verschwinden (teilweise gedeckt)

A2/A3 -> ein Call ohne `tenantId` ist fuer NIEMANDEN mehr sichtbar (Spec Fall (f), gewollt).
Die Unbedenklichkeit haengt vollstaendig an der Annahme, live laufe schon `MULTI_TENANT=true`
(Zeile 106). Ist die falsch, ist A2 der Moment, in dem Bestandsanrufe aus `/api/state`
und `/api/calls/:id` verschwinden — ohne Fehler, ohne Log. Inbound legt heute immer eine
`tenantId` an (aus dem Nummern-Record, `routes/voice.js:549-562/592`), der Verlustfall ist
also rein historisch — aber er ist nicht gezaehlt. Deckung: **TEILWEISE**, UNKNOWN bleibt
UNKNOWN.

### Unbelegte Annahme ueber den Live-Zustand

Der Live-Beweis fuer `MULTI_TENANT=true` ist eine Ableitung aus dem Self-Service-Mount
(`config.js:2435`, `wiring/web-login.js:321-325`) — schluessig, aber indirekt, und Zeile 106
(Backfill) sowie Zeile 31 ("live schlafend") haengen daran. Es gibt einen direkten,
falsifizierbaren Beleg, den das Spec nicht nutzt: `/healthz` liefert `configHash`
(`app.js:155-157`), und `config.tenancy.multiTenant` IST eine der sieben Achsen
(`config-fingerprint.js:25-35`). Der Hash laesst sich lokal fuer beide Kandidatenwerte
nachrechnen und gegen live vergleichen — ohne Dashboard, read-only. `MCP_AUTH` ist gar
nicht belegt (PM-1).

### Verifikation, die auch bei kaputtem Code gruen ist

Zeile 93 ("Live nach Deploy: `/mcp` ohne Token weiter 401") waere auch dann gruen, wenn A4
jeden AUTHENTIFIZIERTEN Request 403t — genau der Ausfall aus PM-1. Die Probe prueft die
Abwesenheit von Auth, nicht die Anwesenheit von Funktion. Es fehlt eine Positiv-Kontrolle
am Live-System. Dasselbe Muster bei A6: ein String-Grep, der nichts findet, ist von einem
Grep, der nichts sucht, nicht unterscheidbar (Lehre `pruefkommando-ohne-positiv-kontrolle`),
und er deckt nur vier feste Pfade, waehrend Soll-Zustand 1 das ganze Verzeichnis behauptet.

### Mergefaehigkeit in einer Phase

Der Schnitt ist in EINER Phase mergefaehig, aber NICHT in der vom Spec behaupteten
Zerlegung: jede Teilmenge von {A1, A2, A3} erzeugt einen Zwischenzustand, in dem das Leck
offen ist (PM-2). Zusaetzlich ist A1 nicht ganz code-lokal: nach A1 liest der Factory-Body
`config` nicht mehr, damit sind Parameter und `defaultConfig`-Import toter Code
(`_tenant.js:15/116`), was CLAUDE.md verbietet; ihre Entfernung beruehrt `makeRequestTenant`
(`:209`), `test/tenant-resolver-parity.test.js:72-110` und den `withMultiTenant`-Helfer.

### Nachzubessern im Spec

1. `MCP_AUTH` live belegen, VOR dem Merge, falsifizierbar: `curl -si -X POST https://app.sundartha.com/mcp`.
   Body `{"error":"Kein Token"}` PLUS Header `WWW-Authenticate: Bearer resource_metadata=...`
   beweist `oauth` (`auth.js:63-71`); Body `{"error":"unauthorized"}` ohne diesen Header
   beweist `token`/Legacy (`auth.js:103/110`). Ist es nicht `oauth`, ist A4 Merge-Blocker
   und die Modus-Umstellung ist eine Owner-Entscheidung, die VORHER steht.
2. `MULTI_TENANT` live direkt belegen statt ableiten: `configHash` von `/healthz` gegen die
   lokal nachgerechneten sieben Achsen fuer beide Kandidatenwerte (`config-fingerprint.js:25-35`).
   Ergebnis ins Spec — Backfill-Begruendung (Zeile 106) und "live schlafend" (Zeile 31)
   haengen daran.
3. A1+A2+A3 als EINEN Commit deklarieren und "einzeln mergefaehig" (Zeile 118) streichen.
   A6 ausdruecklich als NICHT-Beweis markieren: der Inventar-Test ist ohne A1 erfuellbar.
4. A6 auf alle `src/routes/*.js` ausweiten (wie Soll-Zustand 1 formuliert) statt auf vier
   feste Pfade, plus Positiv-Kontrolle: der Test muss auf einer praeparierten Zeichenkette
   anschlagen.
5. Abschnitt "Beruehrte absolute Regeln" um **Regel 2** ergaenzen (PM-3): A1 aendert die
   tenantId-Eingabe von `ownerSelfCallGranted` (`api-calls.js:204-212`). Pflicht: Live-Werte
   von `OWNER_SELF_CALL_ENABLED` und `OWNER_SELF_CALL_TENANT_IDS` im Spec nennen und beide
   Richtungen ausschliessen (inert->scharf, scharf->inert). Testfall: gepinnte ECHTE
   tenantId + `MULTI_TENANT` ungesetzt -> `call.calleeIsOwner` am Datensatz wie erwartet.
6. Eigener Aenderungspunkt fuer die Diagnose-Retention (PM-4): Erwartungsergebnis
   "Tenant B ruft die eigene hinterlegte Nummer an -> `call.diagnostic === true` fuer B und
   NICHT mehr fuer den Owner-Tenant", Verifikation als Testfall. Ist das nicht gewollt, ist
   es eine Owner-Entscheidung, keine Nebenwirkung.
7. Zeile 98/111 umformulieren: "Verschaerfung" gilt pro Tenant. Im Aggregat ist N x
   Tenant-Decke ohne Plattform-Sperre (E10) eine Lockerung gegenueber dem geteilten
   Bootstrap-Topf — als akzeptiertes Risiko mit dem verbleibenden Bremsklotz (Abo+KYC,
   `MAX_NUMBERS`/`MAX_NUMBERS_PER_TENANT`) benennen.
8. Live-Verifikation um eine Positiv-Kontrolle ergaenzen: nach dem Deploy EIN echter
   Werkzeugaufruf aus dem verbundenen Client (`get_my_number` oder `check_inbox`) mit
   erwartetem Inhalt; erst dann gilt A4 als belegt. Rollback-Kriterium hinschreiben.
9. `/api/state` entscheiden (PM-6): entweder auf `requireTenant` umstellen (403, konsistent
   mit `api-read.js:120`) oder den 200-mit-leeren-Listen-Fall samt `reject`-Bucket
   ausdruecklich als akzeptiert festhalten — nicht schweigen.
10. A1 muss sagen, was aus dem dann unbenutzten `config`-Parameter und dem
    `defaultConfig`-Import wird (`_tenant.js:15/116`): behalten heisst toter Code
    (CLAUDE.md), entfernen beruehrt `makeRequestTenant` (`:209`) und
    `test/tenant-resolver-parity.test.js:72-110`. Entscheidung + Verifikation ins Spec.
11. Das UNKNOWN in Zeile 106 mit der RICHTIGEN Zahl schliessen, nicht mit der Gesamtzahl:
    read-only `SELECT count(*) FROM calls WHERE tenant_id IS NULL` (RLS-Gotcha
    `hermes-db-forensik`). Das ist die Menge, die A2/A3 unsichtbar machen (PM-7).
