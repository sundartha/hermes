import crypto from "crypto";

export const MAX_NEWSLETTER_RECIPIENTS = 5;

export const NEWSLETTER_CONFIRM_MAIL_DAILY_CAP = 10;

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

export const NEWSLETTER_CONFIRM_TOKEN_TTL_MS = 48 * ONE_HOUR_MS;

const EMAIL_FORMAT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

export function isValidEmailFormat(email) {
  return EMAIL_FORMAT_PATTERN.test(email);
}

function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function hashNewsletterToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function newNewsletterTokens(nowMs = Date.now()) {
  const confirmToken = randomToken();
  return {
    confirmToken,
    tokenHash: hashNewsletterToken(confirmToken),
    tokenExpiresAt: new Date(nowMs + NEWSLETTER_CONFIRM_TOKEN_TTL_MS).toISOString(),
    unsubToken: randomToken(),
  };
}

export function newsletterConfirmUrl(publicUrl, confirmToken) {
  return `${publicUrl}/newsletter/confirm?token=${confirmToken}`;
}

export function newsletterUnsubscribeUrl(publicUrl, unsubToken) {
  return `${publicUrl}/newsletter/unsubscribe?token=${unsubToken}`;
}

export function planAddNewsletterRecipient({ store, tenantId, rawEmail, accountEmail, now = new Date() }) {
  const email = normalizeEmail(rawEmail);
  if (!email || !isValidEmailFormat(email)) return { ok: false, reason: "invalid_format" };
  if (accountEmail && normalizeEmail(accountEmail) === email) return { ok: false, reason: "duplicate" };
  const existing = store.tenantNewsletterRecipients(tenantId);
  if (existing.some((r) => r.email === email)) return { ok: false, reason: "duplicate" };
  if (existing.length >= MAX_NEWSLETTER_RECIPIENTS) return { ok: false, reason: "cap_reached" };
  const sinceIso = new Date(now.getTime() - ONE_DAY_MS).toISOString();
  if (store.dailyNewsletterConfirmMailCount(tenantId, sinceIso) >= NEWSLETTER_CONFIRM_MAIL_DAILY_CAP)
    return { ok: false, reason: "daily_limit" };
  return { ok: true, email };
}

export function publicNewsletterRecipients(recipients) {
  return recipients.map(({ email, status, createdAt }) => ({ email, status, createdAt }));
}

export function renderNewsletterPage({ title, body, lang = "de" }) {
  return (
    `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex">` +
    `<title>${title}</title>` +
    `<style>body{font-family:sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;` +
    `color:#222;line-height:1.5}</style></head>` +
    `<body><h1>${title}</h1><p>${body}</p></body></html>`
  );
}
