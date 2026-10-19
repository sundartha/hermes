import { env } from "node:process";
import { isDeepStrictEqual } from "node:util";

import { githubZugang } from "../auftrag/pruefer-github.mjs";
import { ausloesenderLauf } from "../auftrag/pruefer-herkunft.mjs";
import { laufAdresse } from "../ziele/ausgabe.mjs";
import { ladeVorhandene } from "./artefakte.mjs";
import { festgehalteneSumme, jobsDesLaufs } from "./festgehalten.mjs";
import { setzeStatus, testschutzNeuStarten } from "./github.mjs";
import { totcodeLaufFehler } from "./totcode-ermitteln.mjs";
import { gruendeDer, pruefeStufe, stufenName, vereinigeTeile } from "./totcode-urteil.mjs";

export const KONTEXT = "Totcode-Messung";
const NAMEN = /^(?:plan|basis|kopf|rotprobe)(?:-|$)/;
const PAKET_ARTEN = ["basis", "kopf"];
const EINZELJOBS = { plan: "planen", rotprobe: "rotprobe" };
const JOBTITEL = { basis: "Basis", kopf: "Kopf" };
const ERFOLG = "success";
const UEBERSPRUNGEN = "skipped";
const WAHR = "true";
const MAX_BESCHREIBUNG = 140;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const GRUENE_BESCHREIBUNG =
  "grün: jeder getötete Mutant bleibt getötet, jede gelöschte Datei ist rot";

function jobsDesWorkflows() {
  try {
    return JSON.parse(env.JOB_ERGEBNISSE ?? "");
  } catch {
    throw new Error("Herkunft: JOB_ERGEBNISSE ist unlesbar.");
  }
}

function herkunft(lauf, jobs) {
  const fehler = totcodeLaufFehler(lauf);
  if (fehler) throw new Error(`Herkunft: ${fehler}.`);
  const ermittelt = jobs.ermitteln;
  if (ermittelt?.result !== ERFOLG || ermittelt.outputs?.noetig !== WAHR)
    throw new Error("Herkunft: der Job ermitteln meldet keine nötige Messung.");
  const { aufmaster, fehler: listenFehler = "" } = ermittelt.outputs;
  return { kopf: lauf.head_sha, aufMaster: aufmaster === WAHR, listenFehler };
}

function paketNummern(jobs) {
  try {
    const liste = JSON.parse(jobs.planen?.outputs?.pakete ?? "");
    return Array.isArray(liste) && liste.every((paket, index) => paket === index)
      ? liste
      : undefined;
  } catch {
    return undefined;
  }
}

function jobFehler(jobs, nummern) {
  const kette = nummern.length > 0 ? ERFOLG : UEBERSPRUNGEN;
  const erwartet = { planen: ERFOLG, rotprobe: ERFOLG, kette };
  return Object.entries(erwartet)
    .filter(([name, ergebnis]) => jobs[name]?.result !== ergebnis)
    .map(([name]) => `Job ${name} endete mit ${jobs[name]?.result ?? "nichts"}`);
}

function summeAus(jobs, art) {
  const job = jobs[EINZELJOBS[art]];
  return job?.outputs?.pruefsumme;
}

export function totcodeJobName(art, nummer) {
  return `Paket ${nummer} / ${JOBTITEL[art]} messen / Schritt`;
}

function paketNamen(nummern) {
  return nummern.flatMap((nummer) => PAKET_ARTEN.map((art) => ({ art, nummer })));
}

async function festgehalteneSummen(github, nummern) {
  const jobs = await jobsDesLaufs(github, env.GITHUB_RUN_ID);
  const summen = new Map();
  const fehler = [];
  for (const { art, nummer } of paketNamen(nummern)) {
    const { summe, fehler: grund } = await festgehalteneSumme(github, {
      jobs,
      nummer,
      art,
      name: totcodeJobName(art, nummer),
    });
    if (grund) fehler.push(grund);
    else summen.set(stufenName(art, nummer), summe);
  }
  return { summen, fehler };
}

