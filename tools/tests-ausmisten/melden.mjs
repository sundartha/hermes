import { env } from "node:process";
import { isDeepStrictEqual } from "node:util";

import { githubZugang } from "../auftrag/pruefer-github.mjs";
import { laufAdresse } from "../ziele/ausgabe.mjs";
import { PLAN, ladeVorhandene, paketName } from "./artefakte.mjs";
import {
  BASIS,
  BRANCH,
  beschraenke,
  beschreibung,
  entscheide,
  pruefeArtefakt,
  pruefePlan,
  vereinige,
} from "./entscheiden.mjs";
import {
  oeffneOderNeustarten,
  prTitel,
  schalteAutoMergeAus,
  schalteAutoMergeEin,
  setzeStatus,
  testschutzNeuStarten,
} from "./github.mjs";
import { ausloeser } from "./herkunft.mjs";
import { git, leseBereiche } from "./pfade.mjs";

const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const MAX_ROTE_BESCHREIBUNG = 100;

function jobErgebnisse() {
  try {
    return JSON.parse(env.JOB_ERGEBNISSE ?? "{}");
  } catch {
    return {};
  }
}

const JOBS = ["planen", "basis", "sammeln", "branch"];
const ERFOLG = "success";
const PRUEFSUMME = /^[0-9a-f]{64}$/;

function alsListe(text) {
  try {
    const wert = JSON.parse(text ?? "null");
    return Array.isArray(wert) ? wert : undefined;
  } catch {
    return undefined;
  }
}

function ausgabe(jobs, job, name) {
  return jobs[job]?.outputs?.[name];
}

function jobDaten(jobs) {
  const fehler = JOBS.filter((name) => jobs[name]?.result !== ERFOLG).map(
    (name) => `Job ${name} endete mit ${jobs[name]?.result ?? "nichts"}`,
  );
  const pakete = alsListe(ausgabe(jobs, "planen", "pakete")) ?? [];
  const summen = alsListe(ausgabe(jobs, "sammeln", "summen")) ?? [];
  const paketeGueltig = pakete.length > 0 && pakete.every((paket, index) => paket === index);
  const summenGueltig =
    summen.length === pakete.length && summen.every((summe) => PRUEFSUMME.test(summe));
  if (!paketeGueltig) fehler.push("Die Paketliste des Plans fehlt oder ist ungültig");
  if (!summenGueltig) {
    fehler.push("Die Prüfsummen der Basis-Pakete fehlen oder passen nicht zur Paketliste");
  }
  return { fehler, pakete, summen, lesbar: paketeGueltig && summenGueltig };
}

function paketArtefakt(texte, { name, art, summe, erwartet, dateien }) {
  if (!texte.has(name)) return { fehler: [] };
  const ergebnis = pruefeArtefakt({ name, art, text: texte.get(name), summe, erwartet });
  if (ergebnis.fehler) return ergebnis;
  if (isDeepStrictEqual(ergebnis.daten.dateien, dateien)) return ergebnis;
  return { fehler: [`Artefakt ${name} hat andere Dateien gemessen als geplant`] };
}

function paketTeile(texte, { plan, summen, erwartet }) {
  const fehler = [];
  const teile = { [BASIS]: [], [BRANCH]: [] };
  plan.pakete.forEach(({ dateien }, nummer) => {
    const gelesen = [BASIS, BRANCH].map((art) =>
      paketArtefakt(texte, {
        name: paketName(art, nummer),
        art,
        summe: art === BASIS ? summen[nummer] : undefined,
        erwartet,
        dateien,
      }),
    );
    for (const { fehler: grund = [] } of gelesen) fehler.push(...grund);
    if (gelesen.every(({ daten }) => daten !== undefined)) {
      teile[BASIS].push(gelesen[0].daten);
      teile[BRANCH].push({ ...gelesen[1].daten, nummer });
    }
  });
  return { fehler, teile };
}

async function artefakte(github, { jobs, erwartet }) {
  const geplant = jobDaten(jobs);
  if (!geplant.lesbar) return { fehler: geplant.fehler };
  const nummern = geplant.pakete;
  const namen = [
    PLAN,
    ...nummern.map((nummer) => paketName(BASIS, nummer)),
    ...nummern.map((nummer) => paketName(BRANCH, nummer)),
  ];
  const geladen = await ladeVorhandene(github, { laufId: env.GITHUB_RUN_ID, erwartet: namen });
  const bisher = [...geplant.fehler, ...geladen.fehler];
  if (!geladen.texte.has(PLAN)) return { fehler: bisher };
  const plan = pruefePlan({
    text: geladen.texte.get(PLAN),
    summe: jobs.planen.outputs.pruefsumme,
    erwartet,
  });
  if (plan.fehler) return { fehler: [...bisher, ...plan.fehler] };
  if (plan.daten.pakete.length !== nummern.length)
    return { fehler: [...bisher, "Plan und Paketliste passen nicht zusammen"] };
  const { fehler, teile } = paketTeile(geladen.texte, {
    plan: plan.daten,
    summen: geplant.summen,
    erwartet,
  });
  return { ...gemessenesErgebnis(teile), issue: plan.daten.issue, fehler: [...bisher, ...fehler] };
}

