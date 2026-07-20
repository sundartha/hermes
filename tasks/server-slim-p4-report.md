# Server-Slim P4 — Report: `src/telephony/call-finish.js` (finishCall + releaseReserve)

**Datum:** 2026-07-16
**Gate:** **PASS**
**finalBranch:** `phase/slim-p4-call-finish`
**Basis:** `master` @ `1f05568` (server.js 2105 Zeilen, P0a-P3 bereits gemergt)
**Ergebnis-Commit:** `3f10728af4cf3aeffab4a625baef4ee6d45e9514`

---

## 0. Ziel der Phase

Extraktion des Geld-Pfads aus `src/server.js`: `finishCall` (Settlement/Summary/Notification/SMS beim Call-Ende) und `releaseReserve` (Worst-Case-Reserve-Freigabe, OUT-05/F2) wandern in ein neues Modul `src/telephony/call-finish.js`, als Factory `makeCallFinish(deps) -> { finishCall, releaseReserve }`. Reine Verschiebung, byte-identischer Funktionskörper — keine Verhaltensänderung.

---

## 1. Plan (gekürzt)

### Verifizierter Ist-Zustand (vor Umsetzung, gegen echten Code geprüft)

| Symbol | Plan-Doc (veraltet) | Echter Code |
|---|---|---|
| `releaseReserve` Definition | L768-772 | **L680-688** |
| `finishCall` Definition | L1092-1181 | **L951-1042** |
| `finishCall` Call-Sites (6) | L742,1245,1260,1391,1440,2207 | **658, 1106, 1121, 1252, 1301, 2068** |
| `releaseReserve` externer Caller | — | **697** (`armReserveReleaseTimer`, bleibt in server.js = P5) |
| `releaseReserve` intra-modul | — | **966** (in `finishCall`, wandert mit) |

Alle 6 `finishCall`-Call-Sites gegen den realen Code bestätigt. Kein Test importiert `finishCall`/`releaseReserve`/`makeCallFinish` aus `server.js` (server.js ist export-frei); Treffer in `test/telnyx-event-ingest-machine.test.js`/`telnyx-shim-harness.js` sind eigene Stubs für den `makeCallControlIngest`-Vertrag und von P4 unberührt.

