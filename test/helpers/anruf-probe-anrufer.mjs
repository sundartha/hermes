import { env } from "node:process";

const FALL = JSON.parse(env.PROBE_FALL);
let versuche = 0;
let zeit = Date.parse("2026-11-17T10:00:00.000Z");

function zeile(text) {
  process.stdout.write(`${text}\n`);
}

export const anrufer = {
  eigeneNummer: async () => FALL.eigeneNummer,
  tagesstand: async () => {
    if (FALL.stand === "unklar") throw new Error("nicht lesbar");
    return FALL.stand;
  },
  anrufen: async () => {
    const messung = FALL.messungen[Math.min(versuche, FALL.messungen.length - 1)];
    versuche += 1;
    zeile(`ANRUF ${versuche}`);
    return messung;
  },
};

export const uhr = {
  jetzt: () => zeit,
  warte: async (ms) => {
    zeit += ms;
    zeile(`WARTE ${ms}`);
  },
};

anrufer.offeneBeenden = async () => {
  zeile("AUFGELEGT");
  return FALL.offene ?? 0;
};

if (FALL.eigeneNummerFehler) {
  anrufer.eigeneNummer = async () => {
    throw new Error("get_agent_number gescheitert");
  };
}
