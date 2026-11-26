import { env } from "node:process";

import { anruferBauen } from "../../scripts/anruf-probe/anrufer.mjs";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

let zeit = Date.parse("2026-11-26T07:00:00.000Z");

export const uhr = {
  jetzt: () => zeit,
  warte: async (ms) => {
    zeit += ms;
  },
};

export const anrufer = anruferBauen({
  basis: env.PROBE_LOKALE_BASIS,
  token: env.STAGING_PROBE_TOKEN,
  ziel: env.STAGING_PROBE_ZIEL,
  sprache: "de",
  auftraggeber: env.STAGING_PROBE_AUFTRAGGEBER,
  vorname: env.STAGING_PROBE_VORNAME,
  abfrage: abrufMitFrist,
  uhr,
});
