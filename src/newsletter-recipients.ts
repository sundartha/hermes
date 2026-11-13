import crypto from "crypto";
import { MS_PER_DAY, MS_PER_HOUR } from "./utils/timer.js";

export const MAX_NEWSLETTER_RECIPIENTS = 5;

export const NEWSLETTER_CONFIRM_MAIL_DAILY_CAP = 10;

export const NEWSLETTER_CONFIRM_TOKEN_TTL_MS = 48 * MS_PER_HOUR;

const EMAIL_FORMAT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string | number | null | undefined): string {
  return String(raw ?? "").trim().toLowerCase();
}

export function isValidEmailFormat(email: string): boolean {
  return EMAIL_FORMAT_PATTERN.test(email);
}

function randomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashNewsletterToken(token: unknown): string {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

interface NewsletterTokens {
  confirmToken: string;
  tokenHash: string;
  tokenExpiresAt: string;
  unsubToken: string;
}

export function newNewsletterTokens(nowMs: number = Date.now()): NewsletterTokens {
  const confirmToken = randomToken();
  return {
    confirmToken,
    tokenHash: hashNewsletterToken(confirmToken),
    tokenExpiresAt: new Date(nowMs + NEWSLETTER_CONFIRM_TOKEN_TTL_MS).toISOString(),
    unsubToken: randomToken(),
  };
}

export function newsletterConfirmUrl(publicUrl: string, confirmToken: string): string {
  return `${publicUrl}/newsletter/confirm?token=${confirmToken}`;
}

export function newsletterUnsubscribeUrl(publicUrl: string, unsubToken: string): string {
  return `${publicUrl}/newsletter/unsubscribe?token=${unsubToken}`;
}

interface RecipientStore {
  tenantNewsletterRecipients(tenantId: string): { email: string }[];
  dailyNewsletterConfirmMailCount(tenantId: string, sinceIso: string): number;
}

export function planAddNewsletterRecipient({
  store,
  tenantId,
  rawEmail,
  accountEmail,
  now = new Date(),
}: {
  store: RecipientStore;
  tenantId: string;
  rawEmail: string | number | null | undefined;
  accountEmail?: string | null | undefined;
  now?: Date;
}): { ok: false; reason: string } | { ok: true; email: string } {
  const email = normalizeEmail(rawEmail);
  if (!email || !isValidEmailFormat(email)) return { ok: false, reason: "invalid_format" };
  if (accountEmail && normalizeEmail(accountEmail) === email) return { ok: false, reason: "duplicate" };
  const existing = store.tenantNewsletterRecipients(tenantId);
  if (existing.some((r) => r.email === email)) return { ok: false, reason: "duplicate" };
  if (existing.length >= MAX_NEWSLETTER_RECIPIENTS) return { ok: false, reason: "cap_reached" };
  const sinceIso = new Date(now.getTime() - MS_PER_DAY).toISOString();
  if (store.dailyNewsletterConfirmMailCount(tenantId, sinceIso) >= NEWSLETTER_CONFIRM_MAIL_DAILY_CAP)
    return { ok: false, reason: "daily_limit" };
  return { ok: true, email };
}

interface Recipient {
  email: string;
  status: string;
  createdAt: string;
}

export function publicNewsletterRecipients(recipients: Recipient[]): Recipient[] {
  return recipients.map(({ email, status, createdAt }) => ({ email, status, createdAt }));
}

export function renderNewsletterPage({
  title,
  body,
  lang = "de",
}: {
  title: string;
  body: string;
  lang?: string;
}): string {
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
