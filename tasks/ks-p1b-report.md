# KS-P1b — Assistant-Shim bekommt denselben Re-Attach-Pfad (Phasenbericht)

Branch: `phase/ks-p1b-shim-reattach` (von `master` = 19f6441)

## Befund

`src/telnyx-llm-shim.js` loeste den Call in Schritt 4 ausschliesslich ueber den
Prozess-Spiegel auf (`store.getCallByControlId`) und antwortete bei einem Miss mit 403 —
ohne `reattachActiveCall`. Nach einem Deploy-/Instanzwechsel lief das Gespraech beim
Provider weiter, waehrend die neue Instanz jeden Turn verwarf: kein Max-Dauer-Cap-Timer
(prozesslokaler `setTimeout`), kein Dead-Air-Watchdog (ebenfalls prozesslokal), also keine
Kostenbremse. Vier andere Aufrufer (`/voice/turn|outbound|status`, Call-Control-Ingest)
hatten diesen Seam bereits.

## Entwurfsentscheidungen

- **E-1 — eigene Store-Query statt zweitem Re-Attach-Kern.** `reattachActiveCall` und
  `store.attachActiveCall` suchen ueber die callId; der Shim besitzt nur die
  `call_control_id` aus `extra_metadata` (E1, Anti-Spoofing — unveraendert). Neu:
  `attachActiveCallByControlId` in **beiden** Backends (`store-backend-parity.test.js`
  macht eine einseitige Ergaenzung automatisch rot).
- **E-2 — die ccid-Variante delegiert, sie dupliziert nicht.**
  `reattachActiveCallByControlId(ccid)` laedt die Zeile ueber die ccid und ruft dann den
  unveraenderten `reattachActiveCall(call.id)`. Grund: der Kern coalesced parallele
  Re-Attaches **pro callId** (RACE-1). Ein zweiter Schluessel haette das Coalescing
  ausgehebelt → zwei Max-Dauer-Timer fuer dasselbe Leg. Preis: auf dem seltenen Miss-Pfad
  zwei DB-Scans; im Code kommentiert. Nebeneffekt: der zweite Durchlauf liefert ueber den
  pg-RACE-GUARD die **Spiegel-Instanz** — genau die lebende Referenz, die der Shim braucht.
- **E-3 — die Guthaben-Pruefung sitzt im geteilten Kern, nicht im Shim.** Ein Ort fuer alle
  fuenf Aufrufer (G5). Es wird **kein neues Praedikat** eingefuehrt: `blockingBudgetAxis`
  ist dieselbe Funktion, die Shim-Turn und Dial-Gate lesen — keine neue Klasse von
  Falsch-Positiven. Reihenfolge: Zeit zuerst, dann Geld (Bestandspfade bleiben
  byte-identisch, solange die Decke traegt).
- **E-4 — eigener Grund-Token, EIN Terminalisierungspfad.** `BUDGET_FAILURE_REASON =
  "budget-exhausted"` neben `CAP_FAILURE_REASON`; `terminateCappedCall` (Signatur und alle
  drei Call-Sites unveraendert) und `terminateOverBudgetCall` sind Wrapper ueber den
  grund-parametrisierten `terminateActiveCall`. INV-9 unberuehrt. `status: "completed"`
  fuer den Geld-Fall (das Leg war technisch gesund; `"failed"` bleibt dem Boot-Zombie).
- **E-5 — `blockingBudgetAxis` wird injiziert, nicht importiert** (Konvention der uebrigen
  `makeCallLifecycle`-Deps; offline fakebar, kein Zyklus).

## Verhaltens-Blast-Radius (bewusst getragen)

Ein Leg mit erschoepfter Tenant-Decke, das nach einem Instanzwechsel ueber `/voice/turn`
re-attached wird, bekommt kuenftig einen harten Hangup statt des hoeflichen
`budgetExhaustedHangup`. Das trifft nur die Schnittmenge *Spiegel-Miss x Decke erschoepft*
(in der Praxis: Post-Deploy) und immer in die sichere Richtung — haette der Shim-Turn eine
Sekunde spaeter ohnehin ueber Schritt 6 beendet.

