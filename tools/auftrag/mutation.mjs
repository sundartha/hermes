import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "node:process";

import { testAgentPrompt, testumbauPrompt } from "./agenten.mjs";
import { vorabGeprueft, vorabHerkunft } from "./absicherungsbeleg.mjs";
import { abnahmeBefehl, hatSkript } from "./befehle.mjs";
import { PATCH_FORMAT, ablagePfad, mitUeberlebenden, sichereFortsetzung, spieleNachrundeEin } from "./fortsetzung.mjs";
import { aenderungenSeit, arbeitsstand, git, kopf } from "./git.mjs";
import { gemeint, gleichwertigGemeldet, gleichwertigZeile, meldungsZeile, nachbewertet } from "./gleichwertig.mjs";
import { fuehreAusMitFortschritt } from "./fortschritt.mjs";
import { phasenbasis } from "./phasenende.mjs";
import { LOKAL_STATT_CI_ANFANG, NUR_INFRASTRUKTUR_ZEILE } from "../mutationspruefung/lauf-einordnung.mjs";
import { GRUND, PRUEFUNG, absatzVerlangt, zweckBlock } from "./zweck.mjs";

const SKRIPT = "test:mutation";
const MUTATION_IN_CI = "HERMES_MUTATION_IN_CI";
const IN_CI = ["--in-ci"];
const TESTUMBAU_MESSUNG = "--testumbau";
const TESTUMBAU = "testumbau";
const EXIT_UEBERLEBT = 1;
const UEBERLEBT = /^Verstoß: Mutant überlebt: (.+)$/gm;
const ERSTLAUF_ROT = /^Abbruch: (Erstlauf rot: .+)$/gm;
const AM_BUDGET = /^Abbruch: Budget\b.*kein Urteil\.$/m;
const BUDGET_ZEILEN = /^((?:Vorschau |Abbruch: Budget\b|Mutationslog: Ende nach ).*)$/gm;
const MELDEN = [
  "Ändert ein Mutant kein beobachtbares Verhalten, antworte statt eines Tests mit einer Zeile je Mutant:",
  "Gleichwertig: <Mutant>, weil <ein Satz>",
  "",
];
const WIDERSPRUCH = [
  "Findest du zu einem Mutanten aus „Der Bau-Agent hält diese Zeilen für nötig“ keinen Test, der ihn tötet, weil die Zeile kein beobachtbares Verhalten ändert, steige nicht aus, sondern antworte je Mutant mit einer Zeile:",
  "Widerspruch: <Mutant>, weil <bei welcher Eingabe sich nichts ändert und warum keine andere Eingabe etwas ändert>",
  "Die Zeile nimmt nichts an. Sie geht mit deiner Begründung einmal an den Bau-Agenten zurück; schreibe <Mutant> wörtlich wie in der Liste.",
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

function amBudget(ausgabe) {
  return AM_BUDGET.test(ausgabe);
}

function budgetEnde(lauf, name, ausgabe) {
  const { phase, auftrag } = lauf.kontext;
  const grund = `${name} am Budget beendet, kein Urteil; die Prüfung läuft nicht noch einmal.`;
  return lauf.entscheidungNoetig({ kopf: `Auftrag ${auftrag.id} der Phase ${phase.phase}: ${grund}`, anlass: grund, verlauf: [grund, ...treffer(ausgabe, BUDGET_ZEILEN)] });
}

function skriptAufruf(argumente) {
  return ["npm", "--silent", "run", SKRIPT, "--", ...argumente];
}

export function mutationsBefehl(lauf, argumente) {
  const gemeldet = argumente.includes(TESTUMBAU_MESSUNG) ? [] : gleichwertige(lauf).flatMap((mutant) => ["--gleichwertig", mutant]);
  const weg = env[MUTATION_IN_CI] === "1" ? IN_CI : [];
  return skriptAufruf([...weg, ...argumente, ...gemeldet]);
}

function ausgewertet(lauf, name, { exitCode, ausgabe, muster = UEBERLEBT }) {
  if (exitCode === 0) return { ende: true, ueberlebende: [], ausgabe };
  if (amBudget(ausgabe)) return { ende: budgetEnde(lauf, name, ausgabe) };
  if (abbruchExit(exitCode)) return { ende: lauf.scheitert(abbruch(name, exitCode, ausgabe), GRUND.MUTATION_ABBRUCH) };
  return { ueberlebende: treffer(ausgabe, muster), ausgabe };
}

function inCi() {
  return env[MUTATION_IN_CI] === "1";
}

function pruefe(lauf, name, befehl) {
  const { root } = lauf.kontext;
  return inCi() ? lauf.belegt(name, () => fuehreAusMitFortschritt(name, befehl, { cwd: root, env })) : lauf.pruefung(name, befehl);
}

function wiederholbar(ergebnis) {
  if (!abbruchExit(ergebnis.exitCode) || amBudget(ergebnis.ausgabe)) return false;
  const lokal = !inCi() || ergebnis.ausgabe.includes(LOKAL_STATT_CI_ANFANG);
  if (lokal) return treffer(ergebnis.ausgabe, ERSTLAUF_ROT).length === 0;
  return ergebnis.ausgabe.includes(NUR_INFRASTRUKTUR_ZEILE);
}

function geprueft(lauf, name, { befehl, muster }) {
  const erster = pruefe(lauf, name, befehl);
  return ausgewertet(lauf, name, { ...(wiederholbar(erster) ? pruefe(lauf, name, befehl) : erster), muster });
}

function vorgemerkterCodestand(lauf) {
  const { root } = lauf.kontext;
  lauf.allesVormerken();
  return [lauf.basis, kopf(root), arbeitsstand(root)].join(" ");
}

function mutanten(lauf, name, argumente) {
  return geprueft(lauf, name, { befehl: mutationsBefehl(lauf, argumente), muster: UEBERLEBT });
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

function widerspruchAbschnitt(widerspruch) {
  if (widerspruch.length === 0) return [];
  const kopf = "Der Test-Agent findet keinen Test, der diese Mutanten tötet, und widerspricht deinem „Nötig“:";
  const folge = "Vereinfache die Zeile oder melde „Gleichwertig“. Bleibt sie nötig, antworte noch einmal mit „Nötig“; dann hält der Lauf an und Antonio entscheidet.";
  return [kopf, "", liste(widerspruch.map(({ mutant, widerspruch: grund }) => `${mutant}, weil ${grund}`)), "", folge, ""];
}

function bauNachrunde(ueberlebende, widerspruch) {
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
    ...widerspruchAbschnitt(widerspruch),
    "Schreibe <Mutant> in jeder Meldung wörtlich so, wie er in der Liste steht, mit Dateipfad.",
    "Ist die Zeile nötig und fehlt nur ein Test, der sie verlangt, änderst du sie nicht und antwortest mit einer Zeile je Mutant:",
    "Nötig: <Mutant>, weil <ein Satz>",
    "Streichen oder vereinfachen darfst du eine Zeile nur, wenn danach jede Eingabe, auch Fehlerfall und leerer Wert, dasselbe Ergebnis liefert wie vorher. Tests änderst du nicht.",
    "Ändert ein Mutant kein beobachtbares Verhalten, antworte statt Streichen mit einer Zeile je Mutant:",
    "Gleichwertig: <Mutant>, weil <ein Satz>",
    "",
  ].join("\n");
}

function mutantenAbschnitt(auftrag, ueberlebende, { stand, melden, noetig = [], widerspruch = false, zweck }) {
  const aufgabe = `Diese Mutanten ${stand} überleben. Ergänze in ${auftrag.abnahme} Fälle, die sie töten; Produktcode änderst du nicht.`;
  const zeilen = ["## Überlebende Mutanten", "", ...zweckBlock(zweck), absatzVerlangt([zweck]), "", aufgabe, "", liste(ueberlebende), ""];
  const begruendet = noetig.length > 0 ? ["Der Bau-Agent hält diese Zeilen für nötig:", liste(noetig.map(({ mutant, grund }) => `${mutant}, weil ${grund}`)), ""] : [];
  return [...zeilen, ...begruendet, ...(melden ? MELDEN : []), ...(widerspruch && noetig.length > 0 ? WIDERSPRUCH : [])];
}

function testNachrunde(kontext, ueberlebende, vorgabe) {
  const { auftrag } = kontext;
  const auftragsteil = auftrag.art === TESTUMBAU ? testumbauPrompt(kontext.phase, auftrag, kontext.root) : testAgentPrompt(kontext);
  return [auftragsteil, ...mutantenAbschnitt(auftrag, ueberlebende, vorgabe)].join("\n");
}

function meldungsZeilen(weg) {
  return [...weg.noetig.map((meldung) => ({ art: "Nötig", ...meldung })), ...weg.gleichwertig.map((meldung) => ({ art: "Gleichwertig", ...meldung }))];
}

function ohneSchluessel(weg, ueberlebende) {
  return meldungsZeilen(weg).filter(({ mutant }) => !ueberlebende.includes(mutant));
}

function meldungNachfrage(zeilen, ueberlebende) {
  return [
    "## Meldung ohne genauen Schlüssel",
    "",
    "Diese Zeilen deiner letzten Antwort nennen keinen Mutanten aus der Liste, wörtlich und mit Dateipfad:",
    "",
    liste(zeilen.map(meldungsZeile)),
    "",
    "Die genauen Schlüssel der Mutanten, die in deinen neuen Zeilen überleben:",
    "",
    liste(ueberlebende),
    "",
    "Wiederhole jede dieser Zeilen mit dem Schlüssel wörtlich aus dieser Liste, sonst ändert sich nichts. Ändere dabei keine Datei.",
    "",
  ].join("\n");
}

function neuGemeldet(erste, zweite) {
  const nachMutant = (meldungen) => [...new Map([...meldungen].map((meldung) => [meldung.mutant, meldung])).values()];
  return { noetig: nachMutant([...erste.noetig, ...zweite.noetig]), gleichwertig: nachMutant([...erste.gleichwertig, ...zweite.gleichwertig]) };
}

function genaueMeldungen(lauf, weg, { ueberlebende, rolle = "bau" }) {
  const zeilen = ohneSchluessel(weg, ueberlebende);
  if (zeilen.length === 0) return weg;
  const nachher = arbeitsstand(lauf.kontext.root);
  const antwort = lauf.fragtNach(rolle, meldungNachfrage(zeilen, ueberlebende), { nachher, geaendert: "Die Nachfrage zur Meldung hat Dateien geändert." });
  if (antwort === null) return null;
  for (const zeile of zeilen) lauf.hinweise.push(`Hinweis: Meldung ohne genauen Schlüssel, nachgefragt: ${meldungsZeile(zeile)}`);
  const weiter = ohneSchluessel(antwort, ueberlebende);
  if (weiter.length > 0) {
    lauf.scheitert(`Meldung passt zu keinem überlebenden Mutanten: ${weiter.map(meldungsZeile).join(" | ")}`);
    return null;
  }
  const passend = (meldungen) => meldungen.filter(({ mutant }) => ueberlebende.includes(mutant));
  return neuGemeldet({ noetig: passend(weg.noetig), gleichwertig: passend(weg.gleichwertig) }, antwort);
}

function bauNachrundeGemeldet(lauf, ueberlebende, widerspruch = []) {
  const sitzung = lauf.letzteSitzung("bau");
  lauf.meldet(PRUEFUNG.MUTATION, "bau");
  const erste = lauf.setzeAgentEinUndUebernimmAusgang("bau", bauNachrunde(ueberlebende, widerspruch), sitzung);
  if (erste === null) return null;
  const weg = genaueMeldungen(lauf, erste, { ueberlebende });
  if (weg === null) return null;
  const { noetig } = weg;
  const gleichwertig = weg.gleichwertig.filter(({ mutant }) => !noetig.some((eintrag) => eintrag.mutant === mutant));
  for (const { mutant, grund } of gleichwertig) lauf.berichtszeilen.push(gleichwertigZeile(mutant, grund));
  return noetig;
}

function bauSchritteOhneAgent(lauf, optionen) {
  return lauf.bauSchritte(optionen).slice(1).every((schritt) => schritt());
}

function testAgentNachrunde(lauf, zwecke, prompt) {
  for (const zweck of zwecke) lauf.meldet(zweck, "test");
  const weg = lauf.setzeAgentEinUndUebernimmAusgang("test", prompt);
  return weg !== null && lauf.grenzen("test", lauf.basisBau) ? weg : null;
}

function testErgaenzt(lauf, ueberlebende, vorgabe) {
  return testAgentNachrunde(lauf, [vorgabe.zweck], testNachrunde(lauf.kontext, ueberlebende, vorgabe));
}

function nachgeholtUndAbgenommen(lauf, nachrunde, { festhalten = true } = {}) {
  if (festhalten && !lauf.zwischenstand()) return null;
  const weg = nachrunde();
  return weg !== null && lauf.allesVormerken() && lauf.gruen(PRUEFUNG.ABNAHME, abnahmeBefehl(lauf.kontext.auftrag)) ? weg : null;
}

function testNachgeholt(lauf, ueberlebende, { festhalten = true, vorab = () => true, ...runde }) {
  const vorgabe = { stand: "in den neuen Zeilen", melden: false, ...runde, zweck: PRUEFUNG.MUTATION };
  return nachgeholtUndAbgenommen(lauf, () => (vorab() ? testErgaenzt(lauf, ueberlebende, vorgabe) : null), { festhalten });
}

function zurueckzugeben(noetig, widerspruch) {
  const grundeDesTests = new Map(widerspruch.map(({ mutant, grund }) => [mutant, grund]));
  return noetig.filter(({ mutant }) => grundeDesTests.has(mutant)).map(({ mutant, grund }) => ({ mutant, grund, widerspruch: grundeDesTests.get(mutant) }));
}

function begruendungen(zurueck) {
  const zeilen = ({ mutant, grund, widerspruch }) => [meldungsZeile({ art: "Nötig", mutant, grund }), meldungsZeile({ art: "Widerspruch", mutant, grund: widerspruch })];
  return zurueck.flatMap(zeilen);
}

function widerspruchHalt(lauf, anlass, zeilen) {
  const { phase, auftrag } = lauf.kontext;
  const kopf = `Auftrag ${auftrag.id} der Phase ${phase.phase}: ${anlass}`;
  const notiz = [anlass, "", ...zweckBlock(PRUEFUNG.MUTATION), "", "Begründungen:", liste(zeilen)].join("\n");
  return lauf.entscheidungNoetig({ kopf, anlass, verlauf: [anlass, ...zeilen], notiz });
}

function seitBauGeaendert(lauf) {
  return aenderungenSeit(lauf.basisBau, lauf.kontext.root).length > 0;
}

function ungehaltenFesthalten(lauf) {
  return !seitBauGeaendert(lauf) || lauf.zwischenstand();
}

function widerspruchBeantwortet(lauf, zurueck, noetig) {
  if (!ungehaltenFesthalten(lauf)) return false;
  const nach = bauNachrundeGemeldet(lauf, zurueck.map(({ mutant }) => mutant), zurueck);
  if (nach === null) return false;
  const gegeben = begruendungen(zurueck);
  if (nach.length > 0) return widerspruchHalt(lauf, "Der Bau-Agent hält die Zeile nach dem Widerspruch des Test-Agenten weiter für nötig.", [...gegeben, ...nach.map((meldung) => meldungsZeile({ art: "Nötig", ...meldung }))]);
  if (!bauSchritteOhneAgent(lauf, { aenderungPflicht: false })) return false;
  const stand = mutanten(lauf, PRUEFUNG.MUTATION_NACH_BAU, ["--basis", lauf.basis]);
  if (stand.ende !== undefined) return stand.ende;
  const uebrige = noetig.filter(({ mutant }) => !zurueck.some((eintrag) => eintrag.mutant === mutant));
  const weg = testNachgeholt(lauf, stand.ueberlebende, { noetig: uebrige, widerspruch: false, festhalten: seitBauGeaendert(lauf) });
  if (weg === null) return false;
  const erneut = weg.widerspruch.filter(({ mutant }) => noetig.some((eintrag) => eintrag.mutant === mutant)).map((meldung) => meldungsZeile({ art: "Widerspruch", ...meldung }));
  return erneut.length > 0 ? widerspruchHalt(lauf, "Der Test-Agent widerspricht nach der Rückgabe ein zweites Mal.", [...gegeben, ...erneut]) : null;
}

function testNachgeholtMitRueckgabe(lauf, ueberlebende, noetig) {
  const weg = testNachgeholt(lauf, ueberlebende, { noetig, widerspruch: true });
  if (weg === null) return false;
  const zurueck = zurueckzugeben(noetig, weg.widerspruch);
  return zurueck.length === 0 ? null : widerspruchBeantwortet(lauf, zurueck, noetig);
}

function neueZeilen(lauf) {
  const pruefen = (name) => mutanten(lauf, name, ["--basis", lauf.basis]);
  const vorher = vorgemerkterCodestand(lauf);
  let stand = pruefen(PRUEFUNG.MUTATION);
  if (stand.ende !== undefined) return stand.ende;
  const noetig = bauNachrundeGemeldet(lauf, stand.ueberlebende);
  if (noetig === null || !bauSchritteOhneAgent(lauf)) return false;
  stand = (vorgemerkterCodestand(lauf) === vorher ? nachBauAbgeleitet(lauf, stand.ausgabe) : null) ?? pruefen(PRUEFUNG.MUTATION_NACH_BAU);
  if (stand.ende !== undefined) return stand.ende;
  const vorzeitig = testNachgeholtMitRueckgabe(lauf, stand.ueberlebende, noetig);
  return vorzeitig === null ? nachTest(lauf, noetig) : vorzeitig;
}

function nachTest(lauf, noetig) {
  const stand = mutanten(lauf, PRUEFUNG.MUTATION_NACH_TEST, ["--basis", lauf.basis]);
  if (stand.ende !== undefined) return stand.ende;
  lauf.merkeUeberlebende(stand.ueberlebende, noetig);
  return lauf.scheitert(`Mutant überlebt: ${stand.ueberlebende[0]}`);
}

function neueZeilenFortgesetzt(lauf) {
  const { ueberlebende, noetig } = lauf.fortsetzung;
  const weg = testNachgeholt(lauf, ueberlebende, { noetig, widerspruch: false, vorab: () => spieleNachrundeEin(lauf) });
  return weg === null ? false : nachTest(lauf, noetig);
}

function sichern(lauf, basis) {
  const datei = ablagePfad(lauf.kontext, ".patch");
  mkdirSync(dirname(datei), { recursive: true });
  lauf.allesVormerken();
  git(["diff", "--cached", "--binary", ...PATCH_FORMAT, `--output=${datei}`, basis], { cwd: lauf.kontext.root });
  return datei;
}

function neueZeilenGesichert(lauf) {
  const basis = lauf.basisBau;
  if (mitUeberlebenden(lauf.fortsetzung) ? neueZeilenFortgesetzt(lauf) : neueZeilen(lauf)) return true;
  lauf.nimmSollwerteZurueck(basis);
  if (lauf.ueberlebt !== null) sichereFortsetzung(lauf, basis);
  return lauf.gesichert(sichern(lauf, basis));
}

function zurueckstellen(lauf) {
  const { root } = lauf.kontext;
  lauf.nimmSollwerteZurueck(lauf.basisBau);
  const datei = sichern(lauf, lauf.basisBau);
  git(["reset", "-q", "--hard", lauf.basisBau], { cwd: root });
  git(["clean", "-q", "-fd"], { cwd: root });
  return { datei, inhalt: readFileSync(datei, "utf8") };
}

function anlassDerRunde({ phase, auftrag }, { ueberlebende }) {
  return `Auf dem alten Stand überleben ${ueberlebende.length} Mutanten des Umbaus ${auftrag.id} der Phase ${phase.phase}`;
}

function testBetreff(auftrag) {
  return `Halte Verhalten vor Umbau ${auftrag.id} fest`;
}

function vorabBetreff(auftrag) {
  return `Halte Verhalten vor Umbau ${auftrag.id} vorab fest`;
}

function testsFesthalten(lauf, runde) {
  const { phase, auftrag } = lauf.kontext;
  lauf.allesVormerken();
  const warum = `Warum: ${anlassDerRunde(lauf.kontext, runde)}; diese Tests halten das Verhalten vor dem Umbau fest.`;
  const herkunft = [`Auftrag: ${phase.phase}/${auftrag.id}`, ...(phase.paket ? [`Paket: ${phase.paket}`] : [])];
  const begruendung = lauf.uebernimmBegruendung(["test"]);
  return lauf.festschreiben(PRUEFUNG.TESTS_ALTER_STAND, [testBetreff(auftrag), "", warum, "", ...begruendung, ...herkunft, ""].join("\n"));
}

function vorabFesthalten(lauf, runde) {
  const { phase, auftrag } = lauf.kontext;
  lauf.allesVormerken();
  const warum = `Warum: ${anlassDerRunde(lauf.kontext, runde)}; diese Tests halten das Verhalten vor dem Umbau fest, geführt im Absicherungslauf vor dem Auftrag.`;
  const begruendung = lauf.uebernimmBegruendung(["test"]);
  return lauf.festschreiben(PRUEFUNG.TESTS_ALTER_STAND, [vorabBetreff(auftrag), "", warum, "", ...begruendung, vorabHerkunft(phase, auftrag), ""].join("\n"));
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

function gemeldetUebernommen(lauf, { gleichwertig, ueberlebende }, gemeldet) {
  let neu = false;
  for (const { mutant, grund } of gleichwertig) {
    for (const schluessel of ueberlebende.filter((ueberlebend) => gemeint(mutant, ueberlebend))) {
      gemeldet.set(schluessel, grund);
      if (gleichwertige(lauf).includes(schluessel)) continue;
      lauf.berichtszeilen.push(gleichwertigZeile(schluessel, grund));
      neu = true;
    }
  }
  return neu;
}

function testRunde(lauf, runde, { gemeldet, festhalten }) {
  const { ueberlebende } = runde;
  const weg = testErgaenzt(lauf, ueberlebende, { stand: "auf dem alten Stand", melden: true, zweck: PRUEFUNG.MUTATION_ALTER_STAND });
  if (weg === null) return false;
  const neu = gemeldetUebernommen(lauf, { gleichwertig: weg.gleichwertig, ueberlebende }, gemeldet);
  const ohneAenderung = aenderungenSeit(lauf.basisBau, lauf.kontext.root).length === 0;
  if (ueberlebende.length > 0 && ohneAenderung && !neu) return null;
  if (ohneAenderung && neu) return true;
  return testsGeprueft(lauf) && festhalten(lauf, runde);
}

function testsGeprueft(lauf) {
  return lauf.statischeTestpruefung() && lauf.basisVergleiche() && lauf.abhaengigkeiten() && lauf.vorherGruen();
}

function vorabAbgesichert(lauf) {
  const { weglassen, lauf: nummer, grund } = vorabGeprueft({ root: lauf.kontext.root, basis: lauf.basisBau, auftragId: lauf.kontext.auftrag.id });
  if (nummer === null) return false;
  const zeile = weglassen ? `Prüfung am alten Stand ausgelassen: Beleg aus Lauf ${nummer}, ${grund}.` : `Beleg verworfen: ${grund} (Lauf ${nummer}); volle Prüfung am alten Stand.`;
  lauf.berichtszeilen.push(zeile);
  return weglassen;
}

const UMBAU_ABLAUF = { einspielen: spieleUmbauEinOderBaueNeu, festhalten: testsFesthalten, abschluss: (aufgerufen, { ende }) => ende };

function alterStandRunden(lauf, ablauf) {
  const gemeldet = new Map();
  let vorher = Infinity;
  for (;;) {
    const stand = mutanten(lauf, PRUEFUNG.MUTATION_ALTER_STAND, ["--basis", lauf.basisBau, "--alter-stand"]);
    if (stand.ende !== undefined) return ablauf.abschluss(lauf, stand);
    const { ueberlebende } = stand;
    const patch = zurueckstellen(lauf);
    if (ueberlebende.length >= vorher) return entscheidung(lauf, { ueberlebende, vorher, gemeldet, patch });
    lauf.hinweise.push(`Umbau verworfen: auf dem alten Stand überlebt ${ueberlebende[0]}`);
    vorher = ueberlebende.length;
    const getestet = testRunde(lauf, { ueberlebende }, { gemeldet, festhalten: ablauf.festhalten });
    if (getestet === null) return entscheidung(lauf, { ueberlebende, vorher, gemeldet, patch });
    if (!getestet || !ablauf.einspielen(lauf, patch)) return false;
  }
}

function alterStand(lauf) {
  if (lauf.kontext.auftrag.art !== "umbau") return true;
  if (vorabAbgesichert(lauf)) return true;
  return alterStandRunden(lauf, UMBAU_ABLAUF);
}

export function vorabAbsichern(lauf) {
  let letzter = { ausgabe: "" };
  const abschluss = (aufgerufen, stand) => {
    letzter = stand;
    return stand.ende;
  };
  const gruen = alterStandRunden(lauf, { einspielen: spieleUnveraendertenPatchEin, festhalten: vorabFesthalten, abschluss });
  return { gruen: gruen === true, ausgabe: letzter.ausgabe ?? "", gleichwertig: gleichwertige(lauf) };
}

function srcSeit(lauf, von) {
  return git(["diff", "--name-only", von, "HEAD", "--", "src"], { cwd: lauf.kontext.root }).trim() !== "";
}

function phasenHinweis(ueberlebende) {
  return `Hinweis: nach der Testrunde überleben ${ueberlebende.length} Mutanten der Phase, z. B. ${ueberlebende[0]}; die Mutationsprüfung der CI entscheidet, ob ein späterer Auftrag sie tötet.`;
}

export function testrundeZuPhasenMutanten(lauf) {
  const von = phasenbasis(lauf.kontext.root);
  if (von === null || !srcSeit(lauf, von)) return true;
  const stand = mutanten(lauf, PRUEFUNG.MUTATION, ["--basis", von]);
  if (stand.ende !== undefined) return stand.ende;
  const weg = testNachgeholt(lauf, stand.ueberlebende, { stand: "in den neuen Zeilen der Phase", melden: true });
  if (weg === null) return false;
  const genau = genaueMeldungen(lauf, weg, { ueberlebende: stand.ueberlebende, rolle: "test" });
  if (genau === null) return false;
  gemeldetUebernommen(lauf, { gleichwertig: genau.gleichwertig, ueberlebende: stand.ueberlebende }, new Map());
  const danach = mutanten(lauf, PRUEFUNG.MUTATION_NACH_TEST, ["--basis", von]);
  if (danach.ende === undefined) lauf.hinweise.push(phasenHinweis(danach.ueberlebende));
  return danach.ende ?? true;
}

export function mutationsSchritte(lauf) {
  if (hatSkript(lauf.kontext.root, SKRIPT)) return [() => alterStand(lauf), () => neueZeilenGesichert(lauf)];
  lauf.hinweise.push(`Mutationsprüfung: package.json hat kein Skript ${SKRIPT}.`);
  return [];
}
