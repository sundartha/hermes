import "./process-guards.js";
import { config } from "./config.ts";
import * as store from "./store.js";
import { fruehwarnung } from "./routes/intern-anrufe-laufend.js";
import { planSummarySms } from "./sms-summary.ts";
import { summarizeCall } from "./claude.js";
import { qualifiesAsInboxEntry } from "./inbox-entry.ts";
import { makeAblageBisFreigabe } from "./tts/ablage-bis-freigabe.js";
import { createTtsStore } from "./tts/store.ts";
import { makeDirectiveSynth } from "./tts/directive-synth.js";
import { makeVorspannAblauf } from "./elevenlabs/vorspann-ablauf.js";
import { audit } from "./util.ts";
import { makeDurableAudit } from "./durable-audit.js";
import { voiceControl, messaging, numberProvisioning } from "./telephony/registry.js";
import { sendBootstrapAlertSms } from "./telephony/alert-sms.ts";
import { makeVoiceRender } from "./telephony/voice-render.js";
import { terminateAndBillCall, hangUpAction, billThunk } from "./telephony/call-termination.ts";
import { makeCallFinish } from "./telephony/call-finish.js";
import { metrics } from "./metrics.ts";
import { makeOutageWatch } from "./telephony/outage-report.js";
import { makePaidWithoutNumberWatch } from "./billing/paid-without-number-watch.ts";
import { makePriceDriftWatch } from "./billing/price-drift-watch.ts";
import { makeProvisionRetryWatch } from "./billing/provision-retry-sweep.ts";
import { makeElConfigRead } from "./telephony/outbound-config-soll.ts";
import { umleitenOderAuflegen } from "./elevenlabs/inbound-bridges.ts";
import { makeInboundBridges } from "./elevenlabs/inbound-fristen.ts";
import { makeTrunkSweep } from "./elevenlabs/inbound-trunk-beleg.ts";
import { selectMailer } from "./wiring/web-login.js";
import { makeOutboundGates, ausgehendGesperrt } from "./telephony/outbound-gates.js";
import { reattachActiveCall as reattachActiveCallCore } from "./telephony/reattach.ts";
import { makeCallLifecycle } from "./telephony/call-lifecycle.ts";
import { blockingBudgetAxisFrisch } from "./budget-gate.js";
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
import { resolveProvisionRetry } from "./billing/provision-trigger.ts";
import { createQueue } from "./queue/registry.js";
import { stripeBilling } from "./billing/stripe.ts";
import { makeMetering } from "./billing/metering.js";
import { makeCostTruing } from "./billing/cost-truing.ts";
import { elevenlabsConvai, elevenlabsOutbound } from "./elevenlabs/registry.ts";
import { elevenlabsNummern } from "./elevenlabs/nummern-port.ts";
import { makeCostCrossCheck } from "./billing/cost-cross-check.ts";
import {
  makeRequestTenant,
  internalIdentity,
  OWNER_ID,
  TENANT_REJECT,
} from "./request-tenant.js";
import { makeConsultDelivery } from "./consult/delivery.js";
import { consultAllowedForCall } from "./consult/gate.ts";
import { elevenLabsLookupAvailableFor } from "./research/registry.js";
import { buildApp } from "./app.js";
import { makeAbschaltweiche } from "./abschaltweiche.js";
import { bootServer } from "./boot.js";
import { anfrage } from "./utils/anfrage.js";
import { setzeKennungInLogzeilen } from "./utils/anfrage-kennung.ts";
import { starteTelemetrie } from "./utils/telemetrie.js";
import { defaultSetTimer } from "./utils/uhr-warten.ts";

await store.oeffneSpeicher();

const provisioningQueue = createQueue();

const { requestTenant, requireTenant } = makeRequestTenant(store);

