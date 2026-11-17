import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";


const karte = JSON.parse(readFileSync(new URL("../../tools/bausteine.json", import.meta.url), "utf8"));

test("anruf-pruefung-importrichtung: anrufe importiert nichts mehr aus betrieb, der Bestand führt das Paar nicht mehr", () => {
  const paar = karte.altlast.find((eintrag) => eintrag.von === "anrufe" && eintrag.nach === "betrieb");
  assert.equal(paar, undefined);
});

test("anruf-pruefung-importrichtung: Prüfergebnisse bleiben gleich", async () => {
  const { invalidText, validateAssistantContext, validateMandate } = await import("../../src/begriffe/anruf-pruefung.ts");
  assert.equal(invalidText("objective", "x".repeat(501)), "objective ist zu lang (max. 500 Zeichen)");
  assert.equal(invalidText("objective", "x".repeat(500)), null);
  assert.equal(invalidText("objective", 5), "objective muss ein String sein");
  assert.deepEqual(validateAssistantContext({ summary: "a", fremd: 1 }), { value: { summary: "a" } });
  assert.deepEqual(validateAssistantContext("x"), { error: "context muss ein Objekt sein" });
  assert.deepEqual(validateMandate({ on_out_of_scope: "nein" }).error?.startsWith("mandate.on_out_of_scope muss einer von"), true);
  assert.deepEqual(validateMandate({ decide_freely: "ja" }), { value: { decide_freely: "ja" } });
});
