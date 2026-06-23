// Postgres-Store-Backend hinter STORE_BACKEND=pg. Haelt einen synchron
// gespiegelten In-Memory-Zustand (gleicher Shape wie das json-Backend), der bei
// init() einmal aus der DB hydriert wird; jede Mutation laeuft synchron gegen den
// Spiegel (state-ops.js, geteilte Fachlogik) und stoesst danach einen DB-Flush an.
//
// WARUM der Spiegel: die Store-Signaturen sind synchron und werden von den
// Callern teils ohne await aufgerufen (Bridge-Event-Handler, store.save()). pg ist
// async. Der Spiegel ist die kleinste Aenderung, die Contract-Parity zum
// json-Backend erreicht, ohne eine der Signaturen oder einen Caller zu
// veraendern. save() ist deshalb KEIN No-Op: die mutate-then-save()-Stellen
// (call.twilioSid/summary/objectiveAchieved) wirken auf eine Spiegel-Referenz aus
// getCall(); save() flusht den Spiegel zurueck in die DB.
//
// AKZEPTIERTES RESTRISIKO (P3b, single-tenant/ein-Prozess): bei mehreren
// Prozessen kann der Spiegel von der DB driften - gleichwertig zur heutigen
// json-Annahme (ein Prozess haelt den Zustand). Multi-Prozess-Korrektheit ist
// spaeterer Scope, nicht P3b.
import { config } from "../config.js";
import * as ops from "./state-ops.js";
import { OWNER_TENANT_ID, DEFAULT_PROVIDER } from "./defaults.js";
import { migrate } from "../db/migrate.js";

// Owner-Tenant zentral in defaults.js; hier re-exportiert, weil Tests + pg-helpers
// die Konstante historisch von store/pg.js importieren (Import-Stabilitaet).
export { OWNER_TENANT_ID };

