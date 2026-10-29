import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";

import {
  HILFE,
  NEGATIV,
  NULL,
  NULLTEST,
  VERDOPPELN,
  ZAHLTEST,
  alleEintraege,
  ersteLaeufe,
  erwartung,
  ghAttrappe,
  holeVorergebnis,
  nachrunde,
  nachrundeRepo,
  quelle,
  temporaer,
  vorlaufRepo,
  zusammenfassung,
} from "./mutationspruefung-nachrunde-hilfen.js";

const SCHWACHER_NULLTEST = NULLTEST.replace('assert.equal(einordnen(0), "null");', "assert.ok(einordnen(0));");
const KEIN_VORERGEBNIS = /^Mutationsprüfung: kein Vorergebnis \((.+)\), voller Neulauf\.$/m;
const AUS_VORLAUF = /^Mutationsprüfung: Vorergebnis aus Lauf 4711, .+$/m;
const UEBERNOMMEN = /^src\/zahl\.js: (\d+) Mutanten aus Lauf 4711 übernommen, (\d+) neu geprüft$/m;
const FRIST = { timeout: 600_000 };
const aufraeumer = [];
let vorlauf;

before(() => {
  vorlauf = vorlaufRepo(aufraeumer);
}, FRIST);

after(() => {
  for (const aufgabe of aufraeumer) aufgabe();
});

function zahlen() {
  return { alle: alleEintraege(vorlauf.ordner).length };
}

function pruefeAuswahl(lauf, betroffeneTests) {
  const erwartet = erwartung(alleEintraege(vorlauf.ordner), betroffeneTests);
  assert.equal(ersteLaeufe(lauf.ausgaben), erwartet.geprueft);
  if (erwartet.uebernommen === 0) assert.doesNotMatch(lauf.ausgaben, UEBERNOMMEN);
  else {
    const [, uebernommen, geprueft] = lauf.ausgaben.match(UEBERNOMMEN);
    assert.deepEqual([Number(uebernommen), Number(geprueft)], [erwartet.uebernommen, erwartet.geprueft]);
  }
  return erwartet;
}

function mitVorergebnis(dateien, optionen = {}) {
  const repo = nachrundeRepo(vorlauf, aufraeumer, { dateien, nachricht: optionen.nachricht, entfernen: optionen.entfernen });
  const attrappe = ghAttrappe(vorlauf, aufraeumer, optionen.gh);
  const ziel = join(temporaer(aufraeumer, "nachrunde-vorergebnis-"), "vorergebnis.json");
  const geholt = holeVorergebnis(repo, attrappe, { ziel, basis: vorlauf.basis, aenderungen: optionen.umgebung });
  assert.equal(geholt.status, 0, geholt.stdout + geholt.stderr);
  return { repo, ziel, geholt, lauf: nachrunde(repo, vorlauf.basis, { vorergebnis: ziel, aufraeumer }) };
}

test("Nachrunde mit nur einer neuen Testdatei übernimmt die getöteten Mutanten und prüft nur die übrigen neu", FRIST, () => {
  const { geholt, lauf } = mitVorergebnis({ "test/null.test.js": NULLTEST });
  assert.match(geholt.stdout, AUS_VORLAUF);
  const erwartet = pruefeAuswahl(lauf, []);
  assert.ok(erwartet.uebernommen > 0 && erwartet.uebernommen < zahlen().alle, `übernommen ${erwartet.uebernommen}`);
  assert.equal(lauf.urteil.status, 0, lauf.urteil.stdout + lauf.urteil.stderr);
});

test("Nachrunde, die die tötende Testdatei ändert, prüft deren Mutanten neu", FRIST, () => {
  const { lauf } = mitVorergebnis({ "test/null.test.js": NULLTEST, "test/zahl.test.js": `${ZAHLTEST}// geändert\n` });
  const erwartet = pruefeAuswahl(lauf, ["test/zahl.test.js"]);
  assert.ok(erwartet.geprueft > erwartet.uebernommen);
});

test("Nachrunde, die eine von der tötenden Testdatei geladene Testhilfe ändert, prüft deren Mutanten neu", FRIST, () => {
  const { lauf } = mitVorergebnis({ "test/null.test.js": NULLTEST, "test/hilfe.js": `${HILFE}// geändert\n` });
  const erwartet = pruefeAuswahl(lauf, ["test/zahl.test.js"]);
  assert.ok(erwartet.geprueft > erwartet.uebernommen);
});

test("Nachrunde mit geänderter Konfiguration prüft alle Mutanten neu", FRIST, () => {
  const { alle } = zahlen();
  const { geholt, lauf } = mitVorergebnis({ "test/null.test.js": NULLTEST, "package.json": '{ "type": "module", "private": true }\n' });
  assert.match(geholt.stdout, AUS_VORLAUF);
  assert.doesNotMatch(lauf.ausgaben, UEBERNOMMEN);
  assert.match(lauf.ausgaben, /^Mutationsprüfung: Vorergebnis passt nicht zum Stand \(.+\), voller Neulauf\.$/m);
  assert.equal(ersteLaeufe(lauf.ausgaben), alle);
});

test("Nachrunde mit geändertem Produktcode prüft alle Mutanten neu", FRIST, () => {
  const { lauf } = mitVorergebnis({ "test/null.test.js": NULLTEST, "src/zahl.js": quelle(NEGATIV, NULL, "  if (zahl === 10) return \"zehn\";") + VERDOPPELN });
  assert.doesNotMatch(lauf.ausgaben, UEBERNOMMEN);
  assert.match(lauf.ausgaben, /^Mutationsprüfung: Vorergebnis passt nicht zum Stand \(.+\), voller Neulauf\.$/m);
});

