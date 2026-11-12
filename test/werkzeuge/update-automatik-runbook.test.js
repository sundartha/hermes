import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { NACHKONTROLLE_TITEL } from "../../tools/deploy-weg/hoertest.mjs";
import { NODE_LABEL, PAUSE_LABEL, updateArtBestimmen } from "../../tools/mutation-laeufe.mjs";

const lesen = (pfad) => readFileSync(new URL(`../../${pfad}`, import.meta.url), "utf8");
const npm = (name, alt, neu) => ({ name, alt, neu });
const action = (name, alt, neu) => ({ name, alt, neu, oekosystem: "actions" });

const MERGE = "test/sicherheit/update-merge-regel.test.js";
const WARTEZEITEN = "test/sicherheit/abhaengigkeits-updates-wartezeiten.test.js";
const ART = "test/werkzeuge/update-art.test.js";
const PRUEFER = "test/werkzeuge/pruefer-eingabe.test.js";
const MIGRATION = "test/sicherheit/update-pr-braucht-migrationspruefung.test.js";
const NODE = "test/werkzeuge/node-erkennung.test.js";
const NODE_WORKFLOW = "test/werkzeuge/node-erkennung-workflow.test.js";
const NACHKONTROLLE = "test/werkzeuge/deploy-nachkontrolle.test.js";
const NACHKONTROLLE_WORKFLOW = "test/werkzeuge/nachkontrolle-workflow.test.js";

const ZEILEN = [
  {
    zeile: "Patch",
    arten: [
      ["patch", { pakete: [npm("a", "1.2.3", "1.2.4")] }],
      ["actions", { pakete: [action("actions/checkout", "v4.1.0", "v4.2.0")] }],
    ],
    belege: [
      [WARTEZEITEN, "wartet wirksam"],
      [MERGE, "ein npm-Patch unter sieben Tagen wartet, ab sieben Tagen geht er durch"],
      [PRUEFER, "Minor ohne Changelog steht in fehlend, Patch ohne Changelog nicht"],
    ],
  },
  {
    zeile: "Minor",
    arten: [["minor", { pakete: [npm("a", "1.2.3", "1.3.0")] }]],
    belege: [
      [MERGE, "ein npm-Minor unter sieben Tagen wartet"],
      [PRUEFER, "Minor ohne Changelog steht in fehlend, Patch ohne Changelog nicht"],
    ],
  },
  {
    zeile: "Major",
    arten: [
      ["major", { pakete: [npm("typescript", "6.0.3", "7.0.0"), npm("eslint", "9.1.0", "9.1.2")] }],
      ["major", { pakete: [action("actions/checkout", "v4", "v5")] }],
    ],
    belege: [
      [WARTEZEITEN, "Major nie in einer Gruppe"],
      [MERGE, "ein Major unter vierzehn Tagen wartet, auch mit PASS"],
      [MERGE, "ein Major ohne PASS wird nicht gemergt"],
      [MIGRATION, "ein Major ohne Migrationsprüfung im Approve wird in der Merge-Queue gestoppt"],
      [MIGRATION, "Sammel-PR wie 3352 nennt nur die Major-Pakete, jedes einmal"],
    ],
  },
  {
    zeile: "Node-Hauptversion",
    arten: [["node-hauptversion", { node: [{ alt: "22.1.0", neu: "26.0.0" }] }]],
    belege: [
      [MERGE, "eine Node-Hauptversion ohne Antonios Ja wird nicht gemergt, auch mit PASS"],
      [MERGE, "Node vor Active LTS plus vierzehn Tagen wird nicht gemergt"],
      [NODE, "Am 14. Tag nach Beginn der Active LTS öffnet der Lauf einen PR mit dem Label node-hauptversion"],
      [NODE_WORKFLOW, "startet wöchentlich und von Hand"],
    ],
  },
  {
    zeile: "Sicherheitsupdate",
    arten: [["sicherheit", { sicherheit: true, pakete: [npm("a", "1.0.0", "1.0.1")] }]],
    belege: [
      [MERGE, "ein bestätigter Sicherheitsfix eines npm-Pakets wartet nicht"],
      [MERGE, "ein Security im PR-Titel umgeht die Wartezeit nicht"],
      [MERGE, "auch ein Sicherheitsfix braucht bei einem Major die Migrationsprüfung"],
    ],
  },
  {
    zeile: "Immer gleich",
    arten: [],
    belege: [
      [MERGE, "ein zweites Update wartet hinter einem Update in der Merge-Queue"],
      [MERGE, "kein Update-Merge, solange ein offener PR dieselbe package.json ändert"],
    ],
  },
  {
    zeile: "Nachkontrolle und Revert-PR",
    arten: [],
    belege: [
      [NACHKONTROLLE, "falscher Commit bis Fristende: genau ein Revert-PR mit dem Update-Token und ein Issue"],
      [NACHKONTROLLE, "zweiter Lauf zum selben Commit: kein zweiter PR, das Issue wird ersetzt"],
      [NACHKONTROLLE, "Token fehlt: rot, kein PR, Issue mit Hinweis auf den Handweg"],
      [NACHKONTROLLE_WORKFLOW, "der Job nachkontrolle wartet auf Entscheiden und Deploy"],
    ],
  },
  {
    zeile: "Not-Aus",
    arten: [],
    belege: [
      [MERGE, "Not-Aus: mit gesetztem Label updates-pausiert wird ein sonst grünes Update nicht gemergt"],
      [NODE, "Not-Aus: mit gesetztem Label updates-pausiert öffnet die Node-Erkennung keinen PR und ändert nichts"],
    ],
  },
  {
    zeile: "Sperrliste",
    arten: [],
    belege: [
      [WARTEZEITEN, "Sperrliste: ein Eintrag ohne Grund wird rot"],
      [WARTEZEITEN, "Sperrliste: ein abgelaufenes Datum wird rot"],
    ],
  },
];

