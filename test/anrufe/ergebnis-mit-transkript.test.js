import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { registerTools } from "../../src/mcp-tools.js";

const HTTP_OK = 200;

function captureTools(ctx) {
  const handlers = new Map();
  registerTools({ registerTool: (name, _c, handler) => handlers.set(name, handler), registerResource() {} }, ctx);
  return handlers;
}

const THREE_TURNS = [
  { role: "agent", text: "Guten Tag, ich rufe fuer Frau Beispiel an." },
  { role: "counterparty", text: "Kreditkarte 3056 930902 5904 notieren Sie." },
  { role: "agent", text: "Danke, auf Wiederhören." },
];

async function resultFor(callBody) {
  const server = http.createServer((_req, res) => {
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(callBody));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const handlers = captureTools({ identity: null, scopedTenant: "tenant_5078", consultAllowed: true, language: "de" });
    const result = await handlers.get("get_call_result")({ call_id: "call_5078" });
    if (result.isError) return { fehler: result.content[0].text };
    return { structured: result.structuredContent, content: result.content, meta: result._meta };
  } finally {
    if (previous === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = previous;
    await new Promise((resolve) => server.close(resolve));
  }
}

for (const status of ["completed", "failed", "cancelled"]) {
  test(`get_call_result liefert nach Status ${status} das Transkript nur im _meta als Rolle und maskierten Text`, async () => {
    const { structured, content, meta } = await resultFor({ status, summary: "Fertig.", transcript: THREE_TURNS });
    assert.equal(meta.transcript.length, 3);
    assert.deepEqual(
      meta.transcript.map((turn) => turn.role),
      ["agent", "counterparty", "agent"],
    );
    assert.equal(meta.transcript[0].text, "Guten Tag, ich rufe fuer Frau Beispiel an.");
    const masked = meta.transcript[1];
    assert.equal(masked.text, "Kreditkarte ****5904 notieren Sie.");
    assert.deepEqual(Object.keys(masked).sort(), ["role", "text"]);
    const modelVisible = JSON.stringify({ content, structuredContent: structured });
    assert.ok(!modelVisible.includes("Guten Tag, ich rufe"));
    assert.ok(!modelVisible.includes("Danke, auf"));
    assert.ok(!modelVisible.includes("3056 930902"));
    assert.equal(structured.transcript, undefined);
  });
}

test("get_call_result liefert bei laufendem Anruf kein Transkript", async () => {
  const result = await resultFor({
    status: "active",
    answeredAt: "2026-11-17T10:00:00.000Z",
    transcript: THREE_TURNS,
  });
  assert.equal(result.structured, undefined);
  assert.ok(result.fehler.includes("Anruf laeuft noch"));
});

test("get_call_result benennt eine fremde Rolle als Gegenueber", async () => {
  const { meta } = await resultFor({
    status: "completed",
    transcript: [{ role: "caller", text: "Hallo" }],
  });
  assert.deepEqual(meta.transcript, [{ role: "counterparty", text: "Hallo" }]);
});
