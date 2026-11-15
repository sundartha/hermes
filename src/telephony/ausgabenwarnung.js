import { sendeVorfall } from "./alert-sms.ts";

const ANLASS = "spend-warning";
const PRAEFIX = "[Hermes] Plattform-Warnschwelle erreicht: ";

export function sendeAusgabenwarnung({ config, warning, detail }) {
  return sendeVorfall({
    adresse: config.billing.betterstackAlertUrl,
    anlass: ANLASS,
    schluessel: `${ANLASS}:${warning.monthKey}`,
    status: "alert",
    meldezeile: PRAEFIX + detail,
  });
}
