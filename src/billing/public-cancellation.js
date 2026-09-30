// Oeffentliches Kuendigungsformular (§ 312k BGB) - Kuendigen OHNE Anmeldung.
//
// Warum es das gibt: die Kuendigungsschaltflaeche auf sundartha.com fuehrte bisher nur zum
// Login. LG Koeln (29.07.2022, 33 O 355/22) und LG Muenchen I (10.10.2023, 33 O 15098/22)
// werten eine Passwort-/Login-Pflicht als unzulaessige Huerde: der Verbraucher muss sich
// ueber Angaben wie Name und E-Mail identifizieren koennen. Dieses Modul nimmt die
// Kuendigungserklaerung ohne Sitzung entgegen (Route: public-cancellation-routes.js).
//
// ZWEI Wege, EINE Antwort nach aussen:
//   - SELBSTLAEUFER: ordentliche Kuendigung zum naechstmoeglichen Zeitpunkt UND die Email
//     gehoert eindeutig einem Tenant mit Abo -> dieselbe Sequenz wie der Knopf im
//     Kundenbereich (setSubscriptionCancellation + Bestaetigung an die KONTO-Adresse).
//   - WEITERGABE: alles andere (ausserordentlich, Wunschtermin, kein/mehrdeutiger Treffer,
//     kein Abo, Stripe-Fehler) geht als Mail an das Kundenpostfach (MAIL_FROM) und wird
//     von Hand bearbeitet; bei eindeutigem Treffer bekommt die KONTO-Adresse sofort eine
//     Eingangsbestaetigung.
// Nach aussen sehen beide Wege gleich aus (nur der Eingangszeitpunkt kommt zurueck): die
// Antwort verraet nie, ob eine Email Kunde ist (keine Konto-Aufzaehlung).
//
// MISSBRAUCH, bewusst abgewogen: wer eine fremde Konto-Email eintraegt, kann ein fremdes
// Abo zum Periodenende vormerken. Die Bestaetigung geht dann an den ECHTEN Inhaber (Konto-
// Adresse, nie die Formular-Adresse - kein Mail-Versand an beliebige Adressen), der die
// Vormerkung im Kundenbereich mit einem Klick zuruecknimmt; bis zum Periodenende aendert
// sich nichts am Dienst. Eine zusaetzliche Bestaetigungs-Mail vor der Wirkung waere genau
// die Huerde, die § 312k verbietet.
//
// Regel 4: Name/Email/Grund landen NIE in Log oder audit_log - nur in der Mail an das
// eigene Kundenpostfach (dafuer sind sie da). audit_log traegt Art, Weg und Ausgang.
import { normalizeEmail, isValidEmailFormat } from "../newsletter-recipients.js";
import { formatReceivedAt } from "./cancellation-mail.js";
import {
  setSubscriptionCancellation,
  triggerCancellationConfirmation,
} from "./subscription-cancellation.js";

const CANCELLATION_KIND = Object.freeze({
  ORDINARY: "ordinary",
  EXTRAORDINARY: "extraordinary",
});
const CANCELLATION_TIMING = Object.freeze({ NEXT: "next", DATE: "date" });

// Ausgang des Selbstlaeufers - landet im audit_log und in der Mail ans Kundenpostfach.
const SCHEDULE_OUTCOME = Object.freeze({
  SCHEDULED: "scheduled",
  ALREADY_SCHEDULED: "already_scheduled",
  NOT_ELIGIBLE: "not_eligible",
  NO_MATCH: "no_match",
  NO_SUBSCRIPTION: "no_subscription",
  BILLING_OFF: "billing_off",
  FAILED: "failed",
});
const DONE_OUTCOMES = new Set([SCHEDULE_OUTCOME.SCHEDULED, SCHEDULE_OUTCOME.ALREADY_SCHEDULED]);

// Feldgrenzen: grosszuegig fuer echte Eingaben, eng genug gegen Muell im Postfach.
const NAME_MIN = 2;
const NAME_MAX = 120;
const EMAIL_MAX = 254; // RFC 5321 Pfadlaenge
const REFERENCE_MAX = 80;
const REASON_MAX = 2000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const KIND_LABEL = Object.freeze({
  [CANCELLATION_KIND.ORDINARY]: "ordentliche Kündigung",
  [CANCELLATION_KIND.EXTRAORDINARY]: "außerordentliche Kündigung",
});

const trimmed = (value) => (typeof value === "string" ? value.trim() : "");
const withinLength = (value, { min, max }) => value.length >= min && value.length <= max;

