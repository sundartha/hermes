import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { z } from "zod";
import { registerTools } from "../../src/mcp-tools.js";
import { mcpPost, startServer, toolCall } from "../helpers.js";
import { captureToolHandlers } from "../gemeinsam/werkzeug-registrierung.js";

function captureSchemas() {
  const schemas = new Map();
  const fakeServer = {
    registerTool(name, config) {
      schemas.set(name, config.inputSchema);
    },
    registerResource() {},
  };
  registerTools(fakeServer, {});
  return schemas;
}

const PLACE_CALL_SHAPE = {
  to: { optional: false },
  objective: { optional: false },
  briefing: { optional: true },
  constraints: { optional: true },
  mandate: { optional: true },
  context: { optional: true },
  language: { optional: true },
  max_duration_s: { optional: true },
  diagnostic: { optional: true },
};

test("P1-01: place_call-briefing-Beschreibung verlangt zusammengefassten Kontext ohne Secrets in der Assistenten-Rolle", () => {
  const schema = captureSchemas().get("place_call");
  assert.ok(schema, "place_call ist registriert");
  const briefing = schema.briefing.description || "";
  assert.match(briefing, /context/i, "nennt 'Kontext'");
  assert.match(briefing, /summari/i, "verlangt Zusammenfassen statt Roh-Dump");
  assert.match(briefing, /secret/i, "untersagt Secrets");
  assert.match(briefing, /assistant/i, "haelt die Assistenten-Rolle (kein Claude/Gemini)");
  assert.match(briefing, /never script an answer/i, "untersagt die erfundene Antwort");
  assert.match(briefing, /Leave the gap open/i, "verlangt die offene Luecke");
  assert.doesNotMatch(
    briefing,
    /agent is not allowed to say that/i,
    "behauptet kein Verbot, das mandate.on_out_of_scope widerspricht",
  );
});

test("P1-02 (nach P10/LANG-15): place_call-Schema bleibt strukturell unveraendert (gleiche Felder + Optionalitaet)", () => {
  const schema = captureSchemas().get("place_call");
  const actualKeys = Object.keys(schema).sort();
  const expectedKeys = Object.keys(PLACE_CALL_SHAPE).sort();
  assert.deepEqual(actualKeys, expectedKeys, "keine neuen/entfernten Felder");
  for (const [field, { optional }] of Object.entries(PLACE_CALL_SHAPE)) {
    assert.equal(
      schema[field].isOptional(),
      optional,
      `Optionalitaet von '${field}' unveraendert`,
    );
  }
});

test("I9-01: place_call-objective-Beschreibung verlangt Ich-Satz + konkretes Thema + warnt vor woertlichem Vorsprechen", () => {
  const schema = captureSchemas().get("place_call");
  const objective = schema.objective.description || "";
  assert.match(objective, /read out VERBATIM/i, "nennt das woertliche Vorsprechen");
  assert.match(objective, /first-person/i, "verlangt einen sprechbaren Ich-Satz");
  assert.match(objective, /no bare-infinitive stub/i, "untersagt Infinitiv-Stummel");
  assert.match(objective, /disclosure/i, "verortet es nach der Offenlegung");
  assert.match(objective, /concrete topic/i, "verlangt konkretes Thema/Anlass");
  assert.match(objective, /ask the user FIRST/i, "verlangt Rueckfrage statt vagem Auftrag");
  assert.match(objective, /topic itself/i, "die Vorab-Rueckfrage gilt nur noch dem Thema selbst");
});

test("P3-01: place_call-context ist optional + Beschreibung haelt Hintergrund-/Secret-/Assistenten-Vertrag", () => {
  const schema = captureSchemas().get("place_call");
  assert.ok(schema.context, "context ist registriert");
  assert.equal(schema.context.isOptional(), true, "context ist optional (advisory)");
  const desc = schema.context.description || "";
  assert.match(desc, /background/i, "nennt 'Hintergrund'");
  assert.match(desc, /secret/i, "untersagt Secrets");
  assert.match(desc, /assistant/i, "haelt die Assistenten-Rolle (kein Claude/Gemini)");
});

