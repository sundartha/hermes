import { config } from "../config.js";
import * as ops from "./state-ops.js";
import { tenantLanguage as tenantLanguageOf } from "./views.js";
import {
  BOOTSTRAP_TENANT_ID,
  DEFAULT_PROVIDER,
  CENTS_PER_EUR,
  isBookableCents,
  USAGE_CORRUPT_REASON,
  emptyPlatformTtsUsage,
  emptyCostCrossCheck,
} from "./defaults.js";
import { migrate } from "../db/migrate.js";
import { backfillGreetingNotices } from "./greeting-notice-migration.js";

export { BOOTSTRAP_TENANT_ID };
export { anrufpauseSetzen } from "./state-ops.js";

const ACTIVE_CALL_BY_ID_SQL = `SELECT * FROM call WHERE id = $1 AND status = $2`;

export function makePgStore(runner, { prepareSchema = migrate } = {}) {
  let state = null;
  let flushChain = Promise.resolve();
  let lastFlushError = null;

  function requireState() {
    if (!state) throw new Error("pg-Store nicht initialisiert - erst await store.init() aufrufen");
    return state;
  }

  async function init() {
    await runner.withClient(async (client) => {
      await setTenant(client, BOOTSTRAP_TENANT_ID);
      await prepareSchema(client, BOOTSTRAP_TENANT_ID);
      state = await hydrate(client);
      const flushBootstrap = () =>
        flushTenants(
          client,
          state.tenants.filter((t) => t.id === BOOTSTRAP_TENANT_ID),
        );
      if (ops.seedBootstrapIdpSubject(state, config.auth.ownerIdpSubject, BOOTSTRAP_TENANT_ID))
        await flushBootstrap();
      if (ops.seedBootstrapKyc(state, BOOTSTRAP_TENANT_ID)) await flushBootstrap();
      for (const tenantId of backfillGreetingNotices(state)) {
        await setTenant(client, tenantId);
        await flushSettings(client, tenantId, ops.settingsFor(state, tenantId));
      }
      await setTenant(client, BOOTSTRAP_TENANT_ID);
    });
    return state;
  }

  function save(preFlush) {
    const snapshot = requireState();
    flushChain = flushChain
      .then(() => runner.withClient((client) => flush(client, snapshot, preFlush)))
      .then(
        () => {
          lastFlushError = null;
        },
        (err) => {
          lastFlushError = err;
          console.error("[pg] Flush fehlgeschlagen:", err.message);
        },
      );
    return flushChain;
  }

  async function drainFlushes() {
    let ref = flushChain;
    for (;;) {
      await ref;
      if (flushChain === ref) break;
      ref = flushChain;
    }
    if (lastFlushError) throw lastFlushError;
  }

  async function attachActiveCallRow(sql, lookupValue) {
    try {
      const state = requireState();
      return await runner.withClient(async (client) => {
        for (const tenant of state.tenants) {
          await setTenant(client, tenant.id);
          const rows = (await client.query(sql, [lookupValue, CALL_STATUS_ACTIVE])).rows;
          if (rows.length === 0) continue;
          const callId = rows[0].id;
          const segRows = (
            await client.query(`SELECT * FROM transcript_segment WHERE call_id = $1 ORDER BY id ASC`, [
              callId,
            ])
          ).rows;
          const itemRows = (
            await client.query(`SELECT * FROM action_item WHERE call_id = $1 ORDER BY seq DESC`, [
              callId,
            ])
          ).rows;
          const call = rowToCall(rows[0], groupTranscripts(segRows), groupActionItemIds(itemRows));
          const raced = ops.getCall(state, callId);
          if (raced) return raced;
          state.calls.push(call);
          return call;
        }
        return null;
      });
    } catch (e) {
      console.error("[pg] attachActiveCall fehlgeschlagen:", e.message);
      return null;
    }
  }

  return {
    init,
    load: () => requireState(),
    save,
    drainFlushes,
    newId: ops.newId,

    createCall(input) {
      const call = ops.createCall(requireState(), input);
      save();
      return call;
    },
    getCall: (id) => ops.getCall(requireState(), id),
    attachActiveCall: (callId) => attachActiveCallRow(ACTIVE_CALL_BY_ID_SQL, callId),
    addTranscript(callId, role, text) {
      if (ops.addTranscript(requireState(), callId, role, text)) save();
    },
    purgeTranscript(callId) {
      if (ops.purgeTranscript(requireState(), callId)) save();
    },
    markAnswered(callId) {
      const { call, changed } = ops.markAnswered(requireState(), callId);
      if (changed) save();
      return call;
    },
    trueUpAnsweredAt(callId, answeredAtIso) {
      const { call, changed } = ops.trueUpAnsweredAt(requireState(), callId, answeredAtIso);
      if (changed) save();
      return call;
    },
    recordAnsweredUnclearReason(callId, reason) {
      const { call, changed } = ops.recordAnsweredUnclearReason(requireState(), callId, reason);
      if (changed) save(); return call;
    },
    ...elDetektorMutatoren({ requireState, save }),
    endCallRecord(callId, status = "completed") {
      const { call, changed } = ops.endCallRecord(requireState(), callId, status);
      if (changed) save();
      return call;
    },
    setCallEndedAt(callId, status, endedAtIso) {
      const { call, changed } = ops.setCallEndedAt(requireState(), callId, status, endedAtIso);
      if (changed) save();
      return call;
    },
    markSummarySmsSent(callId) {
      const { call, changed } = ops.markSummarySmsSent(requireState(), callId);
      if (changed) save();
      return call;
    },
    markSummaryMailSent(callId) {
      const { call, changed } = ops.markSummaryMailSent(requireState(), callId);
      if (changed) save();
      return call;
    },
    markBilled(callId) {
      const { call, changed } = ops.markBilled(requireState(), callId);
      if (changed) save();
      return call;
    },
    recordWebhookAnchors(callId, anchors) {
      const { call, changed } = ops.recordWebhookAnchors(requireState(), callId, anchors);
      if (changed) save();
      return call;
    },
    markInboxEntry(callId, qualifies) {
      const { call, changed } = ops.markInboxEntry(requireState(), callId, qualifies);
      if (changed) save(); return call;
    },
    takeInboxEntries(tenantId, options) {
      const result = ops.takeInboxEntries(requireState(), tenantId, options);
      if (result.marked) save();
      return result;
    },
    recordCallEstimatedCostCents(callId, input) {
      const { call, changed } = ops.recordCallEstimatedCostCents(requireState(), callId, input);
      if (changed) save();
      return call;
    },
    recordCallCostTruingResult(callId, outcome) {
      const { call, changed } = ops.recordCallCostTruingResult(requireState(), callId, outcome);
      if (changed) save();
      return call;
    },
    ...kostenAbschlussMutatoren({ requireState, save }),
    recordFailureReason(callId, reason) {
      const { call, changed } = ops.recordFailureReason(requireState(), callId, reason);
      if (changed) save();
      return call;
    },
    recordElevenlabsConversationId(callId, conversationId) {
      const { call, changed } = ops.recordElevenlabsConversationId(
        requireState(),
        callId,
        conversationId,
      );
      if (changed) save();
      return call;
    },
    recordSipCallId(callId, sipCallId) {
      const { call, changed } = ops.recordSipCallId(requireState(), callId, sipCallId);
      if (changed) save();
      return call;
    },
    recordCostProfile(callId, profil) {
      const { call, changed } = ops.recordCostProfile(requireState(), callId, profil);
      if (changed) save();
      return call;
    },
    ...brueckenZustandMutatoren({ requireState, save }),
    ...inboundTrunkBelegMutatoren({ requireState, save }),
    recordCallCostEvidence(eingabe) {
      const { evidence, changed } = ops.recordCallCostEvidence(requireState(), eingabe);
      if (changed) save();
      return evidence;
    },
    callCostEvidence(callId) {
      return ops.callCostEvidence(requireState(), callId);
    },
    ...absenderWahrheitMutatoren({ requireState, save }),
    recordProviderCallResult(callId, result) {
      const { call, changed } = ops.recordProviderCallResult(requireState(), callId, result);
      if (changed) save();
      return call;
    },
    recordProviderCollectedFields(callId, fields) {
      const { call, changed } = ops.recordProviderCollectedFields(requireState(), callId, fields);
      if (changed) save();
      return call;
    },
    recordCalleeConfirmedTimezone(callId, confirmed) {
      const { call, changed } = ops.recordCalleeConfirmedTimezone(requireState(), callId, confirmed);
      if (changed) save();
      return call;
    },
    countCallerTurn(callId) {
      const { call, changed } = ops.countCallerTurn(requireState(), callId);
      if (changed) save();
      return call ? call.callerTurns : 0;
    },
    emitConsult(callId, questions) {
      const { call, changed } = ops.emitConsult(requireState(), callId, questions);
      if (changed) save();
      return call;
    },
    answerConsult(callId, input) {
      const result = ops.answerConsult(requireState(), callId, input);
      if (result.changed) save();
      return result;
    },
    markConsultAnswerDelivered(callId) {
      const result = ops.markConsultAnswerDelivered(requireState(), callId);
      if (result.changed) save();
      return result;
    },
    markConsultAskDelivered(callId, eventId) {
      const result = ops.markConsultAskDelivered(requireState(), callId, eventId);
      if (result.changed) save();
      return result;
    },
    ackConsult(callId, input) {
      const result = ops.ackConsult(requireState(), callId, input);
      if (result.changed) save();
      return result;
    },
    timeOutStagedConsult(callId, input) {
      const result = ops.timeOutStagedConsult(requireState(), callId, input);
      if (result.changed) save();
      return result;
    },
    expireOpenConsults(callId) {
      const { call, changed } = ops.expireOpenConsults(requireState(), callId);
      if (changed) save();
      return call;
    },
    pendingConsult: (callId, afterEventId) =>
      ops.pendingConsult(requireState(), callId, afterEventId),
    advanceInCallConsult(callId, input) {
      const { changed, wait } = ops.advanceInCallConsult(requireState(), callId, input);
      if (changed) save();
      return wait;
    },
    noteConsultPoll: (callId) => ops.noteConsultPoll(requireState(), callId),
    addLookupFacts(callId, facts) {
      const { changed, added } = ops.addLookupFacts(requireState(), callId, facts);
      if (changed) save();
      return added;
    },
    countCallLookup: (callId) => ops.countCallLookup(requireState(), callId),
    recordCallLookup(callId, query) {
      const { changed, seq } = ops.recordCallLookup(requireState(), callId, query);
      if (changed) save();
      return seq;
    },
    finishCallLookup(callId, seq, outcome) {
      const { changed } = ops.finishCallLookup(requireState(), callId, { seq, ...outcome });
      if (changed) save();
      return changed;
    },
    countNoSpeechTurn: (callId) => ops.countNoSpeechTurn(requireState(), callId),
    clearNoSpeechStreak: (callId) => ops.clearNoSpeechStreak(requireState(), callId),
    countOutboundCallsSince: (sinceIso, filters = {}) =>
      ops.countOutboundCallsSince(requireState(), sinceIso, filters),
    counterpartyMemory: (tenantId, e164) => ops.counterpartyMemory(requireState(), tenantId, e164),
    findTenantByNumber: (e164) => ops.findTenantByNumber(requireState(), e164),
    numberRecordByE164: (e164) => ops.numberRecordByE164(requireState(), e164),
    resolveCallLanguage: (args) => ops.resolveCallLanguage(requireState(), args),
    tenantLanguage: (tenantId) => tenantLanguageOf(requireState(), tenantId),

    addActionItem(callId, text, type = "todo") {
      const result = ops.addActionItem(requireState(), callId, text, type);
      if (!result.duplicate) save();
      return result;
    },
    callActionItems: (callId) => ops.callActionItems(requireState(), callId),
    toggleActionItem(id) {
      const item = ops.toggleActionItem(requireState(), id);
      if (item) save();
      return item;
    },

    getCalendar: (tenantId) => ops.getCalendar(requireState(), tenantId),
    addCalendarEvent(event) {
      const ev = ops.addCalendarEvent(requireState(), event);
      save();
      return ev;
    },
    findConflict: (tenantId, startIso, endIso) =>
      ops.findConflict(requireState(), tenantId, startIso, endIso),

    tenantContext: (tenantId) => ops.tenantContext(requireState(), "", tenantId),

    trackUsage(tenantId, tokens, cfg) {
      const usage = ops.trackUsage(requireState(), tenantId, tokens, cfg, new Date().toISOString());
      save();
      return usage;
    },
    budgetExceeded: (tenantId, cfg) =>
      ops.budgetExceeded(requireState(), tenantId, cfg, new Date().toISOString()),
    liveBudgetExceeded: (tenantId, liveCents, cfg) =>
      ops.liveBudgetExceeded(requireState(), tenantId, liveCents, cfg, new Date().toISOString()),
    activeCallsFor: (tenantId) => ops.activeCallsFor(requireState(), tenantId),
    reserveExceedsBudget: (tenantId, reserveCents, cfg) =>
      ops.reserveExceedsBudget(requireState(), tenantId, reserveCents, cfg, new Date().toISOString()),
    tenantBudgetSnapshot: (tenantId, cfg) =>
      ops.tenantBudgetSnapshot(requireState(), tenantId, cfg, new Date().toISOString()),
    addVoiceUsageCostCents(tenantId, costCents) {
      const usage = ops.addVoiceUsageCostCents(requireState(), tenantId, costCents, new Date().toISOString());
      save();
      return usage;
    },
    addResearchFeeCostCents(tenantId, costCents) {
      const usage = ops.addResearchFeeCostCents(requireState(), tenantId, costCents, new Date().toISOString());
      save();
      return usage;
    },
    applyCostCorrectionCents(tenantId, input) {
      const result = ops.applyCostCorrectionCents(requireState(), tenantId, input, new Date().toISOString());
      if (result.booked) save();
      return result;
    },
    usageOf: (tenantId) => ops.usageOf(requireState(), tenantId),

    tryReserveOutboundBudget: (tenantId, reserveCents, cfg) =>
      ops.tryReserveOutboundBudget(requireState(), tenantId, reserveCents, cfg, new Date().toISOString()),
    releaseOutboundReserve: (call) => ops.releaseOutboundReserve(requireState(), call),
    releaseOutboundReserveCents: (tenantId, cents) =>
      ops.releaseOutboundReserveCents(requireState(), tenantId, cents),
    reservationOf: (tenantId) => ops.reservationFor(requireState(), tenantId),
    claimPlatformSpendWarning: (cfg, nowIso) =>
      ops.claimPlatformSpendWarning(requireState(), cfg, nowIso),

    recordTtsCharacters(chars, nowIso) {
      const r = ops.recordTtsCharacters(requireState(), chars, config.billing, nowIso);
      if (r.changed) save();
      return r.warning;
    },
    platformTtsUsageView: (nowIso) => ops.platformTtsUsageView(requireState(), config.billing, nowIso),

    recordTenantTtsCharacters(tenantId, chars) {
      const r = ops.recordTenantTtsCharacters(requireState(), tenantId, chars);
      if (r.changed) save();
      return r;
    },

    recordRelayTtsCharacters(tenantId, chars, nowIso) {
      const r = ops.recordRelayTtsCharacters(requireState(), { tenantId, chars, cfg: config.billing, nowIso });
      if (r.changed) save();
      return r.warning;
    },

    markCostCrossCheckAttempted(monthKey) {
      const s = requireState();
      const before = s.costCrossCheck.lastCheckedMonthKey;
      ops.markCrossCheckAttempted(s, monthKey);
      if (s.costCrossCheck.lastCheckedMonthKey !== before) save();
    },

    setTenantBudget(tenantId, amounts) {
      const row = ops.setTenantBudget(requireState(), tenantId, amounts);
      save();
      return row;
    },
    recordUsageEvent(input) {
      const event = ops.recordUsageEvent(requireState(), input);
      save();
      return event;
    },
    dailySmsCount: (tenantId, sinceIso) => ops.dailySmsCount(requireState(), tenantId, sinceIso),
    planMinutesExceeded: (tenantId, opts) => ops.planMinutesExceeded(requireState(), tenantId, opts),
    pendingMeterEvents: () => ops.pendingMeterEvents(requireState()),
    markMeterEventsSent(eventIds) {
      const n = ops.markMeterEventsSent(requireState(), eventIds);
      if (n) save();
      return n;
    },

    setKycLevel(tenantId, level) {
      const tenant = ops.setKycLevel(requireState(), tenantId, level);
      save();
      return tenant;
    },
    kycReached: (tenantId, minLevel) => ops.kycReached(requireState(), tenantId, minLevel),

    tenantActiveSubscriber: (tenantId, minLevel) =>
      ops.tenantActiveSubscriber(requireState(), tenantId, minLevel),
    tenantInactive: (tenantId) => ops.tenantInactive(requireState(), tenantId),

    setSuspendedAtIfAbsent(tenantId) {
      const { changed } = ops.setSuspendedAtIfAbsent(requireState(), tenantId, new Date().toISOString());
      if (changed) save();
    },
    clearSuspendedAt(tenantId) {
      const { changed } = ops.clearSuspendedAt(requireState(), tenantId);
      if (changed) save();
    },

    stampBudgetPeriod(tenantId, periodStartIso) {
      const { changed } = ops.stampBudgetPeriod(requireState(), tenantId, periodStartIso);
      if (changed) save();
      return changed;
    },
    tenantSuspendedAt: (tenantId) => ops.tenantSuspendedAt(requireState(), tenantId),

    setTenantStripe(tenantId, patch) {
      const tenant = ops.setTenantStripe(requireState(), tenantId, patch);
      save();
      return tenant;
    },
    tenantStripe: (tenantId) => ops.tenantStripe(requireState(), tenantId),

    setTenantSubscription(tenantId, patch) {
      const tenant = ops.setTenantSubscription(requireState(), tenantId, patch);
      ops.deriveTenantBudgetFromPlan(requireState(), tenantId, config.billing);
      save();
      return tenant;
    },
    tenantSubscription: (tenantId) => ops.tenantSubscription(requireState(), tenantId),
    findTenantBySubscription: (subscriptionId) =>
      ops.findTenantBySubscription(requireState(), subscriptionId),

    findTenantByCustomer: (customerId) => ops.findTenantByCustomer(requireState(), customerId),
    tenantExists: (tenantId) => ops.tenantExists(requireState(), tenantId),
    setBillingHold(tenantId, patch) {
      ops.setBillingHold(requireState(), tenantId, patch);
      save();
    },
    clearBillingHold(tenantId) {
      ops.clearBillingHold(requireState(), tenantId);
      save();
    },
    billingHoldActive: (tenantId) =>
      ops.billingHoldActive(requireState(), tenantId, new Date().toISOString()),

    setContractEndCleanupPending(tenantId, patch) {
      const tenant = ops.setContractEndCleanupPending(requireState(), tenantId, patch);
      save();
      return tenant;
    },
    contractEndCleanupPending: (tenantId) =>
      ops.contractEndCleanupPending(requireState(), tenantId),
    tenantsPendingContractEndCleanup: () =>
      ops.tenantsPendingContractEndCleanup(requireState()),
    tenantIdpSubject: (tenantId) => ops.tenantIdpSubject(requireState(), tenantId),

    setCancellationMailPending(tenantId, patch) {
      const tenant = ops.setCancellationMailPending(requireState(), tenantId, patch);
      save();
      return tenant;
    },
    cancellationMailPending: (tenantId) =>
      ops.cancellationMailPending(requireState(), tenantId),
    tenantsPendingCancellationMail: () =>
      ops.tenantsPendingCancellationMail(requireState()),

    setPrivateNumber(tenantId, raw) {
      const tenant = ops.setPrivateNumber(requireState(), tenantId, raw);
      save();
      return tenant;
    },
    tenantPrivateNumber: (tenantId) => ops.tenantPrivateNumber(requireState(), tenantId),

    setTenantGeo(tenantId, patch) {
      const tenant = ops.setTenantGeo(requireState(), tenantId, patch);
      save();
      return tenant;
    },
    tenantGeo: (tenantId) => ops.tenantGeo(requireState(), tenantId),
    tenantTimezone: (tenantId) => ops.tenantTimezone(requireState(), tenantId),

    setNewsletterConsent(tenantId, consent) {
      const tenant = ops.setNewsletterConsent(requireState(), tenantId, consent);
      save();
      return tenant;
    },
    tenantNewsletterConsent: (tenantId) => ops.tenantNewsletterConsent(requireState(), tenantId),

    tenantNewsletterRecipients: (tenantId) => ops.tenantNewsletterRecipients(requireState(), tenantId),
    confirmedNewsletterRecipients: (tenantId) =>
      ops.confirmedNewsletterRecipients(requireState(), tenantId),
    dailyNewsletterConfirmMailCount: (tenantId, sinceIso) =>
      ops.dailyNewsletterConfirmMailCount(requireState(), tenantId, sinceIso),
    addNewsletterRecipient(tenantId, recipientInput) {
      const recipient = ops.addNewsletterRecipient(requireState(), tenantId, recipientInput);
      save();
      return recipient;
    },
    removeNewsletterRecipient(tenantId, email) {
      const changed = ops.removeNewsletterRecipient(requireState(), tenantId, email);
      if (changed) save();
      return changed;
    },
    confirmNewsletterRecipientByToken(tokenHash, nowIso) {
      const result = ops.confirmNewsletterRecipientByToken(requireState(), tokenHash, nowIso);
      if (result) save();
      return result;
    },
    unsubscribeNewsletterRecipientByToken(token) {
      const result = ops.unsubscribeNewsletterRecipientByToken(requireState(), token);
      if (result) save();
      return result;
    },

    addNotification(title, body, callId) {
      ops.addNotification(requireState(), title, body, callId);
      save();
    },

    seedBootstrapNumber(e164, tenantId, provider) {
      ops.seedBootstrapNumber(requireState(), e164, tenantId, provider);
      return save();
    },

    bootstrapTenant(e164, tenantId, provider) {
      ops.bootstrapTenant(requireState(), e164, tenantId, provider);
      return save();
    },

    pruneOldData(
      days = config.privacy.retentionDays,
      diagnosticDays = config.privacy.diagnosticRetentionDays,
      evidenceDays = config.privacy.evidenceRetentionDays,
    ) {
      const removed = ops.pruneOldData(requireState(), {
        retentionDays: days,
        diagnosticRetentionDays: diagnosticDays,
        evidenceRetentionDays: evidenceDays,
      });
      if (ops.hasPrunedSomething(removed)) save();
      return removed;
    },

    eraseTenantData(tenantId) {
      const state = requireState();
      const eraseCallIds = ops.tenantCallScope(state, tenantId).calls.map((c) => c.id);
      const removed = ops.eraseTenantData(state, tenantId);
      if (removed.calls || removed.actionItems || removed.notifications || removed.privateNumber)
        save((client) => hardDeleteCalls(client, tenantId, eraseCallIds));
      return removed;
    },
    exportTenantData: (tenantId) => ops.exportTenantData(requireState(), tenantId),

    updateSettings(tenantId, patch) {
      const result = ops.updateSettings(requireState(), tenantId, patch);
      save();
      return result;
    },

    resolveProfile: (tenantId) => ops.resolveProfile(requireState(), tenantId),
    resolveTenant: (idpSubject) => ops.resolveTenant(requireState(), idpSubject),
    bindSubToTenant: (sub, tenantId) => ops.bindSubToTenant(requireState(), sub, tenantId),

    async ensureTenant(tenantId) {
      try {
        const state = requireState();
        return await runner.withClient(async (client) => {
          const statusRows = (
            await client.query(`SELECT status FROM tenant WHERE id = $1`, [tenantId])
          ).rows;
          if (statusRows.length === 0) return false;
          const present = ops.findTenant(state, tenantId);
          if (present) {
            present.status = statusRows[0].status;
            return true;
          }
          const full = (
            await client.query(`SELECT ${TENANT_COLUMNS} FROM tenant WHERE id = $1`, [tenantId])
          ).rows[0];
          const raced = ops.findTenant(state, tenantId);
          if (raced) {
            raced.status = full.status;
            return true;
          }
          state.tenants.push(rowToTenant(full));
          await hydrateTenant(client, state, tenantId);
          return true;
        });
      } catch (e) {
        console.error("[pg] ensureTenant fehlgeschlagen:", e.message);
        return false;
      }
    },
    listProfiles: () => ops.listProfiles(requireState()),
    setProfile(tenantId, patch) {
      const result = ops.setProfile(requireState(), tenantId, patch);
      save();
      return result;
    },
    deleteProfile(tenantId) {
      const ok = ops.deleteProfile(requireState(), tenantId);
      if (ok) save();
      return ok;
    },
  };
}

