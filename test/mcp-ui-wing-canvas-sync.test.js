// H2: Byte-Gleichheit der Wing-Canvas-Engine zwischen Authoring-Quelle
// (design-system) und Laufzeit-Kopie (src/ui) - Muster wie
// mcp-ui-p5-token-sync.test.js/mcp-ui-wing-static.test.js (WING_PNG). Kein
// automatischer Sync-Mechanismus (siehe Kopf-Kommentar beider Dateien) -
// dieser Test ist das Drift-Gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dsPath = fileURLToPath(new URL("../design-system/components/brand/wing-canvas-engine.js", import.meta.url));
const srcPath = fileURLToPath(new URL("../src/ui/wing-canvas-engine.js", import.meta.url));

test("T-wing-canvas-sync: design-system-Quelle und src/ui-Kopie sind byte-identisch", () => {
  assert.equal(
    readFileSync(srcPath, "utf8"),
    readFileSync(dsPath, "utf8"),
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
