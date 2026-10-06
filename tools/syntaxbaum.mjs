import * as espree from "espree";
import { ESLint } from "eslint";

const POSITIONSFELDER = new Set(["range", "start", "end", "loc", "comments", "tokens"]);

const OHNE_KONFIGURATION = { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: {} };

async function konfiguration(pfad, eslint) {
  try {
    return await eslint.calculateConfigForFile(pfad);
  } catch {
    return undefined;
  }
}

export async function einstellungenFuer(pfad, eslint = new ESLint()) {
  const config = await konfiguration(pfad, eslint);
  if (config?.languageOptions === undefined) return OHNE_KONFIGURATION;
  const { ecmaVersion, sourceType, parserOptions = {} } = config.languageOptions;
  return { ecmaVersion, sourceType, ecmaFeatures: parserOptions.ecmaFeatures ?? {} };
}

export function gelesen(text, einstellungen) {
  try {
    return espree.parse(text, { ...einstellungen, comment: true, range: true });
  } catch {
    return undefined;
  }
}

function vergleichbar(schluessel, wert) {
  if (POSITIONSFELDER.has(schluessel)) return undefined;
  return typeof wert === "bigint" ? `${wert}n` : wert;
}

export function gleicherBaum(links, rechts) {
  return JSON.stringify(links, vergleichbar) === JSON.stringify(rechts, vergleichbar);
}

function gleicherSyntaxbaum(vorher, nachher, einstellungen = OHNE_KONFIGURATION) {
  const alterBaum = gelesen(vorher, einstellungen);
  const neuerBaum = gelesen(nachher, einstellungen);
  return alterBaum !== undefined && neuerBaum !== undefined && gleicherBaum(alterBaum, neuerBaum);
}

export async function nurKommentareGeaendert({ pfad, vorher, nachher }, eslint) {
  return gleicherSyntaxbaum(vorher, nachher, await einstellungenFuer(pfad, eslint));
}
