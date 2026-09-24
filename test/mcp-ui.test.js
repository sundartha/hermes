// P1 MCP Rich-UI duenne Scheibe: get_call_status auf Stufe 0 (structuredContent +
// schema-validiert) + Stufe 1 (ui://-Resource fuer faehige Hosts) mit fail-closed
// Fallback. Kein echter MCP-Transport/Host: ein fakeServer faengt registerTool-
// (config inkl. outputSchema/_meta) + registerResource-Aufrufe ein, ein lokaler
// HTTP-Mock spielt das Gateway (Spec Abschnitt 8 - Seam beweist sich ueber Tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { registerTools } from "../src/mcp-tools.js";
import { uiRendererFor } from "../src/ui/registry.js";
import {
  mcpNativeRenderer,
  WIDGET_AGENT_STATUS,
} from "../src/ui/adapters/mcp-native.js";
// Neue read-only Widget-Ids aus der kanonischen Quelle (widget-catalog.js).
import {
  WIDGET_MY_NUMBER,
  WIDGET_CALLS,
  WIDGET_CALL,
  widgetHtml,
} from "../src/ui/widget-catalog.js";
import {
  UI_MIME,
  capabilityDeclaresUi,
  uiResourceUri,
  uiServerExtension,
} from "../src/ui/contract.js";
import { config } from "../src/config.js";

const RESOURCE_URI_CALL = uiResourceUri(WIDGET_CALL); // ui://hermes/call/v<widgetVersion>.html

// Abwesenheits-Pin (Kritik N1): KEINE feste Zahl ("~10") vorschreiben, sondern generisch
// jede "alle N Sekunden"-Polling-Anweisung verbieten - robuster als ein Positiv-String-Pin.
const NO_POLLING_CADENCE = /alle ~?\d+\s*Sekunden/;

// Minimal gueltige place_call-Aufruf-Form fuer die Tests dieser Datei (EINE Quelle,
// G5/S2): Argumente UND der dazu passende Gateway-Mock-Body. place_call postet an
// POST /api/calls und liest nur r.callId - anders als get_call_status/get_call_result,
// die GET /api/calls/:id lesen und ein RICH_CALL/RICH_TRANSCRIPT-Call-Objekt erwarten.
const PLACE_CALL_ARGS = { to: "+4917212345678", objective: "Testanruf" };
// T2-13 (N-10): der Fake-Gateway ist statisch (EIN Body fuer JEDEN Pfad) - place_call
// macht jetzt ZWEI Hops (confirmCallHop -> POST /api/call-confirmations, dann
// placeCallHopCall -> POST /api/calls). preview/confirmed decken den ersten Hop,
// callId weiterhin den zweiten.
const PLACE_CALL_MOCK = {
  preview: { status: "awaiting_confirmation", to: PLACE_CALL_ARGS.to, objective: PLACE_CALL_ARGS.objective },
  confirmed: true,
  callId: "call_1",
};

// Faehiger Host: deklariert die UI-Capability mit UI_MIME (SEP-1865 initialize).
const CAPABLE_CAPS = {
  extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [UI_MIME] } },
};
const capableHost = () => ({ enabled: true, capabilities: CAPABLE_CAPS });

// P2: seit withOpenAiToolMetadata() traegt JEDES Werkzeug ein _meta (die T-22-
// Statuszeilen). Gleich streng wie vor P2, bei dem Vorkommen von _meta genau die
// Statuszeilen: die Schluesselmenge von _meta muss EXAKT diese beiden Schluessel sein
// (src/mcp-tools.js OPENAI_INVOKING_KEY/OPENAI_INVOKED_KEY, hier als eigene Konstante,
// weil die src-Konstanten modul-privat bleiben - sie zu exportieren waere eine
// ausfuehrbare src-Zeile). Kontrollfall am Dateiende, damit der Helfer nicht unbemerkt
// immer true liefert.
const STATUS_LINE_META_KEYS = ["openai/toolInvocation/invoking", "openai/toolInvocation/invoked"];
const ohneWidgetMeta = (config) =>
  isDeepStrictEqual(Object.keys(config._meta ?? {}).sort(), [...STATUS_LINE_META_KEYS].sort());

