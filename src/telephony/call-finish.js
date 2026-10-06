import { USAGE_EVENT_KIND } from "../store/defaults.js";
import { keepsTranscriptForDiagnosis } from "../diagnostic-retention.js";
import { localeFor } from "../i18n/locales.js";
import { planSummaryMail } from "../mail-summary.js";
import { planNotPlacedMail } from "../mail-not-placed.js";
import { reportSystematicOutage } from "./outage-report.js";
import { BRIDGE_STATE, bridgeStateOf, uebergabeGescheitert } from "../elevenlabs/inbound-bridge-state.js";
import { newsletterUnsubscribeUrl } from "../newsletter-recipients.js";

const SMS_BODY_MAX_CHARS = 1500;

const EL_UEBERGABE_LOG_PREFIX = "[el-uebergabe]";
const GRUND_KEINER = "keiner";
const GESCHEITERT_ZUSTAND_FUER_LOG = Object.freeze({
  [BRIDGE_STATE.WARTET]: "wartet",
  [BRIDGE_STATE.RUECKFALL]: "rueckfall",
  [BRIDGE_STATE.KEIN_EL_INBOUND]: "abgewiesen",
});
function logGescheiterteUebergabe(call) {
  const zustand = GESCHEITERT_ZUSTAND_FUER_LOG[bridgeStateOf(call)];
  console.log(`${EL_UEBERGABE_LOG_PREFIX} gescheitert call=${call.id} grund=${call.failureReason || GRUND_KEINER} zustand=${zustand}`);
}

