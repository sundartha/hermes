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
  BOOTSTRAP_TENANT_ID,
  sanitizeProfile,
  resolveProfileFrom,
  MAX_NOTIFICATIONS,
  DEFAULT_PROVIDER,
  PROVIDER,
  DEFAULT_COUNTRY,
  DEFAULT_LANGUAGE,
  normNum,
  E164,
  countryAllowed,
  NUMBER_STATUS,
  NUMBER_TRANSITIONS,
  GLOBAL_CAP_REASON,
  TENANT_STATUS,
  PROVISIONING_JOB_STATUS,
  PROVISION_NUMBER_JOB,
  USAGE_EVENT_KIND,
  CENTS_PER_EUR,
  KYC_LEVEL,
  KYC_ORDER,
} from "./defaults.js";
import { SUPPORTED_LANGUAGES, PERSONA_STYLE_IDS } from "../i18n/locales.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_SECOND = 1000;

export function makeDefaultState() {
  return {
    settings: defaultSettingsMap(),
    calls: [], // {id, direction, from, to, goal, status, startedAt, endedAt, transcript:[{role,text,at}], summary, actionItemIds:[ids]}
    actionItems: [], // {id, callId, text, type:"todo"|"appointment", done, createdAt}
    calendar: calendarMap(),
    usage: emptyUsageMap(),
    notifications: [], // {id, title, body, at, callId}
    // Rechteprofile pro Tenant (Phase 2, Phase S re-keyed): { "<tenantId>": {<Profil-Felder>} }.
    // Eigener Top-Level-Key - updateSettings faesst ihn bewusst NICHT an.
    profiles: {},
    // Bootstrap-Tenant als Code-Default (status active), konsistent zu den
    // [BOOTSTRAP_TENANT_ID]-Buckets in settings/calendar/usage. Identitaet (ownerName)
    // ist NICHT mehr vorbelegt (P2b: kein config-Seed) - sie kommt ueber Self-Service
    // bzw. scripts/bootstrap-tenant.js. Weitere Tenants ueber registerTenant (Onboarding).
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: TENANT_STATUS.ACTIVE }], // [{ id, status }]
    // E.164 -> tenant_id Routing-Tabelle (P3c) + Lifecycle. Owner-Nummer ist
    // config-derived (seedBootstrapNumber, status active). 'requested' Nummern haben
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
    // In-Flight-Reserven (OUT-05): tenantId -> GANZZAHL Cents noch nicht abgerechneter
    // Worst-Case-Kosten laufender Outbound-Calls. STRUKTURELL EPHEMER: nie auf Platte
    // (json.save schliesst es aus), nie in pg (kein Flush) -> ein Neustart startet bei 0
    // (korrekt: ein Boot toetet in-flight Calls, A6). Money at rest = Ganzzahl Cents (G26).
    reservations: {},
  };
}

