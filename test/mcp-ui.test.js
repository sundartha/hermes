// P1 MCP Rich-UI duenne Scheibe: get_call_status auf Stufe 0 (structuredContent +
// schema-validiert) + Stufe 1 (ui://-Resource fuer faehige Hosts) mit fail-closed
// Fallback. Kein echter MCP-Transport/Host: ein fakeServer faengt registerTool-
// (config inkl. outputSchema/_meta) + registerResource-Aufrufe ein, ein lokaler
// HTTP-Mock spielt das Gateway (Spec Abschnitt 8 - Seam beweist sich ueber Tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { z } from "zod";
import { registerTools } from "../src/mcp-tools.js";
import { uiRendererFor } from "../src/ui/registry.js";
import {
  mcpNativeRenderer,
  WIDGET_AGENT_STATUS,
} from "../src/ui/adapters/mcp-native.js";
import { chatgptRenderer } from "../src/ui/adapters/chatgpt.js";
// Neue read-only Widget-Ids aus der kanonischen Quelle (widget-catalog.js).
import {
  WIDGET_MY_NUMBER,
  WIDGET_CALLS,
  WIDGET_CALENDAR,
  WIDGET_CALL,
} from "../src/ui/widget-catalog.js";
import {
  UI_MIME,
  CHATGPT_UI_MIME,
  CHATGPT_META_KEY,
  capabilityDeclaresUi,
  capabilityDeclaresChatgptUi,
  uiResourceUri,
  uiServerExtension,
} from "../src/ui/contract.js";

const RESOURCE_URI_CALL = uiResourceUri(WIDGET_CALL); // ui://hermes/call

// Abwesenheits-Pin (Kritik N1): KEINE feste Zahl ("~10") vorschreiben, sondern generisch
// jede "alle N Sekunden"-Polling-Anweisung verbieten - robuster als ein Positiv-String-Pin.
const NO_POLLING_CADENCE = /alle ~?\d+\s*Sekunden/;

// Minimal gueltige place_call-Aufruf-Form fuer die Tests dieser Datei (EINE Quelle,
// G5/S2): Argumente UND der dazu passende Gateway-Mock-Body. place_call postet an
// POST /api/calls und liest nur r.callId - anders als get_call_status/get_transcript,
// die GET /api/calls/:id lesen und ein RICH_CALL/RICH_TRANSCRIPT-Call-Objekt erwarten.
const PLACE_CALL_ARGS = { to: "+4917212345678", objective: "Testanruf" };
const PLACE_CALL_MOCK = { callId: "call_1" };

// Faehiger Host: deklariert die UI-Capability mit UI_MIME (SEP-1865 initialize).
const CAPABLE_CAPS = {
  extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [UI_MIME] } },
};
const capableHost = () => ({ enabled: true, capabilities: CAPABLE_CAPS });

// Faengt registerTool(name, config, handler) + registerResource(name, uri, config,
// readCb) ein. tool() (Bestand) faengt es ueber server.tool ab (hier ungenutzt).
function captureUi(ctx) {
  const tools = new Map(); // name -> { config, desc, handler }
  const resources = []; // { name, uri, config, readCallback }
  const fakeServer = {
    tool(name, desc, _schema, handler) {
      tools.set(name, { config: null, desc, handler });
    },
    registerTool(name, config, handler) {
      tools.set(name, { config, handler });
    },
    registerResource(name, uri, config, readCallback) {
      resources.push({ name, uri, config, readCallback });
    },
  };
  registerTools(fakeServer, ctx);
  return { tools, resources };
}

// Gateway-Mock mit konfigurierbarem Body je Pfad (Default = ein laufender Call mit
// PII-Zusatzfeldern fuer den Whitelist-Test).
const RICH_CALL = {
  status: "active",
  answeredAt: "2026-06-26T10:00:00.000Z",
  startedAt: "2026-06-26T09:59:50.000Z",
  transcript: [
    { role: "agent", text: "Guten Tag, hier ist Hermes.", at: "2026-06-26T10:00:01.000Z" },
    { role: "callee", text: "Hallo, worum geht es?", at: "2026-06-26T10:00:05.000Z" },
  ],
  // Felder, die NIEMALS nach aussen duerfen (Whitelist-Test AC4):
  email: "secret@example.com",
  apiKey: "sk_live_LEAK",
  tenantId: "tenant-XYZ",
  audioUrl: "https://example.com/recording.wav",
};

async function startGatewayMock(body) {
  // requests: Mitschnitt der eingehenden Requests (method/url/headers) fuer den
  // Callback-Beweis (P4-AC5: cancel_call laeuft als authentisierter POST auf den
  // bestehenden /cancel-Pfad, kein Seitenkanal). Additiv - Bestandsaufrufer ignorieren.
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}

async function withGateway(body, fn) {
  return withGatewayCapture(body, () => fn());
}

// Wie withGateway, reicht aber den Mock an fn (fuer den Request-Mitschnitt, AC5).
async function withGatewayCapture(body, fn) {
  const mock = await startGatewayMock(body);
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    return await fn(mock);
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
}

const callStatusOutput = z.object({
  call_id: z.string(),
  status: z.string(),
  duration_s: z.number(),
  last_transcript_lines: z.array(z.string()),
  failure_reason: z.string().nullable(),
});

// callOutput (place_call, W2): Obermenge aus callStatusOutput per Spread (G5/S2, keine
// erneute Feld-Duplizierung) plus den beiden Abschluss-Feldern aus dem get_transcript-
// Kontrakt (nullable, der Anruf hat gerade erst begonnen) plus dem additiven
// context_received-Meta (I10, call-quality Impl-1).
const contextReceivedOutput = z.object({
  active: z.boolean(),
  summary: z.boolean(),
  key_facts_count: z.number(),
  recipient_relationship: z.boolean(),
  desired_outcome: z.boolean(),
});
const callOutput = z.object({
  ...callStatusOutput.shape,
  result_summary: z.string().nullable(),
  objective_achieved: z.union([z.boolean(), z.string()]).nullable(),
  context_received: contextReceivedOutput,
});

test("T-P1-UI-AC1: Stufe 0 additiv - Textblock (3 Felder) + schema-validiertes structuredContent", async () => {
  await withGateway(RICH_CALL, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { config, handler } = tools.get("get_call_status");
    assert.ok(config.outputSchema, "outputSchema am config deklariert");
    const result = await handler({ call_id: "call_1" });

    assert.equal(result.content[0].type, "text", "Textblock bleibt erhalten");
    const textObj = JSON.parse(result.content[0].text);
    assert.deepEqual(
      Object.keys(textObj).sort(),
      ["duration_s", "last_transcript_lines", "status"],
      "Textblock unveraendert: genau die heutige 3-Feld-Sicht",
    );

    assert.ok(result.structuredContent, "structuredContent vorhanden");
    assert.deepEqual(Object.keys(result.structuredContent).sort(), [
      "call_id",
      "duration_s",
      "failure_reason",
      "last_transcript_lines",
      "status",
    ]);
    assert.equal(result.structuredContent.call_id, "call_1");
    assert.equal(result.structuredContent.status, "in_progress");
    // CDF1 (Spec b): laufender/erfolgreicher Call traegt KEINEN Fehlergrund -> null.
    assert.equal(result.structuredContent.failure_reason, null, "aktiver Call: failure_reason null");
    assert.doesNotThrow(
      () => callStatusOutput.parse(result.structuredContent),
      "structuredContent validiert gegen outputSchema",
    );
  });
});

