import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import {
  TESTBANK,
  VERDOPPELNTEST,
  ZAHLTEST,
  abgewandelt,
  alleEintraege,
  bestaetigtGetoetet,
  ersteLaeufe,
  holeAus,
  mitEintraegen,
  nachrunde,
  temporaer,
  urteil,
  vorlaufRepo,
  werkzeugLauf,
} from "./mutationspruefung-nachrunde-hilfen.js";

const KEIN_VORERGEBNIS = /^Mutationsprüfung: kein Vorergebnis \((.+)\), voller Neulauf\.$/m;
const AUS_VORLAUF =
  /^Mutationsprüfung: Vorergebnis aus Lauf 4711, (\d+) bestätigt getötete Mutanten\.$/m;
const UEBERNOMMEN = /^src\/zahl\.js: (\d+) Mutanten aus Lauf 4711 übernommen, (\d+) neu geprüft$/m;
const FRIST = { timeout: 600_000 };
const FREMD = "0123456789abcdef0123456789abcdef01234567";
const aufraeumer = [];
let vorlauf;

before(() => {
  vorlauf = vorlaufRepo(aufraeumer);
}, FRIST);

after(() => {
  for (const aufgabe of aufraeumer) aufgabe();
});

function abgelehnt(optionen, grund) {
  const { geholt } = holeAus(optionen.vorlauf ?? vorlauf, aufraeumer, optionen);
  assert.equal(geholt.status, 0, geholt.stdout + geholt.stderr);
  const treffer = geholt.stdout.match(KEIN_VORERGEBNIS);
  assert.ok(treffer, geholt.stdout);
  assert.match(treffer[1], grund);
}

function angenommen(optionen) {
  const { geholt } = holeAus(optionen.vorlauf ?? vorlauf, aufraeumer, optionen);
  assert.equal(geholt.status, 0, geholt.stdout + geholt.stderr);
  const treffer = geholt.stdout.match(AUS_VORLAUF);
  assert.ok(treffer, geholt.stdout);
  return Number(treffer[1]);
}

function mitTeilen(umbau) {
  return { vorlauf: abgewandelt(vorlauf, aufraeumer, umbau) };
}

function ohneFeld(feld) {
  return (teile) => teile.map((teil) => ({ ...teil, [feld]: undefined }));
}

function zweiTeile(zweiter) {
  return mitTeilen(([erster]) => [
    { ...erster, teile: 2 },
    { ...erster, teil: 2, teile: 2, ...zweiter },
  ]);
}

function zahlBestaetigt() {
  return alleEintraege(vorlauf.ordner).filter(bestaetigtGetoetet).length;
}

test("ein mit success abgeschlossener Vorlauf wird angenommen", FRIST, () => {
  assert.equal(angenommen({ gh: { conclusion: "success" } }), zahlBestaetigt());
});

test("ein abgebrochener Vorlauf wird nicht angenommen", FRIST, () => {
  abgelehnt({ gh: { conclusion: "cancelled" } }, /nicht mit Urteil abgeschlossen/);
});

test("ein Vorlauf eines anderen Ereignisses als des Abrufs wird nicht angenommen", FRIST, () => {
  abgelehnt({ gh: { event: "push" } }, /gehört nicht zum Abruf des Workflows CI/);
});

test("ein Vorlauf eines anderen Workflows wird nicht angenommen", FRIST, () => {
  abgelehnt(
    { gh: { path: ".github/workflows/andere.yml" } },
    /gehört nicht zum Abruf des Workflows CI/,
  );
});

test("ein Vorlauf aus einem anderen Repository wird nicht angenommen", FRIST, () => {
  abgelehnt({ gh: { repository: { full_name: "fremd/repo" } } }, /nicht aus diesem Repository/);
});

test("ein Vorlauf aus dem Fork eines anderen Repositorys wird nicht angenommen", FRIST, () => {
  abgelehnt(
    { gh: { head_repository: { full_name: "fremd/fork" } } },
    /nicht aus diesem Repository/,
  );
});

