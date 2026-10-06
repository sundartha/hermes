import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { registerTools } from "../src/mcp-tools.js";
import { resolveLocale, WIDGET_DICT } from "../src/ui/widget-i18n.js";

const HTTP_OK = 200;

function captureTools(ctx) {
  const handlers = new Map();
  const fakeServer = {
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
    },
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return handlers;
}

async function startGatewayMock(body) {
  const server = http.createServer((req, res) => {
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withGateway(body, fn) {
  const mock = await startGatewayMock(body);
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
}

test("UI-09: Charakterisierung heutiger Stand - drei Sprachachsen divergieren gleichzeitig in einer Karte", async () => {
  const chromeLocale = resolveLocale(["en-US"], WIDGET_DICT);
  assert.equal(chromeLocale, "en");

  const CALL_FIXTURE = {
    status: "completed",
    startedAt: "2026-06-26T09:59:50.000Z",
    endedAt: "2026-06-26T10:02:00.000Z",
    summary: "Rendez-vous confirmé pour samedi à onze heures.",
    transcript: [
      { role: "agent", text: "Bonjour, ici Hermes." },
      { role: "callee", text: "Bonjour, de quoi s'agit-il ?" },
    ],
  };

  await withGateway(CALL_FIXTURE, async () => {
    const handlers = captureTools({ identity: null, scopedTenant: "tenant-fr" });
    const statusResult = await handlers.get("get_call_status")({ call_id: "call_1" });
    const transcriptResult = await handlers.get("get_call_result")({ call_id: "call_1" });

    const summary = transcriptResult.structuredContent.result_summary;
    assert.match(summary, /[éèàâîïôûç]/i, "Achse D traegt franzoesische Zeichen (Fixture-Beweis)");

    const lines = statusResult.structuredContent.last_transcript_lines;
    const calleeLine = lines.find((line) => line.includes("Bonjour, de quoi"));
    assert.ok(calleeLine, "Gegenseiten-Zeile muss im Fixture-Transkript vorkommen");
    const prefix = calleeLine.split(":")[0];

    const dictUniverse = new Set([
      ...Object.keys(WIDGET_DICT.en ?? {}),
      ...Object.values(WIDGET_DICT.de),
      ...Object.values(WIDGET_DICT.fr),
    ]);
    assert.ok(
      !dictUniverse.has(prefix),
      `Rollen-Praefix "${prefix}" muesste aus der Widget-Chrome-Uebersetzungswelt stammen, ` +
        "tut es aber nicht - dritte, unkoordinierte Sprachquelle",
    );

    const handlersOther = captureTools({ identity: null, scopedTenant: "tenant-en-us" });
    const statusResultOther = await handlersOther.get("get_call_status")({ call_id: "call_1" });
    const calleeLineOther = statusResultOther.structuredContent.last_transcript_lines.find((line) =>
      line.includes("Bonjour, de quoi"),
    );
    assert.equal(
      calleeLineOther.split(":")[0],
      prefix,
      "Praefix bleibt invariant, egal welcher Tenant (unabhaengig von Achse D)",
    );
  });
});