test("T-CDF1-UI: Fehlergrund (Spec c) - failure_reason erscheint, PII bleibt gestrippt", async () => {
  // Eigener Mock-Body: fehlgeschlagener Call mit gesetztem failureReason + denselben
  // PII-Zusatzfeldern wie RICH_CALL. Der Grund wird ueber die Whitelist exponiert; die
  // PII-Felder duerfen NIE durchschlagen (Whitelist, nicht Blacklist).
  const FAILED_CALL = {
    status: "failed",
    startedAt: "2026-06-26T09:59:50.000Z",
    endedAt: "2026-06-26T10:00:20.000Z",
    failureReason: "failed:603",
    transcript: [],
    email: "secret@example.com",
    apiKey: "sk_live_LEAK",
    tenantId: "tenant-XYZ",
    audioUrl: "https://example.com/recording.wav",
  };
  await withGateway(FAILED_CALL, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("get_call_status");
    const result = await handler({ call_id: "call_1" });

    assert.equal(result.structuredContent.failure_reason, "failed:603", "Grund exponiert");
    assert.doesNotThrow(() => callStatusOutput.parse(result.structuredContent));

    const serialized = JSON.stringify(result);
    for (const leak of ["secret@example.com", "sk_live_LEAK", "tenant-XYZ", "recording.wav"]) {
      assert.ok(!serialized.includes(leak), `kein Leck von ${leak} im Tool-Result`);
    }
  });
});

test("T-P1-UI-AC2: place_call traegt jetzt die vereinte Live-Karte (_meta); get_call_status verliert ihr eigenes _meta (W2)", async () => {
  await withGateway(RICH_CALL, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });

    const callResources = resources.filter((r) => r.uri === RESOURCE_URI_CALL);
    assert.equal(callResources.length, 1, "genau eine call-Resource (place_call)");
    assert.equal(callResources[0].config.mimeType, UI_MIME);
    assert.equal(
      tools.get("place_call").config._meta.ui.resourceUri,
      RESOURCE_URI_CALL,
      "place_call: _meta zeigt auf die vereinte Karte",
    );

    assert.equal(tools.get("get_call_status").config._meta, undefined, "get_call_status: kein _meta mehr");
  });
});

test("T-P1-UI-AC3: place_call Stufe-0-only bei Master-Schalter aus / kein hostHint (stdio); get_call_status bleibt ueberall ohne _meta", async () => {
  const cases = {
    "stdio (uiHost=null)": null,
    "Master-Schalter aus trotz Capability": { enabled: false, capabilities: CAPABLE_CAPS },
  };
  await withGateway(PLACE_CALL_MOCK, async () => {
    for (const [label, uiHost] of Object.entries(cases)) {
      const { tools, resources } = captureUi(uiHost === null ? undefined : { uiHost });
      const { config, handler } = tools.get("place_call");
      assert.equal(resources.filter((r) => r.uri === RESOURCE_URI_CALL).length, 0, `${label}: keine call-Resource`);
      assert.ok(!config._meta, `${label}: place_call kein _meta`);

      const result = await handler(PLACE_CALL_ARGS);
      assert.equal(result.content[0].type, "text", `${label}: Text-Fallback bleibt nutzbar (AC8)`);
      assert.deepEqual(
        JSON.parse(result.content[0].text),
        { call_id: "call_1", status: "dialing" },
        `${label}: Text-Block byte-identisch zum Bestand`,
      );
      assert.ok(result.structuredContent, `${label}: structuredContent bleibt (Byte-Invariante 6.4)`);
      assert.equal(result.structuredContent.call_id, "call_1");
      assert.equal(result.structuredContent.status, "dialing");

      assert.equal(
        tools.get("get_call_status").config._meta,
        undefined,
        `${label}: get_call_status bleibt ohne _meta`,
      );
    }
  });
});

test("T-UI-stateless: Master-Schalter an OHNE caps (realer stateless tools/list) haengt Widget bei place_call trotzdem an", async () => {
  // Der Live-Bug, festgenagelt: der stateless Transport (sessionIdGenerator=undefined)
  // fuehrt die initialize-Capabilities NICHT zum tools/list-POST mit, dort ist
  // uiHost.capabilities leer/undefined. Das Widget-_meta UND die ui://-Resource muessen
  // trotzdem erscheinen - sonst sieht der Nutzer nie ein Widget (nur Text).
  const cases = {
    "enabled, capabilities undefined": { enabled: true },
    "enabled, capabilities leer": { enabled: true, capabilities: {} },
  };
  await withGateway(PLACE_CALL_MOCK, async () => {
    for (const [label, uiHost] of Object.entries(cases)) {
      const { tools, resources } = captureUi({ uiHost });

      const place = tools.get("place_call");
      assert.equal(place.config._meta?.ui?.resourceUri, RESOURCE_URI_CALL, `${label}: place_call _meta zeigt auf die URI`);
      assert.ok(resources.some((r) => r.uri === RESOURCE_URI_CALL), `${label}: ui://-Resource registriert`);
      const placeResult = await place.handler(PLACE_CALL_ARGS);
      assert.ok(placeResult.structuredContent, `${label}: place_call structuredContent bleibt`);

      const status = tools.get("get_call_status");
      assert.equal(status.config._meta, undefined, `${label}: get_call_status bleibt ohne _meta (W2)`);
    }
  });
});

test("T-P1-UI-AC4: Whitelist - keine fremden/PII-Felder in structuredContent/Text (get_call_status)", async () => {
  await withGateway(RICH_CALL, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("get_call_status");
    const result = await handler({ call_id: "call_1" });

    const serialized = JSON.stringify(result);
    for (const leak of ["secret@example.com", "sk_live_LEAK", "tenant-XYZ", "recording.wav"]) {
      assert.ok(!serialized.includes(leak), `kein Leck von ${leak} im Tool-Result`);
    }
    assert.deepEqual(Object.keys(result.structuredContent).sort(), [
      "call_id",
      "duration_s",
      "failure_reason",
      "last_transcript_lines",
      "status",
    ]);
  });
});

test("T-P1-UI-AC5: Fehlerpfad - degradierte Antwort -> isError, text-only, auch bei faehigem Host", async () => {
  // Body ohne transcript -> requireFields wirft -> wrapHandler liefert isError.
  await withGateway({ status: "active" }, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("get_call_status");
    const result = await handler({ call_id: "call_1" });
    assert.ok(result.isError, "degradierte Antwort -> isError");
    assert.ok(!result.structuredContent, "Fehlerpfad ohne structuredContent");
    const txt = result.content.map((c) => c.text).join("\n");
    assert.doesNotMatch(txt, /Cannot read|undefined|TypeError/i, "generischer, provider-freier Text");
  });
});

test("T-P1-UI-seam: uiRendererFor Default = mcp-nativ hinter dem Master-Schalter", () => {
  // Stufe 0 (null) NUR bei Master-Schalter aus / kein hostHint.
  assert.equal(uiRendererFor({ enabled: false, capabilities: CAPABLE_CAPS }), null);
  assert.equal(uiRendererFor(null), null, "kein hostHint -> null");
  // Master-Schalter an -> Default mcp-nativ, UNABHAENGIG von der Capability (stateless-
  // tauglich: caps fehlen auf dem tools/list-POST trotzdem erscheint das Widget).
  assert.equal(uiRendererFor(capableHost()), mcpNativeRenderer);
  assert.equal(uiRendererFor({ enabled: true }), mcpNativeRenderer, "ohne caps -> mcp-nativ");
  assert.equal(uiRendererFor({ enabled: true, capabilities: {} }), mcpNativeRenderer, "leere caps -> mcp-nativ");
  assert.equal(
    uiRendererFor({
      enabled: true,
      capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html"] } } },
    }),
    mcpNativeRenderer,
    "fremder mimeType -> Default mcp-nativ (kein ChatGPT-Marker)",
  );

  assert.equal(mcpNativeRenderer.hasWidget(WIDGET_CALL), true);
  assert.equal(mcpNativeRenderer.hasWidget("unknown"), false);

  assert.equal(capabilityDeclaresUi(undefined), false, "Grenzfall: undefined -> false");
  assert.equal(capabilityDeclaresUi({}), false);
});

