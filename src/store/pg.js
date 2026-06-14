// Postgres-Store-Backend hinter STORE_BACKEND=pg. Haelt einen synchron
// gespiegelten In-Memory-Zustand (gleicher Shape wie das json-Backend), der bei
// init() einmal aus der DB hydriert wird; jede Mutation laeuft synchron gegen den
// Spiegel (state-ops.js, geteilte Fachlogik) und stoesst danach einen DB-Flush an.
//
// WARUM der Spiegel: die 24 Store-Signaturen sind synchron und werden von den
// Callern teils ohne await aufgerufen (Bridge-Event-Handler, store.save()). pg ist
// async. Der Spiegel ist die kleinste Aenderung, die Contract-Parity zum
// json-Backend erreicht, ohne eine der 24 Signaturen oder einen Caller zu
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
import { OWNER_TENANT_ID } from "./defaults.js";
import { migrate } from "../db/migrate.js";

// Owner-Tenant zentral in defaults.js; hier re-exportiert, weil Tests + pg-helpers
// die Konstante historisch von store/pg.js importieren (Import-Stabilitaet).
export { OWNER_TENANT_ID };

// makePgStore(runner) -> Objekt mit den 24 Store-Funktionen. runner-Vertrag:
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
      state = await hydrate(client, OWNER_TENANT_ID);
    });
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
      .then(() => runner.withClient((client) => flush(client, OWNER_TENANT_ID, snapshot)))
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
    countOutboundCallsSince: (sinceIso, requestedBy = null) =>
      ops.countOutboundCallsSince(requireState(), sinceIso, requestedBy),
    findTenantByNumber: (e164) => ops.findTenantByNumber(requireState(), e164),

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

    getCalendar: () => ops.getCalendar(requireState()),
    addCalendarEvent(title, startIso, endIso) {
      const ev = ops.addCalendarEvent(requireState(), title, startIso, endIso);
      save();
      return ev;
    },
    findConflict: (startIso, endIso) => ops.findConflict(requireState(), startIso, endIso),

    trackUsage(inputTokens, outputTokens, cfg) {
      const usage = ops.trackUsage(requireState(), inputTokens, outputTokens, cfg);
      save();
      return usage;
    },
    budgetExceeded: (cfg) => ops.budgetExceeded(requireState(), cfg),

    addNotification(title, body, callId) {
      ops.addNotification(requireState(), title, body, callId);
      save();
    },

    // Default = config.retentionDays, identisch zum json-Backend: der einzige
    // Produktiv-Caller (server.js) ruft no-arg. Ohne diesen Default waere die
    // DSGVO-Retention unter STORE_BACKEND=pg still abgeschaltet (Absolute Regel).
    pruneOldData(days = config.retentionDays) {
      const removed = ops.pruneOldData(requireState(), days);
      if (removed.calls || removed.notifications || removed.actionItems) save();
      return removed;
    },

    updateSettings(patch) {
      const result = ops.updateSettings(requireState(), patch);
      save();
      return result;
    },

    resolveProfile: (email) => ops.resolveProfile(requireState(), email),
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

// ---- Hydrierung: DB-Zeilen -> verschachtelter Spiegel-Shape ----
// Laeuft auf einer Verbindung mit gesetzter RLS-GUC (siehe init).
async function hydrate(client, tenantId) {
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
  const profileRows = (await client.query(`SELECT email, data FROM profile WHERE tenant_id = $1`, [tenantId])).rows;
  const numberRows = (await client.query(
    `SELECT e164, tenant_id, provider FROM number WHERE tenant_id = $1`, [tenantId]
  )).rows;

  const segmentsByCall = groupTranscripts(segRows);
  const itemIdsByCall = groupActionItemIds(itemRows);

  const state = ops.makeDefaultState();
  state.settings = settingsRows.length ? rowToSettings(settingsRows[0]) : state.settings;
  state.calls = callRows.map((r) => rowToCall(r, segmentsByCall, itemIdsByCall));
  state.actionItems = itemRows.map(rowToActionItem);
  state.calendar = calRows.map(rowToCalendarEvent);
  state.usage = usageRows.length ? rowToUsage(usageRows[0]) : state.usage;
  state.notifications = notifRows.map(rowToNotification);
  state.profiles = Object.fromEntries(profileRows.map((r) => [r.email, r.data]));
  state.numbers = numberRows.map((r) => ({ e164: r.e164, tenantId: r.tenant_id, provider: r.provider }));
  return state;
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
    allowPersonalData: r.allow_personal_data,
    allowBankData: r.allow_bank_data,
  };
}

