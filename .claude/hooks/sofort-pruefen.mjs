import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { argv, chdir } from "node:process";
import { promisify } from "node:util";

import { block, git, isInside, readInput, realPath, repositoryRoot, startDirectory } from "./lib.mjs";

const ausfuehren = promisify(execFile);
const ESLINT_ORDNER = ["src", "test"];
const ESLINT_ENDUNGEN = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);
const SYNTAX_ORDNER = ["src", "scripts"];
const SYNTAX_ENDUNGEN = new Set([".js", ".mjs"]);
const BAUSYSTEM_ORDNER = ["tools", ".github/workflows", ".claude/hooks"];
const CI_DATEI = ".github/workflows/ci.yml";
const OBERGRENZE = /^ {2}OBERGRENZE_BAUSYSTEM_DATEIEN: (\d+)$/m;
const FEHLER_STUFE = 2;
const ERSTE_ZEILE = 1;
const LEERZEICHEN = /\s+/g;
const WEG = "So geht es richtig:";
const ARCHITEKTUR_ORDNER = ["src", "test"];
const BAUSTEINKARTE = "tools/bausteine.json";
const ARCHITEKTUR_REGELN = ".dependency-cruiser.cjs";
const KATALOG_WERKZEUG = "tools/katalog-pruefen.mjs";
const KATALOG_ORDNER = ["src"];
const KATALOG_DOKUMENT = /^docs\/sicherheits/;
const EXIT_BEFUND = 1;
const SYNTAX_ZEILE = /:(\d+)$/m;
const SYNTAX_MELDUNG = /^\w*Error: .*$/m;
const HINTERGRUND = "--hintergrund";
const HINTERGRUND_FRIST_MS = 100_000;
const KIBI = 1024;
const PUFFER_MEBI = 64;
const PUFFER_BYTES = PUFFER_MEBI * KIBI * KIBI;
const SATZENDE = /\.$/;
const TSC_ENDUNGEN = new Set([".ts", ".mts", ".cts"]);
const TSC_ZEILE = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/;
const MAX_TYPFEHLER = 10;
const KEIN_PROGRAMM = "ENOENT";

function zuPruefendeDatei(input) {
  const pfad = input.tool_input?.file_path;
  if (typeof pfad !== "string") return undefined;
  const verzeichnis = startDirectory(input);
  const wurzel = realPath(repositoryRoot(verzeichnis));
  const datei = realPath(isAbsolute(pfad) ? pfad : resolve(verzeichnis, pfad));
  if (!isInside(datei, wurzel) || !existsSync(datei)) return undefined;
  return { wurzel, datei, pfad: relative(wurzel, datei).split(sep).join("/") };
}

function inOrdnern({ wurzel, datei }, ordner, endungen) {
  return (endungen === undefined || endungen.has(extname(datei))) && ordner.some((name) => isInside(datei, resolve(wurzel, name)));
}

async function eslintVerstoesse(ziel) {
  if (!inOrdnern(ziel, ESLINT_ORDNER, ESLINT_ENDUNGEN)) return [];
  const { ESLint } = await import("eslint");
  const eslint = new ESLint({ cwd: ziel.wurzel, applySuppressions: true });
  const [ergebnis] = await eslint.lintFiles([ziel.datei]);
  return ergebnis.messages
    .filter(({ severity }) => severity === FEHLER_STUFE)
    .map(({ line, ruleId, message }) => `${ziel.pfad}:${line}  ${ruleId ?? "parser"}  ${message.replace(LEERZEICHEN, " ")}`);
}

