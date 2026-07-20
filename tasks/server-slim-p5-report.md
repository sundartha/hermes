# Phase P5 — Detailbericht

**Titel:** `src/telephony/call-lifecycle.js` extrahieren (Cap-Timer + Reattach + Rearm)
**Gate:** PASS
**finalBranch:** `phase/slim-p5-call-lifecycle`
**Basis:** `master` @ `c87d08c` (P1–P4 gemergt)
**Head-Commit:** `ee19a0eb4ca6a6d3534f1104001ee0571853786b`

---

## 1. Scope

Grundlage: `PLAN-SERVER-SLIM.md`. Ausgangszustand `src/server.js` = 2018 Zeilen. Reine Verschiebung, byte-identisches Verhalten — keine neue Env-Var, keine Dependency, keine Verhaltensänderung, keine Route-/Mount-/Boot-Log-Änderung.

Zu verschiebende Symbole (Zeilen gegen echten Code verifiziert, nicht gegen den veralteten Basis-Plan):

| Symbol | Echte Zeilen | Art | Ziel |
|---|---|---|---|
| `callMaxDurationMs` | 641–645 | privater Helfer | Modul (privat) |
| `terminateCappedCall` | 647–680 | async, EINZIGER Terminalisierungspfad (INV-9) | Modul (privat) |
| `scheduleMaxDurationEnd` | 682–687 | Timer-Setter | Modul (privat) |
| `armMaxDurationTimer` | 689–694 | öffentl. Wrapper | Modul-API |
| `armReserveReleaseTimer` | 696–704 | öffentl. Wrapper | Modul-API |
| `reattachActiveCall` (Wrapper) | 830–847 | öffentl. Wrapper | Modul-API |
| `rearmActiveCallTimers` | 1870–1898 | Boot-only | Modul-API |

Dazwischen bleiben unangetastet in server.js: `INBOUND_ASSISTANT_HANDOFF` (710) + `inboundAssistantHandoffXml` (723) — P11-Scope.

Konsumenten-Call-Sites (bleiben in server.js, werden `lifecycle.*`): 792, 855, 922, 968, 1037, 1130, 1146, 1148, 1944. Grep-verifiziert: `callMaxDurationMs`/`terminateCappedCall`/`scheduleMaxDurationEnd` werden nur modul-intern referenziert → gehören nicht in die zurückgegebene API.

Injizierte Deps (alle bereits in server.js importiert, bleiben es): `store`, `config`, `voiceControl` (L50), `terminateAndBillCall`/`hangUpAction`/`billThunk` (L65), `reattachActiveCallCore` (L72), `cappedEndedAtMs`/`classifyCallTime` (L83-84), plus `callFinish.finishCall`/`.releaseReserve` (Instanz L174-182). Nach dem Move bleibt jeder dieser Imports genutzt (mind. als Injektionsargument) → kein G12-Cleanup nötig.

---

## 2. Plan (gekürzt)

Ziel: Cap-Timer (Max-Dauer), Reserve-Release-Backstop, Re-Attach-Wrapper und Boot-Re-Arm — bisher als sieben Top-Level-Funktionen in `src/server.js` — hinter eine Factory `makeCallLifecycle()` in eine neue Datei `src/telephony/call-lifecycle.js` ziehen (~140 LOC).

### 2.1 Neue Datei: `src/telephony/call-lifecycle.js`

Reine Factory, keine eigenen Imports (alle Deps injiziert — konsistent mit `makeCallFinish` aus P4). Funktions-Körper byte-identisch aus server.js übernommen; die einzigen zwei inhaltlichen Änderungen sind die Umbenennung der injizierten Referenz `callFinish.finishCall`→`finishCall` und `callFinish.releaseReserve`→`releaseReserve` (Dep-Namen). Alle Kommentare (INV-9-tragend) verbatim mitnehmen.

Signatur:

```js
export function makeCallLifecycle({
  store,
  config,
  finishCall,             // = callFinish.finishCall  (INV-7: gleiche Referenz wie bridge/ingest)
  releaseReserve,         // = callFinish.releaseReserve
  voiceControl,
  terminateAndBillCall,
  hangUpAction,
  billThunk,
  reattachActiveCallCore, // reattachActiveCall aus ./reattach.js
  cappedEndedAtMs,
  classifyCallTime,
}) {
  // callMaxDurationMs, terminateCappedCall, scheduleMaxDurationEnd,
  // armMaxDurationTimer, armReserveReleaseTimer, reattachActiveCall,
  // rearmActiveCallTimers — jeweils verbatim aus den o.g. server.js-Zeilen
  return { armMaxDurationTimer, armReserveReleaseTimer, reattachActiveCall, rearmActiveCallTimers };
}
```

