#!/usr/bin/env node
// OUTBOUND-E4 (F4, PLAN-OUTBOUND-RESILIENZ.md E-6): der EXTERNE Weg des Drift-Waechters -
// dieselbe Pruefung wie der In-Prozess-Waechter (outbound-drift-watch.js), aber ohne Store
// (der GitHub-Actions-Runner hat wegen der Prod-DB-IP-Allowlist keinen DB-Zugang).
//
// WARUM ES DAS GIBT: der 27.08.2026-Ausfall (die Plattform-Absendernummer gehoerte dem
// Telnyx-Konto nicht mehr) lief DREI TAGE unbemerkt, weil niemand ausser einem zufaelligen
// Anruf je nachsah. Dieses Kommando prueft, OHNE dass ein Anruf stattfindet.
//
// NUR-LESEND: der Import-Graph traegt das - dieses Skript haengt ausschliesslich an
// telnyxConfigRead (config-read.js, sechs GETs) und fetchPhoneNumber (convai.js, ein GET),
// keines davon kann schreiben.
//
// FAIL-CLOSED, weil ein gruenes Pruefkommando, das nichts geprueft hat, wie ein bestandenes
// aussieht (Muster check-elevenlabs-drift.mjs): ohne TELNYX_API_KEY endet der Lauf mit
// einer Meldung und Exit 1 - nie mit stillem OK. Ein nicht ausgenommener Befund JEDER
// Klasse blockiert, EINSCHLIESSLICH unknown - der CLI-Weg ist strenger als der In-Prozess-
// Waechter (der unknown nur als NOTIZ meldet), weil hier kein zweiter Kanal existiert, der
// das sonst auffinge.
//
// Aufruf: npm run outbound:drift
import { config } from "../src/config.js";
import { telnyxConfigRead } from "../src/telephony/adapters/telnyx/config-read.js";
import { fetchPhoneNumber } from "../src/elevenlabs/convai.js";
import { messeAnbieterWirklichkeit } from "../src/telephony/outbound-config-probe.js";
import { beurteileDrift, istBlockierend, DRIFT_BEFUND } from "../src/telephony/outbound-config-drift.js";
import { bedienteLaenderAus } from "../src/telephony/outbound-drift-watch.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOG_PREFIX = "[check-outbound-drift]";
const AUSNAHMEN_PFAD = new URL("../outbound-drift-ausnahmen.json", import.meta.url);

// Fail-closed VOR jedem Netzzugriff: ungelesen wird nichts als gruen gemeldet (Muster
// check-elevenlabs-drift.mjs#schluesselFehlt). Nur der Telnyx-Schluessel ist Pflicht - ein
// fehlender ElevenLabs-Schluessel/leere Telnyx-IDs fuehren zu gezaehlten unbekannt-Befunden
// (PM-16), nicht zu einem Abbruch VOR dem Lauf.
function schluesselFehlt() {
  if (!config.telephony.telnyxApiKey) return "TELNYX_API_KEY fehlt.";
  return null;
}

// Deklarierte Ausnahmen (Muster eslint-legacy-exceptions.json): Grund UND Datum sind
// Pflicht (der Kern selbst prueft das nochmal, s. ausnahmeFehler) - eine fehlende Datei
// gilt als "keine Ausnahmen", kein Fehler (ein frischer Checkout ohne die Datei soll nicht
// scheitern, er hat dann nur mehr blockierende Befunde).
function ladeAusnahmen() {
  try {
    const roh = readFileSync(AUSNAHMEN_PFAD, "utf8");
    return JSON.parse(roh);
  } catch {
    return [];
  }
}

// Der CLI-Weg hat KEINEN Store: Pruefung 8 (24h-Verbrauch) und Pruefung 9 (Alarm-Absender-
// Bindung) sind dadurch strukturell unbeantwortbar - beide werden ueber
// outbound-drift-ausnahmen.json bewusst ausgenommen (D-5). letzteErfolgreicheMessungMs
// bleibt undefined: der CLI-Weg triggert NIE watchdog_stale - das ist der In-Prozess-
// Waechter-Job.
function sollAusConfig() {
  return {
    elAgentId: config.voice.elevenLabsOutbound.agentId,
    elPhoneNumberId: config.voice.elevenLabsOutbound.agentPhoneNumberId,
    platformAniE164: config.provisioning.platformAniE164,
    fqdnConnectionId: config.telephony.telnyxFqdnConnectionId,
    ovpId: config.telephony.telnyxOutboundVoiceProfileId,
    bedienteLaender: bedienteLaenderAus(config.safety.allowedCountryCodes),
    alertSenderE164: "",
    verbrauch24hMicroCents: undefined,
    letzteErfolgreicheMessungMs: undefined,
  };
}