// makePgStore(runner) -> Objekt mit den Store-Funktionen (Namensliste in store.js).
// runner-Vertrag:
//   withClient(fn) : ruft fn(client) auf EINER Verbindung; client.query(text,
//                    params)->{rows} und client.exec(sqlScript) (Mehrfach-DDL).
// KEINE DB-Verbindung hier konstruiert (DIP): Pool/Adapter wird injiziert. init()
// muss vor dem ersten Zugriff erwartet werden (Migration + Hydrierung).
export function makePgStore(runner) {
  let state = null;
  // Serialisiert die DB-Flushes: Mutationen rufen save() synchron, der DB-Write
  // wird an diese Kette gehaengt, damit Flushes nicht ineinander laufen.
  let flushChain = Promise.resolve();

  function requireState() {
    if (!state) throw new Error("pg-Store nicht initialisiert - erst await store.init() aufrufen");
    return state;
  }

  // Migriert + hydriert den Spiegel einmalig aus der DB. Schema/Seeding/Hydrierung
  // laufen auf EINER Verbindung (withClient), damit die RLS-GUC waehrend der
  // tenant-scoped Reads/Inserts gesetzt bleibt (auf einem Pool waere sonst jede
  // Anweisung eine andere Session). Die GUC wird VOR dem Seeding gesetzt, sonst
  // wuerde die RLS-WITH-CHECK die Owner-Inserts unter einer nicht-privilegierten
  // DB-Rolle blocken.
  async function init() {
    await runner.withClient(async (client) => {
      await setTenant(client, OWNER_TENANT_ID);
      await migrate(client, OWNER_TENANT_ID);
      state = await hydrate(client);
      // Owner-Identitaet config-derived seeden (Variante a, G1): owner_name hydriert
      // als NULL -> ohne Seed bliebe der Owner namenlos. Idempotent (gesetzter Wert
      // gewinnt). Persistenz via save() unten, damit first_name/owner_name
      // round-trippen (flushTenants).
      ops.seedOwnerIdentity(state, config.ownerFirstName, config.ownerLastName, OWNER_TENANT_ID);
    });
    // Nur flushen, wenn der Seed tatsaechlich einen ownerName gesetzt hat (leere
    // Config -> Boot-Refusal greift ohnehin vorher, kein Leer-Flush). save() wird
    // AWAITED: init() ist async und der Flush teilt sich die Verbindung mit den
    // folgenden Zugriffen (pglite = eine Verbindung) -> ein nicht-erwarteter Flush
    // wuerde mit dem ersten Folge-Query um die Transaktion konkurrieren.
    if (state.tenants.some((t) => t.id === OWNER_TENANT_ID && t.ownerName)) await save();
    return state;
  }

  // Flusht den kompletten Spiegel in die DB (eine Transaktion auf einer
  // Verbindung, RLS-GUC gesetzt). Full-Upsert + Delete-Missing spiegelt das
  // heutige json-Verhalten (kompletter Datei-Rewrite pro save) und macht jeden
  // mutate-then-save()-Pfad korrekt. save() wird synchron gerufen; der DB-Write
  // haengt an flushChain, damit Flushes nicht ineinander laufen.
  function save() {
    const snapshot = requireState();
    flushChain = flushChain
      .then(() => runner.withClient((client) => flush(client, snapshot)))
      .catch((err) => {
        console.error("[pg] Flush fehlgeschlagen:", err.message);
      });
    return flushChain;
  }

  return {
    init,
    load: () => requireState(),
    save,
    newId: ops.newId,

    createCall(input) {
      const call = ops.createCall(requireState(), input);
      save();
      return call;
    },
    getCall: (id) => ops.getCall(requireState(), id),
    addTranscript(callId, role, text) {
      if (ops.addTranscript(requireState(), callId, role, text)) save();
    },
    purgeTranscript(callId) {
      if (ops.purgeTranscript(requireState(), callId)) save();
    },
    markAnswered(callId) {
      const { call, changed } = ops.markAnswered(requireState(), callId);
      if (changed) save();
      return call;
    },
    endCallRecord(callId, status = "completed") {
      const { call, changed } = ops.endCallRecord(requireState(), callId, status);
      if (changed) save();
      return call;
    },
    countOutboundCallsSince: (sinceIso, filters = {}) =>
      ops.countOutboundCallsSince(requireState(), sinceIso, filters),
    findTenantByNumber: (e164) => ops.findTenantByNumber(requireState(), e164),
    // Schwester-Query + Sprach-Aufloesung (F1 Phase 4). Reine Leser auf dem Spiegel.
    numberRecordByE164: (e164) => ops.numberRecordByE164(requireState(), e164),
    resolveCallLanguage: (args) => ops.resolveCallLanguage(requireState(), args),

    addActionItem(callId, text, type = "todo") {
      const item = ops.addActionItem(requireState(), callId, text, type);
      save();
      return item;
    },
    toggleActionItem(id) {
      const item = ops.toggleActionItem(requireState(), id);
      if (item) save();
      return item;
    },

    getCalendar: (tenantId) => ops.getCalendar(requireState(), tenantId),
    addCalendarEvent(tenantId, title, startIso, endIso) {
      const ev = ops.addCalendarEvent(requireState(), tenantId, title, startIso, endIso);
      save();
      return ev;
    },
    findConflict: (tenantId, startIso, endIso) => ops.findConflict(requireState(), tenantId, startIso, endIso),

    // Tenant-Kontext-Seam (I0): liest den hydrierten Spiegel (kein DB-Roundtrip),
    // config.ownerName als Owner-Fallback (Wrapper-Parity zu json.js).
    tenantContext: (tenantId) => ops.tenantContext(requireState(), config.ownerName, tenantId),

    trackUsage(tenantId, inputTokens, outputTokens, cfg) {
      const usage = ops.trackUsage(requireState(), tenantId, inputTokens, outputTokens, cfg);
      save();
      return usage;
    },
    budgetExceeded: (tenantId, cfg) => ops.budgetExceeded(requireState(), tenantId, cfg),
    globalBudgetExceeded: (cfg) => ops.globalBudgetExceeded(requireState(), cfg),
    // Lese-Zugriff auf den Usage-Bucket eines Tenants (I5): liest den Spiegel
    // (kein DB-Roundtrip), Wrapper-Parity zu json.js. Reine Query, kein save.
    usageOf: (tenantId) => ops.usageOf(requireState(), tenantId),

    // ---- Per-Tenant-Budget + Metering (P6b3): Wrapper-Parity zu json.js ----
    setTenantBudget(tenantId, amounts) {
      const row = ops.setTenantBudget(requireState(), tenantId, amounts);
      save();
      return row;
    },
    recordUsageEvent(input) {
      const event = ops.recordUsageEvent(requireState(), input);
      save();
      return event;
    },
    pendingMeterEvents: () => ops.pendingMeterEvents(requireState()),
    markMeterEventsSent(eventIds) {
      const n = ops.markMeterEventsSent(requireState(), eventIds);
      if (n) save();
      return n;
    },

    // ---- KYC (P6b4): Wrapper-Parity zu json.js ----
    setKycLevel(tenantId, level) {
      const tenant = ops.setKycLevel(requireState(), tenantId, level);
      save();
      return tenant;
    },
    kycReached: (tenantId, minLevel) => ops.kycReached(requireState(), tenantId, minLevel),

    // ---- Stripe-Customer/Karte pro Tenant (Pay1): Wrapper-Parity zu json.js ----
    setTenantStripe(tenantId, patch) {
      const tenant = ops.setTenantStripe(requireState(), tenantId, patch);
      save();
      return tenant;
    },
    tenantStripe: (tenantId) => ops.tenantStripe(requireState(), tenantId),

    // ---- Private Summary-Nummer pro Tenant (F2): Wrapper-Parity zu json.js ----
    setPrivateNumber(tenantId, raw) {
      const tenant = ops.setPrivateNumber(requireState(), tenantId, raw);
      save();
      return tenant;
    },
    tenantPrivateNumber: (tenantId) => ops.tenantPrivateNumber(requireState(), tenantId),

    // ---- Geo-Location pro Tenant (F1): Wrapper-Parity zu json.js ----
    setTenantGeo(tenantId, patch) {
      const tenant = ops.setTenantGeo(requireState(), tenantId, patch);
      save();
      return tenant;
    },

    addNotification(title, body, callId) {
      ops.addNotification(requireState(), title, body, callId);
      save();
    },

    // Owner-/Bestandsnummer direkt 'active' eintragen (CLI scripts/seed-owner-number.js):
    // die EINE legitime Ausnahme zur Transition-Kette (idempotent ueber normNum). Der
    // neue Spiegel-Eintrag wird vom save()->flushTenantScope->flushNumbers persistiert.
    seedOwnerNumber(e164, tenantId, provider) {
      ops.seedOwnerNumber(requireState(), e164, tenantId, provider);
      return save();
    },

    // Default = config.retentionDays, identisch zum json-Backend: der einzige
    // Produktiv-Caller (server.js) ruft no-arg. Ohne diesen Default waere die
    // DSGVO-Retention unter STORE_BACKEND=pg still abgeschaltet (Absolute Regel).
    pruneOldData(days = config.retentionDays) {
      const removed = ops.pruneOldData(requireState(), days);
      if (removed.calls || removed.notifications || removed.actionItems) save();
      return removed;
    },

    // Per-Tenant-DSGVO-Loeschung (Art. 17): mutiert den Spiegel (call-verknuepfte
    // Daten des Tenants raus), der bestehende Flush reconciled die DB tenant-scoped
    // (deleteMissing mit leerer keep-Liste -> DELETE WHERE tenant_id; transcript_
    // segment per ON DELETE CASCADE). KEIN eigenes DELETE noetig.
    eraseTenantData(tenantId) {
      const removed = ops.eraseTenantData(requireState(), tenantId);
      if (removed.calls || removed.actionItems || removed.notifications) save();
      return removed;
    },
    exportTenantData: (tenantId) => ops.exportTenantData(requireState(), tenantId),

    updateSettings(tenantId, patch) {
      const result = ops.updateSettings(requireState(), tenantId, patch);
      save();
      return result;
    },

    resolveProfile: (email) => ops.resolveProfile(requireState(), email),
    // Tenant-Aufloesung (I4): liest den hydrierten Spiegel (Wrapper-Parity zu json.js).
    resolveTenant: (idpSubject) => ops.resolveTenant(requireState(), idpSubject),
    listProfiles: () => ops.listProfiles(requireState()),
    setProfile(email, patch) {
      const result = ops.setProfile(requireState(), email, patch);
      save();
      return result;
    },
    deleteProfile(email) {
      const ok = ops.deleteProfile(requireState(), email);
      if (ok) save();
      return ok;
    },
  };
}

