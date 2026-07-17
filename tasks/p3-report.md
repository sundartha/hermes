# Phase P3 — Detailbericht

**Titel:** Fehler-/Fehlkonfigurations-Pfade strukturell absichern (Shutdown-Flush, Corrupt-Store, Redrive-Cap, Demo-Seed)
**Gate:** PASS
**finalBranch:** `phase/cc-p3-failclosed-paths`
**Basis:** `master` @ `1d7992f` (P1+P2 bereits gelandet)
**headCommit (Worktree):** `63a0835aac84ae7758b3fa76f6b5999d6a7483dc`

---

## 1. Ausgangslage / Ziel

P3 adressiert vier unabhaengige Fail-closed-Luecken in Fehler- und Fehlkonfigurations-Pfaden:

- **S1-2** — ein fehlgeschlagener finaler Store-Flush beim Shutdown (pg-Backend) wurde bislang nur geloggt, nie an den Aufrufer durchgereicht — `gracefulShutdown` endete mit `exit(0)`, obwohl der letzte Flush fehlgeschlagen war (stiller Datenverlust).
- **S1-4** — ein korruptes `store.json` wurde bislang immer mit Defaults ueberschrieben, auch wenn die forensische `.corrupt-<ts>`-Sicherung selbst fehlschlug (z.B. nicht-schreibbares `dataDir`) — dann ging das korrupte Original ohne Backup verloren.
- **S1-3** — `PROVISIONING_REDRIVE_MAX_AGE_MS` war unklemmt konfigurierbar; ein zu grosser Wert oeffnet das Anbieter-Idempotenzfenster (Stripe-Hold) und damit einen Doppelkauf-Pfad.
- **S1-12** — `seedDefaults()` in `src/db/migrate.js` fuegte `calendar_event`-Demo-Zeilen ohne `ON CONFLICT` ein; `calendar_event.id` ist ein globaler PK mit festen Demo-IDs (`ev1`/`ev2`/`ev3`) — ein zweiter, parallel bootender Tenant kollidiert am PK und crasht den Seed.

## 2. Plan (gekuerzt)

### Load-bearing Discovery (aendert das S1-4-Design gegenueber dem Plantext)

Der urspruengliche Plantext scoped S1-4 auf `json.js` allein ("throw fail-closed"), mit DoD "exit != 0". Empirisch widerlegt: `src/process-guards.js` installiert einen `uncaughtException`-Handler, der **loggt, aber nie exit't** (bewusste, dokumentierte Entscheidung — andere Calls bleiben am Leben). `store.load()` laeuft innerhalb von `bootServer(...)`, awaited am Modul-Top-Level (`src/server.js:185`). Realer Test gegen einen korrupten + nicht-schreibbaren Store zeigte: Der Boot-Throw wird vom Guard geschluckt, Prozess endet mit **Exit 0** (lautloser Boot-Tod), nicht mit einem Fehlercode.

**Konsequenz:** S1-4 muss eine **Zwei-Datei**-Aenderung sein (wie S1-2): `json.js` wirft (rein, kein Wipe), `boot.js` wandelt den Throw in ein sichtbares `process.exit(1)` um. `boot.js` war bereits im deklarierten 5-Dateien-Set von P3 enthalten und spiegelt das bestehende Boot-Gate-Muster der Datei (`fakeOriginate`/`hasActiveNumber`/`meterGaps`: alle `console.error`+`process.exit(1)`).

Zusaetzlich empirisch validiert:
- `ON CONFLICT (id) DO NOTHING` no-opt still, auch wenn die kollidierende Zeile unter pglite-RLS eines anderen Tenants unsichtbar ist; ein reines INSERT wirft `duplicate key ... calendar_event_pkey`.
- Ein frischer In-Process-`import("../src/config.js?tag")` liest `process.env` pro Instanz neu; unter `NODE_ENV=test` ist dotenv aus (keine `.env`-Interferenz) — heute unclamped 86400000 -> mutation-sensitiv.

