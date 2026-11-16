import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../../src/store.js";

const DREI = [{ id: "c1" }, { id: "c2" }, { id: "c3" }];

test("anrufeFuerZustand: gelesener Auszug wird mit der Anzahl der Anrufe abgefragt und auf das Limit gekuerzt", async () => {
  const aufrufe = [];
  const speicher = {
    exportTenantDataGelesen: async (...args) => {
      aufrufe.push(args);
      return { calls: DREI };
    },
  };
  const anrufe = await speicherBereiche(speicher).zustandAnrufe.anrufeFuerZustand("t_a", 2);
  assert.deepEqual(aufrufe, [["t_a", { anrufe: 2 }]]);
  assert.deepEqual(anrufe, [{ id: "c1" }, { id: "c2" }]);
});

test("anrufeFuerZustand: ohne gelesenen Auszug zaehlt der volle Export und wird auf das Limit gekuerzt", async () => {
  const aufrufe = [];
  const speicher = {
    exportTenantData: async (...args) => {
      aufrufe.push(args);
      return { calls: DREI };
    },
  };
  const anrufe = await speicherBereiche(speicher).zustandAnrufe.anrufeFuerZustand("t_a", 1);
  assert.deepEqual(aufrufe, [["t_a"]]);
  assert.deepEqual(anrufe, [{ id: "c1" }]);
});