test("Urteil aus Teilmenge und Übernahme gleicht dem Urteil eines vollen Neulaufs", FRIST, () => {
  const dateien = { "test/null.test.js": SCHWACHER_NULLTEST };
  const { lauf } = mitVorergebnis(dateien);
  const voll = nachrunde(nachrundeRepo(vorlauf, aufraeumer, { dateien }), vorlauf.basis, { aufraeumer });
  assert.match(lauf.ausgaben, UEBERNOMMEN);
  assert.doesNotMatch(voll.ausgaben, UEBERNOMMEN);
  assert.ok(ersteLaeufe(lauf.ausgaben) < ersteLaeufe(voll.ausgaben));
  assert.equal(voll.urteil.status, 1, voll.urteil.stdout);
  assert.equal(lauf.urteil.status, voll.urteil.status);
  assert.deepEqual(zusammenfassung(lauf.urteil.stdout), zusammenfassung(voll.urteil.stdout));
});

test("scheitert der Abruf bei GitHub, läuft die Nachrunde voll neu mit Logzeile statt abzubrechen", FRIST, () => {
  const { alle } = zahlen();
  const { geholt, lauf } = mitVorergebnis({ "test/null.test.js": NULLTEST }, { gh: { abruf: "fehlt" } });
  assert.match(geholt.stdout, KEIN_VORERGEBNIS);
  assert.match(geholt.stdout.match(KEIN_VORERGEBNIS)[1], /503/);
  assert.equal(ersteLaeufe(lauf.ausgaben), alle);
  assert.equal(lauf.urteil.status, 0, lauf.urteil.stdout + lauf.urteil.stderr);
});

test("nennt der Commit keinen Vorlauf, läuft die Nachrunde voll neu mit Logzeile", FRIST, () => {
  const { alle } = zahlen();
  const { geholt, lauf } = mitVorergebnis({ "test/null.test.js": NULLTEST }, { nachricht: "Mutationsprüfung auf Abruf\n\nAuftrag: lauf/in-ci\n" });
  assert.match(geholt.stdout, KEIN_VORERGEBNIS);
  assert.equal(ersteLaeufe(lauf.ausgaben), alle);
});

test("stammt der genannte Lauf nicht von einem lauf-mutation-Zweig, läuft die Nachrunde voll neu", FRIST, () => {
  const { alle } = zahlen();
  const { geholt, lauf } = mitVorergebnis({ "test/null.test.js": NULLTEST }, { gh: { lauf: { head_branch: "feature/fremd" } } });
  assert.match(geholt.stdout, KEIN_VORERGEBNIS);
  assert.equal(ersteLaeufe(lauf.ausgaben), alle);
});

test("ist der genannte Lauf nicht abgeschlossen, läuft die Nachrunde voll neu", FRIST, () => {
  const { alle } = zahlen();
  const { geholt, lauf } = mitVorergebnis({ "test/null.test.js": NULLTEST }, { gh: { lauf: { status: "in_progress", conclusion: null } } });
  assert.match(geholt.stdout, KEIN_VORERGEBNIS);
  assert.equal(ersteLaeufe(lauf.ausgaben), alle);
});

test("gehört der genannte Lauf zu einem anderen Commit als die Teilergebnisse, läuft die Nachrunde voll neu", FRIST, () => {
  const { alle } = zahlen();
  const fremd = "0123456789abcdef0123456789abcdef01234567";
  const { geholt, lauf } = mitVorergebnis({ "test/null.test.js": NULLTEST }, { gh: { lauf: { head_sha: fremd } } });
  assert.match(geholt.stdout, KEIN_VORERGEBNIS);
  assert.equal(ersteLaeufe(lauf.ausgaben), alle);
});

test("ein im Commit liegendes Vorergebnis mit erfundenem Status wird nicht geglaubt: der Mutant wird neu geprüft", FRIST, () => {
  const erfunden = alleEintraege(vorlauf.ordner).map((eintrag) => ({ ...eintrag, status: "Killed", bestaetigung: "getoetet", toeter: ["test/zahl.test.js"] }));
  const dateien = { "test/null.test.js": SCHWACHER_NULLTEST, ".mutationspruefung/vorergebnis.json": JSON.stringify({ lauf: 4711, eintraege: erfunden }) };
  const { lauf } = mitVorergebnis(dateien);
  const voll = nachrunde(nachrundeRepo(vorlauf, aufraeumer, { dateien }), vorlauf.basis, { aufraeumer });
  pruefeAuswahl(lauf, []);
  assert.equal(lauf.urteil.status, 1, lauf.urteil.stdout);
  assert.deepEqual(zusammenfassung(lauf.urteil.stdout), zusammenfassung(voll.urteil.stdout));
});

test("Nachrunde mit gelöschter Testdatei prüft alle Mutanten neu", FRIST, () => {
  const { alle } = zahlen();
  const { lauf } = mitVorergebnis({ "test/null.test.js": NULLTEST }, { entfernen: ["test/weitere.test.js"] });
  assert.doesNotMatch(lauf.ausgaben, UEBERNOMMEN);
  assert.equal(ersteLaeufe(lauf.ausgaben), alle);
});

test("Nachrunde mit geänderter Datei unter test/, die kein Test erreicht, prüft alle Mutanten neu", FRIST, () => {
  const { alle } = zahlen();
  const { lauf } = mitVorergebnis({ "test/null.test.js": NULLTEST, "test/daten.json": '{ "neu": true }\n' });
  assert.doesNotMatch(lauf.ausgaben, UEBERNOMMEN);
  assert.equal(ersteLaeufe(lauf.ausgaben), alle);
});
