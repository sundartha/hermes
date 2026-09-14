// Voice-Gateway: Provider-Webhooks (Inbound/Outbound),
// MCP ueber Streamable HTTP (/mcp), REST-API fuer Dashboard & stdio-MCP.
// MUSS erste Importzeile bleiben (vor store.js) - globales Crash-Netz, ESM-Eval-Order (T-P0-07).
import "./process-guards.js";
import { config } from "./config.js";
import * as store from "./store.js";
import { planSummarySms } from "./sms-summary.js";
import { summarizeCall } from "./claude.js";
import { qualifiesAsInboxEntry } from "./inbox-entry.js";
import { createTtsStore } from "./tts/store.js";
import { makeDirectiveSynth } from "./tts/directive-synth.js";
import { audit } from "./util.js";
import { makeDurableAudit } from "./durable-audit.js";
import { voiceControl, messaging, numberProvisioning, providerConfigRead } from "./telephony/registry.js";
import { sendBootstrapAlertSms } from "./telephony/alert-sms.js";
import { makeVoiceRender } from "./telephony/voice-render.js";
import { terminateAndBillCall, hangUpAction, billThunk } from "./telephony/call-termination.js";
import { makeCallFinish } from "./telephony/call-finish.js";
import { makeOutageWatch } from "./telephony/outage-report.js";
import { makeDriftWatch } from "./telephony/outbound-drift-watch.js";
import { makePaidWithoutNumberWatch } from "./billing/paid-without-number-watch.js";
import { makePriceDriftWatch } from "./billing/price-drift-watch.js";
import { makeProvisionRetryWatch } from "./billing/provision-retry-sweep.js";
import { makeElConfigRead } from "./telephony/outbound-config-soll.js";
import { makeElevenLabsOutbound } from "./elevenlabs/outbound.js";
import { metrics } from "./metrics.js";
import { selectMailer } from "./wiring/web-login.js";
import { makeOutboundGates } from "./telephony/outbound-gates.js";
import { makeAniOwnershipRecheck } from "./telephony/ani-ownership-recheck.js";
import { reattachActiveCall as reattachActiveCallCore } from "./telephony/reattach.js";
import { makeCallLifecycle } from "./telephony/call-lifecycle.js";
import { blockingBudgetAxis } from "./budget-gate.js";
import {
  recordProvisioningJob,
  markProvisioningJob,
  classifyQueuedProvisioningJobs,
  findNumber,
  classifyCallTime,
  cappedEndedAtMs,
} from "./store/state-ops.js";
import { handleProvisionJob } from "./worker/provisioning.js";
import { makeProvisioningOrchestrator } from "./worker/provisioning-orchestrator.js";
import { resolveProvisionRetry } from "./billing/provision-trigger.js";
import { createQueue } from "./queue/registry.js";
import { stripeBilling } from "./billing/stripe.js";
import { makeMetering } from "./billing/metering.js";
import { makeCostTruing } from "./billing/cost-truing.js";
import { fetchConversation } from "./elevenlabs/convai.js";
import { makeCostCrossCheck } from "./billing/cost-cross-check.js";
import {
  makeRequestTenant,
  internalIdentity,
  OWNER_ID,
  TENANT_REJECT,
} from "./request-tenant.js";
import { makeConsultDelivery } from "./consult/delivery.js";
import { consultAllowedForCall } from "./consult/gate.js";
import { elevenLabsLookupAvailableFor } from "./research/registry.js";
import { buildApp } from "./app.js";
import { bootServer } from "./boot.js";

// Eine Queue-Instanz pro Prozess (Konstruktion in der Naht, nicht im Handler; P15).
// Default In-Memory (deterministisch, drain-on-demand); QUEUE_BACKEND=pgboss wirft
// (deferred nach P8) -> kein still gestartetes No-op-Subsystem.
const provisioningQueue = createQueue();

