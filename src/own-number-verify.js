// Besitz-Verifikation der eigenen Nummer (PLAN-OWNER-CALL/OC, Owner-Entscheidung 2026-08-21).
// Loest den Launch-Blocker in PLAN-SECURITY.md: die Tenant-Allowlist OWNER_SELF_CALL_TENANT_IDS
// ist keine Verifikation - dieses Modul ist es. Zweistufig:
//   Stufe 1 (hier): E-Mail-Bestaetigung der ABSICHT (Token-Bausteine + Gate-Entscheidung).
//   Stufe 2 (state-ops.js verifyPrivateNumberByInboundCall): Besitz-NACHWEIS per Anruf von
//   der hinterlegten Nummer selbst - braucht keine Bausteine hier (kein Token, kein Mail).
//
// PARALLEL-LOKAL zu src/newsletter-recipients.js gebaut (Owner-Auftrag: "verallgemeinere
// NUR wenn noetig"): dieselbe Token-/TTL-/Tageslimit-Bauart, aber eigene, kleinere
// Konstantenmenge - eine EINZELNE Nummer pro Tenant braucht weder Cap noch Duplikat-Pruefung
// (die newsletter-recipients.js fuer ihre Liste braucht). renderNewsletterPage bleibt
// direkt wiederverwendet (self-service-routes.js) - der Seiten-Renderer ist bereits
// generisch (title/body/lang), eine zweite Kopie waere reine Duplizierung (G5).
//
// REIN bis auf den Gate-Check und die Stufe-2-Verdrahtung (die injizieren store/audit,
// Muster planAddNewsletterRecipient): kein IO, kein Store-Import auf Modul-Ebene (DIP).
import crypto from "crypto";
import { normNum } from "./store/defaults.js";

// Tageslimit der Bestaetigungs-Mails je Tenant (Owner-Auftrag, Muster
// NEWSLETTER_CONFIRM_MAIL_DAILY_CAP: Schutz gegen Missbrauch als Spam-Schleuder gegen die
// Konto-Adresse). Zaehlt JEDEN Versuch, der bis zur Token-Ausstellung kommt.
export const OWN_NUMBER_CONFIRM_MAIL_DAILY_CAP = 10;

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

// Gueltigkeit des Bestaetigungs-Tokens (Muster NEWSLETTER_CONFIRM_TOKEN_TTL_MS: 48h),
// danach neutrale Fehlseite.
export const OWN_NUMBER_CONFIRM_TOKEN_TTL_MS = 48 * ONE_HOUR_MS;

function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function hashOwnNumberToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

// Erzeugt den Bestaetigungs-Token EINES Bestaetigungsversuchs (Muster newNewsletterTokens):
// NUR der SHA256-Hash wird gespeichert (tokenHash) + Ablaufzeit (48h) - Einmalverwendung.
export function newOwnNumberConfirmToken(nowMs = Date.now()) {
  const confirmToken = randomToken();
  return {
    confirmToken,
    tokenHash: hashOwnNumberToken(confirmToken),
    tokenExpiresAt: new Date(nowMs + OWN_NUMBER_CONFIRM_TOKEN_TTL_MS).toISOString(),
  };
}

export function ownNumberConfirmUrl(publicUrl, confirmToken) {
  return `${publicUrl}/own-number/confirm?token=${confirmToken}`;
}

// Gate-Entscheidung VOR jeder Token-Ausstellung (Muster planAddNewsletterRecipient): NUR
// das Tageslimit - anders als bei den Newsletter-Zusatzempfaengern gibt es hier weder
// Format/Duplikat (die Nummer selbst ist bereits format-/land-validiert, s.
// state-ops.normalizePrivateNumber) noch einen Cap (genau EIN Feld pro Tenant, kein Set).
// store injiziert (DIP) - store.dailyPrivateNumberConfirmMailCount ist die Store-FASSADE
// (json.js/pg.js exportieren beide), kein direkter state-ops-Import.
export function planStartOwnNumberConfirmation({ store, tenantId, now = new Date() }) {
  const sinceIso = new Date(now.getTime() - ONE_DAY_MS).toISOString();
  if (store.dailyPrivateNumberConfirmMailCount(tenantId, sinceIso) >= OWN_NUMBER_CONFIRM_MAIL_DAILY_CAP)
    return { ok: false, reason: "daily_limit" };
  return { ok: true };
}

// Additive Lese-View fuer /api/self-service/state (Owner-Auftrag: "keine Tokens"). Reine
// Projektion - der Aufrufer reicht die Rohwerte (state-ops.js privateNumberVerification).
export function publicPrivateNumberVerification({ emailConfirmed, verified, verifiedAt } = {}) {
  return { emailConfirmed: emailConfirmed === true, verified: verified === true, verifiedAt: verifiedAt ?? null };
}

// OC-Besitz-Verifikation, Stufe 2 (PLAN-SECURITY.md Launch-Blocker geloest): wird von
// POST /voice/incoming NACH der Tenant-Aufloesung aufgerufen. Der ANRUFENDE Provider hat
// die Signatur bereits fail-closed geprueft (app.use("/voice") in routes/voice.js) - From
// ist an dieser Stelle providerseitig genauso vertrauenswuerdig wie To. Reine
// Zustandsmutation, KEIN Einfluss auf den weiteren Gespraechsfluss (kein anderes Greeting,
// keine andere Antwort) - der Aufrufer liest nur den Audit-Hinweis. Reihenfolge Stufe 1
// (E-Mail) vor Stufe 2 (dieser Anruf) ist Pflicht: ein Match VOR abgeschlossener
// E-Mail-Bestaetigung mutiert nichts (state-ops.js verifyPrivateNumberByInboundCall), der
// Hinweis macht das fuer Support sichtbar. store/audit injiziert (DIP, Muster
// planStartOwnNumberConfirmation) - EIN Options-Parameter (max-3-Regel).
export function verifyOwnNumberOnInboundCall({ store, audit, req, tenantId, nowIso }) {
  const ownNumberVerify = store.verifyPrivateNumberByInboundCall(tenantId, normNum(req.body.From), nowIso);
  if (ownNumberVerify.verified) {
    audit("own_number_verified", req, `tenant=${tenantId}`);
  } else if (ownNumberVerify.reason) {
    audit("own_number_verify_skipped", req, `tenant=${tenantId} reason=${ownNumberVerify.reason}`);
  }
  return ownNumberVerify;
}
