# Clean-Code-Audit — src/ (Hermes-Backend)

**Datum:** unbekannt
**Scope:** `src/` (Produkt-Backend), 130 `.js`-Dateien, ~20.613 LOC gesamt
**Methodik:** Breite Metrik-Erhebung ueber alle 130 Dateien (LOC, Fan-in, Verschachtelungstiefe, Funktionslaenge, externe Dependencies). Darauf aufbauend 47 der 130 Dateien per Sonnet tief auditiert (Zeile-fuer-Zeile gegen die Clean-Code-Rubrik `.claude/refs/clean-code.md`), jeder S1/S2-Fund adversarial verifiziert (Gegenpruefung von Code, Tests, Git-Historie, Aufrufern — kein Fund wird ungeprueft uebernommen). Zusaetzlich vier Querschnitts-Linsen ueber den gesamten Baum: Kopplung & Aenderungslokalitaet, Duplizierung, Abhaengigkeiten (extern + DIP), Erweiterbarkeit (OCP/DIP). Die restlichen 83 Dateien wurden nur gemessen, nicht tief geprueft (siehe Abschnitt 8).

---

## 1. Gesamtbewertung

**Ampel: GELB.** Solides, mehrfach refaktoriertes Fundament (Ports/Adapter, Provider-Registry, schlanke externe Dependencies) — aber echte Korrektheits-/Geld-Risiken in kritischen Pfaden und eine duenne Testdecke genau an den Stellen, wo sie am meisten zaehlt.

**(a) Einfach zu verstehen — Mittel bis schwach.**
Kernmodule sind gross und dicht: `store/state-ops.js` (1702 Zeilen, 105 Exporte), `store/pg.js` (1376), `config.js` (870), `web-auth.js` (845, Tiefe ~9). Funktionslaenge reisst wiederholt die selbstgesetzte Obergrenze von 100 Zeilen (`agentTurn` 115, `registerTools` 364, `handleChatCompletion` 176, `wireWebLogin` 156). Verstaerkt wird das durch Dutzende Kommentare mit internen Phasen-/Ticket-Kuerzeln (`P4.5`, `afix-p2/R2`, `AC7`, `stab-p9`, `BK0`) direkt im Code (C1-Funde in praktisch jeder tief geprueften Datei) — ohne Zugriff auf externe Planungsdokumente sind diese fuer eine neue Leserin nicht aufloesbar.

**(b) Wenige Abhaengigkeiten — Stark.**
Nur 9 externe Packages, jeweils sauber auf einen Adapter begrenzt (`twilio` nur in den Twilio-Adaptern, `ws` nur in `bridge.js`, `jose` nur in `auth.js`, `zod` nur in `mcp-tools.js`, `@anthropic-ai/sdk` nur hinter dem `llm.js`-Seam). Stripe laeuft bewusst ueber rohes `fetch()` statt SDK, der Geo-Adapter verzichtet bewusst auf eine `maxmind`-Dependency. Ports-Dateien (`telephony/ports.js`, `billing/ports.js`, `queue/ports.js`, `ui/ports.js`) sind reine Vertraege ohne Laufzeit-Code.

**(c) Leicht aenderbar / neue Features — Mittel.**
Die Ports/Registry-Architektur (Provider-Dispatch, Billing-Port, Queue-Port) traegt neue Features gut. Dagegen ziehen mehrere Hub-Module (`store/defaults.js` Fan-in 32, `config.js` Fan-in 25, `store/state-ops.js` Fan-in 14 bei 105 Exporten ueber 8+ Fachdomaenen) jede Aenderung durch denselben Datei-Kontext. Sechs von sieben Provider-Dispatch-Funktionen in `telephony/registry.js` liefern bei unbekanntem Provider still den Twilio-Adapter statt zu werfen — nur `numberProvisioning` ist fail-closed; ein neuer dritter Provider (laut Memory geplant) muesste an sechs Stellen einzeln nachgezogen werden statt an einer Tabelle.

**(d) Aenderungslokalitaet ("hier aendern bricht nicht dort") — Schwach, groesster Schwachpunkt.**
Mehrere zentrale Invarianten sind nur per Kommentar/Konvention gesichert, nicht strukturell: `withStoreLock`-Reentrancy (ein Verstoss wuerde den gesamten Prozess prozessweit einfrieren, ohne Fehlermeldung), das 24h-Idempotenz-Fenster fuer Provisioning-Redrive (kein `max` im Env-Parser trotz "MUSS"-Kommentar), die JSON/Postgres-Backend-Paritaet (kein struktureller Test, nur ein einzelner Serialisierungsfall geprueft). Genau in diese Kategorie fallen mehrere der schwersten S1-Funde: ein Geld-Gate akzeptiert negative `max_duration_s` und dreht die Budget-Reserve ins Negative; die SMS-Nutzung wird nie an Stripe gemeldet, weil eine Mapping-Tabelle nicht mitgezogen wurde, als ein vierter Nutzungstyp dazukam; `usage.costEur` ist der einzige Geld-Wert im Store, der als Float statt Ganzzahl-Cents gefuehrt wird.

---

