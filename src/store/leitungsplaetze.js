import { MS_PER_SECOND } from "../utils/timer.js";

export const ANBIETER = Object.freeze({ TELNYX: "telnyx", ELEVENLABS: "elevenlabs" });

export const LEITUNGSPLATZ_ENTSCHEIDUNG = Object.freeze({
  FREI: "frei",
  ANBIETER_VOLL: "anbieter_voll",
});

const KAPAZITAET = Object.freeze({ [ANBIETER.TELNYX]: 100, [ANBIETER.ELEVENLABS]: 6 });
const RESERVE = Object.freeze({ [ANBIETER.TELNYX]: 10, [ANBIETER.ELEVENLABS]: 2 });
const BEDARF_AUSGEHEND = Object.freeze({
  [ANBIETER.TELNYX]: [ANBIETER.TELNYX],
  [ANBIETER.ELEVENLABS]: [ANBIETER.ELEVENLABS, ANBIETER.TELNYX],
});
const ABLAUF_PUFFER_S = 120;
const ELEVENLABS_ABLAUF_S = 600;

const ablaufSekunden = (weg, maxDauerS) =>
  (weg === ANBIETER.ELEVENLABS ? ELEVENLABS_ABLAUF_S : maxDauerS) + ABLAUF_PUFFER_S;

export function makeLeitungsplaetze({ jetztMs = Date.now } = {}) {
  const zeilen = new Map();

  const belegtBei = (anbieter) => {
    const jetzt = jetztMs();
    let belegt = 0;
    for (const [schluessel, zeile] of zeilen)
      if (zeile.ablaufMs <= jetzt) zeilen.delete(schluessel);
      else if (zeile.anbieter === anbieter) belegt += 1;
    return belegt;
  };

  const hatPlatz = (anbieter) => belegtBei(anbieter) + 1 <= KAPAZITAET[anbieter] - RESERVE[anbieter];

  async function belegenAusgehend({ callId, weg, maxDauerS }) {
    const bedarf = BEDARF_AUSGEHEND[weg];
    if (!bedarf.every(hatPlatz)) return { entscheidung: LEITUNGSPLATZ_ENTSCHEIDUNG.ANBIETER_VOLL };
    const ablaufMs = jetztMs() + ablaufSekunden(weg, maxDauerS) * MS_PER_SECOND;
    for (const anbieter of bedarf) zeilen.set(`${callId}|${anbieter}`, { anbieter, callId, ablaufMs });
    return { entscheidung: LEITUNGSPLATZ_ENTSCHEIDUNG.FREI };
  }

  function freigeben(callId) {
    for (const [schluessel, zeile] of zeilen) if (zeile.callId === callId) zeilen.delete(schluessel);
  }

  return { belegenAusgehend, freigeben };
}

export const leitungsplaetze = makeLeitungsplaetze();
