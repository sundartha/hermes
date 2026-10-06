import { test } from "node:test";
import assert from "node:assert/strict";
import { registerTools } from "../src/mcp-tools.js";
import { startServer, seedState, mcpPost, readToolResult } from "./helpers.js";

const EXPECTED_ANNOTATIONS = {
  prepare_call: {
    title: "Preview a phone call",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  place_call: {
    title: "Place a phone call",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  get_call_status: {
    title: "Get call status",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  get_call_result: {
    title: "Get call result",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  cancel_call: {
    title: "Cancel a call",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  get_agent_number: {
    title: "Agent phone number",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  list_calls: {
    title: "List calls",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  check_inbox: {
    title: "Check inbox",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  list_action_items: {
    title: "List action items",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  get_agent_status: {
    title: "Get agent status",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
};

const EXPECTED_CONSULT_ANNOTATIONS = {
  await_call_event: {
    title: "Wait for call update",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  answer_consult: {
    title: "Answer call question",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
};

function captureAnnotations(ctx = {}) {
  const annotationsByTool = new Map();
  const fakeServer = {
    registerTool: (name, config) => annotationsByTool.set(name, config.annotations),
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return annotationsByTool;
}

test("P0-1: die Werkzeuge ohne Consult-Kanal tragen genau die vereinbarten Annotations", () => {
  const found = captureAnnotations();
  assert.deepEqual(
    [...found.keys()].sort(),
    Object.keys(EXPECTED_ANNOTATIONS).sort(),
    "die Menge der registrierten Werkzeuge ist unveraendert",
  );
  for (const [name, expected] of Object.entries(EXPECTED_ANNOTATIONS))
    assert.deepEqual(found.get(name), expected, name);
});

test("P0-1: die Consult-Werkzeuge tragen ihre Annotations - und erscheinen nur mit Faehigkeit", () => {
  const withConsult = captureAnnotations({ consultAllowed: true });
  const withoutConsult = captureAnnotations();
  for (const [name, expected] of Object.entries(EXPECTED_CONSULT_ANNOTATIONS)) {
    assert.ok(!withoutConsult.has(name), `${name} fehlt ohne Faehigkeit`);
    assert.deepEqual(withConsult.get(name), expected, name);
  }
});

test("P0-1/P1 (X-1): kein registriertes Werkzeug kommt ohne die drei Pflicht-Annotationen durch", () => {
  const found = captureAnnotations({ consultAllowed: true });
  assert.ok(found.size > 0, "es wurden ueberhaupt Werkzeuge registriert");
  for (const [name, annotations] of found) {
    assert.equal(typeof annotations, "object", `${name} traegt ein annotations-Objekt`);
    assert.ok(annotations !== null, `${name}: annotations ist nicht null`);
    assert.equal(typeof annotations.title, "string", `${name} traegt einen title`);
    assert.equal(typeof annotations.readOnlyHint, "boolean", `${name} traegt readOnlyHint`);
    assert.equal(typeof annotations.destructiveHint, "boolean", `${name} traegt destructiveHint`);
    assert.equal(typeof annotations.openWorldHint, "boolean", `${name} traegt openWorldHint`);
  }
});

test("P0-1 (E2E): tools/list liefert ueber die echte /mcp-Route fuer JEDES Werkzeug Annotations", async () => {
  const srv = await startServer({ seed: seedState({}) });
  try {
    const result = await readToolResult(
      await mcpPost(`${srv.localUrl}/mcp`, null, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    );
    assert.ok(result.tools.length > 0, "tools/list liefert Werkzeuge");
    const alle = { ...EXPECTED_ANNOTATIONS, ...EXPECTED_CONSULT_ANNOTATIONS };
    for (const tool of result.tools) {
      assert.ok(alle[tool.name], `${tool.name} ist in der Erwartungstabelle`);
      assert.deepEqual(tool.annotations, alle[tool.name], tool.name);
    }
    const namen = result.tools.map((entry) => entry.name);
    for (const legacy of ["cancel_call", "list_action_items"])
      assert.ok(namen.includes(legacy), `${legacy} erscheint in tools/list`);
  } finally {
    await srv.stop();
  }
});

test("P1 (N-1/X-1/N-3/N-4/N-11): tools/list ueber /mcp liefert mit Consult-Faehigkeit alle 11 Werkzeuge - Annotationen vollstaendig und tabellentreu, await_call_event nennt seinen Schreibeffekt", async () => {
  const srv = await startServer({
    seed: seedState({}),
    env: { CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" },
  });
  try {
    const result = await readToolResult(
      await mcpPost(`${srv.localUrl}/mcp`, null, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    );
    const alle = { ...EXPECTED_ANNOTATIONS, ...EXPECTED_CONSULT_ANNOTATIONS };
    assert.deepEqual(
      result.tools.map((entry) => entry.name).sort(),
      Object.keys(alle).sort(),
      "genau die elf erwarteten Werkzeuge, keins mehr, keins weniger",
    );
    for (const tool of result.tools) {
      assert.equal(typeof tool.annotations.readOnlyHint, "boolean", `${tool.name}.readOnlyHint`);
      assert.equal(
        typeof tool.annotations.destructiveHint,
        "boolean",
        `${tool.name}.destructiveHint`,
      );
      assert.equal(
        typeof tool.annotations.openWorldHint,
        "boolean",
        `${tool.name}.openWorldHint`,
      );
      assert.deepEqual(tool.annotations, alle[tool.name], tool.name);
    }
    const awaitCallEvent = result.tools.find((entry) => entry.name === "await_call_event");
    assert.ok(awaitCallEvent, "await_call_event ist registriert");
    assert.match(
      awaitCallEvent.description,
      /writes to the call record/,
      "await_call_event.description nennt den Schreibeffekt in Klartext",
    );
    assert.doesNotMatch(
      awaitCallEvent.description,
      /same question is not (handed out|delivered)/,
      "await_call_event.description behauptet keine serverseitige Entdopplung",
    );
  } finally {
    await srv.stop();
  }
});

test("P1 (DP-1): stdio-ctx und HTTP-ctx liefern fuer dasselbe Werkzeug identische Annotationen", () => {
  const stdioAnnotations = captureAnnotations({ uiHost: { enabled: false } });
  const httpAnnotations = captureAnnotations({
    consultAllowed: true,
    uiHost: { enabled: true },
  });
  const gemeinsam = [...stdioAnnotations.keys()].filter((name) => httpAnnotations.has(name));
  assert.ok(gemeinsam.length > 0, "es gibt gemeinsame Werkzeuge auf beiden Pfaden");
  for (const name of gemeinsam)
    assert.deepEqual(stdioAnnotations.get(name), httpAnnotations.get(name), name);
});
