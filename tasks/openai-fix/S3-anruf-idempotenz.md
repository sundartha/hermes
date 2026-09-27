# Schnitt S3: Anruf-Pfad: Idempotenz und Frist

Blocker: P0-6 (Frist + Idempotenz), PP-D10-04, PP-D10-05, PP-D10-G4 (Teil: Reserve-Leck ohne Datensatz), PP-D10-G1 (nur die Gleich-Ziel-Haelfte) | Anforderungs-IDs: T-27, N-11 | Kategorie: A (Frist), B (Idempotenz)

## Ist-Zustand

- Interner Hop ohne Frist: `src/mcp-tools.js:585` (`const call = (method, path, body) => api({ method, path, body, identity, scopedTenant })`) uebergibt kein `timeoutMs`; `api()` setzt `signal` nur bei gesetztem `timeoutMs` (`:57`, Wert-Zweig `:36` der Fetch-Optionen). Einzige Ausnahme im Haus ist `pollConsult` (`:590-603`). `place_call` faehrt ueber genau diesen Hop (`:825`).
- Der Anrufstart blockiert ueber die ganze Klingelphase, GEMESSEN, nicht geraten: `src/elevenlabs/convai.js:59-72` (unerreichbares Ziel 1,05 s; echter Anruf 40,3 s blosses Klingeln), Transport-Bound `REQUEST_TIMEOUT_MS = 120000` (`:79`). Derselbe Befund zweitbelegt in `src/elevenlabs/outbound.js:1882-1887`.
- Derselbe Messtext belegt die Waisen-Wirkung schon heute: bei 15 s Frist brach der Server WAEHREND des Klingelns ab, "das Gespraech kam danach trotzdem zustande" (`src/elevenlabs/convai.js:64-68`). Ein Abbruch verhindert den Anruf nicht, er kappt nur unsere Kennung.
- Keine Deduplizierung: `POST /api/calls` (`src/routes/api-calls.js:334-338`) nimmt ausser `to`/`objective` keinen Schluessel; `src/routes/api-calls.js:439` (`store.createCall`) legt bedingungslos einen neuen Datensatz mit neuer `call.id` an. `src/single-flight.js:1-37` ist ausweislich Modulkopf fuer den Provisioning-Drain gebaut (eigene Chain-Instanz, `:30-36`); `src/chain-mutex.js:15-22` liefert nur die Mechanik hinter `store.withStoreLock` und ebenjenem Drain. BEIDE greifen auf dem Anruf-Pfad NICHT. Der einzige Lock der Kette deckt die Geld-Reserve (`src/telephony/outbound-gates.js:939`, `store.withStoreLock(() => reserveOutcome(ctx))`).
- Zwischen Gate-Ende und Datensatz liegen zwei awaits mit Netzverkehr: Briefing (`src/routes/api-calls.js:394`, Frist 6000 ms `src/config.js:586-591`) und Eroeffnungszeile (`:428`, LLM-Seam, `llmRequestTimeoutMs` 3500 ms + `llmMaxRetries` 2, `src/config.js:550-555`). Erst danach `createCall` (`:439`).
- Kein aeusserer `try`: der Handler beginnt `src/routes/api-calls.js:334`, der `try` erst `:473`. Ein Wurf im Fenster Gate-Ende..`createCall` endet als `unhandledRejection` (`src/process-guards.js:21`) - der Client bekommt gar keine Antwort. Die Reserve ist zu diesem Zeitpunkt bereits gebucht (`src/telephony/outbound-gates.js:939` -> `src/store/state-ops.js:4783-4788`), ihre Freigabe verlangt aber einen Datensatz (`src/store/state-ops.js:4795-4801`, `if (!call || !call.reserveCents || call.reserveReleased) return false`) - Reserve-Leck, das kuenftige Anrufe mit 402 abweist.
- Erfolgsantwort ohne jede Wiederhol-Information: `src/routes/api-calls.js:514-524` (`ok, callId, twilioSid, status, context_received, diagnostic`). MCP-Sicht: `CALL_OUTPUT` (`src/mcp-tools.js:322-327`, Spread aus `CALL_STATUS_OUTPUT` `:177-183`), Handler `:825-847`, Status hart `"dialing"` (`:829`).
- Vorhandene, wiederverwendbare Bausteine: `store.withStoreLock` (Fassade, `src/store.js:439-452`, Re-Entrancy-Riegel `:441-447`, Body kurz und synchron halten `:424`), `store.activeCallsFor(tenantId)` (Fassade `src/store.js:244`, json `src/store/json.js:905`, pg `src/store/pg.js:544`, Projektion `src/store/state-ops.js:1779-1781`, liefert alle `status==="active"`-Legs eines Tenants, richtungsoffen), `store.createCall` synchron in BEIDEN Backends (`src/store/json.js:426-430`, `src/store/pg.js:205-209`), Abbruch-Erkennung `isAbortError` (`src/mcp-tools.js:287-288`), Fehlercode-Katalog `MCP_ERROR_CODE` (`src/i18n/mcp-texts.js:20-24`) mit drei Sprachen (`:27`, `:107`, `:151`).
- Einziger Produktiv-Aufrufer der Route ist der MCP-Hop (`src/mcp-tools.js:825`); `grep -rn "api/calls" src apps` findet in `apps/web` KEINEN Aufrufer.

