# PLAN-LAUNCH-FIXES.md — Verbindliche Strategie fuer die drei Launch-Blocker

Status: verbindliches Umsetzungs-Dokument. Read-only erstellt (keine Code-Aenderung durch
diese Synthese). Grundlage: die drei finalen Fix-Designs + Pre-Mortems je Defekt, jeder
Kern-Befund stichprobenartig gegen den echten Code verifiziert. Repo-Stand: Worktree
`launch-fixes-strategy`, HEAD `361e55b`. Live-Backend `STORE_BACKEND=pg`, Render `plan: free`
(Single-Instance), Live-Voice-Engine `budget` (turn-basiert, `/voice/turn`).

Dieses Dokument traegt ALLEIN. Die Umsetzungs-Session liest ausschliesslich dieses Dokument plus
die hier genannten Code-/Testdateien.

---

## 0. Zweck, Audit-Bezug, Owner-Entscheidung

### 0.1 Zweck

`PLAN-LAUNCH-TESTS.md` (Repo-Root, 99 Tests P0-P2) hat drei erwartbar rote P0-Blocker
identifiziert, die vor dem Launch geschlossen werden muessen:

- **OUT-05** — Budget-/Reserve-Race bei parallelen `place_call`: mehrere gleichzeitige (oder
  kurz aufeinanderfolgende) Outbound-Calls koennen den Budget-Cap ueberschreiten, weil zwischen
  Reserve-Gate und Abrechnung (Call-Ende) keine Spur der voraussichtlichen Kosten im Store steht.
- **PROV-01** — Provisioning-Crash-Recovery: ein Prozess-Crash zwischen Enqueue und Drain laesst
  eine Nummer in `requested` haengen; es gibt keinen Wiederanlauf, und der Owner-Retry-Hebel ist
  fuer genau diesen Fall mit `409 already_provisioned` blockiert.
- **DEPLOY-04 / A6** — Deploy toetet laufende Calls: kein `SIGTERM`-Drain, kein Timer-Re-Arm,
  Reconcile-Flush kann aktive Call-Zeilen loeschen, Webhooks fuer dem Prozess unbekannte callId
  hangen fail-closed auf.

### 0.2 Owner-Entscheidung (bindend)

- **ALLE drei Defekte werden VOR dem Launch gefixt.** Keiner wird als akzeptiertes Launch-Risiko
  weggewinkt.
- **Der Deploy-Freeze ist nur eine Uebergangs-Auflage, bis der A6-Fix live ist.** Bis A6 live
  ist, darf nur in nachweislich anruf-freien Fenstern deployt werden (siehe 4.3). Sobald A6 live
  ist, entfaellt die Auflage im Rahmen der dort dokumentierten Restrisiken (Boot-Gap Free bleibt
  Infra-Grenze, Owner-Frage 6.1).

### 0.3 Ausfuehrungsmodell

Umsetzung in einer separaten Lean-Session nach dem etablierten Template: duenner Lead, pro Phase
EIN `phase-impl-lean`-Workflow auf Branch `fix/<phase>`, dualer Review (Safety/Verhalten +
Clean-Code-Auditor, S1/S2 = Blocker), Merge im Lead. `npm test` ist nach JEDER Phase komplett
gruen — es gibt in dieser Kette KEINE bewusst rot gelassenen Spaeter-Phase-Tests (jede Phase ist
additiv und in sich `npm test`-gruen; test-first heisst: der neue Test wird in derselben Phase
gruen).

Bindend fuer jede Phase: `.claude/refs/workflow.md`, `.claude/refs/clean-code.md`, und die
Absoluten Regeln aus `CLAUDE.md` — insbesondere Regel 1 (Safety-/Budget-Gates: Denylist,
Land-Gate, Stundenlimit, Budget-Guard global UND pro-Tenant als Schnittmenge, Max-Gespraechsdauer,
Provider-Signaturpruefung fail-closed — NIE aufweichen), fest verdrahteter Offenlegungssatz, Auth
fail-closed, keine Secrets in Logs/Responses.

---

# 1. OUT-05 — Budget-/Reserve-Race bei parallelen place_call

## 1.1 Verifizierte Wurzelanalyse (Datei:Zeile)

Der Audit-Titel unterstellt ein klassisches TOCTOU ("Reserve landet nicht atomar") und schlaegt
`withStoreLock` um "Check+Reserve" vor. Das ist nur die halbe Wahrheit: **es gibt heute keinen
Reserve-Schreibschritt, den ein Lock schuetzen koennte.**

- `src/store/state-ops.js:1132` `reserveExceedsBudget(s, tenantId, reserveCents, cfg)` ist eine
  reine Query auf `usageFor(s,t).costEur` — keine Mutation. Ebenso `budgetExceeded` (1123) und
  `globalBudgetExceeded` (1253). (Verifiziert: `state-ops.js` hat aktuell KEIN
  `reservations`/`tryReserve`.)
- Der Usage-Bucket kennt kein Reserve-Feld (`src/store/defaults.js:244-247`:
  `{ inputTokens, outputTokens, costEur, calls }`).
- Der einzige Ort, an dem eine EUR-Zahl in den Budget-Bucket geschrieben wird, ist
  `addVoiceUsageCostCents` (`state-ops.js:1104-1108`), aufgerufen NUR aus
  `reconcileOutboundVoiceBudget` (`src/server.js:1029-1033`), das NUR aus `finishCall`
  (`server.js:1055-1061`) laeuft — also **ausschliesslich bei Call-Ende**.
- Der Gate-Block in `POST /api/calls` laeuft synchron ohne `await` vom Budget-Gate
  (`server.js:1361`) ueber das Reserve-Gate (`server.js:1385`) bis zum ersten `await`
  `originateCall` (`server.js:1425`). Ab da gibt Node die Event-Loop frei -> ein zweiter Request
  sieht denselben unveraenderten `costEur`.

Zwei uebereinanderliegende Effekte:

- **(a) TOCTOU-Fenster:** durch den Netz-`await` bei 1425 geoeffnet.
- **(b) Strukturell, unabhaengig von Interleaving:** selbst rein sequenziell (Request A fertig
  bevor B eintrifft) bleibt die Luecke, weil die Abrechnung bis zu `maxDur` (geclampt 300 s,
  `server.js:1379`) spaeter passiert. N Calls kurz hintereinander sind alle einzeln unter dem
  Reserve-Cap, aber alle gleichzeitig aktiv und ungebucht — die kumulierte Worst-Case-Exposition
  uebersteigt den Cap um ein Vielfaches. Ein Lock um die reine Query behebt das NICHT.

**Globaler Notaus in verschaerfter Form:** `globalBudgetExceeded` (`state-ops.js:1253`) prueft nur
den settled Betrag; es gibt gar keine globale Reserve-Pruefung. Regel 1 verlangt BEIDE Achsen
(Schnittmenge) fail-closed.

## 1.2 Fix-Design

**Kernentscheidung:** In-Flight-Reserven laufen in einer NEUEN, strukturell ephemeren Map
`s.reservations` (tenantId -> Ganzzahl-Cents). `place_call` reserviert unter `store.withStoreLock`
atomar (Check+Increment, Schnittmenge Tenant UND global) VOR dem Dial, in einem fail-closed
try/catch; die Reserve wird bei JEDEM Endzustand freigegeben. Der bestehende settled-Budget-Gate
bleibt unveraendert und parallel (Regel 1, nur strenger).

**Store-Schicht (`src/store/state-ops.js`) — sitzt bewusst hier, damit json UND pg automatisch
gleichziehen (P3b-Muster):**

- `makeDefaultState()`: neues Feld `reservations: {}` (tenantId -> Ganzzahl-Cents). Money at rest
  = Ganzzahl Cents (G26).
- `reservationFor(s, tenantId)` -> `s.reservations[tenantId] || 0` (reine Query).
- `reservationsTotal(s)` -> Summe ueber `Object.values(s.reservations)` (globale Achse).
- `reserveExceedsBudget` wird **kumulativ**:
  `usageFor(s,t).costEur + (reservationFor(s,t) + reserveCents)/CENTS_PER_EUR > effectiveCapEur(...)`.
  Bei leerer Reserve byte-identisch zu heute -> Bestandstests gruen.
- `globalReserveExceedsBudget(s, reserveCents, cfg)` (NEU, schliesst die reserve-blinde globale
  Achse): `globalUsageTotals(s).costEur + (reservationsTotal(s) + reserveCents)/CENTS_PER_EUR > cfg.maxBudgetEur`.
- `tryReserveOutboundBudget(s, tenantId, reserveCents, cfg)` (NEU, atomare Einheit): wenn
  `reserveExceedsBudget || globalReserveExceedsBudget` -> `return false`; sonst
  `s.reservations[tenantId] = reservationFor(...) + reserveCents; return true;`. **Rein synchron,
  KEIN `await` zwischen Check und Increment** (echte Atomaritaet unter dem Lock).
- `releaseOutboundReserve(s, call)` (NEU, idempotent): No-op wenn `!call?.reserveCents ||
  call.reserveReleased`; sonst `s.reservations[call.tenantId] = Math.max(0, reservationFor(...) -
  call.reserveCents); call.reserveReleased = true;`. Clamp `>= 0` (G26), Idempotenz ueber
  `call.reserveReleased`.

**Strukturelle Ephemeralitaet (NIE persistiert/hydriert):**

- `src/store/json.js` `save()`: `reservations` VOR `JSON.stringify` per Rest-Destrukturierung
  ausschliessen (`const { reservations, ...persisted } = state; JSON.stringify(persisted, ...)`).
  Der In-Prozess-`state.reservations` akkumuliert prozessweit korrekt; nur die PLATTE ist per
  Konstruktion reserve-frei. KEIN fehleranfaelliger Reset in `load()`.
- `src/store/json.js` `load()`-Migrationsblock: `state.reservations ||= {}` (defensiv; da die
  Platte nie `reservations` traegt, ist das Ergebnis IMMER leer).
- `src/store/pg.js`: `hydrate()` baut auf `makeDefaultState()` -> `reservations:{}` gratis;
  `rowToUsage`/`flushUsage` fassen es NICHT an (keine Spalte, kein Schema-Change).

**Fassaden-Wrapper (json + pg, Muster wie `addVoiceUsageCostCents`):**
`tryReserveOutboundBudget`, `releaseOutboundReserve`, `reservationOf` (reine Query, kein save) —
in `src/store.js` ueber die Re-Export-Liste durchgereicht.

**Verdrahtung in `server.js` (`POST /api/calls`), fail-closed:** ersetzt den reinen
Reserve-Check (`server.js:1384-1394`):

```
const reserveCents = tariffCentsPerMin(to) * Math.ceil(maxDur / SECONDS_PER_MINUTE);
// Atomare Check+Reserve (Schnittmenge Tenant+global) VOR dem Dial. fail-closed:
// jeder Body-Throw (z.B. json save()-IO) MUSS als Denial gelten, NIE als reserviert,
// und darf keinen unhandled reject erzeugen. KEIN Netz-await im Lock-Body (Invariante).
let reserved;
try {
  reserved = await store.withStoreLock(() =>
    store.tryReserveOutboundBudget(tenantId, reserveCents, config),
  );
} catch (e) {
  console.error(`[place_call] reserve fehlgeschlagen tenant=${tenantId}:`, e.message); // secret-frei
  audit("place_call_denied", req, `to=${to} grund=reserve_error tenant=${tenantId}`);
  return res.status(402).json({ error: "Reservierung fehlgeschlagen. Bitte erneut versuchen." });
}
if (!reserved) {
  audit("place_call_denied", req, `to=${to} grund=reserve tenant=${tenantId} requestedBy=${requestedBy}`);
  return res.status(402).json({ error: "Voraussichtliche Anrufkosten ueberschreiten das verfuegbare Budget." });
}
```

- `createCall(...)` erhaelt zusaetzlich `reserveCents`; `state-ops.createCall` legt
  `reserveCents: reserveCents || 0` und `reserveReleased: false` am Call-Record an.
- `server.js`-Helper `releaseReserve(call)`:
  `store.withStoreLock(() => store.releaseOutboundReserve(call)).catch((e) => console.error("[reserve] release:", e.message))`
  (fehler-schluckend, NIE unhandled reject).
