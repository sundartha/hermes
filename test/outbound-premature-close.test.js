import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runOutboundThenTurn,
  AGENT_SPEECH,
  assertDisclosureInGather,
  startCountingAnthropicMock,
  startAlwaysPrematureMock,
  startAlways4xxMock,
  GATHER_OPEN as GATHER,
  HANGUP_TAG as HANGUP,
} from "./_outbound-harness.js";

const LLM_DEGRADED_MARKER = "Ich melde mich, sobald es wieder möglich ist";
const TURN_ERROR_MARKER = "technisches Problem";

for (const provider of ["telnyx"]) {
  test(`A (${provider}): /voice/outbound ist LLM-frei (Offenlegung + Gather, kein [outbound]-Log)`, async () => {
    const mock = await startCountingAnthropicMock({ failFirst: 1 });
    try {
      const { outboundBody, stdout } = await runOutboundThenTurn({
        mockUrl: mock.url,
        provider,
        speechResult: "Hallo",
      });
      assertDisclosureInGather(outboundBody);
      assert.ok(
        !outboundBody.includes(HANGUP),
        `/voice/outbound darf nicht auflegen: ${outboundBody}`,
      );
      assert.ok(
        !outboundBody.includes(AGENT_SPEECH),
        `/voice/outbound darf kein Anliegen rendern (LLM-frei): ${outboundBody}`,
      );
      assert.ok(
        !stdout.includes("[outbound]"),
        `/voice/outbound macht keinen LLM-Call mehr (kein [outbound]-Log): ${stdout}`,
      );
      assert.ok(
        !stdout.includes("[outbound-recv]"),
        `/voice/outbound macht keinen LLM-Call mehr (kein [outbound-recv]-Log): ${stdout}`,
      );
    } finally {
      await mock.close();
    }
  });

  test(`B (${provider}): Seam retriet -> Anliegen im /voice/turn, kein terminaler Fehler`, async () => {
    const mock = await startCountingAnthropicMock({ failFirst: 2 });
    try {
      const { turnBody, stdout } = await runOutboundThenTurn({
        mockUrl: mock.url,
        provider,
        speechResult: "Hallo",
      });
      assert.ok(turnBody.includes(GATHER), `Turn nach Retry muss <Gather> rendern: ${turnBody}`);
      assert.ok(
        turnBody.includes(AGENT_SPEECH),
        `Anliegen fehlt nach erfolgreichem Retry: ${turnBody}`,
      );
      assert.ok(!turnBody.includes(HANGUP), `geglueckter Turn darf nicht auflegen: ${turnBody}`);
      assert.ok(
        !stdout.includes("[turn]"),
        `kein terminaler Turn-Fehler erwartet (Retry greift): ${stdout}`,
      );
      assert.equal(mock.count(), 3, "erwartet 2 Aborts + 1 Erfolg = 3 Requests");
    } finally {
      await mock.close();
    }
  });

  test(`C (${provider}): anhaltend nicht verfuegbar -> wuerdevolle Degradation + Hangup`, async () => {
    const mock = await startAlwaysPrematureMock();
    try {
      const { turnBody } = await runOutboundThenTurn({
        mockUrl: mock.url,
        provider,
        speechResult: "Hallo",
        env: { LLM_MAX_RETRIES: "0" },
      });
      assert.ok(turnBody.includes(LLM_DEGRADED_MARKER), `Degradations-Text fehlt: ${turnBody}`);
      assert.ok(turnBody.includes(HANGUP), `Degradation muss kontrolliert auflegen: ${turnBody}`);
      assert.ok(
        !turnBody.includes(TURN_ERROR_MARKER),
        `Degradation darf nicht das generische Ende rendern: ${turnBody}`,
      );
    } finally {
      await mock.close();
    }
  });

  test(`D (${provider}): 400 wird nicht retried -> technisches Ende, keine Degradation`, async () => {
    const mock = await startAlways4xxMock();
    try {
      const { turnBody } = await runOutboundThenTurn({
        mockUrl: mock.url,
        provider,
        speechResult: "Hallo",
      });
      assert.ok(
        turnBody.includes(TURN_ERROR_MARKER),
        `generisches technisches Ende fehlt: ${turnBody}`,
      );
      assert.ok(
        !turnBody.includes(LLM_DEGRADED_MARKER),
        `400 darf nicht als Degradation enden: ${turnBody}`,
      );
      assert.ok(turnBody.includes(HANGUP), `technisches Ende muss auflegen: ${turnBody}`);
      assert.equal(mock.count(), 1, "400 darf genau EINMAL angefragt werden (kein Retry)");
    } finally {
      await mock.close();
    }
  });
}
