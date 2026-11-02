import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { alleEintraege, erwartung } from "./mutationspruefung-nachrunde-hilfen.js";
import { folgerundeAlteSeite, vorlaufAlteSeite, zahlGemessen } from "./mutationspruefung-uebernahme-hilfen.js";

const UEBERNOMMEN = /(\d+) Mutanten aus Lauf 4711 übernommen, \d+ neu geprüft/;
const SCHATTEN = /Mutanten aus Lauf 4711 wären übernommen worden \(Schatten\)/;
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

function uebernommen(ausgabe) {
  const treffer = ausgabe.match(UEBERNOMMEN);
  assert.ok(treffer, ausgabe);
  return Number(treffer[1]);
}

test("eine Folgerunde mit einer neuen Quelldatei, die kein tötender Test lädt, übernimmt die Mutanten der alten Seite", FRIST, () => {
  const { ausgabe, teil } = folgerundeAlteSeite(vorlauf, aufraeumer, { dateien: { "src/dritte.js": "export const DRITTE = 3;\n" } });
  assert.ok(erwartetUebernehmbar() > 0, "der Vorlauf hat bestätigt getötete Mutanten");
  assert.equal(uebernommen(ausgabe), erwartetUebernehmbar());
  assert.doesNotMatch(ausgabe, SCHATTEN);
  assert.equal(teil.schatten, undefined);
});

test("eine Folgerunde mit geändertem Werkzeug im Kopf übernimmt auf der alten Seite nichts", FRIST, () => {
  const { ausgabe, teil } = folgerundeAlteSeite(vorlauf, aufraeumer, { dateien: { "package.json": '{ "type": "module", "private": true }\n' } });
  assert.ok(zahlGemessen(teil) > 0, "die Folgerunde hat frisch gemessen");
  assert.doesNotMatch(ausgabe, UEBERNOMMEN);
});

test("eine Folgerunde mit anderem Ausgangspunkt übernimmt auf der alten Seite, wenn Quelle und tötende Tests dort gleich sind", FRIST, () => {
  const { ausgabe } = folgerundeAlteSeite(vorlauf, aufraeumer, { dateien: { "src/dritte.js": "export const DRITTE = 3;\n" }, basis: vorlauf.ursprung });
  assert.equal(uebernommen(ausgabe), erwartetUebernehmbar());
});
