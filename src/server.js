// Voice-Gateway: Twilio-Webhooks (Inbound/Outbound), Audio-Bridge (Realtime),
// MCP ueber Streamable HTTP (/mcp), REST-API fuer Dashboard & stdio-MCP.
// MUSS erste Importzeile bleiben (vor store.js) - globales Crash-Netz, ESM-Eval-Order (T-P0-07).
import "./process-guards.js";
import { config } from "./config.js";
import * as store from "./store.js";
import { planSummarySms } from "./sms-summary.js";
import { summarizeCall } from "./claude.js";
import { makeConversationWatchdog, WATCHDOG_LOG_PREFIX } from "./telnyx-conversation-watchdog.js";
import { makeCallControlTerminator } from "./telnyx-call-terminate.js";
import { createTtsStore } from "./tts/store.js";
import { makeDirectiveSynth } from "./tts/directive-synth.js";
import { audit } from "./util.js";
import { voiceControl, messaging, numberProvisioning } from "./telephony/registry.js";
import { makeVoiceRender } from "./telephony/voice-render.js";
import { terminateAndBillCall, hangUpAction, billThunk } from "./telephony/call-termination.js";
import { makeCallFinish } from "./telephony/call-finish.js";
import { makeOutboundGates } from "./telephony/outbound-gates.js";
import { reattachActiveCall as reattachActiveCallCore } from "./telephony/reattach.js";
import { makeCallLifecycle } from "./telephony/call-lifecycle.js";
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
import {
  makeRequestTenant,
  internalIdentity,
  OWNER_ID,
  TENANT_REJECT,
} from "./request-tenant.js";
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
const { gates: outboundGates } = makeOutboundGates({
  store,
  config,
  requestTenant,
  internalIdentity,
  OWNER_ID,
  TENANT_REJECT,
  audit,
  messaging,
});

// Metering-Instanz (P6b3-Meter + outbound-p1c-Reconcile) EINMAL beim Boot verdrahtet
// (Naht wie outboundGates/provisioningQueue, nicht im Handler; INV-7). store+config
// werden geschlossen; die Gating-Bedingung `if (config.billing.paymentEnabled)` bleibt beim
// Aufrufer (finishCall / Provisioning-Drain), nicht im Modul.
const metering = makeMetering({ store, config });

// call-finish (P4): finishCall (Settlement/Summary/SMS) + releaseReserve (Reserve-Freigabe)
// EINMAL beim Boot verdrahtet (Naht wie metering/outboundGates, nicht im Handler; INV-7).
// EINE Instanz: dieselbe finishCall-Referenz geht an attachMediaBridge UND - via
// makeVoiceRoutes - makeCallControlIngest
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
  billThunk,
  reattachActiveCallCore,
  cappedEndedAtMs,
  classifyCallTime,
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

// stab-p9 (Kosten-Notaus): EIN ConversationWatchdog, geteilt von Shim (Loop-Guard +
// Dead-Air-Feed pro Turn) und Call-Control-Ingest (Dead-Air armieren bei ai_assistant_start,
// stoppen bei hangup). Terminierung ueber das GETEILTE Call-Control-Hangup-Primitiv (auch
// der Shim nutzt makeCallControlTerminator fuer Budget-Kill/end_call, S2). EINMAL beim Boot
// verdrahtet (Naht wie metering/callFinish/lifecycle/provisioning, INV-7); geht als deps-
// Eintrag an buildApp (Shim-Mount + Voice-Routes teilen sich die EINE Instanz).
const conversationWatchdog = makeConversationWatchdog({
  config,
  terminate: makeCallControlTerminator({ store, voiceControl, logPrefix: WATCHDOG_LOG_PREFIX }),
});

// Play-TTS-Seam: haelt vorab synthetisierte Agent-Audios kurz + einmalig (PII). EINMAL
// beim Boot verdrahtet (Naht wie conversationWatchdog, INV-7).
const ttsStore = createTtsStore({ ttlMs: config.voice.elevenLabsPlayTts.tokenTtlMs });

// Play-TTS-Direktiven-Synth (fail-safe, Server-Slim P2): webt <Play>-Audio in Telnyx-
// Direktiven ein. Schliesst die EINE ttsStore-Instanz (INV-7) + config.
const directiveSynth = makeDirectiveSynth({ config, ttsStore });

// Voice-Render-Helfer (Server-Slim P3): EINE Instanz (INV-7), config wird geschlossen.
// Geht als Dep an makeVoiceRoutes (P11); die Render-Funktionen werden dort destrukturiert.
const voiceRender = makeVoiceRender({ config });

// ---------------- Kompositionswurzel (Server-Slim P15) ----------------
// buildApp(deps) verdrahtet die komplette Express-App (Middleware, Wiring, Router-Mounts,
// src/app.js); bootServer(deps) fuehrt die Boot-Sequenz aus (store.load, Retention,
// Fail-closed-Gates, listen, Audio-Bridge, Graceful-Shutdown, src/boot.js). Beide teilen
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
  conversationWatchdog,
  ttsStore,
  directiveSynth,
  voiceRender,
};
const { app } = await buildApp(deps);
await bootServer({ app, ...deps });
