import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "node:process";

import { testAgentPrompt } from "./agenten.mjs";
import { abnahmeBefehl, hatSkript } from "./befehle.mjs";
import { aenderungenSeit, arbeitsstand, gemeinsamerOrdner, git, kopf } from "./git.mjs";
import { gemeint, gleichwertigGemeldet, gleichwertigZeile, meldungsZeile, nachbewertet } from "./gleichwertig.mjs";
import { ALTER_SCHUTZ, ALTER_SCHUTZ_BELEGT, ALTER_SCHUTZ_NICHT_BELEGT, ALTER_SCHUTZ_UNGEPRUEFT, alterSchutzBeleg, satzKennung, satzNummer, SCHUTZ_NICHT_PRUEFBAR, SCHUTZ_UNERREICHT, SCHUTZ_WIRKUNGSLOS, schutzSaetze } from "./schutzkennung.mjs";
import { phasenbasis } from "./phasenende.mjs";
import { GRUND, PRUEFUNG, absatzVerlangt, zweckBlock } from "./zweck.mjs";

const SKRIPT = "test:mutation";
const MUTATION_IN_CI = "HERMES_MUTATION_IN_CI";
const IN_CI = ["--in-ci"];
const EXIT_UEBERLEBT = 1;
const UEBERLEBT = /^Verstoß: Mutant überlebt: (.+)$/gm;
const ERSTLAUF_ROT = /^Abbruch: (Erstlauf rot: .+)$/gm;
const AM_BUDGET = /^Abbruch: Budget\b.*kein Urteil\.$/m;
const OHNE_WIRKUNG = new RegExp(`^Verstoß: ((?:${SCHUTZ_WIRKUNGSLOS}|${ALTER_SCHUTZ_NICHT_BELEGT} \\([^)]*\\)): .+)$`, "gm");
const SCHUTZ_HINWEIS = new RegExp(`^((?:${SCHUTZ_NICHT_PRUEFBAR}|${SCHUTZ_UNERREICHT}|${ALTER_SCHUTZ_BELEGT}).*)$`, "gm");
const UMBAU_UNGEPRUEFT = "Hinweis: Wirkung der Schutztests im Umbau nicht geprüft.";
const SCHUTZFALL = "[NIE";
const BUDGET_ZEILEN = /^((?:Vorschau |Abbruch: Budget\b|Mutationslog: Ende nach ).*)$/gm;
const ABLAGE = "auftrag-umbau";
const PATCH_FORMAT = ["--no-ext-diff", "--no-color", "--src-prefix=a/", "--dst-prefix=b/"];
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
  const gemeldet = gleichwertige(lauf).flatMap((mutant) => ["--gleichwertig", mutant]);
  const weg = env[MUTATION_IN_CI] === "1" ? IN_CI : [];
  return skriptAufruf([...weg, ...argumente, ...gemeldet]);
}

function ausgewertet(lauf, name, { exitCode, ausgabe, muster = UEBERLEBT }) {
  if (exitCode === 0) return { ende: true, ueberlebende: [], ausgabe };
  if (amBudget(ausgabe)) return { ende: budgetEnde(lauf, name, ausgabe) };
  if (abbruchExit(exitCode)) return { ende: lauf.scheitert(abbruch(name, exitCode, ausgabe), GRUND.MUTATION_ABBRUCH) };
  return { ueberlebende: treffer(ausgabe, muster), ausgabe };
}

function geprueft(lauf, name, { befehl, muster }) {
  const erster = lauf.pruefung(name, befehl);
  const wiederholen = abbruchExit(erster.exitCode) && !amBudget(erster.ausgabe);
  return ausgewertet(lauf, name, { ...(wiederholen ? lauf.pruefung(name, befehl) : erster), muster });
}

