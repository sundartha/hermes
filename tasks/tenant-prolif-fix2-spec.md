# Spec: Fix 2 — DID-Lifecycle (Release im Suspend-/Loesch-Pfad)

Autoritative Scope-/Design-/Invarianten-/Abgrenzungs-Definition fuer Fix 2. Vorrang vor dem
Umbrella-Doc `PLAN-TENANT-PROLIFERATION.md`. Grundlage: RCA `tasks/rca-tenant-number-proliferation.md`
Abschnitt 6 (Fix 2). Zeilennummern sind nur Anker — die Symbole per grep verifizieren, NIE
Zeilennummern uebernehmen (sie rotten).

## Wurzel (ein Satz)

`releaseNumber` hat genau EINEN Aufrufer (Provisioning-FAILED-Rollback, `onboarding.js`). Suspend
(`billing/webhook.js`) setzt nur den Status, DSGVO-Loeschung (`eraseTenantData`) laesst `numbers`
bewusst unangetastet. Jede gekaufte DID bleibt bei Telnyx `active` + mietkostenpflichtig — auch nach
Kuendigung und Tenant-Loeschung. Fix 2 baut einen kontrollierten, grace-gegateten Release-Pfad.

## Absolute Grenzen (alle Phasen)

- CLAUDE.md Regel 1-7 unberuehrt: Safety-Gates (Allowlist/Denylist/Land/Stundenlimit/Budget/
  Max-Dauer/Signatur), Offenlegungssatz, Auth-fail-closed. Kein Fix umgeht ein Gate.
- **DID-Release NIE sofort/aggressiv.** Grace-Period + Idempotenz + Live-Status-Recheck vor JEDEM
  DELETE + durabler Audit. Telnyx gibt eine released DID NICHT garantiert zurueck -> ein Fehl-Release
  ist Rufnummern-Verlust fuer einen zahlenden Kunden.
- **Ausgeliefert wird Observe-Only** (`RELEASE_GRACE_DAYS=0`): kein Verhalten aendert sich, bis der
  Owner die Grace aktiv > 0 setzt. Analogie: `PROVISIONING_REDRIVE_MAX_AGE_MS=0` = Feature aus.
- Keine neuen npm-Dependencies. Schema nur additiv/idempotent (`ALTER ... ADD COLUMN IF NOT EXISTS`,
  keine Versionierungstabelle). ESM, kein Build-Step, kein TypeScript, Kommentare deutsch OHNE
  Umlaute (ue/oe/ae). SCOPE strikt: nur die jeweilige Phase.
- **Twilio hat KEIN releaseNumber** (es gibt keinen `adapters/twilio/numbers.js`). Der Release-Pfad
  gilt NUR fuer `provider==="telnyx"`; alles andere -> hold (manuell), NIE ein Release-Versuch.

## Gemeinsames Vorbild (im Code vorhanden, nachbauen statt neu erfinden)

- Reiner, IO-freier, zeit-injizierter Klassifizierer: `classifyQueuedProvisioningJobs(s, {nowMs,
  maxAgeMs, kycMinLevel})` (`state-ops.js:1198`). Vorbild fuer `classifyNumbersForRelease`.
- Scheduling: Boot-Lauf `void reconcileOrphanedProvisioning()` (`server.js:2341`/Aufruf ~2562) +
  `setInterval(runRetention, RETENTION_SWEEP_INTERVAL_MS).unref()` (`server.js:2453`).
- Env-Muster an 4 Orten: `numEnv(...)` in `config.js` (Vorbild `PROVISIONING_REDRIVE_MAX_AGE_MS`),
  `.env.example`, `render.yaml`, `test/helpers.js` BASE_ENV (dort `"0"` als neutraler fail-closed
  Default — sonst leakt lokales `.env` in Spawn-Tests, Baseline lokal rot/CI gruen).
- Durabler Audit: `makeAuditStore(runner)` (`src/audit-store.js`) -> `INSERT INTO audit_log`.
- Store-Release: `releaseNumber(s, numberId)` (`state-ops.js:1122`, ACTIVE->RELEASED);
  Telnyx-Adapter `releaseNumber(providerNumberId)` (`adapters/telnyx/numbers.js:96`, DELETE, NICHT
  idempotent) ueber den NumberProvisioning-Port/registry.

---

## Phase tenant-prolif-c — suspended_at + Webhook-Anker

### Ziel (ein Satz)

Ein Tenant, der in den Suspend-Zustand wechselt, traegt ab der ERSTEN Suspendierung einen
`suspended_at`-Zeitstempel; Reaktivierung loescht ihn. Das ist der Grace-Anker fuer Phase D.

### Betroffene Dateien (Anker per grep verifizieren)

- `src/db/schema.sql` — neue Nullable-Spalte `tenant.suspended_at` (Spalten-Pattern wie
  `stripe_number_setup_fee_exempt`, Commit e625989). `src/db/migrate.js` — additiver, idempotenter
  Migrations-Eintrag.
