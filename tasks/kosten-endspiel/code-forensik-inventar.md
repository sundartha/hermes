# Kosten-Endspiel: Code-Forensik-Inventar (READ-ONLY)

Stand: 2026-07-21, master=3516c31 (kein Checkout-Wechsel, keine Aenderung).
Methode: ausschliesslich `Read`/`grep`/`wc -l` auf dem Arbeitsbaum. Keine API, kein Server, keine DB.

## (a) D1-D4 an File:Zeile belegt

### D1 - Rate-Limit durch Redundanz (7 Requests PRO ANRUF, kein Call-Filter serverseitig)

`src/telephony/adapters/telnyx/voice.js:306-321` (`fetchCostRecordPage`):
```js
async function fetchCostRecordPage(recordType) {
  const q = new URLSearchParams();
  q.set("filter[record_type]", recordType);
  q.set("page[size]", String(COST_RECORDS_PAGE_SIZE));
  ...
  const res = await fetch(`${config.telephony.telnyxApiBase}${DETAIL_RECORDS_BASE}?${q}`, {
```
Beleg: die einzigen Query-Parameter sind `filter[record_type]` und `page[size]` - **kein** anrufspezifischer Parameter (kein `legId`, kein Zeitfenster als Server-Filter). `legId`/`startedAt`/`endedAt` werden erst client-seitig in `toCostRecord`/`assignmentOutcome` (Zeile 251-298) verwendet, NACH dem Fetch.

`src/telephony/adapters/telnyx/voice.js:327-336` (`fetchAllCostRecords`):
```js
async function fetchAllCostRecords() {
  const rawRecords = [];
  for (const recordType of COST_RECORD_TYPES) {
    const page = await fetchCostRecordPage(recordType);
```
`COST_RECORD_TYPES` hat 7 Eintraege (Zeile 38-41) -> 7 Requests je Aufruf von `fetchAllCostRecords`.

`src/telephony/adapters/telnyx/voice.js:519-524` (`getVoiceCostRecords`):
```js
async getVoiceCostRecords({ legId, startedAt, endedAt } = {}) {
  ...
  const fetched = await fetchAllCostRecords();
```
Aufrufer: `src/billing/cost-truing.js:270-296` (`trueOneCall`) ruft `control.getVoiceCostRecords({ legId, startedAt, endedAt })` **einmal pro Kandidaten-Call** in der Sweep-Schleife (`sweepAllCandidates`, Zeile 356-373, `for (const call of candidates) await trueOneCall(call, tally)`).

Warum genau diese Zeilen den Defekt ausmachen: der komplette Kontobestand aller `record_type`-Seiten wird bei JEDEM Call neu vom Server geholt, obwohl der Server keinen Call-Filter kennt und dieselben 7 Seiten fuer jeden Kandidaten im selben Sweep identisch waeren. Bei N Kandidaten sind das 7*N Requests statt 7 (oder weniger, s. D2).

### D2 - Paginierung ignoriert (nur Seite 1, `page[number]` fehlt komplett)

`src/telephony/adapters/telnyx/voice.js:306-309`:
```js
const q = new URLSearchParams();
q.set("filter[record_type]", recordType);
q.set("page[size]", String(COST_RECORDS_PAGE_SIZE));
```
Es gibt in der gesamten Datei **keine** Verwendung von `page[number]` oder einer Schleife ueber `meta.total_pages`. `fetchAllCostRecords` (Zeile 327-336) ruft `fetchCostRecordPage` genau einmal je `recordType`, behandelt das Ergebnis als vollstaendig (`rawRecords.push(...page.raw)`) und meldet keinen "es gibt noch mehr Seiten"-Zustand.

Warum das den Defekt ausmacht: laut Auftrag ist gemessen `meta = {"total_results":212,"total_pages":5,"page_size":50}` fuer mindestens einen `record_type`. Mit `page[size]=250` (siehe D3) faellt Telnyx serverseitig auf `page_size=50` zurueck (gemessen, s. Kontext), der Code liest aber weder `meta` noch `page[number]` aus - Seiten 2-5 sind fuer den Code unerreichbar. Aeltere Anrufe (deren Belege auf spaeteren Seiten liegen) werden strukturell nie gefunden.

