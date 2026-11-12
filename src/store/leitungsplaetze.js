import { MS_PER_SECOND } from "../utils/timer.js";

export const ANBIETER = Object.freeze({ TELNYX: "telnyx", ELEVENLABS: "elevenlabs" });

export const LEITUNGSPLATZ_ENTSCHEIDUNG = Object.freeze({
  FREI: "frei",
  ANBIETER_VOLL: "anbieter_voll",
  KUNDE_VOLL: "kunde_voll",
});

export const RICHTUNG = Object.freeze({ AUSGEHEND: "ausgehend", EINGEHEND: "eingehend" });

export const AUSGEHEND_JE_KUNDE = 2;

const KAPAZITAET = Object.freeze({ [ANBIETER.TELNYX]: 100, [ANBIETER.ELEVENLABS]: 6 });
const RESERVE = Object.freeze({ [ANBIETER.TELNYX]: 10, [ANBIETER.ELEVENLABS]: 2 });
export const BEDARF = Object.freeze({
  [ANBIETER.TELNYX]: [ANBIETER.TELNYX],
  [ANBIETER.ELEVENLABS]: [ANBIETER.ELEVENLABS, ANBIETER.TELNYX],
});
const ABLAUF_PUFFER_S = 120;
const ELEVENLABS_ABLAUF_S = 600;

export const ablaufSekunden = (weg, maxDauerS) =>
  (weg === ANBIETER.ELEVENLABS ? ELEVENLABS_ABLAUF_S : maxDauerS) + ABLAUF_PUFFER_S;

export function entscheideAus(aktuell, { tenantId, weg, hoechstzahlKunde = Infinity }) {
  const laufendeAnrufe = new Set(
    aktuell
      .filter((zeile) => zeile.tenantId === tenantId && zeile.richtung === RICHTUNG.AUSGEHEND)
      .map((zeile) => zeile.callId),
  );
  if (laufendeAnrufe.size >= hoechstzahlKunde) return LEITUNGSPLATZ_ENTSCHEIDUNG.KUNDE_VOLL;
  const hatPlatz = (anbieter) => {
    const belegt = aktuell.filter((zeile) => zeile.anbieter === anbieter);
    const ausgehend = belegt.filter((zeile) => zeile.richtung === RICHTUNG.AUSGEHEND);
    return ausgehend.length + 1 <= KAPAZITAET[anbieter] - RESERVE[anbieter] && belegt.length + 1 <= KAPAZITAET[anbieter];
  };
  return BEDARF[weg].every(hatPlatz)
    ? LEITUNGSPLATZ_ENTSCHEIDUNG.FREI
    : LEITUNGSPLATZ_ENTSCHEIDUNG.ANBIETER_VOLL;
}

export const belegungAus = (zeilen) =>
  Object.values(ANBIETER).map((anbieter) => ({
    anbieter,
    belegt: zeilen.filter((zeile) => zeile.anbieter === anbieter).length,
    kapazitaet: KAPAZITAET[anbieter],
  }));

export function makeLeitungsplaetze({ jetztMs = Date.now } = {}) {
  const zeilen = new Map();

  const aktuelleZeilen = () => {
    const jetzt = jetztMs();
    for (const [schluessel, zeile] of zeilen) if (zeile.ablaufMs <= jetzt) zeilen.delete(schluessel);
    return [...zeilen.values()];
  };

  const entscheide = (anfrage) => entscheideAus(aktuelleZeilen(), anfrage);

  async function pruefenAusgehend(anfrage) {
    return entscheide(anfrage);
  }

  async function belegenAusgehend({ callId, tenantId, weg, maxDauerS, hoechstzahlKunde }) {
    const entscheidung = entscheide({ tenantId, weg, hoechstzahlKunde });
    if (entscheidung !== LEITUNGSPLATZ_ENTSCHEIDUNG.FREI) return { entscheidung };
    const ablaufMs = jetztMs() + ablaufSekunden(weg, maxDauerS) * MS_PER_SECOND;
    for (const anbieter of BEDARF[weg])
      zeilen.set(`${callId}|${anbieter}`, { anbieter, callId, tenantId, ablaufMs, richtung: RICHTUNG.AUSGEHEND });
    return { entscheidung };
  }

  async function belegenEingehend({ callId, tenantId, weg, maxDauerS }) {
    const ablaufMs = jetztMs() + ablaufSekunden(weg, maxDauerS) * MS_PER_SECOND;
    for (const anbieter of BEDARF[weg])
      zeilen.set(`${callId}|${anbieter}`, { anbieter, callId, tenantId, ablaufMs, richtung: RICHTUNG.EINGEHEND });
  }

  function freigeben(callId) {
    for (const [schluessel, zeile] of zeilen) if (zeile.callId === callId) zeilen.delete(schluessel);
  }

  async function belegung() {
    return belegungAus(aktuelleZeilen());
  }

  return { pruefenAusgehend, belegenAusgehend, belegenEingehend, freigeben, belegung };
}

export const leitungsplaetze = makeLeitungsplaetze();
