import assert from "node:assert/strict";
import test from "node:test";

import { LEITUNGSPLATZ_DB_FRIST_MS } from "../../src/begriffe/speicher.ts";
import { makePostgresLeitungsplaetze } from "../../src/store.js";

const CALL_ID = "call_eingehend_bleibt";
const BELEGEN = Object.freeze({ callId: CALL_ID, tenantId: "tenant_ebg", weg: "elevenlabs", maxDauerS: 60, hoechstzahlKunde: 2 });
const FREIGEBEN = "DELETE FROM leitungsplatz WHERE call_id = $1";

const weiter = () => new Promise((fertig) => setImmediate(fertig));

function runnerMitOffenemCommit() {
  const aufrufe = [];
  const zustand = { commitFertig: null };
  const client = {
    query(text, parameter) {
      aufrufe.push({ text, parameter });
      if (text === "COMMIT") return new Promise((fertig) => { zustand.commitFertig = fertig; });
      return Promise.resolve({ rows: [] });
    },
  };
  return { aufrufe, zustand, runner: { withClient: (arbeit) => arbeit(client) } };
}

async function spaeterCommit(t, aktion) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { runner, aufrufe, zustand } = runnerMitOffenemCommit();
  const lauf = makePostgresLeitungsplaetze(runner)[aktion](BELEGEN);
  while (!zustand.commitFertig) await weiter();
  t.mock.timers.tick(LEITUNGSPLATZ_DB_FRIST_MS);
  t.mock.method(console, "error", () => {});
  const antwort = await lauf;
  zustand.commitFertig({ rows: [] });
  await weiter();
  await weiter();
  return { antwort, loeschungen: aufrufe.filter((a) => a.text === FREIGEBEN) };
}

test("belegenEingehend: COMMIT nach der Frist loescht die Zeile des laufenden Anrufs nicht", async (t) => {
  const { loeschungen } = await spaeterCommit(t, "belegenEingehend");
  assert.deepEqual(loeschungen, []);
});

test("belegenAusgehend: COMMIT nach der Frist antwortet anbieter_voll und loescht genau die Zeile der callId", async (t) => {
  const { antwort, loeschungen } = await spaeterCommit(t, "belegenAusgehend");
  assert.deepEqual(antwort, { entscheidung: "anbieter_voll" });
  assert.deepEqual(loeschungen.map((a) => a.parameter), [[CALL_ID]]);
});
