import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

import { matches } from "../pruefungen-messen.mjs";

export const ARTEN = ["funktion", "fehlerbehebung", "umbau", "testumbau"];
export const TESTUMBAU = "testumbau";
export const FUNKTIONSKARTE = "FUNKTIONSKARTE.md";
export const UMBAU_AUSWEG = "keiner, weil Umbau: bestehende Tests bleiben unverändert grün";
export const ABSICHT = "Absicht";
export const ABSICHT_HOECHSTENS = 1000;
const ARTEN_MIT_ROTEM_TEST = new Set(["funktion", "fehlerbehebung"]);
const UMBAU_ARTEN = new Set(["umbau", TESTUMBAU]);
const KENNUNG = /^[a-z0-9][a-z0-9-]*$/i;
const ABNAHMETEST = /^test\/.+\.test\.[cm]?js$/;
const TESTDATEI = /(^|\/)test\/|\.test\.[cm]?js$/;
const AUSFUEHRBARER_TEST = /\.test\.[cm]?js$/;
const TYPDATEI_ENDUNG = ".d.ts";
const JS_ENDUNG = /\.[cm]?js$/;
const JS_DATEI = /\.js$/;
const TS_ENDUNG = ".ts";
const MAX_BETREFF = 72;
const CODEOWNERS = ".github/CODEOWNERS";
const VERANKERT = "/";
const LEERRAUM = /\s+/;
const PHASE_AUS_PITCH = /^P-/i;
const NUMMER = /^[SBT][1-9]\d*$/;

export function ladePhase(pfad) {
  return JSON.parse(readFileSync(pfad, "utf8"));
}

export function absichtBefunde(absicht) {
  if (typeof absicht !== "string" || absicht.trim() === "") {
    return [`${ABSICHT} ist leer; sie sagt in 2 bis 4 Sätzen, wofür die Änderung da ist, welche Abkürzung nicht gewollt ist und wie im Zweifel zu wählen ist`];
  }
  if (absicht.length > ABSICHT_HOECHSTENS) return [`${ABSICHT} hat ${absicht.length} Zeichen, höchstens ${ABSICHT_HOECHSTENS} (2 bis 4 Sätze)`];
  return [];
}

export function brauchtRotenTest(auftrag) {
  return ARTEN_MIT_ROTEM_TEST.has(auftrag.art);
}

export function istTestdatei(pfad) {
  return TESTDATEI.test(pfad);
}

export function istAusfuehrbarerTest(pfad) {
  return AUSFUEHRBARER_TEST.test(pfad);
}

export function istUmbau(auftrag) {
  return UMBAU_ARTEN.has(auftrag.art);
}

export function istTestbereich(bereich) {
  return typeof bereich === "string" && istTestdatei(bereich);
}

export function imBereich(bereich, pfad) {
  return bereich.endsWith("/") ? pfad.startsWith(bereich) : pfad === bereich;
}

function bereichsVerzeichnis(bereich) {
  return bereich.endsWith("/") ? bereich : `${dirname(bereich)}/`;
}

function imBereichOderZwilling(bereich, pfad) {
  return imBereich(bereich, pfad) || (JS_DATEI.test(bereich) && pfad === bereich.replace(JS_DATEI, TS_ENDUNG));
}

