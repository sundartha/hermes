# Server-Slim P6 — Detailbericht

**Phase:** P6 — `src/worker/provisioning-orchestrator.js` extrahieren (Single-Flight, TDZ-kritisch)
**Gate:** PASS
**finalBranch:** `phase/slim-p6-provisioning-orchestrator`
**headCommit (Worktree):** `a0978288ffe4ebe934136e13a8184f8587be9b34`

---

## 1. Ziel der Phase

Die Provisioning-Orchestrierung — 7 zusammengehoerige Funktionen fuer Nummern-Kauf-Einreihung, -Trigger, -Drain (Single-Flight) und -Reconcile — aus `src/server.js` in ein eigenes Modul `src/worker/provisioning-orchestrator.js` extrahieren, als DI-Factory `makeProvisioningOrchestrator(...)`. Besonderheit dieser Phase: eine echte **TDZ-Falle** (Temporal Dead Zone), weil zwei Call-Sites innerhalb eines `guardedBoot`-Blocks liegen, der bei einem Referenzfehler **fail-open** verschluckt statt zu crashen — das musste strukturell UND empirisch ausgeschlossen werden.

---

## 2. Plan (gekuerzt)

### Verifizierter Ist-Stand
- `src/server.js` hatte 1924 Zeilen (das aeltere Plan-Dokument nannte veraltete Zeilennummern — korrigiert gegen echten `master`).
- Die 7 zu verschiebenden Symbole lagen als zusammenhaengender Block **L1502-1705**: `queueProvisioning`, `triggerTenantProvisioning`, `runProvisioningDrain`, `runProvisioningDrainExclusive` (Modul-const via `makeSingleFlight`), `redriveProvisioningJobs`, `closeSettledProvisioningJobs`, `reconcileOrphanedProvisioning`.
- **6 externe Call-Sites** ausserhalb des Blocks mussten auf `provisioning.X` umgestellt werden, davon zwei **TDZ-kritisch**, weil sie innerhalb des `guardedBoot("Web-Login/Portal", ...)`-Blocks liegen (L456 Self-Service-Routen-Wiring zur Boot-Zeit, L495 Stripe-Webhook-Wiring zur Request-Zeit) — beide muessen die neue `provisioning`-Instanz zur Verfuegung haben, **bevor** dieser Block ausgefuehrt wird.
- Kein Test liest `server.js`-Quelltext direkt; alle Referenzen in `test/*` sind Kommentare oder rekonstruieren Logik ueber Direkt-Imports der Untermodule → reiner Refactor, keine Testaenderung noetig (per grep verifiziert).
- Blindstelle bestaetigt: kein automatisierter Test spawnt `server.js` mit `STORE_BACKEND=pg` + `SESSION_SECRET` gleichzeitig → der TDZ ist automatisiert nicht erreichbar, nur strukturell + per manuellem pg-Smoke fangbar.

### Neue Datei `src/worker/provisioning-orchestrator.js` (~230 LOC)
- Faktorierung folgt dem P5-Praezedenzfall (`call-lifecycle.js`): stateful Instanzen/Domaenen-Kollaboratoren werden **injiziert**, reine Konstanten/Enums/Geo-Helfer werden **im Modul importiert** (`makeSingleFlight`, `PROVIDER`, `PROVISION_NUMBER_JOB`, `PROVISIONING_JOB_STATUS`, `KYC_OUTBOUND_MIN`, `shouldPersistProvisionResult` aus `store/defaults.js`; `searchParamsForCountry`, `holdAmountForCountry` aus `telephony/provisioning-geo.js`).
- Factory-Signatur: **ein** Objekt-Argument mit 13 Keys (`store`, `config`, `queue`, `billing`, `metering`, `numberProvisioning`, `handleProvisionJob`, `resolveProvisionRetry`, `audit`, `recordProvisioningJob`, `markProvisioningJob`, `classifyQueuedProvisioningJobs`, `findNumber`) — F1-konform (ein Arg), Kompositionswurzel-Wiring analog `call-lifecycle` (11 Keys).
- `runProvisioningDrainExclusive = makeSingleFlight(runProvisioningDrain)` lebt im **Factory-Scope** (nicht mehr Modul-const) → INV-7 (genau ein Drain-Guard pro Prozess) bleibt erhalten, solange die Factory nur einmal in der Boot-Wurzel konstruiert wird.
- Oeffentliche Flaeche minimal (G8): nur `queueProvisioning`, `triggerTenantProvisioning`, `runProvisioningDrainExclusive`, `reconcileOrphanedProvisioning` werden zurueckgegeben; `redriveProvisioningJobs`/`closeSettledProvisioningJobs`/`runProvisioningDrain` bleiben modulintern privat.
- Body-Transformation im verschobenen Code, sonst **byte-verbatim**: `provisioningQueue` → `queue` (3 Stellen), `stripeBilling` → `billing` (1 Stelle), plus ein Kommentar-Genauigkeitsfix am Single-Flight-const ("Modul-const" → "Factory-Scope-const", da sich der Scope durch den Move tatsaechlich aendert).