## 2. S1-Befunde (Korrektheit/Sicherheit/Tests) — einzeln

**S1-1 — `src/store/state-ops.js:1300-1371` — Budget-Gate rechnet auf JS-Float statt Ganzzahl-Cents**
`usage.costEur` wird per `+=` auf einem JS-Float akkumuliert (`trackUsage` Z.1325, `addVoiceUsageCostCents` Z.1336, `globalUsageTotals` Z.1304), waehrend jeder andere Geldwert im selben File (`hardCapCents`, `usageEvents.costCents`, `aiCostCents`) bewusst Ganzzahl-Cents ist. Genau dieser Float-Wert ist der Live-Vergleichswert in `budgetExceeded`/`reserveExceedsBudget`/`globalBudgetExceeded` — eine Geld-Gate-Entscheidung auf Rundungsfehler-anfaelliger Basis. Weder README noch PLAN-SECURITY.md dokumentieren dieses Risiko, obwohl CLAUDE.md das fuer bewusste Vereinfachungen verlangt.
*Fix:* `usage.costEur`/Parallelwert als Ganzzahl-Cents fuehren (Runden vor `+=`), Vergleich Cents-gegen-Cents.

**S1-2 — `src/store/pg.js:87-95` (`save()`), Wirkung bis `boot.js:152-155` — verschluckter Flush-Fehler beim Shutdown**
`save()`s `.catch()` loggt einen DB-Fehler nur, wirft ihn nicht weiter — `flushChain` loest daher immer auf, nie ab. `drainFlushes()` (108-115), laut eigenem Kommentar "die einzige korrekte Garantie" fuer den finalen Shutdown-Flush, kann einen fehlgeschlagenen letzten Flush nicht erkennen. `gracefulShutdown` in `boot.js` beendet den Prozess trotzdem mit Exit-Code 0, als waere der letzte Stand persistiert — ein transienter DB-Fehler beim Shutdown verliert den letzten Mutations-Delta unwiderruflich.
*Fix:* separaten `lastFlushError`-Zustand setzen (ohne die interne Kette selbst zu rejecten), `drainFlushes()` prueft/propagiert ihn.

**S1-3 — `src/config.js:440-450` — Provisioning-Redrive-Obergrenze nicht strukturell erzwungen**
`provisioningRedriveMaxAgeMs` traegt einen "MUSS strikt kleiner als 24h (Stripe-Hold-Fenster), sonst droht Doppelkauf"-Kommentar, aber `numEnv()` bekommt kein `max`. Vergleichbare Werte im selben File (`deadAirTimeoutS`, `openingSpeakTimeoutS`, `loopGuardMaxEmptyTurns`) erzwingen ihre Obergrenze exakt ueber dieses Feld. Aktuell ungefaehrlich (Default/Deploy-Wert = 0), aber ein Fehlkonfigurations-Pfad zu echtem doppeltem Nummernkauf.
*Fix:* `max: MS_PER_DAY - 1` ergaenzen (Konstante existiert bereits im selben File).

**S1-4 — `src/store/json.js:62-74` — Corrupt-Store-Recovery kann Original wipen, ohne dass Rename gelingt**
Schlaegt `fs.renameSync(FILE, corruptPath)` fehl, wird das nur geloggt; der folgende `console.error` behauptet trotzdem unbedingt "umbenannt nach ...", und `save()` ueberschreibt danach unbedingt das Original mit Defaults — genau der "stille Wipe", den der Kommentar direkt darueber ausschliessen will. Nur der Erfolgsfall ist getestet (T-P1-03).
*Fix:* Erfolg der Rename in einer Variable festhalten; im Fehlerfall ehrlich loggen und NICHT ueberschreiben (throw statt Default+save), Test fuer den Rename-Fehlerfall ergaenzen.

**S1-5 — `src/mcp-tools.js:581-591` — `list_action_items` komplett ungetestet**
Einziges von neun MCP-Tools ohne jede Testerwaehnung (alle anderen: 3-18 Treffer). Enthaelt drei unabhaengig pruefbare Zweige (Filter, Leerfall-Text, ternaere "(Termin)"-Formatierung), keiner davon assertiert.
*Fix:* Test per bestehendem `captureTools()`-Harness ergaenzen.

**S1-6 — `src/telephony/outbound-gates.js:500-504` — negatives `max_duration_s` hebelt das Budget-Gate aus**
`parseInt(ctx.b.max_duration_s || config.maxCallDurationS, 10) || DEFAULT_CALL_DURATION_S` schuetzt per `||` nur vor 0/null/NaN, nicht vor negativen Zahlen. `max_duration_s: -300` ergibt `ctx.maxDur = -300`, `ctx.reserveCents` wird dadurch negativ und SENKT den getrackten Reservierungsstand statt ihn zu erhoehen — hebelt exakt die vom Modul selbst als "haerteste Invariante" bezeichnete `reserve_budget`-Schranke aus. Weder MCP-Tool-Schema (`z.number().optional()`, keine `.positive()`) noch API-Body-Validierung fangen das ab; bestehender Test prueft nur die obere Grenze.
*Fix:* explizite `Number.isFinite && > 0`-Pruefung statt `||`; Schema um `.positive().max(...)` haerten; Testfall fuer negativen Wert ergaenzen.