test("T-UI-server-cap: Server deklariert io.modelcontextprotocol/ui (Pflicht fuers Host-Rendern)", () => {
  // Der initialize-Response MUSS die Extension mit UI_MIME tragen, sonst rendert der Host
  // das ui://-Widget NICHT - auch bei korrektem Tool-_meta (MCP Apps / SEP-1865, apps.mdx).
  // Symmetrie: die eigene Server-Deklaration erfuellt den Client-Detektor (EINE Quelle).
  const ext = uiServerExtension();
  assert.deepEqual(ext, { "io.modelcontextprotocol/ui": { mimeTypes: [UI_MIME] } });
  assert.equal(capabilityDeclaresUi({ extensions: ext }), true, "Server-Decl erfuellt Client-Detektor");
});

// ===== P2: get_transcript ueber den BESTEHENDEN Seam (Seam-Wiederverwendung) =====
// Datensatz eines ABGESCHLOSSENEN Calls MIT Roh-Transkript-Zeilen + Summary/Ziel +
// PII. Der Whitelist-Test beweist, dass NUR Summary/objective/call_id durchkommen,
// das Roh-Transkript NIE - auch wenn der Datensatz es noch traegt (DSGVO).
const RICH_TRANSCRIPT = {
  status: "completed",
  summary: "Termin Donnerstag 14:30 bei Salon Bella gebucht.",
  objectiveAchieved: true,
  transcript: [
    { role: "agent", text: "Guten Tag, ich rufe im Auftrag von Antonio an.", at: "2026-06-26T10:00:01.000Z" },
    { role: "callee", text: "Donnerstag 14:30 koennen wir machen.", at: "2026-06-26T10:00:05.000Z" },
  ],
  // Felder, die NIEMALS nach aussen duerfen (Whitelist-Test):
  email: "secret@example.com",
  apiKey: "sk_live_LEAK",
  tenantId: "tenant-XYZ",
  audioUrl: "https://example.com/recording.wav",
};

const transcriptOutput = z.object({
  call_id: z.string(),
  result_summary: z.string(),
  objective_achieved: z.union([z.boolean(), z.string()]),
});

test("T-P2-UI-AC1: Stufe 0 additiv - Textblock (Summary/Ziel) + schema-validiertes structuredContent", async () => {
  await withGateway(RICH_TRANSCRIPT, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { config, handler } = tools.get("get_transcript");
    assert.ok(config.outputSchema, "outputSchema am config deklariert");
    const result = await handler({ call_id: "call_1" });

    assert.equal(result.content[0].type, "text", "Textblock bleibt erhalten");
    const textObj = JSON.parse(result.content[0].text);
    assert.deepEqual(
      Object.keys(textObj).sort(),
      ["objective_achieved", "result_summary"],
      "Textblock: Summary/Ziel-Sicht ohne call_id (kein Roh-Transkript)",
    );

    assert.ok(result.structuredContent, "structuredContent vorhanden");
    assert.deepEqual(Object.keys(result.structuredContent).sort(), [
      "call_id",
      "objective_achieved",
      "result_summary",
    ]);
    assert.equal(result.structuredContent.call_id, "call_1");
    assert.equal(result.structuredContent.objective_achieved, true);
    assert.doesNotThrow(
      () => transcriptOutput.parse(result.structuredContent),
      "structuredContent validiert gegen outputSchema",
    );
  });
});

test("T-P2-UI-AC2: get_transcript verliert ihr _meta (W2) - keine eigene Resource mehr ueber registerTools", async () => {
  await withGateway(RICH_TRANSCRIPT, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { config } = tools.get("get_transcript");
    assert.equal(config._meta, undefined, "get_transcript: kein _meta mehr");
  });
});

test("T-P2-UI-AC3: Fallback fail-closed - kein _meta, structuredContent voll", async () => {
  const cases = {
    "stdio (uiHost=null)": null,
    "Master-Schalter aus trotz Capability": { enabled: false, capabilities: CAPABLE_CAPS },
  };
  await withGateway(RICH_TRANSCRIPT, async () => {
    for (const [label, uiHost] of Object.entries(cases)) {
      const { tools } = captureUi(uiHost === null ? undefined : { uiHost });
      const { config, handler } = tools.get("get_transcript");
      assert.ok(!config._meta, `${label}: kein _meta`);
      const result = await handler({ call_id: "call_1" });
      assert.ok(result.structuredContent, `${label}: structuredContent bleibt`);
      assert.equal(result.structuredContent.call_id, "call_1");
    }
  });
});

test("T-P2-UI-AC4: Whitelist (DSGVO) - Roh-Transkript NIE in structuredContent/Text (get_transcript)", async () => {
  await withGateway(RICH_TRANSCRIPT, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("get_transcript");
    const result = await handler({ call_id: "call_1" });

    const serialized = JSON.stringify(result);
    // Roh-Transkript-Zeilen (role/text) UND PII duerfen NIRGENDS auftauchen.
    for (const leak of [
      "Donnerstag 14:30 koennen wir machen.",
      "ich rufe im Auftrag von Antonio an",
      "callee",
      "secret@example.com",
      "sk_live_LEAK",
      "tenant-XYZ",
      "recording.wav",
    ]) {
      assert.ok(!serialized.includes(leak), `kein Leck von "${leak}" im Tool-Result`);
    }
    assert.deepEqual(Object.keys(result.structuredContent).sort(), [
      "call_id",
      "objective_achieved",
      "result_summary",
    ]);
  });
});

test("T-P2-UI-AC5: Fehlerpfad - degradierte Antwort -> isError, text-only, auch bei faehigem Host", async () => {
  // Body ohne transcript -> requireFields wirft -> wrapHandler liefert isError.
  await withGateway({ status: "completed" }, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("get_transcript");
    const result = await handler({ call_id: "call_1" });
    assert.ok(result.isError, "degradierte Antwort -> isError");
    assert.ok(!result.structuredContent, "Fehlerpfad ohne structuredContent");
    const txt = result.content.map((c) => c.text).join("\n");
    assert.doesNotMatch(txt, /Cannot read|undefined|TypeError/i, "generischer, provider-freier Text");
  });
});

// ===== P3: zweiter Host-Adapter (ChatGPT Apps SDK) hinter dem UiRenderer-Port =====
// Beweist: dasselbe Widget rendert in BEIDEN Host-Konventionen; der mcp-native Pfad
// bleibt byte-kompatibel (die P1/P2-Tests oben sind unveraendert), nur die Host-eigene
// _meta-Form + der mimeType unterscheiden sich.
const CHATGPT_CAPS = {
  extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [CHATGPT_UI_MIME] } },
};
const chatgptHost = () => ({ enabled: true, capabilities: CHATGPT_CAPS });

// Liest die statische ui://-Resource eines Renderers fuer ein Widget zurueck (readback).
function readbackResource(renderer, widgetId) {
  return new Promise((resolve) => {
    const fakeServer = {
      registerResource(_name, _uri, _config, readCallback) {
        resolve(readCallback());
      },
    };
    renderer.registerResource(fakeServer, widgetId);
  });
}

// Nach W2 traegt ausschliesslich place_call ein Widget-_meta (WIDGET_CALL, vereinte
// Live-Karte) - get_call_status/get_transcript verlieren ihr _meta. P3_WIDGETS spiegelt
// genau diese tatsaechlich verdrahtete Menge; place_call hat eine andere Aufruf-Form
// (to/objective statt call_id) und einen POST- statt GET-Mock-Body, daher args separat.
const P3_WIDGETS = [
  {
    tool: "place_call",
    widgetId: WIDGET_CALL,
    body: { ...PLACE_CALL_MOCK, email: "secret@example.com", apiKey: "sk_live_LEAK", tenantId: "tenant-XYZ" },
    args: PLACE_CALL_ARGS,
  },
];