function paketTeil(texte, { art, nummer, summe, plan }) {
  const name = stufenName(art, nummer);
  const erwartet = { basis: plan.basis, kopf: plan.kopf };
  const gelesen = pruefeStufe({ text: texte.get(name), summe, art, erwartet, paket: nummer });
  if (gelesen.fehler) return gelesen;
  const { dateien, teil = null } = plan.pakete[nummer];
  const { inhalt } = gelesen;
  if (isDeepStrictEqual({ dateien: inhalt.dateien, teil: inhalt.teil }, { dateien, teil }))
    return gelesen;
  return { fehler: `${name}.json hat anderes gemessen als geplant` };
}

function paketTeile(texte, { plan, nummern, summen }) {
  const fehler = [];
  const teile = { basis: [], kopf: [] };
  for (const { art, nummer } of paketNamen(nummern)) {
    const summe = summen.get(stufenName(art, nummer));
    const { inhalt, fehler: grund } = paketTeil(texte, { art, nummer, summe, plan });
    if (grund) fehler.push(grund);
    else teile[art].push(inhalt);
  }
  return { fehler, teile };
}

async function gemessen(github, { jobs, erwartet }) {
  const nummern = paketNummern(jobs);
  if (nummern === undefined)
    return { fehler: ["Die Paketliste des Plans fehlt oder ist ungültig"] };
  const namen = [
    "plan",
    "rotprobe",
    ...paketNamen(nummern).map(({ art, nummer }) => stufenName(art, nummer)),
  ];
  const laufId = env.GITHUB_RUN_ID;
  const geladen = await ladeVorhandene(github, { laufId, erwartet: namen, muster: NAMEN });
  const festgehalten = await festgehalteneSummen(github, nummern);
  const fehler = [...jobFehler(jobs, nummern), ...geladen.fehler, ...festgehalten.fehler];
  const lies = (art) =>
    pruefeStufe({ text: geladen.texte.get(art), summe: summeAus(jobs, art), art, erwartet });
  const plan = lies("plan");
  if (plan.fehler) return { fehler: [...fehler, plan.fehler] };
  if (plan.inhalt.pakete?.length !== nummern.length)
    return { fehler: [...fehler, "Plan und Paketliste passen nicht zusammen"] };
  const rotprobe = lies("rotprobe");
  const teile = paketTeile(geladen.texte, {
    plan: plan.inhalt,
    nummern,
    summen: festgehalten.summen,
  });
  return {
    fehler: [...fehler, ...teile.fehler, ...(rotprobe.fehler ? [rotprobe.fehler] : [])],
    plan: plan.inhalt,
    basis: vereinigeTeile(teile.teile.basis),
    kopf: { ...vereinigeTeile(teile.teile.kopf), rotprobe: rotprobe.inhalt },
  };
}

async function gruendeFuer(github, { jobs, kopf, master, aufMaster, listenFehler }) {
  if (listenFehler !== "") return [listenFehler];
  if (!aufMaster) return [`PR-Kopf liegt nicht auf master ${master}; neu basieren`];
  const stand = await gemessen(github, { jobs, erwartet: { basis: master, kopf } });
  return stand.fehler.length > 0 ? stand.fehler : gruendeDer(stand);
}

function standardAbhaengigkeiten() {
  return {
    github: githubZugang({ token: env.GITHUB_TOKEN ?? "" }),
    jobs: jobsDesWorkflows(),
    lauf: ausloesenderLauf(),
    master: env.GITHUB_SHA ?? "",
    neustart: testschutzNeuStarten,
  };
}

export async function melden(abhaengigkeiten = standardAbhaengigkeiten()) {
  const { github, jobs, lauf, master, neustart } = abhaengigkeiten;
  const stand = herkunft(lauf, jobs);
  const { kopf } = stand;
  const gruende = await gruendeFuer(github, { ...stand, jobs, master });
  const gruen = gruende.length === 0;
  for (const grund of gruende) console.log(`Verstoß: ${grund}`);
  const beschreibung = gruen
    ? GRUENE_BESCHREIBUNG
    : `rot: ${gruende.join("; ")}`.slice(0, MAX_BESCHREIBUNG);
  console.log(`${kopf}: ${beschreibung}`);
  const adresse = laufAdresse();
  await setzeStatus(github, { kopf, gruen, beschreibung, adresse, kontext: KONTEXT });
  console.log(await neustart(kopf));
  return gruen ? EXIT_GRUEN : EXIT_ROT;
}
