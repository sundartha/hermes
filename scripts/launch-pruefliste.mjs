#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SPALTEN = ["Kennung", "Punkt", "Schwelle", "Wert", "Belegt am", "Beleg", "Anleitung"];
const KEIN = "—";
const EXIT_ROT = 1;
const EXIT_AUFRUF = 2;
const ARGV_OFFSET = 2;
const ZEILE_TRENNER = 1;
const ZEILE_DATEN = 2;
const TAG_LAENGE = 10;
const ISO_DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;
const SCHWELLE = /^(≥|≤) (\d+(?:,\d+)?)$/;
const ZAHL = /^\d+(?:,\d+)?$/;
const DEFAULT_LISTE = "docs/betrieb/launch-pruefliste.md";
const RESTORE = "docs/RUNBOOK-RESTORE.md";

const anleitung = (name) => `docs/betrieb/${name}.md`;

export const PFLICHT = Object.freeze({
  Q1: { schwelle: "≤ 0,5" },
  Q2: { schwelle: "≤ 0" },
  Q3: { schwelle: "≤ 120" },
  Q4: { schwelle: "≤ 0" },
  Q5: { schwelle: "≥ 20" },
  Q6: { schwelle: "≤ 2000" },
  Q7: { schwelle: "≤ 2000" },
  Q8: { schwelle: "≤ 30" },
  Q9: { schwelle: "≥ 1" },
  Q10: { schwelle: "≤ 8000" },
  Q11: { schwelle: "≥ 1" },
  N1: { anleitung: anleitung("notruf-n1") },
  N2: { anleitung: anleitung("notruf-n2") },
  N3: { anleitung: anleitung("notruf-n3") },
  N4: { anleitung: anleitung("notruf-n4") },
  R1: { anleitung: RESTORE },
  K1: { schwelle: "≥ 20", anleitung: anleitung("kontingente") },
  K2: { schwelle: "≥ 20", anleitung: anleitung("kontingente") },
  K3: { schwelle: "≥ 20", anleitung: anleitung("kontingente") },
  B1: { schwelle: "≥ 1", anleitung: anleitung("bereitschaft") },
  G1: { anleitung: anleitung("geheimnis-tausch") },
});

const trenneZellen = (zeile) => {
  const innen = zeile.trim().replace(/^\|/, "").replace(/\|$/, "");
  return innen.split("|").map((zelle) => zelle.trim());
};

const istTrenner = (zeile) => /^\|?[\s:|-]+\|?$/.test(zeile) && zeile.includes("-");

export function leseTabelle(text) {
  const zeilen = text.split("\n").filter((zeile) => zeile.trim().startsWith("|"));
  if (zeilen.length === 0) return { fehler: "keine Tabelle" };
  const kopf = trenneZellen(zeilen[0]);
  if (kopf.join("|") !== SPALTEN.join("|")) return { fehler: "Spalten stimmen nicht" };
  if (zeilen.length <= ZEILE_TRENNER || !istTrenner(zeilen[ZEILE_TRENNER])) return { fehler: "Trennzeile fehlt" };
  const reihen = [];
  for (const zeile of zeilen.slice(ZEILE_DATEN)) {
    const zellen = trenneZellen(zeile);
    if (zellen.length !== SPALTEN.length) return { fehler: `kaputte Zeile: ${zeile}` };
    reihen.push(Object.fromEntries(SPALTEN.map((spalte, index) => [spalte, zellen[index]])));
  }
  return { reihen };
}

const leer = (wert) => wert === "" || wert === KEIN;
const zahl = (text) => Number(text.replace(",", "."));
const tagVon = (datum) => datum.toISOString().slice(0, TAG_LAENGE);

function datumFehler(text, heute) {
  if (!ISO_DATUM.test(text)) return "Datum fehlt oder ist kein ISO-Datum";
  const datum = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(datum.getTime()) || tagVon(datum) !== text) return "Datum ist kein echtes Datum";
  return text > heute ? "Datum liegt in der Zukunft" : null;
}