**S1-7 — `src/billing/stripe.js:62-66` — SMS-Nutzung wird nie an Stripe gemeldet**
`STRIPE_METER_EVENT_NAME` deckt nur `voice_minute`/`ai_token`/`number_month` ab, `sms` fehlt. Jede erfolgreiche Summary-SMS erzeugt trotzdem ein `USAGE_EVENT_KIND.SMS`-Event; `reportMeter` wirft dafuer "unbekanntes kind", `flushMeters` faengt das ab, markiert das Event aber nicht als gesendet — es wird bei jedem Flush erneut versucht und erneut abgelehnt. Ursache: die Map wurde nicht nachgezogen, als der SMS-Producer spaeter dazukam (G27, Struktur-Luecke). Kein Test deckt `kind='sms'` ab.
*Fix:* `sms`-Eintrag ergaenzen; zusaetzlich Boot-Check, der Vollstaendigkeit gegen `USAGE_EVENT_KIND` erzwingt.

**S1-8 — `src/billing/stripe.js:164-170` — `cancelHold` ohne jede Testabdeckung der echten Implementierung**
Alle Tests, die `cancelHold` erwaehnen, nutzen einen Fake-BillingPort, nie `stripeBilling` selbst — im Unterschied zu `placeHold`/`captureHold`, die direkt gegen echtes/gemocktes HTTP getestet sind. Betrifft den Rollback-Pfad (Hold-Freigabe nach fehlgeschlagenem Capture/Provisioning).
*Fix:* direkter Test nach Muster von `prov01-capture-idempotent.test.js`.

**S1-9 — `src/routes/api-onboard.js:116-122` — 400-Zweig fuer ungueltige `privateNumber` ungetestet**
Dedizierter Pre-Check, damit ungueltiges Format 400 statt 503 liefert — keine der sieben onboard-spezifischen Testdateien sendet ueberhaupt ein `privateNumber`-Feld. Eine Regression faellt lautlos auf den 503-Pfad zurueck, unbemerkt.
*Fix:* Testfall ergaenzen (ungueltige `privateNumber` -> 400 + Text).

**S1-10 — `src/llm.js:198-207` — Breaker-open-Metrik-Zweig ohne Assertion**
Struktureller dritter Ausgang von `complete()` (`outcome:'breaker-open'`, kein `latencyMs`, `attempts` hart 0) wird von T-CP2-9 zwar durchlaufen, aber sein Metrik-Payload nie geprueft. String `breaker-open` kommt in keiner Testdatei vor.
*Fix:* `metricCalls` in T-CP2-9 erfassen und Form/Outcome assertieren.

**S1-11 — `src/store.js:200-203` — `withStoreLock`-Reentrancy nur per Kommentar gesichert**
`runStoreExclusive` ist eine einzige Prozess-weite Chain ohne Reentrancy-Erkennung. Ein verschachtelter `withStoreLock`-Aufruf waehrend eines laufenden Bodys erzeugt einen Zirkel-Deadlock, der NICHT nur den aufrufenden Request, sondern jeden folgenden `withStoreLock`-Aufruf im ganzen Prozess dauerhaft blockiert (alle Call-/Budget-/Transkript-Schreibzugriffe frieren ein) — ohne jede Fehlermeldung. `billing/webhook.js` musste dieser Falle bereits einmal real ausweichen (eigene Chain-Instanz statt `store.withStoreLock`).
*Fix:* Reentrancy strukturell erkennbar machen (Flag/AsyncLocalStorage), bei Verschachtelung sofort werfen statt still zu haengen.

**S1-12 — `src/db/migrate.js:137-148` — Demo-Kalender-Seed ohne `ON CONFLICT`, globaler PK**
Check-then-act (SELECT-Existenzpruefung, dann INSERT-Schleife) ohne `ON CONFLICT`, anders als die drei vorangehenden Inserts derselben Funktion. `calendar_event.id` ist ein globaler, nicht tenant-gescopter PRIMARY KEY; `DEMO_EVENTS` traegt fixe IDs (`ev1`/`ev2`/`ev3`). Zwei gleichzeitig bootende Prozesse fuer denselben Tenant kollidieren auf demselben PK — `init()` bricht dann per `exit(1)` ab (fail-closed-by-design, aber fuer eine harmlose Seed-Kollision unangemessen).
*Fix:* `ON CONFLICT (id) DO NOTHING` ergaenzen; mittelfristig Event-IDs tenant-scopen.

**S1-13 — `src/portal-pool.js:66-75` — `withClient`-Ressourcenlebenszyklus komplett ungetestet**
Der erklaerte Daseinszweck der Datei (Leak-Vermeidung via `client.release()` im `finally`) hat keinen Test gegen die echte Implementierung: alle Konsumenten bauen eigene Fakes mit derselben `{withClient}`-Form statt `createPortalRunner()` echt laufen zu lassen.
*Fix:* Test mit echtem Pool-Double, der Rueckgabewert-Durchreichung, `release()`-Aufruf und Release-bei-Fehler prueft.

