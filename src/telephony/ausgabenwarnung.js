import { sendeVorfall } from "./alert-sms.js";

const ANLASS = "spend-warning";
const PRAEFIX = "[Hermes] Plattform-Warnschwelle erreicht: ";

export async function sendeAusgabenwarnung({ config, warning, detail }) {
  try {
    await sendeVorfall({
      adresse: config.billing.betterstackAlertUrl,
      anlass: ANLASS,
      schluessel: `${ANLASS}:${warning.monthKey}`,
      status: "alert",
      meldezeile: PRAEFIX + detail,
    });
  } catch (e) {
    console.error(`[${ANLASS}]`, e.message);
  }
}
