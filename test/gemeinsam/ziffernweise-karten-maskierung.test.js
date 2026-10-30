import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { maskRestrictedText } from "../../src/restricted-data.js";
import { startServer, mcpPost, toolCall, readToolResult, seedState, seedCall } from "../helpers.js";

import { pruefeLaufzeitVerdopplung } from "./laufzeit-verdopplung.js";

const VISA_16 = "4111111111111111";
const MASTERCARD_16 = "5555555555554444";
const MASTERCARD_MIN_IIN_16 = "2223003122003222";
const DISCOVER_16 = "6011111111111117";
const VISA_13 = "4222222222222";
const AMEX_15 = "378282246310005";
const NINES_16 = "4999999999999996";
const LUHN_INVALID_16 = "4111111111111112";
const IIN_1_LUHN_VALID_16 = "1111111111111117";
const IIN_7_LUHN_VALID_16 = "7111111111111114";
const LUHN_VALID_12 = "411111111117";
const DINERS_14 = "36227206271667";

function einzeln(ziffern) {
  return ziffern.split("").join(" ");
}

function vierergruppenAusEinzelziffern(ziffern) {
  return ziffern
    .match(/.{1,4}/g)
    .map(einzeln)
    .join(", ");
}

const AGENT = "agent";
const COUNTERPARTY = "counterparty";

const MASKIERT = [
  [AGENT, `Karte ${einzeln(VISA_16)}.`, "Karte ****1111."],
  [AGENT, `Karte ${vierergruppenAusEinzelziffern(VISA_16)}.`, "Karte ****1111."],
  [COUNTERPARTY, `Karte ${einzeln(VISA_16)}.`, "Karte ****1111."],
  [COUNTERPARTY, `Karte ${vierergruppenAusEinzelziffern(VISA_16)}.`, "Karte ****1111."],
  [COUNTERPARTY, `Meine Karte ist ${einzeln(MASTERCARD_16)} danke`, "Meine Karte ist ****4444 danke"],
  [AGENT, `Karte ${vierergruppenAusEinzelziffern(MASTERCARD_16)}.`, "Karte ****4444."],
  [AGENT, `Karte ${einzeln(MASTERCARD_MIN_IIN_16)}.`, "Karte ****3222."],
  [AGENT, `Karte ${einzeln(DISCOVER_16)}.`, "Karte ****1117."],
  [AGENT, `Karte ${einzeln(NINES_16)}.`, "Karte ****9996."],
  [AGENT, `Karte ${einzeln(VISA_13)}.`, "Karte ****2222."],
  [AGENT, `Karte ${vierergruppenAusEinzelziffern(VISA_13)}.`, "Karte ****2222."],
  [AGENT, `Ohne Wort ${einzeln(AMEX_15)}.`, "Ohne Wort ****0005."],
];

const BESTEHEND_MASKIERT = [
  [AGENT, `Karte ${VISA_16}.`, "Karte ****1111."],
  [AGENT, "Karte 4111 1111 1111 1111.", "Karte ****1111."],
  [AGENT, "Karte 4111, 1111, 1111, 1111.", "Karte ****1111."],
  [AGENT, "Karte 4111-1111-1111-1111.", "Karte ****1111."],
  [COUNTERPARTY, "Karte 5555 5555 5555 4444.", "Karte ****4444."],
];

const UNMASKIERT = [
  [AGENT, `Karte ${einzeln(LUHN_INVALID_16)}.`],
  [AGENT, `Karte ${vierergruppenAusEinzelziffern(LUHN_INVALID_16)}.`],
  [AGENT, `Karte ${einzeln(IIN_1_LUHN_VALID_16)}.`],
  [AGENT, `Karte ${einzeln(IIN_7_LUHN_VALID_16)}.`],
  [AGENT, `Karte ${einzeln(LUHN_VALID_12)}.`],
  [AGENT, `Karte ${vierergruppenAusEinzelziffern(LUHN_VALID_12)}.`],
  [AGENT, `Ohne Wort ${einzeln(VISA_13)}.`],
  [AGENT, `Ohne Wort ${einzeln(DINERS_14)}.`],
  [AGENT, "Postleitzahl 1 0 1 1 5 in Berlin."],
  [AGENT, "Ihr Bestätigungscode ist 4 8 2 9 1 7."],
  [COUNTERPARTY, "Der Code lautet 4 8 2 9 1 7."],
  [AGENT, "Termin am 2 5 . 0 9 . 2 0 2 6 um 1 4 : 3 0 Uhr."],
  [AGENT, "Termin am 2 5. 0 9. 2 0 2 6, um 1 4 Uhr 3 0."],
];

const SUMMARY_UND_ERGEBNIS = [
  [
    `Kunde nannte Karte ${einzeln(VISA_16)}.`,
    `Karte ${einzeln(VISA_16)} notiert.`,
    "Karte ****1111.",
    "Karte ****1111 notiert.",
  ],
  [
    `Kunde nannte Karte ${vierergruppenAusEinzelziffern(MASTERCARD_16)}.`,
    `Karte ${vierergruppenAusEinzelziffern(MASTERCARD_16)} notiert.`,
    "Karte ****4444.",
    "Karte ****4444 notiert.",
  ],
];

function rolleUndText([role, text], index) {
  return seedCall({
    id: `call_ziffernweise_${index}`,
    status: "completed",
    answeredAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    transcript: [{ role, text }],
  });
}