function mutanten(lauf, name, argumente) {
  return geprueft(lauf, name, { befehl: mutationsBefehl(lauf, argumente), muster: UEBERLEBT });
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

function mitMutantenAbschnitt(ueberlebende, { offen = [] }) {
  return ueberlebende.length > 0 || offen.length === 0;
}

function zweckeDerRunde(ueberlebende, vorgabe) {
  return [...(mitMutantenAbschnitt(ueberlebende, vorgabe) ? [vorgabe.zweck] : []), ...(vorgabe.offen?.length > 0 ? [PRUEFUNG.SCHUTZTESTS] : [])];
}

function mutantenAbschnitt(auftrag, ueberlebende, { stand, melden, noetig = [], widerspruch = false, zweck }) {
  const aufgabe = `Diese Mutanten ${stand} überleben. Ergänze in ${auftrag.abnahme} Fälle, die sie töten; Produktcode änderst du nicht.`;
  const zeilen = ["## Überlebende Mutanten", "", ...zweckBlock(zweck), absatzVerlangt([zweck]), "", aufgabe, "", liste(ueberlebende), ""];
  const begruendet = noetig.length > 0 ? ["Der Bau-Agent hält diese Zeilen für nötig:", liste(noetig.map(({ mutant, grund }) => `${mutant}, weil ${grund}`)), ""] : [];
  return [...zeilen, ...begruendet, ...(melden ? MELDEN : []), ...(widerspruch && noetig.length > 0 ? WIDERSPRUCH : [])];
}

function schutzAbschnitt(auftrag, offen) {
  if (offen.length === 0) return [];
  const aufgabe = `Schreibe zu jedem Satz in ${auftrag.abnahme} mindestens einen neuen Fall, dessen fester Name mit der Kennung und einem Leerzeichen beginnt, der genau diesen Satz über einen Eingang prüft und gegen den alten Stand grün ist. Produktcode und bestehende Fälle änderst du nicht.`;
  const kopf = "Der Umbau ist zurückgestellt, der Arbeitsbaum steht auf dem Stand vor dem Umbau. Zu diesen Sätzen aus wasDarfNiePassieren gibt es noch keinen Schutztest:";
  return ["## Schutztests auf dem alten Stand", "", ...zweckBlock(PRUEFUNG.SCHUTZTESTS), absatzVerlangt([PRUEFUNG.SCHUTZTESTS]), "", kopf, "", liste(offen), "", aufgabe, ""];
}

function testNachrunde(kontext, ueberlebende, vorgabe) {
  const { auftrag } = kontext;
  const mutantenTeil = mitMutantenAbschnitt(ueberlebende, vorgabe) ? mutantenAbschnitt(auftrag, ueberlebende, vorgabe) : [];
  return [testAgentPrompt(kontext), ...mutantenTeil, ...schutzAbschnitt(auftrag, vorgabe.offen ?? [])].join("\n");
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

function genaueMeldungen(lauf, weg, ueberlebende) {
  const zeilen = ohneSchluessel(weg, ueberlebende);
  if (zeilen.length === 0) return weg;
  const nachher = arbeitsstand(lauf.kontext.root);
  const antwort = lauf.fragtNach("bau", meldungNachfrage(zeilen, ueberlebende), { nachher, geaendert: "Die Nachfrage zur Meldung hat Dateien geändert." });
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
  const { sitzung } = lauf.agenten.findLast(({ rolle }) => rolle === "bau");
  lauf.meldet(PRUEFUNG.MUTATION, "bau");
  const erste = lauf.setzeAgentEinUndUebernimmAusgang("bau", bauNachrunde(ueberlebende, widerspruch), sitzung);
  if (erste === null) return null;
  const weg = genaueMeldungen(lauf, erste, ueberlebende);
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
  return testAgentNachrunde(lauf, zweckeDerRunde(ueberlebende, vorgabe), testNachrunde(lauf.kontext, ueberlebende, vorgabe));
}

function nachgeholtUndAbgenommen(lauf, nachrunde, { festhalten = true } = {}) {
  if (festhalten && !lauf.zwischenstand()) return null;
  const weg = nachrunde();
  return weg !== null && lauf.allesVormerken() && lauf.gruen(PRUEFUNG.ABNAHME, abnahmeBefehl(lauf.kontext.auftrag)) ? weg : null;
}

function testNachgeholt(lauf, ueberlebende, { festhalten = true, ...runde }) {
  const vorgabe = { stand: "in den neuen Zeilen", melden: false, ...runde, zweck: PRUEFUNG.MUTATION };
  return nachgeholtUndAbgenommen(lauf, () => testErgaenzt(lauf, ueberlebende, vorgabe), { festhalten });
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
  if (vorzeitig !== null) return vorzeitig;
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

function anlassDerRunde({ phase, auftrag }, { ueberlebende, offen }) {
  const umbau = `des Umbaus ${auftrag.id} der Phase ${phase.phase}`;
  const mutantenTeil = mitMutantenAbschnitt(ueberlebende, { offen }) ? [`Auf dem alten Stand überleben ${ueberlebende.length} Mutanten ${umbau}`] : [];
  const schutzTeil = offen.length > 0 ? [`${offen.length} Sätze aus wasDarfNiePassieren ${umbau} haben noch keinen Schutztest`] : [];
  return [...mutantenTeil, ...schutzTeil].join("; ");
}

function testBetreff(auftrag) {
  return `Halte Verhalten vor Umbau ${auftrag.id} fest`;
}

function istTestCommit({ root, phase, auftrag }, stand) {
  const [betreff, herkunft] = git(["log", "-1", "--format=%s%x00%(trailers:key=Auftrag,valueonly)", stand], { cwd: root }).split("\0");
  return betreff === testBetreff(auftrag) && herkunft.split("\n").includes(`${phase.phase}/${auftrag.id}`);
}

function umbauAnfang(lauf) {
  const { root, auftrag } = lauf.kontext;
  const von = phasenbasis(root);
  if (von === null) return lauf.basis;
  const kandidaten = git(["rev-list", "--fixed-strings", `--grep=${testBetreff(auftrag)}`, `${von}..${lauf.basis}`], { cwd: root }).split("\n").filter(Boolean);
  const aeltester = kandidaten.findLast((stand) => istTestCommit(lauf.kontext, stand));
  return aeltester === undefined ? lauf.basis : git(["rev-parse", `${aeltester}^`], { cwd: root }).trim();
}

function testsFesthalten(lauf, runde) {
  const { phase, auftrag } = lauf.kontext;
  lauf.allesVormerken();
  const warum = `Warum: ${anlassDerRunde(lauf.kontext, runde)}; diese Tests halten das Verhalten vor dem Umbau fest.`;
  const herkunft = [`Auftrag: ${phase.phase}/${auftrag.id}`, ...(phase.paket ? [`Paket: ${phase.paket}`] : [])];
  const begruendung = lauf.uebernimmBegruendung(["test"]);
  return lauf.festschreiben(PRUEFUNG.TESTS_ALTER_STAND, [testBetreff(auftrag), "", warum, "", ...begruendung, ...herkunft, ""].join("\n"));
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

function testRunde(lauf, runde, gemeldet) {
  const { ueberlebende, offen } = runde;
  const weg = testErgaenzt(lauf, ueberlebende, { stand: "auf dem alten Stand", melden: true, zweck: PRUEFUNG.MUTATION_ALTER_STAND, offen });
  if (weg === null) return false;
  const neu = gemeldetUebernommen(lauf, { gleichwertig: weg.gleichwertig, ueberlebende }, gemeldet);
  const ohneAenderung = aenderungenSeit(lauf.basisBau, lauf.kontext.root).length === 0;
  if (ueberlebende.length > 0 && ohneAenderung && !neu) return null;
  if (ohneAenderung && neu && offen.length === 0) return true;
  return testsGeprueft(lauf, offen) && testsFesthalten(lauf, runde);
}

function testsGeprueft(lauf, offen) {
  const geprueft = lauf.statischeTestpruefung() && lauf.basisVergleiche() && lauf.abhaengigkeiten() && lauf.vorherGruen();
  return geprueft && (offen.length === 0 || lauf.schutztests("test"));
}

function offeneSaetze(auftrag) {
  return schutzSaetze(auftrag).map((satz, index) => `${satzKennung(index + 1)} ${satz}`);
}

function ohneRunde({ ende }, offen) {
  return ende !== undefined && (ende !== true || offen.length === 0);
}

function nachAlterStand(lauf, { ende }, anfang) {
  return ende && (schutzSaetze(lauf.kontext.auftrag).length === 0 || lauf.schutztests("bau", anfang));
}

function zurueckgestellt(ueberlebende, offen) {
  if (ueberlebende.length > 0) return `Umbau verworfen: auf dem alten Stand überlebt ${ueberlebende[0]}`;
  return `Umbau zurückgestellt: ${offen.length} Sätze aus wasDarfNiePassieren haben noch keinen Schutztest.`;
}

function alterStand(lauf) {
  if (lauf.kontext.auftrag.art !== "umbau") return true;
  const gemeldet = new Map();
  let vorher = Infinity;
  const anfang = umbauAnfang(lauf);
  let offen = anfang === lauf.basis ? offeneSaetze(lauf.kontext.auftrag) : [];
  for (;;) {
    const stand = mutanten(lauf, PRUEFUNG.MUTATION_ALTER_STAND, ["--basis", lauf.basisBau, "--alter-stand"]);
    if (ohneRunde(stand, offen)) return nachAlterStand(lauf, stand, anfang);
    const { ueberlebende } = stand;
    const patch = zurueckstellen(lauf);
    if (ueberlebende.length >= vorher) return entscheidung(lauf, { ueberlebende, vorher, gemeldet, patch });
    lauf.hinweise.push(zurueckgestellt(ueberlebende, offen));
    if (ueberlebende.length > 0) vorher = ueberlebende.length;
    const getestet = testRunde(lauf, { ueberlebende, offen }, gemeldet);
    if (getestet === null) return entscheidung(lauf, { ueberlebende, vorher, gemeldet, patch });
    if (!getestet || !spieleUmbauEinOderBaueNeu(lauf, patch)) return false;
    offen = [];
  }
}

function wirkung(lauf, name, alteStellen) {
  const befehl = skriptAufruf(["--basis", lauf.basis, "--schutzwirkung", ...alteStellen.flatMap((stelle) => ["--alter-schutz", stelle])]);
  const stand = geprueft(lauf, name, { befehl, muster: OHNE_WIRKUNG });
  if (stand.ende === true) lauf.berichtszeilen.push(...treffer(stand.ausgabe, SCHUTZ_HINWEIS));
  return stand;
}

function mitSatz(saetze, befund) {
  const nummer = satzNummer(befund.slice(befund.indexOf(SCHUTZFALL)), saetze.length);
  return nummer === null ? befund : `${befund} – Satz ${satzKennung(nummer)} „${saetze[nummer - 1]}“`;
}

function wirkungsAbschnitt(auftrag, befunde) {
  const kopf = "Diese Schutztests durchlaufen neue Zeilen, werden aber bei keinem ihrer Mutanten rot; sie halten ihren Satz aus wasDarfNiePassieren nicht fest:";
  const aufgabe = `Mach jeden in ${auftrag.abnahme} wirksam: Er prüft genau das Verhalten aus seinem Satz über den Eingang und wird rot, wenn der schützende Code fehlt. Produktcode änderst du nicht.`;
  const ausweg = ["Liegt der Schutz eines Satzes in Code, den der Auftrag nicht ändert, antworte statt eines Tests mit einer Zeile je Kennung:", "Alter Schutz: [NIE<n>] src/<datei>:<zeile>, weil <ein Satz>", "Die Zeile gilt nur, wenn der Fall Mutanten genau dieser unveränderten Zeile tötet."];
  const offen = liste(befunde.map((befund) => mitSatz(schutzSaetze(auftrag), befund)));
  return ["## Schutztests ohne Wirkung", "", ...zweckBlock(PRUEFUNG.SCHUTZWIRKUNG), absatzVerlangt([PRUEFUNG.SCHUTZWIRKUNG]), "", kopf, "", offen, "", aufgabe, ...ausweg, ""];
}

function wirkungNachgeholt(lauf, befunde) {
  const { kontext } = lauf;
  const prompt = [testAgentPrompt(kontext), ...wirkungsAbschnitt(kontext.auftrag, befunde)].join("\n");
  const weg = nachgeholtUndAbgenommen(lauf, () => testAgentNachrunde(lauf, [PRUEFUNG.SCHUTZWIRKUNG], prompt));
  return weg !== null && lauf.statischeTestpruefung() && lauf.schutztests("bau") ? ersteJeKennung(weg.alterSchutz) : null;
}

function ersteJeKennung(alterSchutz) {
  const kennungen = new Set();
  return alterSchutz.filter(({ mutant }) => {
    const kennung = ALTER_SCHUTZ.exec(mutant)?.[1];
    if (kennung === undefined || kennungen.has(kennung)) return false;
    kennungen.add(kennung);
    return true;
  });
}

function alterSchutzZeile({ mutant, grund }, ausgabe) {
  const [, kennung, datei, zeile] = ALTER_SCHUTZ.exec(mutant);
  const beleg = alterSchutzBeleg(datei, zeile, `${kennung} `);
  const belegt = ausgabe.split("\n").some((ausgabezeile) => ausgabezeile.startsWith(beleg));
  return `${belegt ? "Alter Schutz" : ALTER_SCHUTZ_UNGEPRUEFT}: ${mutant}, weil ${grund}`;
}

function neueZeilenNachSchutzrunde(lauf) {
  const stand = mutanten(lauf, PRUEFUNG.MUTATION_NACH_TEST, ["--basis", lauf.basis]);
  return stand.ende ?? lauf.scheitert(`Mutant überlebt: ${stand.ueberlebende[0]}`);
}

function schutzwirkung(lauf) {
  const { auftrag } = lauf.kontext;
  if (schutzSaetze(auftrag).length === 0) return true;
  if (auftrag.art === "umbau") {
    lauf.berichtszeilen.push(UMBAU_UNGEPRUEFT);
    return true;
  }
  const erster = wirkung(lauf, PRUEFUNG.SCHUTZWIRKUNG, []);
  if (erster.ende !== undefined) return erster.ende;
  const alteSchutze = wirkungNachgeholt(lauf, erster.ueberlebende);
  if (alteSchutze === null || !neueZeilenNachSchutzrunde(lauf)) return false;
  const zweiter = wirkung(lauf, PRUEFUNG.SCHUTZWIRKUNG_NACH_TEST, alteSchutze.map(({ mutant }) => mutant));
  if (zweiter.ende !== true) return zweiter.ende ?? lauf.scheitert(`Schutztest ohne Wirkung: ${zweiter.ueberlebende[0]}`);
  for (const angabe of alteSchutze) lauf.berichtszeilen.push(alterSchutzZeile(angabe, zweiter.ausgabe));
  return true;
}

export function mutationsSchritte(lauf) {
  if (hatSkript(lauf.kontext.root, SKRIPT)) return [() => alterStand(lauf), () => neueZeilenGesichert(lauf), () => schutzwirkung(lauf)];
  lauf.hinweise.push(`Mutationsprüfung: package.json hat kein Skript ${SKRIPT}.`);
  return [];
}
