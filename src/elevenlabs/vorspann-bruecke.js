import { EL_BRIDGE_START_DEADLINE_MS } from "./inbound-bridges.js";
import { INBOUND_EL_GRUND, vermerkeUebergabeGescheitert } from "./inbound-uebergabe-gescheitert.js";
import { defaultSetTimer } from "../utils/timer.js";
import { meldeVorspannAbgespielt, meldeVorspannMessung, meldeVorspannRueckfall } from "./vorspann-erzeugen.js";
import {
  VORSPANN_EL_GRUND,
  VORSPANN_WAHL_GRUND,
  VORSPANN_WIEDERGABE_FRIST_MS,
} from "./vorspann-pruefung.js";

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

export function makeVorspannBruecke({ voiceControl, store, ttsStore, inboundBridges, legeBeideBeineAuf, logFehler }) {
  async function bruecke({ call, zustand }) {
    const { stand } = zustand;
    if (!stand.has(STAND.WIEDERGABE) || !stand.has(STAND.EL_BEIN) || stand.has(STAND.BRUECKE)) return;
    if (stand.has(STAND.ABGEBROCHEN) || call.status !== "active") return;
    stand.set(STAND.BRUECKE, Date.now());
    const steuerung = voiceControl(call.provider);
    try {
      await steuerung.bridge(zustand.calleeId, { zielId: call.elCallControlId });
    } catch (fehler) {
      logFehler("bruecke", call.id, fehler);
      return legeBeideBeineAuf({ call, zustand, steuerung });
    }
    messeSeit({ callId: call.id, messung: "bridge", bezug: "ms_seit_vorspann_ende", stand, seit: STAND.WIEDERGABE });
    const aufzeichnung = store.getCall(call.id);
    aufzeichnung.bridgedAt = new Date().toISOString();
    store.save();
  }

  function vermerkeElGescheitert({ call, grund }) {
    meldeVorspannRueckfall({ callId: call.id, grund });
    const nowMs = Date.now();
    vermerkeUebergabeGescheitert(
      { callId: call.id, grund: INBOUND_EL_GRUND.EL_UEBERGABE_GESCHEITERT, nowMs },
      { store, inboundBridges },
    );
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
    if (ereignis.wiedergabeStatus !== WIEDERGABE_VOLLSTAENDIG) {
      logFehler("wiedergabe", call.id, new Error(`Status ${ereignis.wiedergabeStatus}`));
      meldeVorspannRueckfall({ callId: call.id, grund: VORSPANN_WAHL_GRUND.NICHT_ABGESPIELT });
      return legeBeideBeineAuf({ call, zustand, steuerung: voiceControl(call.provider) });
    }
    if (zustand.stand.has(STAND.ABGEBROCHEN) || zustand.stand.has(STAND.WIEDERGABE)) return;
    zustand.stand.set(STAND.WIEDERGABE, Date.now());
    store.addTranscript(call.id, "agent", zustand.text);
    meldeVorspannAbgespielt(call.id);
    await bruecke({ call, zustand });
  }

  const faellig = ({ call, zustand }, fehlt) =>
    call.status === "active" &&
    !zustand.stand.has(STAND.ABGEBROCHEN) &&
    !zustand.stand.has(STAND.BRUECKE) &&
    !zustand.stand.has(fehlt);

  function nachFrist({ call, zustand, fehlt, ms, handeln }) {
    const gescheitert = (fehler) => logFehler("frist", call.id, fehler);
    defaultSetTimer(() => {
      if (faellig({ call, zustand }, fehlt)) handeln().catch(gescheitert);
    }, ms);
  }

  function armiereFristen({ call, zustand }) {
    const steuerung = voiceControl(call.provider);
    nachFrist({
      call,
      zustand,
      fehlt: STAND.WIEDERGABE,
      ms: VORSPANN_WIEDERGABE_FRIST_MS,
      handeln: async () => {
        meldeVorspannRueckfall({ callId: call.id, grund: VORSPANN_WAHL_GRUND.NICHT_ABGESPIELT });
        await legeBeideBeineAuf({ call, zustand, steuerung });
      },
    });
    nachFrist({
      call,
      zustand,
      fehlt: STAND.EL_BEIN,
      ms: EL_BRIDGE_START_DEADLINE_MS,
      handeln: async () => {
        vermerkeElGescheitert({ call, grund: VORSPANN_EL_GRUND.FRIST });
        await legeBeideBeineAuf({ call, zustand, steuerung });
      },
    });
  }

  return { beiElAngenommen, beiWiedergabeEnde, armiereFristen, vermerkeElGescheitert };
}