**S1-14 — `src/telephony/voice-render.js:33-43` — Telnyx-vs-Twilio Action-URL-Verzweigung ungetestet**
Absolute vs. relative Gather/Redirect-Action-URL (noetig, weil Telnyx-TeXML relative URLs anders aufloest) — kein Test prueft je den `action="https...`-Wert; bestehende Telnyx-Render-Tests uebergeben die Action bereits fertig-relativ, umgehen den Zweig also. Live-verhaltenskritisch fuer die aktuell laufende Telnyx+Budget-Engine-Konfiguration.
*Fix:* Assertion auf den `action`-Attributwert fuer Telnyx (absolut) und Twilio (relativ) ergaenzen.

**S1-15 — `src/geo/registry.js:15-18` — Geo-Adapter-Weiche (true-Zweig) nie durchlaufen**
`GEO_ENABLED=false` ist in allen Spawn-Tests hart gepinnt; kein Test setzt es auf `true`. Da `maxmind.js` derzeit ohnehin immer `null` liefert, waere selbst eine kaputte/vertauschte Bedingung fuer die Suite unsichtbar.
*Fix:* Test mit `GEO_ENABLED=true`, der den Registry-Pfad (nicht den direkten `makeMaxmindGeoLookup`-Aufruf) durchlaeuft.

**S1-16 — `src/telephony/adapters/twilio/voice.js:8-16` — echte Twilio-SDK-Interaktion nie ausgefuehrt**
`originateCall`/`endCall` (echter Anruf-Start/-Ende, kostenrelevant) haben keinen Verhaltenstest; der einzige Import in der Suite prueft nur Registry-Dispatch-Identitaet. Alle Origination-Tests laufen ueber den `FAKE_ORIGINATE`-Testseam und umgehen damit exakt diesen Code. Ein Praezedenzfall (F10 Runde 1) zeigt, dass genau diese Art Luecke bereits einen realen Bug verdeckt hat.
*Fix:* eigene Testdatei analog `test/telnyx-voice.test.js`, `twilio`-SDK-Client testbar/mockbar machen.

**S1-17 — `src/queue/registry.js:8-12` — Fail-closed-Zweige (`pgboss`-Stub, unbekannter Wert) nie getestet**
Keine Testdatei importiert `queue/registry.js` direkt; alle Provisioning-Tests umgehen die Dispatch-Funktion und importieren `makeMemoryQueue()` direkt. `server.js:47` ruft `createQueue()` ungeschuetzt auf Modul-Ebene auf — ein durchgesickerter `QUEUE_BACKEND=pgboss`/Tippfehler wuerde den Server-Boot crashen, ohne dass ein Test das je gepruefte Verhalten war.
*Fix:* dedizierter Unit-Test fuer `createQueue('pgboss')`/unbekannten Wert (Throw-Message assertieren).

---

## 3. S2-Befunde (Duplizierung) — einzeln

**S2-1 — `src/config.js:420`** — `perTargetWindowMs`-Fallback dupliziert `24*60*60*1000` inline statt die bereits definierte `MS_PER_DAY`-Konstante (Z.64, an anderer Stelle im selben File korrekt genutzt) zu referenzieren. *Fix:* `fallback: MS_PER_DAY`.

**S2-2 — `src/web-auth.js:232/239/282/650`** — Idiom "Cookie lesen -> `verifyValue` oder `null`" 5x wortgleich (4x wirklich identisch, 1x mit zusaetzlichem Recovery-Zweig). *Fix:* `readSignedCookie(req, name, secret)`-Helper.

**S2-3 — `src/web-auth.js:205/262/268` + `223/235/248`** — Login-Flow-Cookie-Array `['pkce_verifier','oauth_state','oidc_nonce']` 3x als Literal, CSRF-Fehlermeldung 3x wortgleich. *Fix:* benannte Konstante `LOGIN_FLOW_COOKIE_NAMES` + Helper `rejectCsrf(res)`.

**S2-4 — `src/store/json.js:102-133`** — `migrateUsageToMap`/`migrateSettingsToMap` implementieren denselben Migrations-Algorithmus (Marker-Erkennung -> Legacy-Wrap -> Map-Iteration mit Default-Merge -> Bootstrap-Tenant sichern) zeilenfuer-Zeile identisch, nur Praedikat/Default-Factory unterscheiden sich. *Fix:* gemeinsamer Helper `migrateFlatToMap(raw, isFlatShape, emptyBucket, emptyMap)`.

**S2-5 — `src/mcp-tools.js` (indirekt, nicht in Original-Datenbasis separat gefuehrt, siehe S2-11 Registry)** — entfaellt (kein eigener Fund; siehe Querschnitt).

**S2-6 — `src/ui/wing-canvas-engine.js:209`** — `Timeline.prototype.play` baut captured-Flags per Inline-Schleife zurueck statt die bereits existierende `_resetCaptures()` (von `step()` bereits genutzt) aufzurufen. *Fix:* `this._resetCaptures();`.

