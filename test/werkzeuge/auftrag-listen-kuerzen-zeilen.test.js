import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { LISTEN_KUERZEN } from "../../tools/auftrag/listen-kuerzen.mjs";

import { probeRepository, runIn } from "./probe-repo.js";

const BEREICHE = "tools/bereiche.json";
const MIT_ALTERNATIVEN = ["--alternativen"];
const FACHLOGIK = String.raw`    "fachlogik": ["^src/consult/answer\\.[jt]s$", "^src/consult/question\\.[jt]s$", "^src/w/"],`;
const FACHLOGIK_GEKUERZT = String.raw`    "fachlogik": ["^src/consult/answer\\.[jt]s$", "^src/w/"],`;
const EINZIG = String.raw`    "einzig": ["^src/consult/question\\.[jt]s$"],`;
const EINZIG_LEER = `    "einzig": [],`;
const ALT = String.raw`^src/billing/(charge|decline|refund)\.[jt]s$`;
const NEU = String.raw`^src/billing/(charge|refund)\.[jt]s$`;
const PLUS = String.raw`^src/billing/(charge|decline)+\.js$`;
const BLEIBEN = [String.raw`^src/(billing|w)/`, String.raw`^src/w/wert\.(js|mjs)$`, String.raw`^src/billing/(decline|charge)?\.js$`];
const TEXT = String.raw`[
  {
    "bereich": "probe",
    "quellen": ["^src/"],
${FACHLOGIK}
${EINZIG}
    "eingaenge": [
      "^src/billing/(charge|decline|refund)\\.[jt]s$",
      "^src/(billing|w)/",
      "^src/w/wert\\.(js|mjs)$",
      "^src/billing/(decline|charge)?\\.js$"
    ]
  }
]
`;
const VORHANDEN = ["src/billing/charge.js", "src/billing/refund.js", "src/consult/answer.js", "src/w/wert.js"];
const GELOESCHT = ["src/billing/decline.js", "src/consult/question.js", "src/w/wert.mjs"];

function nachLoeschung(context, { text = TEXT, argumente = [], zusatz = [] } = {}) {
  const dateien = Object.fromEntries([...VORHANDEN, ...zusatz, ...GELOESCHT].map((pfad) => [pfad, "export {};\n"]));
  const repo = probeRepository(context, { "package.json": JSON.stringify({ type: "module" }), [BEREICHE]: text, ...dateien });
  runIn(repo, "git", ["rm", "-q", ...GELOESCHT]);
  const lauf = runIn(repo, process.execPath, [LISTEN_KUERZEN, "--basis", "HEAD", ...argumente]);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  return { ausgabe: lauf.stdout, text: readFileSync(join(repo, BEREICHE), "utf8") };
}

function eingaenge(text) {
  return JSON.parse(text)[0].eingaenge;
}

test("auftrag-listen-kuerzen: ein toter Eintrag in einer einzeiligen Liste unter einem Schlüssel fällt, die übrigen Einträge der Zeile und der übrige Text bleiben bytegleich", (context) => {
  const { text } = nachLoeschung(context);
  assert.equal(text, TEXT.replace(FACHLOGIK, FACHLOGIK_GEKUERZT).replace(EINZIG, EINZIG_LEER));
});

test("auftrag-listen-kuerzen: ist der einzige Eintrag einer einzeiligen Liste tot, bleibt die leere Liste [] mit Schlusskomma wie vorher", (context) => {
  const { text } = nachLoeschung(context);
  assert.ok(text.split("\n").includes(EINZIG_LEER), text);
  assert.deepEqual(JSON.parse(text)[0].einzig, []);
});

test("auftrag-listen-kuerzen: eine einzeilige Liste in anderer Schreibweise als JSON mit Komma und Leerzeichen bleibt, und die Ausgabe meldet sie als nicht zeilenweise streichbar", (context) => {
  const eng = TEXT.replace(FACHLOGIK, FACHLOGIK.replaceAll('", "', '","'));
  const { ausgabe, text } = nachLoeschung(context, { text: eng });
  assert.equal(text, eng);
  assert.match(ausgabe, /tools\/bereiche\.json: .*nicht zeilenweise streichen, die Liste bleibt/);
});