## Soll-Zustand

1. Der `place_call`-Hop traegt eine Frist. Die Frist ist strukturell GROESSER als das gesamte Vorwahl-Budget des Servers (Briefing + Eroeffnungszeile + `REQUEST_TIMEOUT_MS`), damit ein Zeitablauf niemals einen laufenden Anrufstart kappt.
2. Laeuft die Frist doch ab (haengendes Gateway), sieht der Client eine stabile, lokalisierte Fehlermeldung, die ausdruecklich sagt: der Anruf kann laufen, ein erneuter `place_call` an dasselbe Ziel liefert den laufenden Anruf zurueck statt eines zweiten Anrufs.
3. Ein zweiter `POST /api/calls` desselben Tenants auf dasselbe (normalisierte) Ziel, waehrend ein Anruf dieses Tenants an dieses Ziel noch `active` ist und innerhalb des Dedup-Fensters begann, waehlt NICHT. Er antwortet 200 mit der `callId` des ERSTEN Anrufs und `deduplicated: true`.
4. Die Entscheidung "waehlen oder deduplizieren" und das Anlegen des Datensatzes passieren in EINEM synchronen `store.withStoreLock`-Abschnitt. Zwei gleichzeitige Anrufe auf dasselbe Ziel erzeugen genau EINEN Datensatz und genau EINEN Anrufstart.
5. Ein deduplizierter Aufruf gibt die von ihm selbst gebuchte Reserve vollstaendig zurueck und verbraucht kein Stunden-/Ziel-Kontingent (er legt keinen Datensatz an).
6. Wirft irgendetwas im Fenster Gate-Ende..`createCall`, antwortet die Route 503 und die Reserve dieses Requests ist zurueckgegeben - kein `unhandledRejection`, kein dauerhaftes Reserve-Leck.
7. Die Gate-Kette bleibt unveraendert: 18 Glieder, gleiche Reihenfolge, `reserve_budget` letztes Glied. Die Dedup-Entscheidung liegt HINTER der vollstaendigen Kette und kann kein Gate ueberspringen.

## Aenderungen

### A1 Frist auf dem internen Hop (`src/mcp-tools.js`)

