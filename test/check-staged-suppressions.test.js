// Aufraeum-Gate (scripts/check-staged-suppressions.js). Prueft die reine
// Auswahl-Logik auf einer Attrappe, nie auf der echten eslint-suppressions.json
// (die ist gross und aendert sich mit jedem Aufraeumen). Beide Richtungen:
// eine vorgemerkte Datei mit Eintraegen wird gemeldet, eine ohne wird nicht.
//
// ALTLAST-LISTE: der zweite describe-Block prueft den Ausweg aus dem Gate.
// Hintergrund: das Gate hatte einen Fall ohne Ausweg (src/store/state-ops.js,
// src/store/pg.js tragen Schuld, deren Aufraeumen ein eigenes Refactoring
// waere). Der Eigentuemer hat entschieden: der Ausweg ist eine ausdrueckliche
// Altlast-Liste, nicht "git commit --no-verify".
//
// Der Vertrag, den dieser Block pinnt, ist die NAHT, nicht der Speicherort:
//   findSuppressedStagedFiles({ stagedFiles, suppressions, legacyExceptions })
// legacyExceptions ist eine Abbildung Dateipfad -> { reason, date }:
//   reason: nicht-leerer Text, warum die Datei noch nicht geraeumt ist
//   date:   Kalenderdatum im Format YYYY-MM-DD, wann die Ausnahme entstand
// Ein Eintrag, dem eines von beidem fehlt oder der es nur leer/unlesbar
// fuehrt, ist UNGUELTIG und entschuldigt nichts - die Liste ist eine bewusste
// Ausnahme, kein Abstellgleis. WO die Liste liegt, laesst der Auswahl-Block
// bewusst offen; das Einlesen prueft der dritte Block getrennt davon, der
// vierte den Bericht, den ein Blockierter zu sehen bekommt.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  findSuppressedStagedFiles,
  loadLegacyExceptions,
} from "../scripts/check-staged-suppressions.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY_EXCEPTIONS_REL = "eslint-legacy-exceptions.json";
const SUPPRESSIONS_REL = "eslint-suppressions.json";
const SCRIPT_PATH = resolve(REPO_ROOT, "scripts/check-staged-suppressions.js");

