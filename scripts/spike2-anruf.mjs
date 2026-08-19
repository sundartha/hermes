// WEGWERF-SKRIPT (Spike 2). Loest GENAU EINEN ausgehenden Anruf ueber die
// SIP-Strecke ElevenLabs -> Telnyx aus und misst ihn anschliessend am Telnyx-Beleg.
//
//   node scripts/spike2-anruf.mjs anrufen +49...  -> genau ein Anruf an genau diese Nummer
//   node scripts/spike2-anruf.mjs messen          -> CDR + ElevenLabs-Gespraech auslesen
//
// Die Zielrufnummer wird in Ausgaben und in der Messdatei maskiert.
// Schluessel und Basis-URLs kommen aus src/config.js (G35, Muster spike1-lab.mjs):
// dieselben .env-Werte wie vorher, nur nicht mehr von Hand aus der Datei geparst.

import { config } from "../src/config.js";

const { apiKey: elevenApiKey, apiBase: elevenApiBase } = config.voice.elevenLabsOutbound;
const { telnyxApiKey, telnyxApiBase } = config.telephony;

const AGENT_ID = "agent_5301kwkh9vv3ezesf100pggfj9rs";
const DID_SPIKE = "+15739090177";
// Das Ziel steht bewusst NICHT hier: es kommt woertlich aus dem Aufruf und wird
// nie abgeleitet, geraten oder umgeformt (D16, .fortschritt.md).

const ELEVEN_NUMMERN_PFAD = "/v1/convai/phone-numbers";
const ELEVEN_ANRUF_PFAD = "/v1/convai/sip-trunk/outbound-call";
const ELEVEN_GESPRAECHE_PFAD = "/v1/convai/conversations";
const TELNYX_BELEGE_PFAD = "/v2/detail_records";

// Seitengroessen der beiden Mess-Abfragen: der gesuchte Vorgang steht ganz vorn,
// der Rest der Seite dient nur als Umfeld.
const BELEG_SEITENGROESSE = 15;
const GESPRAECH_SEITENGROESSE = 5;
// Einrueckung der ausgegebenen JSON-Bloecke - eine Stufe reicht fuer die Sichtkontrolle.
const JSON_EINRUECKUNG = 1;

// E.164 woertlich: fuehrendes +, danach nur Ziffern, erste Ziffer nicht 0,
// insgesamt 7 bis 15 Ziffern. Leerzeichen und Trennzeichen gelten als Abweichung
// und werden abgelehnt - dieses Skript repariert keine Eingabe.
const E164_MUSTER = /^\+[1-9]\d{6,14}$/;

// Laesst die Landes- und Vorwahl stehen und deckt den Teilnehmerteil ab.
const maskiere = (nummer) =>
  typeof nummer === "string" ? nummer.replace(/(\+\d{6})\d+/, "$1XXXX") : nummer;

// Liest das Ziel aus dem Aufruf. Bricht ab, bevor irgendein Netzaufruf passiert.
function zielAusAufruf() {
  const ziel = process.argv[3];
  if (!ziel) {
    console.error("ABBRUCH: Zielrufnummer fehlt.");
    console.error("Aufruf: node scripts/spike2-anruf.mjs anrufen +<Land><Nummer>");
    process.exit(1);
  }
  if (!E164_MUSTER.test(ziel)) {
    // Das abgelehnte Argument wird nicht ausgegeben - es koennte eine ungemaskierte
    // Rufnummer sein, und maskiere() greift nur bei E.164-Form.
    console.error("ABBRUCH: Zielrufnummer ist kein E.164.");
    console.error("Erwartet: fuehrendes +, danach 7 bis 15 Ziffern, sonst nichts.");
    process.exit(1);
  }
  return ziel;
}

async function eleven(methode, pfad, koerper) {
  const antwort = await fetch(`${elevenApiBase}${pfad}`, {
    method: methode,
    headers: { "xi-api-key": elevenApiKey, "Content-Type": "application/json" },
    body: koerper ? JSON.stringify(koerper) : undefined,
  });
  const text = await antwort.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* Rohtext bleibt */ }
  return { status: antwort.status, json, text };
}

