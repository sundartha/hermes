# F2 Spec — Phasen P8–P11 (Kosten, Dedup, DSGVO, Owner-Seed)

> Autoritative Scope-/Design-/Invarianten-Definition fuer die Phasen P8, P9, P10, P11.
> Basis: `master` (P0–P7 gemergt). Verbindlich VOR dem Umbrella-Doc
> `docs/strategy/f2-inbound-sms-summaries.md`. Alle Zeilennummern hier sind nur Orientierung —
> grep nach den Symbolen, uebernimm KEINE Zeilennummern in den Code (sie rotten, C2).

## Verifizierte Code-Anker (Stand master, per grep bestaetigt)

- `recordUsageEvent(s, { tenantId, callId = null, kind, quantity, costCents })` in `src/store/state-ops.js`
  (fail-closed: unbekanntes `kind` wirft). Facade: `store.recordUsageEvent({...})` (in `json.js`,
  im pg-Store-Objekt von `pg.js`, und im `store.js`-Re-Export-Block).
- `USAGE_EVENT_KIND.SMS === "sms"` in `src/store/defaults.js` (bereits definiert, NIRGENDS emittiert).
  In `src/server.js` ist `USAGE_EVENT_KIND` bereits importiert.
- usageEvents-Eintrag: `{ id, tenantId, callId, kind, quantity, costCents, occurredAt (ISO), stripeMeterSent }`.
- `planSummarySms(store, config, call)` in `src/sms-summary.js` ist die EINE Sende-Entscheidung
  (reine Lese-Funktion, offline testbar). Liefert `{ to, smsFrom, send, reason }`. `finishCall`
  (`src/server.js`) ruft sie; der Versand passiert im `if (plan.send)`-Block, der bestehende
  `else if (plan.reason)`-Zweig macht `audit("sms_summary_skipped", null, \`call=${call.id} reason=${plan.reason}\`)`.
- Kosten-Config-Konvention: `voiceMinuteCostCents` / `numberSetupFeeCents` defaulten auf `0` via
  `numEnv(...)` in `src/config.js`. `config.allowedCountryCodes` default `+49,+33,+44`.
- `createCall(s, {...})` baut das Call-Objekt in `state-ops.js`. `publicCall({ streamToken, _finished, ...rest })`
  in `src/store/views.js` strippt interne Felder fuer API-Antworten.
- `exportTenantData(s, tenantId)` liefert `{ tenantId, exportedAt, calls, actionItems, notifications }`.
  `eraseTenantData(s, tenantId)` liefert den `removed`-Zaehler `{ calls, transcriptSegments, actionItems, notifications }`;
  beide nutzen `tenantCallScope`; `findTenant(s, tenantId)` ist die Tenant-Finder-Quelle.
- `tenantPrivateNumber(s, tenantId)` (Reader, `?? null`) und `setPrivateNumber`/`normalizePrivateNumber`
  existieren bereits (P1). `seedOwnerNumberFromConfig(s, e164, tenantId, provider)` ist das idempotente
  Boot-Seed-Muster, aufgerufen via `ops.` in `json.js` (finishLoad) UND `pg.js` (init). `normNum`, `E164`,
  `OWNER_TENANT_ID` sind in `state-ops.js` bereits in Scope.
- `_finished` wird vom json-`save()` (rohes `JSON.stringify(state)`) mit-persistiert; pg flusht NUR
  strukturierte Spalten. Darum ist der PERSISTENTE Marker `summarySmsSentAt` die backend-uebergreifend
  korrekte Dedup-Quelle (P9), nicht das In-Memory-`_finished`.

## Querschnitt-Regeln (alle Phasen)

- **PII-Dichtheit:** Nummern NIE in Logs/Audit/`/api/state`/MCP/settings. Audit nur Key + Reason-Marker.
- **Store-Facade-Re-Export-Lücke:** jede NEU ueber `store.<fn>` aufgerufene Funktion MUSS in ALLE drei
  Schichten: `state-ops.js` (Kernlogik) + `json.js` (Wrapper) + pg-Store-Objekt in `pg.js` (Wrapper) +
  `store.js` Re-Export-Block. Sonst Laufzeit-`undefined` (Tests mit Direkt-Backend maskieren es).
- **G5 / kein Drift:** Sende-Entscheidung lebt in `planSummarySms`; Schreib-Seiteneffekte (recordUsageEvent,
  Marker setzen) in `finishCall`. `state-ops` bleibt IO-frei (kein `console`, kein `save`).
- Beide Backends (`json` + pglite-`pg`) muessen `node --test` gruen halten. Neues Verhalten -> neuer Test.
- Clean-Code: keine Magic Numbers (benannte Config/Konstante), Kommentare deutsch OHNE Umlaute.

---

## P8 — Kosten-Schutz (Tages-Cap + Usage-Event)

**Ziel:** Jeder erfolgreiche Summary-SMS-Versand erzeugt genau ein `recordUsageEvent({kind:"sms"})`; ein
Tages-Cap pro Tenant begrenzt die Anzahl.

