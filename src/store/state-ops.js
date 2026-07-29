// Reine In-Memory-Operationen auf dem verschachtelten Store-Zustand
// {settings, calls, actionItems, calendar, usage, notifications, profiles, numbers}.
// usage ist eine Map tenantId -> Bucket (P4, Daten-Schicht pro-Tenant).
// KEIN IO: weder Datei noch DB. Beide Backends (json.js, pg.js) halten denselben
// Zustands-Shape und delegieren die Mutationen hierher - so lebt die Fachlogik
// (Call-Record-Aufbau, Retention-Praedikate, Kostenformel, ...) genau EINMAL
// (Duplizierung vermieden). Die Backends kuemmern sich nur um Persistenz.
//
// Die Spend-Monat-Achse (spendMonthKey/spendMonthCostCents, P4) ist der UTC-KALENDERMONAT
// und ausdruecklich NICHT die Stripe-ABRECHNUNGSPERIODE aus src/billing/period.js
// (periodStartFromEnd/resolvePeriodStartIso, Spalte stripe_current_period_start). Der
// Begriff "Periode" ist im Repo an Stripe vergeben und wird fuer diese Achse NICHT benutzt.
// Bewusst nicht der Stripe-Anker: der ist ohne Abo fail-closed und wuerde jeden
// pre-Payment-Tenant dauerhaft sperren - das Gegenteil des Ziels.
import crypto from "crypto";
import {
  defaultSettings,
  defaultSettingsMap,
  calendarMap,
  emptyUsage,
  emptyUsageMap,
  emptyPlatformTtsUsage,
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
  allowedPrivateNumberCodes,
  NUMBER_STATUS,
  NUMBER_TRANSITIONS,
  GLOBAL_CAP_REASON,
  REQUEST_NUMBER_REASON,
  TENANT_STATUS,
  PROVISIONING_JOB_STATUS,
  PROVISION_NUMBER_JOB,
  USAGE_EVENT_KIND,
  CENTS_PER_EUR,
  MICRO_CENTS_PER_CENT,
  TOKENS_PER_M_TOK,
  isBookableCents,
  isCorrectionCents,
  PROVIDER_RATE_SCALE,
  USAGE_CORRUPT_REASON,
  globalCapCents,
  KYC_LEVEL,
  KYC_ORDER,
  COST_TRUING_SOURCE,
} from "./defaults.js";
import { SUPPORTED_LANGUAGES, PERSONA_STYLE_IDS, languageForCountry } from "../i18n/locales.js";
import { planCapCents } from "../billing/plan-caps.js";
import { isKnownPlanSlug } from "../plans.js";
// GAP-14: Wert-Guard fuer updateSettings (greeting muss den Inbound-Pflichtsatz tragen).
// inbound-notice.js ist ein Blatt-Modul (kein Rueckimport, kein Zyklus).
import { hasInboundNotice } from "../i18n/inbound-notice.js";
// P8/FMT-11: Denylist des Ziel-Gates der privaten Summary-Nummer, geteilt mit der
// Outbound-Gate-Kette (D3, G5) - siehe number-denylist.js fuer die Begruendung.
import { isDenied } from "../telephony/number-denylist.js";

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
    // KEINE Owner-Vorbelegung -> Owner ohne Zeile faellt auf cfg.platformSpendCapCents
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
    // Fruehwarn-Marker (Budget-Achsen P6): der Spend-Monat, fuer den die Plattform-
    // Warnschwelle bereits gemeldet wurde. PROZESS-LOKAL und STRUKTURELL EPHEMER (json.save
    // schliesst den Key aus, pg hat keine Spalte). Bewusst KEIN Anhaengen an spendMonthKey:
    // der lebt PRO TENANT-BUCKET, die Schwelle ist eine PLATTFORM-Groesse - es gibt keinen
    // Plattform-Bucket, der einen Schluessel truege.
    platformSpendWarnedMonth: null,
    // LCT P7: globaler ElevenLabs-Zeichenzaehler (Muster profile - keine Tenant-Dimension).
    // ANDERS als platformSpendWarnedMonth direkt darueber: DIESES Feld PERSISTIERT (json
    // nimmt es NICHT in die Ephemer-Strip-Liste auf, pg haelt eine eigene Tabelle) - ein
    // rein prozess-lokaler Zaehler wuerde bei jedem Free-Tier-Restart auf 0 fallen und die
    // Kontingent-Wand nie erreichen (dieselbe P4-Asymmetrie-Begruendung wie spendMonthKey).
    platformTtsUsage: emptyPlatformTtsUsage(),
    // sub -> tenantId Resolver-Index (tenant-prolif-b). MERGE-OVERLAY fuer resolveTenant:
    // traegt die per Email-Merge (Phase A) an einen FREMDEN Tenant gebundenen Zweit-subs,
    // die NICHT als tenant.idpSubject gespiegelt sind. pg fuellt ihn bei init() aus account
    // + beim Nach-Boot-Login; strukturell EPHEMER (nie auf Platte, jeden Boot neu -> kein Drift).
    subIndex: {},
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
    mandate,
    language,
    maxDurationS,
    requestedBy,
    tenantId,
    provider,
    reserveCents,
    diagnostic,
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
    // P6 (PLAN-CONVERSATION-QUALITY-V2): Vorab-Mandat (additiv NULLABLE). Fehlt es ->
    // null -> Prompt-Sektion "" -> Prompt + Persist byte-identisch zum Bestand. Erlaubt
    // dem Agenten nur muendliche Zusagen im Owner-Rahmen, KEINE Buchung (E1).
    mandate: mandate || null,
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
    // LCT P2: Kosten-Achse dieses Calls. ALLE fuenf sind additiv und INERT - kein Gate,
    // kein Meter und keine Projektion liest sie in dieser Phase.
    //
    // estimatedCostCents: der TATSAECHLICH gebuchte Schaetzbetrag (GANZZAHL Cents),
    // geschrieben von reconcileOutboundVoiceBudget im SELBEN Schritt, in dem gebucht wird.
    // NIE spaeter aus tariffCentsPerMin rekonstruiert: der Tarif aendert sich (P4b), die
    // Buchung nicht - eine rekonstruierte Differenz erstattete Geld zurueck, das real
    // ausgegeben wurde, und oeffnete den geteilten Lebenszeit-Topf wieder.
    estimatedCostCents: null,
    // actualCostMicroCents: Summe der Provider-Ist-Kosten dieses Calls in GANZZAHL
    // Mikro-Cents, in der PROVIDER-WAEHRUNG UNVERAENDERT (heute USD). KEINE Umrechnung an
    // dieser Kante - die lebt an genau einer Stelle in P4. Eine umgerechnete Zahl ist
    // unrekonstruierbar, sobald der Kurs sich aendert, und genau sie ist der Forensik-Wert.
    actualCostMicroCents: null,
    // costTruedAt/costTruedSource: Gegenstueck zum binaeren billedAt (D9) - "Ist-Wert steht
    // aus" hat damit endlich einen Zustand. Beschrieben ab P3.
    costTruedAt: null,
    costTruedSource: null,
    // costTruingAttempts: PERSISTIERT, nicht in-memory. Ein Prozess-lokaler Zaehler wird auf
    // dem Render-Free-Tier bei jedem Restart genullt, erreicht COST_TRUING_MAX_ATTEMPTS (P3)
    // nie und liesse den Job unbegrenzt gegen tote Calls laufen.
    costTruingAttempts: 0,
    // P5 (C-Telnyx, PLAN-TELNYX-AI-ASSISTANT.md): Call-Control-Handles. Initial null, erst
    // bei erfolgreicher Call-Control-Origination gesetzt (telnyx-origination.js) - byte-
    // identisch zur pg-Hydrierung (rowToCall), kein json<->pg-Shape-Drift.
    callControlId: null,
    assistantId: null,
    // P2b (Diagnose-Retention): markiert einen Call, dessen Roh-Transkript die Summary
    // ueberleben darf. Wird AUSSCHLIESSLICH serverseitig gesetzt (Ziel == eigene
    // verifizierte Nummer des Tenants, src/diagnostic-retention.js) - nie roh aus dem
    // Request-Body. Default false = Bestandsverhalten (Purge nach Summary); undefined/
    // fehlend -> false, byte-identisch zur pg-Hydrierung (rowToCall).
    diagnostic: diagnostic === true,
    // OUT-05 (F2): Worst-Case-Reserve dieses Calls (GANZZAHL Cents) + Idempotenz-Schloss der
    // Freigabe. reserveCents/reserveReleased sind reine Referenz-/Idempotenz-Daten fuer
    // releaseOutboundReserve + den Backstop-Timer; der Reserve-LEDGER (s.reservations) ist
    // strukturell ephemer. Inbound/Legacy ohne Reserve -> 0/false (No-op-Freigabe). KEINE
    // pg-Spalte (bewusst nicht persistiert): nach Boot ist die Reserve ohnehin 0 (ephemer).
    reserveCents: reserveCents || 0,
    reserveReleased: false,
    // P3.2: Zaehler konsekutiver Turns mit leerem Gather (No-Speech-Staffel in
    // /voice/turn). EPHEMER wie reserveCents: KEINE pg-Spalte, keine Hydrierung in
    // rowToCall -> nach einem Deploy-Instanzwechsel beginnt die Staffel fail-safe von
    // vorn (mehr Hoeflichkeit, nie ein frueherer Hangup).
    noSpeechStreak: 0,
    // AL-P1: Telnyx-Conversation-UUID (Latenz-Achse) + purge-fester Anrufer-Turn-Zaehler
    // (Abbruch-Achse). Initial null/0 - byte-identisch zur pg-Hydrierung (rowToCall),
    // kein json<->pg-Shape-Drift.
    telnyxConversationId: null,
    callerTurns: 0,
    actionItemIds: [],
  };
  s.calls.unshift(call);
  usageFor(s, call.tenantId).calls++;
  return call;
}

export function getCall(s, id) {
  return s.calls.find((c) => c.id === id || c.twilioSid === id) || null;
}

