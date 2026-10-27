import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "node:process";

import { testAgentPrompt } from "./agenten.mjs";
import { abnahmeBefehl, hatSkript } from "./befehle.mjs";
import { aenderungenSeit, arbeitsstand, gemeinsamerOrdner, git, kopf } from "./git.mjs";
import { gemeint, gleichwertigGemeldet, gleichwertigZeile, nachbewertet } from "./gleichwertig.mjs";
import { GRUND, PRUEFUNG, absatzVerlangt, zweckBlock } from "./zweck.mjs";

const SKRIPT = "test:mutation";
const MUTATION_IN_CI = "HERMES_MUTATION_IN_CI";
const IN_CI = ["--in-ci"];
const EXIT_UEBERLEBT = 1;
const UEBERLEBT = /^Verstoß: Mutant überlebt: (.+)$/gm;
const ERSTLAUF_ROT = /^Abbruch: (Erstlauf rot: .+)$/gm;
const ABLAGE = "auftrag-umbau";
const PATCH_FORMAT = ["--no-ext-diff", "--no-color", "--src-prefix=a/", "--dst-prefix=b/"];
const MELDEN = [
  "Ändert ein Mutant kein beobachtbares Verhalten, antworte statt eines Tests mit einer Zeile je Mutant:",
  "Gleichwertig: <Mutant>, weil <ein Satz>",
  "",
];

function treffer(text, muster) {
  return [...text.matchAll(muster)].map(([, wert]) => wert.trim());
}

function liste(mutanten) {
  return mutanten.map((mutant) => `- ${mutant}`).join("\n");
}

function gleichwertige(lauf) {
  return gleichwertigGemeldet(lauf.berichtszeilen.join("\n"));
}

function abbruch(name, exitCode, ausgabe) {
  const rote = treffer(ausgabe, ERSTLAUF_ROT);
  return rote.length > 0 ? `${name} ist mit Exit ${exitCode} abgebrochen: ${rote.join("; ")}` : `${name} ist mit Exit ${exitCode} abgebrochen.`;
}

function abbruchExit(exitCode) {
  return exitCode !== 0 && exitCode !== EXIT_UEBERLEBT;
}

function mutationsBefehl(lauf, argumente) {
  const gemeldet = gleichwertige(lauf).flatMap((mutant) => ["--gleichwertig", mutant]);
  const weg = env[MUTATION_IN_CI] === "1" ? IN_CI : [];
  return ["npm", "--silent", "run", SKRIPT, "--", ...weg, ...argumente, ...gemeldet];
}

function ausgewertet(lauf, name, { exitCode, ausgabe }) {
  if (exitCode === 0) return { ende: true };
  if (abbruchExit(exitCode)) return { ende: lauf.scheitert(abbruch(name, exitCode, ausgabe), GRUND.MUTATION_ABBRUCH) };
  return { ueberlebende: treffer(ausgabe, UEBERLEBT), ausgabe };
}

function mutanten(lauf, name, argumente) {
  const befehl = mutationsBefehl(lauf, argumente);
  const erster = lauf.pruefung(name, befehl);
  return ausgewertet(lauf, name, abbruchExit(erster.exitCode) ? lauf.pruefung(name, befehl) : erster);
}

function vorgemerkterCodestand(lauf) {
  const { root } = lauf.kontext;
  lauf.allesVormerken();
  return [lauf.basis, kopf(root), arbeitsstand(root)].join(" ");
}

function nachBauAbgeleitet(lauf, ausgabe) {
  const name = PRUEFUNG.MUTATION_NACH_BAU;
  const neu = nachbewertet(ausgabe, new Set(gleichwertige(lauf)));
  if (neu === null) return null;
  const hinweis = `Hinweis: ${name} nicht neu ausgeführt: Code und Tests seit ${PRUEFUNG.MUTATION} unverändert, Ergebnis daraus mit den Gleichwertig-Meldungen neu bewertet.`;
  const befehl = mutationsBefehl(lauf, ["--basis", lauf.basis]).join(" ");
  const ergebnis = { name, befehl, exitCode: neu.rot ? EXIT_UEBERLEBT : 0, ausgabe: [hinweis, ...neu.zeilen].join("\n"), dauer_ms: 0 };
  return ausgewertet(lauf, name, lauf.belegt(name, () => ergebnis));
}

