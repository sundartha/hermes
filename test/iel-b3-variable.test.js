// IEL-B3 (L5): {{inbound_situation}} - Outbound sendet die Variable leer, die Vorlage
// traegt sie am Ende der PERSONA-Zeile, der Inbound-Blocktext existiert.
// Mutationsproben: (a) Schluessel in dynamicVariables entfernen -> B3-1/2/3 rot;
// (b) Wert != "" -> B3-2/3/5 rot; (c) Platzhalter an andere Stelle -> B3-4 rot;
// (d) Anrufernummer in den Blocktext -> B3-8 rot.
//
// Offline: kein Spawn, kein Netz. Der Anrufstart laeuft ueber die GETEILTE Attrappe
// (helpers/elevenlabs-anrufstart-attrappe.mjs) - keine zweite fetch-Ersetzung.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";
import { consultAllowedForCall } from "../src/consult/gate.js";
import { LOCALES } from "../src/i18n/locales.js";
import { pinCall, pinStore, sendeAnrufstart } from "./helpers/elevenlabs-anrufstart-attrappe.mjs";

const TEMPLATE_PATH = "elevenlabs/agent_configs/outbound-agent.template.json";
const PLATZHALTER = "{{inbound_situation}}";
const VARIABLE = "inbound_situation";
const LETZTER_SCHLUESSEL = "tenant_token";
const SEKTIONS_TRENNER = "\n\n";
const GENAU_EINMAL = 1;
// Schluessel-Reihenfolge des Anrufstarts auf master 0775435 (vor IEL-B3), abgegriffen -
// der Vorher-Anker fuer "Bestand + genau ein Schluessel".
const BESTANDS_SCHLUESSEL = Object.freeze([
  "consult_available",
  "lookup_available",
  "opening_line",
  "owner_name",
  "callee",
  "objective",
  "constraints",
  "background",
  "mandate",
  "owner_timezone",
  "callee_timezone",
  "today",
  "callee_relation",
  "voicemail_line",
  "tenant_token",
]);
// Die Stelle der Vorlage VOR IEL-B3; bleibt nach dem Entfernen des neuen Platzhalters stehen.
const BESTANDS_ANKER = "not a human.{{callee_relation}}\n\nSITUATION AND TASK:";
const NEUER_ANKER = "{{callee_relation}}{{inbound_situation}}\n\nSITUATION AND TASK:";
const AUFGEHOBENE_UEBERSCHRIFT = "SITUATION AND TASK";
const TEST_OWNER = "Quinn Beispielowner";
const ZIFFER = /\d/;
const OWNER_ZIEL = Object.freeze({ calleeIsOwner: true });
const EN_PROMPT = LOCALES.en.prompt;

// In Stufen gelesen statt in einer Kette (G36/Demeter, Bestandsmuster el-vorlage-variablen-abgleich).
function vorlagenPrompt() {
  const vorlage = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  const agent = vorlage.agent.conversation_config.agent;
  return agent.prompt.prompt;
}

const gesendet = (call = pinCall()) =>
  sendeAnrufstart({ makeElevenLabsOutbound, consultAllowedForCall, store: pinStore(), call });
const blockText = () => EN_PROMPT.inboundSituation({ owner: TEST_OWNER });
// IEP-P6: die Owner-Fassung derselben Vorlagen-Sektion - sie faellt unter dieselben
// Auflagen (Auftraggeber genannt, kein Platzhalter, keine Ziffer, Ueberschrift aufgehoben).
const OWNER_FREMD_EROEFFNUNG = LOCALES.de.inboundEroeffnung(TEST_OWNER);
const blockTextOwner = () =>
  EN_PROMPT.inboundSituationOwner({ owner: TEST_OWNER, fremdEroeffnung: OWNER_FREMD_EROEFFNUNG });
const vorkommen = (text, teil) => text.split(teil).length - 1;

