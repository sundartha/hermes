import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const VORLAGE = "elevenlabs/agent_configs/outbound-agent.template.json";

function texteMitPfad(wert, pfad, treffer) {
  if (typeof wert === "string") {
    treffer.push([pfad, wert]);
  } else if (wert && typeof wert === "object") {
    for (const [k, v] of Object.entries(wert)) texteMitPfad(v, `${pfad}.${k}`, treffer);
  }
  return treffer;
}

test("Vorlage verweist nirgends auf die nicht mehr vorhandene src/elevenlabs/convai.js", () => {
  const vorlage = JSON.parse(readFileSync(VORLAGE, "utf8"));
  const alt = texteMitPfad(vorlage, "", []).filter(([, text]) => text.includes("src/elevenlabs/convai.js"));
  assert.deepEqual(alt.map(([pfad]) => pfad), []);
});

test("Hinweistexte nennen src/elevenlabs/convai.ts", () => {
  const vorlage = JSON.parse(readFileSync(VORLAGE, "utf8"));
  const neu = texteMitPfad(vorlage, "", []).filter(([, text]) => text.includes("src/elevenlabs/convai.ts"));
  assert.equal(neu.length, 3);
});
