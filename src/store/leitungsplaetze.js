import { ANRUFSTART_WARTEFRIST_MAX_MS } from "../begriffe/anrufe.js";
import { MS_PER_SECOND } from "../utils/timer.ts";

export const ANBIETER = Object.freeze({ TELNYX: "telnyx", ELEVENLABS: "elevenlabs" });

export const LEITUNGSPLATZ_ENTSCHEIDUNG = Object.freeze({
  FREI: "frei",
  ANBIETER_VOLL: "anbieter_voll",
  KUNDE_VOLL: "kunde_voll",
});

export const RICHTUNG = Object.freeze({ AUSGEHEND: "ausgehend", EINGEHEND: "eingehend", WARTEND: "wartend" });

export const AUSGEHEND_JE_KUNDE = 2;
export const WARTENDE_JE_KUNDE = 2;
export const WARTENDE_GESAMT = 10;
export const WARTE_ANBIETER = "warteschlange";
const WARTE_PUFFER_S = 30;
export const WARTE_ABLAUF_S = ANRUFSTART_WARTEFRIST_MAX_MS / MS_PER_SECOND + WARTE_PUFFER_S;

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

export function entscheideWartendeAus(aktuell, { tenantId }) {
  const wartende = new Map(
    aktuell.filter((zeile) => zeile.richtung === RICHTUNG.WARTEND).map((zeile) => [zeile.callId, zeile.tenantId]),
  );
  const vomKunden = [...wartende.values()].filter((kunde) => kunde === tenantId).length;
  if (vomKunden >= WARTENDE_JE_KUNDE) return LEITUNGSPLATZ_ENTSCHEIDUNG.KUNDE_VOLL;
  return wartende.size >= WARTENDE_GESAMT ? LEITUNGSPLATZ_ENTSCHEIDUNG.ANBIETER_VOLL : LEITUNGSPLATZ_ENTSCHEIDUNG.FREI;
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

  async function belegenWartend({ callId, tenantId }) {
    const entscheidung = entscheideWartendeAus(aktuelleZeilen(), { tenantId });
    if (entscheidung !== LEITUNGSPLATZ_ENTSCHEIDUNG.FREI) return entscheidung;
    const ablaufMs = jetztMs() + WARTE_ABLAUF_S * MS_PER_SECOND;
    zeilen.set(`${callId}|${WARTE_ANBIETER}`, { anbieter: WARTE_ANBIETER, callId, tenantId, ablaufMs, richtung: RICHTUNG.WARTEND });
    return entscheidung;
  }

  async function belegenAusgehend({ callId, tenantId, weg, maxDauerS, hoechstzahlKunde }) {
    const entscheidung = entscheide({ tenantId, weg, hoechstzahlKunde });
    if (entscheidung !== LEITUNGSPLATZ_ENTSCHEIDUNG.FREI) return { entscheidung };
    zeilen.delete(`${callId}|${WARTE_ANBIETER}`);
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

  async function belegteAnrufe(callIds) {
    const gesucht = new Set(callIds);
    return new Set(
      aktuelleZeilen()
        .filter((zeile) => zeile.richtung !== RICHTUNG.WARTEND)
        .map((zeile) => zeile.callId)
        .filter((callId) => gesucht.has(callId)),
    );
  }

  return { pruefenAusgehend, belegenAusgehend, belegenWartend, belegenEingehend, freigeben, belegung, belegteAnrufe };
}

export const leitungsplaetze = makeLeitungsplaetze();