async function setTenant(client, tenantId) {
  await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
}

async function hydrateTenant(client, state, tenantId) {
  await setTenant(client, tenantId);
  await hydrateTenantInto(client, state, tenantId);
}

async function hydrate(client) {
  const state = ops.makeDefaultState();
  state.tenants = await hydrateTenants(client);
  for (const tenant of state.tenants) {
    await hydrateTenant(client, state, tenant.id);
  }
  state.profiles = await hydrateProfiles(client);
  state.platformTtsUsage = await hydratePlatformTtsUsage(client);
  state.costCrossCheck = await hydrateCostCrossCheck(client);
  state.anrufpause = await hydrateAnrufpause(client);
  state.platformNumberUse = await hydratePlatformNumberUse(client);
  state.outageAlerts = await hydrateOutageAlerts(client);
  await hydrateSubIndex(client, state);
  return state;
}

async function hydrateProfiles(client) {
  const rows = (await client.query(`SELECT tenant_id, data FROM profile`)).rows;
  return Object.fromEntries(rows.map((r) => [r.tenant_id, r.data]));
}

async function hydratePlatformTtsUsage(client) {
  const rows = (
    await client.query(`SELECT cycle_key, characters, warned_cycle FROM platform_tts_usage WHERE id = 1`)
  ).rows;
  if (rows.length === 0) return emptyPlatformTtsUsage();
  const r = rows[0];
  return { cycleKey: r.cycle_key, characters: Number(r.characters), warnedCycle: r.warned_cycle };
}