async function syntaxVerstoesse(ziel) {
  if (!inOrdnern(ziel, SYNTAX_ORDNER, SYNTAX_ENDUNGEN)) return [];
  try {
    await ausfuehren(process.execPath, ["--check", ziel.datei], { cwd: ziel.wurzel });
    return [];
  } catch (fehler) {
    if (typeof fehler.code !== "number") throw fehler;
    const zeile = SYNTAX_ZEILE.exec(fehler.stderr)?.[1] ?? ERSTE_ZEILE;
    const meldung = SYNTAX_MELDUNG.exec(fehler.stderr)?.[0] ?? "Syntaxfehler";
    return [`${ziel.pfad}:${zeile}  syntax  ${meldung}. ${WEG} die Zeile öffnen und Klammern, Anführungszeichen und import/export prüfen; .js und .mjs sind ES-Module.`];
  }
}

async function bestandsVerstoesse(ziel) {
  const { BESTAENDE, basisAus, bestandAuf, gewachseneEintraege } = await import("../../tools/pruefen.mjs");
  const bestand = BESTAENDE.find(({ datei }) => datei === ziel.pfad);
  if (bestand === undefined) return [];
  const basis = basisAus([]);
  return gewachseneEintraege(bestandAuf(basis, bestand), bestandAuf(null, bestand))
    .map((eintrag) => `${ziel.pfad}:${ERSTE_ZEILE}  eingefrorene-bestaende  ${eintrag} ist neu oder öfter eingefroren. ${WEG} Bestände schrumpfen nur; die Ursache im Code beheben, statt einen Eintrag zu ergänzen.`);
}

function wachstumsVerstoesse(ziel) {
  if (!inOrdnern(ziel, BAUSYSTEM_ORDNER)) return [];
  const ci = join(ziel.wurzel, CI_DATEI);
  const grenze = existsSync(ci) ? OBERGRENZE.exec(readFileSync(ci, "utf8"))?.[1] : undefined;
  if (grenze === undefined) return [];
  const liste = git(ziel.wurzel, ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...BAUSYSTEM_ORDNER]).text;
  const dateien = liste.split("\n").filter(Boolean);
  if (dateien.length <= Number(grenze)) return [];
  return [`${ziel.pfad}:${ERSTE_ZEILE}  wachstumsbremse  Unter tools/, .github/workflows/ und .claude/hooks/ liegen ${dateien.length} Dateien, erlaubt sind ${grenze}. ${WEG} den Inhalt in eine bestehende Datei legen oder eine tote Datei mit Beleg per git grep entfernen; die Obergrenze OBERGRENZE_BAUSYSTEM_DATEIEN in ${CI_DATEI} nie anheben.`];
}