### Geplante Edits

**FILE A — `src/store/pg.js` (S1-2, Teil 1/2):**
Neue Closure-Variable `lastFlushError` neben `flushChain`. `save()` bekommt einen Zwei-Arm-`.then`: Erfolgsarm loescht `lastFlushError` (Clear-on-Success — Voll-Upsert-Semantik, nur der letzte Flush zaehlt), Fehlerarm setzt ihn (die Kette selbst bleibt immer resolving, Aufrufer-Verhalten unveraendert). `drainFlushes()` wirft `lastFlushError` am Ende, falls gesetzt.

**FILE B — `src/boot.js` (S1-2 Teil 2 + S1-4):**
`store.load()` in `try/catch` -> bei Fehler `console.error` + `process.exit(1)` (mit Begruendung zum uncaughtException-Netz im Kommentar). Die Shutdown-Closure wird aus dem Funktionskoerper in eine injizierbare, top-level exportierte Fabrik `makeGracefulShutdown({ httpServer, store, config, exit, log, logError })` extrahiert (testbar mit Stub-Store + Exit-Spy, ohne echten Prozess-Exit). Ordering bleibt: `close()` (mit `closeIdleConnections()`) -> `store.save()` + `store.drainFlushes()` -> bei Fehler `exit(1)` mit lautem Log, sonst `exit(0)`. `shuttingDown`-Guard bleibt gegen Wiedereintritt.

**FILE C — `src/store/json.js` (S1-4 + S1-2-Paritaets-Kommentar):**
Der korrupte Zweig wirft neu, wenn die `.corrupt-<ts>`-Sicherung (`fs.renameSync`) selbst fehlschlaegt — Defaults+`save()` nur noch bei erfolgreicher Sicherung. Ehrliches Log ("Sicherung FEHLGESCHLAGEN ... Original bleibt unter FILE") ersetzt das alte irrefuehrende "umbenannt"-Paar auf dem Fehlerpfad. `drainFlushes()`-Kommentar (No-Op) aktualisiert auf den neuen Vertrag.

**FILE D — `src/config.js` (S1-3):**
`provisioningRedriveMaxAgeMs`-`numEnv`-Option bekommt `max: MS_PER_DAY - 1` (bestehende Konstante, kein neuer Env-Wert, `-1` im erlaubten Magic-Number-Set). Klemmung statt Boot-Refusal, Schwestermuster wie `maxCallDurationS`.

**FILE E — `src/db/migrate.js` (S1-12):**
`calendar_event`-INSERT in `seedDefaults()` bekommt `ON CONFLICT (id) DO NOTHING`, analog zu den drei Geschwister-Inserts der Funktion.

**FILE F — `test/helpers.js` (minimal, begruendete Abweichung):**
`startServerExpectExit()` bekommt einen optionalen `dataDir`-Reuse-Parameter (spiegelt den bestehenden `startServer`-Parameter), noetig fuer den S1-4-Kindprozess-Test gegen ein nicht-schreibbares `dataDir` — Alternative (inline Spawn) waere G5-Duplikation.

### Geplante Tests (T1-T5)

