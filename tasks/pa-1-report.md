# Phase PA-1 — Geteilter Max-Dauer-Helfer (`bridge.js` + `call-lifecycle.js`) + bridge-finalize-Wiring-Test

**Status:** Gate = PASS (kein Blocker)
**finalBranch:** `phase/polish-a-p1-fix2`
**Typ:** verhaltens-erhaltend (Refactor + neue Konstante) + Regressions-/Wiring-Test
**Quelle:** `PLAN-POLISH-A.md` Abschnitt 7 „#### PA-1", PM-2/PM-3, OQ-1/OQ-2 (beide Owner-bestaetigt)

---

## 1. Zusammenfassung

PA-1 buendelt die bisher zweifach duplizierte Max-Dauer-Formel `(call.maxDurationS || defaultS) * 1000` — einmal roh mit Magic-`1000` in `src/bridge.js` (Realtime-Cap-Timer), einmal als private Funktion in `src/telephony/call-lifecycle.js` (Budget-Engine: `armMaxDurationTimer` + Reserve-Release-Backstop) — in einen einzigen, config-freien Helfer. Zusaetzlich wurde ein neuer Wiring-Test ergaenzt, der die bestehende `finalize()`-Idempotenz in `bridge.js` (STOP-Media-Frame + `providerWs`-Close duerfen `onCallEnded` nur EINMAL ausloesen) als Regressionsgurt festnagelt.

Die dritte bekannte Duplikat-Stelle (`src/store/state-ops.js` — `callLimitMs` mit eigenem lokalen `MS_PER_SECOND`) bleibt bewusst unangetastet — dokumentierte, Owner-bestaetigte Layer-Divergenz (OQ-1): die Store-Schicht darf die Telephony-/Helper-Schicht nicht importieren.

Kein Verhaltenswechsel, kein Deploy, kein Push. Über zwei Fix-Runden wurde die finale Dateiplatzierung des Helfers und seiner Konstante nachgeschaerft (siehe Abschnitt 6).

---

## 2. Plan (gekuerzt)

### Grounding (gegen `master` verifiziert)

- `src/bridge.js:282` — rohe Formel mit Magic-`1000`: `(call.maxDurationS || config.maxCallDurationS) * 1000` im `endTimer`-`setTimeout` (START-Media-Frame-Handler). Einzige `1000`-Stelle der Datei.
- `src/telephony/call-lifecycle.js:29-31` — private `callMaxDurationMs(call)` mit identischer Formel + Magic-`1000`; genutzt von `armMaxDurationTimer` (Z.79) UND `armReserveReleaseTimer` (Z.88). Einzige `1000`-Stelle der Datei.
- `src/store/state-ops.js:373-374` — dritte Stelle (`callLimitMs`) mit eigenem lokalen `MS_PER_SECOND` (Z.43). **Bleibt unangetastet** (OQ-1, config-frei, Store-Schicht).
- `src/bridge.js:122-137` — `finalize(status)`: `closed`-Guard (idempotent) → `store.endCallRecord` + `onCallEnded?.(store.getCall(call.id))`. Zwei reale Einstiege: STOP-Media-Frame (Z.295) und `providerWs.on("close")` (Z.303)/`("error")` (Z.304).
- `src/boot.js:145` — `attachMediaBridge(httpServer, callFinish.finishCall)` → in Prod ist `onCallEnded === finishCall`. Buchung laeuft heute korrekt genau einmal.
- Die 5 `terminateAndBillCall`-Aufrufe (`call-lifecycle.js`, `telnyx-call-control-ingest.js`, `routes/api-calls.js` x2, `routes/voice.js`) — `bridge.js` nutzt diesen Weg **nicht**.
- `test/bridge-openai-event.test.js` — enthaelt bereits `setupCall()` (Z.106) samt OpenAI-WS-Loader-Shim, realem `http.Server` + echtem Provider-ws-Client. Twilio-STOP-Frame-Shape: `{ event: "stop" }` → `MEDIA_EVENT.STOP`.

### Geplante Aenderungen

