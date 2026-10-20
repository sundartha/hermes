import { basename } from "node:path";

import { staticTestName } from "../testschutz/aenderungen.mjs";
import { removedCases } from "../testschutz/entfernt.mjs";
import { MESSBAR } from "./entscheiden.mjs";
import { istRelativ, syntaxknoten, vorhandenesZiel } from "./importe.mjs";
import { TESTDATEI, erwaehnende, graphImStand, mengenVerstoesse } from "./messmenge.mjs";
import { GATE_DATEI, TESTORDNER, aenderungen, git, gitGelingt, testpfadFrei } from "./pfade.mjs";

const FALL_TRENNER = ": ";
const KEINE_TESTDATEI = ".test.";
const ABSCHALTUNG = /Stryker disable/;
const OHNE_MESSUNG_ERLAUBT = /^(?:test|node_modules)\//;
const SKRIPT = /\.[cm]?[jt]s$/;
const REINER_LOESCH_HUNK = /^@@ -\d+(?:,\d+)? \+\d+,0 @@/m;
const PAAR = /^[RC]\d*$/;
const FELDER_JE_PAAR = 3;
const FELDER_JE_AENDERUNG = 2;
const GELOESCHT = "D";
const GEAENDERT = "M";

function eintraege(liste) {
  const pfade = new Set();
  const faelle = [];
  const namen = new Set();
  for (const eintrag of liste.map((text) => text.trim()).filter(Boolean)) {
    const stelle = eintrag.indexOf(FALL_TRENNER);
    if (!eintrag.startsWith(TESTORDNER)) namen.add(eintrag);
    else if (stelle === -1) pfade.add(eintrag);
    else {
      const [datei, fall] = [eintrag.slice(0, stelle), eintrag.slice(stelle + FALL_TRENNER.length)];
      faelle.push({ datei, fall });
    }
  }
  return { pfade, faelle, namen };
}

function paare(basis, kopf) {
  const args = ["diff", "--name-status", "-z", "--find-renames=50%", "--find-copies", basis, kopf];
  const felder = git(args).split("\0").filter(Boolean);
  const gefunden = [];
  let stelle = 0;
  while (stelle < felder.length) {
    const istPaar = PAAR.test(felder[stelle]);
    const [von, nach] = felder.slice(stelle + 1, stelle + FELDER_JE_PAAR);
    if (istPaar) gefunden.push({ von, nach });
    stelle += istPaar ? FELDER_JE_PAAR : FELDER_JE_AENDERUNG;
  }
  return gefunden;
}

function existiert(rev, pfad) {
  return gitGelingt(["cat-file", "-e", `${rev}:${pfad}`]);
}

function inhalt(rev, pfad) {
  return existiert(rev, pfad) ? git(["show", `${rev}:${pfad}`]) : "";
}

function gemerkt(stand, schluessel, rechne) {
  if (!stand.gemerkt.has(schluessel)) stand.gemerkt.set(schluessel, rechne());
  return stand.gemerkt.get(schluessel);
}

function basisText(pfad, stand) {
  return gemerkt(stand, `text ${pfad}`, () => inhalt(stand.basis, pfad));
}

function gateListe(rev) {
  return existiert(rev, GATE_DATEI) ? JSON.parse(inhalt(rev, GATE_DATEI)) : {};
}

function sammle({ basis, kopf, liste, graph }) {
  const diff = aenderungen(basis, kopf);
  const mit = (art) => new Set(diff.filter(({ status }) => status === art).map(({ pfad }) => pfad));
  return {
    basis,
    kopf,
    graph,
    ...eintraege(liste),
    geloescht: mit(GELOESCHT),
    geaendert: mit(GEAENDERT),
    paare: paare(basis, kopf),
    gatesBasis: gateListe(basis),
    gatesKopf: gateListe(kopf),
    gemerkt: new Map(),
  };
}

function erreichbar(startpfade, graph) {
  const erreicht = new Set(startpfade);
  for (const datei of erreicht) {
    for (const ziel of graph.importe.get(datei) ?? []) erreicht.add(ziel);
  }
  return [...erreicht];
}

export function transitiveHuelle(startpfade, graph) {
  return erreichbar(startpfade, graph)
    .filter((pfad) => MESSBAR.test(pfad))
    .sort();
}

function paarVon(pfad, stand) {
  return stand.paare.find(({ von }) => von === pfad);
}