// Faengt registerTool(name, config, handler) + registerResource(name, uri, config,
// readCb) ein. Der Legacy-Weg tool() hat seit OpenAI-P2 keinen Aufrufer mehr in src/.
// registerResource nimmt die vier SDK-Argumente als Liste entgegen (Signatur des SDK,
// nicht unsere) und legt sie benannt ab.
function captureUi(ctx) {
  const tools = new Map(); // Werkzeugname -> Konfiguration und Handler
  const resources = []; // je Resource: Name, URI, Konfiguration, Lese-Callback
  const fakeServer = {
    registerTool(name, config, handler) {
      tools.set(name, { config, handler });
    },
    registerResource(...registration) {
      const [name, uri, config, readCallback] = registration;
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

const HTTP_OK = 200;

// Benannte Zugriffe statt tiefer Aufrufketten (Demeter G36). Jede Funktion liefert GENAU
// den Wert, den die Assertion vorher inline gelesen hat - ohne optionales Verketten: ein
// fehlendes Zwischenfeld oder eine fehlende Resource wirft wie zuvor.
function uiResourceUriOf(tools, toolName) {
  const { config } = tools.get(toolName);
  return config._meta.ui.resourceUri;
}

async function resourceText(resource) {
  const { contents } = await resource.readCallback();
  return contents[0].text;
}

function readResourceText(resources, uri) {
  return resourceText(resources.find((resource) => resource.uri === uri));
}

async function startGatewayMock(body) {
  // requests: Mitschnitt der eingehenden Requests (method/url/headers) fuer den
  // Callback-Beweis (P4-AC5: cancel_call laeuft als authentisierter POST auf den
  // bestehenden /cancel-Pfad, kein Seitenkanal). Additiv - Bestandsaufrufer ignorieren.
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
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
// erneute Feld-Duplizierung) plus den beiden Abschluss-Feldern aus dem get_call_result-
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
    // Positiv-Kontrolle (P5b, Schritt 2): der Mock-Upstream traegt weiterhin das volle
    // Diagnose-Token - sonst waere die Kuerzungs-Zusicherung unten trivial gruen.
    assert.equal(FAILED_CALL.failureReason, "failed:603", "Upstream traegt das volle Token");
    const { tools } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("get_call_status");
    const result = await handler({ call_id: "call_1" });

    // P5b (O-13 Teil 2, Datenminimierung): an der MCP-Kante nur noch das Basis-Token.
    assert.equal(result.structuredContent.failure_reason, "failed", "Grund exponiert, gekuerzt");
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

    const callResources = resources.filter((resource) => resource.uri === RESOURCE_URI_CALL);
    assert.equal(callResources.length, 1, "genau eine call-Resource (place_call)");
    assert.equal(callResources[0].config.mimeType, UI_MIME);
    assert.equal(
      uiResourceUriOf(tools, "place_call"),
      RESOURCE_URI_CALL,
      "place_call: _meta zeigt auf die vereinte Karte",
    );

    assert.ok(ohneWidgetMeta(tools.get("get_call_status").config), "get_call_status: kein Widget-_meta");
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
      assert.equal(resources.filter((resource) => resource.uri === RESOURCE_URI_CALL).length, 0, `${label}: keine call-Resource`);
      assert.ok(ohneWidgetMeta(config), `${label}: place_call kein Widget-_meta`);

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

      assert.ok(
        ohneWidgetMeta(tools.get("get_call_status").config),
        `${label}: get_call_status bleibt ohne Widget-_meta`,
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
      const placeConfig = place.config;
      assert.equal(placeConfig._meta?.ui?.resourceUri, RESOURCE_URI_CALL, `${label}: place_call _meta zeigt auf die URI`);
      assert.ok(resources.some((resource) => resource.uri === RESOURCE_URI_CALL), `${label}: ui://-Resource registriert`);
      const placeResult = await place.handler(PLACE_CALL_ARGS);
      assert.ok(placeResult.structuredContent, `${label}: place_call structuredContent bleibt`);

      const status = tools.get("get_call_status");
      assert.ok(ohneWidgetMeta(status.config), `${label}: get_call_status bleibt ohne Widget-_meta (W2)`);
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
    const txt = result.content.map((content) => content.text).join("\n");
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

// ===== P2: get_call_result ueber den BESTEHENDEN Seam (Seam-Wiederverwendung) =====
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
  // AL-P11: die fuenf handlungsrelevanten Ergebnis-Karten-Felder (Whitelist).
  outcome: z.string().nullable(),
  commitments: z.array(z.string()),
  counterparty_commitments: z.array(z.string()),
  open_points: z.array(z.string()),
  next_step: z.string().nullable(),
});

test("T-P2-UI-AC1: Stufe 0 additiv - Textblock (Summary/Ziel) + schema-validiertes structuredContent", async () => {
  await withGateway(RICH_TRANSCRIPT, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { config, handler } = tools.get("get_call_result");
    assert.ok(config.outputSchema, "outputSchema am config deklariert");
    const result = await handler({ call_id: "call_1" });

    assert.equal(result.content[0].type, "text", "Textblock bleibt erhalten");
    const textObj = JSON.parse(result.content[0].text);
    assert.deepEqual(
      Object.keys(textObj).sort(),
      [
        "commitments",
        "counterparty_commitments",
        "next_step",
        "objective_achieved",
        "open_points",
        "outcome",
        "result_summary",
      ],
      "Textblock: Summary/Ziel/Ergebnis-Karte ohne call_id (kein Roh-Transkript)",
    );

    assert.ok(result.structuredContent, "structuredContent vorhanden");
    assert.deepEqual(Object.keys(result.structuredContent).sort(), [
      "call_id",
      "commitments",
      "counterparty_commitments",
      "next_step",
      "objective_achieved",
      "open_points",
      "outcome",
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

test("T-P2-UI-AC2: get_call_result verliert ihr _meta (W2) - keine eigene Resource mehr ueber registerTools", async () => {
  await withGateway(RICH_TRANSCRIPT, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { config } = tools.get("get_call_result");
    assert.ok(ohneWidgetMeta(config), "get_call_result: kein Widget-_meta");
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
      const { config, handler } = tools.get("get_call_result");
      assert.ok(ohneWidgetMeta(config), `${label}: kein Widget-_meta`);
      const result = await handler({ call_id: "call_1" });
      assert.ok(result.structuredContent, `${label}: structuredContent bleibt`);
      assert.equal(result.structuredContent.call_id, "call_1");
    }
  });
});

test("T-P2-UI-AC4: Whitelist (DSGVO) - Roh-Transkript NIE in structuredContent/Text (get_call_result)", async () => {
  await withGateway(RICH_TRANSCRIPT, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("get_call_result");
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
      "commitments",
      "counterparty_commitments",
      "next_step",
      "objective_achieved",
      "open_points",
      "outcome",
      "result_summary",
    ]);
  });
});

test("T-P2-UI-AC5: Fehlerpfad - degradierte Antwort -> isError, text-only, auch bei faehigem Host", async () => {
  // Body ohne transcript -> requireFields wirft -> wrapHandler liefert isError.
  await withGateway({ status: "completed" }, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("get_call_result");
    const result = await handler({ call_id: "call_1" });
    assert.ok(result.isError, "degradierte Antwort -> isError");
    assert.ok(!result.structuredContent, "Fehlerpfad ohne structuredContent");
    const txt = result.content.map((content) => content.text).join("\n");
    assert.doesNotMatch(txt, /Cannot read|undefined|TypeError/i, "generischer, provider-freier Text");
  });
});

// ===== P3: zweiter Host-Adapter (ChatGPT Apps SDK) hinter dem UiRenderer-Port =====
// Beweist: dasselbe Widget rendert in BEIDEN Host-Konventionen; der mcp-native Pfad
// bleibt byte-kompatibel (die P1/P2-Tests oben sind unveraendert), nur die Host-eigene
// _meta-Form + der mimeType unterscheiden sich.
// Skybridge-Capability-Literal: NUR noch fuer den Beleg "eine Capability im Request
// aendert nichts" (T2-01 - der ChatGPT-/Skybridge-Adapter ist entfernt, s.
// src/ui/registry.js). Kein Import mehr aus contract.js (die Konstante existiert dort
// nicht mehr).
const SKYBRIDGE_UI_MIME = "text/html+skybridge";
const CHATGPT_CAPS = {
  extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [SKYBRIDGE_UI_MIME] } },
};
const skybridgeCapsHost = () => ({ enabled: true, capabilities: CHATGPT_CAPS });

