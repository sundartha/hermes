import assert from "node:assert/strict";
import { test } from "node:test";

import { NEGATIV, NULL, VERDOPPELN, VERDOPPELNTEST, ZAHLTEST, abgewandelt, alleEintraege, ersteLaeufe, erwartung, mitEintraegen, nachrunde, quelle, temporaer, zusammenfassung } from "./mutationspruefung-nachrunde-hilfen.js";
import { holeNachForcePush, prLauf, vorlaufJeDatei } from "./mutationspruefung-uebernahme-hilfen.js";
import { commitAll, runIn, writeFiles } from "./probe-repo.js";

const FRIST = { timeout: 600_000 };
const AUS_VORLAUF = /^Mutationsprüfung: Vorergebnis aus Lauf 4711, \d+ bestätigt getötete Mutanten\.$/m;
const KEINE_BELEGE = /^Mutationsprüfung: Vorergebnis aus Lauf 4711, 0 bestätigt getötete Mutanten\.$/m;
const UEBERNOMMEN = /^src\/zahl\.js: (\d+) Mutanten aus Lauf 4711 übernommen, (\d+) neu geprüft$/m;
const KEIN_VORERGEBNIS = /^Mutationsprüfung: kein Vorergebnis \((.+)\), voller Neulauf\.$/m;
const NICHT_NACHPRUEFBAR = /^Mutationsprüfung: kein Vorergebnis \(.*Kopf des Vorlaufs nicht nachprüfbar.*\), voller Neulauf\.$/m;
const FEHLENDER_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const ANDERER_STAND = [
  ["Werkzeug unter tools/", { "tools/abgewandelt.mjs": "export const ABGEWANDELT = true;\n" }],
  ["Workflow", { ".github/workflows/ci.yml": "name: CI\n" }],
  ["Daten unter test/", { "test/daten.json": '{ "neu": true }\n' }],
];
const DATEI_AUSSERHALB = "vorlagen/wert.json";
const zustand = vorlaufJeDatei(FRIST, { "test/verdoppeln.test.js": `${VERDOPPELNTEST}// liest ${DATEI_AUSSERHALB}\n`, [DATEI_AUSSERHALB]: '{ "wert": 1 }\n' });

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

test("ändert der Force-Push eine Datendatei außerhalb von src/ und test/, die die tötende Testdatei beim Namen nennt, prüft der Pull Request deren Mutanten neu", FRIST, () => {
  const { lauf } = gemessenNachForcePush({ [DATEI_AUSSERHALB]: '{ "wert": 2 }\n' });
  assert.doesNotMatch(lauf.ausgaben, UEBERNOMMEN);
  assert.equal(ersteLaeufe(lauf.ausgaben), eintraege().length);
});

test("ändert der Force-Push die Quelle, übernimmt der Pull Request keinen ihrer Mutanten", FRIST, () => {
  const { lauf } = gemessenNachForcePush({ "src/zahl.js": quelle(NEGATIV, NULL, '  if (zahl === 10) return "zehn";') + VERDOPPELN });
  assert.doesNotMatch(lauf.ausgaben, UEBERNOMMEN);
  assert.ok(ersteLaeufe(lauf.ausgaben) > eintraege().length);
});

test("hat der abgebrochene Vorlauf einen Mutanten nicht in allen Anteilen der Testdateien gemessen, wird er nicht übernommen", FRIST, () => {
  const halb = abgewandelt(zustand.vorlauf, zustand.aufraeumer, mitEintraegen((liste) => liste.map((eintrag) => ({ ...eintrag, messanteil: [1, 2] }))));
  const { geholt } = geholtNachForcePush({}, halb);
  assert.match(geholt.stdout, KEINE_BELEGE);
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
  assert.match(geholt.stdout, KEINE_BELEGE);
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
  assert.match(zweiVorlaeufe(ueberlebt).stdout, /^Mutationsprüfung: Vorergebnis aus Lauf 4999, 4712, 0 bestätigt getötete Mutanten\.$/m);
});

function gitOk(ordner, argumente) {
  const lauf = runIn(ordner, "git", argumente);
  assert.equal(lauf.status, 0, lauf.stderr);
  return lauf.stdout.trim();
}

function vorlaufAufKopf(kopf) {
  const vorlauf = abgewandelt(zustand.vorlauf, zustand.aufraeumer, (teile) => teile.map((teil) => ({ ...teil, kopf })));
  const lauf = { conclusion: "cancelled", head_sha: kopf };
  return geholtNachForcePush({}, vorlauf, { laeufe: [prLauf(vorlauf, lauf)], lauf }).geholt;
}

function kopfMitAnderemStand(dateien) {
  const arbeit = temporaer(zustand.aufraeumer, "uebernahme-anderer-kopf-");
  gitOk(zustand.vorlauf.repo, ["clone", "-q", zustand.vorlauf.repo, arbeit]);
  gitOk(arbeit, ["checkout", "-q", "-B", "anderer-stand", zustand.vorlauf.kopf]);
  writeFiles(arbeit, dateien);
  commitAll(arbeit, "Vorlauf mit anderem Stand");
  const kopf = gitOk(arbeit, ["rev-parse", "HEAD"]);
  gitOk(arbeit, ["push", "-q", "origin", `HEAD:refs/heads/anderer-stand-${kopf}`]);
  return kopf;
}

test("hat der Vorlauf auf einem Kopf mit anderem Werkzeug, Workflow oder anderen Daten gemessen, übernimmt der Pull Request nach einem Force-Push keinen Beleg, auch wenn die Belege den Stand dieses Laufs tragen", FRIST, () => {
  for (const [teil, dateien] of ANDERER_STAND) assert.match(vorlaufAufKopf(kopfMitAnderemStand(dateien)).stdout, KEINE_BELEGE, teil);
});

test("nennt der Vorlauf einen Kopf, den das Repository nicht kennt, übernimmt der Pull Request nach einem Force-Push nichts", FRIST, () => {
  assert.match(vorlaufAufKopf(FEHLENDER_COMMIT).stdout, NICHT_NACHPRUEFBAR);
});

test("von vier früheren beendeten Läufen holt der Pull Request Belege nur aus den drei jüngsten, den ältesten ruft er nicht ab", FRIST, () => {
  const leer = abgewandelt(zustand.vorlauf, zustand.aufraeumer, () => []).artefakte;
  const laeufe = [4710, 4711, 4712, 4713].map((id) => prLauf(zustand.vorlauf, { id, conclusion: "cancelled" }));
  const { stdout } = geholtNachForcePush({}, zustand.vorlauf, { laeufe, artefakteJeLauf: { 4711: leer, 4712: leer, 4713: leer } }).geholt;
  const treffer = stdout.match(KEIN_VORERGEBNIS);
  assert.ok(treffer, stdout);
  assert.deepEqual([...treffer[1].matchAll(/der Lauf (\d+)/g)].map(([, id]) => Number(id)), [4713, 4712, 4711]);
});