test("ein Vorlauf, der keinen Commit nennt, wird nicht angenommen", FRIST, () => {
  abgelehnt({ gh: { head_sha: "kein-commit" } }, /keinen Commit/);
});

test("ein Vorlauf ohne Teilergebnisse wird nicht angenommen", FRIST, () => {
  abgelehnt(
    mitTeilen(() => []),
    /keine Teilergebnisse/,
  );
});

test("Teilergebnisse im älteren Format ohne Node-Version werden nicht angenommen", FRIST, () => {
  abgelehnt(mitTeilen(ohneFeld("umgebung")), /älteren Format/);
});

test("Teilergebnisse ohne Zahl der Teile werden nicht angenommen", FRIST, () => {
  abgelehnt(mitTeilen(ohneFeld("teile")), /älteren Format/);
});

test("Teilergebnisse ohne Liste der Prüfungen werden nicht angenommen", FRIST, () => {
  abgelehnt(mitTeilen(ohneFeld("pruefungen")), /älteren Format/);
});

test("Teilergebnisse mit einer Prüfung unbekannter Seite werden nicht angenommen", FRIST, () => {
  abgelehnt(
    mitTeilen((teile) =>
      teile.map((teil) => ({
        ...teil,
        pruefungen: teil.pruefungen.map((pruefung) => ({ ...pruefung, seite: "beliebig" })),
      })),
    ),
    /unbrauchbare Prüfungen/,
  );
});

test(
  "Teilergebnisse mit einer Prüfung ohne Commit als Ausgangspunkt werden nicht angenommen",
  FRIST,
  () => {
    abgelehnt(
      mitTeilen((teile) =>
        teile.map((teil) => ({
          ...teil,
          pruefungen: teil.pruefungen.map((pruefung) => ({ ...pruefung, von: "HEAD" })),
        })),
      ),
      /unbrauchbare Prüfungen/,
    );
  },
);

test(
  "Teilergebnisse mit einer Prüfung, deren Ende kein Commit ist, werden nicht angenommen",
  FRIST,
  () => {
    abgelehnt(
      mitTeilen((teile) =>
        teile.map((teil) => ({
          ...teil,
          pruefungen: teil.pruefungen.map((pruefung) => ({ ...pruefung, bis: "HEAD" })),
        })),
      ),
      /unbrauchbare Prüfungen/,
    );
  },
);

test("Teilergebnisse mit verschiedener Prüfsumme gehören nicht zu einem Plan", FRIST, () => {
  abgelehnt(zweiTeile({ pruefsumme: "anders" }), /nicht zu einem Plan und Commit gehören/);
});

test("Teilergebnisse mit verschiedenem Kopf gehören nicht zu einem Commit", FRIST, () => {
  abgelehnt(zweiTeile({ kopf: FREMD }), /nicht zu einem Plan und Commit gehören/);
});

test("Teilergebnisse mit verschiedener Zahl der Teile gehören nicht zu einem Plan", FRIST, () => {
  abgelehnt(zweiTeile({ teile: 3 }), /nicht zu einem Plan und Commit gehören/);
});

test("Teilergebnisse mit verschiedener Node-Version gehören nicht zu einem Lauf", FRIST, () => {
  abgelehnt(zweiTeile({ umgebung: "v1.0.0" }), /nicht zu einem Plan und Commit gehören/);
});

test("Teilergebnisse mit verschiedenen Prüfungen gehören nicht zu einem Plan", FRIST, () => {
  abgelehnt(
    zweiTeile({ pruefungen: [{ seite: "neu", von: FREMD, bis: null }] }),
    /nicht zu einem Plan und Commit gehören/,
  );
});

test("zwei Teilergebnisse mit derselben Nummer sind nicht vollständig", FRIST, () => {
  abgelehnt(zweiTeile({ teil: 1 }), /nicht alle Teilergebnisse/);
});

test("ein Teilergebnis von zwei geplanten Teilen ist nicht vollständig", FRIST, () => {
  abgelehnt(
    mitTeilen(([erster]) => [{ ...erster, teile: 2 }]),
    /nicht alle Teilergebnisse/,
  );
});

