import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

import { matches } from "../pruefungen-messen.mjs";

export const ARTEN = ["funktion", "fehlerbehebung", "umbau"];
export const FUNKTIONSKARTE = "FUNKTIONSKARTE.md";
const ARTEN_MIT_ROTEM_TEST = new Set(["funktion", "fehlerbehebung"]);
const NIE_SCHLUESSEL = ["wiederholung", "gleichzeitig", "zeitueberschreitung", "abbruch"];
const KENNUNG = /^[a-z0-9][a-z0-9-]*$/i;
const ABNAHMETEST = /^test\/.+\.test\.[cm]?js$/;
const TESTDATEI = /(^|\/)test\/|\.test\.[cm]?js$/;
const TYPDATEI_ENDUNG = ".d.ts";
const JS_ENDUNG = /\.[cm]?js$/;
const MAX_BETREFF = 72;
const CODEOWNERS = ".github/CODEOWNERS";
const VERANKERT = "/";
const LEERRAUM = /\s+/;

export function ladePhase(pfad) {
  return JSON.parse(readFileSync(pfad, "utf8"));
}

export function brauchtRotenTest(auftrag) {
  return ARTEN_MIT_ROTEM_TEST.has(auftrag.art);
}

export function istTestdatei(pfad) {
  return TESTDATEI.test(pfad);
}

export function imBereich(bereich, pfad) {
  return bereich.endsWith("/") ? pfad.startsWith(bereich) : pfad === bereich;
}

function bereichsVerzeichnis(bereich) {
  return bereich.endsWith("/") ? bereich : `${dirname(bereich)}/`;
}

export function gehoertZumBereich(bereich, pfad) {
  if (imBereich(bereich, pfad)) return true;
  if (pfad === `${bereichsVerzeichnis(bereich)}${FUNKTIONSKARTE}`) return true;
  if (!pfad.endsWith(TYPDATEI_ENDUNG)) return false;
  return bereich.endsWith("/")
    ? pfad.startsWith(bereich)
    : pfad === bereich.replace(JS_ENDUNG, TYPDATEI_ENDUNG);
}

export function funktionskartePfad(bereich) {
  return `${bereichsVerzeichnis(bereich)}${FUNKTIONSKARTE}`;
}

export function geschuetzteMuster(root) {
  const pfad = join(root, CODEOWNERS);
  if (!existsSync(pfad)) return [];
  const zeilen = readFileSync(pfad, "utf8").split("\n");
  const muster = zeilen.map((zeile) => zeile.trim().split(LEERRAUM)[0]);
  return muster.filter((eintrag) => eintrag && !eintrag.startsWith("#"));
}

export function istGeschuetzt(muster, pfad) {
  return muster.some((eintrag) => {
    if (eintrag.startsWith(VERANKERT)) return matches(eintrag.slice(1), pfad);
    return matches(eintrag, pfad) || matches(eintrag, basename(pfad));
  });
}

function textFehlt(wert) {
  return typeof wert !== "string" || wert.trim() === "";
}

function einzeilig(wert) {
  return !textFehlt(wert) && !wert.includes("\n");
}

