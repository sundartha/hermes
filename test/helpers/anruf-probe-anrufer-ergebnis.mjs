import { env } from "node:process";

const FALL = JSON.parse(env.PROBE_FALL);
let versuche = 0;
let zeit = Date.parse("2026-11-17T10:00:00.000Z");

function zeile(text) {
  process.stdout.write(`${text}\n`);
}

export const anrufer = {
  eigeneNummer: async () => FALL.eigeneNummer,
  tagesstand: async () => FALL.stand,
  anrufen: async () => {
    versuche += 1;
    zeile(`ANRUF ${versuche}`);
    return FALL.messungen[Math.min(versuche - 1, FALL.messungen.length - 1)];
  },
  stimmenAnzahl: async () => {
    zeile(`STIMMEN ${versuche}`);
    const wert = FALL.stimmen[Math.min(versuche - 1, FALL.stimmen.length - 1)];
    if (wert === "fehler") throw new Error("nicht lesbar");
    return wert;
  },
  ergebnisVorgetragen: async () => {
    zeile(`ERGEBNIS ${versuche}`);
    const wert = FALL.ergebnisse[Math.min(versuche - 1, FALL.ergebnisse.length - 1)];
    if (wert === "fehler") throw new Error("nicht lesbar");
    return wert;
  },
  offeneBeenden: async () => 0,
};

export const uhr = {
  jetzt: () => zeit,
  warte: async (ms) => {
    zeit += ms;
    zeile(`WARTE ${ms}`);
  },
};
