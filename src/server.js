import "./process-guards.js";
import { config } from "./config.js";
import * as store from "./store.js";
import { planSummarySms } from "./sms-summary.ts";
import { summarizeCall } from "./claude.js";
import { qualifiesAsInboxEntry } from "./inbox-entry.ts";
import { createTtsStore } from "./tts/store.js";
import { makeDirectiveSynth } from "./tts/directive-synth.js";
import { makeVorspannErzeuger } from "./elevenlabs/outbound-vorspann.js";
import { makeVorspannAblauf } from "./elevenlabs/vorspann-ablauf.js";
import { audit } from "./util.ts";
import { makeDurableAudit } from "./durable-audit.js";
import { voiceControl, messaging, numberProvisioning, providerConfigRead } from "./telephony/registry.js";
import { sendBootstrapAlertSms } from "./telephony/alert-sms.js";
import { makeVoiceRender } from "./telephony/voice-render.js";
import { terminateAndBillCall, hangUpAction, billThunk } from "./telephony/call-termination.ts";
import { makeCallFinish } from "./telephony/call-finish.js";
import { metrics } from "./metrics.js";
import { makeOutageWatch } from "./telephony/outage-report.js";
import { makePaidWithoutNumberWatch } from "./billing/paid-without-number-watch.ts";
import { makePriceDriftWatch } from "./billing/price-drift-watch.ts";
import { makeProvisionRetryWatch } from "./billing/provision-retry-sweep.ts";
import { makeElConfigRead } from "./telephony/outbound-config-soll.ts";
import { makeElevenLabsOutbound, mitAuftragsurteil } from "./elevenlabs/outbound.js";
import { makeInboundBridges, umleitenOderAuflegen } from "./elevenlabs/inbound-bridges.ts";
import { makeTrunkSweep } from "./elevenlabs/inbound-trunk-beleg.ts";
import { inboundTrunkSchreiberWennErlaubt, sipRegistrarWennAktiv } from "./elevenlabs/nummern-registrierung.js";
import { selectMailer } from "./wiring/web-login.js";
import { makeOutboundGates, ausgehendGesperrt } from "./telephony/outbound-gates.js";
import { makeAniOwnershipRecheck } from "./telephony/ani-ownership-recheck.js";
import { reattachActiveCall as reattachActiveCallCore } from "./telephony/reattach.js";
import { makeCallLifecycle } from "./telephony/call-lifecycle.ts";
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
import { resolveProvisionRetry } from "./billing/provision-trigger.ts";
import { createQueue } from "./queue/registry.js";
import { stripeBilling } from "./billing/stripe.ts";
import { makeMetering } from "./billing/metering.js";
import { makeCostTruing } from "./billing/cost-truing.ts";
import { fetchConversation } from "./elevenlabs/convai.js";
import { makeCostCrossCheck } from "./billing/cost-cross-check.ts";
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
import { makeAbschaltweiche } from "./abschaltweiche.js";
import { bootServer } from "./boot.js";
import { anfrage } from "./utils/anfrage.js";
import { setzeKennungInLogzeilen } from "./utils/anfrage-kennung.ts";
import { starteTelemetrie } from "./utils/telemetrie.js";

await store.oeffneSpeicher();

const provisioningQueue = createQueue();

const { requestTenant, requireTenant } = makeRequestTenant(store);

const telnyxRead = providerConfigRead();
const { gates: outboundGates, callQuotaDenial } = makeOutboundGates({
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

const metering = makeMetering({ store });

const costCrossCheck = makeCostCrossCheck({ store, config, voiceControl });

const mailer = selectMailer(config);

const auditStoreRef = { current: null };

const durableAudit = makeDurableAudit({ audit, auditStoreRef });

const durableAuditFor = (tenantId) => makeDurableAudit({ audit, auditStoreRef, tenantId });

const elKostenRead = {
  fetchConversation: (conversationId) =>
    fetchConversation({ fetchImpl: anfrage, account: config.voice.elevenLabsOutbound, conversationId }),
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
  reparatur: inboundTrunkSchreiberWennErlaubt(config),
  mitStartSperre: store.mitStartSperre,
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
});

const callFinish = {
  ...callFinishOhneUrteil,
  finishCall: mitAuftragsurteil({ finishCall: callFinishOhneUrteil.finishCall, summarizeCall }),
};

const endCarrierCall = (callId) => {
  const call = store.getCall(callId);
  const auflegen = call ? hangUpAction(voiceControl, call, call.twilioSid) : null;
  return auflegen?.();
};
const elevenLabsOutbound = makeElevenLabsOutbound({
  store,
  config,
  terminateAndBillCall,
  billThunk,
  finishCall: callFinish.finishCall,
  consultAllowedForCall,
  lookupAvailableFor: elevenLabsLookupAvailableFor,
  sipRegistrar: sipRegistrarWennAktiv(config),
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
  blockingBudgetAxis,
});

const inboundBridges = makeInboundBridges({
  store,
  umleiten: ({ call, rueckfallUrl }) =>
    umleitenOderAuflegen({ voiceControl, endCarrierCall, call, url: `${config.server.publicUrl}${rueckfallUrl}` }),
});

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

const provisionRetryWatch = makeProvisionRetryWatch({
  store,
  config,
  provision: provisioning.triggerTenantProvisioning,
  audit: durableAudit,
  billing: stripeBilling,
});

const ttsStore = createTtsStore({ ttlMs: config.voice.elevenLabsPlayTts.tokenTtlMs });

const TTS_QUOTA_WARN_EVENT = "tts_quota_warning";
const TTS_QUOTA_SMS_PREFIX = "[Hermes] ElevenLabs-Kontingent-Warnschwelle erreicht: ";
function onTtsQuotaWarning(warning) {
  const detail = `zeichen=${warning.characters}/${warning.quota} zyklus=${warning.cycleKey}`;
  audit(TTS_QUOTA_WARN_EVENT, null, detail);
  sendBootstrapAlertSms({ messaging, config, store, prefix: TTS_QUOTA_SMS_PREFIX, detail, logTag: TTS_QUOTA_WARN_EVENT });
}

const directiveSynth = makeDirectiveSynth({ config, ttsStore, store, onQuotaWarning: onTtsQuotaWarning });

const vorspannErzeuger = makeVorspannErzeuger({ config, store, synthese: directiveSynth.synthesizeVorspann });

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
});

const consultDelivery = makeConsultDelivery({ store, webhookHoldMs: config.tenancy.elConsultAnswerMs });

const voiceRender = makeVoiceRender({ config });

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
  vorspannErzeuger,
  vorspannAblauf,
  inboundBridges,
  inboundTrunkSweep,
  telemetrie,
  abschaltweiche: makeAbschaltweiche(),
  healthzOptionen: { zeitplaene: provisioning.ueberfaelligeZeitplaene },
};
const { app, accounts, auditStore } = await buildApp(deps);
accountsRef.current = accounts;
auditStoreRef.current = auditStore;
await bootServer({ app, auditStore, ...deps });