- Fehlerpfad `catch` (`server.js:1447`): `await releaseReserve(call)` VOR
  `store.endCallRecord(call.id, "failed")` — kein Dial = keine Kosten = volle Freigabe.
- `finishCall` (`server.js:1055`): nach `reconcileOutboundVoiceBudget(call)` und vor
  `store.save()`: `await releaseReserve(call)` — Worst-Case-Reserve abbauen, Ist-Minuten bleiben
  in `costEur`.

**Reserve-Release-Backstop (schliesst Pre-Mortem BLOCKER 1) — Timer beim Originate, BEIDE
Engines:** neue Funktion `armReserveReleaseTimer(call)` im try-Block NACH erfolgreichem Originate
(an der Stelle von `armMaxDurationTimer`, `server.js:1439`), aber **unbedingt** (kein
`voiceEngine !== "realtime"`-Guard):

```
function armReserveReleaseTimer(call) {
  const delay = (call.maxDurationS || config.maxCallDurationS) * 1000 + config.reserveReleaseGraceMs;
  setTimeout(() => releaseReserve(store.getCall(call.id) || call), delay);
}
```

- Warum NACH erfolgreichem Originate: der BLOCKER-Fall ist "Originate 200, Call laeuft,
  `completed`-Callback verloren" — dann IST der Originate zurueckgekehrt, der Timer wird sicher
  armiert. Der Originate-FEHLER-Fall gibt die Reserve bereits im `catch` frei.
- Idempotenz ueber `call.reserveReleased` -> frueherer Happy-Path-Callback macht den Timer zum
  No-op; kein Timer-Handle-Tracking noetig (Stil wie `armMaxDurationTimer`).
- Reserve-Lebensdauer strukturell `<= maxDur + reserveReleaseGraceMs` ODER bis zum naechsten Boot
  (ephemer) — der frueheste greift. Die Orphan-Akkumulation aus dem Pre-Mortem ist damit
  strukturell unmoeglich, unabhaengig von Callback-Zuverlaessigkeit und Boot-Frequenz.
- Neue Konstante `config.reserveReleaseGraceMs` (Env `RESERVE_RELEASE_GRACE_MS`, Default `15000`),
  in `config.js` zentralisiert, in `.env.example` dokumentiert, in `test/helpers.js` `BASE_ENV`
  mit neutralem `"15000"` nachgezogen (Lehre `test-base-env-drift`).

**Test-Seam fuer Originate-Erfolg (schliesst Pre-Mortem MAJOR 2) — `FAKE_ORIGINATE`,
boot-gehaertet:** offline kann `originateCall` sonst nicht erfolgreich zurueckkehren
(`twilioClient()` wirft synchron bei nicht-AC-SID), d.h. der server-seitige Atomaritaets-Pfad UND
der Erfolgs-Freigabepfad (`finishCall`/Timer) waeren untestbar.

- Neue `config.fakeOriginate` (Env `FAKE_ORIGINATE`, Default `false`), zentralisiert +
  `.env.example` + `BASE_ENV` `"false"`.
- `src/telephony/registry.js`: `fakeVoice`-Adapter (`originateCall` -> synthetisches
  `{ sid: 'fake_' + ... }`, `endCall` No-op). `voiceControl` waehlt ihn NUR bei
  `config.fakeOriginate` — EIN zentraler Registry-Gate; `server.js` bleibt unangetastet.
- **Boot-Haertung (fail-closed, gegen Prod-Foot-Gun):** `src/boot-guard.js` verweigert den Start,
  wenn `config.fakeOriginate === true` und NICHT gleichzeitig `config.skipTwilioSignatureCheck ===
  true`. In Prod ist die Signaturpruefung fail-closed AN (Regel 1) -> `fakeOriginate` kann dort
  NIE greifen; ein versehentliches `FAKE_ORIGINATE=true` fuehrt in Prod zum Boot-Refusal, nicht zu
  stillem Nicht-Waehlen. Praezedenz: `SKIP_TWILIO_SIGNATURE_CHECK` (Test-Suite nutzt es
  prozessweit). Der Seam ersetzt NUR den Provider-Transport in beweisbar nicht-produktiver
  Umgebung — er ist KEINE abgeschaltete Sicherung; alle Gates (Budget, Denylist, Land-Gate,
  Stundenlimit, Offenlegung, Signaturpruefung) laufen unveraendert.

## 1.3 Verworfene Alternativen (mit Grund)

1. `withStoreLock` NUR um die reine `reserveExceedsBudget`-Query. Verworfen: nichts zu
   serialisieren; behebt NICHTS ohne ein tatsaechlich geschriebenes Reserve-Feld.
2. `reservedCents` als Feld IM Usage-Bucket. Verworfen: bricht die exakten `deepEqual`-Shape-Tests
   (`store-pg.test.js:54`, `store-pg-tenant-budget.test.js:39`) und zwaengt eine pg-Migration. Die
   separate `s.reservations`-Map laesst die Bucket-Shape unveraendert.
3. Reserve persistieren (Disk/pg). Verworfen: erzeugt genau die Orphan-Klasse (Crash zwischen
   Reserve und Settlement). Ephemer + strukturelle Nicht-Serialisierung heilt das automatisch, weil
   ein Neustart in-flight Calls ohnehin toetet (A6) -> 0 ist der korrekte Nach-Boot-Zustand.
4. `load()`-Reset-Zeile fuer json-Ephemeralitaet. Verworfen (Pre-Mortem MAJOR 3): fragil, eine
   Zeile, umgehbar -> stattdessen strukturelle Nicht-Serialisierung in `save()`.
5. Periodischer Sweeper statt/zusaetzlich zum Backstop-Timer. NICHT fuer Launch: der per-Call-Timer
   deckt den BLOCKER-Fall vollstaendig. Sweeper deferiert (nur gegen den seltenen,
   boot-begrenzten Hung-Originate-Rand noetig).
6. Reserve konservativer runden (`ceil+1`). Verworfen (MINOR 4): verschaerft die ohnehin
   konservative Reserve ohne Launch-Notwendigkeit; der ~1-Minutentakt-Slack ist bounded und
   fail-forward.
7. Injektion des Fakes per DI-Argument statt Env. Verworfen: `server.js` importiert `voiceControl`
   beim Boot; Spawn-Tests beeinflussen den Kindprozess nur ueber Env.
8. Harte Max-Concurrent-Calls-Bremse. Verworfen fuer OUT-05: der Reserve-Ledger begrenzt die
   Worst-Case-EUR-Exposition direkt; eine Concurrency-Zahl ist ein anderes, grobkoernigeres
   Feature ohne Geldbezug. Out-of-scope.

## 1.4 Betroffene Absolute Regeln — Nachweis kein Aufweichen

- **Regel 1 (Budget-Guard global UND pro-Tenant, Schnittmenge, fail-closed):** GESTAERKT.
  `budgetExceeded`/`globalBudgetExceeded` (settled) bleiben unveraendert und parallel.
  `reserveExceedsBudget` wird strikt konservativer; `globalReserveExceedsBudget` schliesst die
  reserve-blinde globale Achse; `tryReserveOutboundBudget` prueft BEIDE Achsen mit `||`.
  Fail-closed erweitert: ein Body-Throw beim Reservieren gilt als Denial (402), nie als reserviert.
  Kein Gate entfernt/aufgeweicht.
- **Kein neuer Denial-Vektor gegen zahlende Kunden:** der Backstop-Timer macht die
  Reserve-Lebensdauer strukturell `<= maxDur + Grace` -> keine akkumulierenden Orphans, kein
  per-Tenant- oder plattformweiter Freeze.
- **Max-Gespraechsdauer:** unveraendert (`armMaxDurationTimer` nicht angefasst).
- **`FAKE_ORIGINATE`-Seam:** weicht KEINE Sicherung auf, boot-gehaertet (in Prod unmoeglich).
- **Offenlegung / Auth / Secrets:** nicht beruehrt; Fehler secret-frei geloggt (`err.message`, nie
  `config`).

## 1.5 Test-first-Definition

- **`test/outbound-budget-concurrency.test.js` (Store-Fassade, Temp-`DATA_DIR`, KEIN Spawn):**
  `Promise.all(Array.from({length:5}, () => store.withStoreLock(() => store.tryReserveOutboundBudget(TENANT, 60, cfg))))`
  gegen `maxBudgetEur:1` -> genau EIN `true`, `K-1` `false`; `reservationOf(TENANT) === 60` (nur
  EINE Reserve, nicht K*60); Freigabe -> `reservationOf === 0`, danach reserviert wieder
  erfolgreich; Idempotenz: zweite Freigabe -> `false`, bleibt 0; globale Achse: zwei verschiedene
  Tenants je knapp unter eigenem Cap, Summe > `maxBudgetEur` -> zweite scheitert am globalen Notaus.
  Diskriminierend: LOCK-lose Impl laesst mehr als ein `true` durch -> bleibt rot.
- **`test/outbound-reserve-concurrency-http.test.js` (Spawn, `FAKE_ORIGINATE=true`):** zwei
  gleichzeitige `place_call` (`Promise.all`) gegen engen Cap -> genau EIN `200 dialing`, EIN `402`.
- **`test/outbound-reserve-release-success.test.js` (Spawn):** `place_call` #1 (Fake-Dial, haelt
  Reserve) -> #2 `402` -> `POST /voice/status` `completed` fuer #1 -> #2-Wiederholung `200`.
  Beweist Erfolgs-Freigabe ueber `finishCall`.
- **`test/outbound-reserve-backstop.test.js` (Spawn):** `place_call` #1 mit `max_duration_s="1"` +
  `RESERVE_RELEASE_GRACE_MS="200"` (Fake-Dial) -> #2 `402` -> Callback bewusst NICHT senden ->
  ~1.3 s warten -> #2-Wiederholung `200`. Beweist die von `finishCall` UNABHAENGIGE Freigabe.
- **`test/outbound-reserve-release-error.test.js` (Spawn, ohne Fake):** ein `place_call` (echter,
  werfender Originate) -> 500/502; zweiter identischer -> erneut 500/502 (Reserve auf `catch`-Pfad
  freigegeben).
- **Begleit:** `state-ops`-Unit (Grenzfaelle `>`/`>=` kumulativ, `globalReserveExceedsBudget`,
  Clamp/Idempotenz); json-Ephemeralitaets-Unit (nach `save()` KEIN `reservations`-Key auf Platte,
  `load()` liefert dennoch `reservationOf === 0`). Regression: `outbound-reserve-gate.test.js`
  bleibt unveraendert gruen.

## 1.6 Rollback-Plan

Rein additiv, revert-faehig, kein Schema/keine Migration/keine Datenrueckstaende at rest.
`reservations` lag nie auf Platte (strukturell ausgeschlossen) -> kein stale Key zu bereinigen.
Phase-F2-revert stellt den reinen `reserveExceedsBudget`-Aufruf her (Felder `reserveCents`/
`reserveReleased` an Alt-Records ungenutzt = harmlos); Phase-F1-revert entfernt `reservations` +
Funktionen. Neustart nach Revert startet mit sauberem Budget-Gate.

## 1.7 Pre-Mortem-Restrisiken (akzeptiert, bounded)

- (a) `withStoreLock` schuetzt nur EINEN Prozess (OT-3, Render 1 Instanz) — bestehendes Risiko,
  NICHT neu geschaffen.
- (b) Freigabe braucht die Live-Call-Referenz -> cross-instance blind (OT-3, MINOR 5).
  **Verifikationspunkt fuer die Umsetzung:** bestaetigen, dass KEIN `finishCall`-Caller ein
  DB-rekonstruiertes (nicht in-memory-gespiegeltes) Call-Objekt uebergibt.
- (c) Hung-Originate (Provider-HTTP haengt ewig) laesst eine Reserve bis Boot stehen — selten,
  boot-begrenzt, NICHT der BLOCKER-Fall (der hatte ein 200). Optionaler Sweeper deferiert.
- (d) Ist-Kosten koennen die Reserve um `<= 1 Minutentakt` (Rundung/Hangup-Latenz) uebersteigen —
  bounded, fail-forward (Ist korrekt gebucht), KEIN Overspend-Loch im Sinne des Original-Defekts.
- (e) MINOR 6: kein Netz-`await` je in einen `withStoreLock`-Body — als Invarianten-Kommentar am
  Reserve-Lock in `server.js` festhalten (die HARD-RULE in `store.js:162` nennt nur Re-Entrancy).