// Setzt die RLS-GUC fuer die laufende Verbindung (session-weit). flush setzt sie
// zusaetzlich transaktionslokal.
async function setTenant(client, tenantId) {
  await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
}

// ---- Hydrierung: DB-Zeilen -> verschachtelter Spiegel-Shape (multi-tenant, I8) ----
// Laeuft auf einer Verbindung. Liest zuerst die tenant-Tabelle (state.tenants), dann
// pro Tenant unter dessen RLS-GUC die tenant-scoped Zeilen in die Buckets/Listen.
// makeDefaultState() EINMAL (Owner-Buckets vorbelegt); pro Tenant werden Buckets
// gefuellt (settings/calendar/usage) bzw. Listen angehaengt (calls/actionItems/
// notifications/numbers). profiles bleiben global keyed-by-email (geerbte
// Entscheidung #9) und werden NUR unter dem Owner geladen.
async function hydrate(client) {
  const state = ops.makeDefaultState();
  state.tenants = await hydrateTenants(client);
  for (const tenant of state.tenants) {
    await setTenant(client, tenant.id);
    await hydrateTenantInto(client, state, tenant.id);
  }
  return state;
}

// tenant-Tabelle -> Tenant-Records. owner_name/idp_subject NUR setzen, wenn in der
// DB nicht-null (sonst kippte der config.ownerName-Fallback im tenantContext und es
// entstuende ein leeres ownerName-Feld). Der Owner ist immer enthalten (seedDefaults
// garantiert die Zeile). KEINE GUC noetig - die tenant-Tabelle hat keine RLS.
async function hydrateTenants(client) {
  const rows = (await client.query(
    `SELECT id, status, owner_name, first_name, idp_subject, kyc_level, stripe_customer_id, stripe_payment_method_id, country, default_language, private_number FROM tenant`
  )).rows;
  return rows.map((r) => {
    const tenant = { id: r.id, status: r.status };
    if (r.owner_name != null) tenant.ownerName = r.owner_name;
    // first_name NUR-nicht-null hydrieren (Muster wie owner_name, G1): Tenant ohne
    // Wert behaelt KEIN leeres Feld -> firstName-Ableitung im tenantContext greift.
    if (r.first_name != null) tenant.firstName = r.first_name;
    if (r.idp_subject != null) tenant.idpSubject = r.idp_subject;
    // kyc_level NUR setzen, wenn nicht-null (Muster wie owner_name/idp_subject):
    // ein Owner/Bestand ohne Wert behaelt KEIN kycLevel-Feld -> kycReached liefert
    // true (byte-identisch zum json-Pfad, kein null-Feld-Drift, R6).
    if (r.kyc_level != null) tenant.kycLevel = r.kyc_level;
    // Pay1: nur-nicht-null hydrieren (Muster wie kyc_level) -> Tenant ohne Karte
    // behaelt KEIN leeres Feld (kein Drift json<->pg, R6).
    if (r.stripe_customer_id != null) tenant.stripeCustomerId = r.stripe_customer_id;
    if (r.stripe_payment_method_id != null) tenant.stripePaymentMethodId = r.stripe_payment_method_id;
    // Geo (F1): nur-nicht-null hydrieren (Muster wie kyc_level/stripe_*) -> ein
    // Owner/Bestand ohne Wert behaelt KEIN leeres Feld (kein json<->pg-Drift, R7/R12);
    // der Code-Fallback || DE/de der Konsumenten greift.
    if (r.country != null) tenant.country = r.country;
    if (r.default_language != null) tenant.defaultLanguage = r.default_language;
    // F2: private Summary-Nummer nur-nicht-null hydrieren (Muster wie kyc_level/stripe_*/
    // geo) -> ein Tenant ohne Nummer behaelt KEIN leeres Feld (kein json<->pg-Drift, M1);
    // der Skip-Pfad in finishCall (kein Ziel -> keine SMS) greift verlaesslich.
    if (r.private_number != null) tenant.privateNumber = r.private_number;
    return tenant;
  });
}