test("ein einziges Teilergebnis mit der Nummer 2 ist nicht vollständig", FRIST, () => {
  abgelehnt(
    mitTeilen(([erster]) => [{ ...erster, teil: 2 }]),
    /nicht alle Teilergebnisse/,
  );
});

test("ein Vorlauf mit derselben Nummer wie der laufende wird nicht angenommen", FRIST, () => {
  abgelehnt({ umgebung: { GITHUB_RUN_ID: "4711" } }, /nicht älter als dieser/);
});

test("ein Vorlauf mit höherer Nummer als der laufende wird nicht angenommen", FRIST, () => {
  abgelehnt({ umgebung: { GITHUB_RUN_ID: "4000" } }, /nicht älter als dieser/);
});

test("außerhalb eines Abrufs der Mutationsprüfung wird kein Vorlauf geholt", FRIST, () => {
  abgelehnt({ umgebung: { GITHUB_EVENT_NAME: "pull_request" } }, /kein Abruf der Mutationsprüfung/);
});

test("auf einem anderen Zweig als lauf-mutation wird kein Vorlauf geholt", FRIST, () => {
  abgelehnt({ umgebung: { GITHUB_REF_NAME: "main" } }, /kein Abruf der Mutationsprüfung/);
});

test(
  "ein Commit ohne Auftragszeile des Abrufs, aber mit Vorlauf, wird nicht geglaubt",
  FRIST,
  () => {
    abgelehnt({ nachricht: "Mutationsprüfung auf Abruf\n\nVorlauf: 4711\n" }, /keinen Vorlauf/);
  },
);

test("ein Commit mit der Vorlaufnummer 0 nennt keinen Vorlauf", FRIST, () => {
  abgelehnt(
    { nachricht: "Mutationsprüfung auf Abruf\n\nAuftrag: lauf/in-ci\nVorlauf: 0\n" },
    /keinen Vorlauf/,
  );
});

test("die Zahl bestätigt getöteter Mutanten ignoriert Einträge ohne Lage", FRIST, () => {
  const ohneLage = mitEintraegen((eintraege) => [
    ...eintraege,
    {
      schluessel: "src/zahl.js:99 ohne Lage",
      zeilen: [99, 99],
      status: "Killed",
      bestaetigung: "getoetet",
      toeter: ["test/zahl.test.js"],
    },
  ]);
  assert.equal(
    angenommen({ vorlauf: abgewandelt(vorlauf, aufraeumer, ohneLage) }),
    zahlBestaetigt(),
  );
});

test("die Zahl bestätigt getöteter Mutanten ignoriert Einträge fremder Prüfungen", FRIST, () => {
  const lage = { start: { line: 99, column: 1 }, end: { line: 99, column: 2 } };
  const fremd = (teile) =>
    teile.map((teil) => ({
      ...teil,
      messungen: [
        ...teil.messungen,
        {
          pruefung: 1,
          ergebnisse: [
            {
              schluessel: "src/zahl.js:99 fremd",
              zeilen: [99, 99],
              status: "Killed",
              bestaetigung: "getoetet",
              toeter: ["test/zahl.test.js"],
              lage,
            },
          ],
        },
      ],
    }));
  assert.equal(angenommen({ vorlauf: abgewandelt(vorlauf, aufraeumer, fremd) }), zahlBestaetigt());
});

const ALS_UEBERLEBENDE = mitEintraegen((eintraege) =>
  eintraege.map((eintrag) => ({
    ...eintrag,
    status: "Survived",
    bestaetigung: undefined,
    toeter: [],
  })),
);

test(
  "bei doppeltem Schlüssel zählt der bestätigt getötete Eintrag auch, wenn er in einem späteren Teil steht",
  FRIST,
  () => {
    const umbau = ([erster]) => [
      { ...ALS_UEBERLEBENDE([erster])[0], teile: 2 },
      { ...erster, teil: 2, teile: 2 },
    ];
    assert.equal(angenommen(mitTeilen(umbau)), zahlBestaetigt());
  },
);

