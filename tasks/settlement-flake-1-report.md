# Phasen-Report — settlement-flake-1

**Status:** Gate = **PASS** (Safety APPROVED, Clean-Code PASS, keine Blocker)
**Final-Branch:** `phase/settlement-flake-1` (Commit `9f530f5`, 1 Commit, master nicht voraus)
**Basis:** master `69ec7cd`
**Diff:** 1 Datei, +29/-1, **ausschliesslich Test** — `test/telnyx-event-ingest-route.test.js`. **0 Zeilen Produktionscode.**
**Suite:** 2846 pass / 0 fail. **Isoliert:** 30/30 gruen (plus Bestaetigungscharge 30/30 = 60/60), Baseline vorher 12/30 rot.

---

## 1. Auftrag

Der Doppelbuchungs-/Reserve-Test `test/telnyx-event-ingest-route.test.js:74` war zu ~27 % unzuverlaessig
(`reserveReleased` false statt true). Die Wurzel-Frage war **zuerst zu beantworten, nicht zu umgehen**:

- **H1 = Testschuld** — die Wartebedingung wartet nur auf `billedAt`, prueft danach `reserveReleased`.
- **H2 = Produktdefekt** — `finishCall` setzt `billedAt` und `reserveReleased` in getrennt persistierten
  Schritten; ein Prozessabbruch dazwischen bindet eine Reserve dauerhaft und blockiert das Tenant-Budget.

Verboten als Loesung (ohne H1 vorher zu belegen): Wartebedingung verbreitern, `setTimeout` verlaengern,
Retry. Das waere eine abgeschaltete Sicherung auf dem Geldpfad — ein gruener Test, der eine echte Race
verdeckt, ist schlechter als ein roter.

**Abnahme:** 30 von 30 isolierten Laeufen gruen **plus** `npm test` vollstaendig gruen.

---

## 2. Verdikt der Wurzel-Frage: **H1 (Testschuld)** — am Code belegt, H2 widerlegt

Beide Hypothesen teilen dieselbe *mechanische* Praemisse. Die Praemisse ist **wahr**; die *Folge*, die H2
daraus zieht, ist **falsch**.

### 2.1 Die Praemisse ist wahr: zwei getrennte Platten-Schreibvorgaenge

`src/telephony/call-finish.js`, `finishCall`:

```js
if (!call.billedAt) {
  if (config.billing.paymentEnabled) metering.recordVoiceMinuteMeter(call);
  metering.reconcileOutboundVoiceBudget(call);
  store.markBilled(call.id);        // <-- PLATTEN-SCHREIBVORGANG #1
}
await releaseReserve(call);          // <-- ASYNC-GRENZE (withStoreLock-Kette), KEIN save
store.save();                        // <-- PLATTEN-SCHREIBVORGANG #2
```

- `src/store/json.js`, `markBilled`: `if (changed) save()` → **`billedAt` liegt sofort auf der Platte,
  `reserveReleased` noch `false`.**
