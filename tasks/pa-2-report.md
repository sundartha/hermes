# Phase PA-2 — Detailbericht

**S1: Kein Provisioning-Enqueue vor persistierter Job-Spur (fail-closed)**

- **Gate:** PASS
- **finalBranch:** `phase/polish-a-p2`
- **headCommit:** `ddc8d40938e41d12e614d1c76f890db8873d1ea2`
- **Datum:** 2026-07-17

---

## 1. Plan (gekuerzt)

### Root Cause (code-verifiziert auf `master`)

Datei `src/worker/provisioning-orchestrator.js`, Funktion `queueProvisioning(numberId, tenantId)`. Der urspruengliche Ablauf:

```js
async function queueProvisioning(numberId, tenantId) {
  const idempotencyKey = `provision_${numberId}`;
  queue.enqueue({ kind: PROVISION_NUMBER_JOB, payload: { numberId }, idempotencyKey }); // <-- VOR Persistenz
  return store
    .withStoreLock(() => {
      const s = store.load();
      const job = recordProvisioningJob(s, { numberId, tenantId, idempotencyKey });
      store.save();                                   // <-- kann werfen (I/O / RLS)
      return { ok: true, jobId: job.id };
    })
    .catch((e) => {
      console.error("[provision] Job-Spur fehlgeschlagen:", e.message);
      return { ok: false };                           // Aufrufer triggert dann KEINEN Drain
    });
}
```

**Defekt (G31, verborgene temporale Kopplung):** Der Job landet in der In-Memory-Queue, *bevor* die persistente Job-Spur (`s.provisioningJobs`) committed ist. Scheitert `store.save()`/`withStoreLock`, liefert die Funktion `{ok:false}` (Aufrufer triggert keinen Drain) — aber der Queue-Job bleibt drin. Ein spaeterer, erfolgreicher Provisioning-Call eines *anderen* Tenants stoesst `runProvisioningDrainExclusive()` an; der Memory-Drain iteriert ueber **alle** QUEUED-Jobs — inklusive des verwaisten. `handleProvisionJob` kauft die Nummer real (Telnyx-Order, bei `PAYMENT_ENABLED` Hold+Capture), obwohl `s.provisioningJobs` keinen Eintrag hat. Ergebnis: **aktivierte Nummer = echtes Geld, OHNE Job-Spur**, die `reconcileOrphanedProvisioning` klassifizieren koennte.

**Aufrufer (beide profitieren automatisch, keiner wird angefasst — PM-8):**
- `src/routes/api-onboard.js`: `queueProvisioning` -> bei `!ok` 503, sonst `void runProvisioningDrainExclusive()`
- `src/worker/provisioning-orchestrator.js` `triggerTenantProvisioning`: gleiches Muster

### Der Fix (Blast-Radius: eine Funktion in einer Datei)

`queue.enqueue` wird strukturell **hinter** die erfolgreiche Persistenz gezogen (`.then` an die bestehende Promise-Kette gehaengt, Original-`.catch`-Fail-Closed-Semantik bleibt formgleich). Damit erzwingt der Kontrollfluss *persist -> enqueue* (G31 aufgeloest).

```js
async function queueProvisioning(numberId, tenantId) {
  const idempotencyKey = `provision_${numberId}`;
  return store
    .withStoreLock(() => {
      const s = store.load();
      const job = recordProvisioningJob(s, { numberId, tenantId, idempotencyKey });
      store.save();
      return { ok: true, jobId: job.id };
    })
    .then((res) => {
      queue.enqueue({ kind: PROVISION_NUMBER_JOB, payload: { numberId }, idempotencyKey });
      return res;
    })
    .catch((e) => {
      console.error("[provision] Job-Spur fehlgeschlagen:", e.message);
      return { ok: false };
    });
}
```

Begruendung fuer `.then` statt `async/await`+`try/catch`: kleinster Diff, bestehendes Promise-Chain-Idiom bleibt formgleich, keine Signatur-/Rueckgabe-Aenderung. Ein hypothetischer Enqueue-Wurf landete im `.catch` -> `{ok:false}` trotz bereits persistierter Spur = fail-closed-sichere Richtung (Reconciler greift beim Boot).

### Neuer Regressionstest — `test/provisioning-enqueue-order.test.js`

Reiner Unit-Test (kein Netz/Server/pglite): Fake-Store mit Transaktions-Rollback-Semantik (ein gescheitertes `save()` rollt den `provisioningJobs`-Push zurueck) + die reale In-Memory-Queue (deterministisch). `handleProvisionJob` ist gefaked und simuliert den Kauf. Szenario:

