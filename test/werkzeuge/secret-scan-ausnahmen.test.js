import assert from "node:assert/strict";
import { test } from "node:test";

import { workflowLines } from "./workflow-dateien.js";

const WORKFLOW = "ci.yml";
const SCHRITT = "      - name: Secret-Scan";
const NAECHSTER_SCHRITT = /^ {6}- /;
const FORTSETZUNG = /\\\s*$/;
const AUFRUF = '"$RUNNER_TEMP/gitleaks"';
const ZUWEISUNG = /^\s*(\w+)="(.*)"\s*$/;
const VARIABLE = /^"\$(\w+)"$/;
const LEERER_ORDNER = /^\$\(mktemp -d "[^"]+"\)$/;
const GIT_VERZEICHNIS = "$(git rev-parse --absolute-git-dir)";
const TRENNER = /\s+/;
const WEITERE_AUSNAHMEN = ["--baseline-path", "-b", "-i"];

function schrittZeilen() {
  const zeilen = workflowLines(WORKFLOW);
  const anfang = zeilen.indexOf(SCHRITT);
  assert.notEqual(anfang, -1, `${SCHRITT.trim()} fehlt in ${WORKFLOW}`);
  const rest = zeilen.slice(anfang + 1);
  const ende = rest.findIndex((zeile) => NAECHSTER_SCHRITT.test(zeile));
  return ende === -1 ? rest : rest.slice(0, ende);
}

function befehle(zeilen) {
  const ergebnis = [];
  let offen = "";
  for (const zeile of zeilen) {
    offen += ` ${zeile.replace(FORTSETZUNG, "").trim()}`;
    if (!FORTSETZUNG.test(zeile)) {
      ergebnis.push(offen.trim());
      offen = "";
    }
  }
  return ergebnis;
}

function scanAufruf() {
  const zeilen = schrittZeilen();
  const aufrufe = befehle(zeilen).filter((befehl) => befehl.startsWith(AUFRUF));
  assert.equal(aufrufe.length, 1, `genau ein gitleaks-Aufruf erwartet:\n${aufrufe.join("\n")}`);
  const zuweisungen = new Map(
    zeilen.map((zeile) => ZUWEISUNG.exec(zeile)?.slice(1)).filter(Boolean),
  );
  return { teile: aufrufe[0].split(TRENNER), zuweisungen };
}

function zugewiesen(zuweisungen, teil) {
  const name = VARIABLE.exec(teil ?? "")?.[1];
  return name === undefined ? undefined : zuweisungen.get(name);
}

function wertNach(teile, option) {
  const stelle = teile.indexOf(option);
  return stelle === -1 ? undefined : teile[stelle + 1];
}

test("secret-scan: Inline-Markierungen im Code nehmen keinen Fund aus", () => {
  const { teile } = scanAufruf();
  assert.ok(teile.includes("--ignore-gitleaks-allow"), teile.join(" "));
});

test("secret-scan: eine .gitleaksignore aus dem Pull Request nimmt keinen Fund aus", () => {
  const { teile, zuweisungen } = scanAufruf();
  const ordner = zugewiesen(zuweisungen, wertNach(teile, "--gitleaks-ignore-path"));
  assert.match(
    ordner ?? "",
    LEERER_ORDNER,
    `kein frisch angelegter leerer Ordner: ${teile.join(" ")}`,
  );
  const quelle = zugewiesen(zuweisungen, teile.at(-1));
  assert.equal(quelle, GIT_VERZEICHNIS, `Quelle muss das Git-Verzeichnis sein: ${teile.join(" ")}`);
});

test("secret-scan: Ausnahmen kommen nur aus gitleaks.toml", () => {
  const { teile } = scanAufruf();
  assert.equal(wertNach(teile, "--config"), "gitleaks.toml", teile.join(" "));
  const weitereAusnahmen = teile.filter((teil) =>
    WEITERE_AUSNAHMEN.some((option) => teil.startsWith(option)),
  );
  assert.deepEqual(weitereAusnahmen, [], teile.join(" "));
});