test("T-P3-AC1: place_call (einziges _meta-tragendes Tool nach W2), mcp-nativer Host - eine Resource + _meta.ui.resourceUri", async () => {
  for (const { tool, widgetId, body } of P3_WIDGETS) {
    await withGateway(body, async () => {
      const { tools, resources } = captureUi({ uiHost: capableHost() });
      const uri = uiResourceUri(widgetId);
      const matching = resources.filter((r) => r.uri === uri);
      assert.equal(matching.length, 1, `${tool}: genau eine Resource`);
      assert.equal(matching[0].config.mimeType, UI_MIME);
      assert.equal(tools.get(tool).config._meta.ui.resourceUri, uri, `${tool}: _meta zeigt darauf`);
    });
  }
});

test("T-P3-AC2: place_call, ChatGPT-Host - eine Resource + flaches openai/outputTemplate", async () => {
  for (const { tool, widgetId, body, args } of P3_WIDGETS) {
    await withGateway(body, async () => {
      const capable = captureUi({ uiHost: capableHost() });
      const chat = captureUi({ uiHost: chatgptHost() });
      const uri = uiResourceUri(widgetId);
      const matching = chat.resources.filter((r) => r.uri === uri);
      assert.equal(matching.length, 1, `${tool}: genau eine Resource`);
      assert.equal(matching[0].config.mimeType, CHATGPT_UI_MIME);
      const meta = chat.tools.get(tool).config._meta;
      assert.equal(meta[CHATGPT_META_KEY], uri, `${tool}: flacher String unter openai/outputTemplate`);
      assert.ok(!meta.ui, `${tool}: kein verschachteltes _meta.ui (das ist mcp-nativ)`);

      const a = await capable.tools.get(tool).handler(args);
      const b = await chat.tools.get(tool).handler(args);
      assert.deepEqual(
        Object.keys(b.structuredContent).sort(),
        Object.keys(a.structuredContent).sort(),
        `${tool}: structuredContent-Keys host-unabhaengig identisch`,
      );
    });
  }
});

test("T-P3-AC3: Registry waehlt GENAU EINEN Adapter pro Host (ChatGPT explizit, sonst mcp-nativ)", () => {
  assert.equal(uiRendererFor(capableHost()), mcpNativeRenderer, "mcp-nativer Host -> mcp-native");
  assert.equal(uiRendererFor(chatgptHost()), chatgptRenderer, "ChatGPT-Host -> chatgpt");
  assert.equal(
    uiRendererFor({
      enabled: true,
      capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html"] } } },
    }),
    mcpNativeRenderer,
    "fremder mimeType (kein ChatGPT-Marker) -> Default mcp-nativ",
  );
  assert.equal(uiRendererFor({ enabled: false, capabilities: CHATGPT_CAPS }), null, "Master-Schalter aus -> null");
  assert.equal(uiRendererFor(null), null, "kein hostHint -> null");
});

test("T-P3-AC4: Whitelist unveraendert auch im ChatGPT-Pfad (place_call, kein PII-Leck aus dem Gateway-Body)", async () => {
  const leaks = {
    place_call: ["secret@example.com", "sk_live_LEAK", "tenant-XYZ"],
  };
  for (const { tool, body, args } of P3_WIDGETS) {
    await withGateway(body, async () => {
      const capable = captureUi({ uiHost: capableHost() });
      const chat = captureUi({ uiHost: chatgptHost() });
      const a = await capable.tools.get(tool).handler(args);
      const b = await chat.tools.get(tool).handler(args);
      const serialized = JSON.stringify(b);
      for (const leak of leaks[tool]) {
        assert.ok(!serialized.includes(leak), `${tool}: kein Leck von "${leak}" im ChatGPT-Result`);
      }
      assert.deepEqual(
        Object.keys(b.structuredContent).sort(),
        Object.keys(a.structuredContent).sort(),
        `${tool}: structuredContent-Keys exakt wie mcp-nativ`,
      );
    });
  }
});

test("T-P3-AC5: gleiche Widget-Bytes in beiden Hosts (Resource-HTML byte-genau)", async () => {
  for (const { widgetId } of P3_WIDGETS) {
    const nativeBack = await readbackResource(mcpNativeRenderer, widgetId);
    const chatBack = await readbackResource(chatgptRenderer, widgetId);
    assert.equal(chatBack.contents[0].mimeType, CHATGPT_UI_MIME, "ChatGPT-readback mimeType");
    const nativeHtml = nativeBack.contents[0].text;
    const chatHtml = chatBack.contents[0].text;
    assert.equal(chatHtml, nativeHtml, `${widgetId}: identische Widget-Bytes in beiden Hosts`);
    assert.ok(chatHtml.startsWith("<!-- @dsCard"), "@dsCard-Marker in Zeile 1");
    assert.ok(!chatHtml.includes("@import"), "kein @import");
    assert.doesNotMatch(chatHtml, /<link[\s>]/, "kein <link>-Element");
    assert.doesNotMatch(chatHtml, /href\s*=/, "kein href-Linkback");
  }
});

test("T-P3-AC6: chatgptRenderer-Grenzfaelle + Detektor", () => {
  assert.equal(chatgptRenderer.hasWidget(WIDGET_CALL), true);
  assert.equal(chatgptRenderer.hasWidget(WIDGET_AGENT_STATUS), true);
  assert.equal(chatgptRenderer.hasWidget("unknown"), false);
  assert.equal(chatgptRenderer.mimeType, CHATGPT_UI_MIME);

  assert.equal(capabilityDeclaresChatgptUi(undefined), false, "Grenzfall: undefined -> false");
  assert.equal(capabilityDeclaresChatgptUi({}), false);
  // Detektoren disjunkt: ein mcp-nativer Host ist KEIN ChatGPT-Host und umgekehrt.
  assert.equal(capabilityDeclaresChatgptUi(CAPABLE_CAPS), false, "mcp-Caps -> kein ChatGPT");
  assert.equal(capabilityDeclaresUi(CHATGPT_CAPS), false, "ChatGPT-Caps -> kein mcp-nativ");
});

// Regressions-Pin fuer die in src/ui/registry.js dokumentierte, bewusst offene Luecke:
// der ChatGPT-Adapter liefert dasselbe Widget-HTML wie mcp-nativ (T-P3-AC5), das seit
// widget-wire NUR NOCH tools/call-postMessage spricht - keine ChatGPT-eigene
// window.openai-Bruecke mehr. Ein echter ChatGPT-Host bekommt damit den Erst-Aufruf
// (Text+structuredContent) wie gewohnt, aber KEINE live-aktualisierende Karte (Self-Poll/
// Cancel/get_transcript bleiben dort stumm). Faellt dieser Test um, weil das HTML wieder
// window.openai enthaelt ODER tools/call nicht mehr der einzige Sendeweg ist, muss die
// Entscheidung in src/ui/registry.js neu getroffen und dort dokumentiert werden - nicht
// stillschweigend hier vorbeigehen.
test("T-P3-AC7: bekannte Luecke gepinnt - ChatGPT-ausgeliefertes Widget-HTML spricht nur tools/call, keine window.openai-Bruecke", async () => {
  for (const { widgetId } of P3_WIDGETS) {
    const chatBack = await readbackResource(chatgptRenderer, widgetId);
    const chatHtml = chatBack.contents[0].text;
    assert.ok(!chatHtml.includes("window.openai"), `${widgetId}: kein window.openai im ChatGPT-Pfad`);
    assert.ok(chatHtml.includes('"tools/call"'), `${widgetId}: einziger Sendeweg bleibt tools/call`);
  }
});