// Request-Tenant-Resolver (rein, extrahiert nach src/request-tenant.js, A4): an den
// konkreten store gebunden (Factory-Muster wie makeSelfServiceRoutes - haelt das
// Resolver-Modul DB-frei und ohne server.js-Boot importierbar/unit-testbar). Der
// neue Web-Session-Zweig wertet req.tenant (gesetzt von webAuthMiddleware nach
// signiertem Cookie + gueltiger DB-Session) VOR der req.auth/MCP-Logik aus: die
// staerkere, jederzeit invalidierbare Identitaet gewinnt, fail-closed (-> TENANT_REJECT,
// nie Owner). Volle Begruendung im Modul-Doc von request-tenant.js. isTrustedLocalCaller/
// internalIdentity sowie OWNER_ID/TENANT_REJECT kommen aus demselben
// Modul (in app.js importiert, wo sie gebraucht werden).
const { requestTenant, requireTenant } = makeRequestTenant(store);

// Outbound-Gate-Kette EINMAL beim Boot verdrahtet (Modul-Scope wie provisioningQueue,
// P15): geordnetes Array, Reihenfolge per test/outbound-gates-order.test.js festgenagelt.
// requestTenant/internalIdentity/OWNER_ID/TENANT_REJECT werden durchgereicht (EINE Quelle,
// kein zweiter Tenant-Resolver, G5/DIP). audit/messaging (Budget-Achsen P6) speisen die
// fail-soft Plattform-Fruehwarnung im reserve_budget-Gate - dieselben Instanzen wie
// callFinish (kein zweiter Audit-/Messaging-Zugang, DIP).
//
// OUTBOUND-E4 Review-Blocker (BLOCKER 1 / G9/C2): telnyxRead ist derselbe rein LESENDE
// Provider-Read-Port, den driftWatch weiter unten bekommt (registry.js#
// providerConfigRead, Default Telnyx, kein zweiter HTTP-Client) - HIER schon gebaut
// (statt erst bei driftWatch), damit der ANI-Riegel seine LIVE-Nachmessung ("Schutzschicht
// 2", PLAN-SECURITY.md) ueberhaupt bekommt. Ohne diese Verdrahtung faellt aniOwnershipRecheck
// auf makeOutboundGates' Default-No-op zurueck und das Gate kann NIE ablehnen.
const telnyxRead = providerConfigRead();
const { gates: outboundGates } = makeOutboundGates({
  store,
  config,
  requestTenant,
  internalIdentity,
  OWNER_ID,
  TENANT_REJECT,
  audit,
  messaging,
  aniOwnershipRecheck: makeAniOwnershipRecheck({ telnyxRead }),
});

// Metering-Instanz (P6b3-Meter + outbound-p1c-Reconcile) EINMAL beim Boot verdrahtet
// (Naht wie outboundGates/provisioningQueue, nicht im Handler; INV-7). store+config
// werden geschlossen; die Gating-Bedingung `if (config.billing.paymentEnabled)` bleibt beim
// Aufrufer (finishCall / Provisioning-Drain), nicht im Modul.
const metering = makeMetering({ store });

// KV-M4: monatliche Gegenprobe (reine Beobachtung) EINMAL beim Boot verdrahtet (Naht wie
// costTruing, INV-7). Dieselbe voiceControl-Registry (Telnyx-only, kein Abgleich moeglich
// -> sauberer No-op, Muster costTruing). Liest NUR die Gate-Achse und den Ledger, schreibt
// AUSSCHLIESSLICH den eigenen Monats-Riegel (state.costCrossCheck) - kein Gate, kein Meter,
// keine Buchung wird beruehrt.
const costCrossCheck = makeCostCrossCheck({ store, config, voiceControl });