const { gates: outboundGates, callQuotaDenial } = makeOutboundGates({
  store,
  config,
  requestTenant,
  internalIdentity,
  OWNER_ID,
  TENANT_REJECT,
  audit,
  messaging,
  budgetReservierung: store.budgetReservierung,
});

const metering = makeMetering({ store });

const costCrossCheck = makeCostCrossCheck({ store, config, voiceControl });

const mailer = selectMailer(config);

const auditStoreRef = { current: null };

const durableAudit = makeDurableAudit({ audit, auditStoreRef });

const durableAuditFor = (tenantId) => makeDurableAudit({ audit, auditStoreRef, tenantId });

const elKostenRead = {
  fetchConversation: (conversationId) =>
    elevenlabsConvai().fetchConversation({ fetchImpl: anfrage, account: config.voice.elevenLabsOutbound, conversationId }),
};

const costTruing = makeCostTruing({
  store, config, voiceControl, audit: durableAudit, messaging, mailer, elKostenRead,
});

const outageWatch = makeOutageWatch({ store, config, audit, messaging, mailer });

const elRead = makeElConfigRead(config);
const inboundTrunkSweep = makeTrunkSweep({
  store,
  config,
  elRead,
  reparatur: elevenlabsNummern().inboundTrunkSchreiberWennErlaubt(config),
  mitStartSperre: store.mitStartSperre,
  jetzt: () => new Date(),
});

const paidWithoutNumberWatch = makePaidWithoutNumberWatch({ store, config, audit: durableAudit });

const priceDriftWatch = makePriceDriftWatch({
  store,
  config,
  audit: durableAudit,
  messaging,
  mailer,
  lesePreis: (priceId) => stripeBilling.retrievePriceAmount(priceId),
});

const accountsRef = { current: null };

const callFinishOhneUrteil = makeCallFinish({
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
  metrics,
  leitungsplaetze: store.leitungsplaetze,
  budgetReservierung: store.budgetReservierung,
});

const callFinish = {
  ...callFinishOhneUrteil,
  finishCall: elevenlabsOutbound().mitAuftragsurteil({ finishCall: callFinishOhneUrteil.finishCall, summarizeCall }),
};

const endCarrierCall = (callId, gelesen) => {
  const call = store.getCall(callId) ?? gelesen;
  const auflegen = call ? hangUpAction(voiceControl, call, call.twilioSid) : null;
  return auflegen?.();
};
const elevenLabsOutbound = elevenlabsOutbound().makeElevenLabsOutbound({
  store,
  config,
  terminateAndBillCall,
  billThunk,
  finishCall: callFinish.finishCall,
  consultAllowedForCall,
  lookupAvailableFor: elevenLabsLookupAvailableFor,
  endCarrierCall,
});

const lifecycle = makeCallLifecycle({
  store,
  config,
  finishCall: callFinish.finishCall,
  releaseReserve: callFinish.releaseReserve,
  voiceControl,
  terminateAndBillCall,
  hangUpAction,
  billThunk, endActiveCall: elevenLabsOutbound.endActiveCall,
  awaitAndPersistInboundElResult: elevenLabsOutbound.awaitAndPersistInboundElResult,
  reattachActiveCallCore,
  cappedEndedAtMs,
  classifyCallTime,
  blockingBudgetAxis: blockingBudgetAxisFrisch,
});

const inboundBridges = makeInboundBridges({
  store,
  now: Date.now,
  umleiten: ({ call, rueckfallUrl }) =>
    umleitenOderAuflegen({ voiceControl, endCarrierCall, call, url: `${config.server.publicUrl}${rueckfallUrl}` }),
});

let anrufstartHandler = null;
const anrufstartVerdrahtung = {
  setzeHandler: (handler) => {
    anrufstartHandler = handler;
  },
};

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
  anrufstartHandler: (auftrag) => anrufstartHandler(auftrag),
});

const provisionRetryWatch = makeProvisionRetryWatch({
  store,
  config,
  provision: provisioning.triggerTenantProvisioning,
  audit: durableAudit,
  billing: stripeBilling,
});

