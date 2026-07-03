// Boot-Entkopplung (OT-1, AC5). Fuehrt einen Boot-Teilschritt aus und kappt seinen
// Blast-Radius: faengt jeden Fehler, loggt ihn laut + secret-frei (nur err.message)
// und laeuft weiter (kein throw). Damit killt ein Portal-Pool-Fehler (DB unerreichbar
// fuer das Web-Login ODER Superuser-Rolle/F5) nicht mehr den ganzen Prozess inkl.
// Telefonie - nur die Web-Login/Portal-Routen entfallen (existieren nicht -> 404).
// Bewusst eigene, testbare Einheit (DIP) statt inline-try/catch.
//
// Liefert true, wenn der Teilschritt durchlief (gemountet), sonst false (uebersprungen).
export async function guardedBoot(label, fn) {
  try {
    await fn();
    return true;
  } catch (e) {
    // secret-frei: NUR die Fehler-Message, nie config/Connection-String/Env.
    console.error(
      `[boot] ${label} deaktiviert (Portal-Pool-Fehler):`,
      e && e.message ? e.message : String(e),
    );
    return false;
  }
}

// Boot-Haertung (OUT-05, F2): FAKE_ORIGINATE ersetzt den Provider-Transport durch einen
// Test-Fake (kein echter Dial) und DARF nur greifen, wo die Signaturpruefung ohnehin
// geskippt ist (beweisbar nicht-produktiv). In Prod ist die Signaturpruefung fail-closed AN
// (Regel 1) -> ein versehentliches FAKE_ORIGINATE=true fuehrt zum Boot-Refusal statt zu
// stillem Nicht-Waehlen. Reine Entscheidung (arg-injiziert, config-frei, testbar):
// true = Start verweigern. Praezedenz: SKIP_TWILIO_SIGNATURE_CHECK (die Test-Suite nutzt es
// prozessweit).
export function fakeOriginateBootBlocked({ fakeOriginate, skipTwilioSignatureCheck }) {
  return fakeOriginate === true && skipTwilioSignatureCheck !== true;
}