### Edits in `src/server.js` (Plan)
- Import `makeSingleFlight` entfernen (nur noch im neuen Modul gebraucht).
- `PROVISION_NUMBER_JOB` / `PROVISIONING_JOB_STATUS` aus dem `defaults.js`-Importblock entfernen (nur im verschobenen Block genutzt); `PROVIDER`/`KYC_OUTBOUND_MIN`/`shouldPersistProvisionResult` bleiben, da ausserhalb des Blocks weiterverwendet.
- Import `provisioning-geo.js` (`searchParamsForCountry`, `holdAmountForCountry`) entfernen.
- `makeProvisioningOrchestrator` aus `./worker/provisioning-orchestrator.js` importieren.
- **Konstruktion der `provisioning`-Instanz VOR dem `guardedBoot("Web-Login/Portal", ...)`-Block** einfuegen (direkt nach `lifecycle`) — das ist der zentrale TDZ-Pflicht-Schritt.
- Beide `guardedBoot`-interne Call-Sites (Self-Service-Wiring, Stripe-Webhook-Wiring) auf `provisioning.triggerTenantProvisioning` umstellen.
- 3 Onboard-Call-Sites (`POST /api/onboard`, `.../retry`) und 1 Boot-Callback (`reconcileOrphanedProvisioning`) auf `provisioning.*` umstellen — diese bleiben bis P10/P15 in `server.js`.
- Den Original-Block L1502-1705 loeschen (wandert vollstaendig in die Factory).
- Erwartete Netto-Reduktion: **≈ −189 Zeilen** in `server.js`.

### Tests
Keine Aenderung, kein neuer Test — begruendet als reiner Refactor mit identischem Laufzeitverhalten; bestehende Tests decken Single-Flight (`prov01-drain-singleflight`), Boot-Reconcile (`prov01-boot-reconcile`), HTTP-Wiring (`prov01-retry-redrive-http`, `onboarding-route`, `p2-onboard-retry`), Stripe-Webhook-Seam (`p3-payment-webhook`) und Worker/Geo-Kern (`provisioning-worker`, `f1-provisioning-geo`) bereits ab.

### Deterministische Pruefungen (Plan-Vorgabe)
- `node --check` auf beiden Dateien, `grep -c "^export" src/server.js` = 0, `npm test` gruen.
- INV-7-Grep: `makeSingleFlight(runProvisioningDrain)` genau 1x im neuen Modul, `makeSingleFlight` 0x in `server.js`.
- INV-11/TDZ-Struktur-Gate (`awk`): Konstruktionszeile der `provisioning`-Instanz muss **vor** der `guardedBoot("Web-Login/Portal"`-Zeile stehen.
- **Manueller pg+session-Boot-Smoke als Pflicht-Overlay** (weil automatisiert nicht erreichbar): Boot-Log darf `"deaktiviert"` 0x enthalten (kein Fail-Open des guardedBoot durch TDZ/ReferenceError).