---

# 2. PROV-01 — Provisioning-Crash-Recovery

## 2.1 Verifizierte Wurzelanalyse (Datei:Zeile)

- **Queue rein In-Memory, kein Boot-Wiederanlauf:** `src/queue/adapters/memory/queue.js:10-21`
  (`jobs=[]`, `byKey=new Map()`, Closure); `createQueue()` einmal bei Modul-Laden
  (`server.js:115`). `runProvisioningDrain` wird NUR aus zwei Request-Handlern gerufen
  (`server.js:1779` in `POST /api/onboard`, `server.js:1896` in `triggerTenantProvisioning`),
  NIE aus dem Boot-Pfad. `pgboss`-Adapter ist ein fail-closed Stub (deferred).
- **Drain fire-and-forget NACH der Response:** `server.js:1763-1779` (`queueProvisioning(...)` ->
  `res.json(...)` -> `void runProvisioningDrain()`). Crash in diesem Fenster: Nummer bleibt
  `requested`, Job `queued`, nichts weiss beim naechsten Boot davon. `runProvisioningDrain`
  (`server.js:1904-1950`) haelt KEINEN `withStoreLock` um die Schleife; `store.save()` erst NACH
  jedem Job.
- **`already_provisioned` unterscheidet nicht "in Arbeit" vs. "verwaist":**
  `occupiesCapacity(number)` (`state-ops.js:880-886`) zaehlt `requested`/`provisioning`/
  `capturing`/`active` alle als belegt; `tenantHasLiveNumber` (`state-ops.js:894-900`) treibt den
  einzigen Idempotenz-Guard in `requestNumberForPaidTenant` (`billing/provision-trigger.js:16-23`).
  `RETRY_REASON_STATUS` (`server.js:1791-1796`) mappt `already_provisioned` hart auf `409` — der
  Owner-Recovery-Hebel ist fuer genau den Crash-Fall blockiert.
- **Keine Altersinformation:** `requestNumber`/`recordProvisioningJob` legen ohne Zeitstempel an;
  die pg-Spalten `number.created_at`/`provisioning_job.created_at` (`db/schema.sql:254,296`)
  existieren, werden aber NICHT selektiert/gemappt (`pg.js:497-502,533-547`). Staleness ist heute
  nicht mal messbar.
- **Korrektur zur Audit-Annahme:** der historische Telnyx-402-Vorfall (Guthaben < $2) ist NICHT
  PROV-01. `orderNumber` wirft synchron (`telnyx/numbers.js:83-90`), der `catch` in
  `provisionNumber` (`onboarding.js:104-108`) setzt `failed` + gibt den Hold frei; `failed` belegt
  keine Kapazitaet. PROV-01 braucht einen ECHTEN Prozessabbruch zwischen Enqueue und Job-Abschluss.

## 2.2 Fix-Design — Kernumkehr gegenueber dem Erst-Design

Der Ausgangsdefekt ist **geld-neutral** (nichts doppelt gekauft). Das naive Erst-Design (Boot-Sweep
re-drivet ALLE `queued`-Jobs ungegatet) haette echtes Geld doppelt ausgegeben. **Der Boot-Sweep
bleibt der Mechanismus, wird aber von einem blinden Re-Kauf zu einem klassifizierenden Reconciler.**
Er re-drivet AUSSCHLIESSLICH die beweisbar geld-sichere Teilmenge; alles andere wird nur sichtbar
geloggt. Default ist **Observe-Only** (`maxAge=0` -> kein Auto-Kauf), damit der Sweep in Prod erst
dunkel validiert und dann scharfgeschaltet wird.

Vier im Code verifizierte Befunde, die das Design tragen:
1. `store.save()` NUR am Job-Ende -> normaler Crash zeigt `requested`. ABER ein Fremd-`save()`
   eines parallelen Requests persistiert den In-Flight-Zustand `provisioning`/`capturing` +
   `paymentIntentId` -> die Detektion darf sich NICHT allein auf `requested` verlassen.
2. Ein `provisioningJobs`-Record existiert NUR bei echtem enqueue (Dry-Run kehrt vorher zurueck)
   -> die `queued`-Job-Spur diskriminiert Dry-Run-`requested` (kein Job) von Crash-`requested`.
3. Re-Drive derselben `numberId` ist idempotent NUR innerhalb der Anbieter-Fenster:
   `orderNumber` Key `order_${numberId}` (Telnyx-Idempotenz **live UNBESTAETIGT**,
   `telnyx/numbers.js:6-9`), `placeHold` Key `hold_${numberId}` (Stripe verfaellt nach 24h). Ein
   Re-Drive ausserhalb -> Doppelkauf.
4. `captureHold` hat KEINEN Idempotency-Key (verifiziert: `stripe.js:87-94` sendet keinen Header,
   im Gegensatz zu `placeHold` `stripe.js:66-67`). Ein zweiter Capture -> Stripe-Fehler ->
   `rollbackAfterOrder` -> `releaseNumber` gibt eine real bezahlte Nummer frei.

### Bausteine

**F4-Datenschicht — `createdAt` + reiner Klassifikator:**

- `recordProvisioningJob` (`state-ops.js`) setzt `createdAt: new Date().toISOString()`
  (application-time, EINE Quelle fuer beide Backends). pg: `flushProvisioningJobs` nimmt
  `created_at` in den INSERT (Spalte existiert, `schema.sql:296`, application-provided statt
  DB-Default gegen Skew); `hydrateProvisioningJobs` selektiert + mappt `createdAt` (TIMESTAMPTZ ->
  ISO). Legacy-Records ohne `createdAt`: Alter unbekannt -> fail-closed als "zu alt" behandelt
  (surfacen, nicht auto-re-driven).
- `classifyQueuedProvisioningJobs(s, { nowMs, maxAgeMs, kycMinLevel })` (rein, IO-frei,
  backend-agnostisch) triagiert alle `QUEUED`-Jobs in drei disjunkte Koerbe:
  - `close`: Nummer fehlt oder terminal/aktiv (`ACTIVE`/`FAILED`/`RELEASED`/`SUSPENDED`) -> Job
    schliessen, KEIN Kauf.
  - `hold`: (i) Nummer nicht `REQUESTED` (mid-flight `provisioning`/`capturing`) -> reason
    `mid_flight_*` (BEFUND 4); (ii) `!tenantActiveSubscriber(s, tenantId, kycMinLevel)` -> reason
    `no_active_subscriber` (BEFUND 3); (iii) Alter unbekannt oder `> maxAgeMs` -> reason
    `unknown_age`/`too_old` (BEFUND 1). -> Owner-Reconcile-Runbook, KEIN Auto-Kauf.
  - `redrive`: `REQUESTED` + aktiver KYC-Subscriber + jung -> geld-sicher automatisch nachfuehrbar.
  `maxAgeMs === 0` -> jeder `requested`-Job faellt in `hold` (Observe-Only).
- Neue Config `provisioningRedriveMaxAgeMs` (Env `PROVISIONING_REDRIVE_MAX_AGE_MS`, Default `0` =
  Observe-Only, fail-closed), `.env.example` mit Rationale (muss KLEINER als das kleinste
  Anbieter-Idempotenz-Fenster bleiben; Stripe = 24h; scharf empfohlen `3600000` = 1h),
  `BASE_ENV` `"0"`, `render.yaml` pruefen.

**F3 — Single-Flight um den Drain (`server.js`):** eigener drain-spezifischer In-Process-Mutex
(Promise-Ketten-Technik wie `withStoreLock`, aber getrennt, weil `withStoreLock` mit dem langen
Provider-`await` + Per-Job-`save()` ungeeignet ist):

```
let _drainChain = Promise.resolve();
function runProvisioningDrainExclusive() {
  _drainChain = _drainChain.then(runProvisioningDrain, runProvisioningDrain);
  return _drainChain;
}
```

ALLE Aufrufer (`server.js:1779`, `1896`) + der Boot-Sweep rufen ab jetzt
`void runProvisioningDrainExclusive()`. Prozessweit laeuft nur EIN Drain; schliesst den latenten
Bestands-Doppel-Drain (Pre-Mortem BEFUND 5a) — strikte Verbesserung auch fuer den Bestand.

**F5 — Boot-Sweep-Reconciler (`server.js`):**

```
function redriveProvisioningJobs(jobs) {
  for (const j of jobs)
    provisioningQueue.enqueue({
      kind: PROVISION_NUMBER_JOB, payload: { numberId: j.numberId }, idempotencyKey: j.idempotencyKey,
    });
  if (jobs.length) void runProvisioningDrainExclusive();
}

function reconcileOrphanedProvisioning() {
  if (!config.provisioningEnabled) return; // fail-closed: Dry-Run kauft nichts nach
  const buckets = classifyQueuedProvisioningJobs(store.load(), {
    nowMs: Date.now(), maxAgeMs: config.provisioningRedriveMaxAgeMs, kycMinLevel: KYC_OUTBOUND_MIN,
  });
  if (buckets.close.length) {
    void store.withStoreLock(() => {
      const s = store.load();
      for (const j of buckets.close) markProvisioningJob(s, j.id, PROVISIONING_JOB_STATUS.DONE);
      store.save();
    });
  }
  for (const { job, reason } of buckets.hold) // PII-/Secret-frei (nur interne IDs)
    console.warn(`[provision-reconcile] hold job=${job.id} number=${job.numberId} tenant=${job.tenantId} grund=${reason}`);
  redriveProvisioningJobs(buckets.redrive);
}
```

Aufruf EINMAL im `app.listen`-Callback (`server.js` ~2076), NACH den Boot-Logs, fire-and-forget
(`void reconcileOrphanedProvisioning()`) — blockiert weder `listen` noch Healthcheck. Der
Boot-Guard `hasActiveNumber` laeuft weiter davor. `mark done` NUR fuer `close` (aktiv/terminal), NIE
fuer mid-flight -> die Recovery-Tuer bleibt offen (schliesst BEFUND 4, kein Brick).

**F6 — `captureHold` idempotenz-sicher (`billing/stripe.js`):** den Stripe-Fehler "PaymentIntent
bereits captured" (`payment_intent_unexpected_state`, PI-Status `succeeded`) als **Erfolg**
behandeln statt als Fehler. Praezise Diskriminierung (nur "already captured", NICHT jeden
Stripe-Fehler schlucken). **Pflicht, sobald PAYMENT_ENABLED live ist** (nicht optional) — sonst
release-t ein Concurrent-/Re-Drive-Capture eine real bezahlte Nummer.

**F7 — Retry-Lever entsperren (`billing/provision-trigger.js` + `server.js`):** neue reine
Entscheidung `resolveProvisionRetry(s, opts)` neben `requestNumberForPaidTenant`:

```
export function resolveProvisionRetry(s, opts) {
  const stuck = s.numbers.find(
    (n) => n.tenantId === opts.tenantId && n.status === NUMBER_STATUS.REQUESTED &&
      s.provisioningJobs.some((j) => j.numberId === n.id && j.status === PROVISIONING_JOB_STATUS.QUEUED),
  );
  if (stuck) {
    const job = s.provisioningJobs.find(
      (j) => j.numberId === stuck.id && j.status === PROVISIONING_JOB_STATUS.QUEUED);
    const ageMs = opts.nowMs - Date.parse(job.createdAt ?? "");
    if (!job.createdAt || Number.isNaN(ageMs) || ageMs > opts.maxAgeMs)
      return { ok: false, reason: "needs_manual_reconcile" };
    return { ok: true, reason: "redrive", numberId: stuck.id, jobId: job.id };
  }
  return requestNumberForPaidTenant(s, opts); // unveraendert
}
```

`triggerTenantProvisioning` ruft `resolveProvisionRetry` (mit `nowMs`+`maxAgeMs`). Bei
`reason === "redrive"`: NICHT `queueProvisioning` (das legt eine NEUE Nummer/Job an), sondern
`redriveProvisioningJobs([<stuck-Job>])`. `needs_manual_reconcile` -> neuer Eintrag in
`RETRY_REASON_STATUS` (409 mit Runbook-Hinweis). Das Abo/KYC-Gate der Route (`server.js:1805`,
`tenantActiveSubscriber(tenantId, KYC_OUTBOUND_MIN)`) bleibt UNVERAENDERT VOR dem Trigger. Aktiv ->
weiter 409; terminal `failed` -> weiter neue Nummer (Bestandsschutz).