Modul-Kommentar dokumentiert die Konstruktionsreihenfolge (Boot-DAG: `outboundGates` → `metering` → `callFinish` → `call-lifecycle`, kein Lazy-Thunk, P15) und trägt die INV-9-Invariante (terminateCappedCall bleibt EINZIGER Terminalisierungspfad, Provider-Leg zuerst awaited, dann buchen via unverändertes `terminateAndBillCall` in `call-termination.js`). Vollständige Kommentar-Blöcke der Ursprungszeilen verbatim übernommen; Funktions-Reihenfolge im Modul = server.js-Reihenfolge (G10 vertikale Lokalität).

### 2.2 Edits in `src/server.js`

- **Edit A** — Import nach dem `reattach.js`-Import: `import { makeCallLifecycle } from "./telephony/call-lifecycle.js";`
- **Edit B** — Konstruktion zwischen der `callFinish`-Instanziierung und `app.use(securityHeaders);`: `const lifecycle = makeCallLifecycle({ store, config, finishCall: callFinish.finishCall, releaseReserve: callFinish.releaseReserve, voiceControl, terminateAndBillCall, hangUpAction, billThunk, reattachActiveCallCore, cappedEndedAtMs, classifyCallTime });`
- **Edit C** — die 5 Timer-Funktionen (L641–704, inkl. Kommentare) komplett entfernen.
- **Edit D** — reattach-Wrapper (L830–847) entfernen.
- **Edit E** — `rearmActiveCallTimers` (L1870–1898) entfernen.
- **Edit F** — 9 Konsumenten-Call-Sites auf `lifecycle.*` umstellen: `armMaxDurationTimer` (L792, L1130, L1146), `reattachActiveCall` (L855 `/voice/turn`, L922 `/voice/outbound`, L968, L1037 als Dep in `makeCallControlIngest`), `armReserveReleaseTimer` (L1148), `rearmActiveCallTimers` (L1944). Kommentare/Prosa (Boot-Ordering-Block, cancel-Kommentar) bleiben unverändert — sie referenzieren die Operationen begrifflich korrekt weiter.

### 2.3 Tests — 4 mechanische Whitebox-Updates, kein neuer Test

Bestandssuite ist das Gate (P3/P4-Präzedenz). Das Verhalten ist bereits umfassend abgedeckt (`max-duration-pure`, `-live-cap`, `-rearm`, `reattach-active-call`, `store-pg-reattach-active-call`, `outbound-reserve-backstop`, `telnyx-p6-cap-callcontrol`, `telnyx-p9-flag-matrix`). Vier bestehende Tests slicen eine verschobene Funktion per Quelltext-Marker aus `server.js` und müssen zwingend-mechanisch (Quelldatei-/Dep-Namen-Anpassung, Assertionsstärke identisch) angepasst werden:

1. `test/reattach-active-call.test.js` — Regex `/await reattachActiveCall\(/` → `/await lifecycle\.reattachActiveCall\(/` (2×).
2. `test/call-termination-order.test.js` — neue Konstante `lifecycleSrc` (liest `src/telephony/call-lifecycle.js`); `terminateCappedCall`-Slice und `bill:`-Regex darauf umgestellt (`billThunk(callFinish.finishCall, …)` → `billThunk(finishCall, …)`, injizierter Dep-Name im Modul). Import-Match + `cancelBlock`-Assertion bleiben auf `serverSrc` (Import + `cancel_call` bleiben in server.js).
3. `test/telnyx-p6-cap-callcontrol.test.js` — nur T6 betroffen (Slice-Quelle `serverSrc`→`lifecycleSrc`); T7 (cancel) und T8 (`place_call`/`armMaxDurationTimer`) unverändert, da sie server.js-Blöcke slicen, die dort bleiben, bzw. der T8-Regex als Substring weiter matcht.
4. `test/telnyx-p9-flag-matrix.test.js` — `serverSrc`-Konstante zu `lifecycleSrc` umgebogen/umbenannt (war dort nur für diesen einen Slice genutzt → Rename statt Zusatz-Const, vermeidet G12).