**S2-7 — `src/self-service-routes.js:309/356/428`** — `if (!config.paymentEnabled) return res.status(404)...` wortidentisch 3x (plus zwei weitere Kopien derselben Meldung in `routes/api-billing.js`, insgesamt 6x im Billing-Bereich). *Fix:* `requirePaymentEnabled`-Guard bzw. Middleware.

**S2-8 — `src/routes/voice.js:230/242/285/294/309/348`** — Dreierfolge `synthesizeDirectiveAudio -> render -> res.type().send()` an sechs Stellen (5 davon byte-identisch). *Fix:* `sendVoiceXml({res, call, directives, provider})`-Helper.

**S2-9 — `src/app.js:70/84`** (+ eine dritte Stelle in `wiring/auth-gate.js:45`) — `req.path.startsWith("/voice")` 3x als rohes Literal dupliziert, waehrend jeder andere Pfad im File (`STRIPE_WEBHOOK_PATH` etc.) als benannte Konstante gefuehrt wird. *Fix:* `VOICE_PATH_PREFIX`-Konstante.

**S2-10 — `src/billing/stripe.js:128/179/261/323`** — `authHeaders(idempotencyKey ? {...} : {})` 4x wortgleich. *Fix:* `idempotentHeaders(key)`-Helper.

**S2-11 — `src/routes/api-onboard.js:92-95` vs. `237-240`** — tenantId-Validierungsblock (Guard + 400 + Fehlertext) byte-identisch dupliziert. *Fix:* gemeinsame Helper-Funktion.

**S2-12 — `src/telephony/adapters/telnyx/voice.js:147-148` vs. `196-197`** — Twilio-kompatible `{data}`-Envelope-Entpackung wortgleich 2x. *Fix:* `parseTelnyxResource(res)`-Helper.

**S2-13 — `src/i18n/locales.js:102/154/198`** — `styleClause`-Lookup-mit-Fallback 3x (DE/FR/EN) wortgleich, nur das referenzierte Katalog-Objekt variiert. *Fix:* Factory `makeStyleClause(catalog)`.

**S2-14 — `src/wiring/web-login.js:128-129` vs. `180`** (plus 2 weitere Stellen in `auth-gate.js`/`config.js`) — `config.selfServiceEnabled && config.multiTenant` 4x unabhaengig geprueft statt einmal benannt. *Fix:* `isSelfServiceLive(config)`-Ableitung.

**S2-15 (T1, S2) — `src/wiring/web-login.js:126-130`** — Drei-Wege-Branch von `postLoginPath` wird in der einzigen Testdatei nie mit den anderen zwei Zweigen (webDistDir gesetzt, Self-Service aktiv) durchlaufen — nur der `undefined`-Zweig ist geprueft. *Fix:* zwei weitere `makeDeps()`-Varianten ergaenzen.

**S2-16 (T1, S2) — `src/wiring/web-login.js:180`** — Self-Service-Mount-Guard wird nie mit `selfServiceEnabled:true/multiTenant:true` durchlaufen; existierende Self-Service-Tests umgehen `wireWebLogin` komplett. *Fix:* dritter Testfall mit Mount-Beweis via Statuscode.

**S2-17 — Querschnitt: `withStoreLock`-Reentrancy** (siehe auch S1-11) — als Duplizierungs-/Kopplungsrisiko: die Invariante lebt nur als Kommentar an einer Stelle, waehrend 8 Call-Sites in 6 Dateien sich implizit darauf verlassen.

**S2-18 — Querschnitt: `src/telephony/adapters/telnyx/messaging.js:21-24`** — eigene, schwaechere Fehlerbehandlung statt des im Provider-Package etablierten `assertTelnyxOk`-Helpers (von `voice.js`/`numbers.js` durchgaengig genutzt). *Fix:* auf `assertTelnyxOk` umstellen.

**S2-19 — Querschnitt: `config.js` — ~16 Stellen** `(process.env.X || "default") === "true"` dupliziert, kein `boolEnv`-Pendant zum vorhandenen validierenden `numEnv()`. Betrifft u.a. `outboundFrozen`, `paymentEnabled`, `multiTenant`, `provisioningEnabled`. *Fix:* `boolEnv(name, raw, {fallback})`-Helper mit Fail-Closed-Diagnose.

**S2-20 — Querschnitt: `src/mcp-tools.js:19`, `src/mcp-server.js:31`, `src/boot.js:112`** — `GATEWAY_URL`-Fallback `"http://localhost:3000"` 3x separat dupliziert statt zentral in `config.js`. *Fix:* zentraler `resolveGatewayUrl()`-Helper.

**S2-21 — Querschnitt: `src/telephony/registry.js:54-116`** — sechs Funktionen (`voiceControl`, `messaging`, `mediaTransport`, `webhookEvents`, `numberProvisioning`, `voiceRenderer`) wiederholen denselben `provider === PROVIDER.TELNYX ? ... : ...`-Diskriminator statt einer Lookup-Tabelle. *Fix:* `ADAPTERS`-Objekt-Tabelle.

