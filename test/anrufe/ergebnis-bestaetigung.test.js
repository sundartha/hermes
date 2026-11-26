import assert from "node:assert/strict";
import http from "node:http";
import { test, before, after } from "node:test";

import { tempDataDir, seedState, seedCall } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";

const GOAL = "Termin am Dienstag um 10 Uhr vereinbaren";
const AGENT_ZEILE = { role: "agent", text: "Passt Ihnen Dienstag um 10 Uhr?" };
const ZITAT = "Dienstag um 10 Uhr passt";
const GEGENSEITE_ZEILE = { role: "user", text: "Ja, Dienstag um 10 Uhr passt, das ist fest eingetragen." };
const ABLEHNUNG_ZEILE = { role: "user", text: "Nein, einen Termin vergeben wir nicht." };

const FAELLE = {
  bestaetigt: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: true, confirmed_by_counterparty: true, confirmation_quote: ZITAT },
    erwartet: ["done_confirmed", null],
  },
  zitatGross: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: {
      objective_achieved: true,
      confirmed_by_counterparty: true,
      confirmation_quote: "  DIENSTAG   um 10 Uhr\npasst ",
    },
    erwartet: ["done_confirmed", null],
  },
  ohneBestaetigung: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: true },
    erwartet: ["unconfirmed", null],
  },
  bestaetigungFalse: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: true, confirmed_by_counterparty: false, confirmation_quote: ZITAT },
    erwartet: ["unconfirmed", null],
  },
  bestaetigungAlsText: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: true, confirmed_by_counterparty: "true", confirmation_quote: ZITAT },
    erwartet: ["unconfirmed", null],
  },
  ohneZitat: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: true, confirmed_by_counterparty: true },
    erwartet: ["unconfirmed", null],
  },
  leeresZitat: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: true, confirmed_by_counterparty: true, confirmation_quote: "   " },
    erwartet: ["unconfirmed", null],
  },
  zitatErfunden: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: true, confirmed_by_counterparty: true, confirmation_quote: "Mittwoch um 9 Uhr passt" },
    erwartet: ["unconfirmed", null],
  },
  zitatNurVomAgent: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: true, confirmed_by_counterparty: true, confirmation_quote: "Passt Ihnen Dienstag" },
    erwartet: ["unconfirmed", null],
  },
  zielNichtErreicht: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: false, confirmed_by_counterparty: true, confirmation_quote: ZITAT },
    erwartet: ["unconfirmed", null],
  },
  zielUnklar: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: "unclear", confirmed_by_counterparty: true, confirmation_quote: ZITAT },
    erwartet: ["unconfirmed", null],
  },
  abgelehnt: {
    transcript: [AGENT_ZEILE, ABLEHNUNG_ZEILE],
    modell: { objective_achieved: false, declined: true },
    erwartet: ["not_done", "declined"],
  },
  abgelehntUndBestaetigt: {
    transcript: [AGENT_ZEILE, GEGENSEITE_ZEILE],
    modell: { objective_achieved: true, confirmed_by_counterparty: true, confirmation_quote: ZITAT, declined: true },
    erwartet: ["not_done", "declined"],
  },
  ablehnungAlsText: {
    transcript: [AGENT_ZEILE, ABLEHNUNG_ZEILE],
    modell: { objective_achieved: false, declined: "true" },
    erwartet: ["unconfirmed", null],
  },
  nurMenue: {
    transcript: [AGENT_ZEILE, { role: "agent", text: "Hallo?" }],
    modell: { objective_achieved: true, confirmed_by_counterparty: true, confirmation_quote: "Hallo" },
    erwartet: ["not_done", "menu-only"],
  },
};

const MODELL_BASIS = { summary: "Zusammenfassung.", actionItems: [] };

let server;
let lastRequest = null;
let aktuell = null;
let store, claude, anrufErgebnis;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      lastRequest = JSON.parse(body);
      const modell = { ...MODELL_BASIS, ...FAELLE[aktuell].modell };
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_4059",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content: [{ type: "text", text: JSON.stringify(modell) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 20, output_tokens: 30 },
        }),
      );
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-4059-key";
  const calls = Object.entries(FAELLE).map(([name, fall]) =>
    seedCall({
      id: `call_4059_${name}`,
      goal: GOAL,
      transcript: fall.transcript,
      answeredAt: "2026-11-20T10:00:05.000Z",
    }),
  );
  process.env.DATA_DIR = tempDataDir(
    seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }], calls }),
  );
  await import("../../src/config.ts");
  store = await import("../../src/store.js");
  claude = await import("../../src/claude.js");
  anrufErgebnis = await import("../../src/mcp/anruf-ergebnis.js");
});

after(async () => {
  await new Promise((r) => server.close(r));
});

async function ergebnisNachAuswertung(name) {
  aktuell = name;
  const call = store.getCall(`call_4059_${name}`);
  await claude.summarizeCall(call);
  return anrufErgebnis.pickTranscript(call.id, call);
}

for (const [name, fall] of Object.entries(FAELLE)) {
  test(`Ergebnis nach Auswertung 4059: ${name}`, async () => {
    const ergebnis = await ergebnisNachAuswertung(name);
    assert.deepEqual([ergebnis.result_state, ergebnis.result_reason], fall.erwartet);
  });
}

test("Auswertung 4059: der Auftrag an das Modell verlangt Bestaetigung, Zitat und Ablehnung", async () => {
  await ergebnisNachAuswertung("bestaetigt");
  const system = lastRequest.system;
  const text = typeof system === "string" ? system : JSON.stringify(system);
  for (const feld of ["confirmed_by_counterparty", "confirmation_quote", "declined"]) {
    assert.ok(text.includes(feld), `${feld} fehlt im Auftrag`);
  }
});

test("Auswertung 4059: Bestaetigung ohne Zitat und Ablehnung bleiben in der Karte erhalten, ohne sie bleibt sie unveraendert", async () => {
  await ergebnisNachAuswertung("bestaetigt");
  assert.deepEqual(store.getCall("call_4059_bestaetigt").result.counterparty, { confirmed: true, declined: false });
  await ergebnisNachAuswertung("abgelehnt");
  assert.deepEqual(store.getCall("call_4059_abgelehnt").result.counterparty, { confirmed: false, declined: true });
  await ergebnisNachAuswertung("ohneBestaetigung");
  assert.equal(store.getCall("call_4059_ohneBestaetigung").result, null);
});
