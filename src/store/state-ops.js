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
  defaultSettingsMap,
  calendarMap,
  emptyUsage,
  emptyUsageMap,
  OWNER_TENANT_ID,
  sanitizeProfile,
  resolveProfileFrom,
  MAX_NOTIFICATIONS,
  DEFAULT_PROVIDER,
  normNum,
  NUMBER_STATUS,
  NUMBER_TRANSITIONS,
  TENANT_STATUS,
  PROVISIONING_JOB_STATUS,
  PROVISION_NUMBER_JOB,
  USAGE_EVENT_KIND,
  CENTS_PER_EUR,
  KYC_ORDER,
} from "./defaults.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function makeDefaultState() {
  return {
    settings: defaultSettingsMap(),
    calls: [], // {id, direction, from, to, goal, status, startedAt, endedAt, transcript:[{role,text,at}], summary, actionItemIds:[ids]}
    actionItems: [], // {id, callId, text, type:"todo"|"appointment", done, createdAt}
    calendar: calendarMap(),
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
    // Async-Provisioning-Jobs (P6b2): persistente Spur der Queue (json-Liste bzw.
    // provisioning_job-Tabelle in pg). Die Laufzeit-Queue lebt im Adapter
    // (queue/adapters/memory); diese Liste haelt den Audit-/Reconciliation-Zustand
    // (RLS-fest, hydrierbar). [{ id, numberId, tenantId, kind, status, idempotencyKey, attempts, lastError }]
    provisioningJobs: [],
    // Per-Tenant-Kostendecke (P6b3): [{ tenantId, budgetCents, hardCapCents }].
    // KEINE Owner-Vorbelegung -> Owner ohne Zeile faellt auf cfg.maxBudgetEur
    // (budgetExceeded), byte-identisch zum Bestand.
    tenantBudgets: [],
    // Append-only Usage-Ledger (P6b3): Quelle fuer das Stripe-Metering (NICHT fuers
    // Budget-Gate - das bleibt die usage-Map). [{ id, tenantId, callId, kind,
    // quantity, costCents, occurredAt, stripeMeterSent }]. Eintraege werden NIE
    // mutiert, nur stripeMeterSent flippt beim Flush.
    usageEvents: [],
  };
}