- **T1** `test/store-pg-drain-flushes.test.js`: neuer Fall — `drainFlushes()` wirft bei fehlgeschlagenem letztem Flush, cleart nach folgendem Erfolg (Clear-on-Success-Zyklus); bestehender Fall bleibt gruen.
- **T2** `test/graceful-shutdown.test.js`: zwei neue fokussierte Unit-Faelle fuer `makeGracefulShutdown()` — rejectender Flush -> genau ein `exit(1)` + lauter Alarm; erfolgreicher Flush -> genau ein `exit(0)`. Bestehende Spawn-Tests bleiben der Regression-Anker.
- **T3** `test/config-failclosed.test.js`: neuer Fall — Clamp exakt 86400000 -> 86399999, Randwert 86399999 unveraendert, 0 bleibt 0, kein Fatal.
- **T4** `test/store-integrity.test.js`: neuer Fall T-P1-03b — korrupt + nicht-schreibbares `dataDir` -> `exit != 0`, Original byte-identisch, kein `.corrupt`-Backup, kein `.tmp`, ehrliches Log ("Sicherung FEHLGESCHLAGEN"), kein Luegen-Log ("umbenannt"). Bestehender T-P1-03 (schreibbares Verzeichnis) bleibt gruen.
- **T5** `test/store-pg.test.js`: neuer Fall — zweiter Tenant-Seed kollidiert nicht mehr am globalen `calendar_event`-PK; Idempotenz-Gegentest; genau 3 Owner-Demo-Events, keine Duplikate. Mutation-verifiziert rot ohne den `ON CONFLICT`-Fix.

### Deterministische Verifikation

`node --check` auf allen fuenf src-Dateien + Helper; fokussierte Laeufe je Testdatei; volle Suite `npm test` (Erwartung: `fail 0`, Gesamtzahl >= Baseline 2318 + 5); Boot-Smoke (`SKIP_TWILIO_SIGNATURE_CHECK=true npm start` + `curl /healthz`); Grep-Belege fuer `lastFlushError`, `max: MS_PER_DAY - 1`, `ON CONFLICT (id) DO NOTHING`, `makeGracefulShutdown`.

### Clean-Code-Compliance (geplant)

G5/S2 (keine Duplikation: `lastFlushError` eine Quelle, `makeGracefulShutdown` injiziert statt kopiert, ein `clearTimeout`+`return`, `dataDir`-Helper statt zweiter Spawn-Definition); G25 (keine Magic Numbers ausser 0/1/-1: `MS_PER_DAY - 1`, benannte Testdatei-Modes); G35 (Redrive-Clamp lebt in `config.js`, kein neuer Env-Wert); N7 (`makeGracefulShutdown`/`backedUp` machen Absicht/Effekt explizit); F1 (Options-Objekt bzw. 1 Argument); G30/G34/P15 (Shutdown-Closure als injizierbare Fabrik = DIP/Testbarkeits-Verbesserung); C2/C5/G9/G12 (ehrliche Kommentare, kein toter Code); P16 (`lastFlushError` auf derselben serialisierten `flushChain`, `ON CONFLICT` ersetzt Check-then-Act durch DB-Struktur-Garantie).

### Pre-Mortem / akzeptierte Risiken / Deviations (geplant)

- **Deviation 1 (verlangt):** S1-4 fasst auch `boot.js` an, nicht nur `json.js` — empirisch begruendet (uncaughtException-Netz schluckt sonst den Boot-Throw, Exit 0 statt DoD-`exit != 0`).
- **Deviation 2 (geflaggt):** `test/helpers.js` bekommt optionalen `dataDir`-Parameter — rueckwaertskompatibel, Alternative waere G5-Duplikation.
- **S1-4 Verfuegbarkeits-Trade-off (akzeptiert):** Fail-closed-Throw macht aus einem wiederherstellbaren korrupten Store einen Boot-Fehler (exit 1) — bewusst, Alternative waere unwiederbringlicher Datenverlust.
- **S1-2 Restart-Loop (akzeptiert):** `exit(1)` nur bei einem *fehlgeschlagenen* (rejectenden) letzten Flush; ein *haengender* Flush trifft weiterhin den Watchdog-`exit(0)`. Auf Render wird die Instanz ohnehin ersetzt — der Gewinn ist Sichtbarkeit.
- **S1-3 stiller Clamp (akzeptiert):** kein Boot-Refusal, aber der Doppelkauf-Pfad ist strukturell unmoeglich; konsistent mit Schwester-Clamps.
- **S1-12 (akzeptiert):** Demo-Events sind ueber einen globalen PK verschluesselt; der Seed eines zweiten Tenants no-opt (0 Kalenderzeilen fuer diesen Tenant) statt zu crashen — vorbestehendes Design, ausserhalb des P3-Scopes; der Fix entfernt nur den Crash.

