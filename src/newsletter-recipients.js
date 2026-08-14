// Newsletter-Zusatzempfaenger (Double-Opt-in): Domaenenlogik NEBEN dem Boolean-Consent-Pfad
// (state-ops.js setNewsletterConsent/tenantNewsletterConsent, unangetastet). Spiegel von
// mail-summary.js/billing/cancellation-mail.js: reine Entscheidungen + Text-/Token-Bausteine
// hier, state-ops.js haelt nur die Rohdaten-Mutation, HTTP/Mail-Verdrahtung bleibt beim
// Aufrufer (self-service-routes.js).
import crypto from "crypto";

// Owner-Auftrag (rechtliche Leitplanke, nicht verhandelbar): hoechstens 5 Zusatzadressen je
// Tenant. Bewusst KEINE Env-Var (Muster config.js researchMaxUses) - ein Wert, den niemand im
// Betrieb je anders braucht, verdient keinen Konfigurationshebel.
export const MAX_NEWSLETTER_RECIPIENTS = 5;

// Tageslimit der Bestaetigungs-Mails je Tenant (Owner-Auftrag: Schutz gegen Missbrauch des
// Formulars als Spam-Schleuder gegen fremde Postfaecher). Zaehlt JEDEN Eintragungsversuch, der
// bis zur Mutation kommt (nicht nur erfolgreiche Sends) - der Angriffsvektor ist das
// Wiederholen von Eintragen/Entfernen, nicht ein Mailer-Fehler.
export const NEWSLETTER_CONFIRM_MAIL_DAILY_CAP = 10;

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

// Gueltigkeit des Bestaetigungs-Tokens (Owner-Auftrag: 48h), danach neutrale Fehlseite.
export const NEWSLETTER_CONFIRM_TOKEN_TTL_MS = 48 * ONE_HOUR_MS;

// Einfache, aber wirksame Formatpruefung (Owner-Auftrag: "simple Formatpruefung") - kein
// RFC-5322-Vollparser, der ist fuer eine Eingabe mit anschliessendem Double-Opt-in-Versand
// unnoetig streng (der eigentliche Beleg ist das Anklicken des Bestaetigungslinks).
const EMAIL_FORMAT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// trim+lowercase (Owner-Auftrag) - EINE Normalisierung fuer Eingabe UND Duplikat-Pruefung
// (auch gegen die Konto-Adresse), sonst wuerden "A@B.de" und "a@b.de" als zwei Adressen
// durchgehen.
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

// Erzeugt BEIDE Tokens eines neuen Recipient-Eintrags in einem Zug (G5: EINE Erzeugungsstelle).
//
// confirmToken: 32-Byte-Zufallswert, NUR sein SHA256-Hash wird gespeichert (tokenHash) +
// Ablaufzeit (48h) - Einmalverwendung, danach nie wieder gebraucht (Muster PKCE-Verifier/
// Passwort-Reset-Token).
//
// unsubToken: bewusste Abweichung vom im Auftrag genannten Feldnamen `unsubTokenHash` - der
// Abmelde-Link muss in JEDER kuenftigen Summary-Mail identisch reproduzierbar sein (Owner-
// Auftrag: "Abmelde-Link in jeder Mail"), ein Hash ist irreversibel und wuerde das nach dem
// ersten Versand strukturell verhindern. Gespeichert wird deshalb der Klartext, verglichen
// ueber safeEqual (util.js) - EXAKT das Muster von call.streamToken (state-ops.js, Zeile ~185):
// ein wiederverwendbares Bearer-Capability-Token, kein Passwort-Aequivalent. Blast-Radius bei
// einem DB-Leak: einzige Wirkung ist ein Opt-out fuer genau diese Adresse, keine PII-
// Preisgabe ueber das hinaus, was DB-Zugriff ohnehin zeigt.
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

// Gate-Entscheidung VOR jeder Mutation (Muster planSummaryMail/planSummarySms): reine Lese-
// Entscheidung, reason ist ein stabiler, sprachneutraler Code (Vokabelform wie
// invalid_private_number). store wird injiziert (DIP) - store.tenantNewsletterRecipients/
// store.dailyNewsletterConfirmMailCount sind die Store-FASSADE (json.js/pg.js exportieren
// beide), kein direkter state-ops-Import (haelt dieses Modul backend-agnostisch).
//
// Reihenfolge: Format -> Duplikat (Konto-Adresse UND bestehende Liste) -> Cap (5) ->
// Tageslimit (10/Tag) - guenstige, reine String-Checks zuerst, Store-Lesungen zuletzt.
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

// Additive Lese-View fuer /api/self-service/state (Owner-Auftrag: "KEINE Tokens/Hashes in der
// Antwort"). Reine Projektion, keine Store-Lesung hier (der Aufrufer reicht die Rohliste).
export function publicNewsletterRecipients(recipients) {
  return recipients.map(({ email, status, createdAt }) => ({ email, status, createdAt }));
}

// Stilneutrale, framework-freie HTML-Seite fuer die beiden oeffentlichen Bestaetigungs-/
// Abmelde-Routen (Owner-Auftrag: "schlicht, kein Framework"). lang steuert nur das
// html-lang-Attribut (Barrierefreiheit) - der sichtbare Text kommt vollstaendig aus dem
// aufgeloesten Locale-Bundle (i18n/locales.js), kein zweiter Text-Ort.
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
