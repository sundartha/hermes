export async function planSummaryMail({ store, call, mailer, accounts }) {
  if (call.summaryMailSentAt) return { send: false, targets: [], reason: null };
  if (!mailer) return { send: false, targets: [], reason: "no_mailer" };
  if (!call.summary) return { send: false, targets: [], reason: null };

  const targets = [];
  let reason = null;

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