## 2.3 Verworfene / aufgeschobene Alternativen (mit Grund)

- **A) Erst-Design: unbegrenzter Auto-Re-Drive aller `queued`-Jobs.** Verworfen (Pre-Mortem
  BLOCKER 1/3, MAJOR 4/5): alters-, gate- und concurrency-blind -> Doppelkauf, Brick,
  Gate-Umgehung.
- **B) Stale `requested` -> `failed` + neue Nummer.** Verworfen: neue `numberId` -> neue
  Idempotenz-Keys -> echter Doppelkauf + verwaister erster Kauf (Money-Leck).
- **C) Durable Queue via `QUEUE_BACKEND=pgboss`.** Verworfen fuer Launch: bewusster fail-closed
  Stub (deferred), neue Dependency + LISTEN/NOTIFY (unter pglite ungetestet), hilft dem
  json-Default nicht. Die Job-Spur IST bereits durabel — es fehlt nur das klassifizierende
  Wiedereinreihen beim Boot.
- **D) Verify-before-buy (Provider-Abfrage vor Re-Order).** NICHT verworfen, **aufgeschoben als
  robusteste Loesung / Owner-Option** (Frage 6.2). Sicher auch bei ABGELAUFENER Idempotenz, aber
  groessere Provider-Integration (async-pending Orders, Metadata-Matching, unverifizierte
  Telnyx-Query-Semantik). Zeigt der Idempotenz-Smoke, dass Telnyx den Key NICHT honoriert, wird D
  zur Pflicht statt des Alters-Fensters.
- **E) Periodischer Cron-Reconciler.** Verworfen: Render Free hat kein Cron/Jobs. Boot-Sweep nutzt
  das vorhandene Boot-Signal.

## 2.4 Betroffene Absolute Regeln — Nachweis kein Aufweichen

- **Regel 1 (kein Doppelkauf mit echtem Geld):** GESTAERKT. Der Sweep kauft NIE eine neue Nummer;
  er re-drivet die bestehende `numberId` NUR innerhalb des Idempotenz-Fensters (Alters-Gate) UND
  NUR fuer einen weiterhin aktiven, KYC-verifizierten Subscriber (identisch zur Retry-Route).
  `captureHold`-Idempotenz schuetzt zusaetzlich die bezahlte Nummer. `MAX_NUMBERS`/
  `maxNumbersPerTenant` bleiben unberuehrt (Blast-Radius-Deckel). Budget-Schnittmenge unangetastet
  (PROV-01 liegt vor jedem Anruf).
- **Regel 1 (Stripe-Hold-Storno):** verbessert. Innerhalb des Fensters holt der Re-Drive die
  verlorene `paymentIntentId` ueber den idempotenten `placeHold` (gleicher Key) zurueck; ausserhalb
  -> `hold` -> Owner-Reconcile (kein neuer verwaister Hold durch Auto-Kauf).
- **Regel 3 (Auth fail-closed):** kein neuer Endpunkt. Boot-Sweep prozess-intern.
  `POST /api/onboard/retry` behaelt Owner-/localhost-Gate + Subscriber-Gate (F7 aendert nur die
  interne Entscheidung).
- **Regel 4 (Secrets):** Sweep-/Reconcile-Logs nennen NUR interne IDs (`job`/`number`/`tenant`/
  `grund`), nie e164/PaymentIntent/Key.
- **Regel 6 (Scope):** nur PROV-01, kein Spekulativ-UI; die eine Env-Var ist der Sicherheits-Regler.
- Disclosure / Max-Dauer / Signaturpruefung: nicht beruehrt.

## 2.5 Test-first-Definition

- **F3 `test/prov01-drain-singleflight.test.js` (kein Spawn):** Fake-Provisioner mit verzoegertem
  `orderNumber` + Zaehler pro `numberId`. Zwei parallele `runProvisioningDrainExclusive()` ->
  `orderNumber` genau EINMAL pro `numberId` (ohne Guard: zwei).
- **F4 `test/prov01-classify.test.js` (kein Spawn/pglite):** acht Faelle — (i) requested+queued+
  aktiv+jung -> `redrive`; (ii) requested+alt -> `hold:too_old`; (iii) requested+`createdAt` fehlt
  -> `hold:unknown_age`; (iv) requested+suspended -> `hold:no_active_subscriber`; (v)
  provisioning/capturing -> `hold:mid_flight_*`; (vi) Nummer active/failed/fehlt -> `close`; (vii)
  done/failed-Job -> ignoriert; (viii) `maxAgeMs=0` -> jeder requested -> `hold`.
- **F4 `test/prov01-createdat.test.js`:** `recordProvisioningJob` setzt `createdAt` (ISO);
  optionaler pglite-Roundtrip (flush->hydrate) erhaelt es (EIGENE Datei, nie mit Spawn mischen).
- **F5 `test/prov01-boot-reconcile.test.js` (Spawn + idempotenz-bewusster Telnyx-Mock,
  `PAYMENT_ENABLED=true`, EIGENE Datei):** der Mock dedupliziert nach `Idempotency-Key` und
  modelliert eine BEREITS existierende Order (geseedete Vor-Order). Seed: aktiver Owner-Nummer,
  Tenant `t_user1` (active, kyc>=CARD, Stripe-Karte), Nummer `{status:"requested",
  provider:"telnyx", country:"DE"}` + `provisioningJobs:[{status:"queued", createdAt:<jetzt>,
  idempotencyKey:"provision_num_x"}]`, `PROVISIONING_REDRIVE_MAX_AGE_MS:"3600000"`. Prueft
  (Money-Safety): pollt bis `num_x.status==="active"`; Mock verzeichnet fuer `order_num_x` GENAU
  EINE effektive Order, Stripe-Fake GENAU EINEN captured PI. Zusatzlauf `maxAge=0` (Observe-Only)
  -> bleibt `requested`, `hold`-Log, kein Kauf. Zusatzlauf `createdAt` alt -> `hold`. Dry-Run
  (`PROVISIONING_ENABLED:"false"`) -> `requested`, kein Call.
- **F6 `test/prov01-capture-idempotent.test.js` (kein Spawn):** Fake-Billing, dessen `captureHold`
  beim ZWEITEN Aufruf den "already captured"-Fehler wirft; `provisionNumber` zweimal auf derselben
  `numberId` -> zweiter Lauf endet in `active` (NICHT `released`).
- **F7 `test/prov01-retry-redrive.test.js` (kein Spawn, Decision-Core):** junger stuck ->
  `redrive`+numberId+jobId; alter stuck -> `needs_manual_reconcile`; aktiv ->
  `already_provisioned`; terminal `failed` -> neue `requested`-Nummer. Bestandstest
  `p2-onboard-retry.test.js` bleibt gruen (aktiv -> 409).

## 2.6 Rollback-Plan

Additiver Code + EIN neues Feld `createdAt` am Job + EINE neue Env-Var. KEINE Schema-Migration
(pg-Spalte `created_at` existiert). `git revert` der Phasen entfernt alles; `createdAt` an
Job-Records ist ein ignoriertes Zusatzfeld. **Zwei Laufzeit-Kill-Switches OHNE Code-Revert:**
(a) `PROVISIONING_ENABLED=false` -> Sweep No-op; (b) `PROVISIONING_REDRIVE_MAX_AGE_MS=0` ->
Observe-Only. `close`-Jobs auf `done` sind regulaere terminale Endzustaende.

## 2.7 Pre-Mortem-Restrisiken (akzeptiert)

- **5b Multi-Instance-Sweep (>1 Instanz):** Launch laeuft Single-Instance (Render Free, 1
  Instanz). Der Sweep ist unter Single-Instance sicher. **HARTER Gate vor Multi-Instance:** ein
  pg-`pg_advisory_lock` pro `numberId` (bzw. globaler Sweep-Lock) MUSS vor Skalierung auf >1
  Instanz kommen (PLAN-SECURITY-Eintrag, Owner-Frage 6.6).
- **7 Cap-Re-Validierung:** der Re-Drive verbraucht KEINE neue Kapazitaet (dieselbe `numberId`);
  eine seither verschaerfte `MAX_NUMBERS`-Bremse wird fuer die bestehende Nummer nicht neu geprueft
  — vertretbar, kein Netto-Neuverbrauch, `MAX_NUMBERS` deckelt den Gesamtbestand.
- **runProvisioningDrain haelt keinen `withStoreLock` ueber die Schleife** (pre-existierend); der
  Single-Flight-Guard schliesst den Doppel-Drain, der Whole-Mirror-Flush-Race bleibt an das
  Single-Instance-Gate gekoppelt.
- **BLOCKER 2 (Telnyx-Idempotenz live UNBESTAETIGT):** harter Launch-Gate — Scharfschaltung
  (`maxAge>0`) mit `PAYMENT_ENABLED` erst NACH gruenem Owner-Smoke (Owner-Frage 6.2). Bis dahin
  Observe-Only.

---

# 3. DEPLOY-04 / A6 — Deploy toetet laufende Calls

## 3.1 Verifizierte Wurzelanalyse (Datei:Zeile)

Zwei unabhaengige Bruch-Mechanismen plus drei Pre-Mortem-Korrekturen.

- **Kein `SIGTERM`/`SIGINT`-Handler:** verifiziert `grep -rn "SIGTERM\|SIGINT" src/` -> 0 Treffer.
  `src/process-guards.js` installiert nur `unhandledRejection`/`uncaughtException`, bewusst OHNE
  `process.exit`/Graceful-Shutdown. Ein Deploy-Kill mid-Turn laesst den naechsten Gather-Webhook
  ohne TwiML/TeXML-Antwort -> Provider beendet den Leg, unabhaengig vom State.
- **Reconcile-Flush loescht DB-Zeilen bei divergierenden Mirrors:** `src/store/pg.js` haelt pro
  Prozess einen bei `init()` einmalig hydrierten Spiegel; `flushCalls` (`pg.js:865-871`) ruft
  `deleteMissing` -> `deleteMissingByText` (`pg.js:1142-1157`): `DELETE FROM call WHERE
  tenant_id=$1 AND id <> ALL($2)`. Jede DB-Zeile, die der flushende Prozess NICHT im Spiegel hat,
  wird geloescht. Betrifft identisch `action_item`, `calendar_event`, `notification`, `number`,
  `provisioning_job`, `usage_event` (alle `deleteMissing`).
- **Fail-closed Hangup bei unbekanntem Call, real beobachtet:** `/voice/turn`
  (`server.js:917-930`, Live-Vorfall `call_mr3lg2g7t9zg`, 2026-07-02), `/voice/outbound`
  gleiches Muster; `/voice/status` (`server.js:1139-1142`) stiller No-op ohne Log -> ein
  Call-Ende-Signal fuer eine geloeschte Zeile geht spurlos verloren.
- **Max-Dauer-Timer ist reiner Prozess-State:** `armMaxDurationTimer` (`server.js:838-849`)
  `setTimeout` im Speicher, wird beim Boot NIE fuer laufende Calls neu armiert. Fuer Telnyx ist er
  laut Kommentar der EINZIGE harte Max-Dauer-Cap (TimeLimit unbestaetigt); Twilio hat zusaetzlich
  `timeLimit` provider-seitig.

Pre-Mortem-Korrekturen:
- **K1 (reale Budget-Richtung ist UNTER-Zaehlung):** `budgetExceeded`/`globalBudgetExceeded`/
  `reserveExceedsBudget` lesen NUR die usage-Map, gefuellt NUR ueber `finishCall` ->
  `reconcileOutboundVoiceBudget` -> `addVoiceUsageCostCents`. Ein aktiver Call hat NULL
  Budget-Effekt bis `finishCall`. Wer einen aktiven Call beendet OHNE `finishCall`, bucht die
  Minuten NIE -> der Budget-Deckel sieht zu wenig Spend (die gefaehrliche Richtung).
- **K2 (`endCallRecord` rechnet NICHT ab):** `endCallRecord` (`state-ops.js:273`) setzt nur
  `status`/`endedAt=new Date()`. Der im Erst-Design vorgesehene `endCallRecord(id,"failed")` fuer
  Zombies terminalisiert OHNE Bucht (Unter-Zaehlung) UND setzt `endedAt=Boot-Zeit` (ein spaeterer
  `/voice/status` inflationiert `voiceMinutesOf` auf den Boot-Abstand).