**DoD:** `node --check` sauber auf allen fuenf src-Dateien; `npm test` 0 Fails inkl. der fuenf neuen/erweiterten Faelle; Boot-Shutdown-Unit-Test: rejectender Flush -> `exit(1)`, Erfolg -> `exit(0)`.

## 3. Implementierung — Zusammenfassung

Exakt gemaess Plan umgesetzt, Branch `phase/cc-p3-failclosed-paths` von `master`@`1d7992f` abgezweigt, Commit `63a0835`.

- **`src/store/pg.js`**: `lastFlushError`-Closure-Variable, `save()` mit Zwei-Arm-`.then` (Clear-on-Success / Set-on-Error), `drainFlushes()` wirft `lastFlushError` am Ende der Loop.
- **`src/boot.js`**: `store.load()` in `try/catch` -> `process.exit(1)` mit ehrlichem Log; `makeGracefulShutdown()` als injizierbare Top-Level-Fabrik extrahiert (Watchdog-Timeout, `closed`-Promise via `httpServer.close`, `closeIdleConnections()`, `store.save()`+`store.drainFlushes()` im selben `try/catch`, `exit(1)`+lauter Log bei Fehler, sonst `exit(0)`); Wiring (`SIGTERM`/`SIGINT`) bleibt unveraendert.
- **`src/store/json.js`**: Korrupter Zweig wirft nur noch bei fehlgeschlagener `.corrupt-<ts>`-Sicherung (Original bleibt unveraendert, ehrliches Log); Defaults+`save()` nur bei erfolgreichem Rename; `drainFlushes()`-Kommentar auf den neuen Backend-Paritaets-Vertrag aktualisiert (Body bleibt No-Op).
- **`src/config.js`**: `provisioningRedriveMaxAgeMs` bekommt `max: MS_PER_DAY - 1`.
- **`src/db/migrate.js`**: `calendar_event`-INSERT in `seedDefaults()` bekommt `ON CONFLICT (id) DO NOTHING`.
- **`test/helpers.js`**: `startServerExpectExit()` bekommt optionalen `dataDir`-Reuse-Parameter (additiv, bestehende Aufrufer unberuehrt).
- **Neue/erweiterte Tests**: `test/store-pg-drain-flushes.test.js`, `test/graceful-shutdown.test.js` (2 neue Faelle), `test/config-failclosed.test.js`, `test/store-integrity.test.js` (T-P1-03b), `test/store-pg.test.js` (S1-12).

### Ergebnisse

- `node --check` sauber auf allen 6 betroffenen src-Dateien.
- Volle Suite: **2324 pass / 0 fail** (Baseline 2318 + 6 neue/erweiterte Faelle).
- Ein Voll-Lauf zeigte einen einzelnen unrelated Fail in `test/p2-onboard-retry.test.js` (401 vs. 403, trusted-localhost Auth-Pfad), unberuehrt von P3s Diffs; isoliert gruen, sauberer Voll-Lauf-Rerun (2324/2324) bestaetigte pre-existing Voll-Last-Flake (dokumentierte Flake-Klasse), kein Regress.
- Smoke-Test: `SKIP_TWILIO_SIGNATURE_CHECK=true npm start`-Aequivalent bootete, `curl /healthz` -> `{"ok":true}`; echtes `SIGTERM` gegen den laufenden Prozess durchlief den sauberen Erfolgspfad end-to-end (`[shutdown] Signal SIGTERM ...` -> Exit 0, Port nicht mehr belegt) — exerziert `makeGracefulShutdown()`s Erfolgsarm real, nicht nur Stub-Tests.
- `node_modules`-Symlink gitignored, nicht committet. Nur die 11 geplanten/geflaggten Dateien staged und committet.

