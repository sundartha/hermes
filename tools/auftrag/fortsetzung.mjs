import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { env, pid } from "node:process";
import { fileURLToPath } from "node:url";

import { auftragsBlock } from "./agenten.mjs";
import { brauchtRotenTest, imBereich } from "./format.mjs";
import { NUL, gemeinsamerOrdner, git, kopf } from "./git.mjs";
import { PRUEFUNG } from "./zweck.mjs";

export const ABLAGE = "auftrag-umbau";
export const PATCH_FORMAT = ["--no-ext-diff", "--no-color", "--src-prefix=a/", "--dst-prefix=b/"];
const VERSION = 3;
const STAND = ".fortsetzung.json";
const TEILE = ["abnahme"];
const ABNAHME = "abnahme";
const TOOLS = fileURLToPath(new URL("..", import.meta.url));
const WERKZEUG_ORDNER = ["auftrag", "mutationspruefung"].map((name) => join(TOOLS, name));
const WURZEL_DATEIEN = /^(?:stryker.*\.(?:json|c?js|mjs)|package-lock\.json)$/;
const GLEICHWERTIG_ZEILE = /^Gleichwertig: .+, weil \S.*$/;
const WERKZEUGABBRUCH = new Set(["mutation abbruch", "agent exit"]);

function pruefsumme(inhalt) {
  return createHash("sha256").update(inhalt).digest("hex");
}

function dateienUnter(ordner) {
  return readdirSync(ordner, { recursive: true })
    .map((name) => join(ordner, name))
    .filter((datei) => statSync(datei).isFile())
    .sort();
}

function werkzeugDateien(root) {
  const werkzeug = WERKZEUG_ORDNER.filter((ordner) => existsSync(ordner)).flatMap(dateienUnter).map((datei) => [relative(TOOLS, datei), datei]);
  const wurzel = readdirSync(root).filter((name) => WURZEL_DATEIEN.test(name)).sort().map((name) => [`wurzel/${name}`, join(root, name)]);
  return [...werkzeug, ...wurzel];
}

function werkzeugstand(root) {
  const summe = createHash("sha256");
  for (const [name, datei] of werkzeugDateien(root)) summe.update(`${name}${NUL}`).update(readFileSync(datei)).update(NUL);
  return summe.digest("hex");
}

function auftragsstand({ phase, auftrag }) {
  const { phase: name, issue, paket, absicht, entwurf } = phase;
  return pruefsumme(JSON.stringify([auftragsBlock(phase, auftrag), auftrag, name, issue, paket, absicht, entwurf]));
}

export function ablagePfad({ root, phase, auftrag }, endung) {
  return gemeinsamerOrdner(root, ABLAGE, phase.phase, `${auftrag.id}${endung}`);
}

function teilPfad(kontext, teil) {
  return ablagePfad(kontext, `.fortsetzung.${teil}.patch`);
}

export function fortsetzbar(auftrag) {
  return brauchtRotenTest(auftrag);
}

export function eingangsstand({ kontext, basis }) {
  return { basis, auftrag: auftragsstand(kontext), werkzeug: werkzeugstand(kontext.root) };
}

export function loescheFortsetzung(kontext) {
  rmSync(ablagePfad(kontext, STAND), { force: true });
  for (const teil of TEILE) rmSync(teilPfad(kontext, teil), { force: true });
}

function schreibeAtomar(datei, inhalt) {
  const entwurf = `${datei}.${pid}.tmp`;
  writeFileSync(entwurf, inhalt);
  renameSync(entwurf, datei);
}

function schreibePatch(root, datei, argumente) {
  const entwurf = `${datei}.${pid}.tmp`;
  git(["--literal-pathspecs", "diff", "--binary", "--no-renames", ...PATCH_FORMAT, `--output=${entwurf}`, ...argumente], { cwd: root });
  const inhalt = readFileSync(entwurf);
  if (inhalt.length === 0) {
    rmSync(entwurf);
    return null;
  }
  renameSync(entwurf, datei);
  return { datei, pruefsumme: pruefsumme(inhalt) };
}

