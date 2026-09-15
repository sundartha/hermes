#!/usr/bin/env node
// IEL-B10: das Geheimnis-Werkzeug des ElevenLabs-Inbound-Wegs (Spec E16, E19, E21, E22).
//
// Unterbefehle:
//   setzen --nummer=<E.164> [--nummer=...] [--ausfuehren]
//                         erzeugt SIP-User, SIP-Passwort und Init-Token im Prozess und verteilt sie im
//                         selben Lauf: Render-Env -> Workspace-Secret -> inbound_trunk_config.
//   beleg-init            Ziel-Urteil (Render-API), dann zwei POSTs an den Init-Webhook (403/404).
//   allowlist-uebernehmen [--ausfuehren]
//                         OWNER_SELF_CALL_TENANT_IDS (genau ein Eintrag) -> ELEVENLABS_INBOUND_TENANT_IDS.
//   schalter --an|--aus [--ausfuehren]
//                         ELEVENLABS_INBOUND_ENABLED; --an nur mit Inventar, beleg-init, stimmen-beleg und
//                         Mindestlaengen GRUEN im selben Lauf, --aus bedingungslos.
//   stimmen-beleg         Stimm-Gleichheit Pflichtsatz/Agent (nur lesend + Probe-Synthesen).
//   conversation-beleg --richtung=inbound|outbound --seit=<ISO> [--nummer=<E.164>]
//                         abgeleitete Felder der neuesten Conversation, nie ein Variablen-Wert.
//
// INVARIANTEN:
//   - Trockenlauf ist Default; geschrieben wird nur mit --ausfuehren.
//   - Kein Geheimnis-Wert erreicht stdout/stderr: EINE Ausgabefunktion (Ausgabe-Waechter) prueft jede
//     Zeile gegen alle erzeugten und gelesenen Werte; Anbieter-Fehlerkoerper werden nie gelesen, auch
//     der letzte catch gibt nur einen Status aus (ein Parse-Fehlertext kann Koerper-Schnipsel tragen).
//   - Kein Unterbefehl laedt den Store; die lokale .env ist weder Wert- noch Zielquelle: Werte entstehen
//     im Prozess, Ziele sind Repo-Konstanten (gepinnter Render-Dienst, initWebhookUrl), das Ziel-Urteil
//     liest den Dienst ueber die Render-API.
//   - Der Render-Listen-Endpunkt (PUT .../env-vars ersetzt die GESAMTE Env) ist baulich unerreichbar,
//     geschrieben werden genau fuenf benannte Schluessel (src/render-api.js, iel-geheimnisse-render.mjs).
//
// RENDER_API_KEY ist Werkzeug-, nicht Dienst-Konfiguration: gelesen ueber den eigenen Namespace
// config.werkzeug (EIN Leser mit push-elevenlabs.mjs; process.env ausserhalb von src/config.js ist per
// Lint gesperrt, G35). Die Inbound-Geheimnisse der lokalen Konfiguration liest dieses Werkzeug nie.
//
// Aufruf OHNE Env-Praefix (Allow-Regel Bash(node scripts/iel-*)):
//   node scripts/iel-geheimnisse.mjs setzen --nummer=+49... [--ausfuehren]
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "../src/config.js";
import { EXIT, LOG_PREFIX, makeAusgabeWaechter } from "./iel-geheimnisse-ausgabe.mjs";
import { laufeBelegInit, laufeStimmenBeleg } from "./iel-geheimnisse-belege.mjs";
import { RICHTUNGEN, laufeConversationBeleg } from "./iel-geheimnisse-conversation.mjs";
import { laufeAllowlistUebernehmen, laufeSchalter } from "./iel-geheimnisse-schalter.mjs";
import { laufeSetzen } from "./iel-geheimnisse-setzen.mjs";

const UNTERBEFEHL = Object.freeze({
  SETZEN: "setzen",
  BELEG_INIT: "beleg-init",
  ALLOWLIST: "allowlist-uebernehmen",
  SCHALTER: "schalter",
  STIMMEN: "stimmen-beleg",
  CONVERSATION: "conversation-beleg",
});
const SCHALTER_ARG = Object.freeze({
  AUSFUEHREN: "--ausfuehren",
  AN: "--an",
  AUS: "--aus",
  NUMMER: "--nummer=",
  RICHTUNG: "--richtung=",
  SEIT: "--seit=",
});
const WERT_SCHALTER = Object.freeze([SCHALTER_ARG.NUMMER, SCHALTER_ARG.RICHTUNG, SCHALTER_ARG.SEIT]);
const SCHLUESSEL = Object.freeze({ RENDER: "RENDER_API_KEY", EL: "ELEVENLABS_API_KEY", AGENT: "ELEVENLABS_AGENT_ID" });
const CLI_ARGS_OFFSET = 2;
const WERT_TRENNER = "=";
const LISTEN_TRENNER = ", ";

