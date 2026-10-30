import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { registerTools } from "../src/mcp-tools.js";
import { resolveLocale, WIDGET_DICT, WIDGET_CONTENT_LOCALE_META_KEY } from "../src/ui/widget-i18n.js";

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

const FERTIGER_ANRUF = { status: "completed", language: "fr", startedAt: "2026-06-26T09:59:50.000Z", endedAt: "2026-06-26T10:02:00.000Z", transcript: [] };
const ANBIETER_ANRUF = { ...FERTIGER_ANRUF, language: "de", summary: "The AI agent greeted Antonio." };
const EIGENER_ANRUF = { ...FERTIGER_ANRUF, language: "fr", summary: "Rendez-vous confirmé.", result: { outcome: "Rendez-vous samedi" } };

async function inhaltssprache({ tool, mandant, gateway, args = {} }) {
  return withGateway(gateway, async () => {
    const handlers = captureTools({ identity: null, scopedTenant: "tenant-x", language: mandant, uiHost: { enabled: true } });
    const result = await handlers.get(tool)(args);
    return { result, tag: result._meta?.[WIDGET_CONTENT_LOCALE_META_KEY], hat: WIDGET_CONTENT_LOCALE_META_KEY in (result._meta ?? {}) };
  });
}

test("WSP-S1: get_call_result nennt die Sprache seines Ergebnis-Texts - eigene Auswertung in der Anrufsprache, Anbieter-Text unbekannt, Platzhalter in der Mandantensprache", async () => {
  const faelle = [
    { name: "eigene Auswertung (Karte) in Anrufsprache fr", anruf: EIGENER_ANRUF, mandant: "de", erwartet: "fr" },
    { name: "Anbieter-Zusammenfassung ohne Karte", anruf: ANBIETER_ANRUF, mandant: "de", erwartet: null },
    { name: "beendet ohne Text -> Platzhalter des Mandanten", anruf: FERTIGER_ANRUF, mandant: "de", erwartet: "de" },
    { name: "Fehlschlag ohne Text -> Fehlertext des Mandanten", anruf: { ...FERTIGER_ANRUF, status: "failed", failureReason: "no-answer" }, mandant: "en", erwartet: "en" },
  ];
  for (const fall of faelle) {
    const { tag, hat } = await inhaltssprache({ tool: "get_call_result", mandant: fall.mandant, gateway: fall.anruf, args: { call_id: "call_1" } });
    assert.equal(hat, true, `${fall.name}: Feld vorhanden`);
    assert.equal(tag, fall.erwartet, fall.name);
  }
});

test("WSP-S2: der Platzhalter 'noch keine Zusammenfassung' steht in der Mandantensprache, nie fest deutsch", async () => {
  const texte = {};
  for (const sprache of ["de", "en", "fr"]) {
    const { result } = await inhaltssprache({ tool: "get_call_result", mandant: sprache, gateway: FERTIGER_ANRUF, args: { call_id: "call_1" } });
    texte[sprache] = result.structuredContent.result_summary;
  }
  assert.match(texte.de, /Noch keine Zusammenfassung/);
  assert.doesNotMatch(texte.en, /Noch keine|Zusammenfassung/);
  assert.match(texte.en, /summary/i);
  assert.match(texte.fr, /résumé/i);
  assert.equal(new Set(Object.values(texte)).size, 3, "drei Sprachen, drei Texte");
});

test("WSP-S3: list_calls nennt die Sprache aller Zusammenfassungen - eine fremde oder unbekannte macht die ganze Liste unbekannt", async () => {
  const faelle = [
    { name: "leere Liste -> Mandantensprache", calls: [], erwartet: "de" },
    { name: "nur Anrufe ohne Text -> Mandantensprache", calls: [FERTIGER_ANRUF], erwartet: "de" },
    { name: "alle eigene Auswertung in derselben Sprache", calls: [{ ...EIGENER_ANRUF, language: "de" }, { ...EIGENER_ANRUF, language: "de" }], erwartet: "de" },
    { name: "ein Anbieter-Text", calls: [{ ...EIGENER_ANRUF, language: "de" }, ANBIETER_ANRUF], erwartet: null },
    { name: "zwei Anrufsprachen", calls: [{ ...EIGENER_ANRUF, language: "de" }, EIGENER_ANRUF], erwartet: null },
  ];
  for (const fall of faelle) {
    const { tag } = await inhaltssprache({ tool: "list_calls", mandant: "de", gateway: { calls: fall.calls } });
    assert.equal(tag, fall.erwartet, fall.name);
  }
});

test("WSP-S4: jedes Widget-Werkzeug nennt Mandantensprache und Inhaltssprache, ohne Widget bleibt das Ergebnis frei davon", async () => {
  for (const sprache of ["de", "fr"]) {
    const { result, tag } = await inhaltssprache({ tool: "get_agent_number", mandant: sprache, gateway: { agent: { number: "+4930" } } });
    assert.equal(result._meta["hermes/locale"], sprache);
    assert.equal(tag, sprache);
  }
  const ohneWidget = await inhaltssprache({ tool: "get_call_status", mandant: "de", gateway: ANBIETER_ANRUF, args: { call_id: "call_1" } });
  assert.equal(ohneWidget.hat, false, "get_call_status hat kein Widget");
});
