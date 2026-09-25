// E2 (P0-1) - Regressions-Anker ueber die Tool-Annotations.
//
// OpenAI fuehrt fehlende Nebenwirkungs-Kennzeichnung woertlich als haeufigen
// Ablehnungsgrund; vor dieser Phase trug KEIN Werkzeug annotations. Der Test haelt die
// Werte je Werkzeug fest, damit sie nicht wegdriften - und dass ueberhaupt KEIN Werkzeug
// ohne annotations durchkommt (auch ein spaeter hinzugefuegtes 13.).
//
// Die Erwartung steht hier als LITERAL, absichtlich nicht aus src importiert: ein Test,
// der seine Erwartung aus dem Pruefling zieht, belegt nichts.
//
// Harness wie test/p15-mcp-tool-descriptions-en.test.js: ein fakeServer faengt BEIDE
// Registrierungswege ab. Der Legacy-Weg heisst jetzt
// server.tool(name, desc, schema, annotations, handler) - die Annotations sitzen an der
// VIERTEN Position (frozen SDK-API, s. Kommentar am tool()-Helfer in src/mcp-tools.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerTools } from "../src/mcp-tools.js";
import { startServer, seedState, mcpPost, readToolResult } from "./helpers.js";

const EXPECTED_ANNOTATIONS = {
  place_call: {
    title: "Place a phone call",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  get_call_status: { title: "Get call status", readOnlyHint: true, openWorldHint: true },
  get_transcript: { title: "Get call transcript", readOnlyHint: true, openWorldHint: true },
  cancel_call: {
    title: "Cancel a call",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  get_my_number: { title: "Agent phone number", readOnlyHint: true, openWorldHint: false },
  list_calls: { title: "List calls", readOnlyHint: true, openWorldHint: false },
  check_inbox: {
    title: "Check inbox",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  list_action_items: { title: "List action items", readOnlyHint: true, openWorldHint: false },
  get_calendar: { title: "Get calendar", readOnlyHint: true, openWorldHint: false },
  get_agent_status: { title: "Get agent status", readOnlyHint: true, openWorldHint: false },
};

// await_call_event ist NICHT readOnly: seine Route schreibt (askDeliveredAt persistent,
// consultPolledAtMs ephemer). destructive=false (rein additive Marker), idempotent=true
// (askDeliveredAt wird nur EINMAL gesetzt) - genau das darf ein pollender Client wissen.
const EXPECTED_CONSULT_ANNOTATIONS = {
  await_call_event: {
    title: "Wait for call update",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  answer_consult: {
    title: "Answer call question",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

function captureAnnotations(ctx = {}) {
  const annotationsByTool = new Map();
  const fakeServer = {
    // server.tool(name, desc, schema, annotations, handler) - die eingefrorene
    // 5-Positions-API. Restparameter statt fuenf benannter Positionen (max-params 3).
    tool: (name, ...rest) => {
      const [, , annotations] = rest;
      annotationsByTool.set(name, annotations);
    },
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

// Der eigentliche Drift-Schutz: ein spaeter hinzugefuegtes Werkzeug ohne annotations
// faellt hier auf, auch wenn niemand die Tabellen oben erweitert.
test("P0-1: kein registriertes Werkzeug kommt ohne Annotations durch", () => {
  const found = captureAnnotations({ consultAllowed: true });
  assert.ok(found.size > 0, "es wurden ueberhaupt Werkzeuge registriert");
  for (const [name, annotations] of found) {
    assert.equal(typeof annotations, "object", `${name} traegt ein annotations-Objekt`);
    assert.ok(annotations !== null, `${name}: annotations ist nicht null`);
    assert.equal(typeof annotations.title, "string", `${name} traegt einen title`);
    assert.equal(typeof annotations.readOnlyHint, "boolean", `${name} traegt readOnlyHint`);
    assert.equal(typeof annotations.openWorldHint, "boolean", `${name} traegt openWorldHint`);
  }
});

// Der Beweis ueber die ECHTE Route (P10-Lerntest fuer die eingefrorene SDK-API): der
// Legacy-Weg server.tool(...) nimmt die Annotations als VIERTES von fuenf Positions-
// Argumenten. Parst das SDK sie anders, verschwinden sie hier still - oder der Handler
// wandert an die falsche Position. Beides faellt nur ueber tools/list am laufenden Server auf.
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
    // Die zwei Werkzeuge auf dem Legacy-Registrierweg MUESSEN dabei sein - sie sind der
    // eigentliche Beleg (der registerTool-Weg traegt annotations ohnehin im config-Objekt).
    const namen = result.tools.map((entry) => entry.name);
    for (const legacy of ["cancel_call", "list_action_items"])
      assert.ok(namen.includes(legacy), `${legacy} erscheint in tools/list`);
  } finally {
    await srv.stop();
  }
});
