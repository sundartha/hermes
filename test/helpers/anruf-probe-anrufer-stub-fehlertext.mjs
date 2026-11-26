import { env } from "node:process";

import { anruferBauen } from "../../scripts/anruf-probe/anrufer.mjs";

let zeit = Date.parse("2026-11-26T07:00:00.000Z");

export const uhr = {
  jetzt: () => zeit,
  warte: async (ms) => {
    zeit += ms;
  },
};

function antwort(name) {
  if (name === "get_agent_number") return { structuredContent: { number: env.STAGING_PROBE_ZIEL } };
  if (name === "list_calls") return { structuredContent: { calls: [] } };
  return { isError: true, content: [{ type: "text", text: env.PROBE_FEHLERTEXT }] };
}

const abfrage = async (_url, optionen) => {
  const { name } = JSON.parse(optionen.body).params;
  const rpc = { jsonrpc: "2.0", id: 1, result: antwort(name) };
  return { ok: true, status: 200, text: async () => JSON.stringify(rpc) };
};

export const anrufer = anruferBauen({
  basis: env.STAGING_URL,
  token: env.STAGING_PROBE_TOKEN,
  ziel: env.STAGING_PROBE_ZIEL,
  sprache: "de",
  auftraggeber: env.STAGING_PROBE_AUFTRAGGEBER,
  vorname: env.STAGING_PROBE_VORNAME,
  abfrage,
  uhr,
});