function storedActionItemTexts(store, callId) {
  return store.callActionItems(callId).map((item) => item.text);
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

function formatCallDuration(call) {
  const startMs = Date.parse(call.answeredAt || "");
  const endMs = Date.parse(call.endedAt || "");
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return "";
  const totalSeconds = Math.max(0, Math.round((endMs - startMs) / MS_PER_SECOND));
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = String(totalSeconds % SECONDS_PER_MINUTE).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function mailTimestampLabel(call) {
  const anchorMs = Date.parse(call.answeredAt || call.startedAt);
  if (Number.isNaN(anchorMs)) return "";
  return new Intl.DateTimeFormat(localeFor(call.language).dateLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(anchorMs));
}

function buildMailBody({ call, t, who, result, aiCount }) {
  const when = mailTimestampLabel(call);
  const durationLabel = formatCallDuration(call);
  return (
    `${who}\n\n` +
    (when ? `${t.mailTimeLabel} ${when}\n` : "") +
    (durationLabel ? `${t.mailDurationLabel} ${durationLabel}\n` : "") +
    `\n${result.summary}` +
    (aiCount
      ? `\n\n${t.actionItemsHeading}\n` + result.actionItems.map((a, i) => `${i + 1}. ${a}`).join("\n")
      : "")
  );
}

async function sendMailToTargets({ config, mailer, targets, mailBody, subject, texts }) {
  let sentCount = 0;
  for (const target of targets) {
    const mailText = target.unsubToken
      ? `${mailBody}\n\n${texts.unsubscribeLinkLabel} ` +
        newsletterUnsubscribeUrl(config.server.publicUrl, target.unsubToken)
      : mailBody;
    try {
      await mailer.sendMail({ to: target.email, subject, text: mailText });
      sentCount += 1;
    } catch (e) {
      console.error("[mail]", e.message);
    }
  }
  return sentCount;
}

async function sendSummaryMails({ store, config, call, mailer, accounts, audit, t, who, result, aiCount }) {
  const mailPlan = await planSummaryMail({ store, call, mailer, accounts });
  if (!mailPlan.send) {
    if (mailPlan.reason) {
      audit("mail_summary_skipped", null, `call=${call.id} reason=${mailPlan.reason}`);
    }
    return;
  }
  const mailBody = buildMailBody({ call, t, who, result, aiCount });
  const sentCount = await sendMailToTargets({
    config,
    mailer,
    targets: mailPlan.targets,
    mailBody,
    subject: t.summaryTitle,
    texts: t,
  });
  if (sentCount > 0) store.markSummaryMailSent(call.id);
}

async function sendNotPlacedMail({ store, config, call, mailer, accountsRef, audit, texts }) {
  const plan = await planNotPlacedMail({ store, call, mailer, accounts: accountsRef.current });
  if (!plan.send) {
    if (plan.reason) audit("not_placed_mail_skipped", null, `call=${call.id} reason=${plan.reason}`);
    return;
  }
  const mailBody =
    `${texts.statusBody(call.to, call.status, call.failureReason)}\n\n${texts.notPlacedMailHint}`;
  await sendMailToTargets({
    config,
    mailer,
    targets: plan.targets,
    mailBody,
    subject: texts.failedTitle,
    texts,
  });
}

async function reportFailedCall({ store, config, call, mailer, accountsRef, audit, messaging, texts }) {
  try {
    await sendNotPlacedMail({ store, config, call, mailer, accountsRef, audit, texts });
  } catch (err) {
    console.error("[mail] not-placed:", err.message);
  }
  await reportSystematicOutage({ store, config, call, audit, messaging, mailer });
}

export function makeCallFinish({
  store,
  config,
  metering,
  messaging,
  summarizeCall,
  planSummarySms,
  audit,
  mailer = null,
  accountsRef = { current: null },
  qualifiesAsInboxEntry = () => false,
}) {
  function releaseReserve(call) {
    return store
      .withStoreLock(() => store.releaseOutboundReserve(call))
      .catch((e) => console.error("[reserve] release:", e.message));
  }

  async function finishCall(call) {
    if (!call || call._finished) return;
    call._finished = true;
    const t = localeFor(call.language).postCall;
    if (!call.billedAt) {
      if (config.billing.paymentEnabled) metering.recordVoiceMinuteMeter(call);
      metering.reconcileVoiceBudget(call);
      store.markBilled(call.id);
    }
    await releaseReserve(call);
    store.save();

    if (uebergabeGescheitert(call)) {
      logGescheiterteUebergabe(call);
      await reportSystematicOutage({ store, config, call, audit, messaging, mailer });
      return;
    }

    if (call.status !== "completed" || !call.transcript.length) {
      const target = call.direction === "outbound" ? call.to : call.from;
      store.addNotification(
        call.status === "cancelled" ? t.cancelledTitle : t.failedTitle,
        t.statusBody(target, call.status, call.failureReason),
        call.id,
      );
      await reportFailedCall({ store, config, call, mailer, accountsRef, audit, messaging, texts: t });
      return;
    }

    const inboxWorthy = qualifiesAsInboxEntry(call, store.tenantContext(call.tenantId).settings);
    try {
      const result = call.summary
        ? { summary: call.summary, actionItems: storedActionItemTexts(store, call.id) }
        : await summarizeCall(call);
      if (!keepsTranscriptForDiagnosis(call, config.privacy)) store.purgeTranscript(call.id);
      if (!result) return;
      const aiCount = (result.actionItems || []).length;
      const who = call.direction === "outbound" ? t.subjectOutbound(call.to) : t.subjectInbound(call.from);
      store.addNotification(t.summaryTitle, `${who}: ${result.summary}`, call.id);

      const plan = planSummarySms(store, config, call);
      if (plan.send) {
        const resultLine = call.result?.outcome || result.summary;
        const sms =
          `[${store.tenantContext(call.tenantId).settings.agentName}] ${who}\n\n${resultLine}` +
          (aiCount
            ? `\n\n${t.actionItemsHeading}\n` + result.actionItems.map((a, i) => `${i + 1}. ${a}`).join("\n")
            : "");
        try {
          await messaging(call.provider).sendSms({
            from: plan.smsFrom.e164,
            to: plan.to,
            body: sms.slice(0, SMS_BODY_MAX_CHARS),
          });
          store.recordUsageEvent({
            tenantId: call.tenantId,
            callId: call.id,
            kind: USAGE_EVENT_KIND.SMS,
            quantity: 1,
            costCents: config.billing.smsCostCents,
          });
          store.markSummarySmsSent(call.id);
        } catch (e) {
          console.error(
            "[sms]",
            e.message,
            "(Trial: Zielnummer verifiziert? SMS-faehige Twilio-Nummer?)",
          );
        }
      } else if (plan.reason) {
        audit("sms_summary_skipped", null, `call=${call.id} reason=${plan.reason}`);
      }

      await sendSummaryMails({
        store, config, call, mailer, accounts: accountsRef.current, audit, t, who, result, aiCount,
      });
    } catch (err) {
      console.error("[summary]", err.message);
    } finally {
      store.markInboxEntry(call.id, inboxWorthy);
    }
  }

  return { finishCall, releaseReserve };
}
