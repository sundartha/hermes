import { test } from "node:test";
import assert from "node:assert/strict";
import { startServerExpectExit } from "../helpers.js";
import { config } from "../../src/config.ts";

test("Config-Wachter: unbekannter Key verweist auf src/config.ts", () => {
  assert.throws(() => config.safety.gibtEsNicht, /Gruppierung in src\/config\.ts pruefen\)\.$/);
});

test("Boot: Modell ohne Preis verweist auf MODEL_PRICE_SCHEDULES in src/config.ts", async () => {
  const { code, output } = await startServerExpectExit({ env: { CLAUDE_MODEL: "modell-ohne-preis" } });
  assert.equal(code, 1, output);
  assert.match(output, /MODEL_PRICE_SCHEDULES \(src\/config\.ts\), /);
  assert.doesNotMatch(output, /src\/config\.js/);
});