- Neue Modul-Konstante, exportiert, bei den anderen Bound-Konstanten (Nachbarschaft `:287`): `PLACE_CALL_HOP_TIMEOUT_MS = 180000`. Kommentar traegt die Rechnung: `REQUEST_TIMEOUT_MS` 120000 (`src/elevenlabs/convai.js:79`) + Briefing 6000 (`src/config.js:586-591`) + Eroeffnungszeile (3500 ms x bis zu 3 Versuche + Backoff, `src/config.js:550-561`) + Reserve. KEIN Env-Knopf: eine kuerzere Frist erzeugt genau die Waise, die dieser Schnitt beseitigt; Praezedenz fuer "interner Transport-Bound, kein Operator-Knopf" ist `src/elevenlabs/convai.js:55-57`.
- In `registerTools` neben `call`/`pollConsult` (`:585-603`) ein dritter, benannter Zugang `placeCallHop(body)`, der `api({ method: "POST", path: "/api/calls", body, identity, scopedTenant, timeoutMs: PLACE_CALL_HOP_TIMEOUT_MS })` ruft und `isAbortError` (`:288`) in `new ToolError(MCP_ERROR_CODE.CALL_START_UNCONFIRMED)` umsetzt. `call()` selbst bleibt unangetastet - alle zehn uebrigen Werkzeuge bleiben byte-identisch (Frist fuer sie: s. Abhaengigkeiten).
- `:825` ruft `placeCallHop(args)` statt `call("POST", "/api/calls", args)`.
- Warum so: ein eigener benannter Zugang ist das im Haus bereits gewaehlte Muster fuer den EINEN Aufruf mit eigener Frist (`pollConsult`, `:588-603`). Ein viertes Positionsargument an `call()` waere gegen den dortigen Kommentar (F1: EIN Objekt-Argument statt sechs Positionen).

### A2 Neuer Fehlercode + Text (`src/i18n/mcp-texts.js`)

- `MCP_ERROR_CODE` (`:20-24`) um `CALL_START_UNCONFIRMED: "call_start_unconfirmed"` erweitern, Text in allen drei Sprachbloecken (`de:40-47`, `en`, `fr`) ergaenzen. Inhalt (de, Wortlaut im Spec verbindlich, weil Test ihn pinnt): "Zeitablauf beim Anrufstart - der Anruf kann bereits laufen. Ein erneuter place_call an dieselbe Nummer liefert den laufenden Anruf zurueck und startet keinen zweiten."
- Warum so: `wrapHandler` (`src/mcp-tools.js:630-647`) uebersetzt genau `err.code` ueber diesen Katalog; ohne Eintrag saehe ein EN/FR-Tenant den Auffangsatz.

### A3 Dedup-Praedikat als reines Modul (`src/telephony/call-dedup.js`, neu)

- Exportiert `DEDUP_WINDOW_MS = 180000` und `findDuplicateOutboundCall(activeCalls, { to, nowMs })`: liefert den juengsten Eintrag mit `direction === "outbound"`, `to === to` (STRIKTE Zeichenketten-Gleichheit auf der bereits normalisierten Nummer, Praezedenz `src/callee-is-owner.js`) und `Date.parse(startedAt) >= nowMs - DEDUP_WINDOW_MS`, sonst `null`. Rein, kein Store, kein IO, unit-testbar.
- Schluessel-Entscheidung (begruendet, Preis benannt):
  - VERWORFEN: client-gelieferter Idempotenz-Schluessel. Ein Modell erfindet ihn bei der Wiederholung neu; er schuetzt genau in dem Fall nicht, fuer den er gebaut waere. Ausserdem entscheidet dann der Aufrufer ueber eine Sicherheitseigenschaft (Gegenmuster zur OC-Regel "der Aufrufer nennt nur `to`, den Rest entscheidet der Server").
  - VERWORFEN: Hash aus `to` + `objective`. Ein LLM-getriebener zweiter Versuch formuliert `objective` um; der Hash trifft ihn nicht. Er ist strikt schwaecher als `to` allein.
  - GEWAEHLT: Tenant + normalisiertes `to` + "erster Anruf noch `active`" + Fenster 180 s. Der Zustand "es laeuft gerade ein Anruf dieses Tenants an diese Nummer" ist der Zustand, den ein zweiter echter Anruf verletzt.
  - PREIS 1: ein ABSICHTLICHER zweiter Anruf an dieselbe Nummer innerhalb von 180 s waehrend der erste laeuft ist nicht mehr moeglich. Er ist am Telefon ohnehin sinnlos (dieselbe Person ist im Gespraech), und er ist am `deduplicated`-Feld erkennbar, also fuer den Nutzer erklaerbar.
  - PREIS 2: ein haengengebliebener `active`-Datensatz (z.B. Poll-Abbruch) sperrt dieses EINE Ziel fuer bis zu 180 s. Deshalb das Fenster: ohne es sperrte er bis zum Dauer-Cap.
  - PREIS 3: ein Wiederholungsaufruf NACH 180 s waehlt erneut. Gegen einen Host-Retry, der Minuten spaeter kommt, schuetzt dieser Schnitt nicht (dann ist der erste Anruf meist ohnehin beendet).
