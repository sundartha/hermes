// WEGWERF-SKRIPT (Spike 2). Richtet die SIP-Strecke Telnyx <-> ElevenLabs ein und
// baut sie wieder ab. Gehoert NICHT zum Produktivpfad und wird nach dem Spike geloescht.
//
// Sicherheitsregeln, die dieses Skript einhaelt:
//   - Kein Kauf. Keine Nummer wird bestellt oder freigegeben.
//   - Es fasst AUSSCHLIESSLICH die in DID_SPIKE genannte Nummer an und verweigert
//     den Dienst fuer jede andere, insbesondere fuer die live genutzte DID_LIVE.
//   - SIP-Zugangsdaten werden im Speicher erzeugt und NIE ausgegeben oder gespeichert.
//   - API-Schluessel erscheinen in keiner Ausgabe.
//
// Unterbefehle: setup | move | restore | status | teardown
//
// Schluessel und Basis-URLs kommen aus src/config.js (G35, Muster spike1-lab.mjs):
// dieselben .env-Werte wie vorher, nur nicht mehr von Hand aus der Datei geparst.

import { randomBytes } from "node:crypto";

import { config } from "../src/config.js";

const { apiKey: elevenApiKey, apiBase: elevenApiBase } = config.voice.elevenLabsOutbound;
const { telnyxApiKey, telnyxApiBase } = config.telephony;

// --- Feste Groessen des Spikes -------------------------------------------------
const DID_SPIKE = "+15739090177"; // seit 2026-07-29 ohne Verkehr, im Repo als stillgelegt gefuehrt
const DID_SPIKE_ID = "3011078889721038032";
const CONNECTION_HERMES = "2982643896460248193"; // TeXML-App "Hermes" = Vorher-Zustand
const VOICE_PROFILE_MCP = "2982782444253480209"; // whitelisted_destinations enthaelt DE
const ELEVENLABS_FQDN = "sip.rtc.elevenlabs.io";
const TELNYX_HOST = "sip.telnyx.com"; // OHNE "sip:" davor - haeufigste Fehlerquelle
const AGENT_ID = "agent_5301kwkh9vv3ezesf100pggfj9rs";
const VERBOTEN = ["+17067101188", "+18643028341", "+15804504874"];

// Der Name ist die EINZIGE Kennung, an der move/teardown die Spike-Verbindung
// wiederfinden - er muss in allen drei Unterbefehlen derselbe sein.
const VERBINDUNGS_NAME = "ElevenLabs Spike2";

const FQDN_VERBINDUNGEN_PFAD = "/v2/fqdn_connections";
const FQDN_PFAD = "/v2/fqdns";
const TELNYX_NUMMERN_PFAD = "/v2/phone_numbers";
const ELEVEN_NUMMERN_PFAD = "/v1/convai/phone-numbers";

// Standard-SIP-Port; Telnyx erwartet ihn ausgeschrieben im FQDN-Eintrag.
const SIP_PORT = 5060;
// Auszugslaenge der Konsolen-Ausgabe: genug fuer die entscheidenden Felder einer
// Antwort, kurz genug, dass eine Trefferliste das Terminal nicht flutet.
const AUSGABE_MAX_ZEICHEN = 1200;
// Laenge der im Speicher erzeugten SIP-Zugangsdaten. Der Benutzername muss nur
// eindeutig sein, das Geheimnis traegt die Sicherheit - daher deutlich laenger.
const BENUTZER_ZUFALL_BYTES = 4;
const GEHEIMNIS_ZUFALL_BYTES = 18;

if (!telnyxApiKey || !elevenApiKey) {
  console.error("FEHLT: TELNYX_API_KEY oder ELEVENLABS_API_KEY");
  process.exit(1);
}

