// ---- Umschlag-Form des ElevenLabs-Rueckfrage-Webhooks (Werkzeug get_consult) ----------
// Reparatur-Beleg: der Anbieter schickt Werkzeug-Aufrufe NICHT flach, sondern in einem
// Umschlag - schema-deklarierte Parameter (hier: question) liegen unter "parameters",
// NUR conversation_id liegt auf oberster Ebene. Vor dieser Reparatur las der Handler
// req.body?.question (oberste Ebene) und fand deshalb bei einem echten Anbieter-Aufruf
// nie etwas - eine leere Frage wurde still an das Laufwerk zurueckgegeben, ohne dass
// irgendwo ein Fehler sichtbar wurde.
//
// KENNZEICHNUNGS-PFLICHT (Vorgabe des Eigentuemers): die Umschlag-Form unten ist NICHT aus
// einem echten Mitschnitt eines Anbieter-Aufrufs, sondern woertlich aus der
// Anleitungs-Dokumentation des Anbieters uebernommen - elevenlabs/skills (GitHub-Repo),
// Datei agents/references/client-tools.md, Abschnitt "Webhook Request Format":
//   {"tool_call_id":"call_abc123","tool_name":"get_weather","parameters":{...},
//    "conversation_id":"conv_xyz789"}
// Ein echter Mitschnitt eines get_consult-Aufrufs steht noch aus. Erfunden ist an der
// Nutzlast unten NICHTS: Feldnamen und Verschachtelung sind woertlich aus dem Zitat,
// tool_name/tool_call_id sind fuer diese Tests beliebige, aber PLAUSIBLE Werte (der
// Handler liest sie nicht, s. src/routes/webhooks-elevenlabs.js).
//
// Spawn-basiert ueber die ECHTE HTTP-Route (Muster
// test/elevenlabs-consult-webhook-guards.test.js): ein Gate, das nur in einer Funktion
// sitzt, aber nicht in der Route haengt, wuerde sonst gruen messen. Token-, Bindungs-,
// Faehigkeits- und Geld-Pruefung sind dort bereits gepinnt und werden hier NICHT
// wiederholt - Faelle hier bleiben in ALLEN diesen Gates im Gutfall, damit ausschliesslich
// die Umschlag-Form den Ausschlag gibt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";

const CONSULT_PATH = "/webhooks/elevenlabs/consult";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
const TOOL_TOKEN = "el-tool-token-testgeheim";

const CALL_ID = "call_el_umschlag";
const CONVERSATION_ID = "conv_el_umschlag_1";
const QUESTION = "Darf ich den Termin am Donnerstag zusagen?";

// HTTP_BAD_REQUEST ist der neue Ablehnungscode dieser Reparatur (routes/webhooks-elevenlabs.js).
const HTTP_BAD_REQUEST = 400;
const KEIN_PARAMETER_UMSCHLAG = "kein_parameter_umschlag";

const CONSULT_ON_ENV = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN,
  CONSULT_WAIT_MS: "200",
  CONSULT_OPEN_MS: "1500",
});

const post = (srv, body) =>
  fetch(`${srv.localUrl}${CONSULT_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [TOOL_TOKEN_HEADER]: TOOL_TOKEN },
    body: JSON.stringify(body),
  });

const callOf = (srv) => srv.readStore().calls.find((call) => call.id === CALL_ID);
const consultCount = (srv) => (callOf(srv).consults ?? []).length;

// Woertlich die Umschlag-Form aus client-tools.md, s. Kommentar am Dateikopf - nur die
// beiden Felder befuellt, die dieser Handler tatsaechlich liest (question, conversation_id).
const anbieterUmschlag = (question) => ({
  tool_call_id: "call_abc123",
  tool_name: "get_consult",
  parameters: { question },
  conversation_id: CONVERSATION_ID,
});

const seed = () =>
  seedState({
    calls: [
      seedCall({
        id: CALL_ID,
        status: "active",
        direction: "outbound",
        maxDurationS: 300,
        elevenlabsConversationId: CONVERSATION_ID,
      }),
    ],
  });

test("EL-CONSULT UMSCHLAG 1: die dokumentierte Anbieter-Form wird angenommen, die Frage kommt aus parameters.question", async (ctx) => {
  const srv = await startServer({ env: CONSULT_ON_ENV, seed: seed() });
  try {
    const res = await post(srv, anbieterUmschlag(QUESTION));

    await ctx.test("angenommen (2xx), kein Gate hat gesperrt", async () => {
      assert.ok(res.ok, `2xx erwartet, war ${res.status}: ${await res.clone().text()}`);
    });

    await ctx.test("die Frage aus parameters.question steht am Consult, nicht leer", () => {
      const consults = callOf(srv).consults;
      assert.equal(consults.length, 1);
      assert.equal(
        consults[0].questions[0],
        QUESTION,
        "der Handler muss parameters.question lesen, nicht req.body.question (oberste Ebene)",
      );
    });
  } finally {
    await srv.stop();
  }
});

test("EL-CONSULT UMSCHLAG 2: ein Rumpf ohne parameters wird als Fehler beantwortet, nicht still als leere Frage", async (ctx) => {
  const srv = await startServer({ env: CONSULT_ON_ENV, seed: seed() });
  try {
    // conversation_id bindet einen gueltigen, laufenden Anruf - Token/Bindung/Faehigkeit/
    // Geld sind also alle im Gutfall. NUR "parameters" fehlt (question waere hier frueher
    // faelschlich auf oberster Ebene gesucht worden).
    const res = await post(srv, { conversation_id: CONVERSATION_ID, question: QUESTION });

    await ctx.test("400, kein stiller Erfolg", async () => {
      assert.equal(
        res.status,
        HTTP_BAD_REQUEST,
        `400 erwartet, war ${res.status}: ${await res.clone().text()}`,
      );
      assert.equal((await res.json()).error, KEIN_PARAMETER_UMSCHLAG);
    });

    await ctx.test("kein Consult mit leerer Frage entstanden", () => {
      assert.equal(consultCount(srv), 0, "eine leere Frage waere die schlechtere Luege");
    });
  } finally {
    await srv.stop();
  }
});

test("EL-CONSULT UMSCHLAG 3: conversation_id wird weiterhin von der obersten Ebene gelesen", async () => {
  const srv = await startServer({ env: CONSULT_ON_ENV, seed: seed() });
  try {
    // Genau die Anbieter-Form: conversation_id NEBEN dem Umschlag, nicht darin. Wuerde der
    // Handler versehentlich in parameters.conversation_id suchen, faende er nichts und
    // dieser (gueltige) Aufruf schluege fehl.
    const res = await post(srv, anbieterUmschlag(QUESTION));
    assert.ok(res.ok, `2xx erwartet (conversation_id ausserhalb von parameters), war ${res.status}`);
    assert.equal(consultCount(srv), 1);
  } finally {
    await srv.stop();
  }
});
