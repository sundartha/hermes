# Phase IEL-B4a: Persistierter Brueckenzustand

- **Gate:** PASS
- **finalBranch:** `phase/iel-b4a-brueckenzustand`
- **headCommit:** `80e089d942fe4d9d6911495abc28202d39252e75`
- **Basis:** `phase/iel-b3-prompt-variable` (5e93138)

## Plan (gekuerzt)

Ziel: der Brueckenzustand des EL-Inbound-Wegs (Bindung an eine ElevenLabs-Conversation, Rueckfall, Nachlauf-Start) wird persistiert statt nur im Prozess gehalten — ueberlebt einen Neustart, in json UND pg.

Kernbefunde vor der Umsetzung:
- **B-1 (Lint-Pins gelten auch fuer Commits):** `.githooks/pre-commit` prueft `eslint-legacy-exceptions.json` exakt. Spec-Signatur mit 4 Positionsargumenten verletzt `max-params` (F1) -> Objekt-Parameter `{conversationId, nowIso}` statt Positionsargumenten. Neue Spalten in `pg.js` ueber Modul-Ebene-Spread-Helfer, damit `rowToCall`/`callRowValues` unveraendert bleiben; `makePgStore` waechst um genau eine Spread-Zeile (Pin-Anhebung mit Begruendung).
- **B-2 (API-Projektion muss gleich bleiben):** `publicCall` in `views.js` muss die drei neuen Felder strippen, sonst sickern sie in `/api/state`, `/api/calls/:id`, den Art.-15-Export und `self-service/state` — trotz "keine API-View-Aenderung" im Scope, weil die Invariante "API-Projektion unveraendert" sonst bricht.
- **B-3 (Zeitspalten sind TEXT, Spec verlangt TIMESTAMPTZ):** Treiber liefert `Date`-Objekte zurueck -> Hydrierung braucht `instanceof Date ? toISOString() : ...`; unlesbarer String in TIMESTAMPTZ liesse `flushCalls` fuer den ganzen Tenant scheitern -> neue Operationen verwerfen jede nicht-kanonische ISO-Zeit (werfen nicht).
- **B-4 (Bindung nutzt `bridgeStateOf`):** "kein Rueckfall-Marker und keine Conversation-ID" = Definition von `WARTET` im Praedikat, nicht zweimal geschrieben (G5). Ein Call ohne Profil `TELNYX_INBOUND_EL_CONVAI` wird nie gebunden.
- **B-5 (Rueckgabeform der Wrapper):** alle drei Wrapper geben das volle Op-Ergebnis (`{call, changed, bound}`) zurueck statt nur `call`, weil spaetere Aufrufer (B4/B6/B8) darauf verzweigen muessen.
- **B-6 (Test-Isolation):** `src`-Imports im neuen Test laufen dynamisch in `before()`, nachdem `DATA_DIR` gesetzt ist; `json.js` wird fuer den Neustart-Test frisch re-importiert (`?seq=`).

Neue Datei `src/elevenlabs/inbound-bridge-state.js`: reines Praedikat `bridgeStateOf(call)` -> `BRIDGE_STATE` (`KEIN_EL_INBOUND`/`WARTET`/`GEBUNDEN`/`RUECKFALL`), Blatt-Modul ohne Store/IO-Abhaengigkeit.

Edits: `state-ops.js` (drei neue Felder in `createCall`, `setOnceTimestamp` mit optionalem Zeitparameter, `bindInboundElConversation`/`markInboundElFallback`/`markInboundElNachlaufStarted`, reine Hilfsfunktion `carrierEndMsOf`), `json.js` + `pg.js` (Feld-Defaults/Spalten, Wrapper mit Save-nur-bei-Aenderung), `schema.sql` (3 TIMESTAMPTZ-Spalten additiv + ALTER TABLE IF NOT EXISTS), `store.js` (Fassaden-Re-Export), `views.js` (Strip in `publicCall`), `eslint-legacy-exceptions.json` (Pin-Anhebung `makePgStore` 584->585, gemessen).