// ===== W3: drittes read-only Widget (get_agent_status) ueber den BESTEHENDEN Seam =====
// Stufe 0 (structuredContent + Backward-Compat-Text) + Stufe 1 (agent-status Widget) bei
// faehigem Host; Fallback Stufe-0 bei unfaehigem. Whitelist beweist Nicht-Durchreichung
// von PII/Secrets/Cross-Tenant-State. Read-only: kein Callback/Button. Erbt W1-Binding.
const RICH_STATE = {
  agent: {
    number: "+18643028341",
    owner: "Antonio",
    voiceEngine: "budget",
    model: "claude-haiku",
    secretAgentField: "agent-LEAK", // darf NIE durch
  },
  usage: { calls: 3, costEur: 2.1, tenantCapEur: 10, internalCounter: 999 },
  settings: {
    allowCalendar: true,
    allowBooking: false,
    allowSummaries: true,
    allowPersonalData: false,
    allowBankData: false,
    secretSetting: "settings-LEAK",
  },
  // Felder, die NIEMALS nach aussen duerfen:
  email: "secret@example.com",
  apiKey: "sk_live_LEAK",
  tenantId: "tenant-XYZ",
  calls: [{ id: "c1", from: "+49170000000" }], // fremder state, nicht durchreichen
};
const RESOURCE_URI_AGENT = uiResourceUri(WIDGET_AGENT_STATUS); // ui://hermes/agent-status
const AGENT_KEYS = [
  "calls",
  "costEur",
  "model",
  "number",
  "owner",
  "permissions",
  "tenantCapEur",
  "voiceEngine",
];
const PERMISSIONS_STR = "Summaries=true, PersoenlicheDaten=false, Bankdaten=false";
const agentStatusOutput = z.object({
  number: z.string().nullable(),
  owner: z.string().nullable(),
  voiceEngine: z.string(),
  model: z.string(),
  calls: z.number(),
  costEur: z.number(),
  tenantCapEur: z.number(),
  permissions: z.string(),
});

test("T-W3-AC1: Stufe 0 additiv - Backward-Compat-Text + schema-validiertes structuredContent", async () => {
  await withGateway(RICH_STATE, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { config, handler } = tools.get("get_agent_status");
    assert.ok(config.outputSchema, "outputSchema am config deklariert");
    const result = await handler({});

    assert.equal(result.content[0].type, "text", "Textblock bleibt erhalten");
    const txt = result.content[0].text;
    assert.match(txt, /Agent-Nummer:/, "Backward-Compat-Format (Agent-Nummer)");
    assert.match(txt, /Berechtigungen:/, "Backward-Compat-Format (Berechtigungen)");

    assert.ok(result.structuredContent, "structuredContent vorhanden");
    assert.deepEqual(Object.keys(result.structuredContent).sort(), AGENT_KEYS);
    assert.equal(result.structuredContent.permissions, PERMISSIONS_STR);
    assert.doesNotThrow(
      () => agentStatusOutput.parse(result.structuredContent),
      "structuredContent validiert gegen outputSchema",
    );
  });
});

test("T-W3-AC2: Stufe 1 (faehiger Host) - genau eine agent-status-Resource + _meta zeigt darauf", async () => {
  await withGateway(RICH_STATE, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const agentResources = resources.filter((r) => r.uri === RESOURCE_URI_AGENT);
    assert.equal(agentResources.length, 1, "genau eine agent-status-Resource");
    assert.equal(agentResources[0].config.mimeType, UI_MIME);

    const { config } = tools.get("get_agent_status");
    assert.equal(config._meta.ui.resourceUri, RESOURCE_URI_AGENT, "_meta zeigt auf dieselbe URI");
  });
});

test("T-W3-AC3: Fallback fail-closed - kein _meta, keine agent-status-Resource, Tool bleibt", async () => {
  const cases = {
    "stdio (uiHost=null)": null,
    "Master-Schalter aus trotz Capability": { enabled: false, capabilities: CAPABLE_CAPS },
  };
  await withGateway(RICH_STATE, async () => {
    for (const [label, uiHost] of Object.entries(cases)) {
      const { tools, resources } = captureUi(uiHost === null ? undefined : { uiHost });
      const { config, handler } = tools.get("get_agent_status");
      assert.equal(
        resources.filter((r) => r.uri === RESOURCE_URI_AGENT).length,
        0,
        `${label}: keine agent-status-Resource`,
      );
      assert.ok(!config._meta, `${label}: kein _meta`);
      // Default-Tool: existiert in ALLEN Faellen, nur das Widget faellt weg.
      const result = await handler({});
      assert.ok(result.structuredContent, `${label}: structuredContent bleibt`);
      assert.deepEqual(Object.keys(result.structuredContent).sort(), AGENT_KEYS);
    }
  });
});

test("T-W3-AC4: Whitelist - keine fremden/PII-Felder in structuredContent/Text/Resource", async () => {
  await withGateway(RICH_STATE, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("get_agent_status");
    const result = await handler({});

    const serialized = JSON.stringify(result);
    for (const leak of [
      "secret@example.com",
      "sk_live_LEAK",
      "tenant-XYZ",
      "agent-LEAK",
      "settings-LEAK",
      "c1",
    ]) {
      assert.ok(!serialized.includes(leak), `kein Leck von ${leak} im Tool-Result`);
    }
    assert.deepEqual(Object.keys(result.structuredContent).sort(), AGENT_KEYS);

    // Resource-HTML ist statisch -> enthaelt per Konstruktion keine Agent-Daten.
    const agentRes = resources.find((r) => r.uri === RESOURCE_URI_AGENT);
    const html = (await agentRes.readCallback()).contents[0].text;
    for (const leak of ["secret@example.com", "sk_live_LEAK", "tenant-XYZ", "agent-LEAK", "settings-LEAK"]) {
      assert.ok(!html.includes(leak), `Resource-HTML statisch, kein ${leak}`);
    }
  });
});

test("T-W3-AC5: Fehlerpfad - Body ohne agent -> isError, text-only, auch bei faehigem Host", async () => {
  // Body ohne agent -> requireFields wirft VOR pickAgentStatus -> wrapHandler isError.
  await withGateway({ usage: {}, settings: {} }, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("get_agent_status");
    const result = await handler({});
    assert.ok(result.isError, "degradierte Antwort -> isError");
    assert.ok(!result.structuredContent, "Fehlerpfad ohne structuredContent");
    const txt = result.content.map((c) => c.text).join("\n");
    assert.doesNotMatch(txt, /Cannot read|undefined|TypeError/i, "generischer, provider-freier Text");
  });
});

test("T-W3-AC6: agent-status.html self-contained + read-only + erbt W1-Binding", async () => {
  const readback = await readbackResource(mcpNativeRenderer, WIDGET_AGENT_STATUS);
  const content = readback.contents[0];
  assert.equal(content.mimeType, UI_MIME);
  const html = content.text;
  assert.ok(html.startsWith("<!-- @dsCard"), "@dsCard-Marker in Zeile 1");
  assert.ok(!html.includes("@import"), "kein @import");
  assert.doesNotMatch(html, /<link[\s>]/, "kein <link>-Element");
  assert.doesNotMatch(html, /href\s*=/, "kein href-Linkback");
  // Read-only: kein Callback/Button/Tool-Trigger im Widget (W3).
  assert.doesNotMatch(html, /<button/, "kein <button> (read-only)");
  assert.ok(!html.includes("callTool"), "kein callTool (read-only, kein Callback)");
  // Erbt W1-Binding: die injizierte Bootstrap-Quelle (run(window)) ist vorhanden.
  assert.ok(html.includes("run(window)"), "injiziertes W1-Binding (run(window)) vorhanden");
  assert.equal(mcpNativeRenderer.hasWidget(WIDGET_AGENT_STATUS), true, "Adapter kennt agent-status");
});

