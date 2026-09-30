/* =============================================================================
 * cancel-form.js - reine Bausteine des Kuendigungsformulars (§ 312k BGB) auf
 * /kuendigen und im Reiter "Verträge kündigen" der Startseite. Kein DOM, kein
 * fetch: scripts/cancel-form.js verdrahtet, dieses Modul entscheidet (per
 * node:test geprueft). Die Fachlogik (Pruefung, Zuordnung, Mails) lebt im
 * Gateway: src/billing/public-cancellation.js im Wurzelprojekt.
 * ========================================================================== */

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_TOO_MANY = 429;

// Welche Meldung (data-msg-* am Formular) zu welcher Antwort gehoert. Alles
// Unbekannte - 5xx, Netzfehler - faellt auf "unavailable": dann bleibt dem
// Kunden die E-Mail, und die Meldung sagt ihm genau das.
export const FORM_MESSAGE = Object.freeze({
  INVALID: "invalid",
  RATE: "rate",
  UNAVAILABLE: "unavailable",
});

export function messageForStatus(status) {
  if (status === HTTP_BAD_REQUEST) return FORM_MESSAGE.INVALID;
  if (status === HTTP_TOO_MANY) return FORM_MESSAGE.RATE;
  return FORM_MESSAGE.UNAVAILABLE;
}

export const isAccepted = (status) => status === HTTP_OK;

// Eingangszeitpunkt fuer die Bestaetigungsseite - in deutscher Ortszeit wie die
// Bestaetigungs-Mail (src/billing/cancellation-mail.js), mit Zonenkuerzel,
// damit der gespeicherte Ausdruck auch im Ausland eindeutig bleibt.
export function formatReceivedAt(iso, lang) {
  const locale = lang === "en" ? "en-GB" : "de-DE";
  return (
    new Intl.DateTimeFormat(locale, {
      timeZone: "Europe/Berlin",
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date(iso)) + (lang === "en" ? " (Berlin time)" : " Uhr (deutsche Zeit)")
  );
}

// JJJJ-MM-TT -> TT.MM.JJJJ bzw. DD/MM/YYYY fuer die Zusammenfassung.
export function formatWishDate(value, lang) {
  const [year, month, day] = value.split("-");
  return lang === "en" ? `${day}/${month}/${year}` : `${day}.${month}.${year}`;
}

// Nur die Felder, die der Gateway kennt - der Rest des Formulars (Knoepfe)
// reist nicht mit. Das Verstecktfeld "website" bleibt drin: der Gateway
// erkennt daran Bots (src/public-cancellation-routes.js).
export const PAYLOAD_FIELDS = Object.freeze([
  "name",
  "email",
  "reference",
  "kind",
  "reason",
  "timing",
  "date",
  "website",
]);

export function payloadFrom(entries) {
  const values = new Map(entries);
  const payload = new URLSearchParams();
  for (const field of PAYLOAD_FIELDS) payload.set(field, String(values.get(field) ?? "").trim());
  return payload;
}
