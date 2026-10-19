import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { baueArbeitsordner, entferne } from "../../tools/auftrag/pruefer-arbeitsordner.mjs";
import { zuPruefendeCommits } from "../../tools/auftrag/pruefer-auswahl.mjs";
import { pruefeCommit } from "../../tools/auftrag/pruefer-lauf.mjs";
import {
  SCHEIN_TOKEN,
  aufzeichnung,
  ersatzPruefer,
  ohneGitVariablen,
  probeRepo,
} from "./pruefer/hilfen.mjs";

ohneGitVariablen();

const KB = 1024;
const UEBERSPRUNGEN = "## Nicht unter importe/ abgelegt";
const HAUPT = [
  'import { A } from "./a.js";',
  'import { B } from "../b.mjs";',
  'import { AUCH } from "./auch.js";',
  'import { P } from "../../node_modules/paket/index.js";',
  'import { D } from "../../../draussen.js";',
  'import fremd from "fremd";',
  "export const SUMME = A + B + AUCH + P + D + fremd;",
  "",
].join("\n");
const BESTAND = {
  "src/x/a.js": "export const A = 1;\n",
  "src/b.mjs": "export const B = 2;\n",
  "src/x/auch.js": "export const AUCH = 3;\n",
  "node_modules/paket/index.js": "export const P = 4;\n",
};

function commitMit(context, bestand, neu) {
  const repo = probeRepo(context, bestand);
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.committe(neu, "Ändere die Summe\n");
  const [commit] = zuPruefendeCommits({ basis, head: repo.git(["rev-parse", "HEAD"]), branch: "fix/summe", root: repo.ordner }).commits;
  return { repo, basis, commit };
}

function ordnerFuer(context, { repo, basis, commit }) {
  const ergebnis = baueArbeitsordner(commit, { root: repo.ordner, auftragstext: "", ciLauf: "", basis });
  context.after(() => entferne(ergebnis.ordner));
  return ergebnis;
}

function uebersprungenIn(ordner) {
  const text = readFileSync(join(ordner, "auftrag.md"), "utf8");
  const anfang = text.indexOf(UEBERSPRUNGEN);
  if (anfang === -1) return "";
  return text.slice(anfang, text.indexOf("\n## ", anfang + 1));
}

test("die direkt relativ importierten Repo-Dateien liegen unter importe/ und stehen mit Pfad im Aufruftext, Geändertes, Pakete und Pfade außerhalb des Repos nicht", async (context) => {
  const { repo, basis, commit } = commitMit(context, BESTAND, { "src/x/haupt.js": HAUPT, "src/x/auch.js": "export const AUCH = 5;\n" });
  const ersatz = ersatzPruefer(context, { aufnahme: aufzeichnung("gueltig") });
  const kontext = { root: repo.ordner, basis, token: SCHEIN_TOKEN, programm: ersatz.programm, auftragstext: "", ciLauf: "" };
  const ergebnis = await pruefeCommit({ ...commit, letzter: false }, kontext);
  assert.equal(ergebnis.zustand, "geprueft");
  const { dateien, eingabe } = ersatz.protokoll();
  const importe = dateien.filter((name) => name.startsWith("importe/") && /\.m?js$/.test(name)).sort();
  assert.deepEqual(importe, ["importe/src/b.mjs", "importe/src/x/a.js"]);
  assert.ok(dateien.includes("dateien/src/x/auch.js"));
  assert.equal(dateien.some((name) => name.startsWith("importe/") && (name.includes("node_modules") || name.includes("auch"))), false);
  assert.equal(dateien.some((name) => name.includes("draussen")), false);
  for (const pfad of importe) assert.ok(eingabe.includes(JSON.stringify(pfad)), pfad);
  assert.match(eingabe, /dateien\/, importe\//);
  assert.equal(eingabe.includes("export const A = 1;"), false);
});

test("ein Import, den ein früherer Commit des PR geändert hat, liegt im Stand nach dem geprüften Commit unter importe/, nicht im Stand der Basis", (context) => {
  const repo = probeRepo(context, BESTAND);
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.committe({ "src/b.mjs": "export const B = 7;\n" }, "Ändere B\n");
  repo.committe({ "src/x/haupt.js": HAUPT }, "Ändere die Summe\n");
  const { commits } = zuPruefendeCommits({ basis, head: repo.git(["rev-parse", "HEAD"]), branch: "fix/summe", root: repo.ordner });
  const { ordner } = ordnerFuer(context, { repo, basis, commit: commits.at(-1) });
  assert.equal(readFileSync(join(ordner, "importe/src/b.mjs"), "utf8"), "export const B = 7;\n");
  assert.equal(readFileSync(join(ordner, "basis/src/b.mjs"), "utf8"), "export const B = 2;\n");
});

test("eine Datei über 64 KB wird nicht abgelegt, sondern mit Pfad in auftrag.md genannt", (context) => {
  const gross = `export const G = "${"g".repeat(65 * KB)}";\n`;
  const lage = commitMit(context, { "src/gross.js": gross, "src/klein.js": "export const K = 1;\n" }, {
    "src/haupt.js": 'import { G } from "./gross.js";\nimport { K } from "./klein.js";\nexport const H = G + K;\n',
  });
  const { ordner, importe } = ordnerFuer(context, lage);
  assert.deepEqual(importe, ["importe/src/klein.js"]);
  assert.equal(existsSync(join(ordner, "importe/src/gross.js")), false);
  assert.ok(uebersprungenIn(ordner).includes('- "src/gross.js" ('), uebersprungenIn(ordner));
});

test("mehr als 40 Importe oder zusammen mehr als 400 KB werden nicht abgelegt, sondern in fester Reihenfolge in auftrag.md genannt", (context) => {
  const viele = Object.fromEntries(Array.from({ length: 41 }, (_, index) => [`src/v/d${String(index).padStart(2, "0")}.js`, `export const D = ${index};\n`]));
  const vieleImporte = Object.keys(viele).map((pfad, index) => `import { D as D${index} } from "./${pfad.slice("src/".length)}";`);
  const lageViele = commitMit(context, viele, { "src/haupt.js": `${vieleImporte.join("\n")}\n` });
  const ergebnisViele = ordnerFuer(context, lageViele);
  assert.equal(ergebnisViele.importe.length, 40);
  assert.ok(uebersprungenIn(ergebnisViele.ordner).includes('- "src/v/d40.js" ('), uebersprungenIn(ergebnisViele.ordner));
  const schwer = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`src/s${index}.js`, `export const S = "${"s".repeat(60 * KB)}";\n`]));
  const schwerImporte = Object.keys(schwer).map((pfad, index) => `import { S as S${index} } from "./${pfad.slice("src/".length)}";`);
  const lageSchwer = commitMit(context, schwer, { "src/haupt.js": `${schwerImporte.join("\n")}\n` });
  const ergebnisSchwer = ordnerFuer(context, lageSchwer);
  assert.deepEqual(ergebnisSchwer.importe, ["s0", "s1", "s2", "s3", "s4", "s5"].map((name) => `importe/src/${name}.js`));
  assert.ok(uebersprungenIn(ergebnisSchwer.ordner).includes('- "src/s6.js" ('), uebersprungenIn(ergebnisSchwer.ordner));
});
