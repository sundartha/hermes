const WEBHOOK_SPUR = /^.*stripe_webhook_\w+.*$/gm;

export const laufendeAusgaben = new Set();

export function fristAblaufMeldung(zeilen) {
  const ausgaben = [...laufendeAusgaben].map((ausgabe) => ausgabe.text);
  ausgaben.forEach((text, index) => {
    console.log(`--- Ausgabe Instanz ${index + 1} ---`);
    console.log(text);
  });
  const spuren = ausgaben.flatMap((text) => text.match(WEBHOOK_SPUR) ?? []);
  return `Zustand per SQL nicht erreicht: ${JSON.stringify(zeilen)}\nWebhook-Spuren der laufenden Server:\n${spuren.join("\n") || "(keine)"}`;
}
