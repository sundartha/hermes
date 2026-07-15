# PLAN-FRAGILITY-REMEDIATION

Phasen-Strategie gegen die Fragilitaet "fix hier / kaputt dort". Baut auf dem
Clean-Code-Audit vom 2026-07-15 (`tasks/clean-code-audit-2026-07.md`) auf.
Die konkreten, code-verifizierten Fix-Designs pro Cluster liegen roh in
`tasks/fragility-cluster-designs.json` (7 Sonnet-Designer, je eine Schicht am
echten Code geprueft). Dieses Dokument ist die Sequenz + der Ausfuehrungsplan.

## 1. Problem in einem Satz

Ein lokal korrekt aussehender Fix bricht lautlos eine Invariante anderswo, weil
die Invariante im Code nicht sichtbar/erzwungen ist. Konkret erlebt: "wir aendern
was an Stripe und ploetzlich kann der KI-Agent nicht mehr reden."

## 2. Diagnose (aus dem Audit, verdichtet)

Es ist **kein** flaechendeckendes Copy-Paste (Anti-Dupl haelt: agentTurn/state-ops/
Registry = je eine Quelle, Geld = Cents). Zwei strukturelle Ursachen:

- **Ursache A — Ueberwachsene Hubs.** `server.js` (2679 Z., ~7 Verantwortlichkeiten)
  und `config.js` (flaches 111-Key-Objekt, 480 Call-Sites, von 17 Dateien importiert).
  Aenderung an einem Hub zwingt zum Nachdenken ueber alles im selben Scope -> ein
  Seiteneffekt woanders wird uebersehen.
- **Ursache B — Invarianten per Konvention statt Struktur (G31/G27).** Der eigentliche
  Treiber. Gate-Reihenfolgen nur per Kommentar; `finishCall`-Idempotenz nur wenn jeder
  Pfad durchlaeuft; pg/json-Symmetrie unerzwungen; `bridge.js` ohne die agentTurn-Guards.

**Meta-Lehre:** "Test gruen = Pfad live" gilt hier nicht durchgaengig — der pg-Boolean-
Drift ist im lokalen json-Dev unsichtbar, tote Seeds haben gruene Tests. Deshalb
gehoert zu jeder Phase ein Test, der die Invariante SELBST festnagelt, nicht nur das
Happy-Path-Verhalten.

## 3. Leitprinzipien der Remediation

1. **Invarianten strukturell erzwingen, nicht kommentieren** (G27). Jede Phase liefert
   einen Mechanismus, der den kuenftigen Fehler LAUT macht (Order-Snapshot, pg/json-
   Paritaet, Config-Proxy-Guard, Fail-Fast-Settlement-Guard).
2. **Safety-Netz vor Umbau.** Erst die aktiven Geld-/Korrektheits-Landminen (S1) und die
   Test-Wahrheits-Mechanismen; dann die groesseren Struktur-Refactors — die dann bereits
   durch die neuen Netze geschuetzt sind.
3. **Kein Big-Bang.** Ein Cluster = eine `phase-impl-lean`-Session in frischem Kontext.
   Grosse mechanische Umbauten (config-Grouping) feature-fuer-feature, nicht 111 Keys
   in einem Diff.
4. **Verhaltens-Erhalt beweisbar.** Bestehende Integrationstests bleiben gruen (Byte-
   Identitaet am externen Kontrakt); jede Phase fuegt ihren Invarianten-Test hinzu.
5. **Absolute Regeln unangetastet.** Safety-Gates, Offenlegungssatz, Auth fail-closed,
   Secrets, Audio-nie-durch-MCP (CLAUDE.md). Jede Phase traegt ihre `safetyGateImpact`-
   Einstufung; `touches-gate-risky`-Phasen brauchen den Opus-Safety-Review + ggf. einen
   echten Probe-Anruf vor Merge.

## 4. Die Phasen

Alle 7 Cluster melden `dependsOn: []` — sie sind technisch unabhaengig. Die Nummerierung
ist die **empfohlene Reihenfolge nach Risiko x Schutzwirkung**, keine harte Kette. Jede
Phase = eine eigene Impl-Session.

