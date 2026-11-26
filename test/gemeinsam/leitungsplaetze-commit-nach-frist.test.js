import assert from "node:assert/strict";
import test from "node:test";

import { LEITUNGSPLATZ_DB_FRIST_MS } from "../../src/begriffe/speicher.ts";
import { makePostgresLeitungsplaetze } from "../../src/store.js";

const CALL_ID = "call_commit_nach_frist";
const BELEGEN = Object.freeze({ callId: CALL_ID, tenantId: "tenant_cnf", weg: "elevenlabs", maxDauerS: 60, hoechstzahlKunde: 2 });
const FREIGEBEN = "DELETE FROM leitungsplatz WHERE call_id = $1";

const weiter = () => new Promise((fertig) => setImmediate(fertig));

function runnerMitOffenemCommit({ freigabeFehler = false } = {}) {
  const aufrufe = [];
  const zustand = { commitFertig: null };
  const client = {
    query(text, parameter) {
      aufrufe.push({ text, parameter });
      if (text === "COMMIT") return new Promise((fertig) => { zustand.commitFertig = fertig; });
      if (text === FREIGEBEN && freigabeFehler) return Promise.reject(new Error("Freigabe kaputt"));
      return Promise.resolve({ rows: [] });
    },
  };
  return { aufrufe, zustand, runner: { withClient: (arbeit) => arbeit(client) } };
}

async function bisCommitOffen(zustand) {
  while (!zustand.commitFertig) await weiter();
}

const freigaben = (aufrufe) => aufrufe.filter((a) => a.text === FREIGEBEN);

for (const [name, aktion] of [["belegenAusgehend", "belegenAusgehend"], ["belegenEingehend", "belegenEingehend"]]) {
  test(`${name}: COMMIT nach der Frist gibt nur ausgehend den Platz der callId wieder frei`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { runner, aufrufe, zustand } = runnerMitOffenemCommit();
    const lauf = makePostgresLeitungsplaetze(runner)[aktion](BELEGEN);
    await bisCommitOffen(zustand);
    t.mock.timers.tick(LEITUNGSPLATZ_DB_FRIST_MS);
    const antwort = await lauf;
    if (aktion === "belegenAusgehend") assert.deepEqual(antwort, { entscheidung: "anbieter_voll" });
    assert.equal(freigaben(aufrufe).length, 0);
    zustand.commitFertig({ rows: [] });
    await weiter();
    await weiter();
    assert.deepEqual(freigaben(aufrufe).map((a) => a.parameter), aktion === "belegenAusgehend" ? [[CALL_ID]] : []);
  });
}

test("COMMIT rechtzeitig: nichts wird freigegeben, Entscheidung frei", async () => {
  const { runner, aufrufe, zustand } = runnerMitOffenemCommit();
  const lauf = makePostgresLeitungsplaetze(runner).belegenAusgehend(BELEGEN);
  await bisCommitOffen(zustand);
  zustand.commitFertig({ rows: [] });
  assert.deepEqual(await lauf, { entscheidung: "frei" });
  await weiter();
  assert.equal(freigaben(aufrufe).length, 0);
});

test("Freigabe nach spaetem COMMIT scheitert: Antwort bleibt anbieter_voll, Fehler ohne Wurf protokolliert", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const protokoll = t.mock.method(console, "error", () => {});
  const { runner, aufrufe, zustand } = runnerMitOffenemCommit({ freigabeFehler: true });
  const lauf = makePostgresLeitungsplaetze(runner).belegenAusgehend(BELEGEN);
  await bisCommitOffen(zustand);
  t.mock.timers.tick(LEITUNGSPLATZ_DB_FRIST_MS);
  assert.deepEqual(await lauf, { entscheidung: "anbieter_voll" });
  zustand.commitFertig({ rows: [] });
  await weiter();
  await weiter();
  assert.equal(freigaben(aufrufe).length, 1);
  const meldungen = protokoll.mock.calls.map((c) => c.arguments.join(" "));
  assert.ok(meldungen.some((m) => m.includes("Freigabe kaputt") && m.includes("[leitungsplaetze]")));
});
