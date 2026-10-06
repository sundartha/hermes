export const MOCK_USAGE = { input_tokens: 10, output_tokens: 5 };

export const text = (value) => ({ type: "text", text: value });
export const toolUse = (name, input = {}) => ({ type: "tool_use", id: "tu1", name, input });
export const reply = (...blocks) => ({ blocks });

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