24 geplante Testfaelle (`test/iel-b4a-brueckenzustand.test.js`, IEL-B4a-0..23): Positiv-Kontrolle, Zustandstabelle (8 Kombinationen), Fremdprofile, Altdatensatz/undefined, `carrierEndMsOf`-Grenzfaelle, Set-once-Semantik (beide Marker), ungueltige Eingaben, Bindung aus WARTET/idempotent/verweigert bei anderer ID/nach Rueckfall/an Nicht-EL-Call, Rueckfall nach Bindung, `createCall`-Initialwerte, API-Projektion, JSON-Wrapper + Neustart + Altdatensatz-Hydrierung, pg-Neustart + Paritaet, Folge-Flush setzt nicht zurueck, Bestandstabellen-Migration per ALTER, Fassaden-Durchreichung.

Pre-Mortem im Plan deckte ab: Zustandsverlust nach Deploy (Tests 20/21), Flush-Abbruch durch unlesbare Zeit (ISO-Wache, Tests 7/14), json/pg-Drift bei `Date`-Objekten (`isoZeitpunktOderNull`, Test 20), API-Leck (views.js, Test 16), Fehlbindung an Budget-Calls (`bridgeStateOf`, Test 13), Hook-Ablehnung durch Pin-Drift (Messbefehl in Abschnitt 4), falsche Budget-Buchung durch `carrierEndMsOf` (fail-closed auf `nowMs`, kein Aufrufer in B4a).

Keine Route, kein Aufrufer, kein Timer im Scope — Safety-Gates, Offenlegung, Auth, Inbound-TeXML und Outbound-Verhalten bleiben unberuehrt; neue Spalten stehen auf NULL und sind wirkungslos.

## Impl-Zusammenfassung

Exakt nach Plan umgesetzt. Neues Blatt-Modul `src/elevenlabs/inbound-bridge-state.js` mit `bridgeStateOf`/`BRIDGE_STATE`. Drei neue Store-Operationen in `state-ops.js` (`bindInboundElConversation`, `markInboundElFallback`, `markInboundElNachlaufStarted`) plus reine Hilfsfunktion `carrierEndMsOf` — alle noch ohne Aufrufer in dieser Phase. Drei neue TIMESTAMPTZ-Spalten (additiv, nullable, kein Backfill) durchgezogen durch `json.js`, `pg.js` (inkl. Migrations-ALTER, Flush-SQL, Wrapper-Paritaet), `schema.sql`, `store.js`-Fassade und `publicCall` in `views.js`.

Neuer Test `test/iel-b4a-brueckenzustand.test.js`: 24 Faelle (IEL-B4a-0..23) gegen beide Backends (json, pglite). Alle gruen, ebenso die Bestandsparitaetstests aus Plan Abschnitt 4 (82 gesamt). Volle Testbank: **5631 pass, 0 fail**. Lint: 0 Fehler (69 unveraenderte Bestandswarnungen). `check-staged-suppressions.js` fuer beide angehobenen Dateien: Exit 0. Grep-Scope-Kontrolle exakt getroffen (5 Dateien mit den neuen Symbolen). Schema-Greps (3 CREATE-TABLE-Spalten, 3 ALTER-Statements) bestaetigt.

Kein Route-/Aufrufer-Code beruehrt: Inbound-TeXML, Outbound-Verhalten, Safety-Gates (Kostendecke, Offenlegung, Auth) und Budget-Engine unangetastet — neue Spalten stehen auf NULL und sind ohne Aufrufer wirkungslos, exakt wie im Plan-Premortem vorgesehen.

**headCommit:** 80e089d, Branch `phase/iel-b4a-brueckenzustand` (Basis `phase/iel-b3-prompt-variable`).