### Deviations

1. **DEVIATION 1 (plan-verlangt, empirisch begruendet):** S1-4 fasst auch `src/boot.js` an, nicht nur `json.js` wie im urspruenglichen Plantext gescoped. Empirisch verifiziert: `process-guards.js` installiert einen `uncaughtException`-Handler, der loggt, aber nie exit't (bewusste, dokumentierte Entscheidung) — ein blosser Throw aus `store.load()` innerhalb von `bootServer` waere geschluckt worden, Prozess haette lautlos mit Exit 0 geendet und den DoD (`exit != 0`) verfehlt. `boot.js` umschliesst `store.load()` jetzt in `try/catch` -> `process.exit(1)` mit ehrlichem Log. Deckt sich mit dem Plan-eigenen "0. LOAD-BEARING DISCOVERY"-Abschnitt, der diese Korrektur explizit verlangt.
2. **DEVIATION 2 (plan-geflaggt, angewendet):** `test/helpers.js` bekam einen optionalen `dataDir`-Parameter auf `startServerExpectExit` (spiegelt das bestehende `startServer`-Muster), um den S1-4-Kindprozess-Test gegen ein nicht-schreibbares `dataDir` zu unterstuetzen, ohne die ~15-zeilige Spawn-/Exit-Capture-Logik zu duplizieren. Rueckwaertskompatibel, bestehende Aufrufer unberuehrt.
3. Ein Voll-Suite-Lauf zeigte einen einzelnen unrelated Fail in `test/p2-onboard-retry.test.js`, unberuehrt von jeglichem Diff dieser Phase; isoliert gruen, sauberer Rerun (2324/2324) bestaetigte einen pre-existing Voll-Last-Flake, keinen Regress. Kein Code-Change dafuer (ausserhalb des P3-Scopes).

### Clean-Code-Selbstcheck (Impl)

- **G5/S2** (keine Duplikation): `lastFlushError` einzige Quelle; `makeGracefulShutdown` per Injection wiederverwendet, nicht kopiert; ein `clearTimeout`+`return`-Standort vermeidet `exit(0)`/`exit(1)`-Fall-through-Duplikation; `dataDir`-Helper-Parameter vermeidet zweite Spawn-Testdefinition; der S1-4-Test nutzt `startServerExpectExit` wieder.
- **G25** (keine Magic Numbers ausser 0/1/-1): `MS_PER_DAY-1` nutzt die vorbestehende benannte Konstante; neue Testdatei-Modes benannt (`READ_EXEC_NO_WRITE`, `OWNER_RWX`).
- **G35** (Config lebt in `config.js`): Redrive-Clamp ist die einzige `rawConfig`-Aenderung, kein neuer Env-Wert.
- **F1** (<=3 Argumente): `makeGracefulShutdown` nimmt ein Options-Objekt, der zurueckgegebene Handler ein Argument (`signal`).
- **N7** (Nebeneffekte im Namen): `makeGracefulShutdown`-Fabrikname und `backedUp`-Boolean machen Absicht/Effekt explizit.
- **P15** (kein Lazy-Init-Antipattern): Die Shutdown-Closure wurde aus dem Boot-Funktionskoerper in eine injizierbare, top-level exportierte Fabrik gehoben — verbessert Testbarkeit, statt versteckte Konstruktionslogik hinzuzufuegen.
- **C2/C5/G9/G12**: ehrliches aktualisiertes Log in `json.js` (die vorherige luegende "umbenannt"/"corrupt-Rename fehlgeschlagen"-Paarung auf dem Fehlerpfad entfernt), kein toter/auskommentierter Code, keine ungenutzten Imports (verifiziert per `node --check` auf allen betroffenen Dateien + vollem gruenen Testlauf).
- Jedes neue Verhalten hat einen automatisierten `node:test`-Fall; die reine Kommentar-Aktualisierung in `json.js` (C2) brauchte keinen. ESM, kein Build-Step, kein TypeScript, deutsche Kommentare ohne Umlaute durchgehend.
- Keine Sicherheits-/Auth-/Budget-Gate geschwaecht — S1-3 verschaerft das Doppelkauf-Guard; keine Secrets geloggt (nur Pfade/Fehlermeldungen, bestandskonform).

