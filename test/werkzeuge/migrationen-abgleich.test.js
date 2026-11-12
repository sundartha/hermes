import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { commitAll, probeRepository, runIn, writeFiles } from "../gemeinsam/umgebung.mjs";

const WURZEL = fileURLToPath(new URL("../..", import.meta.url));
const ORDNER = "src/db/migrations";
const LISTE = "src/db/migrate.js";
const ROT = 1;

function liste(...namen) {
  return namen.map((name, nr) => `const M${nr} = "${name}";\n`).join("");
}

function dateien(namen) {
  return Object.fromEntries(namen.map((name) => [`${ORDNER}/${name}`, "SELECT 1;\n"]));
}

function abgleich(context, { inListe, imOrdner, mehr = {}, danach = null }) {
  const repo = probeRepository(context, { [LISTE]: liste(...inListe), ...dateien(imOrdner), ...mehr });
  const basis = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  if (danach !== null) {
    writeFiles(repo, danach);
    commitAll(repo, "Stand");
  }
  const lauf = runIn(repo, process.execPath, [join(WURZEL, "tools/pruefen.mjs"), "migrationen", "--basis", basis]);
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

const ZWEI = ["0001_a.sql", "0002_b.sql"];

test("Ordner und Liste stimmen überein: grün", (context) => {
  const ergebnis = abgleich(context, { inListe: ZWEI, imOrdner: ZWEI });
  assert.equal(ergebnis.status, 0, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /keine geänderte Migration\./);
});

test("Ohne migrate.js gibt es keinen Abgleich", (context) => {
  const repo = probeRepository(context, dateien(["0001_a.sql", "0003_c.sql"]));
  const basis = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  const lauf = runIn(repo, process.execPath, [join(WURZEL, "tools/pruefen.mjs"), "migrationen", "--basis", basis]);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /Migrationen: kein src\/db\/migrate\.js, kein Abgleich\./);
});

const FAELLE = [
  ["Datei fehlt in der Liste", { inListe: ["0001_a.sql"], imOrdner: ZWEI }, /0002_b\.sql/],
  ["Eintrag ohne Datei", { inListe: ZWEI, imOrdner: ["0001_a.sql"] }, /0002_b\.sql/],
  ["Lücke in der Nummerierung", { inListe: ["0001_a.sql", "0003_c.sql"], imOrdner: ["0001_a.sql", "0003_c.sql"] }, /0002/],
  ["doppelte Nummer", { inListe: [...ZWEI, "0002_c.sql"], imOrdner: [...ZWEI, "0002_c.sql"] }, /0002/],
  ["Start nicht bei 0001", { inListe: ["0002_b.sql"], imOrdner: ["0002_b.sql"] }, /0001/],
  ["leere Liste", { inListe: [], imOrdner: [] }, /keinen Migrationsnamen/],
  ["Ordner fehlt", { inListe: ZWEI, imOrdner: [] }, /0001_a\.sql/],
  [
    "nur migrate.js geändert",
    { inListe: ZWEI, imOrdner: ZWEI, danach: { [LISTE]: liste("0001_a.sql") } },
    /0002_b\.sql/,
  ],
];

for (const [name, eingabe, erwartung] of FAELLE) {
  test(`Abgleich rot: ${name}`, (context) => {
    const ergebnis = abgleich(context, eingabe);
    assert.equal(ergebnis.status, ROT, ergebnis.ausgabe);
    assert.match(ergebnis.ausgabe, erwartung);
  });
}