// ===== W-batch: drei weitere read-only Widgets ueber den BESTEHENDEN Seam =====
// get_my_number / list_calls / get_calendar bekommen Stufe 0 (structuredContent +
// Backward-Compat-Text) + Stufe 1 (Widget) bei faehigem Host; Fallback Stufe-0 bei
// unfaehigem. Whitelist beweist Nicht-Durchreichung von PII/Secrets/Roh-Transkript/
// Cross-Tenant-State. Read-only: kein Callback/Button. list_calls/get_calendar liefern
// Objekt-Listen (Slot-Rendering ueber das generische W1-Binding, data-mcp-row).
const RICH_STATE_BATCH = {
  agent: {
    number: "+18643028341",
    secretAgentField: "agent-LEAK", // darf NIE durch
  },
  calls: [
    {
      id: "c1",
      direction: "outbound",
      to: "+4917212345678",
      from: "+18643028341",
      status: "completed",
      startedAt: "2026-06-26T09:59:50.000Z",
      answeredAt: "2026-06-26T10:00:00.000Z",
      endedAt: "2026-06-26T10:05:00.000Z",
      summary: "Termin Donnerstag 14:30 gebucht.",
      // Felder, die NIEMALS nach aussen duerfen:
      transcript: [{ role: "agent", text: "Guten Tag, hier ist Hermes." }],
      tenantId: "tenant-XYZ",
      audioUrl: "https://example.com/rec.wav",
      apiKey: "sk_live_LEAK",
    },
    {
      id: "c2",
      direction: "inbound",
      from: "+49170000000",
      to: "+18643028341",
      status: "active", // ohne answeredAt -> mapStatus = dialing
      startedAt: "2026-06-26T11:00:00.000Z",
    },
  ],
  calendar: [
    {
      title: "Zahnarzt",
      start: "2026-06-28T09:00:00.000Z",
      end: "2026-06-28T09:30:00.000Z",
      // Felder, die NIEMALS nach aussen duerfen:
      location: "Geheim",
      attendees: ["secret@example.com"],
      notes: "calendar-LEAK",
    },
  ],
  // Top-Level-Felder, die NIEMALS nach aussen duerfen:
  email: "secret@example.com",
  apiKey: "sk_live_LEAK",
  tenantId: "tenant-XYZ",
};
// Sammelliste sensibler Strings (eine Quelle fuer alle Whitelist-Checks der Scheibe).
const BATCH_LEAKS = [
  "agent-LEAK",
  "sk_live_LEAK",
  "tenant-XYZ",
  "secret@example.com",
  "rec.wav",
  "Guten Tag",
  "calendar-LEAK",
  "Geheim",
];
const RESOURCE_URI_MY = uiResourceUri(WIDGET_MY_NUMBER); // ui://hermes/my-number
const RESOURCE_URI_CALLS = uiResourceUri(WIDGET_CALLS); // ui://hermes/calls
const RESOURCE_URI_CAL = uiResourceUri(WIDGET_CALENDAR); // ui://hermes/calendar
const myNumberOutput = z.object({ number: z.string().nullable() });
const callsOutput = z.object({
  calls: z.array(
    z.object({
      id: z.string(),
      direction: z.string(),
      counterparty: z.string().nullable(),
      status: z.string(),
      startedAt: z.string(),
      summary: z.string().optional(),
    }),
  ),
});
const calendarOutput = z.object({
  calendar: z.array(z.object({ title: z.string().nullable(), start: z.string(), end: z.string() })),
});
const CALL_ENTRY_KEYS = ["counterparty", "direction", "id", "startedAt", "status"];
const CALENDAR_ENTRY_KEYS = ["end", "start", "title"];
// Fallback-Faelle (Stufe 0 bleibt): NUR Master-Schalter aus / kein hostHint (stdio).
// Ein faehiger Host mit/ohne deklarierte Capability bekommt jetzt das Widget (Default
// mcp-nativ, stateless-tauglich) - siehe T-UI-stateless.
const FALLBACK_CASES = {
  "stdio (uiHost=null)": null,
  "Master-Schalter aus trotz Capability": { enabled: false, capabilities: CAPABLE_CAPS },
};
// Beweist: Server-seitige Formatierung (fmt) - kein roher ISO-Timestamp im Slot.
const isFormattedNotIso = (s) => typeof s === "string" && s.length > 0 && !/\dT\d/.test(s);

// ---- get_my_number ----
test("T-Wb-MY-AC1: Stufe 0 - Backward-Compat-Text {number} + schema-validiertes structuredContent", async () => {
  await withGateway(RICH_STATE_BATCH, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { config, handler } = tools.get("get_my_number");
    assert.ok(config.outputSchema, "outputSchema am config deklariert");
    const result = await handler({});

    assert.equal(result.content[0].type, "text", "Textblock bleibt erhalten");
    assert.deepEqual(JSON.parse(result.content[0].text), { number: "+18643028341" }, "Text byte-identisch");
    assert.deepEqual(Object.keys(result.structuredContent).sort(), ["number"]);
    assert.equal(result.structuredContent.number, "+18643028341");
    assert.doesNotThrow(() => myNumberOutput.parse(result.structuredContent));
  });
});

test("T-Wb-MY-AC2: Stufe 1 (faehiger Host) - genau eine my-number-Resource + _meta", async () => {
  await withGateway(RICH_STATE_BATCH, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const matching = resources.filter((r) => r.uri === RESOURCE_URI_MY);
    assert.equal(matching.length, 1, "genau eine my-number-Resource");
    assert.equal(matching[0].config.mimeType, UI_MIME);
    assert.equal(tools.get("get_my_number").config._meta.ui.resourceUri, RESOURCE_URI_MY);
  });
});

test("T-Wb-MY-AC3: Fallback fail-closed - kein _meta/Resource, structuredContent bleibt", async () => {
  await withGateway(RICH_STATE_BATCH, async () => {
    for (const [label, uiHost] of Object.entries(FALLBACK_CASES)) {
      const { tools, resources } = captureUi(uiHost === null ? undefined : { uiHost });
      const { config, handler } = tools.get("get_my_number");
      assert.equal(resources.filter((r) => r.uri === RESOURCE_URI_MY).length, 0, `${label}: keine Resource`);
      assert.ok(!config._meta, `${label}: kein _meta`);
      const result = await handler({});
      assert.deepEqual(Object.keys(result.structuredContent).sort(), ["number"], `${label}: structuredContent bleibt`);
    }
  });
});

test("T-Wb-MY-AC4: Whitelist - NUR { number }, kein agent-LEAK/PII", async () => {
  await withGateway(RICH_STATE_BATCH, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const result = await tools.get("get_my_number").handler({});
    const serialized = JSON.stringify(result);
    for (const leak of BATCH_LEAKS) assert.ok(!serialized.includes(leak), `kein Leck von ${leak}`);
    assert.deepEqual(Object.keys(result.structuredContent).sort(), ["number"]);

    const html = (await resources.find((r) => r.uri === RESOURCE_URI_MY).readCallback()).contents[0].text;
    for (const leak of BATCH_LEAKS) assert.ok(!html.includes(leak), `Resource-HTML statisch, kein ${leak}`);
  });
});

