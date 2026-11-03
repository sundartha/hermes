import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argv, env } from "node:process";
import { parseArgs } from "node:util";

import { werkzeugBefunde } from "./auftrag/werkzeuge.mjs";
import { Abbruch, ausfuehren, gepruefteBasis, git } from "./pr-aenderungen.mjs";
import { nimmSperreAuchFuerKindprozesse } from "./schwerlauf/sperre.mjs";

const LISTE = "tools/ci-lokal.json";
const AUFRUF = "Aufruf: node tools/ci-lokal.mjs --basis <commit> [--mit-teuren] [--pr <nummer>]";
const PR_NUMMER = /^[1-9]\d*$/;
const ERSTES_ARGUMENT = 2;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const LETZTE_ZEILEN = 15;
const MILLISEKUNDEN_JE_SEKUNDE = 1000;
const NACHKOMMASTELLEN = 1;
const MAX_AUSGABE = 268_435_456;
const EINRUECKUNG = "    ";

function schrittUmgebung(basis, pr) {
  const umgebung = { ...env, BASIS: basis };
  delete umgebung.PR;
  return pr === undefined ? umgebung : { ...umgebung, PR: pr };
}

function befehlAusfuehren(befehl, root, { basis, pr }) {
  const lauf = spawnSync("/bin/sh", ["-c", `exec 2>&1\n${befehl}`], {
    cwd: root,
    encoding: "utf8",
    env: schrittUmgebung(basis, pr),
    maxBuffer: MAX_AUSGABE,
  });
  if (lauf.error) return { gruen: false, ausgabe: `${lauf.stdout ?? ""}\n${lauf.error.message}` };
  return { gruen: lauf.status === EXIT_GRUEN, ausgabe: lauf.stdout };
}

function schrittAusfuehren(schritt, root, lauf) {
  if (schritt.werkzeug !== undefined) {
    const befunde = werkzeugBefunde(root, [schritt.werkzeug]);
    if (befunde.length > 0) return { gruen: false, ausgabe: befunde.join("\n") };
  }
  return befehlAusfuehren(schritt.befehl, root, lauf);
}

function letzteZeilen(ausgabe) {
  const zeilen = ausgabe.trimEnd().split("\n");
  return zeilen.slice(-LETZTE_ZEILEN).map((zeile) => `${EINRUECKUNG}${zeile}`);
}

function nichtGelaufen(schritt, { mitTeuren, pr }) {
  if (schritt.teuer === true && !mitTeuren) return "teuer, nur mit --mit-teuren";
  if (schritt.mitPr === true && pr === undefined) return "braucht den PR, nur mit --pr";
  return null;
}

function pruefen(root, { basis, mitTeuren, pr }) {
  const { schritte } = JSON.parse(readFileSync(join(root, LISTE), "utf8"));
  const rot = [];
  for (const schritt of schritte) {
    const grund = nichtGelaufen(schritt, { mitTeuren, pr });
    if (grund !== null) {
      console.log(`${schritt.name} nicht gelaufen (${grund})`);
      continue;
    }
    const start = performance.now();
    const { gruen, ausgabe } = schrittAusfuehren(schritt, root, { basis, pr });
    const sekunden = ((performance.now() - start) / MILLISEKUNDEN_JE_SEKUNDE).toFixed(NACHKOMMASTELLEN);
    console.log(`${schritt.name} ${gruen ? "grün" : "rot"} ${sekunden}s`);
    if (!gruen) {
      rot.push(schritt.name);
      console.log(letzteZeilen(ausgabe).join("\n"));
    }
  }
  console.log(rot.length === 0 ? "ci-lokal: grün" : `ci-lokal: rot: ${rot.join(", ")}`);
  return rot.length === 0 ? EXIT_GRUEN : EXIT_ROT;
}

await ausfuehren(async (root) => {
  const { values } = parseArgs({ options: { basis: { type: "string" }, "mit-teuren": { type: "boolean", default: false }, pr: { type: "string" } } });
  const basis = git(["rev-parse", "--verify", gepruefteBasis(values.basis, AUFRUF, root)], root).trim();
  if (values.pr !== undefined && !PR_NUMMER.test(values.pr)) throw new Abbruch(`--pr erwartet eine PR-Nummer, nicht ${JSON.stringify(values.pr)}. ${AUFRUF}`);
  await nimmSperreAuchFuerKindprozesse(["ci-lokal", ...argv.slice(ERSTES_ARGUMENT)].join(" "));
  return pruefen(root, { basis, mitTeuren: values["mit-teuren"], pr: values.pr });
});
