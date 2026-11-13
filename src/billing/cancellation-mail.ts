import { findPlan } from "../plans.ts";
import { MS_PER_SECOND } from "../utils/timer.js";

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

interface Logger {
  warn: (message: string) => void;
}

interface AuditStore {
  record: (entry: { tenantId: string; action: string; detail: string | null }) => Promise<unknown>;
}

interface Mailer {
  sendMail: (message: { to: string; subject: string; text: string }) => Promise<unknown>;
}

interface Accounts {
  accountByTenant: (tenantId: string) => Promise<{ email?: string | null } | null | undefined>;
}

interface Store {
  cancellationMailPending: (tenantId: string) => { pending: boolean; receivedAt: string | number };
  tenantSubscription: (tenantId: string) => {
    planSlug?: string | null;
    currentPeriodEnd?: number | null;
    cancelAtPeriodEnd?: boolean | null;
  };
  setCancellationMailPending: (tenantId: string, patch: { pending: boolean }) => unknown;
  tenantsPendingCancellationMail: () => { id: string }[];
}

interface Config {
  server: { publicUrl: string };
}

interface SendDeps {
  store: Store;
  mailer: Mailer | null | undefined;
  accounts: Accounts;
  config: Config;
  auditStore: AuditStore;
  logger: Logger;
}

function fehlerText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function kennungText(wert: unknown): string {
  return typeof wert === "string" || typeof wert === "number" ? String(wert) : "";
}

function fehlerKennung(err: unknown): string {
  const felder = typeof err === "object" && err !== null ? err : {};
  const code = "code" in felder ? felder.code : undefined;
  const name = "name" in felder ? felder.name : undefined;
  return kennungText(code) || kennungText(name) || "error";
}

function formatReceivedAt(receivedAt: string | number) {
  return `${RECEIVED_FORMAT.format(new Date(receivedAt))} Uhr`;
}

export function buildCancellationMailText({
  planSlug,
  currentPeriodEnd,
  receivedAt,
  publicUrl,
}: {
  planSlug?: string | null | undefined;
  currentPeriodEnd?: number | null | undefined;
  receivedAt: string | number;
  publicUrl: string;
}): { subject: string; text: string } {
  const planName = (planSlug == null ? null : findPlan(planSlug))?.name ?? planSlug ?? "Ihr Tarif";
  const receivedText = formatReceivedAt(receivedAt);
  const effectiveText =
    currentPeriodEnd != null
      ? EFFECTIVE_DATE_FORMAT.format(new Date(currentPeriodEnd * MS_PER_SECOND))
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

async function attemptSend({
  store,
  mailer,
  accounts,
  auditStore,
  logger,
  config,
  tenantId,
}: SendDeps & { tenantId: string }): Promise<boolean> {
  const { pending, receivedAt } = store.cancellationMailPending(tenantId);
  if (!pending) return false;

  const { planSlug, currentPeriodEnd, cancelAtPeriodEnd } = store.tenantSubscription(tenantId);
  if (cancelAtPeriodEnd === false) return true;

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
      `[cancellation-mail] Versand fehlgeschlagen tenant=${tenantId}: ${fehlerKennung(err)}`,
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
  auditStore = { record: () => Promise.resolve() },
  logger = console,
  tenantId,
}: Omit<SendDeps, "auditStore" | "logger"> & {
  auditStore?: AuditStore;
  logger?: Logger;
  tenantId: string;
}): Promise<boolean> {
  try {
    return await attemptSend({ store, mailer, accounts, auditStore, logger, config, tenantId });
  } catch (err) {
    logger.warn(`[cancellation-mail] Aufraeumen fehlgeschlagen tenant=${tenantId}: ${fehlerText(err)}`);
    return true;
  }
}

export async function runCancellationMailSweep({
  store,
  mailer,
  accounts,
  config,
  auditStore,
  logger = console,
}: Omit<SendDeps, "logger"> & { logger?: Logger }): Promise<{ attempted: number }> {
  const pending = store.tenantsPendingCancellationMail();
  for (const tenant of pending) {
    await attemptCancellationMailConfirm({ store, mailer, accounts, config, auditStore, logger, tenantId: tenant.id });
  }
  return { attempted: pending.length };
}
