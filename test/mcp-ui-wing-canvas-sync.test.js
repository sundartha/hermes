import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ausgelieferteWidgets, skriptbloecke } from "./gemeinsam/ausgelieferte-widgets.js";

const dsPath = fileURLToPath(new URL("../design-system/components/brand/wing-canvas-engine.js", import.meta.url));

test("T-wing-canvas-sync: design-system-Quelle und src/ui-Kopie sind byte-identisch", async () => {
  const engine = readFileSync(dsPath, "utf8");
  const widgets = Object.entries(await ausgelieferteWidgets());
  assert.ok(widgets.length > 0, "keine ausgelieferten Widgets gefunden");
  assert.deepEqual(
    widgets.filter(([, html]) => !skriptbloecke(html).includes(engine)).map(([widget]) => widget),
    [],
    "wing-canvas-engine.js ist an beiden Orten auseinandergelaufen - beide Dateien synchron pflegen",
  );
});

test("T-wing-canvas-no-network: keine http(s)-URLs/@import in der Engine", () => {
  const ds = readFileSync(dsPath, "utf8");
  assert.doesNotMatch(ds, /https?:\/\//, "kein http(s)://");
  assert.doesNotMatch(ds, /@import/, "kein @import");
});

test("T-wing-canvas-size: Engine-Datei bleibt unter dem 25KB-Budget", () => {
  const bytes = readFileSync(dsPath).length;
  assert.ok(bytes <= 25 * 1024, `Engine ist ${bytes} Bytes, Budget 25KB`);
});