async function telnyx(methode, pfad, koerper) {
  const antwort = await fetch(`${telnyxApiBase}${pfad}`, {
    method: methode,
    headers: {
      Authorization: `Bearer ${telnyxApiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: koerper ? JSON.stringify(koerper) : undefined,
  });
  const text = await antwort.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* Rohtext bleibt in text */ }
  return { ok: antwort.ok, status: antwort.status, json, text };
}

async function eleven(methode, pfad, koerper) {
  const antwort = await fetch(`${elevenApiBase}${pfad}`, {
    method: methode,
    headers: { "xi-api-key": elevenApiKey, "Content-Type": "application/json" },
    body: koerper ? JSON.stringify(koerper) : undefined,
  });
  const text = await antwort.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* Rohtext bleibt in text */ }
  return { ok: antwort.ok, status: antwort.status, json, text };
}

// Entfernt Zugangsdaten aus allem, was auf die Konsole geht.
function ohneGeheimnis(wert) {
  const text = typeof wert === "string" ? wert : JSON.stringify(wert, null, 1);
  return text
    .replace(new RegExp(telnyxApiKey, "g"), "<TELNYX_KEY>")
    .replace(new RegExp(elevenApiKey, "g"), "<ELEVENLABS_KEY>")
    .replace(/("(?:password|user_name|username)"\s*:\s*)"[^"]*"/g, '$1"<verdeckt>"');
}

function zeig(titel, antwort) {
  console.log(`--- ${titel}: HTTP ${antwort.status}`);
  console.log(ohneGeheimnis(antwort.json ?? antwort.text).slice(0, AUSGABE_MAX_ZEICHEN));
}

function schuetzeLiveNummern() {
  if (VERBOTEN.includes(DID_SPIKE)) {
    console.error("ABBRUCH: DID_SPIKE steht auf der Verbotsliste.");
    process.exit(1);
  }
}

// --- Unterbefehle --------------------------------------------------------------

async function status() {
  zeig(`Nummer ${DID_SPIKE}`, await telnyx("GET", `${TELNYX_NUMMERN_PFAD}/${DID_SPIKE_ID}`));
  zeig("FQDN-Verbindungen", await telnyx("GET", FQDN_VERBINDUNGEN_PFAD));
  zeig("FQDN-Eintraege", await telnyx("GET", FQDN_PFAD));
  zeig("ElevenLabs-Nummern", await eleven("GET", ELEVEN_NUMMERN_PFAD));
}

async function setup() {
  schuetzeLiveNummern();
  // Zugangsdaten leben NUR in diesem Prozess. Beide Seiten bekommen sie im selben Lauf.
  const benutzer = `hermes${randomBytes(BENUTZER_ZUFALL_BYTES).toString("hex")}`;
  const geheim = randomBytes(GEHEIMNIS_ZUFALL_BYTES).toString("base64url");

  const verbindung = await telnyx("POST", FQDN_VERBINDUNGEN_PFAD, {
    connection_name: VERBINDUNGS_NAME,
    active: true,
    transport_protocol: "TCP",
    dtmf_type: "RFC 2833",
    encode_contact_header_enabled: true,
    user_name: benutzer,
    password: geheim,
    inbound: {
      dnis_number_format: "+e164",
      ani_number_format: "+E.164",
      codecs: ["G711U"],
      sip_region: "US",
    },
    outbound: {
      outbound_voice_profile_id: VOICE_PROFILE_MCP,
      ani_override_type: "always",
      ani_override: DID_SPIKE,
    },
  });
  zeig("FQDN-Verbindung anlegen", verbindung);
  if (!verbindung.ok) return;
  const verbindungsId = verbindung.json.data.id;

  const fqdn = await telnyx("POST", FQDN_PFAD, {
    connection_id: verbindungsId,
    fqdn: ELEVENLABS_FQDN,
    port: SIP_PORT,
    dns_record_type: "a",
  });
  zeig("FQDN-Eintrag anlegen", fqdn);

  const nummer = await eleven("POST", ELEVEN_NUMMERN_PFAD, {
    phone_number: DID_SPIKE,
    label: "Spike2 Telnyx",
    provider: "sip_trunk",
    agent_id: AGENT_ID,
    inbound_trunk_config: {
      allowed_numbers: [DID_SPIKE],
      media_encryption: "disabled",
    },
    outbound_trunk_config: {
      address: TELNYX_HOST, // Hostname OHNE "sip:"
      transport: "tcp",
      media_encryption: "disabled",
      credentials: { username: benutzer, password: geheim },
      enabled_codecs: ["PCMU/8000"], // u-law, weil US-DID
    },
  });
  zeig("ElevenLabs-Nummer importieren", nummer);

  console.log(`\nVERBINDUNGS-ID (nicht geheim): ${verbindungsId}`);
  console.log("Zugangsdaten wurden erzeugt und NICHT gespeichert.");
}

async function move() {
  schuetzeLiveNummern();
  const verbindungen = await telnyx("GET", FQDN_VERBINDUNGEN_PFAD);
  const ziel = verbindungen.json?.data?.find(
    (verbindung) => verbindung.connection_name === VERBINDUNGS_NAME,
  );
  if (!ziel) { console.error(`ABBRUCH: FQDN-Verbindung '${VERBINDUNGS_NAME}' fehlt.`); return; }
  zeig(
    `Nummer ${DID_SPIKE} -> Verbindung ${ziel.id}`,
    await telnyx("PATCH", `${TELNYX_NUMMERN_PFAD}/${DID_SPIKE_ID}`, { connection_id: ziel.id })
  );
}

// DER RUECKWEG. Haengt die umgeleitete Nummer zurueck an die TeXML-App "Hermes";
// alles andere darf danach fehlschlagen, ohne dass die Nummer tot bleibt.
async function restore() {
  zeig(
    `RUECKGAENGIG: ${DID_SPIKE} -> TeXML-App Hermes`,
    await telnyx("PATCH", `${TELNYX_NUMMERN_PFAD}/${DID_SPIKE_ID}`, {
      connection_id: CONNECTION_HERMES,
    })
  );
}

async function elevenLabsNummerEntfernen() {
  const nummern = await eleven("GET", ELEVEN_NUMMERN_PFAD);
  for (const eintrag of nummern.json ?? []) {
    if (eintrag.phone_number !== DID_SPIKE) continue;
    zeig(
      "ElevenLabs-Nummer entfernen",
      await eleven("DELETE", `${ELEVEN_NUMMERN_PFAD}/${eintrag.phone_number_id}`),
    );
  }
}

async function fqdnEintraegeEntfernen(verbindungsId) {
  const eintraege = await telnyx("GET", FQDN_PFAD);
  for (const eintrag of eintraege.json?.data ?? []) {
    if (eintrag.connection_id !== verbindungsId) continue;
    zeig("FQDN-Eintrag entfernen", await telnyx("DELETE", `${FQDN_PFAD}/${eintrag.id}`));
  }
}

async function spikeVerbindungenEntfernen() {
  const verbindungen = await telnyx("GET", FQDN_VERBINDUNGEN_PFAD);
  for (const verbindung of verbindungen.json?.data ?? []) {
    if (verbindung.connection_name !== VERBINDUNGS_NAME) continue;
    await fqdnEintraegeEntfernen(verbindung.id);
    zeig(
      "FQDN-Verbindung entfernen",
      await telnyx("DELETE", `${FQDN_VERBINDUNGEN_PFAD}/${verbindung.id}`),
    );
  }
}

// Vollstaendiger Abbau in genau dieser Reihenfolge: erst die Nummer zurueckhaengen
// (restore), dann den ElevenLabs-Import loesen, zuletzt FQDN-Eintraege und Verbindung.
async function teardown() {
  await restore();
  await elevenLabsNummerEntfernen();
  await spikeVerbindungenEntfernen();
}

const befehle = { setup, move, restore, status, teardown };
const befehl = process.argv[2];
if (!befehle[befehl]) {
  console.error(`Unterbefehl fehlt. Erlaubt: ${Object.keys(befehle).join(" | ")}`);
  process.exit(1);
}
await befehle[befehl]();