- Die Achse ist der TENANT, nicht `requestedBy`: Geld- und Limit-Achsen dieses Repos sind tenant-gekeyt (`src/telephony/outbound-gates.js:364-378`); eine zweite Identitaet desselben Tenants darf die Bremse nicht vervielfachen.

### A4 Reserve-Rueckgabe ohne Datensatz (`src/store/state-ops.js`, `src/store/json.js`, `src/store/pg.js`, `src/store.js`)

- Neue Operation neben `releaseOutboundReserve` (`src/store/state-ops.js:4795-4801`): `releaseOutboundReserveCents(s, tenantId, cents)` - `s.reservations[tenantId] = Math.max(0, reservationFor(s, tenantId) - cents)`, Rueckgabe `true/false` (false bei nicht buchbaren `cents`). Clamp und Fail-closed-Form wie das Original.
- Fassaden-Verdrahtung analog `releaseOutboundReserve`: `src/store/json.js:954-956` (kein `save()` - Reserven sind strukturell ephemer, `src/store/state-ops.js:4755-4759`), `src/store/pg.js:585`, Export-Liste `src/store.js:261`.
- INVARIANTE, im Kommentar der neuen Operation festzuhalten: sie ist AUSSCHLIESSLICH fuer den Fall "dieser Request hat reserviert und legt KEINEN Datensatz an" da. Existiert ein Datensatz, gilt weiter allein `releaseOutboundReserve` mit seinem `reserveReleased`-Schloss. Zwei Freigabewege fuer denselben Betrag waeren ein Geld-Defekt.
- Warum nicht stattdessen einen Dummy-Datensatz anlegen und ihn regulaer freigeben: der Datensatz zaehlt in `countOutboundCallsSince` (`src/store/state-ops.js:1758-1765`, zaehlt bewusst auch fehlgeschlagene Calls) und verbrauchte Stunden- und Ziel-Kontingent fuer einen Anruf, der nie stattfand.

### A5 Dedup-Claim und Fehlerklammer in der Route (`src/routes/api-calls.js`)

- Ab `:365` (direkt nach der Gate-Kette) bis `:459` (`createCall`) in einen `try` klammern. `catch`: `store.releaseOutboundReserveCents(ctx.tenantId, ctx.reserveCents)` unter `store.withStoreLock`, secret-freies `console.error` (Muster `:554-557`), `res.status(503).json({ error: <Bestandstext GATE_ERROR_MESSAGE-Nachbarschaft, eigener kurzer Satz> })`. Das ist die Antwort, die heute ganz fehlt (P0-6 "verschaerfend") und zugleich PP-D10-G4.
- `:439` ersetzen durch EINEN synchronen Lock-Abschnitt (Body ohne jedes await, Invariante `src/store.js:424`):
  1. `findDuplicateOutboundCall(store.activeCallsFor(ctx.tenantId), { to: ctx.to, nowMs: Date.now() })`.
  2. Treffer -> Ergebnis `{ duplicateOf: <call.id> }`, sonst `{ call: store.createCall({ ...unveraenderte Felder... }) }`.
