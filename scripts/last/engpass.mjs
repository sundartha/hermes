import { readFileSync } from "node:fs";

import { MAX_FEHLERQUOTE_PROZENT, MAX_WARTEZEIT_SEKUNDEN } from "./schwellen.mjs";

const ALARMREGELN = JSON.parse(readFileSync(new URL("../../docs/betrieb/grafana/alarmregeln.json", import.meta.url), "utf8"));
const SCHWELLE = "threshold";

function alarmGrenze(uid) {
  const regel = ALARMREGELN.find((eintrag) => eintrag.uid === uid);
  const bedingung = regel.data.find((teil) => teil.model.type === SCHWELLE);
  const [bedingungswert] = bedingung.model.conditions;
  return bedingungswert.evaluator.params[0];
}

export const GRENZEN = Object.freeze({
  fehlerquoteProzent: MAX_FEHLERQUOTE_PROZENT,
  httpP95Ms: alarmGrenze("http-dauer-p95"),
  eventloopP99Ms: alarmGrenze("eventloop-p99"),
  dbPoolWartend: alarmGrenze("db-pool-wartend"),
  warteschlangeAlterS: MAX_WARTEZEIT_SEKUNDEN,
});

const GROESSEN = Object.freeze([
  { schluessel: "fehlerquoteProzent", groesse: "fehlerquote", reisstAbGrenze: true },
  { schluessel: "httpP95Ms", groesse: "http_p95", reisstAbGrenze: false },
  { schluessel: "eventloopP99Ms", groesse: "eventloop_p99", reisstAbGrenze: false },
  { schluessel: "dbPoolWartend", groesse: "db_pool_wartend", reisstAbGrenze: false },
  { schluessel: "warteschlangeAlterS", groesse: "warteschlangenalter", reisstAbGrenze: false },
]);

function reisst(wert, grenze, reisstAbGrenze) {
  if (!Number.isFinite(wert)) return true;
  return reisstAbGrenze ? wert >= grenze : wert > grenze;
}

export function ersterEngpass(kurve, grenzen) {
  for (const punkt of kurve) {
    const gerissen = GROESSEN.find((eintrag) => reisst(punkt[eintrag.schluessel], grenzen[eintrag.schluessel], eintrag.reisstAbGrenze));
    if (gerissen !== undefined) {
      const wert = punkt[gerissen.schluessel];
      return { stufe: punkt.anrufe, groesse: gerissen.groesse, wert: Number.isFinite(wert) ? wert : null, grenze: grenzen[gerissen.schluessel] };
    }
  }
  return undefined;
}