### D3 - Fail-closed-Sicherung ist tot (Schwelle 250 vs. Telnyx-Deckel 50)

`src/telephony/adapters/telnyx/voice.js:44`:
```js
const COST_RECORDS_PAGE_SIZE = 250;
```
`src/telephony/adapters/telnyx/voice.js:332`:
```js
if (page.raw.length === COST_RECORDS_PAGE_SIZE) return { ok: false, reason: "page_truncated" };
```
Kommentar dazu, Zeile 42-44: "Eine Seite je Typ. Volle Seite = moeglicher Datenverlust -> fail-closed (ok:false) statt stiller Untermenge".

Warum das den Defekt ausmacht: die Bedingung vergleicht `page.raw.length` (die tatsaechlich zurueckgelieferte Zeilenzahl) gegen die ANGEFORDERTE Groesse `250`. Telnyx deckelt serverseitig auf 50 (gemessen laut Kontext: `page[number]=2` -> `page_size` fiel unerwartet auf 20 in einer weiteren Messung). `page.raw.length` kann unter dieser Deckelung nie `250` erreichen -> die Bedingung ist bei realer Telnyx-Antwort strukturell nie wahr, der beabsichtigte fail-closed-Riegel greift nie. Test `test/telnyx-cost-records.test.js:564-569` ("volle Seite -> ok:false, reason page_truncated") pinnt genau diesen Zustand nur mit einer KUENSTLICHEN 250-Zeilen-Fixture, nicht mit dem realen 50er-Deckel - der Test beweist die Code-Logik, nicht die Wirksamkeit gegen die reale API.

### D4 - Fehlerpfad (teilweise) stumm - kein Log der Ablehnungs-URSACHE (z.B. 429/10011)

`src/telephony/adapters/telnyx/voice.js:306-321`, der `catch`-Zweig:
```js
  } catch {
    return { ok: false, reason: "provider_error" };
  }
```
Kein `console.error`/`console.warn` in diesem Zweig. `src/telephony/adapters/telnyx/errors.js:52-60` (`assertTelnyxOk`) wirft nur einen `Error` (mit `err.providerStatus`), loggt selbst nichts. `getVoiceCostRecords` (Zeile 519-524) gibt bei `!fetched.ok` sofort `return fetched;` zurueck - `logCostRecordsOk` (Zeile 353-357, "PII-freier Erfolgs-Log") wird NUR im Erfolgspfad erreicht (Aufrufstelle Zeile 539, nach dem `if (!fetched.ok) return fetched;`-Guard).

**Praezisierung gegenueber der Auftragsbeschreibung**: der Fehlerpfad ist nicht vollstaendig stumm - `src/billing/cost-truing.js:295-296` faengt den Wurf zusaetzlich ab (`catch { result = { ok: false }; }`), und `sweepAllCandidates` (Zeile 356-373) loggt am Sweep-Ende die AGGREGIERTEN Zaehler (`unbestimmt=${tally.unavailable}` etc., Zeile 364-369). D.h. dass Calls in `provider_error`/`unavailable` fielen, ist am Ende jedes Sweeps sichtbar. **Was tatsaechlich fehlt**: die URSACHE (HTTP-Status 429, Telnyx-Code 10011, welcher `recordType` betroffen war) geht in `fetchCostRecordPage`s `catch {}` (Zeile 318-320) vollstaendig verloren, bevor sie den Sweep-Log erreicht - deshalb blieb D1 (Rate-Limit) unsichtbar, obwohl die Anzahl betroffener Calls sichtbar war.

## (b) Umbau-Inventar fuer die Zielarchitektur

