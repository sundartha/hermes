const ANBIETER_STOERUNG = {
  healthzMs: 2000,
  messungen: 5,
  messTaktMs: 500,
  anbieterAufrufFristMs: 10_000,
};

export const SCHWELLEN = Object.freeze({
  "elevenlabs-aus": Object.freeze({ ...ANBIETER_STOERUNG, antwortVerzugMs: 0 }),
  "elevenlabs-langsam": Object.freeze({ ...ANBIETER_STOERUNG, antwortVerzugMs: 1000 }),
});

export const ANFRAGE_FRIST_MS = 5000;
export const BEREIT_FRIST_MS = 30_000;
export const GESAMT_FRIST_MS = 110_000;
