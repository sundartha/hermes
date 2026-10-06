import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";

let systemPrompt, toolDefs;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [],
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
    }),
  );
  await import("../src/config.js");
  ({ systemPrompt, toolDefs } = await import("../src/claude.js"));
});

const enCall = (over = {}) => seedCall({ tenantId: BOOTSTRAP_TENANT_ID, language: "en", ...over });

const GERMAN_HEADINGS = [
  "SITUATION:",
  "SO SPRICHST DU:",
  "WENN ETWAS UNKLAR IST:",
  "DEINE GRENZEN:",
  "SO KOMMST DU ZUM ERGEBNIS:",
];

test("systemPrompt(en) traegt keine deutschen Sektions-Ueberschriften (ex PROMPT-01)", () => {
  const prompt = systemPrompt(enCall({ direction: "inbound" }));
  const leaked = GERMAN_HEADINGS.filter((h) => prompt.includes(h));
  assert.deepEqual(
    leaked,
    [],
    `EN-Prompt traegt noch deutsche Ueberschriften (Launch-Blocker): ${leaked.join(", ")}`,
  );
});

test("toolDefs()-Beschreibungen sind nicht hartcodiert deutsch (ex PROMPT-02)", () => {
  const defs = toolDefs("en");
  const endCall = defs.find((t) => t.name === "end_call");
  const takeMessage = defs.find((t) => t.name === "take_message");
  assert.ok(endCall, "end_call fehlt in toolDefs()");
  assert.ok(takeMessage, "take_message fehlt in toolDefs()");
  assert.ok(
    !/Beendet das Telefonat/.test(endCall.description),
    `end_call-Beschreibung ist weiterhin hartcodiert deutsch: ${endCall.description}`,
  );
  assert.ok(
    !/Nimmt eine Nachricht/.test(takeMessage.description),
    `take_message-Beschreibung ist weiterhin hartcodiert deutsch: ${takeMessage.description}`,
  );
});