function entfernteFaelle(datei, stand) {
  return gemerkt(stand, `faelle ${datei}`, () =>
    removedCases(stand.basis, datei, inhalt(stand.kopf, datei)),
  );
}

function pfadGrund(pfad, stand) {
  const paar = paarVon(pfad, stand);
  if (paar) {
    return `umbenannt oder kopiert nach ${paar.nach}; das ist keine Löschung, die Prüfung je Fall bleibt`;
  }
  if (!existiert(stand.basis, pfad)) return "die Datei gibt es in der Basis nicht";
  if (!stand.geloescht.has(pfad)) return "steht auf der Liste, der PR löscht die Datei aber nicht";
  if (!testpfadFrei(pfad)) {
    return "test/werkzeuge/, test/sicherheit/ und die Testbank-Skripte sind ausgenommen";
  }
  if (!TESTDATEI.test(pfad) && basename(pfad).includes(KEINE_TESTDATEI)) {
    return "weder Testdatei (test/**/*.test.js oder .ts) noch Testhilfe";
  }
  return undefined;
}

function fallGrund({ datei, fall }, stand) {
  if (!TESTDATEI.test(datei) || !testpfadFrei(datei)) {
    return "einzelne Fälle nur aus test/**/*.test.* außer test/werkzeuge/ und test/sicherheit/";
  }
  if (!existiert(stand.kopf, datei)) {
    return "die Datei fehlt im Kopf; ganze Dateien stehen mit vollem Pfad auf der Liste";
  }
  if (!stand.geaendert.has(datei)) return "der PR ändert die Datei nicht";
  if (!entfernteFaelle(datei, stand).includes(fall)) {
    return `der Fall „${fall}“ ist nicht genau als ganzer Fall entfernt; die Datei ändert sich sonst noch oder der Fall besteht weiter`;
  }
  return undefined;
}

function einteilen(stand) {
  const verstoesse = [];
  const tests = [];
  const hilfen = [];
  for (const pfad of [...stand.pfade].sort()) {
    const grund = pfadGrund(pfad, stand);
    if (grund) verstoesse.push({ datei: pfad, grund });
    else if (TESTDATEI.test(pfad)) tests.push(pfad);
    else hilfen.push(pfad);
  }
  const faelle = stand.faelle.filter((eintrag) => {
    const grund = fallGrund(eintrag, stand);
    if (grund) verstoesse.push({ datei: eintrag.datei, grund });
    return grund === undefined;
  });
  return { verstoesse, tests, hilfen, faelle };
}

function gatesDer(datei, gates) {
  const betroffen = Object.entries(gates).filter(([, { tests = [] }]) => tests.includes(datei));
  return betroffen.map(([name]) => name).sort();
}

function gateGruende(name, { namen, gatesKopf, kopf }) {
  const gruende = [];
  if (!namen.has(name)) gruende.push(`Gate ${name} steht nicht als Name auf der Liste`);
  const { tests = [] } = gatesKopf[name] ?? {};
  if (!tests.some((pfad) => existiert(kopf, pfad))) {
    gruende.push(
      `${GATE_DATEI} des Kopfs nennt für Gate ${name} keine Testdatei, die im Kopf existiert`,
    );
  }
  return gruende;
}

function gatePruefung(alteTests, stand) {
  const gates = {};
  const verstoesse = [];
  for (const test of alteTests) {
    for (const name of gatesDer(test, stand.gatesBasis)) {
      gates[name] = [...(gates[name] ?? []), test];
      verstoesse.push(...gateGruende(name, stand).map((grund) => ({ datei: test, grund })));
    }
  }
  const fremd = [...stand.namen].filter((name) => !Object.hasOwn(gates, name)).sort();
  const grund = "der Eintrag ist kein Pfad unter test/ und kein Gate einer gelisteten Gate-Datei";
  verstoesse.push(...fremd.map((datei) => ({ datei, grund })));
  return { gates, verstoesse };
}

function nutzerInDerBasis(hilfe, { graph, basis }) {
  const nutzer = new Set([
    ...(graph.importierer.get(hilfe) ?? []),
    ...erwaehnende([basename(hilfe)], basis),
  ]);
  nutzer.delete(hilfe);
  return [...nutzer].sort();
}