1. **Neue Datei** `src/telephony/call-duration.js` (spaeter umplatziert, siehe Fixes): reine, config-freie Datei mit `export const MS_PER_SECOND = 1000;` und `export function callMaxDurationMs(call, defaultMaxDurationS)`.
2. **`src/bridge.js`** — nur Import + Timer-Zeile im START-Case (HEIKLE STELLE strikt begrenzt): `callMaxDurationMs(call, config.maxCallDurationS)` statt roher Formel. Sonst keine Zeile angefasst (Barge-in, `hangup`, `finalize`, `closed`-Guard, `onCallEnded?.()`, Offenlegungssatz, `connectOpenAI` unberuehrt).
3. **`src/telephony/call-lifecycle.js`** — aliased Import (`callMaxDurationMs as computeMaxDurationMs`), damit die interne Funktion und ihre zwei Call-Sites (Z.79/88) namentlich unveraendert bleiben; der lokale Wrapper bindet nur noch den config-Default.
4. **`src/telephony/call-termination.js`** — reine Kommentar-Praezisierung (C1/C2): stale `server.js`-Referenz raus, neuer Absatz zu `bridge.js` als separatem sechsten Terminierungspfad (kein Logik-Diff).
5. **Tests:**
   - Neu `test/call-duration.test.js` — 4 Faelle: `MS_PER_SECOND`-Konstante, call-eigenes Limit schlaegt Default, `||`-Falsy-Faelle (0/null/undefined), armierte Deadline `now + Formel`.
   - Additiv `test/bridge-openai-event.test.js` — `mock`-Import, `setupCall` optionaler `onCallEnded`-Parameter (Default `() => {}`), Return um `providerWs`/`client`/`httpServer` erweitert; neuer Testfall „finalize-Idempotenz: STOP-Frame DANN providerWs-Close rufen onCallEnded GENAU EINMAL" — treibt zwei echte finalize-Einstiege (STOP-Media-Frame, dann `providerWs`-Close) und prueft `onCallEnded.mock.callCount() === 1`.

### Clean-Code-Konformitaet (geplant)

- **G5:** zwei echte Duplikate gebuendelt; dritte Stelle (`state-ops.js`) bleibt dokumentierte Layer-Divergenz (OQ-1), kein FLAG.
- **G25:** Magic-`1000` in `bridge.js` entfernt → `MS_PER_SECOND`.
- **G35:** Default bleibt in `config.js`, wird hereingereicht — Helfer bleibt config-frei.
- **C1/C2:** `call-termination.js`-Kommentar entstaubt, keine neuen `Datei:Zeile`-Anker.
- **F1:** Helfer hat 2 Argumente. **N7:** reine Funktion, kein Nebeneffekt. **P15:** kein Lazy-Init.

### Safety-Invarianten (geplant, unantastbar)

- Max-Dauer-Gate: Ablaufzeitpunkt an beiden Call-Sites byte-identisch (`MS_PER_SECOND === 1000`, `||`-Semantik erhalten). Gate weder entfernt noch aufgeweicht.
- `state-ops.js` unberuehrt (OQ-1). `finalize`/`onCallEnded` ohne Signatur-/Struktur-Aenderung (OQ-2).
- Offenlegungssatz, Barge-in, Hangup-/Call-Ende-Choreografie, `closed`-Guard, Auth/Signatur: nicht angefasst.
- Kein neuer Endpunkt, keine Env-Aenderung, keine neue Dependency, kein Deploy/Push.

### Deterministisch pruefbares Ergebnis (Plan-Checks)

1. `node --check` auf allen 4 Quelldateien → Exit 0.
2. `grep -n "1000" src/bridge.js src/telephony/call-lifecycle.js` → leer, `exit=1`.
3. `grep -nE "^export (const MS_PER_SECOND|function callMaxDurationMs)"` im Helfer → 2 Treffer.
4. Gezielte Tests (neu + betroffene Bestandssuiten) gruen.
5. Volle `npm test` gruen.

