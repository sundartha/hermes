import { meldeVorspannAbgespielt, meldeVorspannMessung, meldeVorspannRueckfall, statusUrsache } from "./vorspann-erzeugen.js";
import { VORSPANN_WAHL_GRUND } from "./vorspann-pruefung.js";

const WIEDERGABE_VOLLSTAENDIG = "completed";
export const STAND = Object.freeze({
  ABGEHOBEN: Symbol(),
  WIEDERGABE: Symbol(),
  EL_BEIN: Symbol(),
  BRUECKE: Symbol(),
  ABGEBROCHEN: Symbol(),
});

const STAND_NAMEN = new Map(Object.entries(STAND).map(([name, marke]) => [marke, name]));

export const standNachObjekt = (stand) => Object.fromEntries([...stand].map(([marke, ms]) => [STAND_NAMEN.get(marke), ms]));
export const standAusObjekt = (objekt) => new Map(Object.entries(objekt).map(([name, ms]) => [STAND[name], ms]));

export const messeSeit = ({ callId, messung, bezug, stand, seit, jetzt }) =>
  meldeVorspannMessung({ callId, messung, bezug, ms: jetzt - stand.get(seit) });

export function makeVorspannBruecke({ voiceControl, store, ttsStore, legeBeideBeineAuf, vermerkeElFehler, vermerkeNichtAbgespielt, logFehler, now }) {
  async function bruecke({ call, zustand }) {
    const { stand } = zustand;
    if (!stand.has(STAND.WIEDERGABE) || !stand.has(STAND.EL_BEIN) || stand.has(STAND.BRUECKE) || stand.has(STAND.ABGEBROCHEN)) return;
    if (call.status !== "active") return;
    stand.set(STAND.BRUECKE, now());
    const steuerung = voiceControl(call.provider);
    try {
      await steuerung.bridge(zustand.calleeId, { zielId: call.elCallControlId });
    } catch (fehler) {
      logFehler("bruecke", call.id, fehler);
      await vermerkeElFehler(call);
      return legeBeideBeineAuf({ call, zustand, steuerung });
    }
    messeSeit({ callId: call.id, messung: "bridge", bezug: "ms_seit_vorspann_ende", stand, seit: STAND.WIEDERGABE, jetzt: now() });
    const aufzeichnung = await store.leseCall(call.id);
    aufzeichnung.bridgedAt = new Date(now()).toISOString();
    store.save();
  }

  async function beiElAngenommen({ call, zustand }) {
    if (zustand.stand.has(STAND.EL_BEIN)) return;
    zustand.stand.set(STAND.EL_BEIN, now());
    messeSeit({ callId: call.id, messung: "el_angenommen", bezug: "ms_seit_abheben", stand: zustand.stand, seit: STAND.ABGEHOBEN, jetzt: now() });
    await bruecke({ call, zustand });
  }

  async function beiWiedergabeEnde({ call, zustand, ereignis }) {
    ttsStore.release(zustand.token);
    if (zustand.stand.has(STAND.ABGEBROCHEN)) return;
    if (ereignis.wiedergabeStatus !== WIEDERGABE_VOLLSTAENDIG) {
      logFehler("wiedergabe", call.id, new Error(`Status ${ereignis.wiedergabeStatus}`));
      meldeVorspannRueckfall({ callId: call.id, grund: VORSPANN_WAHL_GRUND.NICHT_ABGESPIELT, ursache: statusUrsache(ereignis.wiedergabeStatus) });
      vermerkeNichtAbgespielt(call);
      return legeBeideBeineAuf({ call, zustand, steuerung: voiceControl(call.provider) });
    }
    if (zustand.stand.has(STAND.WIEDERGABE)) return;
    zustand.stand.set(STAND.WIEDERGABE, now());
    try {
      await store.addTranscript(call.id, "agent", zustand.text);
    } catch (fehler) {
      logFehler("transkript", call.id, fehler);
      return legeBeideBeineAuf({ call, zustand, steuerung: voiceControl(call.provider) });
    }
    meldeVorspannAbgespielt(call.id);
    await bruecke({ call, zustand });
  }

  return { beiElAngenommen, beiWiedergabeEnde };
}
