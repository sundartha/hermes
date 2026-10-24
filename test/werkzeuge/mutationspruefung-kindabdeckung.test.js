import assert from "node:assert/strict";
import { cpSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ablage, mitKindern } from "../../tools/mutationspruefung/kindabdeckung-ablage.mjs";
import { BASIS, NEGATIV, NULL, pruefe, quelle, schluessel, UEBERLEBT } from "./mutationspruefung-hilfen.js";
import { probeDirectory, probeRepository, REPO_ROOT, writeFiles } from "./probe-repo.js";

const WERKZEUGORDNER = "tools/mutationspruefung";
const STARTWEG = "test/helpers.js";
const WEITERGABE_IMPORT = /^import \{ (\w+) \} from "[^"]+\/zustand\.mjs";$/m;
const BIS_ZUM_ENDE = "setInterval(() => {}, 1000);";
const EIGENES_ENDE = 'process.on("SIGTERM", () => process.exit(0));';
const MUTANTEN_JE_QUELLE = /^src\/(?:zahl|text|wort|ruf)\.js: [1-9]\d* Mutanten gegen \d+ Testdateien/gm;
const QUELLEN = 4;
const ZAHL = 'import { einordnen } from "../src/zahl.js";';
const TEXT = 'import { laut } from "../src/text.js";';
const WORT = 'import { leise } from "../src/wort.js";';
const RUF = 'import { ruf } from "../src/ruf.js";';
const STAND = { static: { 1: 1 }, perTest: { erster: { 1: 2, 2: 1 } } };
const NICHT_IM_ORDNER = "ENOTDIR";

function kind(einfuhr, ausdruck, ende) {
  return [einfuhr, ende, `process.stdout.write(${ausdruck} + "\\n");`, BIS_ZUM_ENDE, ""].join("\n");
}

function zwischenkind(enkel, signal) {
  return [
    'import { spawn } from "node:child_process";',
    'import { kindUmgebung } from "./helpers.js";',
    `const enkel = spawn(process.execPath, [${JSON.stringify(enkel)}], { env: kindUmgebung(), stdio: ["ignore", "inherit", "inherit"] });`,
    'process.on("SIGTERM", () => {',
    '  enkel.once("exit", () => process.exit(0));',
    `  enkel.kill(${JSON.stringify(signal)});`,
    "});",
    BIS_ZUM_ENDE,
    "",
  ].join("\n");
}

function kindtest(skript, erwartet, signal) {
  return [
    'import assert from "node:assert/strict";',
    'import { spawn } from "node:child_process";',
    'import { once } from "node:events";',
    'import { test } from "node:test";',
    'import { kindUmgebung } from "./helpers.js";',
    'test("das Kind antwortet, bis der Test es beendet", async () => {',
    `  const kind = spawn(process.execPath, [${JSON.stringify(skript)}], { env: kindUmgebung(), stdio: ["ignore", "pipe", "inherit"] });`,
    '  const [ausgabe] = await once(kind.stdout, "data");',
    '  const beendet = once(kind, "exit");',
    `  kind.kill(${JSON.stringify(signal)});`,
    "  await beendet;",
    `  assert.equal(String(ausgabe).trim(), ${JSON.stringify(erwartet)});`,
    "});",
    "",
  ].join("\n");
}

function startweg() {
  const [zeile, weitergabe] = WEITERGABE_IMPORT.exec(readFileSync(join(REPO_ROOT, STARTWEG), "utf8"));
  return [zeile, `export const kindUmgebung = () => ${weitergabe}({ PATH: process.env.PATH });`, ""].join("\n");
}