### Pre-Mortem (Plan)
- Risiko "bezahlte Signups provisionieren stumm keine Nummer mehr": Ursache waere ein TDZ an der Self-Service-Call-Site durch verspaetete Konstruktion → guardedBoot faellt fail-open in "deaktiviert", Routen 404 lautlos, von der json-Testsuite unsichtbar. Gegenmassnahme: Konstruktion fix vor dem Block + `awk`-Struktur-Gate + manueller pg-Smoke als harte Merge-Gates.
- Risiko "Doppelkauf durch zwei Drain-Guards": Gegenmassnahme Guard im Factory-Scope, Factory nur einmal in der Wurzel konstruiert, per Test + Grep bewiesen.
- Risiko "Referenz-Identitaet von `triggerTenantProvisioning` geht verloren" (an zwei Stellen gereicht): beide Empfaenger erhalten dieselbe Closure aus einer Factory-Instanz, kein `this`-Binding-Risiko.

---

## 3. Implementierung — Zusammenfassung

- Neue Datei `src/worker/provisioning-orchestrator.js` (245 Zeilen) mit `makeProvisioningOrchestrator` — 13 injizierte Deps + reine Modul-Imports (`single-flight.js`, `store/defaults.js`, `telephony/provisioning-geo.js`), wie geplant.
- Reine Verschiebung der 7 Symbole aus dem Ausgangsblock L1502-1705 in `src/server.js`. Einzige Aenderungen am verschobenen Code: `provisioningQueue` → `queue` (3x), `stripeBilling` → `billing` (1x), ein Kommentar-Genauigkeitsfix (Modul-const → Factory-Scope-const).
- `src/server.js`: `provisioning`-Instanz wird **vor** dem `guardedBoot("Web-Login/Portal", ...)`-Block konstruiert (TDZ-Pflicht erfuellt). Beide `guardedBoot`-interne Call-Sites (Self-Service-Wiring, Stripe-Webhook) sowie die 4 uebrigen Call-Sites (`/api/onboard`, `/api/onboard/retry`, Boot-Callback) auf `provisioning.*` umgestellt.
- `src/server.js`: 1924 → 1740 Zeilen (**−184 netto**, minimal von der Plan-Schaetzung ≈−189 abweichend durch die Zeilenverschiebungen waehrend der Edit-Sequenz selbst, siehe Deviations), export-frei, Boot-Log-Zeile unveraendert (1 Treffer).
- Verifikation: `node --check` auf beiden Dateien gruen; volle `npm test` **2290/2290** (json + pg/pglite in einem Lauf); die 11 im Plan genannten Phasen-Testdateien isoliert gruen; TDZ-Struktur-Gate (`awk`: Konstruktion vor `guardedBoot`) = OK; Grep-Beweise (`^export`=0, `makeSingleFlight` in `server.js`=0, `makeSingleFlight(runProvisioningDrain)` im neuen Modul=1) bestanden.
- **Zusaetzlich zum Plan durchgefuehrt:** echter manueller pg+session-Boot-Smoke (isolierte lokale Postgres-16-Instanz via `initdb`/`pg_ctl` im Scratchpad, dedizierte NOBYPASSRLS-Nicht-Superuser-Rolle wegen des F5-Portal-Pool-Guards). Ergebnis: Boot-Log enthaelt `"deaktiviert"` 0x; `GET /api/self-service/state` liefert 401 (nicht 404 → Route ist wirklich gemountet); `POST /webhooks/stripe` liefert den App-Level-404-JSON-Body (Route erreicht den Handler); `POST /api/onboard/retry` durchlaeuft `provisioning.triggerTenantProvisioning` bis zum erwarteten 403-Fail-Closed. Damit ist der TDZ/Fail-Open-Risikofall aus dem Pre-Mortem **empirisch widerlegt**, nicht nur strukturell ausgeschlossen. Testinstanz danach sauber heruntergefahren, Scratchpad-Dateien entfernt.

### Deviations (Plan vs. Umsetzung)