- **K3 (`pruneOldData` schuetzt aktive Calls bereits):** `keepCall = c.status==="active" || ...`
  (`state-ops.js:1278`) -> Phantom-aktive Zeilen muessen aktiv (Timer/Sweep) aufgeloest werden,
  nicht ueber Retention.

## 3.2 Fix-Design

Sechs Bausteine, verteilt auf fuenf Phasen (F8-F12).

**1.1 (F8) Reconcile-Schutz — aktive Call-Zeilen nie loeschen (`pg.js` `flushCalls`):** das
generische `deleteMissing` (8 Tabellen, andere Status-Semantik) bleibt UNVERAENDERT. Neue lokale
`deleteMissingCallsKeepActive(client, tenantId, keepIds)`: prunt Retention-Zeilen wie bisher,
schuetzt aber jede DB-Zeile mit `status='active'`, die der Spiegel nicht kennt
(`... AND status<>'active' AND id <> ALL($2)`). Der eigene aktive Call steht in `keepIds` (Upsert);
geschuetzt werden nur FREMDE aktive Zeilen. Magic-String `'active'` -> benannte Konstante
`CALL_STATUS_ACTIVE`.

**1.2 (F9) Pure Rechenlogik (`state-ops.js`, config-frei, arg-injiziert):**
- `remainingMaxDurationMs(call, nowMs, defaultMaxDurationS)`:
  `Math.max(0, limit - (nowMs - Date.parse(call.answeredAt ?? call.startedAt)))`. Anker ist der
  ECHTE Call-Start (`answeredAt` bevorzugt), NICHT der Boot-Zeitpunkt; fehlt beides -> `0`.
- `cappedEndedAtMs(call, nowMs, defaultMaxDurationS)`:
  `Math.min(nowMs, Date.parse(call.answeredAt ?? call.startedAt) + limit)`. Deterministischer
  Ende-Zeitpunkt fuer JEDE Timer-/Re-Arm-Terminalisierung; fuer einen Zombie liefert er
  `anchor+limit` (nie Boot-Abstand), fuer eine Live-Cap ~`now`.

**1.3 (F9) Billing-Idempotenz — persistierter `billedAt`-Marker (Muster `summarySmsSentAt`):**
`finishCall` bucht die Voice-Minuten genau EINMAL, egal ueber wie viele Restarts/Retries das
Call-Ende getriggert wird.
- Neue Spalte `call.billed_at TEXT` in `src/db/schema.sql` per `ALTER TABLE call ADD COLUMN IF NOT
  EXISTS billed_at TEXT;` (idempotent, nullable, KEIN Backfill, NULL = "noch nicht gebucht").
- `rowToCall` hydriert `billedAt: r.billed_at ?? null`; `flushCalls`-INSERT + `ON CONFLICT DO
  UPDATE` fuehren `billed_at` mit; `createCall`/`emptyCall` init `billedAt: null` (json-Parity).
- Neue reine State-Op `markBilled(s, callId)` (idempotent, setzt nur wenn leer). Fassade in
  `pg.js`/`json.js`/`store.js`.
- `finishCall` (`server.js:1055`) — der Abrechnungsblock wird um den persistierten Guard gelegt
  (nur der Abrechnungsblock; Summary/Notification bleiben retry-bar, SMS bleibt ueber
  `summarySmsSentAt` idempotent):

```
async function finishCall(call) {
  if (!call || call._finished) return;
  call._finished = true;
  if (!call.billedAt) {                          // persistierter, prozessuebergreifender Guard
    if (config.paymentEnabled) recordVoiceMinuteMeter(call);
    reconcileOutboundVoiceBudget(call);
    store.markBilled(call.id);                    // -> billed_at, ueberlebt Restart
  }
  store.save();
  ... (Summary/Notification/SMS unveraendert) ...
}
```

> **Merge-Auflage (kette-uebergreifend):** Wird OUT-05 (F1/F2) VOR A6 gemergt (empfohlene
> Reihenfolge), enthaelt `finishCall` bereits `await releaseReserve(call)` (OUT-05, 1.2). Der
> `billedAt`-Guard von F9 wird um den ABRECHNUNGSBLOCK gelegt; `releaseReserve` bleibt
> UNVERAENDERT erhalten (die Reserve wird bei jedem Call-Ende freigegeben, unabhaengig vom
> Bucht-Guard). F9 darf den OUT-05-`releaseReserve`-Aufruf NICHT entfernen oder in den
> `!billedAt`-Zweig ziehen.

**1.4 (F10) Timer-Unifikation + Boot-Re-Arm (`server.js`):** ein einziger
Terminalisierungspfad — kein zweiter Bucht-freier Weg.
- `scheduleMaxDurationEnd(call, providerCallSid, ms)` (ersetzt die Timer-Logik von
  `armMaxDurationTimer`): beim Feuern (1) `if (store.getCall(call.id)?.status !== "active") return`;
  (2) `store.setCallEndedAt(id, "completed", cappedEndedAtMs(...)-ISO)`; (3)
  `finishCall(store.getCall(id))` (bucht idempotent via 1.3); (4) best-effort
  `voiceControl(provider).endCall(sid).catch(()=>{})`. Hinterlaesst NIE eine Phantom-aktive Zeile
  und rechnet immer ab.
- Neue State-Op `setCallEndedAt(s, callId, status, endedAtIso)` (nur wenn `status==='active'`,
  idempotent, Muster `endCallRecord` aber mit EXPLIZITEM Anker). `endCallRecord` (now-basiert)
  bleibt fuer Live-Pfade (cancel/`/voice/status`) unveraendert.
- `armMaxDurationTimer` wird duenner Wrapper: `scheduleMaxDurationEnd(call, sid, (call.maxDurationS
  || config.maxCallDurationS) * 1000)`. Alle Aufrufer byte-identisch verdrahtet.
- `rearmActiveCallTimers()` als Boot-Schritt NACH `store.load()` (neben `runRetention`), nur wenn
  `config.voiceEngine !== "realtime"`: iteriert `store.load().calls.filter(c => c.status ===
  "active")`. `remaining > 0` -> `scheduleMaxDurationEnd(call, call.twilioSid, remaining)` (Timer
  relativ zum ECHTEN Start); `remaining <= 0` (Zombie) -> SOFORT ueber den Abrechnungspfad:
  `setCallEndedAt(id, "failed", cappedEndedAtMs(...)-ISO)` + `finishCall` + best-effort `endCall`.

**1.5 (F11) Graceful Shutdown — Flush-Drain mit KORREKTEM Ordering (`server.js`):**

```
async function gracefulShutdown(signal) {
  if (shuttingDown) return; shuttingDown = true;
  const watchdog = setTimeout(() => process.exit(0), config.shutdownDrainTimeoutMs).unref();
  await new Promise((resolve) => httpServer.close(resolve));  // in-flight fertig, DARAUF WARTEN
  if (typeof httpServer.closeIdleConnections === "function") httpServer.closeIdleConnections();
  await store.save();                                          // ERST JETZT finaler Drain
  clearTimeout(watchdog);
  process.exit(0);
}
```

Registriert via `process.once("SIGTERM", ...)` + `process.once("SIGINT", ...)` (idempotent) +
`shuttingDown`-Flag als Wiedereintritts-Schutz. Der ENTSCHEIDENDE Punkt (Pre-Mortem BEFUND 2):
`store.save()` ERST nach dem AWAIT auf `httpServer.close()` -> KEIN `/voice/turn`-Handler kann NACH
dem Drain noch eine Mutation anhaengen. Watchdog kappt einen haengenden Drain hart. Neue Config
`SHUTDOWN_DRAIN_TIMEOUT_MS` (Fallback 8000, via `numEnv` min/max) + `.env.example` + `render.yaml` +
`BASE_ENV`.

**1.6 (F12) Webhook-Re-Attach (unbekannter, aber aktiver Call) — inkl. `/voice/status`:** neue
Store-Methode `attachActiveCall(callId)`.
- **pg (RLS-sauber):** `call` ist `FORCE ROW LEVEL SECURITY` mit
  `USING (tenant_id = current_setting('app.current_tenant', true))` (`schema.sql:409-412`). Ueber
  die hydrierten `state.tenants` iterieren, pro Tenant `setTenant(client, tenant.id)` +
  `SELECT ... FROM call WHERE id=$1 AND status='active'`. Erster Treffer: Call ueber `rowToCall`
  (+ Transkript/ActionItems) idempotent in den Spiegel pushen (Race-Guard: unmittelbar vor `push`
  erneut `ops.getCall` pruefen, Muster `ensureTenant`), zurueckgeben; sonst `null`.
- **json:** `attachActiveCall = getCall` (Single-Prozess, keine Divergenz); unbekannte id ->
  `null`. Byte-identisch zum Bestand.
- Verdrahtung an DREI Stellen (attach-then-classify, Pre-Mortem BEFUND 3b + 5):
  - `/voice/turn` (919) und `/voice/outbound` (972): der `if (!call || call.status !== "active")`-
    Zweig ruft ZUERST `store.attachActiveCall(callId)`. Treffer -> `remaining =
    remainingMaxDurationMs(...)`: `remaining <= 0` -> NICHT fortfuehren (kein `agentTurn`, keine
    LLM-Kosten), terminalisieren + `finishCall` + best-effort `endCall` -> Hangup; `remaining > 0`
    -> `scheduleMaxDurationEnd` (Einzel-Rearm) + normal fortfahren. `null` -> bestehender
    fail-closed Hangup + Warn-Log UNVERAENDERT.
  - `/voice/status` (1141): `getCall(...)` `null` -> ZUERST `attachActiveCall(...)`; Treffer -> der
    bestehende Lifecycle-Zweig (markAnswered / endCallRecord+finishCall) rettet das Call-Ende-Signal
    einer nicht-gespiegelten Zeile; kein Treffer -> bestehender stiller Return.
- Signatur gewahrt: `app.use("/voice", ...)` (`server.js:455-465`) prueft die Provider-Signatur
  fail-closed VOR jedem Handler. Re-Attach sitzt strukturell HINTER der Signatur und vertraut
  ausschliesslich DB-bestaetigten Zeilen, NIE dem Request-Body.

**Was der Code-Fix NICHT loesen kann:** das Boot-Gap auf Render Free (waehrend der neue Prozess
bootet, antwortet keine Instanz; ein in dieses Fenster fallender Turn-POST bekommt
Connection-Refused). Infra-Grenze (Owner-Frage 6.1), kein Store-Bug.

## 3.3 Verworfene Alternativen (mit Grund)

- **Alt 1 — generisches `deleteMissing` global "aktive Zeilen schuetzen".** Verworfen:
  `status='active'` hat nur bei `call` die Semantik "laufendes Gespraech"; bei `number` bedeutet
  ACTIVE eine aktive DID. Genereller Schutz verhinderte legitimes Prunen. Gezielte call-lokale
  Funktion ist die kleinste korrekte Aenderung.
- **Alt 2 — Zombie ueber `endCallRecord(id,"failed")` beenden.** Verworfen nach Pre-Mortem BEFUND
  1: rechnet NICHT ab (Unter-Zaehlung, Regel-1-Aufweichung) und setzt `endedAt=Boot`. Ersetzt durch
  den `finishCall`-Pfad mit gekapptem `endedAt` + Idempotenz-Marker.
- **Alt 3 — `httpServer.close()` nicht awaiten, direkt drainen.** Verworfen nach BEFUND 2: ohne
  AWAIT kann ein in-flight `/voice/turn` NACH dem Drain noch eine Mutation anhaengen (Fakt C bleibt
  offen).
- **Alt 4 — kein Billing-Idempotenz-Marker, nur `_finished` (In-Memory).** Verworfen:
  `_finished` ueberlebt keinen Restart; ein verspaeteter `/voice/status`-completed nach Restart
  bucht doppelt (additive, persistierte usage-Map). Der Boot-Re-Arm macht Restart-Zyklen auf Free
  HAEUFIG. Persistierter `billedAt` ist der kleinstmoegliche Idempotenz-Weg.