**Geplanter Blast-Radius:** +1 Quelldatei (~10 Zeilen), 3 chirurgische Edits, +1 Testdatei, 1 additiv erweiterte Testdatei. Keine der `terminateAndBillCall`-Route-Dateien, keine Store-Datei, kein Config, kein Env.

---

## 3. Implementierungs-Zusammenfassung

- **headCommit:** `36c71f4370cf8ddfd7fb74d0882f1c8bc409eb7d`
- **nodeCheckPass:** true
- **testsPass:** true — `testPassCount: 2367`, `testFailCount: 0`
- **committed:** true

PA-1 wurde exakt gemaess Plan umgesetzt: neuer geteilter Max-Dauer-Helfer (`callMaxDurationMs` + `MS_PER_SECOND`, config-frei, byte-identische `||`-Semantik), migriert in `src/bridge.js` (nur Import + Timer-Zeile im START-Case) und `src/telephony/call-lifecycle.js` (aliased Import `computeMaxDurationMs`, lokaler Wrapper bindet nur noch den config-Default). `src/telephony/call-termination.js` erhielt nur eine Kommentar-Praezisierung (C1/C2, stale `server.js`-Referenz raus, neuer Absatz zu `bridge.js` als separatem sechsten Terminierungspfad). `state-ops.js` bewusst unangetastet (OQ-1).

