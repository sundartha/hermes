#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(import.meta.url), "..", "..");
const STANDARD_ENV_DATEI = resolve(REPO, ".env");
const STANDARD_API_BASE = "https://api.exa.ai";
const SEARCH_PATH = "/search";
const PROBE_QUERY = "opening hours Deutsches Museum Munich";
const PROBE_TIMEOUT_MS = 10000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const MIN_KEY_LAENGE = 20;
const MASKE_ZEICHEN = 4;
const ENV_ZEILE = /^EXA_API_KEY=/;
const API_BASE_ZEILE = /^EXA_API_BASE=(.+)$/;
const LOG = "[exa-key]";

const ZEILENENDE = /\r|\n/;
const CTRL_C = "\u0003";
const BACKSPACE = ["\u007f", "\b"];

function maskiert(key) {
  return `${key.slice(0, MASKE_ZEICHEN)}… (${key.length} Zeichen)`;
}

function leseKeyVerdeckt() {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    return new Promise((abschluss) => {
      let daten = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (teil) => (daten += teil));
      stdin.on("end", () => abschluss(daten.split(ZEILENENDE)[0].trim()));
    });
  }
  stdout.write(`${LOG} Exa-API-Key einfuegen und Enter druecken (Eingabe bleibt unsichtbar): `);
  return new Promise((abschluss) => {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let eingabe = "";
    const fertig = (wert) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      abschluss(wert.trim());
    };
    stdin.on("data", function beiZeichen(teil) {
      if (teil.includes(CTRL_C)) {
        stdin.removeListener("data", beiZeichen);
        fertig("");
        return;
      }
      if (BACKSPACE.includes(teil)) {
        eingabe = eingabe.slice(0, -1);
        return;
      }
      eingabe += teil;
      if (ZEILENENDE.test(eingabe)) {
        stdin.removeListener("data", beiZeichen);
        fertig(eingabe.split(ZEILENENDE)[0]);
      }
    });
  });
}

async function probeGegenExa({ key, apiBase }) {
  let antwort;
  try {
    antwort = await fetch(`${apiBase}${SEARCH_PATH}`, {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ query: PROBE_QUERY, type: "auto", numResults: 1 }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (fehler) {
    return { ergebnis: "netz", detail: fehler?.message || String(fehler) };
  }
  if (antwort.ok) return { ergebnis: "ok" };
  if ([HTTP_UNAUTHORIZED, HTTP_FORBIDDEN].includes(antwort.status)) {
    return { ergebnis: "ungueltig", detail: `HTTP ${antwort.status}` };
  }
  return { ergebnis: "fehler", detail: `HTTP ${antwort.status}` };
}

function schreibeEnv({ datei, key }) {
  const zeilen = readFileSync(datei, "utf8").split("\n");
  const stelle = zeilen.findIndex((zeile) => ENV_ZEILE.test(zeile));
  if (stelle >= 0) {
    const vorher = zeilen[stelle].slice("EXA_API_KEY=".length);
    zeilen[stelle] = `EXA_API_KEY=${key}`;
    writeFileSync(datei, zeilen.join("\n"));
    return { ersetzt: true, warBelegt: vorher.trim() !== "" };
  }
  const block = [
    "",
    "# In-Call-Recherche (look_up): Schluessel des Suchdienstes Exa, gesetzt per",
    "# npm run exa:key (Probe gegen die echte API vor dem Eintrag).",
    `EXA_API_KEY=${key}`,
    "",
  ];
  writeFileSync(datei, `${zeilen.join("\n").replace(/\n*$/, "\n")}${block.join("\n")}`);
  return { ersetzt: false, warBelegt: false };
}

function apiBaseAus(envText) {
  for (const zeile of envText.split("\n")) {
    const treffer = zeile.match(API_BASE_ZEILE);
    if (treffer) return treffer[1].trim().replace(/\/+$/, "");
  }
  return STANDARD_API_BASE;
}

function eingabeFehler({ argv, datei, key }) {
  if (argv.some((wert) => !wert.startsWith("--"))) {
    return (
      `Abbruch: der Key wird NICHT als Argument angenommen (er landet sonst in` +
      ` der Shell-History). Einfach "npm run exa:key" starten und den Key einfuegen.`
    );
  }
  if (!existsSync(datei)) {
    return `Abbruch: ${datei} existiert nicht - erst .env anlegen (s. .env.example).`;
  }
  if (key === null) return null;
  if (!key) return "Abbruch: keine Eingabe.";
  if (/\s/.test(key) || key.length < MIN_KEY_LAENGE) {
    return (
      `Abbruch: das sieht nicht nach einem vollstaendigen Key aus` +
      ` (${maskiert(key)}; erwartet: mind. ${MIN_KEY_LAENGE} Zeichen, ohne Leerraum).` +
      ` Nichts geschrieben.`
    );
  }
  return null;
}

async function probeBestanden({ key, apiBase }) {
  console.log(`${LOG} Probe gegen ${apiBase} (eine Mini-Suche, ~0,8 US-Cent) ...`);
  const probe = await probeGegenExa({ key, apiBase });
  if (probe.ergebnis === "ok") {
    console.log(`${LOG} Probe OK - der Key funktioniert.`);
    return true;
  }
  const grund =
    probe.ergebnis === "ungueltig"
      ? `Exa lehnt den Key ab (${probe.detail}). Nichts geschrieben - bitte den Key im` +
        ` Exa-Dashboard pruefen und erneut einfuegen.`
      : `die Probe kam nicht durch (${probe.detail}). Ob der Key stimmt, ist damit` +
        ` UNBELEGT - nichts geschrieben. Netz pruefen und erneut versuchen, oder` +
        ` bewusst mit --ohne-probe eintragen.`;
  console.error(`${LOG} Abbruch: ${grund}`);
  return false;
}

async function haupt(argv) {
  const ohneProbe = argv.includes("--ohne-probe");
  const dateiArg = argv.find((wert) => wert.startsWith("--datei="));
  const datei = dateiArg ? resolve(dateiArg.slice("--datei=".length)) : STANDARD_ENV_DATEI;

  const vorFehler = eingabeFehler({ argv, datei, key: null });
  if (vorFehler) {
    console.error(`${LOG} ${vorFehler}`);
    return 1;
  }
  const key = await leseKeyVerdeckt();
  const fehler = eingabeFehler({ argv, datei, key });
  if (fehler) {
    console.error(`${LOG} ${fehler}`);
    return 1;
  }

  const apiBase = apiBaseAus(readFileSync(datei, "utf8"));
  if (ohneProbe) {
    console.log(`${LOG} --ohne-probe: der Key wird OHNE Beleg eingetragen.`);
  } else if (!(await probeBestanden({ key, apiBase }))) {
    return 1;
  }

  const { ersetzt, warBelegt } = schreibeEnv({ datei, key });
  const wie = ersetzt
    ? warBelegt
      ? "bestehender Wert ERSETZT"
      : "leere Zeile befuellt"
    : "Zeile angehaengt";
  console.log(`${LOG} EXA_API_KEY gesetzt (${maskiert(key)}) in ${datei} - ${wie}.`);
  console.log(
    `${LOG} Naechster Schritt: Serverstart nach .fortschritt.md, Abschnitt` +
      ` "BEREIT ZUM ANRUF" (LOOKUP_ENABLED=true reist dort am Startkommando mit).`,
  );
  return 0;
}

const ARG_START = 2;
process.exit(await haupt(process.argv.slice(ARG_START)));
