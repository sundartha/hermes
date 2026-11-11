import { test } from "node:test";
import assert from "node:assert/strict";
import { healBootstrapStore } from "../src/boot.js";
import { BOOTSTRAP_HEAL } from "../src/boot-guard.js";

const CONFIG = Object.freeze({
  provisioning: { bootstrapE164: "+15005550006", bootstrapProvider: "telnyx" },
});

function speicherNachHeilungDerAnderen(ergebnis) {
  const aufrufe = { nachgeladen: 0 };
  const store = {
    load: () => ({ numbers: [], tenants: [], calls: [] }),
    mitStartSperre: async () => ({ uebersprungen: false, ergebnis }),
    nummernVorhanden: async () => true,
    zustandNachladen: async () => {
      aufrufe.nachgeladen += 1;
    },
  };
  return { store, aufrufe };
}

test("Sperre frei, Nummer aber schon von der anderen Instanz angelegt: der Speicher wird neu geladen", async () => {
  const { store, aufrufe } = speicherNachHeilungDerAnderen(false);
  const entscheidung = await healBootstrapStore({ config: CONFIG, store, messaging: null });
  assert.equal(entscheidung, BOOTSTRAP_HEAL.NOT_NEEDED);
  assert.equal(aufrufe.nachgeladen, 1);
});