1. **Zeilennummern-Drift waehrend der eigenen Edit-Sequenz:** Die im Plan genannten Folgezeilen (L1433/L1449/L1491/L1883 etc.) verschoben sich mit jedem vorherigen Import-Entfernungs-/Insert-Schritt dieser Phase selbst. Vor jedem Edit wurde die aktuelle Zeile per `grep`/`Read` neu verifiziert statt blind der Plan-Zeilennummer zu vertrauen — deckt sich mit dem Plan-eigenen Hinweis, dass Zeilennummern rotten.
2. **Ein Wort im neuen (nicht verschobenen) Kommentar bei der `provisioning`-Konstruktion geaendert:** "makeSingleFlight-Guard" → "Single-Flight-Guard". Der Plan-Text fuer diesen Edit enthielt woertlich die Zeichenkette `makeSingleFlight`, was der Plan-eigenen INV-7-Verifikation (`grep -c "makeSingleFlight" src/server.js` soll 0 sein) widersprochen haette. Bedeutung unveraendert, reine Wortwahl.
3. **Pg-Testinstanz fuer den Pflicht-Smoke selbst aufgesetzt:** Der Plan verlangte den manuellen pg+session-Happy-Path-Smoke als Pflicht-Overlay, ohne ein erreichbares Postgres vorzugeben. Da keines bereitstand, wurde eine isolierte lokale Postgres-16-Instanz (initdb/pg_ctl, TCP-only wegen Unix-Socket-Pfadlaenge) im Scratchpad-Verzeichnis aufgesetzt, inkl. dedizierter NOBYPASSRLS-Nicht-Superuser-Rolle (vom F5-Portal-Pool-Guard unabhaengig vom P6-TDZ-Risiko verlangt). Nach dem Smoke sauber gestoppt und geloescht.

---

## 4. Safety-Urteil (final)

**approved: true** — alle Kern-Checks bestanden:

| Check | Ergebnis |
|---|---|
| testsPassIndependently | true |
| safetyGatesIntact | true |
| disclosureIntact | true |
| authFailClosedIntact | true |
| noSecretsLeaked | true |
| behaviorAsIntended | true |
| scopeRespected | true |

**Unabhaengiger Testlauf:** Voller Suite-Lauf (json+pg/pglite in einem Durchgang): 2289 pass / 1 fail / 0 skipped, ~72s. Der einzige Fail ist `test/store-pg.test.js:222` ("addNotification kappt auf 50", 49 statt 50 erhalten) — ein vorbestehender Full-Load-Flake: Datei byte-identisch zu `master`, laeuft isoliert gruen, Thema (pg-Notification-Capping) hat keinen Bezug zur Provisioning-Orchestrierung. Nach dem Gate-Protokoll ("rot nur echt, wenn isoliert rot") kein echter Fail. Alle P6-Pflicht-Tests bestehen: Provisioning-Gruppe 41/41; pg+session-Happy-Path-INV-11-Gruppe 35/35, jeweils 0 Vorkommen von `"deaktiviert"` im stderr (kein Fail-Open/TDZ). `node --check` gruen auf beiden geaenderten Dateien.

**Verdict-Text (Safety):** APPROVED. P6 ist eine saubere reine Verschiebung der Provisioning-Orchestrierung in `src/worker/provisioning-orchestrator.js` via `makeProvisioningOrchestrator({...})`. Normalisierter Diff beweist Byte-Identitaet jeder Codezeile nach den injizierten-Dep-Umbenennungen (`provisioningQueue→queue`, `stripeBilling→billing`); einzige textuelle Aenderung ist eine aktualisierte Kommentarzeile zur Factory-Scope-Lage. Scope eingehalten: genau 2 Dateien geaendert, keine Test-/`package.json`-/Dependency-Aenderungen. INV-6 (Boot-Log = 1), INV-7 (eine Provisioning-Instanz, ein Single-Flight-Guard, `prov01-drain-singleflight` beweist Genau-einmal-Kauf), INV-9 (Geld-/Budget-/Max-Dauer-Pfad unveraendert, `paymentEnabled`-Gating bleibt beim Aufrufer), INV-10 (0 Exporte), INV-11 (Konstruktion vor `guardedBoot`, beide `provision:`-Call-Sites umverdrahtet, pg+session-Happy-Path 35/35 mit 0x `"deaktiviert"` = kein Fail-Open/TDZ) halten alle. Offenlegung (`claude.js`/`bridge.js` unberuehrt, `disclosureSentence` vorhanden) und Auth-Fail-Closed intakt. Logs sind PII-/Secret-frei (`audit` nutzt nur `tenantId`+`reason`).