- Nach dem Lock: bei `duplicateOf` KEIN `emitOpeningConsult`, KEIN Originate, KEIN Timer; `store.releaseOutboundReserveCents(...)` in einem ZWEITEN, kurzen Lock-Abschnitt (nicht im ersten - der erste soll nur die Claim-Entscheidung tragen; beide sind synchron und kurz), `audit("place_call_dedup", req, \`to=${ctx.to} call=${duplicateOf} tenant=${ctx.tenantId}\`)`, dann `res.json({ ok: true, callId: duplicateOf, twilioSid: null, status: "dialing", deduplicated: true, context_received: contextReceivedMeta(ctx.context, config), diagnostic: false })`.
- Erfolgspfad (`:514-524`) um `deduplicated: false` erweitern - EIN Feld, immer vorhanden, damit der Client nicht zwischen "Feld fehlt" und "false" raten muss.
- Warum 200 mit der ersten `callId` und nicht 409/Fehler: ein Fehler fuehrt das Modell dazu, dem Nutzer "der Anruf hat nicht geklappt" zu sagen, WAEHREND ein echter Anruf laeuft - die schlechtere der beiden Luegen. Mit der ersten `callId` laufen `await_call_event`/`get_call_status` auf dem richtigen Anruf weiter (Server-Instruktion verlangt genau diese Schleife), und `deduplicated: true` beantwortet die Frage "lief die Aktion schon?" ausdruecklich.
- Warum die Pruefung NICHT vor `fetchPrecallBriefing`/`fetchOpeningLine`: sie muesste dann zweimal stehen (vor dem Token-Verbrauch und atomar im Lock) - zwei Stellen, die dieselbe Frage beantworten. PREIS: ein deduplizierter Aufruf hat Briefing- und Eroeffnungszeilen-Token bereits verbraucht (beide gedeckelt, 6 s bzw. 3,5 s je Versuch). Bewusst akzeptiert.

### A6 MCP-Sicht (`src/mcp-tools.js`)

- `CALL_OUTPUT` (`:322-327`) um `deduplicated: z.boolean()` erweitern - NUR dort, NICHT in `CALL_STATUS_OUTPUT` (`:177-183`), damit `get_call_status` unberuehrt bleibt.
- Handler `:826-847`: `deduplicated: !!r.deduplicated` (defensive Normalisierung wie `normalizeContextReceived`, `:330-341`); die Textzeile (`:842-846`) nennt den Fall in einem Satz, wenn `deduplicated` gesetzt ist.
- `placeCallDescription` (`:548`) um EINEN Satz: ein erneuter Aufruf an dieselbe Nummer waehrend eines laufenden Anrufs liefert den laufenden Anruf zurueck und startet keinen zweiten (N-11: retry-sicher UND ausgewiesen).

## Erwartungsergebnis und Verifikation

