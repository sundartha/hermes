import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { alleEintraege, erwartung } from "./mutationspruefung-nachrunde-hilfen.js";
import { folgerundeAlteSeite, vorlaufAlteSeite, zahlGemessen } from "./mutationspruefung-uebernahme-hilfen.js";
import { REPO_ROOT, runIn } from "./probe-repo.js";

const VERGLEICH = join(REPO_ROOT, "tools/mutationspruefung/schatten-vergleich.mjs");
const KEIN_VORERGEBNIS_PASST = /Vorergebnis passt nicht zum Stand \(Dateien außerhalb von test\/ geändert\), voller Neulauf/;
const UEBERNOMMEN = /Mutanten aus Lauf 4711 übernommen, \d+ neu geprüft/;
const SCHATTEN = /(\d+) Mutanten aus Lauf 4711 wären übernommen worden \(Schatten\), alle frisch geprüft/;
const FRIST = { timeout: 600_000 };
const aufraeumer = [];
let vorlauf;

before(() => {
  vorlauf = vorlaufAlteSeite(aufraeumer);
}, FRIST);

after(() => {
  for (const aufgabe of aufraeumer) aufgabe();
});

function erwartetUebernehmbar() {
  return erwartung(alleEintraege(vorlauf.ordner), []).uebernommen;
}

function vergleich(ordner) {
  return runIn(REPO_ROOT, process.execPath, [VERGLEICH, ordner]);
}

test("eine Folgerunde mit geänderter Quelldatei außerhalb von test/ meldet die Mutanten der alten Seite als übernehmbar, übernimmt aber noch keinen", FRIST, () => {
  const { ausgabe, teil, ordner } = folgerundeAlteSeite(vorlauf, aufraeumer, { dateien: { "src/dritte.js": "export const DRITTE = 3;\n" } });
  assert.ok(erwartetUebernehmbar() > 0, "der Vorlauf hat bestätigt getötete Mutanten");
  assert.match(ausgabe, KEIN_VORERGEBNIS_PASST);
  assert.doesNotMatch(ausgabe, UEBERNOMMEN);
  assert.equal(teil.schatten.uebernehmbar.length, erwartetUebernehmbar());
  assert.match(ausgabe, SCHATTEN);
  const geprueft = vergleich(ordner);
  assert.equal(geprueft.status, 0, geprueft.stdout + geprueft.stderr);
  assert.match(geprueft.stdout, new RegExp(`Schattenvergleich: ${erwartetUebernehmbar()} übernehmbare Mutanten, 0 im frischen Lauf nicht bestätigt getötet`));
});

test("eine Folgerunde mit geändertem Werkzeug im Kopf meldet auf der alten Seite nichts als übernehmbar", FRIST, () => {
  const { ausgabe, teil } = folgerundeAlteSeite(vorlauf, aufraeumer, { dateien: { "package.json": '{ "type": "module", "private": true }\n' } });
  assert.ok(zahlGemessen(teil) > 0, "die Folgerunde hat frisch gemessen");
  assert.deepEqual(teil.schatten.uebernehmbar, []);
  assert.doesNotMatch(ausgabe, SCHATTEN);
});

test("eine Folgerunde mit anderem Stand der Quellen vor der Änderung meldet auf der alten Seite nichts als übernehmbar", FRIST, () => {
  const { ausgabe, teil } = folgerundeAlteSeite(vorlauf, aufraeumer, { dateien: { "src/dritte.js": "export const DRITTE = 3;\n" }, basis: vorlauf.ursprung });
  assert.ok(zahlGemessen(teil) > 0, "die Folgerunde hat frisch gemessen");
  assert.deepEqual(teil.schatten.uebernehmbar, []);
  assert.doesNotMatch(ausgabe, SCHATTEN);
});
