import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";

const OWNER = "Jonas Beispiel";
const HALLUCINATED_TOOL = "look_up_not_yet_built";

let isSideEffectOnlyTool, toolDefs;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
      calls: [],
    }),
  );
  await import("../../src/config.ts");
  ({ isSideEffectOnlyTool, toolDefs } = await import("../../src/claude.js"));
});

test("AL-P4-7: isSideEffectOnlyTool klassifiziert beide Bestandswerkzeuge und nichts sonst", () => {
  assert.equal(isSideEffectOnlyTool("end_call"), true);
  assert.equal(isSideEffectOnlyTool("take_message"), true);
  assert.equal(isSideEffectOnlyTool(HALLUCINATED_TOOL), false);
  assert.equal(isSideEffectOnlyTool(""), false);
  assert.equal(isSideEffectOnlyTool(undefined), false);
});

test("AL-P4-8: heute ist JEDES Werkzeug aus toolDefs ein Seiteneffekt-Werkzeug", () => {
  assert.ok(toolDefs("de").every((t) => isSideEffectOnlyTool(t.name)));
});

test("AL-P4-9: die take_message-Beschreibung verlangt den Satz in derselben Antwort", () => {
  const expectations = [
    ["de", "in dieselbe Antwort"],
    ["en", "in the very same reply"],
    ["fr", "dans la réponse MÊME"],
  ];
  for (const [lang, clause] of expectations) {
    const def = toolDefs(lang).find((t) => t.name === "take_message");
    assert.ok(
      def.description.includes(clause),
      `${lang}: take_message-Description muss "${clause}" enthalten`,
    );
  }
});