// Kalendertag im Format JJJJ-MM-TT, der wirklich existiert (kein 31.02.).
export function isCalendarDate(value) {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function formatIsoDate(value) {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

// Die Pflichtangaben nach § 312k Abs. 2 Nr. 1 BGB: Art (+ Grund bei ausserordentlich),
// Identitaet, Vertrag, Zeitpunkt, Adresse fuer die Bestaetigung. Jede Pruefung liefert die
// Liste ihrer ungueltigen Felder (leer = alles gut) - der Aufrufer braucht nicht zu raten.
function invalidIdentityFields({ name, email, reference }) {
  const invalid = [];
  if (!withinLength(name, { min: NAME_MIN, max: NAME_MAX })) invalid.push("name");
  if (email.length > EMAIL_MAX || !isValidEmailFormat(email)) invalid.push("email");
  if (reference.length > REFERENCE_MAX) invalid.push("reference");
  return invalid;
}

function invalidTermsFields({ kind, reason, timing, date }) {
  const invalid = [];
  if (!Object.values(CANCELLATION_KIND).includes(kind)) invalid.push("kind");
  const reasonNeeded = kind === CANCELLATION_KIND.EXTRAORDINARY;
  if (reasonNeeded && !withinLength(reason, { min: 1, max: REASON_MAX })) invalid.push("reason");
  if (!Object.values(CANCELLATION_TIMING).includes(timing)) invalid.push("timing");
  if (timing === CANCELLATION_TIMING.DATE && !isCalendarDate(date)) invalid.push("date");
  return invalid;
}

// Reine Pruefung (kein IO). body ist das bereits geparste Objekt. Liefert
// { declaration } oder { invalid: [feld, ...] }. Ein Grund bzw. Datum, das zur gewaehlten
// Art bzw. zum Zeitpunkt nicht gehoert, wird verworfen statt weitergereicht.
export function parseCancellationDeclaration(body) {
  const raw = body && typeof body === "object" ? body : {};
  const fields = {
    name: trimmed(raw.name),
    email: normalizeEmail(trimmed(raw.email)),
    reference: trimmed(raw.reference),
    kind: trimmed(raw.kind),
    reason: trimmed(raw.reason),
    timing: trimmed(raw.timing),
    date: trimmed(raw.date),
  };
  const invalid = [...invalidIdentityFields(fields), ...invalidTermsFields(fields)];
  if (invalid.length > 0) return { invalid };
  const declaration = {
    ...fields,
    reason: fields.kind === CANCELLATION_KIND.EXTRAORDINARY ? fields.reason : "",
    date: fields.timing === CANCELLATION_TIMING.DATE ? fields.date : "",
  };
  return { declaration };
}

function timingText(declaration) {
  return declaration.timing === CANCELLATION_TIMING.DATE
    ? `zum ${formatIsoDate(declaration.date)}`
    : "zum nächstmöglichen Zeitpunkt";
}

// Nur dieser Fall laeuft ohne Menschen: er ist genau das, was der Knopf im Kundenbereich
// auch tut. Wunschtermin und ausserordentliche Kuendigung brauchen ein Urteil.
function isSelfServiceable(declaration) {
  return (
    declaration.kind === CANCELLATION_KIND.ORDINARY &&
    declaration.timing === CANCELLATION_TIMING.NEXT
  );
}

// Mail an das eigene Kundenpostfach: die vollstaendige Erklaerung + was das System schon
// getan hat. Der einzige Ort, an dem Name/Email/Grund die Anfrage ueberleben.
function buildTeamNoticeText({ declaration, receivedAt, outcome, tenantId }) {
  const lines = [
    `Kündigung über das Formular auf der Website, eingegangen am ${formatReceivedAt(receivedAt)}.`,
    "",
    `Name: ${declaration.name}`,
    `E-Mail: ${declaration.email}`,
    `Rufnummer/Kundennummer: ${declaration.reference || "—"}`,
    `Art: ${KIND_LABEL[declaration.kind]}`,
    `Zeitpunkt: ${timingText(declaration)}`,
  ];
  if (declaration.reason) lines.push(`Grund: ${declaration.reason}`);
  lines.push(
    "",
    `Zugeordnetes Konto: ${tenantId ?? "keines (E-Mail unbekannt oder mehrdeutig)"}`,
    `Automatische Vormerkung: ${outcome}`,
    "",
    "Bitte bearbeiten und dem Kunden den Termin bestätigen, zu dem die Kündigung wirkt.",
  );
  return {
    subject: `Kündigung eingegangen: ${KIND_LABEL[declaration.kind]}`,
    text: lines.join("\n"),
  };
}

// Eingangsbestaetigung (§ 312k Abs. 4) fuer den Weitergabe-Weg - an die KONTO-Adresse.
// Der Wirkungstermin folgt gesondert, weil ihn hier noch ein Mensch festlegt.
function buildReceiptText({ declaration, receivedAt, publicUrl }) {
  const text = [
    "Hallo,",
    "",
    `hiermit bestätigen wir den Eingang Ihrer Kündigung vom ${formatReceivedAt(receivedAt)}.`,
    "",
    `Art: ${KIND_LABEL[declaration.kind]}`,
    `Gewünschter Zeitpunkt: ${timingText(declaration)}`,
    "",
    "Wir prüfen Ihre Kündigung und bestätigen Ihnen den Termin, zu dem sie wirkt, gesondert.",
    "",
    "Mit freundlichen Grüßen",
    "Sundartha — Anbieter des Telefon-Assistenten Hermes",
    `Anbieterangaben: ${publicUrl}/impressum`,
  ].join("\n");
  return { subject: "Eingang Ihrer Kündigung", text };
}

// Selbstlaeufer: dieselbe Sequenz wie der Knopf im Kundenbereich. Wirft nie - ein
// Stripe-Fehler endet in FAILED, und die Erklaerung geht dann an einen Menschen.
async function scheduleForTenant(deps, { tenantId, receivedAt }) {
  const { store, billing, auditStore, config } = deps;
  if (!config.billing.paymentEnabled || !billing) return SCHEDULE_OUTCOME.BILLING_OFF;
  try {
    const result = await setSubscriptionCancellation({
      store,
      billing,
      tenant: tenantId,
      cancel: true,
    });
    if (!result.ok) return SCHEDULE_OUTCOME.NO_SUBSCRIPTION;
    if (result.alreadyApplied) return SCHEDULE_OUTCOME.ALREADY_SCHEDULED;
    await auditStore.record({
      tenantId,
      action: "public_cancel_scheduled",
      detail: `current_period_end=${result.currentPeriodEnd ?? "unknown"}`,
    });
    await triggerCancellationConfirmation({ ...deps, tenantId, receivedAt });
    return SCHEDULE_OUTCOME.SCHEDULED;
  } catch (err) {
    console.error(`[public-cancel] Vormerkung fehlgeschlagen tenant=${tenantId}: ${err.message}`);
    return SCHEDULE_OUTCOME.FAILED;
  }
}

async function tryAutomaticCancellation(deps, { declaration, tenantId, receivedAt }) {
  if (!isSelfServiceable(declaration)) return SCHEDULE_OUTCOME.NOT_ELIGIBLE;
  if (!tenantId) return SCHEDULE_OUTCOME.NO_MATCH;
  return scheduleForTenant(deps, { tenantId, receivedAt });
}

// Liefert true, wenn die Erklaerung im Kundenpostfach angekommen ist. Ohne Mailer oder
// Postfach-Adresse ist das nicht moeglich - dann darf der Kunde KEIN "eingegangen" sehen.
async function forwardToTeam(deps, notice) {
  const { mailer, config } = deps;
  const inbox = config.mail.mailFrom;
  if (!mailer || !inbox) {
    console.error("[public-cancel] kein Mailer/Postfach - Erklaerung nicht weiterleitbar");
    return false;
  }
  try {
    await mailer.sendMail({ to: inbox, ...buildTeamNoticeText(notice) });
    return true;
  } catch (err) {
    console.error(`[public-cancel] Weitergabe fehlgeschlagen: ${err.code || err.name || "error"}`);
    return false;
  }
}

// Eingangsbestaetigung an die Konto-Adresse, fail-soft: die Erklaerung liegt zu diesem
// Zeitpunkt schon im Kundenpostfach, ein Versandfehler hier wird dort nachgeholt.
async function sendReceipt(deps, { tenantId, declaration, receivedAt }) {
  const { mailer, accounts, config } = deps;
  try {
    const account = await accounts.accountByTenant(tenantId);
    if (!account?.email) return;
    const mail = buildReceiptText({ declaration, receivedAt, publicUrl: config.server.publicUrl });
    await mailer.sendMail({ to: account.email, ...mail });
  } catch (err) {
    console.error(
      `[public-cancel] Eingangsbestaetigung fehlgeschlagen tenant=${tenantId}: ${err.code || err.name || "error"}`,
    );
  }
}

// Ein flackernder Lookup darf die Erklaerung nicht verlieren: ohne Treffer geht sie an
// einen Menschen (Weitergabe-Weg), statt als Fehler beim Kunden zu landen.
async function lookupTenant(tenantByEmail, email) {
  try {
    return await tenantByEmail(email);
  } catch (err) {
    console.error(`[public-cancel] Konto-Zuordnung fehlgeschlagen: ${err.message}`);
    return null;
  }
}

// Der EINE Einstieg der Route. deps: { store, billing, accounts, tenantByEmail,
// auditStore, mailer, config }. Liefert { ok, receivedAt }; ok:false heisst, die
// Erklaerung konnte weder ausgefuehrt noch weitergegeben werden - der Kunde muss auf die
// E-Mail ausweichen.
export async function receivePublicCancellation(deps, { declaration, receivedAt }) {
  const tenantId = await lookupTenant(deps.tenantByEmail, declaration.email);
  const outcome = await tryAutomaticCancellation(deps, { declaration, tenantId, receivedAt });
  if (DONE_OUTCOMES.has(outcome)) return { ok: true, receivedAt };

  const forwarded = await forwardToTeam(deps, { declaration, receivedAt, outcome, tenantId });
  await deps.auditStore.record({
    tenantId,
    action: forwarded ? "public_cancel_forwarded" : "public_cancel_forward_failed",
    detail: `kind=${declaration.kind} timing=${declaration.timing} outcome=${outcome}`,
  });
  if (!forwarded) return { ok: false, receivedAt };
  if (tenantId) await sendReceipt(deps, { tenantId, declaration, receivedAt });
  return { ok: true, receivedAt };
}
