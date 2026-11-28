import assert from "node:assert/strict";
import { test } from "node:test";

import { stdioSnapshot } from "../mcp-draht-pfade.js";

async function sprachBeschreibung() {
  const { tools } = await stdioSnapshot({});
  const platzieren = tools.find((tool) => tool.name === "place_call");
  const felder = platzieren.inputSchema.properties;
  return felder.language.description;
}

test("place_call language: die Beschreibung sagt, dass die gewählte Sprache auch die Offenlegung bestimmt, ohne eigenen Text Englisch", async () => {
  const text = await sprachBeschreibung();
  assert.match(
    text,
    /The chosen language also sets the language of the mandatory AI disclosure; if it has no disclosure text of its own, the disclosure is spoken in English\.$/,
  );
});

test("place_call language: die alte Aussage, die Offenlegung folge immer dem Angerufenen, ist weg", async () => {
  const text = await sprachBeschreibung();
  assert.doesNotMatch(text, /does NOT change/);
  assert.doesNotMatch(text, /always follows the person being called/);
});

test("place_call language: Startsprache, Standard de, Wechsel und Ablehnung bleiben beschrieben", async () => {
  const text = await sprachBeschreibung();
  assert.ok(
    text.startsWith(
      "The language the agent SPEAKS in this call - any language code, e.g. es or pt-br. Start language, default de; set it first if the person called speaks another. The agent may switch during the call, to any language. A malformed code is REJECTED with an error. ",
    ),
  );
});