`smokePass: false` — begruendet: Server-Boot ohne vollstaendig geseedeten Tenant/Nummer bricht mit "Keine aktive Nummer im Store" ab (boot-guard fail-closed, unabhaengig von dieser Phase). Diese Phase fuegt nur Store-Primitive ohne neue Route/Aufrufer hinzu (per Plan/NICHT-Scope) — kein `/voice`-Endpunkt betroffen, daher kein sinnvoller kurativer curl-Smoke ohne kompletten Bootstrap-Aufwand ausserhalb des Scopes. `node --check` auf allen 6 geaenderten/neuen `.js`-Dateien gruen, volle Testbank gruen — das ist die im Plan (Abschnitt 4) vorgesehene deterministische Verifikation.

### Dateien
- **Neu:** `src/elevenlabs/inbound-bridge-state.js`, `test/iel-b4a-brueckenzustand.test.js`
- **Editiert:** `src/store/state-ops.js`, `src/store/json.js`, `src/store/pg.js`, `src/store.js`, `src/store/views.js`, `src/db/schema.sql`, `eslint-legacy-exceptions.json`, `test/check-staged-suppressions.test.js`

### Deviations vom Plan

1. **eslint-legacy-exceptions.json fuer state-ops.js doch angefasst, aber anders geloest als B-1(d) vorsah:** statt eines neuen `max-lines-per-function`-Pins fuer `createCall` (101 Zeilen durch 3 separate `elBoundAt: null,`-Zeilen) wurden die drei Feldzuweisungen auf EINE Zeile zusammengezogen. `createCall` bleibt dadurch unter 100 Zeilen, der `state-ops.js`-Eintrag in `eslint-legacy-exceptions.json` bleibt WIRKLICH unveraendert wie urspruenglich im Plan verlangt.
2. **Zusaetzliche, vom Plan nicht genannte Datei angefasst:** `test/check-staged-suppressions.test.js`. Grund: die Datei traegt einen wortgleich gespiegelten Fingerprint (`LEGACY_FINGERPRINT`) von `eslint-legacy-exceptions.json` als eigenen Regressionstest — jede legitime Pin-Anhebung muss den Fingerprint nachziehen, sonst schlaegt dieser Test fehl (am echten Lauf verifiziert: erst rot, nach identischem Nachzug gruen). Historische Kommentare in derselben Datei zeigen, dass das etablierte Praxis ist.
3. **Test 1 (Zustandstabelle)** nutzt im finalen Code String-Schluessel statt `BRIDGE_STATE`-Werte direkt in der Tabellen-Konstante (Modul-Top-Level-Auswertung laeuft vor `before()`/dem dynamischen Import) — im Plan nicht explizit vorgegeben, aber noetig fuer das table-driven Muster; funktional identisch zum Plan-Intent.

### Clean-Code Selbst-Check (Impl)

G5 (keine Duplizierung): drei Set-once-Marker ueber EINE Fabrik (`markOnceAt`) statt Kopien; `brueckenZustandFelder`/`-Werte`/`-Mutatoren` als Spread-Helfer in `pg.js` halten `rowToCall`/`callRowValues`/`makePgStore` unter ihren gepinnten Komplexitaeten. G25 (Magic Numbers): keine neuen nackten Zahlen ausser 0/1/-1 in Produktionscode; Test-Konstanten benannt. F1 (<=3 Argumente): `bindInboundElConversation` nimmt Objekt-Parameter statt 4 Positionsargumenten. C5/G9: kein toter/auskommentierter Code. N7: Mutations-Funktionen benennen die Mutation explizit; `bridgeStateOf`/`carrierEndMsOf` sind rein und tragen keine get-Fehlbezeichnung. G30/G34: `bindInboundElConversation` delegiert die Zustandsfrage an `bridgeStateOf` statt sie zu wiederholen. P11: neues Verhalten hat 24 Testfaelle; reine Refactors (`setOnceTimestamp`-Default-Parameter) lassen die Bestandssuite unveraendert gruen.