// Liest die statische ui://-Resource eines Renderers fuer ein Widget zurueck (readback).
function readbackResource(renderer, widgetId) {
  return new Promise((resolve) => {
    const fakeServer = {
      registerResource(...registration) {
        const readCallback = registration.at(-1);
        resolve(readCallback());
      },
    };
    renderer.registerResource(fakeServer, widgetId);
  });
}

// Nach W2 traegt ausschliesslich place_call ein Widget-_meta (WIDGET_CALL, vereinte
// Live-Karte) - get_call_status/get_call_result verlieren ihr _meta. P3_WIDGETS spiegelt
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
      const matching = resources.filter((resource) => resource.uri === uri);
      assert.equal(matching.length, 1, `${tool}: genau eine Resource`);
      assert.equal(matching[0].config.mimeType, UI_MIME);
      assert.equal(uiResourceUriOf(tools, tool), uri, `${tool}: _meta zeigt darauf`);
    });
  }
});

test("T-P3-AC3: Registry waehlt den mcp-nativen Renderer, auch mit Skybridge-Capability (Adapter entfernt, T2-01) - Master-Schalter bleibt das einzige Gate", () => {
  assert.equal(uiRendererFor(capableHost()), mcpNativeRenderer, "mcp-nativer Host -> mcp-native");
  assert.equal(
    uiRendererFor(skybridgeCapsHost()),
    mcpNativeRenderer,
    "Skybridge-Capability aendert nichts mehr - der Adapter ist entfernt",
  );
  assert.equal(
    uiRendererFor({
      enabled: true,
      capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html"] } } },
    }),
    mcpNativeRenderer,
    "jede Capability fuehrt zum selben Renderer",
  );
  assert.equal(uiRendererFor({ enabled: false, capabilities: CHATGPT_CAPS }), null, "Master-Schalter aus -> null");
  assert.equal(uiRendererFor(null), null, "kein hostHint -> null");
});