1. Tenant 1 (`num1`): erster `save()` wirft -> `{ok:false}`, keine Job-Spur, kein Drain-Trigger durch den (simulierten) Aufrufer.
2. Tenant 2 (`num2`): Persistenz erfolgreich -> `{ok:true}`, Drain laeuft.
3. Kern-Invariante (rot ohne Fix): `num1` bleibt `REQUESTED` (nie enqueued) und hat keine Job-Spur — obwohl der Drain fuer `num2` real lief (bewiesen durch `num2 === ACTIVE` + Job `DONE`).

### Rot-vor-Fix-Beweis (Pflicht)

1. Mit Fix: `NODE_ENV=test node --test "test/provisioning-enqueue-order.test.js"` -> pass 1 / fail 0.
2. Fix temporaer entfernt (enqueue zurueck vor `withStoreLock`, exakter `master`-Zustand) -> RED: `AssertionError: verwaiste num1 NICHT gekauft (nie enqueued)`, `actual 'active'` vs `expected 'requested'`.
3. Fix wiederhergestellt -> gruen.
4. Volle Suite `npm test` -> gruen.

### Invarianten & Abgrenzung (bindend)

- Kein realer Kauf (Hold+Capture) ohne `s.provisioningJobs`-Eintrag.
- `reconcileOrphanedProvisioning` kann jeden enqueued Job klassifizieren.
- Budget-/Safety-Gates, Offenlegungssatz, Auth unveraendert (Pfad hat keine Beruehrung).
- INV-7 (eine Memory-Queue pro Prozess) unveraendert.
- Happy-Path byte-verhaltensgleich; nur der Fehlerpfad aendert sich.
- PM-8 respektiert: `src/routes/api-onboard.js` und `triggerTenantProvisioning` nicht angefasst.
- `test/helpers.js`: bewusst KEINE Aenderung (reiner Unit-Test mit Fakes, keine neue Env-Var, kein BASE_ENV-Drift).
- Bestehende Tests (`test/onboard-persist-failure.test.js`, `test/provisioning-worker.test.js`, `test/prov01-boot-reconcile.test.js`) orthogonal, kein Overlap, bleiben unveraendert gruen.

### Pre-Mortem

- Risiko Fake-Store zu untreu (Test gruen mit UND ohne Fix): mitigiert durch Pflicht-Rot-vor-Fix, doppelt verifiziert (Impl + Reviewer).
- Risiko `.then`-Umbau veraendert Happy-Path-Rueckgabewert: mitigiert, `res` wird unveraendert durchgereicht.
- Risiko Fehl-Gruen ohne echten Drain-Lauf: mitigiert durch `num2 === ACTIVE` + Job `DONE` als Lauf-Beweis.
- Risiko `helpers.js` versehentlich editiert: explizit als "keine Aenderung" markiert.

---

## 2. Impl-Zusammenfassung

| Feld | Wert |
|---|---|
| headCommit | `ddc8d40938e41d12e614d1c76f890db8873d1ea2` |
| nodeCheckPass | true |
| testsPass | true |
| testPassCount / testFailCount | 2368 / 0 |
| committed | true |
| filesEdited | `src/worker/provisioning-orchestrator.js` |
| filesCreated | `test/provisioning-enqueue-order.test.js` |
| smokePass | true |

**Zusammenfassung:** PA-2 S1 exakt gemaess Plan umgesetzt. Einzige Produktionsaenderung: in `queueProvisioning` wurde `queue.enqueue()` aus dem Funktionskopf entfernt und via `.then()` an die bestehende `withStoreLock`/`save`-Promise-Kette gehaengt — enqueue laeuft jetzt nur noch NACH erfolgreicher Persistenz der Job-Spur. Bei Persist-Fehler bleibt es bei `{ok:false}` und KEINEM Queue-Eintrag (vorher blieb der Queue-Eintrag trotz Fehler bestehen). Neuer Regressionstest `test/provisioning-enqueue-order.test.js` beweist die Invariante direkt (reiner Unit-Test, Fake-Store mit Transaktions-Rollback-Semantik + reale In-Memory-Queue, kein Netz/Server/pglite).

Rot-vor-Fix-Pflichtnachweis durchgefuehrt: Fix-Zeile temporaer entfernt (exakter `master`-Zustand) -> derselbe Testbefehl schlaegt fehl mit `expected 'active' to strictly equal 'requested'` -> Fix wieder eingesetzt (byte-identisch gegen Backup verifiziert) -> wieder gruen. `node --check` gruen, volle Suite `npm test`: 2368/2368 gruen (2367 Bestandstests + 1 neuer Testfall), inklusive der 131 pglite/pg-Backend-Testdateien.

Best-effort Smoke: Server via `test/helpers.js` `startServer()` gebootet (`PORT=0`, `PROVISIONING_ENABLED=false`), `GET /healthz` -> `200 {"ok":true}`. Kein dedizierter HTTP-Smoke fuer `queueProvisioning` selbst (reine interne Funktion, PM-8 verbietet Anfassen von `api-onboard.js`); der Pfad ist bereits durch `test/prov01-boot-reconcile.test.js` (spawnt echten Server, ruft `/api/onboard` via HTTP) als Teil der gruenen Voll-Suite abgedeckt.

