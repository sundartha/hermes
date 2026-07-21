// Sprung-Uhr fuer Tests der Telnyx-Drossel (KE-P4, src/telephony/adapters/telnyx/
// rate-limit.js): sleep() bewegt die Uhr synchron vorwaerts statt zu warten, sleeps()
// zeichnet jede angeforderte Wartedauer auf - keine Suite haengt an der Wanduhr
// (F.I.R.S.T.: Fast/Repeatable). Geteilte Quelle fuer test/telnyx-cost-throttle.test.js
// und test/telnyx-cost-records.test.js (vormals zwei byte-identische Kopien, G5).
//
// start akzeptiert wahlweise ms (Zahl) oder einen ISO-Zeitstempel (String) - welche Form
// als Default fuer die eigene Startzeit dient, bleibt Sache des jeweiligen Aufrufers.
export function jumpClock(start) {
  const startMs = typeof start === "string" ? Date.parse(start) : start;
  let nowMs = startMs;
  const sleeps = [];
  return {
    now: () => nowMs,
    sleep: async (ms) => {
      sleeps.push(ms);
      nowMs += ms;
    },
    sleeps,
    elapsedMs: () => nowMs - startMs,
  };
}