| Aenderung | deterministisches Erwartungsergebnis | Verifikationsbefehl/Testdatei |
|---|---|---|
| A5 Claim, parallel | Zwei gleichzeitige `POST /api/calls` mit demselben `to` (`FAKE_ORIGINATE=true`): beide 200, gleiche `callId`; genau eine Antwort mit `deduplicated:false`, eine mit `true`; `GET /api/state` -> `calls.length === 1` | neu `test/openai-s3-place-call-idempotenz.test.js`, Muster `test/outbound-reserve-concurrency-http.test.js:10-45` (`Promise.all` zweier POSTs, `startServer`, `FAKE_ORIGINATE`) |
| A5 Claim, sequenziell | Zweiter POST auf dasselbe `to`, waehrend der erste Anruf `active` ist: 200, `deduplicated:true`, `callId` des ersten; `calls.length === 1` | dieselbe Datei |
| A3 Fenster/Status | Nach BEENDETEM erstem Anruf (ohne `FAKE_ORIGINATE` -> 500, Datensatz `failed`) erzeugt derselbe `to` einen NEUEN `callId`; `calls.length === 2` | dieselbe Datei; Regressionsfang bleibt `test/outbound-per-target-cap.test.js` (3x dasselbe Ziel muss weiterhin 3 Datensaetze und beim 4. 429 ergeben) |
| A3 Ziel-Isolation | Zwei gleichzeitige POSTs auf VERSCHIEDENE `to`: zwei verschiedene `callId`, `calls.length === 2` | dieselbe Datei |
| A4 Reserve | Nach einem deduplizierten Aufruf ist `GET /api/state` -> `reservations[<tenant>]` exakt der Betrag EINER Reserve (identisch zum Wert nach einem einzelnen, nicht deduplizierten Anruf) | dieselbe Datei |
| A5 Fehlerklammer | Wirft der Block vor `createCall` (Test injiziert einen Store-Fehler ueber die bestehende Attrappen-Naht), liefert die Route 503 mit JSON-Body und `reservations[<tenant>] === 0`; kein `unhandledRejection` im Kindprozess-Log | dieselbe Datei; Muster der Reserve-Fehlerpruefung `test/outbound-reserve-release-error.test.js` |
| A1 Frist-Hoehe | `PLACE_CALL_HOP_TIMEOUT_MS > REQUEST_TIMEOUT_MS + config.llm.briefingTimeoutMs` (strukturelle Invariante "Frist kappt nie einen laufenden Anrufstart") | neu `test/openai-s3-hop-frist.test.js` (reiner Import, kein Server) |
| A1/A2 Abbruch-Zweig | `place_call`-Handler mit einem `fetch`, das `TimeoutError` wirft -> Tool-Ergebnis `isError:true` und Text === `MCP_TEXTS.<lang>.errors.call_start_unconfirmed` fuer de/en/fr | dieselbe Datei, Muster `test/mcp-fehlergrund-rueckweg.test.js` (registerTools + fakeServer + gestubbtes fetch) |
| A6 Schema | `place_call`-Ergebnis validiert gegen `CALL_OUTPUT` inkl. `deduplicated`; `get_call_status`-Schema unveraendert | dieselbe Datei; bestehende Pins `test/mcp-tools.test.js`, `test/al-p11-result-card.test.js` |
| Gate-Kette unberuehrt | 18 Glieder, Reihenfolge unveraendert | `node --test test/outbound-gates-order.test.js` |
| Gesamtlauf | gruen | `npm test -- --test-concurrency=4`, danach `node --check src/routes/api-calls.js src/mcp-tools.js src/telephony/call-dedup.js src/store/state-ops.js` |
| Smoke | `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true FAKE_ORIGINATE=true npm start`, dann zweimal `curl -X POST localhost:3999/api/calls` mit demselben `to`: zweite Antwort traegt `deduplicated:true` und dieselbe `callId` | manuell, Befehl aus CLAUDE.md "Lokal testen" |

## Blast Radius

