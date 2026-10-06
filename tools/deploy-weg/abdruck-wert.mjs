const FEHLER_SCHLUESSEL = "abdruck-fehler";
const PROBE_ARGUMENTE = 4;
const PROBE_ZAHL = Number.NaN;

export const FEHLER = Object.freeze({ [FEHLER_SCHLUESSEL]: true });

const probeMarken = new WeakMap();

export function istFehler(wert) {
  return wert !== null && typeof wert === "object" && wert[FEHLER_SCHLUESSEL] === true;
}

export function kanonisch(wert) {
  if (Array.isArray(wert)) return `[${wert.map(kanonisch).join(",")}]`;
  if (wert === null || typeof wert !== "object") return JSON.stringify(wert ?? null);
  const paare = Object.keys(wert)
    .sort()
    .map((schluessel) => `${JSON.stringify(schluessel)}:${kanonisch(wert[schluessel])}`);
  return `{${paare.join(",")}}`;
}

function probeText(pfad) {
  return `‹${pfad}›`;
}

function probeArgument(pfad) {
  const ziel = () => undefined;
  const probe = new Proxy(ziel, {
    get(_ziel, name) {
      if (name === Symbol.toPrimitive) return (hinweis) => (hinweis === "number" ? PROBE_ZAHL : probeText(pfad));
      if (name === "toString" || name === "valueOf" || name === "toJSON") return () => probeText(pfad);
      if (name === "then" || typeof name === "symbol") return undefined;
      return probeArgument(`${pfad}.${name}`);
    },
    apply() {
      return probeArgument(`${pfad}()`);
    },
    has() {
      return false;
    },
    ownKeys() {
      return [];
    },
    getOwnPropertyDescriptor() {
      return undefined;
    },
  });
  probeMarken.set(probe, pfad);
  return probe;
}

function probeAufruf(funktion) {
  const argumente = Array.from({ length: PROBE_ARGUMENTE }, (_leer, stelle) => probeArgument(`a${stelle}`));
  try {
    return { art: "ergebnis", wert: abbild(funktion(...argumente)) };
  } catch {
    return { art: "wirft" };
  }
}

function funktionAbbild(funktion) {
  return {
    art: "funktion",
    quelltext: Function.prototype.toString.call(funktion),
    probe: probeAufruf(funktion),
  };
}

function zahlAbbild(zahl) {
  return Number.isFinite(zahl) ? zahl : { art: "zahl", text: String(zahl) };
}

function besonderesAbbild(wert, unterwegs) {
  if (wert instanceof RegExp) return { art: "regexp", text: String(wert) };
  if (wert instanceof Date) return { art: "datum", text: Number.isNaN(wert.getTime()) ? "ungueltig" : wert.toISOString() };
  if (wert instanceof Map) return { art: "map", eintraege: [...wert].map((paar) => abbild(paar, unterwegs)) };
  if (wert instanceof Set) return { art: "set", werte: [...wert].map((eintrag) => abbild(eintrag, unterwegs)) };
  if (typeof wert.then === "function") {
    Promise.resolve(wert).catch(() => undefined);
    return { art: "promise" };
  }
  return undefined;
}

function objektAbbild(wert, unterwegs) {
  if (unterwegs.has(wert)) return { art: "zyklus" };
  unterwegs.add(wert);
  try {
    if (Array.isArray(wert)) return wert.map((eintrag) => abbild(eintrag, unterwegs));
    const besonders = besonderesAbbild(wert, unterwegs);
    if (besonders !== undefined) return besonders;
    return Object.fromEntries(Object.keys(wert).map((schluessel) => [schluessel, abbild(wert[schluessel], unterwegs)]));
  } finally {
    unterwegs.delete(wert);
  }
}

const WERT_ABBILDER = new Map([
  ["string", (wert) => wert],
  ["boolean", (wert) => wert],
  ["number", zahlAbbild],
  ["bigint", (wert) => ({ art: "bigint", text: String(wert) })],
  ["undefined", () => ({ art: "undefined" })],
  ["symbol", (wert) => ({ art: "symbol", text: String(wert.description) })],
  ["function", (wert) => funktionAbbild(wert)],
]);

export function abbild(wert, unterwegs = new Set()) {
  if (probeMarken.has(wert)) return { art: "probe", pfad: probeMarken.get(wert) };
  if (wert === null) return null;
  const abbilder = WERT_ABBILDER.get(typeof wert);
  return abbilder ? abbilder(wert) : objektAbbild(wert, unterwegs);
}

export function istEinfachesObjekt(wert) {
  if (wert === null || typeof wert !== "object" || Array.isArray(wert)) return false;
  const vorbild = Object.getPrototypeOf(wert);
  return vorbild === Object.prototype || vorbild === null;
}
