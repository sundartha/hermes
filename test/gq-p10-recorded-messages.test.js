// GQ-P10 (Befund N-2): der Agent sieht, was er in DIESEM Gespraech schon notiert hat.
//
// Live gemessen: drei Eintraege fuer EINEN Sachverhalt.
//   1) "Antonio soll den Fahrzeugschein zur Inspektion mitbringen."
//   2) "Die Werkstatt bittet Antonio, den Fahrzeugschein zur Inspektion mitzubringen. ..."
//   3) "Die Werkstatt braucht das genaue Fahrzeugmodell und Baujahr, um ... einplanen zu koennen."
//
// GQ-P4 entdoppelt nur INHALTSGLEICHE Nachrichten. Das Modell formuliert aber jedes Mal
// neu, also greift der Riegel nie. Die Wurzel ist nicht die Aehnlichkeitsschwelle, sondern
// dass das Modell ueber take_message entscheidet, OHNE zu wissen, was es schon notiert hat.
//
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang - sonst landen sie still im
// Gates-Lauf, wo Rot erlaubt ist (Lehre catalog-id-prefix-misroutes-tests).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const OWNER = "Jonas Beispiel";
const FIRST = "Antonio soll den Fahrzeugschein zur Inspektion mitbringen.";
const REPHRASED = "Die Werkstatt bittet Antonio, den Fahrzeugschein zur Inspektion mitzubringen.";

let store, claude, LOCALES, SUPPORTED_LANGUAGES;
let callSeq = 0;

before(async () => {
  const calls = [];
  for (let i = 1; i <= 10; i++)
    calls.push(seedCall({ id: `call_gqp10_${i}`, tenantId: BOOTSTRAP_TENANT_ID }));
  for (let i = 1; i <= 4; i++)
    calls.push(
      seedCall({ id: `call_gqp10_in_${i}`, tenantId: BOOTSTRAP_TENANT_ID, direction: "inbound" }),
    );
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls,
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  claude = await import("../src/claude.js");
  ({ LOCALES, SUPPORTED_LANGUAGES } = await import("../src/i18n/locales.js"));
});

function nextCall(prefix = "call_gqp10_") {
  callSeq += 1;
  return store.getCall(`${prefix}${callSeq}`);
}

const heading = () => LOCALES.de.prompt.recorded.heading;

test("GQ-P10-1: callActionItems liefert die Notizen DIESES Calls in Gespraechs-Reihenfolge", () => {
  const call = nextCall();
  const other = nextCall();
  store.addActionItem(call.id, FIRST, "todo");
  store.addActionItem(other.id, "Fremde Notiz aus einem anderen Gespraech", "todo");
  store.addActionItem(call.id, REPHRASED, "todo");

  const items = store.callActionItems(call.id).map((i) => i.text);

  assert.deepEqual(items, [FIRST, REPHRASED], "aelteste zuerst - der Store haelt neueste zuerst");
});

test("GQ-P10-2: nichts notiert -> KEIN Block, der Bestandsprompt bleibt unberuehrt", () => {
  const call = nextCall();
  const prompt = claude.systemPrompt(call);
  assert.ok(!prompt.includes(heading()), "ohne Notizen darf der Prompt nicht driften");
});

test("GQ-P10-3: notierte Nachrichten stehen wortgetreu im Prompt", () => {
  const call = nextCall();
  store.addActionItem(call.id, FIRST, "todo");
  store.addActionItem(call.id, REPHRASED, "todo");

  const prompt = claude.systemPrompt(call);

  assert.ok(prompt.includes(heading()));
  assert.ok(prompt.includes(`- ${FIRST}`));
  assert.ok(prompt.includes(`- ${REPHRASED}`));
});

test("GQ-P10-4: die Guardrail verbietet die Doppel-Aufnahme AUSDRUECKLICH, auch umformuliert", () => {
  // Eine blosse Liste haette das Modell auch als "sag das nochmal" lesen koennen. Der
  // Defekt war ja gerade die NEUFORMULIERUNG desselben Anliegens.
  const g = LOCALES.de.prompt.recorded.guardrail;
  assert.match(g, /NICHT ein zweites Mal auf/);
  assert.match(g, /anders formuliert/);
  assert.match(g, /WIRKLICH neuer Sachverhalt/);
});

test("GQ-P10-5: der Block rendert auch INBOUND - dort entstehen Nachrichten hauptsaechlich", () => {
  // Regressionsschutz gegen die naheliegende Fehlplatzierung: assignmentBlock haengt an
  // call.goal und rendert nur outbound. Genau dort haette der Block den Hauptfall verfehlt.
  // Eigener Pool mit eigener ID - nextCall() teilt sich seinen Zaehler mit den
  // Outbound-Tests und liefe hier ins Leere.
  const call = store.getCall("call_gqp10_in_1");
  assert.equal(call.direction, "inbound", "Vorbedingung des Tests");
  store.addActionItem(call.id, FIRST, "todo");

  const prompt = claude.systemPrompt(call);

  assert.ok(prompt.includes(heading()), "Inbound-Prompt muss den Block tragen");
  assert.ok(prompt.includes(`- ${FIRST}`));
});

test("GQ-P10-6: jede unterstuetzte Sprache traegt Ueberschrift und Guardrail", () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const r = LOCALES[language].prompt.recorded;
    assert.equal(typeof r?.heading, "string", `${language}: recorded.heading fehlt`);
    assert.equal(typeof r?.guardrail, "string", `${language}: recorded.guardrail fehlt`);
  }
});
