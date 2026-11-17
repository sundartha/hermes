import assert from "node:assert/strict";
import { test } from "node:test";
import { baueElMitStore } from "../_iel-inbound-harness.js";
import { withFetch } from "../helpers.js";

const ANRUF = "call_abfrage_ohne_eintrag";
const MANDANT = "tenant_abfrage_ohne_eintrag";

const abwarten = () => new Promise((erfuellen) => setImmediate(erfuellen));

async function ohneAbbruch(store) {
  const el = baueElMitStore(store);
  let abfragen = 0;
  await withFetch(async () => {
    abfragen += 1;
    return { ok: true, status: 200, json: async () => ({}) };
  }, async () => {
    await el.pollFrist(ANRUF, MANDANT);
    await abwarten();
  });
  return abfragen;
}

test("Abfrage-Frist ohne Eintrag: findet die Frist keinen Anruf, wird nicht abgefragt, die Frist geleert und nichts geworfen", async () => {
  const geschrieben = [];
  const abfragen = await ohneAbbruch({
    leseCall: async () => null,
    setzeAbfrageFrist: async (frist) => {
      geschrieben.push(frist);
    },
  });
  assert.equal(abfragen, 0);
  assert.deepEqual(geschrieben, [{ callId: ANRUF, tenantId: MANDANT, faelligAt: null }]);
});

test("Abfrage-Frist ohne Eintrag: ein Speicher ohne Fristen-Schreiber loest beim Leeren der Frist keinen Fehler im Log aus", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  const abfragen = await ohneAbbruch({ leseCall: async () => ({ id: ANRUF, tenantId: MANDANT }) });
  assert.equal(abfragen, 0);
  assert.deepEqual(zeilen, []);
});
