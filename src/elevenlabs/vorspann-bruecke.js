import { meldeVorspannAbgespielt, meldeVorspannMessung, meldeVorspannRueckfall } from "./vorspann-erzeugen.js";
import { VORSPANN_WAHL_GRUND } from "./vorspann-pruefung.js";

const WIEDERGABE_VOLLSTAENDIG = "completed";
export const STAND = Object.freeze({
  ABGEHOBEN: Symbol(),
  WIEDERGABE: Symbol(),
  EL_BEIN: Symbol(),
  BRUECKE: Symbol(),
  ABGEBROCHEN: Symbol(),
});

export const messeSeit = ({ callId, messung, bezug, stand, seit }) =>
  meldeVorspannMessung({ callId, messung, bezug, ms: Date.now() - stand.get(seit) });

export function makeVorspannBruecke({ voiceControl, store, ttsStore, legeBeideBeineAuf, vermerkeElFehler, logFehler }) {
  async function bruecke({ call, zustand }) {
    const { stand } = zustand;
    if (!stand.has(STAND.WIEDERGABE) || !stand.has(STAND.EL_BEIN) || stand.has(STAND.BRUECKE) || stand.has(STAND.ABGEBROCHEN)) return;
    if (call.status !== "active") return;
    stand.set(STAND.BRUECKE, Date.now());
    const steuerung = voiceControl(call.provider);
    try {
      await steuerung.bridge(zustand.calleeId, { zielId: call.elCallControlId });
    } catch (fehler) {
      logFehler("bruecke", call.id, fehler);
      vermerkeElFehler(call);
      return legeBeideBeineAuf({ call, zustand, steuerung });
    }
    messeSeit({ callId: call.id, messung: "bridge", bezug: "ms_seit_vorspann_ende", stand, seit: STAND.WIEDERGABE });
    const aufzeichnung = store.getCall(call.id);
    aufzeichnung.bridgedAt = new Date().toISOString();
    store.save();
  }

  async function beiElAngenommen({ call, zustand }) {
    if (zustand.stand.has(STAND.EL_BEIN)) return;
    zustand.stand.set(STAND.EL_BEIN, Date.now());
    messeSeit({ callId: call.id, messung: "el_angenommen", bezug: "ms_seit_abheben", stand: zustand.stand, seit: STAND.ABGEHOBEN });
    await bruecke({ call, zustand });
  }

  async function beiWiedergabeEnde({ call, zustand, ereignis }) {
    ttsStore.release(zustand.token);
    if (zustand.stand.has(STAND.ABGEBROCHEN)) return;
    if (ereignis.wiedergabeStatus !== WIEDERGABE_VOLLSTAENDIG) {
      logFehler("wiedergabe", call.id, new Error(`Status ${ereignis.wiedergabeStatus}`));
      meldeVorspannRueckfall({ callId: call.id, grund: VORSPANN_WAHL_GRUND.NICHT_ABGESPIELT });
      return legeBeideBeineAuf({ call, zustand, steuerung: voiceControl(call.provider) });
    }
    if (zustand.stand.has(STAND.WIEDERGABE)) return;
    zustand.stand.set(STAND.WIEDERGABE, Date.now());
    try {
      store.addTranscript(call.id, "agent", zustand.text);
    } catch (fehler) {
      logFehler("transkript", call.id, fehler);
      return legeBeideBeineAuf({ call, zustand, steuerung: voiceControl(call.provider) });
    }
    meldeVorspannAbgespielt(call.id);
    await bruecke({ call, zustand });
  }

  return { beiElAngenommen, beiWiedergabeEnde };
}
