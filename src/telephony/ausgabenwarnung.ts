import { sendeVorfall } from "./alert-sms.ts";

const ANLASS = "spend-warning";
const PRAEFIX = "[Hermes] Plattform-Warnschwelle erreicht: ";

interface AusgabenwarnungEingabe {
  config: { billing: { betterstackAlertUrl: string } };
  warning: { monthKey: string };
  detail: string;
}

export function sendeAusgabenwarnung({ config, warning, detail }: AusgabenwarnungEingabe): Promise<boolean> {
  return sendeVorfall({
    adresse: config.billing.betterstackAlertUrl,
    anlass: ANLASS,
    schluessel: `${ANLASS}:${warning.monthKey}`,
    status: "alert",
    meldezeile: PRAEFIX + detail,
  });
}
