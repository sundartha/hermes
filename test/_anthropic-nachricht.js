export function anthropicTextMessage(text) {
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 16 },
  };
}

export function endPremature(res) {
  res.writeHead(200, { "content-type": "application/json", "transfer-encoding": "chunked" });
  res.write('{"id":"msg_mock","type":"message"');
  res.socket.destroy();
}