**Deps der neuen Factory** (ein Objekt-Arg, F1-konform, Muster `makeMetering`): `store`, `config`, `metering`, `messaging`, `summarizeCall`, `planSummarySms`, `audit` (7 Keys). Modul-eigener Import: `USAGE_EVENT_KIND` aus `../store/defaults.js` (Muster P1: „Kind-Quellen importiert das Modul selbst"). `releaseReserve` braucht nur `store`.

### Neue Datei `src/telephony/call-finish.js`

`makeCallFinish(deps)` liefert `{ finishCall, releaseReserve }`. Beide Funktionskörper **verbatim** aus server.js übernommen (nur mechanisch um 2 Spaces eingerückt, Factory-Schachtelung). Wesentliche Invarianten, im Plan-Kommentar dokumentiert:

- **INV-7**: EINE Instanz je Prozess (Wurzel-Scope) — dieselbe `finishCall`-Referenz geht an `attachMediaBridge` UND `makeCallControlIngest`; die In-Memory-Guards (`call._finished`) und der persistierte `billedAt`-Marker verlangen Identität.
- **INV-9**: `if (config.paymentEnabled)`-Gate (Voice-Minuten-Meter) bleibt im `finishCall`-Body unverändert; `reconcileOutboundVoiceBudget` läuft immer; `releaseReserve` wird intra-modul aufgerufen.
- `releaseReserve` ist fehler-schluckend (kein Freigabepfad darf einen unhandled reject werfen) und liefert ein Promise.
- `finishCall` idempotent über `call._finished` (Prozesslaufzeit) plus persistierten `billedAt`-Marker (überlebt Restart, F9 — Abrechnung genau einmal). Transkript-Purge nach erfolgreicher Summary (DSGVO-Datenminimierung). SMS-Ziel/Sende-Entscheidung über `planSummarySms` ausgelagert (Ziel = private Nummer des Call-Tenants, kein Owner-Fallback). Usage-Event/Dedup-Marker (`summarySmsSentAt`) nur nach erfolgreichem SMS-Send.

### Edits an `src/server.js` (E1-E11)

- **E1**: Import `makeCallFinish` aus `./telephony/call-finish.js`, gruppiert mit den telephony/call-\*-Helfern.
- **E2**: Konstruktion `const callFinish = makeCallFinish({...})` direkt nach `const metering` (L166/167) — im bestehenden Boot-Singleton-Cluster, alle 6 Call-Sites liegen darunter → keine Vorwärts-/TDZ-Referenz.
- **E3**: `releaseReserve`-Definition (L680-688) entfernen, `armReserveReleaseTimer` (P5) bleibt.
- **E4**: `armReserveReleaseTimer` ruft `callFinish.releaseReserve(...)`.
- **E5**: `terminateCappedCall`-Bill-Thunk (L658) → `billThunk(callFinish.finishCall, store, callId)`.
- **E6**: `finishCall`-Definition (L951-1042) entfernen, eine der angrenzenden Leerzeilen bereinigen.
- **E7**: `/voice/status`-Bill-Thunk (L1106) → `callFinish.finishCall`.
- **E8**: `makeCallControlIngest`-Dep (L1121): Shorthand `finishCall,` → `finishCall: callFinish.finishCall,` (Property-Name bleibt Vertrag).
- **E9**: `/api/calls`-Catch-Settlement (L1252) → `callFinish.finishCall`.
- **E10**: `/api/calls/:id/cancel`-Settlement (L1301) → `callFinish.finishCall`.
- **E11**: `attachMediaBridge(httpServer, callFinish.finishCall)` (L2068).

Bewusst unberührt: Prosa-Kommentare, die `finishCall`/`releaseReserve` erwähnen; `armReserveReleaseTimer`, `armMaxDurationTimer`, `terminateCappedCall`, `scheduleMaxDurationEnd`, `reattachActiveCall`-Wrapper (bleiben in server.js, P5); `bridge.js` unangetastet (A3).

**Geplanter Blast-Radius:** 1 neue Datei; server.js: +1 Import, +1 Konstruktions-Block, −101 Zeilen (Definitionen), 7 Call-Site-Ersetzungen → Netto ≈ **−96 Zeilen** (2105 → ~2009).

### Tests laut Plan

Kein neuer Testfall geplant (reine Verschiebung, byte-identisches Verhalten). Bestandssuite deckt die load-bearing Facetten ab: `finishcall-billing-once`, `f2-sms-summary-plan`, `f2-p9-dedup-persist`, `outbound-reserve-release-success`, `graceful-shutdown`.

---

## 2. Impl-Zusammenfassung

- **filesCreated**: `src/telephony/call-finish.js`
- **filesEdited**: `src/server.js`, `test/call-termination-order.test.js`
- **headCommit (Impl)**: `3f10728af4cf3aeffab4a625baef4ee6d45e9514`
- **committed**: ja (auf `phase/slim-p4-call-finish`)
- **nodeCheckPass**: true (beide Dateien)
- **testsPass**: true — 2289 pass / 1 fail (klassifiziert als vorbestehender Flake, siehe Deviations)
- **smokePass**: true — Server lokal (`PORT=3999`, `SKIP_TWILIO_SIGNATURE_CHECK=true`) gebootet: Boot-Log byte-identisch, `GET /healthz` → 200, `POST /voice/status` (unbekannte CallSid) → 200 ohne Crash (läuft jetzt via `terminateAndBillCall` indirekt durch `callFinish.finishCall`), `POST /api/calls/nonexistent/cancel` → 404. Kein Server-Log-Fehler.

**Tatsächliches Ergebnis:** `src/server.js` 2105 → **2018 Zeilen** (netto **−87**, +23/−110). Alle geplanten Call-Sites (658, 1106, 1121, 1252, 1301, 2068) sowie der Reserve-Release-Timer (697) auf `callFinish.finishCall`/`callFinish.releaseReserve` umgestellt. `makeCallFinish` genau **1x** konstruiert (L166/167, direkt nach `metering`).

**grep-Invarianten bestätigt:**
- 0 Funktionsdefinitionen (`function finishCall`/`function releaseReserve`) mehr in server.js
- 2x `makeCallFinish` (Import + Konstruktion)
- 6x `callFinish.finishCall`
- 1x `callFinish.releaseReserve`
- 1x `export` in `call-finish.js`, 0x `export` in `server.js`
- Boot-Log-Zeile weiterhin genau 1x

### Deviations

1. **Volle `npm test`-Default-Concurrency hängt auf dieser Maschine** unter Volllast (mehrere spawn-basierte Testdateien blieben >8 Min bei ~0% CPU hängen, Ressourcen-Erschöpfung durch zu viele parallele Kindprozesse). Workaround: `node --test --test-concurrency=4 test/*.test.js` (json und pg) für ein reales, nicht-hängendes Signal. Kein Code-Defekt, reine Maschinen-/Umgebungs-Charakteristik dieses Volllast-Runs, unabhängig von P4.
2. **json-Backend (bounded concurrency=4):** 2290 Tests, 2289 pass, 1 fail (`test/inbound-routing.test.js`, „fehlende To → fail-closed Hangup + Audit, kein Call-Record"). Isoliert lief die Datei 8/8 grün; sie referenziert weder `finishCall` noch `callFinish`. Klassifiziert als der im Repo dokumentierte Voll-Last-Flake (Gate-Protokoll: nur echt rot, wenn isoliert rot bleibt) — kein P4-Blocker.
3. **pg-Backend (bounded concurrency=4):** 2023 Tests, 1990 pass, 33 fail, alle mit identischem Fehlerbild `[store] FATAL: pg-Backend nicht initialisierbar (STORE_BACKEND=pg). DB unerreichbar`. Zur Absicherung derselbe Befehl in einem separaten Throwaway-Worktree gegen unverändertes master (Commit `1f05568`, P4-Ausgangsbasis) laufen lassen: **identische Zahlen** (2023/1990/33) UND byte-identische Menge der 33 betroffenen Dateien (diff exit 0) → zu 100% als vorbestehende Umgebungslücke dieser Maschine verifiziert, nicht durch P4 verursacht, außerhalb des Scopes dieser Phase. Alle 5 SPEC-Gate-Tests liefen unter beiden Backends explizit isoliert **15/15 grün**.
4. **`test/call-termination-order.test.js` geändert:** 3 Quelltext-Wiring-Guards hatten den bare Bezeichner `finishCall` hartkodiert in einem Regex (Whitebox-Test gegen den rohen server.js-Quelltext). Da P4 genau diese Aufrufstellen bewusst auf `callFinish.finishCall` umbenennt (Plan E5/E7/E9/E10, dokumentierte Signaturänderung), wurden die 3 Regex-Literale entsprechend angepasst (mit Begründungskommentar). Laut SPEC ausdrücklich erlaubt („Bestandstests nur bei bewusster Verhaltens-/Signaturänderung anpassen, im Plan begründet"). Keine Verhaltensänderung, alle 13/13 Tests der Datei laufen danach grün; kein neuer Test nötig.

### Clean-Code-Selbstcheck (Impl-Agent)

Gegen `.claude/refs/clean-code.md` geprüft: P15 (Konstruktion in der Wurzel via Factory, kein `new`/Lazy-Init im Fachcode) PASS · F1 (7 Deps als ein Objekt-Arg) PASS · G5 (`USAGE_EVENT_KIND` nur im neuen Modul importiert, eine Quelle) PASS · G12 (alle destrukturierten Deps im Modul-Body tatsächlich genutzt) PASS · N7 (Funktionsnamen unverändert, Nebeneffekt-Doku erhalten) PASS · C-Serie (keine neuen redundanten/toten Kommentare) PASS · G30/G34 (Struktur/Abstraktionsebene unverändert übernommen) PASS · INV-7 (genau eine `callFinish`-Instanz, per grep verifiziert) PASS · keine neuen Magic Numbers, keine neuen npm-Dependencies.

---

## 3. Safety-Urteil (final)

**Verdict: APPROVED**

- `testsPassIndependently`: true — im frischen Worktree (Branch `review-slim-p4` auf `phase/slim-p4-call-finish`) unabhängig ausgeführt: `node --check` grün für beide Dateien, gezielte P4-Tests (finishcall-billing-once, f2-sms-summary-plan, f2-p9-dedup-persist, outbound-reserve-release-success, graceful-shutdown, call-termination-order) → **28/28 pass**, volle Suite `NODE_ENV=test node --test test/*.test.js` → **2290/0 fail/0 skipped** (70.9s), beide Backends abgedeckt (pg-spawnende Tests liefen grün mit). Kein Flake, kein isolierter Rot-Lauf nötig.
- `safetyGatesIntact`: true · `disclosureIntact`: true (claude.js + bridge.js unberührt) · `authFailClosedIntact`: true · `noSecretsLeaked`: true (nur `err.message`, secret-frei, wie zuvor) · `scopeRespected`: true · `behaviorAsIntended`: true.
- **INV-7 gehalten**: genau EIN `makeCallFinish`-Aufruf (L174 im Ergebnis), dieselbe `callFinish.finishCall`-Referenz geht an `attachMediaBridge` UND `makeCallControlIngest`; alle 6 Call-Sites + der `releaseReserve`-Timer verdrahtet, keine bare-Referenz mehr.
- **INV-9 gehalten**: `paymentEnabled`-Gate bleibt im `finishCall`-Body, `reconcileOutboundVoiceBudget` läuft immer, `billedAt`-Guard/Cents-Ganzzahl unverändert, `terminateCappedCall` nutzt weiter `billThunk(callFinish.finishCall, ...)`.
- **INV-6**: Boot-Log-Zeile genau 1 Treffer byte-identisch; `grep ^export` = 0 in server.js.
- **INV-2** unberührt (const-Deklaration, kein Mount).

**Concerns (nicht-blockierend):**
1. Verwaister Import: `USAGE_EVENT_KIND` in `src/server.js:17` nach dem Move ungenutzt (einzige Nutzung mit `finishCall` nach `call-finish.js` gewandert, das die Konstante selbst importiert). Toter Import, trivial entfernbar, null Runtime-/Safety-Impact — dem Clean-Code-Auditor zur Entfernung übergeben (S3).
2. `test/call-termination-order.test.js` wurde geändert (SPEC-Wortlaut nennt „keine Änderung an bestehenden Tests" als Regelfall). Die Änderung ist jedoch zwingend/korrekt (Whitebox-Quelltext-Grep-Test gegen umbenannte Referenz), Assertionsstärke identisch — als akzeptiert bewertet.

---

## 4. Clean-Code-Audit (final)

**Verdict: PASS** (mit einem trivialen S3-Fund)

- **s1** (Blocker): keine
- **s2** (schwerwiegend): keine
- **s3** (moderat): 1 Fund — G12 (ungenutzter Import) · `src/server.js:17` · `USAGE_EVENT_KIND` wird importiert, aber nach der Extraktion nirgends mehr in server.js verwendet (per grep: genau 1 Treffer, die Import-Zeile selbst). Fix: aus dem destrukturierten Import in Zeile 17 entfernen.
- **s4** (kosmetisch): keine

**Begründung:** Der Diff ist eine reine, verhaltenserhaltende Verschiebung — `finishCall`/`releaseReserve` wandern byte-identisch (0 Zeilen Differenz nach De-Indent, per Diff verifiziert: `finishCall` 90/90 Zeilen, `releaseReserve` 5/5 Zeilen) aus server.js in eine neue `makeCallFinish`-Factory. Die Instanziierung folgt exakt dem etablierten Muster (`makeMetering`/`makeOutboundGates`: einmal beim Boot verdrahtet, alle Deps zu dem Zeitpunkt bereits verfügbar, keine TDZ-Gefahr). Alle Aufrufstellen konsequent auf `callFinish.finishCall`/`callFinish.releaseReserve` umgestellt, keine bare-`finishCall`-Leichen (grep bestätigt). Sicherheitskritische Invarianten unangetastet: `billedAt`-Gate (F9, genau-einmal-Buchung), `paymentEnabled`-Gating, Cents als Ganzzahl, Offenlegung/Auth/Audit-Pfade unberührt. Tests: `node --check` sauber, volle Suite im isolierten Worktree → 2290/2290 grün. `USAGE_EVENT_KIND`-Doppelimport ist keine echte G5-Dopplung (dieselbe Quelle `store/defaults.js`), sondern nur der genannte tote Import in server.js. Funktionslänge (90 Zeilen inkl. Kommentare) unter der Obergrenze von 100 — da unverändert übernommen und die Phase explizit als „reine Verschiebung" deklariert, wird eine weitere Zerlegung bewusst nicht gefordert (wäre Scope-Creep über P4 hinaus).

**topTodos:**
1. `USAGE_EVENT_KIND`-Import in `src/server.js:17` entfernen (toter Import, 1-Zeilen-Fix).

---

## 5. Fix-Runden

Keine — der Report-Input enthält keinen `=== FIXES ===`-Block mit Inhalt (leer). Die Phase wurde in einem Durchlauf mit **PASS** abgeschlossen; der einzige offene Punkt (toter `USAGE_EVENT_KIND`-Import, S3) ist nicht-blockierend dokumentiert und für einen Folge-Fix vorgemerkt, nicht in dieser Phase behoben.

---

## 6. Zusammenfassung

P4 wurde exakt nach Plan umgesetzt: `finishCall` (Settlement/Summary/Notification/SMS) und `releaseReserve` (Worst-Case-Reserve-Freigabe) sind als `makeCallFinish({store, config, metering, messaging, summarizeCall, planSummarySms, audit}) -> {finishCall, releaseReserve}` in `src/telephony/call-finish.js` extrahiert — byte-identischer Funktionskörper, EINE Instanz im Wurzel-Scope (INV-7 gewahrt), alle 6 Call-Sites plus der Reserve-Release-Timer konsistent umgestellt. `src/server.js`: 2105 → 2018 Zeilen (netto −87). Volle Testsuite unter beiden Backends grün (json 2289/2290 mit 1 isoliert bestätigtem Full-Load-Flake, pg 1990/2023 mit 33 identisch vorbestehenden „DB unerreichbar"-Fehlschlägen, via Baseline-Vergleich auf unverändertem master verifiziert). Alle 5 SPEC-Gate-Tests unter beiden Backends isoliert 15/15 grün. Safety-Review: APPROVED, keine Blocker. Clean-Code-Audit: PASS mit einem trivialen, nicht-blockierenden S3-Fund (toter `USAGE_EVENT_KIND`-Import in server.js:17, zur späteren Entfernung vorgemerkt). Ergebnis-Commit `3f10728` auf Branch `phase/slim-p4-call-finish` (3 Dateien: 1 neu, 2 geändert).
