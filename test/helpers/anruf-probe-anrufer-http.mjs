import { env } from "node:process";

import { anruferBauen } from "../../scripts/anruf-probe/anrufer.mjs";

const FALL = JSON.parse(env.PROBE_FALL);

const abfrage = async () => {
  if (FALL.wirft) throw new Error(FALL.wirft);
  return {
    ok: FALL.status === 200,
    status: FALL.status,
    text: async () => JSON.stringify(FALL.rpc),
  };
};

export const anrufer = anruferBauen({
  basis: env.STAGING_URL,
  token: env.STAGING_TEST_TOKEN,
  ziel: env.STAGING_PROBE_ZIEL,
  sprache: "de",
  auftraggeber: "Probe GmbH",
  vorname: "Anna",
  abfrage,
});

export const uhr = { jetzt: () => 0, warte: async () => {} };
