import assert from "node:assert/strict";
import { before, test } from "node:test";

import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import { seedCall, seedState, tempDataDir } from "../helpers.js";

const FREMDER_MANDANT = "t_bericht_json_ohne_eintrag";

let bereiche;

before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }],
      calls: [
        seedCall({ id: "call_bericht_json_1" }),
        seedCall({ id: "call_bericht_json_2", tenantId: FREMDER_MANDANT }),
      ],
    }),
  );
  const store = await import("../../src/store.js");
  const { speicherBereiche } = store;
  await store.oeffneSpeicher();
  bereiche = speicherBereiche(store);
});

test("BERICHT-JSON: der Berichts-Leser liefert im JSON-Betrieb alle Anrufe, auch die eines Mandanten ohne Eintrag", async () => {
  const anrufe = await bereiche.berichtAnrufe.anrufeFuerBericht();
  assert.deepEqual(anrufe.map((anruf) => anruf.id).sort(), ["call_bericht_json_1", "call_bericht_json_2"]);
});

test("BERICHT-JSON: der Abgleich-Zustand enthaelt dieselben Anrufe", async () => {
  const zustand = await bereiche.kostenabgleich.abgleichZustand();
  assert.equal(zustand.calls.length, 2);
});
