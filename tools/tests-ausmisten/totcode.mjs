import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, relative } from "node:path";
import { chdir, cwd, env } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { patternFlagsFor } from "../../test/testbaenke-run.mjs";
import { gebundeneNamen } from "../eslint-rules/namen-ohne-begruendung.js";
import { nimmSperreAuchFuerKindprozesse } from "../schwerlauf/sperre.mjs";
import { umbenennungen } from "../umbenennung.mjs";
import { setzeAusgaben } from "../ziele/ausgabe.mjs";
import { entferneArbeitsordner, legeArbeitsordnerAn } from "./arbeitsordner.mjs";
import { gewaehlterBefehl } from "./aufruf.mjs";
import { paketDes, schreibeErgebnis, statusListe } from "./befehle.mjs";
import { MESSBAR, pruefsumme } from "./entscheiden.mjs";
import { syntaxknoten } from "./importe.mjs";
import { messeGegenAlte, messeGegenNeue, trockenlauf } from "./messen.mjs";
import { TESTDATEI, erreichendeTests, graphImStand, importgraph } from "./messmenge.mjs";
import { GATE_DATEI, aenderungen, git, gitGelingt } from "./pfade.mjs";
import { packe, zaehle } from "./planen.mjs";
import { inEigenerGruppe } from "./prozessgruppe.mjs";
import { planeTotcode, transitiveHuelle } from "./totcode-menge.mjs";
import { liefereStufe } from "./totcode-untraut.mjs";
import { ART, ergebnisInhalt, gruendeDer, leseStufe } from "./totcode-urteil.mjs";
import { bildeAlle, dateiAbbildung, zerlegeSchluessel } from "./zeilenabbildung.mjs";

