const ANBIETER_STOERUNG = {
  healthzMs: 2000,
  messungen: 5,
  messTaktMs: 500,
  anbieterAufrufFristMs: 10_000,
};

export const SCHWELLEN = Object.freeze({
  "elevenlabs-aus": Object.freeze({ ...ANBIETER_STOERUNG, antwortVerzugMs: 0 }),
  "elevenlabs-langsam": Object.freeze({ ...ANBIETER_STOERUNG, antwortVerzugMs: 1000 }),
  "postgres-neustart": Object.freeze({
    abweisenMs: 10_000,
    wiederBereitMs: 30_000,
    messTaktMs: 500,
  }),
  "instanz-tod": Object.freeze({ healthzMs: 2000, haltenMs: 10_000, messTaktMs: 500 }),
  "deploy-bei-anruf": Object.freeze({
    beendetMs: 8000,
    anfrageFristMs: 10_000,
    anbieterHaltenMs: 60_000,
    messTaktMs: 200,
  }),
});

export const ANFRAGE_FRIST_MS = 5000;
export const BEREIT_FRIST_MS = 90_000;
export const AUFRAEUM_RESERVE_MS = 20_000;

const KINDER = {
  "elevenlabs-aus": 1,
  "elevenlabs-langsam": 1,
  "postgres-neustart": 1,
  "instanz-tod": 2,
  "deploy-bei-anruf": 1,
};

const LAUFZEIT_NACH_BEREIT_MS = {
  "elevenlabs-aus": (s) => s.messungen * (s.messTaktMs + s.anbieterAufrufFristMs),
  "elevenlabs-langsam": (s) => s.messungen * (s.messTaktMs + s.anbieterAufrufFristMs),
  "postgres-neustart": (s) => s.abweisenMs + s.wiederBereitMs,
  "instanz-tod": (s) => s.haltenMs + s.healthzMs,
  "deploy-bei-anruf": (s) => s.beendetMs + s.anfrageFristMs + s.anbieterHaltenMs,
};

export function gesamtFristMs(probe) {
  return (
    KINDER[probe] * BEREIT_FRIST_MS +
    LAUFZEIT_NACH_BEREIT_MS[probe](SCHWELLEN[probe]) +
    AUFRAEUM_RESERVE_MS
  );
}
