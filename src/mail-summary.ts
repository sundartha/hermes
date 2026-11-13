export interface MailTarget {
  email: string;
  unsubToken: string | null;
}

export interface MailPlan {
  send: boolean;
  targets: MailTarget[];
  reason: string | null;
}

export interface Accounts {
  accountByTenant(tenantId: string): Promise<{ email?: string } | null | undefined>;
}

interface SummaryStore {
  tenantNewsletterConsent(tenantId: string): { consent?: unknown } | null | undefined;
  confirmedNewsletterRecipients(tenantId: string): MailTarget[];
}

interface SummaryCall {
  tenantId: string;
  summaryMailSentAt?: unknown;
  summary?: unknown;
}

export async function planSummaryMail({
  store,
  call,
  mailer,
  accounts,
}: {
  store: SummaryStore;
  call: SummaryCall;
  mailer: unknown;
  accounts?: Accounts | null | undefined;
}): Promise<MailPlan> {
  if (call.summaryMailSentAt) return { send: false, targets: [], reason: null };
  if (!mailer) return { send: false, targets: [], reason: "no_mailer" };
  if (!call.summary) return { send: false, targets: [], reason: null };

  const targets: MailTarget[] = [];
  let reason: string | null = null;

  const consent = store.tenantNewsletterConsent(call.tenantId);
  if (consent?.consent === true) {
    const account = accounts ? await accounts.accountByTenant(call.tenantId) : null;
    if (account?.email) targets.push({ email: account.email, unsubToken: null });
    else reason = "no_account_email";
  }

  for (const recipient of store.confirmedNewsletterRecipients(call.tenantId)) {
    targets.push({ email: recipient.email, unsubToken: recipient.unsubToken });
  }

  if (!targets.length) return { send: false, targets: [], reason };
  return { send: true, targets, reason: null };
}
