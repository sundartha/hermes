// Gemeinsamer Test-Rohstoff fuer lokale Anthropic-Mocks: baut Antwort-Beschreibungen
// (text/toolUse/reply) und rendert sie in beiden Draht-Formen, die die AL-Diagnose-Tests
// gegen ihren lokalen node:http-Mock brauchen - Bestands-JSON (nicht-Streaming) und
// echtes Anthropic-SSE (message_start -> je Block content_block_start/-delta/-stop ->
// message_delta -> message_stop, Text in ZWEI Deltas, deren Grenze bewusst NICHT auf
// einer Satzgrenze liegt).
//
// Reiner Test-Rohstoff ohne config.js-Import - unproblematisch fuer die statische
// Import-Reihenfolge, die test/al-d1-cause-diagnostics.test.js und
// test/al-d2-thinking-signal-diagnostics.test.js beschreiben (Lehre test-base-env-drift).
//
// Die Antwort-Nachrichten-ID variiert bewusst je aufrufender Datei (msg_ald1/msg_ald2) -
// deshalb liefern makeJsonMessage/makeWriteSse Fabriken statt fester Funktionen.

export const MOCK_USAGE = { input_tokens: 10, output_tokens: 5 };

export const text = (value) => ({ type: "text", text: value });
export const toolUse = (name, input = {}) => ({ type: "tool_use", id: "tu1", name, input });
export const reply = (...blocks) => ({ blocks });

// Baut die jsonMessage-Funktion fuer eine feste Nachrichten-ID (Bestandspfad/JSON-Draht).
export function makeJsonMessage(messageId) {
  return function jsonMessage(blocks) {
    return {
      id: messageId,
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5",
      content: blocks,
      stop_reason: blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: MOCK_USAGE,
    };
  };
}

function sseEvent(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
}

// Baut die writeSse-Funktion fuer eine gegebene jsonMessage-Funktion (SSE-Draht).
export function makeWriteSse(jsonMessage) {
  return function writeSse(res, blocks) {
    res.setHeader("content-type", "text/event-stream");
    sseEvent(res, "message_start", {
      message: { ...jsonMessage([]), content: [], usage: { ...MOCK_USAGE, output_tokens: 1 } },
    });
    let index = 0;
    for (const block of blocks) {
      if (block.type === "text") {
        sseEvent(res, "content_block_start", { index, content_block: { type: "text", text: "" } });
        const half = Math.ceil(block.text.length / 2);
        sseEvent(res, "content_block_delta", {
          index,
          delta: { type: "text_delta", text: block.text.slice(0, half) },
        });
        sseEvent(res, "content_block_delta", {
          index,
          delta: { type: "text_delta", text: block.text.slice(half) },
        });
      } else {
        sseEvent(res, "content_block_start", { index, content_block: { ...block, input: {} } });
        sseEvent(res, "content_block_delta", {
          index,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input || {}) },
        });
      }
      sseEvent(res, "content_block_stop", { index });
      index += 1;
    }
    sseEvent(res, "message_delta", {
      delta: { stop_reason: jsonMessage(blocks).stop_reason, stop_sequence: null },
      usage: { output_tokens: MOCK_USAGE.output_tokens },
    });
    sseEvent(res, "message_stop", {});
    res.end();
  };
}