function rowToCall(r, segmentsByCall, itemIdsByCall) {
  return {
    id: r.id,
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

// ---- Flush: Spiegel -> DB (eine Transaktion auf EINER Verbindung, RLS-GUC
// transaktionslokal gesetzt). client = die von withClient gebundene Verbindung.
async function flush(client, tenantId, state) {
  await client.query("BEGIN");
  try {
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await flushCalls(client, tenantId, state.calls);
    await flushActionItems(client, tenantId, state.actionItems);
    await flushCalendar(client, tenantId, state.calendar);
    await flushNotifications(client, tenantId, state.notifications);
    await flushSettings(client, tenantId, state.settings);
    await flushUsage(client, tenantId, state.usage);
    await flushProfiles(client, tenantId, state.profiles);
    await flushNumbers(client, tenantId, state.numbers);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function flushSettings(client, tenantId, settings) {
  await client.query(
    `UPDATE settings SET agent_name=$2, greeting=$3, allow_calendar=$4, allow_booking=$5,
       allow_summaries=$6, allow_personal_data=$7, allow_bank_data=$8
     WHERE tenant_id=$1`,
    [tenantId, settings.agentName, settings.greeting, settings.allowCalendar, settings.allowBooking,
      settings.allowSummaries, settings.allowPersonalData, settings.allowBankData]
  );
}

async function flushUsage(client, tenantId, usage) {
  await client.query(
    `UPDATE usage SET input_tokens=$2, output_tokens=$3, cost_eur=$4, calls=$5 WHERE tenant_id=$1`,
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
          status, started_at, answered_at, ended_at, summary, objective_achieved)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (id) DO UPDATE SET
         twilio_sid=EXCLUDED.twilio_sid, status=EXCLUDED.status, answered_at=EXCLUDED.answered_at,
         ended_at=EXCLUDED.ended_at, summary=EXCLUDED.summary,
         objective_achieved=EXCLUDED.objective_achieved`,
      [c.id, tenantId, c.streamToken, c.twilioSid, c.direction, c.from, c.to, c.goal,
        c.briefing, c.constraints, c.callerName, c.language, c.maxDurationS, c.requestedBy,
        c.status, c.startedAt, c.answeredAt, c.endedAt, c.summary, serializeObjective(c.objectiveAchieved)]
    );
    await flushTranscript(client, tenantId, c);
  }
}

// Transkript-Segmente sind append-only: nur fehlende anhaengen (kein Loeschen,
// ausser der Call faellt per ON DELETE CASCADE weg).
async function flushTranscript(client, tenantId, call) {
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

// number ist in P3c config-derived (Owner-Seed via migrate); der Flush haelt den
// Spiegel mit der DB konsistent (Full-Upsert + Delete-Missing wie die anderen
// Tabellen), damit Re-Hydrierung den Spiegel-Shape exakt rekonstruiert. id=e164
// (TEXT-PK; e164 ist UNIQUE und stabil), daher kein separater Surrogat-Key.
async function flushNumbers(client, tenantId, numbers) {
  await deleteMissingByText(client, "number", "e164", tenantId, numbers.map((n) => n.e164));
  for (const n of numbers) {
    await client.query(
      `INSERT INTO number (id, tenant_id, e164, provider) VALUES ($1,$2,$3,$4)
       ON CONFLICT (e164) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, provider=EXCLUDED.provider`,
      [n.e164, tenantId, n.e164, n.provider || "twilio"]
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
