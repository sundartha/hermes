import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGEL = "hermes/eingabe-nur-mit-schema";
const DATEIEN = ["src/billing/webhook.js", "src/elevenlabs/inbound-initiation.js"];
const HANDPRUEFUNG = 'export const a = (wert) => typeof wert === "string";';
const eslint = new ESLint({ cwd: WURZEL });

const befunde = (ergebnisse) => ergebnisse.flatMap((e) => e.messages).filter((m) => m.ruleId === REGEL);

for (const datei of DATEIEN) {
  test(`Eingaberegel der echten Konfiguration meldet typeof auf der Nutzlast in ${datei}`, async () => {
    const ergebnisse = await eslint.lintText(HANDPRUEFUNG, { filePath: resolve(WURZEL, datei) });
    assert.equal(befunde(ergebnisse).length, 1);
  });
}

test("Eingaberegel der echten Konfiguration: Stripe- und ElevenLabs-Init-Webhook sind ohne Befund", async () => {
  const ergebnisse = await eslint.lintFiles(DATEIEN.map((datei) => resolve(WURZEL, datei)));
  assert.equal(ergebnisse.length, DATEIEN.length);
  assert.deepEqual(befunde(ergebnisse), []);
});
