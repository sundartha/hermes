import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { abrufLaufBefund, gh, ghRepo, LAUF_FERTIG } from "../mutationspruefung/gh.mjs";
import { neuerTempOrdner } from "../temp-ordner.mjs";
import { git } from "./git.mjs";
import { bereicheZwischen } from "./kollision.mjs";
import { REMOTE } from "./sperren.mjs";
import { MASTER } from "./worktrees.mjs";

export const BELEG_ARTEFAKT = "mutationsurteil";
export const BELEG_DATEI = "beleg.json";
export const WERKZEUG_PFADE = [".github/workflows/ci.yml", "tools/mutationspruefung.mjs", "tools/mutationspruefung/", "tools/auftrag/", "stryker.config.json"];
export const WERKZEUG_ABGEWICHEN = "Werkzeugstand weicht ab";
const ERFOLG = "success";
const URTEIL_GRUEN = 0;
const BELEG_VERSION = 1;
const HINZUGEFUEGT = "A";
const TEST_ORDNER = "test/";
const ERSTE_ZEILE = 1;
const COMMIT = /^[0-9a-f]{40}$/;
const PRUEFSUMME = /^[0-9a-f]{64}$/;
const TRAILER = /^Absicherung: Lauf ([1-9]\d*) Auftrag (\S+)$/gm;
const STATUS_ZEILE = /^([A-Z])\t(.+)$/;
const EXIT_GLEICH = 0;
const NUR_COMMIT = "^{commit}";

export function pruefsumme(zeile) {
  return createHash("sha256").update(zeile).digest("hex");
}

export function trailerZeile(lauf, auftragId) {
  return `Absicherung: Lauf ${lauf} Auftrag ${auftragId}`;
}

export function vorabHerkunft(phase, auftrag) {
  return phase.paket ? `Paket: ${phase.paket}` : `Auftrag: ${phase.phase}/${auftrag.id}`;
}

export function absicherungsLauf(log, auftragId) {
  const treffer = [...log.matchAll(TRAILER)].filter(([, , kennung]) => kennung === auftragId);
  return treffer.length === 0 ? null : treffer[0][1];
}

function istBlock(block) {
  return block !== null && typeof block === "object" && typeof block.datei === "string" && Array.isArray(block.pruefsummen) && block.pruefsummen.every((summe) => PRUEFSUMME.test(summe));
}

export function gueltigerBeleg(beleg) {
  const form = beleg !== null && typeof beleg === "object" && beleg.version === BELEG_VERSION && COMMIT.test(beleg.commit) && Number.isInteger(beleg.urteil);
  return form && Array.isArray(beleg.bloecke) && beleg.bloecke.every(istBlock);
}

export function laufBefund(lauf, repo) {
  const erfolgreich = lauf.status === LAUF_FERTIG && lauf.conclusion === ERFOLG;
  return erfolgreich ? abrufLaufBefund(lauf, repo) : "ist nicht erfolgreich beendet";
}

function istTeilfolge(gross, klein) {
  const stellen = Array.from({ length: gross.length - klein.length + 1 }, (leer, index) => index);
  return stellen.some((start) => klein.every((summe, index) => gross[start + index] === summe));
}

function ohneBeleg(verschoben, bloecke) {
  return verschoben.filter(({ datei, pruefsummen }) => !bloecke.some((block) => block.datei === datei && istTeilfolge(block.pruefsummen, pruefsummen)));
}

function nurPfad(aenderung) {
  return aenderung.pfad;
}

function nurDatei(block) {
  return block.datei;
}

export function weglassBefund({ beleg, verschoben, testAenderungen }) {
  if (verschoben.length === 0) return "es gibt keine zu verschiebenden Zeilen";
  if (beleg.urteil !== URTEIL_GRUEN) return `das Urteil des Belegs ist nicht grün (Exit ${beleg.urteil})`;
  const fremde = testAenderungen.filter(({ status }) => status !== HINZUGEFUEGT).map(nurPfad);
  if (fremde.length > 0) return `seit dem Beleg ist unter ${TEST_ORDNER} geändert oder gelöscht: ${fremde.join(", ")}`;
  const offen = ohneBeleg(verschoben, beleg.bloecke);
  const dateien = [...new Set(offen.map(nurDatei))].join(", ");
  return offen.length === 0 ? null : `Zeilen in ${dateien} sind nicht wortgleich zur geprüften Fassung`;
}