**S2-22 — Querschnitt: `src/routes/api-calls.js:114`, `src/routes/voice.js:89`, `src/tts/directive-synth.js:19`** — "unterstuetzt Provider den Assistant-Pfad?"-Check 3x unabhaengig gegen `PROVIDER.TELNYX` statt hinter dem Port gekapselt. *Fix:* Capability-Flag im Registry-Port.

---

## 4. Querschnitts-Befunde je Linse

**Kopplung & Aenderungslokalitaet**
- `withStoreLock`-Reentrancy nur per Kommentar gesichert (S2-17/S1-11) — bereits einmal real umgangen werden musst (`billing/webhook.js`).
- Facade-Bypass: `routes/api-onboard.js` und `wiring/web-login.js` importieren `state-ops.js`-Funktionen direkt und bauen `load->mutate->save`-Sequenzen manuell nach, statt einer zusammengesetzten Store-Facade-Funktion (S3).
- Kanonisches `PROVIDER`-Enum wird an mind. zwei Stellen (`telephony/voice-render.js:36`, `routes/api-calls.js:188`) durch rohe String-Literale umgangen — inkl. Hot-Path Telnyx-Routing (S3).
- `store/state-ops.js` ist ein 1702-Zeilen/105-Funktionen-Hub mit Fan-in 14 ueber 8+ Fachdomaenen; keine strukturelle Backend-Paritaetspruefung zwischen json.js/pg.js (S4).

**Duplizierung**
- Telnyx-Messaging-Adapter umgeht den designierten Shared-Error-Helper (S2-18).
- Boolean-Env-Flags 16x dupliziert ohne validierendes Pendant zu `numEnv` (S2-19).
- UI-Host-Adapter `chatgpt.js`/`mcp-native.js`: identischer `registerResource`-Rumpf, nur `mimeType` unterscheidet sich (S3).
- `state-ops.js`: "Tenant/Nummer finden, sonst werfen"-Guard 6x wortgleich wiederholt (S4).

**Abhaengigkeiten (extern + DIP)**
- Externe Dependencies: schlank und sauber isoliert (siehe Abschnitt 1b) — dieser Bereich ist der staerkste Befund im gesamten Audit.
- `store/state-ops.js` als Gott-Modul buendelt Tenant-, Billing-, KYC-, Geo-, Nummern- und Call-Logik hinter einem einzigen Hub (S3).
- Provider-neutrales Call-Modell traegt ein Twilio-spezifisches Feld (`twilioSid`, sogar als eigene DB-Spalte `twilio_sid`) auch fuer Telnyx-Calls — Naming-Leck einer konkreten Implementierung in den neutralen Domaenen-/DB-Layer (S3).
- `GATEWAY_URL`-Fallback dreifach dupliziert entgegen der Konvention "Env-Variablen zentral in config.js" (S2-20).

**Erweiterbarkeit (OCP/DIP)**
- `telephony/registry.js`: sechs Funktionen wiederholen denselben Provider-Diskriminator statt einer Tabelle (S2-21).
- Provider-Capability-Check ("ist Telnyx?") 3x dupliziert statt hinter dem Port gekapselt (S2-22).
- P15-Kompositionswurzel durchbrochen: `stripeBilling` wird an 3 Stellen (`app.js`, `wiring/web-login.js`, `server.js`) direkt importiert statt einmal konstruiert und durchgereicht wie alle anderen Provider-Instanzen (S3).
- Store-Backend-Vertrag (json vs. pg) nur per Konvention synchron gehalten, kein struktureller Paritaets-Test (S3).

---

## 5. S3/S4 gebuendelt (nach ID-Typ)

Insgesamt 73 S3- und 18 S4-Funde (91 in den 47 tief geprueften Dateien, davon 9 zusaetzlich aus der Querschnitts-Analyse bereits oben unter Abschnitt 4 eingeordnet). Gruppiert nach Rubrik-ID, mit Haeufigkeit und reprasentativen Fundorten:

