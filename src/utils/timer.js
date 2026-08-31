// Gemeinsamer Timer-Helfer (G5, Review-Blocker Runde 1: war byte-identisch in
// telnyx-call-control-ingest.js UND telnyx-conversation-watchdog.js dupliziert).
// setTimeout, der den Event-Loop NICHT am Leben haelt (der HTTP-Server tut das) -
// Muster middleware.js makeFixedWindowCounter (.unref()). Injizierbar fuer
// deterministische Fake-Timer-Tests (DI-Default in den Aufrufern).
export function defaultSetTimer(fn, ms) {
  const handle = setTimeout(fn, ms);
  if (handle && typeof handle.unref === "function") handle.unref();
  return handle;
}

// Sekunden->ms (G5/G25, Review-Blocker Runde 4: war byte-identisch in
// telnyx-call-control-ingest.js UND telnyx-conversation-watchdog.js dupliziert -
// beide Module rechnen bereits mit demselben Timer-Helfer, die Sekunden-Konstante
// gehoert damit ins selbe geteilte Modul statt zweimal lokal definiert zu werden).
export const MS_PER_SECOND = 1000;

// Abrechnungs-/Provider-Minutentakt. EINE Quelle (G5): dieselbe Zahl definiert die
// Minutendefinition von voiceMinutesOf (billing/metering.js) UND die Zeitfenster-Regel
// des Consults - zwei Kopien wuerden bedeuten, dass die Regel gegen eine andere Minute
// rechnet als die Buchung.
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;

// G25: benannt statt der nackten 60 im Produkt (das gepinnte Lint-Budget dieser Datei
// deckt NUR die bereits vorhandene MS_PER_MINUTE-Multiplikation, keine zweite).
const MINUTES_PER_HOUR = 60;

// KV2-7: EINE Stunde in ms. Bisher lokal in kosten-deckung.js gefuehrt;
// kosten-abschluss.js waere die zweite Kopie gewesen (G5).
export const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;
