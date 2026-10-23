import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";
import { parseArgs } from "node:util";

import { werkzeugBefunde } from "./auftrag/werkzeuge.mjs";
import { ausfuehren, gepruefteBasis, git } from "./pr-aenderungen.mjs";

const LISTE = "tools/ci-lokal.json";
const AUFRUF = "Aufruf: node tools/ci-lokal.mjs --basis <commit> [--mit-teuren]";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const LETZTE_ZEILEN = 15;
const MILLISEKUNDEN_JE_SEKUNDE = 1000;
const NACHKOMMASTELLEN = 1;
const MAX_AUSGABE = 268_435_456;
const EINRUECKUNG = "    ";

function befehlAusfuehren(befehl, root, basis) {
  const lauf = spawnSync("/bin/sh", ["-c", `exec 2>&1\n${befehl}`], {
    cwd: root,
    encoding: "utf8",
    env: { ...env, BASIS: basis },
    maxBuffer: MAX_AUSGABE,
  });
  if (lauf.error) return { gruen: false, ausgabe: `${lauf.stdout ?? ""}\n${lauf.error.message}` };
  return { gruen: lauf.status === EXIT_GRUEN, ausgabe: lauf.stdout };
}

function schrittAusfuehren(schritt, root, basis) {
  if (schritt.werkzeug !== undefined) {
    const befunde = werkzeugBefunde(root, [schritt.werkzeug]);
    if (befunde.length > 0) return { gruen: false, ausgabe: befunde.join("\n") };
  }
  return befehlAusfuehren(schritt.befehl, root, basis);
}

function letzteZeilen(ausgabe) {
  const zeilen = ausgabe.trimEnd().split("\n");
  return zeilen.slice(-LETZTE_ZEILEN).map((zeile) => `${EINRUECKUNG}${zeile}`);
}

function pruefen(root, { basis, mitTeuren }) {
  const { schritte } = JSON.parse(readFileSync(join(root, LISTE), "utf8"));
  const rot = [];
  for (const schritt of schritte) {
    if (schritt.teuer === true && !mitTeuren) {
      console.log(`${schritt.name} nicht gelaufen (teuer, nur mit --mit-teuren)`);
      continue;
    }
    const start = performance.now();
    const { gruen, ausgabe } = schrittAusfuehren(schritt, root, basis);
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
  const { values } = parseArgs({ options: { basis: { type: "string" }, "mit-teuren": { type: "boolean", default: false } } });
  return pruefen(root, { basis: git(["rev-parse", "--verify", gepruefteBasis(values.basis, AUFRUF, root)], root).trim(), mitTeuren: values["mit-teuren"] });
});