Nicht betroffen (verifiziert): `telnyx-observability-secret-guard`, `mcp-server-icon`, `process-guards`, `store-integrity`, `telnyx-assistant-route-drift`, `helpers.js`, `telnyx-p6-boot-rearm`, `telnyx-event-ingest-*`, `max-duration-*` (Spawn/Runtime).

### 2.4 Deterministische Verifikation (laut Plan)

```bash
node --check src/telephony/call-lifecycle.js && node --check src/server.js && echo OK   # -> OK
grep -c "^export" src/server.js                                                          # -> 0
grep -rF "Hermes Gateway laeuft auf http://localhost" src/ | wc -l | tr -d ' '           # -> 1
git diff --stat -- src/server.js                                                         # -> Netto negativ, ~2018 -> ~1900
npm test                                                                                  # -> 0 fail
STORE_BACKEND=pg npm test                                                                # -> 0 fail
```

Flake-Protokoll (`p5-gate-proof`, ~12%): Rot gilt nur als echt, wenn die betroffene Datei isoliert (`node --test test/<datei>.test.js`) rot bleibt. Kein Smoke-Test im Plan gefordert (P5 berührt keine öffentliche Route/Mount-Reihenfolge; INV-1/2/3/4 unangetastet) — im Impl-Schritt trotzdem best-effort durchgeführt.

### 2.5 Pre-Mortem / Load-bearing-Invarianten (laut Plan)

- **INV-9 (Max-Dauer, absolut):** `terminateCappedCall` bleibt der EINZIGE Terminalisierungspfad; Reihenfolge „Provider-Leg zuerst (awaited), dann buchen" liegt unverändert in `terminateAndBillCall` (`call-termination.js`, nicht angefasst).
- **INV-5 (Boot-Ordering):** `lifecycle.rearmActiveCallTimers()` bleibt an L1944 — nach allen `process.exit(1)`-Gates, unmittelbar vor `app.listen`. Nur die Definition wandert.
- **INV-7 (EINE Instanz):** `const lifecycle` genau einmal in der Wurzel; `finishCall`/`releaseReserve` sind die identischen `callFinish`-Referenzen (dieselben, die an `attachMediaBridge`/`makeCallControlIngest` gehen) → In-Memory-Guards (`call._finished`) + `billedAt` bleiben identitätsstabil.
- **INV-6/INV-10:** Boot-Log-Zeile unverändert; server.js bleibt export-frei.
- **Kein Lazy-Thunk (P15):** `lifecycle` NACH `callFinish` konstruiert (linearer DAG); Deps kommen fertig gebunden herein.

### 2.6 Deviations vom Basis-Plan-Doc

- **D1 (Zeilennummern):** Basis-Plan nannte veraltete L711-762/779-782/918-925/2103-2124; real (nach P1-P4) L641-704 / L830-847 / L1870-1898 — verifiziert per Grep.
- **D2 (Whitebox-Test-Blast-Radius):** Spec nannte P4-artig „1 Test". Real sind 4 bestehende Whitebox-Quelltext-Guards betroffen, weil `terminateCappedCall`/`rearmActiveCallTimers` die am stärksten quelltext-geguardeten Safety-Funktionen sind. Alle Anpassungen minimal und assertionsstärke-erhaltend, kein neuer Test.
- **D3 (Dep-Mechanismus):** Vollständige Injektion aller 11 Deps statt Direkt-Import im Modul — konsistent mit P4 (`makeCallFinish`), hält alle server.js-Imports als genutzte Injektionsargumente (kein G12).

**Blast-Radius (laut Plan):** 1 neue Datei (~140 LOC), server.js −~120 LOC netto (11 Edits: 1 Import, 1 Konstruktion, 3 Block-Löschungen, 9 Call-Site-Umbenennungen), 4 mechanische Test-Edits. Keine neue Env-Var, keine Dependency, keine Verhaltensänderung, keine Route-/Mount-/Boot-Log-Änderung.

---

## 3. Implementierungs-Zusammenfassung