test("T-P3-AC4: Whitelist - place_call (mcp-nativer Host), kein PII-Leck aus dem Gateway-Body", async () => {
  const leaks = {
    place_call: ["secret@example.com", "sk_live_LEAK", "tenant-XYZ"],
  };
  for (const { tool, body, args } of P3_WIDGETS) {
    await withGateway(body, async () => {
      const capable = captureUi({ uiHost: capableHost() });
      const result = await capable.tools.get(tool).handler(args);
      const serialized = JSON.stringify(result);
      for (const leak of leaks[tool]) {
        assert.ok(!serialized.includes(leak), `${tool}: kein Leck von "${leak}" im Tool-Result`);
      }
    });
  }
});

// E7 (T-30/T-31), Stand T2-01: die zwei Einreichungs-Pflichtfelder sitzen seit T2-01 am
// RESOURCE-INHALT (uiResourceMeta, src/ui/contract.js), nicht mehr am Tool-Deskriptor -
// der traegt seither nur noch _meta.ui.resourceUri. config.server.publicUrl wird pro Test
// explizit gesetzt und im finally wiederhergestellt (Muster test/route-auth-inventory.
// test.js) - sonst entscheidet die lokale .env ueber das Ergebnis. uiResourceMeta()
// wertet synchron zur Aufrufzeit aus (kein await noetig).
test("E7-T10: Tool-Deskriptor traegt seit T2-01 NUR resourceUri; die Resource-CSP ist leer, aber vorhanden", async () => {
  const zuvor = config.server.publicUrl;
  config.server.publicUrl = "https://e7.test";
  try {
    for (const { tool, widgetId, body } of P3_WIDGETS) {
      await withGateway(body, async () => {
        const { tools } = captureUi({ uiHost: capableHost() });
        const { config } = tools.get(tool);
        assert.deepEqual(
          Object.keys(config._meta.ui),
          ["resourceUri"],
          `${tool}: _meta.ui traegt NUR resourceUri`,
        );

        const read = await readbackResource(mcpNativeRenderer, widgetId);
        const content = read.contents[0];
        assert.deepEqual(content._meta.ui.csp, { connectDomains: [], resourceDomains: [] });
        assert.equal("frameDomains" in content._meta.ui.csp, false, "frameDomains entfaellt (0 Frames)");
      });
    }
  } finally {
    config.server.publicUrl = zuvor;
  }
});

test("E7-T11: Resource-Inhalt traegt den Server-Origin als openai/widgetDomain, resourceUri am Tool unveraendert", async () => {
  const zuvor = config.server.publicUrl;
  config.server.publicUrl = "https://e7.test";
  try {
    for (const { tool, widgetId, body } of P3_WIDGETS) {
      await withGateway(body, async () => {
        const { tools } = captureUi({ uiHost: capableHost() });
        const { config } = tools.get(tool);
        assert.equal(config._meta.ui.resourceUri, uiResourceUri(widgetId));

        const read = await readbackResource(mcpNativeRenderer, widgetId);
        const content = read.contents[0];
        assert.equal(content._meta["openai/widgetDomain"], "https://e7.test");
      });
    }
  } finally {
    config.server.publicUrl = zuvor;
  }
});

test("E7-T12: fail-safe - leere publicUrl laesst openai/widgetDomain am Resource-Inhalt entfallen, csp bleibt vorhanden", async () => {
  const zuvor = config.server.publicUrl;
  config.server.publicUrl = "";
  try {
    for (const { widgetId } of P3_WIDGETS) {
      const read = await readbackResource(mcpNativeRenderer, widgetId);
      const content = read.contents[0];
      assert.equal("openai/widgetDomain" in content._meta, false);
      assert.ok(content._meta.ui.csp, "csp bleibt trotzdem vorhanden");
    }
  } finally {
    config.server.publicUrl = zuvor;
  }
});

