// G2: Erst-Turn-Deadlock aufgeloest. /voice/outbound nennt Offenlegung + Anliegen im
// SELBEN Turn (EIN Say IM Gather), bleibt strikt LLM-frei, kappt ueberlanges Anliegen
// fuer die Sprachausgabe und der Outbound-systemPrompt verhindert die Doppel-Nennung.
// Deckt die Pre-Mortem-Punkte (a kein LLM-Pull, b Reihenfolge, c kein Doppel-Anliegen,
// T5 Grenzwerte). Die Renderer-Faelle laufen ueber den G0-Harness (offline, beide
// Provider); der systemPrompt-Fall ist Rein-Unit (kein Spawn, Muster claude-identity).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { runOutbound, GATHER_OPEN, HANGUP_TAG, DISCLOSURE_JONAS } from "./_outbound-harness.js";

// Muss zu OPENING_GOAL_MAX_CHARS (claude.js, 75) passen: dieser Test pinnt das
// beobachtbare Kapp-Verhalten (Wortgrenze, kein Satzzeichen-Salat), nicht die Zahl.
// AL-P5 hat die Kappe von 160 auf 70 gesenkt (Eroeffnungsfenster); AL-P5-Review-Runde 1
// hat sie auf 75 angehoben (reale Auftraege verloren bei 70 ihr zweck-tragendes Verb,
// s. Kommentar in claude.js). Die Duplikation hier ist beabsichtigt und wird bewusst
// mitgezogen - sie ist keine stille Reparatur.
const OPENING_GOAL_MAX_CHARS = 75;

let systemPrompt, openingText, disclosureSentence;
before(async () => {
  process.env.DATA_DIR = tempDataDir(seedState({ calls: [] }));
  await import("../src/config.js");
  ({ systemPrompt, openingText, disclosureSentence } = await import("../src/claude.js"));
});

for (const provider of ["twilio", "telnyx"]) {
  // (1) Offenlegung ZUERST, dann Anliegen, beides in EINEM Say IM Gather; kein Hangup.
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

// (2) Kein LLM-Pull im Erst-Turn: Status 200 ohne Anthropic-Mock, keine LLM-Diagnose.
test("G2: /voice/outbound bleibt LLM-frei (kein [outbound]-Log, kein Anthropic-Call)", async () => {
  const { status, stdout } = await runOutbound({ provider: "twilio" });
  assert.equal(status, 200);
  assert.ok(!stdout.includes("[outbound]"), `kein Outbound-LLM-Log erwartet: ${stdout}`);
  assert.ok(!stdout.includes("[outbound-recv]"), `kein Outbound-LLM-Log erwartet: ${stdout}`);
});

// (3a) Kappe: ueberlanges Anliegen wird fuer die Sprachausgabe gekuerzt.
test("G2: ueberlanges Anliegen wird im Erst-Turn gekappt (Wortgrenze, kein Satzzeichen-Salat)", async () => {
  const longGoal = "wegen einer sehr ausfuehrlichen Terminanfrage ".repeat(8).trim();
  assert.ok(
    longGoal.length > OPENING_GOAL_MAX_CHARS,
    "Test-Setup: goal muss laenger als die Kappe sein",
  );
  const { body, status } = await runOutbound({ provider: "twilio", call: { goal: longGoal } });
  assert.equal(status, 200);
  // Das vollstaendige lange Anliegen darf NICHT komplett gerendert werden.
  assert.ok(
    !body.includes(longGoal),
    `langes Anliegen darf nicht ungekappt gerendert werden: ${body}`,
  );
  // Aber ein Praefix (erstes Wort) muss vorhanden sein - es wurde gekappt, nicht gedroppt.
  assert.ok(
    body.includes("wegen einer sehr ausfuehrlichen"),
    `gekapptes Anliegen-Praefix fehlt: ${body}`,
  );
  // Direkt vor dem schliessenden Punkt darf kein doppeltes Satz-Endzeichen stehen.
  assert.ok(!/[.!?]\.<\/Say>/.test(body), `Satzzeichen-Salat am Anliegen-Ende: ${body}`);
});

// (3b) Grenzfall leeres Anliegen: nur Offenlegung, kein Bruecken-Artefakt.
test("G2: leeres Anliegen -> nur Offenlegung, kein Bruecken-Artefakt", () => {
  const emptyGoalCall = seedCall({ direction: "outbound", goal: "", tenantId: BOOTSTRAP_TENANT_ID });
  const text = openingText(emptyGoalCall);
  assert.ok(text.includes("Guten Tag"), `Offenlegung fehlt: ${text}`);
  // Bei leerem Anliegen wird die Bruecke komplett weggelassen -> Opener == reine Offenlegung.
  assert.equal(text, disclosureSentence(emptyGoalCall), `leeres Anliegen darf keine Bruecke rendern: ${text}`);
});

// (4) Kein Doppel-Anliegen: der Outbound-systemPrompt weist den LLM an, die LLM-frei
// gesprochene Offenlegung + Anliegen NICHT zu wiederholen (statt sie zu verlangen).
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
