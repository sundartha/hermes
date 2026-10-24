import assert from "node:assert/strict";
import { realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { aufrufKette, erreicht, kettenBefunde } from "../../tools/auftrag/planung/kette.mjs";
import { dependentsGraph } from "../../tools/testgraph.mjs";
import { REPO_ROOT, probeDirectory, runIn } from "./probe-repo.js";

const AUFTRAG = join(REPO_ROOT, "tools/auftrag.mjs");
const EXIT_GRUEN = 0;
const EXIT_KEIN_PFAD = 1;
const EXIT_AUFRUF = 2;
const KEIN_PFAD = "kein Pfad belegt\n";

const CLAUDE = "src/claude.js";
const GEDAECHTNIS = "src/call-memory.js";
const SPEICHER = "src/store/state-ops.js";
const WERKZEUGE = "src/mcp-tools.js";
const ROUTE = "src/routes/api-calls.js";
const ANRUFE = "src/calls.js";
const EINGANG = "src/eingang.js";
const ZIEL = "src/ziel.js";
const VORNE = "src/vorne.js";
const HINTEN = "src/hinten.js";

const CLAUDE_QUELLE = `import { budgetedMemoryLines } from "./call-memory.js";
import * as store from "./store/state-ops.js";

function promptInputs(call) {
  return { call, memory: counterpartyMemoryFor(call), loc: call.loc, isInbound: call.direction === "inbound" };
}

function counterpartyMemoryFor(call) {
  if (call.direction !== "outbound") return [];
  return store.counterpartyMemory(call.tenantId, call.to);
}

function assignmentBlock(p) {
  const lines = [\`\${p.loc.prompt.goalLabel} \${p.call.goal}\`];
  return lines.join("\\n") + callMemorySection(p);
}

function outboundSituation(p) {
  const situation = p.loc.prompt.situationOutbound(p);
  return \`\${situation}\\n\\n\${assignmentBlock(p)}\`;
}

function inboundSituation(p) {
  return p.loc.prompt.situationInbound(p);
}

export function systemPrompt(call) {
  const p = promptInputs(call);
  return [p.isInbound ? inboundSituation(p) : outboundSituation(p)].filter(Boolean).join("\\n\\n");
}

function callMemorySection({ memory, loc }) {
  const lines = budgetedMemoryLines(memory);
  if (!lines.length) return "";
  return \`\\n\${loc.prompt.memory.heading}\\n\${lines.join("\\n")}\`;
}
`;

const GEDAECHTNIS_QUELLE = `export const MEMORY_MAX_CALLS = 3;

export const MEMORY_MAX_ENTRY_CHARS = 200;

function singleLine(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\\s+/g, " ").trim();
}

export function memoryLine(entry) {
  const outcome = singleLine(entry?.outcome);
  const facts = Array.isArray(entry?.facts) ? entry.facts.map(singleLine).filter(Boolean) : [];
  const parts = [outcome, facts.join("; ")].filter(Boolean);
  if (!parts.length) return null;
  return parts.join("; ").slice(0, MEMORY_MAX_ENTRY_CHARS);
}

export function budgetedMemoryLines(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(memoryLine)
    .filter(Boolean)
    .slice(0, MEMORY_MAX_CALLS);
}
`;

const QUELLEN = {
  [CLAUDE]: CLAUDE_QUELLE,
  [GEDAECHTNIS]: GEDAECHTNIS_QUELLE,
  [SPEICHER]: "export function counterpartyMemory(tenantId, to) {\n  return [tenantId, to];\n}\n",
  [WERKZEUGE]: "export async function placeCallHop(args) {\n  const response = await fetch(`${args.base}/api/calls`, { method: \"POST\", body: JSON.stringify(args) });\n  return response.json();\n}\n",
  [ROUTE]: "import { placeCall } from \"../calls.js\";\n\nexport function registriere(router) {\n  router.post(\"/api/calls\", async function startCall(anfrage) {\n    return placeCall(anfrage.body);\n  });\n}\n",
  [ANRUFE]: "export function placeCall(args) {\n  return { status: \"queued\", args };\n}\n",
  [EINGANG]: "import { anders } from \"./mitte.js\";\n\nexport function start(hilfe) {\n  return hilfe(1) + anders();\n}\n",
  "src/mitte.js": "import { ziel } from \"./ziel.js\";\n\nfunction hilfe(wert) {\n  return ziel(wert);\n}\n\nexport function anders() {\n  return 0;\n}\n",
  [ZIEL]: "export function ziel(wert) {\n  return wert;\n}\n",
  [VORNE]: "import { b } from \"./mitte2.js\";\n\nexport function a() {\n  return b();\n}\n",
  "src/mitte2.js": "import { c } from \"./hinten.js\";\n\nexport function b() {\n  return c();\n}\n",
  [HINTEN]: "export function c() {\n  return 1;\n}\n",
  "test/claude.test.js": "import { systemPrompt } from \"../src/claude.js\";\n\nsystemPrompt({});\n",
};

function stelle(rolle, datei, funktion) {
  return { rolle, datei, funktion };
}

function namen(kette) {
  return kette?.zwischen.map(({ funktion }) => funktion) ?? null;
}

function kette(ort, ...argumente) {
  return runIn(ort, process.execPath, [AUFTRAG, "kette", ...argumente]);
}

async function probe(context) {
  const root = realpathSync(probeDirectory(context, QUELLEN));
  return { root, graph: await dependentsGraph(root) };
}

test("kette: findet die P-007-Kette von systemPrompt bis memoryLine und schweigt bei direktem Aufruf und HTTP-Sprung", async (context) => {
  const { root, graph } = await probe(context);
  const faelle = [
    [{ datei: CLAUDE, funktion: "systemPrompt" }, { datei: GEDAECHTNIS, funktion: "memoryLine" }, ["outboundSituation", "assignmentBlock", "callMemorySection", "budgetedMemoryLines"]],
    [{ datei: GEDAECHTNIS, funktion: "memoryLine" }, { datei: CLAUDE, funktion: "systemPrompt" }, ["budgetedMemoryLines", "callMemorySection", "assignmentBlock", "outboundSituation"]],
    [{ datei: GEDAECHTNIS, funktion: "budgetedMemoryLines" }, { datei: GEDAECHTNIS, funktion: "memoryLine" }, []],
    [{ datei: WERKZEUGE, funktion: "placeCallHop" }, { datei: ANRUFE, funktion: "placeCall" }, null],
    [{ datei: CLAUDE, funktion: "counterpartyMemoryFor" }, { datei: SPEICHER, funktion: "counterpartyMemory" }, []],
    [{ datei: CLAUDE, funktion: "systemPrompt" }, { datei: SPEICHER, funktion: "counterpartyMemory" }, null],
    [{ datei: EINGANG, funktion: "start" }, { datei: ZIEL, funktion: "ziel" }, null],
    [{ datei: VORNE, funktion: "a" }, { datei: HINTEN, funktion: "c" }, ["b"]],
  ];
  for (const [von, nach, erwartet] of faelle) {
    assert.deepEqual(namen(aufrufKette(root, graph, { von, nach })), erwartet, `${von.funktion} → ${nach.funktion}`);
  }
});

test("kette: die Kette nennt Datei und Zeilen jedes Zwischenglieds", async (context) => {
  const { root, graph } = await probe(context);
  const kette = aufrufKette(root, graph, { von: { datei: CLAUDE, funktion: "systemPrompt" }, nach: { datei: GEDAECHTNIS, funktion: "memoryLine" } });
  assert.deepEqual(kette.zwischen.at(-1), { datei: GEDAECHTNIS, funktion: "budgetedMemoryLines", von: 18, bis: 24 });
  assert.deepEqual(kette.zwischen[0], { datei: CLAUDE, funktion: "outboundSituation", von: 18, bis: 21 });
});

test("kette: auf Modulebene erreicht die Eingangsdatei die Änderungsdatei nur über Importe", async (context) => {
  const { graph } = await probe(context);
  const faelle = [
    [CLAUDE, GEDAECHTNIS, true],
    [CLAUDE, CLAUDE, true],
    [ROUTE, ANRUFE, true],
    [WERKZEUGE, ANRUFE, false],
    [GEDAECHTNIS, CLAUDE, false],
  ];
  for (const [eingang, ziel, erwartet] of faelle) assert.equal(erreicht(graph, eingang, ziel), erwartet, `${eingang} → ${ziel}`);
});

test("kette: ein Bericht mit Lücke bekommt einen Befund mit den ungemeldeten Zwischengliedern, ohne Lücke und beim HTTP-Sprung keinen", async (context) => {
  const { root, graph } = await probe(context);
  const luecke = [stelle("eingang", CLAUDE, "systemPrompt"), stelle("wirkung", GEDAECHTNIS, "memoryLine")];
  const teilweise = [stelle("eingang", CLAUDE, "systemPrompt"), stelle("logik", GEDAECHTNIS, "memoryLine"), stelle("logik", GEDAECHTNIS, "budgetedMemoryLines"), stelle("logik", CLAUDE, "callMemorySection"), stelle("wirkung", CLAUDE, "assignmentBlock")];
  const vollstaendig = [stelle("eingang", CLAUDE, "systemPrompt"), ...["outboundSituation", "assignmentBlock", "callMemorySection"].map((name) => stelle("logik", CLAUDE, name)), stelle("logik", GEDAECHTNIS, "budgetedMemoryLines"), stelle("wirkung", GEDAECHTNIS, "memoryLine")];
  const http = [stelle("eingang", WERKZEUGE, "placeCallHop"), stelle("wirkung", ANRUFE, "placeCall")];
  const mitAusweg = [stelle("eingang", CLAUDE, "systemPrompt"), { rolle: "logik", ausweg: "nicht gefunden, weil dynamisch" }, stelle("wirkung", GEDAECHTNIS, "memoryLine")];
  const bericht = { nummern: { S1: { weg: luecke }, S2: { weg: vollstaendig }, S3: { weg: http }, S4: { weg: teilweise }, S5: { weg: mitAusweg } } };
  const befunde = kettenBefunde(root, graph, bericht);
  assert.equal(befunde.length, 2, befunde.join("\n"));
  assert.equal(befunde[0], `S1: zwischen systemPrompt (${CLAUDE}) und memoryLine (${GEDAECHTNIS}) liegen ungemeldet outboundSituation (${CLAUDE}:18-21), assignmentBlock (${CLAUDE}:13-16), callMemorySection (${CLAUDE}:32-36), budgetedMemoryLines (${GEDAECHTNIS}:18-24); nenn sie als Stellen des Wegs`);
  assert.ok(befunde[1].startsWith(`S4: zwischen systemPrompt (${CLAUDE}) und memoryLine (${GEDAECHTNIS}) liegen ungemeldet outboundSituation (${CLAUDE}:18-21);`), befunde[1]);
});

test("kette-befehl: gibt die P-007-Kette zwischen systemPrompt und memoryLine mit Datei und Zeilen in Aufrufrichtung aus, in beiden Reihenfolgen", (context) => {
  const ort = probeDirectory(context, QUELLEN);
  const erwartet = [
    "Aufrufkette, Aufrufer zuerst:",
    `${CLAUDE}:27-30 systemPrompt`,
    `${CLAUDE}:18-21 outboundSituation`,
    `${CLAUDE}:13-16 assignmentBlock`,
    `${CLAUDE}:32-36 callMemorySection`,
    `${GEDAECHTNIS}:18-24 budgetedMemoryLines`,
    `${GEDAECHTNIS}:10-16 memoryLine`,
    "",
  ].join("\n");
  for (const [von, nach] of [[`${CLAUDE}:systemPrompt`, `${GEDAECHTNIS}:memoryLine`], [`${GEDAECHTNIS}:memoryLine`, `${CLAUDE}:systemPrompt`]]) {
    const lauf = kette(ort, von, nach);
    assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
    assert.equal(lauf.stdout, erwartet, `${von} ${nach}`);
  }
});

test("kette-befehl: zwei unverbundene Funktionen ergeben „kein Pfad belegt“ mit Exit ungleich 0, auch über einen HTTP-Sprung und für eine fehlende Funktion", (context) => {
  const ort = probeDirectory(context, QUELLEN);
  const faelle = [
    [`${EINGANG}:start`, `${ZIEL}:ziel`],
    [`${WERKZEUGE}:placeCallHop`, `${ANRUFE}:placeCall`],
    [`${CLAUDE}:systemPrompt`, `${SPEICHER}:counterpartyMemory`],
    [`${CLAUDE}:systemPrompt`, `${GEDAECHTNIS}:gibtEsNicht`],
  ];
  for (const [von, nach] of faelle) {
    const lauf = kette(ort, von, nach);
    assert.equal(lauf.status, EXIT_KEIN_PFAD, `${von} ${nach}: ${lauf.stdout}${lauf.stderr}`);
    assert.equal(lauf.stdout, KEIN_PFAD, `${von} ${nach}`);
  }
});

test("kette-befehl: eine Stelle ohne Funktion, außerhalb von src, mit .., ohne JavaScript-Endung oder über einen Link nach draußen endet mit Exit 2 und gibt keine Kette aus", (context) => {
  const ort = probeDirectory(context, { ...QUELLEN, "src/.env": "GEHEIM=1\n", "draussen.js": "export function weg() {\n  return 1;\n}\n" });
  symlinkSync(join(ort, "draussen.js"), join(ort, "src/link.js"));
  const ziel = `${GEDAECHTNIS}:memoryLine`;
  for (const stelle of [CLAUDE, `${CLAUDE}:`, "draussen.js:weg", "src/../draussen.js:weg", "src/.env:GEHEIM", "src/link.js:weg", `/${CLAUDE}:systemPrompt`]) {
    const lauf = kette(ort, stelle, ziel);
    assert.equal(lauf.status, EXIT_AUFRUF, `${stelle}: ${lauf.stdout}${lauf.stderr}`);
    assert.equal(lauf.stdout, "", stelle);
    assert.match(lauf.stderr, /^Abbruch: kette nimmt nur /, stelle);
  }
});
