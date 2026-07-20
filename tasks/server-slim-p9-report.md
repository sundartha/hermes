# Phase P9 — Detailbericht

**Titel:** `src/routes/api-calls.js` extrahieren (Outbound-Money-Path)
**Gate:** PASS
**finalBranch:** `phase/slim-p9-api-calls`
**Basis:** `master` nach P8-Merge (server.js 1671 Zeilen, P1–P8 bereits extrahiert)
**Head-Commit (Impl):** `b270ae9e7b1a098a731c40eeeba57e5873f46f3d` auf `phase/slim-p9-api-calls` (im isolierten Worktree, von `master` abgezweigt)
**Fix-Runden:** keine — Gate PASS im ersten Durchlauf (beide finalen Urteile ohne Blocker)

---

## 1. Scope

`PLAN-SERVER-SLIM.md` Phase P9: reine Verschiebung der Outbound-Call-Route-Gruppe aus `src/server.js` in ein neues Modul `src/routes/api-calls.js`, nach demselben DI-Router-Factory-Muster wie `makeReadRoutes`/`makeTenantWriteRoutes`/`makeBillingRoutes`. Betroffen:

- `contextReceivedMeta(context)` — modul-privater Helfer (I10-Meta fuer `place_call`-Antworten)
- `POST /api/calls` — Outbound-Call-Start (Vertrag: `to`/`objective`/`briefing`/`constraints`/…)
- `POST /api/calls/:id/cancel` — laufenden Anruf sauber abbrechen

Kein neues Feature, kein Verhaltenswechsel — Handler-Koerper verbatim aus `server.js` L1017-1148 / L1151-1175 uebernommen, nur mechanische Referenz-Renames (`app.post`→`router.post`, `lifecycle.arm*`→`arm*`, `callFinish.finishCall`→`finishCall`).

**safetyGateImpact:** hoch — dies ist der Outbound-Money-Path. Die geordnete Safety-Gate-Kette (`outboundGates`), der Max-Dauer-Cap (`armMaxDurationTimer`), der Reserve-Backstop (`armReserveReleaseTimer`) und der Fehler-Settlement-Pfad (`terminateAndBillCall` + `billThunk`) laufen alle durch diese zwei Routen.

---

## 2. Plan (gekuerzt)

### 2.1 Ist-Zustand (gegen `master` verifiziert)

`src/server.js` lag bei 1671 Zeilen (P1–P8 bereits extrahiert). Die drei P9-Bloecke:

| Block | Zeilen (master) |
|---|---|
| `contextReceivedMeta` (+ I10-Kommentar) | L1001-1014 |
| `app.post("/api/calls", …)` | L1017-1148 |
| `app.post("/api/calls/:id/cancel", …)` | L1151-1175 |

Mount-Position: nach der REST-API-Section-Header (L999), vor `app.use(makeReadRoutes(...))` (L1185). Alle injizierten Symbole gegen ihre Herkunft in `server.js` verifiziert: `store`, `config`, `audit`, `outboundGates`, `voiceControl`, `originateAiAssistantCall`, `terminateAndBillCall`/`hangUpAction`/`billThunk`, `callFinish`, `lifecycle`, `requestTenant`, `tenantOwnsCall`/`internalIdentity`/`OWNER_ID`, `normNum`/`PROVIDER`, `isTrunkZeroFormatError`/`E164_FORMAT_ERROR`.

Verifizierte Grundlagen: `lifecycle.armMaxDurationTimer`/`armReserveReleaseTimer` sind Closures (kein `this`, per Referenz weitergabefaehig); `contextReceivedMeta` wird nur intern benutzt (wandert modul-privat mit); der Offenlegungssatz liegt in `claude.js`/`bridge.js` und ist ausserhalb des Scopes.

### 2.2 Neue Datei `src/routes/api-calls.js` (~185 LOC)

**Dokumentierte Konvention-Entscheidung:** `normNum`/`PROVIDER` (aus `store/defaults.js`) und `isTrunkZeroFormatError`/`E164_FORMAT_ERROR` (aus `telephony/outbound-gates.js`) werden **direkt importiert statt injiziert** — folgt der etablierten Sibling-Konvention in `src/routes/` (z.B. `globalCapEur` in `makeReadRoutes`, `BOOTSTRAP_TENANT_ID` in `_tenant.js`): eine Quelle (G5), weniger Args (F1). Injiziert bleiben nur Laufzeit-Instanzen + Request-Tenant-Resolver.

