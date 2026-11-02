import assert from "node:assert/strict";
import { test } from "node:test";

import { NEGATIV, NULL, VERDOPPELN, ZAHLTEST, abgewandelt, alleEintraege, ersteLaeufe, erwartung, mitEintraegen, nachrunde, quelle, zusammenfassung } from "./mutationspruefung-nachrunde-hilfen.js";
import { holeNachForcePush, prLauf, vorlaufJeDatei } from "./mutationspruefung-uebernahme-hilfen.js";

const FRIST = { timeout: 600_000 };
const AUS_VORLAUF = /^Mutationsprüfung: Vorergebnis aus Lauf 4711, \d+ bestätigt getötete Mutanten\.$/m;
const KEIN_VORERGEBNIS = /^Mutationsprüfung: kein Vorergebnis \((.+)\), voller Neulauf\.$/m;
const UEBERNOMMEN = /^src\/zahl\.js: (\d+) Mutanten aus Lauf 4711 übernommen, (\d+) neu geprüft$/m;
const zustand = vorlaufJeDatei(FRIST);

function eintraege() {
  return alleEintraege(zustand.vorlauf.ordner);
}

function geholtNachForcePush(dateien = {}, vorlauf = zustand.vorlauf, weitere = {}) {
  const lauf = { conclusion: "cancelled", head_sha: zustand.vorlauf.kopf };
  return holeNachForcePush(vorlauf, zustand.aufraeumer, { dateien, laeufe: [prLauf(vorlauf, lauf)], lauf, umgebung: { MUTATION_UEBERNAHME_PR: "an" }, ...weitere });
}

function gemessenNachForcePush(dateien, vorlauf) {
  const geholt = geholtNachForcePush(dateien, vorlauf);
  return { ...geholt, lauf: nachrunde(geholt.repo, geholt.basis, { vorergebnis: geholt.ziel, aufraeumer: zustand.aufraeumer }) };
}

function pruefeUebernahme(ausgaben, betroffeneTests) {
  const erwartet = erwartung(eintraege(), betroffeneTests);
  const treffer = ausgaben.match(UEBERNOMMEN);
  assert.ok(treffer, ausgaben);
  assert.deepEqual([Number(treffer[1]), Number(treffer[2])], [erwartet.uebernommen, erwartet.geprueft]);
  assert.equal(ersteLaeufe(ausgaben), erwartet.geprueft);
  return erwartet;
}

test("nach einem Force-Push auf einen neuen Hauptstand übernimmt der Pull Request die bestätigt getöteten Mutanten des abgebrochenen Vorlaufs und urteilt wie ein voller Neulauf", FRIST, () => {
  const { geholt, lauf, repo, basis } = gemessenNachForcePush();
  assert.match(geholt.stdout, AUS_VORLAUF);
  const erwartet = pruefeUebernahme(lauf.ausgaben, []);
  assert.ok(erwartet.uebernommen > 0, `übernommen ${erwartet.uebernommen}`);
  const voll = nachrunde(repo, basis, { aufraeumer: zustand.aufraeumer });
  assert.doesNotMatch(voll.ausgaben, UEBERNOMMEN);
  assert.equal(lauf.urteil.status, voll.urteil.status, lauf.urteil.stdout + lauf.urteil.stderr);
  assert.deepEqual(zusammenfassung(lauf.urteil.stdout), zusammenfassung(voll.urteil.stdout));
});

test("ändert der Force-Push die tötende Testdatei, prüft der Pull Request deren Mutanten neu", FRIST, () => {
  const { lauf } = gemessenNachForcePush({ "test/zahl.test.js": `${ZAHLTEST}// geändert\n` });
  const erwartet = pruefeUebernahme(lauf.ausgaben, ["test/zahl.test.js"]);
  assert.ok(erwartet.geprueft > 0);
});

test("ändert der Force-Push die Quelle, übernimmt der Pull Request keinen ihrer Mutanten", FRIST, () => {
  const { lauf } = gemessenNachForcePush({ "src/zahl.js": quelle(NEGATIV, NULL, '  if (zahl === 10) return "zehn";') + VERDOPPELN });
  assert.doesNotMatch(lauf.ausgaben, UEBERNOMMEN);
  assert.ok(ersteLaeufe(lauf.ausgaben) > eintraege().length);
});

test("hat der abgebrochene Vorlauf einen Mutanten nicht in allen Anteilen der Testdateien gemessen, wird er nicht übernommen", FRIST, () => {
  const halb = abgewandelt(zustand.vorlauf, zustand.aufraeumer, mitEintraegen((liste) => liste.map((eintrag) => ({ ...eintrag, messanteil: [1, 2] }))));
  const { geholt } = geholtNachForcePush({}, halb);
  const treffer = geholt.stdout.match(KEIN_VORERGEBNIS);
  assert.ok(treffer, geholt.stdout);
  assert.match(treffer[1], /kein bestätigt getöteter Mutant mit Stand/);
});

test("ein Beleg, dessen Stand nicht zum Stand der betroffenen Dateien passt, wird nicht übernommen", FRIST, () => {
  const fremd = abgewandelt(zustand.vorlauf, zustand.aufraeumer, mitEintraegen((liste) => liste.map((eintrag) => (eintrag.stand === undefined ? eintrag : { ...eintrag, stand: "0".repeat(64) }))));
  const { geholt, lauf } = gemessenNachForcePush({}, fremd);
  assert.match(geholt.stdout, AUS_VORLAUF);
  assert.doesNotMatch(lauf.ausgaben, UEBERNOMMEN);
  assert.equal(ersteLaeufe(lauf.ausgaben), eintraege().length);
});

test("Teilergebnisse ohne Stand je Mutant aus der Zeit vor dieser Regel werden nicht übernommen", FRIST, () => {
  const alt = abgewandelt(zustand.vorlauf, zustand.aufraeumer, mitEintraegen((liste) => liste.map((eintrag) => ({ ...eintrag, stand: undefined }))));
  const { geholt } = geholtNachForcePush({}, alt);
  assert.match(geholt.stdout, KEIN_VORERGEBNIS);
});

function zweiVorlaeufe(juengster) {
  const laeufe = [prLauf(zustand.vorlauf, { id: 4712 }), prLauf(zustand.vorlauf, { id: 4999, conclusion: "cancelled" })];
  return geholtNachForcePush({}, zustand.vorlauf, { laeufe, artefakteJeLauf: { 4999: juengster.artefakte } }).geholt;
}

test("ohne fertigen Teil im jüngsten abgebrochenen Vorlauf kommen die Belege aus dem älteren", FRIST, () => {
  const leer = abgewandelt(zustand.vorlauf, zustand.aufraeumer, () => []);
  assert.match(zweiVorlaeufe(leer).stdout, /^Mutationsprüfung: Vorergebnis aus Lauf 4712, \d+ bestätigt getötete Mutanten\.$/m);
});

test("hat ein jüngerer Vorlauf einen Mutanten vollständig gemessen und nicht bestätigt getötet, zählt der Beleg eines älteren nicht", FRIST, () => {
  const ueberlebt = abgewandelt(zustand.vorlauf, zustand.aufraeumer, mitEintraegen((liste) => liste.map((eintrag) => ({ ...eintrag, status: "Survived", bestaetigung: undefined, toeter: [] }))));
  const treffer = zweiVorlaeufe(ueberlebt).stdout.match(KEIN_VORERGEBNIS);
  assert.ok(treffer);
  assert.match(treffer[1], /kein bestätigt getöteter Mutant mit Stand/);
});