## 4. Safety-Urteil (final)

**APPROVED.**

- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `scopeRespected`: true
- `behaviorAsIntended`: true
- `blockers`: keine

**Concerns (nicht blockierend):**

1. Voller Suite-Lauf: 2324 Tests, 2323 pass, 1 fail. Die einzige Rotmeldung (`test/telnyx-event-ingest-route.test.js:49` "call.hangup Settlement idempotent") ist der dokumentierte pre-existing Voll-Last-Flake (Seed-vor-Boot/Settlement-Race): 3/3 gruen in Isolation, liegt in einer nicht von P3 beruehrten Datei, laeuft json-Backend (P3s pg.js/json.js-Corrupt-Pfad wird dort gar nicht ausgefuehrt), P3 fasst keinen Settlement-Code an. Kein P3-Regress.
2. `boot.js`: die `makeGracefulShutdown`-Fabrik-Extraktion geht ueber die reine try/catch-Vorgabe hinaus, ist aber verhaltens-erhaltend und durch den vom Auftrag verlangten fokussierten Boot-Test (Stub-Store + Exit-Spy) gerechtfertigt; `SIGTERM`/`SIGINT`-Registrierung unveraendert. `exit=process.exit` als Default detached aufrufbar (empirisch: Exit-Code 3 verifiziert).
3. S1-2 Clear-on-Success verifiziert unbedenklich: `flush()` ist ein `BEGIN`/`COMMIT`-Voll-Snapshot-Upsert (alle Tenants + globale Profiles, Rollback-on-Error) -> ein spaeterer erfolgreicher Flush re-persistiert den kompletten State und ueberschreibt jeden frueher fehlgeschlagenen; kein maskierter Datenverlust.

**Unabhaengiger Testlauf** (frischer Worktree, `node_modules`-Symlink war zirkulaer `./node_modules`->self, auf das echte Repo-`node_modules` umgebogen, danach pglite/jose aufloesbar):

- Voller `npm test`: 2324 Tests / 2323 pass / 1 fail (o.g. Flake, 3/3 gruen isoliert = kein P3-Regress).
- Alle P3-Testdateien isoliert 50/50 gruen: S1-3-Clamp (24h -> 24h-1ms, 0 bleibt 0, kein Fatal), S1-2 `gracefulShutdown` (Reject -> genau ein `exit(1)`+Alarm, Erfolg -> genau ein `exit(0)`), S1-2 `drainFlushes` (wirft bei fehlgeschlagenem letztem Flush, cleart nach Erfolg, Happy-Path gruen), S1-4 korrupt+non-writable `dataDir` (`exit != 0`, Original byte-identisch, kein `.corrupt`-Backup, kein `.tmp`, "Sicherung FEHLGESCHLAGEN" geloggt, kein "umbenannt"-Luegenlog), S1-12 zweiter Tenant-Seed keine PK-Kollision, `calendar_event` genau 3 Zeilen.
- `node --check` gruen fuer alle 5 src-Dateien. `process.exit` detached aufrufbar bestaetigt.

