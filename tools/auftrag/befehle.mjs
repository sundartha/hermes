import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";

import { tokenize } from "espree";

import { FAILURE_FILE_VARIABLE } from "../../test/testbaenke-run.mjs";
import { BEREICHE_DATEI, bereichDerDatei, leseBereiche } from "../tests-ausmisten/pfade.mjs";
import { JAVASCRIPT_DATEI, TYPESCRIPT_DATEI, typescriptParser } from "../ziele/funktionen.mjs";

import { geschuetzteMuster, istVertraulich, ladePhase, phasenBefunde } from "./format.mjs";
import { aenderungenSeit, gibtEsIn, git } from "./git.mjs";
import { nurTypenNachgezogen } from "./importendungen.mjs";
import { PHASE_PASST_NICHT, VERSTOSS, fuehreAus, gekuerzteTestausgabe, grenzBefunde, rotUrteil } from "./pruefungen.mjs";
import { MELDUNG, zweckBlock } from "./zweck.mjs";

export const EXIT_GRUEN = 0;
export const EXIT_ROT = 1;
export const ROLLEN = ["test", "bau"];
const OHNE_UMBENENNUNG = { paare: [], nachgezogen: new Set(), hinweise: [] };

export function hatSkript(root, name) {
  const datei = join(root, "package.json");
  if (!existsSync(datei)) return false;
  return Object.hasOwn(JSON.parse(readFileSync(datei, "utf8")).scripts ?? {}, name);
}

export function abnahmeBefehl(auftrag) {
  return ["npm", "--silent", "test", "--", auftrag.abnahme];
}

