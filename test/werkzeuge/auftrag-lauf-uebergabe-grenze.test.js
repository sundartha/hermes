import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ROTER_TEST, funktion } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, starte } from "./auftrag-lauf-probe.js";

const TEST_KONTEXT_GRENZE = 200_000;
const MAX_UEBERGABEN = 2;
const STARTS_JE_RUNDE_HOECHSTENS = MAX_UEBERGABEN + 1;
const RUNDEN = 2;
const SITZUNGEN_IM_DREHBUCH = 12;
const MS_JE_SEKUNDE = 1000;
const LIMIT_IN_SEKUNDEN = 1;
const FUENF_STUNDEN_LIMIT = "You've hit your 5-hour limit · resets 5pm (Europe/Berlin)";
const VOLL = { type: "assistant", message: { content: [{ type: "text", text: "Ich lese noch." }], usage: { input_tokens: TEST_KONTEXT_GRENZE, output_tokens: 20 } } };
const GRUEN = {
  test: { "test/rechnen.test.js": ROTER_TEST },
  bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" },
  "notiz-antwort": "1. Auftrag teilen",
};

function lauf(context, ausfaelle) {
  return starte(context, { auftrag: funktion("2 !== 4"), drehbuch: { ...GRUEN, "test-ausfall": ausfaelle } });
}

function testAgentenDerErstenRunde({ repo }) {
  const beleg = JSON.parse(readFileSync(join(repo, ".fortschritt/probe/A1.runde-1.json"), "utf8"));
  return beleg.agenten.filter(({ rolle }) => rolle === "test");
}

function testStarts({ werkzeug }) {
  const zeilen = readFileSync(join(werkzeug, "starts.jsonl"), "utf8").split("\n").filter(Boolean);
  return zeilen.map((zeile) => JSON.parse(zeile)).filter(({ rolle }) => rolle === "test");
}

test("ein Agent, der den Kontext füllt und dabei nichts ändert, wird einmal übergeben und dann mit Grund beendet statt endlos neu gestartet", (context) => {
  const probe = lauf(context, Array.from({ length: SITZUNGEN_IM_DREHBUCH }, () => ({ text: "Kontext voll", zeilen: [VOLL] })));
  assert.equal(probe.lauf.status, EXIT_ROT, probe.lauf.stdout + probe.lauf.stderr);
  const [uebergeben, beendet, ...weitere] = testAgentenDerErstenRunde(probe);
  assert.deepEqual(weitere, []);
  assert.match(uebergeben.grund, /^Übergabe: Der Kontext erreichte 200000 Token/);
  assert.match(beendet.grund, /^Übergabe: Der Kontext erreichte 200000 Token.* Keine weitere Übergabe: Seit der letzten Übergabe hat der Agent weder den Arbeitsbaum noch einen Commit noch die Belege geändert/);
  assert.match(probe.beleg.grund, /Keine weitere Übergabe/);
  assert.ok(testStarts(probe).length <= RUNDEN * STARTS_JE_RUNDE_HOECHSTENS, String(testStarts(probe).length));
});

test("ein Agent, der zwischen den Übergaben weiterarbeitet, bekommt höchstens zwei Übergaben und endet dann mit Grund", (context) => {
  const fortschritt = Array.from({ length: SITZUNGEN_IM_DREHBUCH }, (_, nummer) => ({ text: "Kontext voll", zeilen: [VOLL], dateien: { [`test/zwischenstand-${nummer}.txt`]: `${nummer}\n` } }));
  const probe = lauf(context, fortschritt);
  assert.equal(probe.lauf.status, EXIT_ROT, probe.lauf.stdout + probe.lauf.stderr);
  const agenten = testAgentenDerErstenRunde(probe);
  assert.equal(agenten.length, STARTS_JE_RUNDE_HOECHSTENS);
  assert.deepEqual(agenten.slice(0, MAX_UEBERGABEN).map(({ grund }) => /Keine weitere Übergabe/.test(grund)), [false, false]);
  assert.match(agenten.at(-1).grund, /Keine weitere Übergabe: Der Agent wurde schon 2-mal übergeben; mehr Übergaben gibt das Skript keinem Agenten\. Der Auftrag ist für einen Agenten zu groß und gehört geteilt\./);
});

test("das 5-Stunden-Limit mit seinem echten Wortlaut gilt als Nutzungslimit: lauf wartet bis zum Zurücksetzen und macht ohne rote Runde weiter", (context) => {
  const zuruecksetzen = { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: Math.ceil(Date.now() / MS_JE_SEKUNDE) + LIMIT_IN_SEKUNDEN } };
  const probe = lauf(context, [{ text: FUENF_STUNDEN_LIMIT, zeilen: [zuruecksetzen] }]);
  assert.equal(probe.lauf.status, 0, probe.lauf.stdout + probe.lauf.stderr);
  assert.equal(probe.beleg.runde, 1);
  const [amLimit, weiter] = probe.beleg.agenten.filter(({ rolle }) => rolle === "test");
  assert.match(amLimit.grund, /^Nutzungslimit erreicht; das Skript startet neue Agenten erst ab \S+ und macht dann weiter\.$/);
  assert.equal(weiter.exitCode, 0);
  const freigabe = Date.parse(/ab (\S+) und/.exec(amLimit.grund)[1]);
  assert.ok(testStarts(probe)[1].zeit >= freigabe, `${testStarts(probe)[1].zeit} < ${freigabe}`);
});