test("P6-01: place_call-mandate ist optional + Beschreibungen halten E1-/Vorrang-/Enum-Vertrag", () => {
  const schema = captureSchemas().get("place_call");
  assert.ok(schema.mandate, "mandate ist registriert");
  assert.equal(schema.mandate.isOptional(), true, "mandate ist optional (advisory)");
  const desc = schema.mandate.description || "";
  assert.match(desc, /mandate/i, "nennt 'Mandat'");
  assert.match(
    desc,
    /books NOTHING|NO calendar access/i,
    "haelt den E1-Vertrag (kein Buchen/Kalenderzugriff)",
  );
  assert.match(desc, /constraints ALWAYS win/i, "nennt den constraints-Vorrang");
  const inner = schema.mandate.unwrap();
  const decideFreely = inner.shape.decide_freely.description || "";
  assert.match(decideFreely, /concretely/i, "decide_freely verlangt Konkretheit");
  assert.match(decideFreely, /constraints/i, "decide_freely verweist auf constraints");
  const onOutOfScope = inner.shape.on_out_of_scope.description || "";
  assert.match(onOutOfScope, /take_message/, "on_out_of_scope dokumentiert take_message");
  assert.match(onOutOfScope, /decline/, "on_out_of_scope dokumentiert decline");
  assert.match(onOutOfScope, /accept_best/, "on_out_of_scope dokumentiert accept_best");
});

const PLACE_CALL_INPUT = Object.freeze({
  to: "+4915112345678",
  objective: "I would like to book a men's haircut for Max on Saturday morning.",
});
const OFFENE_FRAGEN = Object.freeze(["Welche Uhrzeit passt genau?", "Darf es auch Freitag sein?"]);
const KEY_FACTS = Object.freeze(["Stammkunde seit drei Jahren"]);
const CONTEXT_MIT_FRAGEN = Object.freeze({ key_facts: KEY_FACTS, open_questions: OFFENE_FRAGEN });

test("AL-P9-10: ueber das place_call-Schema uebergebene open_questions ueberleben die Schema-Pruefung", () => {
  const schema = captureSchemas().get("place_call");
  const geparst = z.object(schema).parse({ ...PLACE_CALL_INPUT, context: CONTEXT_MIT_FRAGEN });

  assert.deepEqual(
    geparst.context?.key_facts,
    KEY_FACTS,
    "Positiv-Kontrolle: ein deklariertes Geschwisterfeld ueberlebt denselben Parse - faellt schon das aus, misst der Fall unten nicht das Strippen",
  );
  assert.deepEqual(
    geparst.context?.open_questions,
    OFFENE_FRAGEN,
    "open_questions ist im context-Objekt von place_call nicht deklariert und wird von zod still gestrippt - der Eroeffnungs-Consult (AL-P13) kann ueber place_call deshalb NIE feuern, obwohl Validierung (routes/_validation.js) und Auswertung (routes/api-calls.js emitOpeningConsult) dafuer gebaut sind",
  );
});

const CALL_ZIEL = "+4915112345678";
const HTTP_UNAUTHORIZED = 401;
const E2E_ENV = Object.freeze({
  ASSISTANT_CONTEXT_ENABLED: "true",
  FAKE_ORIGINATE: "true",
  ALLOWED_COUNTRY_CODES: "*",
});

test("AL-P9-11: ueber die MCP-Route uebergebene open_questions stehen am Call-Datensatz", async () => {
  const srv = await startServer({ env: E2E_ENV });
  try {
    const placeCallArgs = { ...PLACE_CALL_INPUT, to: CALL_ZIEL, context: CONTEXT_MIT_FRAGEN };
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("place_call", placeCallArgs));
    assert.notEqual(res.status, HTTP_UNAUTHORIZED, "Vorbedingung: die MCP-Route nimmt den Aufruf an");
    const antwort = await res.text();

    const call = srv.readStore().calls.find((eintrag) => eintrag.to === CALL_ZIEL);
    assert.ok(call, `Vorbedingung: kein Call-Datensatz angelegt - Antwort: ${antwort}`);
    assert.deepEqual(
      call.context?.key_facts,
      KEY_FACTS,
      "Positiv-Kontrolle: ein deklariertes Geschwisterfeld erreicht den Record ueber genau diesen Weg",
    );
    assert.deepEqual(
      call.context?.open_questions,
      OFFENE_FRAGEN,
      "die offenen Fragen erreichen den Call-Datensatz nicht - emitOpeningConsult liest ein leeres Feld und legt keinen Consult an, der Anruf laeuft ohne die Antworten, die er gebraucht haette",
    );
  } finally {
    await srv.stop();
  }
});

