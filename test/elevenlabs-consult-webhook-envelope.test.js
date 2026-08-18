// ---- Nutzlast-Form des ElevenLabs-Rueckfrage-Webhooks (Werkzeug get_consult) ----------
// Der Anbieter sendet FLACH: der schema-deklarierte Parameter question liegt direkt auf
// oberster Ebene, es gibt KEINEN "parameters"-Umschlag.
//
// BELEG - und diesmal ein GEMESSENER, kein zitierter: am 18.08.2026 lief ein echter Anruf
// (call_msyexvu3q5r9, Anbieter-Gespraech conv_3701m0a0fxnzen79mjd8qfcp6k00). Der Agent rief
// get_consult zweimal auf; der Koerper aus dem Anbieter-Datensatz (tool_details.body) lautet
// woertlich:
//   {"question": "The workshop is asking for the car's make, model, and year for the brake
//    inspection appointment - what should I tell them?"}
// Mehr steht nicht drin. Die frueher hier gepinnte Umschlag-Form stammte aus
// agents/references/client-tools.md - dem Abschnitt fuer CLIENT-Tools. Wir betreiben ein
// WEBHOOK-Tool, fuer das dieses Format nicht gilt; die Umschlag-Form wird ab jetzt ABGELEHNT
// (Fall 4). Kein Doppelweg - der wuerde genau diesen Fehler wieder verdecken.
//
// FAIL-CLOSED: fehlt question, ist es kein String oder nur Leerraum, antwortet der Handler
// 400 und legt KEINEN Consult an. Eine leere Frage waere die schlechtere Luege - sie
// gaukelte dem Modell etwas zum Beantworten vor (s. toolResultText in
// src/routes/webhooks-elevenlabs.js).
//
// Spawn-basiert ueber die ECHTE HTTP-Route (Muster
// test/elevenlabs-consult-webhook-guards.test.js): ein Gate, das nur in einer Funktion
// sitzt, aber nicht in der Route haengt, wuerde sonst gruen messen. Token-, Bindungs-,
// Faehigkeits- und Geld-Pruefung sind dort bereits gepinnt und werden hier NICHT
// wiederholt - Faelle hier bleiben in ALLEN diesen Gates im Gutfall, damit ausschliesslich
// die Nutzlast-Form den Ausschlag gibt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";

const CONSULT_PATH = "/webhooks/elevenlabs/consult";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
const TOOL_TOKEN = "el-tool-token-testgeheim";

const CALL_ID = "call_el_nutzlast";
const CONVERSATION_ID = "conv_el_nutzlast_1";
// Der Wortlaut ist beliebig - gemessen wird hier ausschliesslich die LAGE des Feldes
// (oberste Ebene). Bewusst OHNE Apostroph, anders als die Original-Frage im Kopfkommentar:
// der Paraphrase-Riegel (consult/question.js, AL-P14) normalisiert Zitatzeichen, und die
// Gleichheit in Fall 1 wuerde sonst an einem Sachverhalt scheitern, den diese Datei nicht
// misst.
const QUESTION =
  "The workshop is asking for the make, model and year of the car - what should I tell them?";

// HTTP_BAD_REQUEST ist der Ablehnungscode der Nutzlast-Pruefung (routes/webhooks-elevenlabs.js).
const HTTP_BAD_REQUEST = 400;
const KEINE_FRAGE = "keine_frage";

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

// Die gemessene Anbieter-Nutzlast. conversation_id steht daneben, weil das Werkzeug am
// Anbieter getrennt so konfiguriert wird, dass es die Anbieter-Systemvariable als
// Body-Parameter mitschickt - Schritt 2 des Handlers liest sie unveraendert von oberster
// Ebene und ist NICHT Gegenstand dieser Datei.
const anbieterNutzlast = (question) => ({ question, conversation_id: CONVERSATION_ID });

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