function summaryCall([summary, outcome], index) {
  return seedCall({
    id: `call_ziffernweise_ergebnis_${index}`,
    status: "completed",
    answeredAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    summary,
    objectiveAchieved: true,
    result: { outcome, commitments: [], counterpartyCommitments: [], openPoints: [], nextStep: summary },
  });
}

const ZEILEN = [...MASKIERT, ...BESTEHEND_MASKIERT, ...UNMASKIERT];
const ZEILEN_CALLS = ZEILEN.map(rolleUndText);
const ERGEBNIS_CALLS = SUMMARY_UND_ERGEBNIS.map(summaryCall);

let srv;

before(async () => {
  srv = await startServer({ seed: seedState({ calls: [...ZEILEN_CALLS, ...ERGEBNIS_CALLS] }) });
});

after(async () => {
  await srv.stop();
});

async function callTool(name, args) {
  return readToolResult(await mcpPost(`${srv.localUrl}/mcp`, null, toolCall(name, args)));
}

async function ausgabezeile(index) {
  const result = await callTool("get_call_status", { call_id: ZEILEN_CALLS[index].id });
  const lines = result.structuredContent.last_transcript_lines;
  assert.equal(lines.length, 1);
  return lines[0];
}

function pruefeMaskiert(offset, liste) {
  return async () => {
    for (const [position, [, text, erwartet]] of liste.entries()) {
      const line = await ausgabezeile(offset + position);
      assert.ok(line.endsWith(erwartet), `Kartennummer im Klartext: ${line} (Eingabe: ${text})`);
    }
  };
}

test("ziffernweise Karte in der Zeile des Agenten und des Gegenübers erscheint in get_call_status als ****1111 statt Ziffern", pruefeMaskiert(0, MASKIERT));

test("kompakte Karte, Vierergruppen, Komma, Bindestrich bleiben in get_call_status maskiert", pruefeMaskiert(MASKIERT.length, BESTEHEND_MASKIERT));

test("Postleitzahl, Code, Datum, Uhrzeit und Folgen ohne gültige Karte bleiben in get_call_status unmaskiert", async () => {
  const offset = MASKIERT.length + BESTEHEND_MASKIERT.length;
  for (const [position, [, text]] of UNMASKIERT.entries()) {
    const line = await ausgabezeile(offset + position);
    assert.ok(line.endsWith(text), `Ziffernfolge ohne Karte fälschlich verändert: ${line}`);
  }
});

test("ziffernweise Karte in Zusammenfassung und Ergebnis erscheint in get_call_result als ****1111 statt Ziffern", async () => {
  for (const [position, [summary, outcome, erwartetSummary, erwartetOutcome]] of SUMMARY_UND_ERGEBNIS.entries()) {
    const result = await callTool("get_call_result", { call_id: ERGEBNIS_CALLS[position].id });
    const data = result.structuredContent;
    assert.ok(data.result_summary.endsWith(erwartetSummary), `Kartennummer im Klartext: ${data.result_summary} (Eingabe: ${summary})`);
    assert.ok(data.outcome.startsWith("Karte ****"), `Kartennummer im Klartext: ${data.outcome} (Eingabe: ${outcome})`);
    assert.ok(data.outcome.endsWith(erwartetOutcome), `Kartennummer im Klartext: ${data.outcome}`);
    assert.ok(data.next_step.endsWith(erwartetSummary), `Kartennummer im Klartext: ${data.next_step}`);
  }
});

const FREMDE_ZIFFER_DAVOR = "9";
const KARTE_MIT_UNREGELMAESSIGEN_GRUPPEN_ENDEND_AUF_EINZELZIFFER = "4111111 11111111 1";
const KARTE_MIT_UNREGELMAESSIGEN_GRUPPEN_BEGINNEND_MIT_EINZELZIFFER = "4 11111111 1111111";

test("Karte Ziffer für Ziffer hinter einer fremden Ziffer wird als Ausschnitt zu ****1111 maskiert", () => {
  const text = `Karte ${FREMDE_ZIFFER_DAVOR} ${einzeln(VISA_16)}.`;
  assert.equal(maskRestrictedText(text), `Karte ${FREMDE_ZIFFER_DAVOR} ****1111.`);
});

test("Karte in unregelmäßigen Gruppen mit einer einzelnen Ziffer am Rand bleibt unmaskiert", () => {
  const endend = `Karte ${KARTE_MIT_UNREGELMAESSIGEN_GRUPPEN_ENDEND_AUF_EINZELZIFFER}.`;
  const beginnend = `Karte ${KARTE_MIT_UNREGELMAESSIGEN_GRUPPEN_BEGINNEND_MIT_EINZELZIFFER}.`;
  assert.equal(maskRestrictedText(endend), endend);
  assert.equal(maskRestrictedText(beginnend), beginnend);
});

test("1 MB aus einzeln mit Leerzeichen getrennten Ziffern ohne Kartennummer braucht höchstens das Dreifache der Zeit von 0,5 MB derselben Eingabe", () => {
  pruefeLaufzeitVerdopplung("1 ", maskRestrictedText);
});

test("1 MB aus der Ziffer 1 in Vierergruppen mit Komma getrennt braucht höchstens das Dreifache der Zeit von 0,5 MB derselben Eingabe", () => {
  pruefeLaufzeitVerdopplung("1 1 1 1, ", maskRestrictedText);
});
