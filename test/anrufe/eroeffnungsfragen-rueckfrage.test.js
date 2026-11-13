import assert from "node:assert/strict";
import { test } from "node:test";

import { mcpPost, startServer, toolCall } from "../helpers.js";

const ZIEL = "+4915112345678";
const OFFENE_FRAGEN = Object.freeze(["Welche Uhrzeit passt genau?", "Darf es auch Freitag sein?"]);
const ENV = Object.freeze({
  ASSISTANT_CONTEXT_ENABLED: "true",
  FAKE_ORIGINATE: "true",
  ALLOWED_COUNTRY_CODES: "*",
});

async function rufeMitFragen(env) {
  const srv = await startServer({ env });
  try {
    const antwort = await mcpPost(
      `${srv.localUrl}/mcp`,
      null,
      toolCall("place_call", {
        to: ZIEL,
        objective: "Haarschnitt fuer Samstag buchen",
        context: { open_questions: OFFENE_FRAGEN },
      }),
    );
    await antwort.text();
    return srv.readStore().calls.find((call) => call.to === ZIEL);
  } finally {
    await srv.stop();
  }
}

test("Eroeffnungsfragen: offene Fragen im Kontext eines Anrufs werden als offene Rueckfrage angelegt", async () => {
  const call = await rufeMitFragen({ ...ENV, CONSULT_ENABLED: "true" });
  assert.ok(call, "Vorbedingung: Anruf angelegt");
  assert.equal(call.consults.length, 1);
  assert.deepEqual(call.consults[0].questions, OFFENE_FRAGEN);
  assert.equal(call.consults[0].status, "open");
});

test("Eroeffnungsfragen: ohne freigegebenen Rueckfrage-Kanal wird keine Rueckfrage angelegt", async () => {
  const call = await rufeMitFragen({ ...ENV, CONSULT_ENABLED: "false" });
  assert.ok(call, "Vorbedingung: Anruf angelegt");
  assert.equal(call.consults ?? undefined, undefined);
});
