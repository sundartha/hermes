import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";

const WURZEL = resolve(import.meta.dirname, "../..");

function betroffen(datei) {
  return JSON.parse(execFileSync("node", ["tools/pruefen.mjs", "betroffen", datei], { cwd: WURZEL, encoding: "utf8" }));
}

test("betroffen nennt zu einer Widget-Datei die Tests, die sie über den gemeinsamen Lader laden", () => {
  const { alle } = betroffen("src/ui/widgets/call.html");
  assert.ok(alle.includes("test/gemeinsam/widget-anruffolge-last.test.js"), alle.join("\n"));
  assert.ok(alle.includes("test/gemeinsam/widget-anruffolge-ladezeit.test.js"), alle.join("\n"));
});
