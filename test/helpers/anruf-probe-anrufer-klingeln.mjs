import { env } from "node:process";

const FALL = JSON.parse(env.PROBE_FALL);

export const anrufer = {
  eigeneNummer: async () => FALL.eigeneNummer,
  tagesstand: async () => FALL.stand,
  anrufen: async () => FALL.messung,
  klingelnSekunden: async () => {
    if (FALL.klingeln === "fehler") throw new Error("nicht lesbar");
    return FALL.klingeln;
  },
  ...(FALL.mitStimmen ? { stimmenAnzahl: async () => 1 } : {}),
  offeneBeenden: async () => 0,
};

export const uhr = { jetzt: () => Date.parse("2026-11-22T10:00:00.000Z"), warte: async () => {} };