// F2-Mail (Call-Summary per E-Mail bei Newsletter-Einwilligung): EIGENE Mailer-Instanz ueber
// dieselbe Auswahl-Rangfolge wie wireWebLogin (selectMailer, src/wiring/web-login.js -
// Brevo/HTTP vor SMTP, G5: EINE Rangfolge, kein zweiter Auswahl-Codepfad), aber bewusst
// NICHT die dortige Instanz geteilt. Begruendung: callFinish wird HIER, am Modul-Top,
// SYNCHRON verdrahtet - wireWebLogin dagegen laeuft erst spaeter, ASYNCHRON, innerhalb des
// pg-gated guardedBoot-Blocks (buildApp/app.js). Eine geteilte Instanz muesste auf diesen
// Block warten und bliebe bei json-Backend oder einem pg-Ausfall (fail-open, INV-11) fuer
// immer aus - der Mailversand haette dann eine unnoetige Abhaengigkeit vom Portal-Pool,
// obwohl selectMailer NUR config.mail braucht (kein pg, reine Funktion). Beide Adapter
// (makeBrevoMailer/makeSmtpMailer) sind laut eigenem Modul-Kopf zustandslos (jeder Aufrufer
// bekommt seine EIGENE Instanz) - zwei Instanzen sind unbedenklich, kein Doppel-Zustand.
const mailer = selectMailer(config);

// KV2-1: spaet gebundene Audit-Sink-Zelle (Muster accountsRef unten). Initialwert null;
// gesetzt NUR im pg-gated guardedBoot-Block (wireWebLogin, das makeAuditStore ohnehin
// baut). STORE_BACKEND=json / pg-Ausfall -> bleibt null -> der durable Zweig ist ein
// fail-soft No-op (bewusste Festlegung, Plan 4.10).
const auditStoreRef = { current: null };

// KV2-1: die EINE Audit-Funktion des Kostenpfads - Konsolenzeile wie bisher, PLUS durabel
// in audit_log. util.js#audit ist ausschliesslich ein console.log; genau deshalb lieferte
// `select ... from audit_log where action='cost_truing_befund'` 11 Tage lang 0 Zeilen,
// waehrend der Befund korrekt feuerte (AUFTRAG B3).
const durableAudit = makeDurableAudit({ audit, auditStoreRef });

// P3 (N-10): derselbe durable Weg, an EINEN Mandanten gebunden - fuer Ereignisse, die
// einem Mandanten gehoeren statt der Plattform (heute: der abgebrochene Rueckfrage-Halt
// des ElevenLabs-Webhooks). Kein zweiter Schreibpfad (E-1): dieselbe Fabrik, dieselbe
// spaet gebundene Zelle, dasselbe fail-soft. Die Instanz ist eine Closure ohne Zustand -
// sie je Ereignis zu bauen kostet nichts und haelt die Verdrahtung hier oben (P15).
const durableAuditFor = (tenantId) => makeDurableAudit({ audit, auditStoreRef, tenantId });

// Kosten-Abgleich (LCT P3) EINMAL beim Boot verdrahtet (Naht wie metering, INV-7). Der
// Laufriegel lebt im Factory-Scope = EIN Riegel pro Prozess, den Intervall (boot.js) und
// manueller Endpunkt (api-billing.js) sich teilen - zwei Instanzen haetten zwei Riegel und
// damit keinen. voiceControl kommt aus der Registry (Adapter ohne fetchCostRecordPool/
// assignCostRecords -> sauberer No-op). Schreibt ausschliesslich P2-Felder; kein Gate,
// kein Meter, keine Buchung wird beruehrt. messaging (LCT P5, Drift-Waechter-Alarm) ist
// dieselbe Instanz wie bei outboundGates/callFinish (kein zweiter Messaging-Zugang, DIP).
// KV2-1: NACH selectMailer verdrahtet (vorher davor) - der Befundkanal geht seit dieser
// Phase ueber denselben Meldeweg wie der Ausfall-Melder (Plan 4.9/4.10) und braucht
// deshalb den Mailer. Dieselbe Umstellung, die outageWatch schon hinter sich hat.
// KV2-9: der ZWEITE, reifende EL-Abruf (GET /v1/convai/conversations/{id}) als schmaler,
// rein LESENDER Port - der Billing-Pfad kennt damit keinen Anbieter (DIP, Muster telnyxRead/
// elRead). BEWUSST als Closure hier und NICHT als Fabrik: makeElConfigRead existiert nur,
// weil DIESELBE Closure zusaetzlich im CLI-Weg (scripts/check-outbound-drift.mjs) stand -
// fuer diesen Abruf gibt es genau einen Aufrufer.
const elKostenRead = {
  fetchConversation: (conversationId) =>
    fetchConversation({ fetchImpl: fetch, account: config.voice.elevenLabsOutbound, conversationId }),
};