const ttsStore = createTtsStore({
  ttlMs: config.voice.elevenLabsPlayTts.tokenTtlMs,
  ablage: config.store.storeBackend === "pg" ? store.ttsAblage : null,
  bisFreigabeAblage: config.store.storeBackend === "pg" ? makeAblageBisFreigabe(store.ttsAblage) : null,
});

const TTS_QUOTA_WARN_EVENT = "tts_quota_warning";
const TTS_QUOTA_SMS_PREFIX = "[Hermes] ElevenLabs-Kontingent-Warnschwelle erreicht: ";
function onTtsQuotaWarning(warning) {
  const detail = `zeichen=${warning.characters}/${warning.quota} zyklus=${warning.cycleKey}`;
  audit(TTS_QUOTA_WARN_EVENT, null, detail);
  sendBootstrapAlertSms({ messaging, config, store, prefix: TTS_QUOTA_SMS_PREFIX, detail, logTag: TTS_QUOTA_WARN_EVENT, jetzt: () => new Date() });
}

const directiveSynth = makeDirectiveSynth({ config, ttsStore, store, onQuotaWarning: onTtsQuotaWarning });

const vorspannErzeuger = elevenlabsOutbound().makeVorspannErzeuger({ config, store, synthese: directiveSynth.synthesizeVorspann });

const vorspannAblauf = makeVorspannAblauf({
  voiceControl,
  store,
  config,
  ttsStore,
  inboundBridges,
  terminateAndBillCall,
  awaitAndPersistInboundElResult: elevenLabsOutbound.awaitAndPersistInboundElResult,
  billThunk,
  finishCall: callFinish.finishCall,
  ausgehendGesperrt: () => ausgehendGesperrt(config, store),
  now: Date.now,
  setTimer: defaultSetTimer,
});

const consultDelivery = makeConsultDelivery({ store, webhookHoldMs: config.tenancy.elConsultAnswerMs });

const voiceRender = makeVoiceRender();

setzeKennungInLogzeilen(config.metrics.logRequestId);

const telemetrie = await starteTelemetrie({
  url: config.telemetry.telemetryOtlpUrl,
  benutzer: config.telemetry.telemetryOtlpUser,
  token: config.telemetry.telemetryOtlpToken,
  instanzKennung: config.telemetry.telemetryInstanceId,
  version: config.server.deployedCommit,
  intervallMs: config.telemetry.telemetryIntervalMs,
  poolZustand: store.poolZustand,
  warteschlangeZustand: provisioningQueue.warteschlangeZustand,
  leitungsplaetzeBelegung: store.leitungsplaetze.belegung,
});

const deps = {
  config,
  store,
  audit,
  callFinish,
  lifecycle,
  provisioning,
  outboundGates,
  callQuotaDenial,
  requestTenant,
  requireTenant,
  ttsStore,
  directiveSynth,
  voiceRender,
  costTruing,
  costCrossCheck,
  durableAudit,
  durableAuditFor,
  outageWatch,
  paidWithoutNumberWatch,
  provisionRetryWatch,
  priceDriftWatch,
  messaging,
  consultDelivery,
  elevenLabsOutbound,
  anrufstartVerdrahtung,
  vorspannErzeuger,
  vorspannAblauf,
  inboundBridges,
  inboundTrunkSweep,
  telemetrie,
  abschaltweiche: makeAbschaltweiche(),
  healthzOptionen: {
    zeitplaene: provisioning.ueberfaelligeZeitplaene,
    fruehwarnung: () => fruehwarnung(store, Date.now()),
  },
};
const { app, accounts, auditStore, zeitplaeneAnmelden } = await buildApp(deps);
accountsRef.current = accounts;
auditStoreRef.current = auditStore;
await bootServer({ app, auditStore, zeitplaeneAnmelden, ...deps });