test(
  "bei doppeltem Schlüssel verdrängt ein später gemeldeter Überlebender den bestätigt getöteten Eintrag nicht",
  FRIST,
  () => {
    const umbau = ([erster]) => [
      { ...erster, teile: 2 },
      { ...ALS_UEBERLEBENDE([erster])[0], teil: 2, teile: 2 },
    ];
    assert.equal(angenommen(mitTeilen(umbau)), zahlBestaetigt());
  },
);

function zweiTeileMit(abweichung, gewoehnlichZuerst) {
  const umgebaut = mitEintraegen((eintraege) => eintraege.map((eintrag) => ({ ...eintrag, ...abweichung })));
  return mitTeilen(([erster]) => {
    const [eins, zwei] = gewoehnlichZuerst ? [erster, umgebaut([erster])[0]] : [umgebaut([erster])[0], erster];
    return [
      { ...eins, teil: 1, teile: 2 },
      { ...zwei, teil: 2, teile: 2 },
    ];
  });
}

test("meldet ein anderes Teil denselben Mutanten als abgestürzt, wird er trotz bestätigter Tötung im ersten Teil nicht übernommen", FRIST, () => {
  assert.equal(angenommen(zweiTeileMit({ bestaetigung: "absturz" }, true)), 0);
});

test("meldet das erste Teil einen Mutanten als abgestürzt und ein späteres als bestätigt getötet, wird er nicht übernommen", FRIST, () => {
  assert.equal(angenommen(zweiTeileMit({ bestaetigung: "absturz" }, false)), 0);
});

test("meldet ein anderes Teil denselben Mutanten mit Hinweis, wird er trotz bestätigter Tötung im ersten Teil nicht übernommen", FRIST, () => {
  assert.equal(angenommen(zweiTeileMit({ hinweis: "unklar" }, true)), 0);
});

test("meldet ein anderes Teil denselben Mutanten mit Befund, wird er trotz bestätigter Tötung im ersten Teil nicht übernommen", FRIST, () => {
  assert.equal(angenommen(zweiTeileMit({ befund: "unklar" }, true)), 0);
});

function ausVorergebnis(umbau, dateien = {}) {
  const quelle = abgewandelt(vorlauf, aufraeumer, umbau);
  const { repo, ziel, geholt } = holeAus(quelle, aufraeumer, { dateien });
  assert.equal(geholt.status, 0, geholt.stdout + geholt.stderr);
  return { repo, lauf: nachrunde(repo, vorlauf.basis, { vorergebnis: ziel, aufraeumer }) };
}

function ganzNeuGeprueft(umbau, dateien) {
  const { lauf } = ausVorergebnis(umbau, dateien);
  assert.doesNotMatch(lauf.ausgaben, UEBERNOMMEN);
  assert.equal(ersteLaeufe(lauf.ausgaben), alleEintraege(vorlauf.ordner).length);
}

test("ändert sich die vom Werkzeug selbst geladene Testbank, die nur ein unbeteiligter Test lädt, wird alles neu geprüft", FRIST, () => {
  ganzNeuGeprueft((berichte) => berichte, { "test/testbaenke-run.mjs": `${TESTBANK}// geändert\n` });
});

test("ein Mutant mit Status Survived gilt trotz Töter und Bestätigung nicht als getötet", FRIST, () => {
  ganzNeuGeprueft(mitEintraegen((eintraege) => eintraege.map((eintrag) => ({ ...eintrag, status: "Survived" }))));
});

test("ein nur durch Hänger erkannter Mutant wird neu geprüft", FRIST, () => {
  ganzNeuGeprueft(mitEintraegen((eintraege) => eintraege.map((eintrag) => ({ ...eintrag, bestaetigung: "haenger" }))));
});

test("ein Mutant mit Hinweis wird neu geprüft", FRIST, () => {
  ganzNeuGeprueft(mitEintraegen((eintraege) => eintraege.map((eintrag) => ({ ...eintrag, hinweis: "unklar" }))));
});

test("ein Mutant mit Befund wird neu geprüft", FRIST, () => {
  ganzNeuGeprueft(mitEintraegen((eintraege) => eintraege.map((eintrag) => ({ ...eintrag, befund: "unklar" }))));
});

