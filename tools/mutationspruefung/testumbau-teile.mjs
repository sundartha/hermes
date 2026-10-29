import { writeFileSync } from "node:fs";
import { cwd } from "node:process";

import { beruehrteTestdateienSamtHilfen } from "../auftrag/testumbau.mjs";
import { git } from "../auftrag/git.mjs";
import { matrix, pruefsumme, teilnummer } from "./teile.mjs";
import { teilberichte } from "./teilberichte.mjs";
import { meldeUrteil, nachherSeite, ohneMutanten, ohnePostgresPruefbar, ohneQuelleZeile, urteilsMengen } from "./testumbau.mjs";
import { planZeilen, stueckName, vorherPlan, vorherStueck } from "./vorher-verteilt.mjs";

const EXIT_GRUEN = 0;
const JOBGRENZE_MINUTEN = 360;
const SEKUNDEN_JE_MINUTE = 60;
const HAELFTE = 2;
const WARNGRENZE_SEKUNDEN = (JOBGRENZE_MINUTEN * SEKUNDEN_JE_MINUTE) / HAELFTE;

async function testumbauPlan(basis, werkzeug) {
  const geaendert = beruehrteTestdateienSamtHilfen(basis, cwd());
  const ohne = await ohneMutanten(basis);
  const kopf = git(["rev-parse", "HEAD"], { cwd: cwd() }).trim();
  if (ohne !== null) return { ohne, geaendert, stuecke: [], pruefsumme: pruefsumme([], kopf) };
  await ohnePostgresPruefbar(basis, geaendert, werkzeug);
  const plan = await vorherPlan({ basis, tests: geaendert }, werkzeug);
  return { ...plan, ohne, geaendert, pruefsumme: pruefsumme(plan.stuecke, kopf) };
}

function warnzeilen({ stuecke }) {
  return stuecke
    .filter(({ geschaetzt }) => geschaetzt !== null && geschaetzt > WARNGRENZE_SEKUNDEN)
    .map((stueck) => `Warnung: ${stueckName(stueck)} lässt sich nicht kleiner schneiden, Schätzung ${Math.round(stueck.geschaetzt / SEKUNDEN_JE_MINUTE)} min, die Jobgrenze von GitHub liegt bei ${JOBGRENZE_MINUTEN} min`);
}

export async function schreibeTestumbauPlan(basis, ziel, werkzeug) {
  const plan = await testumbauPlan(basis, werkzeug);
  console.log(plan.ohne ?? [...planZeilen(plan), ...warnzeilen(plan)].join("\n"));
  writeFileSync(ziel, JSON.stringify({ anzahl: plan.stuecke.length, teile: matrix(plan.stuecke), pruefsumme: plan.pruefsumme }));
  return EXIT_GRUEN;
}

export async function messeTestumbauTeil(basis, optionen, werkzeug) {
  const plan = await testumbauPlan(basis, werkzeug);
  const nummer = teilnummer(optionen, plan.stuecke.length);
  const stueck = plan.stuecke[nummer - 1];
  const ergebnis = { getoetet: 0, verloren: [], echteVerluste: 0, entfallenMoeglich: [], abgestuerzte: [] };
  if (stueck !== undefined) {
    console.log(`Teil ${nummer} von ${plan.stuecke.length}: ${stueckName(stueck)}`);
    await werkzeug.sperre();
    const stand = { basis, tests: plan.geaendert };
    const vorher = await vorherStueck(stand, { nummer, datei: stueck.datei, zeilen: stueck.zeilen }, werkzeug);
    Object.assign(ergebnis, await nachherSeite(vorher.getoetet, stand, werkzeug));
  }
  console.log(`Teil ${nummer}: ${ergebnis.getoetet} vorher getötete Mutanten, ${ergebnis.verloren.length} nachher nicht mehr getötet; das Urteil fällt im Job Mutationsurteil.`);
  writeFileSync(optionen.ergebnis, JSON.stringify({ pruefsumme: plan.pruefsumme, teil: nummer, ...ergebnis }));
  return EXIT_GRUEN;
}

export async function urteileTestumbau(basis, ordner, werkzeug) {
  const plan = await testumbauPlan(basis, werkzeug);
  const berichte = teilberichte(ordner, { teile: plan.stuecke, pruefsumme: plan.pruefsumme }).sort((links, rechts) => links.teil - rechts.teil);
  if (plan.ohne !== null) {
    console.log(plan.ohne);
    return EXIT_GRUEN;
  }
  if (plan.stuecke.length === 0) {
    console.log(ohneQuelleZeile(plan.betroffen.length));
    return EXIT_GRUEN;
  }
  const alle = (feld) => berichte.flatMap((bericht) => bericht[feld]);
  return meldeUrteil({
    quellen: plan.quellen.map(({ datei }) => datei),
    getoetet: berichte.reduce((summe, { getoetet }) => summe + getoetet, 0),
    ...urteilsMengen(berichte),
    abgestuerzte: alle("abgestuerzte"),
  });
}