function schwellenFehler(reihe, soll) {
  if (reihe.Schwelle !== soll) return `Schwelle weicht von ${soll} ab`;
  const treffer = SCHWELLE.exec(soll);
  if (!ZAHL.test(reihe.Wert)) return "Wert nicht lesbar";
  const wert = zahl(reihe.Wert);
  const grenze = zahl(treffer[2]);
  const ok = treffer[1] === "≥" ? wert >= grenze : wert <= grenze;
  return ok ? null : `Wert ${reihe.Wert} verfehlt Schwelle ${soll}`;
}

function anleitungFehler(reihe, soll, wurzel) {
  if (reihe.Anleitung !== soll) return `Anleitung muss ${soll} sein`;
  return fs.existsSync(path.join(wurzel, soll)) ? null : `Anleitungsdatei fehlt: ${soll}`;
}

function ohneSchwelleFehler(reihe) {
  return leer(reihe.Schwelle) ? null : "Schwelle nicht vorgesehen";
}

export function pruefePunkt(reihe, spec, kontext) {
  const teile = [
    spec.schwelle ? schwellenFehler(reihe, spec.schwelle) : ohneSchwelleFehler(reihe),
    datumFehler(reihe["Belegt am"], kontext.heute),
    leer(reihe.Beleg) ? "Beleg fehlt" : null,
    spec.anleitung ? anleitungFehler(reihe, spec.anleitung, kontext.wurzel) : null,
  ];
  return teile.find(Boolean) ?? null;
}

function grundFuer(reihe, gesehen, kontext) {
  const spec = PFLICHT[reihe.Kennung];
  if (!spec) return "unbekannte Kennung";
  if (gesehen.has(reihe.Kennung)) return "doppelte Kennung";
  return pruefePunkt(reihe, spec, kontext);
}

export function bewerte(tabelle, kontext) {
  if (tabelle.fehler) return [{ kennung: "-", grund: tabelle.fehler }];
  const ergebnis = [];
  const gesehen = new Set();
  for (const reihe of tabelle.reihen) {
    ergebnis.push({ kennung: reihe.Kennung, grund: grundFuer(reihe, gesehen, kontext) });
    gesehen.add(reihe.Kennung);
  }
  for (const kennung of Object.keys(PFLICHT)) {
    if (!gesehen.has(kennung)) ergebnis.push({ kennung, grund: "Punkt fehlt" });
  }
  return ergebnis;
}

export function argumente(argv) {
  const args = argv.slice(ARGV_OFFSET);
  const index = args.indexOf("--wurzel");
  const wurzel = index >= 0 ? args.splice(index, ZEILE_DATEN)[1] : null;
  return { liste: args[0] ?? null, wurzel };
}

function wurzelVon(liste, wurzelArg) {
  if (wurzelArg) return path.resolve(wurzelArg);
  return path.resolve(path.dirname(liste), "..", "..");
}

export function lauf(argv, heute) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const arg = argumente(argv);
  const liste = path.resolve(arg.liste ?? path.join(repo, DEFAULT_LISTE));
  if (!fs.existsSync(liste)) {
    return { code: EXIT_AUFRUF, zeilen: [`Prüfliste fehlt: ${liste}`] };
  }
  const kontext = { wurzel: wurzelVon(liste, arg.wurzel), heute };
  const ergebnis = bewerte(leseTabelle(fs.readFileSync(liste, "utf8")), kontext);
  const zeilen = ergebnis.map((punkt) => (punkt.grund ? `rot ${punkt.kennung} ${punkt.grund}` : `gruen ${punkt.kennung}`));
  const rot = ergebnis.some((punkt) => punkt.grund);
  return { code: rot ? EXIT_ROT : 0, zeilen };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ergebnis = lauf(process.argv, tagVon(new Date()));
  console.log(ergebnis.zeilen.join("\n"));
  process.exit(ergebnis.code);
}
