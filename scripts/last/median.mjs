import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ERGEBNIS_ANFANG = '{"ergebnis":';
const ARGUMENT_AB = 2;
const NACHKOMMASTELLEN = 1000;
const HALB = 2;
const OHNE_WERTE = "Median der Fehlerquote der letzten Queue-Laeufe: keine Werte vorhanden";

function quoteDerZeile(zeile) {
  const anfang = zeile.indexOf(ERGEBNIS_ANFANG);
  if (anfang < 0) return undefined;
  try {
    const quote = JSON.parse(zeile.slice(anfang)).ergebnis.fehlerquoteProzent;
    return typeof quote === "number" && Number.isFinite(quote) ? quote : undefined;
  } catch {
    return undefined;
  }
}

function quoteDesLogs(text) {
  const quoten = text.split("\n").map(quoteDerZeile).filter((quote) => quote !== undefined);
  return quoten.at(-1);
}

function medianVon(werte) {
  const sortiert = [...werte].sort((links, rechts) => links - rechts);
  const mitte = Math.floor(sortiert.length / HALB);
  const wert = sortiert.length % HALB === 1 ? sortiert[mitte] : (sortiert[mitte - 1] + sortiert[mitte]) / HALB;
  return Math.round(wert * NACHKOMMASTELLEN) / NACHKOMMASTELLEN;
}

export function medianDerLogs(texte) {
  const quoten = texte.map(quoteDesLogs).filter((quote) => quote !== undefined);
  return { anzahl: quoten.length, median: quoten.length === 0 ? undefined : medianVon(quoten) };
}

async function leseLogs(ordner) {
  try {
    const namen = await readdir(ordner);
    return await Promise.all(namen.map((name) => readFile(join(ordner, name), "utf8")));
  } catch {
    return [];
  }
}

async function main(ordner) {
  const { anzahl, median } = medianDerLogs(await leseLogs(ordner));
  console.log(median === undefined ? OHNE_WERTE : `Median der Fehlerquote der letzten ${anzahl} Queue-Laeufe: ${median} %`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv[ARGUMENT_AB]).then(
    () => process.exit(0),
    () => {
      console.log(OHNE_WERTE);
      process.exit(0);
    },
  );
}