const HTTP_OK = 200;
const JSON_EINRUECKUNG = 2;
const GATEWAY_CALL_ID = "call_gateway_a9";
const GESTARTET = Object.freeze({ callId: GATEWAY_CALL_ID });

async function mitGateway(antworten, lauf) {
  const anfragen = [];
  const gateway = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (stueck) => {
      roh += stueck;
    });
    req.on("end", () => {
      const anfrage = { methode: req.method, pfad: req.url, body: roh ? JSON.parse(roh) : null };
      anfragen.push(anfrage);
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(JSON.stringify(antworten.anruf ?? {}));
    });
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const vorher = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = `http://127.0.0.1:${gateway.address().port}`;
  try {
    return await lauf(anfragen);
  } finally {
    if (vorher === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = vorher;
    await new Promise((resolve) => gateway.close(resolve));
  }
}

const werkzeugHandler = (optionen) => captureToolHandlers({ language: "de", ...optionen });

const anrufStarts = (anfragen) =>
  anfragen.filter((anfrage) => anfrage.methode === "POST" && anfrage.pfad === "/api/calls");

const startText = (callId) => JSON.stringify({ call_id: callId, status: "dialing" }, null, JSON_EINRUECKUNG);

test("a9-02: place_call schickt alle Argumente an den Anrufstart und holt keine Bestaetigung", async () => {
  await mitGateway({ anruf: GESTARTET }, async (anfragen) => {
    const args = { ...PLACE_CALL_INPUT, context: CONTEXT_MIT_FRAGEN };
    const ergebnis = await werkzeugHandler({}).get("place_call")(args);
    assert.notEqual(ergebnis.isError, true, "Vorbedingung: der Anruf startet");
    assert.deepEqual(anrufStarts(anfragen)[0]?.body, args, "der Anruf traegt genau die Argumente");
    assert.equal(anfragen.length, 1, "Positiv-Kontrolle: genau ein Gateway-Aufruf");
    assert.equal(anfragen[0].pfad, "/api/calls", "kein Weg ueber die Bestaetigungs-Route");
  });
});

test("a9-03: place_call-Text ist ohne Hinweise genau die Startzeile", async () => {
  await mitGateway({ anruf: GESTARTET }, async () => {
    const ergebnis = await werkzeugHandler({}).get("place_call")({ ...PLACE_CALL_INPUT });
    assert.equal(ergebnis.content[0].text, startText(GATEWAY_CALL_ID));
    assert.equal(ergebnis.structuredContent.deduplicated, false);
  });
});

test("a9-04: place_call haengt die Hinweise je auf einer eigenen Zeile hinter die Startzeile", async () => {
  await mitGateway({ anruf: { ...GESTARTET, deduplicated: true } }, async () => {
    const ergebnis = await werkzeugHandler({ consultAllowed: true }).get("place_call")({
      ...PLACE_CALL_INPUT,
    });
    const text = ergebnis.content[0].text;
    const start = startText(GATEWAY_CALL_ID);
    assert.ok(text.startsWith(`${start}\n`), `Startzeile, dann Zeilenumbruch - Text: ${text}`);
    const hinweise = text.slice(start.length + 1).split("\n");
    assert.equal(hinweise.length, 2, "ein Hinweis fuer den laufenden Anruf, einer fuer die Rueckfragen");
    for (const hinweis of hinweise) assert.ok(hinweis.length > 0, "kein leerer Hinweis");
    assert.equal(ergebnis.structuredContent.deduplicated, true);
  });
});