const costTruing = makeCostTruing({
  store, config, voiceControl, audit: durableAudit, messaging, mailer, elKostenRead,
});

// OUTBOUND-E3b: vierter, unabhaengiger Sweep-Zweig (Muster costTruing/costCrossCheck,
// INV-7) - schliesst offene Ausfall-Marker, deren Fenster inzwischen gesund ist (D9: der
// Ausloeser in finishCall sieht nur not-placed-Anrufe und kann "erholt" nie selbst
// feststellen). audit/messaging sind dieselben Instanzen wie ueberall sonst (DIP).
// C8b (Review-Blocker Runde 2): NACH mailer verdrahtet (statt davor wie im ersten Entwurf)
// - der fuenfte Zweig (Alarmkanal-Selbsttest, s. runSweepTick) braucht dieselbe
// Mailer-Instanz wie callFinish, kein zweiter Versandzugang (DIP).
const outageWatch = makeOutageWatch({ store, config, audit, messaging, mailer });

// OUTBOUND-E4: siebter Sweep-Zweig + Boot-Lauf (Muster outageWatch, INV-7). telnyxRead
// (dieselbe Instanz wie beim ANI-Riegel oben, EIN Read-Port, kein zweiter HTTP-Client)
// ist der rein LESENDE Provider-Read-Port (registry.js#providerConfigRead, Default
// Telnyx); elRead kommt aus der EINEN Fabrik makeElConfigRead (Blocker 7, G5) - vorher
// stand dieselbe Closure wortgleich auch in scripts/check-outbound-drift.mjs.
const elRead = makeElConfigRead(config);
const driftWatch = makeDriftWatch({ store, config, audit, messaging, mailer, telnyxRead, elRead });

// GP-P0: ACHTER, unabhaengiger Sweep-Zweig (Muster outageWatch/driftWatch, INV-7).
// durableAudit statt audit: der Befund muss die Log-Rotation ueberleben - genau das war
// der Vorfall vom 11.09. (Muster costTruing, KV2-1). KEIN messaging/mailer: die Phase
// meldet auf der Notiz-Stufe (WARN -> Audit -> Marker), sie alarmiert nicht.
const paidWithoutNumberWatch = makePaidWithoutNumberWatch({ store, config, audit: durableAudit });

// GP-P6: ZEHNTER Sweep-Zweig + eigener Boot-Lauf (Muster driftWatch, INV-7). lesePreis ist
// der rein LESENDE Stripe-Abruf des bestehenden Adapters - kein zweiter HTTP-Client, kein
// Geld-Aufruf. durableAudit wie GP-P0 (der Befund muss die Log-Rotation ueberleben);
// messaging/mailer sind dieselben Instanzen wie ueberall sonst (DIP).
const priceDriftWatch = makePriceDriftWatch({
  store,
  config,
  audit: durableAudit,
  messaging,
  mailer,
  lesePreis: (priceId) => stripeBilling.retrievePriceAmount(priceId),
});

// F2-Mail: Accounts-Zugriff (Konto-E-Mail) haengt an accounts.accountByTenant (web-auth.js),
// das NUR existiert, wenn der pg-gated Web-Login-Block durchlaeuft (wireWebLogin, asynchron
// NACH diesem Modul-Scope - s. app.js guardedBoot). Spaet gebundene, veraenderliche Zelle
// (Muster operatorAuth in app.js): Initialwert null, Zuweisung NUR im guardedBoot-Callback
// (wireWebLogin setzt accountsRef.current). callFinish haelt eine Referenz auf DIESE ZELLE
// (nicht auf accounts selbst) und liest sie bei jedem Call-Ende frisch - faellt der pg-Block
// aus/weg, bleibt accountsRef.current fuer immer null und planSummaryMail skip't fail-closed
// mit reason=no_account_email.
const accountsRef = { current: null };