| Phase | Cluster | Audit | Ursache | Gate-Impact | Effort |
|---|---|---|---|---|---|
| P1 | C1 Stripe-Webhook-Race | S1-1 | B | preserves | M |
| P2 | C2 Geld/Typ + pg/json-Paritaet | S1-2/3 | A+B | preserves | L |
| P3 | C5 finishCall-Settlement erzwingen | Struct-4 | B | preserves | M |
| P4 | C4 Webhook-Parsing-Port | Struct-2 | A+B | none | S |
| P5 | C6a Config-Proxy-Guard + Grouping | Struct-3 | A | preserves | M |
| P6 | C3 Outbound-Gate-Kette extrahieren | Struct-1 | A+B | **risky** | L |
| P7 | C7 bridge.js-Guard-Paritaet + Dedup + tote Seeds | S2 | B | **risky** | M |

---

### P1 — C1: Stripe-Webhook-Race (S1-1, Sicherheit/Geld)

**Warum zuerst:** hoechste aktive S1-Landmine. `applyStripeWebhook` (`billing/webhook.js:190-246`)
laeuft ohne jede Serialisierung; Stripe liefert at-least-once, ohne Ordnung, ohne Event-ID-
Dedup. Zwei konkurrierende Events koennen falsch abschliessen -> Tenant bleibt
`active`+`kycLevel=CARD` trotz gescheiterter Zahlung -> **Outbound-Gate faelschlich offen**.

**Invariante (strukturell):** Pro Stripe-Korrelationsschluessel (`subscriptionId`, Fallback
`tenantRef`) laeuft hoechstens EIN Webhook-Effekt; nur das nach `event.created` neueste Event
veraendert den Tenant-Zustand.

**Kern-Refactor:**
- `src/chain-mutex.js`: additive `makeKeyedChainMutex()` (Map pro Schluessel, self-cleaning bei
  `inFlight===0` -> Millionen-Skala-vertraeglich; verschiedene Schluessel laufen parallel).
- `src/billing/webhook.js`: neue `applyStripeWebhookSerialized(event, deps)` NEBEN dem
  unveraenderten `applyStripeWebhook` (Bestandstests bleiben direkt lauffaehig). Serialisiert
  ueber den Keyed-Mutex + `lastAppliedByKey`-Map (Event-ID-Dedup + `created`-Monotonie); Anker
  erst NACH erfolgreichem Aufruf setzen (legitimer Retry nach Fehler nicht faelschlich geblockt).
- `src/server.js` Stripe-Route (~433): ruft die serialisierte Variante.
- **KEIN** `store.withStoreLock` (Deadlock mit verschachteltem `provision()` im ACTIVATE-Zweig,
  HARD-RULE `store.js:193-195`). Eigene, getrennte Chain-Instanz.

**Test (`test/stripe-webhook-race.test.js`, offline):** zwei konkurrierende Events
(`payment_failed` vs. `active`), Verzoegerung einmal auf ACTIVATE, einmal auf SUSPEND — in
BEIDEN Faellen gewinnt das nach `event.created` spaetere Event, nie `active`+CARD nach
Zahlungsfehler. Plus Event-ID-Dedup (zweiter identischer Aufruf = No-op) + verschiedene Tenants
serialisieren NICHT gegeneinander.

**Verifikation:** `npm test` gruen (neuer Test + bestehender `p3-payment-webhook.test.js`).
**Pre-Mortem-Restrisiko:** In-Process-`lastAppliedByKey` wird bei Deploy geleert -> seltenes
Fenster fuer eine sehr alte Redelivery direkt nach Neustart. Bewusst akzeptiert (Render-Free-
Tier = 1 Instanz), persistentes Dedup waere eigene Folge-Phase. Kommentar an
`interpretStripeEvent`: jeder neue Event-Typ MUSS eine der beiden Referenzen tragen.

---

### P2 — C2: Geld/Typ-Konsistenz + pg/json-Paritaet (S1-2, S1-3)

**Warum frueh:** zwei Korrektheits-Bugs an Geld-/Persistenz-Grenzen PLUS der Paritaets-Test,
der die Meta-Lehre ("json-Dev unsichtbar") strukturell schliesst und alle spaeteren Phasen
schuetzt.

