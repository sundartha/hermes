// Drossel am FIXEN UTC-Minutenfenster. GEMESSEN (Plan F1, 2026-07-21, /v2/detail_records):
// das Kontingent laeuft je voller Kalenderminute ab und gleitet NICHT - der Reset faellt
// immer auf :00. Genau deshalb ist die Fenstergrenze Math.floor(now / MINUTE_WINDOW_MS):
// Epoch-Millisekunden sind UTC, die Grenze ist damit ohne Zeitzonen-Rechnung dieselbe wie
// die des Providers.
//
// EIGENE VERANTWORTLICHKEIT (P16): dieses Modul kennt weder HTTP noch Provider-Felder. Es
// beantwortet genau eine Frage - "darf ich jetzt, und wenn nein, wie lange nicht". Uhr und
// Warten sind injizierbar (P4/P15): der Test kommt ohne echten Timer und ohne echte Uhr aus.
//
// NEBENLAEUFIGKEIT: der Belegabruf laeuft strikt sequenziell (eine Seite nach der anderen)
// und ein zweiter Sweep ist durch den sweepRunning-Riegel in billing/cost-truing.js
// ausgeschlossen. Zwei gleichzeitige Wartende koennten das Fensterbudget um je 1
// ueberschreiten - dafuer existiert die bewusste Reserve beim Aufrufer.
const MINUTE_WINDOW_MS = 60_000;

// Einzige Stelle mit einem echten Timer (P15). Kein unref(): ein laufender Sweep soll den
// Prozess nicht ueberholen.
const timerSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createMinuteWindowThrottle({ budget, now = Date.now, sleep = timerSleep }) {
  // Ein Budget <= 0 waere eine abgeschaltete Sicherung, ein Nicht-Ganzzahl-Budget ein
  // Konfigurationsfehler - beides faellt beim Modulladen auf, nicht im Betrieb.
  if (!Number.isInteger(budget) || budget < 1)
    throw new Error("createMinuteWindowThrottle: budget muss eine positive Ganzzahl sein");

  let windowStartMs = null;
  let usedInWindow = 0;

  const windowStartOf = (nowMs) => Math.floor(nowMs / MINUTE_WINDOW_MS) * MINUTE_WINDOW_MS;
  const msUntilNextWindow = (nowMs) => windowStartOf(nowMs) + MINUTE_WINDOW_MS - nowMs;

  // Fensterwechsel = frisches Kontingent. Reine Zustands-Synchronisation, keine Entscheidung.
  function syncWindow(nowMs) {
    const start = windowStartOf(nowMs);
    if (start === windowStartMs) return;
    windowStartMs = start;
    usedInWindow = 0;
  }

  // Ein Wartehinweis des Providers gilt hoechstens EIN Fenster: x-ratelimit-reset traegt die
  // Sekunden bis zur naechsten vollen Minute (gemessen 15 s im Normalbetrieb, 17 s beim 429).
  // Ein groesserer Wert waere Provider-Drift und hielte den Sweep unbegrenzt an.
  function waitMsFor(hintMs, nowMs) {
    if (hintMs === null || hintMs === undefined) return msUntilNextWindow(nowMs);
    return Math.min(Math.max(hintMs, 0), MINUTE_WINDOW_MS);
  }

  return {
    // Reserviert GENAU EINE Anfrage. Ist das Fensterbudget erschoepft, wird HOECHSTENS
    // EINMAL bis zur naechsten vollen Minute gewartet - danach ist das Fenster per
    // Konstruktion frisch. Bewusst KEINE Warteschleife: eine Uhr, die nicht laeuft, wuerde
    // sonst nie zurueckkehren.
    async reserveSlot() {
      syncWindow(now());
      if (usedInWindow >= budget) {
        await sleep(msUntilNextWindow(now()));
        syncWindow(now());
      }
      usedInWindow += 1;
    },

    // Nachlauf nach einer Kontingent-Ablehnung: warten, bis das Fenster zurueckgesetzt ist.
    // hintMs stammt aus dem Antwort-Header des Providers; fehlt er, rechnet die eigene Uhr
    // dieselbe Groesse. Kein Zustands-Schreiben noetig - die naechste Reservierung
    // synchronisiert das Fenster selbst.
    async waitForWindowReset(hintMs = null) {
      await sleep(waitMsFor(hintMs, now()));
    },
  };
}