- `src/store/state-ops.js` — set-if-absent-Setter + Clearer + Getter fuer `suspended_at`.
- `src/store/pg.js` — `TENANT_COLUMNS` + `rowToTenant` (**MUSS hydrieren** — i8-Lehre: sonst geht das
  Feld beim naechsten `flushTenants` verloren) + `flushTenants` (persistieren).
- `src/billing/webhook.js` — SUSPEND-Zweig(e) (subscription.deleted / final gescheiterte
  invoice.payment_failed, ~228-240): `suspended_at` set-if-absent stempeln, wo der Tenant nach
  suspended wechselt.
- `src/billing/activation.js` — `activatePaidTenant(...)` (~61): `suspended_at` bei Reaktivierung
  loeschen (Uhr-Reset).
- Tests: state-ops-Unit + pg-Roundtrip (`test/pg-*`) + `test/p3-payment-webhook.test.js` (Fake-deps).

### Design / Invarianten

1. **set-if-absent:** die Uhr startet bei der ERSTEN Suspendierung. Ein Dunning-Retry
   (mehrfaches `invoice.payment_failed`) darf den Zeitstempel NICHT nach hinten schieben — sonst
   verlaengert jeder Retry die Grace endlos.
2. **Clear bei Reaktivierung:** `activatePaidTenant` (und ein evtl. Reaktivierungs-Zweig im Webhook)
   loescht `suspended_at` -> die Uhr ist zurueckgesetzt, der Tenant ist kein Release-Kandidat mehr.
3. **Rein additiv:** ohne gesetztes `suspended_at` ist das Verhalten byte-identisch zu heute. json
   und pg tragen das Feld gleich (Roundtrip-Test).
4. Kein Release, kein Klassifizierer, kein Scheduling in dieser Phase — nur der Anker.

### Tests (neues Verhalten braucht Test)

- Setter set-if-absent: erster Aufruf stempelt, zweiter (anderer Wert) laesst unveraendert.
- Clearer: nach Clear ist `suspended_at` leer.
- pg-Roundtrip: `suspended_at` ueberlebt `flushTenants` -> `rowToTenant` (i8-Landmine).
- Webhook: `subscription.deleted` stempelt; zweites `invoice.payment_failed` bewegt den Stempel
  NICHT; Reaktivierung loescht ihn.

### Deterministisch pruefbares Ergebnis

- `npm test` gruen (json + pglite), inkl. der neuen Tests. `node --check` auf jede geaenderte Datei.

---

## Phase tenant-prolif-d — Release-Klassifizierer + Reconcile (auto nach Grace, Observe-Only-Default)

### Ziel (ein Satz)

Ein Reconcile-Lauf identifiziert active Telnyx-DIDs von >Grace suspendierten Tenants und gibt sie —
NUR wenn `RELEASE_GRACE_DAYS>0` und nach Live-Recheck — idempotent frei und auditiert das; bei
`RELEASE_GRACE_DAYS=0` (Default) werden Kandidaten NUR geloggt, nichts freigegeben.

### Betroffene Dateien (Anker per grep verifizieren)

- `src/store/state-ops.js` — reiner `classifyNumbersForRelease(s, {nowMs, graceMs})` (Vorbild
  `classifyQueuedProvisioningJobs`).
- `src/config.js` — `RELEASE_GRACE_DAYS` via `numEnv` (Default 0, min 0, integer).
- neues Reconcile-Modul (bzw. `src/onboarding.js`-Nachbar) fuer die Ausfuehrung (IO: provider-Release
  + Store-Mutation + Audit).
- `src/server.js` — Boot-Lauf (wie `reconcileOrphanedProvisioning`, ~2562) +
  `setInterval(...).unref()` (Retention-Pattern, ~2453).
- `.env.example`, `render.yaml`, `test/helpers.js` BASE_ENV (`"0"`) — die 4 Env-Orte.
- Tests: Klassifizierer-Unit (Zeit injiziert, KEIN `Date.now` im Test) + Reconcile-Test mit
  Fake-Provisioner.

### Design / Invarianten

1. **Klassifizierer rein + zeit-injiziert:** `classifyNumbersForRelease(s, {nowMs, graceMs})` gibt
   pro Nummer `release | hold | skip` + Grund zurueck. Regel:
   - `release`: Tenant suspendiert (`suspended_at` gesetzt) UND `nowMs - suspendedAt > graceMs` UND
     Nummer `active` UND `provider==="telnyx"`.
   - `hold`: `provider!=="telnyx"` (manuell — kein Twilio-Release).
   - `skip`: Nummer bereits `released` / Tenant nicht suspendiert / Grace nicht erreicht.
   Kein `Date.now()`/`Math.random()` im reinen Kern.
2. **Observe-Only ist der Default und ein Sentinel:** `RELEASE_GRACE_DAYS=0` -> der Reconcile-
   Executor gibt NICHTS frei (er loggt hoechstens die Kandidatenliste). Nur `>0` schaltet echte
   Releases scharf. `RELEASE_GRACE_DAYS=0` DARF NIE zu einem DELETE fuehren.