**Begruendung (Kurzfassung):** Alle 4 Fail-closed-Fixes (S1-2 Shutdown-Flush ueber `pg.js`+`boot.js` kohaerent, S1-4 Corrupt-Store fail-closed ohne stillen Wipe, S1-3 Redrive-Clamp statt Boot-Refusal, S1-12 Seed-Idempotenz) entsprechen den verbindlichen P3-Invarianten. Scope strikt auf P3 (keine ungefragten Extras ausser der test-gerechtfertigten, verhaltens-erhaltenden Fabrik-Extraktion; keine neuen npm-Deps). Safety-Gates/Disclosure/Auth/Secrets/Audio-MCP unberuehrt bzw. gestaerkt (Clamp verengt das Doppelkauf-Fenster). Kein neuer stiller Datenverlust, keine falsche `exit(0)`-Maskierung — im Gegenteil, beide bisher lautlosen Pfade (Shutdown-Flush-Fehler, Corrupt+Backup-Fehler) werden jetzt sichtbar (`exit 1` + lauter Log). DoD erfuellt.

## 5. Clean-Code-Audit (final)

**Verdict: PASS** — `blocker: false`

> Der P3-Diff schliesst 4 dokumentierte Fail-closed-Luecken (Store-Korruption ohne Backup, `PROVISIONING_REDRIVE_MAX_AGE_MS` ungeklemmt, verschluckter Shutdown-Flush-Fehler, `calendar_event`-PK-Crash bei parallelem Boot) mit zielgerichteten, unabhaengigen Tests. `node --check` sauber, volle Suite 2324/2324 gruen.

### S1-S4-Befunde

| Stufe | Befunde |
|---|---|
| **S1** (Blocker) | keine |
| **S2** (Blocker) | keine |
| **S3** | 1 (CC-P3-01, siehe unten) |
| **S4** | 1 (CC-P3-02, siehe unten) |

**CC-P3-01 (S3)** — `src/db/migrate.js` (`seedDefaults`, ~Z.140-152) — G2 Least-Astonishment / Wurzel-statt-Symptom: Der Fix (`ON CONFLICT (id) DO NOTHING`) behebt den PK-Crash bei parallelem BOOTSTRAP-Boot korrekt, adressiert aber nicht die Wurzel: `calendar_event.id` ist ein globaler PRIMARY KEY (schema.sql Z.218), waehrend jede andere RLS-Tabelle tenant_id-scoped eindeutig ist. `demoCalendar()`-IDs sind fest (`ev1`/`ev2`/`ev3`, `defaults.js` `DEMO_EVENTS`). Ruft `seedDefaults()` je fuer einen zweiten Tenant auf (aktuell nur `BOOTSTRAP_TENANT_ID` produktiv, aber generisch signaturiert/benannt), bekommt dieser Tenant stillschweigend 0 Kalender-Events, ohne Log/Fehler — vom eigenen neuen Test S1-12 exakt so verifiziert und akzeptiert. Aktuell folgenlos (kein zweiter Tenant laeuft im Code durch `seedDefaults()`), aber latenter Fallstrick fuer eine plausible naechste Ausbaustufe (Tenant-Onboarding mit Demo-Kalender). Fix-Vorschlag: `calendar_event` auf `(tenant_id, id)` composite unique umstellen oder `demoCalendar()`-IDs tenant-praefigiert generieren.

**CC-P3-02 (S4)** — `src/store/pg.js` (`drainFlushes`/`lastFlushError`, ~Z.95-127) — `lastFlushError` wird nur bei einem darauffolgenden erfolgreichen Flush geloescht (Clear-on-Success), nicht dadurch, dass `drainFlushes()` ihn bereits geworfen hat. Aktuell unschaedlich: einziger Caller ist `gracefulShutdown()`, das dank `shuttingDown`-Guard `drainFlushes()` genau einmal pro Prozessleben aufruft. Latenter Fallstrick, falls kuenftig ein zweiter/wiederholter Caller `drainFlushes()` unabhaengig aufruft. Fix-Vorschlag (optional): `lastFlushError` beim Werfen konsumieren oder den Ein-Caller-Vertrag per Kommentar festschreiben.

### Pass-Notes

