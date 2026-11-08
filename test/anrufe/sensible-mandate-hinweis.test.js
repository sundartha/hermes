import assert from "node:assert/strict";
import { test } from "node:test";

import { CONSULT_ON, legacySnapshot, stdioSnapshot } from "../mcp-draht-pfade.js";

const HINWEIS =
  "For contracts, loans, insurance, tenancy, employment or legal matters, let decide_freely cover appointment times only and do not set 'accept_best', so the agent agrees to no terms there.";
const PLACE_CALL = "place_call";
const EINMAL = 1;

const PROFILE = [
  ["stdio ohne Consult", () => stdioSnapshot({})],
  ["HTTP-MCP mit Consult", () => legacySnapshot(CONSULT_ON)],
];

function trefferIn(text) {
  return (text ?? "").split(HINWEIS).length - 1;
}

function einmalig(snapshot) {
  let werkzeuge;
  return async () => {
    werkzeuge ??= (await snapshot()).tools;
    return werkzeuge;
  };
}

for (const [profil, snapshot] of PROFILE) {
  const werkzeuge = einmalig(snapshot);

  test(`sensible Mandate (${profil}): die place_call-Beschreibung in tools/list nennt den Hinweis wörtlich genau einmal`, async () => {
    const placeCall = (await werkzeuge()).find((tool) => tool.name === PLACE_CALL);
    assert.ok(placeCall, `${PLACE_CALL} fehlt in tools/list`);
    assert.equal(trefferIn(placeCall.description), EINMAL);
  });

  test(`sensible Mandate (${profil}): kein anderes Werkzeug in tools/list nennt den Hinweis`, async () => {
    const andere = (await werkzeuge())
      .filter((tool) => tool.name !== PLACE_CALL && trefferIn(JSON.stringify(tool)) > 0)
      .map((tool) => tool.name);
    assert.deepEqual(andere, []);
  });
}
