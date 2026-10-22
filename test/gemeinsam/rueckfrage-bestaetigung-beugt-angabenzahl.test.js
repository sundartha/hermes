import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { captureToolHandlers } from "./werkzeug-registrierung.js";

const CALL_ID = "call_angabenzahl";
const EVENT_ID = "c0";
const HTTP_OK = 200;

async function mitGateway(mergedFacts, pruefung) {
  const server = http.createServer((req, res) => {
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify({ accepted: true, merged_facts: mergedFacts }));
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  const vorher = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    return await pruefung();
  } finally {
    process.env.GATEWAY_URL = vorher;
    await new Promise((fertig) => server.close(fertig));
  }
}

async function antwortAufRueckfrage({ sprache, mergedFacts, status, answers }) {
  return mitGateway(mergedFacts, async () => {
    const handler = captureToolHandlers({ consultAllowed: true, language: sprache }).get("answer_consult");
    return handler({ call_id: CALL_ID, event_id: EVENT_ID, status, answers });
  });
}

async function pruefeBestaetigung({ sprache, mergedFacts, answers, text }) {
  const ergebnis = await antwortAufRueckfrage({ sprache, mergedFacts, status: "final", answers });
  assert.equal(ergebnis.content[0].text, text);
}

test("answer_consult final: S1: Englisch, 1 Angabe in der Einzahl", () =>
  pruefeBestaetigung({ sprache: "en", mergedFacts: 1, answers: ["Bello"], text: "1 detail passed on to the call." }));

test("answer_consult final: S2: Englisch, 2 Angaben in der Mehrzahl", () =>
  pruefeBestaetigung({ sprache: "en", mergedFacts: 2, answers: ["Bello", "Freitag"], text: "2 details passed on to the call." }));

test("answer_consult final: S3: Deutsch, 1 Angabe in der Einzahl", () =>
  pruefeBestaetigung({ sprache: "de", mergedFacts: 1, answers: ["Bello"], text: "1 Angabe an den Anruf uebergeben." }));

test("answer_consult final: S4: Deutsch, 3 Angaben in der Mehrzahl", () =>
  pruefeBestaetigung({ sprache: "de", mergedFacts: 3, answers: ["Bello", "Freitag", "10 Uhr"], text: "3 Angaben an den Anruf uebergeben." }));

test("answer_consult final: S5: Französisch, 0 Angaben in der Einzahl", () =>
  pruefeBestaetigung({ sprache: "fr", mergedFacts: 0, answers: ["Bello"], text: "0 information transmise à l'appel." }));

test("answer_consult final: S6: Französisch, 2 Angaben in der Mehrzahl", () =>
  pruefeBestaetigung({ sprache: "fr", mergedFacts: 2, answers: ["Bello", "vendredi"], text: "2 informations transmises à l'appel." }));

test("B1: answer_consult final liefert accepted true und merged_facts 2 in der strukturierten Antwort", async () => {
  const ergebnis = await antwortAufRueckfrage({
    sprache: "en",
    mergedFacts: 2,
    status: "final",
    answers: ["Bello", "Freitag"],
  });
  assert.equal(ergebnis.structuredContent.accepted, true);
  assert.equal(ergebnis.structuredContent.merged_facts, 2);
});

test("B2: answer_consult working bestaetigt mit dem festen Text ohne Zahl", async () => {
  const ergebnis = await antwortAufRueckfrage({ sprache: "en", mergedFacts: 7, status: "working" });
  assert.equal(ergebnis.content[0].text, "Consult acknowledged - the answer is expected next.");
});
