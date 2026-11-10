import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDefaultState, recordTtsCharacters, platformTtsUsageView } from "../../src/store/state-ops.js";

const cfgFor = (anchorDay) => ({
  ttsCharacterQuota: 1000,
  ttsCharacterQuotaWarnPercent: 75,
  ttsQuotaCycleAnchorDay: anchorDay,
});

const CASES = [
  { name: "30.03. mit Anker 31 zaehlt im Februar-Zyklus", at: "2026-03-30T10:00:00.000Z", anchor: 31, key: "2026-02" },
  { name: "29.03. mit Anker 30 zaehlt im Februar-Zyklus", at: "2026-03-29T10:00:00.000Z", anchor: 30, key: "2026-02" },
  { name: "29.03. mit Anker 31 zaehlt im Februar-Zyklus", at: "2026-03-29T10:00:00.000Z", anchor: 31, key: "2026-02" },
  { name: "30.03.2028 im Schaltjahr mit Anker 31 zaehlt im Februar-Zyklus", at: "2028-03-30T10:00:00.000Z", anchor: 31, key: "2028-02" },
  { name: "31.03. mit Anker 31 beginnt den Maerz-Zyklus", at: "2026-03-31T10:00:00.000Z", anchor: 31, key: "2026-03" },
  { name: "01.03. mit Anker 1 beginnt den Maerz-Zyklus", at: "2026-03-01T00:00:00.000Z", anchor: 1, key: "2026-03" },
  { name: "02.09. mit Anker 3 bleibt im August-Zyklus", at: "2026-09-02T00:00:00.000Z", anchor: 3, key: "2026-08" },
];

for (const c of CASES) {
  test(c.name, () => {
    const s = makeDefaultState();
    recordTtsCharacters(s, 10, cfgFor(c.anchor), c.at);
    assert.equal(platformTtsUsageView(s, cfgFor(c.anchor), c.at).cycleKey, c.key);
  });
}

test("Zaehler beginnt nach dem Zyklus-Wechsel am Monatsende bei null", () => {
  const s = makeDefaultState();
  const cfg = cfgFor(31);
  recordTtsCharacters(s, 100, cfg, "2026-02-28T10:00:00.000Z");
  assert.equal(platformTtsUsageView(s, cfg, "2026-02-28T10:00:00.000Z").cycleKey, "2026-01");
  recordTtsCharacters(s, 7, cfg, "2026-03-30T10:00:00.000Z");
  const view = platformTtsUsageView(s, cfg, "2026-03-30T10:00:00.000Z");
  assert.equal(view.cycleKey, "2026-02");
  assert.equal(view.characters, 7);
  recordTtsCharacters(s, 3, cfg, "2026-03-30T11:00:00.000Z");
  assert.equal(platformTtsUsageView(s, cfg, "2026-03-30T11:00:00.000Z").characters, 10);
});