`finishCall` wird bare injiziert (`finishCall: callFinish.finishCall`) — identische mechanische Umbenennung wie P4/P5 bereits in `call-lifecycle.js`/`telnyx-call-control-ingest.js` vollzogen haben.

`makeCallRoutes(deps)` nimmt EIN Deps-Objekt (`store`, `config`, `audit`, `outboundGates`, `voiceControl`, `originateAiAssistantCall`, `terminateAndBillCall`, `hangUpAction`, `billThunk`, `finishCall`, `arm: { armMaxDurationTimer, armReserveReleaseTimer }`, `tenant: { requestTenant, tenantOwnsCall }`, `internalIdentity`, `OWNER_ID`), erzeugt einen `express.Router()`, registriert beide Routen und gibt ihn zurueck.

`contextReceivedMeta` bekommt `config` als zweites Argument (war Datei-Scope-Closure, wird modul-privat) — der einzige Signatur-Touch, weil die Funktion sonst rein bleibt (≤2 Args, F1-konform).

### 2.3 Edit in `src/server.js`

- Import ergaenzt: `import { makeCallRoutes } from "./routes/api-calls.js";` (nach dem `makeBillingRoutes`-Import).
- Handler-Block (I10-Kommentar bis Ende Cancel-Handler, L1001-1175) durch `app.use(makeCallRoutes({ … }))` ersetzt, an unveraenderter Ordinalposition (INV-2/INV-6: `/voice/call-control` → **makeCallRoutes** → `makeReadRoutes` → `makeTenantWriteRoutes` → `makeProfileRoutes` → `makeBillingRoutes` → `onboard`).

### 2.4 Tests (mechanisch, 0 neue Tests)

Zwei Whitebox-Quelltext-Grep-Tests lesen `src/server.js` und muessen auf `src/routes/api-calls.js` retargetet werden:

