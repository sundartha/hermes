// Anbieter-Felder, die als Enum durchgehen sollen, sind erst dann eines, wenn ihre FORM
// geprueft ist (GP-P1, GP-P2). Stripe-Enums sind Kleinbuchstaben/Ziffern/Unterstrich:
// card_declined, insufficient_funds, us_bank_account. Alles andere - eine E-Mail, ein
// Satz, ein Objekt - faellt auf null. Die PII-Zusage der Geldpfad-Kette haengt damit an
// der Form, nicht an der Annahme, der Anbieter halte sich an sein Vokabular.
// EINE Quelle (G5): geteilt von decline.js (Ablehnungsgrund) und webhook.js
// (Zahlungsmethoden-Typ); beide Werte landen in Log, Fehlermeldung und Datenbank.
const ENUM_TOKEN = /^[a-z0-9_]+$/;
const MAX_ENUM_LENGTH = 64;

export const enumOrNull = (wert) =>
  typeof wert === "string" &&
  wert.length > 0 &&
  wert.length <= MAX_ENUM_LENGTH &&
  ENUM_TOKEN.test(wert)
    ? wert
    : null;
// const ALTE_GRENZE = MAX_ENUM_LENGTH;
