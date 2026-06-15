// Reine In-Memory-Operationen auf dem verschachtelten Store-Zustand
// {settings, calls, actionItems, calendar, usage, notifications, profiles, numbers}.
// usage ist eine Map tenantId -> Bucket (P4, Daten-Schicht pro-Tenant).
// KEIN IO: weder Datei noch DB. Beide Backends (json.js, pg.js) halten denselben
// Zustands-Shape und delegieren die Mutationen hierher - so lebt die Fachlogik
// (Call-Record-Aufbau, Retention-Praedikate, Kostenformel, ...) genau EINMAL
// (Duplizierung vermieden). Die Backends kuemmern sich nur um Persistenz.
import crypto from "crypto";
import {
  defaultSettings,
  demoCalendar,
  emptyUsage,
  emptyUsageMap,
  OWNER_TENANT_ID,
  sanitizeProfile,
  resolveProfileFrom,
  MAX_NOTIFICATIONS,
  DEFAULT_PROVIDER,
  NUMBER_STATUS,
  NUMBER_TRANSITIONS,
  TENANT_STATUS,
} from "./defaults.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function makeDefaultState() {
  return {
    settings: defaultSettings(),
    calls: [], // {id, direction, from, to, goal, status, startedAt, endedAt, transcript:[{role,text,at}], summary, actionItemIds:[ids]}
    actionItems: [], // {id, callId, text, type:"todo"|"appointment", done, createdAt}
    calendar: demoCalendar(),
    usage: emptyUsageMap(),
    notifications: [], // {id, title, body, at, callId}
    // Rechteprofile pro Nutzer (Phase 2): { "<email>": {<Profil-Felder>} }. Eigener
    // Top-Level-Key - updateSettings faesst ihn bewusst NICHT an.
    profiles: {},
    // Tenants (Onboarding). Der Owner existiert immer (status active). Weitere
    // Tenants kommen ueber registerTenant (zahlungsfreies Onboarding).
    tenants: [{ id: OWNER_TENANT_ID, status: TENANT_STATUS.ACTIVE }], // [{ id, status }]
    // E.164 -> tenant_id Routing-Tabelle (P3c) + Lifecycle. Owner-Nummer ist
    // config-derived (seedOwnerNumber, status active). 'requested' Nummern haben
    // (noch) keine e164 -> identifiziert ueber id.
    numbers: [], // [{ id, e164, tenantId, provider, status, providerNumberId }]
    // Historie Nummer<->Tenant (Recycling-Hygiene).
    numberAssignments: [], // [{ id, numberId, tenantId, assignedAt, releasedAt }]
  };
}

