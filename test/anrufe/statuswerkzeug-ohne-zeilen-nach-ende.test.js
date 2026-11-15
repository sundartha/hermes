import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { registerTools } from "../../src/mcp-tools.js";

const HTTP_OK = 200;
const LINE_COUNT = 10;
const RUNNING_LIMIT = 6;

function captureTools(ctx) {
  const handlers = new Map();
  registerTools({ registerTool: (name, _c, handler) => handlers.set(name, handler), registerResource() {} }, ctx);
  return handlers;
}

function storedLines() {
  return Array.from({ length: LINE_COUNT }, (_, index) => ({
    role: index % 2 === 0 ? "agent" : "counterparty",
    text: `Zeile ${index + 1}`,
  }));
}

async function statusFor(callBody) {
  const server = http.createServer((_req, res) => {
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(callBody));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const handlers = captureTools({ identity: null, scopedTenant: "tenant_4282", consultAllowed: true, language: "de" });
    const result = await handlers.get("get_call_status")({ call_id: "call_4282" });
    return { structured: result.structuredContent, text: JSON.parse(result.content[0].text) };
  } finally {
    if (previous === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = previous;
    await new Promise((resolve) => server.close(resolve));
  }
}

for (const status of ["completed", "failed", "cancelled"]) {
  test(`get_call_status gibt nach Status ${status} keine Transkriptzeilen aus`, async () => {
    const { structured, text } = await statusFor({ status, transcript: storedLines() });
    assert.equal(structured.status, status);
    assert.deepEqual(structured.last_transcript_lines, []);
    assert.deepEqual(text.last_transcript_lines, []);
  });
}

test("get_call_status gibt bei laufendem Anruf genau die letzten sechs Zeilen aus", async () => {
  const { structured, text } = await statusFor({
    status: "active",
    answeredAt: "2026-11-15T10:00:00.000Z",
    transcript: storedLines(),
  });
  assert.equal(structured.status, "in_progress");
  assert.equal(structured.last_transcript_lines.length, RUNNING_LIMIT);
  assert.equal(structured.last_transcript_lines[0], "Agent: Zeile 5");
  assert.equal(structured.last_transcript_lines[RUNNING_LIMIT - 1], "Gegenseite: Zeile 10");
  assert.deepEqual(text.last_transcript_lines, structured.last_transcript_lines);
});

test("get_call_status deckelt auch beim Waehlen auf sechs Zeilen", async () => {
  const { structured, text } = await statusFor({ status: "active", transcript: storedLines() });
  assert.equal(structured.status, "dialing");
  assert.equal(structured.last_transcript_lines.length, RUNNING_LIMIT);
  assert.equal(structured.last_transcript_lines[0], "Agent: Zeile 5");
  assert.equal(text.last_transcript_lines.length, RUNNING_LIMIT);
});