Blast-Radius exakt wie im Plan: 1 Funktion in 1 Datei (`src/worker/provisioning-orchestrator.js`), 1 neue Testdatei. `test/helpers.js`, `src/routes/api-onboard.js` und `src/onboarding.js` bewusst NICHT angefasst (PM-8, per `git status` vor Commit verifiziert). Keine neue Env-Var, kein BASE_ENV-Drift. Committed auf Branch `phase/polish-a-p2` (frischer Worktree, kein Deploy/Push).

**cleanCodeSelfCheck (Impl-Agent):** G31 (verborgene zeitliche Kopplung) aufgeloest: enqueue laeuft jetzt strukturell erst NACH erfolgreicher `withStoreLock`/`save`-Persistenz, ueber ein `.then()` an die bestehende Promise-Kette gehaengt (Original-Idiom `.catch` bleibt formgleich, keine Signatur-/Rueckgabe-Aenderung). Keine Magic Numbers, kein toter/auskommentierter Code, keine neue Dependency. C2 (Kommentar-Drift) vermieden: Header-Kommentar von "einreihen + persistieren" auf "persistieren, DANN einreihen" nachgezogen; neuer Begruendungs-Kommentar direkt an der enqueue-Stelle erklaert WARUM (G31-Referenz), nicht nur WAS. F1: Funktion hat weiterhin 2 Argumente. N7: `queueProvisioning` beschreibt weiterhin korrekt Persistieren+Einreihen.

### Deviations

Keine (`deviations: []`).

---

## 3. Safety-Urteil (final)

| Feld | Wert |
|---|---|
| approved | true |
| testsPassIndependently | true |
| safetyGatesIntact | true |
| disclosureIntact | true |
| authFailClosedIntact | true |
| noSecretsLeaked | true |
| scopeRespected | true |
| behaviorAsIntended | true |

**independentTestSummary:** Volle Suite unabhaengig in frischem Review-Worktree (`review-pa-2` off `phase/polish-a-p2`) ausgefuehrt: `NODE_ENV=test node --test 'test/*.test.js'` -> tests 2368, pass 2368, fail 0, skipped 0, Dauer ~73s. Inklusive des neuen PA-2-Tests und aller pglite-gestuetzten Tests. Rot-vor-Fix UNABHAENGIG verifiziert: `master`-Vor-Fix-Orchestrator ausgecheckt (`git checkout master -- src/worker/provisioning-orchestrator.js`, enqueue wieder vor `withStoreLock`), nur `test/provisioning-enqueue-order.test.js` gelaufen -> RED: `AssertionError` bei "verwaiste num1 NICHT gekauft", `actual 'active'` vs `expected 'requested'` (also `num1.status===ACTIVE`, der verwaiste Cross-Tenant-Kauf, ohne `provisioningJobs`-Spur — exakt die spezifizierte Rot-Bedingung). Fixed-Version wiederhergestellt (`git checkout review-pa-2 -- ...`) und erneut gelaufen -> GREEN. Arbeitsverzeichnis danach sauber, `git status --short` leer. `node --check` bestand auf beiden geaenderten Dateien.

**concerns (non-blocking):** `queueProvisioning`s `.then(res => { queue.enqueue(...); return res; })` verlaesst sich korrekt auf den synchronen Enqueue-Vertrag des Queue-Ports (`(job)=>string`). Der einzige lebende Adapter ist Memory (synchron); pg-boss wirft bei Konstruktion (deferred). Faellt kuenftig ein asynchroner Queue-Adapter rein, wuerde der enqueue relativ zur zurueckgegebenen Promise fire-and-forget/unawaited — das ist jedoch eine bereits vor PA-2 bestehende Eigenschaft (auch `master`s Vor-Fix-Code hat `enqueue` nicht awaited) und keine Neueinfuehrung durch PA-2. Zu flaggen, sobald der pg-boss-Adapter implementiert wird.

