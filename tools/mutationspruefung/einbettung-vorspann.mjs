import { readFileSync } from "node:fs";
import { env } from "node:process";

import { deklarationen, eingebetteterText, enthaeltHelfer, mutantenIn } from "./einbettung-text.mjs";
import { EINBETTUNG_VORSPANN } from "./zustand.mjs";

const NAMENSRAUM = "__stryker__";
const ABDECKUNG = "mutantCoverage";
const AKTIVER_MUTANT = "__STRYKER_ACTIVE_MUTANT__";

const quelle = new URL(import.meta.url).searchParams.get("quelle");
if (quelle === null) throw new Error("Einbettung: dem Vorspann fehlt die Quelldatei, deren Funktionen eingebettet werden");
env[EINBETTUNG_VORSPANN] = import.meta.url;

let tabelle;
const originale = () => (tabelle ??= deklarationen(readFileSync(quelle, "utf8")));

function alsStatischAbgedeckt(text) {
  const raum = (globalThis[NAMENSRAUM] ??= {});
  const abdeckung = (raum[ABDECKUNG] ??= { static: {}, perTest: {} });
  for (const kennung of mutantenIn(text)) abdeckung.static[kennung] = (abdeckung.static[kennung] ?? 0) + 1;
}

Function.prototype.toString = new Proxy(Function.prototype.toString, {
  apply(ziel, funktion, argumente) {
    const text = Reflect.apply(ziel, funktion, argumente);
    if (!enthaeltHelfer(text)) return text;
    alsStatischAbgedeckt(text);
    return eingebetteterText({ text, name: funktion.name, aktiv: env[AKTIVER_MUTANT], tabelle: originale, datei: quelle });
  },
});