- `src/store/json.js`, `releaseOutboundReserve`: **kein `save()`** (Kommentar dort: „KEIN save():
  reservations ist strukturell ephemer").
- `src/store/state-ops.js`, `releaseOutboundReserve`: setzt `call.reserveReleased = true` rein in-memory.
- Erst `store.save()` in `finishCall` bringt `reserveReleased` auf die Platte.

Der Test liest die Platte (`test/helpers.js`, `readStore()` → `JSON.parse(fs.readFileSync(...))`,
Poll-Intervall 20 ms in `waitForStoreState`). Die alte Wartebedingung war am **frueheren** Schreibvorgang
verankert und prueft danach das Feld des **spaeteren** — sie trifft den Zwischenstand deterministisch
irgendwann. Fensterbreite ≈ `JSON.stringify` + `write` + `fsync` + `rename`, wenige ms bei 20 ms Poll.

Zeitliche Ausrichtung, die die hohe Rate erklaert: `src/telnyx-call-control-ingest.js`,
`handleCallControlEvent` macht `res.sendStatus(200)` **sofort** und settled danach — der Test beginnt also
exakt zu Settlement-Beginn zu pollen, nicht zufaellig verteilt.

**Reproduktion (Impl-Lauf, isoliert):** 12 von 30 Laeufen rot, Fehler jedes Mal exakt `false !== true` auf
Zeile 74, bei bereits gruenem `status === "completed"` (Zeile 72) und gruenem `assert.ok(billedAt)`
(Zeile 73). Das ist byte-genau der `markBilled`-Zwischenstand. (Planungslauf zuvor: 1/15 rot;
Safety-Review unabhaengig: 12/30 rot; Clean-Code-Audit unabhaengig: 5/15 rot — siehe Abweichung D2.)

### 2.2 H2 ist falsch: der behauptete Schaden kann nicht eintreten

H2 behauptet, ein Abbruch zwischen den Schritten binde eine Reserve dauerhaft und blockiere das
Tenant-Budget. Der Reserve-Ledger kann einen Neustart aber gar nicht ueberleben:

| Beleg | Stelle |
| --- | --- |
| `s.reservations` wird per Rest-Destrukturierung aus **jedem** `save()` ausgeschlossen | `src/store/json.js`, `save()`: `const { reservations, subIndex, platformSpendWarnedMonth, ...persisted } = state;` |
| gepinnt durch Bestandstest | `test/reservation-json-ephemeral.test.js` — „reservations-Key ist strukturell von der Platte ausgeschlossen" |
| pg kennt weder Reserve-Spalte noch Hydrierung: `rowToCall` setzt `billedAt: r.billed_at ?? null`, aber **kein** `reserveCents`/`reserveReleased`; `src/db/schema.sql` hat keine Reserve-Spalte | `src/store/pg.js`, `src/db/schema.sql` |
| Ueber-Freigabe ist geklemmt, ein Nachzuegler kann nicht negativ buchen | `src/store/state-ops.js`: `Math.max(0, reservationFor(...) - call.reserveCents)`, gepinnt in `test/reservation-ledger.test.js` |
| `save()` schreibt atomar (tmp + fsync + rename) — ein truncated read scheidet als Ursache aus | `src/store/json.js` |

Folge: Nach jedem Boot ist der Ledger `{}` → 0. In Produktion (`STORE_BACKEND=pg`) hat ein rehydrierter
Call nicht einmal `reserveCents`, `releaseOutboundReserve` ist dort nach einem Boot ein No-op.
**Ein Abbruch zwischen den beiden Schreibvorgaengen kann keine Reserve binden.**

`billedAt` (prozessuebergreifender Bucht-Riegel, eigene Spalte `billed_at`, in `rowToCall` hydriert) und
`reserveReleased` (In-Prozess-Schloss eines strukturell ephemeren Ledgers) haben **absichtlich
verschiedene Lebensdauern**. Sie atomar zusammen persistieren zu wollen ist ein Kategoriefehler.

**Korrektur an der Spec:** Es gibt **keine** Codestelle, die Atomaritaet garantiert — sie durfte auch nicht
erfunden werden. Die tragende Zusicherung ist eine andere und fuer den behaupteten Schaden staerker:
*der Reserve-Ledger erreicht nie die Platte, deshalb ist die Reihenfolge der beiden Marker keine
Crash-Sicherheits-Frage.*

### 2.3 Praezedenzfall in der Bestandssuite

`test/telnyx-p5-origination.test.js` wartet auf **denselben** `finishCall`-Abschluss und verankert korrekt
am spaeteren Marker (`reserveReleased === true`) — dieser Test flaked nicht.
`test/telnyx-event-ingest-route.test.js` war die **einzige** Stelle der Suite, die auf `billedAt` wartet
und danach ein Feld des spaeteren Schreibvorgangs prueft. Der Flake war also eine isolierte Abweichung vom
bereits etablierten Muster, kein Produktsignal.

### 2.4 Pre-Mortem

*Ein Jahr spaeter war die Entscheidung falsch.* Was ist passiert? Jemand hat `s.reservations` persistent
gemacht (Multi-Instanz-Deploy) oder eine `reserve_released`-Spalte ergaenzt — dann wird die Reihenfolge
sehr wohl crash-relevant und die Begruendung im Test rottet still.
**Entschaerfung:** Der Kommentar nennt diese Vorbedingung *explizit als Vorbedingung* und verweist auf
`test/reservation-json-ephemeral.test.js` als deren Waechter — wer die Ephemeralitaet aufhebt, sieht diesen
Test rot und findet ueber ihn den Kommentar. Kein Produktumbau, kein neuer Waechter noetig.

---

## 3. Plan (gekuerzt)

- **Neue Dateien:** keine. Der Befund ist Testschuld an genau einer Wartebedingung.
- **Einziger Edit:** `test/telnyx-event-ingest-route.test.js` — Wartebedingung von
  `(s) => Boolean(s.calls[0].billedAt)` auf
  `(s) => Boolean(s.calls[0].billedAt) && s.calls[0].reserveReleased === true` plus Begruendungs-Kommentar.
- **Produktdateien:** keine Aenderung an `src/telephony/call-finish.js`, `call-termination.js`,
  `src/store/state-ops.js`, `json.js`, `pg.js`, `src/telnyx-call-control-ingest.js`. Ausdruecklich nicht
  angefasst: die Reihenfolge in `finishCall` (beide Reihenfolgen sind crash-sicher), die
  fire-and-forget-Semantik von `bill()` in `terminateAndBillCall` (Absolute Regel 1 — der Max-Dauer-Cap
  darf nie auf die Buchungskette warten), der sofortige `res.sendStatus(200)` im Ingest
  (Telnyx-Retry-Verhalten).
- **Assertions 72-74 bleiben woertlich stehen** — nicht redundant, weil `waitForStoreState` am Ende einen
  **frischen** Re-Read liefert, nicht den Snapshot, der das Praedikat erfuellt hat.
- **Zeilen 77-82** (zweites hangup, 200-ms-Gnadenfrist, `billedAt`-Vergleich) unangetastet.
- **Kein neuer Test:** kein neues Verhalten (0 Zeilen Produktionscode). Die tragenden Zusicherungen sind
  bereits gepinnt: `reservation-json-ephemeral`, `reservation-ledger`, `store-pg-billing-idempotent`,
  `state-ops-set-once-timestamp`, `finishcall-billing-once`, `call-termination-order`. Ein „Test, der das
  Fenster gezielt trifft" waere nur unter H2 gefordert und wuerde die Zwei-Schreibvorgang-Struktur als
  Vertrag festnageln.
- **Blast-Radius:** 1 Datei, 1 Logikzeile, 0 Produktionscode, keine Safety-Gates, keine Geldpfade, keine
  abgeschaltete Sicherung — die Zusicherung wird **staerker** geprueft als vorher.

---

## 4. Implementierung

### 4.1 Zusammenfassung

Wurzel-Frage beantwortet, nicht umgangen: **H1 trifft zu, H2 ist am Code widerlegt.** Umsetzung exakt
gemaess Plan — 1 Datei, 1 Logikzeile, 0 Zeilen Produktionscode.

Das Praedikat fordert jetzt **beide** Settlement-Marker (`billedAt` UND `reserveReleased === true`) statt
nur `billedAt` — derselbe Warte-Anker, den `test/telnyx-p5-origination.test.js` fuer denselben
`finishCall`-Abschluss schon benutzt und der dort nicht flaked.

**Verbotene Wege nicht beschritten:** kein verbreitertes/aufgeweichtes Assert, kein verlaengertes
`setTimeout`, kein Retry. Die 200-ms-Gnadenfrist und der Doppelbuchungs-Vergleich stehen unveraendert; die
Assertions 72-74 stehen woertlich weiter da. Die Zusicherung wird staerker geprueft: das Praedikat fordert
den fertigen Settlement-Zustand **aktiv**, statt ihn auf gut Glueck abzufragen.

### 4.2 Verifikation

| Pruefung | Ergebnis |
| --- | --- |
| `node --check` | PASS |
| Isolierte Laeufe (Impl) | **30/30 gruen**, zweite Charge nach Commit ebenfalls 30/30 → 60/60 |
| Baseline vor Fix (Impl) | 12/30 rot, Signatur immer `false !== true` auf Zeile 74 |
| `npm test` | **2846 pass / 0 fail**, kein Suite-Flake aufgetreten (Gate-Protokoll musste nicht greifen) |
| Runtime-Smoke | Echter Server-Kindprozess, freier Port, `DATA_DIR`-Override; `GET /healthz` → 200; `POST /voice/call-control?callId=call_test1` mit `call.hangup` → 200; danach Store gelesen: `status=completed`, `billedAt` gesetzt, `reserveReleased=true`. Settlement-Pfad zur Laufzeit vollstaendig durchlaufen, nicht nur im Test-Harness. |
| Arbeitsbaum | sauber, `node_modules`-Symlink nicht getrackt |

### 4.3 Clean-Code-Selbstpruefung (Impl)

Katalog durchgegangen, 0 FLAGs S1-S4. P11/T-Serie n. z. (kein Produktionscode → kein neuer Test faellig,
alle drei referenzierten Waechter-Tests existieren, Existenz verifiziert). G5/S2: keine Duplizierung, das
Praedikat folgt dem Bestandsmuster; ein 1-Zeilen-Praedikat dateiuebergreifend zu extrahieren waere
Indirektion ohne Mehrwert (S4). G25: keine Magic Numbers, kein neues Timing-Konstrukt. C5/G9: kein
toter/auskommentierter Code. G12: keine Imports beruehrt. C2: der Kommentar nennt nur Datei- und
Symbolnamen, keine `Datei:Zeile`-Referenzen (die bestehende `:171`-Referenz im Datei-Header ist Bestand,
ausserhalb des Scope). F1: `waitForStoreState` mit 2 Argumenten. Konventionen: ESM, Kommentar deutsch, per
`grep '[^ -~]'` als reines ASCII belegt.
**Urteilsfall:** der Kommentar ist mit 22 Zeilen lang — bewusst, weil die Begruendung dateiuebergreifend
ist (`json.js` rest-omit + `pg.js` fehlende Hydrierung + zwei Waechter-Tests) und im Code selbst nicht
ausdrueckbar. Entspricht der Kommentar-Kultur des Bestands. Nicht als Verstoss gewertet.

### 4.4 Abweichungen (deviations)

- **D1 — `prettier --check` nicht ausfuehrbar.** Prettier ist devDependency, aber nicht installiert
  (`node_modules` ohne prettier-Verzeichnis); `npx` kann offline nicht nachladen (Exit 194). Ersatzweise
  manuell verifiziert: alle **neuen** Zeilen ≤ printWidth 100, 2-Space-Indent, trailing comma nach dem
  letzten Argument, doppelte Anfuehrungszeichen, Semikolons. Hinweis: Zeile 43 der Datei verletzt
  printWidth bereits im Bestand — bewusst nicht angefasst (Plan: alles ausser der einen Zeile
  byte-identisch).
- **D2 — Baseline-Fehlerrate 40 % statt 27 %.** 12 von 30 rot im Impl-Lauf, nicht 27 % bzw. 1/15 aus dem
  Planungslauf. Identische Fehlersignatur, also exakt der `markBilled`-Zwischenstand. Die Rate ist
  last-/maschinenabhaengig, der Befund unveraendert. **Als gemessen berichtet, nicht auf die Vorgabe
  geglaettet.**
- **D3 — `tasks/lessons.md` nicht bearbeitet.** Plan deklariert „einziger Edit" und Blast-Radius
  „Geaenderte Dateien: 1". Die Lehre steht stattdessen hier (Abschnitt 8).
- **D4 — Kein separater `STORE_BACKEND=pg`-Suitelauf.** Das Repo kennt nur ein `test`-Skript. Beide
  Backends laufen in EINEM `npm test`: json als `BASE_ENV`-Default in `test/helpers.js`, pg in-process
  ueber pglite (Dutzende Testdateien ziehen pglite selbst hoch). Kein zweiter Lauf noetig/moeglich.

---

## 5. Safety-Urteil: **APPROVED**

| Kriterium | Ergebnis |
| --- | --- |
| `approved` | true |
| Tests laufen unabhaengig gruen | true |
| Safety-Gates intakt | true |
| Offenlegung intakt | true |
| Auth fail-closed intakt | true |
| Keine Secrets geleakt | true |
| Scope respektiert | true |
| Verhalten wie beabsichtigt | true |
| **Blocker** | **keine** |

**Diff-Pruefung:** `master..phase/settlement-flake-1` ist EINE Datei, +29/-1, ausschliesslich Test. Kein
`src/`, kein `package.json`, kein `package-lock.json`, keine neue Dependency, keine Doku-Beifaenge, ein
einziger Commit, master ist nicht voraus.

**Wurzel selbst nachgeprueft (nicht dem Commit geglaubt):** `finishCall` → `store.markBilled` (json-Wrapper
`if (changed) save()` → `billedAt` sofort auf Platte), danach `await releaseReserve(call)`
(`store.withStoreLock` → `releaseOutboundReserve`, setzt `reserveReleased = true` OHNE `save`), erst danach
`store.save()`. Zwischen den beiden Schreibvorgaengen existiert reproduzierbar ein Dateizustand mit
`billedAt` gesetzt und `reserveReleased=false` — genau das traf das alte Praedikat. `save()` schreibt
atomar (tmp + fsync + rename), ein truncated read ist also nicht die Ursache.

**H2 unabhaengig widerlegt:** `s.reservations` per Rest-Destrukturierung aus JEDEM `save()` ausgeschlossen;
`src/store/pg.js` enthaelt weder `reserveReleased` noch `reserve_released`, `rowToCall` hydriert nichts
dergleichen, `src/db/schema.sql` hat keine Reserve-Spalte (grep leer); `releaseOutboundReserve` klemmt auf
`Math.max(0, ...)`. Ein Prozessabbruch kann folglich keine Reserve gebunden lassen und kein Tenant-Budget
blockieren.

**Absolute Regeln:** Safety-Gates (`numberGateError` in `src/telephony/outbound-gates.js`) unberuehrt;
`disclosureSentence` (`src/claude.js`, `src/bridge.js`) unberuehrt; der Ed25519-fail-closed-Test im selben
File („fehlender/bogus Header → 403, KEINE Zustandsaenderung") ist byte-identisch geblieben; keine neuen
Endpunkte; keine Secrets in Diff oder Commit-Message; Flag-off-Verhalten trivial byte-identisch, weil kein
Produktionscode angefasst wurde.

**Unabhaengige Testlaeufe (frischer Worktree, Branch aus `phase/settlement-flake-1`):**

1. `npm test` Lauf 1: 2846 tests / 2846 pass / 0 fail / 0 cancelled / 0 skipped, 84,9 s, exit 0.
2. `npm test` Lauf 2: 2846 / 2846 / 0 fail, exit 0 — kein Voll-Last-Flake reproduziert.
3. pg-/pglite-Teilmenge explizit (`rls-with-check`, `web-auth-pg`, `store-pg-drain-flushes`,
   `billing-hold-capture`, `tenant-prolif-d-reconcile`, `state-ops-tenant-stripe`, `reservation-ledger`,
   `reservation-json-ephemeral`, `telnyx-p5-origination`, `telnyx-event-ingest-route`): 71/71 pass, 0 fail.
4. **Flake-Beweis unabhaengig gefuehrt:** master-Fassung der Datei per `git archive` extrahiert, 30x
   isoliert → **12/30 ROT**, Fehlerbild jedes Mal `false !== true` auf `reserveReleased`. Branch-Fassung
   30x isoliert → **0/30 rot**. Damit ist die Commit-Behauptung 1:1 reproduziert. Temporaere Kopie
   geloescht, `git status --porcelain` sauber.

**Concerns (kein Blocker):**

1. **Zwei Assertions werden tautologisch.** Nach dem neuen Warten sind `assert.ok(billedAt)` und
   `assert.equal(reserveReleased, true)` per Konstruktion wahr. Eine echte Produkt-Regression
   (`reserveReleased` wird NIE gesetzt) faellt dadurch nicht mehr als scharfe Assertion, sondern als
   4-s-Timeout aus `waitForStoreState` („Store-Zustand nicht erreicht" + calls-Dump). **Erkennung bleibt
   erhalten**, Diagnose wird minimal schlechter. `test/telnyx-p5-origination.test.js` nutzt dasselbe Muster
   bereits — akzeptabel, aber kein Gewinn.
2. **25 Zeilen Kommentar auf 1 Zeile Code**, mit vorwaerts gerichteten Behauptungen („Faellt diese
   Vorbedingung je …"). Alle Behauptungen am Code verifiziert und heute korrekt; Wartungslast, falls der
   Reserve-Ledger je persistent wird. Der Kommentar benennt diesen Trigger immerhin selbst.
3. **VORBESTEHEND:** `npx prettier --check` warnt — aber die master-Fassung derselben Datei warnt
   identisch, und der einzige Prettier-Delta sitzt in Zeile 43 (`assert.equal` ueber 110 Zeichen), die der
   Diff NICHT anfasst. Die neu hinzugefuegten Zeilen sind prettier-konform.
4. **VORBESTEHEND, Umgebungsluecke:** `npm run lint` laeuft in diesem Repo derzeit gar nicht — `@eslint/js`
   fehlt komplett in `node_modules` (`ERR_MODULE_NOT_FOUND` aus `eslint.config.js`). Betrifft master
   genauso, kein Befund gegen den Branch, **aber ein Lint-Gate existiert faktisch nicht.**

---

## 6. Clean-Code-Audit: **PASS (kein Blocker)**

| Stufe | Anzahl |
| --- | --- |
| **S1** | 0 |
| **S2** | 0 |
| **S3** | 2 |
| **S4** | 0 |

**Verdikt:** Diff ist test-only (1 Datei, +29/-1), die Wurzel des Flakes ist korrekt getroffen und der Fix
empirisch belegt: derselbe Testlauf 15x auf master = 10 pass / 5 fail (~33 %), 15x mit dem Branch-Stand =
15/15 pass. Keine Produktionsdatei, keine Safety-Gates/Auth/Secrets beruehrt.

### 6.1 S3-Befunde (offen, kein Blocker)

- **G19/N3 · `test/telnyx-event-ingest-route.test.js:96-99`** — Das Praedikat drueckt die Absicht
  „Settlement abgeschlossen" als rohe Feld-Konjunktion inline aus; der Begriff hat keinen Namen, obwohl
  `test/telnyx-p5-origination.test.js:178` auf denselben Abschluss wartet (dort nur
  `reserveReleased === true`) — zwei Testdateien kodieren denselben Domaenenbegriff verschieden.
  *Bewusst NICHT S2:* einzelner Ausdruck, keine identische Logik, und `waitForStoreState` ist bereits die
  Abstraktion. **Fix:** benanntes Praedikat in `test/helpers.js`
  (z. B. `isSettled(call) => Boolean(call.billedAt) && call.reserveReleased === true`) an beiden Stellen.
- **C4/C2-Risiko · `test/telnyx-event-ingest-route.test.js:71-94`** — 24 Kommentarzeilen auf 2 geaenderte
  Codezeilen; nur der erste Absatz begruendet das Testpraedikat. Absatz 2 erklaert eine PRODUKT-Eigenschaft
  (Ephemeralitaet des Reserve-Ledgers, Crash-Sicherheit) und wiederholt woertlich Wissen, das bereits an
  der Quelle steht (`src/store/json.js` rest-omit, `src/store/state-ops.js` Clamp/Latch,
  `src/telephony/call-finish.js` `releaseReserve`) — jede Aenderung dort laesst diesen Kommentar veralten,
  ohne dass ihn jemand sieht. Inhaltlich belegt (alle Behauptungen am Code geprueft), also **kein
  C2-Verstoss heute**, aber ein gebautes Drift-Risiko. **Fix:** Absatz 2 auf zwei Saetze + Quellverweise
  kuerzen, den Rest der Begruendung in diesen Report.

### 6.2 Was der Auditor als sauber bestaetigt hat

- **Wurzel statt Symptom:** die alte Wartebedingung verankerte am frueheren von zwei Platten-Schreib-
  vorgaengen und assertete danach das Feld des spaeteren — am Code verifiziert (`json.js` `markBilled` →
  `save` bei `changed` vs. `releaseOutboundReserve` OHNE `save`; `call-finish.js`
  `await releaseReserve(call); store.save();`). Der Fix wartet auf den terminalen Marker — **kein sleep,
  kein Timeout-Tuning, keine abgeschwaechte Assertion (G4: keine uebergangene Sicherung).**
- Keine Assertion entfernt oder aufgeweicht; das Praedikat wurde nur **strenger**. Der Fehlerfall bleibt
  diagnostizierbar, weil `waitForStoreState` bei Timeout `JSON.stringify(calls)` mitliefert.
- Der Re-Read-Punkt ist korrekt bedacht: `waitForStoreState` liefert einen ZWEITEN `readStore()`; da
  `billedAt` (setOnceTimestamp) und `reserveReleased` (Latch) monoton sind und `json.js` atomar schreibt
  (tmp+fsync+rename), ist der Re-Read stabil.
- `status === "completed"` bleibt unter dem neuen Anker gedeckt: `src/telnyx-call-control-ingest.js` setzt
  `endCallRecord(..., "completed")` in `persistEnd` VOR `bill`/`finishCall`.
- Alle Faktenbehauptungen des Kommentars am Code nachgeprueft und korrekt (rest-omit von
  `s.reservations`; `billed_at`-Spalte + Hydrierung in `pg.js`; pg ohne `reserveReleased`-Spalte;
  Clamp ≥ 0; beide zitierten Tests existieren und decken das Zitierte ab).
- **Kein Flake dieser Klasse anderswo offen:** die drei uebrigen `billedAt`-Warter
  (`test/max-duration-rearm.test.js:61`, `test/telnyx-p6-boot-rearm.test.js:54`,
  `test/max-duration-live-cap.test.js:51`) assertieren ausschliesslich Felder, die VOR bzw. mit demselben
  `save()` geschrieben werden (`status`/`endedAt`/`usage`) — kein `reserveReleased`, keine
  `notifications`. **Nichts nachzuziehen.**
- Konventionen eingehalten: deutsche Kommentare ohne Umlaute, kein toter/auskommentierter Code, keine
  Magic Numbers, keine neue Dependency, kein Produktumbau fuer ein Testproblem.
- Nicht bewertbar (Regel 7, Prozess/Repo): test-first-Reihenfolge, Coverage, Laufzeit der Gesamtsuite.

### 6.3 Top-Todos (nachgelagert, nicht Teil dieser Phase)

1. Kommentarblock `test/telnyx-event-ingest-route.test.js:81-91` auf zwei Saetze + Quellverweise kuerzen —
   er dupliziert Produktwissen aus `json.js`/`state-ops.js`/`call-finish.js` und veraltet dort unbemerkt.
2. Benanntes Praedikat (z. B. `isSettled(call)` in `test/helpers.js`) einfuehren und in
   `test/telnyx-p5-origination.test.js:178` mitnutzen, damit „Settlement abgeschlossen" EINEN Namen und
   EINE Definition hat.

---

## 7. Fix-Runden

**Keine.** Erster Impl-Durchgang, beide Reviews (Safety + Clean-Code) beim ersten Durchlauf ohne Blocker:
Safety `approved: true`, `blockers: []`; Clean-Code `blocker: false`, S1 = 0, S2 = 0. Es blieben nur zwei
S3-Punkte (Namensgebung, Kommentar-Laenge) — keine Self-Fix-Runde ausgeloest.

---

## 8. Lehre fuer `tasks/lessons.md`

> **Eine Wartebedingung in einem Spawn-Test muss am TERMINALEN Marker eines mehrstufigen
> Persistenz-Ablaufs verankern, nie an einem Zwischenmarker — sonst prueft der Test einen Zustand, den er
> selbst als noch nicht erreicht definiert hat.**

Zusatz-Lehren aus dieser Phase:

- **Flake-Rate ist last-/maschinenabhaengig, der Befund nicht.** Vier unabhaengige Messungen ergaben 1/15,
  12/30, 12/30 und 5/15 rot — bei jedes Mal identischer Fehlersignatur. Raten nicht auf eine
  Spec-Vorgabe glaetten; die Signatur, nicht die Prozentzahl, ist der Beweis.
- **Zwei Marker mit verschiedenen Lebensdauern sind kein Atomaritaets-Problem.** Bevor eine
  „Zwei-Schritt-Persistenz" als Crash-Risiko gefixt wird: pruefen, ob der zweite Wert die Platte ueberhaupt
  je erreicht. Hier war die Antwort nein (rest-omit in `save()`, keine pg-Spalte) — der behauptete Schaden
  war strukturell unmoeglich.
- **Ein Lint-Gate, das nicht laeuft, ist kein Gate.** `npm run lint` scheitert repo-weit an fehlendem
  `@eslint/js`; prettier ist als devDependency deklariert, aber nicht installiert. Beides vorbestehend,
  beides ausserhalb dieser Phase — aber es bedeutet, dass Formatier-/Lint-Aussagen derzeit nur manuell
  belegbar sind.