- `test/telnyx-p6-cap-callcontrol.test.js`: neue Quelle `apiCallsSrc` ergaenzt; T7/T8 von `serverSrc`/`app.post` auf `apiCallsSrc`/`router.post` umgestellt.
- `test/call-termination-order.test.js`: neue Quelle `apiCallsSrc` ergaenzt; zwei Tests (`place_call`-Catch, „alle 5 Pfade EINE Quelle") auf `apiCallsSrc`/`router.post` umgestellt, Assertion `billThunk(callFinish.finishCall, …)` → `billThunk(finishCall, …)` (bare Dep-Name).

Kein anderer Test betroffen (grep-verifiziert): `telnyx-event-ingest-machine.test.js` (nur Prosa), `mcp-ui.test.js`/`assistant-context-http.test.js` (Blackbox HTTP), `telnyx-observability-secret-guard.test.js` (nur `/voice`-Region).

### 2.5 Invarianten-Checkliste (P9-relevant)

- **INV-9 (Safety-Gates):** `for (const gate of outboundGates)` unveraendert, `outboundGates` injiziert (das eine gepinnte Array); `armMaxDurationTimer(call,null)` (C-Telnyx) / `(call,tw.sid)` (TeXML) an denselben Punkten; Fehlerpfad (`terminateAndBillCall` + `providerStatus`-Kategorisierung, keine Secret-Leaks) wortwoertlich mitgewandert.
- **INV-7 (eine Instanz):** `finishCall`, `arm.*`, `outboundGates`, `requestTenant`, `tenantOwnsCall` alle injiziert, keine Zweitinstanz.
- **INV-2/INV-6:** Mount an unveraenderter Ordinalposition, Boot-Log-Zeile weiterhin 1×.
- **INV-10:** `server.js` bleibt export-frei.

### 2.6 Pre-Mortem (Money-Path)

- „Cap geht verloren, Call laeuft unbegrenzt" → verbatim-Move der `armMaxDurationTimer`-Aufrufe an identischen Punkten, abgesichert durch `telnyx-p6-cap-callcontrol` T8 + `max-duration-*`-Suite.
- „Doppelbuchung/Reserve-Leck bei Dial-Fehler" → Catch-Pfad (`terminateAndBillCall` + `billThunk(finishCall,…)`, kein manuelles `releaseReserve`) unveraendert, gepinnt durch `call-termination-order` + `outbound-reserve-*`.
- „Secret-Leak in 502-Body" → `place-call-error.test.js` unveraendert gruen.
- Blast-Radius: 1 neue Datei, 1 Import + 1 Mount in `server.js`, 2 mechanische Test-Retargets.

---

## 3. Implementierungs-Zusammenfassung

Plan vollstaendig und plan-konsistent umgesetzt: `POST /api/calls` und `POST /api/calls/:id/cancel` aus `src/server.js` nach `src/routes/api-calls.js` verschoben (`makeCallRoutes`-Factory, DI-Muster identisch zu `makeReadRoutes`/`makeTenantWriteRoutes`/`makeBillingRoutes`). Outbound-Gate-Kette, Max-Dauer-Cap (an beiden Punkten: C-Telnyx `call,null` und TeXML `call,tw.sid`), Reserve-Backstop und Fehler-Settlement-Pfad byte-identisch mitgewandert. Mount an unveraenderter Ordinalposition, hinter Basic-Auth. `server.js` netto **-149 Zeilen** (1671 → 1522), bleibt export-frei (`grep -c "^export"` = 0), Boot-Log-Zeile weiterhin genau 1×.

**Test-Retargeting:** `test/telnyx-p6-cap-callcontrol.test.js` (T7/T8 auf `api-calls.js` retargetet, tote `serverSrc`-Konstante entfernt), `test/call-termination-order.test.js` (zwei Quelltext-Wiring-Guards retargetet, `billThunk`-Assertion auf bare `finishCall` angepasst) — **0 neue Tests**, Assertionsstaerke unveraendert.

**Testlauf:** volle Suite 2290/2290 gruen (json + eingebettete pglite-Tests gemischt in der Suite).

**Smoke:** Server mit `SKIP_TWILIO_SIGNATURE_CHECK=true FAKE_ORIGINATE=true` + Dummy-Env gestartet (`localhost:3999`); `GET /healthz` → 200; `POST /api/calls` mit `{}` → 400 `{"error":"to und objective sind Pflicht"}` (exakt wie im Plan erwartet); Boot-Log-Zeile „Hermes Gateway laeuft auf http://localhost:3999" genau 1×. Server sauber gestoppt.

**Committed:** ja, Commit `b270ae9` auf Branch `phase/slim-p9-api-calls` (von `master` abgezweigt, isolierter Worktree).

### Deviations (Implementierung)

1. Dep-Liste bewusst abweichend (im Plan selbst so vorgezeichnet): `normNum`, `PROVIDER`, `isTrunkZeroFormatError`, `E164_FORMAT_ERROR` **nicht injiziert**, sondern direkt aus `store/defaults.js` bzw. `telephony/outbound-gates.js` importiert — Sibling-Konvention (G5/G11/G24), verhaltensneutral.
2. `finishCall` bare injiziert (`finishCall: callFinish.finishCall`) statt `callFinish`-Objekt — identische Konvention wie in `call-lifecycle.js`/`telnyx-call-control-ingest.js` (P4/P5).
3. `contextReceivedMeta` erhaelt `config` als zweites Argument (war Datei-Scope-Closure, jetzt modul-privat) — einziger Signatur-Touch, im Plan so vorgesehen.
4. Zusaetzlich zum Plan: die jetzt ungenutzten Imports `E164_FORMAT_ERROR`/`isTrunkZeroFormatError` wurden aus `server.js` entfernt (G12, im Plan implizit aber nicht explizit als Edit-Schritt genannt).
5. Zusaetzlich zum Plan: in `test/telnyx-p6-cap-callcontrol.test.js` wurde die jetzt tote `serverSrc`-Konstante entfernt (G12) — nach dem Retargeting von T7/T8 auf `apiCallsSrc` war sie im gesamten File ungenutzt; im Plan nicht erwaehnt, aber zwingend fuer Clean-Code.
6. Zwei Whitebox-Quelltext-Tests mechanisch retargetet (`server.js`→`api-calls.js`, `app.post`→`router.post`, `callFinish.finishCall`→`finishCall`) wie im Plan spezifiziert — 0 neue Tests.

### Clean-Code-Selbstcheck (Impl-Agent)

G5 (Duplizierung) PASS — `normNum`/`PROVIDER`/`isTrunkZeroFormatError`/`E164_FORMAT_ERROR` direkt aus ihrer Heimat importiert statt injiziert (Sibling-Konvention wie `api-billing.js`/`api-read.js`), keine Zweitquelle. G12 (ungenutzte Imports) PASS — `E164_FORMAT_ERROR`/`isTrunkZeroFormatError` aus dem `server.js`-Import entfernt (nach der Extraktion dort ungenutzt); ebenso das jetzt tote `serverSrc` in `telnyx-p6-cap-callcontrol.test.js` entfernt. F1 (≤3 Argumente) PASS — `makeCallRoutes` nimmt EIN Deps-Objekt, `contextReceivedMeta` hat 2 Argumente. P15 (keine Lazy-Init) PASS — Router einmal konstruiert und gemountet. C5/G9 (kein toter/auskommentierter Code) PASS — Verschiebung wortwoertlich verbatim mit den 5 im Plan spezifizierten Referenz-Renames. N7 (Nebeneffekte im Namen) PASS — `contextReceivedMeta` bleibt rein. G24 (Konventionen) PASS — Modul-Doc-Kopf, Deps-Kommentar-Stil, Router-Pattern 1:1 wie `api-billing.js`/`api-tenant-write.js`. Keine neuen Magic Numbers, keine neuen Dependencies, keine `eslint-disable`-Marker.

---

## 4. Safety-Urteil (final)

**Verdict: APPROVED.**

- `approved: true`, `testsPassIndependently: true`, `safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`, `scopeRespected: true`, `behaviorAsIntended: true`.
- **Blockers: keine.**
- **Independent Test Summary:** volle Suite (`npm test` = `node --test test/*.test.js`, json-Default + eingebettete pglite-pg-Tests) zweimal gelaufen: Lauf #1 = 2289 pass / 1 fail; Lauf #2 = 2290 pass / 0 fail (gruen). Der einzelne Fail aus Lauf #1 (`test/telnyx-p5-origination.test.js:143`, „genau eine neue Notification" → bekam 0) wurde isoliert nachgestellt (`node --test test/telnyx-p5-origination.test.js` = 4/4 gruen) und als vorbestehender Voll-Last-Test-Synchronisations-Race in **unveraendertem** Code (`finishCall` in `src/telephony/call-finish.js`: `releaseOutboundReserve`+`store.save` laufen VOR `store.addNotification`; der Test pollt auf `reserveReleased===true` und kann das Fenster erwischen, in dem die Notification noch fehlt) root-caused — kein P9-Regressionsdefekt, bestaetigt durch den gruenen Re-Lauf.
- Gezieltes Spec-Set (`outbound-reserve-concurrency-http`, `outbound-frozen`, `kyc-gate-outbound`, `w5-abo-allowlist-gate`, `onboarding-outbound`, `place-call-error`, `e164-trunk-zero-reject`, `outbound-gates-order`) + die zwei aktualisierten Whitebox-Tests (`call-termination-order`, `telnyx-p6-cap-callcontrol`) = 66/66 pass.
- Smoke (`SKIP_TWILIO_SIGNATURE_CHECK=true FAKE_ORIGINATE=true`): Boot-Log-Zeilenzahl=1, `POST /api/calls {}` → 400 `{"error":"to und objective sind Pflicht"}`, `POST /api/calls/unknown/cancel` → 404 `{"error":"not found"}`.
- **Verdict-Details:** reine Verschiebung der Outbound-Call-Route-Gruppe via `makeCallRoutes(deps)` (`express.Router`), gemountet an identischer Vorposition (hinter der `/api`-Basic-Auth-Gate, vor `makeReadRoutes`). Diff-Scope exakt 4 Dateien: das neue Modul, `server.js` (netto -176), zwei Whitebox-Grep-Marker-Test-Updates (assertionsstaerke-erhaltend). Keine `package.json`/Lockfile-Aenderung. `src/claude.js`/`src/bridge.js` unangetastet → Offenlegung fest verdrahtet. INV-1..INV-11 halten alle: `outboundGates` ist das eine gepinnte, einmal konstruierte Array (injiziert), die vollstaendige geordnete Gate-Schleife + die 400-Pre-Gate-Checks (`to`/`objective` + `isTrunkZeroFormatError`) verbatim verschoben; `armMaxDurationTimer(call,null)` [C-Telnyx] / `armMaxDurationTimer(call,tw.sid)` [TeXML, `voiceEngine!==realtime`] + `armReserveReleaseTimer` an exakt denselben Punkten; Telnyx-Assistant-vs-TeXML-Origination-Verzweigung und Fehler-Settlement-Pfad (`terminateAndBillCall` + `providerStatus`-Kategorisierung, Secret-freies `err.message`-Logging, generische Client-Meldung, 502/500) identisch; Budget-Schnittmenge liegt unveraendert in den Gates. Auth fail-closed intakt (Gate vor Mount, `/api/calls` nicht ausgenommen, `safeEqual` unveraendert).
- **Concerns (nicht blockierend):**
  1. Vorbestehender (out-of-scope) Test-seitiger Flake in `test/telnyx-p5-origination.test.js:188`: pollt auf `call.reserveReleased===true`, aber `finishCall` persistiert `reserveReleased` VOR der Notification, wodurch unter Voll-Last `s.notifications.length===1` gelegentlich 0 lesen kann. Fix gehoert in eine spaetere Phase (auf `notifications.length` oder einen Completion-Marker pollen statt `reserveReleased`), NICHT P9 — der Produktionscode ist byte-identisch zu `master`.
  2. Die Lifecycle-Timer werden per Destructuring injiziert (`arm: { armMaxDurationTimer, armReserveReleaseTimer }`) und bare aufgerufen — als sicher verifiziert: `makeCallLifecycle` gibt reine Closures zurueck (`function`-Deklarationen, kein `this`/Method-Binding), kein Bound-Context-Verlust. Die urspruenglichen `lifecycle.armMaxDurationTimer(call,null|tw.sid)`-Aufrufstellen sind an exakt denselben Punkten reproduziert.

---

## 5. Clean-Code-Audit (final, s1–s4)

**Verdict: PASS.** `blocker: false`.

P9 ist eine saubere, verifiziert byte-identische Verschiebung der Outbound-Call-Routen von `src/server.js` nach `src/routes/api-calls.js` (`makeCallRoutes`-Factory, DI-Muster identisch zu `makeReadRoutes`/`makeBillingRoutes`/`makeTenantWriteRoutes`). Normalisierter Zeilen-Diff (nur mechanische Umbenennungen: `app.post`→`router.post`, `lifecycle.arm*`→`arm*`, `callFinish.finishCall`→`finishCall`, `contextReceivedMeta` erhaelt `config` als expliziten Parameter statt Closure) zeigt **0 Logik-Abweichungen**. Alle injizierten Deps werden tatsaechlich benutzt (kein Muell). `outboundGates` bleibt EIN Array (einmal am Boot instanziert), `voiceControl` bleibt der eine Import — keine zweite Instanz, keine Duplizierung der Gate-Kette. `node --check` auf beiden Dateien gruen; volle Suite 2290/2290 gruen (isoliert im Worktree verifiziert, `node_modules` verlinkt). Die bestehenden Quelltext-Pruef-Tests wurden korrekt nachgezogen; zusaetzlich decken ~30 Integrationstests `/api/calls` end-to-end weiterhin real ab (Server-Spawn), kein Testluecken-Risiko durch die Verschiebung.

### s1 (Blocker)

Keine Befunde.

### s2

Keine Befunde.

### s3

1. **G30/G34 (bundled)** · `src/routes/api-calls.js:62-135` (`POST /api/calls`-Handler) · Der Handler vermischt weiterhin mehrere Abstraktionsebenen (Input-Validierung, Gate-Loop, Call-Erzeugung, Provider-Verzweigung, Fehlerkategorisierung) in einer ~73-Zeilen-Funktion — unveraendert aus `server.js` uebernommen, im Modul-Kommentar selbst als „bewusste Folgearbeit, NICHT diese Phase" benannt. Kein neuer Verstoss durch P9, aber im Scope sichtbar. Fix (spaetere Phase): Payload-Validierung / Gate-Loop / Provider-Dispatch / Fehler-Mapping in benannte Teilschritte extrahieren (vgl. G30-Beispiel `pay()`/`payIfNecessary()`).

### s4

1. **F1 (kalibriert)** · `src/routes/api-calls.js:47-56` (`makeCallRoutes`-Signatur) · 12 destrukturierte Top-Level-Keys im Deps-Objekt — deutlich ueber der 0-2-Zielgroesse, aber EIN Objekt-Argument (kein Verstoss gegen die Positional-Args-Zaehlung von F1) und exakt das im Repo etablierte DI-Factory-Muster (`makeBillingRoutes`/`makeReadRoutes` haben dieselbe Form) — keine Aktion noetig, nur zur Kenntnis.

### passNotes (final)

Vier-Regeln-Reihenfolge eingehalten: (1) alle 2290 Tests gruen, kein neuer Testausfall; (2) keine Duplizierung — alte Route-Bloecke aus `server.js` vollstaendig entfernt (`contextReceivedMeta`, `E164_FORMAT_ERROR`-Import, `isTrunkZeroFormatError`-Import verifiziert nicht mehr vorhanden), keine Parallel-Implementierung der Gate-Kette; (3) Namen/Kommentare druecken die Absicht klar aus, Modul-Doc-Kommentar begruendet jede Entscheidung (INV-9-Sicherheitsgates, INV-7-Single-Instance, G5-Quelle); (4) Struktur minimal — genau eine neue Factory-Funktion + ein Helper (`contextReceivedMeta`), keine Ueberfragmentierung. Sicherheitsgates prompt-konform unveraendert: Outbound-Gate-Kette (eine Schleife ueber `outboundGates`), Max-Dauer-Cap (`armMaxDurationTimer` an denselben zwei Stellen), Reserve-Backstop (`armReserveReleaseTimer`), Auth-Mount-Position hinter der globalen Basic-Auth-Middleware — alles per normalisiertem Diff und Boot-Reihenfolge verifiziert, nicht nur behauptet. Fehlerpfad (`terminateAndBillCall`, Secret-freie Fehlermeldung an Client, `providerStatus`-Kategorisierung) 1:1 uebernommen.

### topTodos

1. Optional/spaetere Phase: den G30-Split des `POST /api/calls`-Handlers (Validierung/Gate-Loop/Provider-Dispatch/Fehlerpfad in eigene Funktionen) nachholen — im Code selbst bereits als offene Folgearbeit dokumentiert, kein Blocker fuer P9.

---

## 6. Fix-Runden

**Keine Fix-Runde noetig.** Beide finalen Reviews (Safety + Clean-Code-Auditor) liefen im ersten Durchlauf ohne Blocker durch (`approved: true`, `blocker: false`, s1/s2 leer) — Gate PASS ohne Nacharbeit.

---

## 7. Betroffene Dateien

**Neu:** `src/routes/api-calls.js` (~185 LOC, `makeCallRoutes`-Factory + `contextReceivedMeta`)

**Edits (Produktionscode):** `src/server.js` (Import + Mount, netto -149 Zeilen: 1671 → 1522)

**Edits (Tests):** `test/telnyx-p6-cap-callcontrol.test.js` (T7/T8 retargetet auf `api-calls.js`, tote `serverSrc`-Konstante entfernt), `test/call-termination-order.test.js` (zwei Quelltext-Wiring-Guards retargetet, `billThunk`-Assertion auf bare `finishCall` angepasst)

**Explizit unveraendert:** `src/claude.js`, `src/bridge.js` (Offenlegungssatz), alle anderen `src/routes/*`-Module, `outboundGates`-Konstruktion (`server.js`, bleibt an ihrer bestehenden Boot-Stelle).

---

## 8. Status

**Gate: PASS.** Phase P9 (`phase/slim-p9-api-calls`, Commit `b270ae9`) hat den dualen Review (Safety + Clean-Code-Auditor) im ersten Durchlauf ohne Blocker bestanden (`approved: true`, `blocker: false`, s1/s2 leer). Volle Suite 2290/2290 gruen (Re-Lauf; die einzelne Lauf-#1-Abweichung war ein isoliert reproduziert gruener, vorbestehender Voll-Last-Flake ausserhalb des Diff-Scopes). Die Outbound-Call-Route-Gruppe (`POST /api/calls`, `POST /api/calls/:id/cancel`) lebt jetzt in `src/routes/api-calls.js` als eigenstaendige, DI-injizierte Router-Factory — Safety-Gate-Kette, Max-Dauer-Cap, Reserve-Backstop und Fehler-Settlement-Pfad byte-identisch mitgewandert, `server.js` bleibt export-frei und um netto 149 Zeilen schlanker.