| ID | Bedeutung | ca. Haeufigkeit | reprasentative Fundorte |
|---|---|---|---|
| **G11** | Inkonsistente Benennung/Behandlung derselben Sache (Enum vs. Literal, Sync vs. Async, Naming-Drift) | ~15 | `state-ops.js` (call.status-Enum), `pg.js` (hydrateTenantInto inline), `config.js` (provisioningCountry ungetrimmt), `routes/voice.js` (direkte Feldmutation), `bridge.js` (inkonsistente Guards), `billing/ports.js` (retrieve vs. get) |
| **G25** | Magic Numbers/Strings ohne benannte Konstante | ~10 | `state-ops.js` (reason-Strings), `web-auth.js` ('suspended'), `claude.js` (end_call-Literal, 60-Min-Default), `routes/voice.js` (realtime-Magic-String), `api-onboard.js` (254 dreifach), `migrate.js` ('active'), `call-finish.js` (1500-Zeichen-Cap) |
| **G30** | Funktion zu lang / zu viele Aufgaben (>100 Zeilen-Richtwert) | 7 | `mcp-tools.js` (`registerTools`, 364 Z.), `claude.js` (`agentTurn`, 115 Z.), `telnyx-llm-shim.js` (`handleChatCompletion`, 176 Z.), `bridge.js` (Connection-Callback, 215 Z.), `api-onboard.js` (150-Z.-Handler), `api-calls.js` (POST-Handler), `wiring/web-login.js` (`wireWebLogin`, 156 Z.) |
| **C1** | Vergaengliche Phasen-/Ticket-/Commit-Referenzen im Code statt in Git-Historie/Docs | 9 | `claude.js`, `app.js`, `telnyx-llm-shim.js`, `telephony/adapters/telnyx/voice.js`, `llm.js`, `routes/api-calls.js`, `ui/registry.js`, `portal-pool.js` (auch in Error-Messages!) |
| **C2** | Kommentar widerspricht/veraltet gegenueber tatsaechlichem Code-Verhalten | 7 | `billing/webhook.js` (Doc unvollstaendig), `worker/provisioning-orchestrator.js` (Reason-Werte fehlen), `telephony/ports.js` (Header falsch: "genau ein Adapter"), `plans.js` (ueberholter "kein Konsument"-Kommentar), `util.js` (2x falsches Beispiel in Kommentar) |
| **F1** | Zu viele Funktionsargumente (>3-Richtwert) | 5 | `store/pg.js` (`deleteMissingByText`, 5 Param., 1 unbenutzt), `store/json.js` (`addCalendarEvent`, `trackUsage`, je 4), `ui/wing-canvas-engine.js` (`drawTriangle`, 14!), `llm.js` (`backoffDelay`, 4) |
| **G9** | Toter Code | 3 | `ui/wing-canvas-engine.js` (`Timeline.pause` nie aufgerufen), `i18n/locales.js` (unerreichbare Regex-Alternative), `utils/format-duration.js` (Modul ganz ohne Aufrufer) |
| **G12** | Tote/unbenutzte Felder/Parameter | 3 | `ui/wing-canvas-engine.js` (`this.target`, `duration`-Param ungenutzt), `bridge.js` (ctx-Felder log/hangup/finalize ungelesen), `portal-pool.js` (`_pool`-Feld nirgends gelesen) |
| **G26** | Fehlerpfad/Fallback fehlt oder ist unvollstaendig | 3 | `ui/wing-canvas-engine.js` (kein `img.onerror`), `bridge.js` (Timer-Leak bei erneutem `scheduleHangup`), `telephony/ports.js` (`searchNumbers` undokumentiert bei Geld-Wirkung) |
| **G27** | Invariante nur per Konvention, nicht strukturell erzwungen | 6 | `state-ops.js` (`markProvisioningJob` ohne Statuspruefung), `defaults.js` (`sanitizeProfile`-Sonderfall per Literal), `billing/webhook.js` (impliziter SUSPEND-Default), `api-calls.js` (`to` vs. `ctx.to`), `billing/ports.js` (`kind` als generischer String), `telephony/registry.js` (silent Fallback statt Wurf) |
| **P2** | Datei/Funktion buendelt mehrere unabhaengige Aenderungsgruende | 2 | `web-auth.js` (845 Z., 5 Belange), `telephony/call-finish.js` (Billing+Notification+SMS+Persistenz in einer Funktion) |
| **N1/N7** | Irrefuehrender Name / Command-Query-Bruch | 2 | `worker/provisioning-orchestrator.js` (`reqRes` wirkt wie Express-Req/Res), `llm.js` (`isOpen()` mutiert Zustand trotz Query-Namen) |
| **G31** | Reihenfolge-Invariante nur per Prosa, nicht strukturell | 1 | `db/migrate.js` (`rekeyProfilesToTenant` muss zwischen zwei anderen Schritten laufen) |
| **T1/T5** | Sichtbarer Branch/Grenzfall ohne Testabdeckung (S3-Grad, unterhalb der oben als S1 gefuehrten kritischen Faelle) | 2 | `voice-render.js` (`streamDirectives`-URL ungetestet), `plans.js` (`findPlan`-Null-Zweig ungetestet trotz getesteter Schwesterfunktion) |
| **G19/G20** | Zu dichte Ausdruecke / irrefuehrender Funktionsname | 2 | `store/portal.js` (verschachtelter Query-Ausdruck), `store/defaults.js` (`nextWeekday` prueft keinen Werktag) |
| **G5/P6/P15** | Einzelfunde (redundante Bedingung, versteckter Seiteneffekt, DI-Bruch) | 3 | `api-onboard.js` (redundanter Geo-Check, gebrochenes DI-Muster), `config.js` (`numEnv` mutiert globalen State) |

---

## 6. Zaehlung & wichtigste To-dos

| Schweregrad | Anzahl |
|---|---|
| S1 (Korrektheit/Sicherheit/Tests) | 17 |
| S2 (Duplizierung) | 21 |
| S3 (Struktur/Wartbarkeit) | 73 |
| S4 (kosmetisch/gering) | 18 |
| **Gesamt** | **129** |

**Die 3 wichtigsten To-dos:**

