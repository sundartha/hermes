import { writeFileSync } from "node:fs";
import { cwd } from "node:process";

import { beruehrteTestdateienSamtHilfen } from "../auftrag/testumbau.mjs";
import { git } from "../auftrag/git.mjs";
import { alleAusgelassenen } from "./nur-sandbox-rot.mjs";
import { matrix, pruefsumme, teilnummer } from "./teile.mjs";
import { teilberichte } from "./teilberichte.mjs";
import { meldeUrteil, nachherSeite, ohneMutanten, ohnePostgresPruefbar, ohneQuelleZeile, urteilsMengen } from "./testumbau.mjs";
import { geschnittenerPlan, planZeilen, stueckName, vorherStueck } from "./vorher-verteilt.mjs";

const EXIT_GRUEN = 0;
const STUECK_SEITE_MINUTEN = 90;
const SEKUNDEN_JE_MINUTE = 60;
const SEITE_HOECHSTENS_SEKUNDEN = STUECK_SEITE_MINUTEN * SEKUNDEN_JE_MINUTE;

async function testumbauPlan(basis, werkzeug) {
  const geaendert = beruehrteTestdateienSamtHilfen(basis, cwd());
  const ohne = await ohneMutanten(basis);
  const kopf = git(["rev-parse", "HEAD"], { cwd: cwd() }).trim();
  if (ohne !== null) return { ohne, geaendert, stuecke: [], pruefsumme: pruefsumme([], kopf) };
  await ohnePostgresPruefbar(basis, geaendert, werkzeug);
  const plan = await geschnittenerPlan({ basis, tests: geaendert }, werkzeug, SEITE_HOECHSTENS_SEKUNDEN);
  return { ...plan, ohne, geaendert, pruefsumme: pruefsumme(plan.stuecke, kopf) };
}

export async function schreibeTestumbauPlan(basis, ziel, werkzeug) {
  const plan = await testumbauPlan(basis, werkzeug);
  console.log(plan.ohne ?? planZeilen(plan).join("\n"));
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
    const vorher = await vorherStueck(stand, { nummer, datei: stueck.datei, zeilen: stueck.orte ?? stueck.zeilen }, werkzeug);
    Object.assign(ergebnis, await nachherSeite(vorher.getoetet, stand, werkzeug));
  }
  console.log(`Teil ${nummer}: ${ergebnis.getoetet} vorher getötete Mutanten, ${ergebnis.verloren.length} nachher nicht mehr getötet; das Urteil fällt im Job Mutationsurteil.`);
  writeFileSync(optionen.ergebnis, JSON.stringify({ pruefsumme: plan.pruefsumme, teil: nummer, ...ergebnis, ausgelassen: alleAusgelassenen() }));
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
    ausgelassen: alle("ausgelassen"),
  });
}