function schwellenAusConfig() {
  return { staleMs: config.billing.outboundDriftStaleMs, balanceMinHours: config.billing.outboundDriftBalanceMinHours };
}

// Betriebs-Positiv-Kontrolle (Lehre pruefkommando-ohne-positiv-kontrolle): ein gruener
// Lauf, der nichts gemessen hat, muss von einem, der alles gemessen hat, unterscheidbar
// bleiben.
function umfangsZeile({ gemessen, soll: sollAnzahl }) {
  return `${gemessen} von ${sollAnzahl} Pruefungen gefahren`;
}

// D7-Anker (woertlich verlangt): erscheint GENAU dann, wenn kein OWNERSHIP_LOST-Befund
// vorliegt (ausgenommen oder nicht - die Aussage ist "Pruefung 3 war fahrbar und meldet
// keinen Verlust").
function pruefung3Zeile(befunde) {
  const hat = befunde.some((befund) => befund.code === DRIFT_BEFUND.OWNERSHIP_LOST);
  return hat ? "" : "pruefung3 ownership=ok";
}

function ausnahmeZusatz(befunde) {
  const ausgenommen = befunde.filter((befund) => befund.ausgenommen).map((befund) => befund.code);
  if (ausgenommen.length === 0) return "";
  return ` (ausgenommen: ${ausgenommen.join(", ")})`;
}

function melde({ befunde, fehler, gemessen, soll: sollAnzahl }) {
  for (const zeile of fehler) console.error(`${LOG_PREFIX} FEHLER: ${zeile}`);
  for (const befund of befunde)
    console[befund.ausgenommen ? "log" : "error"](
      `${LOG_PREFIX} ${befund.ausgenommen ? "(ausgenommen) " : ""}klasse=${befund.klasse} befund=${befund.code} ${befund.detail}`,
    );
  const umfang = umfangsZeile({ gemessen, soll: sollAnzahl });
  if (!istBlockierend({ befunde, fehler })) {
    const p3 = pruefung3Zeile(befunde);
    console.log(`${LOG_PREFIX} OK - ${umfang}${p3 ? ", " + p3 : ""}${ausnahmeZusatz(befunde)}.`);
    return 0;
  }
  console.error(
    `${LOG_PREFIX} ROT - ${befunde.filter((befund) => !befund.ausgenommen).length} nicht ausgenommene Befunde, ` +
      `${fehler.length} Fehler in der Ausnahme-Erklaerung | ${umfang}. Kein Anruf wurde ausgeloest; ` +
      "dieses Kommando liest ausschliesslich (npm run outbound:drift ist NIE ein Schreibzugriff).",
  );
  return 1;
}

async function runCli() {
  const grund = schluesselFehlt();
  if (grund) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): ${grund} Ungelesen wird nichts als gruen gemeldet.`);
    return 1;
  }
  const elRead = {
    fetchPhoneNumber: (phoneNumberId) =>
      fetchPhoneNumber({ fetchImpl: fetch, account: config.voice.elevenLabsOutbound, phoneNumberId }),
  };
  const soll = sollAusConfig();
  const messung = await messeAnbieterWirklichkeit({ telnyxRead: telnyxConfigRead, elRead, soll });
  const ergebnis = beurteileDrift({
    messung,
    soll,
    ausnahmen: ladeAusnahmen(),
    schwellen: schwellenAusConfig(),
    nowMs: Date.now(),
  });
  return melde(ergebnis);
}

const istHauptmodul = fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (istHauptmodul) {
  try {
    process.exit(await runCli());
  } catch (err) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): ${err.message}`);
    process.exit(1);
  }
}