// call-finish (P4): finishCall (Settlement/Summary/SMS/Mail) + releaseReserve (Reserve-
// Freigabe) EINMAL beim Boot verdrahtet (Naht wie metering/outboundGates, nicht im Handler;
// INV-7). EINE Instanz: dieselbe finishCall-Referenz geht an makeVoiceRoutes und
// call-lifecycle
// (call._finished/billedAt-Guards verlangen Identitaet). metering ist oben konstruiert (P1);
// die paymentEnabled-Gating-Bedingung bleibt im finishCall-Body (INV-9), Cents bleiben Ganzzahl.
const callFinish = makeCallFinish({
  store,
  config,
  metering,
  messaging,
  summarizeCall,
  planSummarySms,
  audit,
  mailer,
  accountsRef,
  qualifiesAsInboxEntry,
});

// EL-Anrufstart (dritter Outbound-Weg, hinter ELEVENLABS_OUTBOUND_ENABLED): EINMAL beim
// Boot verdrahtet (Naht wie metering/callFinish, INV-7). EINE Instanz ist Pflicht - sie
// haelt den ziehenden Ergebnisweg; eine zweite haette eine zweite Abhol-Schleife auf
// demselben Gespraech. Konstruiert NACH callFinish (linearer DAG): finishCall kommt fertig
// gebunden herein, terminateAndBillCall/billThunk sind dieselben Bausteine wie in
// call-lifecycle (kein zweiter, buchungsfreier Terminierungspfad, INV-9).
const elevenLabsOutbound = makeElevenLabsOutbound({
  store,
  config,
  terminateAndBillCall,
  billThunk,
  finishCall: callFinish.finishCall,
  // DASSELBE Praedikat, das der Rueckfrage-Webhook fragt, bevor er eine Rueckfrage annimmt
  // (inkl. Owner-Bedingung) - hier verdrahtet statt in outbound.js importiert (Begruendung
  // an der Signatur dort).
  consultAllowedForCall,
  // Thema B: dasselbe Muster fuer das Recherche-Tor - die EINE Torkette aus
  // research/registry.js, die auch der Lookup-Webhook fragt.
  lookupAvailableFor: elevenLabsLookupAvailableFor,
  // OUTBOUND-E5 (F3): der Absender-Rueckfall-Zaehler - hier verdrahtet statt in
  // outbound.js importiert (Begruendung an der Signatur dort, Lehre test-base-env-drift).
  metrics,
  // IEL-B4 (E7b): Beende-Versuch des Telnyx-Elternbeins eines ueberbrueckten Inbound-Calls
  // (Nachlauf-Frist, 3x 401/404). DIESELBE Handle-Entscheidung wie Cap und cancel_call
  // (hangUpAction, eine Quelle); ohne Call oder Handle kein Versuch (fail-safe wie dort).
  endCarrierCall: (callId) => {
    const call = store.getCall(callId);
    const auflegen = call ? hangUpAction(voiceControl, call, call.twilioSid) : null;
    return auflegen?.();
  },
});

