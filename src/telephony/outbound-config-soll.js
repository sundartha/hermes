// AUSNAHME (Blocker 7, Review Runde 2): makeElConfigRead() unten ist KEINE reine
// Projektion mehr - sie liefert eine Closure, die BEIM AUFRUF einen echten GET macht.
// Die Fabrik selbst bleibt aber deterministisch (kein Netz WAEHREND der Konstruktion,
// kein Date.now) - dieselbe Trennung wie bei jeder anderen injizierten Provider-Closure
// in diesem Repo (messaging()/voiceControl aus registry.js). Sie steht trotzdem HIER statt
// in einer dritten Datei, weil sie EXAKT dieselbe Duplizierung beseitigt (elRead stand
// EL-GET statt an der Telnyx-Soll-Projektion.
import { fetchPhoneNumber } from "../elevenlabs/convai.js";

// Blocker 7 (G5): die EINE Fabrik fuer die EL-Nummernabruf-Closure (Pruefung 1). Vorher
// kuenftige Aenderung (z.B. ein zweiter Header, ein anderer fetchImpl) haette an einer der
// beiden Stellen vergessen werden koennen, ohne dass ein Test es merkt.
export function makeElConfigRead(config) {
  return {
    fetchPhoneNumber: (phoneNumberId) =>
      fetchPhoneNumber({ fetchImpl: fetch, account: config.voice.elevenLabsOutbound, phoneNumberId }),
  };
}