**Concerns (nicht blockierend):** Full-Suite-Lauf zeigte 1 flakenden Fail (`store-pg addNotification cap 49-vs-50`) — vorbestehender Full-Load-Flake, isoliert gruen, unveraenderte Datei, kein Bezug zu P6. Keine dieser Phase zurechenbar, keine Aktion fuer den Merge noetig.

---

## 5. Clean-Code-Audit (final)

**Blocker: false — Verdict: PASS**

- **S1 (Blocker-Klasse):** keine Funde.
- **S2 (Blocker-Klasse):** keine Funde.
- **S3:** keine Funde.
- **S4 (Hinweis, kein Flag):** `src/worker/provisioning-orchestrator.js:18-31` — `makeProvisioningOrchestrator` nimmt 13 benannte Deps als ein DI-Objekt entgegen; entspricht exakt dem etablierten Muster der Schwester-Factories im selben Umbaustrang (`makeCallLifecycle`: 11 Deps, `makeCallFinish`: 7 Deps) — keine neue Abweichung, daher nicht als F1-Verstoss gewertet, nur als Beobachtung festgehalten.

**Verdict-Begruendung:** Saubere, verhaltenserhaltende Extraktion von 7 Funktionen (`queueProvisioning`, `triggerTenantProvisioning`, `runProvisioningDrain`, `runProvisioningDrainExclusive`, `redriveProvisioningJobs`, `closeSettledProvisioningJobs`, `reconcileOrphanedProvisioning`) aus `server.js` in `worker/provisioning-orchestrator.js` als DI-Factory. Normalisierter Body-Diff (alt vs. neu, nur `queue`/`billing`-Parameter-Umbenennung) zeigt byte-identische Logik bis auf eine korrekt aktualisierte Kommentarzeile. Beide `guardedBoot`-Aufrufstellen (Self-Service, Stripe-Webhook) wie im Plan als Pflicht gefordert auf `provisioning.triggerTenantProvisioning` umgestellt; die Factory-Konstruktion liegt korrekt vor dem `guardedBoot`-Block (verifiziert per Zeilennummern: 135/165 vor 209 vor 352) — das im Plan als kritisch markierte TDZ/Fail-Open-Risiko (INV-11) ist damit vermieden. Volle Testsuite (2290/2290) sowie die im Plan als Pflicht genannten pg+session-Happy-Path-Tests laufen gruen, kein `"deaktiviert"` im stderr. Oeffentliche Flaeche minimal (4 Funktionen, G8-konform), keine toten Imports, keine Duplizierung, keine Umlaute in Kommentaren, DI-Pattern konsistent mit Bestandsmodulen.

**Top-Todos (optional, nicht blockierend):** Veraltete Kommentar-Verweise auf "server.js `triggerTenantProvisioning`"/"server.`runProvisioningDrain`" in unveraenderten Dateien bei Gelegenheit auf `worker/provisioning-orchestrator.js` aktualisieren, z.B. `src/self-service-routes.js:90`, `src/store.js:135`, `src/billing/webhook.js:256`, `src/billing/provision-trigger.js:4`, `test/f1-provisioning-geo.test.js:37`, `test/provisioning-worker.test.js:40`. Ausserhalb Diff-Scope dieser Phase, kein Flag.

---

## 6. Fix-Runden

**Keine.** Sowohl das Safety-Review als auch das Clean-Code-Audit kamen bereits in der ersten Runde auf einen sauberen PASS/APPROVED ohne Blocker (S1/S2 leer, keine `blockers`). Es waren keine Fix-Iterationen noetig.

---

## 7. Gesamtergebnis

| Kriterium | Status |
|---|---|
| Plan verifiziert gegen echten Code | ja |
| Implementierung abgeschlossen | ja |
| `node --check` (beide Dateien) | gruen |
| `npm test` (json+pg/pglite) | 2290/2290 (1 vorbestehender, isoliert gruener Flake im Full-Load ausgenommen) |
| Safety-Review | APPROVED, keine Blocker |
| Clean-Code-Audit | PASS, keine Blocker (S1-S3 leer, 1x S4-Hinweis) |
| Fix-Runden noetig | 0 |
| Netto-Reduktion `server.js` | 1924 → 1740 Zeilen (−184) |
| **Gate** | **PASS** |
