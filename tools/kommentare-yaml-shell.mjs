import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { befundeMeldenUndScheitern } from "./auftrag/zweck.mjs";

const DATEIMUSTER = ["*.yml", "*.yaml", "*.sh", "*.command", ".githooks/*"];
const YAML_DATEI = /\.ya?ml$/;
const BLOCKSKALAR_KOPF = /^(\s*(?:-\s+)?)([^\s#:][^:#]*?)\s*:\s*[|>][-+0-9]*\s*(?:#.*)?$/;
const HEREDOC = /^<<(-?)\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\2/;
const SHELL_SCHLUESSEL = "run";
const ERLAUBTE_STARTZEILEN = new Set(["#!/bin/bash", "#!/bin/sh", "#!/usr/bin/env bash"]);
const RAUTE = "#";
const RUECKSTRICH = "\\";
const EINFACH = "'";
const DOPPELT = '"';
const ANSI_ANFANG = "$'";
const AUSDRUCK_ANFANG = "${{";
const AUSDRUCK_ENDE = "}}";
const PARAMETER_ANFANG = "${";
const PARAMETER_ENDE = "}";
const BEFEHL_ANFANG = "$(";
const BEFEHL_ENDE = ")";
const KLAMMER_AUF = "(";
const SHELL_GRENZE = /[\s;&|()]/;
const YAML_GRENZE = /\s/;
const ZEILENENDE = "\n";
const ERSTE_ZEILE = 1;
const ZEILE_NACH_STARTZEILE = 2;
const MASKIERT = 2;
const HEREDOC_NAME = 3;
const HEREDOC_ANFANG = "<";
const HERESTRING = "<<<";
const MAX_GIT_AUSGABE = 268_435_456;
const WERKZEUG = "kommentare-yaml-shell";
const ZWECK = "lint/kommentare-yaml-shell";

function einzug(zeile) {
  return zeile.length - zeile.trimStart().length;
}

function istLeer(zeile) {
  return zeile.trim() === "";
}

function bisEnde(zeile, index, ende) {
  const gefunden = zeile.indexOf(ende, index);
  return gefunden === -1 ? zeile.length : gefunden + ende.length;
}

function oben(stapel) {
  return stapel.at(-1);
}

function ohneOberstes(stapel) {
  return stapel.slice(0, -1);
}

function gemeinsamUebersprungen(zeile, index, shell) {
  if (zeile.startsWith(AUSDRUCK_ANFANG, index)) return { weiter: bisEnde(zeile, index, AUSDRUCK_ENDE) };
  if (shell && zeile[index] === RUECKSTRICH) return { weiter: index + MASKIERT };
  return undefined;
}

function befehlAnfang(zeile, index, { shell, stapel }) {
  if (!shell || !zeile.startsWith(BEFEHL_ANFANG, index)) return undefined;
  return { weiter: index + BEFEHL_ANFANG.length, stapel: [...stapel, BEFEHL_ANFANG], grenze: true };
}

function imZitatLesen(zeile, index, zustand) {
  const zeichen = zeile[index];
  const { stapel } = zustand;
  const zitat = oben(stapel);
  if (zitat === ANSI_ANFANG && zeichen === RUECKSTRICH) return { weiter: index + MASKIERT };
  if (zitat === EINFACH || zitat === ANSI_ANFANG) {
    return zeichen === EINFACH ? { weiter: index + 1, stapel: ohneOberstes(stapel) } : { weiter: index + 1 };
  }
  const sprung = gemeinsamUebersprungen(zeile, index, true) ?? befehlAnfang(zeile, index, zustand);
  if (sprung !== undefined) return sprung;
  if (zeichen === DOPPELT) return { weiter: index + 1, stapel: ohneOberstes(stapel) };
  return { weiter: index + 1 };
}

function parameterUebersprungen(zeile, index, shell) {
  if (!shell || !zeile.startsWith(PARAMETER_ANFANG, index)) return undefined;
  return { weiter: bisEnde(zeile, index, PARAMETER_ENDE) };
}

function ansiAnfang(zeile, index, { shell, stapel }) {
  if (!shell || !zeile.startsWith(ANSI_ANFANG, index)) return undefined;
  return { weiter: index + ANSI_ANFANG.length, stapel: [...stapel, ANSI_ANFANG] };
}

function freiUebersprungen(zeile, index, zustand) {
  return (
    gemeinsamUebersprungen(zeile, index, zustand.shell) ??
    parameterUebersprungen(zeile, index, zustand.shell) ??
    befehlAnfang(zeile, index, zustand) ??
    ansiAnfang(zeile, index, zustand)
  );
}

function klammerLesen(zeichen, index, stapel) {
  const offen = oben(stapel);
  if (zeichen === BEFEHL_ENDE && offen === BEFEHL_ANFANG) return { weiter: index + 1, stapel: ohneOberstes(stapel) };
  if (zeichen === BEFEHL_ENDE && offen === KLAMMER_AUF) return { weiter: index + 1, stapel: ohneOberstes(stapel), grenze: true };
  if (zeichen !== KLAMMER_AUF || ![BEFEHL_ANFANG, KLAMMER_AUF].includes(offen)) return undefined;
  return { weiter: index + 1, stapel: [...stapel, KLAMMER_AUF], grenze: true };
}

function freiLesen(zeile, index, zustand) {
  const { stapel } = zustand;
  const sprung = freiUebersprungen(zeile, index, zustand);
  if (sprung !== undefined) return sprung;
  const zeichen = zeile[index];
  const klammer = klammerLesen(zeichen, index, stapel);
  if (klammer !== undefined) return klammer;
  if (zeichen === EINFACH || zeichen === DOPPELT) return { weiter: index + 1, stapel: [...stapel, zeichen] };
  if (zeichen === RAUTE && zustand.grenze) return { kommentar: zeile.slice(index + 1) };
  return { weiter: index + 1, grenze: (zustand.shell ? SHELL_GRENZE : YAML_GRENZE).test(zeichen) };
}

function zeichenLesen(zeile, index, zustand) {
  const zitiert = [EINFACH, DOPPELT, ANSI_ANFANG].includes(oben(zustand.stapel));
  return zitiert ? imZitatLesen(zeile, index, zustand) : freiLesen(zeile, index, zustand);
}

function heredocAb(zeile, index, zustand) {
  const moeglich = zustand.shell && zustand.stapel.length === 0 && zeile[index] === HEREDOC_ANFANG;
  if (!moeglich || zeile.startsWith(HERESTRING, index)) return undefined;
  return HEREDOC.exec(zeile.slice(index))?.[HEREDOC_NAME];
}

function zeileLesen(zeile, { shell, stapel: anfangsStapel }) {
  let stapel = anfangsStapel;
  let index = 0;
  let heredoc;
  let grenze = true;
  while (index < zeile.length) {
    heredoc = heredocAb(zeile, index, { shell, stapel }) ?? heredoc;
    const schritt = zeichenLesen(zeile, index, { shell, stapel, grenze });
    if (schritt.kommentar !== undefined) return { kommentar: schritt.kommentar, heredoc, stapel };
    stapel = schritt.stapel ?? stapel;
    grenze = schritt.grenze === true;
    index = schritt.weiter;
  }
  return { heredoc, stapel };
}

function heredocZeile(zeile, offen) {
  if (zeile.trim() === offen.ende) return { offen: undefined, stapel: [] };
  const startzeile = offen.erste && ERLAUBTE_STARTZEILEN.has(zeile.trim());
  const weiter = { ...offen, erste: false };
  if (startzeile) return { offen: weiter, stapel: [] };
  const { kommentar } = zeileLesen(zeile, { shell: true, stapel: [] });
  return { offen: weiter, kommentar, stapel: [] };
}

export function shellKommentare(zeilen, ersteNummer = ERSTE_ZEILE) {
  const gefunden = [];
  let stapel = [];
  let offen;
  for (const [index, zeile] of zeilen.entries()) {
    const ergebnis = offen ? heredocZeile(zeile, offen) : zeileLesen(zeile, { shell: true, stapel });
    stapel = ergebnis.stapel;
    if (offen) offen = ergebnis.offen;
    else if (ergebnis.heredoc !== undefined) offen = { ende: ergebnis.heredoc, erste: true };
    if (ergebnis.kommentar !== undefined) {
      gefunden.push({ zeile: ersteNummer + index, text: ergebnis.kommentar });
    }
  }
  return gefunden;
}

function blockEnde(zeilen, start, schluesselSpalte) {
  let ende = start;
  while (ende < zeilen.length && (istLeer(zeilen[ende]) || einzug(zeilen[ende]) > schluesselSpalte)) {
    ende += 1;
  }
  return ende;
}

function ohneEinzug(zeilen) {
  const einzuege = zeilen.filter((zeile) => !istLeer(zeile)).map(einzug);
  const kleinster = einzuege.length === 0 ? 0 : Math.min(...einzuege);
  return zeilen.map((zeile) => zeile.slice(kleinster));
}

function yamlZeile(zeile) {
  return zeileLesen(zeile, { shell: false, stapel: [] }).kommentar;
}

function blockskalare(zeilen) {
  const bloecke = [];
  let index = 0;
  while (index < zeilen.length) {
    const kopf = BLOCKSKALAR_KOPF.exec(zeilen[index]);
    index += 1;
    if (kopf === null) continue;
    const ende = blockEnde(zeilen, index, kopf[1].length);
    const shell = kopf[2] === SHELL_SCHLUESSEL ? { anfang: index + 1, zeilen: ohneEinzug(zeilen.slice(index, ende)) } : undefined;
    bloecke.push({ rumpf: index, ende, shell });
    index = ende;
  }
  return bloecke;
}

export function shellBloecke(zeilen) {
  return blockskalare(zeilen)
    .map(({ shell }) => shell)
    .filter((shell) => shell !== undefined);
}

function yamlZeilen(zeilen, von, bis) {
  const gefunden = [];
  for (let index = von; index < bis; index += 1) {
    const kommentar = yamlZeile(zeilen[index]);
    if (kommentar !== undefined) gefunden.push({ zeile: index + 1, text: kommentar });
  }
  return gefunden;
}

export function yamlKommentare(zeilen) {
  const gefunden = [];
  let weiter = 0;
  for (const { rumpf, ende, shell } of blockskalare(zeilen)) {
    gefunden.push(...yamlZeilen(zeilen, weiter, rumpf));
    if (shell !== undefined) gefunden.push(...shellKommentare(shell.zeilen, shell.anfang));
    weiter = ende;
  }
  gefunden.push(...yamlZeilen(zeilen, weiter, zeilen.length));
  return gefunden;
}

export function kommentareImText(pfad, text) {
  const zeilen = text.split(ZEILENENDE);
  if (YAML_DATEI.test(pfad)) return yamlKommentare(zeilen);
  if (!ERLAUBTE_STARTZEILEN.has(zeilen[0])) return shellKommentare(zeilen);
  return shellKommentare(zeilen.slice(1), ZEILE_NACH_STARTZEILE);
}

export function istYamlOderShell(pfad) {
  return (
    YAML_DATEI.test(pfad) ||
    /\.(?:sh|command)$/.test(pfad) ||
    (pfad.startsWith(".githooks/") && !pfad.slice(".githooks/".length).includes("/"))
  );
}

export function versionierteDateien(root) {
  const liste = execFileSync("git", ["ls-files", "-z", "--", ...DATEIMUSTER], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_GIT_AUSGABE,
  });
  return liste.split("\0").filter(Boolean).sort();
}

function fundorte(root) {
  return versionierteDateien(root).flatMap((pfad) =>
    kommentareImText(pfad, readFileSync(join(root, pfad), "utf8")).map(({ zeile }) => `${pfad}:${zeile}`),
  );
}

function pruefen(root) {
  const funde = fundorte(root);
  befundeMeldenUndScheitern(funde, ZWECK);
  console.log(`${funde.length} neue Befunde von ${WERKZEUG}.`);
}

function direktGestartet() {
  const gestartet = process.argv[1];
  return gestartet !== undefined && realpathSync(gestartet) === fileURLToPath(import.meta.url);
}

if (direktGestartet()) pruefen(process.cwd());
