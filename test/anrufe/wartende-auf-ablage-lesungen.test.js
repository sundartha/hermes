import assert from "node:assert/strict";
import { test } from "node:test";

import { beschreibeSitzungen, wartendeBisLesungen } from "./wartende-auf-ablage.js";

const ZEILE = { pid: 7, wartet_ms: 1 };
const LESUNGEN_BIS_TREFFER = 4;
const LESUNGEN_GESAMT = 100;
const ZEIT_PRO_LESUNG_MS = 2_000;

function attrappe(trefferBei) {
  const stand = { lesungen: 0, uhrMs: 0 };
  const sql = async () => {
    stand.lesungen += 1;
    stand.uhrMs += ZEIT_PRO_LESUNG_MS;
    return { rows: stand.lesungen >= trefferBei ? [ZEILE] : [] };
  };
  return { stand, sql };
}

const ohnePause = async () => undefined;

test("WARTENDE-LESUNGEN: die vierte Lesung liefert die Zeile, auch wenn die Uhr über fünf Sekunden steht", async () => {
  const { stand, sql } = attrappe(LESUNGEN_BIS_TREFFER);
  const zeilen = await wartendeBisLesungen(sql, ohnePause);
  assert.deepEqual(zeilen, [ZEILE]);
  assert.equal(stand.lesungen, LESUNGEN_BIS_TREFFER);
  assert.ok(stand.uhrMs > 5_000);
});

test("WARTENDE-LESUNGEN: ohne Wartende endet die Suche nach genau 100 Lesungen", async () => {
  const { stand, sql } = attrappe(Infinity);
  assert.deepEqual(await wartendeBisLesungen(sql, ohnePause), []);
  assert.equal(stand.lesungen, LESUNGEN_GESAMT);
});

test("WARTENDE-LESUNGEN: die Beschreibung nennt pid, state, wait_event_type und 80 Zeichen der Abfrage", () => {
  const text = beschreibeSitzungen([{ pid: 12, state: "active", wait_event_type: "Lock", query: "x".repeat(200) }]);
  assert.equal(text, `pid=12 state=active wait_event_type=Lock query=${"x".repeat(80)}`);
});
