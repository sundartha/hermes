import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir } from "../helpers.js";

let config;
let store;
before(async () => {
  process.env.DATA_DIR = tempDataDir();
  config = (await import("../../src/config.js")).config;
  store = await import("../../src/store.js");
});

const useAnchor = (anchorDay) => {
  config.billing.ttsQuotaCycleAnchorDay = anchorDay;
};

const CASES = [
  { name: "30.03. mit Anker 31 zaehlt im Februar-Zyklus", at: "2026-03-30T10:00:00.000Z", anchor: 31, key: "2026-02" },
  { name: "29.03. mit Anker 30 zaehlt im Februar-Zyklus", at: "2026-03-29T10:00:00.000Z", anchor: 30, key: "2026-02" },
  { name: "29.03. mit Anker 31 zaehlt im Februar-Zyklus", at: "2026-03-29T10:00:00.000Z", anchor: 31, key: "2026-02" },
  { name: "31.03. mit Anker 31 beginnt den Maerz-Zyklus", at: "2026-03-31T10:00:00.000Z", anchor: 31, key: "2026-03" },
  { name: "01.03. mit Anker 1 beginnt den Maerz-Zyklus", at: "2026-03-01T00:00:00.000Z", anchor: 1, key: "2026-03" },
  { name: "02.09. mit Anker 3 bleibt im August-Zyklus", at: "2026-09-02T00:00:00.000Z", anchor: 3, key: "2026-08" },
  { name: "30.03.2028 im Schaltjahr mit Anker 31 zaehlt im Februar-Zyklus", at: "2028-03-30T10:00:00.000Z", anchor: 31, key: "2028-02" },
];

for (const c of CASES) {
  test(c.name, () => {
    useAnchor(c.anchor);
    store.recordTtsCharacters(10, c.at);
    assert.equal(store.platformTtsUsageView(c.at).cycleKey, c.key);
  });
}

test("Zaehler beginnt nach dem Zyklus-Wechsel am Monatsende bei null", () => {
  useAnchor(31);
  store.recordTtsCharacters(100, "2031-02-28T10:00:00.000Z");
  assert.equal(store.platformTtsUsageView("2031-02-28T10:00:00.000Z").cycleKey, "2031-01");
  store.recordTtsCharacters(7, "2031-03-30T10:00:00.000Z");
  const view = store.platformTtsUsageView("2031-03-30T10:00:00.000Z");
  assert.equal(view.cycleKey, "2031-02");
  assert.equal(view.characters, 7);
  store.recordTtsCharacters(3, "2031-03-30T11:00:00.000Z");
  assert.equal(store.platformTtsUsageView("2031-03-30T11:00:00.000Z").characters, 10);
});