**Bugs:**
- **S1-2** `maxBudgetEur` = Float-Euro (`config.js:68`), einziger Geld-Wert nicht in Cents;
  bildet mit `defaultTenantBudgetCents` eine Gate-Schnittmenge -> Einheiten-Verwechslung am
  Budget-Gate. -> `maxBudgetCents` (Cents-Integer); Env-Name `MAX_BUDGET_EUR` bleibt (Operator
  gibt EUR ein, `* CENTS_PER_EUR` bei Einlesung). ~4 Caller in `state-ops.js`, Display-Sites
  leiten aus Cents ab, ~10 Test-Dateien nachziehen (grep-gefuehrt). Externer API/MCP-Kontrakt
  bleibt EUR.
- **S1-3** `objective_achieved` Boolean->String-Drift: `pg.js` serialisiert `String(false)`
  (~1303), liest ohne Rueck-Coercion (~804). -> `deserializeObjective()` in `rowToCall`
  ("true"/"false"->Boolean, sonst unveraendert).

**Invariante (strukturell):** Geld = Ganzzahl-Cents repo-weit (G31); jede pg-Serialisierung hat
ihre spiegelbildliche De-Serialisierung an derselben Stelle (G27).

**Struktur-Mechanismus (Meta-Lehre):** neuer `test/store-pg-json-parity.test.js` — table-driven
Rundlauf ueber pglite (Re-Open) UND json-Store (Temp-DATA_DIR) fuer `objectiveAchieved` in
`[true,false,'unclear',null]`, `deepStrictEqual(pgResult, jsonResult)`. Neue pg-Spalten mit
nicht-trivialer Typabbildung bekommen kuenftig einen Eintrag hier (analog Geld-Manifest-Guard).

**Verifikation:** `npm test` gruen; Budget-Gate-Unit in Cents (`maxBudgetCents:800` vs.
`costEur=8.00` -> exceeded true, 7.99 -> false).
**Pre-Mortem:** uebersehene Callsite liest `config.maxBudgetEur` (jetzt undefined) ->
`undefined/CENTS_PER_EUR = NaN`, `>= NaN` immer false -> Budget-Gate schaltet sich lautlos ab.
Gegenmassnahme: Geld-Manifest-Test + die ~10 Budget-Gate-Erwartungstests brechen sofort.
**Bewusst zurueckgestellt:** `usage.costEur` -> Cents (S1-4) — sitzt nur im schnellen Live-Gate,
die Abrechnungswahrheit (`usage_event`) ist bereits Cents; eigener Cluster (siehe Abschnitt 6).

---

### P3 — C5: finishCall-Settlement strukturell erzwingen (Struct-4)

**Enthaelt einen echten Bug, nicht nur Struktur.** Am echten Code korrigiert: nur **5** echte
Terminierungspfade (Audit nannte 6 pauschal; `self-service-routes.js`/`sms-summary.js` sind
KEINE Terminatoren). `terminateAndBillCall` (`telephony/call-termination.js:19-29`) ist bereits
der Settlement-Gateway fuer 2 der 5.

**Echter Bug:** `server.js:1827-1829` (place_call-catch bei Dial-Fehlschlag) ruft `finishCall`
**nie** — Settlement/Notification laufen nie, `releaseReserve` wird manuell dupliziert. Kein
Test deckt das ab.

**Invariante (strukturell):** Jeder Statuswechsel weg von `active` laeuft ueber
`terminateAndBillCall(persistEnd, hangUp, bill)`; `bill` (Settlement) ist Pflichtfeld
(Runtime-Throw bei Fehlen) statt verteilter Konvention.

**Kern-Refactor:**
- Fail-Fast-Guard am Anfang von `terminateAndBillCall`: `if (typeof bill !== "function") throw`.
- `/voice/status` (~1510), Telnyx `onHangup` (`telnyx-call-control-ingest.js:221-228`): manuelles
  `endCallRecord`+`finishCall`-Paar durch `terminateAndBillCall({..., hangUp:null, bill:()=>finishCall(...)})`
  ersetzen (`hangUp:null` ist der bereits getestete Zweig).
- **Luecke schliessen:** place_call-catch ebenso ueber den Gateway; manuelles `releaseReserve`
  entfernen (finishCall macht das idempotent selbst).
- `bridge.js` (Realtime, 6. Pfad, andere Topologie, HEIKLE STELLE) bewusst NICHT hier — siehe P7/Restrisiko.