export function verschobeneZeilen({ root, basis }) {
  const bereiche = bereicheZwischen({ cwd: root, von: basis, einfuegungen: false });
  return [...bereiche].flatMap(([datei, liste]) => {
    if (liste.length === 0) return [];
    const zeilen = git(["show", `${basis}:${datei}`], { cwd: root }).split("\n");
    return liste.map(([von, bis]) => ({ datei, pruefsummen: zeilen.slice(von - ERSTE_ZEILE, bis).map(pruefsumme) }));
  });
}

export function testAenderungenSeit({ root, commit }) {
  const ausgabe = git(["diff", "--name-status", "--no-renames", commit, "--", TEST_ORDNER], { cwd: root });
  return ausgabe.split("\n").flatMap((zeile) => {
    const treffer = STATUS_ZEILE.exec(zeile);
    return treffer === null ? [] : [{ status: treffer[1], pfad: treffer[2] }];
  });
}

function git0(argumente, root) {
  return spawnSync("git", argumente, { cwd: root, encoding: "utf8" });
}

export function werkzeugGleich(root, commit) {
  const geaendert = git0(["diff", "--quiet", commit, "--", ...WERKZEUG_PFADE], root);
  const neu = git0(["ls-files", "--others", "--exclude-standard", "--", ...WERKZEUG_PFADE], root);
  return geaendert.status === EXIT_GLEICH && neu.status === EXIT_GLEICH && neu.stdout.trim() === "";
}

function commitDa(root, commit) {
  if (git0(["cat-file", "-e", commit + NUR_COMMIT], root).status === EXIT_GLEICH) return true;
  git0(["fetch", "--quiet", "--no-tags", REMOTE, commit], root);
  return git0(["cat-file", "-e", commit + NUR_COMMIT], root).status === EXIT_GLEICH;
}

function belegAus(lauf, repo) {
  const ordner = neuerTempOrdner();
  gh(["run", "download", lauf, "-R", repo, "-n", BELEG_ARTEFAKT, "-D", ordner]);
  const datei = join(ordner, BELEG_DATEI);
  return existsSync(datei) ? JSON.parse(readFileSync(datei, "utf8")) : null;
}

function verworfen(grund, lauf) {
  return { weglassen: false, lauf, grund };
}

function geprueft({ root, basis, lauf }) {
  const repo = ghRepo();
  const meta = JSON.parse(gh(["api", `repos/${repo}/actions/runs/${lauf}`]));
  const befund = laufBefund(meta, repo);
  if (befund !== null) return verworfen(`der Lauf ${lauf} ${befund}`, lauf);
  if (!commitDa(root, meta.head_sha)) return verworfen(`der Commit des Laufs ${lauf} ist nicht abrufbar`, lauf);
  if (!werkzeugGleich(root, meta.head_sha)) return verworfen(WERKZEUG_ABGEWICHEN, lauf);
  const beleg = belegAus(lauf, repo);
  if (!gueltigerBeleg(beleg) || beleg.commit !== meta.head_sha) return verworfen(`der Lauf ${lauf} hat keinen gültigen Beleg abgelegt`, lauf);
  const eingang = { beleg, verschoben: verschobeneZeilen({ root, basis }), testAenderungen: testAenderungenSeit({ root, commit: beleg.commit }) };
  const grund = weglassBefund(eingang);
  return grund === null ? { weglassen: true, lauf, grund: "Zeilen wortgleich zur geprüften Fassung, unter test/ nur hinzugefügt, Urteil grün" } : verworfen(grund, lauf);
}

function verlauf(root) {
  const log = git0(["log", "--format=%B", `${MASTER}..HEAD`], root);
  return log.status === EXIT_GLEICH ? log.stdout : "";
}

export function vorabGeprueft({ root, basis, auftragId }) {
  const lauf = absicherungsLauf(verlauf(root), auftragId);
  if (lauf === null) return verworfen("kein Absicherungslauf für diesen Auftrag vermerkt", null);
  try {
    return geprueft({ root, basis, lauf });
  } catch (fehler) {
    return verworfen(`Beleg nicht abrufbar: ${fehler.message}`, lauf);
  }
}

export function belegZeilen({ root, basis, urteil }) {
  const bloecke = verschobeneZeilen({ root, basis });
  return { version: BELEG_VERSION, commit: git(["rev-parse", "HEAD"], { cwd: root }).trim(), urteil, bloecke };
}
