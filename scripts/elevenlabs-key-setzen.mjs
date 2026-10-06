#!/usr/bin/env node
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const API_BASIS = "https://api.elevenlabs.io";
const PFAD_AGENTEN = "/v1/convai/agents";
const PFAD_WERKZEUGE = "/v1/convai/tools";
const BENOETIGTES_RECHT = "convai_write";
const FEHLENDES_RECHT_MARKE = "missing_permissions";
const HTTP_OK = 200;
const HTTP_NICHT_AUTORISIERT = 401;
const HTTP_UNVERARBEITBAR = 422;
const ANFRAGE_TIMEOUT_MS = 15000;

const ENV_SCHLUESSEL_NAME = "ELEVENLABS_API_KEY";
const ENV_ZEILE = new RegExp(`^${ENV_SCHLUESSEL_NAME}=.*$`, "m");
const DATEI_RECHTE_NUR_EIGENTUEMER = 0o600;
const ARGV_NUTZLAST_START = 2;

const DRUCKBARE_ASCII = /^[!-~]+$/;

const EINGABE_FRAGE = `${ENV_SCHLUESSEL_NAME} einfuegen (Eingabe bleibt unsichtbar): `;
const ZEICHEN_WAGENRUECKLAUF = "\r";
const ZEICHEN_ZEILENVORSCHUB = "\n";
const ZEICHEN_STRG_C = "\u0003";
const ZEICHEN_STRG_D = "\u0004";
const ZEICHEN_RUECKSCHRITT = "\b";
const ZEICHEN_ENTFERNEN = "\u007f";
const STATUS_WEITER = "weiter";
const STATUS_FERTIG = "fertig";
const STATUS_ABBRUCH = "abbruch";

const NICHTS_GESCHRIEBEN = "Nichts geschrieben, .env unveraendert.";

class Abbruch extends Error {}

function zeichenVerarbeiten(puffer, zeichen) {
  if (zeichen === ZEICHEN_WAGENRUECKLAUF || zeichen === ZEICHEN_ZEILENVORSCHUB) {
    return { puffer, status: STATUS_FERTIG };
  }
  if (zeichen === ZEICHEN_STRG_C) return { puffer: "", status: STATUS_ABBRUCH };
  if (zeichen === ZEICHEN_STRG_D) {
    return puffer ? { puffer, status: STATUS_FERTIG } : { puffer: "", status: STATUS_ABBRUCH };
  }
  if (zeichen === ZEICHEN_RUECKSCHRITT || zeichen === ZEICHEN_ENTFERNEN) {
    return { puffer: puffer.slice(0, -1), status: STATUS_WEITER };
  }
  return { puffer: puffer + zeichen, status: STATUS_WEITER };
}

function verdeckteEingabeLesen() {
  return new Promise((erfuellen, ablehnen) => {
    const strom = process.stdin;
    process.stdout.write(EINGABE_FRAGE);
    strom.setRawMode(true);
    strom.resume();
    strom.setEncoding("utf8");
    let puffer = "";
    const beenden = () => {
      strom.setRawMode(false);
      strom.pause();
      strom.off("data", aufZeichen);
      process.stdout.write("\n");
    };
    const aufZeichen = (stueck) => {
      for (const zeichen of stueck) {
        const schritt = zeichenVerarbeiten(puffer, zeichen);
        puffer = schritt.puffer;
        if (schritt.status === STATUS_FERTIG) {
          beenden();
          erfuellen(puffer);
          return;
        }
        if (schritt.status === STATUS_ABBRUCH) {
          beenden();
          ablehnen(new Abbruch(`Eingabe abgebrochen. ${NICHTS_GESCHRIEBEN}`));
          return;
        }
      }
    };
    strom.on("data", aufZeichen);
  });
}

async function eingabeAusStromLesen() {
  const teile = [];
  for await (const stueck of process.stdin) teile.push(stueck);
  return Buffer.concat(teile).toString("utf8");
}

async function schluesselLesen() {
  const roh = process.stdin.isTTY ? await verdeckteEingabeLesen() : await eingabeAusStromLesen();
  const schluessel = roh.trim();
  if (!schluessel) {
    throw new Abbruch(`Leere Eingabe - kein Schluessel gelesen. ${NICHTS_GESCHRIEBEN}`);
  }
  if (!DRUCKBARE_ASCII.test(schluessel)) {
    throw new Abbruch(
      `Die Eingabe enthaelt Zeichen, die in keinem API-Schluessel vorkommen. ${NICHTS_GESCHRIEBEN}`,
    );
  }
  return schluessel;
}