// Korrelation ueber die Telnyx-eigene call_control_id (Brain-Shim, E1). Fail-closed:
// leere/unbekannte ID -> null (ein Call ohne callControlId ist per Definition kein Treffer).
export function getCallByControlId(s, callControlId) {
  if (!callControlId) return null;
  return s.calls.find((c) => c.callControlId === callControlId) || null;
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

// G5 (PA-5): gemeinsame Set-once-ISO-Marker-Logik der drei strukturell identischen
// Marker-Setter (markAnswered/markSummarySmsSent/markBilled). Setzt fieldName EINMALIG auf
// die aktuelle ISO-Zeit, wenn call existiert und das Feld noch leer ist; jeder Folgeaufruf
// ist ein No-op (der zuerst gesetzte Marker gewinnt -> stabiler Zeitstempel, kein Doppel-
// Schreiben). Fehlender call (null) -> changed=false, KEIN Throw (ein verspaeteter Retry
// fuer einen unbekannten Call darf den Setter nicht crashen). Liefert { call, changed }
// (Wrapper-Kontrakt: save NUR bei changed). BEWUSST nur fuer die drei Set-once-ISO-Marker:
// recordFailureReason (value-gated + 3. Arg) und setCallEndedAt (status-gated, expliziter
// Anker) haben andere Semantik und bleiben getrennt.
function setOnceTimestamp(call, fieldName) {
  let changed = false;
  if (call && !call[fieldName]) {
    call[fieldName] = new Date().toISOString();
    changed = true;
  }
  return { call, changed };
}

export function markAnswered(s, callId) {
  return setOnceTimestamp(getCall(s, callId), "answeredAt");
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
// /voice/status-Retry und macht den Versand so idempotent (genau eine SMS). Set-once
// via setOnceTimestamp (gesetzter Marker gewinnt); Wrapper saved bei changed.
export function markSummarySmsSent(s, callId) {
  return setOnceTimestamp(getCall(s, callId), "summarySmsSentAt");
}

// F9 (A6): persistierter Bucht-Marker. Set-once via setOnceTimestamp (gesetzter gewinnt):
// ein verspaeteter /voice/status-Retry NACH einem Restart findet den Marker und bucht die
// Voice-Minuten NICHT erneut. Wrapper saved bei changed.
export function markBilled(s, callId) {
  return setOnceTimestamp(getCall(s, callId), "billedAt");
}

// LCT P2: persistiert den GEBUCHTEN Schaetzbetrag am Call. Set-once (Muster markBilled):
// der zuerst gebuchte Wert gewinnt, ein spaeter Retry ueberschreibt ihn nie - er ist der
// Bezugspunkt, gegen den P4 die Korrektur bildet.
//
// isBookableCents ist hier PFLICHT und dieselbe EINE Gueltigkeitsquelle (defaults.js), die
// addVoiceUsageCostCents benutzt: wird die Buchung dort als korrupt verworfen, darf hier
// KEIN Estimate stehenbleiben - sonst rechnete P4 eine Rueckerstattung gegen einen Betrag,
// der nie in den Bucket gelaufen ist. Liefert { call, changed } (Wrapper saved bei changed).
export function recordCallEstimatedCostCents(s, callId, costCents) {
  const call = getCall(s, callId);
  if (!call || call.estimatedCostCents !== null || !isBookableCents(costCents))
    return { call: call || null, changed: false };
  call.estimatedCostCents = costCents;
  return { call, changed: true };
}

// LCT P3: naechste Versuchsnummer eines Calls. EINE Quelle (G5) fuer den Kandidaten-
// Riegel in cost-truing.js UND das Hochzaehlen unten - sonst driften Abbruch-Bedingung
// und Zaehler auseinander. Fehlender/korrupter Zaehler -> Start bei 0, nie NaN
// (NaN + 1 bliebe NaN und der Call liefe unbegrenzt weiter).
export function nextCostTruingAttempt(call) {
  const attempts = call?.costTruingAttempts;
  return (Number.isSafeInteger(attempts) && attempts >= 0 ? attempts : 0) + 1;
}

// LCT P3: Ergebnis EINES Kosten-Abgleichs am Call. Schreibt NUR P2-Felder - keine
// Budget-/Usage-/Meter-Achse wird beruehrt (das ist die Kernaussage der Phase).
// costTruedAt !== null ist der PERSISTIERTE Idempotenz-Riegel: ein abgeschlossener Call
// wird nie erneut angefasst (gegen sequenzielle Wiederholung; gegen VERSCHRAENKUNG
// schuetzt der Laufriegel in cost-truing.js). closedAt=null laesst den Call bewusst offen
// ({ok:false} -> spaeterer Lauf), der Versuchszaehler steigt trotzdem und terminiert den
// Job nach COST_TRUING_MAX_ATTEMPTS (Entscheidung beim Aufrufer, state-ops bleibt
// config- und zeitfrei). actualCostMicroCents wird nur uebernommen, wenn es eine
// Ganzzahl >= 0 ist - USD-Mikro-Cent, UNVERAENDERT (keine Umrechnung, D5).
// Liefert { call, changed } (Wrapper saved bei changed).
export function recordCallCostTruingResult(s, callId, { source, actualCostMicroCents, closedAt }) {
  const call = getCall(s, callId);
  if (!call || call.costTruedAt !== null || !Object.values(COST_TRUING_SOURCE).includes(source))
    return { call: call || null, changed: false };
  call.costTruingAttempts = nextCostTruingAttempt(call);
  if (Number.isSafeInteger(actualCostMicroCents) && actualCostMicroCents >= 0)
    call.actualCostMicroCents = actualCostMicroCents;
  call.costTruedSource = source;
  if (closedAt) call.costTruedAt = closedAt;
  return { call, changed: true };
}

// Anker der Max-Dauer-Rechnung: der ECHTE Call-Start (answeredAt bevorzugt, sonst startedAt),
// NIE der Boot-Zeitpunkt. Fehlt beides -> NaN (Aufrufer clampen auf 0).
function callStartAnchorMs(call) {
  return Date.parse(call.answeredAt ?? call.startedAt ?? "");
}

// Hartes Max-Dauer-Limit dieses Calls in ms (call-eigenes maxDurationS vor injiziertem Default).
// config-frei: defaultMaxDurationS reicht der Aufrufer (server.js: config.safety.maxCallDurationS) herein.
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

// AL-P1: Telnyx-Conversation-UUID am Call. Set-once + nur bei truthy Wert (Muster
// recordFailureReason): ein Webhook-Retry ueberschreibt die erste UUID nicht, ein
// fehlendes Feld ist ein No-op (changed=false -> kein Save). Wrapper saved bei changed.
export function recordTelnyxConversationId(s, callId, conversationId) {
  const call = getCall(s, callId);
  let changed = false;
  if (call && conversationId && !call.telnyxConversationId) {
    call.telnyxConversationId = conversationId;
    changed = true;
  }
  return { call, changed };
}

// AL-P1: eine substanzlose Nullzeile gibt es hier nicht - der Aufrufer (agentTurn) ruft
// NUR bei nicht-leerem callerText. Zaehlt den Anrufer-Turn mit und liefert den NEUEN
// Stand (Nebeneffekt im Namen, N7 - Muster countNoSpeechTurn). Fehlendes Feld
// (pg-hydrierter Altbestand) -> 0 als Basis, nie NaN. Liefert { call, changed } wie die
// uebrigen PERSISTENTEN Mutatoren, weil der Wrapper hier - anders als countNoSpeechTurn -
// speichern muss (es gibt eine Spalte).
export function countCallerTurn(s, callId) {
  const call = getCall(s, callId);
  if (!call) return { call: null, changed: false };
  call.callerTurns = (Number.isSafeInteger(call.callerTurns) ? call.callerTurns : 0) + 1;
  return { call, changed: true };
}

// P3.2: konsekutiven Leer-Gather-Turn mitzaehlen und den NEUEN Streak liefern (Nebeneffekt
// im Namen, N7). Unbekannter Call -> 0 (der Aufrufer rendert dann die erste Stufe; ein
// fehlender Call kann diesen Pfad ohnehin nicht erreichen). Fehlendes Feld (pg-hydrierter
// Call) -> 0 als Basis, kein NaN.
export function countNoSpeechTurn(s, callId) {
  const call = getCall(s, callId);
  if (!call) return 0;
  call.noSpeechStreak = (call.noSpeechStreak || 0) + 1;
  return call.noSpeechStreak;
}

// P3.2: Gegenstueck - eine verstandene Aeusserung bricht die Staffel ab ("drei
// AUFEINANDERFOLGENDE leere Turns", nicht drei ueber den ganzen Call verteilte).
export function clearNoSpeechStreak(s, callId) {
  const call = getCall(s, callId);
  if (call) call.noSpeechStreak = 0;
}

// Zaehlt Outbound-Calls mit startedAt >= sinceIso (gleitendes Fenster fuers Pro-Stunde-Gate
// + den per-(Tenant,Ziel)-Cap in server.js). filters (alle optional, kombinierbar als UND):
//   requestedBy : nur Calls dieses Nutzers - forensischer Filter, kein Gate liest ihn mehr
//   tenantId    : nur Calls dieses Tenants (pro-Tenant-Achse, P4; seit O5 die EINZIGE
//                 Stunden-Achse, telephony/outbound-gates tenantHourReached)
//   to          : nur Calls an dieses Ziel (per-(Tenant,Ziel)-Cap, outbound-p1d)
// Ohne Filter: ALLE Outbound-Records. Seit O5 liest KEIN Gate mehr diese ungefilterte
// Achse - sie bleibt als Diagnose-/Query-Faehigkeit (test/store-pg-tenant-budget.test.js);
// die einzige Stunden-Achse ist tenant-gefiltert. Zaehlt bewusst auch fehlgeschlagene -
// konservative Toll-Fraud-Bremse.
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
// tenant.defaultLanguage -> DEFAULT_LANGUAGE (Weltdefault, P10). Jede Stufe greift nur,
// wenn truthy (additiv NULLABLE, Backfill-frei: fehlend/leer = nicht gesetzt = naechste
// Stufe). Eine unbekannte/getippte Sprache wirft hier NICHT - der nachgelagerte
// localeFor()-Resolver faellt fail-safe auf den Weltdefault zurueck (R7). numberRecord
// ist der bereits aufgeloeste Record (oder
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
// country/language (F1, Phase 1) als optionale Params: die geseedete Owner-/
// Bestandsnummer traegt damit ihren Geo-Anker (Inbound-Sprache, Outbound-
// Absenderwahl). Additiv NULLABLE in der DB; ein Bestands-Record ohne Werte faellt
// ueber den Code-Fallback zurueck.
// A1 (PLAN-I18N-FIX): die Sprache wird aus dem LAND abgeleitet, nie aus dem Weltdefault.
// Sonst materialisiert dieser Schreibpfad ab dem Flip "en" IN den Datensatz - auch fuer
// country=DE - und zwar non-NULL, also unsichtbar fuer jede NULL-Zaehlung. Bestehende
// 3-/4-Arg-Aufrufe bleiben verhaltens-erhaltend (DEFAULT_COUNTRY -> languageForCountry
// (DEFAULT_COUNTRY) = heutiger De-facto-Zustand "de").
export function seedBootstrapNumber(
  s,
  e164,
  tenantId,
  provider = DEFAULT_PROVIDER,
  country = DEFAULT_COUNTRY,
  language = languageForCountry(country),
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

// Config-derive Owner-Nummer-Seed beim Boot (analog seedBootstrapKyc): traegt die
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

// Bindet die Owner-OAuth-Identitaet (WorkOS sub) idempotent an den Bootstrap-Tenant
// (AM6 G4) ueber das I8-additive idpSubject-Feld. Geschwister zu seedBootstrapKyc:
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

// s.tenants kann fehlen (seedState seedet keine Tenants, und json.js normalisiert die
// Liste beim Laden NICHT) -> defensiver Default. Eine Quelle fuer alle Tenant-Finder
// (findTenant via id, resolveTenant via idpSubject); der Guard lebt damit an EINER
// Stelle. Exportiert seit GAP-38: die Boot-Heilung zaehlt fremde Tenants und darf dafuer
// kein zweites Gueltigkeitsidiom aufmachen (ein Wurf dort waere ein Boot-Killer).
export const tenantsOf = (s) => s.tenants || [];

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
// registerTenant UND setTenantIdentityIfAbsent (G5: eine Kompositionsstelle). Trimmt; leere
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
// wenn jetzt ein ownerName steht (echte Mutation) -> der Wrapper flusht nur dann. Genutzt
// vom Web-Login-Pfad (P2b, server.js applyTenantIdentity).
export function setTenantIdentityIfAbsent(s, tenantId, { firstName, lastName } = {}) {
  const tenant = findTenant(s, tenantId);
  if (!tenant || tenant.ownerName) return false;
  applyOwnerIdentity(tenant, firstName, lastName);
  return Boolean(tenant.ownerName);
}

// Findet die tenant_budget-Zeile eines Tenants (oder null). EINE Lookup-Stelle fuer
// seedTenantDefaultBudget, effectiveCapCents UND setTenantBudget (G5-Review-Fix): vorher
// stand derselbe s.tenantBudgets.find(...)-Aufruf wortgleich an allen drei Stellen.
function tenantBudgetRow(s, tenantId) {
  return s.tenantBudgets.find((b) => b.tenantId === tenantId) || null;
}

// Seedt die per-Tenant-Kostendecke EINMALIG beim Registrieren (outbound-p1c, D5): schreibt
// die Decke als explizite tenant_budget-Zeile fest, damit sie auch dann bindet, wenn der
// Config-Default spaeter gesenkt oder auf 0 gestellt wird (seit P2a ist der Config-Default
// zusaetzlich der Gate-Fallback in effectiveCapCents - die Zeile bleibt die staerkere,
// vom Operator pro Tenant setzbare Quelle). Set-if-absent wie idpSubject: nur wenn ein Default > 0
// uebergeben wird UND noch keine tenant_budget-Zeile existiert -> setTenantBudget
// (budget == hard cap == Default). 0/fehlend bzw. schon eine Zeile -> No-Op (Owner/Bestand
// unveraendert). Config-frei (Default kommt als Arg). Kein Throw, kein IO.
function seedTenantDefaultBudget(s, tenantId, defaultBudgetCents) {
  if (!defaultBudgetCents) return; // 0/undefined -> kein Seed (kein 0-Cap-Tenant)
  if (tenantBudgetRow(s, tenantId)) return;
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
  { firstName, lastName, privateNumber, idpSubject, defaultBudgetCents, country } = {},
) {
  // country ist das bereits aufgeloeste Herkunftsland des Registrierungs-Requests
  // (P8/FMT-11): setTenantGeo laeuft erst NACH registerTenant, das Land-Gate der privaten
  // Nummer braucht es aber schon hier. Fehlt es -> strenger Bestands-Default.
  const e164 = normalizePrivateNumber(privateNumber, country); // validiert VOR jeder Mutation
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

// ---- suspended_at Grace-Anker (tenant-prolif-c) ----
// Stempelt den Zeitpunkt der ERSTEN Suspendierung als Grace-Anker fuer den spaeteren DID-Release
// (Phase D). SET-IF-ABSENT (Invariante 1): ein Dunning-Retry (weiteres invoice.payment_failed)
// findet den Stempel bereits gesetzt und laesst ihn unveraendert - sonst schoebe jeder Retry die
// Grace nach hinten und verlaengerte sie endlos. nowIso wird injiziert (P12/R: der Test beweist
// set-if-absent mit ZWEI verschiedenen Werten ohne new Date; der Facade-Wrapper reicht
// new Date().toISOString() herein). Fehlender Tenant -> No-Op, KEIN throw (best-effort Anker: der
// Suspend-Pfad darf am fehlenden Spiegel-Tenant nicht scheitern - der DB-Status via
// accounts.setStatus ist davon unabhaengig gesetzt). Reine Mutation, kein IO (Wrapper saved bei
// changed). Nebeneffekt im Namen (N7).
export function setSuspendedAtIfAbsent(s, tenantId, nowIso) {
  const tenant = findTenant(s, tenantId);
  if (!tenant || tenant.suspendedAt) return { tenant, changed: false };
  tenant.suspendedAt = nowIso;
  return { tenant, changed: true };
}

// Loescht den Grace-Anker bei Reaktivierung (Invariante 2): activatePaidTenant ruft es, sobald der
// Tenant wieder active ist -> die Uhr ist zurueckgesetzt, der Tenant ist kein Release-Kandidat mehr.
// Idempotent: kein Anker gesetzt/fehlender Tenant -> No-Op (changed:false, kein needless save).
// Reine Mutation, kein IO (Wrapper saved bei changed).
export function clearSuspendedAt(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  if (!tenant || !tenant.suspendedAt) return { tenant, changed: false };
  tenant.suspendedAt = null;
  return { tenant, changed: true };
}

// Lese-Query des Grace-Ankers (ISO oder null). Reine Query, kein IO. Fehlender Tenant/kein Anker
// -> null (nie undefined), Muster tenantPrivateNumber. Speist die Reaktivierungs-/Roundtrip-Tests
// (und den Phase-D-Klassifizierer) - EINE Quelle der Feld-Kenntnis (G5).
export function tenantSuspendedAt(s, tenantId) {
  return findTenant(s, tenantId)?.suspendedAt ?? null;
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
  {
    subscriptionId,
    planSlug,
    currentPeriodEnd,
    currentPeriodStart,
    numberSetupFeeExempt,
    activationPending,
    periodCreditRevoked,
  } = {},
) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`setTenantSubscription: Tenant ${tenantId} nicht gefunden`);
  // S1-1 (torn write): einen GESETZTEN, aber unbekannten Slug ablehnen, BEVOR irgendein Feld
  // mutiert wird - sonst ueberlebt der ungueltige Slug im In-Memory-Singleton (save() wird in
  // DIESEM Aufruf zwar uebersprungen, weil deriveTenantBudgetFromPlan darunter wirft, aber ein
  // spaeterer, unabhaengiger save() flusht die Mutation still auf Platte/DB). Validierung VOR
  // Mutation macht die Schreibkante atomar. null/leer = erlaubter selektiver Patch (No-op in der
  // Ableitung), wirft NIE - der EINZIGE Wurf ist "Slug gesetzt, aber unbekannt" (Message-Parity
  // zu planCapCents). isKnownPlanSlug ist die SSoT-Mitgliedschaftspruefung (plans.js), cfg-frei.
  if (planSlug != null && planSlug !== "" && !isKnownPlanSlug(planSlug)) {
    throw new Error(`setTenantSubscription: unbekannter Plan-Slug '${planSlug}' (kein Katalog-Eintrag)`);
  }
  if (subscriptionId !== undefined) tenant.stripeSubscriptionId = subscriptionId;
  if (planSlug !== undefined) tenant.stripePlanSlug = planSlug;
  if (currentPeriodEnd !== undefined) tenant.stripeCurrentPeriodEnd = currentPeriodEnd;
  if (currentPeriodStart !== undefined) tenant.stripeCurrentPeriodStart = currentPeriodStart;
  // Fix B (0-EUR-Checkout generisch): true NUR wenn activation.js ueber
  // billing.retrieveSubscription nachgewiesen hat, dass die Subscription mit 0 EUR
  // abgerechnet wurde - befreit provisionNumber vom placeHold. Selektiver Patch wie
  // die uebrigen Felder oben.
  if (numberSetupFeeExempt !== undefined) tenant.stripeNumberSetupFeeExempt = numberSetupFeeExempt;
  // GAP-04-Wartezustand (Marker der Aktivierungs-Erlaubnis, s. tenantMayRequestNumber) und
  // GAP-03-Periodenguthaben-Widerruf (Rueckerstattung): selektive Patch-Keys, Muster wie
  // numberSetupFeeExempt.
  if (activationPending !== undefined) tenant.stripeActivationPending = activationPending;
  if (periodCreditRevoked !== undefined) tenant.stripePeriodCreditRevoked = periodCreditRevoked;
  return tenant;
}

// LCT P6: leitet die Tenant-Kostendecke aus dem EFFEKTIVEN Plan-Slug ab und schreibt sie
// als tenant_budget-Zeile. Laeuft NACH setTenantSubscription (der Patch ist dann schon
// angewendet), also ist tenant.stripePlanSlug bereits der EFFEKTIVE Slug -
// patch.planSlug ?? bestehender Slug ergibt sich hier gratis, ohne das Patch-Feld zu lesen
// (G31: Struktur statt Konvention).
//
// VIER Slug-Faelle, strikt getrennt (die Verwechslung baut den Abo-ohne-Nummer-Vorfall neu):
//   (1) Slug fehlt/leer        -> NO-OP (Budget-Zeile unberuehrt), KEIN Wurf.
//   (1b) Slug gesetzt, aber (nicht mehr) im Katalog (entfernt/umbenannt/Alt-/Testdaten) ->
//       NO-OP + LAUTE WARN, KEIN Wurf. Ein slug-loser Folge-Patch (planSlug===undefined:
//       Perioden-Verlaengerung / numberSetupFeeExempt) erreicht diese Ableitung auf dem
//       bereits PERSISTIERTEN Slug; die Schreibkante (setTenantSubscription) prueft NUR
//       patch.planSlug und laesst den unveraenderten Alt-Slug ungeprueft passieren. Wie die
//       Schwester-Konvention resolveTierForTenant/PROFILE_SKIP.NO_PLAN behandeln wir
//       "fehlend ODER unbekannt" GLEICH (fail-closed, NIE Wurf) - sonst risse planCapCents
//       den nicht gefangenen Stripe-Webhook ab (haengende Antwort). Die bestehende Decke
//       bleibt (fail-closed: die zuletzt abgeleitete Grenze bindet weiter).
//   (2) Slug gesetzt+bekannt   -> Decke ableiten, ggf. auf platformCap klemmen (WARN), setzen.
//   (3) KATALOG-Slug OHNE Kopffreiheit-Eintrag (CATALOG_SLUGS/PLAN_CAP_HEADROOM auseinander-
//       gelaufen, Konfig-Inkohaerenz, am Boot fatal via planCapInertFindings) -> planCapCents
//       WIRFT, bevor setTenantBudget schreibt (kein Torn Write). Der isKnownPlanSlug-Riegel
//       aus (1b) faengt DIESEN Fall NICHT ab (der Slug IST im Katalog) - er bleibt der
//       Riegel gegen Konfig-Drift, ist aber bei kohaerenter Konfiguration zur Laufzeit
//       unerreichbar (erste Linie am Boot ist fatal).
//
// BEIDE Pflichtfelder (budget_cents UND hard_cap_cents) auf denselben Wert - budget_cents
// ist BIGINT NOT NULL; ein Aufruf nur mit hardCapCents setzte budgetCents=undefined, der
// Flush verletzte NOT NULL und flush() rollte die GESAMTE Transaktion zurueck (alle
// Tenants/Calls/Buckets). setTenantBudget selbst wird NICHT umgebaut (eigener Schritt).
//
// AUSDRUECKLICH auch von backfillPlanProfiles gewuenscht: heilt slug-lose Bestands-Abos;
// dass es die Decke MIT schreibt, ist Absicht (Entscheidung 2), kein Versehen.
export function deriveTenantBudgetFromPlan(s, tenantId, cfg) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) return; // setTenantSubscription hat vorher schon fail-closed geworfen, falls fehlend
  const slug = tenant.stripePlanSlug;
  if (!slug) return; // Fall (1): No-op, kein Wurf
  // Fall (1b): ein persistierter Slug, den der Katalog nicht (mehr) kennt (Umbenennung/
  // Entfernung ODER Alt-/Testdaten), erreicht diese Ableitung ueber einen slug-losen
  // Folge-Patch, den die Schreibkante nicht erneut prueft. Fail-closed wie die Schwester-
  // Konvention (resolveTierForTenant): No-op + LAUTE WARN statt Wurf - ein geworfener
  // planCapCents-Fehler risse hier den nicht gefangenen Stripe-Webhook ab. Die bestehende
  // Decke bleibt unberuehrt (die zuletzt abgeleitete Grenze bindet weiter). Der Slug ist ein
  // Plan-Bezeichner, keine PII/kein Secret (wie die clamp-WARN unten).
  if (!isKnownPlanSlug(slug)) {
    console.warn(
      `[budget] plan-cap grund=slug_unbekannt slug=${slug} tenant=${tenantId} -> ` +
        "Ableitung uebersprungen (bestehende Decke bleibt, Tenant-Achse fail-closed)",
    );
    return;
  }
  let capCents = planCapCents(slug, cfg); // Fall (3): wirft nur noch bei Katalog-Slug OHNE Kopffreiheit
  const platformCapCents = cfg.platformSpendCapCents;
  if (capCents >= platformCapCents) {
    // Zweite Linie (leise, aber NICHT still): ein nachtraeglich gesenkter Plattform-Cap
    // darf den Stripe-Webhook nicht abreissen -> klemmen + GENAU EINE WARN, KEIN Wurf. Bei
    // kohaerenter Konfiguration ist dieser Zweig unerreichbar (erste Linie am Boot ist fatal).
    console.warn(
      `[budget] plan-cap grund=clamp slug=${slug} abgeleitet=${capCents} ` +
        `platformSpendCapCents=${platformCapCents} -> geklemmt (Tenant-Achse inert)`,
    );
    capCents = platformCapCents;
  }
  setTenantBudget(s, tenantId, { budgetCents: capCents, hardCapCents: capCents }); // beide Felder
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
    // Fail-closed Default false (nie undefined): unbekannt/nicht geprueft -> placeHold
    // laeuft normal (kein stiller Kosten-Bypass).
    numberSetupFeeExempt: tenant?.stripeNumberSetupFeeExempt ?? false,
    // GAP-04-Wartezustand (s. tenantMayRequestNumber) + GAP-03-Periodenguthaben-Widerruf:
    // fail-closed Default false (nie undefined), Muster numberSetupFeeExempt.
    activationPending: tenant?.stripeActivationPending ?? false,
    periodCreditRevoked: tenant?.stripePeriodCreditRevoked ?? false,
  };
}