// EINE Tabelle je Unterbefehl (statt paralleler switch-Ketten, G23): erlaubte Schalter, benoetigte
// Schluessel, Widerspruchs-Pruefung, Lauf.
const BEFEHLE = Object.freeze({
  [UNTERBEFEHL.SETZEN]: {
    erlaubt: [SCHALTER_ARG.AUSFUEHREN, SCHALTER_ARG.NUMMER],
    schluessel: () => [SCHLUESSEL.RENDER, SCHLUESSEL.EL],
    widerspruch: (argumente) => (argumente.nummern.length === 0 ? `setzen verlangt mindestens ein ${SCHALTER_ARG.NUMMER}<E.164>` : null),
    laufe: laufeSetzen,
  },
  [UNTERBEFEHL.BELEG_INIT]: {
    erlaubt: [],
    schluessel: () => [SCHLUESSEL.RENDER],
    widerspruch: () => null,
    laufe: laufeBelegInit,
  },
  [UNTERBEFEHL.ALLOWLIST]: {
    erlaubt: [SCHALTER_ARG.AUSFUEHREN],
    schluessel: () => [SCHLUESSEL.RENDER],
    widerspruch: () => null,
    laufe: laufeAllowlistUebernehmen,
  },
  [UNTERBEFEHL.SCHALTER]: {
    erlaubt: [SCHALTER_ARG.AN, SCHALTER_ARG.AUS, SCHALTER_ARG.AUSFUEHREN],
    // --aus braucht nur Render: der Rueckweg haengt an nichts sonst.
    schluessel: (argumente) => (argumente.an ? [SCHLUESSEL.RENDER, SCHLUESSEL.EL, SCHLUESSEL.AGENT] : [SCHLUESSEL.RENDER]),
    widerspruch: (argumente) => (argumente.an === argumente.aus ? `schalter verlangt genau eins: ${SCHALTER_ARG.AN} oder ${SCHALTER_ARG.AUS}` : null),
    laufe: laufeSchalter,
  },
  [UNTERBEFEHL.STIMMEN]: {
    erlaubt: [],
    schluessel: () => [SCHLUESSEL.RENDER, SCHLUESSEL.EL, SCHLUESSEL.AGENT],
    widerspruch: () => null,
    laufe: laufeStimmenBeleg,
  },
  [UNTERBEFEHL.CONVERSATION]: {
    erlaubt: [SCHALTER_ARG.RICHTUNG, SCHALTER_ARG.SEIT, SCHALTER_ARG.NUMMER],
    schluessel: () => [SCHLUESSEL.EL, SCHLUESSEL.AGENT],
    widerspruch: conversationWiderspruch,
    laufe: laufeConversationBeleg,
  },
});

// ---- Argumente (rein) ------------------------------------------------------------------------

function conversationWiderspruch(argumente) {
  if (!RICHTUNGEN.includes(argumente.richtung)) return `conversation-beleg verlangt genau ein ${SCHALTER_ARG.RICHTUNG}${RICHTUNGEN.join("|")}`;
  if (Number.isNaN(argumente.seitMs)) return `conversation-beleg verlangt genau ein gueltiges ${SCHALTER_ARG.SEIT}<ISO>`;
  if (argumente.nummern.length > 1) return `conversation-beleg nimmt hoechstens ein ${SCHALTER_ARG.NUMMER}<E.164>`;
  return null;
}

function argumentBekannt(erlaubt, arg) {
  return erlaubt.some((schalter) => (WERT_SCHALTER.includes(schalter) ? arg.startsWith(schalter) : arg === schalter));
}

// Nur der Schalter-Name wird gemeldet, nie ein Wert hinter "=".
function schalterName(arg) {
  return arg.split(WERT_TRENNER)[0];
}

function werteVon(args, schalter) {
  return args.filter((arg) => arg.startsWith(schalter)).map((arg) => arg.slice(schalter.length));
}

function einzigerWert(args, schalter) {
  const werte = werteVon(args, schalter);
  return werte.length === 1 ? werte[0] : null;
}