// Liest die tenant-scoped Zeilen EINES Tenants (RLS-GUC ist gesetzt) und fuellt sie
// in den Spiegel: settings/calendar/usage in den Map-Bucket dieses Tenants, calls/
// actionItems/notifications/numbers an die globalen Listen ANGEHAENGT (nicht
// ueberschrieben - sonst verloeren frueher hydrierte Tenants ihre Daten). profiles
// NUR unter dem Owner (global keyed-by-email, geerbte Entscheidung #9).
async function hydrateTenantInto(client, state, tenantId) {
  const settingsRows = (await client.query(`SELECT * FROM settings WHERE tenant_id = $1`, [tenantId])).rows;
  const callRows = (await client.query(`SELECT * FROM call WHERE tenant_id = $1 ORDER BY seq DESC`, [tenantId])).rows;
  const segRows = (await client.query(
    `SELECT * FROM transcript_segment WHERE tenant_id = $1 ORDER BY id ASC`, [tenantId]
  )).rows;
  const itemRows = (await client.query(
    `SELECT * FROM action_item WHERE tenant_id = $1 ORDER BY seq DESC`, [tenantId]
  )).rows;
  const calRows = (await client.query(`SELECT * FROM calendar_event WHERE tenant_id = $1 ORDER BY seq ASC`, [tenantId])).rows;
  const usageRows = (await client.query(`SELECT * FROM usage WHERE tenant_id = $1`, [tenantId])).rows;
  const notifRows = (await client.query(
    `SELECT * FROM notification WHERE tenant_id = $1 ORDER BY seq DESC`, [tenantId]
  )).rows;
  const numberRows = (await client.query(
    `SELECT id, e164, tenant_id, provider, status, provider_number_id, payment_intent_id, country, language FROM number WHERE tenant_id = $1`, [tenantId]
  )).rows;
  const jobRows = (await client.query(
    `SELECT id, tenant_id, number_id, kind, status, idempotency_key, attempts, last_error
       FROM provisioning_job WHERE tenant_id = $1`, [tenantId]
  )).rows;
  const budgetRows = (await client.query(
    `SELECT tenant_id, budget_cents, hard_cap_cents FROM tenant_budget WHERE tenant_id = $1`, [tenantId]
  )).rows;
  const ueRows = (await client.query(
    `SELECT id, tenant_id, call_id, kind, quantity, cost_cents, occurred_at, stripe_meter_sent
       FROM usage_event WHERE tenant_id = $1 ORDER BY id ASC`, [tenantId]
  )).rows;

  const segmentsByCall = groupTranscripts(segRows);
  const itemIdsByCall = groupActionItemIds(itemRows);

  if (settingsRows.length) state.settings[tenantId] = rowToSettings(settingsRows[0]);
  if (usageRows.length) state.usage[tenantId] = rowToUsage(usageRows[0]);
  state.calendar[tenantId] = calRows.map(rowToCalendarEvent);
  state.calls.push(...callRows.map((r) => rowToCall(r, segmentsByCall, itemIdsByCall)));
  state.actionItems.push(...itemRows.map(rowToActionItem));
  state.notifications.push(...notifRows.map(rowToNotification));
  state.numbers.push(...numberRows.map((r) => ({
    id: r.id,
    e164: r.e164,
    tenantId: r.tenant_id,
    provider: r.provider,
    status: r.status,
    providerNumberId: r.provider_number_id,
    paymentIntentId: r.payment_intent_id ?? null,
    // Geo (F1): Bestands-Nummer ohne Wert -> null (kein undefined-Drift, Muster wie
    // payment_intent_id); der Code-Fallback || DE/de der Konsumenten greift.
    country: r.country ?? null,
    language: r.language ?? null,
  })));
  state.provisioningJobs.push(...jobRows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    numberId: r.number_id,
    kind: r.kind,
    status: r.status,
    idempotencyKey: r.idempotency_key,
    attempts: r.attempts,
    lastError: r.last_error ?? null,
  })));
  state.tenantBudgets.push(...budgetRows.map((r) => ({
    tenantId: r.tenant_id,
    budgetCents: Number(r.budget_cents),
    hardCapCents: Number(r.hard_cap_cents),
  })));
  state.usageEvents.push(...ueRows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    callId: r.call_id,
    kind: r.kind,
    quantity: Number(r.quantity),
    costCents: Number(r.cost_cents),
    occurredAt: r.occurred_at,
    stripeMeterSent: r.stripe_meter_sent,
  })));

  if (tenantId === OWNER_TENANT_ID) {
    const profileRows = (await client.query(`SELECT email, data FROM profile WHERE tenant_id = $1`, [tenantId])).rows;
    state.profiles = Object.fromEntries(profileRows.map((r) => [r.email, r.data]));
  }
}