test("IEL-B3-1: Outbound-Koerper = Bestand + genau inbound_situation, direkt vor tenant_token", async () => {
  const schluessel = Object.keys(await gesendet());

  assert.deepEqual(
    schluessel.filter((name) => name !== VARIABLE),
    BESTANDS_SCHLUESSEL,
  );
  assert.equal(schluessel.indexOf(VARIABLE), schluessel.indexOf(LETZTER_SCHLUESSEL) - 1);
});

test("IEL-B3-2: Fremd-Ziel - inbound_situation ist der leere String", async () => {
  const variablen = await gesendet();

  assert.equal(variablen[VARIABLE], "");
});

test("IEL-B3-3: Owner-Ziel - inbound_situation ist ebenfalls leer", async () => {
  const variablen = await gesendet({ ...pinCall(), ...OWNER_ZIEL });

  assert.equal(variablen[VARIABLE], "");
});

test("IEL-B3-4: Vorlage traegt {{inbound_situation}} genau einmal, direkt hinter {{callee_relation}} am Ende der PERSONA-Zeile", () => {
  const prompt = vorlagenPrompt();
  const [personaSektion] = prompt.split(SEKTIONS_TRENNER);

  assert.equal(vorkommen(prompt, PLATZHALTER), GENAU_EINMAL);
  assert.ok(prompt.includes(NEUER_ANKER), "Platzhalter steht nicht direkt hinter {{callee_relation}}");
  assert.ok(personaSektion.includes(PLATZHALTER), "Platzhalter steht nicht in der PERSONA-Sektion");
});

test("IEL-B3-5: Render-Gleichheit Outbound - Prompt mit gesendetem Wert == Prompt ohne Platzhalter, Bestands-Anker intakt", async () => {
  const prompt = vorlagenPrompt();
  const wert = (await gesendet())[VARIABLE];

  const gerendert = prompt.split(PLATZHALTER).join(wert);
  const ohnePlatzhalter = prompt.split(PLATZHALTER).join("");

  assert.equal(gerendert, ohnePlatzhalter);
  assert.ok(ohnePlatzhalter.includes(BESTANDS_ANKER), "Bestands-Anker der Vorlage fehlt");
});

test("IEL-B3-6: Blocktext nennt den Auftraggeber", () => {
  assert.ok(blockText().includes(TEST_OWNER));
  assert.ok(blockTextOwner().includes(TEST_OWNER));
});

test("IEL-B3-7: Blocktext traegt keinen Platzhalter", () => {
  assert.ok(!blockText().includes("{{"));
  assert.ok(!blockTextOwner().includes("{{"));
});

test("IEL-B3-8: Blocktext traegt keine Nummer (Positiv-Kontrolle am Budget-Baustein)", () => {
  const budgetBaustein = EN_PROMPT.situationInbound({ call: { from: pinCall().from }, owner: TEST_OWNER });

  assert.ok(ZIFFER.test(budgetBaustein), "Positiv-Kontrolle: die Ziffern-Pruefung findet die Nummer im Budget-Baustein nicht");
  assert.ok(!ZIFFER.test(blockText()), "Inbound-Blocktext traegt eine Ziffer");
  assert.ok(!ZIFFER.test(blockTextOwner()), "Owner-Inbound-Blocktext traegt eine Ziffer");
});

test("IEL-B3-9: die im Block aufgehobene Sektion existiert woertlich in der Vorlage", () => {
  const sektionen = vorlagenPrompt().split(SEKTIONS_TRENNER);

  assert.ok(blockText().includes(AUFGEHOBENE_UEBERSCHRIFT));
  assert.ok(blockTextOwner().includes(AUFGEHOBENE_UEBERSCHRIFT));
  assert.ok(
    sektionen.some((sektion) => sektion.startsWith(`${AUFGEHOBENE_UEBERSCHRIFT}:`)),
    `keine Sektion der Vorlage beginnt mit "${AUFGEHOBENE_UEBERSCHRIFT}:"`,
  );
});