- **Alt 5 — voller Multi-Prozess-Korrektheits-Umbau (row-level Versionierung / optimistic
  concurrency / kein Full-Mirror-Flush).** Verworfen: grosser Store-Umbau, im Repo explizit als
  spaeterer Scope deferiert (`pg.js:14-17`). BDUF-Verstoss.
- **Alt 6 — Re-Attach ueber RLS-Bypass-Read.** Verworfen: `call` ist `FORCE ROW LEVEL SECURITY`;
  ein Bypass unterliefe die Tenant-Isolation (Regel 3) und braeuchte eine zweite DB-Rolle — neue
  Sicherungs-Abschaltung, hart verboten. Der Tenant-Loop ueber den hydrierten Spiegel ist
  RLS-konform.
- **Alt 7 — DB-weiter Cross-Tenant Active-Call-Reconciler beim Boot/periodisch, JETZT.** Fuer den
  Free-Launch verworfen: schliesst ein Loch fuer eine Zeile, die weder im Spiegel steht NOCH je
  einen Folge-Webhook sendet — auf Render Free (single-instance, kein Overlap) STRUKTURELL nicht
  existent. Als Pflicht-Gate fuer den paid/zero-downtime-Umstieg dokumentiert (Restrisiko R-8.3).

## 3.4 Betroffene Absolute Regeln — Nachweis kein Aufweichen

- **Regel 1 — Max-Gespraechsdauer.** GESTAERKT: Timer-Re-Arm (F10) stellt den harten Cap nach jedem
  Restart wieder her, verankert am ECHTEN Call-Start; Zombies werden aktiv beendet; der Cap-Timer
  terminalisiert jetzt IMMER (kein Phantom-active). Volle-Limit-Armierung bleibt der Erstfall.
- **Regel 1 — Budget-Guard (Schnittmenge).** GESTAERKT statt beruehrt: jedes Call-Ende — auch
  Timer-Ablauf und Boot-Re-Arm — laeuft ueber die EINE Abrechnungsquelle `finishCall` (K1+K2). Der
  gekappte `endedAt`-Anker verhindert Boot-Zeit-Inflation; der persistierte `billedAt`-Marker
  garantiert "genau einmal gebucht" ueber Prozessgrenzen. Keine Budget-LOGIK geaendert — nur die
  Vollstaendigkeit der Ledger-Buchung gehaertet.
- **Regel 1 — Provider-Signaturpruefung (fail-closed).** Unberuehrt und tragend: Re-Attach (F12)
  sitzt HINTER `app.use("/voice")`.
- **Regel 2 — Offenlegungssatz.** Unberuehrt: Re-Attach setzt ein bestehendes Gespraech fort
  (Disclosure lief beim Call-Start); ein Ueber-Zeit-Leg wird NICHT fortgefuehrt (kein `agentTurn`),
  kein neuer Outbound.
- **Regel 3 — Auth fail-closed / Tenant-Scope.** Gewahrt: Re-Attach fortfuehrt NUR bei einer
  DB-bestaetigten `status='active'`-Zeile (RLS-scoped, GUC pro Tenant); unbekannte/fremde/
  gefaelschte callId -> `null` -> bestehender Hangup. Kein Request-Body-Vertrauen, kein
  Cross-Tenant-Zugriff.
- **Regel 4 — Secrets.** Kein Secret in neuen Logs; callId ist server-generiert, kein PII.

## 3.5 Test-first-Definition

- **T1 `test/store-pg-reconcile-active-call.test.js` (pglite, F8):** `store2.init()` (leer),
  `store1` auf DERSELBEN DB; `store1` erstellt Call + `markAnswered` + `await store1.save()` ->
  aktive Zeile in DB, nicht in `store2`s Spiegel; `store2` fuehrt beliebige Mutation + `save()`;
  Prueft: `SELECT id,status FROM call WHERE id=$1` liefert die Zeile weiter (aktiv). VOR Fix rot.
- **T2 `test/max-duration-pure.test.js` (Unit, F9):** `remainingMaxDurationMs` (a) answeredAt vor
  60 s, max 180 -> ~120000; (b) vor 400 s -> `0`; (c) `maxDurationS=null` -> Fallback; (d)
  answeredAt null, startedAt gesetzt -> Anker startedAt. `cappedEndedAtMs` (e) Zombie ->
  `anchor+limit`; (f) Live-Cap -> ~now; (g) `min` waehlt die fruehere Grenze.
- **T3 `test/store-pg-billing-idempotent.test.js` (pglite, F9):** `markBilled` idempotent (zweiter
  Aufruf `changed=false`), `billedAt` persistiert + hydriert (`store2` sieht es gesetzt).
- **T3b `test/finishcall-billing-once.test.js` (Spawn, F9):** outbound Call beendet
  (`/voice/status` completed), `usageFor` zeigt Delta X; Restart-Kante ueber zweiten
  `/voice/status`-completed fuer denselben terminalen Call (frisches `_finished` via Prozess-Neustart
  auf DERSELBEN DATA_DIR) -> `usageFor` bleibt X (nicht 2X), weil `billedAt` persistiert. VOR Fix
  rot (Doppel-Bucht).
- **T4 `test/max-duration-rearm.test.js` (Spawn, F10):** aktiver Call geseedet mit `answeredAt`
  weit in der Vergangenheit (Zombie); Prozess neu starten -> Call terminal (`status` nicht mehr
  `active`, `endedAt` = `cappedEndedAtMs`-Anker, NICHT Boot-Zeit) UND (outbound) `usageFor` zeigt
  gebuchte Minuten. Zweiter Fall: `answeredAt` vor 10 s, max 180 -> Call bleibt `active`, Timer
  gesetzt (ueber `voiceControl`-Stub zaehlbar).
- **T5 `test/graceful-shutdown.test.js` (Spawn, F11) — MID-FLIGHT:** lokaler Mock-HTTP-Server, der
  auf `POST /v1/messages` ~800 ms wartet, dann gueltige Anthropic-Antwort liefert; Server als
  Kindprozess mit `ANTHROPIC_BASE_URL`=Mock, `LLM_REQUEST_TIMEOUT_MS`>800; aktiver Call geseedet;
  `POST /voice/turn?callId=...` feuern (NICHT awaiten), waehrend der Handler im LLM-Call haengt
  `child.kill("SIGTERM")`; Prueft: Exit 0, `/voice/turn`-Response 200 TwiML (nicht abgeschnitten),
  Agent-Transkript-Mutation im Temp-`store.json` nach Exit. VOR Fix rot.
- **T6 `test/store-pg-reattach-active-call.test.js` (pglite, F12):** `store2` hydriert; `store1`
  erstellt aktiven Call NACH der Hydrierung + `save()`; `store2.getCall(id)` -> `null`;
  `store2.attachActiveCall(id)` -> liefert Call (aktiv), `getCall` findet ihn; Fail-closed:
  unbekannte id -> `null`, `completed`-Call -> `null`.
- **T6b `test/voice-unknown-call-log.test.js` bleibt gruen (F12):** wirklich unbekannter/`completed`
  Call -> Hangup + Log; unter json liefert `attachActiveCall` `null` -> fail-closed Hangup exakt
  erhalten. Nur der Kommentarkopf ergaenzt, Assertions bleiben.

## 3.6 Rollback-Plan

Jede Phase ist ein additiver Commit, sauber `git revert`-bar (Reihenfolge umgekehrt zur
Merge-Reihenfolge, F12 zuerst). Einzige additive Schema-Aenderung: `billed_at`-Spalte (F9) per
`ADD COLUMN IF NOT EXISTS` (nullable, kein Backfill, forward-compatible); beim revert NICHT gedroppt
(ungenutzte NULL-Spalte harmlos; DROP waere die einzige nicht-idempotente Operation). Timer sind
Prozess-Speicher -> keine Persistenz-Rueckstaende. `SHUTDOWN_DRAIN_TIMEOUT_MS` im selben revert aus
`.env`/`render.yaml` entfernen.

## 3.7 Pre-Mortem-Restrisiken (bewusst akzeptiert)

- **R-8.1 (= Owner-Frage 6.1) Boot-Gap Free:** Infra-Grenze, kein Store-Bug. Auf Free strukturell
  offen; auf paid/Deploy-Freeze geschlossen. Der Fix maximiert die Ueberlebenswahrscheinlichkeit;
  der Provider-Leg selbst ueberlebt und wird per Re-Arm/Cap sauber terminalisiert+gebucht.
- **R-8.3 Overlap-Max-Dauer-Loch (paid/zero-downtime, BEFUND 3a):** eine aktive Zeile, die ein
  Overlap-Prozess NACH dem Boot-Re-Arm anlegt UND die nie einen Folge-`/voice/*`-Webhook sendet,
  bekommt keinen Max-Dauer-Timer. Auf Render Free STRUKTURELL nicht erreichbar. PLAN-SECURITY-
  Pflicht-Gate des paid-Umstiegs (DB-weiter Cross-Tenant Active-Call-Reconciler).
- **R-8.4 `usage_event`/`number` Reconcile-ungeschuetzt (BEFUND 6):** bei Prozess-Overlap koennen
  Ledger-Zeilen oder eine frisch aktivierte DID via `deleteMissing` verschwinden. Dieselbe
  Overlap-Only-Klasse wie R-8.3; GEMEINSAM als EIN PLAN-SECURITY-Eintrag, Teil desselben
  paid-Gates.
- **R-8.5 Cross-Restart-Doppel-Notification (kosmetisch):** `finishCall`s Summary/Notification-Block
  ist bewusst NICHT durch `billedAt` gegated (Summary retry-bar, SMS ueber `summarySmsSentAt`
  idempotent). Ein sehr seltener verspaeteter `/voice/status` nach zweitem Restart koennte eine
  doppelte Notification (nicht SMS, nicht Abrechnung) erzeugen. Bestands-Klasse, kein
  Budget-/Safety-Effekt.

---

# 4. Phasenschnitt der GESAMT-Kette (F1..F12)

Jede Phase = EIN `phase-impl-lean`-Workflow auf `fix/<branch>`, dualer Review (S1/S2 = Blocker),
Merge im Lead, `npm test` danach komplett gruen. Alle Verifikations-Kommandos werden aus dem
Repo-Root ausgefuehrt (`cd <repo>` bereits im env). Groesse: S = kleine, lokale Aenderung; M =
mehrere Funktionen/Dateien + Tests; L = breite Verdrahtung + Spawn-Tests.

---

**F1 [OUT-05] Reserve-Buchhaltung im Store** — Branch `fix/out05-reserve-ledger`. Groesse **M**.
- Inhalt: `makeDefaultState.reservations={}`; `json.save()`-Exclude + `json.load()`-Init `||= {}`;
  `reservationFor`/`reservationsTotal`; `reserveExceedsBudget` kumulativ;
  `globalReserveExceedsBudget`; `tryReserveOutboundBudget`; `releaseOutboundReserve`;
  Fassaden-Wrapper (json+pg) + `store.js`-Re-Exports. Test-first
  `test/outbound-budget-concurrency.test.js` (rot) -> Code (gruen); plus `state-ops`-Unit +
  json-Ephemeralitaets-Unit.
- Erwartetes Ergebnis (deterministisch): Referenz-Test gruen (1x true / K-1x false / globale Achse
  / Freigabe+Idempotenz); json-Ephemeralitaets-Unit gruen (kein `reservations`-Key auf Platte);
  alle Bestandstests unveraendert gruen (Reserve=0 -> byte-identischer Gate). Server-Verhalten
  unveraendert (server.js ruft `tryReserve` noch nicht).
- Verifikation: `node --check src/store/state-ops.js src/store/json.js src/store/pg.js src/store.js && npm test`
- Abhaengigkeiten: keine.
- Akzeptierte Restrisiken: (a) `withStoreLock` prozess-lokal (OT-3, single instance).

**F2 [OUT-05] server.js-Verdrahtung + Backstop + Test-Seam** — Branch `fix/out05-wire-place-call`.
Groesse **L**.
- Inhalt: `createCall` um `reserveCents`/`reserveReleased`; `place_call` nutzt
  `await store.withStoreLock(() => store.tryReserveOutboundBudget(...))` in fail-closed try/catch;
  `releaseReserve`-Helper (fehler-schluckend); Freigabe im `catch` und in `finishCall`;
  `armReserveReleaseTimer` unbedingt beim Originate-Erfolg (beide Engines);
  `config.reserveReleaseGraceMs` + `config.fakeOriginate` (config.js + .env.example + BASE_ENV);
  `fakeVoice`-Adapter + Registry-Gate; Boot-Haertung in `boot-guard.js`; MINOR-6-Invarianten-
  Kommentar. Neue Tests: Atomaritaet-HTTP, Erfolgs-Freigabe, Backstop, Fehlerpfad.