async function schrankenVerstoesse(ziel) {
  const { PRUEFREGELN, SYSTEM_BRANCH } = await import("../../tools/freigabe.mjs");
  if (!PRUEFREGELN.some((muster) => muster.test(ziel.pfad))) return [];
  const zweig = git(ziel.wurzel, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (!zweig.ok || SYSTEM_BRANCH.test(zweig.text)) return [];
  return [`${ziel.pfad}:${ERSTE_ZEILE}  freigabe-schranke  ${ziel.pfad} ist eine Prüfregel-Datei, Branch ${zweig.text}, die Freigabe-Prüfung wird rot. ${WEG} nur ändern, wenn der Plan im Issue diese Datei nennt, sonst die Änderung zurücknehmen; den Branch nie umbenennen, um die Prüfung zu umgehen; nach PASS zieht die Kette den PR auf system/* um.`];
}

async function architekturVerstoesse(ziel) {
  if (!inOrdnern(ziel, ARCHITEKTUR_ORDNER, ESLINT_ENDUNGEN) && ziel.pfad !== BAUSTEINKARTE) return [];
  if (!existsSync(join(ziel.wurzel, ARCHITEKTUR_REGELN))) return [];
  const { architekturBefunde, basisAus } = await import("../../tools/pruefen.mjs");
  const { neu, karte } = architekturBefunde(basisAus([]), ziel.pfad === BAUSTEINKARTE ? BAUSTEINKARTE : ziel.pfad);
  const kartenweg = `${WEG} dem Hinweis folgen; Bausteine, Eingänge und Schichten stehen in ${BAUSTEINKARTE}, die Ordner-Hinweise erzeugt npm run hinweise.`;
  return [
    ...neu.map((verstoss) => `${ziel.pfad}:${ERSTE_ZEILE}  architektur  Neuer Verstoß ${verstoss}. ${WEG} die Regel in .dependency-cruiser.cjs lesen und den Import entfernen oder über den Eingang des Zielbausteins aus ${BAUSTEINKARTE} führen; bestehende Verstöße nicht als Vorbild nehmen.`),
    ...karte.map((befund) => `${ziel.pfad}:${ERSTE_ZEILE}  bausteinkarte  ${befund} ${kartenweg}`),
  ];
}

async function katalogVerstoesse(ziel) {
  const quelle = inOrdnern(ziel, KATALOG_ORDNER, ESLINT_ENDUNGEN);
  if (!quelle && !KATALOG_DOKUMENT.test(ziel.pfad)) return [];
  if (!existsSync(join(ziel.wurzel, KATALOG_WERKZEUG))) return [];
  const { basisAus } = await import("../../tools/pruefen.mjs");
  try {
    await ausfuehren(process.execPath, ["tools/katalog-pruefen.mjs", "--basis", basisAus([])], { cwd: ziel.wurzel });
    return [];
  } catch (fehler) {
    if (fehler.code !== EXIT_BEFUND) throw fehler;
    const zeilen = fehler.stderr.split("\n").filter(Boolean);
    return zeilen.map((zeile) => `${ziel.pfad}:${ERSTE_ZEILE}  bedrohungskatalog  ${zeile} ${WEG} jede Zeile in docs/sicherheitsgrenzen.md braucht einen Negativtest SG-<nr> unter test/, jede Route, jeder Webhook und jedes MCP-Werkzeug eine Zeile im Abschnitt Angriffsfläche.`);
  }
}

async function werkzeug(programm, args, optionen) {
  try {
    const { stdout } = await ausfuehren(programm, args, { timeout: HINTERGRUND_FRIST_MS, maxBuffer: PUFFER_BYTES, ...optionen });
    return stdout;
  } catch (fehler) {
    if (fehler.code === KEIN_PROGRAMM) throw new Error(`${programm} nicht installiert`, { cause: fehler });
    return undefined;
  }
}

async function semgrepFunde(verzeichnis, pfad, regeln) {
  const ausgabe = await werkzeug("semgrep", ["scan", ...regeln.flatMap((regel) => ["--config", regel]), "--json", "--metrics=off", "--quiet", pfad], { cwd: verzeichnis });
  if (ausgabe === undefined) return undefined;
  const zeilen = readFileSync(join(verzeichnis, pfad), "utf8").split("\n");
  try {
    return JSON.parse(ausgabe).results.map(({ check_id: regel, start, extra }) => ({ regel, zeile: start.line, text: zeilen[start.line - 1].trim(), meldung: extra.message }));
  } catch {
    return undefined;
  }
}

async function semgrepVerstoesse(ziel) {
  if (!ESLINT_ENDUNGEN.has(extname(ziel.datei))) return [];
  const { SEMGREP_REGELN, basisAus } = await import("../../tools/pruefen.mjs");
  const alt = git(ziel.wurzel, ["show", `${basisAus([])}:${ziel.pfad}`]);
  const ordner = mkdtempSync(join(tmpdir(), "sofort-semgrep-"));
  try {
    mkdirSync(dirname(join(ordner, ziel.pfad)), { recursive: true });
    writeFileSync(join(ordner, ziel.pfad), alt.ok ? alt.text : "");
    const [jetzt, davor] = await Promise.all([semgrepFunde(ziel.wurzel, ziel.pfad, SEMGREP_REGELN), alt.ok ? semgrepFunde(ordner, ziel.pfad, SEMGREP_REGELN) : []]);
    if (jetzt === undefined || davor === undefined) return [];
    const bekannt = new Set(davor.map(({ regel, text }) => `${regel}\n${text}`));
    return jetzt
      .filter(({ regel, text }) => !bekannt.has(`${regel}\n${text}`))
      .map(({ regel, zeile, meldung }) => `${ziel.pfad}:${zeile}  semgrep  ${regel}: ${meldung.replace(LEERZEICHEN, " ").replace(SATZENDE, "")}. ${WEG} dem Hinweis der Regel folgen; Eingaben von außen nur über pruefeKoerper und pruefeAbfrage aus src/utils/eingabe-pruefen.js lesen, Programme nur mit execFile und festen Argumenten starten, nie nosemgrep ergänzen; hältst du den Fund für falsch, im Issue begründen.`);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

async function gitleaksVerstoesse(ziel) {
  const ausgabe = await werkzeug("gitleaks", ["dir", "--config", "gitleaks.toml", "--redact", "--no-banner", "--exit-code", "0", "--report-format", "json", "--report-path", "-", ziel.pfad], { cwd: ziel.wurzel });
  if (ausgabe === undefined) return [];
  try {
    return JSON.parse(ausgabe).map(({ RuleID: regel, Description: beschreibung, StartLine: zeile }) => `${ziel.pfad}:${zeile}  gitleaks  ${beschreibung} (${regel}). ${WEG} erfundene Werte in Tests nur aus test/gemeinsam/erfundene-geheimnisse.js nehmen und dort ergänzen; echte Geheimnisse nur über .env oder das Render-Dashboard, nie in Dateien.`);
  } catch {
    return [];
  }
}

async function typVerstoesse(ziel) {
  if (!TSC_ENDUNGEN.has(extname(ziel.datei))) return [];
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  const ausgabe = await ausfuehren(process.execPath, [tsc, "--noEmit", "--pretty", "false"], { cwd: ziel.wurzel, timeout: HINTERGRUND_FRIST_MS, maxBuffer: PUFFER_BYTES }).then(() => "", (fehler) => fehler.stdout ?? "");
  const fehler = ausgabe.split("\n").map((zeile) => TSC_ZEILE.exec(zeile)).filter((treffer) => treffer !== null);
  const eigene = fehler.filter(([, datei]) => datei === ziel.pfad);
  const andere = fehler.filter(([, datei]) => datei !== ziel.pfad);
  return [...eigene, ...andere]
    .slice(0, MAX_TYPFEHLER)
    .map(([, datei, zeile, code, meldung]) => `${datei}:${zeile}  typpruefung  ${code} ${meldung} ${WEG} den Typ oder den Aufruf an der Stelle korrigieren, die Typen kommen aus der Datei selbst; kein any und kein @ts-ignore einführen.`);
}

const PRUEFUNGEN = [eslintVerstoesse, syntaxVerstoesse, bestandsVerstoesse, wachstumsVerstoesse, schrankenVerstoesse, architekturVerstoesse, katalogVerstoesse];
const HINTERGRUND_PRUEFUNGEN = [semgrepVerstoesse, gitleaksVerstoesse, typVerstoesse];

function uebersprungen(fehler) {
  return `sofort-pruefen: Prüfung übersprungen (${String(fehler.message).split("\n")[0]})`;
}

async function main() {
  const ziel = zuPruefendeDatei(readInput());
  if (ziel === undefined) return;
  chdir(ziel.wurzel);
  const uebersprungene = [];
  const pruefungen = argv.includes(HINTERGRUND) ? HINTERGRUND_PRUEFUNGEN : PRUEFUNGEN;
  const ergebnisse = await Promise.all(pruefungen.map(async (pruefung) => {
    try {
      return await pruefung(ziel);
    } catch (fehler) {
      uebersprungene.push(uebersprungen(fehler));
      return [];
    }
  }));
  const gefunden = ergebnisse.flat();
  if (gefunden.length > 0) block("hooks/sofort-pruefen", [...gefunden, ...uebersprungene]);
  for (const zeile of uebersprungene) console.error(zeile);
}

main().catch((fehler) => {
  console.error(uebersprungen(fehler));
});