**Test:** `terminateAndBillCall` wirft ohne `bill`; doppelte Terminierung idempotent (kein
Doppel-Billing, Reserve genau einmal frei); Source-Regex-Checks, dass die 3 umgestellten Stellen
den Gateway nutzen. Bestehende `/voice/status`- und `telnyx-event-ingest`-Tests bleiben gruen.
**Verifikation:** `npm test` gruen. **Pre-Mortem:** ein 7. Pfad koennte den alten Stil kopieren
statt den Gateway zu rufen — Review-grep `endCallRecord` ausserhalb der 5 bekannten Stellen.

---

### P4 — C4: Provider-Webhook-Parsing hinter einen Port (Struct-2)

**Kleinste, risikoaermste Struktur-Phase (Effort S, `safetyGateImpact: none`) — guter
Vertrauens-/Warm-up-Schritt fuer die `phase-impl-lean`-Schleife.** Reines Parsing VOR den Gates,
keine Gate-Logik beruehrt.

`server.js` parst per 7-8 `if(provider===)`-Zweigen (`extractSpeech/extractLifecycleEvent/
extractSpeakOutcome`, ~588-642). Die DIP-Naht ist innen sauber, leckt aber hier.

**Invariante (strukturell):** Provider-Unterscheidung lebt an genau einer Stelle — der Registry,
dispatcht ueber Port-Objekte (G23 One-Switch). Gilt bereits fuer 4 Ports; Webhook-Parsing wird
der 5.

**Kern-Refactor:** neuer Port `WebhookEvents` in `ports.js`; `adapters/twilio/webhook-events.js`
+ `adapters/telnyx/webhook-events.js` (Code 1:1 verschoben, byte-identisch; `SAFE_CAUSE_TOKEN`
wandert mit; `SPEAK_OUTCOME`-Enum + `parseSpeakEvent` bleiben EINE Quelle in `speak-events.js`);
eine Registry-Zeile `webhookEvents(provider)`; die 3 Call-Sites in `server.js` rufen
`webhookEvents(provider).parseX(req.body)`. Dritter Provider = nur Adapter + Registry-Zeile.

**Test (`test/webhook-events.test.js`, offline):** je Adapter Speech/Lifecycle/SpeakOutcome
(Telnyx-Sonderfelder + `SAFE_CAUSE_TOKEN`-Regex + Transcript-Vorrang gepinnt); Registry-Dispatch.
Bestehende `voice-status-lifecycle`/`voice-speak-status`/`telnyx-speak-events`-Tests bleiben gruen.
**Pre-Mortem:** stille STT-/Diagnose-Regression beim Verschieben — Gegenmassnahme: 1:1-copy +
Charakterisierungstests. Dispatch bewusst per `provider`-Param, NICHT header-basiert (Spoof).

---

### P5 — C6a: Config-Proxy-Guard + erstes Feature-Grouping (Struct-3, Ursache A)

**Der Kraft-Multiplikator gegen "Key verschoben -> stiller Bypass am Gate".** `config.js` ist
flach (111 Keys, 480 dotted Call-Sites). Ein verschobener/getippter Key liefert heute lautlos
`undefined`.

**Invariante (strukturell):** Zugriff auf einen nicht-existenten Config-Key WIRFT sofort
(TypeError) statt `undefined` zu liefern — fail-closed statt fail-silent.

**Kern-Refactor:**
1. **Proxy-Guard zuerst** (bevor irgendein Key verschoben wird): `export const config =
   guardedConfig(rawConfigObject)` — rekursiver Proxy, `get` wirft bei `!(prop in target)`,
   reicht Symbole/Arrays unverpackt durch. Eigener Test beweist den Mechanismus SOFORT.
2. **Dann Grouping feature-fuer-feature, kleinstes Risiko zuerst, je ein Commit:**
   `telnyxAssistant` (10 Keys, DEFAULT AUS -> selbst uebersehener Caller ohne Live-Wirkung) ->
   `billing` -> `webLogin` -> `mcp`. Pro Key: grep Caller VORHER, verschachteln + alle Caller in
   DERSELBEN Aenderung umschreiben, grep NACHHER = 0. Der Proxy faengt jeden uebersehenen Caller
   als Crash in `npm test`.
