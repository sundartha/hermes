import { artefaktName, inhaltDes, vertrauteLaeufe } from "../auftrag/pruefer-gedaechtnis.mjs";
import { PRUEFER_LAUF, workflowNummer } from "../auftrag/pruefer-herkunft.mjs";
import { BLOCKER, HINWEIS, SOLLTE, ersetzeSteuerzeichen } from "../auftrag/pruefer-schema.mjs";
import { KONTEXT } from "../auftrag/pruefer-urteil.mjs";

export const EXIT = { ok: 0, befunde: 1, aufruf: 2, ausgeblieben: 3, nichtGelaufen: 4, keinPr: 5 };
export const HOECHSTENS_SEKUNDEN = 1800;
export const TAKT_SEKUNDEN = 15;
const MS_JE_SEKUNDE = 1000;
const SEKUNDEN_JE_MINUTE = 60;
const KURZ = 7;
const MAX_ZEICHEN = 1500;
const AUSLASSUNG = "…";
const ERFOLG = "success";
const FEHLER = "error";
const WARTET = "pending";
const ERSTELLER = "github-actions[bot]";
const GEMELDET = [BLOCKER, SOLLTE];

function einzeilig(text) {
  const glatt = ersetzeSteuerzeichen(String(text), " ").trim();
  return glatt.length > MAX_ZEICHEN ? `${glatt.slice(0, MAX_ZEICHEN - 1)}${AUSLASSUNG}` : glatt;
}

async function prNummer(github, kopf) {
  const treffer = await github.hole(`/commits/${kopf}/pulls`);
  const offen = treffer.filter(({ state, head }) => state === "open" && head?.sha === kopf);
  return offen[0]?.number ?? null;
}

async function prueferStatus(github, kopf) {
  const statusse = await github.hole(`/commits/${kopf}/statuses`);
  return (
    statusse.find(({ context, creator }) => context === KONTEXT && creator?.login === ERSTELLER) ??
    null
  );
}

async function ergebnisAmKopf(github, { kopf, pr }) {
  const name = artefaktName(pr);
  const antwort = await github.hole(`/actions/artifacts?name=${name}&per_page=100`);
  const frisch = (antwort.artifacts ?? [])
    .filter((artefakt) => artefakt.name === name && artefakt.expired !== true)
    .sort(
      (neuer, aelter) => Date.parse(aelter.created_at ?? 0) - Date.parse(neuer.created_at ?? 0),
    );
  if (frisch.length === 0) return null;
  const vertraut = vertrauteLaeufe(github, await workflowNummer(github, PRUEFER_LAUF));
  for (const artefakt of frisch) {
    const lauf = artefakt.workflow_run?.id;
    if (lauf === undefined || !(await vertraut(lauf))) continue;
    const ergebnis = await inhaltDes(github, artefakt);
    if (ergebnis?.head === kopf) return ergebnis;
  }
  return null;
}

function befundZeilen(ergebnis) {
  return ergebnis.commits.flatMap(({ sha, befunde }) =>
    befunde.flatMap((befund) => {
      if (befund.schwere === HINWEIS) return [];
      const stelle = sha.slice(0, KURZ);
      if (befund.sicherheit) {
        return [
          {
            schwere: befund.schwere,
            zeilen: [
              `${befund.schwere} (Commit ${stelle}): Sicherheitsbefund, Details nicht öffentlich; bei der Betreuung nachfragen.`,
            ],
          },
        ];
      }
      const kopfzeile = `${befund.schwere} (Commit ${stelle}) ${einzeilig(befund.datei)}:${befund.zeile}: ${einzeilig(befund.beleg)}`;
      const reparatur =
        befund.reparatur.trim() === "" ? [] : [`  Reparatur: ${einzeilig(befund.reparatur)}`];
      return [{ schwere: befund.schwere, zeilen: [kopfzeile, ...reparatur] }];
    }),
  );
}

function melde(status, ergebnis, ausgabe) {
  ausgabe(`Prüfer am Kopf: ${status.state} (${einzeilig(status.description ?? "")})`);
  const befunde = befundZeilen(ergebnis);
  for (const { zeilen } of befunde) for (const zeile of zeilen) ausgabe(zeile);
  return befunde.filter(({ schwere }) => GEMELDET.includes(schwere)).length;
}

function minuten(sekunden) {
  return Math.round(sekunden / SEKUNDEN_JE_MINUTE);
}

function kurz(kopf) {
  return kopf.slice(0, KURZ);
}

async function urteilAmKopf({ github, kopf, pr }, ausgabe) {
  const status = await prueferStatus(github, kopf);
  if (status === null || status.state === WARTET) return null;
  const beschreibung = einzeilig(status.description ?? "");
  if (status.state === FEHLER) {
    ausgabe(
      `Prüfer nicht gelaufen am Kopf ${kurz(kopf)}: ${beschreibung}. Das ist KEIN grünes Ergebnis.`,
    );
    return EXIT.nichtGelaufen;
  }
  const ergebnis = await ergebnisAmKopf(github, { kopf, pr });
  if (ergebnis !== null) {
    const anzahl = melde(status, ergebnis, ausgabe);
    return anzahl > 0 || status.state !== ERFOLG ? EXIT.befunde : EXIT.ok;
  }
  if (status.state === ERFOLG) return null;
  ausgabe(
    `Prüfer am Kopf ${kurz(kopf)}: ${status.state} (${beschreibung}); das Ergebnis mit den Befunden liegt nicht vor, Befunde im Pull Request nachlesen.`,
  );
  return EXIT.befunde;
}

export async function abwarten({
  github,
  kopf,
  hoechstens = HOECHSTENS_SEKUNDEN,
  takt = TAKT_SEKUNDEN,
  schlafen = (ms) => new Promise((fertig) => setTimeout(fertig, ms)),
  jetzt = Date.now,
  ausgabe = console.log,
}) {
  const pr = await prNummer(github, kopf);
  if (pr === null) {
    ausgabe(
      `Kein offener Pull Request mit dem Kopf ${kurz(kopf)}: es gibt noch keinen Prüfer. Nach paket-pr erneut aufrufen. Das ist KEIN grünes Ergebnis.`,
    );
    return EXIT.keinPr;
  }
  const ende = jetzt() + hoechstens * MS_JE_SEKUNDE;
  ausgabe(`Warte auf den Prüfer am Kopf ${kurz(kopf)} (höchstens ${minuten(hoechstens)} Minuten).`);
  for (;;) {
    const urteil = await urteilAmKopf({ github, kopf, pr }, ausgabe);
    if (urteil !== null) return urteil;
    if (jetzt() >= ende) break;
    await schlafen(takt * MS_JE_SEKUNDE);
  }
  ausgabe(
    `Prüfer ausgeblieben: nach ${minuten(hoechstens)} Minuten kein Urteil am Kopf ${kurz(kopf)}. Das ist KEIN grünes Ergebnis; später erneut aufrufen oder die Betreuung fragen.`,
  );
  return EXIT.ausgeblieben;
}