**Aenderungen:**
1. `src/config.js`: zwei neue Keys via `numEnv` (Konvention spiegeln):
   - `smsDailyCap: numEnv("SMS_DAILY_CAP", process.env.SMS_DAILY_CAP, { fallback: 10, min: 0 })`
   - `smsCostCents: numEnv("SMS_COST_CENTS", process.env.SMS_COST_CENTS, { fallback: 0, min: 0 })`
     (Default 0 = kein Billing im Prototyp, identisch zu voiceMinuteCostCents/numberSetupFeeCents).
2. `src/store/state-ops.js`: neue REINE Query
   `smsSentTodayCount(s, tenantId, nowIso = new Date().toISOString())` — zaehlt `s.usageEvents` mit
   `kind === USAGE_EVENT_KIND.SMS && e.tenantId === tenantId && e.occurredAt.slice(0,10) === nowIso.slice(0,10)`
   (gleicher UTC-Kalendertag, DST-frei). Kein `save`.
3. Facade fuer die Query: `json.js` (`smsSentTodayCount(tenantId){ return ops.smsSentTodayCount(load(), tenantId) }`),
   pg-Store-Objekt in `pg.js` analog (mit `requireState()`), und in den `store.js` Re-Export-Block aufnehmen.
4. `src/sms-summary.js` — Cap-Check in `planSummarySms` (bleibt die EINE Sende-Entscheidung, offline testbar):
   nach den bestehenden Guards, VOR `send:true`:
   `if (store.smsSentTodayCount(call.tenantId) >= config.smsDailyCap) return { to, smsFrom, send: false, reason: "daily_cap" };`
   Der Cap-Audit faellt damit automatisch durch den bestehenden `else if (plan.reason)`-Zweig in `finishCall`
   (`audit("sms_summary_skipped", null, "... reason=daily_cap")`, PII-frei). Das erfuellt „Cap-Check VOR dem
   Send" woertlich, weil `planSummarySms` vor dem Send laeuft und sein Ergebnis den Send gated (G5: eine Stelle).
5. `src/server.js` — Usage-Event NACH erfolgreichem Send: im `if (plan.send)`-Block, INNERHALB des `try`,
   NACH dem erfolgreichen `await messaging(call.provider).sendSms({...})` (NICHT im `catch` — fehlgeschlagene
   Sends NICHT abrechnen):
   `store.recordUsageEvent({ tenantId: call.tenantId, callId: call.id, kind: USAGE_EVENT_KIND.SMS, quantity: 1, costCents: config.smsCostCents });`

**Akzeptanz (Tests, beide Backends):**
- Jeder erfolgreiche Send -> genau ein SMS-Usage-Event (richtige tenantId/callId/kind, quantity 1, costCents=config.smsCostCents).
- `smsSentTodayCount`: zaehlt nur heutige SMS-Events des Tenants; gestrige/fremde/andere-kind zaehlen nicht.
- Cap erreicht (`>= smsDailyCap`) -> `planSummarySms` liefert `send:false, reason:"daily_cap"`; kein Send;
  `audit("sms_summary_skipped", … reason=daily_cap)`. N+1 Sends/Tag -> hoechstens N.
- Keine Nummer in Audit/Log.

---

## P9 — Dedup persistent (summarySmsSentAt)

**Ziel:** Genau eine Summary-SMS pro Call — auch wenn das In-Memory-`_finished` durch einen Prozess-Restart
zwischen zwei `completed`-Callbacks verloren geht.

**Aenderungen:**
1. `src/store/state-ops.js` `createCall`: `summarySmsSentAt: null` ins initiale Call-Objekt aufnehmen
   (z.B. neben `summary`/`objectiveAchieved`).
2. `src/sms-summary.js` `planSummarySms`: frueher Guard (vor `no_private_number`), damit ein bereits
   versendeter Call NIE erneut sendet:
   `if (call.summarySmsSentAt) return { to, smsFrom, send: false, reason: null };`
   (reason null — kein „Ziel fehlt"-Fall, kein per-Tenant-Audit noetig).
3. `src/server.js` `finishCall`: NACH erfolgreichem Send (im `try`, nach dem `await sendSms`), VOR dem
   Usage-Event (P8): `call.summarySmsSentAt = new Date().toISOString();`. Persistenz: das `recordUsageEvent`
   der Facade ruft intern `save()` und persistiert damit das mutierte Call-Objekt mit (call ist eine Referenz
   in `store.load().calls`). (Wenn P8 noch nicht eingebaut ist: explizit `store.save()` nach dem Marker.)
4. `src/store/views.js` `publicCall`: `summarySmsSentAt` zusaetzlich strippen (analog `_finished`):
   `publicCall({ streamToken, _finished, summarySmsSentAt, ...rest })`.

**Akzeptanz (Tests, beide Backends):**
- `planSummarySms` liefert `send:false` wenn `call.summarySmsSentAt` gesetzt ist (unabhaengig von `_finished`).
- Integration: `finishCall` -> Send #1 erfolgt; danach `delete call._finished` (simulierter Restart, In-Memory-
  Flag weg); `finishCall` erneut -> KEIN zweiter Send (der persistente Marker gated). Genau EINE SMS.
