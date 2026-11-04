import { readFileSync } from "node:fs";
import { env } from "node:process";

import { deklarationen, eingebetteterText, enthaeltHelfer, mutantenIn } from "./einbettung-text.mjs";
import { EINBETTUNG_VORSPANN } from "./zustand.mjs";

const NAMENSRAUM = "__stryker__";
const ABDECKUNG = "mutantCoverage";
const AKTIVER_MUTANT = "__STRYKER_ACTIVE_MUTANT__";
const ZAHL_GEFRAGT = "number";
const TEXT_GEFRAGT = "string";
const TEXT_METHODE = "toString";
const WERT_METHODE = "valueOf";
const TEXT_ZUERST = [TEXT_METHODE, WERT_METHODE];
const WERT_ZUERST = [WERT_METHODE, TEXT_METHODE];

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

const eingebettetesToString = new Proxy(Function.prototype.toString, {
  apply(ziel, funktion, argumente) {
    const text = Reflect.apply(ziel, funktion, argumente);
    if (!enthaeltHelfer(text)) return text;
    alsStatischAbgedeckt(text);
    return eingebetteterText({ text, name: funktion.name, aktiv: env[AKTIVER_MUTANT], tabelle: originale, datei: quelle });
  },
});

function istGrundwert(wert) {
  return wert === null || !["object", "function"].includes(typeof wert);
}

function grundwert(hinweis) {
  for (const name of hinweis === TEXT_GEFRAGT ? TEXT_ZUERST : WERT_ZUERST) {
    if (hinweis === ZAHL_GEFRAGT && name === TEXT_METHODE && this.toString === eingebettetesToString) return Number.NaN;
    if (typeof this[name] === "function") {
      const wert = this[name]();
      if (istGrundwert(wert)) return wert;
    }
  }
  throw new TypeError("Cannot convert object to primitive value");
}

Function.prototype.toString = eingebettetesToString;
Object.defineProperty(Function.prototype, Symbol.toPrimitive, { configurable: true, writable: true, value: grundwert });