test("Mutanten, die nur vom Test gestartete und per Signal beendete Kind- oder Enkelprozesse ausführen, führt die Prüfung gegen die startende Testdatei aus, und die Prozesse töten sie, auch mit eigenem Signal-Handler", (context) => {
  const repo = probeRepository(context, {
    ...BASIS,
    [STARTWEG]: startweg(),
    "src/text.js": "export const laut = (wort) => wort;\n",
    "src/wort.js": "export const leise = (wort) => wort;\n",
    "src/ruf.js": "export const ruf = (wort) => wort;\n",
    "test/kind-negativ.mjs": kind(ZAHL, "einordnen(-1)", ""),
    "test/kind-zahl.mjs": kind(ZAHL, '[-1, 0, 1].map(einordnen).join(",")', ""),
    "test/kind-text.mjs": kind(TEXT, 'laut("ja")', EIGENES_ENDE),
    "test/kind-ruf.mjs": kind(RUF, 'ruf("ja")', ""),
    "test/kind-enkel.mjs": zwischenkind("test/enkel-wort.mjs", "SIGINT"),
    "test/enkel-wort.mjs": kind(WORT, 'leise("JA")', ""),
    "test/zahl.test.js": kindtest("test/kind-negativ.mjs", "negativ", "SIGTERM"),
    "test/zahlen.test.js": kindtest("test/kind-zahl.mjs", "negativ,null,positiv", "SIGTERM"),
    "test/ruf.test.js": kindtest("test/kind-ruf.mjs", "ja!", "SIGHUP"),
    "test/text.test.js": kindtest("test/kind-text.mjs", "JA", "SIGTERM"),
    "test/wort.test.js": kindtest("test/kind-enkel.mjs", "ja", "SIGTERM"),
  });
  cpSync(join(REPO_ROOT, WERKZEUGORDNER), join(repo, WERKZEUGORDNER), { recursive: true });
  writeFiles(repo, {
    "src/zahl.js": quelle(NEGATIV, NULL),
    "src/text.js": "export const laut = (wort) => wort.toUpperCase();\n",
    "src/wort.js": "export const leise = (wort) => wort.toLowerCase();\n",
    "src/ruf.js": "export const ruf = (wort) => `${wort}!`;\n",
  });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.deepEqual(schluessel(lauf.stdout, UEBERLEBT), [], lauf.stdout + lauf.stderr);
  assert.equal(lauf.stdout.match(MUTANTEN_JE_QUELLE)?.length, QUELLEN, lauf.stdout);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
});

test("Die abgelegte Abdeckung eines Kindes zählt für seine Testdatei, und eine Abdeckung ohne Testdatei des Probelaufs bricht ab und nennt die Datei", (context) => {
  const ort = probeDirectory(context, { "a.test.js": "", "b.test.js": "", "fremd.test.js": "", "ablage/leer.txt": "" });
  const [a, b, fremd, ordner] = ["a.test.js", "b.test.js", "fremd.test.js", "ablage"].map((name) => join(ort, name));
  ablage({ datei: join(ordner, "kind.json"), testdatei: a, abdeckung: () => STAND })();
  assert.deepEqual(mitKindern({ [a]: { 3: 1 }, [b]: {} }, ordner), { [a]: { 1: 3, 2: 1, 3: 1 }, [b]: {} });
  ablage({ datei: join(ordner, "fremd.json"), testdatei: fremd, abdeckung: () => STAND })();
  assert.throws(() => mitKindern({ [a]: {}, [b]: {} }, ordner), (fehler) => fehler.message.includes(fremd));
});

test("Ein Kind, dessen Ablageordner schon weggeräumt ist, legt nichts ab und läuft weiter, jede andere Störung beim Ablegen bricht ab", (context) => {
  const ort = probeDirectory(context, { "a.test.js": "" });
  const a = join(ort, "a.test.js");
  const ablegen = (datei) => ablage({ datei, testdatei: a, abdeckung: () => STAND })();
  ablegen(join(ort, "weg", "kind.json"));
  assert.deepEqual(readdirSync(ort), ["a.test.js"]);
  assert.throws(() => ablegen(join(a, "kind.json")), { code: NICHT_IM_ORDNER });
});
