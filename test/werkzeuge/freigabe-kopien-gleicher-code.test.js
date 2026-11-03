import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { aenderungPruefen, urteilDer } from "./freigabe/hilfen.mjs";
import { REPO_ROOT } from "./probe-repo.js";

const EXIT_OK = 0;
const JSON_EINZUG = 2;
const ECHTES_MANIFEST = join(REPO_ROOT, "test/werkzeuge/rotproben/jscpd/pruefung.json");
const MANIFEST = "test/werkzeuge/rotproben/kopien/pruefung.json";
const EINSTELLUNG = "tools/kopien.json";
const LISTE = "tools/basis/kopien.json";
const GLEICH = "wert: 1\n";
const ANDERS = "wert: 2\n";
const LOCKERER = /Muss geändert werden: Die Prüfung „Kopien“ wird lockerer/;

const json = (wert) => `${JSON.stringify(wert, null, JSON_EINZUG)}\n`;
const formate = (...arten) => json({ formate: arten });
const liste = (...befunde) => json({ befunde });

const ZAEHLER = [
  'import { readFileSync, readdirSync } from "node:fs";',
  'const { formate } = JSON.parse(readFileSync("tools/kopien.json", "utf8"));',
  'const bekannt = JSON.parse(readFileSync("tools/basis/kopien.json", "utf8")).befunde;',
  'const passt = (pfad) => pfad.startsWith("flows/") && formate.some((art) => pfad.endsWith(art));',
  "const dateien = readdirSync('.', { recursive: true }).filter(passt).sort();",
  "const funde = dateien.flatMap((erste, stelle) =>",
  "  dateien.slice(stelle + 1).map((zweite) => [erste, zweite]),",
  ").filter(([erste, zweite]) => readFileSync(erste, 'utf8') === readFileSync(zweite, 'utf8'));",
  "const neu = funde.filter((fund) => !bekannt.includes(fund.join('|')));",
  "console.log(neu.length + ' neue Befunde, ' + (funde.length - neu.length) + ' bekannte.');",
  "process.exitCode = neu.length > 0 ? 1 : 0;",
  "",
].join("\n");

function manifest(gleicherCode) {
  return json({
    titel: "Kopien",
    pfade: ["tools/kopien.mjs", EINSTELLUNG, LISTE],
    treffer: {
      befehl: ["node", "{wurzel}/tools/kopien.mjs"],
      zaehlen: "zahlen",
      vor: [" neue Befunde", " bekannte"],
      ...(gleicherCode ? { gleicherCode } : {}),
    },
    ausnahmen: { bezeichnung: "Eingefrorene Kopien", datei: LISTE, zaehlen: "anzahl" },
    probe: { mitnehmen: [EINSTELLUNG, LISTE], befehl: ["node", "{wurzel}/tools/kopien.mjs"] },
  });
}

const BASIS = {
  ".github/CODEOWNERS": "/tools/ @Antonio20045\n/flows/ @Antonio20045\n",
  "tools/kopien.mjs": ZAEHLER,
  [EINSTELLUNG]: formate(".yml"),
  [LISTE]: liste("flows/a.yml|flows/b.yml"),
  [MANIFEST]: manifest(true),
  "flows/a.yml": GLEICH,
  "flows/b.yml": GLEICH,
  "flows/c.js": GLEICH,
  "flows/d.js": GLEICH,
};

async function pruefe(context, { aenderung, basisDateien = BASIS }) {
  const lauf = await aenderungPruefen(context, { basisDateien, aenderung });
  return { ...lauf, urteil: urteilDer(lauf, "Kopien") };
}

async function wirdLockerer(context, aufgabe) {
  const lauf = await pruefe(context, aufgabe);
  assert.match(lauf.stdout, LOCKERER, lauf.stdout + lauf.stderr);
}

test("kopien: beseitigt der PR eine Kopie im Code und streicht ihren Eintrag, ist die Prüfung nicht lockerer", async (context) => {
  const lauf = await pruefe(context, {
    aenderung: { "flows/b.yml": ANDERS, [LISTE]: liste() },
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  assert.equal(lauf.urteil, "strenger");
});

test("kopien: der Detektor lässt ein Format aus und der PR beseitigt zugleich eine Kopie: lockerer", async (context) => {
  const basisDateien = { ...BASIS, [EINSTELLUNG]: formate(".yml", ".js") };
  await wirdLockerer(context, {
    basisDateien,
    aenderung: { "flows/b.yml": ANDERS, [EINSTELLUNG]: formate(".yml") },
  });
});

test("kopien: der Detektor lässt ein Format aus, ohne dass eine Kopie beseitigt wird: lockerer", async (context) => {
  await wirdLockerer(context, { aenderung: { [EINSTELLUNG]: formate(".x") } });
});

test("kopien: der PR trägt eine neue Kopie als Ausnahme ein, ohne eine zu beseitigen: lockerer", async (context) => {
  await wirdLockerer(context, {
    aenderung: {
      "flows/e.yml": GLEICH,
      [LISTE]: liste("flows/a.yml|flows/b.yml", "flows/a.yml|flows/e.yml", "flows/b.yml|flows/e.yml"),
    },
  });
});

test("kopien: der PR beseitigt eine Kopie und trägt zugleich eine neue als Ausnahme ein, der alte Eintrag bleibt: lockerer", async (context) => {
  await wirdLockerer(context, {
    aenderung: {
      "flows/b.yml": ANDERS,
      "flows/e.yml": ANDERS,
      "flows/f.yml": ANDERS,
      [LISTE]: liste("flows/a.yml|flows/b.yml", "flows/e.yml|flows/f.yml"),
    },
  });
});

test("kopien: ohne das Merkmal gleicherCode zählt die Basis weiter auf dem Basis-Code, die beseitigte Kopie wäre lockerer", async (context) => {
  await wirdLockerer(context, {
    basisDateien: { ...BASIS, [MANIFEST]: manifest(false) },
    aenderung: { "flows/b.yml": ANDERS, [LISTE]: liste() },
  });
});

test("kopien: das echte Manifest der jscpd-Prüfung zählt auf demselben Code", () => {
  const { treffer } = JSON.parse(readFileSync(ECHTES_MANIFEST, "utf8"));
  assert.equal(treffer.gleicherCode, true);
});