## Feststellung fuer KS-P3 (damit dort nicht danach gesucht wird)

Die guthaben-abgeleitete Frist selbst ist **nicht** Teil dieser Phase. Die Frist wird beim
Re-Attach schon heute **berechnet und nicht wiederhergestellt**:
`classifyCallTime(call, Date.now(), maxCallDurationS)` (`src/store/state-ops.js`) rechnet die
Restzeit bei jedem Re-Attach frisch aus dem DB-Anker; es gibt **keine gespeicherte Deadline**,
die restauriert wuerde. Wenn KS-P3 die Ableitung aendert, aendert es genau diese eine
Funktion, und der Re-Attach zieht ohne weiteren Eingriff mit. Der in KS-P1b baubare Teil von
"neu berechnen" war deshalb die **Geld-Achse** — der Anteil des E8-Wertes, der schon heute
zwischen Anrufstart und Re-Attach veraltet.

## Mutationsproben (Ist-Ergebnis)

| Mutation | Erwartet | Ist |
|---|---|---|
| Schritt 4 im Shim auf `store.getCallByControlId` zurueckgesetzt | `KS-P1b-1`, `KS-P1b-2` rot | **rot**: KS-P1b-1, KS-P1b-2 **und** KS-P1b-3 (3 von 6) |
| Budget-Zweig aus `runReattach` entfernt | `KS-P1b-7` rot | **rot**: KS-P1b-7 (KS-P1b-8 bleibt gruen — korrekt, dort gewinnt die Zeit-Achse) |
| `attachActiveCallByControlId` nur in `pg.js`, nicht in `json.js` | `store-backend-parity` rot | **rot**: „CC-6: pg traegt KEINE json-fremde Methode ausser der Allowlist" |
| ccid-Guard `ccid ? … : null` in `pg.js` entfernt | `KS-P1b-10` rot | **GRUEN — Erwartung des Plans widerlegt** (s.u.) |

**Zur vierten Probe (ehrlicher Befund):** der Riegel ist eine Roundtrip-Ersparnis, kein
eigenes Sicherheitsnetz. `WHERE call_control_id = NULL` trifft in SQL nie eine Zeile
(NULL-Vergleich), `""` matcht nur eine gleichlautende. Der Guard bleibt (er spart den
Tenant-Loop-Scan und haelt die Form von `getCallByControlId`), aber sein Kommentar in
`pg.js` behauptet nicht mehr, er sei das Gate — und KS-P1b-10 pinnt das Ergebnis, damit eine
kuenftige Umformulierung der Query (z.B. `IS NOT DISTINCT FROM`) auffliegt.

## Tests

Neu: `test/ks-p1b-shim-reattach.test.js` (KS-P1b-1..6, Fakes, kein Netz/Spawn).
Erweitert: `test/reattach-active-call.test.js` (KS-P1b-7/8),
`test/store-pg-reattach-active-call.test.js` (KS-P1b-9/10, pglite).
Defaults ergaenzt (Bestand byte-identisch): `test/telnyx-shim-harness.js`,
`test/telnyx-llm-shim.test.js`.

**Nicht im Plan vorgesehene, aber noetige Bestands-Anpassungen** (Folge der bewussten
`terminateCappedCall`-Refaktorierung bzw. der neuen Kern-Deps):

- `test/call-termination-order.test.js` — Quelltext-Anker `async function
  terminateCappedCall(` → `async function terminateActiveCall(` (der `billThunk`-Body ist
  dorthin gewandert). Pruefgegenstand unveraendert.
- `test/telnyx-p6-cap-callcontrol.test.js` — derselbe Anker in T6, plus `budgetAxisFor: () =>
  null` / `terminateOverBudgetCall` in `makeReattachDeps` (T5a/T5b fahren den Kern direkt).

`test/cap-failure-reason.test.js` blieb unveraendert gruen und belegt damit, dass die
Refaktorierung verhaltenserhaltend ist (Reihenfolge `setCallEndedAt → recordFailureReason →
endCall → bill` und `CAP_FAILURE_REASON` sind dort gepinnt).