function hilfeGruende(hilfe, stand) {
  const gruende = [];
  const imKopf = erwaehnende([basename(hilfe)], stand.kopf).sort();
  if (imKopf.length > 0) gruende.push(`im Kopf nennen sie noch ${imKopf.join(", ")}`);
  const offen = nutzerInDerBasis(hilfe, stand).filter(
    (pfad) => !stand.geloescht.has(pfad) || !stand.pfade.has(pfad),
  );
  if (offen.length > 0) {
    gruende.push(`Nutzer aus der Basis, die der PR nicht löscht und listet: ${offen.join(", ")}`);
  }
  return gruende.map((grund) => ({ datei: hilfe, grund }));
}

function loeschtZeilen(pfad, stand) {
  if (!stand.geaendert.has(pfad)) return false;
  const args = ["diff", "-U0", "--no-renames", "--no-color", "--no-ext-diff", "--no-textconv"];
  return REINER_LOESCH_HUNK.test(git([...args, stand.basis, stand.kopf, "--", pfad]));
}

function totePfad(pfad, stand) {
  if (stand.geloescht.has(pfad)) return paarVon(pfad, stand) === undefined;
  return gemerkt(stand, `tot ${pfad}`, () => loeschtZeilen(pfad, stand));
}

function ohneMessung(pfad) {
  return !MESSBAR.test(pfad) && !OHNE_MESSUNG_ERLAUBT.test(pfad);
}

function dateienDerBasis(stand) {
  return gemerkt(stand, "dateien", () => {
    const pfade = git(["ls-tree", "-r", "-z", "--name-only", stand.basis]).split("\0");
    return pfade.filter((pfad) => pfad !== "" && !OHNE_MESSUNG_ERLAUBT.test(pfad));
  });
}

function testseitigeTexte(reichweite, stand) {
  return reichweite
    .filter((pfad) => pfad.startsWith(TESTORDNER))
    .map((pfad) => basisText(pfad, stand));
}

function imKopf(pfade, stand) {
  return [...new Set(pfade)].filter((pfad) => existiert(stand.kopf, pfad)).sort();
}

function fremdeZiele(reichweite, stand) {
  const texte = testseitigeTexte(reichweite, stand);
  const genannt = dateienDerBasis(stand).filter(
    (pfad) => ohneMessung(pfad) && texte.some((text) => text.includes(basename(pfad))),
  );
  return imKopf([...reichweite.filter(ohneMessung), ...genannt], stand);
}

function nurGenannteQuellen(reichweite, stand) {
  const texte = testseitigeTexte(reichweite, stand);
  const erreicht = new Set(reichweite);
  const genannt = dateienDerBasis(stand).filter(
    (pfad) =>
      MESSBAR.test(pfad) && !erreicht.has(pfad) && texte.some((text) => text.includes(pfad)),
  );
  return imKopf(genannt, stand);
}

function zielAufloesbar(datei, quelle, stand) {
  const text = staticTestName(quelle);
  if (text === undefined) return false;
  if (!istRelativ(text)) return true;
  return vorhandenesZiel(datei, text, (kandidat) => existiert(stand.basis, kandidat)) !== undefined;
}

function offenerImport(datei, stand) {
  if (!SKRIPT.test(datei)) return false;
  const knoten = syntaxknoten(datei, basisText(datei, stand));
  if (knoten === undefined) return true;
  const importe = knoten.filter(({ type }) => type === "ImportExpression");
  return importe.some(({ source }) => !zielAufloesbar(datei, source, stand));
}

function reichweitenGruende(start, stand) {
  const reichweite = erreichbar([start], stand.graph).filter(
    (pfad) => !pfad.startsWith("node_modules/"),
  );
  const gruende = [];
  const fremd = fremdeZiele(reichweite, stand);
  if (fremd.length > 0) {
    gruende.push(
      `erreicht in der Basis ${fremd.join(", ")}; diese Dateien mutiert die Messung nicht, ihre Prüfung fiele ungemessen weg`,
    );
  }
  const genannt = nurGenannteQuellen(reichweite, stand);
  if (genannt.length > 0) {
    gruende.push(
      `nennt ${genannt.join(", ")} nur als Text und importiert sie nicht; eine Prüfung über gelesenen Text oder ein gestartetes Programm misst die Mutation nicht`,
    );
  }
  const offen = reichweite.filter((pfad) =>
    gemerkt(stand, `import ${pfad}`, () => offenerImport(pfad, stand)),
  );
  if (offen.length > 0) {
    gruende.push(
      `dynamischer Import ohne sicher auflösbares Ziel in ${offen.join(", ")}; die Messmenge kann ihm nicht folgen`,
    );
  }
  return gruende.map((grund) => ({ datei: start, grund }));
}

