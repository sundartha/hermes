import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { fehlerNachRichtigemStand, funktion, MIT_SIEBEN, pruefung, ROTER_TEST } from "./auftrag-lauf-hilfen.js";
import { UMBAU, starte } from "./auftrag-lauf-probe.js";
import { commitAll, runIn, writeFiles } from "./probe-repo.js";

test("ein schon gebauter Auftrag wird übersprungen, ein neu geschnittener oder zurückgenommener nicht", (context) => {
  const gebaut = "Räume src auf\n\nWarum: gebaut.\n\nAuftrag: probe/A1\nArt: umbau";
  const zuruecknehmen = (repo) =>
    runIn(repo, "git", ["-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "revert", "--no-edit", "HEAD"]);
  const faelle = [
    { name: "gebaut", nachricht: gebaut, danach: () => {}, uebersprungen: true },
    { name: "neu geschnitten", nachricht: "Schneide den Auftrag A1 neu\n\nWarum: x.\n\nAuftrag: probe/A1", danach: () => {}, uebersprungen: false },
    { name: "andere Art", nachricht: gebaut.replace("Art: umbau", "Art: funktion"), danach: () => {}, uebersprungen: false },
    { name: "andere Phase", nachricht: gebaut.replace("probe/A1", "probe2/A1"), danach: () => {}, uebersprungen: false },
    { name: "nicht im letzten Absatz", nachricht: "x\n\nAuftrag: probe/A1\nArt: umbau\n\nWarum: y.", danach: () => {}, uebersprungen: false },
    { name: "zurückgenommen", nachricht: gebaut, danach: zuruecknehmen, uebersprungen: false },
  ];
  for (const { name, nachricht, danach, uebersprungen } of faelle) {
    const vorbereiten = (repo) => {
      writeFiles(repo, { "notiz.txt": name });
      commitAll(repo, nachricht);
      danach(repo);
    };
    const { werkzeug, lauf, basis, kopf } = starte(context, { auftrag: UMBAU, drehbuch: { bau: {} }, vorbereiten });
    assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), !uebersprungen, `${name}: ${lauf.stdout}${lauf.stderr}`);
    if (uebersprungen) {
      assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
      assert.equal(kopf, basis, name);
    }
  }
});

test("bei einer Fehlerbehebung bekommt der Bau-Agent den Commit, den git bisect als Ursprung findet", (context) => {
  const vorbereiten = fehlerNachRichtigemStand;
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": MIT_SIEBEN["src/rechnen.js"] } };
  const auftrag = { ...funktion("2 !== 4"), art: "fehlerbehebung" };
  const { repo, werkzeug, lauf, beleg } = starte(context, { auftrag, drehbuch, vorbereiten });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(pruefung(beleg, "bisect"), 0);
  assert.match(readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8"), /eingeführt hat[\s\S]+ Runde anders/);
  assert.match(runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout, /^Ursache: [\s\S]+^Eingeführt mit: \w+ Runde anders$/m);
});
