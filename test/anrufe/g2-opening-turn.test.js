import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";

let systemPrompt, openingText;
before(async () => {
  process.env.DATA_DIR = tempDataDir(seedState({ calls: [] }));
  await import("../../src/config.js");
  ({ systemPrompt, openingText } = await import("../../src/claude.js"));
});

test("G2: leeres Anliegen -> Gruss, fester Anlass-Rueckfall und KI-Hinweis, kein Bruecken-Artefakt", () => {
  const emptyGoalCall = seedCall({ direction: "outbound", goal: "", tenantId: BOOTSTRAP_TENANT_ID });
  const text = openingText(emptyGoalCall);
  assert.equal(
    text,
    "Hallo, ich rufe an, um ein kurzes Anliegen zu klären – ich bin Hermes, der KI-Assistent von meinem Auftraggeber, und ich fasse das Gespräch für meinen Auftraggeber zusammen.",
  );
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