// Fall 1 ist die Positiv-Kontrolle bis zur WIRKUNG: ohne ihn bestuende ein Handler, der
// jede Nutzlast ablehnt, die drei Ablehnungsfaelle darunter muehelos.
test("EL-CONSULT NUTZLAST 1: die gemessene flache Anbieter-Form wird angenommen, die Frage kommt von oberster Ebene", async (ctx) => {
  const srv = await startServer({ env: CONSULT_ON_ENV, seed: seed() });
  try {
    const res = await post(srv, anbieterNutzlast(QUESTION));

    await ctx.test("angenommen (2xx), kein Gate hat gesperrt", async () => {
      assert.ok(res.ok, `2xx erwartet, war ${res.status}: ${await res.clone().text()}`);
    });

    await ctx.test("die Frage von oberster Ebene steht am Consult, nicht leer", () => {
      const consults = callOf(srv).consults;
      assert.equal(consults.length, 1);
      assert.equal(
        consults[0].questions[0],
        QUESTION,
        "der Handler muss req.body.question lesen - die gemessene Anbieter-Form ist flach",
      );
    });
  } finally {
    await srv.stop();
  }
});

test("EL-CONSULT NUTZLAST 2: ein Rumpf ohne question wird als Fehler beantwortet, nicht still als leere Frage", async (ctx) => {
  const srv = await startServer({ env: CONSULT_ON_ENV, seed: seed() });
  try {
    // conversation_id bindet einen gueltigen, laufenden Anruf - Token/Bindung/Faehigkeit/
    // Geld sind also alle im Gutfall. NUR question fehlt.
    const res = await post(srv, { conversation_id: CONVERSATION_ID });

    await ctx.test("400, kein stiller Erfolg", async () => {
      assert.equal(
        res.status,
        HTTP_BAD_REQUEST,
        `400 erwartet, war ${res.status}: ${await res.clone().text()}`,
      );
      assert.equal((await res.json()).error, KEINE_FRAGE);
    });

    await ctx.test("kein Consult mit leerer Frage entstanden", () => {
      assert.equal(consultCount(srv), 0, "eine leere Frage waere die schlechtere Luege");
    });
  } finally {
    await srv.stop();
  }
});

// Die Raender (T5/G3): question vorhanden, aber unbrauchbar. Ein Handler, der nur auf
// "Feld da?" prueft, reichte hier eine leere oder gar keine Zeichenkette an das Modell
// weiter - genau die Luege, die Fall 2 verbietet.
test("EL-CONSULT NUTZLAST 3: question als Nicht-String oder leer/nur Leerraum -> 400, kein Consult", async (ctx) => {
  const srv = await startServer({ env: CONSULT_ON_ENV, seed: seed() });
  try {
    const unbrauchbar = {
      "leerer String": "",
      "nur Leerraum": "   \n\t ",
      Zahl: 42,
      "null": null,
      Objekt: { text: QUESTION },
      Liste: [QUESTION],
      "boolesch true": true,
    };
    for (const [name, question] of Object.entries(unbrauchbar)) {
      await ctx.test(`${name} -> 400`, async () => {
        const res = await post(srv, { conversation_id: CONVERSATION_ID, question });
        assert.equal(
          res.status,
          HTTP_BAD_REQUEST,
          `400 erwartet, war ${res.status}: ${await res.clone().text()}`,
        );
        assert.equal((await res.json()).error, KEINE_FRAGE);
      });
    }

    await ctx.test("kein einziger Consult entstanden", () => {
      assert.equal(consultCount(srv), 0);
    });
  } finally {
    await srv.stop();
  }
});

test("EL-CONSULT NUTZLAST 4: die alte parameters-Umschlag-Form wird abgelehnt (kein Doppelweg)", async (ctx) => {
  const srv = await startServer({ env: CONSULT_ON_ENV, seed: seed() });
  try {
    // Exakt die Form aus agents/references/client-tools.md, die dieser Handler frueher las.
    // Sie gilt fuer CLIENT-Tools, nicht fuer Webhook-Tools - und ein zweiter Lesepfad
    // daneben wuerde eine erneut abweichende Anbieter-Form wieder unsichtbar machen.
    const res = await post(srv, {
      tool_call_id: "call_abc123",
      tool_name: "get_consult",
      parameters: { question: QUESTION },
      conversation_id: CONVERSATION_ID,
    });

    await ctx.test("400 mit demselben Grund wie eine fehlende Frage", async () => {
      assert.equal(
        res.status,
        HTTP_BAD_REQUEST,
        `400 erwartet, war ${res.status}: ${await res.clone().text()}`,
      );
      assert.equal((await res.json()).error, KEINE_FRAGE);
    });

    await ctx.test("kein Consult aus dem Umschlag entstanden", () => {
      assert.equal(consultCount(srv), 0, "kein stiller Rueckfall auf parameters.question");
    });
  } finally {
    await srv.stop();
  }
});
