// AL-P2b (WEGWERF, nie nach master): Gegenueber fuer den SSE-Spike - nimmt ab und
// schweigt. Ohne diese Route ist in der Aufnahme nicht zu trennen, wann UNSER
// Assistant zu sprechen beginnt. Reiner statischer TeXML-Responder: kein Store, kein
// Call-Record, kein Gate, kein Kostenpfad.
//
// AUTH-ENTSCHEIDUNG (Absolute Regel 3, begruendet): Telnyx ruft diesen Webhook
// unauthentifiziert - dieselbe Lage wie bei den bestehenden Provider-Webhooks. Statt
// einer NEUEN Ausnahme laeuft die Route deshalb UNTER dem /voice-Praefix und wird in
// src/app.js NACH makeVoiceRoutes(...) gemountet. Damit erbt sie exakt drei
// Bestandssicherungen, ohne eine einzige neue Auth-Kante zu erzeugen:
//   1. Basic-Auth-Exemption - makeAuthGate (src/wiring/auth-gate.js) exemptiert
//      req.path.startsWith(VOICE_PATH_PREFIX). Keine neue Zeile in der eingefrorenen
//      Exemption-Reihenfolge (INV-3), kein Anfassen von /api/*.
//   2. Provider-Signaturpruefung fail-closed - die /voice-Signatur-Middleware im
//      Voice-Router laeuft VOR dem Fall-Through hierher: sie ruft next(), der
//      Voice-Router findet keine passende Route, Express reicht an den naechsten
//      App-Mount weiter. Eine ungueltige Signatur endet vorher mit 403 +
//      [voice-signature]-Zeile. DIESE REIHENFOLGE IST DIE SICHERUNG - sie wird per
//      Spawn-Test gepinnt (test/al-p2b-silence-route.test.js), nicht per Kommentar
//      behauptet.
//   3. Rate-Limit-Bypass + rawBody-Capture (src/app.js) haengen am selben /voice-Praefix;
//      ohne rawBody koennte die Telnyx-Ed25519-Pruefung gar nicht verifizieren.
import { Router } from "express";
import { hangup as hangupD, pause as pauseD } from "../telephony/directives.js";
import { normNum, PROVIDER } from "../store/defaults.js";

// G25: kein nackter Statuscode im Handler (Muster telnyx-llm-shim.js HTTP_NOT_FOUND).
const HTTP_NOT_FOUND = 404;
// Exportiert, damit Treiber-Skript (scripts/al-p2-spike-driver.mjs) und Test EINE Quelle
// fuer den Pfad haben (G5) statt drei Literale.
export const SPIKE_SILENCE_PATH = "/voice/spike-silence";

export function makeSpikeSilenceRoutes({ config, voiceRender }) {
  const router = Router();

  // Existenz hinter dem Schalter (Muster Shim-Existenz-Gate): ohne gesetzte
  // Wegwerf-Zielnummer beantwortet die Route NICHTS - ein versehentlich damit
  // deployter Dienst ist unauffaellig 404.
  router.post(SPIKE_SILENCE_PATH, (req, res) => {
    const spikeCallee = config.telnyx.telnyxAssistant.sseSpikeCallee;
    if (!spikeCallee) return res.status(HTTP_NOT_FOUND).end();

    // `To` wird erst NACH der Signaturpruefung gelesen (Anti-Spoof, Muster
    // /voice/incoming). Nur die EINE Wegwerf-DID wird bedient; jede andere Zielnummer
    // bekommt 404 und genau EINE Diagnosezeile - ohne sie endete ein fehlgeleiteter
    // Testanruf stumm und unerklaerlich (Regel 7). Die Rufnummern duerfen laut Spec im
    // Klartext stehen (es sind unsere eigenen Wegwerf-DIDs).
    const to = normNum(req.body?.To);
    if (to !== spikeCallee) {
      console.warn(
        `[spike-silence] fremdes To -> 404 (to=${to || "leer"} erwartet=${spikeCallee})`,
      );
      return res.status(HTTP_NOT_FOUND).end();
    }

    // Keine Magic Number (G25/G35): die Stille dauert exakt so lange, wie ein Anruf
    // ueberhaupt dauern darf - der harte Max-Dauer-Cap beendet ihn ohnehin.
    const silence = [pauseD(config.safety.maxCallDurationS), hangupD()];
    res.type("text/xml").send(voiceRender.render(silence, PROVIDER.TELNYX));
  });

  return router;
}
