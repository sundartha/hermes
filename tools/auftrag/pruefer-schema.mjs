export const BLOCKER = "BLOCKER";
export const SOLLTE = "SOLLTE";
export const HINWEIS = "HINWEIS";
export const SCHWEREN = [BLOCKER, SOLLTE, HINWEIS];
export const GEPRUEFT = "geprueft";
export const NICHT_GELAUFEN = "nicht_gelaufen";
export const UNVOLLSTAENDIG = "unvollstaendig";
export const ZUSTAENDE = [GEPRUEFT, NICHT_GELAUFEN, UNVOLLSTAENDIG];
export const KATEGORIEN = ["erwartung", "laden", "umgebung", "zeit", "gruen"];
export const ERGEBNIS_DATEI = "ergebnis.json";
export const NACHSTELLUNG_DATEI = "nachstellung.json";
export const ABLAGE_DATEI = "sicherheitshinweise.json";
export const FORMAT = 1;
const KEINE = "keine";
export const NACHBAU = "nachbau";
export const ANORDNUNG = "anordnung";
const UMGEHUNGEN = [KEINE, NACHBAU, ANORDNUNG];
const UMGEHUNGSFELDER = ["vorhanden", "neu", "zitat"];
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
  "Vollständiger node:test-Test (Inhalt der Datei test/pruefer-reproduktion.test.js), der am Endstand des Pull Requests an einer Erwartung scheitert; leer bei SOLLTE und HINWEIS.";
const REPARATUR_TEXT = "Die Reparatur in einem Satz, ohne Code.";
const UMGEHUNG_TEXT =
  "nachbau: neuer Code baut vorhandenen Code in anderer Schreibweise nach (C1); anordnung: Issue oder Commit-Nachricht ordnet an, Code so zu schreiben, dass eine Prüfung ihn nicht erkennt (C2); sonst keine.";
const VORHANDEN_TEXT =
  "Nur bei nachbau: die vorhandene Stelle als <Datei>:<von>-<bis> unter basis/, sonst leer.";
const NEU_TEXT =
  "Nur bei nachbau: die neue Stelle als <Datei>:<von>-<bis> unter dateien/, sonst leer.";
const ZITAT_TEXT = "Nur bei anordnung: der Satz wörtlich aus auftrag.md, sonst leer.";

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
        required: ["schwere", ...TEXTFELDER, "zeile", "sicherheit", "umgehung", ...UMGEHUNGSFELDER],
        properties: {
          schwere: { type: "string", enum: SCHWEREN },
          id: text,
          datei: text,
          zeile: { type: "integer", minimum: 0 },
          beleg: text,
          reproduktion: { type: "string", description: REPRODUKTION_TEXT },
          reparatur: { type: "string", description: REPARATUR_TEXT },
          sicherheit: { type: "boolean" },
          umgehung: { type: "string", enum: UMGEHUNGEN, description: UMGEHUNG_TEXT },
          vorhanden: { type: "string", description: VORHANDEN_TEXT },
          neu: { type: "string", description: NEU_TEXT },
          zitat: { type: "string", description: ZITAT_TEXT },
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

function umgehungAus(wert) {
  const umgehung = wert.umgehung ?? KEINE;
  if (!UMGEHUNGEN.includes(umgehung)) return null;
  if (umgehung === KEINE) return {};
  const felder = UMGEHUNGSFELDER.map((feld) => [feld, wert[feld] ?? ""]);
  return felder.every(([, text]) => istText(text))
    ? { umgehung, ...Object.fromEntries(felder) }
    : null;
}

function befundAus(wert) {
  if (!istObjekt(wert) || !SCHWEREN.includes(wert.schwere) || typeof wert.sicherheit !== "boolean")
    return null;
  if (!TEXTFELDER.every((feld) => istText(wert[feld]))) return null;
  if (!Number.isInteger(wert.zeile) || wert.zeile < 0) return null;
  const umgehung = umgehungAus(wert);
  if (!umgehung) return null;
  const felder = Object.fromEntries(TEXTFELDER.map((feld) => [feld, wert[feld]]));
  return { schwere: wert.schwere, ...felder, zeile: wert.zeile, sicherheit: wert.sicherheit, ...umgehung };
}

function belegAus(wert, befund) {
  if (!befund.umgehung || typeof wert.belegt !== "boolean") return befund;
  return { ...befund, belegt: wert.belegt, belegGrund: istText(wert.belegGrund) ? wert.belegGrund : "" };
}

export function gekuerzt(befund) {
  return befund.sicherheit ? { sicherheit: true, schwere: befund.schwere } : befund;
}

export function gehoertInAblage(befund) {
  return befund.sicherheit;
}

function ablageEintrag(wert) {
  if (!istObjekt(wert) || !COMMIT_SHA.test(wert.sha ?? "")) return null;
  const befund = befundAus(wert.befund);
  return befund && gehoertInAblage(befund) ? { sha: wert.sha, befund } : null;
}

export function ablageAus(inhalt) {
  const wert = alsJson(inhalt);
  if (!istObjekt(wert) || wert.format !== FORMAT || !Array.isArray(wert.hinweise)) return null;
  const hinweise = wert.hinweise.map(ablageEintrag);
  return hinweise.includes(null) ? null : hinweise;
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
  return befund && !befund.sicherheit ? belegAus(wert, befund) : null;
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
    letzter: wert.letzter === true,
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

function istPrNummer(wert) {
  return wert === null || (Number.isInteger(wert) && wert > 0);
}

export function ergebnisAus(inhalt) {
  const wert = alsJson(inhalt);
  if (!istObjekt(wert) || wert.format !== FORMAT || typeof wert.branch !== "string") return null;
  if (!COMMIT_SHA.test(wert.head ?? "") || !Array.isArray(wert.commits)) return null;
  const pr = wert.pr ?? null;
  if (!istPrNummer(pr)) return null;
  const commits = wert.commits.map(commitAus);
  if (commits.includes(null)) return null;
  return { ...wert, pr, probeBranch: wert.probeBranch === true, commits };
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