test("T-P3-AC6: mcpNativeRenderer-Grenzfaelle + Detektor", () => {
  assert.equal(mcpNativeRenderer.hasWidget(WIDGET_CALL), true);
  assert.equal(mcpNativeRenderer.hasWidget(WIDGET_AGENT_STATUS), true);
  assert.equal(mcpNativeRenderer.hasWidget("unknown"), false);
  assert.equal(mcpNativeRenderer.mimeType, UI_MIME);

  assert.equal(capabilityDeclaresUi(undefined), false, "Grenzfall: undefined -> false");
  assert.equal(capabilityDeclaresUi({}), false);
  assert.equal(capabilityDeclaresUi(CHATGPT_CAPS), false, "Skybridge-Caps -> kein mcp-nativ");
  assert.equal(capabilityDeclaresUi(CAPABLE_CAPS), true, "mcp-native Caps -> mcp-nativ");
});

// Regressions-Pin, seit T2-01 fuer JEDEN Host (es gibt nur noch mcp-native): das
// Widget-HTML spricht ausschliesslich tools/call-postMessage (SEP-1865) - keine
// window.openai-Bruecke, keine host-bedingte Verzweigung mehr.
test("T-P3-AC7: Widget-HTML spricht nur tools/call, keine window.openai-Bruecke", async () => {
  for (const { widgetId } of P3_WIDGETS) {
    const read = await readbackResource(mcpNativeRenderer, widgetId);
    const html = read.contents[0].text;
    assert.ok(!html.includes("window.openai"), `${widgetId}: kein window.openai`);
    assert.ok(html.includes('"tools/call"'), `${widgetId}: einziger Sendeweg bleibt tools/call`);
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
  usage: {
    calls: 3,
    planUsagePercent: 40,
    internalCounter: 999,
  },
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
const RESOURCE_URI_AGENT = uiResourceUri(WIDGET_AGENT_STATUS); // ui://hermes/agent-status/v1.html
const AGENT_KEYS = ["calls", "number", "owner", "permissions", "planUsagePercent"];
// Pin bleibt WOERTLICH, wird nur explizit an seine Sprache gebunden (P13 ENTSCHAERFT 1:
// mitgezogen, nicht "passend gemacht").
const PERMISSIONS_STR_DE = "Summaries=true, PersoenlicheDaten=false, Bankdaten=false";
const agentStatusOutput = z.object({
  number: z.string().nullable(),
  owner: z.string().nullable(),
  calls: z.number(),
  planUsagePercent: z.number().nullable(),
  permissions: z.string(),
});

test("T-W3-AC1: Stufe 0 additiv - Backward-Compat-Text + schema-validiertes structuredContent", async () => {
  await withGateway(RICH_STATE, async () => {
    const { tools } = captureUi({ uiHost: capableHost(), language: "de" });
    const { config, handler } = tools.get("get_agent_status");
    assert.ok(config.outputSchema, "outputSchema am config deklariert");
    const result = await handler({});

    assert.equal(result.content[0].type, "text", "Textblock bleibt erhalten");
    const txt = result.content[0].text;
    assert.match(txt, /Agent-Nummer:/, "Backward-Compat-Format (Agent-Nummer)");
    assert.match(txt, /Berechtigungen:/, "Backward-Compat-Format (Berechtigungen)");

    // KS-P8: EINE Nutzungszeile statt drei Geld-/Monats-Zeilen - Prozent, kein Betrag.
    assert.match(
      txt,
      /Monatsnutzung: 40 % des Minuten-Kontingents/,
      "Nutzungszeile: planUsagePercent statt Geldbetrag",
    );

    assert.ok(result.structuredContent, "structuredContent vorhanden");
    assert.deepEqual(Object.keys(result.structuredContent).sort(), AGENT_KEYS);
    assert.equal(result.structuredContent.permissions, PERMISSIONS_STR_DE);
    assert.doesNotThrow(
      () => agentStatusOutput.parse(result.structuredContent),
      "structuredContent validiert gegen outputSchema",
    );

    // O-13 Teil 1: voiceEngine/model sind interne Konfigurationswerte, keine Session-
    // Selbstauskunft an den Tenant - sie duerfen weder ueber den Schluessel noch ueber
    // den Fixture-WERT durchsickern. RICH_STATE traegt beide Felder UNVERAENDERT
    // (Kanarienvogel wie secretAgentField) - faellt dieser Test rot, hat die Whitelist
    // versagt.
    assert.ok(
      !Object.hasOwn(result.structuredContent, "voiceEngine"),
      "structuredContent traegt kein voiceEngine mehr",
    );
    assert.ok(
      !Object.hasOwn(result.structuredContent, "model"),
      "structuredContent traegt kein model mehr",
    );
    assert.ok(!txt.includes("budget"), "Textblock traegt den voiceEngine-Fixture-Wert nicht");
    assert.ok(!txt.includes("claude-haiku"), "Textblock traegt den model-Fixture-Wert nicht");
  });
});

// KS-P8/D1: planUsagePercent ist nullable (kein Kontingent hinterlegt), aber RICH_STATE
// oben liefert durchgaengig eine Zahl - der Fallback-Textzweig UND der nullable-Schema-
// Zweig laufen erst hier durch echtes null. Fixture per Spread aus RICH_STATE (G5 -
// keine zweite Kopie des ganzen Objekts), NUR usage.planUsagePercent auf null gesetzt.
const RICH_STATE_NO_PLAN = {
  ...RICH_STATE,
  usage: { ...RICH_STATE.usage, planUsagePercent: null },
};

test("T-W3-AC1b: planUsagePercent=null (kein Kontingent hinterlegt) - Text-Fallback + nullable-Schema-Zweig", async () => {
  await withGateway(RICH_STATE_NO_PLAN, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { handler } = tools.get("get_agent_status");
    const result = await handler({});

    const txt = result.content[0].text;
    assert.match(
      txt,
      /Monatsnutzung: kein Kontingent hinterlegt/,
      "Fail-closed-Wortlaut statt einer erfundenen 0 %",
    );

    assert.equal(result.structuredContent.planUsagePercent, null, "structuredContent traegt null durch");
    assert.doesNotThrow(
      () => agentStatusOutput.parse(result.structuredContent),
      "nullable-Schema-Zweig (planUsagePercent) validiert bei echtem null",
    );
  });
});

// T2-02/T-34 (invertiert - vormals P13/E4 "Sprache erreicht die Resource"): die
// registrierte ui://-Resource ist jetzt EINE sprachneutrale, cache-feste Fassung -
// language:"en" registriert BYTE-IDENTISCH dieselbe Resource wie language:"de".
// Verdrahtungsbeweis ueber die ECHTE Kette registerTools -> enableWidgetUi ->
// registerResource -> widgetHtml.
test("T-W3-AC1c: die registrierte agent-status-Resource ist sprachneutral (T2-02)", async () => {
  await withGateway(RICH_STATE, async () => {
    const { resources } = captureUi({ uiHost: capableHost(), language: "en" });
    const html = await readResourceText(resources, RESOURCE_URI_AGENT);
    assert.equal(html, widgetHtml(WIDGET_AGENT_STATUS));
  });
});

// Die Sprache erreicht seit T2-02 das ERGEBNIS (mcp-tools.js withWidgetLocale), nicht
// mehr die Resource - "de" und "en" registrieren dieselbe Resource-URI mit demselben
// Inhalt.
test("T-W3-AC1d: language:\"de\" registriert dieselbe Resource wie language:\"en\"", async () => {
  await withGateway(RICH_STATE, async () => {
    const { resources: resourcesEn } = captureUi({ uiHost: capableHost(), language: "en" });
    const htmlEn = await readResourceText(resourcesEn, RESOURCE_URI_AGENT);
    const { resources: resourcesDe } = captureUi({ uiHost: capableHost(), language: "de" });
    const resourceDe = resourcesDe.find((res) => res.uri === RESOURCE_URI_AGENT);
    const readDe = await resourceDe.readCallback();
    const htmlDe = readDe.contents[0].text;
    assert.equal(htmlEn, htmlDe, "T2-02: Resource-Inhalt sprachneutral - Sprache reist ueber Ergebnis-_meta");
  });
});

test("T-W3-AC2: Stufe 1 (faehiger Host) - genau eine agent-status-Resource + _meta zeigt darauf", async () => {
  await withGateway(RICH_STATE, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const agentResources = resources.filter((resource) => resource.uri === RESOURCE_URI_AGENT);
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
        resources.filter((resource) => resource.uri === RESOURCE_URI_AGENT).length,
        0,
        `${label}: keine agent-status-Resource`,
      );
      assert.ok(ohneWidgetMeta(config), `${label}: kein Widget-_meta`);
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
    const agentRes = resources.find((resource) => resource.uri === RESOURCE_URI_AGENT);
    const html = await resourceText(agentRes);
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
    const txt = result.content.map((content) => content.text).join("\n");
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
  // KS-P8: die Nutzungszeile muss als eigene data-mcp-Zeile im Markup stehen, sonst
  // bindet W1 sie nie an einen sichtbaren Slot.
  assert.ok(html.includes('data-mcp="planUsagePercent"'), "Slot data-mcp=planUsagePercent");
});

// ===== W-batch: zwei weitere read-only Widgets ueber den BESTEHENDEN Seam =====
// get_agent_number / list_calls bekommen Stufe 0 (structuredContent +
// Backward-Compat-Text) + Stufe 1 (Widget) bei faehigem Host; Fallback Stufe-0 bei
// unfaehigem. Whitelist beweist Nicht-Durchreichung von PII/Secrets/Roh-Transkript/
// Cross-Tenant-State. Read-only: kein Callback/Button. list_calls liefert eine
// Objekt-Liste (Slot-Rendering ueber das generische W1-Binding, data-mcp-row).
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
// Anzahl der Anrufe in RICH_STATE_BATCH.calls, als feste Zahl gepinnt (nicht aus der
// Fixture abgeleitet): waechst die Fixture, soll die Zaehl-Assertion rot werden.
const RICH_BATCH_CALL_COUNT = 2;
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
const RESOURCE_URI_MY = uiResourceUri(WIDGET_MY_NUMBER); // ui://hermes/my-number/v1.html
const RESOURCE_URI_CALLS = uiResourceUri(WIDGET_CALLS); // ui://hermes/calls/v<widgetVersion>.html
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
const CALL_ENTRY_KEYS = ["counterparty", "direction", "id", "startedAt", "status"];
// Fallback-Faelle (Stufe 0 bleibt): NUR Master-Schalter aus / kein hostHint (stdio).
// Ein faehiger Host mit/ohne deklarierte Capability bekommt jetzt das Widget (Default
// mcp-nativ, stateless-tauglich) - siehe T-UI-stateless.
const FALLBACK_CASES = {
  "stdio (uiHost=null)": null,
  "Master-Schalter aus trotz Capability": { enabled: false, capabilities: CAPABLE_CAPS },
};
// Beweist: Server-seitige Formatierung (fmt) - kein roher ISO-Timestamp im Slot.
const isFormattedNotIso = (value) => typeof value === "string" && value.length > 0 && !/\dT\d/.test(value);

// ---- get_agent_number ----
test("T-Wb-MY-AC1: Stufe 0 - Backward-Compat-Text {number} + schema-validiertes structuredContent", async () => {
  await withGateway(RICH_STATE_BATCH, async () => {
    const { tools } = captureUi({ uiHost: capableHost() });
    const { config, handler } = tools.get("get_agent_number");
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
    const matching = resources.filter((resource) => resource.uri === RESOURCE_URI_MY);
    assert.equal(matching.length, 1, "genau eine my-number-Resource");
    assert.equal(matching[0].config.mimeType, UI_MIME);
    assert.equal(uiResourceUriOf(tools, "get_agent_number"), RESOURCE_URI_MY);
  });
});

test("T-Wb-MY-AC3: Fallback fail-closed - kein _meta/Resource, structuredContent bleibt", async () => {
  await withGateway(RICH_STATE_BATCH, async () => {
    for (const [label, uiHost] of Object.entries(FALLBACK_CASES)) {
      const { tools, resources } = captureUi(uiHost === null ? undefined : { uiHost });
      const { config, handler } = tools.get("get_agent_number");
      assert.equal(resources.filter((resource) => resource.uri === RESOURCE_URI_MY).length, 0, `${label}: keine Resource`);
      assert.ok(ohneWidgetMeta(config), `${label}: kein Widget-_meta`);
      const result = await handler({});
      assert.deepEqual(Object.keys(result.structuredContent).sort(), ["number"], `${label}: structuredContent bleibt`);
    }
  });
});

test("T-Wb-MY-AC4: Whitelist - NUR { number }, kein agent-LEAK/PII", async () => {
  await withGateway(RICH_STATE_BATCH, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const result = await tools.get("get_agent_number").handler({});
    const serialized = JSON.stringify(result);
    for (const leak of BATCH_LEAKS) assert.ok(!serialized.includes(leak), `kein Leck von ${leak}`);
    assert.deepEqual(Object.keys(result.structuredContent).sort(), ["number"]);

    const html = await readResourceText(resources, RESOURCE_URI_MY);
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

    const listedCalls = result.structuredContent.calls;
    assert.equal(listedCalls.length, RICH_BATCH_CALL_COUNT);
    assert.deepEqual(Object.keys(listedCalls[0]).sort(), [...CALL_ENTRY_KEYS, "summary"].sort(), "c1 inkl. summary");
    assert.deepEqual(Object.keys(listedCalls[1]).sort(), CALL_ENTRY_KEYS, "c2 ohne summary");
    assert.equal(listedCalls[0].counterparty, "+4917212345678", "outbound -> to");
    assert.equal(listedCalls[1].counterparty, "+49170000000", "inbound -> from");
    assert.equal(listedCalls[1].status, "dialing", "mapStatus: active ohne answeredAt");
    assert.ok(isFormattedNotIso(listedCalls[0].startedAt), "startedAt server-formatiert (kein ISO)");
    assert.doesNotThrow(() => callsOutput.parse(result.structuredContent));
  });
});

test("T-Wb-CALLS-AC1b: leere Liste -> 'Noch keine Anrufe.' + structuredContent { calls:[] }", async () => {
  await withGateway({ calls: [] }, async () => {
    // P15/T3a: die Leertexte folgen jetzt der Tenant-Sprache. Dieser Fall pinnt den
    // DEUTSCHEN Backward-Compat-Text - die Sprache wird deshalb explizit gewaehlt,
    // statt implizit vom Weltdefault-Schalter zu leben.
    const { tools } = captureUi({ uiHost: capableHost(), language: "de" });
    const result = await tools.get("list_calls").handler({});
    assert.ok(!result.isError, "leere Liste ist kein Fehler");
    assert.equal(result.content[0].text, "Noch keine Anrufe.", "Backward-Compat-Text");
    assert.deepEqual(result.structuredContent, { calls: [] }, "leere Liste schema-konform");
  });
});

test("T-Wb-CALLS-AC2: Stufe 1 (faehiger Host) - genau eine calls-Resource + _meta", async () => {
  await withGateway(RICH_STATE_BATCH, async () => {
    const { tools, resources } = captureUi({ uiHost: capableHost() });
    const matching = resources.filter((resource) => resource.uri === RESOURCE_URI_CALLS);
    assert.equal(matching.length, 1, "genau eine calls-Resource");
    assert.equal(matching[0].config.mimeType, UI_MIME);
    assert.equal(uiResourceUriOf(tools, "list_calls"), RESOURCE_URI_CALLS);
  });
});

test("T-Wb-CALLS-AC3: Fallback fail-closed - kein _meta/Resource, structuredContent bleibt", async () => {
  await withGateway(RICH_STATE_BATCH, async () => {
    for (const [label, uiHost] of Object.entries(FALLBACK_CASES)) {
      const { tools, resources } = captureUi(uiHost === null ? undefined : { uiHost });
      const { config, handler } = tools.get("list_calls");
      assert.equal(resources.filter((resource) => resource.uri === RESOURCE_URI_CALLS).length, 0, `${label}: keine Resource`);
      assert.ok(ohneWidgetMeta(config), `${label}: kein Widget-_meta`);
      const result = await handler({});
      assert.equal(result.structuredContent.calls.length, RICH_BATCH_CALL_COUNT, `${label}: structuredContent bleibt`);
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
    const html = await readResourceText(resources, RESOURCE_URI_CALLS);
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
    // E3 (N-11): deduplicated ist additiv dazugekommen (dieselbe Begruendung, PLACE_CALL_MOCK
    // traegt es nicht -> Handler normalisiert fail-closed auf false, s. T-I10 unten fuer die
    // Wert-Pruefung).
    assert.deepEqual(Object.keys(result.structuredContent).sort(), [
      "call_id", "context_received", "deduplicated", "duration_s", "failure_reason",
      "last_transcript_lines", "objective_achieved", "result_summary", "status",
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

// ==================== P10a (H2): Kontrollfall fuer ohneWidgetMeta() ====================
// Der Helfer prueft seit P10a die Schluesselmenge von _meta STRENG (== genau die beiden
// Statuszeilen), nicht mehr nur "nicht diese zwei Widget-Schluessel". Dieser Kontrollfall
// haelt fest, dass der strengere Helfer nicht unbemerkt immer true liefert.
test("P10a (H2): ohneWidgetMeta() ist streng - true NUR bei genau den beiden Statuszeilen-Schluesseln", () => {
  const STATUS_ONLY = {
    _meta: {
      "openai/toolInvocation/invoking": "x",
      "openai/toolInvocation/invoked": "y",
    },
  };
  assert.ok(ohneWidgetMeta(STATUS_ONLY), "genau die beiden Statuszeilen-Schluessel -> true");

  const WITH_UI_KEY = {
    _meta: { ...STATUS_ONLY._meta, ui: "widget" },
  };
  assert.ok(!ohneWidgetMeta(WITH_UI_KEY), "zusaetzlich 'ui' -> false");

  const WITH_CHATGPT_KEY = {
    // Literal statt Import: der Skybridge-Alias existiert seit T2-01 nicht mehr in
    // contract.js (Adapter entfernt) - der Helfer muss trotzdem JEDEN dritten Schluessel
    // ablehnen, nicht nur die heute noch verdrahteten.
    _meta: { ...STATUS_ONLY._meta, "openai/outputTemplate": "uri" },
  };
  assert.ok(!ohneWidgetMeta(WITH_CHATGPT_KEY), "zusaetzlich openai/outputTemplate -> false");

  const WITH_THIRD_KEY = {
    _meta: { ...STATUS_ONLY._meta, irgendwas: "drittwert" },
  };
  assert.ok(!ohneWidgetMeta(WITH_THIRD_KEY), "ein beliebiger dritter Schluessel -> false");

  assert.ok(!ohneWidgetMeta({}), "fehlendes _meta -> false");
});