## Safety-Urteil

**verdict: PASS, approved: true**, keine Blocker. Alle Kernpruefungen bestanden (`testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`).

Unabhaengige Nachpruefung: Worktree `review-iel-b4a` von `phase/iel-b4a-brueckenzustand` (80e089d), Vorfahre `phase/iel-b3-prompt-variable`. `node --check` fuer alle 6 geaenderten src-Dateien fehlerfrei. Lauf 1 (`--test-concurrency=4`, Zielgruppe inkl. `iel-b4a-brueckenzustand`, `check-staged-suppressions`, `store-pg-json-parity`, `store-backend-parity`, `api-read-parity`, `el-detektor-zaehlfeld-pg`, `sec-p1-webhook-anker-persistenz`, `store-json-migrate-shapes`, `schema-foundation`): 127/127 pass. Lauf 2 (Gegenprobe: `iel-incoming-golden`, `iel-b1-schalter`, `iel-b3-variable`, `sec-p1-webhook-idempotenz`, `inbox-store-parity`): 60/60 pass. eslint auf geaenderte Dateien: 0 errors. Fingerprint-Messung `makePgStore=585` stimmt mit Pin ueberein. Diff-Pruefung: keine Aenderung an `claude.js`, Routen, `config.js`, package.json/Lockfile, Gates oder Auth.

Concerns (nicht blockierend, Hinweise fuer Folgephasen):
- Signaturabweichung von der Spec (Objekt- statt Positionsparameter), begruendet mit F1; B6 muss die Objektform verwenden.
- `views.js` und `eslint-legacy-exceptions.json` (+ Spiegel in `check-staged-suppressions.test.js`) standen nicht in der Spec-Dateiliste, waren aber noetig — nachgemessen und dokumentiert.
- `markInboundElFallback`/`markInboundElNachlaufStarted` pruefen weder Profil noch Status (laut Spec so gewollt, set-once ohne Vorbedingung); `bindInboundElConversation` prueft nicht `status==='active'` — diese Pruefung muss die Init-Route (B6) leisten.
- Neue `no-unused-vars`-Warnung in `views.js` (3x), folgt dem bestehenden Strip-Muster, nur Warnung, kein Fehler.

## Clean-Code-Audit (final)

- **s1:** keine Befunde
- **s2:** keine Befunde
- **s3:** keine Befunde — Benennung durchgaengig sprechend (`bridgeStateOf`, `BRIDGE_STATE`, `markOnceAt`, `istKanonischerIsoZeitpunkt`), Kommentare pruefen sauber gegen den Code
- **s4 (informativ, kein Blocker):**
  1. **F4-INFO** `state-ops.js:1002` (`carrierEndMsOf`): reine Funktion ohne Aufrufer im Scope dieser Phase — bewusst so im Kommentar vermerkt, Verdrahtung ist laut Spec (E7/E17) explizit einer Folgephase (B4/B5) zugewiesen, voll testabgedeckt (Test IEL-B4a-4). Im naechsten Merge beobachten, dass der Aufrufer tatsaechlich folgt.
  2. **G5-INFO** `json.js:619-623` vs. `pg.js:180-183` (`speichereBeiAenderung`): identischer 3-zeiliger Helfer einmal je Backend-Datei — entspricht dem etablierten Wrapper-Paritaets-Muster zwischen json.js/pg.js, keine neue Duplizierung, kein Fix draengend (Cross-Backend-Extraktion wuerde einen bewusst vermiedenen Import erzwingen).

**verdict: PASS, blocker: false.** Saubere Trennung Objekt/Praedikat (P7), F1 eingehalten, G33-Konvention beachtet, G22 vermieden (Feldliste je Backend nur einmal ueber Modul-Ebene-Konstanten). Ueberdurchschnittlich vollstaendige Testabdeckung (Zustandstabelle, Fremdprofile, Altdatensatz-Hydrierung, Grenzfaelle, Set-once-Idempotenz, ungueltige Eingaben, Neustart in beiden Backends, Bestandstabellen-Migration, Fassaden-Durchreichung). Keine Magic Numbers ohne Konstante, kein toter/auskommentierter Code, keine abgeschalteten Sicherungen.

