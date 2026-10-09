import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { env } from "node:process";

import { bauPrompt, testPrompt } from "./agenten.mjs";
import { GRUEN as BELEG_GRUEN, ROT, belegVerzeichnis, schreibeBeleg } from "./bericht.mjs";
import { frage, setzeEin } from "./einsatz.mjs";
import { REPRODUKTION, fuehreReproduktionAus } from "./nachstellen.mjs";
import { leseDatei } from "./pruefer-befehle.mjs";
import {
  ERGEBNIS_DATEI,
  KATEGORIEN,
  NACHSTELLUNG_DATEI,
  ergebnisAus,
  nachstellungAus,
  reproduzierbareBlocker,
} from "./pruefer-schema.mjs";
import { beleg, fuehreAus } from "./pruefungen.mjs";

const ERWARTUNG = KATEGORIEN[0];
const GRUEN = KATEGORIEN.at(-1);
const REPARATUR_AGENT = "bau-kritisch";
const MAX_ZIEL = 72;
const KURZ = 12;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const LABEL = "entscheidung";
const CODEBLOCK = "```";
function zielDer(vorher) {
  return [...vorher].find(([, kategorie]) => kategorie === ERWARTUNG)?.[0] ?? null;
}

export function weitereRunde(vorher, nachher) {
  const ziel = zielDer(vorher);
  const neuRot = [...nachher].some(
    ([schluessel, kategorie]) => kategorie === ERWARTUNG && vorher.get(schluessel) !== ERWARTUNG,
  );
  return ziel !== null && nachher.get(ziel) === GRUEN && !neuRot;
}

function entwurfText(befund) {
  return [
    `Der Prüfer hat einen BLOCKER gemeldet (${befund.id || "ohne Katalog-ID"}), Zeile ${befund.zeile}.`,
    `Beleg: ${befund.beleg}`,
    `Vorgeschlagene Reparatur: ${befund.reparatur}`,
    `Der Reproduktionstest ${REPRODUKTION} scheitert heute an einer Erwartung und muss danach grün sein.`,
  ].join("\n");
}

export function reparaturPhase(befund, { pr }) {
  const [sha, index] = befund.schluessel.split("-");
  const auftrag = {
    id: `blocker-${index}`,
    art: "fehlerbehebung",
    ziel: `Behebe ${befund.id || "BLOCKER"} in ${befund.datei}`.slice(0, MAX_ZIEL),
    bereich: befund.datei,
    erwarteteDateien: [befund.datei],
    vorbild: befund.datei,
    abnahme: REPRODUKTION,
    erwarteterFehler: "ERR_ASSERTION",
    wasDarfNiePassieren: [],
  };
  return {
    phase: `reparatur-${sha.slice(0, KURZ)}`,
    issue: pr,
    entwurf: { [befund.datei]: entwurfText(befund) },
    auftraege: [auftrag],
  };
}

function ladeLage({ ergebnis: ergebnisOrdner, nachstellung: nachstellungsOrdner }) {
  const ergebnis = ergebnisAus(leseDatei(ergebnisOrdner, ERGEBNIS_DATEI) ?? "");
  if (ergebnis === null) throw new Error(`${ERGEBNIS_DATEI} fehlt oder ist ungültig.`);
  const alle = reproduzierbareBlocker(ergebnis);
  const stand = nachstellungAus(
    leseDatei(nachstellungsOrdner, NACHSTELLUNG_DATEI) ?? "",
    new Set(alle.map(({ schluessel }) => schluessel)),
  );
  const blocker = alle.filter(
    ({ schluessel }) => stand.has(schluessel) && stand.get(schluessel).basis !== ERWARTUNG,
  );
  const bestaetigt = blocker.some(({ schluessel }) => stand.get(schluessel).pr === ERWARTUNG);
  return { ergebnis, blocker: bestaetigt ? blocker : [] };
}

async function messe(root, blocker) {
  const kategorien = new Map();
  const ausgaben = new Map();
  for (const { schluessel, reproduktion } of blocker) {
    const { kategorie, ausgabe } = await fuehreReproduktionAus(root, reproduktion);
    kategorien.set(schluessel, kategorie);
    ausgaben.set(schluessel, ausgabe);
  }
  return { kategorien, ausgaben };
}

function schreibeReproduktion(root, befund) {
  const datei = join(root, REPRODUKTION);
  mkdirSync(dirname(datei), { recursive: true });
  writeFileSync(datei, befund.reproduktion);
}

function repariere(kontext, befund, ausgabe) {
  const { root, ergebnis } = kontext;
  const phase = reparaturPhase(befund, ergebnis);
  const [auftrag] = phase.auftraege;
  mkdirSync(belegVerzeichnis(root, phase.phase), { recursive: true });
  writeFileSync(
    join(belegVerzeichnis(root, phase.phase), `${auftrag.id}.phase.json`),
    JSON.stringify(phase),
  );
  schreibeReproduktion(root, befund);
  const sitzung = setzeEin(
    { rolle: "bau", phase, auftrag, root },
    bauPrompt({ phase, auftrag, root }, ausgabe),
    { agent: REPARATUR_AGENT },
  );
  return { phase, auftrag, sitzung };
}

