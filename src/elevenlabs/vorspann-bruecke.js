const WIEDERGABE_VOLLSTAENDIG = "completed";
const STAND = Object.freeze({ WIEDERGABE: Symbol(), EL_BEIN: Symbol(), BRUECKE: Symbol() });

export function makeVorspannBruecke({ voiceControl, store, ttsStore, legeBeideBeineAuf, logFehler }) {
  async function bruecke({ call, zustand }) {
    const { stand } = zustand;
    if (!stand.has(STAND.WIEDERGABE) || !stand.has(STAND.EL_BEIN) || stand.has(STAND.BRUECKE)) return;
    if (call.status !== "active") return;
    stand.add(STAND.BRUECKE);
    const steuerung = voiceControl(call.provider);
    try {
      await steuerung.bridge(zustand.calleeId, { zielId: call.elCallControlId });
    } catch (fehler) {
      logFehler("bruecke", call.id, fehler);
      return legeBeideBeineAuf({ call, zustand, steuerung });
    }
    const aufzeichnung = store.getCall(call.id);
    aufzeichnung.bridgedAt = new Date().toISOString();
    store.save();
  }

  async function beiElAngenommen({ call, zustand }) {
    zustand.stand.add(STAND.EL_BEIN);
    await bruecke({ call, zustand });
  }

  async function beiWiedergabeEnde({ call, zustand, ereignis }) {
    ttsStore.release(zustand.token);
    if (ereignis.wiedergabeStatus !== WIEDERGABE_VOLLSTAENDIG) {
      logFehler("wiedergabe", call.id, new Error(`Status ${ereignis.wiedergabeStatus}`));
      return legeBeideBeineAuf({ call, zustand, steuerung: voiceControl(call.provider) });
    }
    zustand.stand.add(STAND.WIEDERGABE);
    await bruecke({ call, zustand });
  }

  return { beiElAngenommen, beiWiedergabeEnde };
}