function groupTranscripts(segRows) {
  const byCall = new Map();
  for (const r of segRows) {
    if (!byCall.has(r.call_id)) byCall.set(r.call_id, []);
    byCall.get(r.call_id).push({ role: r.role, text: r.text, at: r.at });
  }
  return byCall;
}

// action_item ist nach seq DESC sortiert (neueste zuerst, wie unshift). Die
// actionItemIds eines Calls in chronologischer Reihenfolge (aeltester push zuerst)
// -> beim Gruppieren von hinten nach vorne anfuegen.
function groupActionItemIds(itemRows) {
  const byCall = new Map();
  for (let i = itemRows.length - 1; i >= 0; i--) {
    const r = itemRows[i];
    if (r.call_id == null) continue;
    if (!byCall.has(r.call_id)) byCall.set(r.call_id, []);
    byCall.get(r.call_id).push(r.id);
  }
  return byCall;
}

function rowToSettings(r) {
  return {
    agentName: r.agent_name,
    greeting: r.greeting,
    allowCalendar: r.allow_calendar,
    allowBooking: r.allow_booking,
    allowSummaries: r.allow_summaries,
    // F2 P7: Opt-Out fuer die Summary-SMS. ?? true = Bestands-Zeilen vor dem Migrate
    // (Spalte fehlte) fallen auf Opt-In zurueck -> kein stiller SMS-Verlust (M1).
    smsSummaryOptIn: r.sms_summary_opt_in ?? true,
    allowPersonalData: r.allow_personal_data,
    allowBankData: r.allow_bank_data,
    // F1 Phase 4: optionales Override, Spalte NULLABLE. NULL -> null (nicht gesetzt);
    // die Praezedenz (resolveCallLanguage) faellt dann auf number/tenant/'de' durch.
    language: r.language ?? null,
  };
}

function rowToCall(r, segmentsByCall, itemIdsByCall) {
  return {
    id: r.id,
    // tenantId hydrieren (I8): der Flush partitioniert state.calls per call.tenantId
    // (flushTenantScope/scopeOf). Ohne dieses Feld faende der Owner-Filter nach der
    // Re-Hydrierung keinen einzigen Call (undefined !== "owner") und loeschte beim
    // naechsten Flush alle Calls des Tenants. createCall setzt tenantId bereits im
    // Spiegel (json-Parity) - hier wird es aus der DB-Spalte rekonstruiert.
    tenantId: r.tenant_id,
    streamToken: r.stream_token,
    twilioSid: r.twilio_sid,
    direction: r.direction,
    from: r.from_e164,
    to: r.to_e164,
    goal: r.goal,
    briefing: r.briefing,
    constraints: r.constraints,
    callerName: r.caller_name,
    language: r.language,
    maxDurationS: r.max_duration_s,
    requestedBy: r.requested_by,
    provider: r.provider,
    status: r.status,
    startedAt: r.started_at,
    answeredAt: r.answered_at,
    endedAt: r.ended_at,
    transcript: segmentsByCall.get(r.id) || [],
    summary: r.summary,
    objectiveAchieved: r.objective_achieved,
    actionItemIds: itemIdsByCall.get(r.id) || [],
  };
}

function rowToActionItem(r) {
  return { id: r.id, callId: r.call_id, text: r.text, type: r.type, done: r.done, createdAt: r.created_at };
}

function rowToCalendarEvent(r) {
  return { id: r.id, title: r.title, start: r.starts_at, end: r.ends_at };
}

function rowToUsage(r) {
  return {
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    costEur: Number(r.cost_eur),
    calls: Number(r.calls),
  };
}

function rowToNotification(r) {
  return { id: r.id, title: r.title, body: r.body, callId: r.call_id, at: r.at };
}