test("T-Wb-MY-AC6: my-number.html self-contained + read-only + erbt W1-Binding", async () => {
  const html = (await readbackResource(mcpNativeRenderer, WIDGET_MY_NUMBER)).contents[0].text;
  assert.ok(html.startsWith("<!-- @dsCard"), "@dsCard-Marker in Zeile 1");
  assert.ok(!html.includes("@import"), "kein @import");
  assert.doesNotMatch(html, /<link[\s>]/, "kein <link>-Element");
  assert.doesNotMatch(html, /href\s*=/, "kein href-Linkback");
  assert.doesNotMatch(html, /<button/, "kein <button> (read-only)");
  assert.ok(!html.includes("callTool"), "kein callTool (read-only)");
  assert.ok(html.includes("run(window)"), "injiziertes W1-Binding vorhanden");
  assert.ok(html.includes('data-mcp="number"'), "Slot data-mcp=number");
  assert.equal(mcpNativeRenderer.hasWidget(WIDGET_MY_NUMBER), true, "Adapter kennt my-number");
});

// ---- list_calls ----
test("T-Wb-CALLS-AC1: Stufe 0 - Backward-Compat-Text + structuredContent { calls:[...] } schema-valid", async () => {
  await withGateway(RICH_STATE_BATCH, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { config, handler } = tools.get("list_calls");
    assert.ok(config.outputSchema, "outputSchema am config deklariert");
    const result = await handler({});

    const txt = result.content[0].text;
    assert.match(txt, /\[c1\] -> \+4917212345678 \| completed \|/, "outbound-Zeile byte-identisch");
    assert.match(txt, /\[c2\] <- \+49170000000 \| dialing \|/, "inbound-Zeile (dialing via mapStatus)");
    assert.ok(txt.includes("Termin Donnerstag 14:30 gebucht."), "Summary im Text");

    assert.equal(result.structuredContent.calls.length, 2);
    assert.deepEqual(Object.keys(result.structuredContent.calls[0]).sort(), [...CALL_ENTRY_KEYS, "summary"].sort(), "c1 inkl. summary");
    assert.deepEqual(Object.keys(result.structuredContent.calls[1]).sort(), CALL_ENTRY_KEYS, "c2 ohne summary");
    assert.equal(result.structuredContent.calls[0].counterparty, "+4917212345678", "outbound -> to");
    assert.equal(result.structuredContent.calls[1].counterparty, "+49170000000", "inbound -> from");
    assert.equal(result.structuredContent.calls[1].status, "dialing", "mapStatus: active ohne answeredAt");
    assert.ok(isFormattedNotIso(result.structuredContent.calls[0].startedAt), "startedAt server-formatiert (kein ISO)");
    assert.doesNotThrow(() => callsOutput.parse(result.structuredContent));
  });
});

test("T-Wb-CALLS-AC1b: leere Liste -> 'Noch keine Anrufe.' + structuredContent { calls:[] }", async () => {
  await withGateway({ calls: [] }, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const result = await tools.get("list_calls").handler({});
    assert.ok(!result.isError, "leere Liste ist kein Fehler");
    assert.equal(result.content[0].text, "Noch keine Anrufe.", "Backward-Compat-Text");
    assert.deepEqual(result.structuredContent, { calls: [] }, "leere Liste schema-konform");
  });
});

test("T-Wb-CALLS-AC2: Stufe 1 (faehiger Host) - genau eine calls-Resource + _meta", async () => {
  await withGateway(RICH_STATE_BATCH, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const matching = resources.filter((r) => r.uri === RESOURCE_URI_CALLS);
    assert.equal(matching.length, 1, "genau eine calls-Resource");
    assert.equal(matching[0].config.mimeType, UI_MIME);
    assert.equal(tools.get("list_calls").config._meta.ui.resourceUri, RESOURCE_URI_CALLS);
  });
});

test("T-Wb-CALLS-AC3: Fallback fail-closed - kein _meta/Resource, structuredContent bleibt", async () => {
  await withGateway(RICH_STATE_BATCH, async () => {
    for (const [label, uiHost] of Object.entries(FALLBACK_CASES)) {
      const { tools, resources } = captureUi(uiHost === null ? undefined : { uiHost });
      const { config, handler } = tools.get("list_calls");
      assert.equal(resources.filter((r) => r.uri === RESOURCE_URI_CALLS).length, 0, `${label}: keine Resource`);
      assert.ok(!config._meta, `${label}: kein _meta`);
      const result = await handler({});
      assert.equal(result.structuredContent.calls.length, 2, `${label}: structuredContent bleibt`);
    }
  });
});

test("T-Wb-CALLS-AC4: Whitelist - nur pickCall-Felder, kein Roh-Transkript/PII/Secret", async () => {
  await withGateway(RICH_STATE_BATCH, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const result = await tools.get("list_calls").handler({});
    const serialized = JSON.stringify(result);
    for (const leak of BATCH_LEAKS) assert.ok(!serialized.includes(leak), `kein Leck von ${leak}`);
    for (const entry of result.structuredContent.calls) {
      const keys = Object.keys(entry).sort();
      assert.ok(
        keys.every((k) => [...CALL_ENTRY_KEYS, "summary"].includes(k)),
        `Eintrag-Keys nur Whitelist: ${keys}`,
      );
    }
    const html = (await resources.find((r) => r.uri === RESOURCE_URI_CALLS).readCallback()).contents[0].text;
    for (const leak of BATCH_LEAKS) assert.ok(!html.includes(leak), `Resource-HTML statisch, kein ${leak}`);
  });
});

test("T-Wb-CALLS-AC6: calls.html self-contained + read-only + erbt W1 + deklariert data-mcp-row", async () => {
  const html = (await readbackResource(mcpNativeRenderer, WIDGET_CALLS)).contents[0].text;
  assert.ok(html.startsWith("<!-- @dsCard"), "@dsCard-Marker in Zeile 1");
  assert.ok(!html.includes("@import"), "kein @import");
  assert.doesNotMatch(html, /<link[\s>]/, "kein <link>-Element");
  assert.doesNotMatch(html, /href\s*=/, "kein href-Linkback");
  assert.doesNotMatch(html, /<button/, "kein <button> (read-only)");
  assert.ok(!html.includes("callTool"), "kein callTool (read-only)");
  assert.ok(html.includes("run(window)"), "injiziertes W1-Binding vorhanden");
  assert.ok(html.includes('data-mcp="calls"'), "Listen-Slot data-mcp=calls");
  assert.ok(html.includes("data-mcp-row="), "deklariert Row-Felder fuer das Objekt-Listen-Rendering");
  assert.equal(mcpNativeRenderer.hasWidget(WIDGET_CALLS), true, "Adapter kennt calls");
});

// ---- get_calendar ----
test("T-Wb-CAL-AC1: Stufe 0 - Backward-Compat-Text + structuredContent { calendar:[...] } schema-valid", async () => {
  await withGateway(RICH_STATE_BATCH, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { config, handler } = tools.get("get_calendar");
    assert.ok(config.outputSchema, "outputSchema am config deklariert");
    const result = await handler({});

    assert.match(result.content[0].text, /^Zahnarzt: .+ bis .+$/, "Text byte-identisch (title: start bis end)");
    assert.equal(result.structuredContent.calendar.length, 1);
    assert.deepEqual(Object.keys(result.structuredContent.calendar[0]).sort(), CALENDAR_ENTRY_KEYS);
    assert.equal(result.structuredContent.calendar[0].title, "Zahnarzt");
    assert.ok(isFormattedNotIso(result.structuredContent.calendar[0].start), "start server-formatiert (kein ISO)");
    assert.doesNotThrow(() => calendarOutput.parse(result.structuredContent));
  });
});

test("T-Wb-CAL-AC1b: leerer Kalender -> 'Kalender ist leer.' + structuredContent { calendar:[] }", async () => {
  await withGateway({ calendar: [] }, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const result = await tools.get("get_calendar").handler({});
    assert.ok(!result.isError, "leerer Kalender ist kein Fehler");
    assert.equal(result.content[0].text, "Kalender ist leer.", "Backward-Compat-Text");
    assert.deepEqual(result.structuredContent, { calendar: [] }, "leere Liste schema-konform");
  });
});