function beobachtung(blocker, vorher, nachher) {
  return blocker.map(
    ({ schluessel, id, datei }) =>
      `${id || "BLOCKER"} in ${datei}: vorher ${vorher.get(schluessel)}, nachher ${nachher.get(schluessel)}`,
  );
}

function notizAuftrag(phase, auftrag, zeilen) {
  return [
    testPrompt(phase, auftrag),
    "## Beobachtung nach der Reparatur",
    "",
    CODEBLOCK,
    ...zeilen,
    CODEBLOCK,
    "",
    "## Deine Aufgabe",
    "",
    "Die Reparatur hat keine Wirkung gezeigt. Schreib für Menschen, die keinen Code lesen, eine Entscheidungsnotiz in drei Teilen,",
    "in Klartext ohne Code: was versucht wurde, was beobachtet wurde, zwei bis drei nummerierte Optionen mit deiner Empfehlung.",
    "Antworte nur mit der Notiz.",
  ].join("\n");
}

function veroeffentliche(pr, text, root) {
  if (!Number.isInteger(pr) || pr <= 0)
    return { pruefungen: [], hinweis: "Kein PR bekannt; die Notiz steht nur im Beleg." };
  const gh = env.HERMES_GH ?? "gh";
  const ziel = String(pr);
  const pruefungen = [
    fuehreAus("entscheidung kommentar", [gh, "pr", "comment", ziel, "--body-file", "-"], {
      cwd: root,
      env,
      eingabe: text,
    }),
    fuehreAus("entscheidung label", [gh, "pr", "edit", ziel, "--add-label", LABEL], {
      cwd: root,
      env,
    }),
  ].map(beleg);
  const geschrieben = pruefungen.every(({ exitCode }) => exitCode === 0);
  return {
    pruefungen,
    hinweis: geschrieben
      ? `Die Notiz steht als Kommentar im PR #${ziel}.`
      : "Die Notiz steht nur im Beleg.",
  };
}

function entscheidungNoetig({ root, blocker }, runde, zeilen) {
  const { phase, auftrag, sitzung } = runde;
  const notiz = frage(
    { rolle: "notiz", phase, auftrag, root },
    notizAuftrag(phase, auftrag, zeilen),
  );
  const kopf = `Die Reparatur von ${auftrag.ziel} hat keine Wirkung gezeigt.`;
  const text = [
    "## Entscheidung nötig",
    "",
    kopf,
    "",
    notiz.antwort.trim() || zeilen.join("\n"),
    "",
  ].join("\n");
  const veroeffentlicht = veroeffentliche(phase.issue, text, root);
  const agenten = [...sitzung.sitzungen, ...notiz.sitzungen];
  schreibeBeleg(root, {
    phase: phase.phase,
    auftrag: auftrag.id,
    ergebnis: ROT,
    beobachtung: zeilen,
    blocker: blocker.length,
    entscheidung: { text, agenten, ...veroeffentlicht },
  });
  console.log(`Reparatur ohne Wirkung: Entscheidung nötig. ${veroeffentlicht.hinweis}`);
  return EXIT_ROT;
}

export async function reparatur(optionen, root) {
  const { ergebnis, blocker } = ladeLage(optionen);
  if (blocker.length === 0) {
    console.log("Keine bestätigten BLOCKER; nichts zu reparieren.");
    return EXIT_GRUEN;
  }
  const kontext = { root, ergebnis, blocker };
  let vorher = await messe(root, blocker);
  if (zielDer(vorher.kategorien) === null) {
    console.log(
      "Keine bestätigte Reproduktion scheitert hier an ihrer Erwartung; nichts zu reparieren.",
    );
    return EXIT_GRUEN;
  }
  for (let ziel = zielDer(vorher.kategorien); ziel !== null; ziel = zielDer(vorher.kategorien)) {
    const befund = blocker.find(({ schluessel }) => schluessel === ziel);
    const runde = repariere(kontext, befund, vorher.ausgaben.get(ziel));
    const nachher = await messe(root, blocker);
    schreibeReproduktion(root, befund);
    if (!weitereRunde(vorher.kategorien, nachher.kategorien)) {
      return entscheidungNoetig(
        kontext,
        runde,
        beobachtung(blocker, vorher.kategorien, nachher.kategorien),
      );
    }
    schreibeBeleg(root, {
      phase: runde.phase.phase,
      auftrag: runde.auftrag.id,
      ergebnis: BELEG_GRUEN,
      agenten: runde.sitzung.sitzungen,
    });
    vorher = nachher;
  }
  console.log(
    "Reparatur wirkt: Alle bestätigten Reproduktionen sind grün. Der Prüfer prüft den neuen Stand nach dem nächsten Push.",
  );
  return EXIT_GRUEN;
}