const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const PEEL_TO_COMMIT = "^{commit}";
const NAMENSZEICHEN = /[\w$]/;
const GELOESCHT = "D";
const NEU = "A";
const PRODUKTORT = /^(?:src|scripts|tools)\//;
const PRODUKTORDNER = ["src", "scripts", "tools"];
const WERKZEUGORT = /^(?:tools|scripts)\//;
const BANK = "regression";
const BERICHT = fileURLToPath(new URL("../auftrag/faelle-bericht.mjs", import.meta.url));
const PROBEZEIT_MS = 600_000;
const REGULAERE_ENDEN = new Set([EXIT_GRUEN, EXIT_ROT]);
const DIFF = ["diff", "-U0", "--no-renames", "--no-color", "--no-ext-diff", "--no-textconv"];
const DIFF_ABSCHNITT = /^diff --git /m;
const DIFF_ZIEL = /^\+\+\+ b\/(.+)$/;
const HUNK_KOPF = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/;
const LEERRAUM = /\s+/g;
const MODUL_FEHLT = /\[ERR_MODULE_NOT_FOUND\]: Cannot find module '([^']+)' imported from (.+)$/m;
const EXPORT_FEHLT =
  /SyntaxError: The requested module '([^']+)' does not provide an export named '([^']+)'/;
const DATEIZEILE = /^\s*(file:\/\/\S+):\d+\s*$/;
const RELATIV = /^\.{1,2}\//;
const ANHANG = /[?#].*$/s;
const STANDARD_EXPORT = /\bexport\s+default\b|\bas\s+default\b/;
const IMPORTKNOTEN = new Set(["ImportDeclaration", "ExportNamedDeclaration"]);
const UMGEZOGEN = "Code umgezogen";
const AUFRUF = [
  "Aufruf: node tools/tests-ausmisten/totcode.mjs",
  "planen --basis <rev> --kopf <rev> --liste <datei> --aus <ordner>",
  "| basis --daten <ordner> --aus <ordner> [--paket <nr>]",
  "| kopf --daten <ordner> (--aus <ordner> | --kanal <fifo>) [--paket <nr>]",
  "| rotprobe --daten <ordner> (--aus <ordner> | --kanal <fifo>)",
  "| entscheiden --daten <ordner> --aus <ordner>",
].join(" ");
const PFLICHT = {
  planen: ["basis", "kopf", "liste", "aus"],
  basis: ["daten", "aus"],
  kopf: ["daten"],
  rotprobe: ["daten"],
  entscheiden: ["daten", "aus"],
};
const MESSENDE_BEFEHLE = new Set(["basis", "kopf", "rotprobe"]);

function vollerSha(rev) {
  return git(["rev-parse", "--verify", `${rev}${PEEL_TO_COMMIT}`]).trim();
}

function leseListe(datei) {
  const liste = JSON.parse(readFileSync(datei, "utf8"));
  if (!Array.isArray(liste) || !liste.every((eintrag) => typeof eintrag === "string"))
    throw new Error(`${datei}: erwartet ein JSON-Feld von Einträgen`);
  return liste;
}

function normalisiert(text) {
  return text.replace(LEERRAUM, " ").trim();
}

function grenzt(text, stelle) {
  return stelle < 0 || stelle >= text.length || !NAMENSZEICHEN.test(text[stelle]);
}

function enthaeltWort(text, name) {
  for (let stelle = text.indexOf(name); stelle !== -1; stelle = text.indexOf(name, stelle + 1)) {
    if (grenzt(text, stelle - 1) && grenzt(text, stelle + name.length)) return true;
  }
  return false;
}

function abschnitt(text) {
  const zeilen = text.split("\n");
  const beginn = zeilen.findIndex((zeile) => HUNK_KOPF.test(zeile));
  const kopf = beginn === -1 ? zeilen : zeilen.slice(0, beginn);
  const ziel = kopf.map((zeile) => DIFF_ZIEL.exec(zeile)).find(Boolean);
  return { pfad: ziel?.[1], hunks: beginn === -1 ? [] : zeilen.slice(beginn) };
}

function abschnitte(diff) {
  return diff.split(DIFF_ABSCHNITT).slice(1).map(abschnitt);
}

function eingefuegteTexte({ basis, kopf }, pfade = []) {
  return abschnitte(git([...DIFF, basis, kopf, "--", ...pfade])).flatMap(({ pfad, hunks }) =>
    hunks.filter((zeile) => zeile.startsWith("+")).map((zeile) => ({ pfad, text: zeile.slice(1) })),
  );
}

function geloeschteZeilen(diff) {
  const zeilen = [];
  let nummer = 0;
  for (const zeile of abschnitte(diff).flatMap(({ hunks }) => hunks)) {
    const kopf = HUNK_KOPF.exec(zeile);
    if (kopf !== null) nummer = Number(kopf[1]);
    else if (zeile.startsWith("-"))
      zeilen.push({ nummer: nummer++, text: normalisiert(zeile.slice(1)) });
  }
  return zeilen;
}

async function umbenennungsliste({ basis, kopf }, menge) {
  const { paare } = await umbenennungen({ von: basis, bis: kopf });
  const geprueft = paare.map(({ alt, neu, nurTypen }) => ({ alt, neu, nurTypen }));
  const bekannt = new Set(geprueft.map(({ alt }) => alt));
  const weitere = menge.umbenannt
    .filter(({ von }) => !bekannt.has(von))
    .map(({ von, nach }) => ({ alt: von, neu: nach, nurTypen: false }));
  return [...geprueft, ...weitere];
}

function dateiDiff(datei, { basis, kopf, umbenannt }) {
  const paar = umbenannt.find(({ alt, nurTypen }) => alt === datei && nurTypen);
  if (paar) return git(["diff", "-U0", `${basis}:${datei}`, `${kopf}:${paar.neu}`]);
  return git(["diff", "-U0", "--no-renames", basis, kopf, "--", datei]);
}

function abbildungen(diffs, { pr, umbenannt }) {
  const geloescht = new Set(pr.geloescht);
  return Object.fromEntries(
    Object.entries(diffs).map(([datei, diff]) => [
      datei,
      dateiAbbildung({ datei, geloescht, umbenannt, diff }),
    ]),
  );
}

function verschobeneZeilen(diffs, stand) {
  const neu = new Set(eingefuegteTexte(stand).map(({ text }) => normalisiert(text)));
  const eintraege = Object.entries(diffs).map(([datei, diff]) => [
    datei,
    geloeschteZeilen(diff)
      .filter(({ text }) => text === "" || neu.has(text))
      .map(({ nummer }) => nummer),
  ]);
  return Object.fromEntries(eintraege.filter(([, zeilen]) => zeilen.length > 0));
}

function prDateien(stand) {
  const liste = aenderungen(stand.basis, stand.kopf);
  const mit = (status) =>
    liste
      .filter((eintrag) => eintrag.status === status && PRODUKTORT.test(eintrag.pfad))
      .map(({ pfad }) => pfad)
      .sort();
  return { geloescht: mit(GELOESCHT), neu: mit(NEU) };
}

function werkzeugVerstoesse({ neu }) {
  const grund =
    "neue Datei unter tools/ oder scripts/ in einem PR mit Totcode-Liste; dort misst die Mutationsprüfung der CI nicht";
  return neu.filter((pfad) => WERKZEUGORT.test(pfad)).map((datei) => ({ datei, grund }));
}

async function geloeschteQuellen(menge, { basis, pr }) {
  const graph = await graphImStand(basis);
  const weg = new Set(pr.geloescht);
  const start = [...menge.alteTests, ...menge.geloeschteHilfen];
  return transitiveHuelle(start, graph).filter(
    (pfad) => weg.has(pfad) && !menge.messmenge.includes(pfad),
  );
}

async function paketeDer({ dateien, alteTests, verstoesse }, basis) {
  if (verstoesse.length > 0 || dateien.length === 0) return [];
  return imArbeitsordner(basis, async () => {
    const zahlen = await zaehle(dateien);
    const { sekunden } = await trockenlauf(alteTests);
    return packe(zahlen, sekunden);
  });
}

async function planen({ basis, kopf, liste, aus }) {
  const stand = { basis: vollerSha(basis), kopf: vollerSha(kopf) };
  const eintraege = leseListe(liste);
  const menge = await planeTotcode({ ...stand, liste: eintraege });
  const pr = prDateien(stand);
  const weg = await geloeschteQuellen(menge, { ...stand, pr });
  const umbenannt = await umbenennungsliste(stand, menge);
  const dateien = [...menge.messmenge, ...weg];
  const diffs = Object.fromEntries(
    dateien.map((datei) => [datei, dateiDiff(datei, { ...stand, umbenannt })]),
  );
  const verstoesse = [...menge.verstoesse, ...werkzeugVerstoesse(pr)];
  const pakete = await paketeDer({ dateien, alteTests: menge.alteTests, verstoesse }, stand.basis);
  const plan = {
    art: ART.plan,
    ...stand,
    liste: eintraege,
    menge,
    pr,
    geloeschteQuellen: weg,
    umbenannt,
    abbildung: abbildungen(diffs, { pr, umbenannt }),
    verschoben: verschobeneZeilen(diffs, stand),
    verstoesse,
    pakete,
  };
  schreibeErgebnis(aus, "plan", plan);
  setzeAusgaben({ pakete: JSON.stringify(pakete.map((_paket, nummer) => nummer)) });
  for (const { datei, grund } of verstoesse) console.log(`Verstoß: ${datei}: ${grund}`);
  console.log(
    `${menge.alteTests.length} alte Tests, ${menge.messmenge.length + weg.length} Dateien zum Mutieren, ${verstoesse.length} Verstöße.`,
  );
  return verstoesse.length === 0 ? EXIT_GRUEN : EXIT_ROT;
}

function gelesen(daten, stufe) {
  const { inhalt, fehler } = leseStufe(daten, stufe);
  if (fehler) throw new Error(fehler);
  return inhalt;
}

function messbarerPlan(daten) {
  const plan = gelesen(daten, { art: "plan" });
  if (plan.verstoesse.length > 0) throw new Error("Der Plan hat Verstöße; nichts zu messen.");
  return plan;
}

async function imArbeitsordner(rev, aufgabe) {
  const vorher = cwd();
  const ordner = realpathSync(mkdtempSync(join(tmpdir(), "totcode-")));
  legeArbeitsordnerAn(ordner, rev);
  chdir(ordner);
  try {
    return await aufgabe(ordner);
  } finally {
    chdir(vorher);
    entferneArbeitsordner(ordner);
    rmSync(ordner, { recursive: true, force: true });
  }
}

function auswahlDes(plan, paket) {
  if (paket === undefined)
    return { dateien: [...plan.menge.messmenge, ...plan.geloeschteQuellen], teil: undefined };
  return paketDes(plan, paket);
}

async function basis({ daten, aus, paket }) {
  const plan = messbarerPlan(daten);
  const { alteTests, gates } = plan.menge;
  const auswahl = auswahlDes(plan, paket);
  const { dateien, teil } = auswahl;
  const werte = await imArbeitsordner(plan.basis, async () => {
    const haupt = await messeGegenAlte({ dateien, alt: alteTests, gateAlt: [], teil });
    const gateStati = {};
    const ausgenommen = [...haupt.ausgenommen];
    for (const [name, tests] of Object.entries(gates)) {
      const lauf = await messeGegenAlte({ dateien, alt: [], gateAlt: tests, teil });
      gateStati[name] = statusListe(lauf.gate);
      ausgenommen.push(...lauf.ausgenommen);
    }
    return { mutanten: statusListe(haupt.mutanten), gates: gateStati, ausgenommen };
  });
  liefereStufe({ aus }, { art: "basis", plan, auswahl }, werte);
  return EXIT_GRUEN;
}

function dateiDes(schluessel) {
  return zerlegeSchluessel(schluessel).datei;
}

function zielkarte(abgebildet, stati) {
  return new Map(
    abgebildet.map(({ basis: alt, kopf: neu }) => {
      const { von, bis } = zerlegeSchluessel(neu);
      return [neu, { status: stati[alt], zeilen: [von.zeile, bis.zeile] }];
    }),
  );
}

async function messeImKopf({ stati, abbildung, graph, gateTests }) {
  const { abgebildet, gemischt } = bildeAlle({ basis: stati, abbildung });
  const ganz = [...new Set(gemischt.map(({ datei }) => datei))].sort();
  const gezielt = abgebildet.filter(({ kopf: neu }) => !ganz.includes(dateiDes(neu)));
  const ziele = zielkarte(gezielt, stati);
  const art = gateTests === undefined ? "mutanten" : "gate";
  const gates = new Set(gateTests ?? []);
  const dateien = [...new Set([...ziele.keys()].map(dateiDes))].sort();
  const basisStati = { mutanten: new Map(), gate: new Map(), [art]: ziele };
  const lauf = await messeGegenNeue({ dateien, basis: basisStati, neu: [], graph, gates });
  const ergebnis = { stati: statusListe(lauf[art]), ausgenommen: [...lauf.ausgenommen] };
  for (const datei of ganz) {
    const tests = erreichendeTests(datei, graph).filter(
      (test) => art !== "gate" || gates.has(test),
    );
    const voll = await messeGegenAlte({ dateien: [datei], alt: tests, gateAlt: [] });
    Object.assign(ergebnis.stati, statusListe(voll.mutanten));
    ergebnis.ausgenommen.push(...voll.ausgenommen);
  }
  return ergebnis;
}

function gateTestsImKopf(name) {
  const gates = existsSync(GATE_DATEI) ? JSON.parse(readFileSync(GATE_DATEI, "utf8")) : {};
  return (gates[name]?.tests ?? []).filter((pfad) => existsSync(pfad));
}

async function kopfMessung(plan, basisDaten) {
  const graph = await importgraph();
  const { abbildung } = plan;
  const haupt = await messeImKopf({ stati: basisDaten.mutanten, abbildung, graph });
  const gates = {};
  const ausgenommen = [...haupt.ausgenommen];
  for (const [name, stati] of Object.entries(basisDaten.gates)) {
    const gateTests = gateTestsImKopf(name);
    const lauf = await messeImKopf({ stati, abbildung, graph, gateTests });
    gates[name] = lauf.stati;
    ausgenommen.push(...lauf.ausgenommen);
  }
  return { mutanten: haupt.stati, gates, ausgenommen };
}

function probeDateien({ menge }) {
  const ganze = menge.geloeschteTests.map((pfad) => ({ pfad }));
  const dateien = [...new Set(menge.faelle.map(({ datei }) => datei))].sort();
  const teilweise = dateien.map((pfad) => ({
    pfad,
    faelle: menge.faelle.filter(({ datei }) => datei === pfad).map(({ fall }) => fall),
  }));
  return [...ganze, ...teilweise];
}

function legeBasisHilfenZurueck(ordner, plan) {
  const pfade = git(["ls-tree", "-r", "--name-only", "-z", plan.basis, "--", "test/"], ordner)
    .split("\0")
    .filter(Boolean);
  const proben = new Set(probeDateien(plan).map(({ pfad }) => pfad));
  const zurueck = pfade.filter((pfad) => !TESTDATEI.test(pfad) || proben.has(pfad));
  const pfadliste = ["--pathspec-from-file=-", "--pathspec-file-nul"];
  if (zurueck.length > 0) git(["checkout", plan.basis, ...pfadliste], ordner, zurueck.join("\0"));
}

function textAus(datei) {
  return existsSync(datei) ? readFileSync(datei, "utf8") : "";
}

async function probelauf(ordner, pfad) {
  const ablage = mkdtempSync(join(tmpdir(), "rotprobe-"));
  const [faelleDatei, ausgabeDatei] = [join(ablage, "faelle.jsonl"), join(ablage, "ausgabe.txt")];
  try {
    const berichte = [
      `--test-reporter=${BERICHT}`,
      `--test-reporter-destination=${faelleDatei}`,
      "--test-reporter=spec",
      `--test-reporter-destination=${ausgabeDatei}`,
    ];
    const exit = await inEigenerGruppe(["--test", ...berichte, ...patternFlagsFor(BANK), pfad], {
      cwd: ordner,
      stdio: "ignore",
      env: { ...env, NODE_ENV: "test", TMPDIR: ablage },
      timeout: PROBEZEIT_MS,
    });
    const zeilen = textAus(faelleDatei).split("\n");
    const faelle = zeilen
      .filter(Boolean)
      .map((zeile) => JSON.parse(zeile))
      .filter(({ zeile }) => Number.isInteger(zeile));
    return { faelle, ausgabe: textAus(ausgabeDatei), regulaer: REGULAERE_ENDEN.has(exit) };
  } finally {
    rmSync(ablage, { recursive: true, force: true });
  }
}

function zielVon(importierer, quelle) {
  if (!RELATIV.test(quelle)) return undefined;
  return posix.normalize(posix.join(posix.dirname(importierer), quelle.replace(ANHANG, "")));
}

function namensraumNamen(name, knoten) {
  const zugriffe = knoten.filter(
    (teil) =>
      teil.type === "MemberExpression" &&
      !teil.computed &&
      teil.object.type === "Identifier" &&
      teil.object.name === name,
  );
  const nutzungen = knoten.filter((teil) => teil.type === "Identifier" && teil.name === name);
  if (zugriffe.length === 0 || nutzungen.length !== zugriffe.length + 1) return null;
  return zugriffe.map(({ property }) => property.name);
}

function bezeichner(knoten) {
  return knoten.name ?? knoten.value;
}

function angefragteNamen(angabe, knoten) {
  switch (angabe.type) {
    case "ImportSpecifier":
      return [bezeichner(angabe.imported)];
    case "ImportDefaultSpecifier":
      return ["default"];
    case "ImportNamespaceSpecifier":
      return namensraumNamen(angabe.local.name, knoten);
    default:
      return [bezeichner(angabe.local)];
  }
}

function namenDes(eintrag, knoten) {
  if (!IMPORTKNOTEN.has(eintrag.type) || eintrag.specifiers.length === 0) return null;
  const namen = eintrag.specifiers.map((angabe) => angefragteNamen(angabe, knoten));
  return namen.includes(null) ? null : namen.flat();
}

function importierteNamen(ordner, { importierer, modul }) {
  const knoten = syntaxknoten(importierer, textAus(join(ordner, importierer)));
  if (knoten === undefined) return null;
  const treffer = knoten.filter(
    (teil) => teil.source?.type === "Literal" && zielVon(importierer, teil.source.value) === modul,
  );
  const namen = treffer.map((eintrag) => namenDes(eintrag, knoten));
  if (namen.length === 0 || namen.includes(null)) return null;
  return [...new Set(namen.flat())].sort();
}

function exportiertEinen(text, namen) {
  return namen.some((name) =>
    name === "default" ? STANDARD_EXPORT.test(text) : enthaeltWort(text, name),
  );
}

function deklarierteNamen(deklaration) {
  if (!deklaration) return [];
  if (deklaration.type !== "VariableDeclaration")
    return deklaration.id ? [deklaration.id.name] : [];
  return deklaration.declarations.flatMap((teil) => gebundeneNamen(teil).map(({ name }) => name));
}

function basisExporte(rev, modul) {
  if (!gitGelingt(["cat-file", "-e", `${rev}:${modul}`])) return new Set();
  return exporteAus(modul, git(["show", `${rev}:${modul}`]));
}

function exporteAus(modul, text) {
  const knoten = syntaxknoten(modul, text) ?? [];
  const namen = new Set();
  for (const teil of knoten) {
    if (teil.type === "ExportDefaultDeclaration") namen.add("default");
    if (teil.type !== "ExportNamedDeclaration") continue;
    for (const name of deklarierteNamen(teil.declaration)) namen.add(name);
    for (const { exported } of teil.specifiers) namen.add(bezeichner(exported));
  }
  return namen;
}

function fehlendesModul(ordner, ausgabe) {
  const treffer = MODUL_FEHLT.exec(ausgabe);
  if (treffer === null) return undefined;
  const [, modul, importierer] = treffer;
  return {
    art: "modul",
    modul: relative(ordner, modul),
    importierer: relative(ordner, importierer.trim()),
  };
}

function fehlenderExport(ordner, ausgabe) {
  const zeilen = ausgabe.split("\n");
  const stelle = zeilen.findIndex((zeile) => EXPORT_FEHLT.test(zeile));
  if (stelle === -1) return undefined;
  const [, quelle, name] = EXPORT_FEHLT.exec(zeilen[stelle]);
  const datei = zeilen
    .slice(0, stelle)
    .map((zeile) => DATEIZEILE.exec(zeile))
    .findLast(Boolean);
  if (datei === undefined) return undefined;
  const importierer = relative(ordner, fileURLToPath(datei[1]));
  const modul = zielVon(importierer, quelle);
  return modul === undefined ? undefined : { art: "export", modul, name, importierer };
}

function fehlendeZiele(ordner, importierer) {
  const knoten = syntaxknoten(importierer, textAus(join(ordner, importierer))) ?? [];
  const quellen = knoten
    .map(({ source }) => source)
    .filter((quelle) => quelle?.type === "Literal" && typeof quelle.value === "string");
  const ziele = quellen
    .map((quelle) => zielVon(importierer, quelle.value))
    .filter((ziel) => ziel !== undefined && !existsSync(join(ordner, ziel)));
  return [...new Set(ziele)].sort();
}

function geloeschtesModulGrund(modul, { geloescht }) {
  const vorne = `scheitert im Kopf beim Laden an ${modul}`;
  if (!MESSBAR.test(modul)) return `${vorne}; das ist kein Modul unter src/, scripts/ oder tools/`;
  if (!geloescht.includes(modul)) return `${vorne}; der PR löscht es nicht`;
  return undefined;
}

function modulGrund({ modul: gemeldet, importierer }, kontext) {
  const module = [...new Set([gemeldet, ...fehlendeZiele(kontext.ordner, importierer)])];
  for (const modul of module) {
    const grund =
      geloeschtesModulGrund(modul, kontext.plan.pr) ?? umzugsGrund({ modul, importierer }, kontext);
    if (grund !== undefined) return grund;
  }
  return undefined;
}

function umzugsGrund({ modul, importierer }, kontext) {
  const { neu: angelegt } = kontext.plan.pr;
  const namen = importierteNamen(kontext.ordner, { importierer, modul });
  const neu = angelegt.filter(
    (datei) => namen === null || exportiertEinen(textAus(join(kontext.ordner, datei)), namen),
  );
  if (neu.length === 0) return undefined;
  const genannt =
    namen === null ? "die genutzten Namen lassen sich nicht bestimmen" : namen.join(", ");
  return `${UMGEZOGEN}: ${modul} fehlt, aber der PR legt ${neu.join(", ")} neu an (${genannt})`;
}

function exportGrund({ modul, name: gemeldet, importierer }, kontext) {
  if (!MESSBAR.test(modul))
    return `scheitert im Kopf beim Laden am Export ${gemeldet} aus ${modul}; das ist kein Modul unter src/, scripts/ oder tools/`;
  const genutzt = importierteNamen(kontext.ordner, { importierer, modul }) ?? [];
  const vorhanden = exporteAus(modul, textAus(join(kontext.ordner, modul)));
  const fehlend = [...new Set([gemeldet, ...genutzt.filter((name) => !vorhanden.has(name))])];
  for (const name of fehlend) {
    const grund = einzelExportGrund({ modul, name }, kontext);
    if (grund !== undefined) return grund;
  }
  return undefined;
}

function einzelExportGrund({ modul, name }, kontext) {
  const vorne = `scheitert im Kopf beim Laden am Export ${name} aus ${modul}`;
  if (!basisExporte(kontext.plan.basis, modul).has(name))
    return `${vorne}; den Export gab es dort in der Basis nicht`;
  const neu = kontext.deklarierende(name);
  if (neu.length === 0) return undefined;
  return `${UMGEZOGEN}: der Export ${name} fehlt in ${modul}, steht aber neu in ${neu.join(", ")}`;
}

function ladeVerstoesse(ordner, pfad, { ausgabe, kontext }) {
  const befund = fehlendesModul(ordner, ausgabe) ?? fehlenderExport(ordner, ausgabe);
  if (befund === undefined) {
    const grund =
      "scheitert im Kopf beim Laden, aber nicht an einem fehlenden Modul oder Export unter src/, scripts/ oder tools/";
    return [{ datei: pfad, grund }];
  }
  const grund = befund.art === "modul" ? modulGrund(befund, kontext) : exportGrund(befund, kontext);
  return grund === undefined ? [] : [{ datei: pfad, grund }];
}

function lebendeFaelle(pfad, faelle) {
  return faelle
    .filter(({ rot }) => !rot)
    .map(({ name, still }) => ({
      datei: pfad,
      fall: name,
      grund: still
        ? "übersprungen: der Fall läuft im Kopf nicht und ist damit nicht rot"
        : "lebender Test: der Fall ist im Kopf grün",
    }));
}

function fallVerstoesse({ pfad, faelle: gelistet }, faelle) {
  if (gelistet === undefined) {
    if (faelle.length === 0) return [{ datei: pfad, grund: "liefert im Kopf keinen Fall" }];
    return lebendeFaelle(pfad, faelle);
  }
  const grund = "der Fall läuft im Kopf nicht und ist damit nicht rot";
  const fehlend = gelistet.filter((fall) => !faelle.some(({ name }) => name === fall));
  return [...fehlend.map((fall) => ({ datei: pfad, fall, grund })), ...lebendeFaelle(pfad, faelle)];
}

async function rotprobeDer(ordner, probe, kontext) {
  const lauf = await probelauf(ordner, probe.pfad);
  const ergebnis = ({ name, rot, still }) => ({ datei: probe.pfad, name, rot, still });
  if (!lauf.regulaer) {
    const grund =
      "der Lauf endete im Kopf nicht regulär (Abbruch, Signal oder Zeitgrenze); fehlende Fälle wären ungeprüft";
    return { faelle: lauf.faelle.map(ergebnis), verstoesse: [{ datei: probe.pfad, grund }] };
  }
  if (lauf.faelle.some(({ name }) => name === probe.pfad)) {
    const verstoesse = ladeVerstoesse(ordner, probe.pfad, { ausgabe: lauf.ausgabe, kontext });
    return { faelle: lauf.faelle.map(ergebnis), verstoesse };
  }
  const faelle =
    probe.faelle === undefined
      ? lauf.faelle
      : lauf.faelle.filter(({ name }) => probe.faelle.includes(name));
  return { faelle: faelle.map(ergebnis), verstoesse: fallVerstoesse(probe, faelle) };
}

function kopfKontext(ordner, plan) {
  let eingefuegt;
  const deklarierende = (name) => {
    eingefuegt ??= eingefuegteTexte(plan, PRODUKTORDNER);
    const pfade = eingefuegt.filter(({ text }) => enthaeltWort(text, name)).map(({ pfad }) => pfad);
    return [...new Set(pfade)].sort();
  };
  return { ordner, plan, deklarierende };
}

async function rotprobe(ordner, plan) {
  legeBasisHilfenZurueck(ordner, plan);
  const kontext = kopfKontext(ordner, plan);
  const proben = [];
  for (const probe of probeDateien(plan)) proben.push(await rotprobeDer(ordner, probe, kontext));
  return {
    faelle: proben.flatMap(({ faelle }) => faelle),
    verstoesse: proben.flatMap(({ verstoesse }) => verstoesse),
  };
}

function zielDes({ aus, kanal }) {
  if ((aus === undefined) === (kanal === undefined))
    throw new Error("Genau eins von --aus und --kanal angeben.");
  return { aus, kanal };
}

async function kopf({ daten, aus, kanal, paket }) {
  const ziel = zielDes({ aus, kanal });
  const plan = messbarerPlan(daten);
  const auswahl = auswahlDes(plan, paket);
  const basisDaten = gelesen(daten, { art: "basis", erwartet: plan, paket: auswahl.nummer });
  const messung = await imArbeitsordner(plan.kopf, () => kopfMessung(plan, basisDaten));
  if (auswahl.nummer !== undefined) {
    liefereStufe(ziel, { art: "kopf", plan, auswahl }, messung);
    return EXIT_GRUEN;
  }
  const probe = await imArbeitsordner(plan.kopf, (ordner) => rotprobe(ordner, plan));
  liefereStufe(ziel, { art: "kopf", plan, auswahl }, { ...messung, rotprobe: probe });
  return EXIT_GRUEN;
}

async function rotprobeSchritt({ daten, aus, kanal }) {
  const ziel = zielDes({ aus, kanal });
  const plan = messbarerPlan(daten);
  const probe = await imArbeitsordner(plan.kopf, (ordner) => rotprobe(ordner, plan));
  liefereStufe(ziel, { art: "rotprobe", plan, auswahl: {} }, probe);
  return EXIT_GRUEN;
}

function stufen(daten) {
  const plan = leseStufe(daten, { art: "plan" });
  const weitere = ["basis", "kopf"].map((art) => leseStufe(daten, { art, erwartet: plan.inhalt }));
  const alle = [plan, ...weitere];
  return {
    plan: plan.inhalt,
    basis: weitere[0].inhalt,
    kopf: weitere[1].inhalt,
    fehler: alle.map(({ fehler }) => fehler).filter(Boolean),
  };
}

function entscheiden({ daten, aus }) {
  const stand = stufen(daten);
  const gruende = stand.fehler.length > 0 ? stand.fehler : gruendeDer(stand);
  const inhalt = ergebnisInhalt(stand.plan, gruende);
  schreibeErgebnis(aus, "ergebnis", { ...inhalt, pruefsumme: pruefsumme(JSON.stringify(inhalt)) });
  for (const grund of gruende) console.log(`Verstoß: ${grund}`);
  console.log(`Totcode-Messung ${inhalt.urteil}: ${gruende.length} Gründe.`);
  return gruende.length === 0 ? EXIT_GRUEN : EXIT_ROT;
}

const BEFEHLE = new Map(
  Object.entries({ planen, basis, kopf, rotprobe: rotprobeSchritt, entscheiden }),
);

async function main() {
  const argumente = parseArgs({
    allowPositionals: true,
    options: {
      basis: { type: "string" },
      kopf: { type: "string" },
      liste: { type: "string" },
      daten: { type: "string" },
      aus: { type: "string" },
      kanal: { type: "string" },
      paket: { type: "string" },
    },
  });
  const name = gewaehlterBefehl(argumente, { pflicht: PFLICHT, aufruf: AUFRUF });
  if (name === undefined) return EXIT_ROT;
  if (MESSENDE_BEFEHLE.has(name)) await nimmSperreAuchFuerKindprozesse(`totcode ${name}`);
  return BEFEHLE.get(name)(argumente.values);
}

try {
  process.exitCode = await main();
} catch (fehler) {
  console.error(`Totcode-Messung: Abbruch: ${fehler.message}`);
  process.exitCode = EXIT_ROT;
}