3. **NICHT in dieser Phase:** die echten Safety-Gate-Keys (`maxBudgetCents`, `outboundFrozen`,
   `allowedCountryCodes`, `maxCallsPerHour`, `maxCallDurationS`, ...) bleiben flach, bis sich der
   Guard an den featureflag-geschuetzten Clustern bewaehrt hat.

**Test (`test/config-shape.test.js`):** Proxy wirft bei unbekanntem Top-Level/Nested-Key; nach
Migration existiert der alte flache Pfad nachweislich NICHT mehr; legitimer Zugriff liefert Default.
**Pre-Mortem:** uebersehener Caller in seltenem Nebenpfad (z.B. Reconcile-Job) -> mit Guard
lauter TypeError vor Merge / als 500 statt falscher Verzweigung; genau deshalb Safety-Gate-Keys
erst spaeter. **Teil (b) state-ops-Split:** nur Skizze (Barrel-Reexport, S4), getriggert statt
praeventiv — siehe Abschnitt 6.

---

### P6 — C3: Outbound-Gate-Kette aus server.js extrahieren (Struct-1)

**Der groesste Hebel gegen die Fragilitaet — bewusst NACH dem Safety-Netz, weil
`safetyGateImpact: risky`.** `POST /api/calls` (`server.js:1577-1854`) buendelt ~16 Safety-/
Geld-Gates, deren Reihenfolge NUR ein Kommentar ("Reihenfolge load-bearing") erzwingt. Ein neues/
umsortiertes Gate ist Freihand-Chirurgie in 278 Zeilen.

**Invariante (strukturell):** die Gate-Reihenfolge ist ein geordnetes, per Snapshot-Test
festgenageltes Array — Umsortierung wird ein Ein-Zeilen-Diff, der den Test bewusst bricht.

**Kern-Refactor:** neue `src/telephony/outbound-gates.js`, Factory `makeOutboundGates({store,
config,requestTenant,internalIdentity,OWNER_ID,TENANT_REJECT})` (DI-Muster wie `makeTenantResolver`).
Liefert `{ gates }` = Array `{name, run(ctx)}` in EXAKT bestaetigter Reihenfolge (16 Gates:
`outbound_frozen`, `resolve_identity`, `tenant_reject`, `normalize_target`, `trunk_zero_normalized`,
`kyc`, `owner_name`, `resolve_profile`, `number_gate`, `valid_text`, `assistant_context`,
`resolve_outbound`, `budget`, `minutes`, `compute_reserve`, `reserve_budget`). Jedes `run(ctx)`
liefert `null` (weiter) oder `{status, body, audit}`. Alle privaten Helfer wandern MIT (Koerper
unveraendert); `tariffCentsPerMin`/`E164_FORMAT_ERROR`/`isTrunkZeroFormatError` werden exportiert
und in `server.js` zurueckimportiert (EINE Quelle, Billing-Reconcile nutzt sie auch). Magic Numbers
180/300 -> benannte Konstanten (`DEFAULT_CALL_DURATION_S`, `MAX_CALL_DURATION_CAP_S`). Die Route
schrumpft auf: Body-Parse, 2 Pre-Gate-400-Checks, EINE `for`-Schleife ueber `gates`, dann
createCall/Originate aus `ctx`. `reserve_budget` bleibt das LETZTE Gate (Modul-Kommentar).

**Test (`test/outbound-gates-order.test.js`, offline):** (a) hartkodierter Order-Snapshot der
16 Namen (bricht bei Umsortierung); (b) je Gate ein Ablehnungsfall mit gepinntem
`status`/`body.error`/`audit`-Wortlaut (inkl. `number_gate` status 400 -> audit null;
`reserve_budget` throw = fail-closed). Bestehende Integrationstests (audit, outbound-frozen,
kyc-gate, number-gate, b2-quota, reserve-gate, ...) bleiben gruen (End-to-End-Byte-Identitaet).
**Pre-Mortem:** subtile Reihenfolge-Verschiebung (z.B. `resolve_profile` vor `owner_name`) oder
falsch uebertragene `reserve_budget`-try/catch-Semantik (nicht mehr fail-closed) -> Order-Snapshot
+ per-Gate-Throw-Test fangen genau das.

---

