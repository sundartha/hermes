import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, mcpPost, toolCall, readToolResult } from "../helpers.js";
import { starteAufzeichnendeAttrappe } from "../helpers/aufzeichnende-attrappe.js";
import { starteAttrappe } from "./attrappen-server.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { memoryLine, budgetedMemoryLines } from "../../src/call-memory.js";

const HTTP_OK = 200;
const TELNYX_NR = "+13125550100";
const ZIEL = "+4930123456";
const GEDAECHTNIS_UEBERSCHRIFT = "WAS BISHER GESCHAH";
const EINTRAG_PRAEFIX = "- ";
const BESTAETIGUNGS_SECRET = "gedaechtnis-bestaetigung-mindestens-32-zeichen";
const ERGEBNIS_GRENZE_ZEICHEN = 100;
const URL_VORSPANN = "https://beispiel.de/";
const ANZAHL_A_HINTER_DER_URL = 120;

const TELNYX_OWNER = { e164: TELNYX_NR, provider: "telnyx" };

const modellAntwort = {
  id: "msg_gedaechtnis",
  type: "message",
  role: "assistant",
  model: "claude-haiku-4-5",
  content: [{ type: "text", text: "Guten Tag." }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 8, output_tokens: 3 },
};

async function starteModellAttrappe() {
  const prompts = [];
  const attrappe = await starteAttrappe((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", () => {
      const { system } = JSON.parse(roh);
      prompts.push(system.map((block) => block.text).join("\n"));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(modellAntwort));
    });
  });
  return { ...attrappe, prompts };
}

async function gedaechtnisZeilen({ outcome, facts }) {
  const modell = await starteModellAttrappe();
  const telnyx = await starteAufzeichnendeAttrappe(() => ({ status: HTTP_OK, koerper: { sid: "tnx_gedaechtnis" } }));
  const frueherer = seedCall({
    id: "call_frueher",
    direction: "outbound",
    to: ZIEL,
    status: "completed",
    startedAt: "2026-01-01T10:00:00.000Z",
    result: { outcome, commitments: [], counterpartyCommitments: [], openPoints: [], nextStep: null, facts },
  });
  const srv = await startServer({
    env: {
      ANTHROPIC_BASE_URL: modell.url,
      CALL_CONFIRMATION_SECRET: BESTAETIGUNGS_SECRET,
      TELNYX_API_KEY: "KEYtest-secret",
      TELNYX_CONNECTION_ID: "conn_test",
      TELNYX_ACCOUNT_SID: "acct_test",
      TELNYX_API_BASE: telnyx.url,
    },
    ownerNumber: TELNYX_OWNER,
    seed: seedState({ calls: [frueherer], settings: { allowCallMemory: true, language: "de" } }),
  });
  try {
    const auftrag = { to: ZIEL, objective: "Rueckruf" };
    const bestaetigung = await abrufMitFrist(`${srv.localUrl}/api/call-confirmations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(auftrag),
    });
    const code = (await bestaetigung.json()).confirmation?.code;
    const platziert = await readToolResult(
      await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("place_call", { ...auftrag, confirmation_code: code })),
    );
    assert.notEqual(platziert.isError, true, JSON.stringify(platziert));
    const neuerAnruf = srv.readStore().calls.find((anruf) => anruf.id !== frueherer.id);
    assert.ok(neuerAnruf, "neuer Anruf angelegt");
    const zug = await abrufMitFrist(`${srv.localUrl}/voice/turn?callId=${neuerAnruf.id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "Weber, guten Tag." }),
    });
    assert.equal(zug.status, HTTP_OK);
    assert.equal(modell.prompts.length, 1, "genau ein Modellaufruf");
    const [prompt] = modell.prompts;
    const ab = prompt.indexOf(GEDAECHTNIS_UEBERSCHRIFT);
    assert.ok(ab >= 0, `Gedaechtnisblock im Prompt: ${prompt}`);
    const eintraege = prompt.slice(ab).split("\n").filter((zeile) => zeile.startsWith(EINTRAG_PRAEFIX));
    return eintraege.map((zeile) => zeile.slice(EINTRAG_PRAEFIX.length));
  } finally {
    await srv.stop();
    await modell.close();
    await telnyx.schliesse();
  }
}