function pfadIstSauber(pfad) {
  if (textFehlt(pfad) || isAbsolute(pfad) || pfad.includes("\\")) return false;
  const segmente = pfad.replace(/\/$/, "").split("/");
  return segmente.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function artBefunde(auftrag) {
  const befunde = [];
  if (!ARTEN.includes(auftrag.art)) befunde.push(`art muss eine von ${ARTEN.join(", ")} sein`);
  if (!einzeilig(auftrag.ziel) || auftrag.ziel.length > MAX_BETREFF) {
    befunde.push(`ziel muss eine Zeile mit höchstens ${MAX_BETREFF} Zeichen sein`);
  }
  return befunde;
}

function bereichBefunde(auftrag, kontext) {
  if (!pfadIstSauber(auftrag.bereich)) return ["bereich muss ein relativer Pfad im Repo sein"];
  const befunde = [];
  if (istGeschuetzt(kontext.muster, auftrag.bereich)) {
    befunde.push(`bereich ${auftrag.bereich} ist geschützt (${CODEOWNERS})`);
  }
  if (textFehlt(kontext.entwurf?.[auftrag.bereich])) {
    befunde.push(`der Phase fehlt der Entwurfsabschnitt entwurf["${auftrag.bereich}"]`);
  }
  const erwartet = Array.isArray(auftrag.erwarteteDateien) ? auftrag.erwarteteDateien : null;
  if (erwartet === null) return [...befunde, "erwarteteDateien muss eine Liste sein"];
  const fremd = erwartet.filter(
    (pfad) => !pfadIstSauber(pfad) || !(imBereich(auftrag.bereich, pfad) || istTestdatei(pfad)),
  );
  return [...befunde, ...fremd.map((pfad) => `erwartete Datei ${pfad} liegt nicht im Bereich`)];
}

function vorbildBefunde(auftrag, kontext) {
  if (!pfadIstSauber(auftrag.vorbild)) return ["vorbild muss ein relativer Pfad sein"];
  if (existsSync(join(kontext.root, auftrag.vorbild))) return [];
  return [`vorbild ${auftrag.vorbild} existiert nicht`];
}

function abnahmeBefunde(auftrag, kontext) {
  if (!ABNAHMETEST.test(auftrag.abnahme ?? "") || !pfadIstSauber(auftrag.abnahme)) {
    return ["abnahme muss eine Testdatei test/….test.js sein"];
  }
  const befunde = [];
  if (istGeschuetzt(kontext.muster, auftrag.abnahme)) {
    befunde.push(`abnahme ${auftrag.abnahme} ist geschützt (${CODEOWNERS})`);
  }
  const vorhanden = existsSync(join(kontext.root, auftrag.abnahme));
  if (!brauchtRotenTest(auftrag) && !vorhanden) {
    befunde.push(`ein Umbau braucht einen bestehenden Verhaltenstest, ${auftrag.abnahme} fehlt`);
  }
  if (brauchtRotenTest(auftrag) && !einzeilig(auftrag.erwarteterFehler)) {
    befunde.push("erwarteterFehler muss für Funktion und Fehlerbehebung eine Zeile sein");
  }
  return befunde;
}

function nieBefunde(auftrag) {
  const nie = auftrag.wasDarfNiePassieren;
  if (nie === undefined && !brauchtRotenTest(auftrag)) return [];
  if (nie === null || typeof nie !== "object") {
    return ["wasDarfNiePassieren fehlt; Pflicht für Funktion und Fehlerbehebung"];
  }
  return NIE_SCHLUESSEL.filter((schluessel) => textFehlt(nie[schluessel])).map(
    (schluessel) => `wasDarfNiePassieren.${schluessel} fehlt`,
  );
}

function abhaengigkeitBefunde(auftrag, kontext) {
  const liste = auftrag.abhaengigVon ?? [];
  if (!Array.isArray(liste)) return ["abhaengigVon muss eine Liste sein"];
  return liste
    .filter((kennung) => kennung === auftrag.id || !kontext.kennungen.has(kennung))
    .map((kennung) => `abhaengigVon nennt ${kennung}, das ist kein anderer Auftrag der Phase`);
}

function auftragBefunde(auftrag, kontext) {
  const befunde = [
    ...artBefunde(auftrag),
    ...bereichBefunde(auftrag, kontext),
    ...vorbildBefunde(auftrag, kontext),
    ...abnahmeBefunde(auftrag, kontext),
    ...nieBefunde(auftrag),
    ...abhaengigkeitBefunde(auftrag, kontext),
  ];
  return befunde.map((befund) => `${auftrag.id}: ${befund}`);
}

function kennungBefunde(auftraege) {
  const gesehen = new Set();
  const befunde = [];
  for (const { id } of auftraege) {
    if (typeof id !== "string" || !KENNUNG.test(id)) befunde.push(`ungültige id ${JSON.stringify(id)}`);
    else if (gesehen.has(id)) befunde.push(`id ${id} kommt doppelt vor`);
    gesehen.add(id);
  }
  return befunde;
}

export function reihenfolge(auftraege) {
  const nachKennung = new Map(auftraege.map((auftrag) => [auftrag.id, auftrag]));
  const zustand = new Map();
  const ordnung = [];
  const besuche = (auftrag, pfad) => {
    if (zustand.get(auftrag.id) === "fertig") return null;
    if (zustand.get(auftrag.id) === "offen") return [...pfad, auftrag.id];
    zustand.set(auftrag.id, "offen");
    for (const kennung of auftrag.abhaengigVon ?? []) {
      const vorgaenger = nachKennung.get(kennung);
      const zyklus = vorgaenger ? besuche(vorgaenger, [...pfad, auftrag.id]) : null;
      if (zyklus) return zyklus;
    }
    zustand.set(auftrag.id, "fertig");
    ordnung.push(auftrag);
    return null;
  };
  for (const auftrag of auftraege) {
    const zyklus = besuche(auftrag, []);
    if (zyklus) return { ordnung: [], zyklus };
  }
  return { ordnung, zyklus: null };
}

export function phasenBefunde(phase, root) {
  if (phase === null || typeof phase !== "object") return ["Die Phasendatei ist kein Objekt."];
  const befunde = [];
  if (typeof phase.phase !== "string" || !KENNUNG.test(phase.phase)) {
    befunde.push("phase muss eine Kennung aus Buchstaben, Ziffern und Bindestrichen sein");
  }
  const auftraege = Array.isArray(phase.auftraege) ? phase.auftraege : [];
  if (auftraege.length === 0) return [...befunde, "auftraege muss mindestens einen Auftrag enthalten"];
  befunde.push(...kennungBefunde(auftraege));
  const kontext = {
    root,
    entwurf: phase.entwurf,
    muster: geschuetzteMuster(root),
    kennungen: new Set(auftraege.map((auftrag) => auftrag.id)),
  };
  for (const auftrag of auftraege) befunde.push(...auftragBefunde(auftrag, kontext));
  const { zyklus } = reihenfolge(auftraege);
  if (zyklus) befunde.push(`abhaengigVon bildet einen Kreis: ${zyklus.join(" -> ")}`);
  return befunde;
}