### DB-Migrationen
- `src/db/schema.sql` - EIN Datei-Schema, `CREATE TABLE IF NOT EXISTS` je Tabelle (idempotent), plus additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` fuer Nachzieher. Beispiel Nachzieher-Muster, Zeile 191-208 (Kommentarblock ueber `call`-Tabelle: "Forward-compat: eine bereits existierende call-Tabelle ... provider). Idempotent; frische DB = No-op").
- `src/db/migrate.js` - `applySchema(db)` liest `schema.sql` und fuehrt es per `db.exec(ddl)` aus (Mehrfach-Statement-DDL, da `query()` nur eine Anweisung je Aufruf erlaubt, Kommentar Zeile 1-8). Danach folgen benannte, einmalige Backfill-Funktionen (`backfillPeriodStart`, `backfillAccountEmailCase`, `rekeyProfilesToTenant`), dann `seedDefaults(db, tenantId)`. Oeffentlicher Einstieg: `migrate(db, tenantId)` (Zeile 137-144), ruft alle in fester Reihenfolge.
- Wer fuehrt Migrationen aus: **Boot**, nicht ein separates Skript. `src/store/pg.js:64`: `await migrate(client, BOOTSTRAP_TENANT_ID);` - laeuft beim Prozessstart des pg-Backends.
- Fuer eine neue Belegtabelle: neuer `CREATE TABLE IF NOT EXISTS <name> (...)` Block in `schema.sql`, plus ggf. `ENABLE ROW LEVEL SECURITY` (s.u.) - kein separates Migrationsdatei-System, ein Skript pro Change ist NICHT das Muster hier.

### RLS - Praezedenzfall fuer eine tenant-lose (kontoweite) Tabelle
Gefunden: `audit_log` ist bereits GENAU dieser Fall.
`src/db/schema.sql:486-495`:
```sql
-- audit_log: immutable append-only. tenant_id BEWUSST KEIN FK (muss Tenant-
-- Loeschung ueberdauern, Compliance Art. 15). Keine RLS (privilegierter Insert-Pfad).
-- WARNUNG: audit_log NIE ueber portalStore/Kunden-Reads exponieren - ohne RLS gibt
-- es hier kein Sicherheitsnetz gegen einen vergessenen tenant_id-Filter.
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_sub  TEXT,
  tenant_id  TEXT,
  action     TEXT NOT NULL,
  detail     TEXT
);
```
Kein `ENABLE ROW LEVEL SECURITY` fuer `audit_log` in der Datei (bestaetigt per grep: die RLS-Bloecke Zeile 503-529 listen `audit_log` NICHT). `tenant`/`account` sind ebenfalls RLS-frei (Kommentare in `migrate.js`: "tenant-Tabelle hat keine RLS -> keine GUC noetig", "account hat keine RLS -> keine GUC noetig").

Konsistentes Muster fuer Kostenbelege: eine eigene `cost_record`-Tabelle OHNE `tenant_id`-Spalte (der Beleg ist Telnyx-seitig kontoweit, hat gar keinen Tenant-Bezug) und OHNE RLS - analog zu `audit_log`/`tenant`/`account`.

**Sicherheitsrisiko, das der Lead entscheiden muss (nicht hier entschieden)**: `audit_log` traegt die explizite WARNUNG "NIE ueber portalStore/Kunden-Reads exponieren". Eine tenant-lose `cost_record`-Tabelle braucht DIESELBE Warnung UND muss beweisbar NIE ueber einen Tenant-gescopten Lesepfad direkt abgefragt werden - die Zuordnung zu einem Call/Tenant darf ausschliesslich ueber einen serverseitigen Join mit der (RLS-geschuetzten) `call`-Tabelle laufen, nie durch direkte Tenant-Anfragen an `cost_record`. Ohne diese Disziplin waere die neue Tabelle ein RLS-Loch: jeder Tenant koennte per SQL-Injection/Bug potenziell fremde Kostenbelege (inkl. evtl. sensibler Metadaten anderer Kunden) sehen, weil keine DB-Policy das verhindert - die Isolationslinie liegt dann vollstaendig im Anwendungscode (Join-Bedingung), nicht in der DB.

### Sweep-Intervall
`src/billing/cost-truing.js:36`:
```js
export const COST_TRUING_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
```
Registriert in `src/boot.js:318-324`:
```js
setInterval(
  () =>
    void costTruing
      .runCostTruingSweep({ trigger: SWEEP_TRIGGER.INTERVAL })
      .catch((e) => console.error("[cost-truing]", e.message)),
  COST_TRUING_SWEEP_INTERVAL_MS,
).unref();
```
Kein Lauf beim Boot selbst (bewusst, Kommentar Zeile 303-309 in `boot.js`: "BEWUSSTE ABWEICHUNG ... KEIN Lauf beim Boot ... Ein haengender CDR-Abruf duerfte nie an der Boot-Sequenz haengen").

### Manueller Sweep-Endpunkt
`src/routes/api-billing.js:81-86`:
```js
router.post("/api/billing/cost-truing/sweep", async (req, res) => {
  const result = await costTruing.runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  audit("cost_truing_sweep", req, `skipped=${result.skipped} deckung=${result.coveragePercent ?? "-"}%`);
```
Absicherung: Kommentarblock Zeile 24-30 der Datei: "Hinter der bestehenden `/api/*`-Basic-Auth (server.js deckt `/api/*` ab). BEWUSST KEIN MCP-Tool (kein offener ungegateter Geld-Endpunkt, R4)." - d.h. Basic-Auth-Middleware in `server.js` deckt `/api/*` global ab, kein zusaetzliches Gate im Route-File selbst noetig, kein MCP-Tool-Wrapper vorhanden.

### Config-/Env-Variablen (Namespace `config.billing`)
Zentrale Definition in `src/config.js`, Namespace-Liste `src/config.js:1035` (`billing: [...]`) enthaelt u.a. alle unten genannten Keys. Werte + heutiger Default aus `.env.example`:
- `COST_TRUING_DELAY_MINUTES` = 180 (Aufschub vor Abgleich)
- `COST_TRUING_MAX_ATTEMPTS` = 5
- `COST_TRUING_REQUIRED_RECORD_TYPES` = "" (LEER im Beispiel-Default - siehe Boot-Guard-Abschnitt (d): ein leerer Wert fuehrt zu einem FATALEN Boot-Refusal; das Produktivsystem MUSS also einen nicht-leeren Wert in der echten Render-Config gesetzt haben, das lag ausserhalb dieser read-only Pruefung)
- `COST_TRUING_MIN_COVERAGE_PERCENT` = 80
- `COST_TRUING_COVERAGE_STALL_SWEEPS` = 8
- `COST_DRIFT_WARN_PERCENT` = 50
- `COST_ALERT_DEBOUNCE_MS` = 86400000 (24h)
- `COST_CALIBRATION_MIN_SAMPLES` = 20

Alle acht sind in `render.yaml` referenziert (Zeilen 197-220, `- key: COST_...` je Variable, keine Werte im Blueprint selbst - Render-Dashboard-managed).

**NICHT** env-konfigurierbar (bewusste Code-Konstanten, keine `COST_RECORD_TYPES`/`COST_RECORDS_PAGE_SIZE`-Env-Variable existiert):
- `COST_RECORD_TYPES` - `src/telephony/adapters/telnyx/voice.js:38-41`, hart codiertes Array (Kommentar: "EINE Quelle des Enums (G5/G25) - exportiert, damit Tests und der Boot-Guard gegen genau diese Menge koppeln statt gegen eine Kopie").
- `COST_RECORDS_PAGE_SIZE` - `src/telephony/adapters/telnyx/voice.js:44`, modul-lokale Konstante `250`.

### Tests, die heutiges Verhalten pinnen
- `test/telnyx-cost-records.test.js` - Adapter-Ebene (`getVoiceCostRecords`). Pinnt: alle 7 `record_type` werden abgefragt (Zeile 278ff), die zweistufige Anker/Session-Zuordnung inkl. Ablehnungsfaelle (`currency_mismatch`, `session_unresolved`, `session_mismatch`, Zeile 386-460), die `via_*`-Log-Zeile (Zeile 536-559), sowie `page_truncated` bei EXAKT `COST_RECORDS_PAGE_SIZE`-Zeilen (Zeile 564-569, s. D3-Hinweis: die Fixture erzeugt kuenstlich 250 Zeilen, testet also die Code-Bedingung, nicht die reale 50er-Telnyx-Deckelung). **Fixture-Disziplin (LCT-FIX-1-Lehre)**: die Fixtures (Zeile 87-104, `ID_FIELDS_BY_RECORD_TYPE`) tragen bewusst ZUSAETZLICHE Decoy-Felder `telnyx_leg_id`/`call_leg_id` NEBEN den echten Ankern, um zu beweisen, dass der Code diese NICHT als Zuordnungskriterium nutzt - das sind keine erfundenen Match-Felder mehr, sondern gezielte Gegenproben. Ein Umbau muss diese Decoy-Assertions erhalten oder bewusst ersetzen, sonst verliert die Suite genau die Absicherung, an der die Kette zweimal gescheitert ist.
- `test/cost-truing-observe.test.js` - `cost-truing.js`-Ebene mit GESTUBBTEM `voiceControl` (kein echter Fetch-Zaehler). Pinnt u.a.: Idempotenz bei ueberlappenden Laeufen (Fall g), Coverage-Berechnung (Fall i), Entprellung von Befund-SMS (P5-Faelle), `unavailable` vs. gemessen-Null (Fall k), byte-identische `usage`-Achsen bei erfolglosem Sweep (P5-S7). **Deckt D1 NICHT ab**: da der Adapter gestubbt ist, zaehlt kein Test die tatsaechlichen HTTP-Requests ueber mehrere Kandidaten hinweg - die 7x-Multiplikation ist eine Eigenschaft des ECHTEN Adapters, nicht dieser Suite.
- `test/cost-truing-booking.test.js`, `test/cost-truing-booking-guard.test.js` - Buchungslogik (`applyCostCorrectionCents`-Aufrufkette) bzw. der Boot-Guard (`costTruingBookingFindings`).
- `test/cost-drift-boot.test.js`, `test/voice-tariff-full-cost-guard.test.js` - Boot-Gate-Verhalten rund um Tarif-Drift/Vollkosten-Schwelle.
- `test/api-cost-truing-sweep.test.js` - der manuelle `/api/billing/cost-truing/sweep`-Endpunkt (Auth/Response-Form).
- `test/call-actual-cost-roundtrip.test.js` - Ende-zu-Ende Rundung/Waehrungs-Roundtrip Call -> `actualCostMicroCents`.
- `test/cost-calibration.test.js`, `test/api-cost-drift.test.js`, `test/api-platform-costs.test.js`, `test/f2-p8-cost-cap.test.js` - angrenzende Drift-/Kappungs-Logik, nicht direkt der Sweep-Kern.

## (c) Der Seam fuer D1

Redundanz-Punkt: `fetchAllCostRecords()` (Zeile 327-336) wird pro `trueOneCall`-Aufruf neu ausgefuehrt, obwohl sie fuer den ganzen Sweep (alle Kandidaten desselben Laufs) dieselben 7 Telnyx-Seiten liefert (kein Call-Filter serverseitig, s. D1). Der natuerliche Schnitt liegt zwischen "Belege EINMAL je Sweep holen" (neu: in `sweepAllCandidates`, VOR der Kandidaten-Schleife) und "Belege einem Call zuordnen" (bleibt pro-Call, die Anker/Session-Logik in `assignmentOutcome`/`toCostRecord` ist inhaerent call-bezogen und muss es bleiben).

Heutige Port-Signatur (`src/telephony/ports.js:113`):
```js
* @property {(params: VoiceCostRecordsParams) => Promise<VoiceCostRecordsResult>} [getVoiceCostRecords]
```
mit `VoiceCostRecordsParams = { legId, startedAt, endedAt }` (call-bezogen).

Moeglicher Schnitt (nur benannt, NICHT gebaut): eine neue Methode auf Sweep-Ebene, die EINMAL alle Rohbelege holt (z.B. `fetchAllCostRecords`-Aequivalent ohne `legId`), und `getVoiceCostRecords`/die Zuordnungslogik wird zu einer REINEN, netzfreien Funktion `assignCostRecords(rawRecords, { legId, startedAt, endedAt })`, die `cost-truing.js` fuer jeden Kandidaten gegen dieselben Rohbelege aufruft. Das verschiebt die Fetch-Verantwortung von "pro Call" zu "pro Sweep" und macht `assignmentOutcome`/`toCostRecord` (die bereits reine Funktionen sind, Zeile 251-298) direkt wiederverwendbar.

Aufrufer-Impact (grep bestaetigt): `getVoiceCostRecords` hat **GENAU EINEN Aufrufer im gesamten Repo** - `src/billing/cost-truing.js:290` (`trueOneCall`). Die im Auftrag geforderte Vorsicht ("Tools werden von Budget-Engine UND Realtime-Bridge genutzt") **trifft auf diese Methode NICHT zu** - das ist eine generische Repo-Regel fuer MCP-Tools/Port-Methoden allgemein, hier aber widerlegt durch den Grep-Befund: kein zweiter Aufrufer existiert.

Zweiter Provider: `src/telephony/adapters/twilio/voice.js` implementiert `getVoiceCostRecords` **nicht** (grep: 0 Treffer). Am Port ist die Methode `[optional]` markiert (`[getVoiceCostRecords]` in JSDoc). `cost-truing.js:283` behandelt das Fehlen bereits sauber als No-op (`typeof control.getVoiceCostRecords !== "function"` -> `skippedCalls++`, kein Wurf). Ein Umbau des Telnyx-Adapters auf einen zeitfenster-basierten Bulk-Abruf muss diesen optionalen Charakter erhalten - der Twilio-Pfad bliebe unveraendert und weiterhin uebersprungen.

## (d) Boot-Guards

`src/boot-guard.js:337-395` (`COST_TRUING_BOOKING_FINDING`, `costTruingBookingFindings`):
- **FATAL** `cost_truing_required_types_empty`: `config.billing.costTruingRequiredRecordTypes.length === 0` (Zeile 355-368). Verweigert den Boot, wenn die Pflicht-Menge leer ist.
- **FATAL** `cost_truing_required_types_unassignable`: jeder Pflicht-Typ MUSS Teil von `ASSIGNABLE_COST_RECORD_TYPES` sein - Zeile 373-386, geprueft gegen die EINE Quelle `ASSIGNABLE_COST_RECORD_TYPES` aus `voice.js:90-92` (`COST_RECORD_TYPES.filter(t => !UNASSIGNABLE_COST_RECORD_TYPES.includes(t))`).
- **WARN** `cost_truing_coverage_below_threshold`: `coveragePercent < minCoveragePercent` (Zeile 389-395), kein `exit(1)`.

Aufgerufen aus `src/boot.js:147-148` (`costTruingBookingFindings({ requiredRecordTypes: config.billing.costTruingRequiredRecordTypes, ... })`).

**Was ein Umbau davon verletzen wuerde**: die beiden FATAL-Guards koppeln HART an `COST_RECORD_TYPES`/`ASSIGNABLE_COST_RECORD_TYPES` als die EINE Quelle der moeglichen/zuordenbaren Typen (`voice.js:38-41`, `90-92`). Ein Umbau, der die Typ-Menge in eine DB-Tabelle verschiebt (z.B. dynamisch aus den tatsaechlich beobachteten `record_type`-Werten der neuen `cost_record`-Tabelle), muss diese Allowlist-Semantik (Allowlist statt Denylist, s. Kommentar Zeile 82-89 in `voice.js`) 1:1 erhalten, sonst wird die Pflicht-Menge unbemerkt erfuellbar mit einem strukturell unzuordenbaren Typ (Rueckfall auf den Zustand vor LCT-FIX-1). Ebenso haengt `costTruingCoveragePercent` (`cost-truing.js:68-73`) am Feld `call.costTruedSource === COST_TRUING_SOURCE.DETAIL_RECORDS` - ein Umbau der Zuordnung darf dieses Feld/diesen Wert nicht stillschweigend umbenennen, sonst rechnet der Boot-Guard weiterhin (falsch) mit der alten Semantik.

Kein Boot-Guard prueft `COST_RECORDS_PAGE_SIZE` oder Tarif-Werte im Kontext dieses Sweeps direkt (Tarif-Drift-Guards `voiceTariffFloorFindings` in `boot-guard.js:161-176` sind ein GETRENNTER Mechanismus fuer `VOICE_TARIFF_DOMESTIC_CENTS` vs. Vollkosten-Schwelle, nutzt aber dieselbe `coveragePercent`-Quelle).

## (e) Schaetzung vs. Ist - Reihenfolge der Geldbewegungen

1. **Sofort bei Call-Ende** (`src/telephony/call-finish.js:39-53`, `finishCall`):
   - Zeile 48: `if (config.billing.paymentEnabled) metering.recordVoiceMinuteMeter(call);` (Stripe-Meter, nur bei aktivem Payment)
   - Zeile 49: `metering.reconcileOutboundVoiceBudget(call); // ... IMMER`
   - Innerhalb `reconcileOutboundVoiceBudget` (`src/billing/metering.js:54-70`):
     ```js
     const estimatedCostCents = minutes * tariffCentsPerMin(call.to);
     store.addVoiceUsageCostCents(call.tenantId, estimatedCostCents);   // Budget SOFORT belastet
     store.recordCallEstimatedCostCents(call.id, estimatedCostCents);   // Schaetzung am Call persistiert
     ```
     `recordCallEstimatedCostCents` schreibt `call.estimatedCostCents` in `src/store/state-ops.js:442-444` (nur einmal: `call.estimatedCostCents !== null` blockt Zweitschreiben).

2. **Fruehestens `COST_TRUING_DELAY_MINUTES` (Default 180 min) spaeter, im naechsten 6h-Sweep** (`src/billing/cost-truing.js`):
   - `isTruingCandidate` (Zeile 101-107) selektiert faellige, noch nicht abgeglichene Calls.
   - `trueOneCall` (Zeile 270-322) holt `getVoiceCostRecords`, klassifiziert (`classifyRecords`), und ruft bei `measured` (Zeile 320) `bookCorrectionFor(call, measured)`.
   - `bookCorrectionFor` (Zeile 259-268) ruft `store.applyCostCorrectionCents(call.tenantId, { actualCostMicroCents, estimatedCostCents: call.estimatedCostCents, providerToBucketRateMicro, dataComplete: refundProven(call, measured) })`.
   - `applyCostCorrectionCents` (`src/store/state-ops.js:1900-1917`) rechnet `deltaCents = bucketCents - estimatedCostCents` und bucht darauf **asymmetrisch**:
     - `deltaCents > 0` (Ist teurer als Schaetzung) -> **immer** gebucht, auf **beide** Budget-Achsen (Monat + Lebenszeit) - Nachforderung ist bedingungslos.
     - `deltaCents < 0` (Ist billiger) -> **nur** gebucht, wenn `dataComplete === true` (= `refundProven`, Zeile 235-241: volle Pflicht-Typ-Menge + `billedSecTotal > 0` + buchbarer Schaetzbetrag), und nur auf die Lebenszeit-Achse (`bookCostCorrectionCents`, `state-ops.js:1866-1889`, Kommentar "ACHSEN-ASYMMETRIE").

**Warum die Budget-Sperre nie blind ist**: Schritt 1 bucht IMMER einen (konservativen, aus dem konfigurierten Tarif abgeleiteten) Schaetzbetrag SOFORT - das Budget-Gate (`spendOrDeny`/`budgetExceeded`, ausserhalb dieser Datei) sieht ab diesem Moment einen belasteten Betrag, unabhaengig davon, ob/wann der Sweep je laeuft. Schritt 2 ist ausschliesslich eine SPAETERE PRAEZISIONSKORREKTUR on top - sie kann den Betrag nachtraeglich erhoehen (immer) oder senken (nur bei bewiesener Vollstaendigkeit), aendert aber nie den Umstand, dass zwischen Call-Ende und Sweep ein realer, nicht-null Betrag im Budget-Bucket steht.

## Owner-Aktionen (nicht code-messbar)

Keine - alle Punkte dieses Auftrags waren aus dem Arbeitsbaum ohne Owner-Eingriff belegbar. Fuer eine Live-Verifikation der Zielarchitektur (z.B. reale `page[number]`/`meta`-Antwortformen jenseits von Seite 1, oder der tatsaechliche produktive Wert von `COST_TRUING_REQUIRED_RECORD_TYPES`) waere ein authentifizierter, read-only API-Aufruf durch den Owner noetig - das ist explizit NICHT Teil dieses Auftrags (Lead entscheidet den Phasenplan, dieser Auftrag ist reine Code-Forensik).