test("T-Wb-CAL-AC2: Stufe 1 (faehiger Host) - genau eine calendar-Resource + _meta", async () => {
  await withGateway(RICH_STATE_BATCH, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const matching = resources.filter((r) => r.uri === RESOURCE_URI_CAL);
    assert.equal(matching.length, 1, "genau eine calendar-Resource");
    assert.equal(matching[0].config.mimeType, UI_MIME);
    assert.equal(tools.get("get_calendar").config._meta.ui.resourceUri, RESOURCE_URI_CAL);
  });
});

test("T-Wb-CAL-AC3: Fallback fail-closed - kein _meta/Resource, structuredContent bleibt", async () => {
  await withGateway(RICH_STATE_BATCH, async () => {
    for (const [label, uiHost] of Object.entries(FALLBACK_CASES)) {
      const { tools, resources } = captureUi(uiHost === null ? undefined : { uiHost });
      const { config, handler } = tools.get("get_calendar");
      assert.equal(resources.filter((r) => r.uri === RESOURCE_URI_CAL).length, 0, `${label}: keine Resource`);
      assert.ok(!config._meta, `${label}: kein _meta`);
      const result = await handler({});
      assert.equal(result.structuredContent.calendar.length, 1, `${label}: structuredContent bleibt`);
    }
  });
});

test("T-Wb-CAL-AC4: Whitelist - nur title/start/end, kein location/notes/attendees", async () => {
  await withGateway(RICH_STATE_BATCH, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const result = await tools.get("get_calendar").handler({});
    const serialized = JSON.stringify(result);
    for (const leak of BATCH_LEAKS) assert.ok(!serialized.includes(leak), `kein Leck von ${leak}`);
    assert.deepEqual(Object.keys(result.structuredContent.calendar[0]).sort(), CALENDAR_ENTRY_KEYS);

    const html = (await resources.find((r) => r.uri === RESOURCE_URI_CAL).readCallback()).contents[0].text;
    for (const leak of BATCH_LEAKS) assert.ok(!html.includes(leak), `Resource-HTML statisch, kein ${leak}`);
  });
});

test("T-Wb-CAL-AC6: calendar.html self-contained + read-only + erbt W1 + deklariert data-mcp-row", async () => {
  const html = (await readbackResource(mcpNativeRenderer, WIDGET_CALENDAR)).contents[0].text;
  assert.ok(html.startsWith("<!-- @dsCard"), "@dsCard-Marker in Zeile 1");
  assert.ok(!html.includes("@import"), "kein @import");
  assert.doesNotMatch(html, /<link[\s>]/, "kein <link>-Element");
  assert.doesNotMatch(html, /href\s*=/, "kein href-Linkback");
  assert.doesNotMatch(html, /<button/, "kein <button> (read-only)");
  assert.ok(!html.includes("callTool"), "kein callTool (read-only)");
  assert.ok(html.includes("run(window)"), "injiziertes W1-Binding vorhanden");
  assert.ok(html.includes('data-mcp="calendar"'), "Listen-Slot data-mcp=calendar");
  assert.ok(html.includes("data-mcp-row="), "deklariert Row-Felder fuer das Objekt-Listen-Rendering");
  assert.equal(mcpNativeRenderer.hasWidget(WIDGET_CALENDAR), true, "Adapter kennt calendar");
});

// ===== W2: Tool-Rewiring - Spam-Wurzel beseitigt (vormals W0-Charakterisierungs-Baseline) =====
// Die drei folgenden Tests pinnten in W0 den HEUTIGEN (Spam-)Zustand vor dem Umbau; W2
// kehrt ihn um (siehe tasks/mcp-ui-live-widget-chain.md, Abschnitt W2). place_call laeuft
// jetzt ueber uiTool/registerTool (nicht mehr server.tool) und traegt WIDGET_CALL als
// EINZIGE Karte; get_call_status verliert sein eigenes _meta (siehe P1-Tests oben).

test("T-W2-place-shape: place_call laeuft jetzt ueber registerTool, traegt _meta + volles structuredContent (W0-Baseline invertiert)", async () => {
  await withGateway(PLACE_CALL_MOCK, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { config, handler } = tools.get("place_call");
    assert.ok(config, "place_call laeuft jetzt ueber registerTool (config-Objekt vorhanden, W0 kannte config===null)");
    assert.equal(config._meta.ui.resourceUri, RESOURCE_URI_CALL, "place_call: _meta zeigt auf die vereinte Karte");

    const result = await handler(PLACE_CALL_ARGS);
    assert.equal(result.content[0].type, "text", "Textblock bleibt erhalten (Fallback)");
    assert.ok(result.structuredContent, "structuredContent jetzt vorhanden (W0 kannte undefined)");
    // I10 (call-quality Impl-1): context_received ist additiv dazugekommen. PLACE_CALL_MOCK
    // ({callId:"call_1"}) traegt das Feld selbst NICHT -> der Handler normalisiert
    // defensiv auf "kein Kontext angekommen" (fail-closed, kein Crash bei einem aelteren
    // Gateway-Mock).
    assert.deepEqual(Object.keys(result.structuredContent).sort(), [
      "call_id", "context_received", "duration_s", "failure_reason", "last_transcript_lines",
      "objective_achieved", "result_summary", "status",
    ]);
    assert.equal(result.structuredContent.call_id, "call_1");
    assert.equal(result.structuredContent.status, "dialing");
    assert.equal(result.structuredContent.duration_s, 0);
    assert.deepEqual(result.structuredContent.last_transcript_lines, []);
    assert.equal(result.structuredContent.failure_reason, null);
    assert.equal(result.structuredContent.result_summary, null);
    assert.equal(result.structuredContent.objective_achieved, null);
    assert.deepEqual(result.structuredContent.context_received, {
      active: false,
      summary: false,
      key_facts_count: 0,
      recipient_relationship: false,
      desired_outcome: false,
    });
    assert.doesNotThrow(
      () => callOutput.parse(result.structuredContent),
      "structuredContent validiert gegen outputSchema",
    );
  });
});

test("T-I10-context-received: place_call reicht das context_received-Meta der Gateway-Antwort 1:1 durch", async () => {
  // I10 (call-quality Impl-1): traegt der Gateway-Body das additive Meta, erscheint es
  // unveraendert im structuredContent (Selbstauskunft ans Chat-LLM, nur bool/count).
  const CONTEXT_RECEIVED = {
    active: true,
    summary: true,
    key_facts_count: 3,
    recipient_relationship: false,
    desired_outcome: true,
  };
  await withGateway({ ...PLACE_CALL_MOCK, context_received: CONTEXT_RECEIVED }, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("place_call");
    const result = await handler(PLACE_CALL_ARGS);
    assert.deepEqual(result.structuredContent.context_received, CONTEXT_RECEIVED);
    assert.doesNotThrow(() => callOutput.parse(result.structuredContent));
  });
});

test("T-W2-place-desc: place_call-Beschreibung pollt das Modell nicht mehr an (W0-Baseline invertiert)", () => {
  const { tools } = captureUi({ uiHost: capableHost() });
  const { config } = tools.get("place_call");
  assert.doesNotMatch(
    config.description,
    NO_POLLING_CADENCE,
    "Polling-Anweisung entfernt (Spam-Wurzel beseitigt, W2)",
  );
});

test("T-W2-get-status-desc: get_call_status-Beschreibung pollt das Modell nicht mehr an (W0-Baseline invertiert)", () => {
  const { tools } = captureUi({ uiHost: capableHost() });
  const { config } = tools.get("get_call_status");
  assert.doesNotMatch(
    config.description,
    NO_POLLING_CADENCE,
    "Polling-Anweisung entfernt (Spam-Wurzel beseitigt, W2)",
  );
});
