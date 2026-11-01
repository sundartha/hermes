import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { NEGATIV, NULL, VERDOPPELN, VERDOPPELNTEST, abgewandelt, alleEintraege, bestaetigtGetoetet, ersteLaeufe, erwartung, nachrunde, quelle } from "./mutationspruefung-nachrunde-hilfen.js";
import { holeImPullRequest, schattenUebernehmbar, teilberichte, vorlaufJeDatei } from "./mutationspruefung-uebernahme-hilfen.js";
import { REPO_ROOT, runIn } from "./probe-repo.js";

const VERGLEICH = join(REPO_ROOT, "tools/mutationspruefung/schatten-vergleich.mjs");
const UEBERNOMMEN = /^src\/zahl\.js: (\d+) Mutanten aus Lauf 4711 übernommen, (\d+) neu geprüft$/m;
const FRIST = { timeout: 600_000 };
const zustand = vorlaufJeDatei(FRIST);

function eintraege() {
  return alleEintraege(zustand.vorlauf.ordner);
}

function folgerunde(optionen) {
  const { repo, ziel, geholt } = holeImPullRequest(zustand.vorlauf, zustand.aufraeumer, optionen);
  return { geholt, lauf: nachrunde(repo, zustand.vorlauf.basis, { vorergebnis: ziel, aufraeumer: zustand.aufraeumer }) };
}

function schluesselDerGetoeteten() {
  return new Set(eintraege().filter(bestaetigtGetoetet).map(({ schluessel }) => schluessel));
}

test("im Schattenmodus prüft der Pull Request alle Mutanten frisch und meldet die übernehmbaren, die der frische Lauf bestätigt", FRIST, () => {
  const { geholt, lauf } = folgerunde({ dateien: {} });
  const erwartet = erwartung(eintraege(), []);
  assert.match(geholt.stdout, /Vorergebnis aus Lauf 4711, .* Schattenmodus: nichts wird übernommen\./);
  assert.ok(erwartet.uebernommen > 0 && erwartet.uebernommen < eintraege().length, `übernehmbar ${erwartet.uebernommen}`);
  assert.doesNotMatch(lauf.ausgaben, UEBERNOMMEN);
  assert.equal(ersteLaeufe(lauf.ausgaben), eintraege().length);
  const gemeldet = schattenUebernehmbar(lauf.ordner);
  assert.equal(gemeldet.length, erwartet.uebernommen);
  assert.ok(gemeldet.every(({ schluessel }) => schluesselDerGetoeteten().has(schluessel)));
  const vergleich = runIn(REPO_ROOT, process.execPath, [VERGLEICH, lauf.ordner]);
  assert.equal(vergleich.status, 0, vergleich.stdout + vergleich.stderr);
  assert.equal(lauf.urteil.status, 0, lauf.urteil.stdout + lauf.urteil.stderr);
});

test("im Schattenmodus meldet der Pull Request keinen überlebenden Mutanten als übernehmbar", FRIST, () => {
  const { lauf } = folgerunde({ dateien: {} });
  const ueberlebende = new Set(eintraege().filter((eintrag) => eintrag.status !== "Killed").map(({ schluessel }) => schluessel));
  assert.ok(ueberlebende.size > 0, "der Vorlauf hat Mutanten, die nicht getötet wurden");
  assert.ok(schattenUebernehmbar(lauf.ordner).every(({ schluessel }) => !ueberlebende.has(schluessel)));
});

test("im Schattenmodus meldet der Pull Request die Mutanten nicht, deren Töter eine geänderte Testdatei erreicht", FRIST, () => {
  const { lauf } = folgerunde({ dateien: { "test/verdoppeln.test.js": `${VERDOPPELNTEST}// geändert\n` } });
  const ohneAenderung = erwartung(eintraege(), []).uebernommen;
  const erwartet = erwartung(eintraege(), ["test/verdoppeln.test.js"]).uebernommen;
  assert.ok(erwartet < ohneAenderung, `erwartet ${erwartet}, ohne Änderung ${ohneAenderung}`);
  assert.equal(schattenUebernehmbar(lauf.ordner).length, erwartet);
});

test("im Schattenmodus meldet der Pull Request nichts, wenn die Quelle geändert wurde", FRIST, () => {
  const { lauf } = folgerunde({ dateien: { "src/zahl.js": quelle(NEGATIV, NULL, '  if (zahl === 10) return "zehn";') + VERDOPPELN } });
  assert.deepEqual(schattenUebernehmbar(lauf.ordner), []);
  assert.ok(teilberichte(lauf.ordner).every((teil) => teil.schatten !== undefined));
});

test("im Schattenmodus meldet der Pull Request nichts, wenn der Workflow geändert wurde", FRIST, () => {
  const { lauf } = folgerunde({ dateien: { ".github/workflows/ci.yml": "name: CI\n" } });
  assert.deepEqual(schattenUebernehmbar(lauf.ordner), []);
  assert.ok(ersteLaeufe(lauf.ausgaben) > 0);
});

test("im Schattenmodus meldet der Pull Request nichts bei einer anderen Node-Version des Vorlaufs", FRIST, () => {
  const andere = abgewandelt(zustand.vorlauf, zustand.aufraeumer, (teile) => teile.map((teil) => ({ ...teil, umgebung: "v1.0.0" })));
  const { repo, ziel } = holeImPullRequest(andere, zustand.aufraeumer, {});
  const lauf = nachrunde(repo, zustand.vorlauf.basis, { vorergebnis: ziel, aufraeumer: zustand.aufraeumer });
  assert.match(lauf.ausgaben, /andere Node-Version \(v1\.0\.0\)/);
  assert.deepEqual(schattenUebernehmbar(lauf.ordner), []);
});

test("mit dem Schalter an übernimmt der Pull Request die bestätigt getöteten Mutanten und prüft nur die übrigen neu", FRIST, () => {
  const { lauf } = folgerunde({ dateien: {}, umgebung: { MUTATION_UEBERNAHME_PR: "an" } });
  const erwartet = erwartung(eintraege(), []);
  const [, uebernommen, geprueft] = lauf.ausgaben.match(UEBERNOMMEN);
  assert.deepEqual([Number(uebernommen), Number(geprueft)], [erwartet.uebernommen, erwartet.geprueft]);
  assert.equal(ersteLaeufe(lauf.ausgaben), erwartet.geprueft);
  assert.deepEqual(schattenUebernehmbar(lauf.ordner), []);
  assert.equal(lauf.urteil.status, 0, lauf.urteil.stdout + lauf.urteil.stderr);
});