async function hydrateCostCrossCheck(client) {
  const rows = (
    await client.query(`SELECT last_checked_month_key FROM cost_cross_check WHERE id = 1`)
  ).rows;
  if (rows.length === 0) return emptyCostCrossCheck();
  return { lastCheckedMonthKey: rows[0].last_checked_month_key };
}

async function hydrateAnrufpause(client) {
  const { rows } = await client.query(`SELECT an FROM platform_anrufpause WHERE id = 1`);
  return rows[0]?.an === true;
}

async function hydratePlatformNumberUse(client) {
  const rows = (
    await client.query(
      `SELECT id, e164, purpose, provider, tenant_id, provider_number_id, bound_at, released_at, note
         FROM platform_number_use ORDER BY bound_at`,
    )
  ).rows;
  return rows.map((row) => ({
    id: row.id, e164: row.e164, purpose: row.purpose, provider: row.provider,
    tenantId: row.tenant_id, providerNumberId: row.provider_number_id,
    boundAt: row.bound_at instanceof Date ? row.bound_at.toISOString() : row.bound_at,
    releasedAt: row.released_at instanceof Date ? row.released_at.toISOString() : (row.released_at ?? null),
    note: row.note,
  }));
}

async function hydrateOutageAlerts(client) {
  const rows = (
    await client.query(
      `SELECT id, code, first_seen_at, last_seen_at, last_attempt_at, reported_at,
              delivered_channels, closed_at
         FROM outage_alert ORDER BY first_seen_at`,
    )
  ).rows;
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    firstSeenAt: row.first_seen_at instanceof Date ? row.first_seen_at.toISOString() : row.first_seen_at,
    lastSeenAt: row.last_seen_at instanceof Date ? row.last_seen_at.toISOString() : row.last_seen_at,
    lastAttemptAt: row.last_attempt_at instanceof Date ? row.last_attempt_at.toISOString() : (row.last_attempt_at ?? null),
    reportedAt: row.reported_at instanceof Date ? row.reported_at.toISOString() : (row.reported_at ?? null),
    deliveredChannels: row.delivered_channels,
    closedAt: row.closed_at instanceof Date ? row.closed_at.toISOString() : (row.closed_at ?? null),
  }));
}

async function hydrateSubIndex(client, state) {
  const rows = (await client.query(`SELECT sub, tenant_id FROM account`)).rows;
  for (const r of rows) ops.bindSubToTenant(state, r.sub, r.tenant_id);
}

const TENANT_COLUMNS =
  "id, status, owner_name, first_name, idp_subject, kyc_level, stripe_customer_id, " +
  "stripe_payment_method_id, stripe_payment_method_type, stripe_subscription_id, stripe_plan_slug, " +
  "stripe_current_period_end, stripe_current_period_start, stripe_number_setup_fee_exempt, " +
  "country, default_language, timezone, private_number, number_provision_skip_reason, number_provision_skip_at, " +
  "suspended_at, stripe_activation_pending, stripe_billing_hold, stripe_billing_hold_due_at, " +
  "stripe_period_credit_revoked, stripe_cancel_at_period_end, " +
  "number_release_pending, workos_delete_pending, " +
  "cancellation_mail_pending, cancellation_mail_received_at, " +
  "newsletter_consent, newsletter_consent_at, " +
  "newsletter_recipients, newsletter_confirm_mail_log";