function bauNachrunde(ueberlebende) {
  return [
    "## Überlebende Mutanten",
    "",
    ...zweckBlock(PRUEFUNG.MUTATION),
    absatzVerlangt([PRUEFUNG.MUTATION]),
    "",
    "Diese Mutanten in deinen neuen Zeilen überleben, kein Test verlangt die Zeilen:",
    "",
    liste(ueberlebende),
    "",
    "Ist die Zeile nötig und fehlt nur ein Test, der sie verlangt, änderst du sie nicht und antwortest mit einer Zeile je Mutant:",
    "Nötig: <Mutant>, weil <ein Satz>",
    "Streichen oder vereinfachen darfst du eine Zeile nur, wenn danach jede Eingabe, auch Fehlerfall und leerer Wert, dasselbe Ergebnis liefert wie vorher. Tests änderst du nicht.",
    "Ändert ein Mutant kein beobachtbares Verhalten, antworte statt Streichen mit einer Zeile je Mutant:",
    "Gleichwertig: <Mutant>, weil <ein Satz>",
    "",
  ].join("\n");
}

function testNachrunde(kontext, ueberlebende, { stand, melden, noetig = [], zweck }) {
  const { auftrag } = kontext;
  const aufgabe = `Diese Mutanten ${stand} überleben. Ergänze in ${auftrag.abnahme} Fälle, die sie töten; Produktcode änderst du nicht.`;
  const zeilen = [testAgentPrompt(kontext), "## Überlebende Mutanten", "", ...zweckBlock(zweck), absatzVerlangt([zweck]), "", aufgabe, "", liste(ueberlebende), ""];
  const begruendet = noetig.length > 0 ? ["Der Bau-Agent hält diese Zeilen für nötig:", liste(noetig.map(({ mutant, grund }) => `${mutant}, weil ${grund}`)), ""] : [];
  return [...zeilen, ...begruendet, ...(melden ? MELDEN : [])].join("\n");
}

function bauNachrundeGemeldet(lauf, ueberlebende) {
  const { sitzung } = lauf.agenten.findLast(({ rolle }) => rolle === "bau");
  lauf.meldet(PRUEFUNG.MUTATION, "bau");
  const weg = lauf.setzeAgentEinUndUebernimmAusgang("bau", bauNachrunde(ueberlebende), sitzung);
  if (weg === null) return null;
  const noetig = weg.noetig.filter(({ mutant }) => ueberlebende.includes(mutant));
  const gleichwertig = weg.gleichwertig.filter(({ mutant }) => ueberlebende.includes(mutant) && !noetig.some((eintrag) => eintrag.mutant === mutant));
  for (const { mutant, grund } of gleichwertig) lauf.berichtszeilen.push(gleichwertigZeile(mutant, grund));
  return noetig;
}

function bauSchritteOhneAgentWiederholt(lauf) {
  return lauf.bauSchritte().slice(1).every((schritt) => schritt());
}

function testErgaenzt(lauf, ueberlebende, vorgabe) {
  lauf.meldet(vorgabe.zweck, "test");
  const weg = lauf.setzeAgentEinUndUebernimmAusgang(
    "test",
    testNachrunde(lauf.kontext, ueberlebende, vorgabe),
  );
  return weg !== null && lauf.grenzen("test", lauf.basisBau) ? weg : null;
}

