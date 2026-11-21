import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";

let systemPrompt;
before(async () => {
  process.env.DATA_DIR = tempDataDir(seedState({ calls: [] }));
  await import("../../src/config.ts");
  ({ systemPrompt } = await import("../../src/claude.js"));
});

test("G2: Outbound-systemPrompt verhindert Doppel-Nennung (nicht wiederholen, kein 'allererster Satz')", () => {
  const prompt = systemPrompt(
    seedCall({ direction: "outbound", goal: "Termin", tenantId: BOOTSTRAP_TENANT_ID }),
  );
  assert.ok(prompt.includes("Wiederhole sie NICHT"), `Nicht-wiederholen-Hinweis fehlt: ${prompt}`);
  assert.ok(
    !prompt.includes("Dein allererster Satz muss exakt lauten"),
    `alter Pflicht-Satz-Wortlaut darf nicht mehr im Prompt stehen: ${prompt}`,
  );
});