function gemessenesErgebnis(teile) {
  if (teile[BRANCH].length === 0) return {};
  const gemessen = teile[BRANCH].flatMap((teil) => teil.gemessen);
  return {
    basis: vereinige(teile[BASIS].map((teil) => beschraenke(teil, gemessen))),
    branch: vereinige(teile[BRANCH].map((teil) => beschraenke(teil, gemessen))),
    abgebrochen: teile[BRANCH].filter((teil) => teil.gemessen.length < teil.dateien.length),
  };
}

function abbruchVerstoesse(abgebrochen) {
  return abgebrochen.map(
    ({ nummer, dateien, gemessen }) =>
      `Paket ${nummer} nach dem ersten Verstoß abgebrochen, nicht gemessen: ${dateien.filter((datei) => !gemessen.includes(datei)).join(", ")}`,
  );
}

function urteilFuer({ basis, branch, abgebrochen = [], fehler }) {
  const urteil = basis === undefined ? undefined : entscheide(basis, branch);
  const gemessen = [...(urteil?.verstoesse ?? []), ...abbruchVerstoesse(abgebrochen)];
  const verstoesse = [...fehler, ...gemessen];
  if (fehler.length === 0 && urteil !== undefined)
    return { ...urteil, gruen: verstoesse.length === 0, verstoesse };
  const kurz = `rot: ${verstoesse.join("; ")}`.slice(0, MAX_ROTE_BESCHREIBUNG);
  return { gruen: false, verstoesse, kurz };
}

function issueZeilen(issue) {
  if (issue === null) {
    return [
      "Die letzte Commit-Nachricht nennt keine Zeile „Issue: #<Nummer>“; dieser PR schließt kein Issue.",
    ];
  }
  return [`Closes #${issue}`];
}

export function prText({ bereich, basis, branch, urteil, adresse, issue }) {
  const dateien = basis.dateien.map((datei) => `\`${datei}\``);
  const { alt, neu } = basis.tests;
  return [
    `Ausmisten im Bereich ${bereich}, gemessen im Lauf ${adresse}.`,
    "",
    `- Gemessene Dateien: ${dateien.length} (${dateien.join(", ")})`,
    `- Geänderte Testdateien: ${alt.length} auf master, ${neu.length} im Branch`,
    `- Von den alten Fassungen getötete Mutanten: ${urteil.mutanten.basis}, davon auf dem Branch getötet: ${urteil.mutanten.branch}`,
    `- Gate-Lauf (nur Gate- und SG-Tests): ${urteil.gate.basis}, davon auf dem Branch getötet: ${urteil.gate.branch}`,
    `- Testzeilen: vorher ${basis.testzeilen.vorher}, nachher ${basis.testzeilen.nachher}`,
    `- Trockenlauf: vorher ${basis.trockenlauf.sekunden} s, nachher ${branch.trockenlauf.sekunden} s`,
    "",
    "Jeder Mutant, den die alten Fassungen der geänderten Tests getötet haben, ist auch mit den Tests dieses Branches getötet, im Gate-Lauf ebenso.",
    "",
    ...issueZeilen(issue),
    "",
  ].join("\n");
}

function standardAbhaengigkeiten() {
  return {
    github: githubZugang({ token: env.GITHUB_TOKEN ?? "" }),
    bot: () => githubZugang({ token: env.GH_TOKEN ?? "" }),
    aktionen: {
      autoMerge: schalteAutoMergeEin,
      autoMergeAus: schalteAutoMergeAus,
      neustart: testschutzNeuStarten,
    },
    jobs: jobErgebnisse(),
    master: git(["rev-parse", "HEAD"]).trim(),
  };
}

export async function melden({ pr }, abhaengigkeiten = standardAbhaengigkeiten()) {
  const { github, jobs, master } = abhaengigkeiten;
  const herkunft = await ausloeser({ bereiche: leseBereiche(), github });
  const erwartet = { kopf: herkunft.kopf, master, bereich: herkunft.bereich };
  const gelesen = await artefakte(github, { jobs, erwartet });
  const urteil = urteilFuer(gelesen);
  const adresse = laufAdresse();
  for (const verstoss of urteil.verstoesse) console.log(`Verstoß: ${verstoss}`);
  const text = urteil.kurz ?? beschreibung(urteil);
  console.log(`${herkunft.branch} ${herkunft.kopf}: ${text}`);
  if (!pr)
    await setzeStatus(github, {
      kopf: herkunft.kopf,
      gruen: urteil.gruen,
      beschreibung: text,
      adresse,
    });
  const ausgang = urteil.gruen ? EXIT_GRUEN : EXIT_ROT;
  if (!pr) return ausgang;
  const inhalt = { ...gelesen, bereich: herkunft.bereich, urteil, adresse };
  const ziel = { bot: abhaengigkeiten.bot(), branch: herkunft.branch, kopf: herkunft.kopf };
  const neuerPr = () => ({ title: prTitel(herkunft.bereich), body: prText(inhalt) });
  const meldung = await oeffneOderNeustarten(
    { ...ziel, gruen: urteil.gruen, pr: neuerPr },
    abhaengigkeiten.aktionen,
  );
  console.log(meldung);
  return ausgang;
}
