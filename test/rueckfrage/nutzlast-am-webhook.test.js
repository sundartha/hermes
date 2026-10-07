import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "../helpers.js";

const CONSULT_PATH = "/webhooks/elevenlabs/consult";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
const TOOL_TOKEN = "el-tool-token-testgeheim";

const CALL_ID = "call_el_nutzlast";
const CONVERSATION_ID = "conv_el_nutzlast_1";
const QUESTION =
  "The workshop is asking for the make, model and year of the car - what should I tell them?";

const HTTP_BAD_REQUEST = 400;
const KEINE_FRAGE = "keine_frage";
const FRAGE_ALS_ZAHL = 42;

const CONSULT_ON_ENV = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN,
  CONSULT_WAIT_MS: "200",
  CONSULT_OPEN_MS: "1500",
  EL_CONSULT_DELIVERY_MS: "400",
  EL_CONSULT_ACK_MS: "400",
  EL_CONSULT_ANSWER_MS: "1500",
});

const postRaw = (srv, rawBody) =>
  fetch(`${srv.localUrl}${CONSULT_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [TOOL_TOKEN_HEADER]: TOOL_TOKEN },
    body: rawBody,
  });

const post = (srv, body) => postRaw(srv, JSON.stringify(body));

const callOf = (srv) => srv.readStore().calls.find((call) => call.id === CALL_ID);
const consultCount = (srv) => (callOf(srv).consults ?? []).length;

const anbieterNutzlast = (question) => ({ question, conversation_id: CONVERSATION_ID });

const seedFor = (conversationId) =>
  seedState({
    calls: [
      seedCall({
        id: CALL_ID,
        status: "active",
        direction: "outbound",
        maxDurationS: 300,
        elevenlabsConversationId: conversationId,
      }),
    ],
  });

async function mitServer(conversationId, pruefen) {
  const srv = await startServer({ env: CONSULT_ON_ENV, seed: seedFor(conversationId) });
  try {
    await pruefen(srv);
  } finally {
    await srv.stop();
  }
}

async function assertKeineFrage(res) {
  assert.equal(
    res.status,
    HTTP_BAD_REQUEST,
    `400 erwartet, war ${res.status}: ${await res.clone().text()}`,
  );
  assert.equal((await res.json()).error, KEINE_FRAGE);
}

async function assertAngenommen(res) {
  assert.ok(res.ok, `2xx erwartet, war ${res.status}: ${await res.clone().text()}`);
}

test("EL-CONSULT NUTZLAST 1: die gemessene flache Anbieter-Form wird angenommen, die Frage kommt von oberster Ebene", (ctx) =>
  mitServer(CONVERSATION_ID, async (srv) => {
    const res = await post(srv, anbieterNutzlast(QUESTION));

    await ctx.test("angenommen (2xx), kein Gate hat gesperrt", () => assertAngenommen(res));

    await ctx.test("die Frage von oberster Ebene steht am Consult, nicht leer", () => {
      const consults = callOf(srv).consults;
      assert.equal(consults.length, 1);
      assert.equal(
        consults[0].questions[0],
        QUESTION,
        "der Handler muss req.body.question lesen - die gemessene Anbieter-Form ist flach",
      );
    });
  }));

test("EL-CONSULT NUTZLAST 2: ein Rumpf ohne question wird als Fehler beantwortet, nicht still als leere Frage", (ctx) =>
  mitServer(CONVERSATION_ID, async (srv) => {
    const res = await post(srv, { conversation_id: CONVERSATION_ID });

    await ctx.test("400, kein stiller Erfolg", () => assertKeineFrage(res));

    await ctx.test("kein Consult mit leerer Frage entstanden", () => {
      assert.equal(consultCount(srv), 0, "eine leere Frage waere die schlechtere Luege");
    });
  }));

test("EL-CONSULT NUTZLAST 3: question als Nicht-String oder leer/nur Leerraum -> 400, kein Consult", (ctx) =>
  mitServer(CONVERSATION_ID, async (srv) => {
    const fragtMit = async (question) =>
      assertKeineFrage(await post(srv, { conversation_id: CONVERSATION_ID, question }));

    await ctx.test("leerer String -> 400", () => fragtMit(""));
    await ctx.test("nur Leerraum -> 400", () => fragtMit("   \n\t "));
    await ctx.test("Zahl -> 400", () => fragtMit(FRAGE_ALS_ZAHL));
    await ctx.test("null -> 400", () => fragtMit(null));
    await ctx.test("Objekt -> 400", () => fragtMit({ text: QUESTION }));
    await ctx.test("Liste -> 400", () => fragtMit([QUESTION]));
    await ctx.test("boolesch true -> 400", () => fragtMit(true));

    await ctx.test("kein einziger Consult entstanden", () => {
      assert.equal(consultCount(srv), 0);
    });
  }));

test("EL-CONSULT NUTZLAST 4: die alte parameters-Umschlag-Form wird abgelehnt (kein Doppelweg)", (ctx) =>
  mitServer(CONVERSATION_ID, async (srv) => {
    const res = await post(srv, {
      tool_call_id: "call_abc123",
      tool_name: "get_consult",
      parameters: { question: QUESTION },
      conversation_id: CONVERSATION_ID,
    });

    await ctx.test("400 mit demselben Grund wie eine fehlende Frage", () => assertKeineFrage(res));

    await ctx.test("kein Consult aus dem Umschlag entstanden", () => {
      assert.equal(consultCount(srv), 0, "kein stiller Rueckfall auf parameters.question");
    });
  }));

const AUFGEZEICHNETER_KOERPER =
  '{"question": "Welche Automarke, Modell und Baujahr hat Antonio Fotiadis\' Auto für die Bremsenprüfung?", "conversation_id": "conv_5501m0at0c3metdvggs6key1dehs"}';
const AUFGEZEICHNETE_CONVERSATION = "conv_5501m0at0c3metdvggs6key1dehs";

test("EL-CONSULT NUTZLAST 5: der woertlich aufgezeichnete Anbieter-Aufruf wird angenommen", (ctx) =>
  mitServer(AUFGEZEICHNETE_CONVERSATION, async (srv) => {
    const res = await postRaw(srv, AUFGEZEICHNETER_KOERPER);

    await ctx.test("angenommen (2xx) - genau dieser Koerper ergab am alten Handler 400", () =>
      assertAngenommen(res),
    );

    await ctx.test("die Frage des Anbieters steht am Consult", () => {
      const consults = callOf(srv).consults;
      assert.equal(consults.length, 1);
      assert.match(consults[0].questions[0], /Automarke/);
    });
  }));
