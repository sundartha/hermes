import { findPlan } from "../plans.ts";
import { localeFor } from "../i18n/locales.js";
import { fehlerText } from "../utils/fehler-text.ts";

const CENT_JE_EINHEIT = 100;
const ISO_ZEIT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/;

const ZUSTIMMUNG_WORTLAUT = Object.freeze({
  "widerruf-beginn-v1": Object.freeze({
    de: "Ich verlange ausdrücklich, dass Sundartha vor Ablauf der Widerrufsfrist mit der Leistung beginnt. Mir ist bekannt, dass ich bei Widerruf einen anteiligen Wertersatz für die bis dahin erbrachte Leistung zahle und mein Widerrufsrecht bei vollständiger Erfüllung erlischt.",
    en: "I expressly request that Sundartha begin providing the service before the withdrawal period expires. I am aware that if I withdraw, I will pay a proportionate amount for the service provided up to that point, and that my right of withdrawal expires once the contract has been fully performed.",
  }),
});

const TEXTE = Object.freeze({
  de: Object.freeze({
    sprache: "de",
    zahlFormat: "de-DE",
    zeit: ({ jahr, monat, tag, uhr }) => `${tag}.${monat}.${jahr}, ${uhr} Uhr (UTC)`,
    agbUrl: "https://sundartha.com/agb",
    betreff: (plan) => `Bestätigung deines Abos: Hermes ${plan}`,
    anrede: "Hallo,",
    einleitung: "vielen Dank für deine Buchung. Hiermit bestätigen wir deinen Vertrag:",
    tarif: (plan) => `Tarif: ${plan}`,
    preis: (betrag) => `Preis: ${betrag} pro Monat, monatlich kündbar zum Ende des Abrechnungszeitraums`,
    zustimmung: (zeit) => `Bei der Buchung hast du am ${zeit} folgende Erklärung abgegeben:`,
    agb: (url) => `Allgemeine Geschäftsbedingungen: ${url}`,
    widerruf: (url) =>
      `Widerrufsbelehrung und Muster-Widerrufsformular (Abschnitt „Widerrufsrecht für Verbraucher“ der AGB): ${url}`,
    gruss: "Viele Grüße\nSundartha — Anbieter des Telefon-Assistenten Hermes",
    zitat: (text) => `„${text}“`,
  }),
  en: Object.freeze({
    sprache: "en",
    zahlFormat: "en-GB",
    zeit: ({ jahr, monat, tag, uhr }) => `${jahr}-${monat}-${tag} ${uhr} UTC`,
    agbUrl: "https://sundartha.com/legal/terms",
    betreff: (plan) => `Your subscription confirmation: Hermes ${plan}`,
    anrede: "Hello,",
    einleitung: "thank you for your order. We hereby confirm your contract:",
    tarif: (plan) => `Plan: ${plan}`,
    preis: (betrag) => `Price: ${betrag} per month, cancellable monthly at the end of the billing period`,
    zustimmung: (zeit) => `When booking, on ${zeit} you made the following declaration:`,
    agb: (url) => `Terms and conditions: ${url}`,
    widerruf: (url) =>
      `Withdrawal instructions and model withdrawal form (section "Right of withdrawal for consumers" of the terms): ${url}`,
    gruss: "Kind regards\nSundartha — provider of the Hermes phone assistant",
    zitat: (text) => `"${text}"`,
  }),
});

function zustimmungsZeilen(texte, zustimmung) {
  const wortlaut = ZUSTIMMUNG_WORTLAUT[zustimmung.text]?.[texte.sprache];
  const teile = ISO_ZEIT.exec(zustimmung.at ?? "");
  if (!teile || !wortlaut) return [];
  const [, jahr, monat, tag, uhr] = teile;
  return [texte.zustimmung(texte.zeit({ jahr, monat, tag, uhr })), texte.zitat(wortlaut), ""];
}

export function aboBestaetigungsMail({ sprache, planSlug, zustimmung }) {
  const texte = TEXTE[sprache] ?? TEXTE.en;
  const plan = findPlan(planSlug);
  const format = new Intl.NumberFormat(texte.zahlFormat, { style: "currency", currency: plan.currency });
  const betrag = format.format(plan.amountCents / CENT_JE_EINHEIT);
  const text = [
    texte.anrede,
    "",
    texte.einleitung,
    "",
    texte.tarif(plan.name),
    texte.preis(betrag),
    "",
    ...zustimmungsZeilen(texte, zustimmung),
    texte.agb(texte.agbUrl),
    texte.widerruf(texte.agbUrl),
    "",
    texte.gruss,
  ].join("\n");
  return { subject: texte.betreff(plan.name), text };
}

async function sendeAboBestaetigung({ bereiche, accounts, mailer, tenant, planSlug }) {
  try {
    const account = await accounts.accountByTenant(tenant);
    if (!account?.email) return false;
    const sprache = localeFor(await bereiche.mandantProfil.tenantLanguage(tenant)).language;
    const zustimmung = await bereiche.konto.tenantWiderrufBeginn(tenant);
    if (!zustimmung.at) console.warn(`[abo-bestaetigung] keine gespeicherte Zustimmung tenant=${tenant}`);
    await mailer.sendMail({ to: account.email, ...aboBestaetigungsMail({ sprache, planSlug, zustimmung }) });
    return true;
  } catch (err) {
    console.error(`[abo-bestaetigung] Versand fehlgeschlagen tenant=${tenant}: ${fehlerText(err)}`);
    return false;
  }
}

const BESTAETIGBAR = Object.freeze(new Set(["already_subscribed"]));

async function bestaetigeOffenesAbo(deps) {
  const { subscriptionId } = await deps.bereiche.konto.tenantSubscription(deps.tenant);
  if (!subscriptionId) return;
  if ((await deps.bereiche.konto.aboBestaetigungFuer(deps.tenant)) === subscriptionId) return;
  if (await sendeAboBestaetigung(deps)) await deps.bereiche.konto.setAboBestaetigungFuer(deps.tenant, subscriptionId);
}

export async function bestaetigeAbo(deps, ergebnis) {
  if (!deps.mailer) return;
  if (ergebnis.ok !== true && !BESTAETIGBAR.has(ergebnis.reason)) return;
  try {
    await bestaetigeOffenesAbo(deps);
  } catch (err) {
    console.error(`[abo-bestaetigung] Bestaetigung nicht abgeschlossen tenant=${deps.tenant}: ${fehlerText(err)}`);
  }
}
