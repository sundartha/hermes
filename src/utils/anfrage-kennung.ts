import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const KENNUNG_HEADER = "X-Request-Id";
const KENNUNG_MARKE = "rid=";
const MASCHINENLESBARE_ZEILE = "[metrics] ";
const SCHREIBER_MARKE = Symbol("anfrageKennung");

type Schreiber = ((this: unknown, stueck: unknown, ...rest: unknown[]) => unknown) & { [SCHREIBER_MARKE]?: true };

const kontext = new AsyncLocalStorage<{ kennung: string }>();
let inLogzeilen = false;

export function setzeKennungInLogzeilen(ein: unknown): void {
  inLogzeilen = ein === true;
}

function aktuelleAnfrageKennung(): string | undefined {
  return kontext.getStore()?.kennung;
}

export function mitKennung<T>(kennung: string, aufruf: () => T): T {
  return kontext.run({ kennung }, aufruf);
}

export function anfrageKennungMiddleware(
  req: unknown,
  res: { locals: object; set: (name: string, wert: string) => unknown },
  next: () => void,
): void {
  const kennung = randomUUID();
  Object.assign(res.locals, { kennung });
  res.set(KENNUNG_HEADER, kennung);
  mitKennung(kennung, next);
}

function mitMarke(text: string, kennung: string): string {
  if (text.startsWith(MASCHINENLESBARE_ZEILE)) return text;
  return `${KENNUNG_MARKE}${kennung} ${text}`;
}

export function mitAnfrageKennung(schreibe: Schreiber): Schreiber {
  if (schreibe[SCHREIBER_MARKE]) return schreibe;
  const erweitert: Schreiber = function (this: unknown, stueck: unknown, ...rest: unknown[]) {
    const kennung = inLogzeilen ? aktuelleAnfrageKennung() : undefined;
    const text = kennung && typeof stueck === "string" ? mitMarke(stueck, kennung) : stueck;
    return schreibe.call(this, text, ...rest);
  };
  erweitert[SCHREIBER_MARKE] = true;
  return erweitert;
}
