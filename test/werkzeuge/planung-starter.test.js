import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { starteAgent, starteAgentParallel } from "../../tools/auftrag/agenten.mjs";
import { KONTEXT_GRENZE, STILLSTAND, UEBERGABE, Verlauf } from "../../tools/auftrag/verlauf.mjs";
import { probeDirectory } from "./probe-repo.js";

const AUSFUEHRBAR = 0o755;
const LANGE_ANTWORT = `${"a".repeat(1500)}ENDE`;
const BAU_AUFTRAG = { bereich: "tools/beispiel.mjs", abnahme: "test/werkzeuge/beispiel.test.js" };

const ERSATZ_CLAUDE = `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const ort = process.cwd();
const [ich, anderer, art] = readFileSync(0, "utf8").trim().split(" ");
writeFileSync(join(ort, "start-" + ich), "");
const frist = Date.now() + 20000;
while (anderer && anderer !== "-" && !existsSync(join(ort, "start-" + anderer)) && Date.now() < frist) {
  await new Promise((weiter) => setTimeout(weiter, 20));
}
const gesehen = anderer && anderer !== "-" ? existsSync(join(ort, "start-" + anderer)) : true;
const text = art === "umlaute" ? "äb".repeat(100000) : "a".repeat(1500) + "ENDE";
const zeilen = [
  { type: "result", result: (gesehen ? "gleichzeitig " : "nacheinander ") + text, is_error: false },
  { type: "assistant", message: { id: "m1", usage: { input_tokens: 150000 }, content: [{ type: "text", text: "zwischen" }] } },
  { type: "assistant", message: { id: "m2", usage: { input_tokens: 70000, cache_read_input_tokens: 5000 }, content: [{ type: "text", text: "x" }] } },
];
for (const zeile of zeilen) console.log(JSON.stringify(zeile));
`;

function ersatz(context) {
  const ort = probeDirectory(context, { "claude.mjs": ERSATZ_CLAUDE });
  chmodSync(join(ort, "claude.mjs"), AUSFUEHRBAR);
  return ort;
}

function mitErsatz(context) {
  const ort = ersatz(context);
  const bisher = process.env.HERMES_CLAUDE;
  process.env.HERMES_CLAUDE = join(ort, "claude.mjs");
  context.after(() => {
    if (bisher === undefined) delete process.env.HERMES_CLAUDE;
    else process.env.HERMES_CLAUDE = bisher;
  });
  return ort;
}

function bauMitKopf(ort, kopf) {
  mkdirSync(join(ort, ".claude/agents"), { recursive: true });
  writeFileSync(join(ort, ".claude/agents/bau.md"), `---\nname: bau\n${kopf}---\n\nBaut.\n`);
  return starteAgent({ rolle: "bau", auftrag: BAU_AUFTRAG, root: ort }, "eins").befehl.split(" ");
}

function antwortMitKontext(kontext, eltern = null) {
  const message = { id: `m${kontext}`, usage: { input_tokens: kontext }, content: [{ type: "text", text: "t" }] };
  return JSON.stringify({ type: "assistant", parent_tool_use_id: eltern, message });
}

function dreimalDasselbe(verlauf) {
  verlauf.lies(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "w1", name: "Read", input: { a: 1 } }] } }));
  const rueck = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "w1", content: "gleich" }] } });
  return [1, 2, 3].map(() => verlauf.lies(rueck)).at(-1);
}

test("ohne Parameter liegt die Kontextgrenze bei 100.000 Token", () => {
  assert.equal(KONTEXT_GRENZE, 100_000);
  assert.equal(new Verlauf().lies(antwortMitKontext(99_999)), null);
  assert.equal(new Verlauf().lies(antwortMitKontext(100_000)).art, UEBERGABE);
});

test("mit Parameter null ist die Kontextgrenze abgeschaltet, Stillstand und Limit bleiben", () => {
  const verlauf = new Verlauf({ kontextGrenze: null });
  assert.equal(verlauf.lies(antwortMitKontext(900_000)), null);
  assert.equal(dreimalDasselbe(verlauf).art, STILLSTAND);
  verlauf.lies(JSON.stringify({ type: "result", result: "You've hit your limit |1700000000", is_error: true }));
  assert.equal(verlauf.zusammenfassung().limit.bis, 1_700_000_000_000);
});

