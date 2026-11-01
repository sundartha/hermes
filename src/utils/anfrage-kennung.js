import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const KENNUNG_HEADER = "X-Request-Id";
const KENNUNG_MARKE = "rid=";
const MASCHINENLESBARE_ZEILE = "[metrics] ";
const SCHREIBER_MARKE = Symbol("anfrageKennung");

const kontext = new AsyncLocalStorage();
let inLogzeilen = false;

export function setzeKennungInLogzeilen(ein) {
  inLogzeilen = ein === true;
}

function aktuelleAnfrageKennung() {
  return kontext.getStore()?.kennung;
}

export function mitKennung(kennung, aufruf) {
  return kontext.run({ kennung }, aufruf);
}

export function anfrageKennungMiddleware(req, res, next) {
  const kennung = randomUUID();
  Object.assign(res.locals, { kennung });
  res.set(KENNUNG_HEADER, kennung);
  mitKennung(kennung, next);
}

function mitMarke(text, kennung) {
  if (text.startsWith(MASCHINENLESBARE_ZEILE)) return text;
  return `${KENNUNG_MARKE}${kennung} ${text}`;
}

export function mitAnfrageKennung(schreibe) {
  if (schreibe[SCHREIBER_MARKE]) return schreibe;
  const erweitert = function (stueck, ...rest) {
    const kennung = inLogzeilen ? aktuelleAnfrageKennung() : undefined;
    const text = kennung && typeof stueck === "string" ? mitMarke(stueck, kennung) : stueck;
    return schreibe.call(this, text, ...rest);
  };
  erweitert[SCHREIBER_MARKE] = true;
  return erweitert;
}