export function newId(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---- Calls ----

// createCall verlangt seit P3 einen expliziten tenantId (kein stiller Bootstrap-Default
// mehr). Ein Call ohne Tenant darf NIE entstehen - er liefe sonst auf einen fremden
// Usage-/Budget-Bucket (Cross-Tenant). Wirft fail-closed mit Kontext (P8), statt still
// zu defaulten. Beide realen Aufrufer (server.js Inbound/Outbound) liefern tenantId.
function requireTenantId(tenantId) {
  if (!tenantId) throw new Error("createCall: tenantId ist Pflicht (kein Default-Tenant)");
  return tenantId;
}

export function createCall(
  s,
  {
    direction,
    from,
    to,
    goal,
    twilioSid,
    briefing,
    constraints,
    context,
    language,
    maxDurationS,
    requestedBy,
    tenantId,
    provider,
    reserveCents,
  },
) {
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
    // P3 (PLAN-PERSONAL-ASSISTANT): strukturierter Per-Call-Kontext (additiv NULLABLE).
    // Nur befuellt, wenn der Server das Flag an hat (sonst null -> Prompt-Block + Persist
    // byte-identisch). Speist KEINE Identitaetsgroesse; reine Hintergrund-Faerbung.
    context: context || null,
    // caller_name-Producer entfernt (G1, Identitaets-Bindung): die Offenlegung ist
    // an tenant.ownerName gebunden, NICHT per Call-Parameter setzbar. DB-Spalte
    // bleibt additiv nullable (kein destruktives Migrat) -> Feld bleibt im Record.
    callerName: null,
    language: language || "de",
    maxDurationS: maxDurationS || null,
    // Wer den Call ausgeloest hat: <email> bei authentifizierten MCP-Nutzern,
    // sonst "owner" (localhost/stdio). Fuer Audit + pro-Nutzer-Stundenlimit.
    requestedBy: requestedBy || null,
    // Tenant, dem dieser Call gehoert (P4). Inbound: via numberRecord.tenantId;
    // Outbound: aufgeloester, REJECT-gepruefter requestTenant (server.js). Steuert den
    // Usage-Bucket + die pro-Tenant-Achse von countOutboundCallsSince. Fail-closed (P3):
    // fehlendes tenantId -> Throw (requireTenantId), KEIN stiller Bootstrap-Default.
    tenantId: requireTenantId(tenantId),
    status: "active", // active | completed | failed | cancelled
    startedAt: new Date().toISOString(),
    answeredAt: null,
    endedAt: null,
    transcript: [],
    summary: null,
    objectiveAchieved: null,
    // F2 P9 (M2): persistierter Summary-SMS-Dedup-Marker (ISO-Zeit nach erfolgreichem
    // Send, sonst null). Initial null - byte-identisch zur pg-Hydrierung (rowToCall), kein
    // json<->pg-Shape-Drift. NIE nach aussen (publicCall strippt ihn wie streamToken/_finished).
    summarySmsSentAt: null,
    // CDF1: maschinenlesbarer Fehlergrund (mapped Token), gesetzt im /voice/status-Callback
    // bei nicht erfolgreichem Call. Initial null - byte-identisch zur pg-Hydrierung (rowToCall),
    // kein json<->pg-Shape-Drift.
    failureReason: null,
    // F9 (A6): persistierter Bucht-Marker (ISO nach erfolgreicher Abrechnung in finishCall,
    // sonst null). Ueberlebt - anders als das In-Memory-Flag _finished - den Restart und macht
    // die Voice-Minuten-Buchung prozessuebergreifend genau-einmal. NULL -> null (pg-Parity via
    // rowToCall). Muster summarySmsSentAt.
    billedAt: null,
    // P5 (C-Telnyx, PLAN-TELNYX-AI-ASSISTANT.md): per-Call-Bearer-Secret (Shim-Auth) +
    // Call-Control-Handles. Initial null, erst bei erfolgreicher Call-Control-Origination
    // gesetzt (telnyx-origination.js) - byte-identisch zur pg-Hydrierung (rowToCall), kein
    // json<->pg-Shape-Drift. aiAssistantToken NIE nach aussen (publicCall strippt es).
    aiAssistantToken: null,
    callControlId: null,
    assistantId: null,
    // OUT-05 (F2): Worst-Case-Reserve dieses Calls (GANZZAHL Cents) + Idempotenz-Schloss der
    // Freigabe. reserveCents/reserveReleased sind reine Referenz-/Idempotenz-Daten fuer
    // releaseOutboundReserve + den Backstop-Timer; der Reserve-LEDGER (s.reservations) ist
    // strukturell ephemer. Inbound/Legacy ohne Reserve -> 0/false (No-op-Freigabe). KEINE
    // pg-Spalte (bewusst nicht persistiert): nach Boot ist die Reserve ohnehin 0 (ephemer).
    reserveCents: reserveCents || 0,
    reserveReleased: false,
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
// Exportiert (statt file-privat), weil pg.js denselben Scope an zwei Stellen braucht:
// VOR der Erase-Mutation (Hard-Delete-Pfad fuer eraseTenantData, F8/A6-Fix) UND im
// normalen Flush (flushTenantScope) - EINE Quelle statt eines zweiten/dritten Filters
// mit derselben Regel (G5).
export function tenantCallScope(s, tenantId) {
  const calls = s.calls.filter((c) => c.tenantId === tenantId);
  return { calls, callIds: new Set(calls.map((c) => c.id)) };
}

// Per-Tenant-DSGVO-Loeschung (Art. 17): entfernt ALLE call-verknuepften Daten
// EINES Tenants - die Calls (samt Roh-Transkript), die daraus extrahierten Action
// Items und die call-verknuepften Notifications. Tenant-Scope kommt aus
// tenantCallScope (eine Quelle). Vom tenant-Record wird GEZIELT NUR die private
// Summary-Nummer entfernt (F2 P10): sie ist ein personenbezogenes Kontaktdatum und
// faellt damit unter Art. 17, anders als settings/profiles/numbers/calendar/usage
// (Service-Config/Identitaet/Budget-Gate), die UNANGETASTET bleiben. Reine Mutation,
// kein IO. Liefert Loesch-Zaehler fuers Audit (KEINE Inhalte; privateNumber als 0/1,
// NIE der Wert -> kein PII-Leak ins Log). NIE cross-tenant.
export function eraseTenantData(s, tenantId) {
  const { calls: targetCalls, callIds } = tenantCallScope(s, tenantId);
  const removed = {
    calls: targetCalls.length,
    transcriptSegments: targetCalls.reduce((sum, c) => sum + c.transcript.length, 0),
    actionItems: 0,
    notifications: 0,
    privateNumber: 0,
  };
  const itemsBefore = s.actionItems.length;
  const notifsBefore = s.notifications.length;
  s.calls = s.calls.filter((c) => !callIds.has(c.id));
  s.actionItems = s.actionItems.filter((a) => !callIds.has(a.callId));
  s.notifications = s.notifications.filter((n) => !callIds.has(n.callId));
  removed.actionItems = itemsBefore - s.actionItems.length;
  removed.notifications = notifsBefore - s.notifications.length;
  // Private Summary-Nummer (PII-Kontaktdatum) am tenant-Record loeschen, falls gesetzt.
  // Feld ENTFERNEN (nicht null setzen) -> exportTenantData/tenantPrivateNumber faellt
  // sauber auf "keine Nummer" zurueck (Skip-Pfad in finishCall bleibt verlaesslich, kein
  // Daten-Muell at rest). Zaehler 0/1, damit der Wrapper auch ohne Call-Treffer saved.
  const tenant = findTenant(s, tenantId);
  if (tenant && tenant.privateNumber != null) {
    delete tenant.privateNumber;
    removed.privateNumber = 1;
  }
  return removed;
}

// Nicht-destruktive Auskunft/Export (Art. 15/20): reine Query, KEIN save. Liefert
// ueber tenantCallScope GENAU den Umfang, den eraseTenantData treffen wuerde -
// call-verknuepfte Daten EINES Tenants - PLUS die private Summary-Nummer (F2 P10):
// das personenbezogene Kontaktdatum, das eraseTenantData loescht, gehoert spiegelbildlich
// in die Auskunft (gleicher tenant-Record als Quelle, kein Export/Erase-Drift). null,
// wenn keine gesetzt. KEIN Strippen der Calls hier (das macht die API-Schicht via
// publicCall, um streamToken nicht zu leaken). Die UNMASKIERTE Nummer erreicht nur den
// auth-gegateten, tenant-gescopten Art.-15-Export (/api/tenant-data/export); die
// /api/self-service/state-Sicht liest sie NICHT hieraus, sondern maskiert separat (P6, H4).
export function exportTenantData(s, tenantId) {
  const { calls, callIds } = tenantCallScope(s, tenantId);
  return {
    tenantId,
    exportedAt: new Date().toISOString(),
    privateNumber: findTenant(s, tenantId)?.privateNumber ?? null,
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

// Setzt Terminal-Status + EXPLIZITEN endedAt-Anker (F9). Idempotent: nur aus 'active'
// (Muster endCallRecord). Der explizite Anker (statt new Date()) ist die Grundlage fuer die
// gekappte Zombie-/Timer-Terminalisierung in F10/F12 (nie Boot-Zeit). Nebeneffekt im Namen (N7).
export function setCallEndedAt(s, callId, status, endedAtIso) {
  const call = getCall(s, callId);
  if (!call) return { call: null, changed: false };
  let changed = false;
  if (call.status === "active") {
    call.status = status;
    call.endedAt = endedAtIso;
    changed = true;
  }
  return { call, changed };
}

// Live-Pfade (cancel / /voice/status): now-basierter Terminalisierer, verhaltens-identisch
// zum Bestand (endedAt = jetzt). Delegiert an setCallEndedAt (kein Duplikat, G5).
export function endCallRecord(s, callId, status = "completed") {
  return setCallEndedAt(s, callId, status, new Date().toISOString());
}

// Persistierter Dedup-Marker fuer die Summary-SMS (F2 P9, M2): setzt summarySmsSentAt
// (ISO) am Call-Record NACH erfolgreichem Send. Ueberlebt - anders als das In-Memory-
// Flag call._finished - einen Prozess-Restart zwischen Call-Ende und spaetem
// /voice/status-Retry und macht den Versand so idempotent (genau eine SMS). Idempotent
// (gesetzter Marker gewinnt, Muster wie markAnswered). Wrapper saved bei changed.
export function markSummarySmsSent(s, callId) {
  const call = getCall(s, callId);
  let changed = false;
  if (call && !call.summarySmsSentAt) {
    call.summarySmsSentAt = new Date().toISOString();
    changed = true;
  }
  return { call, changed };
}

// F9 (A6): persistierter Bucht-Marker. Set-once (gesetzter gewinnt, Muster markSummarySmsSent):
// ein verspaeteter /voice/status-Retry NACH einem Restart findet den Marker und bucht die
// Voice-Minuten NICHT erneut. Wrapper saved bei changed.
export function markBilled(s, callId) {
  const call = getCall(s, callId);
  let changed = false;
  if (call && !call.billedAt) {
    call.billedAt = new Date().toISOString();
    changed = true;
  }
  return { call, changed };
}

// Anker der Max-Dauer-Rechnung: der ECHTE Call-Start (answeredAt bevorzugt, sonst startedAt),
// NIE der Boot-Zeitpunkt. Fehlt beides -> NaN (Aufrufer clampen auf 0).
function callStartAnchorMs(call) {
  return Date.parse(call.answeredAt ?? call.startedAt ?? "");
}

// Hartes Max-Dauer-Limit dieses Calls in ms (call-eigenes maxDurationS vor injiziertem Default).
// config-frei: defaultMaxDurationS reicht der Aufrufer (server.js: config.maxCallDurationS) herein.
function callLimitMs(call, defaultMaxDurationS) {
  return (call.maxDurationS || defaultMaxDurationS) * MS_PER_SECOND;
}

// Verbleibende Max-Dauer eines Calls ab jetzt (ms), verankert am echten Start (F9). Zombie /
// fehlender Anker -> 0. Speist den Boot-Re-Arm (F10) + Re-Attach (F12): remaining>0 = weiter,
// remaining<=0 = terminalisieren.
export function remainingMaxDurationMs(call, nowMs, defaultMaxDurationS) {
  const anchor = callStartAnchorMs(call);
  if (Number.isNaN(anchor)) return 0;
  return Math.max(0, callLimitMs(call, defaultMaxDurationS) - (nowMs - anchor));
}

// G5 (Review-Blocker Runde 2): eine gemeinsame reine Entscheidung fuer die zwei Aufrufer, die
// bisher denselben Restzeit-Branch dupliziert hatten (Boot-Re-Arm F10 in server.js UND
// Re-Attach F12 in telephony/reattach.js: beide berechneten remainingMaxDurationMs und
// verzweigten identisch remaining<=0 -> terminalisieren, sonst -> Timer armieren). Liefert
// nur die Klassifikation zurueck - die Ausfuehrung (sync/await terminieren vs. Timer armieren,
// Zaehler vs. Rueckgabeobjekt) bleibt bewusst bei jedem Aufrufer selbst.
export function classifyCallTime(call, nowMs, defaultMaxDurationS) {
  const remaining = remainingMaxDurationMs(call, nowMs, defaultMaxDurationS);
  return { remaining, expired: remaining <= 0 };
}

// Deterministischer, gekappter Ende-Zeitpunkt (ms) fuer JEDE Timer-/Re-Arm-Terminalisierung
// (F10/F12): Zombie -> anchor+limit (nie Boot-Abstand), Live-Cap -> ~now. Fehlender Anker -> 0.
export function cappedEndedAtMs(call, nowMs, defaultMaxDurationS) {
  const anchor = callStartAnchorMs(call);
  if (Number.isNaN(anchor)) return 0;
  return Math.min(nowMs, anchor + callLimitMs(call, defaultMaxDurationS));
}

// CDF1 (Report #2 5.4): persistiert den maschinenlesbaren Fehlergrund (mapped Token) am
// Call-Record. Set-once + nur bei truthy reason (Muster markSummarySmsSent): ein spaeter
// /voice/status-Retry ueberschreibt den ersten Grund nicht; reason=null (completed) -> No-op
// (changed=false -> kein Save). Wrapper saved bei changed.
export function recordFailureReason(s, callId, reason) {
  const call = getCall(s, callId);
  let changed = false;
  if (call && reason && !call.failureReason) {
    call.failureReason = reason;
    changed = true;
  }
  return { call, changed };
}

// Zaehlt Outbound-Calls mit startedAt >= sinceIso (gleitendes Fenster fuers Pro-Stunde-Gate
// + den per-(Tenant,Ziel)-Cap in server.js). filters (alle optional, kombinierbar als UND):
//   requestedBy : nur Calls dieses Nutzers (pro-Nutzer-Limit, Bestand)
//   tenantId    : nur Calls dieses Tenants (pro-Tenant-Achse, P4)
//   to          : nur Calls an dieses Ziel (per-(Tenant,Ziel)-Cap, outbound-p1d)
// Ohne Filter: ALLE Outbound-Records (globale Plattform-Bremse, Bestand). Zaehlt
// bewusst auch fehlgeschlagene - konservative Toll-Fraud-Bremse.
export function countOutboundCallsSince(
  s,
  sinceIso,
  { requestedBy = null, tenantId = null, to = null } = {},
) {
  return s.calls.filter(
    (c) =>
      c.direction === "outbound" &&
      c.startedAt >= sinceIso &&
      (requestedBy == null || c.requestedBy === requestedBy) &&
      (tenantId == null || c.tenantId === tenantId) &&
      (to == null || c.to === to),
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
// Schwester-Query zu findTenantByNumber (F1 Phase 4): liefert den VOLLEN aktiven
// Number-Record (e164, tenantId, country, language, provider, ...) statt nur der
// tenantId. /voice/incoming holt damit in EINEM Lookup tenantId UND number.language
// (Inbound-Sprache, §0-A: die angerufene Nummer ist der Geo-Anker). Dieselbe Praedikat-
// Kette wie findTenantByNumber (nur status='active' routet, exakter E.164-Vergleich) -
// findTenantByNumber delegiert hierher, damit es nur EINE Quelle der Routing-Regel gibt.
// null = unbekannte ODER nicht-aktive Nummer (fail-closed beim Aufrufer).
export function numberRecordByE164(s, e164) {
  if (!e164) return null;
  return s.numbers.find((n) => n.e164 === e164 && n.status === NUMBER_STATUS.ACTIVE) || null;
}

export function findTenantByNumber(s, e164) {
  return numberRecordByE164(s, e164)?.tenantId ?? null;
}

// Aufloesungs-Praezedenz der Gespraechssprache (F1 Phase 4, Owner-Entscheidung #8) an
// EINER Stelle: settings.language (Owner-Override, falls gesetzt) -> number.language ->
// tenant.defaultLanguage -> DEFAULT_LANGUAGE ("de"). Jede Stufe greift nur, wenn truthy
// (additiv NULLABLE, Backfill-frei: fehlend/leer = nicht gesetzt = naechste Stufe). Eine
// unbekannte/getippte Sprache wirft hier NICHT - der nachgelagerte localeFor()-Resolver
// faellt fail-safe auf "de" (R7). numberRecord ist der bereits aufgeloeste Record (oder
// null/undefined, dann faellt die Number-Stufe durch). Reine Lese-Logik, kein Nebeneffekt
// (settingsFor legt zwar lazy einen Bucket an, aber das ist Bestandsverhalten).
export function resolveCallLanguage(s, { tenantId, numberRecord }) {
  const settingsLang = settingsFor(s, tenantId).language;
  const tenant = findTenant(s, tenantId);
  return settingsLang || numberRecord?.language || tenant?.defaultLanguage || DEFAULT_LANGUAGE;
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
// country/language (F1, Phase 1) als optionale Params mit DE/de-Default (eine Quelle:
// defaults.js): die geseedete Owner-/Bestandsnummer traegt damit ihren Geo-Anker
// (Inbound-Sprache, Outbound-Absenderwahl). Bestehende 3-/4-Arg-Aufrufe bleiben
// verhaltens-erhaltend (Default DE/de = heutiger De-facto-Zustand). Additiv NULLABLE
// in der DB; ein Bestands-Record ohne Werte faellt ueber den Code-Fallback zurueck.
export function seedBootstrapNumber(
  s,
  e164,
  tenantId,
  provider = DEFAULT_PROVIDER,
  country = DEFAULT_COUNTRY,
  language = DEFAULT_LANGUAGE,
) {
  const norm = normNum(e164);
  if (!norm) return;
  if (s.numbers.some((n) => n.e164 === norm)) return;
  // Geseedete Owner-Nummer ist in Benutzung -> status active. id, damit
  // number_assignment/Lifecycle sie referenzieren koennen.
  s.numbers.push({
    id: newId("num"),
    e164: norm,
    tenantId,
    provider,
    country,
    language,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: null,
  });
}

// Config-derive Owner-Nummer-Seed beim Boot (analog seedBootstrapIdentity): traegt die
// Owner-Absendernummer aus (e164, provider) ein. Render free hat ein fluechtiges
// Dateisystem -> ohne diesen Seed waere nach jedem Deploy keine aktive Owner-Nummer im
// Store und der Boot-Guard (server.js) braeche fail-closed ab (Owner-Outbound/SMS tot).
// Provider wird gegen PROVIDER validiert (wie scripts/seed-owner-number.js): ungueltig
// oder leer -> KEIN Seed (fail-closed, kein Muell-Provider). Leere e164 -> No-Op
// (seedBootstrapNumber). Idempotent ueber seedBootstrapNumber (e164 normalisiert, vorhandene
// gewinnt). KEIN Magic-Default fuer die Nummer - e164 kommt nur vom Aufrufer.
export function seedBootstrapNumberFromConfig(s, e164, tenantId, provider) {
  if (!Object.values(PROVIDER).includes(provider)) return;
  seedBootstrapNumber(s, e164, tenantId, provider);
}

// Operativer Erst-Setup (CLI scripts/bootstrap-tenant.js): stellt den Bootstrap-Tenant
// (status active) sicher UND traegt seine aktive Bestandsnummer ein. Komponiert die
// bestehenden Bausteine (G5): Tenant-Record idempotent + seedBootstrapNumber (idempotent
// ueber normNum). Ersetzt den fruehen config-derived Boot-Seed (P2b): der erste Tenant
// lebt danach im Store, nicht in der Env. seedBootstrapNumber allein wuerde nur die Nummer
// eintragen - auf einem Bestands-Store ohne diesen Tenant fehlte der Tenant-Record
// (tenantContext/Identitaet liefen ins Leere), darum beides in EINER Mutation. Kein IO
// (der Backend-Wrapper saved). Idempotent: zweiter Lauf = No-Op (findTenant hoisted).
export function bootstrapTenant(s, e164, tenantId, provider = DEFAULT_PROVIDER) {
  if (!findTenant(s, tenantId)) s.tenants.push({ id: tenantId, status: TENANT_STATUS.ACTIVE });
  seedBootstrapNumber(s, e164, tenantId, provider);
  // KYC-Heal NUR fuer den Bootstrap/Owner (Phase outbound-p1fix): ein per CLI off-label mit
  // Nicht-Owner-tenantId angelegter Tenant darf NICHT auto-id_verified werden (waere KYC-Gate-
  // Bypass + Call-Anyone-Subscriber). Tenant-/Nummer-Anlage bleibt fuer JEDEN tenantId; nur der
  // KYC-Heal ist gegated. seedBootstrapKyc bleibt general - der Guard sitzt an der off-label
  // Eintrittsstelle, NICHT in der Funktion (G2/Least-Astonishment).
  if (tenantId === BOOTSTRAP_TENANT_ID) seedBootstrapKyc(s, tenantId);
}

// Seedet die private Summary-Zielnummer des OWNER-Tenants idempotent aus der config-
// Owner-Nummer (F2 P11). Hintergrund: seit P7 geht die Inbound-Summary-SMS an
// tenant.privateNumber (NICHT mehr config.ownerNumber) - ohne diesen Seed verloere der
// Owner nach der finishCall-Umstellung STILL seine eigene Summary-SMS. Config-frei:
// rawOwnerNumber wird durchgereicht (Muster seedBootstrapIdentity/seedBootstrapNumberFromConfig,
// state-ops bleibt config-frei). Idempotent: hat der Owner schon eine privateNumber, No-Op
// (gesetzte gewinnt - kein Override einer per Self-Service gesetzten Nummer). Validierung
// ueber die EINE geteilte Quelle normalizePrivateNumber (G5), aber mit Laendercode-Gate AUS
// ("*"): die config-Owner-Nummer ist Plattform-TRUSTED (dieselbe, die seedBootstrapNumber als
// aktive Absendernummer eintraegt) - die Toll-Fraud-Bremse (countryAllowed) gilt nur fuer
// USER-Eingaben (self-service/onboarding), nicht fuers Boot-Seeding der Owner-Config.
// Ungueltiges E.164-Format ODER leere Config -> KEIN Seed (boot-sicher, KEIN Throw; der
// Aufrufer warnt). Fehlender Owner-Tenant -> No-Op. Liefert true, wenn der Owner DANACH
// eine privateNumber hat (frisch geseedet ODER schon vorhanden), sonst false -> der
// Aufrufer kann fail-soft eine PII-freie Boot-Warnung emittieren.
export function seedBootstrapPrivateNumber(s, rawOwnerNumber, tenantId) {
  const owner = findTenant(s, tenantId);
  if (!owner) return false;
  if (owner.privateNumber) return true; // idempotent: gesetzte Nummer gewinnt
  let e164;
  try {
    e164 = normalizePrivateNumber(rawOwnerNumber, ["*"]); // "*" -> kein Laendercode-Gate (TRUSTED)
  } catch {
    return false; // ungueltiges E.164-Format in der Owner-Config -> kein Seed
  }
  if (!e164) return false; // leere/fehlende Config -> kein Seed
  owner.privateNumber = e164;
  return true;
}

// Bindet die Owner-OAuth-Identitaet (WorkOS sub) idempotent an den Bootstrap-Tenant
// (AM6 G4) ueber das I8-additive idpSubject-Feld. Geschwister zu seedBootstrapPrivateNumber:
// set-if-absent (eine per Self-Service/Web-Login gebundene Identitaet gewinnt), config-frei
// (rawSub durchgereicht), kein IO. resolveTenant findet danach den Tenant mit der aktiven
// Nummer ueber den sub-Claim. Minimaler Sanity-Guard (getrimmt, nicht-leer) statt Voll-
// Validierung: der Wert ist Owner-TRUSTED Config, und resolveTenant macht exakt-match
// (ein Muellwert loest fail-closed schlicht nichts auf). Liefert true NUR bei echter
// Mutation -> der pg-Aufrufer flusht dann gezielt die tenant-Tabelle. Fehlender Owner /
// schon gebunden / leer -> false (kein Seed, kein Throw).
export function seedBootstrapIdpSubject(s, rawSub, tenantId) {
  const owner = findTenant(s, tenantId);
  if (!owner || owner.idpSubject) return false; // fehlt / schon gebunden -> kein Seed
  const sub = typeof rawSub === "string" ? rawSub.trim() : "";
  if (!sub) return false; // leere/fehlende Env -> kein Seed (fail-closed)
  owner.idpSubject = sub;
  return true; // mutiert -> pg flusht die tenant-Tabelle
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
// Backend-Wrapper hereingereicht (P2b: leerer "" - kein config.ownerName mehr), damit
// state-ops config-frei bleibt (wie caps bei requestNumber). Fallback gekapselt: hat der
// Tenant keinen eigenen Namen, gilt der durchgereichte (heute leere) ownerName -> ""
// (das Outbound-Gate in server.js faengt einen leeren ownerName fail-closed ab).
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
// registerTenant UND seedBootstrapIdentity (G5: eine Kompositionsstelle). Trimmt; leere
// Teile -> Feld bleibt weg, damit der config-Owner-Fallback im tenantContext sauber
// greift (kein leerer Daten-Muell). ownerName = "firstName lastName".
export function applyOwnerIdentity(tenant, firstName, lastName) {
  const fn = typeof firstName === "string" ? firstName.trim() : "";
  const ln = typeof lastName === "string" ? lastName.trim() : "";
  const full = [fn, ln].filter(Boolean).join(" ");
  if (fn) tenant.firstName = fn;
  if (full) tenant.ownerName = full;
}

// Schreibt Vor-/Nachname (-> komponierter ownerName via applyOwnerIdentity) set-if-absent
// auf einen EXISTIERENDEN Tenant. Findet den Tenant; fehlt er ODER traegt er bereits einen
// ownerName -> No-Op (NIE einen Tenant aus dem Nichts erfinden: sonst aktivierte der Web-
// Login-Pfad versehentlich einen suspendierten Tenant - Invariante 5). Liefert true NUR,
// wenn jetzt ein ownerName steht (echte Mutation) -> der Wrapper flusht nur dann. Geteilt
// von seedBootstrapIdentity (Boot/Owner) UND dem Web-Login-Pfad (P2b). G5: EINE set-if-
// absent-Identitaets-Quelle, EINE Kompositionsstelle (applyOwnerIdentity).
export function setTenantIdentityIfAbsent(s, tenantId, { firstName, lastName } = {}) {
  const tenant = findTenant(s, tenantId);
  if (!tenant || tenant.ownerName) return false;
  applyOwnerIdentity(tenant, firstName, lastName);
  return Boolean(tenant.ownerName);
}

// Stellt die Owner-Identitaet (firstName/lastName -> ownerName) idempotent im Spiegel
// sicher (Variante a, G1). Wie seedBootstrapNumber: json load() ruft makeDefaultState nicht
// auf Bestands-Stores, pg hydriert owner_name als NULL. Schuetzt den UNGEGATETEN Inbound-
// Greeting (server.js) + summarizeCall. Delegiert an die gemeinsame set-if-absent-Quelle
// (setTenantIdentityIfAbsent, G5): traegt der Owner-Tenant bereits ownerName ODER fehlt er
// (seedState ohne tenants) -> No-Op. Leere Config-Teile -> kein Seed (Boot-Refusal in
// assertConfig faengt das ab). Signatur + Verhalten unveraendert (verhaltens-erhaltend).
export function seedBootstrapIdentity(s, firstName, lastName, tenantId) {
  setTenantIdentityIfAbsent(s, tenantId, { firstName, lastName });
}

// Seedt die per-Tenant-Kostendecke EINMALIG beim Registrieren (outbound-p1c, D5): nimmt
// jeden neuen Tenant aus dem geteilten globalen Pool (sonst faellt er in effectiveCapEur
// auf cfg.maxBudgetEur zurueck). Set-if-absent wie idpSubject: nur wenn ein Default > 0
// uebergeben wird UND noch keine tenant_budget-Zeile existiert -> setTenantBudget
// (budget == hard cap == Default). 0/fehlend bzw. schon eine Zeile -> No-Op (Owner/Bestand
// unveraendert). Config-frei (Default kommt als Arg). Kein Throw, kein IO.
function seedTenantDefaultBudget(s, tenantId, defaultBudgetCents) {
  if (!defaultBudgetCents) return; // 0/undefined -> kein Seed (kein 0-Cap-Tenant)
  if (s.tenantBudgets.find((b) => b.tenantId === tenantId)) return;
  setTenantBudget(s, tenantId, { budgetCents: defaultBudgetCents, hardCapCents: defaultBudgetCents });
}

// Idempotent. Set-on-create: legt den Tenant an (status active) und setzt EINMALIG die
// Identitaet (firstName/lastName -> ownerName, idpSubject = WorkOS sub). idpSubject macht
// den Record ueber resolveTenant (MCP/REST) auffindbar -> EINE kanonische Identitaet fuer
// Web-Login UND MCP (Invarianten 1+3). Existiert der Tenant bereits (z.B. per Web-Login
// gebunden), werden NUR FEHLENDE Identitaetsfelder ergaenzt (set-if-absent) - bestehende
// Werte UND der Status bleiben unveraendert (P0 aktiviert nicht; Aktivierung = P3,
// Invariante 5). normalizePrivateNumber validiert in BEIDEN Zweigen VOR jeder Mutation
// (fail-closed; ungueltig/gesperrtes Land -> throw, kein halb gebundener Record).
export function registerTenant(
  s,
  id,
  { firstName, lastName, privateNumber, idpSubject, defaultBudgetCents } = {},
) {
  const e164 = normalizePrivateNumber(privateNumber); // validiert VOR jeder Mutation
  const existing = findTenant(s, id);
  if (existing) {
    if (idpSubject && !existing.idpSubject) existing.idpSubject = idpSubject;
    if (!existing.ownerName) applyOwnerIdentity(existing, firstName, lastName);
    if (e164 && !existing.privateNumber) existing.privateNumber = e164;
    seedTenantDefaultBudget(s, id, defaultBudgetCents); // set-if-absent (D5)
    return existing;
  }
  const tenant = { id, status: TENANT_STATUS.ACTIVE };
  applyOwnerIdentity(tenant, firstName, lastName);
  if (idpSubject) tenant.idpSubject = idpSubject;
  if (e164) tenant.privateNumber = e164;
  s.tenants.push(tenant);
  seedTenantDefaultBudget(s, id, defaultBudgetCents); // set-if-absent (D5)
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

// Heilt den Bootstrap/Owner-Tenant idempotent auf KYC id_verified (Phase outbound-p1).
// Hintergrund: kycReached gilt seit dem fail-closed-Flip fuer fehlendes kyc_level als
// UNZUREICHEND -> ohne diesen Seed braeche der live telefonierende Owner sofort am
// ersten Outbound-Gate (server.js kycGateError). Set-if-absent wie seedBootstrapIdpSubject:
// nur wenn der Tenant existiert UND kein kyc_level traegt -> setKycLevel(id_verified)
// (eine Mutations-/Validierquelle, G5). Stufe id_verified (NICHT card): der Betreiber ist
// out-of-band verifiziert (keine Stripe-Karte) + ueberlebt eine spaetere Anhebung von
// KYC_OUTBOUND_MIN. Liefert true NUR bei echter Mutation -> der pg-Aufrufer flusht dann
// gezielt die tenant-Tabelle. Fehlender Tenant / schon gesetzt -> false (kein Seed, kein
// Throw). Config-frei, kein IO (Muster seedBootstrapIdpSubject).
export function seedBootstrapKyc(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  if (!tenant || tenant.kycLevel != null) return false; // fehlt / schon gesetzt -> kein Seed
  setKycLevel(s, tenantId, KYC_LEVEL.ID_VERIFIED);
  return true; // mutiert -> pg flusht die tenant-Tabelle
}

// Gate-Praedikat (P6b4, fail-closed seit Phase outbound-p1): erreicht der Tenant
// mindestens die geforderte KYC-Stufe? Fehlendes/`null`-kycLevel gilt als UNZUREICHEND
// -> false (fail-closed; schliesst den frueheren null-Bypass: ein ungeseedeter Tenant mit
// aktiver Nummer kam sonst am ersten Outbound-Gate vorbei). Der live telefonierende
// Owner/Bootstrap-Tenant wird beim Boot via seedBootstrapKyc auf id_verified geheilt und
// passiert damit weiter. Ein EXPLIZIT gesetzter Wert wird rangbasiert verglichen
// (KYC_ORDER-Index). Reine Query, kein IO.
export function kycReached(s, tenantId, minLevel) {
  const tenant = findTenant(s, tenantId);
  if (!tenant || tenant.kycLevel == null) return false; // fail-closed: fehlend -> unzureichend
  return KYC_ORDER.indexOf(tenant.kycLevel) >= KYC_ORDER.indexOf(minLevel);
}

// ---- Abo-gekoppeltes Outbound-Allowlist-Gate (W5, Tenant-Achse) ----
// Ist der Tenant ein AKTIVER, KYC-verifizierter Subscriber? GENAU dann gilt im Outbound-
// Allowlist-Gate (server.js) das ZIEL als erfuellt - das aktive Abo + KYC ersetzt die
// statische ALLOWED_NUMBERS-Liste. BEWUSST STRENGER als kycReached: ein EXPLIZIT gesetztes
// kycLevel (>= minLevel) ist Pflicht. kycReached liefert fuer Owner/Bestand (kein kycLevel-
// Feld) bewusst true - das wuerde auch den Owner-/Bestandspfad lockern und ihn vom heutigen
// Verhalten (statische Allowlist) abweichen lassen (Regress). Der zahlende Subscriber
// unterscheidet sich vom Owner GENAU durch das gesetzte kyc_level; nur er wird gelockert.
// Lockert NIE ein hartes Gate (Denylist/Land/Limit/Budget) - dies ist nur das Allowlist-
// Erfuellungssignal. Reine Query, kein IO.
export function tenantActiveSubscriber(s, tenantId, minLevel) {
  const tenant = findTenant(s, tenantId);
  if (!tenant || tenant.status !== TENANT_STATUS.ACTIVE) return false;
  if (tenant.kycLevel == null) return false; // Owner/Bestand: kein Abo-Subscriber
  return KYC_ORDER.indexOf(tenant.kycLevel) >= KYC_ORDER.indexOf(minLevel);
}

// Defense-in-depth fuers Outbound-Gate (W5): ist der Tenant gesperrt/geschlossen? Ein
// EXISTIERENDER Tenant mit status !== active (suspended nach Abo-Kuendigung/Zahlungsausfall,
// oder closed) darf NICHT mehr frei waehlen - das prueft das Gate HART, VOR jeder Profil-/
// Abo-Lockerung. Verlaesst sich NICHT allein auf die Stripe-Webhook-Session-Invalidierung
// (belt-and-suspenders: der Status lebt am selben tenant-Record, den accounts.setStatus
// schreibt). Fehlender Tenant -> false (KEIN Hard-Block: der vorgelagerte TENANT_REJECT-
// Riegel deckt unbekannte Identitaeten ab, und Owner/Bestand bleiben byte-identisch). Reine
// Query, kein IO.
export function tenantInactive(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  return !!tenant && tenant.status !== TENANT_STATUS.ACTIVE;
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

// ---- Abo-Referenzen pro Tenant (W4) ----
// Setzt die Stripe-Abo-Referenzen eines Tenants. Reine Mutation, kein IO (Wrapper saved).
// patch = { subscriptionId?, planSlug?, currentPeriodEnd?, currentPeriodStart? }: NUR
// uebergebene Keys werden gesetzt (selektiver Patch via !== undefined, Muster wie
// setTenantStripe) - so kann der Webhook currentPeriodEnd/Start nachziehen, ohne
// subscriptionId/planSlug zu beruehren. Fehlender Tenant wirft (kein stilles No-Op, Muster
// setTenantStripe). Opake Referenzen (sub_/price-slug/Unix-s), KEINE Secrets. Liefert den Tenant.
export function setTenantSubscription(
  s,
  tenantId,
  { subscriptionId, planSlug, currentPeriodEnd, currentPeriodStart } = {},
) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`setTenantSubscription: Tenant ${tenantId} nicht gefunden`);
  if (subscriptionId !== undefined) tenant.stripeSubscriptionId = subscriptionId;
  if (planSlug !== undefined) tenant.stripePlanSlug = planSlug;
  if (currentPeriodEnd !== undefined) tenant.stripeCurrentPeriodEnd = currentPeriodEnd;
  if (currentPeriodStart !== undefined) tenant.stripeCurrentPeriodStart = currentPeriodStart;
  return tenant;
}

// Lese-Query der Abo-Referenzen eines Tenants (W4). Reine Query, kein IO. Liefert STETS
// ein Objekt mit allen Feldern (fehlend -> null, nie undefined) - Pendant zu tenantStripe
// (kein optional-chaining-Train beim Aufrufer, Tenant-Form-Kenntnis lebt hier, G5).
export function tenantSubscription(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  return {
    subscriptionId: tenant?.stripeSubscriptionId ?? null,
    planSlug: tenant?.stripePlanSlug ?? null,
    currentPeriodEnd: tenant?.stripeCurrentPeriodEnd ?? null,
    currentPeriodStart: tenant?.stripeCurrentPeriodStart ?? null,
  };
}

// Webhook-Tenant-Aufloesung (W4): Tenant ueber sein gespeichertes Abo finden. Reine
// Query, kein IO. Kein Treffer (oder leere subscriptionId) -> null (der Webhook ignoriert
// fail-closed, kein Cross-Tenant-Effekt - kein Suspend eines fremden/unbekannten Tenants).
export function findTenantBySubscription(s, subscriptionId) {
  if (!subscriptionId) return null;
  return s.tenants.find((t) => t.stripeSubscriptionId === subscriptionId) ?? null;
}

// ---- Private Summary-Nummer pro Tenant (F2) ----
// EINE Normalisier-/Validier-Quelle (G5), geteilt von registerTenant (Onboarding) UND
// setPrivateNumber (Self-Service) - kein Drift zwischen den beiden Schreibwegen. Reine
// Funktion (kein Tenant, kein Store). Reihenfolge ist verbindlich (M3): normNum ZUERST
// (strippt Whitespace/-/() ), dann E.164-Format, dann Laendercode-Gate (H1, Toll-Fraud).
// Leer/null/"" -> null (Aufrufer entfernt das Feld; kein Daten-Muell at rest). Ungueltig
// oder gesperrtes Land -> throw (fail-closed). PII: der Roh-/Zielwert wird NIE in die
// Fehlermeldung gehoben (kein Nummer-Leak im Log, H4). Liefert die normalisierte E.164.
// Exportiert, damit der Route-Layer (POST /api/onboard) VOR dem Store-Lock dieselbe
// Quelle nutzt und ungueltige Eingaben als 400 abweist (statt Throw -> 503).
export function normalizePrivateNumber(raw, allowedCountryCodes) {
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) return null;
  const e164 = normNum(raw);
  if (!E164.test(e164)) throw new Error("private number: ungueltiges E.164-Format");
  if (!countryAllowed(e164, allowedCountryCodes))
    throw new Error("private number: Laendercode nicht erlaubt");
  return e164;
}

// Setzt die private Mobilnummer (E.164), an die nach einem Inbound-Call die Gespraechs-
// Zusammenfassung als SMS geht. Identitaets-/Kontaktdatum -> lebt am Tenant-Record
// (NICHT in settings: settings leakt komplett ueber /api/state + MCP, H4). Reine
// Mutation, kein IO (Wrapper saved). Leer/null/"" -> Feld entfernen (Skip-Pfad in
// finishCall bleibt verlaesslich). Ungueltig/gesperrtes Land -> throw (fail-closed, kein
// Muell at rest). Fehlender Tenant -> throw (Muster setKycLevel/setTenantStripe).
// allowedCountryCodes optional (Default ["+49"] via countryAllowed). Liefert den Tenant.
export function setPrivateNumber(s, tenantId, raw, allowedCountryCodes) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`setPrivateNumber: Tenant ${tenantId} nicht gefunden`);
  const e164 = normalizePrivateNumber(raw, allowedCountryCodes);
  if (e164 === null) delete tenant.privateNumber;
  else tenant.privateNumber = e164;
  return tenant;
}

// Lese-Query der privaten Summary-Nummer (F2). Reine Query, kein IO. Liefert die E.164-
// Nummer oder null (nie undefined) - Pendant zu tenantStripe. finishCall zieht das SMS-
// Ziel ueber DIESEN Reader (Schluessel call.tenantId, identisch zum Absender-Lookup ->
// keine Cross-Tenant-Fehlzustellung, H3) - NICHT ueber tenantContext (PII gehoert nicht
// in die LLM-View, H4). Fehlender Tenant -> null.
export function tenantPrivateNumber(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  return tenant?.privateNumber ?? null;
}

// ---- Geo-Location pro Tenant (F1, Phase 1) ----
// Setzt Default-Land + -Sprache eines Tenants, die die Registrierung aus IP-Geo-
// Vorschlag bzw. expliziter User-Wahl ableitet (Fallback fuer neue Nummern dieses
// Tenants). patch = { country?, defaultLanguage? }: NUR uebergebene Keys werden gesetzt
// (selektiver Patch via !== undefined, kein Ueberschreiben mit undefined) - Muster wie
// setTenantStripe. Fehlender Tenant wirft (kein stilles No-Op). Geo-Daten sind nicht
// sensibel (keine Secrets) -> speicherbar. Reine Mutation, kein IO (Wrapper saved).
// Liefert den Tenant. country = ISO-3166-1-alpha-2, defaultLanguage = BCP-47-kurz.
export function setTenantGeo(s, tenantId, { country, defaultLanguage } = {}) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`setTenantGeo: Tenant ${tenantId} nicht gefunden`);
  if (country !== undefined) tenant.country = country;
  if (defaultLanguage !== undefined) tenant.defaultLanguage = defaultLanguage;
  return tenant;
}

// Lese-Query der Geo-Felder eines Tenants (F1). Reine Query, kein IO. Liefert STETS ein
// Objekt mit beiden Feldern (fehlend -> null). Der Webhook-Provisioning-Trigger (P3) liest
// hieraus das Land der anzufragenden Nummer (onboard hat es via setTenantGeo gesetzt).
export function tenantGeo(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  return { country: tenant?.country ?? null, defaultLanguage: tenant?.defaultLanguage ?? null };
}

// Terminale Zustaende (released/failed) belegen keine Kapazitaet mehr - jeder andere
// Zustand ist entweder ein laufender Kaufversuch oder eine real gemietete, kostenpflichtige
// Nummer und zaehlt (Kosten-Notbremse, Invariante "im Zweifel mitzaehlen",
// PLAN-PROVISIONING-CAP.md). Benannt statt doppelter Negation inline (G28/G29).
function occupiesCapacity(number) {
  return number.status !== NUMBER_STATUS.RELEASED && number.status !== NUMBER_STATUS.FAILED;
}

// Nicht-terminale Nummern (requested/provisioning/active/suspended) belegen
// Kosten/Plaetze; released/failed zaehlen nicht. Basis fuer die Cap-Pruefung.
function liveNumbers(s, tenantId = null) {
  return s.numbers.filter((n) => occupiesCapacity(n) && (tenantId == null || n.tenantId === tenantId));
}

// Hat der Tenant mindestens eine NICHT-terminale Nummer? Idempotenz-Praedikat fuer den
// Webhook-Provisioning-Trigger (P3, Invariante 4): GENAU eine Nummer pro bezahltem Abo -
// ein Webhook-Retry/Folge-'updated' findet die bestehende und fragt keine zweite an.
// Reine Query, kein IO. Nutzt liveNumbers (eine Quelle, G5).
export function tenantHasLiveNumber(s, tenantId) {
  return liveNumbers(s, tenantId).length > 0;
}

// Merkt EINEN global_cap-Skip auf dem Tenant (Fix B, reine Observability: KEIN Trigger,
// KEIN Retry, KEIN Cap-Bypass - Invariante 2 PLAN-PROVISIONING-CAP.md). requestNumber ist
// die EINE Quelle (G5) fuer /api/onboard UND den Webhook-Pfad (requestNumberForPaidTenant)
// - beide profitieren automatisch, ohne den Skip-Zustand selbst durchzureichen.
function markNumberProvisionSkipped(tenant, reason) {
  tenant.numberProvisionSkipReason = reason;
  tenant.numberProvisionSkipAt = new Date().toISOString();
}

// Loescht ein zuvor gemerktes Skip-Signal, sobald requestNumber fuer denselben Tenant
// wieder erfolgreich eine Nummer anfragt (Invariante 3: recoverabler Status, kein
// dauerhaft haengender "blocked"-Chip nach erfolgreichem Retry).
function clearNumberProvisionSkip(tenant) {
  tenant.numberProvisionSkipReason = null;
  tenant.numberProvisionSkipAt = null;
}

// Fragt eine neue Nummer fuer einen Tenant an (Onboarding, ZAHLUNGSFREI). Die
// Caps (maxNumbers global, maxNumbersPerTenant) sind die Kosten-Notbremse, die
// das uebersprungene Stripe-Schloss ersetzt - jede echte Nummer kostet Geld.
// KEIN Provider-Kauf hier (der haengt an beginProvisioning). caps kommen aus
// config (state-ops bleibt config-frei). Liefert {ok, number} oder {ok:false, reason}.
// country/language (F1, Phase 1) im Destructure mit DE/de-Default (eine Quelle:
// defaults.js): die angefragte Nummer traegt von Anfang an ihren Geo-Anker, den der
// spaetere Provider-Kauf (Telnyx-Laendersuche) und das Inbound-/Outbound-Routing
// lesen. Bestehende Aufrufer ohne country/language bleiben verhaltens-erhaltend (DE/de).
export function requestNumber(
  s,
  {
    tenantId,
    provider = DEFAULT_PROVIDER,
    country = DEFAULT_COUNTRY,
    language = DEFAULT_LANGUAGE,
    maxNumbers,
    maxNumbersPerTenant,
  },
) {
  const tenant = findTenant(s, tenantId);
  if (!tenant || tenant.status !== TENANT_STATUS.ACTIVE)
    return { ok: false, reason: "tenant_inactive" };
  if (liveNumbers(s).length >= maxNumbers) {
    markNumberProvisionSkipped(tenant, GLOBAL_CAP_REASON);
    return { ok: false, reason: GLOBAL_CAP_REASON };
  }
  if (liveNumbers(s, tenantId).length >= maxNumbersPerTenant)
    return { ok: false, reason: "tenant_cap" };
  const number = {
    id: newId("num"),
    e164: null,
    tenantId,
    provider,
    country,
    language,
    status: NUMBER_STATUS.REQUESTED,
    providerNumberId: null,
    paymentIntentId: null,
  };
  s.numbers.push(number);
  clearNumberProvisionSkip(tenant);
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
// createdAt = ISO-Aufnahmezeit, Grundlage der Staleness-Triage (F4); bei Idempotenz-
// Treffer bleibt der Erst-Zeitstempel erhalten (kein Ueberschreiben durch den Retry).
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
    createdAt: new Date().toISOString(),
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

// Nummer-Zustaende, in denen ein noch QUEUED-Provisioning-Job gegenstandslos ist:
// aktiv/terminal (ACTIVE = Kauf fertig; FAILED/RELEASED = beendet) oder stillgelegt
// (SUSPENDED). -> Job schliessen, NIE nachkaufen.
const PROVISION_CLOSE_NUMBER_STATUS = new Set([
  NUMBER_STATUS.ACTIVE,
  NUMBER_STATUS.FAILED,
  NUMBER_STATUS.RELEASED,
  NUMBER_STATUS.SUSPENDED,
]);

// Alters-Gate fuer den geld-sicheren Re-Drive - EINE Quelle (G5) fuer den Boot-Sweep-
// Klassifikator (classifyQueuedProvisioningJobs) UND den Retry-Lever (resolveProvisionRetry,
// F7). Liefert den hold-/block-Grund oder null, wenn der Job jung genug ist (innerhalb des
// Anbieter-Idempotenz-Fensters -> re-drive-sicher). "unknown_age": createdAt fehlt/unparsebar
// (fail-closed, Alter unbekannt); "too_old": aelter als maxAgeMs. maxAgeMs===0 (Observe-Only)
// -> jeder reale Job ist "too_old". Ein zweiter Ort duerfte NICHT driften (Doppelkauf-Risiko).
export function redriveAgeHoldReason(job, nowMs, maxAgeMs) {
  const createdMs = Date.parse(job.createdAt ?? "");
  if (!job.createdAt || Number.isNaN(createdMs)) return "unknown_age";
  if (nowMs - createdMs > maxAgeMs) return "too_old";
  return null;
}

// ---- PROV-01 Crash-Recovery: reiner Klassifikator (F4) ----
// Triagiert ALLE QUEUED-Provisioning-Jobs in drei DISJUNKTE Koerbe. REIN und IO-frei
// (mutiert s NICHT, kein Date.now, kein save): nowMs/maxAgeMs/kycMinLevel kommen als
// Argument -> testbar/repeatable (F.I.R.S.T.) und config-frei (state-ops-Invariante).
// Backend-agnostisch (json + pg liefern denselben Shape). Ein Boot-Reconciler (F5,
// NICHT Teil dieser Phase) fuehrt spaeter NUR den geld-sicheren redrive-Korb nach.
//   close   : Nummer fehlt oder aktiv/terminal/suspended -> Job schliessen (Job[]).
//   hold    : mid-flight (provisioning/capturing) ODER kein aktiver KYC-Subscriber ODER
//             Alter unbekannt/zu alt -> Owner-Reconcile, KEIN Auto-Kauf ([{job,reason}]).
//   redrive : REQUESTED + aktiver KYC-Subscriber + jung -> geld-sicher nachfuehrbar (Job[]).
// maxAgeMs === 0 (Default = Observe-Only) -> jeder reale requested-Job ist "zu alt"
// (ageMs > 0, createdAt liegt in der Vergangenheit) und faellt in hold. Legacy-Job ohne
// createdAt -> Alter unbekannt -> fail-closed hold (nie auto-re-driven).
export function classifyQueuedProvisioningJobs(s, { nowMs, maxAgeMs, kycMinLevel }) {
  const buckets = { close: [], hold: [], redrive: [] };
  for (const job of s.provisioningJobs) {
    if (job.status !== PROVISIONING_JOB_STATUS.QUEUED) continue;
    const number = findNumber(s, job.numberId);
    if (!number || PROVISION_CLOSE_NUMBER_STATUS.has(number.status)) {
      buckets.close.push(job);
      continue;
    }
    if (number.status !== NUMBER_STATUS.REQUESTED) {
      buckets.hold.push({ job, reason: `mid_flight_${number.status}` });
      continue;
    }
    if (!tenantActiveSubscriber(s, job.tenantId, kycMinLevel)) {
      buckets.hold.push({ job, reason: "no_active_subscriber" });
      continue;
    }
    const ageHoldReason = redriveAgeHoldReason(job, nowMs, maxAgeMs);
    if (ageHoldReason) {
      buckets.hold.push({ job, reason: ageHoldReason });
      continue;
    }
    buckets.redrive.push(job);
  }
  return buckets;
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
  return (
    (inputTokens / 1e6) * cfg.priceInPerMTokUsd + (outputTokens / 1e6) * cfg.priceOutPerMTokUsd
  );
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

// Bucht die IST-Voice-Minutenkosten (GANZZAHL Cents) eines beendeten Outbound-Calls in den
// LIVE-usage-Bucket des Tenants (outbound-p1c Reconcile, D1). Cent->EUR ueber CENTS_PER_EUR
// (dieselbe Bruecke wie effectiveCapEur, G5); costEur bleibt JS-Float (Bestand). So sieht
// der Budget-Gate (budgetExceeded) + die Vorab-Reservierung endlich die Carrier-Minuten.
// Nebeneffekt im Namen (N7). Reine Mutation, kein IO (Wrapper saved).
export function addVoiceUsageCostCents(s, tenantId, costCents) {
  const usage = usageFor(s, tenantId);
  usage.costEur += costCents / CENTS_PER_EUR;
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

// Vorab-Reservierung (outbound-p1c, Kosten-Achse, D1): wuerde der Worst-Case-Minutenpreis
// (reserveCents, GANZZAHL Cents) den verbleibenden effektiven Tenant-Cap UEBERSTEIGEN?
// Ist-Verbrauch (costEur) + Reserve > effektiver Cap -> true (402 vor Dial). DIESELBE
// Cap-Aufloesung (effectiveCapEur) + derselbe usage-Bucket wie budgetExceeded (G5);
// globalBudgetExceeded bleibt PARALLEL (Schnittmenge, Regel 1). Reine Query, kein IO.
// Neu (OUT-05): die bereits gebuchte In-Flight-Reserve des Tenants (reservationFor)
// zaehlt kumulativ mit -> N kurz aufeinanderfolgende Calls koennen den Cap nicht mehr
// gemeinsam ueberschreiten. Bei LEERER Reserve byte-identisch zum Bestand.
export function reserveExceedsBudget(s, tenantId, reserveCents, cfg) {
  return (
    usageFor(s, tenantId).costEur + (reservationFor(s, tenantId) + reserveCents) / CENTS_PER_EUR >
    effectiveCapEur(s, tenantId, cfg)
  );
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

// Zaehlt die ERFOLGREICH gesendeten Summary-SMS EINES Tenants seit sinceIso (F2 P8,
// Toll-Fraud-Tages-Cap H1). Quelle ist der append-only Usage-Ledger: jede gesendete
// Summary-SMS hinterlaesst genau ein USAGE_EVENT_KIND.SMS-Event (server.js, NUR nach
// erfolgreichem sendSms) -> der Zaehler erfasst ausschliesslich real gesendete SMS,
// nie uebersprungene/fehlgeschlagene. Pro call.tenantId (nicht global). sinceIso kommt
// vom Aufrufer (rollierendes 24h-Fenster, Muster countOutboundCallsSince) -> state-ops
// bleibt zeit-frei und testbar. Reine Query, kein IO.
export function dailySmsCount(s, tenantId, sinceIso) {
  return s.usageEvents.filter(
    (e) => e.kind === USAGE_EVENT_KIND.SMS && e.tenantId === tenantId && e.occurredAt >= sinceIso,
  ).length;
}

// Verbrauchte Voice-Minuten EINES Tenants seit sinceIso (BK4, Minuten-Kontingent).
// Sibling zu dailySmsCount: dieselbe append-only usage_event-Quelle, dasselbe
// rollierende Fenster (sinceIso vom Aufrufer -> zeit-frei/testbar), aber kind=
// VOICE_MINUTE und SUMME der quantity (Minuten, Ganzzahl via Math.ceil im Recorder)
// statt Anzahl. ZAEHLT BEWUSST AUCH bereits gemeldete Events (stripeMeterSent): der
// Flush-Marker ist ein Abrechnungs-Flag, KEINE Perioden-Grenze - das Kontingent misst
// Verbrauch, nicht Meldung. Pro tenantId (nie global, H3). Reine Query, kein IO.
export function voiceMinutesUsedSince(s, tenantId, sinceIso) {
  return s.usageEvents
    .filter(
      (e) =>
        e.kind === USAGE_EVENT_KIND.VOICE_MINUTE &&
        e.tenantId === tenantId &&
        e.occurredAt >= sinceIso,
    )
    .reduce((sum, e) => sum + e.quantity, 0);
}

// Minuten-Kontingent-Gate-Praedikat (B1b, GAP B): sind die im laufenden Abrechnungs-
// fenster verbrauchten Voice-Minuten >= dem Plan-Kontingent? Geschwister zu
// budgetExceeded (reine, IO-freie Query), aber auf der MINUTEN-Quelle
// (voiceMinutesUsedSince), NICHT auf usageFor/costEur (keine Achsen-Vermischung,
// kein Doppelzaehlen mit der EUR-Achse, B4). State-ops bleibt katalog-/zeit-frei:
// der Aufrufer (B2) reicht das aufgeloeste includedMinutes (aus findPlan) und den
// Periodenanker periodStartIso herein.
//
// FAIL-CLOSED (§5.4, bindend): ohne gueltigen Periodenanker ODER ohne bekanntes
// Kontingent => exceeded=true (blocken). periodStartIso wird NIE als undefined an
// voiceMinutesUsedSince durchgereicht - "e.occurredAt >= undefined" ist immer false
// und taeuschte ein stilles used=0 (= volles Kontingent) vor, genau die fail-OPEN-
// Anzeige-Semantik von quotaView, die ein Geld-Gate NICHT erben darf. includedMinutes=0
// (kein Kontingent) ist KEIN Fehlwert: used>=0 ist immer wahr -> korrekt exceeded.
export function planMinutesExceeded(s, tenantId, { includedMinutes, periodStartIso } = {}) {
  if (!periodStartIso || !Number.isFinite(includedMinutes)) return true;
  return voiceMinutesUsedSince(s, tenantId, periodStartIso) >= includedMinutes;
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

// ---- Reserve-Ledger (OUT-05): atomare In-Flight-Reservierung ----
// s.reservations (tenantId -> GANZZAHL Cents) haelt die noch nicht abgerechneten
// Worst-Case-Kosten laufender Outbound-Calls, damit der Budget-Gate (Tenant UND global,
// Schnittmenge, Regel 1) auch WAEHREND eines Calls den kumulierten Verbrauch sieht. Der
// settled-Bucket (usageFor.costEur, gefuellt erst bei Call-Ende) bleibt UNVERAENDERT und
// PARALLEL. Strukturell ephemer (nie persistiert/hydriert).

// Reserve EINES Tenants (reine Query). Fehlender Eintrag -> 0.
export function reservationFor(s, tenantId) {
  return s.reservations[tenantId] || 0;
}

// Plattform-Summe aller In-Flight-Reserven (globale Achse, reine Query).
export function reservationsTotal(s) {
  return Object.values(s.reservations).reduce((sum, cents) => sum + cents, 0);
}

// Globaler Reserve-Notaus (R2, reserve-bewusst): wuerde reserveCents zusaetzlich zur
// settled Plattform-Summe + ALLEN In-Flight-Reserven den globalen Cap ueberschreiten?
// Schliesst die reserve-blinde Luecke in globalBudgetExceeded (das nur settled prueft).
// Reine Query, kein IO.
export function globalReserveExceedsBudget(s, reserveCents, cfg) {
  return (
    globalUsageTotals(s).costEur + (reservationsTotal(s) + reserveCents) / CENTS_PER_EUR >
    cfg.maxBudgetEur
  );
}

// Atomare Check+Reserve (Schnittmenge Tenant UND global, Regel 1). REIN SYNCHRON, KEIN
// await zwischen Check und Increment -> unter store.withStoreLock (server.js, F2) echt
// atomar (keine TOCTOU). Bucht reserveCents auf s.reservations[tenantId], wenn WEDER die
// pro-Tenant- NOCH die globale reserve-bewusste Decke reisst; eine abgelehnte Reserve
// hinterlaesst KEINEN Schreibeffekt. Nebeneffekt im Namen (N7). Liefert true=reserviert
// (Dial erlaubt) / false=abgelehnt (402 vor Dial).
export function tryReserveOutboundBudget(s, tenantId, reserveCents, cfg) {
  if (
    reserveExceedsBudget(s, tenantId, reserveCents, cfg) ||
    globalReserveExceedsBudget(s, reserveCents, cfg)
  )
    return false;
  s.reservations[tenantId] = reservationFor(s, tenantId) + reserveCents;
  return true;
}

// Gibt die Worst-Case-Reserve eines Calls frei (idempotent). No-op ohne reservierte Cents
// ODER bei bereits freigegebener Reserve (call.reserveReleased). Clamp >= 0 (G26, kein
// negativer Ledger, selbst bei Ueber-Freigabe). Setzt call.reserveReleased = true
// (Idempotenz-Schloss, das jeder Freigabepfad in F2 teilt: catch/finishCall/Backstop-Timer).
// Nebeneffekt im Namen (N7). Liefert true, wenn tatsaechlich freigegeben wurde.
export function releaseOutboundReserve(s, call) {
  if (!call || !call.reserveCents || call.reserveReleased) return false;
  s.reservations[call.tenantId] = Math.max(0, reservationFor(s, call.tenantId) - call.reserveCents);
  call.reserveReleased = true;
  return true;
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

  const before = {
    calls: s.calls.length,
    notifications: s.notifications.length,
    actionItems: s.actionItems.length,
  };
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

// Gemeinsame Form fuer optionale Enum-Overrides (language, agentStyle): null/"" setzt das
// Override zurueck (= nicht gesetzt), sonst MUSS der Wert ein String aus der kuratierten
// Whitelist sein. EINE Quelle (G5) statt zweier paralleler Sonderpruefungen. Der generische
// typeof-Vergleich greift hier nicht, weil der Default null ist (typeof null === "object"
// wuerde jeden gueltigen String-Patch ablehnen). Fail-closed: alles ausserhalb der
// Whitelist wird verworfen (kein Schreiben) -> kein Freitext/PII/Impersonation im Feld.
function isOptionalEnumOverride(value, allowedValues) {
  if (value === null || value === "") return true;
  return typeof value === "string" && allowedValues.includes(value);
}

// Optionale Enum-Override-Felder (Default null): eigene fail-closed Katalog-Validierung
// statt typeof. language gegen SUPPORTED_LANGUAGES, agentStyle (P2) gegen PERSONA_STYLE_IDS
// (kuratierte Stil-IDs, NON-PII). "" und null = zuruecksetzen auf "nicht gesetzt".
const OPTIONAL_ENUM_FIELDS = Object.freeze({
  language: SUPPORTED_LANGUAGES,
  agentStyle: PERSONA_STYLE_IDS,
});

// Whitelist gegen die Default-Settings: nur bekannte Keys mit passendem Typ.
// Unbekannte Keys / falsche Typen werden ignoriert - POST /api/settings kann
// so keine fremden Felder in den Store schreiben oder Typen kippen. Optionale Enum-
// Overrides (language, agentStyle) haben eine eigene fail-closed Katalog-Validierung
// (siehe OPTIONAL_ENUM_FIELDS / isOptionalEnumOverride) statt des typeof-Checks.
// Liefert auch die uebernommenen Keys (fuers Audit-Log in server.js).
export function updateSettings(s, tenantId, patch) {
  const allowed = defaultSettings();
  const changed = [];
  const target = settingsFor(s, tenantId);
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in allowed)) continue;
    const enumValues = OPTIONAL_ENUM_FIELDS[key];
    if (enumValues) {
      if (!isOptionalEnumOverride(value, enumValues)) continue;
      // "" (= "nicht gesetzt") wird als null gespeichert (eine Form fuer "nicht gesetzt").
      target[key] = value === "" ? null : value;
      changed.push(key);
    } else if (typeof value === typeof allowed[key]) {
      target[key] = value;
      changed.push(key);
    }
  }
  return { settings: target, changed };
}

// ---- Rechteprofile pro Tenant (Phase 2, Phase S re-keyed) ----
// Effektives Profil fuer eine tenantId. tenantId === BOOTSTRAP_TENANT_ID -> Owner
// (resolveProfileFrom pinnt). Andere tenantId mit gespeichertem Profil -> ueber DEFAULT
// gemerged (fehlende Felder fallen restriktiv zurueck). tenantId ohne Profil / leer ->
// DEFAULT. profiles ist key-agnostisch (eine Map key -> Profil); der Schluessel ist seit
// Phase S die tenantId (vormals email), s. resolveProfileFrom (defaults.js).
export function resolveProfile(s, tenantId) {
  return resolveProfileFrom(tenantId, tenantId ? s.profiles[tenantId] : undefined);
}

// ---- Tenant-Aufloesung (Auth-Achse, I4) ----
// Geschwister zu resolveProfile: BEIDE keyen jetzt auf die Auth-/Tenant-Achse (Phase S).
// resolveProfile mappt nur BOOTSTRAP_TENANT_ID -> OWNER_PROFILE (Owner hart gepinnt), sonst
// stored-or-DEFAULT (fail-closed/restriktiv). resolveTenant liefert die tenantId einer
// Identitaet ODER null: leere/null/unbekannte Identitaet -> null (Reject), NIE
// BOOTSTRAP_TENANT_ID. Ein Default-Tenant hier wuerde den ganzen Tenant-Scope (I5/I6/I7)
// umgehbar machen. 1:1 (#2): genau eine tenantId ODER null, keine Liste. Keyt auf idpSubject (#1).
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
// Schluessel ist die tenantId (Phase S; key-agnostische Map).
export function setProfile(s, tenantId, patch) {
  const clean = sanitizeProfile(patch);
  s.profiles[tenantId] = { ...(s.profiles[tenantId] || {}), ...clean };
  return { profile: s.profiles[tenantId], changed: Object.keys(clean) };
}

export function deleteProfile(s, tenantId) {
  if (!(tenantId in s.profiles)) return false;
  delete s.profiles[tenantId];
  return true;
}