test("ein Mutant ohne genannten Töter wird neu geprüft", FRIST, () => {
  ganzNeuGeprueft(mitEintraegen((eintraege) => eintraege.map((eintrag) => ({ ...eintrag, toeter: [] }))));
});

test("ein Mutant, dessen Töter die Quelle nicht erreicht, wird neu geprüft", FRIST, () => {
  ganzNeuGeprueft(mitEintraegen((eintraege) => eintraege.map((eintrag) => ({ ...eintrag, toeter: ["test/weitere.test.js"] }))));
});

test("ein Mutant, bei dem einer von zwei Tötern die Quelle nicht erreicht, wird neu geprüft", FRIST, () => {
  ganzNeuGeprueft(mitEintraegen((eintraege) => eintraege.map((eintrag) => ({ ...eintrag, toeter: ["test/zahl.test.js", "test/weitere.test.js"] }))));
});

test("liegt ein Eintrag der Datei außerhalb der geprüften Zeilen, wird die ganze Datei neu geprüft", FRIST, () => {
  ganzNeuGeprueft(mitEintraegen(([erster, ...rest]) => [{ ...erster, zeilen: [900, 900] }, ...rest]));
});

test("fehlt im Vorlauf ein Mutant und ist kein Töter mehr gültig, wird die Datei vollständig neu geprüft", FRIST, () => {
  const ohneEinen = mitEintraegen(([, ...rest]) => rest);
  ganzNeuGeprueft(ohneEinen, { "test/zahl.test.js": `${ZAHLTEST}// geändert\n`, "test/verdoppeln.test.js": `${VERDOPPELNTEST}// geändert\n` });
});

function kontextZeilen(umbau, vorher = () => {}) {
  const { repo, ziel, geholt } = holeAus(vorlauf, aufraeumer, {});
  assert.equal(geholt.status, 0, geholt.stdout + geholt.stderr);
  const inhalt = umbau(JSON.parse(readFileSync(ziel, "utf8")));
  writeFileSync(ziel, typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt));
  vorher(repo);
  const ergebnis = join(temporaer(aufraeumer, "nachrunde-ergebnis-"), "teil.json");
  return werkzeugLauf(repo, ["--basis", "HEAD", "--teil", "1", "--teile", "1", "--ergebnis", ergebnis, "--vorergebnis", ziel]).stdout;
}

test("ein Vorergebnis von einer anderen Node-Version wird nicht übernommen", FRIST, () => {
  assert.match(kontextZeilen((vorergebnis) => ({ ...vorergebnis, umgebung: "v1.2.3" })), /kein Vorergebnis \(andere Node-Version \(v1\.2\.3\)\), voller Neulauf\./);
});

test("ein Vorergebnis mit anderer Zahl von Prüfungen wird nicht übernommen", FRIST, () => {
  assert.match(kontextZeilen((vorergebnis) => ({ ...vorergebnis, pruefungen: [...vorergebnis.pruefungen, ...vorergebnis.pruefungen] })), /kein Vorergebnis \(andere Zahl von Prüfungen\), voller Neulauf\./);
});

test("ein Vorergebnis von der anderen Seite der Prüfung wird nicht übernommen", FRIST, () => {
  const alt = (vorergebnis) => ({ ...vorergebnis, pruefungen: vorergebnis.pruefungen.map((pruefung) => ({ ...pruefung, seite: "alt" })) });
  assert.match(kontextZeilen(alt), /Vorergebnis passt nicht zum Stand \(andere Seite der Prüfung\), voller Neulauf\./);
});

test("ein Vorergebnis für einen anderen Stand der Dateien außerhalb von test/ wird nicht übernommen", FRIST, () => {
  assert.match(kontextZeilen((vorergebnis) => vorergebnis), /Vorergebnis passt nicht zum Stand \(Dateien außerhalb von test\/ geändert\), voller Neulauf\./);
});

test("ein Arbeitsbaum mit losen Dateien nimmt kein Vorergebnis an", FRIST, () => {
  const lose = (repo) => writeFileSync(join(repo, "lose.txt"), "lose\n");
  assert.match(kontextZeilen((vorergebnis) => vorergebnis, lose), /kein Vorergebnis \(Arbeitsbaum nicht sauber\), voller Neulauf\./);
});

