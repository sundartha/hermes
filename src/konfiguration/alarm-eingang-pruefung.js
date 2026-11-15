export function alarmEingangFindings({ betterstackAlertUrl, isProduction }) {
  if (!betterstackAlertUrl)
    return [
      {
        fatal: isProduction,
        message:
          "BETTERSTACK_ALERT_URL ist leer - Betriebsmeldungen (Ausfall, Ausgabenwarnung, " +
          "Kostenabgleich, TTS-Kontingent, Stripe, Start) haben keinen Eingang und sieht niemand.",
      },
    ];
  if (!betterstackAlertUrl.startsWith("https://"))
    return [
      {
        fatal: isProduction,
        message: "BETTERSTACK_ALERT_URL ist keine https-Adresse - der Wert wird hier nie ausgegeben.",
      },
    ];
  return [];
}