// call-lifecycle (P5): Cap-Timer (Max-Dauer), Reserve-Release-Backstop, Re-Attach-Wrapper
// und Boot-Re-Arm. EINMAL beim Boot verdrahtet (Naht wie metering/callFinish, INV-7),
// konstruiert NACH callFinish (linearer DAG): finishCall/releaseReserve kommen fertig
// gebunden herein (kein Lazy-Thunk, P15). INV-9: terminateCappedCall bleibt der EINZIGE
// Terminalisierungspfad (Provider-Leg zuerst, dann buchen - via terminateAndBillCall).
const lifecycle = makeCallLifecycle({
  store,
  config,
  finishCall: callFinish.finishCall,
  releaseReserve: callFinish.releaseReserve,
  voiceControl,
  terminateAndBillCall,
  hangUpAction,
  // TEIL B (Owner-Auftrag 15.08.2026): die konkrete EL-Beende-Implementierung
  // (elevenLabsOutbound, oben konstruiert - DI statt Import-Kante telephony->elevenlabs).
  // elevenLabsHangUpAction selbst ist PURE (keine IO) und deshalb ein direkter Import in
  // call-lifecycle.js, kein zweiter DI-Slot hier.
  billThunk, endActiveCall: elevenLabsOutbound.endActiveCall,
  // IEL-B5 (E10): Ergebnis-Teil des Bruecken-Beende-Thunks - dieselbe Instanz (INV-7).
  awaitAndPersistInboundElResult: elevenLabsOutbound.awaitAndPersistInboundElResult,
  reattachActiveCallCore,
  cappedEndedAtMs,
  classifyCallTime,
  blockingBudgetAxis, // KS-P1b: die EINE Geld-Achse fuer die Re-Attach-Pruefung
});

// provisioning-orchestrator (P6): enqueue/trigger/drain(single-flight)/reconcile fuer den
// Nummern-Kauf. EINMAL beim Boot verdrahtet (Naht wie metering/callFinish/lifecycle, INV-7):
// der Single-Flight-Guard lebt im Factory-Scope = EIN Drain-Guard pro Prozess (kein
// Doppelkauf). KONSTRUIERT VOR dem guardedBoot-Block (in buildApp), weil
// triggerTenantProvisioning dort als provision-Seam an zwei Stellen (self-service + Stripe-
// Webhook) gebraucht wird - eine spaetere Konstruktion feuerte im pg+session-Boot einen
// TDZ-ReferenceError, den guardedBoot fail-OPEN verschluckt (Routen lautlos 404, INV-11).
// provisioningQueue + metering (P1) liegen bereits davor.
const provisioning = makeProvisioningOrchestrator({
  store,
  config,
  queue: provisioningQueue,
  billing: stripeBilling,
  metering,
  numberProvisioning,
  handleProvisionJob,
  resolveProvisionRetry,
  audit,
  recordProvisioningJob,
  markProvisioningJob,
  classifyQueuedProvisioningJobs,
  findNumber,
});

// GP-P4 (PLAN-GELDPFAD.md 2): neunter Zweig des Stunden-Sweeps. HIER und nicht oben bei
// paidWithoutNumberWatch: der Zweig braucht triggerTenantProvisioning, das erst mit dem
// Orchestrator darueber existiert. durableAudit statt audit - ein automatischer
// Kaufanstoss muss die Log-Rotation ueberleben (Muster paidWithoutNumberWatch).
const provisionRetryWatch = makeProvisionRetryWatch({
  store,
  config,
  provision: provisioning.triggerTenantProvisioning,
  audit: durableAudit,
});

// Play-TTS-Seam: haelt vorab synthetisierte Agent-Audios kurz + einmalig (PII). EINMAL
// beim Boot verdrahtet (Naht wie callFinish, INV-7).
const ttsStore = createTtsStore({ ttlMs: config.voice.elevenLabsPlayTts.tokenTtlMs });