- Erwartetes Ergebnis: alle vier Server-Tests gruen; `outbound-reserve-gate.test.js` weiter gruen;
  F1-Referenz-Test bleibt gruen; Boot-Refusal bei `FAKE_ORIGINATE=true` ohne
  `SKIP_TWILIO_SIGNATURE_CHECK`.
- Verifikation: `node --check src/server.js src/telephony/registry.js src/boot-guard.js src/config.js && npm test`.
  Optional Smoke: `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true FAKE_ORIGINATE=true STORE_BACKEND=json npm start`
  + zwei schnelle `curl POST /api/calls` gegen knappen Cap -> zweiter 402; danach
  `POST /voice/status` completed -> dritter 200.
- Abhaengigkeiten: **F1** (hart).
- Akzeptierte Restrisiken: (b) cross-instance-Freigabe braucht Live-Call-Referenz (OT-3);
  (c) Hung-Originate boot-begrenzt; (d) ~1-Minutentakt-Reserve-Slack (fail-forward).
  Verifikationspunkt: kein `finishCall`-Caller uebergibt ein DB-rekonstruiertes Call-Objekt.

**F3 [PROV-01] Single-Flight-Drain** — Branch `fix/prov01-drain-singleflight`. Groesse **S**.
- Inhalt: `runProvisioningDrainExclusive`, alle Aufrufer (`server.js:1779`, `1896`) umgestellt.
- Erwartetes Ergebnis: zwei parallele Drains verarbeiten jeden Job genau einmal (kein
  Doppel-`orderNumber`); Bestandsverhalten (ein Drain) byte-identisch. Schliesst latenten
  Bestands-Doppel-Drain.
- Verifikation: `node --check src/server.js && node --test test/prov01-drain-singleflight.test.js && npm test`
- Abhaengigkeiten: keine. Eigenstaendig wertvoll.
- Akzeptierte Restrisiken: keine neuen.

**F4 [PROV-01] createdAt + reiner Klassifikator** — Branch `fix/prov01-classify`. Groesse **M**.
- Inhalt: `createdAt` in `recordProvisioningJob` + pg flush/hydrate (`created_at`);
  `classifyQueuedProvisioningJobs`; Config `PROVISIONING_REDRIVE_MAX_AGE_MS` (Default 0) +
  `.env.example` + `BASE_ENV` `"0"` + `render.yaml`.
- Erwartetes Ergebnis: Klassifikator triagiert die acht Faelle korrekt (redrive/hold/close);
  `maxAgeMs=0` -> alles `hold`; neuer Job-Record traegt `createdAt`; pg-Roundtrip erhaelt es. Kein
  Verhaltenswechsel ohne F5 (reine Datenschicht).
- Verifikation: `node --check src/store/state-ops.js src/store/pg.js src/config.js && node --test test/prov01-classify.test.js test/prov01-createdat.test.js && npm test`
- Abhaengigkeiten: keine.
- Akzeptierte Restrisiken: keine neuen (Datenschicht).

**F5 [PROV-01] Boot-Sweep-Reconciler** — Branch `fix/prov01-boot-sweep`. Groesse **L**.
- Inhalt: `redriveProvisioningJobs` + `reconcileOrphanedProvisioning` + `app.listen`-Aufruf
  (fire-and-forget, gated auf `provisioningEnabled`); idempotenz-bewusster Telnyx-Mock im Test.
- Erwartetes Ergebnis: geseedeter junger stuck-`requested`+`queued`-Store (`PAYMENT_ENABLED=true`,
  `maxAge=3600000`) -> Nummer `active`, GENAU EINE effektive Order + EIN captured PI trotz
  geseedeter Vor-Order; Observe-Only (`maxAge=0`) -> bleibt `requested`, `hold`-Log, kein Kauf;
  Dry-Run -> kein Call.
- Verifikation: `node --check src/server.js && node --test test/prov01-boot-reconcile.test.js && npm test`
- Abhaengigkeiten: **F3** (Single-Flight) + **F4** (Klassifikator/Config), beide hart.
- Akzeptierte Restrisiken: 5b Multi-Instance-Sweep (paid, advisory-lock-Gate); 7 Cap-Re-Validierung
  (kein Netto-Neuverbrauch); BLOCKER 2 Telnyx-Idempotenz -> Observe-Only bis gruener Owner-Smoke.

**F6 [PROV-01] captureHold idempotenz-sicher** — Branch `fix/prov01-capture-idempotent`. Groesse
**S**.
- Inhalt: `captureHold` behandelt "already captured" (`payment_intent_unexpected_state`, PI
  `succeeded`) als Erfolg; praezise Fehler-Diskriminierung.
- Erwartetes Ergebnis: zweiter `captureHold` auf denselben PI -> `active` statt `released`.
- Verifikation: `node --check src/billing/stripe.js && node --test test/prov01-capture-idempotent.test.js && npm test`
- Abhaengigkeiten: unabhaengig implementierbar, aber **Pflicht-Vorbedingung** fuer die
  Scharfschaltung des Sweeps (`maxAge>0`) mit `PAYMENT_ENABLED`. Vor Payment-Live mergen.
- Akzeptierte Restrisiken: keine neuen.

**F7 [PROV-01] Retry-Lever entsperren** — Branch `fix/prov01-retry-redrive`. Groesse **M**.
- Inhalt: `resolveProvisionRetry` (alters-/gate-bewusst) + Verzweigung in
  `triggerTenantProvisioning`; `RETRY_REASON_STATUS.needs_manual_reconcile`.
- Erwartetes Ergebnis: `redrive`+numberId+jobId fuer jungen stuck; `needs_manual_reconcile` fuer
  alten stuck; `already_provisioned` fuer aktiv; neue Nummer fuer terminal-`failed`. Bestandstest
  `p2-onboard-retry.test.js` bleibt gruen (aktiv -> 409).
- Verifikation: `node --check src/billing/provision-trigger.js src/server.js && node --test test/prov01-retry-redrive.test.js && npm test`
- Abhaengigkeiten: **F4** (`createdAt`) + **F5** (`redriveProvisioningJobs`), beide hart.
- Akzeptierte Restrisiken: keine neuen.

**F8 [A6] Reconcile-Schutz** — Branch `fix/a6-reconcile-active`. Groesse **S**.
- Inhalt: `src/store/pg.js` `flushCalls` -> `deleteMissingCallsKeepActive` + Konstante
  `CALL_STATUS_ACTIVE`.
- Erwartetes Ergebnis: aktive DB-Call-Zeile ueberlebt einen Flush aus einem divergenten Spiegel.
- Verifikation: `node --check src/store/pg.js && node --test test/store-pg-reconcile-active-call.test.js && npm test`
- Abhaengigkeiten: keine.
- Akzeptierte Restrisiken: R-8.4 (`usage_event`/`number` bleiben reconcile-ungeschuetzt,
  Overlap-only, paid-Gate).

**F9 [A6] Pure Restzeit/Anker + Billing-Idempotenz** — Branch `fix/a6-billing-idempotent`. Groesse
**L**.
- Inhalt: `remainingMaxDurationMs`, `cappedEndedAtMs`, `markBilled`, `setCallEndedAt`
  (state-ops.js); `billed_at` `ADD COLUMN IF NOT EXISTS` (schema.sql); rowToCall + flushCalls-Spalte
  + Fassaden (pg.js/json.js/store.js); `finishCall`-Abrechnungsblock um `!call.billedAt`-Guard.
  **Merge-Auflage:** ein bereits vorhandener OUT-05-`releaseReserve`-Aufruf in `finishCall` bleibt
  unveraendert erhalten (nicht in den `!billedAt`-Zweig ziehen).
- Erwartetes Ergebnis: pure Funktionen korrekt (Anker echt/gekappt); `finishCall` bucht
  Voice-Minuten genau EINMAL ueber Restarts; `billedAt` persistiert + hydriert.
- Verifikation: `node --check src/server.js src/store/state-ops.js src/store/pg.js src/store/json.js src/store.js && node --test test/max-duration-pure.test.js test/store-pg-billing-idempotent.test.js test/finishcall-billing-once.test.js && npm test`
- Abhaengigkeiten: keine (nutzt nichts aus F8).
- Akzeptierte Restrisiken: R-8.5 (Cross-Restart-Doppel-Notification, kosmetisch).

**F10 [A6] Timer-Unifikation + Boot-Re-Arm** — Branch `fix/a6-timer-rearm`. Groesse **L**.
- Inhalt: `scheduleMaxDurationEnd`; `armMaxDurationTimer` -> Wrapper; `rearmActiveCallTimers()` nach
  `store.load()` (nur `voiceEngine !== "realtime"`).
- Erwartetes Ergebnis: rehydrierte aktive Calls bekommen Timer relativ zum echten Start; Zombies
  werden ueber `finishCall` beendet (gebucht, gekappt, terminal).
- Verifikation: `node --check src/server.js && node --test test/max-duration-rearm.test.js && npm test`
- Abhaengigkeiten: **F9** (hart — `remainingMaxDurationMs`/`cappedEndedAtMs`/`setCallEndedAt`/
  `finishCall`-Guard).
- Akzeptierte Restrisiken: R-8.3 (Overlap-Max-Dauer-Loch, paid-Gate); R-8.1 (Boot-Gap Free).

**F11 [A6] Graceful Shutdown** — Branch `fix/a6-graceful-shutdown`. Groesse **M**.
- Inhalt: `gracefulShutdown` + SIGTERM/SIGINT via `once` (await-close -> closeIdleConnections ->
  save -> Watchdog); `SHUTDOWN_DRAIN_TIMEOUT_MS` (config.js + .env.example + render.yaml + BASE_ENV).
- Erwartetes Ergebnis: SIGTERM -> in-flight `/voice/turn` laeuft fertig, Mutation persistiert,
  Exit-Code 0.
- Verifikation: `node --check src/server.js src/config.js && node --test test/graceful-shutdown.test.js && npm test`
- Abhaengigkeiten: keine (funktional unabhaengig; in der Reihenfolge nach F10).
- Akzeptierte Restrisiken: R-8.1 (Boot-Gap Free bleibt offen — der Drain schuetzt den letzten
  Flush, nicht das Boot-Fenster).

**F12 [A6] Webhook-Re-Attach (inkl. /voice/status)** — Branch `fix/a6-reattach`. Groesse **L**.
- Inhalt: `attachActiveCall` (pg RLS-Tenant-Loop; json = `getCall`) + `store.js`-Export;
  `/voice/turn` + `/voice/outbound` + `/voice/status` attach-then-classify. Angepasst (bleibt
  gruen): `test/voice-unknown-call-log.test.js` (nur Kommentar).
- Erwartetes Ergebnis: aktiver, dem Prozess unbekannter Call wird RLS-sauber re-attached;
  Ueber-Zeit-Leg terminalisiert statt reanimiert; unbekannte/fremde id bleibt fail-closed Hangup;
  `/voice/status` rettet das Call-Ende-Signal einer nicht-gespiegelten Zeile.
- Verifikation: `node --check src/store/pg.js src/store/json.js src/store.js src/server.js && node --test test/store-pg-reattach-active-call.test.js test/voice-unknown-call-log.test.js && npm test`
- Abhaengigkeiten: **F9** (hart) + **F10** (hart) + **F8** (weich, Sicherheitsnetz bis zum naechsten
  Flush).
- Akzeptierte Restrisiken: R-8.3/R-8.4 (Overlap-only, paid-Gate); Cross-Tenant-Attach ausgeschlossen
  (RLS + Signatur vorgelagert).

**Abnahme (separat, nicht Teil einer Merge-Phase): DEPLOY-04-Drill.** Staging (pg, moeglichst
Deploy-Overlap): aktiver Test-Call laeuft, Deploy ausloesen, pruefen dass der Call weiterlaeuft
(Folge-Turn bedient) UND der Max-Dauer-Cap danach greift UND die Voice-Minuten genau einmal gebucht
sind. Auf Render Free zusaetzlich das Boot-Gap-Verhalten dokumentieren (Owner-Frage 6.1).