test("S1: Ergebnis ueber 100 Zeichen endet an der Wortgrenze mit „…“ (98 Zeichen)", async () => {
  const zeilen = await gedaechtnisZeilen({
    outcome:
      "Rueckruf vereinbart, Frau Weber hat den Termin fuer die Lieferung bestaetigt am Dienstag um 15:30 Uhr",
    facts: [],
  });
  const erwartet = "Rueckruf vereinbart, Frau Weber hat den Termin fuer die Lieferung bestaetigt am Dienstag um 15:30…";
  assert.equal(erwartet.length, 98);
  assert.ok(zeilen.includes(erwartet), `erwartet: ${erwartet}\nerhalten: ${zeilen.join("\n")}`);
  assert.ok(!zeilen.join("\n").includes("15:30 Uh"));
});

test("S2: ganze Zeile ueber 200 Zeichen endet an der Wortgrenze mit „…“ (196 Zeichen)", async () => {
  const zeilen = await gedaechtnisZeilen({
    outcome: "Rueckruf vereinbart fuer naechste Woche",
    facts: [
      "Ansprechpartnerin ist Frau Weber aus der Buchhaltung im zweiten Stock",
      "Kundennummer 4711-0815 bei allen Rueckfragen angeben",
      "Lieferung kommt per Spedition Hansen",
    ],
  });
  const erwartet =
    "Rueckruf vereinbart fuer naechste Woche; Ansprechpartnerin ist Frau Weber aus der Buchhaltung im zweiten Stock; Kundennummer 4711-0815 bei allen Rueckfragen angeben; Lieferung kommt per Spedition…";
  assert.equal(erwartet.length, 196);
  assert.ok(zeilen.includes(erwartet), `erwartet: ${erwartet}\nerhalten: ${zeilen.join("\n")}`);
  assert.ok(!zeilen.join("\n").includes("Spedition Hans"));
});

test("S3: Ergebnis ohne Leerzeichen wird hart auf 99 Zeichen gekuerzt und bekommt „…“ (100 Zeichen)", async () => {
  const outcome = URL_VORSPANN + "a".repeat(ANZAHL_A_HINTER_DER_URL);
  const zeilen = await gedaechtnisZeilen({ outcome, facts: [] });
  const erwartet = `${outcome.slice(0, ERGEBNIS_GRENZE_ZEICHEN - 1)}…`;
  assert.equal(erwartet.length, ERGEBNIS_GRENZE_ZEICHEN);
  assert.ok(zeilen.includes(erwartet), zeilen.join("\n"));
});

test("B1: Zeile, die unter die Grenzen passt, steht unveraendert ohne „…“", async () => {
  const zeilen = await gedaechtnisZeilen({
    outcome: "Reklamation 4711 aufgenommen",
    facts: ["Reklamationsnummer 4711"],
  });
  assert.ok(zeilen.includes("Reklamation 4711 aufgenommen; Reklamationsnummer 4711"), zeilen.join("\n"));
  assert.ok(!zeilen.join("\n").includes("…"));
});

test("B2: Ergebnis von genau 100 Zeichen passt und bekommt kein „…“", async () => {
  const outcome = "Frau Weber bestaetigt die Lieferung am Dienstag um 15:30 Uhr an die Hauptstrasse 12 in Berlin-Mitte.";
  assert.equal(outcome.length, ERGEBNIS_GRENZE_ZEICHEN);
  const zeilen = await gedaechtnisZeilen({ outcome, facts: [] });
  assert.ok(zeilen.includes(outcome), zeilen.join("\n"));
  assert.ok(!zeilen.join("\n").includes("…"));
});

test("B3: fehlender Gedaechtniseintrag ergibt keine Zeile statt eines Absturzes", () => {
  assert.equal(memoryLine(null), null);
  assert.equal(memoryLine(undefined), null);
  assert.deepEqual(budgetedMemoryLines([null, { outcome: "Rueckruf vereinbart", facts: [] }]), ["Rueckruf vereinbart"]);
});