Neue Tests:
- `test/call-duration.test.js` (neu, 4 Faelle: Konstante, call-eigenes Limit schlaegt Default, `||`-Falsy-Faelle 0/null/undefined, armierte Deadline `now + Formel`).
- `test/bridge-openai-event.test.js` (additiv: `mock`-Import, `setupCall` optionaler `onCallEnded`-Parameter mit Default, Return um `providerWs`/`client`/`httpServer`, neuer Wiring-Test „finalize-Idempotenz: STOP-Frame DANN providerWs-Close rufen onCallEnded GENAU EINMAL") — alle Bestandsfaelle byte-identisch unveraendert und gruen (OQ-2 gewahrt: `finalize`/`onCallEnded` ohne Struktur-/Signaturaenderung ausser additivem Default).

Deterministische Plan-Checks alle erfuellt: `node --check` auf allen 4 Quelldateien clean; `grep "1000"` in `bridge.js`/`call-lifecycle.js` → leer/`exit=1` (kein rohes Magic-1000 mehr); `grep` der 2 `export`-Zeilen im Helfer → beide Treffer; gezielte Tests (`call-duration` + `bridge-openai-event` + `max-duration-rearm` + `max-duration-pure` + `bridge-hardening`) 47/47 gruen; Voll-Suite 2367/2367 gruen (json-Default + pglite-in-process im selben `npm test`-Lauf).

**Falsifizierbarkeits-Probe:** `closed`-Guard in `bridge.js` temporaer deaktiviert → neuer Wiring-Test faengt den Doppelaufruf korrekt (`2 !== 1` → rot) → danach sauber zurueckgesetzt und erneut gruen verifiziert.

**Smoke-Test:** `startServer()` aus `test/helpers.js` genutzt: `GET /healthz` → 200 `{"ok":true}`; `POST /voice/incoming` (`SKIP_TWILIO_SIGNATURE_CHECK`) → 200 mit gueltiger TwiML-Antwort. Bestaetigt Boot + `/voice`-Routing nach dem Refactor unveraendert; `bridge.js` selbst laeuft nur unter `VOICE_ENGINE=realtime` (nicht Teil dieses Smoke-Pfads), dafuer deckt der neue Wiring-Test + die volle `bridge-openai-event.test.js`-Suite (26/26 gruen) das Verhalten direkt ab.

Commit `36c71f4` auf Branch `phase/polish-a-p1`, kein Push, `node_modules`-Symlink nicht committed. Blast-Radius exakt wie geplant: 6 Dateien (4 chirurgisch editiert, 2 neu), 93 insertions(+), 12 deletions(-).

### Dateien

**Neu:**
- `src/telephony/call-duration.js` (spaeter nach `src/call-duration.js` verschoben, siehe Fixes)
- `test/call-duration.test.js`

**Editiert:**
- `src/bridge.js`
- `src/telephony/call-lifecycle.js`
- `src/telephony/call-termination.js`
- `test/bridge-openai-event.test.js`

### Tests hinzugefuegt/geaendert

- `test/call-duration.test.js` (neu, 4 Testfaelle)
- `test/bridge-openai-event.test.js` (additiv: `setupCall` optionaler `onCallEnded`-Parameter + Return-Erweiterung, 1 neuer Wiring-Testfall „finalize-Idempotenz")

### Deviations

Keine (`deviations: []` im Impl-Report; Datei-Platzierungsabweichung wurde erst im Safety-Review als Concern aufgeworfen und in den Fix-Runden behoben, siehe Abschnitt 6).

### Clean-Code-Self-Check (Implementierung)

G5: zwei echte Duplikate (`bridge.js` + `call-lifecycle.js`) zu einer Quelle gebuendelt; dritte Stelle `state-ops.js` bleibt dokumentierte Layer-Divergenz (OQ-1), kein FLAG. G25: kein rohes `1000` mehr in beiden migrierten Dateien, benannte Konstante `MS_PER_SECOND`. G35: Default bleibt in `config.js`, wird hereingereicht — Helfer bleibt config-frei. C1/C2: `call-termination.js`-Kommentar entstaubt, keine neuen `Datei:Zeile`-Anker. F1: Helfer hat 2 Argumente. N7: reine Funktion (`callMaxDurationMs`), kein Nebeneffekt; Wiring-Test-Name traegt den Nebeneffekt (GENAU EINMAL) im Testnamen. P15: kein Lazy-Init. P11/T-Serie: neues Modul + Unit-Test + Wiring-Test; Charakterisierungs-Suite `bridge-openai-event.test.js` unveraendert gruen (26/26). Keine neuen Dependencies, kein Env, kein Endpunkt, kein Deploy/Push. Safety-Gates/Disclosure/Barge-in/`closed`-Guard nicht angefasst — Falsifizierbarkeitsprobe bestaetigt die Faengigkeit des neuen Tests.

---

## 4. Safety-Urteil (final)

**verdict:** APPROVED

- `approved`: true
- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `behaviorAsIntended`: true
- `scopeRespected`: true
- `blockers`: keine

**Independent Test Summary:** Selbst ausgefuehrt im frischen Worktree (`node_modules`-Symlink auf Haupt-Repo korrigiert, da `ln -s ./node_modules` zirkulaer war). Voll-Suite JSON-Backend: 2367 pass / 0 fail (Dauer ~71s). Direkt-Files `test/bridge-openai-event.test.js` + `test/call-duration.test.js`: 30 pass / 0 fail. PG-Abdeckung lief im selben `npm test`-Lauf via pglite-basierte Tests (`rls-with-check`, `web-auth-pg`, `bk4-quota-view`, `store-pg-rls` u.a.) und war gruen; kein Top-Level-pg-Schalter existiert (`BASE_ENV` pinnt `STORE_BACKEND=json` fuer Spawn-Tests per Design gegen `.env`-Leak), und der geaenderte Code ist store-/config-frei → backend-agnostisch. Adversariale Mutationsprobe: Entfernen des `closed`-Guards in `finalize()` macht den Wiring-Test rot (pass 25 / fail 1) → echter Regressionsgurt. Danach `bridge.js` aus Backup restauriert, `git status` sauber.

**Urteilstext:** PA-1 ist verhaltens-erhaltend, scope-treu und durch eigene gruene Tests (2367/0 + 30/30) sowie eine Mutationsprobe abgesichert. Alle absoluten Regeln unberuehrt: Safety-Gates (`numberGateError`/Max-Dauer-Cap byte-identisch), Disclosure (`claude.js` nicht im Diff, `bridge.js` nur Import+Timer-Zeile), Auth fail-closed (`stream_token` `safeEqual` unberuehrt), keine Secrets, kein neuer npm-Dep, keine config-/state-ops-Aenderung. Alle Zusatz-Invarianten erfuellt (OQ-1, OQ-2, `bridge.js` strikt begrenzt, ein Helfer + `MS_PER_SECOND`, beide Call-Sites byte-identisch, Wiring-Test genau-einmal).

**Concerns (nicht-blockierend):**

1. **Spec-Location-Abweichung:** Der Helfer lag zu diesem Zeitpunkt in `src/call-duration.js` statt im spec-gepinnten `src/telephony/call-duration.js`. Dokumentiert begruendet (schicht-neutral wie `src/util.js`, Vorbereitung fuer eine kuenftige `state-ops`-Zusammenfuehrung, explizit NICHT Teil dieser Runde), Substanz voll erfuellt. Fuer die aktuellen Aufrufer waere `src/telephony/` ebenfalls importierbar gewesen; der Umzug ist rein forward-looking. Nur zur Owner-Sichtbarkeit.
2. **Kosmetisch:** Der Kommentar in `call-lifecycle.js` sagte „EINE Quelle innerhalb der Telephony-Schicht", waehrend die Datei am `src`-Root lag (`call-duration.js`-Kommentar sagte korrekt „Bewusst NICHT unter `src/telephony/`"). Leichte Wortlaut-Inkonsistenz, keine Verhaltens-Wirkung.

---

## 5. Clean-Code-Audit (final)

**verdict:** PASS, kein Blocker.

- **s1:** keine
- **s2:** keine
- **s3:** 1 Fund (siehe unten)
- **s4:** keine
- **blocker:** false

### S3-Fund

**C4/N-Praezision** · `src/telephony/call-lifecycle.js:29` · Kommentar „Die Formel selbst lebt in `src/call-duration.js` (G5: EINE Quelle innerhalb der Telephony-Schicht...)" ist mehrdeutig/leicht irrefuehrend: `call-duration.js` liegt bewusst NICHT unter `src/telephony/` (eigener Docstring in `call-duration.js` begruendet das explizit als „schichtneutral", Muster `util.js`, extra dafuer aus `telephony/` herausverschoben in Runde 1). Ein Leser koennte aus der Formulierung faelschlich schliessen, die Datei liege physisch in der Telephony-Schicht. **Fix-Vorschlag:** „innerhalb der Telephony-Schicht" streichen oder durch „fuer beide Telephony-Aufrufer" ersetzen.