- Produktiv-Aufrufer der Route: NUR `src/mcp-tools.js:825` (`grep -rn "api/calls" src apps`; `apps/web` = 0 Treffer). Kein Dashboard-, kein Webhook-Aufrufer.
- Test-Aufrufer von `POST /api/calls` (`grep -rn "api/calls\`" test/`): `test/anrufstart-ablehnung-grund.test.js:48`, `test/outbound-identity-gate.test.js:52`, `test/profiles.test.js:26`, `test/place-call-sprachwahl.test.js:101`, `test/ie6-s1-katalog-umzug.test.js:130`, `test/outbound-per-target-cap.test.js:19`, `test/outbound-reserve-concurrency-http.test.js:11`, `test/outbound-reserve-backstop.test.js`, `test/outbound-reserve-release-*.test.js`, `test/max-duration-live-cap.test.js`, `test/oc-p1-owner-call-http.test.js`, `test/diagnostic-retention-http.test.js`, `test/elevenlabs-anrufstart.test.js`, `test/telnyx-p5-gate-proof.test.js` sowie der geteilte Helfer `placeCall(srv, to = TELNYX_TEST_PEER_NUMBER)` (`test/helpers.js:1177-1183`).
- WAS KAPUTTGEHEN KANN, konkret: jeder Test, der auf DERSELBEN Server-Instanz zweimal dasselbe `to` waehlt, WAEHREND der erste Anruf `active` bleibt - das sind die 19 Dateien mit `FAKE_ORIGINATE` (`grep -rln "FAKE_ORIGINATE" test/`). Tests mit Offline-Originate (500-Diskriminator, `test/helpers.js:210-217`) sind NICHT betroffen: dort ist der Datensatz beim Antworten schon `failed` (`src/routes/api-calls.js:544-549` laeuft awaited vor `:569`), also nicht mehr `active`. Der Implementierer muss den Gesamtlauf fahren und betroffene Tests auf verschiedene Zielnummern oder ein Beenden zwischen den Anrufen umstellen - NICHT das Dedup-Fenster kleinreden.
- Beschreibungs-Pins: `placeCallDescription` steht unter mehreren Textpruefungen (`test/p15-mcp-tool-descriptions-en.test.js`, `test/mcp-ui-i18n-divergence.test.js`) und das `objective`-Feld traegt laut Kommentar `src/mcp-tools.js:674-681` eine gepinnte Marker-Inventur (Grossbuchstaben-Woerter). A6 aendert NUR `placeCallDescription`, nicht das `objective`-Feld.
- Widget: `structuredContent` speist `WIDGET_CALL` (`src/ui/widgets/call.html`); ein zusaetzliches Feld ist additiv, das Widget liest namentlich (`:272-287`). Kein Handlungsbedarf, aber mitzupruefen.
- Flags/Env: KEINE neue Env-Variable (Frist und Fenster sind interne Bounds). Damit kein Eintrag in `.env.example`/`render.yaml` noetig - das ist ausdruecklich beabsichtigt, weil beide Werte Sicherheitseigenschaften tragen.
- Live-Konfiguration: unberuehrt. Der Schnitt wirkt auf beiden Engine-Zweigen (EL und TeXML), weil er VOR der Weiche (`src/routes/api-calls.js:480`) sitzt.
- Provider: keine Provider-API beruehrt.
- Geld: `s.reservations` bekommt einen zweiten Schreibpfad (A4). Das ist der Punkt mit dem hoechsten Schadenspotenzial in diesem Schnitt - eine doppelte Freigabe senkte die Reserve unter den Ist-Stand und hoehlte die pro-Tenant-Decke aus. Gegenmittel: Clamp >= 0, Aufruf ausschliesslich in den zwei benannten Pfaden (Dedup, Fehlerklammer), beide schliessen einander aus, und beide laufen nur, wenn KEIN Datensatz entstand.

## Beruehrte absolute Regeln

- **Regel 1 (Safety-Gates):** beruehrt, aber NICHT aufgeweicht. Die Kette bleibt 18 Glieder in unveraenderter Reihenfolge mit `reserve_budget` als letztem Glied (`src/telephony/outbound-gates.js:652-965`); der Claim liegt HINTER der vollstaendigen Kette und kann kein Gate ueberspringen. Die Aenderung ist strikt EINSCHRAENKEND: sie fuegt einen Fall hinzu, in dem NICHT gewaehlt wird. Kein Gate wird uebersprungen, gelockert oder per Default umgangen. Der neue Reserve-Freigabeweg gibt ausschliesslich zurueck, was derselbe Request selbst gebucht hat.
- **Regel 2 (Offenlegung):** nicht beruehrt. Ein deduplizierter Aufruf startet kein Gespraech; `calleeIsOwner`, `disclosureSentence` und der Offenlegungs-Sonderfall bleiben unangetastet.
- **Regel 3 (Auth fail-closed):** nicht beruehrt, kein neuer Endpunkt, `internalOnly` bleibt (`src/routes/api-calls.js:334`).
- **Regel 4/5 (Secrets/Audio):** neuer Audit-Eintrag traegt nur `to`, `call`, `tenant` - dieselben Felder wie der bestehende `place_call`-Audit (`:460-464`); neue Fehlertexte sind generisch.
- **Regel 6 (Scope):** eingehalten, s. Abhaengigkeiten fuer die bewussten Auslassungen.

