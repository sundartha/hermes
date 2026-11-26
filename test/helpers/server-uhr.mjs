import { env } from "node:process";

const SPRUNG_SCHLUESSEL = "SERVER_UHR_SPRUNG_MS";
const SPRUNG_SIGNAL = "SIGUSR2";
const NACH_HOECHSTDAUER_MS = 1_900_000;
const ECHTE_UHR = Date;

function stelleServerUhrAuf(sprungMs) {
  let versatz = 0;
  class VorgestelltesDatum extends ECHTE_UHR {
    constructor(...eingabe) {
      super(...(eingabe.length === 0 ? [ECHTE_UHR.now() + versatz] : eingabe));
    }

    static now() {
      return ECHTE_UHR.now() + versatz;
    }
  }
  globalThis.Date = VorgestelltesDatum;
  process.on(SPRUNG_SIGNAL, () => {
    versatz += sprungMs;
  });
}

if (env[SPRUNG_SCHLUESSEL] !== undefined) stelleServerUhrAuf(Number(env[SPRUNG_SCHLUESSEL]));

export const serverUhrUmgebung = (sprungMs = NACH_HOECHSTDAUER_MS) => ({
  [SPRUNG_SCHLUESSEL]: String(sprungMs),
  NODE_OPTIONS: `--import=${import.meta.url}`,
});

export function stelleServerUhrVor(srv) {
  srv.child.kill(SPRUNG_SIGNAL);
}