function testNachgeholt(lauf, ueberlebende, noetig) {
  return (
    lauf.zwischenstand() &&
    testErgaenzt(lauf, ueberlebende, { stand: "in den neuen Zeilen", melden: false, noetig, zweck: PRUEFUNG.MUTATION }) &&
    lauf.allesVormerken() &&
    lauf.gruen(PRUEFUNG.ABNAHME, abnahmeBefehl(lauf.kontext.auftrag))
  );
}

function neueZeilen(lauf) {
  const pruefen = (name) => mutanten(lauf, name, ["--basis", lauf.basis]);
  const vorher = vorgemerkterCodestand(lauf);
  let stand = pruefen(PRUEFUNG.MUTATION);
  if (stand.ende !== undefined) return stand.ende;
  const noetig = bauNachrundeGemeldet(lauf, stand.ueberlebende);
  if (noetig === null || !bauSchritteOhneAgentWiederholt(lauf)) return false;
  stand = (vorgemerkterCodestand(lauf) === vorher ? nachBauAbgeleitet(lauf, stand.ausgabe) : null) ?? pruefen(PRUEFUNG.MUTATION_NACH_BAU);
  if (stand.ende !== undefined) return stand.ende;
  if (!testNachgeholt(lauf, stand.ueberlebende, noetig)) return false;
  stand = pruefen(PRUEFUNG.MUTATION_NACH_TEST);
  return stand.ende ?? lauf.scheitert(`Mutant überlebt: ${stand.ueberlebende[0]}`);
}

function ablage({ root, phase, auftrag }) {
  return gemeinsamerOrdner(root, ABLAGE, phase.phase, `${auftrag.id}.patch`);
}

function sichern(lauf, basis) {
  const datei = ablage(lauf.kontext);
  mkdirSync(dirname(datei), { recursive: true });
  lauf.allesVormerken();
  git(["diff", "--cached", "--binary", ...PATCH_FORMAT, `--output=${datei}`, basis], { cwd: lauf.kontext.root });
  return datei;
}

function neueZeilenGesichert(lauf) {
  const basis = lauf.basisBau;
  return neueZeilen(lauf) || lauf.gesichert(sichern(lauf, basis));
}

function zurueckstellen(lauf) {
  const { root } = lauf.kontext;
  const datei = sichern(lauf, lauf.basisBau);
  git(["reset", "-q", "--hard", lauf.basisBau], { cwd: root });
  git(["clean", "-q", "-fd"], { cwd: root });
  return { datei, inhalt: readFileSync(datei, "utf8") };
}

function testsFesthalten(lauf, ueberlebende) {
  const { phase, auftrag } = lauf.kontext;
  lauf.allesVormerken();
  const warum = `Warum: Auf dem alten Stand überleben ${ueberlebende.length} Mutanten des Umbaus ${auftrag.id} der Phase ${phase.phase}; diese Tests halten das Verhalten vor dem Umbau fest.`;
  const herkunft = [`Auftrag: ${phase.phase}/${auftrag.id}`, ...(phase.paket ? [`Paket: ${phase.paket}`] : [])];
  const begruendung = lauf.uebernimmBegruendung(["test"]);
  return lauf.festschreiben(PRUEFUNG.TESTS_ALTER_STAND, [`Halte Verhalten vor Umbau ${auftrag.id} fest`, "", warum, "", ...begruendung, ...herkunft, ""].join("\n"));
}

function spieleUnveraendertenPatchEin(lauf, { datei, inhalt }) {
  const befehl = ["git", "apply", "--index", datei];
  if (readFileSync(datei, "utf8") === inhalt) return lauf.pruefung(PRUEFUNG.UMBAU_EINSPIELEN, befehl).exitCode === 0;
  lauf.belegt(PRUEFUNG.UMBAU_EINSPIELEN, () => ({ name: PRUEFUNG.UMBAU_EINSPIELEN, befehl, exitCode: 1, ausgabe: `Der Patch in ${datei} wurde seit dem Sichern verändert.` }));
  return false;
}