// LCT P7 (Fixkosten sichtbar machen): Alarm bei ueberschrittener ElevenLabs-Kontingent-
// Warnschwelle, ueber denselben Bootstrap-Alarm-Baustein wie der Drift-Waechter (LCT P5,
// sendDriftAlertSms) - sendBootstrapAlertSms buendelt Empfaenger-Riegel, Bootstrap-Absender
// (die eigene Betreiber-Nummer, NIE die DID eines Kunden) und fail-soft-Versand an EINER
// Stelle (G5). req=null -> audit() loggt ip=system (Muster PLATFORM_WARN_EVENT): ein
// Plattform-Ereignis ist keinem Request zuzurechnen.
const TTS_QUOTA_WARN_EVENT = "tts_quota_warning";
const TTS_QUOTA_SMS_PREFIX = "[Hermes] ElevenLabs-Kontingent-Warnschwelle erreicht: ";
function onTtsQuotaWarning(warning) {
  const detail = `zeichen=${warning.characters}/${warning.quota} zyklus=${warning.cycleKey}`;
  audit(TTS_QUOTA_WARN_EVENT, null, detail);
  sendBootstrapAlertSms({ messaging, config, store, prefix: TTS_QUOTA_SMS_PREFIX, detail, logTag: TTS_QUOTA_WARN_EVENT });
}

// Play-TTS-Direktiven-Synth (fail-safe, Server-Slim P2): webt <Play>-Audio in Telnyx-
// Direktiven ein. Schliesst die EINE ttsStore-Instanz (INV-7) + config. store/onQuotaWarning
// (LCT P7) sind dieselbe store-Fassade wie ueberall in server.js verdrahtet + der Warn-
// Callback oben - injiziert statt im Modul konstruiert (DIP/P15).
const directiveSynth = makeDirectiveSynth({ config, ttsStore, store, onQuotaWarning: onTtsQuotaWarning });

// AL-P13: Consult-Zustellung (Stufe 0: kurzer, client-gezogener Long-Poll). EINMAL beim
// Boot verdrahtet (Naht wie ttsStore/callFinish, INV-7): Poll-Zaehler und
// Drain-Flag leben im Factory-Scope = EINE Obergrenze pro Prozess. Geht an buildApp
// (Consult-Routen) UND an bootServer (Shutdown-Drain loest offene Polls auf).
const consultDelivery = makeConsultDelivery({ store });

// Voice-Render-Helfer (Server-Slim P3): EINE Instanz (INV-7), config wird geschlossen.
// Geht als Dep an makeVoiceRoutes (P11); die Render-Funktionen werden dort destrukturiert.
const voiceRender = makeVoiceRender({ config });

// ---------------- Kompositionswurzel (Server-Slim P15) ----------------
// buildApp(deps) verdrahtet die komplette Express-App (Middleware, Wiring, Router-Mounts,
// src/app.js); bootServer(deps) fuehrt die Boot-Sequenz aus (store.load, Retention,
// Fail-closed-Gates, listen, Graceful-Shutdown, src/boot.js). Beide teilen
// sich EIN deps-Buendel (F1: je Funktion 1 Argument). buildApp MUSS vollstaendig durchlaufen
// (inkl. dem awaited guardedBoot-Block), BEVOR bootServer startet - store.load() wird NICHT
// vorgezogen (Pre-Mortem 11: scheduleReleaseReconcile feuert weiterhin vor store.load, exakt
// wie im Bestand).
const deps = {
  config,
  store,
  audit,
  callFinish,
  lifecycle,
  provisioning,
  outboundGates,
  requestTenant,
  requireTenant,
  ttsStore,
  directiveSynth,
  voiceRender,
  costTruing,
  costCrossCheck,
  // KV2-1: durabler Audit-Sink des Kostenpfads - auditStoreRef geht an buildApp/
  // wireWebLogin (das die Zelle befuellt), durableAudit an bootServer/assertBootGates
  // (das den Boot-Befund darueber schreibt).
  auditStoreRef,
  durableAudit,
  durableAuditFor,
  outageWatch,
  driftWatch,
  paidWithoutNumberWatch,
  provisionRetryWatch,
  priceDriftWatch,
  messaging,
  consultDelivery,
  elevenLabsOutbound,
  // F2-Mail: die spaet gebundene Accounts-Zelle (s. Kommentar oben) - buildApp reicht sie
  // bis wireWebLogin durch, das accountsRef.current NACH dem Bau von accounts setzt.
  accountsRef,
};
const { app } = await buildApp(deps);
await bootServer({ app, ...deps });