Top-Todos: beim naechsten Merge (B4/B5) pruefen, dass `carrierEndMsOf` tatsaechlich verdrahtet wird — sonst verstaerkt sich der F4-Hinweis zu einem echten Befund. Keine harten Blocker offen, Phase mergefaehig.

## Security-Review (final)

**verdict: PASS, approved: true**, keine Blocker. Reine Persistenz-Erweiterung: keine neue/geaenderte Route, kein Aufrufer, kein Timer, keine Logausgabe, keine Secrets, keine neue Dependency, kein Eingriff in Safety-Gates, Offenlegung, Signaturpruefung oder Outbound; `route-auth-inventory` bleibt unberuehrt.

Datenabfluss: `publicCall` entfernt die drei neuen Felder aus API-/MCP-Ausgaben (Test 16). Tenant-Trennung: neue Spalten in bestehender `call`-Tabelle mit RLS, Upsert vollstaendig (Test 21: Folge-Speicherung setzt Marker nicht auf NULL zurueck). Bindung fail-closed: nur `WARTET` + EL-Inbound-Profil wird gebunden (Tests 10/11/13/14). Schema additiv/nullable, kein Backfill. `setOnceTimestamp` nur um optionalen dritten Parameter erweitert, Bestandsaufrufer unveraendert.

Unabhaengige Verifikation per `git archive` im Scratchpad: `iel-b4a-brueckenzustand`, `store-pg-json-parity`, `route-auth-inventory` 68/68 gruen; weitere Store-/Paritaetstests gruen (inkl. `api-read-parity`, DSGVO-Export, `store-backend-parity`). 3 Fails in `check-staged-suppressions.test.js` NUR wegen fehlendem Git-Repo im Archiv (`git read-tree HEAD` scheitert dort strukturell) — keine echte Regression. Volle `npm test`-Suite in diesem Review-Lauf nicht ausgefuehrt (separat durch Safety-Review und Impl abgedeckt).

Concerns (Hinweise fuer Folgephasen, kein Befund in B4a):
- `bindInboundElConversation` prueft weder `call.status==='active'` noch Eindeutigkeit der `conversationId` ueber Calls hinweg — heute von aussen nicht erreichbar (kein Aufrufer, ElevenLabs vergibt die ID, Bindungs-Token als Barriere Stufe 2), B6 muss die Pruefung auf aktiven Call selbst erzwingen (Spec: "Token eines nicht aktiven Calls -> 404").
- `conversationId` wird nur auf nicht-leeren String geprueft, keine Laengen-/Zeichensatzgrenze — B6 sollte das vor dem Op-Aufruf begrenzen (Wert kommt aus dem Body eines oeffentlichen Webhooks).
- `getCall` trifft auch `call.twilioSid` — kuenftige Aufrufer (B6/B8) sollten die `callId` ausschliesslich aus der Token-Zuordnung beziehen.
- `markOnceAt` verwirft stillschweigend nicht-kanonische Zeit (`changed:false`) — B8 sollte das Ergebnis pruefen/testen, sonst bleibt der RUECKFALL-Marker bei einem versehentlich uebergebenen `Date`-Objekt ungesetzt (fail-open Richtung Bindung).
- `carrierEndMsOf` liefert `NaN` bei unlesbarem Marker (fail-closed fuer Live-Term) — B4 sollte den NaN-Fall beim Ende-Anker ausdruecklich behandeln.

## Fix-Runden

Keine — der Review-Zyklus (Impl -> Safety -> Clean-Code -> Security) ergab direkt PASS ohne Blocker. Keine Fix-Runde noetig.
