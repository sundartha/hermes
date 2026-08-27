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
  emptyCostCrossCheck,
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
  KEY_FACTS_LIMITS,
  CONSULT_STATUS,
  CONSULT_ANSWER,
  CONSULT_WAIT,
  GLOBAL_CAP_REASON,
  REQUEST_NUMBER_REASON,
  TENANT_STATUS,
  PROVISIONING_JOB_STATUS,
  PROVISION_NUMBER_JOB,
  USAGE_EVENT_KIND,
  CENTS_PER_EUR,
  MICRO_CENTS_PER_CENT,
  TOKENS_PER_M_TOK,
  MODEL_PRICE_RATE_FIELDS,
  isBookableCents,
  isCorrectionCents,
  PROVIDER_RATE_SCALE,
  USAGE_CORRUPT_REASON,
  globalCapCents,
  KYC_LEVEL,
  KYC_ORDER,
  COST_TRUING_SOURCE,
  NUMBER_HOLD_REASON,
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
// Form-Waechter des Join-Schluessels zur Telefonie-Rechnung (s. recordSipCallId unten).
// sip-call-id.js ist ein Blatt-Modul (kein Rueckimport, kein Zyklus), Muster
// number-denylist.js: eine reine Form-Aussage ueber einen Telefonie-Fakt.
import { isTelnyxSipCallId } from "../telephony/sip-call-id.js";
// AL-P11: EINE Mutationsquelle fuer das Entfernen der Ergebnis-Karten-Zitate (G5).
// INBOX-P2: dazu die EINE Aussensicht der Karte (resultCardView) - dieselbe Funktion,
// die das MCP-Werkzeug get_transcript nutzt. Keine zweite Feldliste (G5/S2).
import { stripResultEvidence, resultCardView } from "../call-result.js";
// F2-Newsletter-Recipients: timing-sicherer Token-Vergleich fuer die beiden oeffentlichen
// Token-Scans (confirm/unsubscribe) - Muster call.streamToken-Pruefung in bridge.js.
import { safeEqual } from "../util.js";
// AL-P12: K (=3) lebt im Prompt-Modul, weil dort auch das Zeichenbudget haengt - die
// Query darf nicht mehr Eintraege liefern, als der Prompt je rendern kann (EINE Quelle).
// call-memory.js ist ein Blatt-Modul (kein Rueckimport, kein Zyklus), Muster call-result.js.
import { MEMORY_MAX_CALLS } from "../call-memory.js";

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
    // OUTBOUND-E1: welche Rufnummern die PLATTFORM benutzt und wofuer. GLOBAL (kein
    // Tenant-Scope) - eine Plattform-Nummer kann zu keinem Tenant gehoeren, und ein
    // Tenant-Scope waere genau der Weg, auf dem eine Tenant-Loeschung die Bindung
    // still mitnimmt. released_at === null heisst IN BENUTZUNG.
    // [{ id, e164, purpose, provider, tenantId, providerNumberId, boundAt, releasedAt, note }]
    platformNumberUse: [],
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
    // KV-M4: Riegel der monatlichen Gegenprobe (Muster platformTtsUsage - global, keine
    // Tenant-Dimension). PERSISTIERT (json.js/pg.js), s. emptyCostCrossCheck.
    costCrossCheck: emptyCostCrossCheck(),
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

// Auftrag 2026-08-19 (Thema A, Auflage A6): Fingerabdruck der bei Auftragsannahme
// festgelegten Eroeffnungszeile. HIER berechnet und nicht vom Aufrufer geliefert
// (G27, Struktur statt Konvention): kein Schreibweg kann Zeile und Hash getrennt
// setzen, also faellt am Anrufstart (elevenlabs/opening-line.js#verifiedOpeningLine)
// JEDE nachtraegliche Veraenderung der Zeile auf - genau die Klasse "Treiber
// transliteriert still Umlaute weg", die der Auftrag schliessen will.
export function openingLineHash(line) {
  return crypto.createHash("sha256").update(line, "utf8").digest("hex");
}