test("Dateien im Arbeitsordner der Mutationsprüfung machen den Arbeitsbaum nicht unsauber", FRIST, () => {
  const arbeitsordner = (repo) => {
    mkdirSync(join(repo, ".mutationspruefung"), { recursive: true });
    writeFileSync(join(repo, ".mutationspruefung", "spur.json"), "{}\n");
  };
  const zeilen = kontextZeilen((vorergebnis) => vorergebnis, arbeitsordner);
  assert.doesNotMatch(zeilen, /Arbeitsbaum nicht sauber/);
  assert.match(zeilen, /Vorergebnis passt nicht zum Stand/);
});

test("ein Vorergebnis ohne Lauf nennt seinen Grund in der Logzeile", FRIST, () => {
  assert.match(kontextZeilen(() => ({ lauf: null, grund: "Egress erschöpft" })), /kein Vorergebnis \(Egress erschöpft\), voller Neulauf\./);
});

test("ein Vorergebnis ohne Lauf und ohne Grund heißt leer", FRIST, () => {
  assert.match(kontextZeilen(() => ({ lauf: null })), /kein Vorergebnis \(leer\), voller Neulauf\./);
});

test("ein Vorergebnis ohne Liste der Prüfungen heißt leer", FRIST, () => {
  assert.match(kontextZeilen(() => ({ lauf: 4711 })), /kein Vorergebnis \(leer\), voller Neulauf\./);
});

test("eine unlesbare Vorergebnisdatei wird nicht übernommen", FRIST, () => {
  assert.match(kontextZeilen(() => "kein json"), /kein Vorergebnis \(Vorergebnisdatei unlesbar\), voller Neulauf\./);
});

test("ohne Angabe eines Vorergebnisses läuft die Nachrunde voll neu mit Logzeile", FRIST, () => {
  const { repo } = holeAus(vorlauf, aufraeumer, {});
  const ergebnis = join(temporaer(aufraeumer, "nachrunde-ergebnis-"), "teil.json");
  const lauf = werkzeugLauf(repo, ["--basis", "HEAD", "--teil", "1", "--teile", "1", "--ergebnis", ergebnis]);
  assert.match(lauf.stdout, /kein Vorergebnis \(kein Vorergebnis angegeben\), voller Neulauf\./);
});

test("das Urteil verwirft Teilergebnisse, die zu einem anderen Vorergebnis gehören", FRIST, () => {
  const { repo, ziel } = holeAus(vorlauf, aufraeumer, {});
  const gemessen = nachrunde(repo, vorlauf.basis, { vorergebnis: ziel, aufraeumer });
  const ohne = urteil(repo, vorlauf.basis, { ordner: gemessen.ordner });
  assert.notEqual(ohne.status, 0);
  assert.match(ohne.stdout + ohne.stderr, /gehören zu einem anderen Vorergebnis/);
});

test("liegt ein Eintrag der Datei vor dem Beginn der geprüften Zeilen, wird die ganze Datei neu geprüft", FRIST, () => {
  ganzNeuGeprueft(mitEintraegen(([erster, ...rest]) => [{ ...erster, zeilen: [0, 1] }, ...rest]));
});

test("ein noch laufender Vorlauf mit gesetztem Ergebnis wird nicht angenommen", FRIST, () => {
  abgelehnt({ gh: { status: "in_progress", conclusion: "failure" } }, /nicht mit Urteil abgeschlossen/);
});

test("ein Vorergebnis ohne Teil oder Urteil ist ein Aufruffehler", FRIST, () => {
  const { repo, ziel } = holeAus(vorlauf, aufraeumer, {});
  const lauf = werkzeugLauf(repo, ["--basis", "HEAD", "--vorergebnis", ziel]);
  assert.notEqual(lauf.status, 0);
  assert.match(lauf.stderr, /--vorergebnis-holen <datei>/);
});

