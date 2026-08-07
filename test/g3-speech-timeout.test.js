// G3: STT-Endpointing-Truncation. Beweist end-to-end (offline, Spawn), dass der
// Override-Seam nur die FOLGE-Gathers im /voice/turn auf ein festes speechTimeout
// setzt, waehrend das Outbound-ERST-Gather (G2-Invariante) bewusst auf "auto"
// bleibt - und dass der Wert config-getrieben tunebar ist (kein Code-Diff). Baut
// auf der gebuendelten Outbound-/Turn-Harness auf (_outbound-harness.js). Telnyx,
// weil der Override am TeXML-Gather haengt (dem einzigen Renderer).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runOutbound,
  runOutboundThenTurn,
  startCountingAnthropicMock,
} from "./_outbound-harness.js";

test("G3: Outbound-Erst-Gather bleibt auf auto (kein festes N) - Telnyx", async () => {
  const { body } = await runOutbound({ provider: "telnyx" });
  assert.match(body, /speechTimeout="auto"/);
  assert.doesNotMatch(body, /speechTimeout="2"/);
});

test("G3: Folge-Turn-Gather traegt festes speechTimeout=2 (kein auto) - Telnyx", async () => {
  // failFirst: 0 -> der Mock antwortet sofort valide (kein Retry), der Turn rendert
  // einen Folge-Gather ueber followupTurnDirectives.
  const mock = await startCountingAnthropicMock({ failFirst: 0 });
  try {
    const { turnBody } = await runOutboundThenTurn({
      provider: "telnyx",
      speechResult: "Ja gerne",
      mockUrl: mock.url,
    });
    assert.match(turnBody, /speechTimeout="2"/);
    assert.doesNotMatch(turnBody, /speechTimeout="auto"/);
  } finally {
    await mock.close();
  }
});

test("G3: Folge-Turn speechTimeout ist config-tunebar (kein Code-Diff)", async () => {
  const mock = await startCountingAnthropicMock({ failFirst: 0 });
  try {
    const { turnBody } = await runOutboundThenTurn({
      provider: "telnyx",
      speechResult: "Ja",
      mockUrl: mock.url,
      env: { STT_SPEECH_TIMEOUT_SEC: "3" },
    });
    assert.match(turnBody, /speechTimeout="3"/);
  } finally {
    await mock.close();
  }
});