// Webhook-Tenant-Aufloesung (W4): Tenant ueber sein gespeichertes Abo finden. Reine
// Query, kein IO. Kein Treffer (oder leere subscriptionId) -> null (der Webhook ignoriert
// fail-closed, kein Cross-Tenant-Effekt - kein Suspend eines fremden/unbekannten Tenants).
export function findTenantBySubscription(s, subscriptionId) {
  if (!subscriptionId) return null;
  return s.tenants.find((t) => t.stripeSubscriptionId === subscriptionId) ?? null;
}

// GAP-03: Tenant-Aufloesung ueber die Stripe-Customer-Referenz (Geld-Ereignisse ohne
// subscriptionId, z.B. charge.dispute.created/charge.refunded tragen nur customer). Reine
// Query, kein IO. Muster findTenantBySubscription (fail-closed null, kein Cross-Tenant-Effekt).
export function findTenantByCustomer(s, customerId) {
  if (!customerId) return null;
  return s.tenants.find((t) => t.stripeCustomerId === customerId) ?? null;
}

// ---- Billing-Hold (GAP-03, O2) ----
// Setzt/loescht den Outbound-Sperrgrund eines Tenants + optionale Frist (dueAtIso, ISO).
// Reine Mutation, kein IO (Wrapper saved). Fehlender Tenant -> No-Op (Muster
// setSuspendedAtIfAbsent: ein Webhook-Event fuer einen unbekannten Tenant darf nicht werfen).
export function setBillingHold(s, tenantId, { reason, dueAtIso = null } = {}) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) return;
  tenant.billingHold = reason;
  tenant.billingHoldDueAt = dueAtIso;
}

// Reversibilitaet (O2/ENTSCHAERFT 3): ein bestaetigtes aktives Abo hebt jede Beanstandungs-
// Wirkung auf (webhook.js ACTIVATE-Zweig). Symmetrisch zu setBillingHold, idempotent.
export function clearBillingHold(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) return;
  tenant.billingHold = null;
  tenant.billingHoldDueAt = null;
}

// Ist der Hold GERADE wirksam? Ohne gesetzten Grund -> null (kein Hold). Mit Grund, aber
// OHNE Frist -> sofort aktiv (z.B. paused). Mit Frist -> erst wenn nowIso die Frist erreicht
// hat (payment_action_required: Warnung davor, Sperre danach) - "Kein Scheduler": die Frist
// wird hier, am Ausgabepunkt (outbound-gates.js), lazy durchgesetzt. Reine Query, kein IO.
// nowIso wird injiziert (P12/R, Uhr testbar); der Fassaden-Wrapper reicht new Date().
export function billingHoldActive(s, tenantId, nowIso) {
  const tenant = findTenant(s, tenantId);
  const reason = tenant?.billingHold ?? null;
  if (!reason) return null;
  const dueAtIso = tenant.billingHoldDueAt;
  if (!dueAtIso) return reason;
  return nowIso >= dueAtIso ? reason : null;
}

// ---- Private Summary-Nummer pro Tenant (F2) ----
// EINE Normalisier-/Validier-Quelle (G5), geteilt von registerTenant (Onboarding) UND
// setPrivateNumber (Self-Service) - kein Drift zwischen den beiden Schreibwegen. Reine
// Funktion (kein Tenant, kein Store). Reihenfolge ist verbindlich (M3): normNum ZUERST,
// dann E.164-Format, dann die DENYLIST (Premium/Notruf - gleiche Praezedenz wie in der
// Outbound-Gate-Kette), dann das Laendercode-Gate. tenantCountryIso (ISO-3166-1-alpha-2,
// aus dem Tenant-Land) ist die Herleitungsquelle des erlaubten Praefixes (P8/FMT-11);
// das Gate selbst BLEIBT eine Allowlist, unbekanntes Land -> strenger Bestands-Default.
// Leer/null/"" -> null (Aufrufer entfernt das Feld; kein Daten-Muell at rest). Ungueltig
// oder gesperrtes Land -> throw (fail-closed). PII: der Roh-/Zielwert wird NIE in die
// Fehlermeldung gehoben (kein Nummer-Leak im Log, H4). Liefert die normalisierte E.164.
// Exportiert, damit der Route-Layer (POST /api/onboard) VOR dem Store-Lock dieselbe
// Quelle nutzt und ungueltige Eingaben als 400 abweist (statt Throw -> 503).
export function normalizePrivateNumber(raw, tenantCountryIso) {
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) return null;
  const e164 = normNum(raw);
  if (!E164.test(e164)) throw new Error("private number: ungueltiges E.164-Format");
  if (isDenied(e164)) throw new Error("private number: gesperrter Nummernbereich");
  if (!countryAllowed(e164, allowedPrivateNumberCodes(tenantCountryIso)))
    throw new Error("private number: Laendercode nicht erlaubt");
  return e164;
}

// Setzt die private Mobilnummer (E.164), an die nach einem Inbound-Call die Gespraechs-
// Zusammenfassung als SMS geht. Identitaets-/Kontaktdatum -> lebt am Tenant-Record
// (NICHT in settings: settings leakt komplett ueber /api/state + MCP, H4). Reine
// Mutation, kein IO (Wrapper saved). Leer/null/"" -> Feld entfernen (Skip-Pfad in
// finishCall bleibt verlaesslich). Ungueltig/gesperrtes Land -> throw (fail-closed, kein
// Muell at rest). Fehlender Tenant -> throw (Muster setKycLevel/setTenantStripe).
// Liefert den Tenant.
export function setPrivateNumber(s, tenantId, raw) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`setPrivateNumber: Tenant ${tenantId} nicht gefunden`);
  // P8/FMT-11: dasselbe Land-Gate wie beim Onboarding, hergeleitet aus dem Tenant-Land
  // (kein Drift zwischen den zwei Schreibwegen, G5). Tenant ohne country -> strenger
  // Bestands-Default ["+49"], byte-identisch zum Zustand vor P8.
  const e164 = normalizePrivateNumber(raw, tenant.country);
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
// Tenants). patch = { country?, defaultLanguage?, timezone? }: NUR uebergebene Keys
// werden gesetzt (selektiver Patch via !== undefined, kein Ueberschreiben mit undefined)
// - Muster wie setTenantStripe. Fehlender Tenant wirft (kein stilles No-Op). Geo-Daten
// sind nicht sensibel (keine Secrets) -> speicherbar. Reine Mutation, kein IO (Wrapper
// saved). Liefert den Tenant. country = ISO-3166-1-alpha-2, defaultLanguage = BCP-47-kurz.
// timezone (P8/FMT-28) ist ein reines ANZEIGE-Feld (IANA-Bezeichner) und wird von
// tenantGeo() BEWUSST NICHT mit ausgeliefert - s. tenantTimezone unten.
export function setTenantGeo(s, tenantId, { country, defaultLanguage, timezone } = {}) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`setTenantGeo: Tenant ${tenantId} nicht gefunden`);
  if (country !== undefined) tenant.country = country;
  if (defaultLanguage !== undefined) tenant.defaultLanguage = defaultLanguage;
  if (timezone !== undefined) tenant.timezone = timezone;
  return tenant;
}

// Lese-Query der Geo-Felder eines Tenants (F1). Reine Query, kein IO. Liefert STETS ein
// Objekt mit beiden Feldern (fehlend -> null). Der Webhook-Provisioning-Trigger (P3) liest
// hieraus das Land der anzufragenden Nummer (onboard hat es via setTenantGeo gesetzt).
export function tenantGeo(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  return { country: tenant?.country ?? null, defaultLanguage: tenant?.defaultLanguage ?? null };
}

// P8/FMT-28: die Zeitzone eines Tenants - GETRENNT von tenantGeo(), und zwar mit Absicht.
// tenantGeo() ist die Routing-/Sprach-Sicht, die die Gate-nahen Konsumenten
// (outbound-gates, provision-trigger, api-calls, self-service-routes) lesen. Haenge die
// Zeitzone dort an, kann ein kuenftiges Gate sie versehentlich mitlesen - genau das
// Anrufzeit-Gate, das der Owner abgelehnt hat (LAW-07/O10). Eigener Reader = die
// Zusicherung "nur Anzeige" ist strukturell, nicht per Kommentar. Fehlender Tenant /
// fehlendes Feld -> null (der Konsument loest ueber resolveTimezone fail-safe auf).
export function tenantTimezone(s, tenantId) {
  return findTenant(s, tenantId)?.timezone ?? null;
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
// country/language (F1, Phase 1) im Destructure: die angefragte Nummer traegt von
// Anfang an ihren Geo-Anker, den der spaetere Provider-Kauf (Telnyx-Laendersuche) und
// das Inbound-/Outbound-Routing lesen. A1 (PLAN-I18N-FIX): language ist LAND-abgeleitet,
// s. seedBootstrapNumber - Bestandsaufrufer ohne country bleiben verhaltens-erhaltend
// (DEFAULT_COUNTRY -> languageForCountry(DEFAULT_COUNTRY)).
// GAP-04: darf fuer diesen Tenant eine Nummer angefragt werden? Zwei Wege, strikt getrennt:
//  (1) status ACTIVE - der Bestandspfad (POST /api/onboard, Operator-Retry): UNVERAENDERT.
//  (2) GAP-04-Wartezustand: die Zahlung ist bestaetigt (activatePaidTenant hat den Marker
//      gesetzt), der Tenant ist aber noch NICHT aktiv - genau dafuer existiert der Marker,
//      damit die Aktivierung das Provisioning-Ergebnis abwarten kann, statt es vorwegzunehmen.
// Hart ausgeschlossen bleibt jeder GESPERRTE Tenant: closed nie, und ein gesetzter
// Suspend-Anker (Zahlungsausfall/Abo geloescht) nie - der Marker ist eine Erlaubnis der
// Aktivierung, KEINE Umgehung einer Sperre.
export function tenantMayRequestNumber(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) return false;
  if (tenant.status === TENANT_STATUS.ACTIVE) return true;
  if (tenant.status === TENANT_STATUS.CLOSED) return false;
  if (tenant.suspendedAt) return false;
  return tenant.stripeActivationPending === true;
}

