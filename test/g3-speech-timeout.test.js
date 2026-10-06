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
