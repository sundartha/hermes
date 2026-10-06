import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { runOutbound, GATHER_OPEN, HANGUP_TAG, DISCLOSURE_JONAS } from "./_outbound-harness.js";

const OPENING_GOAL_MAX_CHARS = 75;

let systemPrompt, openingText, disclosureSentence;
before(async () => {
  process.env.DATA_DIR = tempDataDir(seedState({ calls: [] }));
  await import("../src/config.js");
  ({ systemPrompt, openingText, disclosureSentence } = await import("../src/claude.js"));
});

for (const provider of ["telnyx"]) {
  test(`G2 (${provider}): Offenlegung vor Anliegen, EIN Say im Gather, kein Hangup`, async () => {
    const goal = "einen Friseurtermin zu vereinbaren";
    const { body, status } = await runOutbound({ provider, call: { goal } });
    assert.equal(status, 200);
    const gatherIdx = body.indexOf(GATHER_OPEN);
    const sayIdx = body.search(/<Say[ >]/);
    const discIdx = body.indexOf(DISCLOSURE_JONAS);
    const goalIdx = body.indexOf("Friseurtermin");
    assert.equal((body.match(/<Say[ >]/g) || []).length, 1, `genau ein Say erwartet: ${body}`);
    assert.ok(gatherIdx < sayIdx, `Say muss IM Gather stehen: ${body}`);
    assert.ok(
      discIdx !== -1 && goalIdx !== -1 && discIdx < goalIdx,
      `Offenlegung muss VOR dem Anliegen stehen: ${body}`,
    );
    assert.ok(!body.includes(HANGUP_TAG), `kein Hangup im Erst-Turn: ${body}`);
  });
}

test("G2: /voice/outbound bleibt LLM-frei (kein [outbound]-Log, kein Anthropic-Call)", async () => {
  const { status, stdout } = await runOutbound({ provider: "telnyx" });
  assert.equal(status, 200);
  assert.ok(!stdout.includes("[outbound]"), `kein Outbound-LLM-Log erwartet: ${stdout}`);
  assert.ok(!stdout.includes("[outbound-recv]"), `kein Outbound-LLM-Log erwartet: ${stdout}`);
});

test("G2: ueberlanges Anliegen wird im Erst-Turn gekappt (Wortgrenze, kein Satzzeichen-Salat)", async () => {
  const longGoal = "wegen einer sehr ausfuehrlichen Terminanfrage ".repeat(8).trim();
  assert.ok(
    longGoal.length > OPENING_GOAL_MAX_CHARS,
    "Test-Setup: goal muss laenger als die Kappe sein",
  );
  const { body, status } = await runOutbound({ provider: "telnyx", call: { goal: longGoal } });
  assert.equal(status, 200);
  assert.ok(
    !body.includes(longGoal),
    `langes Anliegen darf nicht ungekappt gerendert werden: ${body}`,
  );
  assert.ok(
    body.includes("wegen einer sehr ausfuehrlichen"),
    `gekapptes Anliegen-Praefix fehlt: ${body}`,
  );
  assert.ok(!/[.!?]\.<\/Say>/.test(body), `Satzzeichen-Salat am Anliegen-Ende: ${body}`);
});

test("G2: leeres Anliegen -> nur Offenlegung, kein Bruecken-Artefakt", () => {
  const emptyGoalCall = seedCall({ direction: "outbound", goal: "", tenantId: BOOTSTRAP_TENANT_ID });
  const text = openingText(emptyGoalCall);
  assert.ok(text.includes("Guten Tag"), `Offenlegung fehlt: ${text}`);
  assert.equal(text, disclosureSentence(emptyGoalCall), `leeres Anliegen darf keine Bruecke rendern: ${text}`);
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