export function createCall(
  s,
  {
    direction,
    from,
    to,
    goal,
    openingLine,
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
    calleeIsOwner,
  },
) {
  const call = {
    id: newId("call"),
    // Zugangsgeheimnis fuer den /media-WebSocket (steht im TeXML, das nur der
    // Provider sieht). Wird von der Bridge beim start-Event geprueft und darf NIE ueber
    // die API ausgegeben werden (server.js publicCall).
    streamToken: crypto.randomBytes(16).toString("hex"),
    twilioSid: twilioSid || null,
    // Provider, ueber den dieser Call laeuft (P6a). Inbound: aus dem Signatur-
    // Header abgeleitet (server.js); Outbound: ungesetzt -> DEFAULT_PROVIDER
    // (seit C-P1 Telnyx; der Live-Aufrufer api-calls.js setzt ihn ohnehin explizit
    // aus der Absendernummer). Folge-Webhooks + finishCall lesen call.provider (Single
    // Source of Truth, kein erneutes Header-Parsen).
    provider: provider || DEFAULT_PROVIDER,
    direction, // "inbound" | "outbound"
    from,
    to,
    goal: goal || null,
    // Thema A (2026-08-19): die geprueft-festgelegte Eroeffnungszeile dieses Anrufs
    // plus ihr Annahme-Hash (openingLineHash oben). Additiv nullable - nur der
    // ElevenLabs-Weg befuellt sie, jeder andere Call bleibt null (pg-Parity via
    // rowToCall). Der Hash entsteht ausschliesslich hier, im selben Zug wie die
    // Zeile; wer die Zeile spaeter anfasst, ohne diese Funktion zu kennen, wird am
    // Anrufstart ertappt statt gesprochen.
    openingLine: openingLine || null,
    openingLineSha256: openingLine ? openingLineHash(openingLine) : null,
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
    // KS-EL1: der GRUND, wenn der Buchungsanker NICHT aus der Anbieter-Dauer entstand
    // (elevenlabs/outbound.js, answeredAnchorOutcome) - additiv nullable. S1-B (17.08.2026):
    // gesetzt bei JEDEM solchen Ausgang, auch bei der belegten Nicht-Rufannahme (frueher der
    // einzige stille Fall), weil auch sie nichts bucht - der Wert unterscheidet die Faelle.
    // Initial null - byte-identisch zur pg-Hydrierung (rowToCall), kein json<->pg-Shape-Drift.
    answeredUnclearReason: null,
    endedAt: null,
    transcript: [],
    summary: null,
    objectiveAchieved: null,
    // AL-P11: strukturierte Ergebnis-Karte (outcome/commitments/counterparty_commitments/
    // open_points/next_step/facts, optional evidence). Additiv NULLABLE, gesetzt erst in
    // summarizeCall. Initial null - byte-identisch zur pg-Hydrierung (rowToCall), kein
    // json<->pg-Shape-Drift.
    result: null,
    // AL-P13: Consult-Kette (A2: Zustand am Call). Initial null - byte-identisch zur
    // pg-Hydrierung (rowToCall), kein json<->pg-Shape-Drift.
    consults: null,
    // Thema B (2026-08-19): das Recherche-Protokoll des EL-Wegs (recordCallLookup
    // unten - Auflage B5, traegt zugleich den Deckel). Initial null - byte-identisch
    // zur pg-Hydrierung (rowToCall), kein json<->pg-Shape-Drift.
    lookupLog: null,
    // F2 P9 (M2): persistierter Summary-SMS-Dedup-Marker (ISO-Zeit nach erfolgreichem
    // Send, sonst null). Initial null - byte-identisch zur pg-Hydrierung (rowToCall), kein
    // json<->pg-Shape-Drift. NIE nach aussen (publicCall strippt ihn wie streamToken/_finished).
    summarySmsSentAt: null,
    // F2-Mail: persistierter Dedup-Marker fuer die Call-Summary-Mail (Spiegel
    // summarySmsSentAt, ISO-Zeit nach erfolgreichem Send, sonst null). NIE nach aussen
    // (publicCall strippt ihn wie summarySmsSentAt).
    summaryMailSentAt: null,
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
    // geschrieben von reconcileVoiceBudget im SELBEN Schritt, in dem gebucht wird.
    // NIE spaeter aus tariffCentsPerMin rekonstruiert: der Tarif aendert sich (P4b), die
    // Buchung nicht - eine rekonstruierte Differenz erstattete Geld zurueck, das real
    // ausgegeben wurde, und oeffnete den geteilten Lebenszeit-Topf wieder.
    estimatedCostCents: null,
    // KS-P5: die zwei ACHSEN-ANKER der Belastung - unter WELCHEM Spend-Monat und WELCHEM
    // Perioden-Stempel estimatedCostCents tatsaechlich gebucht wurde. Set-once zusammen
    // mit dem Betrag (recordCallEstimatedCostCents). Ohne sie kann die spaetere Gutschrift
    // nicht unterscheiden, ob sie dieselbe Zahl senkt, die sie erhoeht hat - und weitete
    // sonst eine abgeschlossene Perioden-/Monatsdecke auf (B5). Bestandszeile (vor KS-P5) ->
    // null: die Gutschrift bleibt dann auf der strengsten Achse (Lebenszeit). Inbound
    // traegt die Anker seit KV-P2 wie jeder andere gebuchte Call.
    estimatedCostSpendMonthKey: null,
    estimatedCostPeriodKey: null,
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
    // OC-P1 (PLAN-OWNER-CALL): war das Ziel dieses Outbound die eigene hinterlegte
    // Nummer des ANRUFENDEN Tenants - bei eingeschaltetem Schalter und gepinntem Tenant?
    // Wird AUSSCHLIESSLICH serverseitig gesetzt (src/callee-is-owner.js, ausgewertet in
    // routes/api-calls.js) - nie roh aus dem Request-Body. SET-ONCE: danach schreibt es
    // niemand mehr, damit eine Nummern-Aenderung zwischen Auftragsannahme und Klingeln
    // die Entscheidung nicht mehr kippen kann. `=== true` statt Rohwert: Default false ist
    // NICHT-Owner ist Offenlegung (fail-closed), byte-identisch zur pg-Hydrierung
    // (rowToCall). Auf dem Record steht NUR dieses Boolean, NIE die Nummer.
    calleeIsOwner: calleeIsOwner === true,
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
    // AL-P14: Zeitstempel (ms) des letzten Consult-Polls dieses Calls. EPHEMER wie
    // noSpeechStreak: KEINE pg-Spalte, keine Hydrierung in rowToCall -> nach einem
    // Instanzwechsel gilt fail-closed "kein wartender Client" und das Werkzeug
    // verschwindet, statt in einen sicheren Timeout zu laufen.
    consultPolledAtMs: 0,
    // AL-P1: Telnyx-Conversation-UUID (Latenz-Achse) + purge-fester Anrufer-Turn-Zaehler
    // (Abbruch-Achse). Initial null/0 - byte-identisch zur pg-Hydrierung (rowToCall),
    // kein json<->pg-Shape-Drift.
    telnyxConversationId: null,
    // EL-BL1: die opake Conversation-Kennung des ElevenLabs-Laufwerks. Dasselbe
    // Provider-Handle-Muster wie telnyxConversationId, und der EINZIGE Weg, ueber den
    // der Rueckfrage-Webhook (routes/webhooks-elevenlabs.js) einen laufenden Anruf
    // bindet. Initial null - byte-identisch zur pg-Hydrierung (rowToCall).
    elevenlabsConversationId: null,
    // PHASE-6-VORAUSSETZUNG (Fertig-Punkt 7, "die Kosten sind gemessen, aufgeschluesselt
    // nach ElevenLabs, Sprachmodell und Telefonie"): die SIP-Call-ID des ausgehenden Legs
    // (Form "otb_..."). Der EINZIGE Join zwischen unseren zwei Kostenquellen auf der
    // SIP-Trunk-Strecke - EINE Quelle (metadata.phone_call.call_id beim Ergebnisabruf),
    // Herkunft und Beleg s. elevenlabs/outbound.js#persistProviderResult sowie der
    // Form-Waechter in telephony/sip-call-id.js.
    // Additiv nullable: nur der ElevenLabs-Weg setzt sie, jeder andere Call bleibt null -
    // byte-identisch zur pg-Hydrierung (rowToCall), kein json<->pg-Shape-Drift.
    sipCallId: null,
    // ABNAHME-D1 (Owner-Auftrag: eigene Felder im Ergebnisschema, additiv NEBEN summary/
    // result). Vom Agenten waehrend des Gespraechs STRUKTURIERT gesammelt (ElevenLabs
    // Data Collection, analysis.data_collection_results) statt nur als Freitext in
    // summary zu stecken. FEHLT eine Angabe im Gespraech (kein Termin/kein Betrag
    // verhandelt), ist das der Normalfall - alle vier bleiben dann null, byte-identisch
    // zur pg-Hydrierung (rowToCall), kein json<->pg-Shape-Drift. Praezedenz
    // answeredUnclearReason (additiv-nullables Anruf-Feld durch alle Ebenen).
    appointmentDate: null,
    appointmentTime: null,
    amount: null,
    currency: null,
    // TEIL 3 derselben Eigentuemer-Auflage: die im Gespraech BESTAETIGTE Zeitzone des
    // Angerufenen - NIE eine aus der Vorwahl abgeleitete Hypothese (die bleibt
    // Vermutung, s. calleeTimezoneText in elevenlabs/outbound.js und wird hier
    // ausdruecklich NICHT gespeichert). Herkunft + Zeitstempel reisen IMMER mit dem
    // Wert (nie getrennt gesetzt, s. recordCalleeConfirmedTimezone) - ein blosser
    // Zonenwert ohne Beleg, WOHER er kommt und WANN er bestaetigt wurde, waere nicht
    // nachpruefbar. Initial null - byte-identisch zur pg-Hydrierung.
    calleeConfirmedTimezone: null,
    calleeConfirmedTimezoneOrigin: null,
    calleeConfirmedTimezoneAt: null,
    callerTurns: 0,
    // INBOX-P1: die zwei Inbox-Marker. Initial null - byte-identisch zur pg-Hydrierung
    // (rowToCall), kein json<->pg-Shape-Drift. Muster summarySmsSentAt.
    inboxEntryAt: null,
    inboxSeenAt: null,
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

// GQ-H1-a: Telnyx hat die zuletzt erzeugte Antwort verworfen, bevor sie gesprochen wurde
// (seine gespiegelte Nachrichtenliste ist zwischen zwei Requests nicht gewachsen). Sie darf
// nicht als "bereits gesagt" im Kontext des naechsten Turns, in der Zusammenfassung oder in
// der Nachricht an den Owner stehen - ein Agent, dessen Kontext behauptet, er habe etwas
// gesagt, verhaelt sich zwangslaeufig unsinnig.
//
// Entfernt NUR eine ABSCHLIESSENDE agent-Zeile. Steht dort etwas anderes (caller-Zeile,
// leeres Transkript), passiert nichts: fail-safe-Richtung, lieber eine Zeile zu viel im
// Transkript als eine echte, gesprochene Aeusserung geloescht. Die caller-Zeile des
// verworfenen Turns bleibt bewusst stehen - der Anrufer HAT diese Worte gesagt (sie sind
// ein Praefix der vollstaendigen Aeusserung), sie behauptet also nichts Falsches.
//
// Reine Mutation, kein IO. Liefert true, wenn etwas entfernt wurde -> der Backend-Wrapper
// save()t nur dann.
export function dropLastAgentTranscript(s, callId) {
  const call = getCall(s, callId);
  if (!call || call.transcript.length === 0) return false;
  if (call.transcript[call.transcript.length - 1].role !== "agent") return false;
  call.transcript.pop();
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
// AL-P13: die Consult-Kette geht bewusst mit - sie haengt am Call-Record, und der
// Auskunftsanspruch umfasst die eigenen Rueckfragen (spiegelbildlich zum Erase, das sie
// mit dem Call entfernt).
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

// KS-EL1 (Owner-Entscheidung: answeredAt traegt ZWEI Sachverhalte auf EINEM Feld - "die
// Verbindung steht", gelesen von isInCallConsult/mapStatus, und "ab hier wird bezahlt",
// gelesen von voiceMinutesOf): der Anker NACHZIEHEN, NICHT setzen. Der Stempel am
// Anrufstart (markAnswered, "jetzt") bleibt fuer den ERSTEN Sachverhalt unveraendert
// stehen; diese Operation tauscht ihn am Gespraechsende gegen die ECHTE Rufannahme des
// Anbieters (answeredAtIso, oder null, wenn sie nicht feststeht), NACHDEM endedAt steht und
// BEVOR gebucht wird. Anders als setOnceTimestamp/markAnswered bewusst KEIN set-once: hier
// wird ein VORLAEUFIGER Wert korrigiert, kein leeres Feld erstmalig befuellt.
//
// KORREKTUR 17.08.2026 (unabhaengige Durchsicht): hier stand "der EINZIGE Aufrufer ist
// finishFromConversation ... genau ein Schreiber, genau einmal je Call". Das war schon vor
// dieser Korrektur falsch - geschrieben wird ueber elevenlabs/outbound.js#applyAnsweredAnchor
// aus DREI Pfaden: dem Poll-Ergebnis (finishFromConversation), dem Abbruch-/Kappungs-Pfad
// (endActiveCall) und dem dauerhaften Abruf-Fehler (finishOnPermanentError). Ein Call kann
// die Funktion damit MEHRFACH sehen (z.B. Poll gibt auf -> terminateAndBillCall -> hangUp ->
// endActiveCall holt das Ergebnis doch noch).
//
// changed unbedingt true TRAEGT das trotzdem (Muster recordProviderCallResult), denn es
// heisst nicht "es gibt nur einen Schreiber", sondern "es WURDE geschrieben, also
// persistieren": die Zuweisung findet bei jedem Aufruf mit existierendem Call statt, ein
// zweiter Aufruf ueberschreibt bewusst (LETZTE Erkenntnis gewinnt - der spaetere Pfad hat
// den frischeren Anbieter-Stand), und ein fehlender Call liefert weiterhin changed:false.
// Ein zusaetzliches Speichern bei gleichem Wert ist folgenlos.
// Zustand ausgeschrieben (state statt s): eine neue einbuchstabige Kennung haette die
// bestehende, im Bestand eingefrorene id-length-Ausnahme dieser Datei ueberschritten
// (eslint-suppressions.json: exakter Zaehler, keine Toleranz nach oben) und damit
// zusaetzliche, neue Verstoesse verdeckt statt sie zu vermeiden.
export function trueUpAnsweredAt(state, callId, answeredAtIso) {
  const call = getCall(state, callId);
  if (!call) return { call: null, changed: false };
  call.answeredAt = answeredAtIso;
  return { call, changed: true };
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
    // AL-P13: ein Anruf, der vorbei ist, hat keine offenen Rueckfragen mehr. HIER, weil
    // dies der EINE Punkt ist, an dem ein Call terminal wird (endCallRecord delegiert
    // hierher) - ein zweiter Ablauf-Sweep waere eine zweite Wahrheit (G5).
    expireOpenConsults(s, callId);
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

// F2-Mail: persistierter Dedup-Marker fuer die Call-Summary-Mail (Spiegel
// markSummarySmsSent). Set-once via setOnceTimestamp (gesetzter Marker gewinnt); Wrapper
// saved bei changed.
export function markSummaryMailSent(s, callId) {
  return setOnceTimestamp(getCall(s, callId), "summaryMailSentAt");
}

// F9 (A6): persistierter Bucht-Marker. Set-once via setOnceTimestamp (gesetzter gewinnt):
// ein verspaeteter /voice/status-Retry NACH einem Restart findet den Marker und bucht die
// Voice-Minuten NICHT erneut. Wrapper saved bei changed.
export function markBilled(s, callId) {
  return setOnceTimestamp(getCall(s, callId), "billedAt");
}

// INBOX-P1: Qualifikations-Marker. qualifies=false -> No-op.
export function markInboxEntry(state, callId, qualifies) {
  if (!qualifies) return { call: null, changed: false };
  return setOnceTimestamp(getCall(state, callId), "inboxEntryAt");
}

// INBOX-P2 (E-5): die Aussensicht EINES Inbox-Eintrags. Whitelist, nicht Blacklist -
// was hier nicht steht, verlaesst den Server nicht. Rein: kein Store-Zugriff, kein IO,
// keine Zeit; die offenen Nachrichten kommen als fertige Textliste herein, damit die
// Projektion testbar bleibt, ohne einen Zustand zu bauen.
// Die fuenf Karten-Felder werden GESPREADET (nie kopiert): resultCardView ist die EINE
// Quelle, die auch get_transcript benutzt. Kein transcript, kein facts, kein evidence.
// summary_unavailable trennt "der Tenant will keine Nachbereitung" (dann entsteht gar
// kein Eintrag, Praedikat-Bedingung 4) von "die Zusammenfassung ist technisch
// gescheitert" (Eintrag mit summary null) - E-2, Pre-Mortem R-1.
// action_required haengt ALLEIN an offenen Nachrichten dieses Anrufs: next_step und
// open_points sind in realen Karten fast immer gefuellt, ein daraus abgeleitetes Feld
// waere konstant true und damit wertlos (R-7).
export function inboxEntryView(call, actionItemTexts) {
  const summary = call.summary ?? null;
  return {
    call_id: call.id,
    caller: call.from ?? null,
    started_at: call.startedAt ?? null,
    summary,
    summary_unavailable: summary === null,
    ...resultCardView(call.result),
    action_items: actionItemTexts,
    action_required: actionItemTexts.length > 0,
  };
}

// Die noch OFFENEN Nachrichten eines Anrufs als reine Texte. Kennungen gehen bewusst
// NICHT mit (F-7): der Assistent kann sie nicht abhaken, also waeren sie nur ein
// zusaetzliches Handle auf fremde Gespraechsinhalte.
function openActionItemTexts(state, callId) {
  return callActionItems(state, callId)
    .filter((item) => !item.done)
    .map((item) => item.text);
}

// INBOX-P2, das Herzstueck (E-3b/R-4): Auswahl, Projektion UND Als-gesehen-Markierung
// sind EINE synchrone Operation. Nicht per Kommentar verboten, sondern strukturell
// unmoeglich: zwischen Auswahl und Markierung passt kein `await`, weil es hier keine
// Naht gibt, an der eines stehen koennte. Damit bekommt beim Wettlauf zweier Sitzungen
// genau EINE die Eintraege - pro Prozess (bei Deploy-Ueberlappung hat jede Instanz
// ihren eigenen Spiegel, bewusst akzeptiert, B-1).
//
// TENANT-SCOPE UNKONDITIONAL: tenantCallScope, OHNE das config.tenancy.multiTenant-Gate,
// mit dem /api/state Legacy-Calls ohne tenantId rettet. Beide Inbox-Marker entstehen
// ausschliesslich an NEUEN Calls, die immer eine tenantId tragen - einen Legacy-Pfad
// gibt es hier nicht, und ein Gate, das keinen Fall deckt, waere nur eine Tuer.
//
// Filter auf WAHRHEIT statt auf null (fail-closed): ein Datensatz ohne das Feld
// (undefined) ist NICHT qualifiziert. `!== null` waere hier fail-OPEN.
// Sortierung nach startedAt AUFSTEIGEND, nicht nach inboxEntryAt: ausgeliefert wird die
// START-Zeit, inboxEntryAt ist die ENDE-Zeit - zwei ueberlappende Anrufe erschienen sonst
// gegenlaeufig zu ihren eigenen Zeitstempeln (R-12).
// Markiert wird NUR, was tatsaechlich ausgeliefert wurde; `remaining` nennt den Rest
// ehrlich. `marked` ist der Wrapper-Kontrakt: save() NUR bei marked > 0 (R-3) - ein
// Leer-Poll ist der Normalfall und darf keinen Voll-Rewrite/Voll-Flush ausloesen.
// includeSeen: liest bereits gesehene Eintraege erneut und aendert KEINEN Marker
// (marked bleibt 0). Optionsobjekt statt viertem Positionsargument (F1, Muster
// recordCallEstimatedCostCents).
export function takeInboxEntries(state, tenantId, { limit, includeSeen }) {
  const { calls } = tenantCallScope(state, tenantId);
  const candidates = calls
    .filter((call) => Boolean(call.inboxEntryAt) && (includeSeen || !call.inboxSeenAt))
    .sort((left, right) =>
      left.startedAt < right.startedAt ? -1 : left.startedAt > right.startedAt ? 1 : 0,
    );
  const delivered = candidates.slice(0, limit);
  let marked = 0;
  const entries = delivered.map((call) => {
    const entry = inboxEntryView(call, openActionItemTexts(state, call.id));
    if (!includeSeen && setOnceTimestamp(call, "inboxSeenAt").changed) marked += 1;
    return entry;
  });
  return { entries, remaining: candidates.length - delivered.length, marked };
}

// KS-P5: die zwei Achsen-Stempel eines Usage-Buckets als Anker-Objekt. EINE Stelle, an
// der die Anker-FORM definiert ist - Schreibseite (metering) und Leseseite (cost-truing)
// bauen sie nie selbst zusammen, sonst driften zwei Feldlisten auseinander (G5).
// Reine Funktion.
export function chargeAnchorsOfUsage(bucket) {
  return { spendMonthKey: bucket.spendMonthKey, periodKey: bucket.budgetPeriodKey };
}

// Gegenstueck der Leseseite: die am Call persistierten Anker in dieselbe Form.
// Reine Funktion.
export function chargeAnchorsOfCall(call) {
  return { spendMonthKey: call.estimatedCostSpendMonthKey, periodKey: call.estimatedCostPeriodKey };
}

// Kein Belastungs-Anker bekannt (Bestandszeile von vor KS-P5, Aufrufer ohne Call).
// BENANNT statt still: die Gutschrift bleibt dann auf der Lebenszeit-Achse, also auf der
// STRENGSTEN - das ist exakt das Bestandsverhalten und damit fail-closed.
export const NO_CHARGE_ANCHORS = Object.freeze({ spendMonthKey: null, periodKey: null });

// LCT P2: persistiert den GEBUCHTEN Schaetzbetrag am Call. Set-once (Muster markBilled):
// der zuerst gebuchte Wert gewinnt, ein spaeter Retry ueberschreibt ihn nie - er ist der
// Bezugspunkt, gegen den P4 die Korrektur bildet.
//
// isBookableCents ist hier PFLICHT und dieselbe EINE Gueltigkeitsquelle (defaults.js), die
// addVoiceUsageCostCents benutzt: wird die Buchung dort als korrupt verworfen, darf hier
// KEIN Estimate stehenbleiben - sonst rechnete P4 eine Rueckerstattung gegen einen Betrag,
// der nie in den Bucket gelaufen ist. Liefert { call, changed } (Wrapper saved bei changed).
// KS-P5: Optionsobjekt statt viertem Positionsargument (F1). Der Aufrufer liefert den
// Betrag UND die Anker der Buchung, unter der er entstanden ist.
export function recordCallEstimatedCostCents(s, callId, { costCents, chargeAnchors }) {
  const call = getCall(s, callId);
  if (!call || call.estimatedCostCents !== null || !isBookableCents(costCents))
    return { call: call || null, changed: false };
  call.estimatedCostCents = costCents;
  // KS-P5: Betrag UND Anker entstehen im selben set-once-Schritt. Getrennt geschrieben
  // gaebe es einen Zustand "Betrag ohne Anker" - genau den Zustand, in dem die spaetere
  // Gutschrift raten muesste.
  call.estimatedCostSpendMonthKey = chargeAnchors.spendMonthKey;
  call.estimatedCostPeriodKey = chargeAnchors.periodKey;
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

// Anker der Max-Dauer-Rechnung UND des Live-Verbrauchs (KS-P2): der ECHTE Call-Start
// (answeredAt bevorzugt, sonst startedAt), NIE der Boot-Zeitpunkt. Fehlt beides -> NaN.
// Die zwei Aufrufer clampen bewusst UNTERSCHIEDLICH und beide fail-closed:
// remainingMaxDurationMs auf 0 (= sofort terminieren), liveVoiceMinutesOf (metering.js)
// reicht das NaN weiter an die D7-Kante (liveBudgetExceeded). Ein stilles 0 waere dort
// fail-OPEN (ungemessener Call), ein durchgereichtes NaN ohne Riegel ebenfalls
// (gebucht + NaN >= cap ist immer false).
export function callStartAnchorMs(call) {
  return Date.parse(call.answeredAt ?? call.startedAt ?? "");
}

// Hartes Max-Dauer-Limit dieses Calls in ms (call-eigenes maxDurationS vor injiziertem Default).
// config-frei: defaultMaxDurationS reicht der Aufrufer herein (seit KS-P3 ueberall
// MAX_CALL_DURATION_CAP_S - der Env-Knopf MAX_CALL_DURATION_S ist entfallen).
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

// AL-P1: Provider-Handle am Call. Set-once + nur bei truthy Wert (Muster
// recordFailureReason): ein Webhook-Retry ueberschreibt die erste Kennung nicht, ein
// fehlender Wert ist ein No-op (changed=false -> kein Save). Wrapper saved bei changed.
//
// EL-BL1: seit dem ElevenLabs-Laufwerk gibt es ZWEI solcher Handles. Eine Fabrik statt
// zweier strukturgleicher Zwillinge (G5): das Set-once-Verhalten ist die Regel, das Feld
// nur ihr Parameter - zwei Kopien koennten auseinanderlaufen, und genau daran haengt,
// dass eine zweite Kennung desselben Anrufs die erste nicht ueberschreibt.
const recordProviderHandleOnce = (field) => (state, callId, handle) => {
  const call = getCall(state, callId);
  let changed = false;
  if (call && handle && !call[field]) {
    call[field] = handle;
    changed = true;
  }
  return { call, changed };
};

export const recordTelnyxConversationId = recordProviderHandleOnce("telnyxConversationId");
export const recordElevenlabsConversationId = recordProviderHandleOnce(
  "elevenlabsConversationId",
);

// Der Join-Schluessel zwischen ElevenLabs- und Telefonie-Kosten (s. Feld-Kommentar in
// createCall). DIESELBE set-once-Fabrik wie die Handles darueber - ein wiederholter
// Ergebnisabruf traegt denselben Wert, und der frueheste zaehlt; ein fehlender Wert ist
// ein No-op (changed=false -> kein Save), damit ein Anbieter, der die Kennung weglaesst,
// den laufenden Anruf nicht scheitern laesst.
const setSipCallIdOnce = recordProviderHandleOnce("sipCallId");

// DER WAECHTER (Owner-Auftrag 17.08.2026). Er sitzt HIER und nicht beim Leser der
// Anbieter-Antwort, weil dies der einzige Schreibweg des Feldes ist - json- und
// pg-Wrapper rufen beide diese Funktion, und jeder KUENFTIGE Schreiber laeuft
// automatisch durch sie (dieselbe Ueberlegung wie bei der weissen Liste in
// elevenlabs/convai.js, die vor dem einzigen Netzzugriff ihres Weges sitzt).
//
// ER VERWIRFT STATT ZU WERFEN: das Feld ist ein Buchhaltungs-Schluessel, und der Anruf
// laeuft, wenn hier geschrieben wird. Ein Fehlschlag darf ihn nicht in den Fehlerpfad
// schicken. Verwerfen ist aber mehr als Nichtstun - es HAELT DEN set-once-PLATZ FREI:
// genau daran ist der Defekt vom 17.08.2026 entstanden, ein falscher Wert kam zuerst und
// sperrte die einzige richtige Quelle fuer immer aus.
//
// STILL WAERE ER WERTLOS: die Meldung ist der einzige Weg, an dem eine Formaenderung des
// Anbieters auffaellt, bevor die Kostenzuordnung eines ganzen Zeitraums fehlt. Sie ist
// secret- und PII-frei - ein opaker Anruf-Handle, dieselbe Klasse wie die Kennungen, die
// der ElevenLabs-Weg ohnehin loggt. Dieses Modul ist sonst IO-frei; der console-Aufruf
// ist dieselbe eng begrenzte Ausnahme wie beim D7-Riegel weiter unten (kein Datei-/DB-IO).
export function recordSipCallId(state, callId, sipCallId) {
  if (sipCallId && !isTelnyxSipCallId(sipCallId)) {
    console.error(
      `[join-schluessel] verworfen grund=keine_telnyx_sip_call_id call=${callId} wert=${sipCallId}`,
    );
    return { call: getCall(state, callId), changed: false };
  }
  return setSipCallIdOnce(state, callId, sipCallId);
}

// KS-EL1: der GRUND, warum trueUpAnsweredAt oben KEINEN Anker ermitteln konnte (additiv
// nullable). Set-once + value-gated ueber DIESELBE Fabrik wie die Provider-Handles - die
// Form ist identisch (ein String-Feld, einmal gesetzt, ein spaeterer Aufruf ueberschreibt
// nicht), nur das Feld selbst ist keine Kennung, sondern ein Diagnosetext. Eine dritte,
// eigens getippte Kopie derselben set-once-Logik (Muster recordFailureReason) waere
// Duplizierung (G5) - die Fabrik ist bewusst allgemein genug fuer beide Faelle.
export const recordAnsweredUnclearReason = recordProviderHandleOnce("answeredUnclearReason");

// EL-Anrufstart: das Ergebnis eines Gespraechs, das der ANBIETER gefuehrt hat. Auf diesem
// Weg gibt es bei uns weder Audio noch Turn-Schleife - Zusammenfassung und Befund kommen
// fertig von aussen und muessen trotzdem an denselben Feldern landen, die get_transcript
// ohnehin liest.
//
// Anders als die Handles oben ist das bewusst KEIN set-once: es gibt genau einen Schreiber
// (den ziehenden Ergebnisweg, und der schreibt nur bei beendetem Gespraech), und ein
// wiederholter Abruf desselben Gespraechs traegt denselben Stand. Beide Felder stammen aus
// EINER Anbieter-Antwort und werden deshalb in EINEM Schritt gesetzt - zwei getrennte
// Schreibschritte koennten auseinanderfallen und einen Befund ohne die zugehoerige
// Zusammenfassung hinterlassen. Wrapper saved immer: es gibt Spalten fuer beide.
export function recordProviderCallResult(state, callId, { summary, objectiveAchieved }) {
  const call = getCall(state, callId);
  if (!call) return { call: null, changed: false };
  call.summary = summary;
  call.objectiveAchieved = objectiveAchieved;
  return { call, changed: true };
}

// ABNAHME-D1 (TEIL 2): die vier Angaben, die der Agent waehrend des Gespraechs
// STRUKTURIERT gesammelt hat (ElevenLabs Data Collection), additiv NEBEN summary -
// dieselbe EINE Anbieter-Antwort wie recordProviderCallResult direkt darueber, deshalb
// aus demselben Grund (G5: koennten sonst auseinanderfallen) in EINEM Schritt gesetzt.
// Bewusst KEIN set-once (Muster recordProviderCallResult, nicht recordProviderHandleOnce):
// genau ein Schreiber (der ziehende Ergebnisweg, elevenlabs/outbound.js#persistProviderResult),
// der nur einmal je Call laeuft. FEHLT eine Angabe im Ergebnis (Normalfall, s. Modul-Kopf-
// Kommentar an den Feld-Defaults), uebergibt der Aufrufer null dafuer - kein Platzhalter,
// kein Fehler. Alle vier Werte reisen als String (Praezedenz answeredUnclearReason: eine
// TEXT-Spalte auf beiden Backends, kein zweiter Zahlentyp, der zwischen json.js und pg.js
// auseinanderlaufen koennte).
export function recordProviderCollectedFields(state, callId, { appointmentDate, appointmentTime, amount, currency }) {
  const call = getCall(state, callId);
  if (!call) return { call: null, changed: false };
  call.appointmentDate = appointmentDate ?? null;
  call.appointmentTime = appointmentTime ?? null;
  call.amount = amount ?? null;
  call.currency = currency ?? null;
  return { call, changed: true };
}

// ABNAHME-D1 (TEIL 3, Eigentuemer-Auflage): die im Gespraech BESTAETIGTE Zeitzone des
// Angerufenen, mit Herkunft und Zeitstempel - haengt an DERSELBEN Ergebnis-Rueckmeldung
// wie recordProviderCollectedFields darueber, ist aber ein eigener Schreibschritt: eine
// Hypothese (aus der Vorwahl abgeleitet) erreicht diese Funktion NIE - der Aufrufer ruft
// sie nur auf, wenn tatsaechlich ein bestaetigter Wert vorliegt (s. elevenlabs/outbound.js).
// ANDERS ALS recordProviderCollectedFields/answeredUnclearReason bewusst KEIN set-once:
// "ueberschreibbar" ist woertliche Eigentuemer-Auflage - ein spaeterer bestaetigter Wert
// ersetzt einen frueheren, statt dass der erste gewinnt. confirmedAt ist UNSERE eigene
// Serverzeit (der Anbieter liefert keinen Bestaetigungs-Zeitpunkt) und reist immer
// zusammen mit dem Wert - nie getrennt gesetzt, sonst koennte ein Zonenwert ohne
// zugehoerigen Zeitstempel stehen bleiben.
export function recordCalleeConfirmedTimezone(state, callId, { timezone, origin, confirmedAt }) {
  const call = getCall(state, callId);
  if (!call) return { call: null, changed: false };
  call.calleeConfirmedTimezone = timezone;
  call.calleeConfirmedTimezoneOrigin = origin;
  call.calleeConfirmedTimezoneAt = confirmedAt;
  return { call, changed: true };
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

// ---- AL-P13: Consult-Kette am Call --------------------------------------------
// Ein Consult ist EIN Rueckfrage-Ereignis mit 1..n Fragen. Consult #0 traegt die
// open_questions des Briefings (AL-P9) und wird beim Waehlen emittiert - die
// Klingelzeit ist die billigste Sprosse der Fakten-Leiter (0 ms Gespraechslatenz).
// Die Kennung ist "c<seq>": stabil, geordnet, ohne Parsing vergleichbar, und im
// Export/Log lesbar (anders als eine Zufalls-ID).

const CONSULT_ID_PREFIX = "c";
const CONSULT_ID_PATTERN = /^c(\d+)$/;
const consultIdOf = (seq) => `${CONSULT_ID_PREFIX}${seq}`;

// "c3" -> 3. Alles andere (fehlend, fremd, manipuliert) -> null = KEIN Filter: ein
// Client, der seinen Stand verloren hat, bekommt die Frage erneut statt gar nichts
// (beantworten kann sie ohnehin nur er selbst).
function consultSeqOf(eventId) {
  const match = typeof eventId === "string" ? eventId.match(CONSULT_ID_PATTERN) : null;
  return match ? Number(match[1]) : null;
}

// Format-Wache fuer die Route (POST /api/calls/:id/consult/answer): event_id ist
// Client-Freitext, bevor er in Audit-Log oder answerConsult einlaeuft, muss er dem
// serverseitig erzeugten Format "c<seq>" entsprechen - EINE Quelle mit consultSeqOf/
// CONSULT_ID_PATTERN (G5), sonst driften Log- und Store-Pruefung auseinander.
export function isConsultEventId(eventId) {
  return typeof eventId === "string" && CONSULT_ID_PATTERN.test(eventId);
}

// Nicht-leere Textfragen dieser Emission. Alles andere faellt weg (Storage-Deckel,
// kein Ereignis ohne beantwortbare Frage).
function cleanQuestions(questions) {
  return Array.isArray(questions) ? questions.filter((q) => typeof q === "string" && q) : [];
}

// Emission (Nebeneffekt im Namen, N7). Leere Fragenliste -> No-op: eine Rueckfrage
// ohne Frage waere ein Ereignis, das der Client nie beantworten kann - call.consults
// bleibt dann null (Bestandsform, kein Shape-Drift).
export function emitConsult(s, callId, questions) {
  const call = getCall(s, callId);
  const asked = cleanQuestions(questions);
  if (!call || !asked.length) return { call: call || null, changed: false, consult: null };
  const chain = (call.consults ||= []);
  const consult = {
    id: consultIdOf(chain.length),
    seq: chain.length,
    questions: asked,
    status: CONSULT_STATUS.OPEN,
    askedAt: new Date().toISOString(),
    answeredAt: null,
    // Zahl, KEIN Text: der Antworttext lebt ausschliesslich in call.context.key_facts.
    // Ein zweiter Speicherort desselben Freitexts waere ein zweiter Loeschpfad fuer
    // Erase/Export (G5) und eine zweite Chance zu leaken.
    answeredFacts: 0,
  };
  chain.push(consult);
  return { call, changed: true, consult };
}

// Reiner Leser: der aelteste OFFENE Consult mit seq > seq(afterEventId), sonst null.
// Die Kette ist push-geordnet, find() liefert damit den aeltesten Treffer.
export function pendingConsult(s, callId, afterEventId) {
  const call = getCall(s, callId);
  if (!call || !Array.isArray(call.consults)) return null;
  const afterSeq = consultSeqOf(afterEventId);
  return (
    call.consults.find(
      (c) => c.status === CONSULT_STATUS.OPEN && (afterSeq === null || c.seq > afterSeq),
    ) ?? null
  );
}

// Merge in call.context.key_facts - die EINZIGE Stelle, an der fremder In-Call-Text
// (Consult-Antwort ODER Suchtreffer) den Prompt erreicht. Bestand gewinnt (Owner-/
// Briefing-Fakten stehen vorn), der Ueberhang faellt am GETEILTEN Deckel
// KEY_FACTS_LIMITS.maxItems; zurueck kommt die tatsaechlich uebernommene Zahl, damit der
// Aufrufer sie melden kann und nichts still verschwindet.
// EL-BEFUND-6: WIE VIELE Fakten stehen JETZT in call.context.key_facts? Vor dem Merge
// gelesen ist das der Index, ab dem die Fakten DIESES Merges liegen - die einzige
// Angabe, mit der ein Warter seine eigene Antwort spaeter zweifelsfrei wiederfindet.
// Am Rand nachgerechnet (Stand vor dem Emit + Anzahl) waere sie falsch, sobald ein
// zweiter Schreiber (addLookupFacts) dazwischen anhaengt.
function keyFactsCount(call) {
  const facts = call?.context?.key_facts;
  return Array.isArray(facts) ? facts.length : 0;
}

function mergeContextFacts(call, facts) {
  const incoming = Array.isArray(facts) ? facts : [];
  if (!incoming.length) return 0;
  const context = (call.context ||= {});
  const existing = Array.isArray(context.key_facts) ? context.key_facts : [];
  const room = KEY_FACTS_LIMITS.maxItems - existing.length;
  if (room <= 0) return 0;
  const taken = incoming.slice(0, room);
  context.key_facts = [...existing, ...taken];
  return taken.length;
}

// GQ-P2: Alter eines Consults an der Wanduhr. NaN bei unlesbarem Zeitstempel - jeder
// Aufrufer entscheidet darauf fail-closed.
function consultAgeMs(consult, nowMs) {
  return nowMs - Date.parse(consult?.askedAt ?? "");
}

// GQ-P2: nimmt eine Rueckfrage dieses Alters noch eine Antwort an? EINE Quelle (G5) fuer
// den Turn-Schritt (advanceInCallConsult) und die Antwort-Kante (answerConsult) - mit
// zwei Praedikaten koennte answerConsult eine Antwort annehmen, die der Turn-Schritt
// Millisekunden spaeter verwirft. Unlesbares Alter ODER fehlende Frist -> false.
function consultAlive(ageMs, openMs) {
  return Number.isFinite(ageMs) && Number.isFinite(openMs) && ageMs < openMs;
}

// Antwort einspeisen. facts sind BEREITS validiert (validateAssistantContext an der
// Route) - diese Ebene kennt keine Validierung, sie fuehrt Buch (G30/G34: eine
// Abstraktionsebene). Reihenfolge der Ablehnungen ist bindend: Call vorbei ->
// unbekanntes Ereignis -> schon beantwortet -> Frist abgelaufen.
export function answerConsult(s, callId, { eventId, facts, nowMs, openMs }) {
  const call = getCall(s, callId);
  const reject = (outcome) => ({ call: call || null, changed: false, outcome, mergedFacts: 0 });
  if (!call || call.status !== "active") return reject(CONSULT_ANSWER.CALL_ENDED);
  const consult = Array.isArray(call.consults)
    ? call.consults.find((c) => c.id === eventId)
    : null;
  if (!consult) return reject(CONSULT_ANSWER.UNKNOWN_EVENT);
  if (consult.status !== CONSULT_STATUS.OPEN) return reject(CONSULT_ANSWER.ALREADY_ANSWERED);
  // GQ-P2: NUR der In-Call-Consult hat eine Wanduhr-Frist. Consult #0 (Klingelzeit,
  // AL-P13) wartet ausschliesslich auf den Client und darf nie an der Uhr sterben - er
  // ueberspringt dieses Gate vollstaendig (Bestandsverhalten byte-identisch). Fuer den
  // In-Call-Fall ist es fail-closed: fehlt die Frist, wird NICHT eingespeist.
  if (isInCallConsult(call, consult) && !consultAlive(consultAgeMs(consult, nowMs), openMs))
    return reject(CONSULT_ANSWER.DEADLINE_PASSED);
  // EL-BEFUND-6: Startindex VOR dem Merge festhalten. Zusammen mit answeredFacts sagt er
  // exakt, welcher Ausschnitt von key_facts zu DIESER Antwort gehoert - unabhaengig
  // davon, was vorher oder nachher sonst noch angehaengt wurde. Eine Zahl, kein zweiter
  // Freitext-Speicher (dieselbe Begruendung wie bei answeredFacts).
  const answeredFactsFrom = keyFactsCount(call);
  const mergedFacts = mergeContextFacts(call, facts);
  consult.status = CONSULT_STATUS.ANSWERED;
  consult.answeredAt = new Date().toISOString();
  consult.answeredFacts = mergedFacts;
  consult.answeredFactsFrom = answeredFactsFrom;
  return { call, changed: true, outcome: CONSULT_ANSWER.ACCEPTED, mergedFacts };
}

// AL-P10b: Suchtreffer in den HINTERGRUND. Zweiter Aufrufer desselben Merges (G5) -
// derselbe Deckel KEY_FACTS_LIMITS.maxItems, dieselbe Vorrang-Regel (Bestand gewinnt).
// Das ist die EINZIGE Stelle, an der ein Suchtreffer den Prompt erreicht.
export function addLookupFacts(s, callId, facts) {
  const call = getCall(s, callId);
  if (!call) return { call: null, changed: false, added: 0 };
  const added = mergeContextFacts(call, facts);
  return { call, changed: added > 0, added };
}

// AL-P10b: Kontingent-Zaehler des Nachschlags. EPHEMER (kein save, keine Spalte - Muster
// countNoSpeechTurn/noteConsultPoll): ein Instanzwechsel mitten im Anruf setzt ihn
// zurueck, das kostet hoechstens LOOKUP_MAX_PER_CALL weitere Suchen in genau diesem Call -
// der harte Deckel bleibt die pro-Tenant-Kostendecke, die vor JEDER Schleifenrunde
// geprueft wird. Nebeneffekt im Namen (N7).
export function countCallLookup(s, callId) {
  const call = getCall(s, callId);
  if (!call) return 0;
  call.lookups = (call.lookups || 0) + 1;
  return call.lookups;
}

// Reiner Leser (Geschwister zu inCallConsults): fehlendes Feld -> 0, kein NaN.
export function callLookups(call) {
  return call?.lookups || 0;
}

// ---- Thema B (2026-08-19): das RECHERCHE-PROTOKOLL des ElevenLabs-Wegs ----
// Anders als der ephemere Zaehler des Budget-Wegs (call.lookups, oben) PERSISTENT
// (Spalte lookup_log, JSONB): der Eigentuemer muss fuer die Datenschutzerklaerung
// belegen koennen, WELCHE Inhalte aus einem Gespraech an den Suchdienst gingen
// (Auflage B5) - und der Deckel LOOKUP_MAX_PER_CALL zaehlt genau diese Eintraege,
// ueberlebt also auch einen Prozess-Restart mitten im Anruf (der Boot-Re-Arm wuerde
// einen ephemeren Zaehler nullen und das Kontingent verdoppeln).
//
// ZWEI SCHRITTE, bewusst getrennt: recordCallLookup VOR dem Absenden (die Absicht
// zaehlt fuers Kontingent, auch wenn die Antwort nie ankommt - dasselbe Prinzip wie
// die Gebuehr, research/in-call.js), finishCallLookup NACH der Antwort (Ausgang und
// Dauer). Die QUERY steht im Protokoll - das ist hier ausdruecklich gewollt (B5,
// Eigentuemer-Entscheidung; die Konsolen-Logs bleiben PII-frei, s. Webhook).
// eslint-Ratsche: "state" statt des datei-ueblichen "s" - die Bulk-Suppressions pinnen
// die id-length-ANZAHL, und neue Schuld soll nicht dazukommen (Lehre der Altlast-Ratsche).
export function recordCallLookup(state, callId, query) {
  const call = getCall(state, callId);
  if (!call || typeof query !== "string" || !query) {
    return { call: call || null, changed: false, seq: null };
  }
  const log = (call.lookupLog ||= []);
  const eintrag = {
    seq: log.length,
    query,
    askedAt: new Date().toISOString(),
    dauerMs: null,
    ok: null,
    factCount: null,
  };
  log.push(eintrag);
  return { call, changed: true, seq: eintrag.seq };
}

export function finishCallLookup(state, callId, { seq, ok, factCount, dauerMs }) {
  const call = getCall(state, callId);
  const log = Array.isArray(call?.lookupLog) ? call.lookupLog : [];
  const eintrag = log.find((zeile) => zeile.seq === seq);
  if (!eintrag) return { call: call || null, changed: false };
  eintrag.ok = ok === true;
  eintrag.factCount = Number.isFinite(factCount) ? factCount : 0;
  eintrag.dauerMs = Number.isFinite(dauerMs) ? dauerMs : null;
  return { call, changed: true };
}

// Reiner Leser fuer Deckel und Torzustand des EL-Wegs (research/registry.js):
// fehlendes Feld -> 0. Zaehlt EINTRAEGE (= ausgeloeste Absichten), nicht Erfolge.
export function elevenLabsLookupCount(call) {
  return Array.isArray(call?.lookupLog) ? call.lookupLog.length : 0;
}

// Offene Consults schliessen (Call terminal / Drain). Idempotent: ein zweiter Aufruf
// findet nichts Offenes mehr und meldet changed=false.
export function expireOpenConsults(s, callId) {
  const call = getCall(s, callId);
  if (!call || !Array.isArray(call.consults)) return { call: call || null, changed: false };
  let changed = false;
  for (const consult of call.consults) {
    if (consult.status !== CONSULT_STATUS.OPEN) continue;
    consult.status = CONSULT_STATUS.EXPIRED;
    changed = true;
  }
  return { call, changed };
}

// EL-NEUSTART-6: dieselbe Schliessung wie oben, PLUS der Verwaisungs-Marker. Ein harter
// Abbruch (Absturz, SIGKILL) toetet jeden Warter, ohne dass ein Pfad den Datensatz noch
// anfassen koennte - die Rueckfrage steht beim naechsten Start offen da und hat KEINE
// Gespraechszeit gekostet. Ihr Kontingent-Platz muss frei werden (consultQuotaUsed), sonst
// kann ein Anruf, der beim Anbieter weiterlaeuft, nie wieder rueckfragen.
//
// EL-NEUSTART-9: ZWEI Aufrufer, EINE Naht. Der zweite ist der DRAIN des geordneten
// Herunterfahrens (conversation/consult-raised.js) - der haeufigere Weg, denn ein Deploy
// ist die Regel und der Absturz die Ausnahme. Dort stirbt der Wartende genauso, nur
// schliesst der Prozess den Datensatz noch selbst; das Boot-Netz sieht ihn danach nie
// wieder (es sucht ueber pendingConsult, also ueber OFFENE Datensaetze). Beide Aufrufer
// messen mit demselben Praedikat und derselben Frist - eine zweite Formulierung koennte
// den Kosten-Riegel auf einem Weg anders wirken lassen als auf dem anderen.
//
// DIE UNTERSCHEIDUNG haengt an der Wanduhr, weil sie sonst nirgends steht: nur eine
// Rueckfrage, deren Haltefrist beim Schliessen noch LIEF, kann einen lebenden Warter
// gehabt haben. War die Frist bereits um, hat der Anruf sie voll bezahlt (oder der Prozess
// starb erst danach) - dann bleibt der Platz verbraucht. IM ZWEIFEL BEZAHLT: unlesbarer
// Zeitstempel oder fehlende Frist -> consultAlive false -> kein Marker (fail-closed, Regel
// 1: lieber eine Rueckfrage zu wenig als ein umgehbarer Kosten-Riegel).
//
// NUR In-Call-Rueckfragen: Consult #0 (Klingelzeit, AL-P13) traegt gar kein Kontingent und
// hat keine Wanduhr-Frist - ihn an CONSULT_OPEN_MS zu messen waere eine Kategorienfehler.
// Der Status kommt unveraendert aus expireOpenConsults (EINE Quelle, kein zweiter
// Schliess-Weg); dieser Aufruf haengt nur den Marker davor. Der Zustands-Parameter heisst
// state und nicht s wie im Bestand: die kurzen Namen sind eingefrorene Altlast, neue Namen
// unterschreiten die Mindestlaenge nicht.
export function expireOrphanedConsults(state, callId, { nowMs, openMs }) {
  const call = getCall(state, callId);
  if (!call) return { call: null, changed: false, orphaned: 0 };
  const orphanedAt = new Date().toISOString();
  let orphaned = 0;
  for (const consult of inCallConsults(call)) {
    if (consult.status !== CONSULT_STATUS.OPEN) continue;
    if (!consultAlive(consultAgeMs(consult, nowMs), openMs)) continue;
    consult.orphanedAt = orphanedAt;
    orphaned += 1;
  }
  const { changed } = expireOpenConsults(state, callId);
  return { call, changed, orphaned };
}

// AL-P14: EIN Consult ist ein IN-CALL-Consult, wenn er NACH dem Abnehmen entstand.
// Abgeleitet statt gespeichert: Consult #0 (AL-P13) entsteht beim Waehlen, also vor
// markAnswered - ein zusaetzliches Quellenfeld waere ein zweiter, pflegebeduerftiger
// Wahrheitsort fuer dieselbe Tatsache. Nie beantwortet -> kein In-Call-Consult.
// Unlesbare Zeitstempel (Fremd-/Altdatensatz) -> false, fail-closed. Reiner Leser.
export function isInCallConsult(call, consult) {
  const answeredAtMs = Date.parse(call?.answeredAt ?? "");
  const askedAtMs = Date.parse(consult?.askedAt ?? "");
  if (Number.isNaN(answeredAtMs) || Number.isNaN(askedAtMs)) return false;
  return askedAtMs >= answeredAtMs;
}

// Alle In-Call-Consults dieses Calls. Reiner Leser.
export function inCallConsults(call) {
  if (!Array.isArray(call?.consults)) return [];
  return call.consults.filter((consult) => isInCallConsult(call, consult));
}

// EL-NEUSTART-6: WIE VIEL Kontingent hat dieser Anruf verbraucht? Die EINE Zahl fuer beide
// Riegel-Leser (consult/in-call.js, routes/webhooks-elevenlabs.js) - zwei Formulierungen
// koennten auseinanderlaufen und der Riegel wirkte dann auf einem Weg anders als auf dem
// anderen. Gezaehlt wird STATUSUNABHAENGIG: eine abgelaufene oder beantwortete Rueckfrage
// hat das kostende Gespraech offen gehalten und ist verbraucht.
//
// AUSGENOMMEN ist genau eine Lage, die keine Gespraechszeit gekostet hat: die Rueckfrage,
// deren Wartender starb, waehrend ihre Haltefrist noch lief - beim harten Abbruch (Marker
// beim Start) wie beim geordneten Herunterfahren (Marker im Drain). Gesetzt wird er
// ausschliesslich in expireOrphanedConsults und nur innerhalb der Haltefrist. Reiner Leser.
export function consultQuotaUsed(call) {
  return inCallConsults(call).filter((consult) => !consult.orphanedAt).length;
}

// GQ-P13: wartet GENAU DIESE Antwort noch auf ihren ersten Modell-Turn? EINE Quelle (G5)
// fuer BEIDE Mechanismen, die auf diesem Zustand sitzen: den Steuertext
// (advanceInCallConsult -> CONSULT_WAIT.ANSWERED) und das Zustellfenster des
// Anstoss-Riegels (markConsultAnswerDelivered, GQ-P7). Vorher stand die Bedingung zweimal
// im Modul; zwei Kopien koennen auseinanderlaufen und ein Fenster oeffnen, in dem es
// nichts zu sagen gibt.
//
// answeredFacts > 0 ist der Kern der Phase: answerConsult setzt den Status UNBEDINGT auf
// "answered" - auch dann, wenn mergeContextFacts am geteilten Deckel KEY_FACTS_LIMITS
// null Fakten uebernommen hat. Ohne diese Bedingung bekaeme das Modell die Anweisung, eine
// Auskunft JETZT zu nennen, die nirgends im Prompt steht, waehrend derselbe Steuertext ihm
// jeden ehrlichen Ausweg verbietet (nicht nachfragen, kein Rueckruf, keine Nachricht).
// Fehlendes Feld (Alt-/Fremddatensatz, hydrierte Zeile) -> false: fail-closed wie
// isInCallConsult. Reiner Leser.
function answerAwaitsDelivery(consult) {
  return (
    consult.status === CONSULT_STATUS.ANSWERED &&
    !consult.deliveredAt &&
    consult.answeredFacts > 0
  );
}

// GQ-P7: Wartet eine EINGETROFFENE Rueckfrage-Antwort noch darauf, dass sie ein Modell-Turn
// ueberhaupt zu sehen bekommt? Reiner Leser.
//
// Der Unterschied zu "beantwortet" ist der Kern des Befunds vom 2026-08-05: die Antwort lag
// um 09:44:24 in call.context.key_facts und damit im Systemprompt - aber der Agent bekam bis
// zum Gespraechsende (09:44:52) keinen einzigen Turn mehr, in dem er sie haette aussprechen
// koennen. Die Gegenstelle schwieg, also kam jeder weitere Turn als Provider-Anstoss, und
// den blockiert der Riegel (GQ-P5). "Im Prompt" und "ausgeliefert" sind zwei Zustaende.
export function consultAnswerAwaitingDelivery(call) {
  return inCallConsults(call).some(answerAwaitsDelivery);
}

// GQ-P7: Gegenstueck - ein Modell-Turn IST gelaufen, die wartende Antwort war dabei im
// Prompt. Markiert alle eingetroffenen, noch nicht ausgelieferten Rueckfrage-Antworten.
// Nebeneffekt im Namen (N7).
//
// Persistent (kein ephemerer Zaehler): faellt die Instanz mitten im Gespraech aus, darf die
// Antwort NICHT ein zweites Mal ein Anstoss-Fenster oeffnen - sonst kann aus dem einmaligen
// Zustellfenster doch wieder eine Schleife werden.
export function markConsultAnswerDelivered(s, callId) {
  const call = getCall(s, callId);
  if (!call) return { call: null, changed: false, marked: 0 };
  const deliveredAt = new Date().toISOString();
  let marked = 0;
  for (const consult of inCallConsults(call))
    if (answerAwaitsDelivery(consult)) {
      consult.deliveredAt = deliveredAt;
      marked += 1;
    }
  return { call, changed: marked > 0, marked };
}

// AL-P14: der Client hat auf diesen Call gepollt. EPHEMER (kein save, keine Spalte -
// Muster countNoSpeechTurn): das ist eine Beobachtung ueber das JETZT, kein Zustand,
// der einen Deploy ueberleben duerfte. Nebeneffekt im Namen (N7).
export function noteConsultPoll(s, callId, nowMs = Date.now()) {
  const call = getCall(s, callId);
  if (call) call.consultPolledAtMs = nowMs;
}

// AL-P14/GQ-P2: der EINE Zustandsschritt der laufenden Rueckfrage, einmal je Turn.
// HOLD      = die kurze Wartefrist laeuft und dies ist der erste Turn seither
//             (LLM-freier Halte-Satz, hoechstens EINER je Consult);
// PENDING   = die Wartefrist ist um, die OFFEN-Frist nicht - der Consult LEBT weiter und
//             nimmt eine Antwort noch an; der Turn laeuft normal und traegt einmalig den
//             ehrlichen Hinweis;
// TIMED_OUT = die OFFEN-Frist ist abgelaufen (oder der Zeitstempel unlesbar, fail-closed)
//             -> Status timed_out, Mandats-Fallback, einmalig;
// NONE      = nichts offen ODER beide Marker bereits gesetzt.
// GQ-P2 (W2): der Abbruch haengt an der WANDUHR, nicht am Turn-Zaehler. Vorher setzte der
// ZWEITE Aufruf bedingungslos timed_out - Telefon-Turns folgen schneller aufeinander, als
// ein Antwortender tippen kann, deshalb starb der Kanal praktisch immer. Nebeneffekt im
// Namen (N7). Betrachtet NUR In-Call-Consults: Consult #0 hat keine Gespraechs-Frist.
export function advanceInCallConsult(s, callId, { nowMs, waitMs, openMs }) {
  const call = getCall(s, callId);
  const idle = { call: call || null, changed: false, wait: CONSULT_WAIT.NONE };
  if (!call) return idle;
  // GQ-P8: die EINGETROFFENE Antwort hat Vorrang vor jeder offenen Rueckfrage. Sie ist der
  // Zustand, den der Bestand gar nicht kannte: nach dem Eintreffen steht der Consult auf
  // "answered", die Suche unten nach OFFENEN Rueckfragen findet nichts, und der Turn lief
  // ohne jeden Steuertext. Kein Zustandswechsel hier (changed:false) - der Einmal-Riegel
  // ist deliveredAt, das der Shim NACH dem Turn setzt (GQ-P7). Beide Mechanismen teilen
  // sich damit EINEN Zustand statt zweier, die auseinanderlaufen koennen (G5).
  if (consultAnswerAwaitingDelivery(call))
    return { call, changed: false, wait: CONSULT_WAIT.ANSWERED };
  const consult = inCallConsults(call).find((c) => c.status === CONSULT_STATUS.OPEN);
  if (!consult) return idle;
  const ageMs = consultAgeMs(consult, nowMs);
  if (!consultAlive(ageMs, openMs)) {
    consult.status = CONSULT_STATUS.TIMED_OUT;
    return { call, changed: true, wait: CONSULT_WAIT.TIMED_OUT };
  }
  if (!consult.held && ageMs < waitMs) {
    consult.held = true;
    return { call, changed: true, wait: CONSULT_WAIT.HOLD };
  }
  if (!consult.pendingNoted) {
    consult.pendingNoted = true;
    return { call, changed: true, wait: CONSULT_WAIT.PENDING };
  }
  return idle;
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

// KS-P2/KV-P2: alle noch LAUFENDEN Legs eines Tenants - die Basis des Live-Terms auf der
// Carrier-Achse, seit KV-P2 richtungsoffen. Reine Leseprojektion, keine Mutation, kein IO.
// Die zwei verbliebenen Bedingungen sind je eine Invariante, keine Bequemlichkeit:
//   status "active" - ein beendeter Call ist bereits GEBUCHT (persistEnd schreibt den
//                     Status VOR bill(), call-termination.js) und wuerde sonst doppelt
//                     zaehlen;
//   tenantId        - die Geld-Achse ist pro Tenant (KS-P9/E10).
// Die dritte Bedingung (direction "outbound") ist mit KV-P2 ENTFALLEN: Inbound bucht
// seither auf dieselbe Achse, und was gebucht wird, muss live zaehlen. Eine zweite
// Abfrage fuer die andere Richtung gibt es bewusst NICHT (G5) - eine zweite Liste, die
// jemand synchron halten muesste, ist das Muster, an dem dieses Repo schon gescheitert ist.
export function activeCallsFor(s, tenantId) {
  return s.calls.filter((c) => c.tenantId === tenantId && c.status === "active");
}

// AL-P12 (Beziehungsgedaechtnis): die Erinnerungen an EINE Gegenstelle, neueste zuerst.
// Projektion, kein Record: je frueherem Anruf nur { outcome, facts } - keine Nummer,
// kein Transkript, keine id (Datenminimierung).
//
// DREI Riegel, alle strukturell (nicht per Konvention, G27):
//   1. TENANT-GATE: ohne settings.allowCallMemory kommt [] zurueck, BEVOR ueberhaupt
//      gescannt wird. settingsFor ist dieselbe Per-Tenant-Quelle, die tenantContext
//      exponiert (EINE Quelle, G5) - der Gate reist mit den Daten, ein kuenftiger
//      zweiter Aufrufer kann ihn nicht vergessen.
//   2. TENANT-SCOPE: c.tenantId === tenantId. Es gibt hier KEINEN tenant-uebergreifenden
//      Zweig; ein Schluesselfehler waere ein PII-Leck ueber Tenant-Grenzen (Cross-Tenant-
//      Test ist Pflicht, nicht Kuer).
//   3. RICHTUNG: nur OUTBOUND-Calls, Schluessel ist das selbst gewaehlte Ziel `to`.
//      Inbound-Anrufer-IDs sind faelschbar - ueber sie koennte ein Fremder Fakten in das
//      Gedaechtnis einer Nummer legen, die der Tenant spaeter selbst anruft.
// Leeres/fehlendes e164 -> [] (sonst matchten alle Calls mit to == null aufeinander).
// Reiner Leser: filter() liefert eine NEUE Liste, sort() beruehrt s.calls also nicht.
// Sortiert wird explizit ueber startedAt statt auf die Array-Reihenfolge zu vertrauen
// (json unshift vs. pg ORDER BY seq DESC - eine Invariante per Konvention waere genau
// die Sorte Fragilitaet, die dieses Repo teuer gelernt hat).
export function counterpartyMemory(s, tenantId, e164) {
  if (!e164) return [];
  if (settingsFor(s, tenantId).allowCallMemory !== true) return [];
  return s.calls
    .filter((c) => c.tenantId === tenantId && c.direction === "outbound" && c.to === e164)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
    .map(memoryEntryOf)
    .filter(Boolean)
    .slice(0, MEMORY_MAX_CALLS);
}

// Traegt dieser Call eine Erinnerung? NUR outcome + facts der Ergebnis-Karte - der Rest
// (commitments/open_points/next_step) gehoert dem Owner, nicht dem naechsten Gespraech,
// und evidence (woertliche Zitate) gehoert dort erst recht nicht hinein. Kein
// status-Vergleich (E3): eine Karte entsteht nur nach einem echten Gespraech, und ein
// zweiter Status-Test waere eine zweite Stelle, die beim naechsten Enum-Wert driftet.
// Der LAUFENDE Call faellt hier von selbst heraus (result ist noch null). Rein.
function memoryEntryOf(call) {
  const outcome = call.result?.outcome ?? null;
  const facts = Array.isArray(call.result?.facts) ? call.result.facts : [];
  return outcome || facts.length ? { outcome, facts } : null;
}

// ---- Action Items ----
// GQ-P4 (Befund B-6): am Beleg-Anruf call_msczdf1aadbw feuerte take_message ACHT MAL mit
// derselben Nachricht (Segmente 18/23/24/26/30/32/34/38). Grund: execTool legte
// bedingungslos an, und diese Funktion prueft nie, ob fuer denselben Call bereits ein
// inhaltsgleiches Item existiert.
//
// "Inhaltsgleich" ist bewusst eine NORMALISIERTE GLEICHHEIT, keine Aehnlichkeit: robust
// gegen belanglose Abweichungen (Whitespace-Menge, Gross-/Kleinschreibung, Satzzeichen am
// Ende), aber jedes andere abweichende Zeichen trennt weiter zwei Nachrichten. Eine
// Praefix-/Aehnlichkeitsregel wuerde das Gegenteil riskieren - zwei echte, verschiedene
// Nachrichten verschmelzen und eine davon VERLIEREN. Datenverlust waere schlimmer als ein
// Duplikat, deshalb faellt die Regel im Zweifel auf "sind verschieden".
const ACTION_ITEM_TRAILING_PUNCTUATION = /[.,;:!?\s]+$/;

// Vergleichsform einer Nachricht. Rein, ohne Nebeneffekt. toLowerCase statt
// toLocaleLowerCase: die Vergleichsform darf nicht von der Server-Locale abhaengen.
function actionItemKey(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(ACTION_ITEM_TRAILING_PUNCTUATION, "");
}

// Das bereits vorhandene inhaltsgleiche Item DIESES Calls, sonst null. Der Scan laeuft
// ueber s.actionItems wie toggleActionItem daneben (gleiche Groessenordnung, gleicher Stil);
// neben einem LLM-Roundtrip faellt er nicht ins Gewicht. Der TYP geht bewusst NICHT in den
// Vergleich ein: dieselbe Nachricht ist dieselbe Nachricht.
function existingActionItem(s, callId, key) {
  return s.actionItems.find((a) => a.callId === callId && actionItemKey(a.text) === key) || null;
}

// Legt ein Action Item an - ODER liefert das bereits vorhandene inhaltsgleiche Item
// desselben Calls zurueck, OHNE ein zweites anzulegen. Der Rueckgabewert traegt seit GQ-P4
// zusaetzlich `duplicate`: nur so kann der Aufrufer (execTool, claude.js) dem Modell die
// Wahrheit sagen. Rein additiv, keine Datenmigration - Bestandsdaten bleiben unberuehrt.
export function addActionItem(s, callId, text, type = "todo") {
  const existing = existingActionItem(s, callId, actionItemKey(text));
  if (existing) return { item: existing, duplicate: true };
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
  return { item, duplicate: false };
}

// GQ-P10 (Befund N-2): die in DIESEM Gespraech bereits notierten Nachrichten, in der
// Reihenfolge ihrer Entstehung. Reiner Leser.
//
// GQ-P4 entdoppelt nur INHALTSGLEICHE Nachrichten (actionItemKey). Das Modell formuliert
// aber jedes Mal neu, also greift der Riegel nie - live entstanden drei Eintraege fuer
// einen Sachverhalt ("Fahrzeugschein mitbringen", "Die Werkstatt bittet Antonio, den
// Fahrzeugschein mitzubringen", ...). Die Wurzel ist nicht die Aehnlichkeitsschwelle,
// sondern dass das Modell NIE erfaehrt, was es schon notiert hat. Dieselbe Blindheit wie
// bei der eingetroffenen Rueckfrage-Antwort (GQ-P8).
//
// s.actionItems traegt die neuesten zuerst (unshift in addActionItem) - hier umgedreht,
// damit der Prompt die Gespraechs-Chronologie zeigt und nicht ihre Umkehrung.
export function callActionItems(s, callId) {
  return s.actionItems.filter((item) => item.callId === callId).reverse();
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

// Die vier Termin-Felder reisen ausnahmslos zusammen -> EIN Objekt statt vier Positionen
// (kein Vertauschen von title/startIso/endIso mehr moeglich). Hier lebt die Shape; beide
// Store-Fassaden (json.js/pg.js) reichen das Objekt nur durch.
export function addCalendarEvent(s, { tenantId, title, startIso, endIso }) {
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
// gewinnt. provider default DEFAULT_PROVIDER (seit C-P1 Telnyx).
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
    cancelAtPeriodEnd,
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
  // 312k-P1 Teil B: Kuendigungsvormerkung zum Periodenende (true) bzw. deren Ruecknahme
  // (false) - selektiver Patch-Key wie die uebrigen Felder oben (webhook.js setzt ihn
  // explizit, nie implizit ueber ein anderes Feld).
  if (cancelAtPeriodEnd !== undefined) tenant.stripeCancelAtPeriodEnd = cancelAtPeriodEnd;
  return tenant;
}

// LCT P6: leitet die Tenant-Kostendecke aus dem EFFEKTIVEN Plan-Slug ab und schreibt sie
// als tenant_budget-Zeile. Laeuft NACH setTenantSubscription (der Patch ist dann schon
// angewendet), also ist tenant.stripePlanSlug bereits der EFFEKTIVE Slug -
// patch.planSlug ?? bestehender Slug ergibt sich hier gratis, ohne das Patch-Feld zu lesen
// (G31: Struktur statt Konvention).
//
// VIER Slug-Faelle plus EIN Satz-Fall, strikt getrennt (die Verwechslung baut den
// Abo-ohne-Nummer-Vorfall neu):
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
//   (2) Slug gesetzt+bekannt   -> Decke ableiten und setzen.
//   (3) KATALOG-Slug OHNE Kopffreiheit-Eintrag (CATALOG_SLUGS/PLAN_CAP_HEADROOM auseinander-
//       gelaufen, Konfig-Inkohaerenz, am Boot fatal via planCapUnderivableFindings) -> planCapCents
//       WIRFT, bevor setTenantBudget schreibt (kein Torn Write). Der isKnownPlanSlug-Riegel
//       aus (1b) faengt DIESEN Fall NICHT ab (der Slug IST im Katalog) - er bleibt der
//       Riegel gegen Konfig-Drift, ist aber bei kohaerenter Konfiguration zur Laufzeit
//       unerreichbar (erste Linie am Boot ist fatal).
//   (4) Slug bekannt, aber der BUCHUNGSSATZ ist 0 (VOICE_TARIFF_DEFAULT_CENTS=0, die
//       dokumentierte Abschaltung der Kosten-Achse) -> abgeleitete Decke 0 -> NO-OP +
//       LAUTE WARN. Eine 0-Decke waere kein strengeres Gate, sondern Telefonie-
//       Totalausfall fuer diesen Tenant (effectiveCapCents liefert die Zeile,
//       budgetExceeded ist ab dem ersten Cent true). Gleiche Entscheidung wie
//       seedTenantDefaultBudget ("0 -> kein Seed, kein 0-Cap-Tenant").
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
  // Plan-Bezeichner, keine PII/kein Secret.
  if (!isKnownPlanSlug(slug)) {
    console.warn(
      `[budget] plan-cap grund=slug_unbekannt slug=${slug} tenant=${tenantId} -> ` +
        "Ableitung uebersprungen (bestehende Decke bleibt, Tenant-Achse fail-closed)",
    );
    return;
  }
  // KS-P9/E10: die Plan-Decke wird NICHT mehr auf die Plattform-Zahl geklemmt. Die Klemme
  // existierte, weil der Plattform-Cap zuerst band; ohne Sperrwirkung wuerde sie nur noch
  // verkaufte Leistung kuerzen, ohne irgendetwas zu schuetzen.
  const capCents = planCapCents(slug, cfg); // Fall (3): wirft nur bei Katalog-Slug OHNE Kopffreiheit
  // Fall (4), KS-P5a: die Decke folgt seit E5a dem Buchungssatz - ist der 0, ist auch die
  // Decke 0. Bestehende Decke bleibt (fail-closed: die zuletzt abgeleitete Grenze bindet
  // weiter), der Grund steht im Log. Der Satz ist eine Betreiber-Zahl, kein Secret/PII.
  if (capCents <= 0) {
    console.warn(
      `[budget] plan-cap grund=tarif_null slug=${slug} tenant=${tenantId} -> ` +
        "Ableitung uebersprungen (bestehende Decke bleibt, VOICE_TARIFF_DEFAULT_CENTS=0)",
    );
    return;
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
    // 312k-P1 Teil B: Kuendigungsvormerkung zum Periodenende. Fail-closed Default false
    // (nie undefined) - Muster numberSetupFeeExempt/activationPending.
    cancelAtPeriodEnd: tenant?.stripeCancelAtPeriodEnd ?? false,
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

// Status eines laufenden Gespraechs. Benannt statt Literal (G11) - dieselbe Bedeutung wie
// in activeCallsFor(:1463) und pg.js deleteMissingCallsKeepActive.
const CALL_STATUS_ACTIVE = "active";

// ---- OUTBOUND-E1: die EINE Quelle der Wahrheit "ist diese Nummer plattform-gebunden?" ----
// REIN, IO-frei, ohne Seiteneffekt, kein Date.now. Liefert ALLE offenen Bindungen (released_at
// null) dieser e164 (Plural! - das Datenmodell traegt bewusst KEIN (e164)-Unique, sondern einen
// Teilindex auf (e164, purpose): eine Nummer kann mehr als eine Rolle gleichzeitig tragen,
// z.B. die eigene Kunden-Bindung UND die geteilte Plattform-ANI-Bindung. Ein `.find()`, das nur
// die ERSTE offene Bindung zurueckgibt, beantwortet "was ist die erste?" statt "ist sie
// gebunden?" - EMPIRISCH als Review-Befund E1-01 belegt: bei zwei offenen Bindungen auf
// derselben Nummer liess das fruehere Einzel-Praedikat den Aufrufer die FALSCHE (die eigene)
// sehen und den irreversiblen Provider-DELETE trotz fortbestehender Plattform-Bindung starten.
// Leere/fehlende e164 -> [] : eine Nummer ohne E.164 kann keine Plattform-Rolle tragen (Muster
// numberRecordByE164:1624).
// Es gibt bewusst KEINEN zweiten Ort, der diese Frage beantwortet - der Ausfall vom
// 24.08. entstand daraus, dass sie gar nicht gestellt wurde; ein zweiter Ort waere die
// naechste Gelegenheit, dass zwei Antworten auseinanderlaufen.
// Linearer Scan ueber den hydrierten Spiegel: bei einer Handvoll Bindungen die einfachste
// funktionsfaehige Loesung. Zielzustand (Mehr-Nummern-Betrieb) ist ein indizierter
// DB-Treffer ueber den bereits gelegten Teilindex - bewusste Zwischenstufe, PLAN BA-13.
// "state"/"binding" statt der im Rest der Datei ueblichen einbuchstabigen Namen (G16/N1,
// eslint id-length): eine Bestandsdatei mit bereits gepinnter Altlast darf durch neuen Code
// NICHT weiter wachsen (Altlast-Ratsche, test/check-staged-suppressions.test.js) - der Pin
// ist ohne Owner-Freigabe unantastbar, also bleibt der ganze OUTBOUND-E1-Block darunter.
//
// Review-Befund E1-S2-2: "offen" (releasedAt===null) UND "(e164,purpose) offen finden" waren
// an vier bzw. zwei Stellen handgerollt kopiert. EINE Quelle je Frage, rein, ohne Seiteneffekt:
function isOpenBinding(binding) {
  return binding.releasedAt === null;
}

function findOpenBinding(state, e164, purpose) {
  return state.platformNumberUse.find(
    (binding) => binding.e164 === e164 && binding.purpose === purpose && isOpenBinding(binding),
  );
}

// Zeitstempel fuer eine geschlossene Bindung (Surrogatschluessel, kein Ueberschreiben -
// Historie bleibt stehen). EINE Quelle statt der drei Kopien in
// unbindPlatformNumber/unbindOwnPlatformBindings/syncPlatformBindings (Review-Befund
// E1-S2-2) - aber OHNE das zu schliessende Objekt als Funktionsparameter zu nehmen:
// eine Zuweisung an eine Property eines Funktionsparameters ist genau die Altlast, die
// die Ratsche in dieser Datei einfriert (no-param-reassign, Review-Blocker Runde 3). Die
// eigentliche Zuweisung passiert deshalb an jedem Aufrufer selbst, auf dessen lokaler
// Schleifen-/const-Variable (nie auf einem Parameter dieser Datei-Funktionen) - geteilt
// bleibt nur das "wie" (ISO-Jetzt), nicht mehr die Zuweisung.
function closingTimestamp() {
  return new Date().toISOString();
}

export function platformNumberBindings(state, e164) {
  if (!e164) return [];
  return state.platformNumberUse.filter((binding) => binding.e164 === e164 && isOpenBinding(binding));
}

// Review-Befund E1-S2-3: "gehoert diese Bindung dem Tenant?" stand zweimal, nicht komplementaer
// formuliert (numberBusyReason vs. unbindOwnPlatformBindings) - bei tenantId=null stuften beide
// Stellen dieselbe Bindung gegensaetzlich ein. EINE Quelle, strikte Gleichheit, keine
// Sonderbehandlung von null hier - eine etwaige Sonderrolle von null gehoert an den Aufrufer
// (s. numberBusyReason unten), NICHT ins Praedikat selbst.
function bindingBelongsTo(binding, tenantId) {
  return binding.tenantId === tenantId;
}

// Darf DIESE Nummer stillgelegt/freigegeben werden - und wenn nein, warum nicht?
// EINE Regel-Quelle (G5) fuer Ebene A (transitionNumber) UND Ebene B (numberReleaseVerdict,
// tenantNumbersForErase). REIN + IO-frei; liefert einen HOLD-Grund oder null.
//
// Geschaerftes Praedikat (PLAN E-1 "Unbind-Protokoll", PM-24): eine offene Bindung, die dem
// FREIGEBENDEN Tenant selbst gehoert, blockiert NICHT - sie darf mit ihm gehen, die
// Freigabe-Kette loest sie vorher (unbindOwnPlatformBindings). Nur eine Bindung, die NICHT dem
// forTenantId gehoert (geteilte Plattform-Bindung ODER ein FREMDER Tenant), haelt - und zwar
// SOBALD IRGENDEINE der offenen Bindungen dieser Nummer fremd ist (E1-01: bei mehreren
// gleichzeitig offenen Bindungen reicht die eigene NICHT, um alle anderen zu entschaerfen).
// Ohne diese Schaerfung blockierte der Riegel im eigenen Zielzustand (je Tenant-DID eine
// Bindung, E-5) JEDE legitime Kuendigung.
//
// Zweite Invariante: kein Release waehrend eines laufenden Anrufs auf dieser Nummer
// (performNumberRelease prueft s.calls heute NICHT - eine DID kann mitten im Gespraech
// beim Anbieter geloescht werden). HOLD, nicht Block: der Retry-Sweep existiert bereits.
export function numberBusyReason(state, number, { forTenantId = null } = {}) {
  const bindings = platformNumberBindings(state, number.e164);
  // forTenantId=null heisst "kein freigebender Tenant benannt" -> JEDE offene Bindung ist
  // dann fremd (Sonderfall des AUFRUFERS, nicht des Eigentums-Praedikats selbst - s.
  // bindingBelongsTo oben, E1-S2-3).
  const blockedByForeignBinding = bindings.some(
    (binding) => forTenantId === null || !bindingBelongsTo(binding, forTenantId),
  );
  if (blockedByForeignBinding) return NUMBER_HOLD_REASON.PLATFORM_IN_USE;
  if (
    number.e164 &&
    state.calls.some(
      (call) => call.status === CALL_STATUS_ACTIVE && (call.from === number.e164 || call.to === number.e164),
    )
  )
    return NUMBER_HOLD_REASON.ACTIVE_CALL;
  return null;
}

// Bindung oeffnen. Idempotent ueber (e164, purpose): eine bereits offene Bindung wird
// zurueckgeliefert, NICHT verdoppelt (der Teilindex in pg wuerde das ohnehin abweisen -
// hier steht dieselbe Regel backend-frei, damit json und pg nicht auseinanderlaufen).
export function bindPlatformNumber(state, { e164, purpose, provider, tenantId = null, providerNumberId = null, note = null }) {
  const open = findOpenBinding(state, e164, purpose);
  if (open) return open;
  const binding = {
    id: newId("pnu"), e164, purpose, provider, tenantId, providerNumberId,
    boundAt: new Date().toISOString(), releasedAt: null, note,
  };
  state.platformNumberUse.push(binding);
  return binding;
}

// Bindung schliessen (Historie bleibt stehen - Surrogatschluessel, kein Ueberschreiben).
// Idempotent: keine offene Bindung -> null, kein Wurf.
export function unbindPlatformNumber(state, { e164, purpose }) {
  const open = findOpenBinding(state, e164, purpose);
  if (!open) return null;
  open.releasedAt = closingTimestamp();
  return open;
}

// OUTBOUND-E1 (E1-03): schliesst ALLE offenen Bindungen dieser Nummer, die dem FREIGEBENDEN
// Tenant selbst gehoeren (number.tenantId) - Vorstufe einer Freigabe/Kuendigung. Die
// Eigentumsfrage "gehoert die Bindung dem freigebenden Tenant?" wird NUR VON bindingBelongsTo
// (oben) beantwortet (G5, E1-S2-3) - vorher stand dieselbe Bedingung ein zweites Mal, kopiert,
// im Aufrufer (release-reconcile.js), und war bereits von numberBusyReason auf Plural
// umgestellt worden, waehrend der Aufrufer noch die Einzel-Bindung loeste (Mechanismus hinter
// E1-01). Reine Mutation, kein IO, kein Date.now-Vergleich. Liefert die GESCHLOSSENEN
// Bindungs-Objekte (nicht nur eine Anzahl), damit ein Aufrufer sie bei einem nachfolgenden
// Fehler zurueckrollen kann (releasedAt wieder auf null) - Unbind und Freigabe muessen
// GEMEINSAM gelingen oder GEMEINSAM ausbleiben, sonst bliebe eine geschlossene Bindung stehen,
// ohne dass die Nummer je freigegeben wurde (E1-02).
export function unbindOwnPlatformBindings(state, number) {
  // Gleiche Wache wie platformNumberBindings: eine Nummer ohne E.164 kann keine
  // Plattform-Rolle tragen, also auch keine eigene Bindung zu schliessen haben.
  if (!number.e164) return [];
  const closed = [];
  for (const binding of platformNumberBindings(state, number.e164)) {
    if (!bindingBelongsTo(binding, number.tenantId)) continue;
    binding.releasedAt = closingTimestamp();
    closed.push(binding);
  }
  return closed;
}

// Idempotenter Abgleich der ABGELEITETEN Bindungen (Boot). desired = die VOLLSTAENDIGE
// Soll-Menge je Rolle; ein Eintrag ohne e164 heisst "diese Rolle hat heute keine Bindung"
// und schliesst eine bestehende. Ohne dieses Schliessen bliebe nach einer Aenderung von
// PLATFORM_ANI_E164 die ALTE Bindung offen - und die alte Nummer damit fuer immer
// eingefroren; genau der Rueckbau-Hebel des Plans ("PLATFORM_ANI_E164='' -> keine
// Bindung -> Bestandsverhalten") haette dann nicht funktioniert.
// Zweimal booten -> identischer Zustand (Abnahme).
export function syncPlatformBindings(state, desired) {
  for (const { purpose, e164, provider, tenantId = null, note = null } of desired) {
    for (const binding of state.platformNumberUse)
      if (binding.purpose === purpose && isOpenBinding(binding) && binding.e164 !== e164)
        binding.releasedAt = closingTimestamp();
    if (e164) bindPlatformNumber(state, { e164, purpose, provider, tenantId, note });
  }
  return state.platformNumberUse.filter(isOpenBinding);
}

// Zustaende, die eine Nummer aus dem Routing nehmen. Eine suspendierte Nummer routet
// genauso wenig wie eine freigegebene - der Riegel gilt fuer BEIDE (PLAN E-1).
const NUMBER_OUT_OF_SERVICE = new Set([NUMBER_STATUS.RELEASED, NUMBER_STATUS.SUSPENDED]);

// Validierte Zustandsaenderung (fail-closed: illegaler Uebergang wirft). Reine
// Status-Mutation; activate/fail/release setzen Zusatzfelder.
export function transitionNumber(s, numberId, toStatus) {
  const number = findNumber(s, numberId);
  if (!number) throw new Error(`transitionNumber: Nummer ${numberId} nicht gefunden`);
  if (!canTransitionNumber(number.status, toStatus))
    throw new Error(`transitionNumber: illegaler Uebergang ${number.status} -> ${toStatus}`);
  // OUTBOUND-E1, EBENE A: der EINE Engpass. transitionNumber ist der einzige Schreiber
  // von number.status im ganzen Repo (grep "\.status *=" -> nur diese Zeile) - dieser
  // Riegel deckt damit JEDEN Code-Pfad, heute und kuenftig, ohne dass ein kuenftiger
  // Aufrufer daran denken muesste. Er sitzt bewusst HIER und nicht in releaseNumber:
  // sonst braeuchte ein spaeterer Suspend-Pfad eine zweite, kopierte Bedingung.
  if (NUMBER_OUT_OF_SERVICE.has(toStatus)) {
    const busy = numberBusyReason(s, number);
    if (busy)
      throw new Error(
        `transitionNumber: Nummer ${numberId} ist gesperrt (${busy}) - Uebergang nach ${toStatus} abgelehnt`,
      );
  }
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

// Freigabe (terminal): status released + assignment schliessen (released_at) + e164 LEEREN.
// e164 leeren (Owner-Entscheidung F-9): number.e164 ist global UNIQUE (schema.sql:646).
// Blieb die e164 an der released-en Zeile stehen, liefe ein spaeterer Wiederkauf DERSELBEN
// Nummer in eine UNIQUE-Verletzung - unter FORCE-RLS mit einer Meldung, die auf eine fuer
// die Session unsichtbare Zeile zeigt. "Wir holen die alte Nummer zurueck" waere damit kein
// verfuegbarer Wiederherstellungsweg. Die Historie Nummer<->Tenant geht nicht verloren:
// sie liegt in numberAssignments (schema.sql:677-683).
// Blast-Radius geprueft - JEDER e164-Leser filtert auf status active und sieht released-e
// Zeilen ohnehin nie: numberRecordByE164(:1624), findActiveNumber(views.js:58),
// activeNumberFor(views.js:93). seedBootstrapNumber(:1674) prueft e164-Kollision ohne
// Status-Filter - genau dort ist das Leeren die gewollte Wirkung. migrate.js:100
// (countryForE164) ist null-sicher (defaults.js:885).
export function releaseNumber(s, numberId) {
  const number = transitionNumber(s, numberId, NUMBER_STATUS.RELEASED);
  number.e164 = null;
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
//   hold   : dieselbe Release-Reife, aber provider!=="telnyx" (manuell - fuer fremde/
//            Alt-Provider gibt es keinen Release-Pfad).
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
  // OUTBOUND-E1, EBENE B: das Verdikt HAELT, bevor der irreversible Provider-DELETE
  // startet (performNumberRelease loescht beim Anbieter VOR der Store-Mutation,
  // release-reconcile.js:61 vor :70). Ein Riegel, der erst in releaseNumber greift,
  // kaeme fuer die Nummer beim Anbieter zu spaet.
  // VOR der Telnyx-Pruefung, damit der Betreiber den wichtigeren Grund im Audit sieht.
  const busy = numberBusyReason(s, number, { forTenantId: number.tenantId });
  if (busy) return { action: RELEASE_VERDICT.HOLD, reason: busy };
  if (number.provider !== PROVIDER.TELNYX)
    return { action: RELEASE_VERDICT.HOLD, reason: NUMBER_HOLD_REASON.NON_TELNYX };
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
// Weiterhin Telnyx-only (nur Telnyx hat einen releaseNumber-Pfad -> non-telnyx bleibt
// unangetastet) und active-only. Der active-Filter IST die Idempotenz-Garantie: ein zweiter
// Erase-Lauf findet die schon released-en Nummern NICHT mehr -> kein zweiter Provider-DELETE.
// REIN + IO-frei (mutiert s NICHT, kein Date.now): der eigentliche Release (Provider-DELETE +
// Store-Mutation + Audit) laeuft im Orchestrator (release-reconcile.js), NICHT hier.
// OUTBOUND-E1: liefert KOERBE, keinen Filter (Muster classifyNumbersForRelease:2601).
// Ein Filter waere SCHLECHTER als der Ist-Zustand, am Code belegt: releaseTenantNumbers-
// OnErase (release-reconcile.js:144-156) zaehlt aborted nur fuer VERARBEITETE Kandidaten.
// Eine herausgefilterte Nummer waere kein Kandidat -> released=0, aborted=0 ->
// contract-end-cleanup.js:91 setzt numberReleasePending=false -> setContractEndCleanup-
// Pending markiert die Kuendigung als erledigt -> der Retry-Sweep findet den Tenant NIE
// wieder. Der Freigabeauftrag verfiele STILL (PM-18). Deshalb: disjunkte Koerbe,
// und der Orchestrator zaehlt jeden HOLD als aborted + schreibt eine Audit-Zeile.
// Diese Funktion bleibt REIN + IO-frei (sie kann selbst keine Audit-Zeile schreiben).
export function tenantNumbersForErase(s, tenantId) {
  const buckets = { release: [], hold: [] };
  for (const n of s.numbers) {
    if (n.tenantId !== tenantId) continue;
    if (n.status !== NUMBER_STATUS.ACTIVE) continue;
    if (n.provider !== PROVIDER.TELNYX) continue;
    const busy = numberBusyReason(s, n, { forTenantId: tenantId });
    if (busy) buckets.hold.push({ number: n, reason: busy });
    else buckets.release.push(n);
  }
  return buckets;
}

// ---- 312k-Phase 4: Vertragsende-Aufraeumarbeiten nach KUENDIGUNG ----
// Owner-Entscheidung: Rufnummer freigeben + WorkOS-Identitaet loeschen duerfen NUR
// erfolgen, wenn der Vertrag durch eine KUENDIGUNG endete (cancelAtPeriodEnd war zuvor
// gesetzt) - NIE bei blossem Zahlungsausfall. Diese Unterscheidung selbst lebt in
// billing/webhook.js (liest cancelAtPeriodEnd VOR dem Suspend); hier nur der Fortschritts-
// Speicher der beiden Teilschritte, damit ein fehlgeschlagener Versuch (Provider-Fehler/
// Netz/fehlender Schluessel) NICHT verloren geht, sondern ein spaeterer Sweep ihn erneut
// versucht (Muster suspended_at/billingHold: selektiver Patch, reine Mutation, kein IO).
//
// numberReleasePending/workosDeletePending sind UNABHAENGIG: der eine Teilschritt kann
// gelingen, waehrend der andere offen bleibt - getrennte Felder statt eines einzelnen
// Sammel-Flags, damit ein spaeterer Sweep gezielt nur den noch offenen Teil erneut anstoesst.
export function setContractEndCleanupPending(
  s,
  tenantId,
  { numberReleasePending, workosDeletePending } = {},
) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) return null;
  if (numberReleasePending !== undefined) tenant.numberReleasePending = numberReleasePending;
  if (workosDeletePending !== undefined) tenant.workosDeletePending = workosDeletePending;
  return tenant;
}

// Fail-closed Default false (nie undefined) - Muster tenantSubscription/activationPending.
export function contractEndCleanupPending(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  return {
    numberReleasePending: tenant?.numberReleasePending ?? false,
    workosDeletePending: tenant?.workosDeletePending ?? false,
  };
}

// Selektor fuer den periodischen Retry-Sweep (Muster classifyNumbersForRelease-Aufrufer):
// NUR Tenants, bei denen mindestens ein Teilschritt noch offen ist. Ein Tenant, dessen
// Vertrag durch Zahlungsausfall endete, hat BEIDE Felder nie gesetzt (false) und taucht
// hier folglich NIE auf - die Felder werden ausschliesslich vom Kuendigungs-Pfad gesetzt.
export function tenantsPendingContractEndCleanup(s) {
  return tenantsOf(s).filter((t) => t.numberReleasePending || t.workosDeletePending);
}

// Liest die WorkOS-Identitaet (sub, aus dem verifizierten IdP-Profil beim Login gebunden,
// s. registerTenant/resolveOrCreateTenant idp_subject) eines Tenants. Reine Query, kein IO.
// Genutzt vom Vertragsende-Aufraeumen (312k-Phase 4): die Nutzer-Kennung fuer die WorkOS-
// Loeschung kommt AUSSCHLIESSLICH aus diesem beim Login gespeicherten Feld, nie aus einem
// Request-Body (kein Spoofing).
export function tenantIdpSubject(s, tenantId) {
  return findTenant(s, tenantId)?.idpSubject ?? null;
}

// ---- 312k-Phase 5: Kuendigungsbestaetigung per E-Mail (§ 312k BGB) ----
// Fortschritts-Speicher EXAKT im Muster von setContractEndCleanupPending/
// contractEndCleanupPending/tenantsPendingContractEndCleanup (312k-Phase 4, oben): ein
// fehlgeschlagener/uebersprungener Versandversuch (SMTP nicht erreichbar, nicht
// konfiguriert, keine Adresse) geht NICHT verloren, sondern bleibt am Tenant offen
// vermerkt und wird von einem spaeteren Sweep erneut versucht (billing/cancellation-mail.js).
//
// receivedAt (ISO-Zeitstempel des Kuendigungs-EINGANGS, § 312k verlangt genau diesen
// Zeitpunkt in der Bestaetigung) wird EINMAL beim Ausloesen der Kuendigung gesetzt
// (self-service-routes.js cancel-Route) und bleibt danach unveraendert stehen - jeder
// Sweep-Versuch liest denselben Eingangszeitpunkt, NIE ein neues "jetzt" der Retry-Zeit.
export function setCancellationMailPending(s, tenantId, { pending, receivedAt } = {}) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) return null;
  if (pending !== undefined) tenant.cancellationMailPending = pending;
  if (receivedAt !== undefined) tenant.cancellationMailReceivedAt = receivedAt;
  return tenant;
}

// Fail-closed Default false (nie undefined) - Muster contractEndCleanupPending.
export function cancellationMailPending(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  return {
    pending: tenant?.cancellationMailPending ?? false,
    receivedAt: tenant?.cancellationMailReceivedAt ?? null,
  };
}

// Selektor fuer den periodischen Retry-Sweep - Muster tenantsPendingContractEndCleanup.
export function tenantsPendingCancellationMail(s) {
  return tenantsOf(s).filter((t) => t.cancellationMailPending);
}

// ---- Stripe-Abgleich-Sweep (verlorene Webhooks selbstheilen) ----
// Selektor fuer runStripeSubscriptionReconcile (billing/stripe-reconcile.js): NUR Tenants,
// die ein gespeichertes Abo haben UND nicht bereits suspendiert sind. Hintergrund (Betreiber-
// Befund 2026-08-13, Stripe-Dashboard): auf dem kostenlosen Render-Plan schlaeft der Dienst,
// das Aufwachen dauert laenger als Stripes Webhook-Timeout - nachweislich sind Events nach
// Ablauf ALLER Stripe-Retries (~3 Tage) endgueltig verloren gegangen. Ein verlorenes
// customer.subscription.deleted hiesse sonst: Kunde nie gesperrt, Rufnummer nie freigegeben.
// suspendedAt als Ausschluss (nicht ein eigenes Flag): der Suspend-Zweig stempelt es immer
// (setSuspendedAtIfAbsent), ACTIVATE loescht es - ein geheilter Tenant faellt damit von
// selbst aus dem Selektor (Idempotenz, Muster tenantsPendingContractEndCleanup), ein
// reaktivierter kommt von selbst wieder hinein. REIN + IO-frei (mutiert s NICHT).
export function tenantsForStripeReconcile(s) {
  return tenantsOf(s).filter((t) => t.stripeSubscriptionId && !t.suspendedAt);
}

// ---- Newsletter-Einwilligung pro Tenant (Opt-in, DSGVO Art. 7 Abs. 1) ----
// Setzt die Newsletter-Einwilligung eines Tenants. Lebt am Tenant-RECORD (NICHT in
// settings): sie ist eine Einwilligung der Person/des Accounts, keine Agent-Verhaltens-
// Einstellung - dieselbe H4-Begruendung wie bei privateNumber (settings leakt komplett
// ueber /api/state + MCP; eine Einwilligung gehoert nicht in diesen Strahl, s. schema.sql).
// NUR strikt boolean: fail-closed wie setKycLevel/setPrivateNumber - jeder andere Wert
// (Freitext/Zahl/undefined/null) wirft VOR jeder Mutation, statt einen Muell-Wert zu
// persistieren, der spaeter als "eingewilligt" fehlinterpretiert werden koennte (Opt-in
// darf NIE stillschweigend entstehen). newsletterConsentAt traegt den ISO-Zeitstempel
// DIESES Zustandswechsels (Opt-in ODER Widerruf setzen ihn gleichermassen, EINE
// Schreibstelle - Muster setOnceTimestamp-Nachbarn, aber bewusst NICHT set-once: jeder
// Wechsel soll den Stand ueberschreiben). Der vollstaendige, unveraenderliche Nachweis
// (wer/wann/welcher Zustand, Art. 7 Abs. 1) liegt zusaetzlich im audit_log (Route-Layer,
// Muster 312k-P3 Kuendigungs-Nachweis) - dieses Feld ist nur die schnelle Lese-Sicht.
// Fehlender Tenant -> throw (Muster setKycLevel/setPrivateNumber, kein stilles No-Op).
// Reine Mutation, kein IO (Wrapper saved). Liefert den Tenant.
export function setNewsletterConsent(s, tenantId, consent) {
  if (typeof consent !== "boolean")
    throw new Error("setNewsletterConsent: consent muss boolean sein");
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`setNewsletterConsent: Tenant ${tenantId} nicht gefunden`);
  tenant.newsletterConsent = consent;
  tenant.newsletterConsentAt = new Date().toISOString();
  return tenant;
}

// Lese-Query der Newsletter-Einwilligung (Muster tenantPrivateNumber/cancellationMailPending):
// fail-closed Default { consent: false, consentAt: null } - ein Tenant ohne Zeile/Feld ist
// NIE "eingewilligt" (der Opt-in-Grundsatz gilt auch beim Lesen, kein stiller Vorangekreuzt-
// Zustand). Reine Query, kein IO.
export function tenantNewsletterConsent(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  return {
    consent: tenant?.newsletterConsent === true,
    consentAt: tenant?.newsletterConsentAt ?? null,
  };
}

// ---- Newsletter-Zusatzempfaenger (Double-Opt-in) ----
// Additiv NEBEN dem Boolean-Consent-Pfad oben: newsletterConsent/newsletterConsentAt steuern
// weiterhin AUSSCHLIESSLICH die Konto-Adresse. newsletterRecipients ist eine EIGENE, zweite
// Empfaengerliste je Tenant fuer beliebige Zusatzadressen (Owner-Auftrag F2-Newsletter-
// Recipients) - beide Achsen sind orthogonal, ein Tenant kann Consent=false UND bestaetigte
// Zusatzempfaenger haben. Jeder Eintrag: { email, status: "pending"|"confirmed", createdAt,
// confirmedAt, tokenHash, tokenExpiresAt, unsubToken }. tokenHash traegt NUR den SHA256 des
// Bestaetigungs-Tokens (Einmalverwendung, nach Erfolg geleert). unsubToken ist der KLARTEXT-
// Abmelde-Token (bewusste Abweichung vom Feldnamen unsubTokenHash im Auftrag - Begruendung
// src/newsletter-recipients.js newNewsletterTokens).
//
// Gate-Entscheidungen (Format/Duplikat/Cap/Tageslimit) leben in src/newsletter-recipients.js
// (planAddNewsletterRecipient) - hier NUR die Rohdaten-Mutation, kein Fachwissen ueber
// Grenzwerte (G17: state-ops bleibt die reine Datenschicht, Muster createCall/state-ops-weite
// Konvention).

// Lese-Query: ALLE Eintraege eines Tenants (pending + confirmed), Muster tenantPrivateNumber.
// Fail-closed leeres Array (nie undefined) - ein Tenant ohne Zeile hat schlicht keine.
export function tenantNewsletterRecipients(s, tenantId) {
  return findTenant(s, tenantId)?.newsletterRecipients ?? [];
}

// Nur die BESTAETIGTEN Eintraege (mail-summary.js/call-finish.js: Summary-Mail-Ziel).
export function confirmedNewsletterRecipients(s, tenantId) {
  return tenantNewsletterRecipients(s, tenantId).filter((r) => r.status === "confirmed");
}

// Anzahl der ausgeloesten Bestaetigungs-Mails seit sinceIso (Missbrauchsschutz-Tageslimit,
// s. newsletter-recipients.js NEWSLETTER_CONFIRM_MAIL_DAILY_CAP). Reine Query, kein IO.
export function dailyNewsletterConfirmMailCount(s, tenantId, sinceIso) {
  const tenant = findTenant(s, tenantId);
  return (tenant?.newsletterConfirmMailLog ?? []).filter((t) => t >= sinceIso).length;
}

// Legt einen neuen pending-Eintrag an UND vermerkt den Bestaetigungs-Mail-Versuch im
// Tageslimit-Log - EIN Store-Write pro Route-Aufruf (beides gehoert zusammen, s. Aufrufer
// self-service-routes.js). Das Log wird bei jedem Add auf das rollierende 24h-Fenster
// geprunt (kein separater Sweep/Retention-Job noetig - es waechst nur bei aktiver Nutzung).
// Fehlender Tenant -> throw (Muster setKycLevel/setPrivateNumber, kein stilles No-Op). Der
// AUFRUFER (self-service-routes.js) MUSS vorher planAddNewsletterRecipient() pruefen - diese
// Funktion validiert NICHT erneut (Trennung Entscheidung/Mutation, Muster planSummaryMail).
export function addNewsletterRecipient(s, tenantId, { email, tokenHash, tokenExpiresAt, unsubToken, now }) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`addNewsletterRecipient: Tenant ${tenantId} nicht gefunden`);
  const nowIso = now ?? new Date().toISOString();
  tenant.newsletterRecipients ??= [];
  tenant.newsletterRecipients.push({
    email,
    status: "pending",
    createdAt: nowIso,
    confirmedAt: null,
    tokenHash,
    tokenExpiresAt,
    unsubToken,
  });
  const cutoff = new Date(Date.parse(nowIso) - MS_PER_DAY).toISOString();
  tenant.newsletterConfirmMailLog = (tenant.newsletterConfirmMailLog ?? [])
    .filter((t) => t >= cutoff)
    .concat(nowIso);
  return tenant.newsletterRecipients[tenant.newsletterRecipients.length - 1];
}

// Entfernt einen Eintrag (pending ODER confirmed) per Self-Service-Aktion. Idempotent: kein
// Treffer -> No-Op, liefert false (Aufrufer entscheidet ueber die HTTP-Antwort). Fehlender
// Tenant -> throw (Muster addNewsletterRecipient).
export function removeNewsletterRecipient(s, tenantId, email) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`removeNewsletterRecipient: Tenant ${tenantId} nicht gefunden`);
  const before = (tenant.newsletterRecipients ?? []).length;
  tenant.newsletterRecipients = (tenant.newsletterRecipients ?? []).filter((r) => r.email !== email);
  return tenant.newsletterRecipients.length !== before;
}

// Oeffentlicher Bestaetigungs-Pfad (GET /newsletter/confirm): der Request traegt NUR ein
// Token, keine Tenant-/E-Mail-Identitaet - deshalb linearer Scan ueber ALLE Tenants (Muster
// findTenantByCustomer), Cap 5 pro Tenant haelt das klein. safeEqual gegen jeden Kandidaten
// (kein Short-Circuit-String-Vergleich auf einem Secret). Treffer NUR bei status="pending"
// UND nicht abgelaufen (tokenExpiresAt > nowIso) - ein bereits bestaetigter Eintrag hat
// tokenHash=null und matcht nie wieder (Einmalverwendung, keine gesonderte Pruefung noetig).
// Erfolg mutiert (status/confirmedAt gesetzt, tokenHash/tokenExpiresAt geleert) und liefert
// {tenantId, email}; kein Treffer -> null (der Aufrufer zeigt eine neutrale Fehlseite, OHNE
// Aufschluss ueber den Grund - Owner-Auftrag).
export function confirmNewsletterRecipientByToken(s, tokenHash, nowIso) {
  for (const tenant of tenantsOf(s)) {
    const match = (tenant.newsletterRecipients ?? []).find(
      (r) =>
        r.status === "pending" &&
        r.tokenHash &&
        safeEqual(r.tokenHash, tokenHash) &&
        r.tokenExpiresAt > nowIso,
    );
    if (match) {
      match.status = "confirmed";
      match.confirmedAt = nowIso;
      match.tokenHash = null;
      match.tokenExpiresAt = null;
      return { tenantId: tenant.id, email: match.email };
    }
  }
  return null;
}

// Oeffentlicher Abmelde-Pfad (GET /newsletter/unsubscribe): Muster confirmNewsletterRecipient-
// ByToken (linearer Scan, safeEqual), aber OHNE Ablauf (unsubToken ist permanent) und ueber
// JEDEN Status (pending ODER confirmed - beide sollen sich jederzeit abmelden koennen). Ein
// Treffer entfernt den Eintrag vollstaendig (idempotent: ein zweiter Aufruf mit demselben
// Token findet nichts mehr und liefert null, OHNE zu werfen).
export function unsubscribeNewsletterRecipientByToken(s, token) {
  for (const tenant of tenantsOf(s)) {
    const recipients = tenant.newsletterRecipients ?? [];
    const idx = recipients.findIndex((r) => r.unsubToken && safeEqual(r.unsubToken, token));
    if (idx !== -1) {
      const [removed] = recipients.splice(idx, 1);
      return { tenantId: tenant.id, email: removed.email };
    }
  }
  return null;
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

// Punktweise Obergrenze ueber ALLE hinterlegten Staffeln: je Rate das Maximum. Das
// Fail-closed-Ziel fuer eine Modell-ID ohne eigenen Eintrag (P7a, seit B4a punktweise).
// "Der teuerste EINTRAG" genuegte, solange genau EINE Preiswelt hinterlegt war; mit vier
// Raten und einem zweiten Anbieter kann kein einzelner Eintrag mehr garantieren, in JEDER
// Rate der teuerste zu sein - das punktweise Maximum kann es: keine hinterlegte Staffel
// ist in irgendeiner Rate teurer als diese Obergrenze.
//
// Setzt VOLLSTAENDIGE Staffeln voraus. Dafuer sorgt der Boot-Abbruch (resolveModelPrices,
// src/config.js), nicht eine zweite Pruefung hier: ein throw an dieser Stelle killte einen
// laufenden Anruf mit 500, ein NaN liesse den Turn ungebucht (fail-OPEN am Gate).
// Eine LEERE Tabelle wirft weiterhin benannt - ein Startwert 0 waere fail-open (Preis 0 =
// Gate blind, Regel 1). Reine Funktion.
function worstCasePrice(prices) {
  const rates = Object.values(prices);
  if (!rates.length)
    throw new Error("modelPricesUsd ist leer - keine Preisquelle fuer den Budget-Guard (Regel 1)");
  const worst = {};
  for (const field of MODEL_PRICE_RATE_FIELDS)
    worst[field] = rates.reduce((max, price) => (price[field] > max ? price[field] : max), 0);
  return worst;
}

// Preis-Aufloesung PRO MODELL (P7a). Fail-closed: ein Modell, das NICHT in der
// Preistabelle steht, wird mit der punktweisen Obergrenze gebucht - nie mit 0,
// nie mit dem Haiku-Default (Regel 1: ein zu niedriger Preis macht die KI-Kosten-Achse
// des Budget-Gates blind, ein zu hoher ist hoechstens zu streng).
//
// Object.hasOwn statt prices[model]: cfg.modelPricesUsd ist in Produktion ein
// guardedConfig-PROXY, dessen get-Trap bei einem unbekannten Schluessel TypeError WIRFT.
// Ein Roh-Index wuerde den Turn also mit 500 killen statt konservativ zu buchen; hasOwn
// laeuft ueber die has-Trap und damit ungefiltert ans Target. Reine Funktion.
function priceForModel(model, prices) {
  return Object.hasOwn(prices, model) ? prices[model] : worstCasePrice(prices);
}

// Tatsaechlich verarbeitete Eingabe-Token EINES Aufrufs ueber ALLE Eingabe-Preisklassen.
// Aus llm-usage.js hierher gezogen (B4a), weil die Summe seit der Aufschluesselung ZWEI
// Leser hat: den Bucket-Zaehler (trackUsage, unten) und die Ledger-MENGE (meterAiTokens,
// llm-usage.js). Zwei Kopien waeren G5. Ausdruecklich NICHT die Preisbasis - der Preis
// entsteht seit B4a je Sorte (tokenCostUsd). Reine Funktion.
export function inputTokensOf(tokens) {
  return tokens.inputUncachedTokens + tokens.inputCacheWriteTokens + tokens.inputCacheReadTokens;
}

// USD-Kosten EINES Token-Verbrauchs unter der Preisstaffel des buchenden Modells.
// EINE Quelle (G5) der Preisformel: trackUsage (Live-Bucket, Mikro-Cent-Akkumulator)
// UND aiCostCents (Stripe-Meter, Ganzzahl Cents) leiten ihren Betrag hieraus ab.
// tokens = {inputUncachedTokens, inputCacheWriteTokens, inputCacheReadTokens,
// outputTokens, model} - je Token-Sorte (llm/ports.js LlmTokenUsage) ihre eigene Rate.
// Bis B4a wurden alle drei Eingabe-Sorten zur vollen Eingabe-Rate gebucht; bei einem
// Cache-Treffer war das um ein Vielfaches zu teuer (Cache-Lesen kostet ein Zehntel).
function tokenCostUsd(tokens, cfg) {
  const price = priceForModel(tokens.model, cfg.modelPricesUsd);
  return (
    (tokens.inputUncachedTokens / TOKENS_PER_M_TOK) * price.inPerMTok +
    (tokens.inputCacheWriteTokens / TOKENS_PER_M_TOK) * price.cacheWritePerMTok +
    (tokens.inputCacheReadTokens / TOKENS_PER_M_TOK) * price.cacheReadPerMTok +
    (tokens.outputTokens / TOKENS_PER_M_TOK) * price.outPerMTok
  );
}

// KV-P6: EINE Stelle (G5), die den UNGERUNDETEN KI-Kosten-Betrag in Mikro-Cent liefert -
// dieselbe Preisformel wie aiCostCents (Stripe-Meter, GERUNDETE Cents) und derselbe
// Ausdruck, den trackUsage bisher inline fuehrte. Gate-Achse (trackUsage) UND Ledger-
// Schreiber (recordUsageEvent ueber llm-usage.js) rufen AUSSCHLIESSLICH diese Funktion -
// eine zweite, unabhaengig geschriebene Kopie waere genau die Duplizierung, die KV-P6
// beheben soll (zwei Rechnungen, die nur zufaellig uebereinstimmen, sind keine
// Gleichheit). Reine Funktion, kein Runden vor der letzten Multiplikation.
export function tokenCostMicroCents(tokens, cfg) {
  return Math.round(tokenCostUsd(tokens, cfg) * cfg.usdToEur * CENTS_PER_EUR * MICRO_CENTS_PER_CENT);
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

// Sind ALLE Inkremente eines Turns buchbar (G28: zusammengesetzte Bedingung
// eingekapselt)? isBookableCents traegt "Cents" im Namen, ist inhaltlich aber der EINE
// Riegel "endlich, ganzzahlig und nicht negativ" und gilt fuer Token-Zaehler genauso: ein
// NaN-Zaehler vergiftet den Bucket auf demselben Weg. Bewusst EIN Praedikat statt fuenf
// Inline-Kopien. Die vier Token-Sorten (llm/ports.js) und microInc sind produktionsseitig
// immer Ganzzahlen (API-Zaehler bzw. Math.round) - die Ganzzahl-Pruefung aendert hier
// nichts am Bestandsverhalten.
//
// Seit B4a JE SORTE geprueft, nicht auf ihrer Summe: ein +NaN/-NaN-Paar koennte sich in
// einer Summe aufheben, die Reichweite der D7-Sicherung darf nicht schrumpfen.
function turnIncrementsBookable(tokens, microInc) {
  return (
    isBookableCents(tokens.inputUncachedTokens) &&
    isBookableCents(tokens.inputCacheWriteTokens) &&
    isBookableCents(tokens.inputCacheReadTokens) &&
    isBookableCents(tokens.outputTokens) &&
    isBookableCents(microInc)
  );
}

// ---- Spend-Monat-Achse (Budget-Achsen P4): additiv, INERT, kein Gate liest sie ----

// Parst einen ISO-Zeitpunkt zu einem Date oder null, wenn er unlesbar ist. EINZIGE
// Anker-Pruefung ALLER periodischer Achsen dieses Moduls (G5): spendMonthKeyOf,
// ttsCycleKeyOf UND - seit KV-M4 - previousMonthKeyOf leiten ihre Uhr-Anomalie-Behandlung
// ("unlesbar -> null -> kein Reset") aus dieser einen Stelle ab statt sie zu kopieren.
// Reine Funktion.
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

// KV-M4: der zuletzt VOLLSTAENDIG abgeschlossene UTC-Kalendermonat relativ zu nowIso (der
// Monat VOR dem laufenden - der laufende Monat selbst ist strukturell nie abgeschlossen).
// Muster ttsCycleKeyOf (Date VOR der Formatierung verschieben, dieselbe yearMonthKey-
// Zeile). Unlesbarer Anker -> null (fail-closed, Muster spendMonthKeyOf: kein Provider-
// Aufruf aus einer kaputten Uhr). Reine Funktion.
function previousMonthKeyOf(nowIso) {
  const at = parseValidDate(nowIso);
  if (at === null) return null;
  const previous = new Date(at.getTime());
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  return yearMonthKey(previous);
}

// Der SPAETERE aus gespeichertem und laufendem periodischen Schluessel. Zwei
// Schluessel-FORMATE, beide lexikografisch = chronologisch sortierbar -> String-Vergleich
// genuegt, keine zweite Datums-Arithmetik: 'YYYY-MM' (Spend-Monat, TTS-Zyklus, KV-M4-Riegel)
// und ISO-8601 (Stripe-Periodenstart, GAP-01). EINZIGE Monotonie-/Zukunftsschluessel-Regel
// ALLER VIER periodischer Achsen dieses Moduls (G5): der Spend-Monat der Budget-Achse
// (P4/P7, ueber authoritativeSpendMonthKey darunter), der ElevenLabs-Zyklus-Schluessel
// (LCT P7, ttsCycleKeyOf/recordTtsCharacters weiter unten), das Perioden-Fenster des
// Budget-Gates (GAP-01, stampBudgetPeriod) UND - seit KV-M4 - der Riegel der monatlichen
// Gegenprobe (markCrossCheckAttempted) teilen sich denselben Riegel statt ihn dreifach zu
// implementieren.
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
//
// KS-P5: Math.max(0, ...) wie bei der Schwester budgetPeriodUsageCents. Bis KS-P5 KONNTE
// die Monats-Achse nie negativ werden (Gutschriften erreichten sie nicht) - genau deshalb
// fehlte der Riegel. Jetzt kann sie es: der 0-Boden von costCents kappt die Lebenszeit,
// die Monatszahl bekaeme den vollen Betrag ab (Gutschrift 100 auf Bucket 40 -> costCents 0,
// spendMonthCostCents -60). Ein negativer Monatsverbrauch ist ein Guthaben, das ueber
// platformSpendMonthCents in die PLATTFORM-Summe wandert und die Decke fuer ALLE Tenants
// aufweitet.
export function spendMonthUsageCents(bucket, nowIso) {
  if (!spendMonthCounterCurrent(bucket, nowIso)) return 0;
  return Math.max(0, bucket.spendMonthCostCents);
}

// Zeigt der gespeicherte Monatszaehler noch den AUTORITATIVEN Monat? EINE Stelle (G5):
// die Leseprojektion darueber liest daraus ihre 0, die Gutschrift (creditHitsSpendMonth)
// ihre Wirksamkeit. Ohne gemeinsame Quelle koennte eine Gutschrift auf einen Zaehler
// gebucht werden, den der Leser laengst als abgelaufen behandelt. Reine Funktion.
function spendMonthCounterCurrent(bucket, nowIso) {
  return spendMonthWindowKey(bucket, nowIso) === bucket.spendMonthKey;
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
// GENAU EINE benannte Ausnahme (LCT P4, praezisiert in KS-P5): die NEGATIVE Korrektur
// laeuft NICHT hier durch, sondern in applyCreditCents (bookCostCorrectionCents). Der
// Grund ist unveraendert - eine Gutschrift aus einem ABGESCHLOSSENEN Monat darf die
// Monatsdecke nicht zurueckdrehen; ein Cap, den man mit alten Calls aufweiten kann, ist
// kein Cap. NEU ist nur die Feinheit: verworfen wird die Gutschrift jetzt anhand des am
// Call persistierten BELASTUNGS-Ankers, nicht mehr pauschal. Sie bleibt damit
// AUSSCHLIESSLICH dort und ist dort testgepinnt.
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
// tokens = die vier Token-Sorten + model (s. tokenCostUsd); das Modell entscheidet die Preisstaffel
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
  const microInc = tokenCostMicroCents(tokens, cfg);
  // D7-Riegel VOR jeder Mutation: bisher stiegen inputTokens/outputTokens schon, bevor die
  // Kostenrechnung ueberhaupt lief - ein NaN-Turn hinterliess also drei vergiftete Felder.
  // Alles-oder-nichts, kein Teil-Schreibeffekt.
  if (!turnIncrementsBookable(tokens, microInc))
    return discardCorruptWrite(usage, `trackUsage tenant:${tenantId}`, microInc);
  // Summe der drei Eingabe-Sorten - Zahlenwert unveraendert zum Bestand (B4a schluesselt
  // die PREISRECHNUNG auf, nicht den Bucket-Zaehler).
  usage.inputTokens += inputTokensOf(tokens);
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

// KS-P5: trifft die Gutschrift denselben Monat, den die Spend-Monat-Achse GERADE zaehlt?
// Drei Bedingungen, jede traegt:
//   - der Anker existiert (Bestandszeile vor KS-P5 -> null -> nur Lebenszeit; Inbound
//     traegt den Anker seit KV-P2 wie jeder andere gebuchte Call),
//   - er ist derselbe Monat, unter dem der Zaehler steht (Vormonat -> verworfen),
//   - der Zaehler ist ueberhaupt noch der laufende: nach einem Rollover liest die Achse
//     bereits 0, eine Gutschrift dagegen zoege den NEUEN Monat ins Minus.
// Reine Funktion.
function creditHitsSpendMonth(bucket, spendMonthKey, nowIso) {
  return (
    spendMonthKey !== null &&
    spendMonthKey === bucket.spendMonthKey &&
    spendMonthCounterCurrent(bucket, nowIso)
  );
}

// KS-P5: trifft die Gutschrift dasselbe Perioden-Fenster wie die Belastung? Verglichen
// wird der Perioden-STEMPEL zum Zeitpunkt der Belastung mit dem heutigen. stampBudgetPeriod
// ist monoton (laterMonotonicKey) - ein abweichender Stempel heisst deshalb IMMER "die
// Periode ist seither weitergewandert". Beide null (nie gestempelt) ist Gleichheit und
// korrekt: ohne Stempel IST das Fenster die Lebenszeit. Reine Funktion.
function creditHitsBudgetPeriod(bucket, periodKey) {
  return periodKey === bucket.budgetPeriodKey;
}

// KS-P5: DIE Gutschrift. Drei Achsen, EIN wirksamer Betrag.
//   1. Lebenszeit (costCents): immer, mit 0-BODEN. Der Boden kappt den Betrag; alles
//      Weitere rechnet mit dem GEKAPPTEN Wert, damit die Achsen nicht auseinanderlaufen.
//   2. Spend-Monat: nur, wenn die Belastung im gerade gezaehlten Monat gebucht wurde.
//   3. Perioden-Fenster: es ist eine ABLEITUNG (costCents - Baseline), also senkt jede
//      Gutschrift es automatisch mit. Gehoert die Belastung NICHT ins laufende Fenster,
//      wandert die Baseline um denselben Betrag mit - das Fenster bleibt unberuehrt,
//      obwohl die Lebenszeit sinkt ("sonst nur Lebenszeit"). Ohne diese Kompensation
//      weitete JEDE alte Gutschrift die Perioden-Decke auf; auf DIESER Achse gibt es den
//      Missbrauchsschutz vor KS-P5 ueberhaupt nicht.
// Der Baseline-Riegel Math.max(0, ...) haelt die Invariante baseline <= costCents: die
// Baseline ist ein costCents-Schnappschuss und darf nie negativ werden (sonst waere das
// Fenster GROESSER als die Lebenszeit). Reine Mutation, Nebeneffekt im Namen (N7).
function applyCreditCents(usage, { deltaCents, chargeAnchors, nowIso }) {
  const vorher = usage.costCents;
  usage.costCents = Math.max(0, vorher + deltaCents);
  const wirksam = usage.costCents - vorher; // <= 0, durch den 0-Boden gekappt
  if (creditHitsSpendMonth(usage, chargeAnchors.spendMonthKey, nowIso))
    usage.spendMonthCostCents += wirksam;
  if (!creditHitsBudgetPeriod(usage, chargeAnchors.periodKey))
    usage.budgetPeriodBaselineCents = Math.max(0, usage.budgetPeriodBaselineCents + wirksam);
}

// LCT P4 / KS-P5, DIE Cent-Schreibkante der Korrektur. EIGENES Praedikat isCorrectionCents
// (Vorzeichen erlaubt) - isBookableCents bleibt unangetastet. Vier Regeln, alle Sicherungen:
//   1. 0-BODEN: usage.costCents faellt NIE unter 0 (ein negativer Lebenszeit-Wert ist fuer
//      isBookableCents unbuchbar -> spendOrDeny sperrt den Tenant mit Grund usage_korrupt;
//      eine Gutschrift, die den Kunden sperrt).
//   2. POSITIVE Korrekturen gehen unveraendert ueber bookCents auf beide Achsen.
//   3. NEGATIVE Korrekturen (Gutschriften) gehen ueber applyCreditCents und wirken je
//      Achse NUR, wenn der BELASTUNGS-Anker dieselbe Achsen-Zahl trifft. Der Anker ist
//      der Achsen-Stempel zum Zeitpunkt der Belastung (chargeAnchorsOfCall), NIE der
//      Zeitpunkt der Korrektur und NIE call.startedAt.
//   4. deltaCents === 0 beruehrt KEINE Achse (kein Phantom-Monatsstempel ueber
//      bookCents(0)) - der Lauf gilt trotzdem als gebucht, s. applyCostCorrectionCents.
// Liefert { usage, booked }. Nebeneffekt im Namen (N7). Optionsobjekt statt fuenftem
// Positionsargument (F1).
export function bookCostCorrectionCents(s, { tenantId, deltaCents, chargeAnchors, nowIso }) {
  const usage = usageFor(s, tenantId);
  if (!isCorrectionCents(deltaCents))
    return { usage: discardCorruptWrite(usage, `bookCostCorrectionCents tenant:${tenantId}`, deltaCents), booked: false };
  if (deltaCents > 0) bookCents(usage, deltaCents, nowIso);
  else if (deltaCents < 0) applyCreditCents(usage, { deltaCents, chargeAnchors, nowIso });
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
  { actualCostMicroCents, estimatedCostCents, providerToBucketRateMicro, dataComplete,
    // KS-P5: die Anker der BELASTUNG. Fehlen sie (Bestandszeile vor KS-P5, Aufrufer ohne
    // Call), gilt NO_CHARGE_ANCHORS - die Gutschrift bleibt auf der Lebenszeit-Achse und
    // damit auf dem Bestandsverhalten. Das ist die STRENGSTE Variante, nicht die
    // lockerste; ein vergessener Aufrufer verliert hier keine Sicherung.
    chargeAnchors = NO_CHARGE_ANCHORS }, nowIso) {
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
  const booked = bookCostCorrectionCents(s, { tenantId, deltaCents, chargeAnchors, nowIso });
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
// Tenants ohne Zeile wirkungslos und der Cap ein GETEILTER Topf.
//
// KS-P9/E10: die Plattform-Achse trifft keine Sperrentscheidung mehr (nur noch Messung +
// Warnschwelle). Stufe (3) ist deshalb KEINE Plattform-Summe, sondern der PRO-TENANT-
// FALLBACK bei Sentinel defaultTenantBudgetCents=0 - dieselbe Zahl, aber pro Tenant
// angelegt. Sie zu entfernen waere fail-open (Tenant ganz ohne Decke) und damit genau der
// verbotene Fall; globalCapCents bleibt deshalb bestehen.
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
// Plattform-Achse (gatePlatformUsageCents), die seit KS-P9/E10 nur noch die BEOBACHTUNG
// speist (claimPlatformSpendWarning) und keine Sperrentscheidung mehr traegt.

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

// Liest den Gate-Verbrauch (ueber die Aufloesung oben) + wendet den D7-Riegel an. Seit
// KS-P9 bleibt genau EIN Aufrufer (tenantSpendOrDeny) - der Rumpf wird bewusst nicht
// dorthin inlined, weil das die fail-closed D7-Kante der TENANT-Geldkante editieren wuerde;
// die pro-Tenant-Achse bleibt in dieser Phase byte-identisch.
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
// D7-Riegel der TENANT-Achse als reines Praedikat, OHNE Log (G28: zusammengesetzte
// Bedingung eingekapselt). Zwei Kanten teilen sich denselben Riegel und unterscheiden
// sich NUR in der Reaktion: die GATE-Kante (spendOrDeny) benennt den vergifteten Wert
// per denyCorruptUsage und sperrt; die ANZEIGE-Kante (tenantBudgetSnapshot) rendert
// stattdessen einen ziffernfreien Sperrtext und loggt bewusst nicht (/api/state ruft sie
// bei JEDEM Dashboard-Poll - ein dauerhaft vergifteter Bucket erzeugte sonst eine
// Log-Flut). Beide pruefen BEIDE Groessen: eine Kante, die nur ihre eigene Seite pruefte,
// verkleinerte die Reichweite der Sicherung.
function usageAxesBookable({ gateCents, lifetimeCents }) {
  return isBookableCents(gateCents) && isBookableCents(lifetimeCents);
}

function spendOrDeny({ label, gateCents, lifetimeCents }) {
  if (usageAxesBookable({ gateCents, lifetimeCents })) return { deny: false, spent: gateCents };
  const gateBookable = isBookableCents(gateCents);
  const feld = gateBookable ? "lifetimeCents" : "gateCents";
  denyCorruptUsage(label, feld, gateBookable ? lifetimeCents : gateCents);
  return { deny: true };
}

// EINE Quelle (G5) fuer die zwei Verbrauchsgroessen der TENANT-Achse: die aufgeloeste
// Gate-Groesse und den Lebenszeit-Wert als UNABHAENGIGE Gegenprobe (NICHT die
// Gate-Groesse selbst). Seit KS-P4 lesen Gate-Entscheidung (tenantSpendOrDeny) UND
// Ablehnungs-/Anzeige-Snapshot (tenantBudgetSnapshot) hierueber - dass beide dieselbe
// Zahl sehen, ist damit STRUKTURELL erzwungen (G27) statt per Konvention. Genau daran
// haengt die Zusage "Reserve > Rest folgt zwingend aus der Gate-Bedingung": ein
// Fehlbetrag reserveCents - remainingCents kann nur dann ein negatives Vorzeichen
// tragen, wenn die zwei Seiten verschiedene Achsen lesen.
function tenantUsageAxes(s, tenantId, cfg, nowIso) {
  return {
    gateCents: gateUsageCents(s, tenantId, cfg, nowIso),
    lifetimeCents: usageFor(s, tenantId).costCents,
  };
}

function tenantSpendOrDeny(s, tenantId, cfg, nowIso) {
  return spendOrDeny({ label: `tenant:${tenantId}`, ...tenantUsageAxes(s, tenantId, cfg, nowIso) });
}

// KS-P2 (Wurzelbehebung): dieselbe Frage wie budgetExceeded, PLUS dem noch nicht gebuchten
// Live-Verbrauch der Carrier-Achse. Bis KS-P2 sah die Mid-Call-Pruefung auf dieser Achse
// nichts: reconcileVoiceBudget bucht erst bei Call-Ende, waehrend die KI-Token-Achse
// in JEDER Schleifenrunde bucht - die teure Achse war live blind.
//
// liveCents kommt vom Aufrufer (budget-gate.js) und ist GANZZAHL Cents. Er durchlaeuft
// denselben D7-Riegel wie der gebuchte Wert, mit EIGENEM Feldnamen im Log: ein unbrauchbarer
// Zeitanker liefert NaN, und "gebucht + NaN >= cap" ist immer false - das Gate waere still
// AUS, ohne Log, ohne Symptom. Fail-closed heisst hier: sperren und die vergiftete Groesse
// benennen.
//
// Die Reserve zaehlt bewusst NICHT mit: sie ist bereits fuer genau diesen Call gebucht -
// gebucht + Reserve + eigene Zeit haetten den Call nach der ersten Minute gegen sich selbst
// aufgelegt. Deshalb kein reservationFor hier, anders als in reserveExceedsBudget, das eine
// NOCH NICHT begonnene Zusatz-Exposition prueft.
export function liveBudgetExceeded(s, tenantId, liveCents, cfg, nowIso) {
  const spend = tenantSpendOrDeny(s, tenantId, cfg, nowIso);
  if (spend.deny) return true;
  if (!isBookableCents(liveCents))
    return denyCorruptUsage(`tenant:${tenantId}`, "liveCents", liveCents);
  return spend.spent + liveCents >= effectiveCapCents(s, tenantId, cfg);
}

// Pro-Tenant-Budget (P6b3): der GATE-Verbrauch (gateUsageCents - Perioden-Fenster bei Flag
// AUS seit GAP-01, Spend-Monat bei Flag AN) gegen den EFFEKTIVEN Cap (pro-Tenant hard_cap_cents wenn
// gesetzt, sonst die Tenant-Default-Decke, sonst der Pro-Tenant-Fallback - Praezedenz s.
// effectiveCapCents). Rein Integer
// gateCents-gegen-Cap (P1); fuer einen ganzzahligen Cap ist floor(x)>=cap aequivalent zu
// x>=cap - bit-identisch zum frueheren Float-Gate.
// Ein unbuchbarer Bucket (D7, jetzt auf BEIDEN Seiten geprueft) sperrt fail-closed mit
// eigenem Grund usage_korrupt - im Extremfall beendet das einen LAUFENDEN Call
// (telnyx-llm-shim) und weist kostenlosen Inbound ab (voice.js). Bei NaN-Verbrauch ist
// genau das richtig, und der eigene Grund macht es vom echten "Budget erschoepft"
// unterscheidbar.
export function budgetExceeded(s, tenantId, cfg, nowIso) {
  // Ohne laufenden Zusatzverbrauch (Dial-Gate, Inbound-Reject): 0 ist buchbar, der D7-Riegel
  // in liveBudgetExceeded ist damit ein No-op, der Ausdruck bleibt "spent >= cap" -
  // byte-identisch zum Bestand. EINE Entscheidungsstelle statt zweier Kopien (G5).
  return liveBudgetExceeded(s, tenantId, 0, cfg, nowIso);
}

// Vorab-Reservierung (outbound-p1c, Kosten-Achse, D1): wuerde der Worst-Case-Minutenpreis
// (reserveCents, GANZZAHL Cents) den verbleibenden effektiven Tenant-Cap UEBERSTEIGEN?
// Gate-Verbrauch (gateUsageCents) + Reserve > effektiver Cap -> true (402 vor Dial).
// DIESELBE Cap-Aufloesung (effectiveCapCents) + derselbe Verbrauchs-Helfer wie
// budgetExceeded (G5, ueber denselben tenantSpendOrDeny-Helfer). Reine Query, kein IO.
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

// Diagnose-Snapshot der TENANT-Achse (P5a, seit KS-P4 die Quelle der ABLEHNUNGSTEXTE):
// Decke, Ist-Verbrauch und freier Rest in GANZZAHL Cents aus DERSELBEN Quelle wie die
// Gate-Praedikate - Cap ueber effectiveCapCents, Verbrauch ueber tenantUsageAxes (also
// die aufgeloeste GATE-Groesse, nicht mehr der Lebenszeit-Zaehler), Reserve ueber
// reservationFor. REIN LESEND: kein Praedikat, keine Entscheidung -
// budgetExceeded/reserveExceedsBudget bleiben unveraendert die einzigen Gate-Fragen.
//
// KS-P4: derselbe ZWEISEITIGE D7-Riegel wie an der Gate-Kante (usageAxesBookable). Nur
// die Lesequelle zu wechseln erzeugte den Spiegelfall des behobenen Fehlers: vergifteter
// Lebenszeit-Zaehler bei gesunder Gate-Groesse -> das Gate sperrt, der Snapshot rendert
// trotzdem eine Zahl, und reserveCents - remainingCents traegt wieder ein negatives
// Vorzeichen. spentCents/remainingCents sind null, sobald EINE der beiden Groessen
// unbuchbar ist; der Aufrufer (outbound-gates.js) rendert dann KEINE Zahl, sondern einen
// ziffernfreien Sperrtext.
// Bewusst NICHT ueber tenantSpendOrDeny: dessen denyCorruptUsage-Log gehoert an die
// GATE-Kante, nicht an eine Anzeige, die /api/state bei jedem Dashboard-Poll aufruft
// (sonst Log-Flut bei einem dauerhaft vergifteten Bucket).
// remainingCents zieht die bereits gebuchte In-Flight-Reserve ab (reservationFor) - der
// "freie Rest" schliesst laufende Calls mit ein, wie reserveExceedsBudget es tut, und
// kann bei bereits ueberreservierten Buckets legitim NEGATIV sein (kein D7-Fall, s.
// outbound-gates.js tenantReserveDenial).
export function tenantBudgetSnapshot(s, tenantId, cfg, nowIso) {
  const capCents = effectiveCapCents(s, tenantId, cfg);
  const axes = tenantUsageAxes(s, tenantId, cfg, nowIso);
  if (!usageAxesBookable(axes)) return { capCents, spentCents: null, remainingCents: null };
  const spentCents = axes.gateCents;
  return { capCents, spentCents, remainingCents: capCents - spentCents - reservationFor(s, tenantId) };
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
    // KV-P6: additiv nullable. NUR ai_token fuellt sie heute (tokenCostMicroCents,
    // dieselbe Formel wie trackUsage) - jedes andere kind bleibt null, kein "0 statt
    // unbekannt" (Muster numberId).
    costMicroCents = null,
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
    costMicroCents,
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

// Grund, aus dem ein Flush NICHTS melden konnte. Ohne Stichtag ist "nichts gemeldet"
// eine SPERRE, kein leerer Ledger - beide Faelle muessen unterscheidbar bleiben, sonst
// sieht der Riegel aus wie Erfolg. Benannte Konstante (G25), EINE Quelle fuer Flush,
// Route-Audit und Test.
export const METER_FLUSH_SKIP = Object.freeze({ NO_EPOCH: "no_flush_epoch" });

// DIE Auswahl der an Stripe meldbaren Ledger-Zeilen (KV-P0). Einziger Ort, an dem ueber
// die Melde-Berechtigung entschieden wird: der Aggregator in billing/meter.js gruppiert
// nur noch, er waehlt nicht mehr aus (er sieht den Zustand gar nicht). Ein kuenftiger
// zweiter Flush-Aufrufer kommt an dieser Funktion nicht vorbei, und wer den Stichtag
// vergisst, meldet NICHTS.
//
// FAIL-CLOSED, und zwar der ganze Zweck: ohne lesbaren Stichtag ist das Ergebnis LEER,
// nie der Bestand. Der typeof-Waechter ist NICHT redundant - new Date(null) ergibt in
// JS ein GUELTIGES Date (1970-01-01), und null ist genau der "nicht gesetzt"-Wert aus
// config.js. Ohne ihn kippte die Fail-Richtung auf "meldet alles". Dasselbe gilt fuer
// 0, true und ein durchgereichtes Date-Objekt.
//
// VERGLEICHSTYP: beide Seiten sind ISO-8601-STRINGS in kanonischer UTC-Form.
// recordUsageEvent stempelt new Date().toISOString(); das pg-Backend haelt occurred_at
// als TEXT und hydriert denselben String (store/pg.js) - json haelt ihn ohnehin. Der
// Stichtag wird hier auf genau diese Form gebracht, BEVOR verglichen wird; ein Vergleich
// String gegen Date waere still immer falsch. >= ist INKLUSIV: ein Ereignis exakt auf
// dem Stichtag wird gemeldet. Reine Query, kein IO, keine Mutation.
export function flushableMeterEvents(s, { flushEpochIso } = {}) {
  const pending = pendingMeterEvents(s);
  const epoch = typeof flushEpochIso === "string" ? parseValidDate(flushEpochIso) : null;
  if (!epoch)
    return { events: [], skipped: pending.length, skipReason: METER_FLUSH_SKIP.NO_EPOCH };
  const epochIso = epoch.toISOString();
  const events = pending.filter((e) => e.occurredAt >= epochIso);
  return { events, skipped: pending.length - events.length, skipReason: null };
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

// ---- Reserve-Ledger (OUT-05): atomare In-Flight-Reservierung ----
// s.reservations (tenantId -> GANZZAHL Cents) haelt die noch nicht abgerechneten
// Worst-Case-Kosten laufender Outbound-Calls, damit der Budget-Gate (pro-Tenant-Decke)
// auch WAEHREND eines Calls den kumulierten Verbrauch sieht. Der
// settled-Bucket (usageFor.costCents, gefuellt erst bei Call-Ende) bleibt UNVERAENDERT und
// PARALLEL. Strukturell ephemer (nie persistiert/hydriert).

// Reserve EINES Tenants (reine Query). Fehlender Eintrag -> 0.
export function reservationFor(s, tenantId) {
  return s.reservations[tenantId] || 0;
}

// Plattform-Summe aller In-Flight-Reserven (Beobachtungs-Achse, reine Query).
export function reservationsTotal(s) {
  return Object.values(s.reservations).reduce((sum, cents) => sum + cents, 0);
}

// Atomare Check+Reserve gegen die EINE Geld-Achse (pro-Tenant-Decke). REIN SYNCHRON, KEIN
// await zwischen Check und Increment -> unter store.withStoreLock (server.js, F2) echt
// atomar (keine TOCTOU). Bucht reserveCents auf s.reservations[tenantId], wenn die
// pro-Tenant reserve-bewusste Decke nicht reisst; eine abgelehnte Reserve
// hinterlaesst KEINEN Schreibeffekt. Nebeneffekt im Namen (N7). Liefert true=reserviert
// (Dial erlaubt) / false=abgelehnt (402 vor Dial). Fail-closed (S1-6, Absolute Regel 1):
// ein unbuchbarer reserveCents darf den Reserve-Ledger NIE senken. Frueher stand hier eine
// direkte negierte reserveCents-Vorzeichenpruefung inline; sie fragt jetzt dieselbe EINE
// Quelle wie alle anderen Geld-Kanten (isBookableCents, D7/G5) und schliesst dabei die
// Luecke bei einem positiven Unendlich-Wert, den die alte Pruefung durchliess.
// KS-P9/E10: die Plattform-Achse trifft keine Sperrentscheidung mehr (nur noch Messung +
// Warnschwelle) - die zweite Bedingung, die frueher hier stand, ist ersatzlos entfallen.
export function tryReserveOutboundBudget(s, tenantId, reserveCents, cfg, nowIso) {
  if (!isBookableCents(reserveCents)) return false;
  if (reserveExceedsBudget(s, tenantId, reserveCents, cfg, nowIso)) return false;
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
// Warnschwelle ueberschritten hat. Seit KS-P9/E10 ist das die EINZIGE Wirkung der
// Plattform-Achse: es gibt keinen Notaus mehr, der danach blocken koennte. AENDERT KEINE
// GATE-ENTSCHEIDUNG: die pro-Tenant-Praedikate oben bleiben unangetastet und
// nebeneffektfrei (reine Query, kein IO - s. deren eigene Modul-Doku). Der Emissionsort
// (Audit/SMS) ist NICHT hier, sondern im reserve_budget-Gate (outbound-gates.js), NACH
// einer erfolgreichen Reservierung.

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

// Plattform-Ist: Gate-Verbrauch der Plattform + In-Flight-Reserven - seit KS-P9 die
// EINZIGE Verwendung der Plattform-Achse. Die Warnung folgt damit automatisch der
// Verbrauchs-Aufloesung (P7: Lebenszeit bei Flag AUS, Spend-Monat bei Flag AN - statt nach
// dem Flip dauerhaft auf der abgeschalteten Lebenszeit-Achse falsch zu alarmieren). Reine
// Query, ohne denyCorruptUsage-Log: das gehoert an eine GATE-Kante, nicht an eine
// Beobachtung (identische Begruendung wie bei tenantBudgetSnapshot).
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

// Kern-Buchung des ElevenLabs-PLATTFORM-Kontingents (Zyklus-Schluessel, Zaehler,
// Warnungs-Union - EINE Aufgabe, G30). KV-P7: aus recordTtsCharacters herausgezogen, weil
// den Kontingent-Zaehler ab jetzt ZWEI Verbraucher mit VERSCHIEDENEN Kostentraegern
// speisen - Play-TTS (reservierter Kostentraeger PLATFORM_TTS_COST_CENTER_ID) und der
// Telnyx-Relay-Pfad (echter Tenant-Bucket, recordRelayTtsCharacters unten). EIN
// ElevenLabs-Konto = EIN Kontingent (G5) - beide teilen sich diese Funktion, keine zweite
// Zyklus-/Schwellen-Logik.
// Liefert {changed, warning}; warning ist eine unterschiedene Union:
//   {characters, quota, cycleKey}                  = Warnschwelle (genau einmal je Zyklus, Alarm-Pflicht)
//   dieselben Felder + exhausted:true              = Kontingent erschoepft (jede Buchung, Riegel-Pflicht, KEIN Alarm)
//   null                                           = nichts zu melden
// Ganzzahl-Arithmetik durchweg (G26); Zukunfts-/Unlesbar-Riegel ueber laterMonotonicKey
// (dieselbe Regel wie die Spend-Monat-Achse, G5).
function bumpPlatformTtsQuota(s, chars, cfg, nowIso) {
  const row = s.platformTtsUsage;
  const key = ttsCycleWindowKey(row, cfg, nowIso);
  if (key === null) return { changed: false, warning: null }; // kein Anker je gestempelt UND Uhr unlesbar -> No-op
  const charactersBefore = key !== row.cycleKey ? 0 : row.characters; // Rollover startet frisch
  row.characters = charactersBefore + chars;
  row.cycleKey = key;
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

// Verbucht erfolgreich an ElevenLabs gesendete Play-TTS-Zeichen auf dem globalen Zaehler UND
// auf dem reservierten Kostentraeger (GAP-09). nowIso kommt vom Aufrufer (state-ops bleibt
// zeit-frei). KV-P7: BYTE-IDENTISCHES Verhalten zum Bestand (reine Aufteilung, kein
// Verhaltenswechsel) - der fruehere unbedingte Kostentraeger-Aufruf lag hinter dem
// key===null-Early-Return, also GENAU hinter `changed`, wie hier.
export function recordTtsCharacters(s, chars, cfg, nowIso) {
  const result = bumpPlatformTtsQuota(s, chars, cfg, nowIso);
  // GAP-09: derselbe Betrag zusaetzlich auf den reservierten Play-TTS-Kostentraeger - ueber
  // die BESTEHENDE Erhoehungsregel (G5: recordTenantTtsCharacters bringt die Ganzzahl-/<=0-
  // Riegel schon mit).
  if (result.changed) recordTenantTtsCharacters(s, PLATFORM_TTS_COST_CENTER_ID, chars);
  return result;
}

// KV-P7 (Massnahme 3): der Telnyx-Relay-Pfad synthetisiert TTS SERVERSEITIG bei Telnyx -
// dieselben ElevenLabs-Zeichen wie Play-TTS, aber OHNE je recordTtsCharacters aufzurufen
// (dessen einziger Aufrufer ist tts/directive-synth.js, hinter
// config.voice.elevenLabsPlayTts.enabled). Der Kontingent-Zaehler sah diesen Verbrauch
// strukturell nie, unabhaengig davon ob Play-TTS an oder aus ist. Diese Funktion schliesst
// die Luecke: die Zeichen gehen auf den ECHTEN Tenant-Bucket (NICHT auf
// PLATFORM_TTS_COST_CENTER_ID - der Verbrauch stammt nicht von dort, anders als bei
// recordTtsCharacters), UND auf denselben Plattform-Zyklus-Zaehler (EIN ElevenLabs-Konto =
// EIN Kontingent, G5 - keine zweite Zyklus-/Schwellen-Logik).
// recordTenantTtsCharacters ist die EINE Gueltigkeitsregel (nicht-ganzzahlig/<=0 -> nichts
// bewegt sich, kein zweiter Riegel hier). changed:true, sobald der Tenant-Bucket stieg -
// auch wenn der Zyklus-Zaehler bei unlesbarer Uhr aussetzt (bumpPlatformTtsQuota liefert
// dann warning:null): sonst verloere die Fassade den bereits geschriebenen Tenant-Wert.
export function recordRelayTtsCharacters(s, { tenantId, chars, cfg, nowIso }) {
  const tenant = recordTenantTtsCharacters(s, tenantId, chars);
  if (!tenant.changed) return { changed: false, warning: null };
  return { changed: true, warning: bumpPlatformTtsQuota(s, chars, cfg, nowIso).warning };
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

// ---- KV-M4: monatliche Gegenprobe (Provider-Rechnung/Ist-Kosten/Gate-Buchung) ----
// REINE BEOBACHTUNG: keine dieser Funktionen mutiert die Gate-Achse (usage.costCents) oder
// den Ledger - sie LESEN beide nur, exakt wie die Kickoff-Landkarte es verlangt.

// Der faellige Monat der Gegenprobe ('YYYY-MM') oder null, wenn er schon geprueft wurde
// (Muster ttsCycleWindowKey: Leser und Schreiber teilen sich denselben autoritativen
// Schluessel ueber laterMonotonicKey). Faellig ist IMMER nur der zuletzt abgeschlossene
// Monat relativ zu nowIso - kein Nachholen uebersprungener Monate (Owner-Vorgabe TEIL 3/4:
// eine reine Beobachtung ohne Sperrwirkung rechtfertigt keine Nachhol-Schleife). Unlesbare
// Uhr -> null (fail-closed: kein Provider-Aufruf aus einer kaputten Uhr). Reine Funktion.
export function crossCheckDueMonthKey(s, nowIso) {
  const dueMonthKey = previousMonthKeyOf(nowIso);
  if (dueMonthKey === null) return null;
  const checked = laterMonotonicKey(s.costCrossCheck.lastCheckedMonthKey, dueMonthKey);
  return checked === s.costCrossCheck.lastCheckedMonthKey && checked !== null ? null : dueMonthKey;
}

// Stempelt monthKey als geprueft - VORWAERTS NUR (laterMonotonicKey-Riegel, kein
// Rueckwaertsschreiben, G5: dieselbe Monotonie-Regel wie die drei uebrigen periodischen
// Achsen dieses Moduls). Wird bei JEDEM Versuch aufgerufen, egal ob der Provider-Aufruf
// gelang - der Aufrufer (billing/cost-cross-check.js) entscheidet das, diese Funktion
// stempelt nur. Ein Riegel, der nur bei Erfolg stempelt, fragte einen dauerhaft
// fehlschlagenden Provider stuendlich neu an (TEIL 3 Lastbudget: hoechstens EIN
// Provider-Aufruf je Kalendermonat).
export function markCrossCheckAttempted(s, monthKey) {
  s.costCrossCheck.lastCheckedMonthKey = laterMonotonicKey(s.costCrossCheck.lastCheckedMonthKey, monthKey);
}

// Summe der abgerufenen Ist-Kosten (actualCostMicroCents, PROVIDER-Waehrung/USD-Mikro-Cent,
// UNVERAENDERT) aller TELNYX-Calls, deren Buchungsmonat monthKey ist. NUR Telnyx: die
// Provider-Rechnung (Zahl 1 der Gegenprobe) ist ausschliesslich Telnyx-Verkehr - eine
// Beimischung von Altzeilen fremder Anbieter waere kein Vergleich zwischen gleichen
// Groessen.
// Monatsanker ist estimatedCostSpendMonthKey - DERSELBE Anker, unter dem
// reconcileVoiceBudget/bookCents auf die Gate-Achse gebucht haben (KS-P5 Bucket-Brigade) -
// NICHT endedAt: Zahl 2 und Zahl 3 der Gegenprobe muessen ueber denselben Zeit-Anker-Typ
// (Buchungsmonat) partitioniert sein, sonst vergleicht die Gegenprobe zwei verschieden
// geschnittene Monate. costTruedAt !== null heisst "ein Abgleichsversuch fand statt"
// (nicht zwingend erfolgreich); NUR ein ganzzahliger, nicht-negativer actualCostMicroCents
// ist eine echte Messung (G26: kein Fliesskomma, keine erfundene 0 fuer "kein Wert").
// Reine Query, kein IO.
export function actualCostMicroCentsForMonth(s, monthKey) {
  return s.calls
    .filter(
      (c) =>
        c.provider === PROVIDER.TELNYX &&
        c.costTruedAt !== null &&
        Number.isSafeInteger(c.actualCostMicroCents) &&
        c.actualCostMicroCents >= 0 &&
        c.estimatedCostSpendMonthKey === monthKey,
    )
    .reduce((sum, c) => sum + c.actualCostMicroCents, 0);
}

// Summe der auf die Gate-Achse gebuchten Carrier-Betraege (EUR-Cent) des Kalendermonats
// monthKey - REKONSTRUIERT aus dem Ledger (usageEvents, kind=VOICE_MINUTE), NICHT direkt
// von der Gate-Achse gelesen: usage.costCents ist ein einziger, ungetrennter Skalar ueber
// ALLE Kosten-Arten (Befund A, s. Kickoff/Plan) - es gibt keine persistierte
// Kosten-Art-Aufschluesselung auf der Gate-Achse selbst.
// PROXY, KEIN IST-WERT (Befund B): recordVoiceMinuteMeter (dieser Ledger-Schreiber)
// laeuft NUR unter PAYMENT_ENABLED, waehrend reconcileVoiceBudget IMMER auf die Gate-Achse
// bucht (call-finish.js) - solange PAYMENT_ENABLED=false gilt, UNTERSCHAETZT diese Summe
// systematisch die tatsaechliche Gate-Buchung. Das gehoert in JEDEN Log-/Berichtstext, der
// diese Zahl zeigt (Kickoff-Vorgabe carrierShareReadable), nicht stillschweigend als "die
// Zahl". Reine Query, kein IO.
export function carrierGateCostCentsForMonth(s, monthKey) {
  return s.usageEvents
    .filter((e) => e.kind === USAGE_EVENT_KIND.VOICE_MINUTE && spendMonthKeyOf(e.occurredAt) === monthKey)
    .reduce((sum, e) => sum + e.costCents, 0);
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

// DRITTER Retention-Durchgang (AL-P11/O5): entfernt die woertlichen Zitate
// (result.evidence) beendeter Calls, die aelter als `days` sind. Der Rest der Karte
// (outcome/facts/...) BLEIBT stehen - genau das ist der Unterschied zu einem
// Record-Purge: die Karte ist die Notiz, die Zitate sind der Beleg mit der kurzen Frist.
// Gleiche bewusste Asymmetrie wie purgeExpiredDiagnosticTranscripts: 0 heisst hier
// "Feature aus" (cutoff = jetzt -> jedes Zitat eines beendeten Calls faellt), NICHT
// "Retention aus". Nur diese Richtung ist fail-closed. Das Entfernen selbst laeuft ueber
// stripResultEvidence (EINE Mutationsquelle, G5).
export function purgeExpiredResultEvidence(s, days) {
  const cutoff = new Date(Date.now() - Math.max(days, 0) * MS_PER_DAY).toISOString();
  let purged = 0;
  for (const call of s.calls) {
    if (!call.endedAt || call.endedAt >= cutoff) continue;
    if (stripResultEvidence(call)) purged++;
  }
  return purged;
}

// Die EINE Retention-Fassade beider Backends: Record-Durchgang (lange Frist) plus
// Diagnose-Transkript-Durchgang (kurze Frist) plus Ergebnis-Zitate-Durchgang (kuerzeste
// Frist). Benannte Optionen statt mehrerer gleichartiger Zahlen-Positionen - nebeneinander
// nicht verwechselungssicher (F1/G25).
export function pruneOldData(s, { retentionDays, diagnosticRetentionDays, evidenceRetentionDays }) {
  const removed = pruneExpiredRecords(s, retentionDays);
  // Laeuft UNABHAENGIG von retentionDays: eine abgeschaltete Record-Retention
  // (RETENTION_DAYS=0, u.a. der Test-Default in BASE_ENV) darf die kuerzere
  // Diagnose-Frist NICHT mit abschalten - sonst laege genau das Roh-Transkript am
  // laengsten, das am kuerzesten liegen soll.
  removed.diagnosticTranscripts = purgeExpiredDiagnosticTranscripts(s, diagnosticRetentionDays);
  // Laeuft ebenfalls UNABHAENGIG von retentionDays (gleiche Begruendung wie oben):
  // eine abgeschaltete Record-Retention darf die kuerzeste Frist nicht mit abschalten.
  removed.resultEvidence = purgeExpiredResultEvidence(s, evidenceRetentionDays);
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
// Unbekannte Keys / falsche Typen werden ignoriert - kein Aufrufer kann so fremde
// Felder in den Store schreiben oder Typen kippen. Optionale Enum-
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