### P7 — C7: bridge.js-Guard-Paritaet + Dedup + tote Seeds (S2 + Ursache B)

**Enthaelt den wichtigsten verbliebenen Ursache-B-Fund (`risky`) und mechanische S2-Aufraeumung.**
Am echten Code wurden mehrere Audit-S2-Punkte als FALSE POSITIVE / bewusste Trennung entlarvt
(dead-air-Log, `voiceAttrs`=DIP, `fmtDate`/`fmt`=verschiedene Kontexte) — die werden NICHT
"gefixt".

**Prioritaet 1 (Invariante, HEIKLE STELLE, additiv):** `bridge.js` (Realtime) hat die
agentTurn-Safety-Guards NICHT — `end_call` ruft unbedingt `scheduleHangup`, kann also einen
Outbound-Call beenden BEVOR der Angerufene spricht (sogar waehrend der Offenlegung); Agent-
Transkript wird roh ohne `shapeForSpeech` gespeichert.
-> `shouldSuppressEndCall(call)` + `END_CALL_WAIT_INSTRUCTION` aus `claude.js` exportieren (byte-
identische Extraktion aus `agentTurn`); `bridge.js` importiert beide + `shapeForSpeech`; im
`response.done`-Handler `end_call` nur ausloesen, wenn `!shouldSuppressEndCall(call)`, sonst
Wait-Instruction zurueckspielen; Transkript durch `shapeForSpeech` schicken. HEIKLE STELLEN
(Barge-in/Timer) unangetastet.

**Prioritaet 2 (S2, mechanisch):** `tenantOwnsCall`-Kopie in `server.js:987` loeschen + aus
`request-tenant.js` importieren; `safeEqual` in `web-auth.js:44-49` durch Import aus `util.js`
ersetzen; TTL-1800-Doppelung (niedrig, ggf. nur Kommentar). **Bewusst NICHT** vereinheitlicht:
`requireTenant`-vs-inline-`TENANT_REJECT` in `POST /api/calls` (unterschiedlicher 403-Payload +
Audit-Vertrag; Fusion wuerde die Toll-Fraud-Forensik verstummen lassen).

**Prioritaet 3 (tote Pfade):** `seedBootstrapPrivateNumber`/`seedBootstrapIdentity`
(`state-ops.js:605/724`) + ihre 2 Testdateien loeschen (Owner-Removal-Altlast, kein Produktions-
Aufrufer). **VORHER** offene Branches pruefen (Memory: `dangling-unmerged-fixes`) — nicht raten.

**Test:** `shouldSuppressEndCall` unit (alle Zweige); `bridge-event-unit` — `end_call` bei
Outbound-ohne-Antwort unterdrueckt / nach Antwort terminiert / Transkript geshaped; safeEqual-
Roundtrip; nach Seed-Loeschung `npm test` ohne Referenzfehler.
**Pre-Mortem:** die zusaetzliche `response.create`-Roundtrip in `bridge.js` koennte mit dem
Barge-in-Guard kollidieren -> **vor Merge echter Realtime-Probe-Anruf**, nicht nur Fake-ctx-Unit.

## 5. Sequenzierung — Begruendung (Pre-Mortem der Reihenfolge)

- **P1-P3 (Safety-Netz) vor P4-P7 (Umbau):** stoppt zuerst die aktiven Geld-/Korrektheits-
  Landminen und etabliert die Test-Wahrheits-Mechanismen (pg/json-Paritaet, Settlement-Guard).
  Wuerde man mit dem grossen Gate-Refactor (P6) starten, refactort man auf ungetestetem Grund.
- **P4 als Warm-up:** kleinste Struktur-Phase, `none`-Gate-Impact — beweist die `phase-impl-lean`-
  Schleife (Plan->Impl->dualer Review->Self-Fix->Merge) an etwas Risikoarmem, bevor die riskanten
  P6/P7 kommen.
- **P5 (Proxy-Guard) vor P6/P7:** der Guard macht "Key verschoben" ueberall danach laut — er
  schuetzt genau die Umbauten, die als naechstes kommen.
- **P6/P7 (`risky`) zuletzt:** brauchen das volle Netz + Opus-Safety-Review; P7 zusaetzlich einen
  echten Realtime-Probe-Anruf.