function spieleUmbauEinOderBaueNeu(lauf, patch) {
  const passt = spieleUnveraendertenPatchEin(lauf, patch);
  const schritte = lauf.bauSchritte();
  return (passt ? schritte.slice(1) : schritte).every((schritt) => schritt());
}

function entscheidung(lauf, { ueberlebende, vorher, gemeldet, patch }) {
  const { phase, auftrag } = lauf.kontext;
  const grund = `Umbau zurückgestellt: auf dem alten Stand überleben ${ueberlebende.length} Mutanten, vorher ${vorher}.`;
  const meldezeilen = [...gemeldet].filter(([mutant]) => ueberlebende.includes(mutant)).map(([mutant, begruendung]) => gleichwertigZeile(mutant, begruendung));
  const notiz = [
    "Die letzte Runde mit dem Test-Agenten hat die Zahl der überlebenden Mutanten auf dem alten Stand nicht gesenkt.",
    `Der Umbau ist nicht committet; er liegt als Patch in ${patch.datei}. Die Tests der bisherigen Runden stehen im Branch.`,
    "",
    ...zweckBlock(PRUEFUNG.MUTATION_ALTER_STAND),
    "",
    "Überlebende Mutanten:",
    liste(ueberlebende),
    ...(meldezeilen.length > 0 ? ["", "Gleichwertig laut Test-Agent, braucht eine Freigabe:", ...meldezeilen] : []),
  ].join("\n");
  const kopfzeile = `Auftrag ${auftrag.id} der Phase ${phase.phase}: ${grund}`;
  return lauf.entscheidungNoetig({ kopf: kopfzeile, anlass: grund, verlauf: [grund], notiz });
}

function testRunde(lauf, ueberlebende, gemeldet) {
  const weg = testErgaenzt(lauf, ueberlebende, { stand: "auf dem alten Stand", melden: true, zweck: PRUEFUNG.MUTATION_ALTER_STAND });
  if (weg === null) return false;
  for (const { mutant, grund } of weg.gleichwertig) {
    for (const schluessel of ueberlebende.filter((ueberlebend) => gemeint(mutant, ueberlebend))) gemeldet.set(schluessel, grund);
  }
  if (aenderungenSeit(lauf.basisBau, lauf.kontext.root).length === 0) return null;
  return lauf.statischeTestpruefung() && lauf.kopien() && lauf.abhaengigkeiten() && lauf.vorherGruen() && testsFesthalten(lauf, ueberlebende);
}

function alterStand(lauf) {
  if (lauf.kontext.auftrag.art !== "umbau") return true;
  const gemeldet = new Map();
  let vorher = Infinity;
  for (;;) {
    const stand = mutanten(lauf, PRUEFUNG.MUTATION_ALTER_STAND, ["--basis", lauf.basisBau, "--alter-stand"]);
    if (stand.ende !== undefined) return stand.ende;
    const { ueberlebende } = stand;
    const patch = zurueckstellen(lauf);
    if (ueberlebende.length >= vorher) return entscheidung(lauf, { ueberlebende, vorher, gemeldet, patch });
    lauf.hinweise.push(`Umbau verworfen: auf dem alten Stand überlebt ${ueberlebende[0]}`);
    vorher = ueberlebende.length;
    const getestet = testRunde(lauf, ueberlebende, gemeldet);
    if (getestet === null) return entscheidung(lauf, { ueberlebende, vorher, gemeldet, patch });
    if (!getestet || !spieleUmbauEinOderBaueNeu(lauf, patch)) return false;
  }
}

export function mutationsSchritte(lauf) {
  if (hatSkript(lauf.kontext.root, SKRIPT)) return [() => alterStand(lauf), () => neueZeilenGesichert(lauf)];
  lauf.hinweise.push(`Mutationsprüfung: package.json hat kein Skript ${SKRIPT}.`);
  return [];
}