async function telnyx(pfad) {
  const antwort = await fetch(`${telnyxApiBase}${pfad}`, {
    headers: { Authorization: `Bearer ${telnyxApiKey}`, Accept: "application/json" },
  });
  const text = await antwort.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* Rohtext bleibt */ }
  return { status: antwort.status, json, text };
}

async function anrufen() {
  const ziel = zielAusAufruf();

  const nummern = await eleven("GET", ELEVEN_NUMMERN_PFAD);
  const eintrag = (nummern.json ?? []).find((kandidat) => kandidat.phone_number === DID_SPIKE);
  if (!eintrag) { console.error("ABBRUCH: Nummer ist bei ElevenLabs nicht importiert."); return; }

  // Die Erstnachricht des Live-Agenten ist der Offenlegungssatz und traegt {{owner_name}}.
  // Ohne diese Variable beendet ElevenLabs das Gespraech sofort (Code 1008).
  const gestartet = await eleven("POST", ELEVEN_ANRUF_PFAD, {
    agent_id: AGENT_ID,
    agent_phone_number_id: eintrag.phone_number_id,
    to_number: ziel,
    conversation_initiation_client_data: {
      dynamic_variables: { owner_name: "Antonio" },
    },
  });
  console.log(`--- Anruf ausgeloest: HTTP ${gestartet.status}`);
  console.log(
    JSON.stringify(gestartet.json ?? gestartet.text, null, JSON_EINRUECKUNG)
      .replaceAll(ziel, maskiere(ziel)),
  );
}

// Die Felder, die der Spike am Telnyx-Beleg auswertet: Zeitachse, Strecke,
// Zustandekommen, Dauer, Sprachqualitaet, Abbruchgrund, Kosten.
function belegZeile(beleg) {
  return {
    started_at: beleg.started_at, answered_at: beleg.answered_at, finished_at: beleg.finished_at,
    cli: maskiere(beleg.cli), cld: maskiere(beleg.cld),
    connection_name: beleg.connection_name, direction: beleg.direction,
    attempted: beleg.attempted, connected: beleg.connected, completed: beleg.completed,
    call_sec: beleg.call_sec, billed_sec: beleg.billed_sec,
    codec: beleg.rtp_use_codec_name, mos: beleg.mos,
    hangup_cause: beleg.hangup_cause, hangup_details: beleg.hangup_details,
    hangup_code: beleg.hangup_code, sip_invite_failure_status: beleg.sip_invite_failure_status,
    telnyx_error_code: beleg.telnyx_error_code, cost: beleg.cost,
  };
}

function gespraechZeile(gespraech) {
  return {
    conversation_id: gespraech.conversation_id, status: gespraech.status,
    start_time_unix_secs: gespraech.start_time_unix_secs,
    call_duration_secs: gespraech.call_duration_secs,
    message_count: gespraech.message_count,
    call_successful: gespraech.call_successful,
    direction: gespraech.direction,
  };
}

async function messen() {
  const belege = await telnyx(
    `${TELNYX_BELEGE_PFAD}?filter[record_type]=sip-trunking&page[size]=${BELEG_SEITENGROESSE}&page[number]=1`,
  );
  console.log("=== Telnyx-Belege, juengste zuerst ===");
  for (const beleg of belege.json?.data ?? []) {
    if (beleg.cli !== DID_SPIKE && beleg.cld !== DID_SPIKE) continue;
    console.log(JSON.stringify(belegZeile(beleg)));
  }

  const gespraeche = await eleven(
    "GET",
    `${ELEVEN_GESPRAECHE_PFAD}?agent_id=${AGENT_ID}&page_size=${GESPRAECH_SEITENGROESSE}`,
  );
  console.log("=== ElevenLabs-Gespraeche, juengste zuerst ===");
  for (const gespraech of gespraeche.json?.conversations ?? []) {
    console.log(JSON.stringify(gespraechZeile(gespraech)));
  }
}

const befehle = { anrufen, messen };
const befehl = process.argv[2];
if (!befehle[befehl]) { console.error("Erlaubt: anrufen | messen"); process.exit(1); }
await befehle[befehl]();