// Rein: {unterbefehl, ausfuehren, an, aus, nummern[], richtung, seitMs} | {fehler}.
export function leseArgumente(argv) {
  const [unterbefehl = "", ...args] = argv;
  const befehl = Object.hasOwn(BEFEHLE, unterbefehl) ? BEFEHLE[unterbefehl] : null;
  if (!befehl) return { fehler: `unbekannter Unterbefehl (bekannt: ${Object.values(UNTERBEFEHL).join(LISTEN_TRENNER)})` };
  const unbekannt = args.filter((arg) => !argumentBekannt(befehl.erlaubt, arg));
  if (unbekannt.length > 0) return { fehler: `unbekannte Argumente fuer ${unterbefehl}: ${unbekannt.map(schalterName).join(LISTEN_TRENNER)}` };
  const doppelt = args.filter((arg, index) => args.indexOf(arg) !== index);
  if (doppelt.length > 0) return { fehler: `doppelte Argumente: ${doppelt.map(schalterName).join(LISTEN_TRENNER)}` };
  const argumente = {
    unterbefehl,
    ausfuehren: args.includes(SCHALTER_ARG.AUSFUEHREN),
    an: args.includes(SCHALTER_ARG.AN),
    aus: args.includes(SCHALTER_ARG.AUS),
    nummern: werteVon(args, SCHALTER_ARG.NUMMER),
    richtung: einzigerWert(args, SCHALTER_ARG.RICHTUNG),
    seitMs: Date.parse(einzigerWert(args, SCHALTER_ARG.SEIT) ?? ""),
  };
  const fehler = befehl.widerspruch(argumente);
  return fehler ? { fehler } : argumente;
}

// Rein: die fuer diesen Lauf fehlenden Schluessel - nur Namen.
export function fehlendeSchluessel({ argumente, abh }) {
  const vorhanden = {
    [SCHLUESSEL.RENDER]: abh.renderApiKey,
    [SCHLUESSEL.EL]: abh.elKonto.apiKey,
    [SCHLUESSEL.AGENT]: abh.elKonto.agentId,
  };
  const befehl = BEFEHLE[argumente.unterbefehl];
  return befehl.schluessel(argumente).filter((name) => !vorhanden[name]);
}

// ---- Verdrahtung und Lauf ------------------------------------------------------------------------

// Die EINZIGE Stelle, die Konfiguration und Prozess-Kanaele verdrahtet (P15).
export function standardAbhaengigkeiten() {
  const { apiKey, apiBase, agentId } = config.voice.elevenLabsOutbound;
  return {
    fetchImpl: fetch,
    zufall: randomBytes,
    stdout: process.stdout,
    stderr: process.stderr,
    renderApiKey: config.werkzeug.renderApiKey,
    elKonto: { apiKey, apiBase, agentId },
    ttsAusgabeformat: config.voice.elevenLabsPlayTts.outputFormat,
  };
}

// Exit ROT, sobald der Waechter eine Zeile verworfen hat - auch wenn der Lauf sonst GRUEN waere.
export async function runCli({ argv, abh }) {
  const waechter = makeAusgabeWaechter({ stdout: abh.stdout, stderr: abh.stderr });
  const code = await laufeBefehl({ argv, abh: { ...abh, waechter } });
  return waechter.verworfen() ? EXIT.ROT : code;
}

async function laufeBefehl({ argv, abh }) {
  const { waechter } = abh;
  const argumente = leseArgumente(argv);
  if (argumente.fehler) {
    waechter.fehler(`Fehler (fail-closed): ${argumente.fehler}`);
    return EXIT.ROT;
  }
  const fehlend = fehlendeSchluessel({ argumente, abh });
  if (fehlend.length > 0) {
    waechter.fehler(`Fehler (fail-closed): ${fehlend.join(LISTEN_TRENNER)} fehlt - nichts gelesen, nichts geschrieben.`);
    return EXIT.ROT;
  }
  try {
    return await BEFEHLE[argumente.unterbefehl].laufe({ argumente, abh });
  } catch (err) {
    waechter.fehler(`Abbruch (fail-closed) - Anbieter-Status ${err?.providerStatus ?? "unbekannt"}; kein Fehlertext ausgegeben.`);
    return EXIT.ROT;
  }
}

const istHauptmodul = fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (istHauptmodul) {
  try {
    process.exitCode = await runCli({ argv: process.argv.slice(CLI_ARGS_OFFSET), abh: standardAbhaengigkeiten() });
  } catch (err) {
    process.stderr.write(`${LOG_PREFIX} Abbruch (fail-closed) - Status ${err?.providerStatus ?? "unbekannt"}; kein Fehlertext ausgegeben.\n`);
    process.exitCode = EXIT.ROT;
  }
}