for (const { zeile, arten, belege } of ZEILEN) {
  test(`Gesamtprobe, Zeile ${zeile}: jede Art wird erkannt und jeder belegende Test existiert`, () => {
    for (const [erwartet, eingabe] of arten) {
      assert.equal(updateArtBestimmen(eingabe), erwartet);
    }
    assert.ok(belege.length > 0);
    for (const [datei, name] of belege) {
      assert.ok(lesen(datei).includes(name), `${datei}: Test "${name}" fehlt`);
    }
  });
}

const RUNBOOK = lesen("docs/RUNBOOK-LAB-LIVE.md");
const ABSCHNITT = /^## Abhaengigkeits-Updates[^\n]*\n([\s\S]*?)(?=^## )/m.exec(RUNBOOK)?.[1] ?? "";

test("Runbook: Abschnitt Abhaengigkeits-Updates steht zwischen Ablauf und Leitplanken", () => {
  assert.ok(ABSCHNITT.length > 0, "Abschnitt fehlt");
  assert.ok(RUNBOOK.indexOf("## Ablauf") < RUNBOOK.indexOf("## Abhaengigkeits-Updates"));
  assert.ok(RUNBOOK.indexOf("## Abhaengigkeits-Updates") < RUNBOOK.indexOf("## Leitplanken"));
});

test("Runbook: jede Art der Regeltabelle steht im Abschnitt", () => {
  for (const art of ["patch", "minor", "major", "node-hauptversion", "sicherheit", "actions"]) {
    assert.ok(ABSCHNITT.includes(`\`${art}\``), `Art ${art} fehlt`);
  }
});

test("Runbook: Not-Aus, Meldung, Token und Sperrliste sind beschrieben", () => {
  for (const stichwort of [PAUSE_LABEL, NODE_LABEL, "UPDATE_WORKFLOW_TOKEN", NACHKONTROLLE_TITEL, "revert/", "ignore", "zurueckrollen", "gh workflow disable"]) {
    assert.ok(ABSCHNITT.includes(stichwort), `${stichwort} fehlt`);
  }
});

test("Runbook: Werte stehen per Verweis auf ihre Quelle, nicht abgeschrieben", () => {
  for (const quelle of [".github/dependabot.yml", "tools/freigabe.mjs", "tools/deploy-weg/takt.mjs", "tools/mutation-laeufe.mjs"]) {
    assert.ok(ABSCHNITT.includes(quelle), `Verweis ${quelle} fehlt`);
  }
  assert.doesNotMatch(ABSCHNITT, /\d+\s*(Tage|Minuten)/);
});

test("Runbook: die genannten Quellen existieren", () => {
  for (const quelle of [".github/dependabot.yml", "tools/freigabe.mjs", "tools/deploy-weg/takt.mjs", "tools/mutation-laeufe.mjs"]) {
    assert.ok(lesen(quelle).length > 0);
  }
});