## Abhaengigkeiten

- **Keine harte Vorbedingung.** Der Schnitt ist allein lauffaehig.
- **Kollision mit dem Schnitt zu P1-25** (`to_dialed`/`from` in der Antwort): beide erweitern `CALL_OUTPUT` (`src/mcp-tools.js:322-327`) und den Antwortkoerper `src/routes/api-calls.js:514-524`. Wer zweiter mergt, hat einen Textkonflikt an genau diesen zwei Stellen - inhaltlich additiv, kein Widerspruch.
- **NICHT in diesem Schnitt, bewusst:** (a) P1-22 in seiner allgemeinen Form - das Stundenlimit bleibt ueber VERSCHIEDENE Ziele TOCTOU-behaftet (`src/telephony/outbound-gates.js:364-378`); der Lock-Abschnitt aus A5 ist die vorbereitete Naht dafuer, die Wiederverwendung der Zaehler-Praedikate braucht aber einen Export aus `makeOutboundGates`. Die Gleich-Ziel-Haelfte von PP-D10-G1 ist mit A5 geschlossen. (b) Fristen fuer die zehn uebrigen Werkzeuge (T-27 in der Breite) - `cancel_call` haengt an einem eigenen Anbieter-Bound (`src/elevenlabs/convai.js:387-400`), den ich nicht gemessen habe. (c) Bestaetigungsschritt/Elicitation (P1-26, N-10), Annotationen (P0-1), Rate-Limit-Achse (P1-23), `answer_consult` als externe Aktion (PP-D10-G3), Nebenlaeufigkeits-Gate (PP-D10-09).
- **Owner-Entscheidung noetig** zu Preis 1 aus A3: ein absichtlicher zweiter Anruf an dieselbe Nummer innerhalb von 180 s waehrend eines laufenden Anrufs ist danach unmoeglich. Ich halte das fuer richtig; die Entscheidung gehoert aber dem Owner, weil sie eine Faehigkeit entfernt.

## Offene Fragen

- Wiederholt ein echter ChatGPT-Host einen `tools/call` nach Timeout automatisch, und nach welcher Frist? UNKNOWN (`tasks/openai-audit/10-externe-aktionen-missbrauch.md`, Offene Fragen). Davon haengt ab, ob 180 s Fenster reichen oder ob der Host lange vor unserer Frist abbricht - die Dedup-Wirkung ist von der Host-Frist UNABHAENGIG, die Nuetzlichkeit der Fehlermeldung aus A2 nicht.
- Worst-Case-Dauer von `fetchOpeningLine` nicht exakt belegt: `src/elevenlabs/opening-line.js` fuehrt keinen eigenen `timeoutMs`, der Wert entsteht im LLM-Seam aus `llmRequestTimeoutMs` 3500 + `llmMaxRetries` 2 + Backoff (`src/config.js:550-561`). UNKNOWN, ob der Backoff gedeckelt ist; die 180 s tragen die Rechnung nur, solange die Summe unter 60 s bleibt. Der Implementierer soll das am Seam nachlesen und die Konstante begruendet anheben, falls noetig.
- Gibt es heute haengengebliebene `active`-Datensaetze in Produktion (Preis 2)? Am Repo nicht entscheidbar; eine Zaehlung in der Prod-DB waere die Gegenprobe (`SELECT count(*) ... status='active' AND started_at < now() - interval '1 hour'`).
- Ob `test/helpers.js` eine Attrappen-Naht fuer einen Store-Fehler VOR `createCall` hergibt (Verifikation der Fehlerklammer), habe ich nicht belegt. Faellt das weg, bleibt fuer A5s `catch` nur ein Unit-Test der Freigabe-Operation - dann ist die Klammer nicht end-to-end verifiziert und der Punkt ist als NICHT umsetzungsreif zu fuehren.