async function anfragen(zweck, adresse, optionen) {
  try {
    const antwort = await fetch(adresse, optionen);
    return { status: antwort.status, rumpf: await antwort.text() };
  } catch (fehler) {
    throw new Abbruch(
      `ElevenLabs-API nicht erreichbar (${zweck}): ${fehler.message}. ${NICHTS_GESCHRIEBEN}`,
    );
  }
}

async function leserechtPruefen(schluessel) {
  const { status } = await anfragen("Leserecht", API_BASIS + PFAD_AGENTEN, {
    headers: { "xi-api-key": schluessel },
    signal: AbortSignal.timeout(ANFRAGE_TIMEOUT_MS),
  });
  if (status !== HTTP_OK) {
    throw new Abbruch(
      `Leserecht fehlt oder Schluessel ungueltig: GET ${PFAD_AGENTEN} antwortet HTTP ${status}, ` +
        `erwartet ${HTTP_OK}. ${NICHTS_GESCHRIEBEN}`,
    );
  }
}

async function schreibrechtPruefen(schluessel) {
  const { status, rumpf } = await anfragen("Schreibrecht", API_BASIS + PFAD_WERKZEUGE, {
    method: "POST",
    headers: { "xi-api-key": schluessel, "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(ANFRAGE_TIMEOUT_MS),
  });
  if (status === HTTP_UNVERARBEITBAR) return;
  if (status === HTTP_NICHT_AUTORISIERT && rumpf.includes(FEHLENDES_RECHT_MARKE)) {
    throw new Abbruch(
      `Schreibrecht FEHLT: dem Schluessel fehlt die Berechtigung "${BENOETIGTES_RECHT}" ` +
        `(HTTP ${status}, ${FEHLENDES_RECHT_MARKE}). Im ElevenLabs-Dashboard unter ` +
        `"API Keys" einen Schluessel MIT ${BENOETIGTES_RECHT} anlegen. ${NICHTS_GESCHRIEBEN}`,
    );
  }
  throw new Abbruch(
    `Schreibrecht nicht belegbar: POST ${PFAD_WERKZEUGE} antwortet HTTP ${status}, ` +
      `erwartet ${HTTP_UNVERARBEITBAR}. ${NICHTS_GESCHRIEBEN}`,
  );
}

function schluesselZeileSetzen(inhalt, schluessel) {
  const zeile = `${ENV_SCHLUESSEL_NAME}=${schluessel}`;
  if (ENV_ZEILE.test(inhalt)) return inhalt.replace(ENV_ZEILE, () => zeile);
  return inhalt.endsWith("\n") ? `${inhalt}${zeile}\n` : `${inhalt}\n${zeile}\n`;
}

function zeitstempel() {
  const [datum, uhrzeit] = new Date().toISOString().split("T");
  return `${datum.replaceAll("-", "")}-${uhrzeit.replace(/\..*$/, "").replaceAll(":", "")}`;
}

function envAktualisieren(pfad, schluessel) {
  const inhalt = readFileSync(pfad, "utf8");
  const sicherung = `${pfad}.bak-${zeitstempel()}`;
  copyFileSync(pfad, sicherung);
  chmodSync(sicherung, DATEI_RECHTE_NUR_EIGENTUEMER);
  writeFileSync(pfad, schluesselZeileSetzen(inhalt, schluessel));
  chmodSync(pfad, DATEI_RECHTE_NUR_EIGENTUEMER);
  return sicherung;
}

async function main() {
  const argumente = process.argv.slice(ARGV_NUTZLAST_START);
  if (argumente.length > 0) {
    throw new Abbruch(
      "Dieses Skript nimmt keine Argumente - der Schluessel wird ueber die Standardeingabe " +
        `gelesen, damit er nicht in Shell-Historie und Prozessliste landet. ${NICHTS_GESCHRIEBEN}`,
    );
  }
  const pfad = fileURLToPath(new URL("../.env", import.meta.url));
  if (!existsSync(pfad)) throw new Abbruch(`${pfad} existiert nicht. ${NICHTS_GESCHRIEBEN}`);

  const schluessel = await schluesselLesen();
  await leserechtPruefen(schluessel);
  console.log("Leserecht ok.");
  await schreibrechtPruefen(schluessel);
  console.log("Schreibrecht ok.");
  const sicherung = envAktualisieren(pfad, schluessel);
  console.log(`.env aktualisiert (Sicherungskopie: ${sicherung}).`);
}

try {
  await main();
} catch (fehler) {
  const meldung =
    fehler instanceof Abbruch ? fehler.message : `Unerwarteter Fehler: ${fehler.message}`;
  console.error(meldung);
  process.exitCode = 1;
}
