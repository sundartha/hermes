import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { TOOLS } from "../basis-vergleich.mjs";
import { gezaehlt, kontingent } from "../eslint-rules/bestand.js";

const SEMGREP_REGELN = "tools/basis/semgrep-regeln.json";
const ANKER = "#";
const JSON_TEXT = /"(?:[^"\\]|\\.)*"/g;

function mitAnker(wert, neuFuer) {
  const [pfad, ...anker] = wert.split(ANKER);
  const neu = neuFuer.get(pfad);
  return neu === undefined ? wert : [neu, ...anker].join(ANKER);
}

function schluesselUmgezogen(objekt, { neuFuer }) {
  return Object.fromEntries(
    Object.entries(objekt).map(([pfad, wert]) => {
      const neu = neuFuer.get(pfad);
      return [neu === undefined || Object.hasOwn(objekt, neu) ? pfad : neu, wert];
    }),
  );
}

function feldUmgezogen(eintrag, feld, neuFuer) {
  const neu = neuFuer.get(eintrag[feld]);
  return neu === undefined ? eintrag : { ...eintrag, [feld]: neu };
}

function endungNachgezogen(eintrag, { alt, neu }) {
  const name = posix.basename(alt);
  const quelle = eintrag.unresolvedTo;
  if (typeof quelle !== "string" || !quelle.endsWith(`/${name}`)) return eintrag;
  return { ...eintrag, unresolvedTo: `${quelle.slice(0, -name.length)}${posix.basename(neu)}` };
}

function abhaengigkeitenUmgezogen(liste, { neuFuer }) {
  return liste.map((eintrag) => {
    const umgezogen = feldUmgezogen(feldUmgezogen(eintrag, "from", neuFuer), "to", neuFuer);
    return umgezogen.to === eintrag.to ? umgezogen : endungNachgezogen(umgezogen, { alt: eintrag.to, neu: umgezogen.to });
  });
}

function knipUmgezogen(basis, { neuFuer }) {
  return { ...basis, befunde: basis.befunde.map((befund) => TOOLS.knip.back(befund, (pfad) => neuFuer.get(pfad) ?? pfad)) };
}

function semgrepBefunde({ root, meldungen }, dateien) {
  const ordner = mkdtempSync(join(tmpdir(), "listenumzug-semgrep-"));
  try {
    for (const pfad of [SEMGREP_REGELN, ...dateien]) {
      mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
      copyFileSync(join(root, pfad), join(ordner, pfad));
    }
    return TOOLS.semgrep.findings(ordner).map(({ key }) => key);
  } catch (fehler) {
    meldungen.push(`semgrep lief nicht (${fehler.message.split("\n")[0]}), die Semgrep-Einträge bleiben`);
    return [];
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function semgrepUmgezogen(basis, umzug) {
  const kandidaten = basis.befunde.map((befund) => {
    const neu = umzug.neuFuer.get(TOOLS.semgrep.path(befund));
    return neu === undefined ? null : { neu, schluessel: TOOLS.semgrep.back(befund, (pfad) => umzug.neuFuer.get(pfad) ?? pfad) };
  });
  const dateien = [...new Set(kandidaten.filter(Boolean).map(({ neu }) => neu))];
  if (dateien.length === 0) return basis;
  const bestaetigt = kontingent(gezaehlt(semgrepBefunde(umzug, dateien)));
  const befunde = basis.befunde.map((befund, stelle) => {
    const kandidat = kandidaten[stelle];
    return kandidat !== null && bestaetigt(kandidat.schluessel) ? kandidat.schluessel : befund;
  });
  return { ...basis, befunde };
}

function gatesUmgezogen(gates, { neuFuer }) {
  return Object.fromEntries(
    Object.entries(gates).map(([gate, felder]) => [
      gate,
      Object.fromEntries(Object.entries(felder).map(([feld, pfade]) => [feld, pfade.map((pfad) => mitAnker(pfad, neuFuer))])),
    ]),
  );
}

const LISTEN = [
  { pfad: "eslint-suppressions.json", umziehen: schluesselUmgezogen },
  { pfad: "eslint-legacy-exceptions.json", umziehen: schluesselUmgezogen },
  { pfad: ".dependency-cruiser-known-violations.json", umziehen: abhaengigkeitenUmgezogen },
  { pfad: "tools/basis/test-importe.json", umziehen: abhaengigkeitenUmgezogen },
  { pfad: "tools/basis/knip.json", umziehen: knipUmgezogen },
  { pfad: "tools/basis/semgrep.json", umziehen: semgrepUmgezogen },
  { pfad: "tools/gate-tests.json", umziehen: gatesUmgezogen },
];

export const LISTENPFADE = LISTEN.map(({ pfad }) => pfad);

function texte(wert) {
  if (typeof wert === "string") return [wert];
  if (Array.isArray(wert)) return wert.flatMap(texte);
  if (wert === null || typeof wert !== "object") return [];
  return Object.entries(wert).flatMap(([schluessel, inhalt]) => [schluessel, ...texte(inhalt)]);
}

function textUmgezogen(text, { alt, neu }, nachher) {
  const paare = alt.map((wert, stelle) => ({ wert, ziel: neu[stelle] })).values();
  const ersetzt = text.replace(JSON_TEXT, (literal) => {
    const { wert, ziel } = paare.next().value ?? {};
    return wert === ziel ? literal : JSON.stringify(ziel);
  });
  return isDeepStrictEqual(JSON.parse(ersetzt), nachher) ? ersetzt : undefined;
}

export function lesbar(datei) {
  return existsSync(datei) ? readFileSync(datei, "utf8") : undefined;
}

function gelesen(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function listeNachUmzug({ pfad, umziehen }, { root, neuFuer }) {
  const text = lesbar(join(root, pfad));
  const vorher = text === undefined ? undefined : gelesen(text);
  if (vorher === undefined) return undefined;
  const meldungen = [];
  const nachher = umziehen(vorher, { root, neuFuer, meldungen });
  const stellen = { alt: texte(vorher), neu: texte(nachher) };
  const neu = isDeepStrictEqual(vorher, nachher) ? text : textUmgezogen(text, stellen, nachher);
  if (neu === undefined) meldungen.push("die Einträge ließen sich im Text nicht eindeutig ersetzen, die Liste bleibt");
  return { pfad, text, neu: neu ?? text, meldungen, anzahl: neu === undefined ? 0 : stellen.alt.filter((wert, stelle) => wert !== stellen.neu[stelle]).length };
}

export function listenNachUmzug(root, neuFuer) {
  return neuFuer.size === 0 ? [] : LISTEN.map((liste) => listeNachUmzug(liste, { root, neuFuer })).filter(Boolean);
}