export function requestNumber(
  s,
  {
    tenantId,
    provider = DEFAULT_PROVIDER,
    country = DEFAULT_COUNTRY,
    language = languageForCountry(country),
    maxNumbers,
    maxNumbersPerTenant,
  },
) {
  const tenant = findTenant(s, tenantId);
  if (!tenantMayRequestNumber(s, tenantId))
    return { ok: false, reason: REQUEST_NUMBER_REASON.TENANT_INACTIVE };
  if (liveNumbers(s).length >= maxNumbers) {
    markNumberProvisionSkipped(tenant, GLOBAL_CAP_REASON);
    return { ok: false, reason: GLOBAL_CAP_REASON };
  }
  if (liveNumbers(s, tenantId).length >= maxNumbersPerTenant)
    return { ok: false, reason: REQUEST_NUMBER_REASON.TENANT_CAP };
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

// requested -> provisioning. REINER Zustandswechsel: die PaymentIntent-Referenz des
// Payment-Pfads haengt seit P4/GAP-11 attachNumberPaymentIntent an (der Hold faellt jetzt
// NACH diesen Wechsel, s. dort).
export function beginProvisioning(s, numberId) {
  return transitionNumber(s, numberId, NUMBER_STATUS.PROVISIONING);
}

// Haengt die Stripe-PaymentIntent-Referenz an eine bereits laufende Provisionierung.
// Die Rollback-Pfade (cancelHold) finden sie damit auch nach einer Re-Hydrierung wieder.
// Getrennt von beginProvisioning, seit die Preis-Suche (GAP-11) zwischen Zustands-
// wechsel und Hold liegt: der Zustandswechsel darf NICHT auf den Hold warten, sonst
// verbreitert sich das Doppelkauf-Fenster des 'requested'-Schlosses.
export function attachNumberPaymentIntent(s, numberId, paymentIntentId) {
  const number = findNumber(s, numberId);
  if (!number) throw new Error(`attachNumberPaymentIntent: Nummer ${numberId} nicht gefunden`);
  number.paymentIntentId = paymentIntentId;
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
// monthlyCostCents (P4/GAP-11): die beim Kauf uebernommene Monatsmiete in GANZZAHL
// Cents der Bucket-Waehrung. NUR gesetzt, wenn der Provider einen verwertbaren Preis
// geliefert hat - fehlt er, bleibt das Feld ABWESEND (nicht 0): P5 unterscheidet daran
// "keine Miete gelernt" von "Miete ist 0" und faellt sonst auf seinen Fallback zurueck.
export function activateNumber(s, numberId, { e164, providerNumberId, monthlyCostCents = null }) {
  const number = transitionNumber(s, numberId, NUMBER_STATUS.ACTIVE);
  number.e164 = e164;
  number.providerNumberId = providerNumberId ?? null;
  if (monthlyCostCents !== null) number.monthlyCostCents = monthlyCostCents;
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

// ---- tenant-prolif-d: DID-Release-Klassifizierer (reiner Kern) ----
// Verdikt-Werte (G25). release/hold/skip sind DISJUNKT.
export const RELEASE_VERDICT = Object.freeze({ RELEASE: "release", HOLD: "hold", SKIP: "skip" });

// Reiner, IO-freier, zeit-injizierter Verdict PRO Nummer (Vorbild redriveAgeHoldReason).
// Kein Date.now/Math.random. EINE Regel-Quelle (G5) fuer den Bucket-Klassifizierer UND
// den Live-Recheck im Reconcile-Executor. Regel (Invariante 1):
//   release: Nummer active + Tenant suspendiert (suspended_at gesetzt) +
//            nowMs - suspendedAt > graceMs + provider==="telnyx".
//   hold   : dieselbe Release-Reife, aber provider!=="telnyx" (manuell - kein Twilio-Release).
//   skip   : nicht active / nicht suspendiert / Grace nicht erreicht / suspended_at
//            unparsebar (fail-closed - NIE auf Muell releasen).
export function numberReleaseVerdict(s, number, { nowMs, graceMs }) {
  if (number.status !== NUMBER_STATUS.ACTIVE)
    return { action: RELEASE_VERDICT.SKIP, reason: `not_active_${number.status}` };
  const suspendedAt = tenantSuspendedAt(s, number.tenantId);
  if (!suspendedAt) return { action: RELEASE_VERDICT.SKIP, reason: "tenant_not_suspended" };
  const suspendedMs = Date.parse(suspendedAt);
  if (Number.isNaN(suspendedMs))
    return { action: RELEASE_VERDICT.SKIP, reason: "suspended_at_unparsebar" };
  if (nowMs - suspendedMs <= graceMs)
    return { action: RELEASE_VERDICT.SKIP, reason: "grace_not_reached" };
  if (number.provider !== PROVIDER.TELNYX)
    return { action: RELEASE_VERDICT.HOLD, reason: "non_telnyx_manual" };
  return { action: RELEASE_VERDICT.RELEASE, reason: null };
}

// Bucket-Klassifizierer (Vorbild classifyQueuedProvisioningJobs): mappt ALLE Nummern auf
// drei disjunkte Koerbe. REIN + IO-frei (mutiert s NICHT, kein Date.now). release=Number[]
// (der Executor braucht id + providerNumberId); hold/skip=[{number,reason}] fuer die
// Observability. Nutzt numberReleaseVerdict (EINE Regel-Quelle, G5).
export function classifyNumbersForRelease(s, { nowMs, graceMs }) {
  const buckets = { release: [], hold: [], skip: [] };
  for (const number of s.numbers) {
    const { action, reason } = numberReleaseVerdict(s, number, { nowMs, graceMs });
    if (action === RELEASE_VERDICT.RELEASE) buckets.release.push(number);
    else if (action === RELEASE_VERDICT.HOLD) buckets.hold.push({ number, reason });
    else buckets.skip.push({ number, reason });
  }
  return buckets;
}

// ---- tenant-prolif-e: Erase-Release-Selektor (reiner Kern) ----
// Liefert die Nummern EINES Tenants, die eine Art.-17-Loeschung freigeben darf: status
// active + provider telnyx. GRACE-FREI - anders als numberReleaseVerdict, das den Suspend-
// Grace prueft: bei Loeschung existiert der Tenant nicht mehr, es gibt keine Reaktivierung.
// Weiterhin Telnyx-only (Twilio hat keinen releaseNumber-Pfad -> non-telnyx bleibt
// unangetastet) und active-only. Der active-Filter IST die Idempotenz-Garantie: ein zweiter
// Erase-Lauf findet die schon released-en Nummern NICHT mehr -> kein zweiter Provider-DELETE.
// REIN + IO-frei (mutiert s NICHT, kein Date.now): der eigentliche Release (Provider-DELETE +
// Store-Mutation + Audit) laeuft im Orchestrator (release-reconcile.js), NICHT hier.
export function tenantNumbersForErase(s, tenantId) {
  return s.numbers.filter(
    (n) =>
      n.tenantId === tenantId &&
      n.status === NUMBER_STATUS.ACTIVE &&
      n.provider === PROVIDER.TELNYX,
  );
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
// costCents/costMicroCentsRem summieren EXAKT ueber Mikro-Cents mit Uebertrag (P1
// Safety-BLOCKER): kein Per-Tenant-Rundungsverlust, bevor die Plattform-Summe gegen
// den globalen Cap verglichen wird.
export function globalUsageTotals(s) {
  let inputTokens = 0,
    outputTokens = 0,
    calls = 0,
    microTotal = 0;
  for (const bucket of Object.values(s.usage)) {
    inputTokens += bucket.inputTokens;
    outputTokens += bucket.outputTokens;
    calls += bucket.calls;
    microTotal += bucket.costCents * MICRO_CENTS_PER_CENT + (bucket.costMicroCentsRem || 0);
  }
  return {
    inputTokens,
    outputTokens,
    calls,
    costCents: Math.floor(microTotal / MICRO_CENTS_PER_CENT),
    costMicroCentsRem: microTotal % MICRO_CENTS_PER_CENT,
  };
}

// Teuerste hinterlegte Rate - das Fail-closed-Ziel fuer ein unbekanntes Modell (P7a).
// "Teuerste" = groesster Output-Preis, bei Gleichstand groesster Input-Preis: Output
// dominiert die Rechnung in jeder bekannten Claude-Staffel (out = 5x in). Eine LEERE
// Tabelle wirft benannt statt still - ein Startwert 0 waere fail-OPEN (Preis 0 = Gate
// blind, Regel 1). Reine Funktion.
function mostExpensivePrice(prices) {
  const rates = Object.values(prices);
  if (!rates.length)
    throw new Error("modelPricesUsd ist leer - keine Preisquelle fuer den Budget-Guard (Regel 1)");
  return rates.reduce((max, p) =>
    p.outPerMTok > max.outPerMTok ||
    (p.outPerMTok === max.outPerMTok && p.inPerMTok > max.inPerMTok)
      ? p
      : max,
  );
}

// Preis-Aufloesung PRO MODELL (P7a). Fail-closed: ein Modell, das NICHT in der
// Preistabelle steht, wird mit der TEUERSTEN hinterlegten Rate gebucht - nie mit 0,
// nie mit dem Haiku-Default (Regel 1: ein zu niedriger Preis macht die KI-Kosten-Achse
// des Budget-Gates blind, ein zu hoher ist hoechstens zu streng).
//
// Object.hasOwn statt prices[model]: cfg.modelPricesUsd ist in Produktion ein
// guardedConfig-PROXY, dessen get-Trap bei einem unbekannten Schluessel TypeError WIRFT.
// Ein Roh-Index wuerde den Turn also mit 500 killen statt konservativ zu buchen; hasOwn
// laeuft ueber die has-Trap und damit ungefiltert ans Target. Reine Funktion.
function priceForModel(model, prices) {
  return Object.hasOwn(prices, model) ? prices[model] : mostExpensivePrice(prices);
}

// USD-Kosten EINES Token-Verbrauchs unter der Preisstaffel des buchenden Modells.
// EINE Quelle (G5) der Preisformel: trackUsage (Live-Bucket, Mikro-Cent-Akkumulator)
// UND aiCostCents (Stripe-Meter, Ganzzahl Cents) leiten ihren Betrag hieraus ab.
// tokens = {inputTokens, outputTokens, model}.
function tokenCostUsd(tokens, cfg) {
  const price = priceForModel(tokens.model, cfg.modelPricesUsd);
  return (
    (tokens.inputTokens / TOKENS_PER_M_TOK) * price.inPerMTok +
    (tokens.outputTokens / TOKENS_PER_M_TOK) * price.outPerMTok
  );
}

// ---- D7-Riegel: unbuchbare Geldwerte laut verwerfen bzw. laut sperren ----
// Dieses Modul ist sonst IO-frei; die zwei console-Aufrufe hier sind eine bewusste,
// eng begrenzte Ausnahme (kein Datei-/DB-IO). Ein STILLER Discard bzw. eine stille
// Sperre auf einer Geld-Kante waere dieselbe fail-open-durch-Vergessen-Klasse, die
// diese Phase behebt: der Betrag ist real verloren bzw. der Dienst ist stumm, und
// beides muss der Operator sehen. Beide Logs sind secret-frei (nur Kante + Zahl).

// Verwirft einen unbuchbaren SCHREIBversuch und liefert den Bucket BIT-IDENTISCH
// zurueck (Rueckgabevertrag beider Schreibkanten bleibt "der Bucket").
function discardCorruptWrite(usage, kante, wert) {
  console.error(`[usage] grund=${USAGE_CORRUPT_REASON} verworfen kante=${kante} wert=${wert}`);
  return usage;
}

// Sperrt an einer Geld-LESEKANTE fail-closed (Absolute Regel 1): ein nicht-endlicher
// Verbrauch macht sonst BEIDE Geld-Gates blind, weil NaN >= cap und NaN > cap immer
// false sind. Einziger Aufrufer ist der gemeinsame spendOrDeny-Rumpf (fuer beide
// Achsen, Tenant UND Plattform, G5-Review-Fix Runde 1) - er meldet das Deny-Signal
// weiter an die vier Gate-Funktionen, die dann true (blocken) liefern.
//
// feld benennt EXPLIZIT, welcher der zwei geprueften Werte tatsaechlich vergiftet ist
// ("gateCents" oder "lifetimeCents" - Review-Blocker Runde 1, P8/G2): ein zuvor
// hartcodiertes "costCents=" log das Feld unabhaengig vom tatsaechlich betroffenen
// Wert. Seit P7 ist gateCents nach dem Flip die MONATSZAHL, nicht mehr costCents - ein
// vergifteter Monats-Wert bei gesundem costCents zeigte im Log trotzdem "costCents=NaN"
// und verwies einen On-Call-Ops (CLAUDE.md Regel 7: "erst Runtime-Output lesen, nie
// raten") auf das falsche Feld, weil der Runtime-Output selbst luegt. Liefert IMMER
// true (Bestandsvertrag).
function denyCorruptUsage(kante, feld, wert) {
  console.error(`[budget] grund=${USAGE_CORRUPT_REASON} kante=${kante} feld=${feld} wert=${wert}`);
  return true;
}

// Sind ALLE drei Inkremente eines Turns buchbar (G28: zusammengesetzte Bedingung
// eingekapselt)? isBookableCents traegt "Cents" im Namen, ist inhaltlich aber der EINE
// Riegel "endlich, ganzzahlig und nicht negativ" und gilt fuer Token-Zaehler genauso: ein
// NaN-Zaehler vergiftet den Bucket auf demselben Weg. Bewusst EIN Praedikat statt drei
// Inline-Kopien. Token-Zaehler (inputTokens/outputTokens) und microInc sind
// produktionsseitig immer Ganzzahlen (API-Zaehler bzw. Math.round) - die Ganzzahl-Pruefung
// aendert hier nichts am Bestandsverhalten.
function turnIncrementsBookable(tokens, microInc) {
  return (
    isBookableCents(tokens.inputTokens) &&
    isBookableCents(tokens.outputTokens) &&
    isBookableCents(microInc)
  );
}

// ---- Spend-Monat-Achse (Budget-Achsen P4): additiv, INERT, kein Gate liest sie ----

// Parst einen ISO-Zeitpunkt zu einem Date oder null, wenn er unlesbar ist. EINZIGE
// Anker-Pruefung BEIDER periodischer Achsen dieses Moduls (G5): spendMonthKeyOf UND
// ttsCycleKeyOf leiten ihre Uhr-Anomalie-Behandlung ("unlesbar -> null -> kein Reset")
// aus dieser einen Stelle ab statt sie zu kopieren. Reine Funktion.
function parseValidDate(nowIso) {
  const at = new Date(nowIso);
  return Number.isNaN(at.getTime()) ? null : at;
}

// UTC-Kalendermonat 'YYYY-MM' eines Datums. EINZIGE Monats-Schluessel-Formatierung beider
// periodischer Achsen (G5): explizit getUTC* statt date.toISOString().slice(0, 7) waere
// aequivalent, aber der Aufrufer ttsCycleKeyOf verschiebt das Date VOR der Formatierung
// (Zyklus-Anker != Kalendermonatsanfang) - ueber ein gemeinsames Date-Argument teilen sich
// beide Achsen dieselbe Format-Zeile. Reine Funktion.
function yearMonthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// UTC-Kalendermonat 'YYYY-MM' aus einem ISO-Zeitpunkt. EINZIGE Ableitungsstelle der
// Spend-Monat-Achse (G5): lokal statt UTC gerechnet driftete der Rollover zwischen
// json- und pg-Backend auseinander. Explizit getUTC* statt nowIso.slice(0, 7) - ein
// ISO-String MIT Offset ("...T01:00+02:00") traegt im Praefix den LOKALEN Monat und
// haette am Monatsersten den falschen Schluessel gestempelt.
// Unlesbarer Anker -> null; die Aufrufer behandeln das als "kein Rollover", nie als
// frischen Monat (fail-closed: eine kaputte Uhr darf den Zaehler nicht ruecksetzen).
// Reine Funktion.
function spendMonthKeyOf(nowIso) {
  const at = parseValidDate(nowIso);
  return at ? yearMonthKey(at) : null;
}

// Der SPAETERE aus gespeichertem und laufendem periodischen Schluessel. Zwei
// Schluessel-FORMATE, beide lexikografisch = chronologisch sortierbar -> String-Vergleich
// genuegt, keine zweite Datums-Arithmetik: 'YYYY-MM' (Spend-Monat, TTS-Zyklus) und
// ISO-8601 (Stripe-Periodenstart, GAP-01). EINZIGE Monotonie-/Zukunftsschluessel-Regel
// ALLER DREI periodischer Achsen dieses Moduls (G5): der Spend-Monat der Budget-Achse
// (P4/P7, ueber authoritativeSpendMonthKey darunter), der ElevenLabs-Zyklus-Schluessel
// (LCT P7, ttsCycleKeyOf/recordTtsCharacters weiter unten) UND das Perioden-Fenster des
// Budget-Gates (GAP-01, stampBudgetPeriod) teilen sich denselben Riegel statt ihn zwei
// weitere Male zu implementieren.
//
// MONOTONIE-RIEGEL (Sicherheitskern): weil das MAXIMUM gebildet wird, kann der
// Schluessel per Konstruktion NIE rueckwaerts wandern, und ein Schluessel in der
// ZUKUNFT (Clock-Skew, falsch gestellte Container-Uhr) gewinnt - er liest NICHT als
// frischer Zeitraum und faellt NICHT auf 0. Ohne diesen Riegel waere jede Achse ueber
// eine einzige Uhr-Anomalie beliebig oft ruecksetzbar, also ihr Cap/Kontingent
// abschaltbar.
//
// Semantik im Ueberblick (storedKey vs. nowKey):
//   aelter   -> nowKey    (Rollover: Leser 0, Schreiber startet bei 0)
//   gleich   -> nowKey    (Normalfall: weiterzaehlen)
//   ZUKUNFT  -> storedKey (Riegel: kein Reset, kein Rueckwaerts-Stempel)
//   kein nowKey (unlesbar) -> storedKey (fail-closed)
//   kein storedKey (Bestandszeile/frischer Bucket) -> nowKey (erste Stempelung)
// Reine Funktion.
export function laterMonotonicKey(storedKey, nowKey) {
  if (!nowKey) return storedKey ?? null;
  if (!storedKey) return nowKey;
  return storedKey > nowKey ? storedKey : nowKey;
}

// Der AUTORITATIVE Monatsschluessel eines Usage-Buckets zum Zeitpunkt nowKey. Delegiert
// unveraendert an laterMonotonicKey (G5) - Semantik byte-identisch zum Bestand vor der
// Extraktion (Beweis: die bestehenden Spend-Monat-/Budget-Tests bleiben gruen).
//
// GENAU ZWEI direkte Aufrufer: die Leseprojektion spendMonthWindowKey (P5b, einzige
// Stelle, die den autoritativen Schluessel zusammensetzt - spendMonthUsageCents bezieht
// ihn NUR noch darueber, siehe unten, statt ihn ein zweites Mal selbst zusammenzusetzen)
// und der Schreiber bookCents. Beide stellen dieselbe Frage ("weicht der autoritative
// Schluessel vom gespeicherten ab?") und lesen die Antwort unterschiedlich: der Leser als
// "0"/den laufenden Schluessel, der Schreiber als "Zaehler startet neu".
function authoritativeSpendMonthKey(storedKey, nowKey) {
  return laterMonotonicKey(storedKey, nowKey);
}

// Reine LESEPROJEKTION des Monatsverbrauchs in GANZZAHL Cents - KEINE Mutation, kein
// Reset-Job, kein Cron, kein preDeploy (Render Free Tier hat weder Shell noch Jobs).
// Liefert 0, sobald der gespeicherte Schluessel aelter als der laufende Monat ist; der
// persistierte Zaehler bleibt dabei unangetastet und wird erst vom naechsten
// Schreibvorgang neu gestartet. Ein Rollover an der LESEKANTE waere ein ungespeicherter
// Schreibeffekt mitten im Gate-Pfad - usageFor legt den Bucket schon beim Lesen per ||=
// an - und feuerte bei jedem /api/state-Poll.
// nowIso kommt vom Aufrufer (state-ops bleibt zeit-frei, Muster voiceMinutesUsedSince /
// setSuspendedAtIfAbsent).
// P4: INERT - KEIN Gate ruft diese Funktion. Der Flip ist P7.
// Bezieht den autoritativen Schluessel ueber spendMonthWindowKey (G5-Fix, Review-Blocker
// Runde 2): vorher bauten beide Leseprojektionen unabhaengig voneinander denselben
// Ausdruck erneut zusammen - woertlich identische Zeile, zweimal im selben Modul. Jetzt
// gibt es GENAU EINE Stelle, die den autoritativen Monatsschluessel zusammensetzt, und
// die Nicht-Divergenz zwischen Anzeige und Verbrauchszahl ist strukturell statt nur
// konventionell erzwungen.
export function spendMonthUsageCents(bucket, nowIso) {
  const key = spendMonthWindowKey(bucket, nowIso);
  return key === bucket.spendMonthKey ? bucket.spendMonthCostCents : 0;
}

// Reine LESEPROJEKTION des ANGEZEIGTEN Monatsschluessels (P5b) - EINZIGE Stelle, die
// die Vergleichsregel authoritativeSpendMonthKey zusammensetzt; spendMonthUsageCents
// bezieht den Schluessel ausschliesslich hierueber (G5), damit Anzeige und
// Verbrauchszahl niemals auseinanderlaufen KOENNEN (derselbe Monotonie-/Zukunfts-Riegel
// gilt automatisch fuer beide). NIE den rohen Bucket-Stempel (bucket.spendMonthKey) roh
// projizieren: nach einem Rollover traegt der Bucket noch den ALTEN Schluessel, waehrend
// spendMonthUsageCents schon 0 liefert - roh projiziert stuende neben einer
// 0,00-EUR-Anzeige der falsche (vergangene) Monat.
export function spendMonthWindowKey(bucket, nowIso) {
  return authoritativeSpendMonthKey(bucket.spendMonthKey, spendMonthKeyOf(nowIso));
}

// EINZIGE Cent-Schreibstelle beider Geld-Achsen (G5) fuer alle NICHT-NEGATIVEN Betraege:
// trackUsage, addVoiceUsageCostCents UND (seit LCT P4) die POSITIVE Korrekturbuchung
// bookCostCorrectionCents buchen hier, damit costCents und spendMonthCostCents nie
// auseinanderlaufen KOENNEN.
//
// GENAU EINE benannte Ausnahme (LCT P4): die NEGATIVE Korrektur schreibt bewusst NUR
// costCents und laesst spendMonthCostCents unangetastet - sonst liesse sich die
// Monatsdecke durch verspaetete Gutschriften aus einem abgeschlossenen Monat aufweiten.
// Ein Cap, den man mit alten Calls zurueckdrehen kann, ist kein Cap. Die Ausnahme lebt
// AUSSCHLIESSLICH in bookCostCorrectionCents und ist dort testgepinnt.
//
// Genau diese Buendelung ist die Gegenmassnahme zu "fail-open durch Vergessen"
// (Pre-Mortem TOD 2): eine kuenftige dritte Schreibstelle, die nur costCents erhoeht,
// waere nach P7 ein blindes Gate ohne Symptom - ein blindes Gate blockt nur nichts mehr.
//
// costCents bleibt UNVERAENDERT monoton (Lebenszeit-Forensik und die unabhaengige
// Gegenprobe, gegen die sich eine vergessene Schreibstelle ueberhaupt nachweisen laesst
// - der Grund, warum die Achse additiv und nicht ersetzend ist).
//
// MIKRO-CENT-REGEL (P1-Safety-BLOCKER): costMicroCentsRem wird hier BEWUSST NICHT
// angefasst. Der Sub-Cent-Rest bleibt LEBENSZEIT-skaliert und ueberlebt jeden
// Monatswechsel; nur der Cent-Zaehler ist periodisch. Ein mit-zurueckgesetzter Rest
// waere nach P7 der wiederkehrende strukturelle Verlust des KI-Kostenanteils.
//
// Nebeneffekt im Namen (N7). Reine Mutation, kein IO.
//
// GRENZFALL null===null (Review-Blocker Runde 1): ist WEDER ein gespeicherter Schluessel
// NOCH nowIso lesbar vorhanden, liefert authoritativeSpendMonthKey null (Zeile "kein
// storedKey... -> nowKey" greift nicht, weil auch nowKey fehlt). Ohne den Explizit-Guard
// unten waere die allgemeine Gleichheitspruefung "key === usage.spendMonthKey" hier
// null===null=true und laese den Fall faelschlich als "derselbe Monat" durch -
// spendMonthCostCents wuerde weiterakkumulieren, OBWOHL nie ein Monat gestempelt wurde
// (Widerspruch zur MONOTONIE-Doku oben: "ohne Anker wird NIE gestempelt"). Der Guard
// macht diesen Grenzfall zum expliziten No-Op auf der Spend-Monat-Achse - costCents
// (Lebenszeit) bucht trotzdem weiter, nur die periodische Achse bleibt unangetastet.
function bookCents(usage, cents, nowIso) {
  usage.costCents += cents;
  const key = authoritativeSpendMonthKey(usage.spendMonthKey, spendMonthKeyOf(nowIso));
  if (key === null) return; // kein Anker je gestempelt UND nowIso unlesbar -> No-Op (kein Phantom-Betrag)
  usage.spendMonthCostCents = key === usage.spendMonthKey ? usage.spendMonthCostCents + cents : cents;
  usage.spendMonthKey = key;
}

// Mikro-Cent-Carry (G5): verteilt (Rest + Inkrement) in den vollen Cent-Uebertrag und den
// neuen Sub-Cent-Rest - das EINE Ganzzahl-Idiom hinter trackUsage (Cent-Aufloesung) und
// convertProviderMicroToBucketCents (Kurs-Umrechnung), das sich nur im Divisor und in der
// Einheit des Restes unterscheidet. REINE Funktion, MUTIERT NICHTS: der Aufrufer entscheidet,
// ob er Uebertrag UND Rest gemeinsam fortschreibt (alles-oder-nichts). floor und modulo
// teilen sich denselben Quotienten - kein "/ divisor"-Zwischenschritt als Float.
function carryMicroRemainder(remMicro, incrementMicro, divisor) {
  const totalMicro = remMicro + incrementMicro;
  return { carryCents: Math.floor(totalMicro / divisor), remMicro: totalMicro % divisor };
}

// Bucht KI-Token-Verbrauch + Kosten auf den Usage-Bucket des Tenants (P4).
// tokens = {inputTokens, outputTokens, model}; das Modell entscheidet die Preisstaffel
// (P7a, fail-closed bei unbekannter ID). P1 Safety-BLOCKER: kein Per-Inkrement-Cent-
// Rounding - ein einzelner Haiku-Turn kostet oft << 0,5 Cent und wuerde bei einer
// Pro-Inkrement-Rundung IMMER auf 0 fallen (das Budget-Gate saehe den KI-Kostenanteil
// nie). Stattdessen akkumuliert dieser Pfad EXAKT in Mikro-Cents (costMicroCentsRem)
// und bucht nur den vollen Cent-Uebertrag nach costCents (Math.floor) - der Sub-Cent-
// Rest reist ungerundet ueber die Inkremente mit, bis er selbst einen ganzen Cent
// ergibt. Liefert den Bucket. Ein unbuchbarer Turn (D7) wird vor jeder Mutation
// verworfen - der Bucket bleibt bit-identisch, der Rueckgabewert bleibt der Bucket.
// nowIso (P4, optional): vom Aufrufer injizierter Zeitpunkt fuer die Spend-Monat-Achse
// (Muster voiceMinutesUsedSince/setSuspendedAtIfAbsent, state-ops bleibt zeit-frei).
export function trackUsage(s, tenantId, tokens, cfg, nowIso) {
  const usage = usageFor(s, tenantId);
  const microInc = Math.round(
    tokenCostUsd(tokens, cfg) * cfg.usdToEur * CENTS_PER_EUR * MICRO_CENTS_PER_CENT,
  );
  // D7-Riegel VOR jeder Mutation: bisher stiegen inputTokens/outputTokens schon, bevor die
  // Kostenrechnung ueberhaupt lief - ein NaN-Turn hinterliess also drei vergiftete Felder.
  // Alles-oder-nichts, kein Teil-Schreibeffekt.
  if (!turnIncrementsBookable(tokens, microInc))
    return discardCorruptWrite(usage, `trackUsage tenant:${tenantId}`, microInc);
  usage.inputTokens += tokens.inputTokens;
  usage.outputTokens += tokens.outputTokens;
  const { carryCents, remMicro } = carryMicroRemainder(usage.costMicroCentsRem, microInc, MICRO_CENTS_PER_CENT);
  // Der volle Cent-Uebertrag geht ueber die EINE Buchungsstelle auf BEIDE Achsen; der
  // Sub-Cent-Rest bleibt lebenszeit-skaliert im Bucket (P1-Safety-BLOCKER, s. bookCents).
  bookCents(usage, carryCents, nowIso);
  usage.costMicroCentsRem = remMicro;
  return usage;
}

// AL-P10: gemeinsamer Kern BEIDER Ganzzahl-Cent-Buchungen (G5) - derselbe
// Korruptions-Riegel, dieselbe EINE Buchungsstelle (bookCents). `quelle` traegt
// ausschliesslich das Diagnose-Label: zwei Sachverhalte teilen sich keine Log-Zeile
// (teuer gelernte Repo-Lehre). Privat, kein Export. Optionsobjekt statt fuenftem
// Positionsargument (F1).
function addUsageCostCents(s, { tenantId, costCents, nowIso, quelle }) {
  const usage = usageFor(s, tenantId);
  if (!isBookableCents(costCents))
    return discardCorruptWrite(usage, `${quelle} tenant:${tenantId}`, costCents);
  bookCents(usage, costCents, nowIso);
  return usage;
}

// Bucht die IST-Voice-Minutenkosten (GANZZAHL Cents) eines beendeten Outbound-Calls in den
// LIVE-usage-Bucket des Tenants (outbound-p1c Reconcile, D1). Ganze Cents, exakt (keine
// Mikro-Cent-Bruecke noetig - der Voice-Tarif ist bereits Ganzzahl Cents/Minute). So sieht
// der Budget-Gate (budgetExceeded) + die Vorab-Reservierung endlich die Carrier-Minuten.
// nowIso (P4, optional): s. trackUsage.
// Nebeneffekt im Namen (N7). Reine Mutation, kein IO (Wrapper saved).
export function addVoiceUsageCostCents(s, tenantId, costCents, nowIso) {
  return addUsageCostCents(s, { tenantId, costCents, nowIso, quelle: "addVoiceUsageCostCents" });
}

// AL-P10: Gebuehr der serverseitigen Vorab-Recherche (GANZZAHL Cents). Eigene
// benannte Buchung neben der Token-Achse, WEIL serverseitige Suchen in
// input_tokens/output_tokens nicht erscheinen - sie waeren fuer das Budget-Gate
// sonst unsichtbar. Landet auf demselben Live-Budget-Bucket wie alles andere.
export function addResearchFeeCostCents(s, tenantId, costCents, nowIso) {
  return addUsageCostCents(s, { tenantId, costCents, nowIso, quelle: "addResearchFeeCostCents" });
}

// LCT P4: Divisor der Korrektur-Formel. ZUSAMMENGESETZT aus den zwei vorhandenen
// Konstanten, nie als nackte 1e12 - eine zweite, unabhaengig gepflegte Zahl waere genau
// die Drift, an der der naechste Einheiten-Fehler entsteht.
const CORRECTION_DIVISOR = MICRO_CENTS_PER_CENT * PROVIDER_RATE_SCALE;

// Provider-Mikro-Cent (USD) -> Ziel-Bucket-Cent (EUR), GANZZAHL, mit Rest-Uebertrag.
// REINE Funktion, MUTIERT NICHTS - genau deshalb kann der Aufrufer die Fall-Entscheidung
// NACH der Rechnung treffen und den Rest verwerfen, ohne ihn vorher geschrieben zu haben
// (alles-oder-nichts). Multiplikation zuerst, GENAU EINE Division ganz am Ende, gemeinsam
// mit der Cent-Rundung: kein "* rate / 1e6"-Zwischenschritt, der eine Float-Stufe und
// damit einen unexakten Rest einfuehrte.
// remMicro ausserhalb [0, CORRECTION_DIVISOR) oder nicht ganzzahlig -> 0 (fail-closed:
// ein korrupter Rest darf hoechstens einen Cent kosten, nie eine Rueckerstattung
// vergroessern). Der Aufrufer garantiert actualCostMicroCents >= 0 (P1-Typ).
export function convertProviderMicroToBucketCents({ remMicro, actualCostMicroCents, providerToBucketRateMicro }) {
  const safeRemMicro =
    Number.isSafeInteger(remMicro) && remMicro >= 0 && remMicro < CORRECTION_DIVISOR ? remMicro : 0;
  // Multiplikation zuerst; die EINZIGE Division steckt in carryMicroRemainder (floor und
  // modulo teilen denselben Quotienten) - kein "* rate / 1e6"-Zwischenschritt als Float.
  const { carryCents, remMicro: carriedRem } = carryMicroRemainder(
    safeRemMicro,
    actualCostMicroCents * providerToBucketRateMicro,
    CORRECTION_DIVISOR,
  );
  return { bucketCents: carryCents, remMicro: carriedRem };
}

// LCT P4, DIE Cent-Schreibkante der Korrektur (Anhang-Signatur, verbindlich).
// EIGENES Praedikat isCorrectionCents (Vorzeichen erlaubt) - isBookableCents bleibt
// unangetastet. Drei Regeln, alle drei sind Sicherungen und keine Kosmetik:
//   1. 0-BODEN: usage.costCents faellt NIE unter 0.
//   2. ACHSEN-ASYMMETRIE: positive Korrekturen gehen ueber bookCents auf BEIDE Achsen,
//      negative NUR auf die Lebenszeit-Achse. Sonst liesse sich die Monatsdecke durch
//      verspaetete Gutschriften aus einem abgeschlossenen Monat aufweiten.
//   3. deltaCents === 0 beruehrt KEINE Achse (kein Phantom-Monatsstempel ueber
//      bookCents(0)) - der Lauf gilt trotzdem als gebucht, s. applyCostCorrectionCents.
// Liefert { usage, booked }. Nebeneffekt im Namen (N7).
export function bookCostCorrectionCents(s, tenantId, deltaCents, nowIso) {
  const usage = usageFor(s, tenantId);
  if (!isCorrectionCents(deltaCents))
    return { usage: discardCorruptWrite(usage, `bookCostCorrectionCents tenant:${tenantId}`, deltaCents), booked: false };
  if (deltaCents > 0) bookCents(usage, deltaCents, nowIso); // beide Achsen
  // 0-BODEN + Achsen-Asymmetrie. NEBENEFFEKT, der in den Kommentar gehoert: wird
  // costCents auf 0 geklemmt, bricht still die Invariante
  // spendMonthCostCents <= costCents. spendOrDeny nutzt die Lebenszeitzahl als
  // UNABHAENGIGE Gegenprobe gegen die Monatszahl; nach einem Clamp ist diese
  // Gegenprobe nicht mehr aussagekraeftig. Heute entsteht daraus kein Schaden (beide
  // bleiben buchbar), die geaenderte BEDEUTUNG der Gegenprobe steht deshalb hier.
  else if (deltaCents < 0) usage.costCents = Math.max(0, usage.costCents + deltaCents);
  return { usage, booked: true };
}

// LCT P4: EIN Schritt aus Umrechnung, Fall-Entscheidung, Buchung und Rest-Fortschreibung.
// Verhaeltnis zu bookCostCorrectionCents wie trackUsage zu bookCents: hier liegt die
// Arithmetik, dort die Cent-Schreibkante.
// dataComplete ist KEIN Verhaltensschalter (F3/G15), sondern ein DATUM ueber die
// Datenlage, das die Regel selbst braucht: die Asymmetrie IST die Regel.
//   Ist > Schaetzung  -> IMMER gebucht (Unterschaetzung wird bedingungslos geheilt)
//   Ist < Schaetzung  -> nur bei dataComplete === true
//   verworfen         -> costCorrectionMicroCentsRem bleibt BIT-GLEICH
// Liefert { usage, booked, deltaCents }.
export function applyCostCorrectionCents(s, tenantId,
  { actualCostMicroCents, estimatedCostCents, providerToBucketRateMicro, dataComplete }, nowIso) {
  const usage = usageFor(s, tenantId);
  const { bucketCents, remMicro } = convertProviderMicroToBucketCents({
    remMicro: usage.costCorrectionMicroCentsRem,
    actualCostMicroCents,
    providerToBucketRateMicro,
  });
  const deltaCents = bucketCents - estimatedCostCents;
  // Die einzige Stelle, an der Geld zurueckgegeben werden kann - und sie verlangt den
  // Beweis. Reihenfolge ist Absicht: verworfen wird VOR jeder Mutation, damit der Rest
  // nachweislich bit-gleich bleibt (Rundungs-Absatz des Plans).
  if (deltaCents < 0 && !dataComplete) return { usage, booked: false, deltaCents };
  const booked = bookCostCorrectionCents(s, tenantId, deltaCents, nowIso);
  if (!booked.booked) return { usage, booked: false, deltaCents }; // isCorrectionCents-Riegel
  usage.costCorrectionMicroCentsRem = remMicro; // NUR zusammen mit der Buchung
  return { usage, booked: true, deltaCents };
}

// Effektiver pro-Tenant-Cap (TENANT-MONATSDECKE) in GANZZAHL Cents, genutzt von
// budgetExceeded UND reserveExceedsBudget. Praezedenz, absteigend:
//   (1) tenant_budget-Zeile -> deren hard_cap_cents
//   (2) Tenant-Default-Decke aus der Config (defaultTenantBudgetCents)
//   (3) globaler Cap (globalCapCents)
//
// P2a/D3: Stufe (2) ist neu. Vorher fiel JEDER Tenant ohne Zeile direkt auf Stufe (3) -
// damit war der PLATTFORM-NOTAUS zugleich Nutzer-Kontingent, die Tenant-Achse fuer alle
// Tenants ohne Zeile wirkungslos und der Cap ein GETEILTER Topf. globalCapCents bleibt
// PARALLEL ueber globalBudgetExceeded/globalReserveExceedsBudget bestehen - es gilt
// weiter die Schnittmenge min(Tenant, Plattform), Absolute Regel 1. Kein Gate wird
// entfernt oder ersetzt, es kommt nur eine zusaetzliche, engere Decke dazu.
//
// Der Test `> 0` ist SICHERHEITSKRITISCH, nicht kosmetisch. 0 ist die dokumentierte
// Sentinel-Semantik "kein Default-Seed" (config.js defaultTenantBudgetCents, min 0), und
// seedTenantDefaultBudget ueberspringt bei 0. Ein bedingungsloser Fallback lieferte bei
// Live-Wert 0 einen Cap von 0: budgetExceeded (>=) waere fuer JEDEN Tenant ohne Zeile
// true - jeder Outbound blockt, der KOSTENLOSE Inbound-Pfad weist ab (routes/voice.js)
// und der Shim legt mitten im laufenden Gespraech auf (telnyx-llm-shim.js). Das waere ein
// Totalausfall der Telefonie. Derselbe Vergleich faengt zugleich einen fehlenden oder
// nicht-numerischen Wert ab (undefined > 0 ist false) und landet dann ebenfalls auf dem
// Bestandsverhalten - die Abweichung geht immer Richtung Bestand, nie Richtung 0-Cap.
function effectiveCapCents(s, tenantId, cfg) {
  const budget = tenantBudgetRow(s, tenantId);
  if (budget) return budget.hardCapCents;
  const tenantDefaultCents = cfg.defaultTenantBudgetCents;
  return tenantDefaultCents > 0 ? tenantDefaultCents : globalCapCents(cfg);
}

// ---- Gate-Verbrauchsaufloesung (Budget-Achsen P7) ----
// ZWEI benannte Aufloesungen fuer die ZWEI Verbrauchsquellen im Modul: die Tenant-Achse
// (usageFor-Bucket) und die Plattform-Achse (globalUsageTotals-Summe ueber ALLE Buckets).
// Hinter GENAU EINEM Flag (BUDGET_MONTH_ENABLED, config.js): AUS (Default) liefert exakt
// den bisherigen Lebenszeit-Ausdruck (bucket.costCents bzw. globalUsageTotals(s).costCents),
// byte-identisch zum Bestand. AN liest stattdessen die additive, seit P4 mitgefuehrte
// Spend-Monat-Achse (spendMonthUsageCents) - denselben UTC-Kalendermonat, den bookCents
// seit P4 mitschreibt. KEIN weiteres Praedikat/keine Fassade liest das Flag (Beleg:
// test/budget-month-flip.test.js zaehlt die Lesestellen in diesem Modul) - beide Achsen
// schalten dadurch STRUKTURELL gemeinsam: es kann nie einen Zustand geben, in dem eine
// Achse periodisch und die andere lebenslang rechnet.
//
// GAP-01 (P6) ersetzt den LEBENSZEIT-Zweig der TENANT-Achse durch das Perioden-Fenster
// (budgetPeriodUsageCents darunter). Der Flag-AN-Zweig bleibt unberuehrt, ebenso die
// Plattform-Achse (gatePlatformUsageCents, Absolute Regel 1).

// Leseprojektion der PERIODEN-Achse (GAP-01). Reine Funktion, KEINE Mutation, kein Cron
// (Render Free Tier hat weder Shell noch Jobs) - der Reset ist ein Ereignis (Stripe-
// Perioden-Wechsel, s. stampBudgetPeriod), kein Zeitablauf. Nie gestempelt -> Lebenszeit
// (Bestandsverhalten, fail-closed). Math.max(0, ...), weil eine verspaetete NEGATIVE
// Kostenkorrektur aus der Vorperiode costCents unter den Baseline druecken kann - ein
// negativer Verbrauch waere ein Guthaben, das das Gate aufweitet.
function budgetPeriodUsageCents(bucket) {
  if (!bucket.budgetPeriodKey) return bucket.costCents;
  return Math.max(0, bucket.costCents - bucket.budgetPeriodBaselineCents);
}

// Stempelt den Beginn einer NEUEN Abrechnungsperiode auf den Usage-Bucket (GAP-01/O4).
// Nebeneffekt im Namen (N7). Der Aufrufer (billing/activation.js) entscheidet, OB gestempelt
// werden darf - hier lebt nur die WIE-Regel:
//   - kein Anker (Abo ohne Perioden-Feld) -> No-Op, das Gate bleibt auf der Lebenszeit-Achse
//   - gleicher Schluessel (Webhook-Retry, Metadata-Update) -> No-Op (idempotent)
//   - AELTERER Schluessel -> No-Op. MONOTONIE-RIEGEL ueber dieselbe eine Regel wie die
//     Spend-Monat-Achse (laterMonotonicKey, G5): ein rueckdatiertes/wiedereingespieltes
//     Event darf ein Kontingent nicht beliebig oft neu oeffnen.
// Reine Mutation, kein IO (Wrapper saved bei changed). Liefert { changed }.
export function stampBudgetPeriod(s, tenantId, periodStartIso) {
  if (!periodStartIso) return { changed: false };
  const bucket = usageFor(s, tenantId);
  if (laterMonotonicKey(bucket.budgetPeriodKey, periodStartIso) !== periodStartIso)
    return { changed: false };
  if (bucket.budgetPeriodKey === periodStartIso) return { changed: false };
  bucket.budgetPeriodKey = periodStartIso;
  bucket.budgetPeriodBaselineCents = bucket.costCents;
  return { changed: true };
}

export function gateUsageCents(s, tenantId, cfg, nowIso) {
  const bucket = usageFor(s, tenantId);
  return cfg.budgetMonthEnabled ? spendMonthUsageCents(bucket, nowIso) : budgetPeriodUsageCents(bucket);
}

// Plattform-Monatssumme: reine Ganzzahl-Summe der Monatsprojektion JEDES Buckets - KEINE
// Mikro-Cent-Bruecke noetig (anders als globalUsageTotals). Grund: bookCents bucht den
// Sub-Cent-Rest (costMicroCentsRem) per P1-Safety-Entscheidung IMMER lebenszeit-skaliert,
// nie auf die Monats-Achse - auf der Monats-Achse existiert also kein Rest, der beim
// Summieren verloren gehen koennte, die Ganzzahl-Summe ist exakt.
function platformSpendMonthCents(s, nowIso) {
  return Object.values(s.usage).reduce((sum, bucket) => sum + spendMonthUsageCents(bucket, nowIso), 0);
}

export function gatePlatformUsageCents(s, cfg, nowIso) {
  return cfg.budgetMonthEnabled ? platformSpendMonthCents(s, nowIso) : globalUsageTotals(s).costCents;
}

// Liest den Gate-Verbrauch (ueber die Aufloesung oben) + wendet den D7-Riegel an
// (G5-Review-Fix Runde 1): tenantSpendOrDeny UND globalSpendOrDeny stehen wortgleich als
// "Wert lesen -> if(!isBookableCents) deny" da - EIN gemeinsamer Rumpf fuer beide.
//
// P7-Erweiterung (D7-Reichweite darf NIE schrumpfen): geprueft wird die Gate-Groesse
// (gateCents, nach dem Flip die Monatszahl) UND der Lebenszeit-Wert derselben Quelle
// (lifetimeCents) - eine UNABHAENGIGE Gegenprobe, NICHT die Gate-Groesse selbst. Nur die
// Gate-Groesse zu pruefen wuerde die Reichweite der Sicherung VERKLEINERN: ein Bucket mit
// vergiftetem Lebenszeit-Zaehler und gesunder Monatszahl rutschte durch, obwohl er heute
// sperrt - ein Flag darf keine Sicherung schrumpfen lassen. Nur den Lebenszeit-Wert zu
// pruefen waere nach dem Flip fail-OPEN: NaN >= cap ist false. Bei Flag AUS sind gateCents
// und lifetimeCents DIESELBE Zahl (spendOrDeny bleibt dann verhaltens-identisch zum
// Bestand). Liefert bei beidseitig buchbaren Werten {deny:false, spent:gateCents}; sonst
// loggt denyCorruptUsage bereits fail-closed (der vergiftete Wert, gleich welche Seite,
// UNTER SEINEM EIGENEN Feldnamen - "gateCents" oder "lifetimeCents", Review-Blocker
// Runde 1) und die Funktion liefert nur noch {deny:true} - der Aufrufer muss dann bloss
// true zurueckgeben.
function spendOrDeny({ label, gateCents, lifetimeCents }) {
  const gateBookable = isBookableCents(gateCents);
  if (gateBookable && isBookableCents(lifetimeCents)) return { deny: false, spent: gateCents };
  const feld = gateBookable ? "lifetimeCents" : "gateCents";
  denyCorruptUsage(label, feld, gateBookable ? lifetimeCents : gateCents);
  return { deny: true };
}

function tenantSpendOrDeny(s, tenantId, cfg, nowIso) {
  return spendOrDeny({
    label: `tenant:${tenantId}`,
    gateCents: gateUsageCents(s, tenantId, cfg, nowIso),
    lifetimeCents: usageFor(s, tenantId).costCents, // unabhaengige Gegenprobe, NICHT die Gate-Groesse
  });
}

// Pro-Tenant-Budget (P6b3): der GATE-Verbrauch (gateUsageCents - Perioden-Fenster bei Flag
// AUS seit GAP-01, Spend-Monat bei Flag AN) gegen den EFFEKTIVEN Cap (pro-Tenant hard_cap_cents wenn
// gesetzt, sonst die Tenant-Default-Decke, sonst der Plattform-Cap - Praezedenz s.
// effectiveCapCents). globalBudgetExceeded bleibt PARALLEL. Rein Integer
// gateCents-gegen-Cap (P1); fuer einen ganzzahligen Cap ist floor(x)>=cap aequivalent zu
// x>=cap - bit-identisch zum frueheren Float-Gate.
// Ein unbuchbarer Bucket (D7, jetzt auf BEIDEN Seiten geprueft) sperrt fail-closed mit
// eigenem Grund usage_korrupt - im Extremfall beendet das einen LAUFENDEN Call
// (telnyx-llm-shim) und weist kostenlosen Inbound ab (voice.js). Bei NaN-Verbrauch ist
// genau das richtig, und der eigene Grund macht es vom echten "Budget erschoepft"
// unterscheidbar.
export function budgetExceeded(s, tenantId, cfg, nowIso) {
  const spend = tenantSpendOrDeny(s, tenantId, cfg, nowIso);
  if (spend.deny) return true;
  return spend.spent >= effectiveCapCents(s, tenantId, cfg);
}

// Vorab-Reservierung (outbound-p1c, Kosten-Achse, D1): wuerde der Worst-Case-Minutenpreis
// (reserveCents, GANZZAHL Cents) den verbleibenden effektiven Tenant-Cap UEBERSTEIGEN?
// Gate-Verbrauch (gateUsageCents) + Reserve > effektiver Cap -> true (402 vor Dial).
// DIESELBE Cap-Aufloesung (effectiveCapCents) + derselbe Verbrauchs-Helfer wie
// budgetExceeded (G5, ueber denselben tenantSpendOrDeny-Helfer); globalBudgetExceeded
// bleibt PARALLEL (Schnittmenge, Regel 1). Reine Query, kein IO.
// Neu (OUT-05): die bereits gebuchte In-Flight-Reserve des Tenants (reservationFor)
// zaehlt kumulativ mit -> N kurz aufeinanderfolgende Calls koennen den Cap nicht mehr
// gemeinsam ueberschreiten. Bei LEERER Reserve byte-identisch zum Bestand. P1: rein
// Integer Cents (der settled Sub-Cent-Rest costMicroCentsRem wird an dieser
// Vergleichskante geflooert - Effekt < 1 Cent, dominiert vom Worst-Case-Reserve-
// Ueberschaetzer; die Sub-Cent-Turns selbst gehen NICHT verloren, sie tragen im Bucket).
export function reserveExceedsBudget(s, tenantId, reserveCents, cfg, nowIso) {
  const spend = tenantSpendOrDeny(s, tenantId, cfg, nowIso);
  if (spend.deny) return true;
  return spend.spent + reservationFor(s, tenantId) + reserveCents > effectiveCapCents(s, tenantId, cfg);
}

// Diagnose-Snapshot der TENANT-Achse (P5a): Decke, Ist-Verbrauch und freier Rest in
// GANZZAHL Cents aus DERSELBEN Quelle wie die Gate-Praedikate (effectiveCapCents,
// usageFor, reservationFor). REIN LESEND: kein Praedikat, keine Entscheidung -
// budgetExceeded/reserveExceedsBudget bleiben unveraendert die einzigen Gate-Fragen.
// spentCents/remainingCents sind null, wenn der Bucket unbuchbar ist (D7); der Aufrufer
// (outbound-gates.js) rendert dann KEINE Zahl, sondern einen ziffernfreien Sperrtext.
// remainingCents zieht die bereits gebuchte In-Flight-Reserve ab (reservationFor) - der
// "freie Rest" schliesst laufende Calls mit ein, wie reserveExceedsBudget es tut, und
// kann bei bereits ueberreservierten Buckets legitim NEGATIV sein (kein D7-Fall, s.
// outbound-gates.js tenantReserveDenial).
// Bewusst NICHT ueber tenantSpendOrDeny: dessen denyCorruptUsage-Log gehoert an die
// GATE-Kante, nicht an eine Anzeige, die /api/state bei jedem Dashboard-Poll aufruft
// (sonst Log-Flut bei einem dauerhaft vergifteten Bucket).
export function tenantBudgetSnapshot(s, tenantId, cfg) {
  const capCents = effectiveCapCents(s, tenantId, cfg);
  const spent = usageFor(s, tenantId).costCents;
  if (!isBookableCents(spent)) return { capCents, spentCents: null, remainingCents: null };
  return { capCents, spentCents: spent, remainingCents: capCents - spent - reservationFor(s, tenantId) };
}

// Setzt/aktualisiert die per-Tenant-Kostendecke (P6b3). Upsert ueber tenantId
// (eine Zeile pro Tenant). budgetCents = weiches Inklusiv-Kontingent (Billing-
// Anzeige), hardCapCents = harte Call-Sperre (budgetExceeded). Reine Mutation,
// kein IO. Money als GANZZAHL Cents (G26). Liefert die Zeile.
export function setTenantBudget(s, tenantId, { budgetCents, hardCapCents }) {
  const existing = tenantBudgetRow(s, tenantId);
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
export function aiCostCents(tokens, cfg) {
  return Math.round(tokenCostUsd(tokens, cfg) * cfg.usdToEur * CENTS_PER_EUR);
}

// Append-only Usage-Ledger-Eintrag (P6b3, Stripe-Meter-Quelle). NIE mutiert
// (nur stripeMeterSent flippt beim Flush). costCents als GANZZAHL Cents (G26).
// kind aus USAGE_EVENT_KIND (fail-closed: unbekanntes kind wirft). callId
// optional (number_month-Meter hat keinen Call). numberId optional - nur der
// number_month-Meter traegt sie, sie ist dort der Idempotenz-Anker der Monatsmiete
// (P5/GAP-06, numbersDueForMonthMeter). occurredAt optional: der Aufrufer reicht
// SEINE Uhr durch, wenn Faelligkeits-Pruefung und Buchung dieselbe Monatsgrenze
// sehen muessen (sonst faellt ein Monat zwischen zwei Uhren durch); ohne Argument
// unveraendert new Date(). Liefert den Eintrag.
export function recordUsageEvent(
  s,
  {
    tenantId,
    callId = null,
    numberId = null,
    kind,
    quantity,
    costCents,
    occurredAt = new Date().toISOString(),
  },
) {
  if (!Object.values(USAGE_EVENT_KIND).includes(kind))
    throw new Error(`recordUsageEvent: unbekanntes kind '${kind}'`);
  const event = {
    id: newId("ue"),
    tenantId,
    callId,
    numberId,
    kind,
    quantity,
    costCents,
    occurredAt,
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

// GAP-06 (P5): welche AKTIVEN Nummern haben im UTC-Kalendermonat von nowIso noch keinen
// number_month-Beleg? DIE eine Idempotenz-Entscheidung der DID-Monatsmiete (G5/G31) -
// beide Ausloeser (Abo-Verlaengerung, stuendlicher Sweep) fragen ueber DIESE Funktion,
// keiner haelt eine eigene Kopie der Regel.
//
// ANKER IST DIE NUMMER, NICHT DER TENANT: eine Zaehlung je Tenant erzeugt bei zwei
// Nummern, von denen eine keinen gelernten Preis hat, eine echte DOPPELBUCHUNG der
// anderen. Belege ohne numberId (Bestand von vor P5) koennen keiner Nummer zugeordnet
// werden und sperren deshalb nichts - sie werden ignoriert.
//
// Zeit-frei wie voiceMinutesUsedSince: nowIso kommt vom Aufrufer. Unlesbare Uhr -> LEER
// (fail-closed: eine kaputte Uhr bucht nichts, statt jeden Lauf neu zu buchen).
// tenantId gesetzt -> nur dieser Tenant (Abo-Ereignis); null -> alle (Sweep). Nur ACTIVE:
// eine gekuendigte/freigegebene Nummer erzeugt keine Miete mehr. Reine Query, kein IO.
export function numbersDueForMonthMeter(s, { nowIso, tenantId = null }) {
  const monthKey = spendMonthKeyOf(nowIso);
  if (!monthKey) return [];
  const gebucht = new Set();
  for (const e of s.usageEvents) {
    if (e.kind !== USAGE_EVENT_KIND.NUMBER_MONTH) continue;
    if (!e.numberId) continue;
    if (spendMonthKeyOf(e.occurredAt) !== monthKey) continue;
    gebucht.add(e.numberId);
  }
  return s.numbers.filter(
    (n) =>
      n.status === NUMBER_STATUS.ACTIVE &&
      (tenantId === null || n.tenantId === tenantId) &&
      !gebucht.has(n.id),
  );
}

// Minuten-Kontingent-Gate-Praedikat (B1b, GAP B): sind die im laufenden Abrechnungs-
// fenster verbrauchten Voice-Minuten >= dem Plan-Kontingent? Geschwister zu
// budgetExceeded (reine, IO-freie Query), aber auf der MINUTEN-Quelle
// (voiceMinutesUsedSince), NICHT auf usageFor/costCents (keine Achsen-Vermischung,
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

// Liest den Gate-Verbrauch der Plattform (ueber gatePlatformUsageCents) + wendet den
// D7-Riegel an (G5-Review-Fix Runde 1, Geschwister zu tenantSpendOrDeny): beide teilen
// sich seit P7 den gemeinsamen spendOrDeny-Rumpf oben statt ihn wortgleich zu duplizieren.
function globalSpendOrDeny(s, cfg, nowIso) {
  return spendOrDeny({
    label: "plattform",
    gateCents: gatePlatformUsageCents(s, cfg, nowIso),
    lifetimeCents: globalUsageTotals(s).costCents,
  });
}

// Globaler Budget-Notaus (Plattform-Cap, R2): Gate-Verbrauch der Plattform (gatePlatform-
// UsageCents) gegen config.billing.platformSpendCapCents. Bleibt PARALLEL zum pro-Tenant-
// Budget bestehen (Schnittmenge, beide fail-closed). Fuer owner-only faellt die Summe mit
// dem Owner-Bucket zusammen -> byte-identisch zum Bestand bei Flag AUS. Wird NIE entfernt.
// Rein Integer Cents-gegen-Cap (P1, bit-identisch zum frueheren Float-Gate bei
// ganzzahligem Cap, s. budgetExceeded).
export function globalBudgetExceeded(s, cfg, nowIso) {
  const spend = globalSpendOrDeny(s, cfg, nowIso);
  if (spend.deny) return true;
  return spend.spent >= globalCapCents(cfg);
}

// ---- Reserve-Ledger (OUT-05): atomare In-Flight-Reservierung ----
// s.reservations (tenantId -> GANZZAHL Cents) haelt die noch nicht abgerechneten
// Worst-Case-Kosten laufender Outbound-Calls, damit der Budget-Gate (Tenant UND global,
// Schnittmenge, Regel 1) auch WAEHREND eines Calls den kumulierten Verbrauch sieht. Der
// settled-Bucket (usageFor.costCents, gefuellt erst bei Call-Ende) bleibt UNVERAENDERT und
// PARALLEL. Strukturell ephemer (nie persistiert/hydriert).

// Reserve EINES Tenants (reine Query). Fehlender Eintrag -> 0.
export function reservationFor(s, tenantId) {
  return s.reservations[tenantId] || 0;
}

// Plattform-Summe aller In-Flight-Reserven (globale Achse, reine Query).
export function reservationsTotal(s) {
  return Object.values(s.reservations).reduce((sum, cents) => sum + cents, 0);
}

// Globaler Reserve-Notaus (R2, reserve-bewusst): wuerde reserveCents zusaetzlich zum
// Gate-Verbrauch der Plattform + ALLEN In-Flight-Reserven den globalen Cap ueberschreiten?
// Schliesst die reserve-blinde Luecke in globalBudgetExceeded (das nur settled/Monat prueft).
// Reine Query, kein IO. P1: rein Integer Cents (settled Sub-Cent-Rest an dieser
// Vergleichskante geflooert, s. reserveExceedsBudget).
export function globalReserveExceedsBudget(s, reserveCents, cfg, nowIso) {
  const spend = globalSpendOrDeny(s, cfg, nowIso);
  if (spend.deny) return true;
  return spend.spent + reservationsTotal(s) + reserveCents > globalCapCents(cfg);
}

// Atomare Check+Reserve (Schnittmenge Tenant UND global, Regel 1). REIN SYNCHRON, KEIN
// await zwischen Check und Increment -> unter store.withStoreLock (server.js, F2) echt
// atomar (keine TOCTOU). Bucht reserveCents auf s.reservations[tenantId], wenn WEDER die
// pro-Tenant- NOCH die globale reserve-bewusste Decke reisst; eine abgelehnte Reserve
// hinterlaesst KEINEN Schreibeffekt. Nebeneffekt im Namen (N7). Liefert true=reserviert
// (Dial erlaubt) / false=abgelehnt (402 vor Dial). Fail-closed (S1-6, Absolute Regel 1):
// ein unbuchbarer reserveCents darf den Reserve-Ledger NIE senken. Frueher stand hier eine
// direkte negierte reserveCents-Vorzeichenpruefung inline; sie fragt jetzt dieselbe EINE
// Quelle wie alle anderen Geld-Kanten (isBookableCents, D7/G5) und schliesst dabei die
// Luecke bei einem positiven Unendlich-Wert, den die alte Pruefung durchliess.
export function tryReserveOutboundBudget(s, tenantId, reserveCents, cfg, nowIso) {
  if (!isBookableCents(reserveCents)) return false;
  if (
    reserveExceedsBudget(s, tenantId, reserveCents, cfg, nowIso) ||
    globalReserveExceedsBudget(s, reserveCents, cfg, nowIso)
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

// ---- Plattform-Fruehwarnung (Budget-Achsen P6) ----
// Meldet - GENAU EINMAL pro Spend-Monat - dass die Plattform-Summe eine konfigurierbare
// Warnschwelle ueberschritten hat, BEVOR der Notaus (globalBudgetExceeded/
// globalReserveExceedsBudget) tatsaechlich blockt. AENDERT KEINE GATE-ENTSCHEIDUNG: die
// Praedikate oben bleiben unangetastet und nebeneffektfrei (reine Query, kein IO - s. deren
// eigene Modul-Doku). Der Emissionsort (Audit/SMS) ist NICHT hier, sondern im
// reserve_budget-Gate (outbound-gates.js), NACH einer erfolgreichen Reservierung.

const PERCENT_SCALE = 100; // G25: Prozent -> Ganzzahl-Vergleich ohne Fliesskomma

// Ganzzahl-Prozent-Schwelle ohne Fliesskomma (ueber PERCENT_SCALE, G25/G26): liegt value
// bei/ueber percent Prozent von base? !(percent > 0) faengt 0 (dokumentierter Aus-Sentinel),
// negative und fehlende Werte in EINER Bedingung -> false (Schwelle AUS); die Abweichung
// geht immer Richtung Bestand (kein Alarm), nie Richtung Falschalarm. EINE Vergleichsregel
// fuer BEIDE Prozent-Schwellen des Moduls (G5): die Plattform-Spend-Warnung
// (claimPlatformSpendWarning) UND das ElevenLabs-Kontingent (recordTtsCharacters, LCT P7).
// Reine Funktion.
function scaledThresholdCrossed(value, base, percent) {
  if (!(percent > 0)) return false;
  return value * PERCENT_SCALE >= base * percent;
}

// Plattform-Ist (Gate-Verbrauch + In-Flight) - DIESELBE Groesse, die
// globalReserveExceedsBudget gegen den Cap haelt (kein zweiter Wahrheitsanker; P7: die
// Warnung folgt damit automatisch der Gate-Achse - Lebenszeit bei Flag AUS, Spend-Monat
// bei Flag AN - statt nach dem Flip dauerhaft auf der abgeschalteten Lebenszeit-Achse
// falsch zu alarmieren). Bewusst NICHT ueber globalSpendOrDeny: dessen denyCorruptUsage-
// Log gehoert an die GATE-Kante, nicht an eine Beobachtung (identische Begruendung wie
// bei tenantBudgetSnapshot). Reine Query.
function platformSpendObservedCents(s, cfg, nowIso) {
  const total = gatePlatformUsageCents(s, cfg, nowIso) + reservationsTotal(s);
  return isBookableCents(total) ? total : null;
}

// Meldet die Plattform-Warnschwelle GENAU EINMAL pro Spend-Monat (Nebeneffekt im Namen,
// N7 - "claim" wie tryReserveOutboundBudget/releaseOutboundReserve, die ebenfalls mutieren
// UND das Ergebnis melden). Liefert {totalCents, monthKey} beim erstmaligen Ueberschreiten,
// sonst null. nowIso kommt vom Aufrufer (state-ops bleibt zeit-frei, Muster
// spendMonthUsageCents).
export function claimPlatformSpendWarning(s, cfg, nowIso) {
  const totalCents = platformSpendObservedCents(s, cfg, nowIso);
  if (totalCents === null) return null; // korrupter Verbrauchszaehler -> stumm (Gate-Kante loggt)
  if (!scaledThresholdCrossed(totalCents, globalCapCents(cfg), cfg.platformSpendWarnPercent)) return null;
  const monthKey = spendMonthKeyOf(nowIso);
  // Unlesbarer Anker -> melden, aber KEINEN Marker setzen: ein gespeichertes null wuerde
  // beim naechsten Mal als null===null "schon gemeldet" gelesen und die Warnung DAUERHAFT
  // verschlucken. Zu laut ist erlaubt, stumm nie.
  if (monthKey === null) return { totalCents, monthKey };
  if (s.platformSpendWarnedMonth === monthKey) return null;
  s.platformSpendWarnedMonth = monthKey;
  return { totalCents, monthKey };
}

// ---- ElevenLabs-Kontingent-Zaehler (LCT P7) ----
// Globaler, nicht-tenant-scoped Zeichenzaehler ueber den Play-TTS-Vorab-Synthese-Pfad
// (src/tts/directive-synth.js). REINE SICHTBARKEIT: kein Gate/Reserve/Buchung liest diese
// Achse - die Zahlen dienen ausschliesslich dem Anzeige-Endpunkt (GET /api/billing/
// platform-costs).

// GAP-09: reservierter Kostentraeger des Play-TTS-Pfads. Der Zaehl-Seam der Store-Fassade
// (recordTtsCharacters(chars, nowIso)) hat KEINE Tenant-Dimension - der Verbrauch war damit
// plattformweit gebucht und KEINEM Kostentraeger zugeordnet (eine Kostenstelle ohne
// Kostentraeger). Jedes plattformweit gebuchte Zeichen landet deshalb zusaetzlich auf
// diesem einen reservierten Bucket; strukturell gilt ab jetzt
// Summe(usage[*].ttsCharacters) >= platformTtsUsage.characters.
// Der Doppelpunkt haelt den Schluessel kollisionsfrei gegen jede echte tenantId
// (BOOTSTRAP_TENANT_ID "owner" / newId("t")). Es ist KEIN Tenant: er steht nicht in
// s.tenants, wird also weder vom pg-Flush (der ueber state.tenants laeuft) noch von einer
// Tenant-Projektion beruehrt; alle Geldfelder des Buckets bleiben 0, weshalb
// globalUsageTotals/platformSpendMonthCents byte-identisch bleiben.
// Die echte Pro-Tenant-Aufteilung des Play-TTS-Pfads verlangt eine Signatur-Erweiterung
// der Store-Fassade und ist damit Folgearbeit.
export const PLATFORM_TTS_COST_CENTER_ID = "platform:play-tts";

// EINE Regel fuer "ElevenLabs-Kontingent erschoepft" (G5): der Vorab-Riegel in
// tts/directive-synth.js prueft damit die Leseprojektion platformTtsUsageView, der
// Nach-Buchungs-Riegel in recordTtsCharacters denselben Ausdruck gegen den Stand VOR der
// Buchung. quota <= 0 = kein Kontingent hinterlegt -> nie erschoepft (derselbe
// Aus-Sentinel wie warnPercent=0 in scaledThresholdCrossed; die Abweichung geht immer
// Richtung Bestand). Reine Funktion ueber die Projektionsform {characters, quota}.
export function ttsQuotaExhausted({ characters, quota }) {
  return quota > 0 && characters >= quota;
}

// Zyklus-Schluessel des ElevenLabs-Kontingents ('YYYY-MM'). Anker = anchorDay (Tag im
// Monat, aus config.billing.ttsQuotaCycleAnchorDay): ab anchorDay laeuft der aktuelle
// Monat als Schluessel, DAVOR gilt noch der VORmonat -> der Reset faellt auf den
// ElevenLabs-Zyklus-Tag, NICHT den Kalender-Monatsersten (anders als spendMonthKeyOf).
// Unlesbares nowIso -> null (der Aufrufer behandelt das ueber laterMonotonicKey
// fail-closed, kein Reset). Reine Funktion.
function ttsCycleKeyOf(nowIso, anchorDay) {
  const at = parseValidDate(nowIso);
  if (at === null) return null;
  const anchored = new Date(at.getTime());
  if (at.getUTCDate() < anchorDay) anchored.setUTCMonth(anchored.getUTCMonth() - 1);
  return yearMonthKey(anchored);
}

// Der autoritative Zyklus-Schluessel des ElevenLabs-Zaehlers zum Zeitpunkt nowIso: der
// SPAETERE aus gespeichertem und laufendem Zyklus-Schluessel ueber laterMonotonicKey
// (dieselbe Monotonie-/Zukunftsschluessel-Regel wie die Spend-Monat-Achse, G5 - Muster
// spendMonthWindowKey). EINE Stelle, die den Schluessel zusammensetzt: der Schreiber
// recordTtsCharacters UND die Leseprojektion platformTtsUsageView beziehen ihn NUR
// darueber, damit Leser und Schreiber garantiert denselben Zyklus sehen. Reine Funktion.
function ttsCycleWindowKey(row, cfg, nowIso) {
  return laterMonotonicKey(row.cycleKey, ttsCycleKeyOf(nowIso, cfg.ttsQuotaCycleAnchorDay));
}

// Verbucht erfolgreich an ElevenLabs gesendete Zeichen auf dem globalen Zaehler UND auf dem
// reservierten Kostentraeger (GAP-09), und meldet die Warnschwelle GENAU EINMAL je Zyklus
// (Muster claimPlatformSpendWarning). nowIso kommt vom Aufrufer (state-ops bleibt zeit-frei).
// Liefert {changed, warning}; warning ist eine unterschiedene Union:
//   {characters, quota, cycleKey}                  = Warnschwelle (genau einmal je Zyklus, Alarm-Pflicht)
//   dieselben Felder + exhausted:true              = Kontingent erschoepft (jede Buchung, Riegel-Pflicht, KEIN Alarm)
//   null                                           = nichts zu melden
// Ganzzahl-Arithmetik durchweg (G26); Zukunfts-/Unlesbar-Riegel ueber laterMonotonicKey
// (dieselbe Regel wie die Spend-Monat-Achse, G5).
export function recordTtsCharacters(s, chars, cfg, nowIso) {
  const row = s.platformTtsUsage;
  const key = ttsCycleWindowKey(row, cfg, nowIso);
  if (key === null) return { changed: false, warning: null }; // kein Anker je gestempelt UND Uhr unlesbar -> No-op
  const charactersBefore = key !== row.cycleKey ? 0 : row.characters; // Rollover startet frisch
  row.characters = charactersBefore + chars;
  row.cycleKey = key;
  // GAP-09: derselbe Betrag zusaetzlich auf den reservierten Kostentraeger - ueber die
  // BESTEHENDE Erhoehungsregel (G5: recordTenantTtsCharacters bringt die Ganzzahl-/<=0-
  // Riegel schon mit). Lebenszeit-Summe wie dort; nach einem Zyklus-Rollover liegt die
  // Bucket-Summe damit UEBER dem Zyklus-Zaehler - "deckt" ist >=, nicht ==.
  recordTenantTtsCharacters(s, PLATFORM_TTS_COST_CENTER_ID, chars);
  const notice = { characters: row.characters, quota: cfg.ttsCharacterQuota, cycleKey: key };
  // GAP-09: war das Kontingent schon VOR dieser Buchung erschoepft, ist diese Buchung reine
  // Overage -> eigene Meldeform (Marker exhausted), damit der Play-TTS-Pfad auf Azure-<Say>
  // degradieren kann (Degradation, KEINE Sperre - ein Anruf ohne Stimme ist der schlimmere
  // Ausgang). Bewusst der Stand VORHER: der Aufruf, der die Wand durchbricht, ist bereits
  // bezahlt und behaelt sein Audio; erst der naechste degradiert. Diese Meldung ist
  // ABSICHTLICH nicht warn-once (der Riegel braucht sie bei JEDEM Aufruf) - der Aufrufer
  // alarmiert deshalb nicht ueber sie, sondern loggt (sonst eine SMS je Turn).
  if (ttsQuotaExhausted({ characters: charactersBefore, quota: cfg.ttsCharacterQuota }))
    return { changed: true, warning: { ...notice, exhausted: true } };
  const crossed = scaledThresholdCrossed(row.characters, cfg.ttsCharacterQuota, cfg.ttsCharacterQuotaWarnPercent);
  if (crossed && row.warnedCycle !== key) {
    row.warnedCycle = key; // Warnschwelle: GENAU EINE Meldung je Zyklus, Form unveraendert (3 Felder)
    return { changed: true, warning: notice };
  }
  return { changed: true, warning: null };
}

// Reine Leseprojektion fuer den Anzeige-Endpunkt (kein Gate). Zyklus-korrekt: nach einem
// Rollover wird 0 gezeigt, OHNE die Zeile zu mutieren (Muster spendMonthUsageCents/
// spendMonthWindowKey - Leser und Schreiber teilen sich denselben autoritativen
// Schluessel ueber laterMonotonicKey).
export function platformTtsUsageView(s, cfg, nowIso) {
  const row = s.platformTtsUsage;
  const key = ttsCycleWindowKey(row, cfg, nowIso);
  const characters = key === row.cycleKey ? row.characters : 0;
  return { characters, quota: cfg.ttsCharacterQuota, warnPercent: cfg.ttsCharacterQuotaWarnPercent, cycleKey: key };
}

// ---- ElevenLabs-Zeichen PRO TENANT (KE-P6) ----
// Verbucht die Zeichen EINES abgeglichenen Calls auf dem Tenant-Bucket. Bewusst OHNE Zyklus
// und OHNE Warnschwelle: die Zyklus-/Kontingent-Logik gehoert dem PLATTFORM-Zaehler
// (recordTtsCharacters darueber, EIN ElevenLabs-Konto). Hier ist die Frage eine andere -
// "welcher Tenant verbraucht wie viel" - und dafuer ist die Lebenszeit-Summe (wie
// usage.calls) die einfachste funktionsfaehige Form (P15). Ganzzahl-Arithmetik (G26).
// Nicht-ganzzahlig/<=0 -> No-op, KEIN Wurf: der Aufrufer ist ein Sweep, der nie abbrechen darf.
// Liefert {changed} wie recordTtsCharacters, damit die Fassaden nur bei echter Aenderung
// speichern.
export function recordTenantTtsCharacters(s, tenantId, chars) {
  if (!Number.isSafeInteger(chars) || chars <= 0) return { changed: false };
  usageFor(s, tenantId).ttsCharacters += chars;
  return { changed: true };
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
// Loescht beendete Calls (samt Transkript), Notifications und ERLEDIGTE Action Items,
// die aelter als `days` sind. Aktive Calls und offene Action Items bleiben immer
// erhalten. days <= 0 schaltet diesen Durchgang ab. (Bisheriger pruneOldData-Rumpf,
// unveraendert - nur benannt und aus der Komposition herausgezogen.)
function pruneExpiredRecords(s, days) {
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

// Zweiter, STRENGERER Retention-Durchgang (P2b): loescht die Roh-Transkripte beendeter
// Diagnose-Calls, die aelter als `days` sind. Der CALL-RECORD bleibt stehen (er faellt
// erst ueber die lange RETENTION_DAYS-Frist) - genau das macht die kuerzere Frist zur
// bindenden. Reine Mutation, kein IO; liefert die Zahl geleerter Transkripte.
//
// BEWUSSTE ASYMMETRIE zu pruneExpiredRecords: dort heisst days<=0 "Retention aus" (alles
// bleibt), hier heisst 0 "Feature aus" (cutoff = jetzt -> jedes beendete Diagnose-
// Transkript faellt). Nur diese Richtung ist fail-closed: DIAGNOSTIC_RETENTION_DAYS=0
// darf nicht in unbegrenzte Rohdaten kippen. Negative Werte kann config nicht liefern
// (numEnv min:0) und werden zusaetzlich geklemmt. Das Leeren selbst laeuft ueber
// purgeTranscript - EINE Mutationsquelle (G5), kein zweites `call.transcript = []`.
export function purgeExpiredDiagnosticTranscripts(s, days) {
  const cutoff = new Date(Date.now() - Math.max(days, 0) * MS_PER_DAY).toISOString();
  let purged = 0;
  for (const call of s.calls) {
    if (call.diagnostic !== true || !call.endedAt || call.endedAt >= cutoff) continue;
    if (purgeTranscript(s, call.id)) purged++;
  }
  return purged;
}

// Die EINE Retention-Fassade beider Backends: Record-Durchgang (lange Frist) plus
// Diagnose-Transkript-Durchgang (kurze Frist). Benannte Optionen statt zweier
// gleichartiger Zahlen-Positionen - 30 und 7 nebeneinander sind nicht
// verwechselungssicher (F1/G25).
export function pruneOldData(s, { retentionDays, diagnosticRetentionDays }) {
  const removed = pruneExpiredRecords(s, retentionDays);
  // Laeuft UNABHAENGIG von retentionDays: eine abgeschaltete Record-Retention
  // (RETENTION_DAYS=0, u.a. der Test-Default in BASE_ENV) darf die kuerzere
  // Diagnose-Frist NICHT mit abschalten - sonst laege genau das Roh-Transkript am
  // laengsten, das am kuerzesten liegen soll.
  removed.diagnosticTranscripts = purgeExpiredDiagnosticTranscripts(s, diagnosticRetentionDays);
  return removed;
}

// Hat ein pruneOldData-Lauf irgendetwas veraendert? EINE Quelle fuer die save()-Bedingung
// BEIDER Backends und die Log-Bedingung in boot.js. Vorher stand dieselbe OR-Kette
// dreimal - ein dort vergessener neuer Zaehler haette einen Purge still nicht persistiert
// (Datenverlust-Klasse, G5/S2).
export function hasPrunedSomething(removed) {
  return Object.values(removed).some((n) => n > 0);
}

// ---- Settings ----
// Liefert den Settings-Bucket eines Tenants und LEGT IHN BEI BEDARF AN (Lazy-Init
// als bewusster, dokumentierter Nebeneffekt, analog usageFor). So lebt der
// Map-Zugriff genau einmal (G5). Ein neuer Tenant bekommt frische defaultSettings();
// der Owner ist in der Map vorbelegt.
export function settingsFor(s, tenantId) {
  return (s.settings[tenantId] ||= defaultSettings());
}

// Loest einen optionalen Enum-Override (language, agentStyle) auf seine KANONISCHE Form
// auf. null/"" = Override zuruecksetzen (gespeichert wird null - EINE Form fuer "nicht
// gesetzt"). Sonst muss der Wert ein String sein, der - Gross-/Kleinschreibung ignoriert -
// in der kuratierten Whitelist steht; zurueck kommt IMMER der Eintrag aus der Whitelist,
// nie die Nutzer-Schreibweise. LANG-19/E1: "EN" ist kein Nutzerfehler, sondern nur eine
// Schreibweise von "en" - stilles Verwerfen ist Datenverlust. Fail-closed bleibt
// fail-closed: alles, was nicht case-insensitiv trifft (Freitext/PII/Impersonation), wird
// weiterhin verworfen. Der generische typeof-Vergleich greift hier nicht, weil der Default
// null ist (typeof null === "object" wuerde jeden gueltigen String-Patch ablehnen). EINE
// Quelle (G5) fuer beide Enum-Felder. Reine Funktion.
function resolveOptionalEnumOverride(value, allowedValues) {
  if (value === null || value === "") return { accepted: true, value: null };
  if (typeof value !== "string") return { accepted: false, value: null };
  const canonical = allowedValues.find((allowed) => allowed.toLowerCase() === value.toLowerCase());
  return canonical === undefined ? { accepted: false, value: null } : { accepted: true, value: canonical };
}

// Optionale Enum-Override-Felder (Default null): eigene fail-closed Katalog-Validierung
// statt typeof, case-insensitiv normalisierend (LANG-19). language gegen
// SUPPORTED_LANGUAGES, agentStyle (P2) gegen PERSONA_STYLE_IDS (kuratierte Stil-IDs,
// NON-PII). "" und null = zuruecksetzen auf "nicht gesetzt".
const OPTIONAL_ENUM_FIELDS = Object.freeze({
  language: SUPPORTED_LANGUAGES,
  agentStyle: PERSONA_STYLE_IDS,
});

// Wert-Pruefungen jenseits von Typ/Enum. greeting: der Inbound-Pflichtsatz (GAP-14/O7)
// darf nicht wegeditiert werden. SELEKTIV - nur dieses Feld faellt, der uebrige Patch
// laeuft durch (ein Bestandskunde muss seinen agentName aendern koennen, auch wenn sein
// Greeting den Marker nicht traegt). Bestand wird EINMALIG migriert, nicht je Write.
const FIELD_GUARDS = Object.freeze({ greeting: hasInboundNotice });

// Whitelist gegen die Default-Settings: nur bekannte Keys mit passendem Typ.
// Unbekannte Keys / falsche Typen werden ignoriert - POST /api/settings kann
// so keine fremden Felder in den Store schreiben oder Typen kippen. Optionale Enum-
// Overrides (language, agentStyle) haben eine eigene fail-closed Katalog-Validierung
// (siehe OPTIONAL_ENUM_FIELDS / resolveOptionalEnumOverride) statt des typeof-Checks.
// Liefert auch die uebernommenen Keys (fuers Audit-Log in server.js).
export function updateSettings(s, tenantId, patch) {
  const allowed = defaultSettings();
  const changed = [];
  const target = settingsFor(s, tenantId);
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in allowed)) continue;
    const enumValues = OPTIONAL_ENUM_FIELDS[key];
    if (enumValues) {
      const override = resolveOptionalEnumOverride(value, enumValues);
      if (!override.accepted) continue;
      target[key] = override.value; // kanonisch (Whitelist-Schreibweise) bzw. null
      changed.push(key);
    } else if (typeof value === typeof allowed[key]) {
      const guard = FIELD_GUARDS[key];
      if (guard && !guard(value)) continue; // selektiv verworfen, Patch laeuft weiter
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
// Defensiver In-Memory-Index-Accessor (Muster tenantsOf): seedState-/Legacy-Stores ohne
// subIndex -> leeres Objekt, kein Crash.
const subIndexOf = (s) => s.subIndex || {};

// Bindet einen OIDC-sub im Resolver-Index an seinen (kanonischen) Tenant (tenant-prolif-b).
// Nebeneffekt im Namen (N7). Rein In-Memory, KEIN IO/Flush: account persistiert der Web-
// Login-Pfad selbst, der Index wird jeden Boot aus account neu aufgebaut. Leerer sub/tenantId
// -> No-Op (fail-closed, kein Muell-Key). Defensiv (subIndex ||=).
export function bindSubToTenant(s, sub, tenantId) {
  if (!sub || !tenantId) return;
  (s.subIndex ||= {})[sub] = tenantId;
}

export function resolveTenant(s, idpSubject) {
  if (!idpSubject) return null; // leer/null NICHT iterieren -> kein versehentlicher Owner-Fallback
  // Der sub->tenantId-Index hat VORRANG (Invariante tenant-prolif-b: "Index Vorrang oder
  // idp_subject reine Anzeigespalte"): er traegt die per Email-Merge (Phase A) gebundenen
  // Zweit-subs, die NICHT als tenant.idpSubject gespiegelt sind. Index-Miss -> Fallback auf
  // den 1:1-idpSubject-Scan (Owner-Seed/Onboarding/Primaer-Login; unter json der einzige Pfad).
  const merged = subIndexOf(s)[idpSubject];
  if (merged) return merged;
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