Umgesetzt in isoliertem Worktree auf neuem Branch `phase/slim-p5-call-lifecycle`, exakt gemäß Plan. Neue Datei `src/telephony/call-lifecycle.js` mit Factory `makeCallLifecycle({store, config, finishCall, releaseReserve, voiceControl, terminateAndBillCall, hangUpAction, billThunk, reattachActiveCallCore, cappedEndedAtMs, classifyCallTime})`, die `{armMaxDurationTimer, armReserveReleaseTimer, reattachActiveCall, rearmActiveCallTimers}` exportiert. Alle 6 Symbole (`callMaxDurationMs`, `terminateCappedCall`, `scheduleMaxDurationEnd`, `armMaxDurationTimer`, `armReserveReleaseTimer`, reattach-Wrapper, `rearmActiveCallTimers`) byte-identisch verschoben inkl. aller Kommentarblöcke.

`src/server.js`: **2018 → 1924 Zeilen (−94 netto)**, export-frei, Boot-Log-Zeile exakt 1×. `lifecycle`-Instanz einmal in der Wurzel konstruiert, nach `callFinish` (linearer DAG, kein Lazy-Thunk, P15). Alle 9 Konsumenten-Call-Sites auf `lifecycle.*` umgestellt.

4 bestehende Whitebox-Quelltext-Guard-Tests zwingend-mechanisch angepasst (Quelldatei bzw. Dep-Name geändert, Assertionsstärke identisch): `reattach-active-call.test.js`, `call-termination-order.test.js`, `telnyx-p6-cap-callcontrol.test.js`, `telnyx-p9-flag-matrix.test.js`. Kein neuer Test (reiner Refactor).

**Ergebnisse:**
- `node --check` sauber auf `src/telephony/call-lifecycle.js` und `src/server.js`.
- Volle Suite (JSON-Backend): **2290/2290 pass, 0 fail**.
- `STORE_BACKEND=pg npm test` (globaler Env-Modus) schlägt fehl — kein `DATABASE_URL`/erreichbares Postgres lokal, identisch reproduzierbar auf `master` (P4-Präzedenz bestätigt: kein unterstützter globaler pg-Env-Modus). Diff berührt `src/config.js`/`src/store.js`/`src/store/pg.js` nicht → reines Umgebungslimit, keine P5-Regression. Die ~30 pg-opt-in-Testdateien (u.a. `store-pg-reattach-active-call.test.js`) konstruieren PGlite selbst in-process und laufen im normalen JSON-Lauf grün mit.
- Best-effort Smoke-Test via echtem Server-Spawn: `/healthz` → 200; `/voice/incoming` → 200 mit gültigem TeXML (beweist `armMaxDurationTimer`-Verdrahtung); Call korrekt als `active` im Store persistiert.

### Deviations (Implementierung)