- **Unabhaengigkeit gibt Flexibilitaet:** da alle `dependsOn: []`, kann bei Bedarf umsortiert
  werden (z.B. P4 ganz zuerst als Aufwaermer). Die Reihenfolge ist eine Risiko-Empfehlung, kein Zwang.

## 6. Ausfuehrungsmodell (pro Phase)

Jede Phase laeuft als eigene **`phase-impl-lean`**-Session (Memory `lean-phase-orchestration`,
`workflow-model-policy`):

- **In FRISCHER Session starten** (Lead-Kontext sauber; Lead liest NIE Code, bleibt <100k).
- **Phase im per-run-Skript HART pinnen** (Memory `phase-impl-workflow-args`): echten Git-Stand
  selbst pruefen, nicht dem args-Preset vertrauen.
- **Modell-Pins explizit** (Memory `workflow-model-policy`): Opus = Plan + Safety-Review,
  Sonnet = Impl/Audit/Fix/Report. Subagenten NIE Fable erben lassen.
- **Worktree-Isolation** fuer die Impl; dualer Review (Safety/Verhalten + Clean-Code-Auditor,
  S1/S2 = Blocker); Self-Fix bis PASS; **Merge im Lead**.
- **Git-Hygiene (Memory):** NIE `git add -A` (`git-add-all-hazard`); waehrend laufender
  worktree-Workflows NIE `git stash` (`stash-clobbered-by-worktrees`); Force-Push nur
  `--force-with-lease`.
- **`touches-gate-risky` (P6, P7):** zusaetzlicher Opus-Safety-Review-Gate; P7 + Realtime-Probe-Anruf.
- **Deploy-Bewusstsein (Memory `deploy-repo-split`):** Live laeuft ueber `upstream`; `git push
  origin` macht nichts live. Diese Phasen sind interne Refactors — Deploy erst nach bewusstem Cutover.
- Nach jeder Phase: `PLAN-SECURITY.md` pruefen (bei Gate-Beruehrung), Ergebnis + Verifikations-
  Output in `tasks/todo.md` protokollieren, Lehren in `tasks/lessons.md`.

## 7. Bewusst zurueckgestellt / akzeptierte Restrisiken

- **S1-4 `usage.costEur` -> Cents:** eigener spaeterer Cluster. Float sitzt nur im schnellen
  Live-Gate; Abrechnungswahrheit (`usage_event`) ist bereits Cents. Nicht in dieselbe PR wie P2
  (zwei unabhaengige Geld-Refactors gleichzeitig = groesseres Risiko).
- **C6b `state-ops.js`-Split (1742 Z.):** S4, niedrig. Barrel-Reexport-Skizze steht; nur anfassen,
  wenn eine kuenftige Feature-Aenderung wiederholt in den falschen Abschnitt draengt (getriggert).
- **`bridge.js` als 6. Terminierungspfad (aus C5-Pre-Mortem):** andere Topologie, HEIKLE STELLE;
  ein neuer Realtime-Terminierungspfad koennte den finishCall-Fehler reproduzieren. Als separater
  Folge-Befund vermerkt.
- **Config-Safety-Gate-Keys bleiben flach**, bis der Proxy-Guard sich an featureflag-Clustern
  bewaehrt hat (P5).
- **Stripe-Dedup ist in-process** (kein persistentes Ledger) — akzeptiert wie das bestehende
  `withStoreLock`-OT-3-Restrisiko.

## 8. Definition of Done (gesamt)

Fertig, wenn P1-P7 gemergt sind und gilt: (a) `npm test` gruen inkl. der neuen Invarianten-Tests
(Race, pg/json-Paritaet, Settlement-Guard, Webhook-Port, Config-Proxy, Gate-Order-Snapshot,
bridge-Guard-Paritaet); (b) jede Gate-Reihenfolge/Terminierung/Config-Zugriff ist strukturell
erzwungen, nicht per Kommentar; (c) keine der Absoluten Regeln aufgeweicht; (d) `tasks/lessons.md`
enthaelt die Lehren aus den `risky`-Phasen. Erfolgskriterium gegen die Ausgangsklage: eine
Aenderung an Stripe/Config/einem Gate bricht einen entfernten Pfad nicht mehr LAUTLOS — sie
bricht einen Test.
