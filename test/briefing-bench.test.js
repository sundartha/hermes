// briefing-bench (scripts/briefing-bench): Messwerkzeug fuer die Wirkung der Werkzeugtexte
// auf das rufende Modell. Hier NUR der Attrappen-Modus - ohne Netz, ohne Guthaben,
// deterministisch. Belegt wird: (1) der Schnappschuss kommt vom echten Draht (stdio) dieses
// Checkouts, (2) ein sauberer Lauf ergibt 0 Befunde, (3) jede Einschleusung schlaegt an
// (Positiv-Kontrolle - eine Metrik, die nie anschlaegt, misst nichts), (4) zwei Laeufe sind
// gleich, (5) der Vergleich alt/neu faellt bei einer Verschlechterung durch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROOT } from "./helpers.js";
import { snapshotTools, runBench } from "../scripts/briefing-bench/bench.mjs";
import { dummyModel, INJECTION } from "../scripts/briefing-bench/modelle.mjs";
import { compareReports, evaluateReply } from "../scripts/briefing-bench/metriken.mjs";
import { SCENARIOS, GAP_CLASS } from "../scripts/briefing-bench/szenarien.mjs";

const RUNS = 5;
const LEGIT_SCENARIOS = 3;
const TOTAL_RUNS = RUNS * SCENARIOS.length;
const GAP_RUNS = RUNS * SCENARIOS.filter((scenario) => scenario.luecke).length;

let cachedSnapshot = null;
async function snapshot() {
  cachedSnapshot ??= await snapshotTools(ROOT);
  return cachedSnapshot;
}

const benchWith = async (injection) =>
  runBench({ snapshot: await snapshot(), model: dummyModel({ injection }), runs: RUNS });

test("briefing-bench: Szenarien decken jede Luecken-Klasse und drei legitime Anrufe ab", () => {
  const classes = SCENARIOS.map((scenario) => scenario.klasse);
  for (const klasse of [GAP_CLASS.SELF, GAP_CLASS.PRINCIPAL, GAP_CLASS.LOOKUP])
    assert.ok(classes.includes(klasse), klasse);
  assert.equal(classes.filter((klasse) => klasse === GAP_CLASS.NONE).length, LEGIT_SCENARIOS);
});

test("briefing-bench: Schnappschuss vom echten stdio-Draht enthaelt prepare_call zuerst", async () => {
  const report = await benchWith(null);
  assert.deepEqual(report.werkzeuge, ["prepare_call", "place_call"]);
  assert.match(report.fingerabdruck, /^[0-9a-f]{64}$/);
});

test("briefing-bench: sauberer Attrappen-Lauf ergibt 0 Befunde und ist deterministisch", async () => {
  const first = await benchWith(null);
  assert.deepEqual(first.summe, {
    laeufe: TOTAL_RUNS,
    verweigert: 0,
    selbstnennung: 0,
    erfunden: 0,
    lueckeKorrekt: GAP_RUNS,
    lueckeGemessen: GAP_RUNS,
  });
  assert.deepEqual(await benchWith(null), first, "zweiter Lauf identisch");
});

test("briefing-bench: Positiv-Kontrollen - jede Einschleusung schlaegt an, der Vergleich faellt durch", async () => {
  const clean = await benchWith(null);
  const expected = [
    [INJECTION.SELF_NAMING, "selbstnennung"],
    [INJECTION.INVENTION, "erfunden"],
    [INJECTION.REFUSAL, "verweigert"],
  ];
  for (const [injection, metric] of expected) {
    const report = await benchWith(injection);
    assert.equal(report.summe[metric], TOTAL_RUNS, `${injection} -> ${metric}`);
    assert.equal(
      compareReports(clean, report).erfuellt,
      false,
      `${injection}: Vergleich faellt durch`,
    );
  }
  assert.equal(compareReports(clean, clean).erfuellt, true);
});

test("briefing-bench: Selbstnennung auch in verschachtelten context-Feldern, Zielnummer zaehlt nicht als erfunden", () => {
  const scenario = SCENARIOS[0];
  const reply = {
    toolCalls: [
      {
        name: "prepare_call",
        input: {
          to: "+4930999999",
          objective: "Book.",
          context: { key_facts: ["Speaks as Gemini"] },
        },
      },
    ],
    text: "",
  };
  const result = evaluateReply(scenario, reply);
  assert.equal(result.selbstnennung, true);
  assert.deepEqual(result.erfunden, [], "Nummer im to-Feld ist kein Freitext");
});