export function newId(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---- Calls ----
export function createCall(s, { direction, from, to, goal, twilioSid, briefing, constraints, language, maxDurationS, requestedBy, tenantId, provider }) {
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
    // caller_name-Producer entfernt (G1, Identitaets-Bindung): die Offenlegung ist
    // an tenant.ownerName gebunden, NICHT per Call-Parameter setzbar. DB-Spalte
    // bleibt additiv nullable (kein destruktives Migrat) -> Feld bleibt im Record.
    callerName: null,
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
// Liefert den Kalender-Bucket eines Tenants und LEGT IHN BEI BEDARF AN (Lazy-Init
// als bewusster, dokumentierter Nebeneffekt, analog usageFor). So lebt der
// Map-Zugriff genau einmal (G5). Ein neuer Tenant startet mit einer LEEREN Liste
// (der Owner-Demo-Kalender ist nur dem Owner vorbelegt, calendarMap).
export function calendarFor(s, tenantId) {
  return (s.calendar[tenantId] ||= []);
}

export function getCalendar(s, tenantId) {
  return calendarFor(s, tenantId).sort((a, b) => a.start.localeCompare(b.start));
}

export function addCalendarEvent(s, tenantId, title, startIso, endIso) {
  const ev = { id: newId("ev"), title, start: startIso, end: endIso };
  calendarFor(s, tenantId).push(ev);
  return ev;
}

export function findConflict(s, tenantId, startIso, endIso) {
  return getCalendar(s, tenantId).find((ev) => ev.start < endIso && startIso < ev.end) || null;
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
// e164 wird normalisiert (normNum) BEVOR der Idempotenz-Check + das Speichern
// laufen, damit die gespeicherte Form mit dem normalisierten Inbound-To-Lookup
// (findTenantByNumber) uebereinstimmt - sonst routet eine Owner-Nummer mit
// Trennzeichen nicht (TD-2). Sauberes E.164 -> No-Op (byte-identisch).
export function seedOwnerNumber(s, e164, tenantId, provider = DEFAULT_PROVIDER) {
  const norm = normNum(e164);
  if (!norm) return;
  if (s.numbers.some((n) => n.e164 === norm)) return;
  // Geseedete Owner-Nummer ist in Benutzung -> status active. id, damit
  // number_assignment/Lifecycle sie referenzieren koennen.
  s.numbers.push({ id: newId("num"), e164: norm, tenantId, provider, status: NUMBER_STATUS.ACTIVE, providerNumberId: null });
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

// s.tenants kann fehlen (seedState seedet keine Tenants) -> defensiver Default.
// Eine Quelle fuer alle Tenant-Finder (findTenant via id, resolveTenant via
// idpSubject); der Guard lebt damit an EINER Stelle.
const tenantsOf = (s) => s.tenants || [];

export function findTenant(s, id) {
  return tenantsOf(s).find((t) => t.id === id) || null;
}

// ---- Tenant-Kontext-Seam (Identitaets-Schicht, I0) ----
// Reines IO-freies Domaenen-Objekt: die EINE Stelle, die Identitaet + Settings +
// Kalender eines Tenants buendelt. Liest die pro-Tenant-Buckets
// (settingsFor/calendarFor, I2) + den durchgereichten ownerName. ownerName wird vom
// Backend-Wrapper hereingereicht (heute config.ownerName), damit state-ops
// config-frei bleibt (wie caps bei requestNumber). Owner-Fallback gekapselt: hat der
// Tenant keinen eigenen Namen, gilt der durchgereichte ownerName. Invariante: bei
// genau einem Tenant ist der Owner-Bucket byte-identisch zu den heutigen Singletons.
export function tenantContext(s, ownerName, tenantId) {
  const tenant = findTenant(s, tenantId);
  const effectiveOwner = (tenant && tenant.ownerName) || ownerName;
  return {
    tenantId,
    ownerName: effectiveOwner,
    // firstName (LLM-Persona, G1): eigener Tenant-Vorname falls gesetzt, sonst aus
    // dem effektiven ownerName abgeleitet -> EINE Ableitungsstelle (G5). Leerer Name
    // -> leerer firstName (das Outbound-Gate in /api/calls faengt das fail-closed ab).
    firstName: (tenant && tenant.firstName) || firstNameOf(effectiveOwner),
    settings: settingsFor(s, tenantId),
    calendar: calendarFor(s, tenantId),
  };
}

// Vorname = erstes Whitespace-getrenntes Token eines vollen Namens. Leerer/falscher
// Eingabewert -> "". Lokale Helper-Funktion, eine Quelle fuer die Persona-Ableitung.
function firstNameOf(fullName) {
  return typeof fullName === "string" ? fullName.trim().split(/\s+/)[0] || "" : "";
}

// Setzt firstName + komponierten ownerName auf einem Tenant-Record (G1). Geteilt von
// registerTenant UND seedOwnerIdentity (G5: eine Kompositionsstelle). Trimmt; leere
// Teile -> Feld bleibt weg, damit der config-Owner-Fallback im tenantContext sauber
// greift (kein leerer Daten-Muell). ownerName = "firstName lastName".
export function applyOwnerIdentity(tenant, firstName, lastName) {
  const fn = typeof firstName === "string" ? firstName.trim() : "";
  const ln = typeof lastName === "string" ? lastName.trim() : "";
  const full = [fn, ln].filter(Boolean).join(" ");
  if (fn) tenant.firstName = fn;
  if (full) tenant.ownerName = full;
}

// Stellt die config-abgeleitete Owner-Identitaet (firstName/lastName -> ownerName)
// idempotent im Spiegel sicher (Variante a, G1). Wie seedOwnerNumber: json load()
// ruft makeDefaultState nicht auf Bestands-Stores, pg hydriert owner_name als NULL.
// Schuetzt den UNGEGATETEN Inbound-Greeting (server.js) + summarizeCall. Idempotent:
// traegt der Owner-Tenant bereits ownerName, No-Op (gesetzte Identitaet gewinnt).
// Fehlender Owner-Tenant (seedState ohne tenants) -> No-Op. Leere Config-Teile ->
// kein Seed (Boot-Refusal in assertConfig faengt das ab).
export function seedOwnerIdentity(s, firstName, lastName, tenantId) {
  const owner = findTenant(s, tenantId);
  if (!owner || owner.ownerName) return;
  applyOwnerIdentity(owner, firstName, lastName);
}

// Idempotent + set-on-create: legt den Tenant an, falls neu (status active), und
// setzt dabei EINMALIG die Identitaet. Liefert den Tenant. firstName + lastName
// kommen aus dem Onboarding (I3 + G1); ownerName = "firstName lastName" wird
// KOMPONIERT (Bestandskonsumenten lesen ownerName unveraendert), firstName zusaetzlich
// gespeichert (LLM-Persona). Ein bestehender Tenant kommt unveraendert zurueck (kein
// Upsert). Leere Teile -> Feld weggelassen (Owner-Fallback greift).
export function registerTenant(s, id, { firstName, lastName } = {}) {
  const existing = findTenant(s, id);
  if (existing) return existing;
  const tenant = { id, status: TENANT_STATUS.ACTIVE };
  applyOwnerIdentity(tenant, firstName, lastName);
  s.tenants.push(tenant);
  return tenant;
}

// Setzt den KYC-Reifegrad eines Tenants (P6b4). Nebeneffekt im Namen (N7): set*.
// Validiert gegen KYC_ORDER (fail-closed: unbekannte Stufe wirft, statt einen
// Muell-Wert zu persistieren, der das Gate still aushebelt). Fehlender Tenant
// wirft (kein stilles No-Op). Reine Mutation, kein IO (Wrapper saved).
export function setKycLevel(s, tenantId, level) {
  if (!KYC_ORDER.includes(level)) throw new Error(`setKycLevel: unbekannte KYC-Stufe ${level}`);
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`setKycLevel: Tenant ${tenantId} nicht gefunden`);
  tenant.kycLevel = level;
  return tenant;
}

// Gate-Praedikat (P6b4): erreicht der Tenant mindestens die geforderte KYC-Stufe?
// Bewusste Asymmetrie (Plan-Beschluss, NICHT aufraeumen): fehlendes kycLevel-Feld
// (Owner/Bestand) gilt als ausreichend -> true (kein Regress, byte-identisch). Ein
// EXPLIZIT gesetzter Wert wird dagegen rangbasiert verglichen (KYC_ORDER-Index) und
// sperrt fail-closed unter der Schwelle. Reine Query, kein IO.
export function kycReached(s, tenantId, minLevel) {
  const tenant = findTenant(s, tenantId);
  if (!tenant || tenant.kycLevel == null) return true; // Bestand/Owner: kein Feld -> Gate passiert
  return KYC_ORDER.indexOf(tenant.kycLevel) >= KYC_ORDER.indexOf(minLevel);
}

// ---- Stripe-Customer/Karte pro Tenant (Pay1) ----
// Setzt die Stripe-Referenzen eines Tenants. Reine Mutation, kein IO (Wrapper saved).
// patch = { customerId?, paymentMethodId? }: NUR uebergebene Keys werden gesetzt
// (selektiver Patch via !== undefined, kein Ueberschreiben mit undefined) - so kann
// der Aufrufer customerId und paymentMethodId unabhaengig voneinander setzen.
// Fehlender Tenant wirft (kein stilles No-Op, Muster wie setKycLevel).
// stripe_customer_id/payment_method_id sind KEINE Secrets (opake cus_/pm_-Referenzen)
// -> speicherbar. Liefert den Tenant.
export function setTenantStripe(s, tenantId, { customerId, paymentMethodId } = {}) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`setTenantStripe: Tenant ${tenantId} nicht gefunden`);
  if (customerId !== undefined) tenant.stripeCustomerId = customerId;
  if (paymentMethodId !== undefined) tenant.stripePaymentMethodId = paymentMethodId;
  return tenant;
}

// Lese-Query der Stripe-Referenzen eines Tenants (Pay1). Reine Query, kein IO.
// Liefert STETS ein Objekt mit beiden Feldern (fehlend -> null, nie undefined) -
// so braucht der Aufrufer (server.js Customer-Match) keinen optional-chaining-Train
// auf den Tenant-Datensatz (G36) und die Tenant-Form-Kenntnis lebt hier (eine Quelle, G5).
export function tenantStripe(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  return {
    customerId: tenant?.stripeCustomerId ?? null,
    paymentMethodId: tenant?.stripePaymentMethodId ?? null,
  };
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
  const number = { id: newId("num"), e164: null, tenantId, provider, status: NUMBER_STATUS.REQUESTED, providerNumberId: null, paymentIntentId: null };
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

// requested -> provisioning. Optionaler paymentIntentId (Payment-Pfad): wird auf
// der Nummer hinterlegt, damit die Rollback-Pfade (cancelHold) ihn nach einer
// Re-Hydrierung wiederfinden. Ohne den Param (payment-off, 2-arg) byte-identisch.
export function beginProvisioning(s, numberId, paymentIntentId = null) {
  const number = transitionNumber(s, numberId, NUMBER_STATUS.PROVISIONING);
  if (paymentIntentId) number.paymentIntentId = paymentIntentId;
  return number;
}

// provisioning -> capturing: Geld-Einzug laeuft (Stripe capture). NUR im Payment-
// Pfad (provisionNumber mit deps.billing). activateNumber deckt capturing -> active ab.
export function beginCapturing(s, numberId) {
  return transitionNumber(s, numberId, NUMBER_STATUS.CAPTURING);
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

// ---- Provisioning-Jobs (P6b2, async Worker) ----
// Persistente Job-Spur (Audit + pg-Roundtrip + RLS), parallel zur Laufzeit-Queue im
// Adapter. recordProvisioningJob ist idempotent ueber idempotencyKey (kein Doppel-
// Record bei Retry). markProvisioningJob setzt den Endstatus (done|failed) + lastError.
export function recordProvisioningJob(s, { numberId, tenantId, idempotencyKey }) {
  const existing = s.provisioningJobs.find((j) => j.idempotencyKey === idempotencyKey);
  if (existing) return existing;
  const job = {
    id: newId("job"),
    numberId,
    tenantId,
    kind: PROVISION_NUMBER_JOB,
    status: PROVISIONING_JOB_STATUS.QUEUED,
    idempotencyKey,
    attempts: 0,
    lastError: null,
  };
  s.provisioningJobs.push(job);
  return job;
}

export function markProvisioningJob(s, jobId, status, lastError = null) {
  const job = s.provisioningJobs.find((j) => j.id === jobId);
  if (!job) return null;
  job.status = status;
  job.attempts += 1;
  if (lastError) job.lastError = lastError;
  return job;
}

// ---- Usage / Budget-Guard (Daten-Schicht pro-Tenant, P4) ----
// Liefert den Usage-Bucket eines Tenants und LEGT IHN BEI BEDARF AN (Nebeneffekt
// im Kommentar; der Aufrufer reicht stets eine konkrete tenantId). So lebt der
// Map-Zugriff genau einmal (G5) - keine s.usage[tenantId]-Duplizierung verstreut.
export function usageFor(s, tenantId) {
  return (s.usage[tenantId] ||= emptyUsage());
}

// Lese-Zugriff auf den Usage-Bucket eines Tenants ueber die EINE Lazy-Default-Quelle
// (usageFor) - so liefert /api/state/get_agent_status (I5) NIE undefined fuer einen
// Tenant ohne Bucket, ohne den Lazy-Default ausserhalb usageFor zu duplizieren (G5).
// Nebeneffekt geerbt von usageFor (legt den Bucket bei Bedarf an, wie settingsFor/
// calendarFor liest); reine Query in der Fassade (kein save). Eigener Fassaden-Name,
// damit die Lese-Absicht an der Fassaden-Grenze sichtbar ist.
export function usageOf(s, tenantId) {
  return usageFor(s, tenantId);
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

// USD-Kosten eines Token-Verbrauchs (Claude-Preise pro 1M Tokens). EINE Quelle
// (G5) der Preisformel: trackUsage (Live-Bucket, EUR-Float) UND aiCostCents
// (Stripe-Meter, Ganzzahl Cents) leiten ihren Betrag hieraus ab.
function tokenCostUsd(inputTokens, outputTokens, cfg) {
  return (inputTokens / 1e6) * cfg.priceInPerMTokUsd + (outputTokens / 1e6) * cfg.priceOutPerMTokUsd;
}

// Bucht KI-Token-Verbrauch + Kosten auf den Usage-Bucket des Tenants (P4).
// costEur bleibt JS-Float (Bestand, akzeptiertes Risiko). Liefert den Bucket.
export function trackUsage(s, tenantId, inputTokens, outputTokens, cfg) {
  const usage = usageFor(s, tenantId);
  usage.inputTokens += inputTokens;
  usage.outputTokens += outputTokens;
  usage.costEur += tokenCostUsd(inputTokens, outputTokens, cfg) * cfg.usdToEur;
  return usage;
}

// Effektiver pro-Tenant-Cap in EUR: existiert eine tenant_budget-Zeile, gilt deren
// hard_cap_cents (Ganzzahl Cents -> EUR ueber CENTS_PER_EUR); sonst der globale
// cfg.maxBudgetEur (Owner/Bestand ohne Zeile -> byte-identisch). EINE Stelle fuer
// die Cap-Aufloesung (G5), von budgetExceeded genutzt.
function effectiveCapEur(s, tenantId, cfg) {
  const budget = s.tenantBudgets.find((b) => b.tenantId === tenantId);
  return budget ? budget.hardCapCents / CENTS_PER_EUR : cfg.maxBudgetEur;
}

// Pro-Tenant-Budget (P6b3): der LIVE-usage-Bucket gegen den EFFEKTIVEN Cap (pro-
// Tenant hard_cap_cents wenn gesetzt, sonst cfg.maxBudgetEur). Verbrauchsquelle
// bleibt die usage-Map (schneller Live-Gate, kein Doppelzaehlen mit usage_event);
// neu ist NUR die pro-Tenant-Decke. globalBudgetExceeded bleibt PARALLEL.
export function budgetExceeded(s, tenantId, cfg) {
  return usageFor(s, tenantId).costEur >= effectiveCapEur(s, tenantId, cfg);
}

// Setzt/aktualisiert die per-Tenant-Kostendecke (P6b3). Upsert ueber tenantId
// (eine Zeile pro Tenant). budgetCents = weiches Inklusiv-Kontingent (Billing-
// Anzeige), hardCapCents = harte Call-Sperre (budgetExceeded). Reine Mutation,
// kein IO. Money als GANZZAHL Cents (G26). Liefert die Zeile.
export function setTenantBudget(s, tenantId, { budgetCents, hardCapCents }) {
  const existing = s.tenantBudgets.find((b) => b.tenantId === tenantId);
  if (existing) {
    existing.budgetCents = budgetCents;
    existing.hardCapCents = hardCapCents;
    return existing;
  }
  const row = { tenantId, budgetCents, hardCapCents };
  s.tenantBudgets.push(row);
  return row;
}

// Logischer AI-Token-Kostenanteil in GANZZAHL Cents (P6b3, Stripe-Meter). Leitet
// sich aus DERSELBEN Preisformel ab wie der trackUsage-Live-Bucket (tokenCostUsd,
// G5) - hier nur nach EUR-Cents gerundet (Money at rest = Ganzzahl Cents, G26).
export function aiCostCents(inputTokens, outputTokens, cfg) {
  return Math.round(tokenCostUsd(inputTokens, outputTokens, cfg) * cfg.usdToEur * CENTS_PER_EUR);
}

// Append-only Usage-Ledger-Eintrag (P6b3, Stripe-Meter-Quelle). NIE mutiert
// (nur stripeMeterSent flippt beim Flush). costCents als GANZZAHL Cents (G26).
// kind aus USAGE_EVENT_KIND (fail-closed: unbekanntes kind wirft). callId
// optional (number_month-Meter hat keinen Call). Liefert den Eintrag.
export function recordUsageEvent(s, { tenantId, callId = null, kind, quantity, costCents }) {
  if (!Object.values(USAGE_EVENT_KIND).includes(kind))
    throw new Error(`recordUsageEvent: unbekanntes kind '${kind}'`);
  const event = {
    id: newId("ue"),
    tenantId,
    callId,
    kind,
    quantity,
    costCents,
    occurredAt: new Date().toISOString(),
    stripeMeterSent: false,
  };
  s.usageEvents.push(event);
  return event;
}

// Noch nicht gemeldete Ledger-Eintraege (Flush-Quelle, billing/meter.js). Reine Query.
export function pendingMeterEvents(s) {
  return s.usageEvents.filter((e) => !e.stripeMeterSent);
}

// Markiert die gemeldeten Events als gesendet (Idempotenz-Schloss: zweiter Flush
// findet sie nicht mehr in pendingMeterEvents). Liefert die Anzahl der Flips.
export function markMeterEventsSent(s, eventIds) {
  const ids = new Set(eventIds);
  let n = 0;
  for (const e of s.usageEvents) {
    if (ids.has(e.id) && !e.stripeMeterSent) {
      e.stripeMeterSent = true;
      n++;
    }
  }
  return n;
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
// Liefert den Settings-Bucket eines Tenants und LEGT IHN BEI BEDARF AN (Lazy-Init
// als bewusster, dokumentierter Nebeneffekt, analog usageFor). So lebt der
// Map-Zugriff genau einmal (G5). Ein neuer Tenant bekommt frische defaultSettings();
// der Owner ist in der Map vorbelegt.
export function settingsFor(s, tenantId) {
  return (s.settings[tenantId] ||= defaultSettings());
}

// Whitelist gegen die Default-Settings: nur bekannte Keys mit passendem Typ.
// Unbekannte Keys / falsche Typen werden ignoriert - POST /api/settings kann
// so keine fremden Felder in den Store schreiben oder Typen kippen.
// Liefert auch die uebernommenen Keys (fuers Audit-Log in server.js).
export function updateSettings(s, tenantId, patch) {
  const allowed = defaultSettings();
  const changed = [];
  const target = settingsFor(s, tenantId);
  for (const [key, value] of Object.entries(patch || {})) {
    if (key in allowed && typeof value === typeof allowed[key]) {
      target[key] = value;
      changed.push(key);
    }
  }
  return { settings: target, changed };
}

// ---- Rechteprofile pro Nutzer (Phase 2) ----
// Effektives Profil fuer eine Identitaet. null/leer (localhost/stdio ohne JWT)
// -> Owner. Bekannte Identitaet -> gespeichertes Profil ueber DEFAULT gemerged
// (fehlende Felder fallen restriktiv zurueck). Unbekannt -> DEFAULT.
export function resolveProfile(s, email) {
  return resolveProfileFrom(email, email ? s.profiles[email] : undefined);
}

// ---- Tenant-Aufloesung (Auth-Achse, I4) ----
// Geschwister zu resolveProfile, ABER mit umgekehrter Fail-Semantik. resolveProfile
// faellt bei leerer Identitaet bewusst fail-OPEN auf Owner (resolveProfileFrom(!email)
// -> OWNER_PROFILE in defaults.js): das vergibt RECHTE konservativ an den Owner.
// resolveTenant DARF diese Semantik NIEMALS erben: leere/null/unbekannte Identitaet
// -> null (Reject), NIE OWNER_TENANT_ID. Ein Default-Tenant hier wuerde den ganzen
// Tenant-Scope (I5/I6/I7) umgehbar machen - still, weil Owner-only-Tests gruen blieben.
// 1:1 (#2): liefert genau eine tenantId ODER null, keine Liste. Keyt auf idpSubject (#1).
export function resolveTenant(s, idpSubject) {
  if (!idpSubject) return null; // leer/null NICHT iterieren -> kein versehentlicher Owner-Fallback
  const tenant = tenantsOf(s).find((t) => t.idpSubject === idpSubject);
  return tenant ? tenant.id : null;
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