export function gehoertZumBereich(bereich, pfad) {
  if (imBereichOderZwilling(bereich, pfad)) return true;
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

export function pfadIstSauber(pfad) {
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

function testbereichBefunde(auftrag) {
  const nurTests = istTestbereich(auftrag.bereich);
  if (auftrag.art === "umbau" && nurTests) {
    return [`bereich ${auftrag.bereich} umfasst nur Tests; ein reiner Testumbau hat art ${TESTUMBAU} und läuft beim Test-Agenten, weil der Bau-Agent keine Tests ändert`];
  }
  if (auftrag.art !== TESTUMBAU) return [];
  const erwartet = Array.isArray(auftrag.erwarteteDateien) ? auftrag.erwarteteDateien : [];
  const produkt = erwartet.filter((pfad) => !istTestdatei(pfad));
  return [
    ...(nurTests ? [] : [`ein ${TESTUMBAU} braucht einen bereich, der nur Tests umfasst, nicht ${auftrag.bereich}`]),
    ...produkt.map((pfad) => `ein ${TESTUMBAU} ändert keinen Produktcode; erwartete Datei ${pfad} ist keine Testdatei`),
  ];
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
    (pfad) => !pfadIstSauber(pfad) || !(imBereichOderZwilling(auftrag.bereich, pfad) || istTestdatei(pfad)),
  );
  return [...befunde, ...fremd.map((pfad) => `erwartete Datei ${pfad} liegt nicht im Bereich`)];
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
  const saetze = Array.isArray(nie) ? nie : Object.values(nie);
  return saetze.some(textFehlt) ? ["wasDarfNiePassieren muss eine Liste von Sätzen sein"] : [];
}

function abhaengigkeitBefunde(auftrag, kontext) {
  const liste = auftrag.abhaengigVon ?? [];
  if (!Array.isArray(liste)) return ["abhaengigVon muss eine Liste sein"];
  return liste
    .filter((kennung) => kennung === auftrag.id || !kontext.kennungen.has(kennung))
    .map((kennung) => `abhaengigVon nennt ${kennung}, das ist kein anderer Auftrag der Phase`);
}

function umbauNummernBefunde(auftrag) {
  if (auftrag.prueft === UMBAU_AUSWEG && auftrag.szenarien === undefined) return [];
  return [`prueft muss bei einem Umbau genau „${UMBAU_AUSWEG}“ sein, ohne szenarien`];
}

function szenarienBefunde(nummern, szenarien) {
  if (szenarien === null || typeof szenarien !== "object" || Array.isArray(szenarien)) {
    return ["szenarien muss je Nummer aus prueft den wörtlichen Szenariotext enthalten"];
  }
  const fehlend = nummern.filter((nummer) => textFehlt(szenarien[nummer]));
  const fremd = Object.keys(szenarien).filter((nummer) => !nummern.includes(nummer));
  return [
    ...fehlend.map((nummer) => `szenarien["${nummer}"] fehlt; dort steht der Szenariotext wörtlich`),
    ...fremd.map((nummer) => `szenarien nennt ${nummer}, das nicht in prueft steht`),
  ];
}

function nummernBefunde(auftrag) {
  if (istUmbau(auftrag)) return umbauNummernBefunde(auftrag);
  const nummern = Array.isArray(auftrag.prueft) ? auftrag.prueft : [];
  if (nummern.length === 0) {
    return [`prueft muss die Nummern nennen, die der Auftrag prüft (etwa S1, B1, T1); „${UMBAU_AUSWEG}“ gilt nur für einen Umbau`];
  }
  const ungueltig = nummern.filter((nummer) => typeof nummer !== "string" || !NUMMER.test(nummer));
  if (ungueltig.length > 0) return ungueltig.map((nummer) => `prueft nennt ${JSON.stringify(nummer)}, das ist keine Nummer wie S1, B1 oder T1`);
  const doppelt = nummern.filter((nummer, stelle) => nummern.indexOf(nummer) !== stelle);
  return [...doppelt.map((nummer) => `prueft nennt ${nummer} doppelt`), ...szenarienBefunde(nummern, auftrag.szenarien)];
}

function auftragBefunde(auftrag, kontext) {
  const befunde = [
    ...artBefunde(auftrag),
    ...bereichBefunde(auftrag, kontext),
    ...testbereichBefunde(auftrag),
    ...abnahmeBefunde(auftrag, kontext),
    ...nieBefunde(auftrag),
    ...abhaengigkeitBefunde(auftrag, kontext),
    ...(kontext.ausPitch ? nummernBefunde(auftrag) : []),
  ];
  return befunde.map((befund) => `${auftrag.id}: ${befund}`);
}

export function kennungBefunde(auftraege) {
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
  if (Object.hasOwn(phase, "absicht")) befunde.push(...absichtBefunde(phase.absicht));
  const auftraege = Array.isArray(phase.auftraege) ? phase.auftraege : [];
  if (auftraege.length === 0) return [...befunde, "auftraege muss mindestens einen Auftrag enthalten"];
  befunde.push(...kennungBefunde(auftraege));
  const kontext = {
    root,
    ausPitch: PHASE_AUS_PITCH.test(String(phase.phase)),
    entwurf: phase.entwurf,
    muster: geschuetzteMuster(root),
    kennungen: new Set(auftraege.map((auftrag) => auftrag.id)),
  };
  for (const auftrag of auftraege) befunde.push(...auftragBefunde(auftrag, kontext));
  const { zyklus } = reihenfolge(auftraege);
  if (zyklus) befunde.push(`abhaengigVon bildet einen Kreis: ${zyklus.join(" -> ")}`);
  return befunde;
}