function rowToTenant(r) {
  const tenant = { id: r.id, status: r.status };
  if (r.owner_name != null) tenant.ownerName = r.owner_name;
  if (r.first_name != null) tenant.firstName = r.first_name;
  if (r.idp_subject != null) tenant.idpSubject = r.idp_subject;
  if (r.kyc_level != null) tenant.kycLevel = r.kyc_level;
  if (r.stripe_customer_id != null) tenant.stripeCustomerId = r.stripe_customer_id;
  if (r.stripe_payment_method_id != null) tenant.stripePaymentMethodId = r.stripe_payment_method_id;
  if (r.stripe_payment_method_type != null)
    tenant.stripePaymentMethodType = r.stripe_payment_method_type;
  if (r.stripe_subscription_id != null) tenant.stripeSubscriptionId = r.stripe_subscription_id;
  if (r.stripe_plan_slug != null) tenant.stripePlanSlug = r.stripe_plan_slug;
  if (r.stripe_current_period_end != null)
    tenant.stripeCurrentPeriodEnd = Number(r.stripe_current_period_end);
  if (r.stripe_current_period_start != null)
    tenant.stripeCurrentPeriodStart = Number(r.stripe_current_period_start);
  if (r.stripe_number_setup_fee_exempt != null)
    tenant.stripeNumberSetupFeeExempt = r.stripe_number_setup_fee_exempt;
  if (r.country != null) tenant.country = r.country;
  if (r.default_language != null) tenant.defaultLanguage = r.default_language;
  if (r.timezone != null) tenant.timezone = r.timezone;
  if (r.private_number != null) tenant.privateNumber = r.private_number;
  if (r.number_provision_skip_reason != null)
    tenant.numberProvisionSkipReason = r.number_provision_skip_reason;
  if (r.number_provision_skip_at != null) tenant.numberProvisionSkipAt = r.number_provision_skip_at;
  if (r.suspended_at != null) tenant.suspendedAt = r.suspended_at;
  if (r.stripe_activation_pending != null) tenant.stripeActivationPending = r.stripe_activation_pending;
  if (r.stripe_billing_hold != null) tenant.billingHold = r.stripe_billing_hold;
  if (r.stripe_billing_hold_due_at != null) tenant.billingHoldDueAt = r.stripe_billing_hold_due_at;
  if (r.stripe_period_credit_revoked != null)
    tenant.stripePeriodCreditRevoked = r.stripe_period_credit_revoked;
  if (r.stripe_cancel_at_period_end != null)
    tenant.stripeCancelAtPeriodEnd = r.stripe_cancel_at_period_end;
  if (r.number_release_pending != null) tenant.numberReleasePending = r.number_release_pending;
  if (r.workos_delete_pending != null) tenant.workosDeletePending = r.workos_delete_pending;
  if (r.cancellation_mail_pending != null) tenant.cancellationMailPending = r.cancellation_mail_pending;
  if (r.cancellation_mail_received_at != null)
    tenant.cancellationMailReceivedAt = r.cancellation_mail_received_at;
  if (r.newsletter_consent != null) tenant.newsletterConsent = r.newsletter_consent;
  if (r.newsletter_consent_at != null) tenant.newsletterConsentAt = r.newsletter_consent_at;
  if (r.newsletter_recipients != null) tenant.newsletterRecipients = r.newsletter_recipients;
  if (r.newsletter_confirm_mail_log != null)
    tenant.newsletterConfirmMailLog = r.newsletter_confirm_mail_log;
  return tenant;
}

async function hydrateTenants(client) {
  const rows = (await client.query(`SELECT ${TENANT_COLUMNS} FROM tenant`)).rows;
  return rows.map(rowToTenant);
}

async function hydrateCallCostEvidence(client, tenantId) {
  const rows = (
    await client.query(
      `SELECT id, tenant_id, call_id, traeger, reife, betrag_mikro_cents, waehrung, quelle,
              beleg_ref, versuche, gemessen_at, abstand_zum_gespraechsende_s, detail,
              nachreifbar
         FROM call_cost_evidence WHERE tenant_id = $1 ORDER BY id ASC`,
      [tenantId],
    )
  ).rows;
  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    callId: row.call_id,
    traeger: row.traeger,
    reife: row.reife,
    betragMikroCents:
      row.betrag_mikro_cents === null || row.betrag_mikro_cents === undefined
        ? null
        : Number(row.betrag_mikro_cents),
    waehrung: row.waehrung ?? null,
    quelle: row.quelle ?? null,
    belegRef: row.beleg_ref ?? null,
    versuche: Number(row.versuche),
    gemessenAt: row.gemessen_at ?? null,
    abstandZumGespraechsendeS: row.abstand_zum_gespraechsende_s ?? null,
    detail: row.detail ?? null,
    nachreifbar: row.nachreifbar,
  }));
}

async function hydrateTenantInto(client, state, tenantId) {
  const settingsRows = (
    await client.query(`SELECT * FROM settings WHERE tenant_id = $1`, [tenantId])
  ).rows;
  const callRows = (
    await client.query(`SELECT * FROM call WHERE tenant_id = $1 ORDER BY seq DESC`, [tenantId])
  ).rows;
  const segRows = (
    await client.query(`SELECT * FROM transcript_segment WHERE tenant_id = $1 ORDER BY id ASC`, [
      tenantId,
    ])
  ).rows;
  const itemRows = (
    await client.query(`SELECT * FROM action_item WHERE tenant_id = $1 ORDER BY seq DESC`, [
      tenantId,
    ])
  ).rows;
  const calRows = (
    await client.query(`SELECT * FROM calendar_event WHERE tenant_id = $1 ORDER BY seq ASC`, [
      tenantId,
    ])
  ).rows;
  const usageRows = (await client.query(`SELECT * FROM usage WHERE tenant_id = $1`, [tenantId]))
    .rows;
  const notifRows = (
    await client.query(`SELECT * FROM notification WHERE tenant_id = $1 ORDER BY seq DESC`, [
      tenantId,
    ])
  ).rows;
  const numberRows = (
    await client.query(
      `SELECT id, e164, tenant_id, provider, status, provider_number_id, payment_intent_id, country, language, monthly_cost_cents, provider_agent_phone_number_id, el_inbound_trunk_belegt_at, el_inbound_trunk_zugang_fp FROM number WHERE tenant_id = $1`,
      [tenantId],
    )
  ).rows;
  const jobRows = (
    await client.query(
      `SELECT id, tenant_id, number_id, kind, status, idempotency_key, attempts, last_error, created_at
       FROM provisioning_job WHERE tenant_id = $1`,
      [tenantId],
    )
  ).rows;
  const budgetRows = (
    await client.query(
      `SELECT tenant_id, budget_cents, hard_cap_cents FROM tenant_budget WHERE tenant_id = $1`,
      [tenantId],
    )
  ).rows;
  const ueRows = (
    await client.query(
      `SELECT id, tenant_id, call_id, number_id, kind, quantity, cost_cents, cost_micro_cents, occurred_at, stripe_meter_sent
       FROM usage_event WHERE tenant_id = $1 ORDER BY id ASC`,
      [tenantId],
    )
  ).rows;

  const segmentsByCall = groupTranscripts(segRows);
  const itemIdsByCall = groupActionItemIds(itemRows);

  if (settingsRows.length) state.settings[tenantId] = rowToSettings(settingsRows[0]);
  if (usageRows.length) state.usage[tenantId] = rowToUsage(usageRows[0]);
  state.calendar[tenantId] = calRows.map(rowToCalendarEvent);
  state.calls.push(...callRows.map((r) => rowToCall(r, segmentsByCall, itemIdsByCall)));
  state.actionItems.push(...itemRows.map(rowToActionItem));
  state.notifications.push(...notifRows.map(rowToNotification));
  state.numbers.push(...numberRows.map(rowToNumber));
  state.provisioningJobs.push(
    ...jobRows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      numberId: r.number_id,
      kind: r.kind,
      status: r.status,
      idempotencyKey: r.idempotency_key,
      attempts: r.attempts,
      lastError: r.last_error ?? null,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    })),
  );
  state.tenantBudgets.push(
    ...budgetRows.map((r) => ({
      tenantId: r.tenant_id,
      budgetCents: Number(r.budget_cents),
      hardCapCents: Number(r.hard_cap_cents),
    })),
  );
  state.usageEvents.push(
    ...ueRows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      callId: r.call_id,
      numberId: r.number_id ?? null,
      kind: r.kind,
      quantity: Number(r.quantity),
      costCents: Number(r.cost_cents),
      costMicroCents:
        r.cost_micro_cents === null || r.cost_micro_cents === undefined
          ? null
          : Number(r.cost_micro_cents),
      occurredAt: r.occurred_at,
      stripeMeterSent: r.stripe_meter_sent,
    })),
  );
  state.callCostEvidence.push(...(await hydrateCallCostEvidence(client, tenantId)));
}

function groupTranscripts(segRows) {
  const byCall = new Map();
  for (const r of segRows) {
    if (!byCall.has(r.call_id)) byCall.set(r.call_id, []);
    byCall.get(r.call_id).push({ role: r.role, text: r.text, at: r.at });
  }
  return byCall;
}

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
    smsSummaryOptIn: r.sms_summary_opt_in ?? true,
    allowPersonalData: r.allow_personal_data,
    allowBankData: r.allow_bank_data,
    allowResearch: r.allow_research ?? false,
    allowCallMemory: r.allow_call_memory ?? false,
    language: r.language ?? null,
    agentStyle: r.agent_style ?? null,
  };
}