test("eine eigene Kontextgrenze gilt statt 100.000", () => {
  assert.equal(new Verlauf({ kontextGrenze: 50_000 }).lies(antwortMitKontext(60_000)).art, UEBERGABE);
});

test("die volle Antwort und der größte Kontext sind nur auf Wunsch lesbar", () => {
  const verlauf = new Verlauf({ kontextGrenze: null });
  for (const kontext of [3000, 9000, 4000]) verlauf.lies(antwortMitKontext(kontext));
  verlauf.lies(antwortMitKontext(50_000, "unteragent"));
  verlauf.lies(JSON.stringify({ type: "result", result: LANGE_ANTWORT }));
  const knapp = verlauf.zusammenfassung();
  assert.deepEqual(Object.keys(knapp), ["antwort", "limit"]);
  assert.equal(knapp.antwort.length, 1000);
  const voll = verlauf.zusammenfassung({ vollstaendig: true });
  assert.equal(voll.antwort, knapp.antwort);
  assert.equal(voll.volleAntwort, LANGE_ANTWORT);
  assert.equal(voll.groessterKontext, 9000);
});

test("ohne Wunsch liefert starteAgent dieselben Felder wie bisher", (context) => {
  const ort = mitErsatz(context);
  const auftrag = { bereich: "tools/beispiel.mjs", abnahme: "test/werkzeuge/beispiel.test.js" };
  const lauf = starteAgent({ rolle: "bau", auftrag, root: ort }, "eins");
  assert.deepEqual(Object.keys(lauf), ["rolle", "agent", "sitzung", "befehl", "exitCode", "aktion", "fehlerausgabe", "antwort", "limit"]);
  assert.equal(lauf.aktion.art, UEBERGABE);
  assert.equal(lauf.antwort.length, 1000);
});

test("lauf startet eine Rolle mit dem Effort ihrer Agentendatei", (context) => {
  const befehl = bauMitKopf(mitErsatz(context), "effort: high\n");
  assert.equal(befehl[befehl.indexOf("--effort") + 1], "high");
  assert.equal(befehl.filter((teil) => teil === "--effort").length, 1);
});

test("ohne Effort in der Agentendatei startet lauf die Rolle ohne --effort", (context) => {
  const befehl = bauMitKopf(mitErsatz(context), "");
  assert.equal(befehl.includes("--effort"), false);
  assert.equal(befehl[befehl.indexOf("--agent") + 1], "bau");
});

test("zwei Agenten laufen gleichzeitig, ohne Bereich und Abnahme und ohne Kontextgrenze", async (context) => {
  const ort = mitErsatz(context);
  const start = { agent: "erkunder", argumente: [], kontextGrenze: null, vollstaendig: true };
  const starte = (ich, anderer) => starteAgentParallel({ rolle: "erkunder", root: ort }, `${ich} ${anderer}`, start);
  const laeufe = await Promise.all([starte("eins", "zwei"), starte("zwei", "eins")]);
  for (const lauf of laeufe) {
    assert.equal(lauf.exitCode, 0);
    assert.equal(lauf.aktion, null);
    assert.equal(lauf.agent, "erkunder");
    assert.equal(lauf.volleAntwort, `gleichzeitig ${LANGE_ANTWORT}`);
    assert.equal(lauf.groessterKontext, 150_000);
  }
  assert.ok(existsSync(join(ort, "start-eins")) && existsSync(join(ort, "start-zwei")));
});

test("ohne Bereich und ohne genannten Agenten bricht der Start mit Grund ab", () => {
  assert.throws(() => starteAgent({ rolle: "erkunder", root: "." }, "los"), /Ohne Bereich braucht der Start einen Agenten/);
  assert.throws(() => starteAgent({ rolle: "erkunder", root: "." }, "los", { agent: "" }), /Ohne Bereich braucht der Start einen Agenten/);
});

test("der parallele Start liest lange Antworten mit Umlauten unverändert", async (context) => {
  const ort = mitErsatz(context);
  const start = { agent: "erkunder", argumente: [], kontextGrenze: null, vollstaendig: true };
  const lauf = await starteAgentParallel({ rolle: "erkunder", root: ort }, "drei - umlaute", start);
  assert.equal(lauf.aktion, null);
  assert.equal(lauf.volleAntwort, `gleichzeitig ${"äb".repeat(100_000)}`);
});