function herkunft(lauf, stufe) {
  const { root } = lauf.kontext;
  const stand = { commit: kopf(root), baum: git(["write-tree"], { cwd: root }).trim() };
  const agenten = lauf.alleSitzungen();
  const pruefungen = lauf.pruefungen.map(({ name, exitCode }) => ({ name, exitCode }));
  return { stufe, ...stand, werkzeug: lauf.eingang.werkzeug, runde: lauf.runde, agenten, pruefungen };
}

function schreibeStand(lauf, stand) {
  schreibeAtomar(ablagePfad(lauf.kontext, STAND), JSON.stringify({ version: VERSION, ...lauf.eingang, runde: lauf.runde, zeit: new Date().toISOString(), ...stand }));
}

function nebenwerte(lauf) {
  return { gleichwertig: gleichwertigeZeilen(lauf), zweck: { bau: { ...lauf.zweck.bau }, test: { ...lauf.zweck.test } }, listenumzug: lauf.listenumzug ?? [] };
}

export function sichereAbnahme(lauf) {
  const { kontext, eingang, basis, basisBau } = lauf;
  if (eingang === null || basisBau === basis) return true;
  lauf.allesVormerken();
  const { root } = kontext;
  if (git(["diff", "--name-only", basis, basisBau], { cwd: root }).trim() === "") return true;
  mkdirSync(dirname(ablagePfad(kontext, STAND)), { recursive: true });
  loescheFortsetzung(kontext);
  const abnahme = schreibePatch(root, teilPfad(kontext, ABNAHME), [basis, basisBau]);
  schreibeStand(lauf, { stufe: ABNAHME, herkunft: herkunft(lauf, ABNAHME), abnahme, ...nebenwerte(lauf) });
  return true;
}

function gleichwertigeZeilen(lauf) {
  return lauf.berichtszeilen.filter((zeile) => GLEICHWERTIG_ZEILE.test(zeile));
}

function lies(datei) {
  try {
    const stand = JSON.parse(readFileSync(datei, "utf8"));
    return stand.version === VERSION ? stand : null;
  } catch {
    return null;
  }
}

function gitMit(root, argumente, umgebung) {
  return spawnSync("git", argumente, { cwd: root, env: umgebung, encoding: "utf8" });
}