function hydratedMicroCents(raw) {
  return raw === null || raw === undefined ? null : Number(raw);
}

function absenderWahrheitFelder(r) {
  return {
    fromActualE164: r.from_actual_e164 ?? null,
    fromSource: r.from_source ?? null,
    fromRegistrationSource: r.from_registration_source ?? null,
  };
}
function absenderWahrheitWerte(call) {
  return [call.fromActualE164 ?? null, call.fromSource ?? null, call.fromRegistrationSource ?? null];
}

function elDetektorFelder(zeile) {
  return { elDetectorCounts: zeile.el_detector_counts ?? null };
}
function elDetektorWerte(call) {
  return [call.elDetectorCounts ? JSON.stringify(call.elDetectorCounts) : null];
}

function absenderWahrheitMutatoren({ requireState, save }) {
  return {
    recordFromRegistrationSource(callId, quelle) {
      const { call, changed } = ops.recordFromRegistrationSource(requireState(), callId, quelle);
      if (changed) save();
      return call;
    },
    recordActualSender(callId, herkunft) {
      const { call, changed } = ops.recordActualSender(requireState(), callId, herkunft);
      if (changed) save();
      return call;
    },
  };
}

function kostenAbschlussMutatoren({ requireState, save }) {
  return {
    schliesseKostenAbgleich(callId, eingabe) {
      const { call, changed } = ops.schliesseKostenAbgleich(requireState(), callId, eingabe);
      if (changed) save();
      return call;
    },
    oeffneKostenAbgleichErneut(callId) {
      const { call, changed } = ops.oeffneKostenAbgleichErneut(requireState(), callId);
      if (changed) save();
      return call;
    },
  };
}

function elDetektorMutatoren({ requireState, save }) {
  return {
    recordElDetectorCounts(callId, zaehlung) {
      const { call, changed } = ops.recordElDetectorCounts(requireState(), callId, zaehlung);
      if (changed) save();
      return call;
    },
  };
}

function isoZeitpunktOderNull(wert) {
  return wert instanceof Date ? wert.toISOString() : (wert ?? null);
}
function brueckenZustandFelder(zeile) {
  return {
    elBoundAt: isoZeitpunktOderNull(zeile.el_bound_at),
    elFallbackAt: isoZeitpunktOderNull(zeile.el_fallback_at),
    elNachlaufStartedAt: isoZeitpunktOderNull(zeile.el_nachlauf_started_at),
  };
}
function brueckenZustandWerte(call) {
  return [call.elBoundAt ?? null, call.elFallbackAt ?? null, call.elNachlaufStartedAt ?? null];
}
function inboundTrunkBelegFelder(zeile) {
  const belegtAt = isoZeitpunktOderNull(zeile.el_inbound_trunk_belegt_at);
  if (belegtAt === null) return {};
  return { elInboundTrunkBelegtAt: belegtAt, elInboundTrunkZugangFp: zeile.el_inbound_trunk_zugang_fp ?? null };
}
function inboundTrunkBelegWerte(nummer) {
  return [nummer.elInboundTrunkBelegtAt ?? null, nummer.elInboundTrunkZugangFp ?? null];
}
function mitSpeichernBeiAenderung(save) {
  return (ergebnis) => {
    if (ergebnis.changed) save();
    return ergebnis;
  };
}
function brueckenZustandMutatoren({ requireState, save }) {
  const speichereBeiAenderung = mitSpeichernBeiAenderung(save);
  return {
    bindInboundElConversation(callId, bindung) {
      return speichereBeiAenderung(ops.bindInboundElConversation(requireState(), callId, bindung));
    },
    markInboundElFallback(callId, nowIso) {
      return speichereBeiAenderung(ops.markInboundElFallback(requireState(), callId, nowIso));
    },
    markInboundElNachlaufStarted(callId, nowIso) {
      return speichereBeiAenderung(ops.markInboundElNachlaufStarted(requireState(), callId, nowIso));
    },
  };
}
function inboundTrunkBelegMutatoren({ requireState, save }) {
  const speichereBeiAenderung = mitSpeichernBeiAenderung(save);
  return {
    markNumberElInboundTrunkBelegt(numberId, beleg) {
      return speichereBeiAenderung(ops.markNumberElInboundTrunkBelegt(requireState(), numberId, beleg));
    },
    clearNumberElInboundTrunkBeleg(numberId) {
      return speichereBeiAenderung(ops.clearNumberElInboundTrunkBeleg(requireState(), numberId));
    },
  };
}

function rowToCall(r, segmentsByCall, itemIdsByCall) {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    streamToken: r.stream_token,
    twilioSid: r.twilio_sid,
    direction: r.direction,
    from: r.from_e164,
    to: r.to_e164,
    goal: r.goal,
    openingLine: r.opening_line ?? null,
    openingLineSha256: r.opening_line_sha256 ?? null,
    briefing: r.briefing,
    constraints: r.constraints,
    context: r.context ?? null,
    mandate: r.mandate ?? null,
    callerName: r.caller_name,
    language: r.language,
    maxDurationS: r.max_duration_s,
    requestedBy: r.requested_by,
    provider: r.provider,
    status: r.status,
    startedAt: r.started_at,
    answeredAt: r.answered_at,
    answeredUnclearReason: r.answered_unclear_reason ?? null,
    appointmentDate: r.appointment_date ?? null,
    appointmentTime: r.appointment_time ?? null,
    amount: r.amount ?? null,
    currency: r.currency ?? null,
    calleeConfirmedTimezone: r.callee_confirmed_timezone ?? null,
    calleeConfirmedTimezoneOrigin: r.callee_confirmed_timezone_origin ?? null,
    calleeConfirmedTimezoneAt: r.callee_confirmed_timezone_at ?? null,
    endedAt: r.ended_at,
    transcript: segmentsByCall.get(r.id) || [],
    summary: r.summary,
    objectiveAchieved: deserializeObjective(r.objective_achieved),
    summarySmsSentAt: r.summary_sms_sent_at ?? null,
    summaryMailSentAt: r.summary_mail_sent_at ?? null,
    failureReason: r.failure_reason ?? null,
    billedAt: r.billed_at ?? null,
    callControlId: r.call_control_id ?? null,
    assistantId: r.assistant_id ?? null,
    diagnostic: r.diagnostic === true,
    calleeIsOwner: r.callee_is_owner === true,
    callerIsOwner: r.caller_is_owner === true,
    inboxEntryAt: r.inbox_entry_at ?? null,
    inboxSeenAt: r.inbox_seen_at ?? null,
    estimatedCostCents: r.estimated_cost_cents ?? null,
    estimatedCostSpendMonthKey: r.estimated_cost_spend_month_key ?? null,
    estimatedCostPeriodKey: r.estimated_cost_period_key ?? null,
    actualCostMicroCents: hydratedMicroCents(r.actual_cost_micro_cents),
    costTruedAt: r.cost_trued_at ?? null,
    costTruedSource: r.cost_trued_source ?? null,
    costTruingAttempts: r.cost_truing_attempts ?? 0,
    telnyxConversationId: r.telnyx_conversation_id ?? null,
    elevenlabsConversationId: r.elevenlabs_conversation_id ?? null,
    sipCallId: r.sip_call_id ?? null,
    costProfile: r.cost_profile ?? null,
    callerTurns: r.caller_turns ?? 0,
    result: r.result ?? null,
    consults: r.consults ?? null,
    lookupLog: r.lookup_log ?? null,
    actionItemIds: itemIdsByCall.get(r.id) || [],
    webhookAnchors: r.webhook_anchors ?? [],
    ...absenderWahrheitFelder(r),
    ...elDetektorFelder(r),
    ...brueckenZustandFelder(r),
  };
}

function rowToActionItem(r) {
  return {
    id: r.id,
    callId: r.call_id,
    text: r.text,
    type: r.type,
    done: r.done,
    createdAt: r.created_at,
  };
}

function rowToCalendarEvent(r) {
  return { id: r.id, title: r.title, start: r.starts_at, end: r.ends_at };
}

function hydratedCostCents(costEur) {
  const cents = Math.round(Number(costEur) * CENTS_PER_EUR);
  if (isBookableCents(cents)) return cents;
  console.error(`[pg] grund=${USAGE_CORRUPT_REASON} cost_eur=${costEur} -> costCents=0`);
  return 0;
}

function rowToUsage(r) {
  return {
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    costCents: hydratedCostCents(r.cost_eur),
    costMicroCentsRem: 0,
    calls: Number(r.calls),
    spendMonthKey: r.spend_month_key ?? null,
    spendMonthCostCents: Number(r.spend_month_cost_cents ?? 0),
    costCorrectionMicroCentsRem: Number(r.cost_correction_micro_cents_rem ?? 0),
    ttsCharacters: Number(r.tts_characters ?? 0),
    budgetPeriodKey: r.budget_period_key ?? null,
    budgetPeriodBaselineCents: Number(r.budget_period_baseline_cents ?? 0),
  };
}

function rowToNotification(r) {
  return { id: r.id, title: r.title, body: r.body, callId: r.call_id, at: r.at };
}