test("auftrag-listen-kuerzen: mit --alternativen fällt in tools/bereiche.json eine Alternative, die an der Basis nur gelöschte Dateien traf, und das Muster trifft danach dieselben vorhandenen Dateien", (context) => {
  const { text } = nachLoeschung(context, { argumente: MIT_ALTERNATIVEN });
  assert.equal(text, TEXT.replace(FACHLOGIK, FACHLOGIK_GEKUERZT).replace(EINZIG, EINZIG_LEER).replace(JSON.stringify(ALT), JSON.stringify(NEU)));
  const [muster] = eingaenge(text);
  const vorher = new RegExp(ALT);
  const nachher = new RegExp(muster);
  assert.deepEqual(VORHANDEN.filter((pfad) => nachher.test(pfad)), VORHANDEN.filter((pfad) => vorher.test(pfad)));
  assert.equal(GELOESCHT.filter((pfad) => nachher.test(pfad)).length, 0);
});

test("auftrag-listen-kuerzen: ohne --alternativen bleibt ein Muster mit toter Alternative unverändert", (context) => {
  const { text } = nachLoeschung(context);
  assert.deepEqual(eingaenge(text), [ALT, ...BLEIBEN]);
});

test("auftrag-listen-kuerzen: eine Alternative, die noch eine Datei trifft, eine Endungsgruppe und ein Muster mit Gruppe unter Mengenangabe bleiben auch mit --alternativen", (context) => {
  const { text } = nachLoeschung(context, { argumente: MIT_ALTERNATIVEN });
  assert.deepEqual(eingaenge(text).slice(1), BLEIBEN);
});

test("auftrag-listen-kuerzen: steht ein Muster mit toter Alternative unter zwei Schlüsseln, bleibt tools/bereiche.json mit --alternativen bytegleich und die Ausgabe nennt das Muster als nicht genau einmal im Text", (context) => {
  const doppelt = TEXT.replace(EINZIG, `${EINZIG}\n    "zweit": [${JSON.stringify(ALT)}],`);
  const { ausgabe, text } = nachLoeschung(context, { text: doppelt, argumente: MIT_ALTERNATIVEN });
  assert.equal(text, doppelt);
  assert.ok(ausgabe.includes(`${BEREICHE}: das Muster ${JSON.stringify(ALT)} steht nicht genau einmal im Text, die Liste bleibt.\n`), ausgabe);
});

test("auftrag-listen-kuerzen: träfe ein Muster mit Gruppe unter + ohne seine tote Alternative eine vorhandene Datei nicht mehr, bleibt tools/bereiche.json mit --alternativen bytegleich, die Ausgabe nennt das Muster und die Schlusszeile zählt keine Liste", (context) => {
  const plus = `[\n  {\n    "bereich": "probe",\n    "quellen": ["^src/"],\n    "eingaenge": [${JSON.stringify(PLUS)}]\n  }\n]\n`;
  const { ausgabe, text } = nachLoeschung(context, { text: plus, argumente: MIT_ALTERNATIVEN, zusatz: ["src/billing/chargedecline.js"] });
  assert.equal(text, plus);
  assert.ok(ausgabe.includes(`${BEREICHE}: das Muster ${JSON.stringify(PLUS)} träfe ohne seine toten Alternativen andere vorhandene Dateien, es bleibt.\n`), ausgabe);
  assert.match(ausgabe, /^0 Einträge gestrichen und 0 Muster um tote Alternativen gekürzt in 0 Listen/m);
});

test("auftrag-listen-kuerzen: die Ausgabe nennt jede gestrichene Alternative mit altem und neuem Muster, und die Schlusszeile zählt das umgeschriebene Muster", (context) => {
  const { ausgabe } = nachLoeschung(context, { argumente: MIT_ALTERNATIVEN });
  assert.ok(ausgabe.includes(`${BEREICHE}: tote Alternative gestrichen ${JSON.stringify(ALT)} -> ${JSON.stringify(NEU)}\n`), ausgabe);
  assert.equal(ausgabe.split(" -> ").length, 2, ausgabe);
  assert.match(ausgabe, /^1 Einträge gestrichen und 1 Muster um tote Alternativen gekürzt in 1 Listen/m);
});