1. **Geld-Gates haerten (S1-6, S1-7, S1-1).** Negatives `max_duration_s` dreht die Budget-Reserve ins Negative und hebelt die "haerteste Invariante" des Outbound-Gate-Moduls aus; SMS-Nutzung wird strukturell nie an Stripe gemeldet; `usage.costEur` ist der einzige Float-Geldwert im Store. Alle drei sind konkret, klein zu fixen und wirken auf denselben Money-at-rest-Pfad, der laut CLAUDE.md Prioritaet vor Features hat.
2. **`withStoreLock`-Reentrancy strukturell absichern (S1-11).** Aktuell nur per Kommentar verhindert; ein Verstoss friert den gesamten Prozess ohne Fehlermeldung ein — genau die Art stiller, systemweiter Ausfall, den ein Millionen-Skala-Telefonie-Dienst sich am wenigsten leisten kann.
3. **Testluecken an sicherheits-/kostenrelevanten Branches schliessen (S1-9/14/15/16/17 u.a.).** Mehrere real durchlaufene Produktionszweige (Telnyx-Action-URL-Wahl, echte Twilio-Anrufausloesung, Queue-Fail-Closed-Pfad, Onboard-Validierung) sind ungetestet — jeweils mit konkretem, kleinem Testfix benannt.

---

## 7. Abdeckung / Grenzen

Von 130 Dateien in `src/` wurden **47 tief geprueft** (Zeile-fuer-Zeile, adversarial verifiziert). Die **restlichen 83 Dateien wurden nur breit gemessen** (LOC, Fan-in, Verschachtelungstiefe) und NICHT einzeln durchgelesen — fuer sie liegt kein datei-spezifischer Befund vor, ihre Abwesenheit in Abschnitt 2-5 ist keine Aussage ueber Sauberkeit:

`auth.js`, `billing/activation.js`, `billing/backfill-profiles.js`, `billing/card-setup.js`, `billing/errors.js`, `billing/meter.js`, `billing/metering.js`, `billing/period.js`, `billing/plan-profile-resolver.js`, `billing/provision-trigger.js`, `billing/subscribe.js`, `boot-guard.js`, `boot.js`, `brand-icon-data.js`, `chain-mutex.js`, `geo/maxmind.js`, `geo/resolve.js`, `geo/stub.js`, `mcp-server-info.js`, `mcp-server.js`, `metrics.js`, `middleware.js`, `onboard-guard.js`, `onboarding.js`, `process-guards.js`, `queue/adapters/memory/queue.js`, `queue/adapters/pgboss/queue.js`, `release-reconcile.js`, `request-tenant.js`, `routes/_tenant.js`, `routes/_validation.js`, `routes/api-billing.js`, `routes/api-profiles.js`, `routes/api-read.js`, `routes/api-tenant-write.js`, `routes/stripe-webhook.js`, `self-service.js`, `server.js`, `single-flight.js`, `sms-summary.js`, `telephony/adapters/telnyx/call-control-events.js`, `telephony/adapters/telnyx/elevenlabs-voice.js`, `telephony/adapters/telnyx/errors.js`, `telephony/adapters/telnyx/media.js`, `telephony/adapters/telnyx/messaging.js`, `telephony/adapters/telnyx/numbers.js`, `telephony/adapters/telnyx/render.js`, `telephony/adapters/telnyx/signature.js`, `telephony/adapters/telnyx/speak-events.js`, `telephony/adapters/telnyx/webhook-events.js`, `telephony/adapters/twilio/client.js`, `telephony/adapters/twilio/media.js`, `telephony/adapters/twilio/messaging.js`, `telephony/adapters/twilio/render.js`, `telephony/adapters/twilio/signature.js`, `telephony/adapters/twilio/webhook-events.js`, `telephony/call-lifecycle.js`, `telephony/call-termination.js`, `telephony/directives.js`, `telephony/failure-reason.js`, `telephony/media-events.js`, `telephony/provisioning-geo.js`, `telephony/reattach.js`, `telnyx-call-control-ingest.js`, `telnyx-call-terminate.js`, `telnyx-conversation-watchdog.js`, `telnyx-inbound.js`, `telnyx-origination.js`, `tts/store.js`, `tts/synth.js`, `ui/adapters/chatgpt.js`, `ui/adapters/mcp-native.js`, `ui/contract.js`, `ui/hud-card-css.js`, `ui/widget-bind.js`, `ui/widget-catalog.js`, `ui/widget-i18n.js`, `ui/wing-canvas-mount-idle.js`, `ui/wing-image-data.js`, `ui/wing-markup.js`, `utils/timer.js`, `wiring/auth-gate.js`, `worker/provisioning.js`.

Bemerkenswert: einige der querschnittlich zitierten Belege (z.B. `wiring/auth-gate.js`, `ui/adapters/chatgpt.js`/`mcp-native.js`, `queue/adapters/*`) liegen in dieser nicht-tief-geprueften Menge — sie wurden dort nur ueber Grep/Stichprobe im Rahmen der Querschnitts-Linsen sichtbar, nicht vollstaendig auditiert. Ein zukuenftiger Auditlauf sollte diese 83 Dateien priorisiert nach Fan-in/LOC abarbeiten, insbesondere `server.js` (Kompositionswurzel), `routes/stripe-webhook.js` und die Telnyx-Adapter-Dateien (Geld-/Sicherheitsnähe).