export function newId(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---- Calls ----
export function createCall(s, { direction, from, to, goal, twilioSid, briefing, constraints, callerName, language, maxDurationS, requestedBy, tenantId, provider }) {
  const call = {
    id: newId("call"),
    // Zugangsgeheimnis fuer den /media-WebSocket (steht im TwiML, das nur Twilio
    // sieht). Wird von der Bridge beim start-Event geprueft und darf NIE ueber
    // die API ausgegeben werden (server.js publicCall).
    streamToken: crypto.randomBytes(16).toString("hex"),
    twilioSid: twilioSid || null,
    // Provider, ueber den dieser Call laeuft (P6a). Inbound: aus dem Signatur-
    // Header abgeleitet (server.js); Outbound: ungesetzt -> DEFAULT_PROVIDER
    // (Twilio-only). Folge-Webhooks + finishCall lesen call.provider (Single
    // Source of Truth, kein erneutes Header-Parsen).
    provider: provider || DEFAULT_PROVIDER,
    direction, // "inbound" | "outbound"
    from,
    to,
    goal: goal || null,
    briefing: briefing || null,
    constraints: constraints || null,
    callerName: callerName || null,
    language: language || "de",
    maxDurationS: maxDurationS || null,
    // Wer den Call ausgeloest hat: <email> bei authentifizierten MCP-Nutzern,
    // sonst "owner" (localhost/stdio). Fuer Audit + pro-Nutzer-Stundenlimit.
    requestedBy: requestedBy || null,
    // Tenant, dem dieser Call gehoert (P4). Inbound: via findTenantByNumber
    // aufgeloest; Outbound: OWNER_TENANT_ID (Outbound-from bleibt Owner bis P5).
    // Steuert den Usage-Bucket + die pro-Tenant-Achse von countOutboundCallsSince.
    // Fail-closed: fehlendes tenantId -> Owner (heute einziger realer Tenant).
    tenantId: tenantId || OWNER_TENANT_ID,
    status: "active", // active | completed | failed | cancelled
    startedAt: new Date().toISOString(),
    answeredAt: null,
    endedAt: null,
    transcript: [],
    summary: null,
    objectiveAchieved: null,
    actionItemIds: [],
  };
  s.calls.unshift(call);
  usageFor(s, call.tenantId).calls++;
  return call;
}

export function getCall(s, id) {
  return s.calls.find((c) => c.id === id || c.twilioSid === id) || null;
}

export function addTranscript(s, callId, role, text) {
  const call = getCall(s, callId);
  if (!call) return false;
  call.transcript.push({ role, text, at: new Date().toISOString() });
  return true;
}

// Loescht das Roh-Transkript EINES Calls (DSGVO-Datenminimierung, #7): nach
// erfolgreicher Summary bleibt nur Summary + Action Items at rest. Reine Mutation,
// kein IO. Liefert true, wenn etwas geaendert wurde (Call existiert + hatte
// Transkript) -> der Backend-Wrapper save()t nur dann. summary/objectiveAchieved/
// actionItemIds bleiben unangetastet.
export function purgeTranscript(s, callId) {
  const call = getCall(s, callId);
  if (!call || call.transcript.length === 0) return false;
  call.transcript = [];
  return true;
}

// Der EINE call-verknuepfte Tenant-Scope: die Calls eines Tenants + ihre id-Menge.
// Von eraseTenantData (Loeschung) UND exportTenantData (Export) gemeinsam genutzt,
// damit beide GARANTIERT denselben Umfang treffen - sonst leakt der Export Daten,
// die das Erase loescht, oder umgekehrt (R3-Drift). Die Scoping-Regel
// (call.tenantId === tenantId) existiert genau hier. actionItems/notifications
// tragen KEIN eigenes tenantId -> sie werden ueber callId in callIds gescoped.
function tenantCallScope(s, tenantId) {
  const calls = s.calls.filter((c) => c.tenantId === tenantId);
  return { calls, callIds: new Set(calls.map((c) => c.id)) };
}

// Per-Tenant-DSGVO-Loeschung (Art. 17): entfernt ALLE call-verknuepften Daten
// EINES Tenants - die Calls (samt Roh-Transkript), die daraus extrahierten Action
// Items und die call-verknuepften Notifications. Tenant-Scope kommt aus
// tenantCallScope (eine Quelle). settings/profiles/numbers/tenants/calendar/usage
// bleiben UNANGETASTET (Service-Config/Identitaet/Budget-Gate). Reine Mutation,
// kein IO. Liefert Loesch-Zaehler fuers Audit (KEINE Inhalte). NIE cross-tenant.
export function eraseTenantData(s, tenantId) {
  const { calls: targetCalls, callIds } = tenantCallScope(s, tenantId);
  const removed = {
    calls: targetCalls.length,
    transcriptSegments: targetCalls.reduce((sum, c) => sum + c.transcript.length, 0),
    actionItems: 0,
    notifications: 0,
  };
  const itemsBefore = s.actionItems.length;
  const notifsBefore = s.notifications.length;
  s.calls = s.calls.filter((c) => !callIds.has(c.id));
  s.actionItems = s.actionItems.filter((a) => !callIds.has(a.callId));
  s.notifications = s.notifications.filter((n) => !callIds.has(n.callId));
  removed.actionItems = itemsBefore - s.actionItems.length;
  removed.notifications = notifsBefore - s.notifications.length;
  return removed;
}

// Nicht-destruktive Auskunft/Export (Art. 15/20): reine Query, KEIN save. Liefert
// ueber tenantCallScope GENAU den Umfang, den eraseTenantData treffen wuerde -
// call-verknuepfte Daten EINES Tenants. KEIN Strippen hier (das macht die
// API-Schicht via publicCall, um streamToken nicht zu leaken).
export function exportTenantData(s, tenantId) {
  const { calls, callIds } = tenantCallScope(s, tenantId);
  return {
    tenantId,
    exportedAt: new Date().toISOString(),
    calls,
    actionItems: s.actionItems.filter((a) => callIds.has(a.callId)),
    notifications: s.notifications.filter((n) => callIds.has(n.callId)),
  };
}

export function markAnswered(s, callId) {
  const call = getCall(s, callId);
  let changed = false;
  if (call && !call.answeredAt) {
    call.answeredAt = new Date().toISOString();
    changed = true;
  }
  return { call, changed };
}

export function endCallRecord(s, callId, status = "completed") {
  const call = getCall(s, callId);
  if (!call) return { call: null, changed: false };
  let changed = false;
  if (call.status === "active") {
    call.status = status;
    call.endedAt = new Date().toISOString();
    changed = true;
  }
  return { call, changed };
}

// Zaehlt Outbound-Calls mit startedAt >= sinceIso (gleitendes Fenster fuers
// Pro-Stunde-Gate in server.js). filters (alle optional, kombinierbar als UND):
//   requestedBy : nur Calls dieses Nutzers (pro-Nutzer-Limit, Bestand)
//   tenantId    : nur Calls dieses Tenants (pro-Tenant-Achse, P4)
// Ohne Filter: ALLE Outbound-Records (globale Plattform-Bremse, Bestand). Zaehlt
// bewusst auch fehlgeschlagene - konservative Toll-Fraud-Bremse.
export function countOutboundCallsSince(s, sinceIso, { requestedBy = null, tenantId = null } = {}) {
  return s.calls.filter(
    (c) =>
      c.direction === "outbound" &&
      c.startedAt >= sinceIso &&
      (requestedBy == null || c.requestedBy === requestedBy) &&
      (tenantId == null || c.tenantId === tenantId)
  ).length;
}

// ---- Action Items ----
export function addActionItem(s, callId, text, type = "todo") {
  const item = {
    id: newId("ai"),
    callId,
    text,
    type,
    done: false,
    createdAt: new Date().toISOString(),
  };
  s.actionItems.unshift(item);
  const call = getCall(s, callId);
  if (call) call.actionItemIds.push(item.id);
  return item;
}

export function toggleActionItem(s, id) {
  const item = s.actionItems.find((a) => a.id === id);
  if (item) item.done = !item.done;
  return item;
}

// ---- Kalender ----
export function getCalendar(s) {
  return s.calendar.sort((a, b) => a.start.localeCompare(b.start));
}

export function addCalendarEvent(s, title, startIso, endIso) {
  const ev = { id: newId("ev"), title, start: startIso, end: endIso };
  s.calendar.push(ev);
  return ev;
}

export function findConflict(s, startIso, endIso) {
  return getCalendar(s).find((ev) => ev.start < endIso && startIso < ev.end) || null;
}

// ---- Inbound-Routing: E.164 -> Tenant (P3c) ----
// Reine Query (kein IO, keine Mutation): liefert die tenant_id der Nummer oder
// null. null = unbekannte ODER nicht-aktive Nummer -> der Caller faellt fail-closed
// (kein Default-Tenant). NUR status='active' routet: requested/provisioning haben
// (noch) keine e164, suspended/released/failed duerfen NICHT mehr eingehende Calls
// annehmen (Abuse/Budget/Freigabe). e164 wird exakt verglichen (E.164).
export function findTenantByNumber(s, e164) {
  if (!e164) return null;
  const hit = s.numbers.find((n) => n.e164 === e164 && n.status === NUMBER_STATUS.ACTIVE);
  return hit ? hit.tenantId : null;
}

// Stellt die config-abgeleitete Owner-Nummer idempotent im Spiegel sicher (json
// load() ruft makeDefaultState nicht auf bestehenden Stores, seedState()-Tests
// seeden ohne numbers). Leere Nummer -> kein Seed (env-gating). Vorhandene e164
// gewinnt. provider default DEFAULT_PROVIDER (Twilio) -> bestehende Aufrufe
// (3 Args) verhaltens-erhaltend; Telnyx-Seed reicht provider=telnyx mit.
export function seedOwnerNumber(s, e164, tenantId, provider = DEFAULT_PROVIDER) {
  if (!e164) return;
  if (s.numbers.some((n) => n.e164 === e164)) return;
  // Geseedete Owner-Nummer ist in Benutzung -> status active. id, damit
  // number_assignment/Lifecycle sie referenzieren koennen.
  s.numbers.push({ id: newId("num"), e164, tenantId, provider, status: NUMBER_STATUS.ACTIVE, providerNumberId: null });
}

// ---- Onboarding / Number-Lifecycle (zahlungsfrei, Cap statt Stripe) ----
// Reine State-Machine + Datenschicht: Tenant registrieren, Nummer anfragen,
// validierte Zustandsuebergaenge. KEIN Provider-Kauf (Live-API) und KEIN IO hier
// - das macht der Adapter/die Route. Die zentrale Sicherheitseigenschaft: eine
// Nummer wird NIE direkt 'active' gebaut, nur ueber die legale Transition-Kette.

// Erlaubter Uebergang? (fail-closed: alles nicht in NUMBER_TRANSITIONS ist verboten).
export function canTransitionNumber(from, to) {
  return (NUMBER_TRANSITIONS[from] || []).includes(to);
}

export function findNumber(s, id) {
  return s.numbers.find((n) => n.id === id) || null;
}

export function findTenant(s, id) {
  // s.tenants kann fehlen (seedState seedet keine Tenants) -> defensiver Default;
  // der Guard lebt damit an EINER Stelle (auch tenantContext nutzt ihn).
  return (s.tenants || []).find((t) => t.id === id) || null;
}

// ---- Tenant-Kontext-Seam (Identitaets-Schicht, I0) ----
// Reines IO-freies Domaenen-Objekt: die EINE Stelle, die Identitaet + Settings +
// Kalender eines Tenants buendelt. Liest noch die globalen Singletons
// (s.settings, s.calendar) + den durchgereichten ownerName (Konsumenten/Map folgen
// in spaeteren Phasen). ownerName wird vom Backend-Wrapper hereingereicht (heute
// config.ownerName), damit state-ops config-frei bleibt (wie caps bei
// requestNumber). Owner-Fallback gekapselt: hat der Tenant keinen eigenen Namen,
// gilt der durchgereichte ownerName. Invariante: bei genau einem Tenant ist das
// Ergebnis byte-identisch zu den heutigen globalen Singletons.
export function tenantContext(s, ownerName, tenantId) {
  const tenant = findTenant(s, tenantId);
  return {
    tenantId,
    ownerName: (tenant && tenant.ownerName) || ownerName,
    settings: s.settings,
    calendar: s.calendar,
  };
}

// Idempotent: legt den Tenant an, falls neu (status active). Liefert den Tenant.
export function registerTenant(s, id) {
  const existing = findTenant(s, id);
  if (existing) return existing;
  const tenant = { id, status: TENANT_STATUS.ACTIVE };
  s.tenants.push(tenant);
  return tenant;
}

// Nicht-terminale Nummern (requested/provisioning/active/suspended) belegen
// Kosten/Plaetze; released/failed zaehlen nicht. Basis fuer die Cap-Pruefung.
function liveNumbers(s, tenantId = null) {
  return s.numbers.filter(
    (n) =>
      n.status !== NUMBER_STATUS.RELEASED &&
      n.status !== NUMBER_STATUS.FAILED &&
      (tenantId == null || n.tenantId === tenantId)
  );
}

// Fragt eine neue Nummer fuer einen Tenant an (Onboarding, ZAHLUNGSFREI). Die
// Caps (maxNumbers global, maxNumbersPerTenant) sind die Kosten-Notbremse, die
// das uebersprungene Stripe-Schloss ersetzt - jede echte Nummer kostet Geld.
// KEIN Provider-Kauf hier (der haengt an beginProvisioning). caps kommen aus
// config (state-ops bleibt config-frei). Liefert {ok, number} oder {ok:false, reason}.
export function requestNumber(s, { tenantId, provider = DEFAULT_PROVIDER, maxNumbers, maxNumbersPerTenant }) {
  const tenant = findTenant(s, tenantId);
  if (!tenant || tenant.status !== TENANT_STATUS.ACTIVE) return { ok: false, reason: "tenant_inactive" };
  if (liveNumbers(s).length >= maxNumbers) return { ok: false, reason: "global_cap" };
  if (liveNumbers(s, tenantId).length >= maxNumbersPerTenant) return { ok: false, reason: "tenant_cap" };
  const number = { id: newId("num"), e164: null, tenantId, provider, status: NUMBER_STATUS.REQUESTED, providerNumberId: null };
  s.numbers.push(number);
  return { ok: true, number };
}

// Validierte Zustandsaenderung (fail-closed: illegaler Uebergang wirft). Reine
// Status-Mutation; activate/fail/release setzen Zusatzfelder.
export function transitionNumber(s, numberId, toStatus) {
  const number = findNumber(s, numberId);
  if (!number) throw new Error(`transitionNumber: Nummer ${numberId} nicht gefunden`);
  if (!canTransitionNumber(number.status, toStatus))
    throw new Error(`transitionNumber: illegaler Uebergang ${number.status} -> ${toStatus}`);
  number.status = toStatus;
  return number;
}

export function beginProvisioning(s, numberId) {
  return transitionNumber(s, numberId, NUMBER_STATUS.PROVISIONING);
}

// provisioning -> active: NUR nach erfolgreichem Provider-Kauf. Setzt die gekaufte
// e164 + provider_number_id und legt die assignment-Zeile an. KEIN active ohne
// diese Transition (zentrale fail-closed-Eigenschaft).
export function activateNumber(s, numberId, { e164, providerNumberId }) {
  const number = transitionNumber(s, numberId, NUMBER_STATUS.ACTIVE);
  number.e164 = e164;
  number.providerNumberId = providerNumberId ?? null;
  s.numberAssignments.push({
    id: newId("asg"),
    numberId: number.id,
    tenantId: number.tenantId,
    assignedAt: new Date().toISOString(),
    releasedAt: null,
  });
  return number;
}

export function failNumber(s, numberId) {
  return transitionNumber(s, numberId, NUMBER_STATUS.FAILED);
}

// Freigabe (terminal): status released + assignment schliessen (released_at).
export function releaseNumber(s, numberId) {
  const number = transitionNumber(s, numberId, NUMBER_STATUS.RELEASED);
  const asg = s.numberAssignments.find((a) => a.numberId === numberId && !a.releasedAt);
  if (asg) asg.releasedAt = new Date().toISOString();
  return number;
}

// ---- Usage / Budget-Guard (Daten-Schicht pro-Tenant, P4) ----
// Liefert den Usage-Bucket eines Tenants und LEGT IHN BEI BEDARF AN (Nebeneffekt
// im Kommentar; der Aufrufer reicht stets eine konkrete tenantId). So lebt der
// Map-Zugriff genau einmal (G5) - keine s.usage[tenantId]-Duplizierung verstreut.
export function usageFor(s, tenantId) {
  return (s.usage[tenantId] ||= emptyUsage());
}

// Plattform-Summe ueber ALLE Tenant-Buckets (globaler Budget-Notaus, R2). Fuer
// owner-only faellt die Summe mit dem Owner-Bucket zusammen -> verhaltens-identisch.
export function globalUsageTotals(s) {
  const total = emptyUsage();
  for (const bucket of Object.values(s.usage)) {
    total.inputTokens += bucket.inputTokens;
    total.outputTokens += bucket.outputTokens;
    total.costEur += bucket.costEur;
    total.calls += bucket.calls;
  }
  return total;
}

// Bucht KI-Token-Verbrauch + Kosten auf den Usage-Bucket des Tenants (P4).
// costEur bleibt JS-Float (Bestand, akzeptiertes Risiko). Liefert den Bucket.
export function trackUsage(s, tenantId, inputTokens, outputTokens, cfg) {
  const usage = usageFor(s, tenantId);
  usage.inputTokens += inputTokens;
  usage.outputTokens += outputTokens;
  const usd =
    (inputTokens / 1e6) * cfg.priceInPerMTokUsd +
    (outputTokens / 1e6) * cfg.priceOutPerMTokUsd;
  usage.costEur += usd * cfg.usdToEur;
  return usage;
}

// Pro-Tenant-Budget: der Tenant-Bucket gegen config.maxBudgetEur (P4). Quelle ist
// die bestehende usage-Tabelle (tenant_id-PK) + config-Cap; KEINE tenant_budget-
// Tabelle, pro-Tenant-individuelle Caps = P6.
export function budgetExceeded(s, tenantId, cfg) {
  return usageFor(s, tenantId).costEur >= cfg.maxBudgetEur;
}

// Globaler Budget-Notaus (Plattform-Cap, R2): Summe ueber ALLE Tenant-Buckets
// gegen config.maxBudgetEur. Bleibt PARALLEL zum pro-Tenant-Budget bestehen
// (Schnittmenge, beide fail-closed). Fuer owner-only faellt die Summe mit dem
// Owner-Bucket zusammen -> byte-identisch zum Bestand. Wird NIE entfernt.
export function globalBudgetExceeded(s, cfg) {
  return globalUsageTotals(s).costEur >= cfg.maxBudgetEur;
}

// ---- Notifications ----
export function addNotification(s, title, body, callId) {
  s.notifications.unshift({
    id: newId("nt"),
    title,
    body,
    callId: callId || null,
    at: new Date().toISOString(),
  });
  s.notifications = s.notifications.slice(0, MAX_NOTIFICATIONS);
}

// ---- Retention (DSGVO-Datenminimierung) ----
// Loescht beendete Calls (samt Transkript), Notifications und ERLEDIGTE Action
// Items, die aelter als `days` sind. Aktive Calls und offene Action Items
// bleiben immer erhalten. days <= 0 schaltet die Retention ab.
export function pruneOldData(s, days) {
  const removed = { calls: 0, notifications: 0, actionItems: 0 };
  if (!days || days <= 0) return removed;
  const cutoff = new Date(Date.now() - days * MS_PER_DAY).toISOString();

  const keepCall = (c) => c.status === "active" || !c.endedAt || c.endedAt >= cutoff;
  const keepNotification = (n) => n.at >= cutoff;
  const keepActionItem = (a) => !a.done || a.createdAt >= cutoff;

  const before = { calls: s.calls.length, notifications: s.notifications.length, actionItems: s.actionItems.length };
  s.calls = s.calls.filter(keepCall);
  s.notifications = s.notifications.filter(keepNotification);
  s.actionItems = s.actionItems.filter(keepActionItem);
  removed.calls = before.calls - s.calls.length;
  removed.notifications = before.notifications - s.notifications.length;
  removed.actionItems = before.actionItems - s.actionItems.length;
  return removed;
}

// ---- Settings ----
// Whitelist gegen die Default-Settings: nur bekannte Keys mit passendem Typ.
// Unbekannte Keys / falsche Typen werden ignoriert - POST /api/settings kann
// so keine fremden Felder in den Store schreiben oder Typen kippen.
// Liefert auch die uebernommenen Keys (fuers Audit-Log in server.js).
export function updateSettings(s, patch) {
  const allowed = defaultSettings();
  const changed = [];
  for (const [key, value] of Object.entries(patch || {})) {
    if (key in allowed && typeof value === typeof allowed[key]) {
      s.settings[key] = value;
      changed.push(key);
    }
  }
  return { settings: s.settings, changed };
}

// ---- Rechteprofile pro Nutzer (Phase 2) ----
// Effektives Profil fuer eine Identitaet. null/leer (localhost/stdio ohne JWT)
// -> Owner. Bekannte Identitaet -> gespeichertes Profil ueber DEFAULT gemerged
// (fehlende Felder fallen restriktiv zurueck). Unbekannt -> DEFAULT.
export function resolveProfile(s, email) {
  return resolveProfileFrom(email, email ? s.profiles[email] : undefined);
}

export function listProfiles(s) {
  return s.profiles;
}

// Legt ein Profil an oder ergaenzt es (Merge der sanitisierten Felder). Liefert
// das gespeicherte Profil + die uebernommenen Keys (fuers Audit-Log, ohne Werte).
export function setProfile(s, email, patch) {
  const clean = sanitizeProfile(patch);
  s.profiles[email] = { ...(s.profiles[email] || {}), ...clean };
  return { profile: s.profiles[email], changed: Object.keys(clean) };
}

export function deleteProfile(s, email) {
  if (!(email in s.profiles)) return false;
  delete s.profiles[email];
  return true;
}