function einspielbar(root, dateien) {
  const ordner = mkdtempSync(join(tmpdir(), "fortsetzung-"));
  const umgebung = { ...env, GIT_INDEX_FILE: join(ordner, "index") };
  try {
    const lesen = gitMit(root, ["read-tree", "HEAD"], umgebung);
    if (lesen.status !== 0) return lesen.stderr.trim();
    for (const datei of dateien) {
      const anwenden = gitMit(root, ["apply", "--cached", datei], umgebung);
      if (anwenden.status !== 0) return `${basename(datei)} lässt sich nicht einspielen: ${anwenden.stderr.trim()}`;
    }
    return null;
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function unveraendert(eintrag) {
  return existsSync(eintrag.datei) && pruefsumme(readFileSync(eintrag.datei)) === eintrag.pruefsumme;
}

function eingespielteTeile(stand) {
  return TEILE.map((teil) => [teil, stand[teil]]).filter(([, eintrag]) => eintrag !== null);
}

function basisGelesen(root, basis) {
  const art = gitMit(root, ["cat-file", "-t", basis], env);
  return art.status === 0 && art.stdout.trim() === "commit";
}

function betrifftAuftrag({ bereich, abnahme, erwarteteDateien }, pfad) {
  return imBereich(bereich, pfad) || pfad === abnahme || erwarteteDateien.includes(pfad);
}

function neueBasisAendert({ kontext }, alt, neu) {
  const { root, auftrag } = kontext;
  if (!basisGelesen(root, alt)) return "die alte Basis ist nicht mehr lesbar";
  const pfade = git(["diff", "--name-only", "--no-renames", "-z", alt, neu], { cwd: root }).split(NUL).filter(Boolean);
  const betroffen = pfade.filter((pfad) => betrifftAuftrag(auftrag, pfad));
  return betroffen.length === 0 ? null : `ändert den Bereich oder den Abnahmetest: ${betroffen.join(", ")}`;
}

function abweichung(lauf, stand) {
  const { eingang } = lauf;
  const basis = stand.basis === eingang.basis ? null : neueBasisAendert(lauf, stand.basis, eingang.basis);
  if (basis !== null) return `Basis ist eine andere und ${basis}`;
  if (stand.auftrag !== eingang.auftrag) return "Auftrag oder Phase haben sich geändert";
  const veraendert = eingespielteTeile(stand).find(([, eintrag]) => !unveraendert(eintrag));
  return veraendert === undefined ? null : `Patch ${veraendert[0]} fehlt oder wurde verändert`;
}

function ungueltig(lauf, stand) {
  const grund = abweichung(lauf, stand);
  if (grund !== null) return grund;
  return einspielbar(lauf.kontext.root, eingespielteTeile(stand).map(([, eintrag]) => eintrag.datei));
}

function wechsel(stand, eingang) {
  const neu = [stand.werkzeug === eingang.werkzeug ? [] : ["Werkzeugstand"], stand.basis === eingang.basis ? [] : ["Basis"]].flat();
  return neu.length === 0 ? null : `${neu.join(" und ")} neu`;
}

function ohnePruefergebnis(stand) {
  return { ...stand, gleichwertig: [] };
}

function gueltigerStand(lauf, stand) {
  const neu = wechsel(stand, lauf.eingang);
  if (neu !== null) {
    const ohne = ohnePruefergebnis(stand);
    console.error(`lauf: Fortsetzung auf gesichertem Stand (${neu}: nur die Arbeit der Agenten bis zur Stufe ${ohne.stufe} gilt weiter, der Abnahmetest wird eingespielt, der Bau-Agent baut neu; kein Prüfergebnis der Sicherung gilt, jede Prüfstufe läuft mit dem neuen Stand neu)`);
    return ohne;
  }
  console.error(`lauf: Fortsetzung auf gesichertem Stand (Stufe ${stand.stufe} aus Runde ${stand.runde} war grün; der Abnahmetest wird eingespielt, der Bau-Agent baut neu)`);
  return stand;
}

export function ladeOderVerwirfFortsetzung(lauf) {
  const { kontext } = lauf;
  if (lauf.eingang === null || !existsSync(ablagePfad(kontext, STAND))) return null;
  const stand = lies(ablagePfad(kontext, STAND));
  const grund = stand === null ? "Stand nicht lesbar" : ungueltig(lauf, stand);
  if (grund === null) return gueltigerStand(lauf, stand);
  console.error(`lauf: Gesicherter Stand verworfen (${grund}); der Auftrag beginnt von vorn.`);
  loescheFortsetzung(kontext);
  return null;
}

export function beendeFortsetzung(lauf, gruen) {
  if (lauf.eingang === null) return;
  const abgebrochen = lauf.roteIds.some((id) => WERKZEUGABBRUCH.has(id));
  if (gruen || !abgebrochen) loescheFortsetzung(lauf.kontext);
}

function spieleEin(lauf, teil) {
  const eintrag = lauf.fortsetzung[teil];
  if (eintrag === null) return true;
  if (!unveraendert(eintrag)) return lauf.scheitert(`Der Patch ${teil} der Fortsetzung wurde seit dem Prüfen verändert.`);
  return lauf.gruen(PRUEFUNG.UMBAU_EINSPIELEN, ["git", "apply", "--index", eintrag.datei]);
}

export function fortgesetzteSchritte(lauf, vorBau) {
  const abnahme = [() => lauf.stelleFortsetzungHer() && spieleEin(lauf, ABNAHME), ...vorBau.slice(1)];
  return [...abnahme, ...lauf.bauSchritte()];
}