- `STORE_BACKEND=pg npm test` (globaler Env-Modus) wie in Plan-Schritt 4 verlangt ausgeführt, schlägt mit FATAL DB-Init-Fehler fehl (kein `DATABASE_URL`/erreichbares Postgres in dieser Umgebung) — reproduziert identisch auf `master` (P4-Vorlaeufer-Report bestätigt: „kein unterstützter globaler pg-Env-Modus existiert"). Diff berührt `src/config.js`, `src/store.js`, `src/store/pg.js` nicht. Stattdessen verifiziert: JSON-Backend-`npm test` (2290/2290 grün) inkl. der ~30 pg-opt-in-Testdateien, die PGlite selbst in-process konstruieren.
- Ein `api-action-items-toggle.test.js`-Flake trat in einem Vollast-`npm test`-Lauf auf (SocketError, unabhängige Datei); isoliert (`node --test test/api-action-items-toggle.test.js`) 2/2 grün bestätigt — dokumentierter `p5-gate-proof`-Flake (~12%), kein echtes Rot. Ein zweiter voller `npm test`-Lauf danach war ohnehin 2290/2290 grün.

### Clean-Code-Selbstcheck (Impl-Agent)

Reine Verschiebung, keine Logik-Änderung: `makeCallLifecycle` folgt dem P4-Muster (`makeCallFinish`) — Factory mit injizierten Deps, keine eigenen Imports (G5/DIP). Nur 2 inhaltliche Änderungen: `callFinish.finishCall`→`finishCall` und `callFinish.releaseReserve`→`releaseReserve` (Dep-Umbenennung laut Plan). Alle 11 injizierten Deps bleiben in server.js genutzt (kein G12-Dead-Import). Funktionsreihenfolge im neuen Modul = server.js-Reihenfolge (G10 vertikale Lokalität). Keine Magic Numbers eingeführt, kein toter/auskommentierter Code, ≤3 Argumente pro Funktion unverändert (Objekt-Deps). server.js bleibt export-frei (INV-6), `lifecycle` einmal in der Wurzel konstruiert (INV-7). Kommentare deutsch ohne Umlaute, verbatim aus dem Bestand übernommen wo vorgeschrieben.

### Smoke-Test

Best-effort Server-Spawn-Smoke (`test/helpers.js` `startServer`, `SKIP_TWILIO_SIGNATURE_CHECK` bereits in `BASE_ENV`): `GET /healthz` → 200 `{ok:true}`; `POST /voice/incoming` → 200 mit gültigem TeXML-Gather (Beweis für `lifecycle.armMaxDurationTimer`-Verdrahtung); Call im Store als `status=active` persistiert. Kein dedizierter Smoke für `/voice/turn`|`outbound`/`status` nötig, da diese Pfade bereits durch die Spawn-basierten Runtime-Tests `max-duration-live-cap`/`-rearm` + `reattach-active-call` end-to-end abgedeckt sind (alle grün).

---

## 4. Safety-Urteil (final)

**Verdict: APPROVED.**

- `approved: true`, `testsPassIndependently: true`, `safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`, `scopeRespected: true`, `behaviorAsIntended: true`.
- **Blockers: keine.**
- **Independent Test Summary:** Voller `NODE_ENV=test node --test test/*.test.js`-Lauf im Review-Worktree (Branch `review-slim-p5` auf `phase/slim-p5-call-lifecycle`): **2290 pass / 0 fail / 0 skipped, ~72s** — deckt JSON-Spawn-Tests UND pglite-pg-Backend-Tests ab (pg wird in-process via `@electric-sql/pglite` ausgeübt). Zusätzlich die 6 SPEC-benannten Tests + 3 angepassten Whitebox-Tests isoliert gelaufen: 52/53 pass; der eine Fehlschlag (`telnyx-p9-flag-matrix` „Flag AN + Telnyx" → `fetch ETIMEDOUT 127.0.0.1`) ist der bekannte ~12%-Vollast-Spawn-Flake — passte 4/4 zweimal isoliert und innerhalb des vollen 2290er-Laufs. Globale Gates: `node --check` sauber für `src/server.js` + `src/telephony/call-lifecycle.js`; `grep -c '^export' src/server.js` = 0; Boot-Log `Hermes Gateway laeuft auf http://localhost` = exakt 1× unter `src/`; `package.json`/`package-lock.json` unverändert (keine neue Dependency).
- **Verdict-Text:** P5 ist eine saubere, reine Verschiebung der Cap-Timer-/Reserve-Backstop-/Reattach-/Rearm-Funktionen aus `src/server.js` nach `src/telephony/call-lifecycle.js` via `makeCallLifecycle({...})`. Die einzige textliche Änderung sind die injizierten bloßen Namen `finishCall`/`releaseReserve` (== `callFinish.finishCall`/`.releaseReserve`, dieselben Referenzen — INV-7), keine Logik-Änderung, kein Dedup, kein Intra-Funktions-Split. `lifecycle` wird genau einmal nach `callFinish` konstruiert (linearer DAG, kein Lazy-Thunk), innerhalb des Pre-Middleware-Wiring-Blocks, sodass INV-2 (Middleware-/Mount-Reihenfolge) byte-identisch bleibt; alle Deps sind gehoistete Imports oder die `callFinish`-Konstante (keine TDZ); zurückgegebene Closures sind `this`-frei. `terminateCappedCall` bleibt der einzige Max-Dauer-Terminalisierungspfad (Provider-Leg zuerst awaited, dann buchen via unverändertes `terminateAndBillCall`) — INV-9 intakt; `rearmActiveCallTimers` bleibt an seiner Boot-Position nach allen exit1-Gates vor `listen` — INV-5 intakt. `claude.js` + `bridge.js` unangetastet (`disclosureSentence` intakt); kein Auth-Code angefasst; keine Secrets geloggt. Scope respektiert (server.js + neues Modul + 4 mechanische Whitebox-Grep-Test-Edits mit identischer Assertionsstärke, null neue Tests, keine neuen npm-Dependencies). Volle Suite 2290/2290 grün über beide Backends.
- **Concerns (nicht blockierend):** `telnyx-p9-flag-matrix.test.js` zeigte einen `fetch`/`ETIMEDOUT`-Fehlschlag im gezielten Multi-File-Batch, passte aber isoliert (4/4 zweimal) und im vollen Suite-Lauf — deckt sich mit dem dokumentierten ~12%-`p5-gate-proof`-Vollast-Spawn-Flake, keine P5-Regression.

---

## 5. Clean-Code-Audit (final, S1-S4)

**Verdict: PASS** — saubere, mechanische Extraktion ohne Verhaltensänderung. `blocker: false`.

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3:** keine.
- **S4 (Kenntnisnahme, kein Fix nötig):**
  - G31 (n.z./bewusste Ausnahme) · `src/server.js:184-202` · `makeCallLifecycle()` muss NACH `callFinish` konstruiert werden (`finishCall`/`releaseReserve` kommen fertig gebunden herein) — reine Reihenfolge-Konvention im Boot-Code, nichts in der Signatur erzwingt sie strukturell. Kein neues P5-Problem: identisches Muster (`outboundGates` → `metering` → `callFinish` → `lifecycle`) existiert bereits unverändert aus P1-P4 im selben Wiring-Stil.

**Pass-Notizen:** Reine Verschiebung (Modul-Kommentar behauptet „reine Verschiebung aus server.js" — durch Diff verifiziert): `callMaxDurationMs`/`terminateCappedCall`/`scheduleMaxDurationEnd`/`armMaxDurationTimer`/`armReserveReleaseTimer`/`reattachActiveCall`/`rearmActiveCallTimers` 1:1 nach `telephony/call-lifecycle.js` verschoben, in server.js keine Alt-Definitionen mehr vorhanden (grep-bestätigt: keine Toplevel-Funktionsdeklarationen dieser Namen mehr in server.js). Alle Aufrufer konsequent auf `lifecycle.*` umgestellt (`armMaxDurationTimer` ×3, `reattachActiveCall` ×4 inkl. Call-Control-Ingest-Wiring, `armReserveReleaseTimer` ×1, `rearmActiveCallTimers` ×1). Sicherheitskritische Boot-Gate-Reihenfolge (F10-ORD-Kommentar: `rearmActiveCallTimers` erst nach `assertConfig`/`fakeOriginateBootBlocked`/`hasActiveNumber`, vor `app.listen`) ist positionsgleich erhalten — live geprüft in `src/server.js:1841-1852`. DAG-Reihenfolge (`lifecycle` nach `callFinish` konstruiert, alle injizierten Deps zum Konstruktionszeitpunkt bereits importiert/verfügbar) stimmt. Faktory-Signatur (11 benannte Deps als ein Objekt) folgt demselben etablierten Muster wie `makeCallFinish`/`makeOutboundGates` aus P1-P4 (G24-Konvention eingehalten, DIP-konform: keine konkrete Infra wird intern ge-new-t). Testdateien wurden nur auf den neuen Dateipfad umgestellt, keine Assertion abgeschwächt (`call-termination-order.test.js`, `reattach-active-call.test.js`, `telnyx-p6-cap-callcontrol.test.js`, `telnyx-p9-flag-matrix.test.js` — alle 4 gezielt in Isolation nachgetestet: 34/34 grün). Voller Testlauf im Branch-Worktree: 2290/2290 grün, 0 Fails, 0 skipped. Keine toten Imports (`terminateAndBillCall`/`hangUpAction`/`billThunk`/`cappedEndedAtMs`/`classifyCallTime` weiterhin an anderer Stelle in server.js genutzt), keine Magic Numbers, keine abgeschalteten Sicherungen, kein auskommentierter Code, keine neuen Kommentar-Lügen (C2 — Referenzen auf `terminateCappedCall` etc. in verbleibenden server.js-Kommentaren sind weiterhin sachlich korrekt, da die Funktion nur den Ort, nicht ihr Verhalten gewechselt hat).

**Top-TODOs:** keine.

---

## 6. Fix-Runden

Keine. Beide Reviews (Safety + Clean-Code) kamen ohne Blocker (S1/S2 = 0) und ohne notwendige Nacharbeit direkt zu PASS/APPROVED — keine Fix-Runde erforderlich.