function testGruende(test, { stand, huelle }) {
  const alt = { rev: stand.basis, graph: stand.graph };
  const menge = { dateien: huelle, alt: [test] };
  const befunde = mengenVerstoesse({ geaendert: [], alt, menge });
  const gruende = befunde.map((befund) => befund.slice(`${test}${FALL_TRENNER}`.length));
  if (!transitiveHuelle([test], stand.graph).some((pfad) => totePfad(pfad, stand))) {
    gruende.push(
      "prüft keinen toten Code: erreicht in der Basis keine Datei unter src/, scripts/ oder tools/, die der PR löscht oder aus der er Zeilen in einem reinen Lösch-Hunk entfernt",
    );
  }
  return gruende.map((grund) => ({ datei: test, grund }));
}

function kopfPfad(pfad, stand) {
  if (existiert(stand.kopf, pfad)) return pfad;
  return paarVon(pfad, stand)?.nach;
}

function abgeschaltet(pfad, stand) {
  const texte = [inhalt(stand.basis, pfad), inhalt(stand.kopf, kopfPfad(pfad, stand))];
  return texte.some((text) => ABSCHALTUNG.test(text));
}

function abschaltungen(messmenge, stand) {
  const grund = "enthält „Stryker disable“; abgeschaltete Mutanten zählen nicht als getötet";
  return messmenge.filter((pfad) => abgeschaltet(pfad, stand)).map((datei) => ({ datei, grund }));
}

function ungelisteteFaelle(stand) {
  const geaenderteTests = [...stand.geaendert].filter(
    (pfad) => pfad.startsWith(TESTORDNER) && SKRIPT.test(pfad),
  );
  const gelistet = new Set(stand.faelle.map(({ datei, fall }) => `${datei}${FALL_TRENNER}${fall}`));
  return geaenderteTests
    .sort()
    .flatMap((datei) =>
      entfernteFaelle(datei, stand).map((fall) => `${datei}${FALL_TRENNER}${fall}`),
    )
    .filter((eintrag) => !gelistet.has(eintrag));
}

function nichtGelistet(stand) {
  const ungelistet = [...stand.geloescht].filter(
    (pfad) => pfad.startsWith(TESTORDNER) && !stand.pfade.has(pfad),
  );
  return [...ungelistet.sort(), ...ungelisteteFaelle(stand)];
}

function ungelisteteGruende(ungelistet) {
  const grund =
    "der PR löscht diesen Test, er steht aber nicht auf der Liste; ungemessen darf kein Test wegfallen";
  return ungelistet.map((datei) => ({ datei, grund }));
}

export async function planeTotcode({ basis, kopf, liste }) {
  const stand = sammle({ basis, kopf, liste, graph: await graphImStand(basis) });
  const teile = einteilen(stand);
  const alteTests = [
    ...new Set([...teile.tests, ...teile.faelle.map(({ datei }) => datei)]),
  ].sort();
  const gate = gatePruefung(alteTests, stand);
  const huelle = transitiveHuelle([...alteTests, ...teile.hilfen], stand.graph);
  const messmenge = huelle.filter((pfad) => kopfPfad(pfad, stand) !== undefined);
  const ungelistet = nichtGelistet(stand);
  const verstoesse = [
    ...teile.verstoesse,
    ...ungelisteteGruende(ungelistet),
    ...gate.verstoesse,
    ...teile.hilfen.flatMap((hilfe) => hilfeGruende(hilfe, stand)),
    ...alteTests.flatMap((test) => testGruende(test, { stand, huelle })),
    ...[...alteTests, ...teile.hilfen].flatMap((start) => reichweitenGruende(start, stand)),
    ...abschaltungen(messmenge, stand),
  ];
  if (alteTests.length === 0) {
    const grund = "die Liste nennt keine gelöschte Testdatei und keinen entfernten Fall";
    verstoesse.push({ datei: "", grund });
  }
  return {
    basis,
    kopf,
    geloeschteTests: teile.tests,
    geloeschteHilfen: teile.hilfen,
    faelle: teile.faelle,
    alteTests,
    gates: gate.gates,
    messmenge,
    umbenannt: stand.paare.filter(({ von }) => messmenge.includes(von) && !existiert(kopf, von)),
    nichtGelistet: ungelistet,
    verstoesse,
  };
}