// ---- Flush: Spiegel -> DB (multi-tenant, I8). Eine Transaktion ueber den ganzen
// Spiegel. Die tenant-Tabelle wird zuerst geschrieben (kein RLS, kein GUC noetig;
// die FK-Ziele muessen vor den tenant-scoped Inserts existieren). Danach pro Tenant
// die RLS-GUC setzen und NUR dessen Scheibe flushen - exakt das owner-pinned
// Verhalten von frueher, nur N-fach. Bei genau einem Tenant identisch zu vorher.
// client = die von withClient gebundene Verbindung.
async function flush(client, state) {
  await client.query("BEGIN");
  try {
    await flushTenants(client, state.tenants);
    for (const tenant of state.tenants) {
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
      await flushTenantScope(client, tenant.id, state);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

// Flusht die tenant-scoped Scheibe EINES Tenants (RLS-GUC ist gesetzt). Die
// call-verknuepften Entitaeten (calls + ihre actionItems/notifications) werden ueber
// scopeOf partitioniert (dieselbe Regel wie ops.tenantCallScope: call.tenantId ===
// tenantId) - sonst blockte die RLS-WITH-CHECK den Insert einer Call-Zeile mit
// fremder tenant_id unter dieser GUC. settings/calendar/usage/numbers ueber die
// bestehenden pro-Tenant-Accessoren bzw. den numbers-Filter. profiles NUR unter dem
// Owner (global keyed-by-email, geerbte Entscheidung #9).
async function flushTenantScope(client, tenantId, state) {
  const { calls, callIds } = scopeOf(state, tenantId);
  await flushCalls(client, tenantId, calls);
  await flushActionItems(client, tenantId, state.actionItems.filter((a) => callIds.has(a.callId)));
  await flushCalendar(client, tenantId, ops.calendarFor(state, tenantId));
  await flushNotifications(client, tenantId, notificationsForTenant(state, tenantId, callIds));
  await flushSettings(client, tenantId, ops.settingsFor(state, tenantId));
  await flushUsage(client, tenantId, ops.usageFor(state, tenantId));
  if (tenantId === OWNER_TENANT_ID) await flushProfiles(client, tenantId, state.profiles);
  await flushNumbers(client, tenantId, state.numbers);
  await flushProvisioningJobs(client, tenantId, state.provisioningJobs);
  await flushTenantBudgets(client, tenantId, state.tenantBudgets);
  await flushUsageEvents(client, tenantId, state.usageEvents);
}

// tenant-Tabelle round-trippen (I8): id/status/owner_name/idp_subject upsert. KEINE
// RLS auf der tenant-Tabelle -> keine GUC noetig (anders als die 10 Daten-Tabellen).
// owner_name/idp_subject sind NULLABLE; ein Owner ohne eigenen Namen schreibt NULL
// (Owner-Fallback bleibt). Lebt VOR den tenant-scoped Inserts, weil diese per FK
// auf tenant(id) verweisen.
async function flushTenants(client, tenants) {
  for (const t of tenants) {
    await client.query(
      `INSERT INTO tenant (id, status, owner_name, first_name, idp_subject, kyc_level, stripe_customer_id, stripe_payment_method_id, country, default_language, private_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         status=EXCLUDED.status, owner_name=EXCLUDED.owner_name,
         first_name=EXCLUDED.first_name,
         idp_subject=EXCLUDED.idp_subject, kyc_level=EXCLUDED.kyc_level,
         stripe_customer_id=EXCLUDED.stripe_customer_id,
         stripe_payment_method_id=EXCLUDED.stripe_payment_method_id,
         country=EXCLUDED.country, default_language=EXCLUDED.default_language,
         private_number=EXCLUDED.private_number`,
      [t.id, t.status, t.ownerName ?? null, t.firstName ?? null, t.idpSubject ?? null, t.kycLevel ?? null,
       t.stripeCustomerId ?? null, t.stripePaymentMethodId ?? null, t.country ?? null, t.defaultLanguage ?? null,
       t.privateNumber ?? null]
    );
  }
}

// Die call-verknuepfte Tenant-Partition fuer den Flush: die Calls eines Tenants + ihre
// callIds (EIN Filter-Pass, dieselbe Regel wie ops.tenantCallScope: call.tenantId ===
// tenantId). actionItems/notifications tragen kein eigenes tenantId und werden ueber
// callId zugeordnet. Lokal gehalten, damit state-ops.js (Store-Fachlogik) unveraendert bleibt.
function scopeOf(state, tenantId) {
  const calls = state.calls.filter((c) => c.tenantId === tenantId);
  const callIds = new Set(calls.map((c) => c.id));
  return { calls, callIds };
}

// Notifications eines Tenants: call-verknuepfte ueber callIds; manuelle (callId=null)
// sind keinem Call/Tenant zuordbar -> sie gehoeren dem Owner (dokumentierte
// Entscheidung, I8). So flusht jede manuelle Notification GENAU einmal (unter Owner)
// und keine Notification faellt zwischen die Tenants.
function notificationsForTenant(state, tenantId, callIds) {
  return state.notifications.filter(
    (n) => callIds.has(n.callId) || (n.callId == null && tenantId === OWNER_TENANT_ID)
  );
}

// settings/usage haben tenant_id als PK und genau eine Zeile pro Tenant. Upsert
// (INSERT ON CONFLICT) statt blossem UPDATE (I8): der Owner hat seine Zeile aus
// seedDefaults -> ON CONFLICT DO UPDATE wirkt byte-identisch zum frueheren UPDATE;
// ein neuer Tenant (kein Seed) bekommt seine Zeile erst hier angelegt. Gleiches
// Upsert-Muster wie flushCalls/flushCalendar/flushNumbers (G5).
async function flushSettings(client, tenantId, settings) {
  await client.query(
    `INSERT INTO settings
       (tenant_id, agent_name, greeting, allow_calendar, allow_booking,
        allow_summaries, allow_personal_data, allow_bank_data, sms_summary_opt_in, language)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (tenant_id) DO UPDATE SET
       agent_name=EXCLUDED.agent_name, greeting=EXCLUDED.greeting,
       allow_calendar=EXCLUDED.allow_calendar, allow_booking=EXCLUDED.allow_booking,
       allow_summaries=EXCLUDED.allow_summaries, allow_personal_data=EXCLUDED.allow_personal_data,
       allow_bank_data=EXCLUDED.allow_bank_data, sms_summary_opt_in=EXCLUDED.sms_summary_opt_in,
       language=EXCLUDED.language`,
    [tenantId, settings.agentName, settings.greeting, settings.allowCalendar, settings.allowBooking,
      settings.allowSummaries, settings.allowPersonalData, settings.allowBankData,
      settings.smsSummaryOptIn, settings.language]
  );
}

async function flushUsage(client, tenantId, usage) {
  await client.query(
    `INSERT INTO usage (tenant_id, input_tokens, output_tokens, cost_eur, calls)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tenant_id) DO UPDATE SET
       input_tokens=EXCLUDED.input_tokens, output_tokens=EXCLUDED.output_tokens,
       cost_eur=EXCLUDED.cost_eur, calls=EXCLUDED.calls`,
    [tenantId, usage.inputTokens, usage.outputTokens, usage.costEur, usage.calls]
  );
}

async function flushCalls(client, tenantId, calls) {
  await deleteMissing(client, "call", tenantId, calls.map((c) => c.id));
  for (const c of calls) {
    await client.query(
      `INSERT INTO call
         (id, tenant_id, stream_token, twilio_sid, direction, from_e164, to_e164, goal,
          briefing, constraints, caller_name, language, max_duration_s, requested_by,
          status, started_at, answered_at, ended_at, summary, objective_achieved, provider)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (id) DO UPDATE SET
         twilio_sid=EXCLUDED.twilio_sid, status=EXCLUDED.status, answered_at=EXCLUDED.answered_at,
         ended_at=EXCLUDED.ended_at, summary=EXCLUDED.summary,
         objective_achieved=EXCLUDED.objective_achieved, provider=EXCLUDED.provider`,
      [c.id, tenantId, c.streamToken, c.twilioSid, c.direction, c.from, c.to, c.goal,
        c.briefing, c.constraints, c.callerName, c.language, c.maxDurationS, c.requestedBy,
        c.status, c.startedAt, c.answeredAt, c.endedAt, c.summary, serializeObjective(c.objectiveAchieved),
        c.provider || DEFAULT_PROVIDER]
    );
    await flushTranscript(client, tenantId, c);
  }
}

// Transkript-Segmente sind append-only: nur fehlende anhaengen. EINZIGE Ausnahme:
// ein geleertes Spiegel-Transkript (Roh-Transkript-Purge nach Summary, #7) wird
// auf die DB reconciled -> die persistierten Segmente DIESES Calls werden geloescht.
// Tenant-Schutz doppelt verankert wie bei deleteMissingByText: expliziter
// tenant_id-Filter im Statement PLUS RLS-GUC (FORCE-RLS, set_config in flush) als
// zweite Linie. Trifft NUR diesen Call dieses Tenants; andere bleiben unberuehrt.
async function flushTranscript(client, tenantId, call) {
  if (call.transcript.length === 0) {
    await client.query(`DELETE FROM transcript_segment WHERE tenant_id=$1 AND call_id=$2`, [tenantId, call.id]);
    return;
  }
  const existing = Number(
    (await client.query(`SELECT count(*) AS n FROM transcript_segment WHERE call_id=$1`, [call.id])).rows[0].n
  );
  for (let i = existing; i < call.transcript.length; i++) {
    const seg = call.transcript[i];
    await client.query(
      `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1,$2,$3,$4,$5)`,
      [call.id, tenantId, seg.role, seg.text, seg.at]
    );
  }
}

async function flushActionItems(client, tenantId, items) {
  await deleteMissing(client, "action_item", tenantId, items.map((i) => i.id));
  // Aelteste zuerst einfuegen, damit seq die unshift-Reihenfolge widerspiegelt.
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    await client.query(
      `INSERT INTO action_item (id, tenant_id, call_id, text, type, done, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET done=EXCLUDED.done`,
      [it.id, tenantId, it.callId, it.text, it.type, it.done, it.createdAt]
    );
  }
}

async function flushCalendar(client, tenantId, events) {
  await deleteMissing(client, "calendar_event", tenantId, events.map((e) => e.id));
  for (const ev of events) {
    await client.query(
      `INSERT INTO calendar_event (id, tenant_id, title, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at`,
      [ev.id, tenantId, ev.title, ev.start, ev.end]
    );
  }
}

async function flushNotifications(client, tenantId, notifications) {
  await deleteMissing(client, "notification", tenantId, notifications.map((n) => n.id));
  // Aelteste zuerst, damit seq die unshift-Reihenfolge (neueste zuerst) ergibt.
  for (let i = notifications.length - 1; i >= 0; i--) {
    const n = notifications[i];
    await client.query(
      `INSERT INTO notification (id, tenant_id, title, body, call_id, at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [n.id, tenantId, n.title, n.body, n.callId, n.at]
    );
  }
}

async function flushProfiles(client, tenantId, profiles) {
  const emails = Object.keys(profiles);
  await deleteMissingByText(client, "profile", "email", tenantId, emails);
  for (const [email, data] of Object.entries(profiles)) {
    await client.query(
      `INSERT INTO profile (tenant_id, email, data) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, email) DO UPDATE SET data=EXCLUDED.data`,
      [tenantId, email, JSON.stringify(data)]
    );
  }
}

// number-Flush (Onboarding-Lifecycle): id-PK-Upsert mit allen Lifecycle-Feldern
// (status, provider_number_id, e164 NULLABLE fuer 'requested').
// Multi-Tenant (I8): flush ruft flushNumbers pro Tenant unter dessen RLS-GUC; der
// own-Filter haelt das pro Aufruf auf die Nummern DIESES Tenants (zweite Linie zur
// per-Tenant-GUC). So round-trippen die Nummern aller Tenants (nicht mehr owner-only).
async function flushNumbers(client, tenantId, numbers) {
  const own = numbers.filter((n) => n.tenantId === tenantId);
  await deleteMissing(client, "number", tenantId, own.map((n) => n.id));
  for (const n of own) {
    await client.query(
      `INSERT INTO number (id, tenant_id, e164, provider, status, provider_number_id, payment_intent_id, country, language)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         e164=EXCLUDED.e164, provider=EXCLUDED.provider,
         status=EXCLUDED.status, provider_number_id=EXCLUDED.provider_number_id,
         payment_intent_id=EXCLUDED.payment_intent_id,
         country=EXCLUDED.country, language=EXCLUDED.language`,
      [n.id, tenantId, n.e164 ?? null, n.provider || DEFAULT_PROVIDER, n.status, n.providerNumberId ?? null, n.paymentIntentId ?? null, n.country ?? null, n.language ?? null]
    );
  }
}

// provisioning_job-Flush (async Worker, P6b2): id-PK-Upsert der Job-Spur. own-Filter
// + deleteMissing pro Tenant unter dessen RLS-GUC (zweite Linie, Muster wie
// flushNumbers). status/attempts/last_error koennen sich aendern (Worker-Lauf), der
// Rest (number_id/kind/idempotency_key) bleibt nach dem Insert stabil.
async function flushProvisioningJobs(client, tenantId, jobs) {
  const own = jobs.filter((j) => j.tenantId === tenantId);
  await deleteMissing(client, "provisioning_job", tenantId, own.map((j) => j.id));
  for (const j of own) {
    await client.query(
      `INSERT INTO provisioning_job (id, tenant_id, number_id, kind, status, idempotency_key, attempts, last_error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         status=EXCLUDED.status, attempts=EXCLUDED.attempts, last_error=EXCLUDED.last_error`,
      [j.id, tenantId, j.numberId, j.kind, j.status, j.idempotencyKey, j.attempts, j.lastError ?? null]
    );
  }
}

// tenant_budget-Flush (P6b3): PK = tenant_id (eine Zeile pro Tenant), kein
// deleteMissing noetig (setTenantBudget loescht nie). own-Filter pro Tenant unter
// dessen RLS-GUC (zweite Linie, Muster wie flushNumbers). Upsert wie flushSettings/
// flushUsage. Money als GANZZAHL Cents.
async function flushTenantBudgets(client, tenantId, budgets) {
  const own = budgets.filter((b) => b.tenantId === tenantId);
  for (const b of own) {
    await client.query(
      `INSERT INTO tenant_budget (tenant_id, budget_cents, hard_cap_cents)
       VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id) DO UPDATE SET
         budget_cents=EXCLUDED.budget_cents, hard_cap_cents=EXCLUDED.hard_cap_cents`,
      [tenantId, b.budgetCents, b.hardCapCents]
    );
  }
}

// usage_event-Flush (P6b3): append-only id-PK-Ledger. own-Filter + deleteMissing
// (Retention/Erase koennten Events entfernen) + Upsert (nur stripe_meter_sent
// aenderbar nach dem Insert). Muster wie flushProvisioningJobs.
async function flushUsageEvents(client, tenantId, events) {
  const own = events.filter((e) => e.tenantId === tenantId);
  await deleteMissing(client, "usage_event", tenantId, own.map((e) => e.id));
  for (const e of own) {
    await client.query(
      `INSERT INTO usage_event (id, tenant_id, call_id, kind, quantity, cost_cents, occurred_at, stripe_meter_sent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET stripe_meter_sent=EXCLUDED.stripe_meter_sent`,
      [e.id, tenantId, e.callId, e.kind, e.quantity, e.costCents, e.occurredAt, e.stripeMeterSent]
    );
  }
}

// objectiveAchieved kann string ODER boolean sein (json speichert beides). Die
// TEXT-Spalte haelt die String-Form; null bleibt null.
function serializeObjective(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : String(value);
}

// Loescht Zeilen des Tenants, deren TEXT-PK nicht mehr im Spiegel steht (Retention
// /Prune). Leere keep-Liste -> alle Zeilen des Tenants weg.
async function deleteMissing(client, table, tenantId, keepIds) {
  await deleteMissingByText(client, table, "id", tenantId, keepIds);
}

async function deleteMissingByText(client, table, column, tenantId, keepValues) {
  if (keepValues.length === 0) {
    await client.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenantId]);
    return;
  }
  await client.query(
    `DELETE FROM ${table} WHERE tenant_id=$1 AND ${column} <> ALL($2::text[])`,
    [tenantId, keepValues]
  );
}