3. **Live-Recheck vor JEDEM DELETE:** unmittelbar vor dem provider-Release erneut pruefen, dass der
   Tenant weiter suspendiert ist und KEIN aktives Abo traegt. Reaktivierte der Kunde zwischenzeitlich
   -> Release abbrechen (Race-Schutz).
4. **Idempotenz:** der Store-Status-Check (`active` -> sonst skip) schuetzt gegen den nicht-
   idempotenten Telnyx-DELETE; ein bereits `released`-Eintrag oder ein provider-"already gone"
   (404) fuehrt NICHT zu einem Fehler-Abbruch, sondern zu skip/Erfolg. Reihenfolge so, dass ein
   Crash zwischen provider-DELETE und Store-Mutation beim naechsten Lauf konvergiert, nicht divergiert.
5. **Durabler Audit:** jede Release-Aktion (und jeder Observe-Kandidat im scharfen Modus) ueber
   `makeAuditStore`/`audit_log` (actor = System/Reconcile, tenant_id, action, detail) — nicht nur
   `console`.
6. **Scheduling:** Boot-Lauf + `setInterval(...).unref()`. Free-Tier-Liveness-Vorbehalt im Code
   dokumentieren (Render-Free kann schlafen; Boot-Lauf deckt den Deploy-Fall; eine Render-Cron ist
   das spaetere Upgrade, fuer den Launch nicht noetig).
7. **Kein Safety-Gate beruehrt.** Der Release laeuft ueber den bestehenden NumberProvisioning-Port
   (registry-Dispatch), kein neuer Provider-Einstieg.

### Pre-Mortem (ein Jahr spaeter, Fix war falsch)

- Ein Kunde verlor seine Geschaeftsnummer wegen einer 2-Tage-Zahlungsluecke -> zu aggressives
  Release ohne Grace/Recheck. Deshalb Grace + Live-Recheck + Observe-Only-Default.
- `RELEASE_GRACE_DAYS=0` gab doch etwas frei (Sentinel falsch interpretiert) -> Test, der beweist:
  Default releast NICHTS, egal wie alt die Suspendierung.
- Der Job lief nie (Free-Tier schlief) und Kosten liefen weiter -> Boot-Lauf als Mindestgarantie +
  dokumentierter Cron-Upgrade-Pfad.

### Tests (neues Verhalten braucht Test)

- Klassifizierer: >Grace suspendiert + telnyx + active -> `release`; non-telnyx -> `hold`; bereits
  released / nicht suspendiert / Grace nicht erreicht -> `skip`. Zeit injiziert.
- Reconcile scharf (grace>0) mit Fake-Provisioner: Kandidat wird freigegeben (Store ACTIVE->RELEASED)
  + Audit-Eintrag; zweiter Lauf ist idempotent (kein zweiter DELETE); non-telnyx unangetastet;
  Live-Recheck bricht ab, wenn der Fake-Tenant reaktiviert.
- Reconcile Observe-Only (grace=0): KEIN Release, egal wie alt die Suspendierung.

### Deterministisch pruefbares Ergebnis

- `npm test` gruen (json + pglite), inkl. der neuen Tests. `node --check` auf jede geaenderte Datei.

---

## Phase tenant-prolif-e — eraseTenantData gibt Nummern frei (DSGVO, klein)

### Ziel (ein Satz)

`eraseTenantData` (Art. 17) gibt zusaetzlich die Nummern des Tenants frei, damit eine kuenftige
Erase-Route keine DID leakt (heute bewusst uebersprungen).

### Betroffene Dateien (Anker per grep verifizieren)

- `src/store/state-ops.js` — `eraseTenantData(s, tenantId)` (~254): die aktiven Nummern des Tenants
  ueber denselben grace-freien, aber idempotenten + audit-gedeckten Release-Weg wie Phase D freigeben
  (bei Loeschung gilt keine Grace — der Tenant ist weg; aber Telnyx-only + Idempotenz + Audit
  bleiben).
- Tests: `test/tenant-erasure*.test.js`.

### Design / Invarianten

1. Bei Loeschung KEINE Grace (der Tenant existiert nicht mehr) — aber weiterhin nur
   `provider==="telnyx"` releasen, idempotent, auditiert.
2. **Latenz-Hinweis:** es existiert noch KEIN Live-Aufrufer von `eraseTenantData` — der Release wird
   hier vorab verdrahtet. Kein neuer Endpunkt in dieser Phase (Scope).
3. Reine Erweiterung: der bestehende Erase-Umfang (Calls/Kontakt/Transkript) bleibt unveraendert;
   Nummern kommen additiv hinzu.

### Tests (neues Verhalten braucht Test)

- Erase gibt die active Telnyx-Nummer des Tenants frei (Store ACTIVE->RELEASED) + Audit; non-telnyx
  bleibt unangetastet; doppelter Erase ist idempotent.

### Deterministisch pruefbares Ergebnis

- `npm test` gruen (json + pglite), inkl. der neuen Tests. `node --check` auf jede geaenderte Datei.