function readRepoFile(relativePath) {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

const DUMMY_SUPPRESSIONS = {
  "src/dummy/schmutzig.js": {
    "no-magic-numbers": { count: 3 },
    "id-length": { count: 1 },
  },
  "src/dummy/leer.js": {},
  "apps/dummy/andere-datei.js": {
    "no-magic-numbers": { count: 2 },
  },
};

describe("findSuppressedStagedFiles (Attrappe)", () => {
  it("meldet eine vorgemerkte Datei mit Eintraegen samt Regeln+Anzahl", () => {
    const offenders = findSuppressedStagedFiles({
      stagedFiles: ["src/dummy/schmutzig.js"],
      suppressions: DUMMY_SUPPRESSIONS,
    });
    assert.equal(offenders.length, 1);
    assert.equal(offenders[0].file, "src/dummy/schmutzig.js");
    assert.deepEqual(offenders[0].ruleCounts, [
      { rule: "no-magic-numbers", count: 3 },
      { rule: "id-length", count: 1 },
    ]);
  });

  it("laesst eine vorgemerkte Datei ohne Eintraege durch", () => {
    const offenders = findSuppressedStagedFiles({
      stagedFiles: ["src/dummy/sauber.js"],
      suppressions: DUMMY_SUPPRESSIONS,
    });
    assert.deepEqual(offenders, []);
  });

  it("behandelt eine Datei mit leerem Regel-Objekt wie keinen Eintrag", () => {
    const offenders = findSuppressedStagedFiles({
      stagedFiles: ["src/dummy/leer.js"],
      suppressions: DUMMY_SUPPRESSIONS,
    });
    assert.deepEqual(offenders, []);
  });

  it("meldet nur die betroffenen unter mehreren vorgemerkten Dateien", () => {
    const offenders = findSuppressedStagedFiles({
      stagedFiles: [
        "src/dummy/sauber.js",
        "src/dummy/schmutzig.js",
        "apps/dummy/andere-datei.js",
        "src/dummy/leer.js",
      ],
      suppressions: DUMMY_SUPPRESSIONS,
    });
    assert.deepEqual(
      offenders.map((offender) => offender.file),
      ["src/dummy/schmutzig.js", "apps/dummy/andere-datei.js"],
    );
  });

  it("liefert eine leere Liste ohne vorgemerkte Dateien", () => {
    const offenders = findSuppressedStagedFiles({
      stagedFiles: [],
      suppressions: DUMMY_SUPPRESSIONS,
    });
    assert.deepEqual(offenders, []);
  });
});

// Eigene Attrappe fuer die Altlast-Faelle, damit die Bestandsfaelle oben
// unveraendert bleiben. "geraeumt.js" fehlt hier absichtlich: sie steht auf
// der Liste, traegt aber keine Unterdrueckungen mehr.
const LEGACY_SUPPRESSIONS = {
  "src/dummy/altlast.js": { "id-length": { count: 3 }, "max-params": { count: 2 } },
  "src/dummy/ohne-grund.js": { "id-length": { count: 1 } },
  "src/dummy/ohne-datum.js": { "id-length": { count: 1 } },
  "src/dummy/leere-felder.js": { "id-length": { count: 1 } },
  "src/dummy/krummes-datum.js": { "id-length": { count: 1 } },
  "src/dummy/nicht-gelistet.js": { "no-magic-numbers": { count: 2 } },
};

// Genau ein Eintrag ist gueltig (altlast.js). Er steht in jedem Fall mit im
// Spiel, damit jeder Test die Entschuldigung UND die Positiv-Kontrolle
// zugleich prueft: ein Gate, das alles durchlaesst, faellt hier auf.
const LEGACY_EXCEPTIONS = {
  "src/dummy/altlast.js": {
    reason: "Aufraeumen waere ein eigenes Refactoring des Zustandsmoduls",
    date: "2026-08-13",
  },
  "src/dummy/ohne-grund.js": { date: "2026-08-13" },
  "src/dummy/ohne-datum.js": { reason: "steht noch aus" },
  "src/dummy/leere-felder.js": { reason: "   ", date: "   " },
  "src/dummy/krummes-datum.js": { reason: "steht noch aus", date: "bald" },
  "src/dummy/geraeumt.js": {
    reason: "war Altlast, ist inzwischen geraeumt",
    date: "2026-08-13",
  },
};

// Prueft die Auswahl gegen die Altlast-Attrappe und liefert nur die Pfade der
// Treffer - die Regel-Anzahlen decken die Bestandsfaelle oben bereits ab.
function offendingFiles(stagedFiles) {
  const offenders = findSuppressedStagedFiles({
    stagedFiles,
    suppressions: LEGACY_SUPPRESSIONS,
    legacyExceptions: LEGACY_EXCEPTIONS,
  });
  return offenders.map((offender) => offender.file);
}

describe("Altlast-Liste im Aufraeum-Gate (Attrappe)", () => {
  it("entschuldigt eine gelistete Datei, meldet die ungelistete weiterhin", () => {
    assert.deepEqual(
      offendingFiles(["src/dummy/altlast.js", "src/dummy/nicht-gelistet.js"]),
      ["src/dummy/nicht-gelistet.js"],
    );
  });

  it("entschuldigt nicht, wenn dem Eintrag der Grund fehlt", () => {
    assert.deepEqual(
      offendingFiles(["src/dummy/altlast.js", "src/dummy/ohne-grund.js"]),
      ["src/dummy/ohne-grund.js"],
    );
  });

  it("entschuldigt nicht, wenn dem Eintrag das Datum fehlt", () => {
    assert.deepEqual(
      offendingFiles(["src/dummy/altlast.js", "src/dummy/ohne-datum.js"]),
      ["src/dummy/ohne-datum.js"],
    );
  });

  it("entschuldigt nicht, wenn Grund und Datum nur aus Leerzeichen bestehen", () => {
    assert.deepEqual(
      offendingFiles(["src/dummy/altlast.js", "src/dummy/leere-felder.js"]),
      ["src/dummy/leere-felder.js"],
    );
  });

  it("entschuldigt nicht, wenn das Datum kein Kalenderdatum ist", () => {
    assert.deepEqual(
      offendingFiles(["src/dummy/altlast.js", "src/dummy/krummes-datum.js"]),
      ["src/dummy/krummes-datum.js"],
    );
  });

  it("laesst eine gelistete, inzwischen geraeumte Datei unauffaellig", () => {
    assert.deepEqual(
      offendingFiles([
        "src/dummy/geraeumt.js",
        "src/dummy/altlast.js",
        "src/dummy/nicht-gelistet.js",
      ]),
      ["src/dummy/nicht-gelistet.js"],
    );
  });
});

// Das Einlesen der Liste. Die Lesefunktion ist injizierbar, deshalb braucht
// dieser Pfad kein Dateisystem. Geprueft wird beides: der Erfolgsfall UND dass
// eine fehlende oder kaputte Liste abbricht statt still ohne Liste
// weiterzulaufen. Der stille Weiterlauf waere der gefaehrliche Ausgang: eine
// leere Liste entschuldigt niemanden, das Gate saehe aus wie funktionierend
// und wuerde jede gelistete Datei trotzdem ablehnen - Anlass genug, wieder zum
// verbotenen "--no-verify" zu greifen.
describe("loadLegacyExceptions (injizierter Leser)", () => {
  it("liest eine gueltige Liste ueber die injizierte Lesefunktion ein", () => {
    const angefragtePfade = [];
    const geladen = loadLegacyExceptions((relativePath) => {
      angefragtePfade.push(relativePath);
      return JSON.stringify(LEGACY_EXCEPTIONS);
    });
    assert.deepEqual(geladen, LEGACY_EXCEPTIONS);
    assert.deepEqual(angefragtePfade, [LEGACY_EXCEPTIONS_REL]);
  });

  it("bricht ab, wenn die Liste fehlt oder unlesbar ist", () => {
    assert.throws(
      () =>
        loadLegacyExceptions(() => {
          throw new Error("ENOENT: no such file or directory");
        }),
      /ENOENT/,
    );
  });

  it("bricht ab, wenn die Liste syntaktisch kaputt ist", () => {
    assert.throws(
      () => loadLegacyExceptions(() => '{ "src/dummy/altlast.js": '),
      SyntaxError,
    );
  });
});

// Der Bericht, den ein Blockierter zu sehen bekommt. Wer abgelehnt wird, liest
// diesen Text - nicht den Quelltext des Skripts. Steht der Ausweg nur im
// Kopfkommentar, greift der Blockierte zum naechstliegenden Mittel, und das ist
// "git commit --no-verify". Genau so ist am 2026-08-13 ein Commit still an der
// Ratsche vorbeigelaufen. Geprueft wird darum am Berichtstext eines echten
// CLI-Laufs, nicht an einer Innerei der Ausgabe-Funktion.
//
// Die abgelehnte Datei wird aus dem Bestand gewaehlt statt fest verdrahtet: ein
// einzelner Bestandspfad verschwindet mit dem naechsten Aufraeumen, die Frage
// "gibt es ueberhaupt eine abgelehnte Datei" ist die Positiv-Kontrolle.
function firstRejectedFile() {
  const suppressions = JSON.parse(readRepoFile(SUPPRESSIONS_REL));
  const legacyExceptions = JSON.parse(readRepoFile(LEGACY_EXCEPTIONS_REL));
  return Object.keys(suppressions).find(
    (file) =>
      !legacyExceptions[file] && Object.keys(suppressions[file]).length > 0,
  );
}

describe("Ablehnungs-Bericht des Aufraeum-Gates", () => {
  it("nennt die Altlast-Liste als Ausweg", () => {
    const rejectedFile = firstRejectedFile();
    assert.ok(
      rejectedFile,
      `Positiv-Kontrolle fehlgeschlagen: keine Datei in ${SUPPRESSIONS_REL}, die das Gate ablehnen wuerde`,
    );
    const run = spawnSync(process.execPath, [SCRIPT_PATH, rejectedFile], {
      encoding: "utf8",
    });
    const report = `${run.stdout}${run.stderr}`;
    assert.equal(run.status, 1, `Gate hat nicht abgelehnt: ${report}`);
    assert.ok(
      report.includes(rejectedFile),
      `Bericht nennt die abgelehnte Datei nicht: ${report}`,
    );
    assert.ok(
      report.includes(LEGACY_EXCEPTIONS_REL),
      `Bericht nennt den Ausweg (${LEGACY_EXCEPTIONS_REL}) nicht: ${report}`,
    );
  });
});