async function flush(client, state, preFlush) {
  await client.query("BEGIN");
  try {
    if (preFlush) await preFlush(client);
    await flushTenants(client, state.tenants);
    await flushPlatformNumberUse(client, state.platformNumberUse);
    await flushOutageAlerts(client, state.outageAlerts);
    for (const tenant of state.tenants) {
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
      await flushTenantScope(client, tenant.id, state);
    }
    await flushProfiles(client, state.profiles);
    await flushPlatformTtsUsage(client, state.platformTtsUsage);
    await flushCostCrossCheck(client, state.costCrossCheck);
    await flushAnrufpause(client, state.anrufpause === true);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function flushTenantScope(client, tenantId, state) {
  const { calls, callIds } = ops.tenantCallScope(state, tenantId);
  await flushCalls(client, tenantId, calls);
  await flushActionItems(
    client,
    tenantId,
    state.actionItems.filter((a) => callIds.has(a.callId)),
  );
  await flushCalendar(client, tenantId, ops.calendarFor(state, tenantId));
  await flushNotifications(client, tenantId, notificationsForTenant(state, tenantId, callIds));
  await flushSettings(client, tenantId, ops.settingsFor(state, tenantId));
  await flushUsage(client, tenantId, ops.usageFor(state, tenantId));
  await flushNumbers(client, tenantId, state.numbers);
  await flushProvisioningJobs(client, tenantId, state.provisioningJobs);
  await flushTenantBudgets(client, tenantId, state.tenantBudgets);
  await flushUsageEvents(client, tenantId, state.usageEvents);
  await flushCallCostEvidence(client, tenantId, state.callCostEvidence);
}

async function flushTenants(client, tenants) {
  for (const t of tenants) {
    await client.query(
      `INSERT INTO tenant (id, status, owner_name, first_name, idp_subject, kyc_level, stripe_customer_id, stripe_payment_method_id, stripe_payment_method_type, stripe_subscription_id, stripe_plan_slug, stripe_current_period_end, stripe_current_period_start, stripe_number_setup_fee_exempt, country, default_language, timezone, private_number, number_provision_skip_reason, number_provision_skip_at, suspended_at, stripe_activation_pending, stripe_billing_hold, stripe_billing_hold_due_at, stripe_period_credit_revoked, stripe_cancel_at_period_end, number_release_pending, workos_delete_pending, cancellation_mail_pending, cancellation_mail_received_at, newsletter_consent, newsletter_consent_at, newsletter_recipients, newsletter_confirm_mail_log)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34)
       ON CONFLICT (id) DO UPDATE SET
         owner_name=EXCLUDED.owner_name,
         first_name=EXCLUDED.first_name,
         idp_subject=EXCLUDED.idp_subject, kyc_level=EXCLUDED.kyc_level,
         stripe_customer_id=EXCLUDED.stripe_customer_id,
         stripe_payment_method_id=EXCLUDED.stripe_payment_method_id,
         stripe_payment_method_type=EXCLUDED.stripe_payment_method_type,
         stripe_subscription_id=EXCLUDED.stripe_subscription_id,
         stripe_plan_slug=EXCLUDED.stripe_plan_slug,
         stripe_current_period_end=EXCLUDED.stripe_current_period_end,
         stripe_current_period_start=EXCLUDED.stripe_current_period_start,
         stripe_number_setup_fee_exempt=EXCLUDED.stripe_number_setup_fee_exempt,
         country=EXCLUDED.country, default_language=EXCLUDED.default_language,
         timezone=EXCLUDED.timezone,
         private_number=EXCLUDED.private_number,
         number_provision_skip_reason=EXCLUDED.number_provision_skip_reason,
         number_provision_skip_at=EXCLUDED.number_provision_skip_at,
         suspended_at=EXCLUDED.suspended_at,
         stripe_activation_pending=EXCLUDED.stripe_activation_pending,
         stripe_billing_hold=EXCLUDED.stripe_billing_hold,
         stripe_billing_hold_due_at=EXCLUDED.stripe_billing_hold_due_at,
         stripe_period_credit_revoked=EXCLUDED.stripe_period_credit_revoked,
         stripe_cancel_at_period_end=EXCLUDED.stripe_cancel_at_period_end,
         number_release_pending=EXCLUDED.number_release_pending,
         workos_delete_pending=EXCLUDED.workos_delete_pending,
         cancellation_mail_pending=EXCLUDED.cancellation_mail_pending,
         cancellation_mail_received_at=EXCLUDED.cancellation_mail_received_at,
         newsletter_consent=EXCLUDED.newsletter_consent,
         newsletter_consent_at=EXCLUDED.newsletter_consent_at,
         newsletter_recipients=EXCLUDED.newsletter_recipients,
         newsletter_confirm_mail_log=EXCLUDED.newsletter_confirm_mail_log`,
      [
        t.id,
        t.status,
        t.ownerName ?? null,
        t.firstName ?? null,
        t.idpSubject ?? null,
        t.kycLevel ?? null,
        t.stripeCustomerId ?? null,
        t.stripePaymentMethodId ?? null,
        t.stripePaymentMethodType ?? null,
        t.stripeSubscriptionId ?? null,
        t.stripePlanSlug ?? null,
        t.stripeCurrentPeriodEnd ?? null,
        t.stripeCurrentPeriodStart ?? null,
        t.stripeNumberSetupFeeExempt ?? null,
        t.country ?? null,
        t.defaultLanguage ?? null,
        t.timezone ?? null,
        t.privateNumber ?? null,
        t.numberProvisionSkipReason ?? null,
        t.numberProvisionSkipAt ?? null,
        t.suspendedAt ?? null,
        t.stripeActivationPending ?? null,
        t.billingHold ?? null,
        t.billingHoldDueAt ?? null,
        t.stripePeriodCreditRevoked ?? null,
        t.stripeCancelAtPeriodEnd ?? null,
        t.numberReleasePending ?? null,
        t.workosDeletePending ?? null,
        t.cancellationMailPending ?? null,
        t.cancellationMailReceivedAt ?? null,
        t.newsletterConsent ?? null,
        t.newsletterConsentAt ?? null,
        t.newsletterRecipients ? JSON.stringify(t.newsletterRecipients) : null,
        t.newsletterConfirmMailLog ? JSON.stringify(t.newsletterConfirmMailLog) : null,
      ],
    );
  }
}

function notificationsForTenant(state, tenantId, callIds) {
  return state.notifications.filter(
    (n) => callIds.has(n.callId) || (n.callId == null && tenantId === BOOTSTRAP_TENANT_ID),
  );
}

async function flushSettings(client, tenantId, settings) {
  await client.query(
    `INSERT INTO settings
       (tenant_id, agent_name, greeting, allow_calendar, allow_booking,
        allow_summaries, allow_personal_data, allow_bank_data, sms_summary_opt_in, language,
        agent_style, allow_research, allow_call_memory)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (tenant_id) DO UPDATE SET
       agent_name=EXCLUDED.agent_name, greeting=EXCLUDED.greeting,
       allow_calendar=EXCLUDED.allow_calendar, allow_booking=EXCLUDED.allow_booking,
       allow_summaries=EXCLUDED.allow_summaries, allow_personal_data=EXCLUDED.allow_personal_data,
       allow_bank_data=EXCLUDED.allow_bank_data, sms_summary_opt_in=EXCLUDED.sms_summary_opt_in,
       language=EXCLUDED.language, agent_style=EXCLUDED.agent_style,
       allow_research=EXCLUDED.allow_research, allow_call_memory=EXCLUDED.allow_call_memory`,
    [
      tenantId,
      settings.agentName,
      settings.greeting,
      settings.allowCalendar,
      settings.allowBooking,
      settings.allowSummaries,
      settings.allowPersonalData,
      settings.allowBankData,
      settings.smsSummaryOptIn,
      settings.language,
      settings.agentStyle ?? null,
      settings.allowResearch ?? false,
      settings.allowCallMemory ?? false,
    ],
  );
}

async function flushUsage(client, tenantId, usage) {
  await client.query(
    `INSERT INTO usage (tenant_id, input_tokens, output_tokens, cost_eur, calls,
                        spend_month_key, spend_month_cost_cents, cost_correction_micro_cents_rem,
                        tts_characters, budget_period_key, budget_period_baseline_cents)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (tenant_id) DO UPDATE SET
       input_tokens=EXCLUDED.input_tokens, output_tokens=EXCLUDED.output_tokens,
       cost_eur=EXCLUDED.cost_eur, calls=EXCLUDED.calls,
       spend_month_key=EXCLUDED.spend_month_key,
       spend_month_cost_cents=EXCLUDED.spend_month_cost_cents,
       cost_correction_micro_cents_rem=EXCLUDED.cost_correction_micro_cents_rem,
       tts_characters=EXCLUDED.tts_characters,
       budget_period_key=EXCLUDED.budget_period_key,
       budget_period_baseline_cents=EXCLUDED.budget_period_baseline_cents`,
    [
      tenantId,
      usage.inputTokens,
      usage.outputTokens,
      usage.costCents / CENTS_PER_EUR,
      usage.calls,
      usage.spendMonthKey ?? null,
      usage.spendMonthCostCents,
      usage.costCorrectionMicroCentsRem,
      usage.ttsCharacters,
      usage.budgetPeriodKey ?? null,
      usage.budgetPeriodBaselineCents,
    ],
  );
}

function callRowValues(call, tenantId) {
  return [
    call.id,
    tenantId,
    call.streamToken,
    call.twilioSid,
    call.direction,
    call.from,
    call.to,
    call.goal,
    call.briefing,
    call.constraints,
    call.callerName,
    call.language,
    call.maxDurationS,
    call.requestedBy,
    call.status,
    call.startedAt,
    call.answeredAt,
    call.endedAt,
    call.summary,
    serializeObjective(call.objectiveAchieved),
    call.provider || DEFAULT_PROVIDER,
    call.summarySmsSentAt ?? null,
    call.context ? JSON.stringify(call.context) : null,
    call.failureReason ?? null,
    call.billedAt ?? null,
    call.callControlId ?? null,
    call.assistantId ?? null,
    call.diagnostic === true,
    call.mandate ? JSON.stringify(call.mandate) : null,
    call.estimatedCostCents ?? null,
    call.actualCostMicroCents ?? null,
    call.costTruedAt ?? null,
    call.costTruedSource ?? null,
    call.costTruingAttempts ?? 0,
    call.telnyxConversationId ?? null,
    call.callerTurns ?? 0,
    call.result ? JSON.stringify(call.result) : null,
    call.consults ? JSON.stringify(call.consults) : null,
    call.estimatedCostSpendMonthKey ?? null,
    call.estimatedCostPeriodKey ?? null,
    call.elevenlabsConversationId ?? null,
    call.answeredUnclearReason ?? null,
    call.appointmentDate ?? null,
    call.appointmentTime ?? null,
    call.amount ?? null,
    call.currency ?? null,
    call.calleeConfirmedTimezone ?? null,
    call.calleeConfirmedTimezoneOrigin ?? null,
    call.calleeConfirmedTimezoneAt ?? null,
    call.sipCallId ?? null,
    call.openingLine ?? null,
    call.openingLineSha256 ?? null,
    call.lookupLog ? JSON.stringify(call.lookupLog) : null,
    call.summaryMailSentAt ?? null,
    call.calleeIsOwner === true,
    call.inboxEntryAt ?? null,
    call.inboxSeenAt ?? null,
    ...absenderWahrheitWerte(call),
    call.costProfile ?? null,
    ...elDetektorWerte(call),
    call.webhookAnchors?.length ? JSON.stringify(call.webhookAnchors) : null,
    ...brueckenZustandWerte(call),
    call.callerIsOwner === true,
  ];
}

async function flushCalls(client, tenantId, calls) {
  await deleteMissingCallsKeepActive(
    client,
    tenantId,
    calls.map((c) => c.id),
  );
  for (const c of calls) {
    await client.query(
      `INSERT INTO call
         (id, tenant_id, stream_token, twilio_sid, direction, from_e164, to_e164, goal,
          briefing, constraints, caller_name, language, max_duration_s, requested_by,
          status, started_at, answered_at, ended_at, summary, objective_achieved, provider,
          summary_sms_sent_at, context, failure_reason, billed_at,
          call_control_id, assistant_id, diagnostic, mandate,
          estimated_cost_cents, actual_cost_micro_cents, cost_trued_at,
          cost_trued_source, cost_truing_attempts, telnyx_conversation_id, caller_turns, result,
          consults, estimated_cost_spend_month_key, estimated_cost_period_key,
          elevenlabs_conversation_id, answered_unclear_reason,
          appointment_date, appointment_time, amount, currency,
          callee_confirmed_timezone, callee_confirmed_timezone_origin,
          callee_confirmed_timezone_at, sip_call_id, opening_line, opening_line_sha256,
          lookup_log, summary_mail_sent_at, callee_is_owner, inbox_entry_at, inbox_seen_at,
          from_actual_e164, from_source, from_registration_source, cost_profile,
          el_detector_counts, webhook_anchors, el_bound_at, el_fallback_at, el_nachlauf_started_at,
          caller_is_owner)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60,$61,$62,$63,$64,$65,$66,$67)
       ON CONFLICT (id) DO UPDATE SET
         twilio_sid=EXCLUDED.twilio_sid, status=EXCLUDED.status, answered_at=EXCLUDED.answered_at,
         ended_at=EXCLUDED.ended_at, summary=EXCLUDED.summary,
         objective_achieved=EXCLUDED.objective_achieved, provider=EXCLUDED.provider,
         summary_sms_sent_at=EXCLUDED.summary_sms_sent_at, failure_reason=EXCLUDED.failure_reason,
         billed_at=EXCLUDED.billed_at,
         call_control_id=EXCLUDED.call_control_id, assistant_id=EXCLUDED.assistant_id,
         estimated_cost_cents=EXCLUDED.estimated_cost_cents,
         actual_cost_micro_cents=EXCLUDED.actual_cost_micro_cents,
         cost_trued_at=EXCLUDED.cost_trued_at, cost_trued_source=EXCLUDED.cost_trued_source,
         cost_truing_attempts=EXCLUDED.cost_truing_attempts,
         telnyx_conversation_id=EXCLUDED.telnyx_conversation_id,
         caller_turns=EXCLUDED.caller_turns, result=EXCLUDED.result,
         consults=EXCLUDED.consults, context=EXCLUDED.context,
         estimated_cost_spend_month_key=EXCLUDED.estimated_cost_spend_month_key,
         estimated_cost_period_key=EXCLUDED.estimated_cost_period_key,
         elevenlabs_conversation_id=EXCLUDED.elevenlabs_conversation_id,
         answered_unclear_reason=EXCLUDED.answered_unclear_reason,
         appointment_date=EXCLUDED.appointment_date, appointment_time=EXCLUDED.appointment_time,
         amount=EXCLUDED.amount, currency=EXCLUDED.currency,
         callee_confirmed_timezone=EXCLUDED.callee_confirmed_timezone,
         callee_confirmed_timezone_origin=EXCLUDED.callee_confirmed_timezone_origin,
         callee_confirmed_timezone_at=EXCLUDED.callee_confirmed_timezone_at,
         sip_call_id=EXCLUDED.sip_call_id, lookup_log=EXCLUDED.lookup_log,
         summary_mail_sent_at=EXCLUDED.summary_mail_sent_at,
         inbox_entry_at=EXCLUDED.inbox_entry_at, inbox_seen_at=EXCLUDED.inbox_seen_at,
         from_actual_e164=EXCLUDED.from_actual_e164, from_source=EXCLUDED.from_source,
         from_registration_source=EXCLUDED.from_registration_source,
         cost_profile=EXCLUDED.cost_profile,
         el_detector_counts=EXCLUDED.el_detector_counts,
         webhook_anchors=EXCLUDED.webhook_anchors,
         el_bound_at=EXCLUDED.el_bound_at, el_fallback_at=EXCLUDED.el_fallback_at,
         el_nachlauf_started_at=EXCLUDED.el_nachlauf_started_at`,
      callRowValues(c, tenantId),
    );
    await flushTranscript(client, tenantId, c);
  }
}

async function flushTranscript(client, tenantId, call) {
  if (call.transcript.length === 0) {
    await client.query(`DELETE FROM transcript_segment WHERE tenant_id=$1 AND call_id=$2`, [
      tenantId,
      call.id,
    ]);
    return;
  }
  const persisted = (
    await client.query(
      `SELECT id, role, text FROM transcript_segment WHERE call_id=$1 ORDER BY id ASC`,
      [call.id],
    )
  ).rows;
  let gemeinsam = 0;
  while (
    gemeinsam < persisted.length &&
    gemeinsam < call.transcript.length &&
    persisted[gemeinsam].role === call.transcript[gemeinsam].role &&
    persisted[gemeinsam].text === call.transcript[gemeinsam].text
  )
    gemeinsam += 1;
  if (gemeinsam < persisted.length)
    await client.query(
      `DELETE FROM transcript_segment WHERE tenant_id=$1 AND call_id=$2 AND id = ANY($3)`,
      [tenantId, call.id, persisted.slice(gemeinsam).map((r) => r.id)],
    );
  for (let i = gemeinsam; i < call.transcript.length; i++) {
    const seg = call.transcript[i];
    await client.query(
      `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1,$2,$3,$4,$5)`,
      [call.id, tenantId, seg.role, seg.text, seg.at],
    );
  }
}

async function flushActionItems(client, tenantId, items) {
  await deleteMissing(
    client,
    "action_item",
    tenantId,
    items.map((i) => i.id),
  );
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    await client.query(
      `INSERT INTO action_item (id, tenant_id, call_id, text, type, done, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET done=EXCLUDED.done`,
      [it.id, tenantId, it.callId, it.text, it.type, it.done, it.createdAt],
    );
  }
}

async function flushCalendar(client, tenantId, events) {
  await deleteMissing(
    client,
    "calendar_event",
    tenantId,
    events.map((e) => e.id),
  );
  for (const ev of events) {
    await client.query(
      `INSERT INTO calendar_event (id, tenant_id, title, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at`,
      [ev.id, tenantId, ev.title, ev.start, ev.end],
    );
  }
}

async function flushNotifications(client, tenantId, notifications) {
  await deleteMissing(
    client,
    "notification",
    tenantId,
    notifications.map((n) => n.id),
  );
  for (let i = notifications.length - 1; i >= 0; i--) {
    const n = notifications[i];
    await client.query(
      `INSERT INTO notification (id, tenant_id, title, body, call_id, at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [n.id, tenantId, n.title, n.body, n.callId, n.at],
    );
  }
}

async function flushProfiles(client, profiles) {
  const tenantIds = Object.keys(profiles);
  await deleteMissingProfiles(client, tenantIds);
  for (const [tenantId, data] of Object.entries(profiles)) {
    await client.query(
      `INSERT INTO profile (tenant_id, data) VALUES ($1,$2)
       ON CONFLICT (tenant_id) DO UPDATE SET data=EXCLUDED.data`,
      [tenantId, JSON.stringify(data)],
    );
  }
}

async function flushPlatformTtsUsage(client, row) {
  await client.query(
    `INSERT INTO platform_tts_usage (id, cycle_key, characters, warned_cycle) VALUES (1,$1,$2,$3)
     ON CONFLICT (id) DO UPDATE SET cycle_key=EXCLUDED.cycle_key, characters=EXCLUDED.characters,
       warned_cycle=EXCLUDED.warned_cycle`,
    [row.cycleKey, row.characters, row.warnedCycle],
  );
}

async function flushCostCrossCheck(client, row) {
  await client.query(
    `INSERT INTO cost_cross_check (id, last_checked_month_key) VALUES (1,$1)
     ON CONFLICT (id) DO UPDATE SET last_checked_month_key=EXCLUDED.last_checked_month_key`,
    [row.lastCheckedMonthKey],
  );
}

async function flushAnrufpause(client, an) {
  await client.query(
    `INSERT INTO platform_anrufpause (id, an) VALUES (1,$1)
     ON CONFLICT (id) DO UPDATE SET an=EXCLUDED.an`,
    [an],
  );
}

async function flushPlatformNumberUse(client, bindings) {
  await deleteMissingPlatformNumberUse(client, bindings.map((binding) => binding.id));
  for (const binding of bindings) {
    await client.query(
      `INSERT INTO platform_number_use
         (id, e164, purpose, provider, tenant_id, provider_number_id, bound_at, released_at, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         e164=EXCLUDED.e164, purpose=EXCLUDED.purpose, provider=EXCLUDED.provider,
         tenant_id=EXCLUDED.tenant_id, provider_number_id=EXCLUDED.provider_number_id,
         released_at=EXCLUDED.released_at, note=EXCLUDED.note`,
      [binding.id, binding.e164, binding.purpose, binding.provider, binding.tenantId ?? null,
       binding.providerNumberId ?? null, binding.boundAt, binding.releasedAt ?? null, binding.note ?? null],
    );
  }
}

async function deleteMissingPlatformNumberUse(client, keepIds) {
  if (keepIds.length === 0) {
    await client.query(`DELETE FROM platform_number_use`);
    return;
  }
  await client.query(`DELETE FROM platform_number_use WHERE id <> ALL($1::text[])`, [keepIds]);
}

async function flushOutageAlerts(client, alerts) {
  await deleteMissingOutageAlerts(client, alerts.map((alert) => alert.id));
  for (const alert of alerts) {
    await client.query(
      `INSERT INTO outage_alert
         (id, code, first_seen_at, last_seen_at, last_attempt_at, reported_at,
          delivered_channels, closed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         last_seen_at=EXCLUDED.last_seen_at, last_attempt_at=EXCLUDED.last_attempt_at,
         reported_at=EXCLUDED.reported_at, delivered_channels=EXCLUDED.delivered_channels,
         closed_at=EXCLUDED.closed_at`,
      [alert.id, alert.code, alert.firstSeenAt, alert.lastSeenAt, alert.lastAttemptAt ?? null,
       alert.reportedAt ?? null, alert.deliveredChannels ?? null, alert.closedAt ?? null],
    );
  }
}

async function deleteMissingOutageAlerts(client, keepIds) {
  if (keepIds.length === 0) {
    await client.query(`DELETE FROM outage_alert`);
    return;
  }
  await client.query(`DELETE FROM outage_alert WHERE id <> ALL($1::text[])`, [keepIds]);
}

async function deleteMissingProfiles(client, keepTenantIds) {
  if (keepTenantIds.length === 0) {
    await client.query(`DELETE FROM profile`);
    return;
  }
  await client.query(`DELETE FROM profile WHERE tenant_id <> ALL($1::text[])`, [keepTenantIds]);
}

async function flushOwnScoped({ client, tenantId, table, rows, insertRow }) {
  const own = rows.filter((r) => r.tenantId === tenantId);
  await deleteMissing(
    client,
    table,
    tenantId,
    own.map((r) => r.id),
  );
  for (const row of own) {
    await insertRow(row);
  }
}

function rowToNumber(r) {
  return {
    id: r.id, e164: r.e164, tenantId: r.tenant_id, provider: r.provider, status: r.status,
    providerNumberId: r.provider_number_id,
    paymentIntentId: r.payment_intent_id ?? null,
    country: r.country ?? null,
    language: r.language ?? null,
    providerAgentPhoneNumberId: r.provider_agent_phone_number_id ?? null,
    ...inboundTrunkBelegFelder(r),
    ...(r.monthly_cost_cents === null || r.monthly_cost_cents === undefined
      ? {} : { monthlyCostCents: r.monthly_cost_cents }),
  };
}

async function flushNumbers(client, tenantId, numbers) {
  await flushOwnScoped({
    client,
    tenantId,
    table: "number",
    rows: numbers,
    insertRow: (n) =>
      client.query(
        `INSERT INTO number (id, tenant_id, e164, provider, status, provider_number_id, payment_intent_id, country, language, monthly_cost_cents, provider_agent_phone_number_id, el_inbound_trunk_belegt_at, el_inbound_trunk_zugang_fp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO UPDATE SET
           e164=EXCLUDED.e164, provider=EXCLUDED.provider,
           status=EXCLUDED.status, provider_number_id=EXCLUDED.provider_number_id,
           payment_intent_id=EXCLUDED.payment_intent_id,
           country=EXCLUDED.country, language=EXCLUDED.language,
           monthly_cost_cents=EXCLUDED.monthly_cost_cents,
           provider_agent_phone_number_id=EXCLUDED.provider_agent_phone_number_id,
           el_inbound_trunk_belegt_at=EXCLUDED.el_inbound_trunk_belegt_at,
           el_inbound_trunk_zugang_fp=EXCLUDED.el_inbound_trunk_zugang_fp`,
        [
          n.id,
          tenantId,
          n.e164 ?? null,
          n.provider || DEFAULT_PROVIDER,
          n.status,
          n.providerNumberId ?? null,
          n.paymentIntentId ?? null,
          n.country ?? null,
          n.language ?? null,
          n.monthlyCostCents ?? null,
          n.providerAgentPhoneNumberId ?? null,
          ...inboundTrunkBelegWerte(n),
        ],
      ),
  });
}

async function flushProvisioningJobs(client, tenantId, jobs) {
  await flushOwnScoped({
    client,
    tenantId,
    table: "provisioning_job",
    rows: jobs,
    insertRow: (j) =>
      client.query(
        `INSERT INTO provisioning_job (id, tenant_id, number_id, kind, status, idempotency_key, attempts, last_error, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           status=EXCLUDED.status, attempts=EXCLUDED.attempts, last_error=EXCLUDED.last_error`,
        [
          j.id,
          tenantId,
          j.numberId,
          j.kind,
          j.status,
          j.idempotencyKey,
          j.attempts,
          j.lastError ?? null,
          j.createdAt,
        ],
      ),
  });
}

async function flushTenantBudgets(client, tenantId, budgets) {
  const own = budgets.filter((b) => b.tenantId === tenantId);
  for (const b of own) {
    await client.query(
      `INSERT INTO tenant_budget (tenant_id, budget_cents, hard_cap_cents)
       VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id) DO UPDATE SET
         budget_cents=EXCLUDED.budget_cents, hard_cap_cents=EXCLUDED.hard_cap_cents`,
      [tenantId, b.budgetCents, b.hardCapCents],
    );
  }
}

async function flushUsageEvents(client, tenantId, events) {
  await flushOwnScoped({
    client,
    tenantId,
    table: "usage_event",
    rows: events,
    insertRow: (e) =>
      client.query(
        `INSERT INTO usage_event (id, tenant_id, call_id, number_id, kind, quantity, cost_cents, cost_micro_cents, occurred_at, stripe_meter_sent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET stripe_meter_sent=EXCLUDED.stripe_meter_sent`,
        [
          e.id,
          tenantId,
          e.callId,
          e.numberId ?? null,
          e.kind,
          e.quantity,
          e.costCents,
          e.costMicroCents ?? null,
          e.occurredAt,
          e.stripeMeterSent,
        ],
      ),
  });
}

async function flushCallCostEvidence(client, tenantId, zeilen) {
  await flushOwnScoped({
    client,
    tenantId,
    table: "call_cost_evidence",
    rows: zeilen,
    insertRow: (zeile) =>
      client.query(
        `INSERT INTO call_cost_evidence
           (id, tenant_id, call_id, traeger, reife, betrag_mikro_cents, waehrung, quelle,
            beleg_ref, versuche, gemessen_at, abstand_zum_gespraechsende_s, detail,
            nachreifbar)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO UPDATE SET
           reife=EXCLUDED.reife, betrag_mikro_cents=EXCLUDED.betrag_mikro_cents,
           waehrung=EXCLUDED.waehrung, quelle=EXCLUDED.quelle,
           beleg_ref=EXCLUDED.beleg_ref, versuche=EXCLUDED.versuche,
           gemessen_at=EXCLUDED.gemessen_at,
           abstand_zum_gespraechsende_s=EXCLUDED.abstand_zum_gespraechsende_s,
           detail=EXCLUDED.detail, nachreifbar=EXCLUDED.nachreifbar`,
        [
          zeile.id,
          tenantId,
          zeile.callId,
          zeile.traeger,
          zeile.reife,
          zeile.betragMikroCents ?? null,
          zeile.waehrung ?? null,
          zeile.quelle ?? null,
          zeile.belegRef ?? null,
          zeile.versuche,
          zeile.gemessenAt ?? null,
          zeile.abstandZumGespraechsendeS ?? null,
          zeile.detail ? JSON.stringify(zeile.detail) : null,
          zeile.nachreifbar,
        ],
      ),
  });
}

function serializeObjective(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : String(value);
}

function deserializeObjective(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

async function deleteMissing(client, table, tenantId, keepIds) {
  await deleteMissingByText({ client, table, column: "id", tenantId, keepValues: keepIds });
}

async function deleteMissingByText({ client, table, column, tenantId, keepValues }) {
  if (keepValues.length === 0) {
    await client.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenantId]);
    return;
  }
  await client.query(`DELETE FROM ${table} WHERE tenant_id=$1 AND ${column} <> ALL($2::text[])`, [
    tenantId,
    keepValues,
  ]);
}

const CALL_STATUS_ACTIVE = "active";
async function deleteMissingCallsKeepActive(client, tenantId, keepIds) {
  if (keepIds.length === 0) {
    await client.query(`DELETE FROM call WHERE tenant_id=$1 AND status <> $2`, [
      tenantId,
      CALL_STATUS_ACTIVE,
    ]);
    return;
  }
  await client.query(
    `DELETE FROM call WHERE tenant_id=$1 AND status <> $2 AND id <> ALL($3::text[])`,
    [tenantId, CALL_STATUS_ACTIVE, keepIds],
  );
}

async function hardDeleteCalls(client, tenantId, callIds) {
  if (callIds.length === 0) return;
  await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  await client.query(`DELETE FROM call WHERE tenant_id=$1 AND id = ANY($2::text[])`, [
    tenantId,
    callIds,
  ]);
}