**verdict:** APPROVED. PA-2 ist ein korrekt geschnittener, fail-closed S1-Fix: `queue.enqueue` laeuft jetzt nur noch NACHDEM die `provisioningJobs`-Spur persistiert ist (in das `.then` von `withStoreLock` verschoben), sodass ein Persist-Fehler `{ok:false}` OHNE geuqeueten Job liefert -> kein verwaister Cross-Tenant-Kauf, und `reconcileOrphanedProvisioning` kann jeden persistierten Job klassifizieren. Diff ist exakt 2 Dateien (Orchestrator `queueProvisioning` + neuer Regressionstest); keine Package-/Lock-Aenderung (keine neue npm-Dependency); `onboarding.js`/`api-onboard.js` unangetastet gemaess PM-8. Happy Path ist byte-aequivalent (enqueue ist synchron gemaess Port-Vertrag; Aufrufer awaiten die volle Kette vor dem Single-Flight-Drain, der einen frischen Lauf startet und den Job sieht). Safety-Gates (numberGateError-Familie, Budget, Geld-Hold/Capture/Rollback), Offenlegung (`claude.js`+`bridge.js` unangetastet), Auth fail-closed und Secret-Hygiene alle intakt. INV-7 (eine Memory-Queue pro Prozess) erhalten. Unabhaengiger Rot-vor-Fix-Nachweis bestanden. Volle Suite 2368/2368 gruen.

**blockers:** keine.

---

## 4. Clean-Code-Audit (final)

| Kategorie | Befunde |
|---|---|
| S1 (Blocker, kritisch) | keine |
| S2 (Blocker, hoch) | keine |
| S3 (nicht-blockierend, mittel) | keine |
| S4 (nicht-blockierend, niedrig) | keine |
| blocker | false |

**verdict:** PASS. Diff `master..phase/polish-a-p2` = 1 Commit (`ddc8d40`), 2 Dateien: `src/worker/provisioning-orchestrator.js` (14 Zeilen) + `test/provisioning-enqueue-order.test.js` (133 Zeilen, neu). Kein Katalog-Verstoss gefunden (S1-S4 alle leer).

**passNotes:** Korrekter G31-Fix (verborgene zeitliche Kopplung): enqueue haengt jetzt strukturell im `.then()` der `withStoreLock`-Promise, nicht mehr synchron davor -> Persist-Fehler (`store.save()` wirft) fuehrt nachweislich zu KEINEM Queue-Eintrag (durch Test bewiesen, nicht nur behauptet). Docstring/Inline-Kommentare wurden konsistent mit dem neuen Verhalten aktualisiert (kein C2-Drift), keine Autoren-/Datums-Metadaten (C1 sauber), kein auskommentierter Code (C5 sauber). Rueckwirkende Pruefung des Nebenlaeufigkeitsverhaltens (P16): der `.then()`-Callback laeuft ausserhalb des internen Chain-Mutex-Tips, aber die Ordnungsinvariante (persist-vor-enqueue) haengt nicht von Mikrotask-Reihenfolge relativ zu anderen `withStoreLock`-Aufrufern ab, sondern einzig davon, dass `.then()` erst nach Aufloesung der Persist-Promise feuert — kein neues Race eingefuehrt. Rueckfallszenario (Crash exakt zwischen Persist und enqueue) ist bereits durch die bestehende Boot-Sweep-Reconciler-Architektur abgedeckt (In-Memory-Queue geht bei JEDEM Crash verloren, `reconcileOrphanedProvisioning` klassifiziert `queued`-Job-Spuren unabhaengig vom Queue-Zustand) — keine neue Luecke. Beide Aufrufer (`api-onboard.js` Zeile 215, `provisioning-orchestrator.js` Zeile 119 `triggerTenantProvisioning`) unveraendert, Rueckgabe-Shape `{ok,jobId}|{ok:false}` identisch erhalten. Regressionstest folgt Build-Operate-Check (P13), Rot-vor-Fix-Nachweis im Kommentar dokumentiert (P11-Geist), deterministisch/kein Netz/keine Timer (P12 F.I.R.S.T. erfuellt), reale In-Memory-Queue statt Mock (kein Over-Mocking). Volle Suite lokal gruen: 2368/0 (`node --test`), Syntax-Check ok. Kein Magic-Number-, Nesting- oder Funktionslaenge-Verstoss; oeffentliche Flaeche des Orchestrators unveraendert (G8 weiterhin 4 Funktionen exportiert).

**topTodos:**
1. Kein TODO — Phase PA-2/P2 ist mergefaehig.
2. Optional (kein Blocker, reine Doku-Vollstaendigkeit): das Katalog-Zitat "G31" im Code-Kommentar koennte im `PLAN-POLISH-A.md`-Tracking auf diesen Fix verlinkt werden, falls dort noch offen gefuehrt.
3. Bei Gelegenheit pruefen, ob der gleiche Persist-vor-Sichtbarmachung-Musterfix auch fuer `redriveProvisioningJobs()`/`closeSettledProvisioningJobs()` relevant waere (ausserhalb des aktuellen Diff-Scopes, daher hier nicht geflaggt — nur als Beobachtung fuer eine Folge-Phase).

---

## 5. Fix-Runden

Keine. Der erste Impl-/Review-Durchlauf war direkt PASS — kein S1/S2-Blocker im Clean-Code-Audit, keine Safety-Blocker, `deviations: []`, `FIXES` leer.