- `publicCall(call)` enthaelt KEIN `summarySmsSentAt` (und kein `_finished`/`streamToken`).

---

## P10 — DSGVO Export/Erase (privateNumber)

**Ziel:** `privateNumber` ist in `exportTenantData` (Art. 15) enthalten und wird von `eraseTenantData`
(Art. 17) entfernt — OHNE den Tenant-Record selbst zu loeschen.

**Aenderungen (`src/store/state-ops.js`):**
1. `exportTenantData`: `privateNumber: tenantPrivateNumber(s, tenantId)` ins Rueckgabe-Objekt aufnehmen
   (Reader-Wiederverwendung, eine Quelle — liefert E.164 oder `null`).
2. `eraseTenantData`: nach den call-scoped Loeschungen den Tenant holen und NUR die `privateNumber`
   entfernen (NICHT den Record loeschen — `firstName`/`ownerName`/`kycLevel` etc. bleiben):
   ```
   const tenant = findTenant(s, tenantId);
   removed.privateNumber = tenant && tenant.privateNumber != null ? 1 : 0;
   if (tenant) delete tenant.privateNumber;
   ```
   Initiales `removed`-Objekt um `privateNumber: 0` ergaenzen (stabile Form).

**Akzeptanz (Tests, beide Backends):**
- set privateNumber -> `exportTenantData.privateNumber` == der Wert.
- nach `eraseTenantData`: `tenantPrivateNumber(tenantId) === null`, `exportTenantData.privateNumber === null`,
  Tenant-Record existiert weiter (z.B. `findTenant` != null, `ownerName`/`firstName` intakt), `removed.privateNumber === 1`.
- Ohne gesetzte Nummer: `removed.privateNumber === 0`, kein Throw.

---

## P11 — Owner-Seed (privateNumber aus config.ownerNumber)

**Ziel:** Der Owner-Tenant bekommt seine `privateNumber` idempotent aus `config.ownerNumber` geseedet, sodass
die Owner-Summary-SMS-Kontinuitaet erhalten bleibt (M5). Kein Fallback in `finishCall` (P7 bleibt unveraendert).

**Aenderungen:**
1. `src/store/state-ops.js`: neue Funktion `seedOwnerPrivateNumberFromConfig(s, e164, tenantId)` — analog
   `seedOwnerNumberFromConfig`, IO-frei (kein `save`, kein `console`):
   - Tenant via `findTenant(s, tenantId)`; fehlt -> No-Op (defensiv, kein Throw beim Boot).
   - IDEMPOTENT: `if (tenant.privateNumber) return;` (vorhandene Nummer gewinnt).
   - Leeres `e164` -> No-Op.
   - `const norm = normNum(e164); if (E164.test(norm)) tenant.privateNumber = norm;` — KEIN `countryAllowed`-Gate
     (die Owner-Nummer ist vertrauenswuerdige Operator-Config; das Land-Gate ist nur fuer Self-Service/Toll-Fraud,
     und `allowedCountryCodes` koennte das Owner-Land nicht enthalten). Ungueltiges E.164 -> NICHT setzen, kein
     Throw (die Boot-Warnung faengt den Leer-Fall). Fail-safe beim Boot.
2. Boot-Aufruf in `src/store/json.js` (`finishLoad`, nach `seedOwnerNumberFromConfig`) UND `src/store/pg.js`
   (`init`, in der `withClient`-Sequenz nach `seedOwnerIdentity`, VOR dem `save()`/Flush, damit `private_number`
   round-trippt): `ops.seedOwnerPrivateNumberFromConfig(state, config.ownerNumber, OWNER_TENANT_ID);`
   - pg: sicherstellen, dass nach dem Seed geflusht wird (die `private_number`-Spalte existiert bereits in
     hydrate/flush aus P3). Ggf. die `save()`-Bedingung erweitern, falls sie nur an `ownerName` haengt.
3. Boot-Warnung (PII-frei): nach dem Seed, wenn der Owner DANACH immer noch keine `privateNumber` hat ->
   `console.warn("[boot] Owner ohne private Summary-Nummer - Owner-Summary-SMS deaktiviert (OWNER_NUMBER setzen)")`.
   KEINE Nummer in der Meldung. Message als benannte Konstante halten, um Drift zwischen json.js/pg.js zu
   vermeiden (z.B. exportierte Konstante aus state-ops/defaults). `console.warn` (NICHT error) — den getesteten
   Boot-Failclosed-Kontrakt (zwei `[boot]`-`console.error`-Zeilen in server.js) NICHT anfassen.

**Akzeptanz (Tests, beide Backends):**
- Owner mit gesetztem `config.ownerNumber` -> nach Boot/finishLoad: `tenantPrivateNumber(OWNER_TENANT_ID) === normNum(config.ownerNumber)`.
- Idempotenz: bereits gesetzte `privateNumber` wird durch erneuten Seed NICHT ueberschrieben.
- Owner nach Seed leer (leere/ungueltige ownerNumber) -> `console.warn` (kein Crash, kein Throw).
- `finishCall`/`planSummarySms` (P7) bleiben unveraendert.