Verifikation ueber die Repo-Vorgaben hinaus durchgefuehrt (eigener Schwester-Worktree, bereits auf `phase/cc-p3-failclosed-paths` mit installiertem `node_modules`): `node --check` auf allen 5 geaenderten src-Dateien sauber; volle Suite `npm test` = 2324/2324 gruen, 0 fail (inkl. aller 6 neuen/geaenderten Testdateien). Kategorie-Durchgang: **P16** (Nebenlaeufigkeit) sauber — `flushChain`/`lastFlushError`-Serialisierung korrekt nachvollzogen (kein Race, JS single-threaded + Chain-Ordering garantiert Konsistenz vor jedem `await`). **C1-C5** PASS (keine Autoren-Metadaten, kein auskommentierter Code, Kommentare aktuell und konsistent, inkl. korrekt bereinigtem Alt-Kommentarblock in `boot.js`). **F1** n.z. (Options-Objekt-Pattern fuer `makeGracefulShutdown` ist Konstruktor-Injection wie beim bestehenden `bootServer`, kein Positional-Arg-Bloat). **G4/G9/G12** PASS. **G24** (Konventionen): der dynamische `config.js?tag`-Reimport-Trick in `config-failclosed.test.js` hat ein direktes Vorbild in `test/tenant-settings-calendar-map.test.js` (kein Stilbruch); das `chmodSync`-Non-writable-dir-Testmuster hat ein Vorbild in `test/onboard-persist-failure.test.js`; `test/helpers.js` `dataDir:reuseDataDir` spiegelt exakt das bestehende Muster in `startServer()`. `MS_PER_DAY`-Konstante bereits vorhanden (kein neuer Magic Number). Root-Cause-Diagnose in `boot.js` (uncaughtException-Netz faengt Boot-Throw ab -> stiller `exit 0`) gegen `process-guards.js` verifiziert und bestaetigt korrekt.

### Top-Todos (optional, kein Muss-Fix)

- `migrate.js`/`schema.sql`: `calendar_event` auf tenant-scoped Eindeutigkeit umstellen (composite Key oder praefigierte Demo-IDs), damit ein zweiter Tenant nicht strukturell riskiert, seinen Demo-Kalender stillschweigend zu verlieren (S3, nicht blockierend).
- `pg.js`: `lastFlushError`-Konsum-Semantik entweder explizit dokumentieren (Ein-Caller-Vertrag) oder beim Werfen zuruecksetzen, falls `drainFlushes()` je einen zweiten Caller bekommt.
- Keine weitere Aktion noetig fuer S1/S2 — Diff ist mergefaehig.

## 6. Fix-Runden

**Keine.** Der `=== FIXES ===`-Abschnitt der Quelle ist leer. Der Diff wurde im ersten Anlauf approved (Safety: APPROVED ohne Blocker; Clean-Code: PASS ohne S1/S2-Blocker, nur ein nicht-blockierender S3- und ein S4-Befund als Top-Todos festgehalten) — keine Nacharbeiten noetig.

## 7. Ergebnis

| Kriterium | Status |
|---|---|
| Gate | **PASS** |
| Safety-Review | APPROVED, keine Blocker, 3 nicht-blockierende Concerns |
| Clean-Code-Audit | PASS, S1/S2 leer, 1x S3 + 1x S4 (nicht-blockierend, als Top-Todos festgehalten) |
| Tests | 2324/2324 gruen (Baseline 2318 + 6 neue/erweiterte Testdateien) |
| Diff-Blast-Radius | 11 Dateien (5 src + 6 test, davon 1 Test-Helper) |
| Betroffene Fixes | S1-2 (pg-Shutdown-Flush), S1-4 (Corrupt-Store), S1-3 (Redrive-Clamp), S1-12 (Demo-Seed-PK-Kollision) |
| Neue npm-Dependency | keine |
| Merge auf `master` | liegt beim Lead/Orchestrator gemaess Lean-Phasen-Workflow |
