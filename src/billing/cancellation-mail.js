import { findPlan } from "../plans.js";

const AUDIT_ACTION = Object.freeze({
  MAIL_SENT: "cancellation_mail_sent",
  MAIL_SEND_FAILED: "cancellation_mail_send_failed",
  MAIL_SEND_SKIPPED: "cancellation_mail_send_skipped",
});

const RECEIVED_FORMAT = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  dateStyle: "medium",
  timeStyle: "short",
});
const EFFECTIVE_DATE_FORMAT = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  dateStyle: "medium",
});

function formatReceivedAt(receivedAt) {
  return `${RECEIVED_FORMAT.format(new Date(receivedAt))} Uhr`;
}

export function buildCancellationMailText({ planSlug, currentPeriodEnd, receivedAt, publicUrl }) {
  const planName = findPlan(planSlug)?.name ?? planSlug ?? "Ihr Tarif";
  const receivedText = formatReceivedAt(receivedAt);
  const effectiveText =
    currentPeriodEnd != null
      ? EFFECTIVE_DATE_FORMAT.format(new Date(currentPeriodEnd * 1000))
      : "dem Ende des laufenden Abrechnungszeitraums";
  const impressumUrl = `${publicUrl}/impressum`;

  const subject = "Bestätigung Ihrer Kündigung";
  const text = [
    "Hallo,",
    "",
    `hiermit bestätigen wir den Eingang Ihrer Kündigung vom ${receivedText}.`,
    "",
    `Gekündigter Vertrag: ${planName}`,
    "",
    "Es handelt sich um eine ordentliche Kündigung zum Ende des laufenden " +
      `Abrechnungszeitraums. Sie wird wirksam zum ${effectiveText}.`,
    "",
    "Bis zu diesem Zeitpunkt können Sie den Dienst unverändert weiter nutzen.",
    "",
    "Mit freundlichen Grüßen",
    "Sundartha — Anbieter des Telefon-Assistenten Hermes",
    `Anbieterangaben: ${impressumUrl}`,
  ].join("\n");

  return { subject, text };
}

async function attemptSend({ store, mailer, accounts, auditStore, logger, config, tenantId }) {
  const { pending, receivedAt } = store.cancellationMailPending(tenantId);
  if (!pending) return false;

  if (!mailer) {
    logger.warn(`[cancellation-mail] SMTP nicht konfiguriert - Bestaetigung offen tenant=${tenantId}`);
    await auditStore.record({
      tenantId,
      action: AUDIT_ACTION.MAIL_SEND_SKIPPED,
      detail: "reason=smtp_not_configured",
    });
    return true;
  }

  const account = await accounts.accountByTenant(tenantId);
  if (!account?.email) {
    logger.warn(`[cancellation-mail] keine Empfaengeradresse hinterlegt - Bestaetigung offen tenant=${tenantId}`);
    await auditStore.record({
      tenantId,
      action: AUDIT_ACTION.MAIL_SEND_SKIPPED,
      detail: "reason=no_address",
    });
    return true;
  }

  const { planSlug, currentPeriodEnd } = store.tenantSubscription(tenantId);
  const { subject, text } = buildCancellationMailText({
    planSlug,
    currentPeriodEnd,
    receivedAt,
    publicUrl: config.server.publicUrl,
  });

  try {
    await mailer.sendMail({ to: account.email, subject, text });
  } catch (err) {
    logger.warn(
      `[cancellation-mail] Versand fehlgeschlagen tenant=${tenantId}: ${err.code || err.name || "error"}`,
    );
    await auditStore.record({
      tenantId,
      action: AUDIT_ACTION.MAIL_SEND_FAILED,
      detail: "reason=provider_error",
    });
    return true;
  }

  store.setCancellationMailPending(tenantId, { pending: false });
  await auditStore.record({ tenantId, action: AUDIT_ACTION.MAIL_SENT, detail: null });
  return false;
}

export async function attemptCancellationMailConfirm({
  store,
  mailer,
  accounts,
  config,
  auditStore = { record: async () => {} },
  logger = console,
  tenantId,
}) {
  try {
    return await attemptSend({ store, mailer, accounts, auditStore, logger, config, tenantId });
  } catch (err) {
    logger.warn(`[cancellation-mail] Aufraeumen fehlgeschlagen tenant=${tenantId}: ${err.message}`);
    return true;
  }
}

export async function runCancellationMailSweep({ store, mailer, accounts, config, auditStore, logger = console }) {
  const pending = store.tenantsPendingCancellationMail();
  for (const tenant of pending) {
    await attemptCancellationMailConfirm({ store, mailer, accounts, config, auditStore, logger, tenantId: tenant.id });
  }
  return { attempted: pending.length };
}
