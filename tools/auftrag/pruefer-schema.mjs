export const BLOCKER = "BLOCKER";
export const SCHWEREN = [BLOCKER, "SOLLTE", "HINWEIS"];
export const GEPRUEFT = "geprueft";
export const NICHT_GELAUFEN = "nicht_gelaufen";
export const UNVOLLSTAENDIG = "unvollstaendig";
export const ZUSTAENDE = [GEPRUEFT, NICHT_GELAUFEN, UNVOLLSTAENDIG];
export const KATEGORIEN = ["erwartung", "laden", "umgebung", "zeit", "gruen"];
export const ERGEBNIS_DATEI = "ergebnis.json";
export const NACHSTELLUNG_DATEI = "nachstellung.json";
export const FORMAT = 1;
const URTEILE = ["BESTANDEN", "NICHT_BESTANDEN"];
const TEXTFELDER = ["id", "datei", "beleg", "reproduktion", "reparatur"];
const MAX_TEXT_ZEICHEN = 40_000;
const MAX_BEFUNDE = 200;
const COMMIT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const PATCH_ID = /^(?:[0-9a-f]{40}(?:[0-9a-f]{24})?)?$/;
const SCHLUESSEL = /^[0-9a-f]{40}(?:[0-9a-f]{24})?-\d+$/;
const LEERZEICHEN = 0x20;
const ENTF = 0x7f;
const REPRODUKTION_TEXT =
  "Vollständiger node:test-Test (Inhalt der Datei test/pruefer-reproduktion.test.js), der auf diesem Commit an einer Erwartung scheitert; leer bei SOLLTE und HINWEIS.";

const text = { type: "string" };

export const ANTWORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["urteil", "befunde"],
  properties: {
    urteil: { type: "string", enum: URTEILE },
    befunde: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["schwere", ...TEXTFELDER, "zeile", "sicherheit"],
        properties: {
          schwere: { type: "string", enum: SCHWEREN },
          id: text,
          datei: text,
          zeile: { type: "integer", minimum: 0 },
          beleg: text,
          reproduktion: { type: "string", description: REPRODUKTION_TEXT },
          reparatur: text,
          sicherheit: { type: "boolean" },
        },
      },
    },
  },
};

export function ersetzeSteuerzeichen(text, ersatz) {
  return [...text]
    .map((zeichen) => {
      const code = zeichen.codePointAt(0);
      return code < LEERZEICHEN || code === ENTF ? ersatz : zeichen;
    })
    .join("");
}

function istObjekt(wert) {
  return wert !== null && typeof wert === "object" && !Array.isArray(wert);
}

function istText(wert) {
  return typeof wert === "string" && wert.length <= MAX_TEXT_ZEICHEN;
}

function befundAus(wert) {
  if (!istObjekt(wert) || !SCHWEREN.includes(wert.schwere) || typeof wert.sicherheit !== "boolean")
    return null;
  if (!TEXTFELDER.every((feld) => istText(wert[feld]))) return null;
  if (!Number.isInteger(wert.zeile) || wert.zeile < 0) return null;
  const felder = Object.fromEntries(TEXTFELDER.map((feld) => [feld, wert[feld]]));
  return { schwere: wert.schwere, ...felder, zeile: wert.zeile, sicherheit: wert.sicherheit };
}

export function gekuerzt(befund) {
  return befund.sicherheit ? { sicherheit: true, schwere: befund.schwere } : befund;
}

export function befundeDerAntwort(wert) {
  if (!istObjekt(wert) || !Array.isArray(wert.befunde) || wert.befunde.length > MAX_BEFUNDE)
    return null;
  const befunde = wert.befunde.map(befundAus);
  return befunde.includes(null) ? null : befunde;
}

function artefaktBefund(wert) {
  if (istObjekt(wert) && wert.sicherheit === true) {
    return SCHWEREN.includes(wert.schwere) ? { sicherheit: true, schwere: wert.schwere } : null;
  }
  const befund = befundAus(wert);
  return befund && !befund.sicherheit ? befund : null;
}

function kopfGueltig(wert) {
  if (!istObjekt(wert) || !COMMIT_SHA.test(wert.sha ?? "") || !PATCH_ID.test(wert.patchId ?? "-"))
    return false;
  return (
    ZUSTAENDE.includes(wert.zustand) &&
    Array.isArray(wert.befunde) &&
    wert.befunde.length <= MAX_BEFUNDE
  );
}

function commitAus(wert) {
  if (!kopfGueltig(wert)) return null;
  const befunde = wert.befunde.map(artefaktBefund);
  if (befunde.includes(null)) return null;
  return {
    sha: wert.sha,
    patchId: wert.patchId,
    zustand: wert.zustand,
    grund: istText(wert.grund) ? wert.grund : "",
    uebernommen: wert.uebernommen === true,
    kritisch: wert.kritisch === true,
    befunde,
  };
}

function alsJson(inhalt) {
  try {
    return JSON.parse(inhalt);
  } catch {
    return null;
  }
}

export function ergebnisAus(inhalt) {
  const wert = alsJson(inhalt);
  if (!istObjekt(wert) || wert.format !== FORMAT || typeof wert.branch !== "string") return null;
  if (!COMMIT_SHA.test(wert.head ?? "") || !Array.isArray(wert.commits)) return null;
  const commits = wert.commits.map(commitAus);
  if (commits.includes(null)) return null;
  return { ...wert, probeBranch: wert.probeBranch === true, commits };
}

export function schluesselVon(sha, index) {
  return `${sha}-${index}`;
}

export function reproduzierbareBlocker(ergebnis) {
  return ergebnis.commits.flatMap(({ sha, befunde }) =>
    befunde
      .map((befund, index) => ({ ...befund, sha, schluessel: schluesselVon(sha, index) }))
      .filter(
        (befund) =>
          befund.schwere === BLOCKER && !befund.sicherheit && befund.reproduktion.trim() !== "",
      ),
  );
}

function nachstellungsEintrag(wert, erlaubt) {
  if (!istObjekt(wert) || !SCHLUESSEL.test(wert.schluessel ?? "") || !erlaubt.has(wert.schluessel))
    return null;
  if (!KATEGORIEN.includes(wert.pr) || !KATEGORIEN.includes(wert.basis)) return null;
  return [wert.schluessel, { pr: wert.pr, basis: wert.basis }];
}

export function nachstellungAus(inhalt, erlaubt) {
  const wert = alsJson(inhalt);
  const ergebnisse =
    istObjekt(wert) && wert.format === FORMAT && Array.isArray(wert.ergebnisse)
      ? wert.ergebnisse
      : [];
  const eintraege = new Map();
  for (const eintrag of ergebnisse.map((roh) => nachstellungsEintrag(roh, erlaubt))) {
    if (eintrag && !eintraege.has(eintrag[0])) eintraege.set(...eintrag);
  }
  return eintraege;
}