### Urteilstext

Sauberer, eng geschnittener G5-Refactor: bisher zweifach duplizierte Max-Dauer-Formel (`bridge.js` roh mit Magic-1000, `call-lifecycle.js` separat) in einen einzigen config-freien, schichtneutralen Helfer `src/call-duration.js` gebuendelt; `MS_PER_SECOND` korrekt aus der bereits etablierten geteilten Konstante (`utils/timer.js`) statt neu dupliziert. Verhalten byte-identisch (`||`-Semantik/Deadline unveraendert). Diff bleibt strikt auf den zugesagten Scope (`bridge.js`-Timer-Zeile + `call-lifecycle.js`) begrenzt, HEIKLE STELLE (`bridge.js` `finalize`/`closed`-Guard) strukturell unangetastet. Neuer Wiring-Test fuer die Realtime-`finalize()`-Idempotenz treibt echte Doppel-Trigger (STOP-Frame + `providerWs`-Close) und verifiziert exakt einen `onCallEnded`-Aufruf gegen den bestehenden `closed`-Guard — kein Fake, echte Regression waere rot.

Kommentare sind ehrlich: die Datei benennt ihre eigene Rest-Duplizierung mit `state-ops.js#callLimitMs` selbst offen als „ECHTE Duplizierung (G5)" statt sie wegzuerklaeren; das ist per `PLAN-POLISH-A.md` OQ-1 am 2026-07-17 vom Owner ausdruecklich bestaetigt als NICHT Teil dieser Phase (`state-ops.js` bleibt config-frei) — eine dokumentierte, begruendete Ausnahme (Audit-Regel 3), daher kein S2-Blocker.