test("das Holen des Vorergebnisses neben anderen Angaben ist ein Aufruffehler", FRIST, () => {
  const { repo, ziel } = holeAus(vorlauf, aufraeumer, {});
  const lauf = werkzeugLauf(repo, ["--vorergebnis-holen", ziel, "--basis", "HEAD"]);
  assert.notEqual(lauf.status, 0);
  assert.match(lauf.stderr, /--vorergebnis-holen <datei>/);
});

const ALLE_GETOETET = mitEintraegen((eintraege) => eintraege.map((eintrag) => ({ ...eintrag, status: "Killed", bestaetigung: "getoetet", toeter: ["test/zahl.test.js"], hinweis: undefined, befund: undefined })));

function alleUebernommen(dateien) {
  const { lauf } = ausVorergebnis(ALLE_GETOETET, dateien);
  const [, uebernommen, geprueft] = lauf.ausgaben.match(UEBERNOMMEN);
  assert.deepEqual([Number(uebernommen), Number(geprueft)], [alleEintraege(vorlauf.ordner).length, 0]);
  return ersteLaeufe(lauf.ausgaben);
}

test("sind alle Mutanten der Datei übernommen und erreicht eine neue Testdatei die Quelle, läuft nur ein Probemutant für den Erstlauf", FRIST, () => {
  assert.equal(alleUebernommen({}), 1);
});

test("sind alle Mutanten der Datei übernommen und erreicht keine neue Testdatei die Quelle, läuft für die Datei keine Mutationsprüfung mehr", FRIST, () => {
  assert.equal(alleUebernommen({ "test/null.test.js": WEITERER_TEST }), 0);
});

const WEITERER_TEST = ['import { test } from "node:test";', 'test("leer", () => {});', ""].join("\n");

const ROTER_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { einordnen } from "../src/zahl.js";',
  'test("rot", () => {',
  '  assert.equal(einordnen(1), "falsch");',
  "});",
  "",
].join("\n");

test("ist alles übernommen, aber eine neue Testdatei in der ersten Stufe schon ohne Mutation rot, bricht die Nachrunde ab wie ein voller Neulauf", FRIST, () => {
  assert.throws(() => ausVorergebnis(ALLE_GETOETET, { "test/rot.test.js": ROTER_TEST }), /initial test run/i);
});

test("das Holen und das Lesen des Vorergebnisses im selben Aufruf ist ein Aufruffehler", FRIST, () => {
  const { repo, ziel } = holeAus(vorlauf, aufraeumer, {});
  const plan = join(temporaer(aufraeumer, "nachrunde-plan-"), "plan.json");
  const lauf = werkzeugLauf(repo, ["--basis", vorlauf.basis, "--plan", plan, "--vorergebnis-holen", ziel, "--vorergebnis", ziel]);
  assert.notEqual(lauf.status, 0);
  assert.match(lauf.stderr, /--vorergebnis-holen <datei>/);
});

test("der Testumbau übernimmt nichts: sein Plan schreibt zum Vorergebnis-Holen eine Datei ohne Vorlauf", FRIST, () => {
  const { repo } = holeAus(vorlauf, aufraeumer, {});
  const ordner = temporaer(aufraeumer, "nachrunde-testumbau-");
  const ziel = join(ordner, "vorergebnis.json");
  const lauf = werkzeugLauf(repo, ["--basis", "HEAD", "--testumbau", "--plan", join(ordner, "plan.json"), "--vorergebnis-holen", ziel]);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(JSON.parse(readFileSync(ziel, "utf8")).lauf, null);
});

test("der Testumbau nimmt das Vorergebnis im Teil- und Urteilsaufruf an, ohne es zu benutzen", FRIST, () => {
  const { repo, ziel } = holeAus(vorlauf, aufraeumer, {});
  const ordner = temporaer(aufraeumer, "nachrunde-testumbau-urteil-");
  const lauf = werkzeugLauf(repo, ["--basis", "HEAD", "--testumbau", "--urteil", ordner, "--vorergebnis", ziel]);
  assert.doesNotMatch(lauf.stderr, /^Aufruf:/m);
  assert.doesNotMatch(lauf.stdout + lauf.stderr, /Vorergebnis|übernommen/);
});
