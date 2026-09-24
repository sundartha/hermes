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
// Harness wie test/p15-mcp-tool-descriptions-en.test.js: ein fakeServer faengt den
// Registrierweg ab. Seit P2 laufen ALLE Werkzeuge ueber registerTool(config), annotations
// sitzen einheitlich im config-Objekt - der fakeServer faengt deshalb nur noch
// registerTool ab (frueherer server.tool()-Legacy-Weg entfernt, s. Kommentar am
// uiTool()-Helfer in src/mcp-tools.js).
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
  get_calendar: {
    title: "Get calendar",
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

// await_call_event ist NICHT readOnly: seine Route schreibt (askDeliveredAt persistent,
// consultPolledAtMs ephemer). destructive=false (rein additive Marker), idempotent=true
// (askDeliveredAt wird nur EINMAL gesetzt). openWorldHint=false (P1/N-4): der Zugriff
// bleibt der tenant-lokale Store (GET /api/calls/:id), auch wenn ueber einen Anruf nach
// draussen berichtet wird. answer_consult: destructiveHint=true (P1/N-3) - der
// eingespeiste Text wird am Telefon ausgesprochen und ist nicht zuruecknehmbar.
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

// Der eigentliche Drift-Schutz: ein spaeter hinzugefuegtes Werkzeug ohne annotations
// faellt hier auf, auch wenn niemand die Tabellen oben erweitert.
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

// Der Beweis ueber die ECHTE Route (P10-Lerntest fuer die SDK-API): registerTool()
// verwirft unbekannte Config-Felder still (P0/U-2). Parst das SDK annotations anders,
// verschwinden sie hier still - das faellt nur ueber tools/list am laufenden Server auf.
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
    // cancel_call/list_action_items (die zwei Werkzeuge, die vor P2 auf dem Legacy-Weg
    // registriert wurden) MUESSEN dabei sein - nach der Migration auf registerTool()
    // ist das keine Formalitaet mehr, sondern derselbe Weg wie alle anderen zehn.
    const namen = result.tools.map((entry) => entry.name);
    for (const legacy of ["cancel_call", "list_action_items"])
      assert.ok(namen.includes(legacy), `${legacy} erscheint in tools/list`);
  } finally {
    await srv.stop();
  }
});

// P1 (S8): der Vollstaendigkeitsbeweis mit FREIGESCHALTETER Consult-Faehigkeit ueber die
// echte Route - der Bootstrap-Tenant loest auf OWNER_PROFILE auf (routes/mcp.js,
// store/defaults.js), consultAllowedFor() wird damit true (consult/gate.js). Das liefert
// GENAU die zwoelf Werkzeuge. Die Schleifen laufen ueber result.tools, NICHT ueber eine
// handgepflegte Namensliste - ein registerTool()-Konfigobjekt verwirft unbekannte Felder
// STILL (P0/U-2), ein Test am Config-Objekt beweist deshalb nichts ueber das, was der
// Host sieht.
test("P1 (N-1/X-1/N-3/N-4/N-11): tools/list ueber /mcp liefert mit Consult-Faehigkeit alle 12 Werkzeuge - Annotationen vollstaendig und tabellentreu, await_call_event nennt seinen Schreibeffekt", async () => {
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
    // (1) Mengengleichheit gegen die Vereinigung beider Tabellen - nicht die Zahl 12
    // gegen eine Konstante, damit sowohl ein fehlendes als auch ein dreizehntes Werkzeug
    // auffaellt.
    assert.deepEqual(
      result.tools.map((entry) => entry.name).sort(),
      Object.keys(alle).sort(),
      "genau die zwoelf erwarteten Werkzeuge, keins mehr, keins weniger",
    );
    for (const tool of result.tools) {
      // (2) X-1/N-1 am ausgelieferten JSON: alle drei Pflicht-Annotationen sind Booleans.
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
      // (3) Wahrheitstabelle Zeile fuer Zeile - openWorldHint (S1) und
      // answer_consult.destructiveHint (S3) eingeschlossen.
      assert.deepEqual(tool.annotations, alle[tool.name], tool.name);
    }
    // (4) N-11 am Wire-Text: der Schreibeffekt steht in Klartext in der Beschreibung.
    const awaitCallEvent = result.tools.find((entry) => entry.name === "await_call_event");
    assert.ok(awaitCallEvent, "await_call_event ist registriert");
    assert.match(
      awaitCallEvent.description,
      /writes to the call record/,
      "await_call_event.description nennt den Schreibeffekt in Klartext",
    );
    // Review-Befund Runde 1 (P1): die Entdopplung leistet ALLEIN after_event_id
    // (state-ops.js:pendingConsult filtert nur auf status/seq, askDeliveredAt spielt
    // dort keine Rolle) - die Beschreibung darf keine serverseitige Entdopplung
    // behaupten, sonst widerspricht sie der eigenen Parameter-Beschreibung.
    assert.doesNotMatch(
      awaitCallEvent.description,
      /same question is not (handed out|delivered)/,
      "await_call_event.description behauptet keine serverseitige Entdopplung",
    );
  } finally {
    await srv.stop();
  }
});

// P1 (S9): belegt statt behauptet, dass stdio und HTTP /mcp fuer dasselbe Werkzeug
// dieselben Annotationen liefern - der ctx entscheidet nur, WELCHE Werkzeuge registriert
// werden, nie MIT WELCHEN WERTEN. Ein echter stdio-JSON-RPC-Harness wird hier bewusst
// NICHT gebaut (tasks/openai-p1-spec.md Abschnitt 2): es gibt genau eine Werte-Quelle
// (TOOL_ANNOTATIONS, 0 Treffer fuer "annotations" ausserhalb src/mcp-tools.js) und genau
// zwei registerTools()-Aufrufer (src/mcp-server.js:26, src/routes/mcp.js:151) - die Werte
// koennen zwischen den Transporten nicht divergieren.
test("P1 (DP-1): stdio-ctx und HTTP-ctx liefern fuer dasselbe Werkzeug identische Annotationen", () => {
  // Exakt wie src/mcp-server.js:26-28 registerTools() aufruft.
  const stdioAnnotations = captureAnnotations({ uiHost: { enabled: false } });
  // Exakt wie src/routes/mcp.js:151 registerTools() mit voller Consult-Faehigkeit aufruft.
  const httpAnnotations = captureAnnotations({
    allowCalendar: true,
    consultAllowed: true,
    uiHost: { enabled: true },
  });
  const gemeinsam = [...stdioAnnotations.keys()].filter((name) => httpAnnotations.has(name));
  assert.ok(gemeinsam.length > 0, "es gibt gemeinsame Werkzeuge auf beiden Pfaden");
  for (const name of gemeinsam)
    assert.deepEqual(stdioAnnotations.get(name), httpAnnotations.get(name), name);
});