Volle Test-Suite auf dem tatsaechlichen Phase-Branch (Commit `25663f9`, sauberer Checkout unter `.claude/worktrees/wf_065204a3-003-8`) verifiziert: 2367/2367 gruen (5 neue Tests ggue. `master`: 4 in `test/call-duration.test.js` + 1 Wiring-Test in `test/bridge-openai-event.test.js`). `node --check` auf allen 4 geaenderten Produktionsdateien sauber. Keine toten Imports, kein auskommentierter Code, keine Autoren-/Datums-Metadaten in Kommentaren, keine neuen Magic Numbers (G25 im Gegenteil aufgeloest: `bridge.js` rohes `*1000` → `MS_PER_SECOND`).

### Pass-Notes

Sicherheitsrelevant unveraendert: Absolute Regel Max-Dauer (Cap-Timer) laeuft weiter byte-identisch, nur die Formel-Quelle wurde konsolidiert — keine Aenderung an Allowlist/Denylist/Budget-Gates/Offenlegung/Auth. `call-termination.js`-Aenderungen sind reine Kommentar-Praezisierungen (verifiziert: `bridge.js` importiert `terminateAndBillCall` tatsaechlich nicht — der neue Kommentar zur Trennung Realtime- vs. Budget-Engine-Terminierungspfad ist grep-bestaetigt korrekt). Testqualitaet gut: neuer Wiring-Test nutzt echten HTTP-Server + echte WebSocket-Sockets (kein ueberzogenes Mocking), Assertions synchron korrekt (`finalize()`/Handler sind synchron, kein Race). `call-duration.test.js` deckt Default-Fallback (0/null/undefined), call-eigenes Override und die volle Deadline-Formel ab.

### Top-Todos

1. Kein Blocker — Phase PA-1 (fix2) ist mergefaehig.
2. Kosmetisch, nicht blockierend: Kommentar in `call-lifecycle.js:29` praezisieren (S3-Flag oben).
3. Folgearbeit (bereits als OQ-1 getrackt, nicht Teil dieser Phase): `state-ops.js#callLimitMs` auf `callMaxDurationMs()` migrieren, sobald der Owner die Store→config-Import-Frage freigibt — loest die letzte dokumentierte G5-Kopie auf.

---

## 6. Fix-Runden

### Runde 1 (r1)

**Ergebnis:** G5-Blocker teilweise geloest, NICHT vollstaendig — Grund: Zielkonflikt mit bindender OQ-1-Invariante dieses Fix-Tasks.

**Umgesetzt:** `call-duration.js` von `src/telephony/` nach `src/call-duration.js` verschoben (schichtneutraler Top-Level-Ort, Muster `src/util.js`). Das loest den strukturellen Kern des Review-Findings (Datei liegt nun tatsaechlich nicht mehr in der Telephony-Schicht, wie zuvor vom Safety-Review als Concern vermerkt).

### Runde 2 (r2)

**Ergebnis:** G5-Blocker behoben.

`src/call-duration.js` deklariert `MS_PER_SECOND` nicht mehr selbst, sondern importiert es aus dem bereits etablierten `src/utils/timer.js` (blattfoermig, importfrei, kein Zyklus-Risiko). Der Export aus `call-duration.js` wurde entfernt, da kein Produktionscode (nur der eigene Test) ihn benoetigte.

Nach diesen zwei Fix-Runden landete die Phase auf dem finalen Branch **`phase/polish-a-p1-fix2`**.

---

## 7. Endstand

| Kriterium | Ergebnis |
|---|---|
| Gate | **PASS** (kein S1/S2-Blocker) |
| finalBranch | `phase/polish-a-p1-fix2` |
| Tests | 2367/2367 gruen (+ gezielte Suiten 47/47, Wiring-Suite 30/30) |
| Safety | APPROVED (keine Blocker, 2 nicht-blockierende Concerns — beide in den Fix-Runden adressiert) |
| Clean-Code | PASS (1 S3-Fund, kein Blocker) |
| Deploy/Push | Keiner — Branch nicht gemergt/gepusht im Rahmen dieser Phase |