---

# 5. Empfohlene Reihenfolge der Gesamt-Kette

**Empfohlene Reihenfolge: F1 -> F2 -> F3 -> F4 -> F5 -> F6 -> F7 -> F8 -> F9 -> F10 -> F11 -> F12.**
Das entspricht der Owner-Vorgabe (OUT-05 zuerst, dann PROV-01, dann A6) und wird uebernommen.

**Begruendung:**

- **OUT-05 zuerst (F1-F2):** kleinster, in sich geschlossener Money-Fix (2 Phasen, keine
  Abhaengigkeit von den anderen beiden Defekten). Schliesst ein aktives Overspend-Loch, liefert
  einen schnellen, gut testbaren Gewinn und stabilisiert die Budget-/`finishCall`-Oberflaeche, die
  A6 (F9) spaeter erweitert.
- **PROV-01 zweitens (F3-F7):** ueberwiegend additiv, Default Observe-Only (`maxAge=0`) -> geringer
  Blast-Radius. F6 (`captureHold`-Idempotenz) haertet zusaetzlich den Money-Pfad generell und ist
  Pflicht-Vorbedingung fuer die Sweep-Scharfschaltung. Die interne Reihenfolge ist zwingend
  sequenziell: F3 (Single-Flight) und F4 (Datenschicht) vor F5 (Boot-Sweep), F6 vor Payment-Live,
  F7 nach F4+F5.
- **A6 zuletzt (F8-F12):** die groesste und invasivste Kette (5 Phasen, tief in `server.js`,
  `finishCall`, Timer, Shutdown, Re-Attach, beide Stores). Bewusst zuletzt, wenn die
  Money-Buchhaltungs-Fundamente (OUT-05-Reserve, PROV-01-`captureHold`-Idempotenz) bereits stabil
  sind — so wird F9 (`billedAt` in `finishCall`) auf einer Oberflaeche gebaut, die die
  OUT-05-`releaseReserve`-Verdrahtung schon traegt (beide Money-Hooks werden gemeinsam
  reviewt). Die A6-interne Merge-Reihenfolge ist BLOCKING (F8 -> F9 -> F10 -> F11 -> F12); harte
  Abhaengigkeiten: F10 -> F9, F12 -> F9 + F10 (+ F8 weich).

**Bewusst NICHT abgewichen (obwohl argumentierbar):** Man koennte A6 vorziehen, um den
Deploy-Freeze frueher aufzuheben. Dagegen: (1) A6 ist am riskantesten — die beiden kleineren
Money-Fixes zuerst bauen Vertrauen und de-risken die `finishCall`-Oberflaeche; (2) der
Deploy-Freeze ist eine billige operative Massnahme (siehe 5.1); (3) F9 profitiert davon, dass die
OUT-05-`releaseReserve`-Verdrahtung in `finishCall` bereits vorhanden ist.

### 5.1 Deploy-Freeze waehrend der Umsetzung (operative Auflage)

Bis **F12 live** ist (A6 vollstaendig), gilt: jeder Deploy — auch der der OUT-05- und
PROV-01-Fixes — kann laufende Calls toeten. Deshalb **nur in nachweislich anruf-freien Fenstern
deployen** (Live-Widget / `get_agent_status` zeigt keinen aktiven Call). Das ist die
Uebergangs-Auflage aus der Owner-Entscheidung (0.2). Sie entfaellt, sobald F12 live ist, im Rahmen
der A6-Restrisiken (Boot-Gap Free bleibt bestehen, Owner-Frage 6.1).

---

# 6. PLAN-SECURITY.md — noetige Eintraege

Alle drei Defekte sind sicherheitsrelevant (Budget-/Money-/Regel-1-Achse) und brauchen einen
Eintrag. `PLAN-SECURITY.md` ist bei der Umsetzung jeder Phase mit dem entsprechenden Text zu
ergaenzen (Pflicht bei sicherheitsrelevanten Aenderungen, CLAUDE.md).

**OUT-05 (nach F2):**
> OUT-05 (Reserve-Race): Worst-Case-Reserven pro place_call in einem strukturell ephemeren
> In-Prozess-Ledger (`s.reservations`, nie serialisiert/hydriert); Check+Reserve atomar unter
> `withStoreLock` (Schnittmenge Tenant+global), fail-closed try/catch (Body-Throw = Denial 402).
> Freigabe bei jedem Endzustand: Erfolg via `finishCall`, Fehler via `catch`, UND — unabhaengig vom
> Provider-Callback — via beim Originate armiertem Reserve-Release-Timer (beide Engines) bei
> `maxDur + RESERVE_RELEASE_GRACE_MS`. Restrisiken (akzeptiert, bounded): (a) Multi-Prozess nicht
> abgedeckt (OT-3, single-instance); (b) Freigabe braucht die Live-Call-Referenz -> cross-instance
> blind (OT-3); (c) Hung-Originate laesst eine Reserve bis Boot stehen (selten, boot-begrenzt);
> (d) Ist-Kosten koennen die Reserve um <= 1 Minutentakt (Rundung/Hangup-Latenz) uebersteigen,
> fail-forward. `FAKE_ORIGINATE` ist ein boot-gehaerteter Test-Seam (nur zulaessig wenn
> Signaturpruefung geskippt -> in Prod unmoeglich), keine abgeschaltete Sicherung.

**PROV-01 (nach F5, ergaenzt nach F6/F7):**
> Provisioning-Crash-Recovery (PROV-01, klassifizierender Boot-Sweep): Nach einem Prozess-Crash
> zwischen Enqueue und Drain klassifiziert ein fire-and-forget Boot-Sweep
> (`reconcileOrphanedProvisioning`, gated auf `PROVISIONING_ENABLED`) die persistierten
> `queued`-Jobs in drei Koerbe: redrive (nur `requested` + aktiver KYC-Subscriber + Job juenger als
> `PROVISIONING_REDRIVE_MAX_AGE_MS`, Default 0 = Observe-Only) ueber den idempotenten,
> single-flight-serialisierten Worker; hold (zu alt / unbekanntes Alter / gate-faellt / Nummer
> mid-flight) -> Owner-Reconcile-Runbook, KEIN Auto-Kauf; close (Nummer aktiv/terminal/fehlt) ->
> Job schliessen. `captureHold` behandelt "already captured" als Erfolg (kein Release einer
> bezahlten Nummer). HARTER Launch-Gate: Scharfschaltung (maxAge>0) mit PAYMENT_ENABLED erst nach
> gruenem Owner-Smoke der Telnyx-Idempotenz auf `/v2/number_orders` (zweimal derselbe Key -> eine
> Order). Bis dahin Observe-Only. Bewusst akzeptierte Restrisiken: (1) Multi-Instance-Sweep braucht
> vor Skalierung auf >1 Instanz einen pg-Advisory-Lock pro numberId; Launch ist Single-Instance.
> (2) Cap-Re-Validierung: der Re-Drive verbraucht keine neue Kapazitaet, eine seither verschaerfte
> MAX_NUMBERS-Bremse wird fuer sie nicht neu geprueft. (3) `runProvisioningDrain` haelt keinen
> `withStoreLock` ueber die Drain-Schleife (pre-existierend); der Single-Flight-Guard schliesst den
> Doppel-Drain, der Whole-Mirror-Flush-Race bleibt an das Single-Instance-Gate gekoppelt.

**A6 / DEPLOY-04 (nach F12, Bausteine bereits ab F8-F11):**
> A6/DEPLOY-04: Call-State-Kontinuitaet ueber Restart. Max-Dauer-Cap (Regel 1) wird beim Boot fuer
> rehydrierte aktive Calls neu armiert, verankert am echten Call-Start; Zombies (>= Max-Dauer)
> werden beim Boot ueber den EINEN Abrechnungspfad (`finishCall`) beendet — mit gekapptem `endedAt`
> (nie Boot-Zeit) und persistiertem `billedAt`-Marker (genau-einmal-Buchung ueber Prozessgrenzen).
> `/voice/*`-Re-Attach (inkl. `/voice/status`) fuehrt einen aktiven Call nur nach RLS-scoped
> DB-Bestaetigung fort (fail-closed bei unbekannter/fremder callId) und reanimiert keinen
> Ueber-Zeit-Leg. Provider-Signaturpruefung bleibt vorgelagert. Reconcile-Flush loescht keine
> `status='active'`-Call-Zeile mehr. SIGTERM/SIGINT-Graceful-Shutdown draint den letzten Flush
> (await close -> save). RESTRISIKEN (bezahlter zero-downtime-Tier, auf Render Free strukturell
> nicht erreichbar): (a) eine nicht-gespiegelte aktive Zeile ohne jeden Folge-Webhook bekommt keinen
> Max-Dauer-Timer; (b) `usage_event`/`number` bleiben Reconcile-ungeschuetzt (Ledger/DID). Beide
> vor Aktivierung von Prozess-Overlap durch einen DB-weiten Cross-Tenant Active-Call-Reconciler zu
> schliessen (Pflicht-Gate des paid-Umstiegs); bis dahin bewusst deferiert. Boot-Gap auf Render
> Free (kein Overlap/preDeploy) ist eine Infra-Grenze, kein Store-Bug — durch Deploy-Freeze bei
> aktivem Traffic oder bezahlten zero-downtime-Tier zu adressieren.

---

# 7. Offene Owner-Fragen

Nur echte Entscheidungen, die das Design aufgedeckt hat (keine Rueckversicherung).

1. **[A6] Boot-Gap auf Render Free.** Der Code-Fix maximiert die Ueberlebenswahrscheinlichkeit,
   kann aber das Fenster "neuer Prozess bootet, keine Instanz antwortet" auf Free nicht schliessen
   (kein Overlap/preDeploy). Fuer eine harte DEPLOY-04-Garantie "Call laeuft weiter": bezahlter
   Tier mit zero-downtime-Overlap ODER dauerhafter operativer Deploy-Freeze bei aktivem Traffic?
   (Beeinflusst die Abnahme-Erwartung, nicht den Code-Fix.)

2. **[PROV-01] Telnyx-Idempotenz-Smoke (harter Launch-Gate).** VOR der Scharfschaltung (`maxAge>0`,
   `PAYMENT_ENABLED`): zweimal derselbe `Idempotency-Key` auf `POST /v2/number_orders` -> nur EINE
   Order? Ergebnis entscheidet, ob das Alters-Fenster genuegt (Telnyx honoriert den Key) oder ob
   verify-before-buy (Alternative D) Pflicht wird. Bis gruen: Observe-Only.

3. **[PROV-01] Zielwert `PROVISIONING_REDRIVE_MAX_AGE_MS`.** Empfehlung Launch = `0` (Observe-Only,
   Detektion in Prod-Logs validieren), dann konservativ `3600000` (1h, klar < Stripe-24h) nach
   gruenem Smoke. Owner bestaetigt den Zielwert.

4. **[A6] `SHUTDOWN_DRAIN_TIMEOUT_MS`-Wert.** Vorschlag 8000 ms (Render sendet nach SIGTERM
   standardmaessig nach ~30 s SIGKILL; 8 s laesst Puffer, ohne den Deploy merklich zu
   verlangsamen). Owner-Bestaetigung des Werts?

5. **[OUT-05] `RESERVE_RELEASE_GRACE_MS`-Default (Vorschlag 15000 ms).** Puffer ueber der
   Call-Max-Dauer fuer Hangup-/Callback-Latenz. Groesser = mehr Sicherheit gegen fruehe Freigabe
   eines noch laufenden Calls, aber laengere Orphan-Lebensdauer im Verlustfall. Owner bestaetigt
   oder justiert.

6. **[PROV-01 + A6] Multi-Instance-Zeitpunkt.** Wann skaliert der Dienst auf >1 Instanz? Davor
   MUSS zwingend kommen: pg-`pg_advisory_lock` pro numberId fuer den PROV-01-Sweep UND ein DB-weiter
   Cross-Tenant Active-Call-Reconciler fuer das A6-Overlap-Max-Dauer-Loch (R-8.3/R-8.4). Als eigene,
   spaetere Phase einzuplanen — kein Launch-Blocker (Launch ist Single-Instance).
