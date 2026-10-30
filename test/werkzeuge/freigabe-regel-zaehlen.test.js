import assert from "node:assert/strict";
import { test } from "node:test";

import { freigabeImProbeRepo } from "./freigabe/hilfen.mjs";
import { commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const JSON_EINZUG = 2;
const EIGENE_REGEL = "hermes/keine-kommentare";
const ANDERE_REGEL = "hermes/wort-nur-in";
const ZAEHLER = [
  'import { readFileSync } from "node:fs";',
  'const treffer = JSON.parse(readFileSync("tools/treffer.json", "utf8"));',
  "const messages = Object.entries(treffer).flatMap(([ruleId, anzahl]) =>",
  "  Array.from({ length: anzahl }, () => ({ ruleId, severity: 2 })),",
  ");",
  "console.log(JSON.stringify([{ filePath: 'datei.js', messages }]));",
  "",
].join("\n");

function json(wert) {
  return `${JSON.stringify(wert, null, JSON_EINZUG)}\n`;
}

function pruefung(zusatz) {
  return json({
    titel: "Regel",
    pfade: ["tools/treffer.json"],
    treffer: { befehl: ["node", "{wurzel}/tools/zaehler.mjs"], zaehlen: "eslint-json", ...zusatz },
    probe: { befehl: ["node", "{wurzel}/tools/zaehler.mjs"] },
  });
}

async function urteil(context, { manifest, vorher, nachher }) {
  const verzeichnis = probeRepository(context, {
    ".github/CODEOWNERS": "/tools/ @Antonio20045\n",
    "tools/zaehler.mjs": ZAEHLER,
    "tools/treffer.json": json(vorher),
    "test/werkzeuge/rotproben/regel/pruefung.json": manifest,
  });
  const basis = runIn(verzeichnis, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(verzeichnis, { "tools/treffer.json": json(nachher) });
  commitAll(verzeichnis, "Änderung");
  const lauf = await freigabeImProbeRepo(context, { verzeichnis, basis });
  const kommentar = lauf.anfragen.find(
    ({ methode, pfad }) => methode === "POST" && pfad.endsWith("/comments"),
  );
  return /\*\*Regel: (\S+)\*\*/.exec(kommentar?.rumpf.body ?? "")?.[1];
}

const MIT_REGEL = pruefung({ regel: EIGENE_REGEL });

test("regel-zaehlen: verliert nur eine andere Regel Treffer, ist die Regel-Prüfung gleich", async (context) => {
  const vorher = { [EIGENE_REGEL]: 3, [ANDERE_REGEL]: 10 };
  const nachher = { [EIGENE_REGEL]: 3, [ANDERE_REGEL]: 0 };
  assert.equal(await urteil(context, { manifest: MIT_REGEL, vorher, nachher }), "gleich");
});

test("regel-zaehlen: verliert die eigene Regel Treffer, ist die Regel-Prüfung lockerer", async (context) => {
  const vorher = { [EIGENE_REGEL]: 3, [ANDERE_REGEL]: 10 };
  const nachher = { [EIGENE_REGEL]: 1, [ANDERE_REGEL]: 20 };
  assert.equal(await urteil(context, { manifest: MIT_REGEL, vorher, nachher }), "lockerer");
});

test("regel-zaehlen: fehlt die eigene Regel in der Ausgabe ganz, zählt sie als null und die Prüfung ist lockerer", async (context) => {
  const vorher = { [EIGENE_REGEL]: 3, [ANDERE_REGEL]: 10 };
  const nachher = { [ANDERE_REGEL]: 20 };
  assert.equal(await urteil(context, { manifest: MIT_REGEL, vorher, nachher }), "lockerer");
});

test("regel-zaehlen: gewinnt die eigene Regel Treffer, ist die Regel-Prüfung strenger", async (context) => {
  const vorher = { [ANDERE_REGEL]: 10 };
  const nachher = { [EIGENE_REGEL]: 2, [ANDERE_REGEL]: 0 };
  assert.equal(await urteil(context, { manifest: MIT_REGEL, vorher, nachher }), "strenger");
});

test("regel-zaehlen: ein Manifest ohne Regel zählt weiter die Gesamtzahl aller Regeln", async (context) => {
  const vorher = { [EIGENE_REGEL]: 3, [ANDERE_REGEL]: 10 };
  const nachher = { [EIGENE_REGEL]: 3, [ANDERE_REGEL]: 0 };
  assert.equal(await urteil(context, { manifest: pruefung({}), vorher, nachher }), "lockerer");
});
