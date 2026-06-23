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
