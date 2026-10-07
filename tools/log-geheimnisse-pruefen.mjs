import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const EXIT_SAUBER = 0;
const EXIT_FUND = 1;
const EXIT_FALSCHER_AUFRUF = 2;
const AUFRUF = "Aufruf: node tools/log-geheimnisse-pruefen.mjs [--wurzel ORDNER]";
const REPO_WURZEL = new URL("..", import.meta.url);
const GESCANNTE_DATEIEN = Object.freeze([
  "src/telephony/adapters/telnyx/voice.js",
  "src/routes/voice.js",
]);

const VERBOTENE_MUSTER = new Map([
  ["Konfig-Geheimnis", /config\.(telnyx\w*\.)?\w*Secret/],
  ["Telnyx-API-Schluessel", /config\.telnyxApiKey/],
  ["Authorization-Kopf der Anfrage", /req\.headers\.authorization/i],
  ["Telnyx-Signaturkopf", /telnyx-signature-ed25519/],
  ["roher Anfragekoerper", /\brawBody\b/],
  ["Wortteil secret", /secret/i],
  ["Wortteil apikey", /apikey/i],
  ["Wortteil authorization", /authorization/i],
  ["Telefonnummer im E.164-Format", /\+\d{8,15}/],
]);

const LOG_AUFRUF = /console\.(?:log|warn|error|info|debug)\s*\(/y;
const ZEILENUMBRUCH = "\n";
const TEXT_BEGRENZER = new Set(['"', "'", "`"]);
const ESCAPE_ZEICHEN = "\\";
const ESCAPE_BREITE = 2;
const ZEILENKOMMENTAR = "//";
const BLOCKKOMMENTAR_ANFANG = "/*";
const BLOCKKOMMENTAR_ENDE = "*/";
const NICHT_GEFUNDEN = -1;
const KLAMMER_TIEFE = new Map([
  ["(", 1],
  [")", -1],
]);
const DRIFT_ZEILE = 1;
const DRIFT_HINWEIS = "keine console-Aufrufe gefunden - Scanner- oder Datei-Drift";
const DATEI_FEHLT = "Datei fehlt";
const ERSTES_ARGUMENT = 2;

function endeDesTextes(quelle, anfang) {
  const begrenzer = quelle[anfang];
  let stelle = anfang + 1;
  while (stelle < quelle.length && quelle[stelle] !== begrenzer) {
    stelle += quelle[stelle] === ESCAPE_ZEICHEN ? ESCAPE_BREITE : 1;
  }
  return Math.min(stelle + 1, quelle.length);
}

function endeDesKommentars(quelle, anfang) {
  if (quelle.startsWith(ZEILENKOMMENTAR, anfang)) {
    const umbruch = quelle.indexOf(ZEILENUMBRUCH, anfang);
    return umbruch === NICHT_GEFUNDEN ? quelle.length : umbruch;
  }
  const ende = quelle.indexOf(BLOCKKOMMENTAR_ENDE, anfang + BLOCKKOMMENTAR_ANFANG.length);
  return ende === NICHT_GEFUNDEN ? quelle.length : ende + BLOCKKOMMENTAR_ENDE.length;
}

function hinterTextOderKommentar(quelle, stelle) {
  if (TEXT_BEGRENZER.has(quelle[stelle])) return endeDesTextes(quelle, stelle);
  const kommentar =
    quelle.startsWith(ZEILENKOMMENTAR, stelle) || quelle.startsWith(BLOCKKOMMENTAR_ANFANG, stelle);
  return kommentar ? endeDesKommentars(quelle, stelle) : stelle;
}

function schliessendeKlammer(quelle, oeffnend) {
  let tiefe = 0;
  let stelle = oeffnend;
  while (stelle < quelle.length) {
    const weiter = hinterTextOderKommentar(quelle, stelle);
    if (weiter === stelle) {
      tiefe += KLAMMER_TIEFE.get(quelle[stelle]) ?? 0;
      if (tiefe === 0) return stelle;
      stelle += 1;
    } else {
      stelle = weiter;
    }
  }
  return quelle.length;
}

function logAufrufAn(quelle, stelle) {
  LOG_AUFRUF.lastIndex = stelle;
  const treffer = LOG_AUFRUF.exec(quelle);
  if (treffer === null) return null;
  const oeffnend = LOG_AUFRUF.lastIndex - 1;
  const schliessend = schliessendeKlammer(quelle, oeffnend);
  return { anfang: stelle, ende: schliessend, argumente: quelle.slice(oeffnend + 1, schliessend) };
}

function logAufrufe(quelle) {
  const aufrufe = [];
  let stelle = 0;
  while (stelle < quelle.length) {
    const weiter = hinterTextOderKommentar(quelle, stelle);
    const aufruf = weiter === stelle ? logAufrufAn(quelle, stelle) : null;
    if (aufruf) aufrufe.push(aufruf);
    stelle = aufruf ? aufruf.ende + 1 : Math.max(weiter, stelle + 1);
  }
  return aufrufe;
}

function zeileVon(quelle, stelle) {
  return quelle.slice(0, stelle).split(ZEILENUMBRUCH).length;
}

function trefferImAufruf(argumente) {
  return [...VERBOTENE_MUSTER].filter(([, muster]) => muster.test(argumente));
}

function befundeDerQuelle(datei, quelle) {
  const aufrufe = logAufrufe(quelle);
  if (aufrufe.length === 0) return [`${datei}:${DRIFT_ZEILE} ${DRIFT_HINWEIS}`];
  return aufrufe.flatMap(({ anfang, argumente }) =>
    trefferImAufruf(argumente).map(
      ([name, muster]) => `${datei}:${zeileVon(quelle, anfang)} ${name} im Log-Aufruf ${muster}`,
    ),
  );
}

function befundeDerDatei(wurzel, datei) {
  const ort = new URL(datei, wurzel);
  if (!existsSync(ort)) return [`${datei}:${DRIFT_ZEILE} ${DATEI_FEHLT}`];
  return befundeDerQuelle(datei, readFileSync(ort, "utf8"));
}

function wurzelAus(argumente) {
  const { values } = parseArgs({ args: argumente, options: { wurzel: { type: "string" } } });
  if (values.wurzel === undefined) return REPO_WURZEL;
  const wurzel = new URL(`${pathToFileURL(values.wurzel).href}/`);
  if (!existsSync(wurzel)) throw new TypeError(`Wurzel ${values.wurzel} existiert nicht.`);
  return wurzel;
}

function main(argumente) {
  let wurzel;
  try {
    wurzel = wurzelAus(argumente);
  } catch (fehler) {
    console.error(`${fehler.message}\n${AUFRUF}`);
    return EXIT_FALSCHER_AUFRUF;
  }
  const befunde = GESCANNTE_DATEIEN.flatMap((datei) => befundeDerDatei(wurzel, datei));
  for (const befund of befunde) console.log(befund);
  return befunde.length === 0 ? EXIT_SAUBER : EXIT_FUND;
}

process.exitCode = main(process.argv.slice(ERSTES_ARGUMENT));
