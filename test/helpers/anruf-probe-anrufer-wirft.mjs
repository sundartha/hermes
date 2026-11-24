import { env } from "node:process";

const FALL = JSON.parse(env.PROBE_FALL);
let zeit = Date.parse("2026-11-17T10:00:00.000Z");

export const anrufer = {
  eigeneNummer: async () => FALL.eigeneNummer,
  tagesstand: async () => FALL.stand,
  anrufen: async () => {
    throw new Error(FALL.fehler);
  },
  offeneBeenden: async () => 0,
};

export const uhr = {
  jetzt: () => zeit,
  warte: async (ms) => {
    zeit += ms;
  },
};
