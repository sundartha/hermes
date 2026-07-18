// CP4 (P3b-R): End-to-end-Verhalten des Outbound-/Turn-Pfads
// gegen einen flackernden Anthropic-Upstream ("Premature close" = chunked-Body wird
// vom Server abgebrochen). Pinnt fuer BEIDE Provider (Twilio + Telnyx):
//   A - /voice/outbound ist LLM-frei: Offenlegung + <Gather>, kein LLM-Call (kein
//       [outbound]/[outbound-recv]-Log mehr) - der Strukturfix (Schicht 1).
//   B - der resiliente Seam (src/llm.js) retriet im ersten /voice/turn begrenzt und
//       liefert dann das Anliegen (Schicht 2 greift, kein terminaler Fehler).
//   C - bei anhaltender Nichtverfuegbarkeit wirft der Seam LlmUnavailableError; der
//       /voice/turn-catch verabschiedet sich wuerdevoll (Say + Hangup), kein nacktes
//       "technisches Problem".
//   D - ein nicht-transienter 400 wird NICHT retried; der /voice/turn-catch rendert
//       das generische technische Ende, NICHT die Degradation (kein Fehlgriff).
//
// agentTurn ruft Anthropic ueber das SDK; statt das Netz zu treffen lenken die Mocks
// den Client per ANTHROPIC_BASE_URL auf einen lokalen Server (deterministisch,
// offline). Da /voice/outbound LLM-frei ist, treffen B/C/D den Seam erst ueber den
// ERSTEN /voice/turn (mit SpeechResult) - die Kette (runOutboundThenTurn) ist daher
// zweistufig. Choreografie + Mocks + Marker leben in test/_outbound-harness.js (G0).
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

// Teilstring von LLM_DEGRADED_SPEECH (server.js): pinnt die wuerdevolle Degradation.
const LLM_DEGRADED_MARKER = "Ich melde mich, sobald es wieder möglich ist";
// Teilstring von TURN_ERROR_SPEECH (server.js): pinnt das generische technische Ende.
const TURN_ERROR_MARKER = "technisches Problem";

for (const provider of ["twilio", "telnyx"]) {
  // A - /voice/outbound ist LLM-frei: Offenlegung + <Gather>, KEIN LLM-Call.
  test(`A (${provider}): /voice/outbound ist LLM-frei (Offenlegung + Gather, kein [outbound]-Log)`, async () => {
    const mock = await startCountingAnthropicMock({ failFirst: 1 });
    try {
      const { outboundBody, stdout } = await runOutboundThenTurn({
        mockUrl: mock.url,
        provider,
        speechResult: "Hallo",
      });
      // G2: Offenlegung als Say IM Gather (gatherIdx < discIdx).
      assertDisclosureInGather(outboundBody);
      assert.ok(
        !outboundBody.includes(HANGUP),
        `/voice/outbound darf nicht auflegen: ${outboundBody}`,
      );
      // LLM-frei -> nur die Offenlegung, kein Anliegen aus dem Mock.
      assert.ok(
        !outboundBody.includes(AGENT_SPEECH),
        `/voice/outbound darf kein Anliegen rendern (LLM-frei): ${outboundBody}`,
      );
      // Strukturfix-Diskriminator: keine Outbound-LLM-Diagnose-Logs mehr.
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

  // B - Resilienz greift: der Seam retriet im ersten /voice/turn und liefert dann das
  // Anliegen. LLM_MAX_RETRIES=2 (BASE_ENV) -> 2 Aborts + 1 Erfolg = 3 Requests.
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
      // Diskriminator: kein terminaler Turn-Error -> der interne Retry hat gegriffen.
      assert.ok(
        !stdout.includes("[turn]"),
        `kein terminaler Turn-Fehler erwartet (Retry greift): ${stdout}`,
      );
      // 2 Aborts + 1 Erfolg = begrenzter Retry.
      assert.equal(mock.count(), 3, "erwartet 2 Aborts + 1 Erfolg = 3 Requests");
    } finally {
      await mock.close();
    }
  });

  // C - Degradation: anhaltende Nichtverfuegbarkeit -> LlmUnavailableError -> der
  // /voice/turn-catch verabschiedet sich wuerdevoll (Say + Hangup), kein nacktes
  // "technisches Problem". LLM_MAX_RETRIES=0 -> complete wirft direkt beim ersten
  // transienten Fehler (retries-exhausted), deterministisch + schnell (kein Backoff).
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
      // Diskriminator Degradation vs. generischer Fehler.
      assert.ok(
        !turnBody.includes(TURN_ERROR_MARKER),
        `Degradation darf nicht das generische Ende rendern: ${turnBody}`,
      );
    } finally {
      await mock.close();
    }
  });

  // D - selektiv: ein 400 ist NICHT transient -> KEIN Retry, complete wirft den
  // Original-Fehler (kein LlmUnavailableError) -> der /voice/turn-catch rendert das
  // generische technische Ende, NICHT die Degradation. count===1 = kein Over-Retry.
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
      // Waechter gegen Over-Retry (Pre-Mortem: Over-Retry maskiert Config-Fehler).
      assert.equal(mock.count(), 1, "400 darf genau EINMAL angefragt werden (kein Retry)");
    } finally {
      await mock.close();
    }
  });
}