export function abnahmeLauf(abnahme, { cwd, env: umgebung }) {
  const ordner = mkdtempSync(join(tmpdir(), "abnahme-fehler-"));
  const fehlerDatei = join(ordner, "fehler.json");
  try {
    const lauf = fuehreAus("abnahme", abnahmeBefehl({ abnahme }), {
      cwd,
      env: { ...umgebung, [FAILURE_FILE_VARIABLE]: fehlerDatei },
    });
    const fehlermeldungen = existsSync(fehlerDatei) ? JSON.parse(readFileSync(fehlerDatei, "utf8")) : [];
    return { ...lauf, fehlermeldungen };
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

export function gueltigePhase(phasendatei, root) {
  let phase;
  try {
    phase = ladePhase(phasendatei);
  } catch (fehler) {
    return { befunde: [`Die Phasendatei ${phasendatei} ist nicht lesbar: ${fehler.message}`] };
  }
  return { phase, befunde: phasenBefunde(phase, root) };
}

export function gueltigerAuftrag(phasendatei, kennung, root) {
  const { phase, befunde } = gueltigePhase(phasendatei, root);
  if (befunde.length > 0) return { befunde };
  const auftrag = phase.auftraege.find(({ id }) => id === kennung);
  return auftrag ? { phase, auftrag, befunde } : { befunde: [`Die Phase hat keinen Auftrag ${kennung}.`] };
}

export function meldeBefunde(befunde) {
  for (const befund of befunde) console.error(befund);
  return EXIT_ROT;
}

export function issueBefunde(phase) {
  if (istVertraulich(phase)) return [];
  return Number.isInteger(phase.issue) && phase.issue > 0 ? [] : ["issue muss die Nummer des Phasen-Issues sein."];
}

function phasenUndIssueBefunde(phasendatei, root) {
  const { phase, befunde } = gueltigePhase(phasendatei, root);
  return { phase, befunde: befunde.length > 0 ? befunde : issueBefunde(phase) };
}

export function pruefe(phasendatei, root) {
  const { phase, befunde } = phasenUndIssueBefunde(phasendatei, root);
  if (befunde.length > 0) {
    meldeBefunde(befunde);
    console.log(`rot: ${befunde.length} Befunde in ${phasendatei}.`);
    console.log(zweckBlock(MELDUNG.PHASENDATEI).join("\n"));
    return EXIT_ROT;
  }
  console.log(`grün: ${phase.auftraege.length} Aufträge in ${phasendatei} sind vollständig.`);
  return EXIT_GRUEN;
}

export function rot(phasendatei, kennung, root) {
  const { auftrag, befunde } = gueltigerAuftrag(phasendatei, kennung, root);
  if (befunde.length > 0) return meldeBefunde(befunde);
  if (typeof auftrag.erwarteterFehler !== "string") {
    return meldeBefunde([`Auftrag ${kennung} ist ein Umbau und hat keinen roten Test.`]);
  }
  const lauf = abnahmeLauf(auftrag.abnahme, { cwd: root, env });
  console.log(gekuerzteTestausgabe(lauf.ausgabe));
  const urteil = rotUrteil(lauf, auftrag.erwarteterFehler);
  console.log(urteil.zeile);
  return urteil.rot ? EXIT_GRUEN : EXIT_ROT;
}

function bereichNachListe(root) {
  if (!existsSync(join(root, BEREICHE_DATEI))) {
    return () => {
      throw new Error(`${BEREICHE_DATEI} fehlt; ohne die Liste lässt sich nicht prüfen, ob ein Umbenennungs-Auftrag nur Dateien seines Bereichs umbenennt.`);
    };
  }
  const bereiche = leseBereiche();
  return (pfad) => bereichDerDatei(pfad, bereiche);
}

export async function grenzen(phasendatei, kennung, { rolle, basis, root }) {
  const { auftrag, befunde } = gueltigerAuftrag(phasendatei, kennung, root);
  if (befunde.length > 0) {
    console.log(`${VERSTOSS}${PHASE_PASST_NICHT}`);
    return meldeBefunde(befunde);
  }
  const umbenennung = rolle === "bau" ? await nurTypenNachgezogen({ basis, root }, aenderungenSeit(basis, root).map(({ pfad }) => pfad)) : OHNE_UMBENENNUNG;
  const { paare, nachgezogen, hinweise: umbenennungsHinweise } = umbenennung;
  const aenderungen = aenderungenSeit(basis, root, paare);
  const kontext = { auftrag, rolle, muster: geschuetzteMuster(root), bestand: (pfad) => gibtEsIn(basis, pfad, root), nachgezogen, paare, bereichDer: bereichNachListe(root) };
  const { verstoesse, hinweise, produktzeilen } = grenzBefunde(kontext, aenderungen);
  for (const zeile of [...verstoesse, ...hinweise, ...umbenennungsHinweise]) console.log(zeile);
  const urteil = verstoesse.length === 0 ? "grün" : "rot";
  console.log(
    `${urteil}: ${aenderungen.length} Dateien geändert, ${produktzeilen} neue Zeilen Produktcode, Rolle ${rolle}.`,
  );
  return verstoesse.length === 0 ? EXIT_GRUEN : EXIT_ROT;
}

const HINZUGEFUEGT = /^\+(?!\+\+ )/;
const ZIELDATEI = /^\+\+\+ b\/(.+)$/;
const HUNK_KOPF = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const JAVASCRIPT = { ecmaVersion: "latest", sourceType: "module", loc: true };
const TYPESCRIPT = { ...JAVASCRIPT, range: true, tokens: true };
const BEZEICHNER = "Identifier";

function vorgemerkteNeueZeilen(basis, root) {
  const diff = git(["-c", "core.quotePath=false", "diff", "--cached", "--unified=0", "--no-color", basis], { cwd: root }).split("\n");
  const jeDatei = new Map();
  let datei = "";
  let naechste = 0;
  for (const zeile of diff) {
    const ziel = ZIELDATEI.exec(zeile);
    const kopf = HUNK_KOPF.exec(zeile);
    if (ziel !== null) datei = ziel[1];
    else if (kopf !== null) naechste = Number(kopf[1]);
    else if (HINZUGEFUEGT.test(zeile)) jeDatei.set(datei, [...(jeDatei.get(datei) ?? []), naechste++]);
  }
  return [...jeDatei].map(([pfad, neu]) => ({ datei: pfad, neu, inhalt: git(["show", `:${pfad}`], { cwd: root }) }));
}

const DEKLARIERT_NACH = new Set(["function", "const", "let", "var", "class"]);
const METHODEN_VORSATZ = new Set(["async", "static"]);
const GENERATOR = "*";
const KLAMMER_AUF = "(";
const KLAMMER_ZU = ")";
const BLOCK_AUF = "{";
const ABSTAND_FUNCTION_VOR_STERN = 2;

function anfangsZeile({ loc }) {
  return loc.start.line;
}

function endZeile({ loc }) {
  return loc.end.line;
}

function stehtAmZeilenanfang(tokens, index) {
  const zeile = anfangsZeile(tokens[index]);
  let davor = index - 1;
  while (davor >= 0 && anfangsZeile(tokens[davor]) === zeile && METHODEN_VORSATZ.has(tokens[davor].value)) davor -= 1;
  return davor < 0 || endZeile(tokens[davor]) < zeile;
}

function folgtBlockAufParameter(tokens, index) {
  if (tokens[index + 1]?.value !== KLAMMER_AUF) return false;
  let tiefe = 0;
  for (let stelle = index + 1; stelle < tokens.length; stelle += 1) {
    tiefe += Number(tokens[stelle].value === KLAMMER_AUF) - Number(tokens[stelle].value === KLAMMER_ZU);
    if (tiefe === 0) return tokens[stelle + 1]?.value === BLOCK_AUF;
  }
  return false;
}

function istDeklaration(tokens, index) {
  const davor = tokens[index - 1];
  if (DEKLARIERT_NACH.has(davor?.value) || (davor?.value === GENERATOR && tokens[index - ABSTAND_FUNCTION_VOR_STERN]?.value === "function")) return true;
  return stehtAmZeilenanfang(tokens, index) && folgtBlockAufParameter(tokens, index);
}

function leereNamen() {
  return { genannt: new Set(), deklariert: new Set() };
}

const NUR_TYP = "type";
const TYP_DEKLARATIONEN = new Set(["TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSDeclareFunction"]);
const TYP_SCHLUESSEL = new Set(["typeAnnotation", "returnType", "typeParameters", "typeArguments", "superTypeArguments", "implements"]);
const TYP_ZUSICHERUNGEN = new Set(["TSAsExpression", "TSSatisfiesExpression"]);
const TYP_MODIFIKATOREN = new Set(["public", "private", "protected", "readonly", "override", "abstract"]);

function istNurTyp(knoten) {
  return TYP_DEKLARATIONEN.has(knoten.type) || knoten.declare === true || knoten.importKind === NUR_TYP || knoten.exportKind === NUR_TYP;
}

function modifikatorBereiche(knoten) {
  const name = knoten.key ?? knoten.parameter ?? knoten.id;
  if (!name) return [];
  const anfang = Math.max(knoten.range[0], ...(knoten.decorators ?? []).map(({ range }) => range[1]));
  return [[anfang, name.range[0], TYP_MODIFIKATOREN]];
}

function typBereiche(knoten, schluessel) {
  if (istNurTyp(knoten)) return [knoten.range];
  const zusicherung = TYP_ZUSICHERUNGEN.has(knoten.type) ? [[knoten.expression.range[1], knoten.range[1]]] : [];
  return [...zusicherung, ...modifikatorBereiche(knoten), ...(schluessel[knoten.type] ?? []).flatMap((name) => kinderBereiche(knoten, name, schluessel))];
}

function kinderBereiche(knoten, name, schluessel) {
  const kinder = [knoten[name]].flat().filter(Boolean);
  return TYP_SCHLUESSEL.has(name) ? kinder.map(({ range }) => range) : kinder.flatMap((kind) => typBereiche(kind, schluessel));
}

function typescriptTokens(inhalt) {
  const { ast, visitorKeys } = typescriptParser().parseForESLint(inhalt, TYPESCRIPT);
  const bereiche = typBereiche(ast, visitorKeys);
  return ast.tokens.filter(({ range: [anfang], value }) => !bereiche.some(([von, bis, nur]) => von <= anfang && anfang < bis && (nur?.has(value) ?? true)));
}

const LESARTEN = [
  { endung: JAVASCRIPT_DATEI, sprache: "JavaScript", tokens: (inhalt) => tokenize(inhalt, JAVASCRIPT) },
  { endung: TYPESCRIPT_DATEI, sprache: "TypeScript", tokens: typescriptTokens },
];

function lesartDer(datei) {
  return LESARTEN.find(({ endung }) => endung.test(datei));
}

function namenJeZeile(tokens) {
  const jeZeile = new Map();
  tokens.forEach((token, index) => {
    if (token.type !== BEZEICHNER) return;
    const zeile = anfangsZeile(token);
    const namen = jeZeile.get(zeile) ?? leereNamen();
    namen[istDeklaration(tokens, index) ? "deklariert" : "genannt"].add(token.value);
    jeZeile.set(zeile, namen);
  });
  return jeZeile;
}

function neueZeilenDer({ datei, inhalt, neu }) {
  const lesart = lesartDer(datei);
  const namen = lesart === undefined ? new Map() : namenJeZeile(lesart.tokens(inhalt));
  return neu.map((nummer) => ({ datei, ...(namen.get(nummer) ?? leereNamen()) }));
}

function lesbareZeilen(dateien) {
  const zeilen = [];
  const unlesbar = [];
  for (const datei of dateien) {
    try {
      zeilen.push(...neueZeilenDer(datei));
    } catch (fehler) {
      unlesbar.push(`nicht lesbar: ${datei.datei} ist kein lesbares ${lesartDer(datei.datei).sprache} (${fehler.message})`);
    }
  }
  return { zeilen, unlesbar };
}

function verstossBei({ datei, funktion, fuer }, zeilen) {
  const nachbau = zeilen.find((zeile) => zeile.datei !== datei && zeile.deklariert.has(funktion));
  if (nachbau !== undefined) return [`nachgebaut: ${nachbau.datei} deklariert ${funktion} neu, statt ${datei}:${funktion} zu nutzen (für ${fuer})`];
  return zeilen.some((zeile) => zeile.genannt.has(funktion)) ? [] : [`nicht genutzt: ${datei}:${funktion} (für ${fuer})`];
}

export function nutzungsVerstoesse(nutzen, dateien) {
  if (nutzen.length === 0) return [];
  const { zeilen, unlesbar } = lesbareZeilen(dateien);
  return [...unlesbar, ...nutzen.flatMap((eintrag) => verstossBei(eintrag, zeilen))];
}

export function genutzt(phasendatei, kennung, { basis, root }) {
  const { auftrag, befunde } = gueltigerAuftrag(phasendatei, kennung, root);
  if (befunde.length > 0) return meldeBefunde(befunde);
  const nutzen = auftrag.nutzen ?? [];
  const verstoesse = nutzungsVerstoesse(nutzen, nutzen.length > 0 ? vorgemerkteNeueZeilen(basis, root) : []);
  for (const verstoss of verstoesse) console.log(`${VERSTOSS}${verstoss}`);
  const urteil = verstoesse.length === 0 ? `grün: ${nutzen.length} von ${nutzen.length} vorhandenen Funktionen in den neuen Zeilen genutzt.` : `rot: ${verstoesse.length} Verstöße bei ${nutzen.length} vorhandenen Funktionen in den neuen Zeilen.`;
  console.log(urteil);
  return verstoesse.length === 0 ? EXIT_GRUEN : EXIT_ROT;
}
