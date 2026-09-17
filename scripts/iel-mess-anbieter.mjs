// Anbieter-Naht des IEL-Messwerkzeugs (scripts/iel-mess.mjs).
//
// Drei Dinge, sonst nichts:
//   1. Anfrage-Bauer: reine Funktionen, die beschreiben, WAS an Telnyx/ElevenLabs geht.
//   2. Transport: echt (fetch, Schluessel aus src/config.js) oder trocken (protokolliert,
//      sendet nie, liefert Musterantworten, damit derselbe Ablauf durchlaeuft).
//   3. Uhr: echt oder trocken (virtuelle Zeit, kein Warten).
// Schluessel stehen nur im Kopf der echten Anfrage und erscheinen in keiner Ausgabe.

import { config } from "../src/config.js";
import { registrierungsKoerper } from "../src/elevenlabs/nummern-registrierung.js";

// --- Wegwerf-Objekte (Kickoff 3.8), ohne Nummer und ohne Produktionsverkehr ----------
const TEXML_APP_ID = "3048315229369796444";
const CC_APP_ID = "3048315366347376485";
const ANRUFER_SUBDOMAIN = "hermesie15c3d4cd0.sip.telnyx.com";

// --- Harte Zeitgrenzen am Anbieter (die Owner-Grenze ist 60 s je Anruf) --------------
// TeXML <Dial timeLimit> hat die Anbieter-Untergrenze 60 s; Call-Control time_limit_secs
// liegt darunter frei. Beide stehen auf der Owner-Obergrenze, nie darueber.
export const ANBIETER_ZEITLIMIT_S = 60;
// Wie lange das Anrufer-Bein (Wegwerf-Call-Control-App) klingeln darf, bevor Telnyx aufgibt.
const ANRUFER_KLINGEL_S = 15;

const FETCH_TIMEOUT_MS = 5000;
const FORM_TYP = "application/x-www-form-urlencoded";
const JSON_TYP = "application/json";
const NUMMER_SICHTBARE_ZIFFERN = 4;
const NUMMER_MUSTER = /(?<!\w)\+?\d{7,15}(?!\w)/g;
// Lang genug fuer das vollstaendige Inline-TeXML einer Anlage-Anfrage.
const TROCKEN_ZEILE_MAX_ZEICHEN = 1200;
const TROCKEN_ZEIT_SPALTE = 3;
// Telnyx-Seitengroesse fuer Listen (call_events, detail_records): eine Seite reicht fuer
// einen einzelnen Mess-Anruf, detail_records blaettert der Aufrufer selbst.
const TELNYX_SEITENGROESSE = 50;

// --- Ausgabe-Hygiene ------------------------------------------------------------------

// Jede Rufnummer (mit oder ohne +) wird auf ihre letzten vier Ziffern gekuerzt.
export function maskiereNummern(text) {
  return String(text).replace(NUMMER_MUSTER, (nummer) => `…${nummer.slice(-NUMMER_SICHTBARE_ZIFFERN)}`);
}

function escapeXml(wert) {
  const ersatz = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
  return String(wert).replace(/[&<>"']/g, (zeichen) => ersatz[zeichen]);
}

// --- Anfrage-Bauer: Telnyx -------------------------------------------------------------

function sipMitHeadern(sipZiel, header) {
  const query = Object.entries(header)
    .map(([name, wert]) => `${name}=${encodeURIComponent(wert)}`)
    .join("&");
  return query ? `${sipZiel}?${query}` : sipZiel;
}

function mitEndung(header, endung) {
  return Object.fromEntries(Object.entries(header).map(([name, wert]) => [name, `${wert}${endung}`]));
}

function sipVerb({ sipZiel, header, zugang }) {
  const attribute = zugang ? ` username="${escapeXml(zugang.username)}" password="${escapeXml(zugang.password)}"` : "";
  return `<Sip${attribute}>${escapeXml(sipMitHeadern(sipZiel, header))}</Sip>`;
}

// Digest-Fall (M3): zwei Dials in EINEM Anruf - erst MIT Zugangsdaten (Positiv-Kontrolle),
// dann OHNE (wird abgelehnt?). Die Header-Endung -mit/-ohne ordnet die EL-Gespraeche zu.
function dialVerben({ fall, header, geheim }) {
  const dialAttribute = ` callerId="${escapeXml(fall.anrufer_kennung)}" timeout="${fall.dial_timeout_s}" timeLimit="${ANBIETER_ZEITLIMIT_S}"`;
  const dial = (sip) => `<Dial${dialAttribute}>${sip}</Dial>`;
  if (!fall.digest) return dial(sipVerb({ sipZiel: fall.sip_ziel, header }));
  if (!geheim) throw new Error("Digest-Fall ohne Zugangsdaten - TeXML wird nicht gebaut");
  return [
    dial(sipVerb({ sipZiel: fall.sip_ziel, header: mitEndung(header, "-mit"), zugang: geheim })),
    dial(sipVerb({ sipZiel: fall.sip_ziel, header: mitEndung(header, "-ohne") })),
  ].join("");
}

// Die K1-Form: Pflichtsatz, Uebergabe per <Dial><Sip>, danach der Rueckfallsatz. Ohne
// action-Attribut laeuft TeXML nach einem gescheiterten Dial mit dem naechsten Verb weiter.
function texmlDokument({ fall, gemeinsam, header, geheim }) {
  const stimme = ` voice="${escapeXml(gemeinsam.say_stimme.voice)}" language="${escapeXml(gemeinsam.say_stimme.language)}"`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?><Response>',
    `<Say${stimme}>${escapeXml(gemeinsam.pflichtsatz)}</Say>`,
    dialVerben({ fall, header, geheim }),
    `<Say${stimme}>${escapeXml(gemeinsam.rueckfallsatz)}</Say>`,
    "<Hangup/></Response>",
  ].join("");
}

export function texmlAnrufAnfrage({ fall, gemeinsam, header, laufId, geheim }) {
  return {
    anbieter: "telnyx",
    methode: "POST",
    pfad: `/v2/texml/calls/${TEXML_APP_ID}`,
    form: {
      From: fall.anrufer_kennung,
      To: `sip:${laufId}@${ANRUFER_SUBDOMAIN}`,
      Texml: texmlDokument({ fall, gemeinsam, header, geheim }),
      Timeout: String(ANRUFER_KLINGEL_S),
      TimeLimit: String(ANBIETER_ZEITLIMIT_S),
    },
  };
}

function texmlAnrufPfad(callSid) {
  return `/v2/texml/Accounts/${config.telephony.telnyxAccountSid}/Calls/${callSid}`;
}

export const texmlStatusAnfrage = (callSid) => ({ anbieter: "telnyx", methode: "GET", pfad: texmlAnrufPfad(callSid) });

export const texmlBeendenAnfrage = (callSid) => ({
  anbieter: "telnyx", methode: "POST", pfad: texmlAnrufPfad(callSid), form: { Status: "completed" },
});

export const aktiveAnrufeAnfrage = () => ({
  anbieter: "telnyx", methode: "GET", pfad: `/v2/connections/${CC_APP_ID}/active_calls`,
});

// Das eingehende Bein der Call-Control-App aus ihrem call.initiated-Ereignis (Filter
// connection_id + name am 2026-09-14 gegengeprueft: je 1 Treffer fuer call.initiated/call.hangup).
export const anruferEreignisseAnfrage = () => ({
  anbieter: "telnyx",
  methode: "GET",
  pfad: `/v2/call_events?filter%5Bconnection_id%5D=${CC_APP_ID}&filter%5Bname%5D=call.initiated&page%5Bsize%5D=${TELNYX_SEITENGROESSE}`,
});

export const ccAktionAnfrage = (callControlId, aktion, koerper) => ({
  anbieter: "telnyx", methode: "POST", pfad: `/v2/calls/${callControlId}/actions/${aktion}`, json: koerper,
});

export const ccStatusAnfrage = (callControlId) => ({ anbieter: "telnyx", methode: "GET", pfad: `/v2/calls/${callControlId}` });

export function ccWaehlenAnfrage({ fall, header }) {
  return {
    anbieter: "telnyx",
    methode: "POST",
    pfad: "/v2/calls",
    json: {
      connection_id: CC_APP_ID,
      to: fall.sip_ziel,
      from: fall.anrufer_kennung,
      custom_headers: Object.entries(header).map(([name, value]) => ({ name, value })),
      timeout_secs: fall.dial_timeout_s,
      time_limit_secs: ANBIETER_ZEITLIMIT_S,
    },
  };
}

export const aufnahmenAnfrage = (callSessionId) => ({
  anbieter: "telnyx", methode: "GET", pfad: `/v2/recordings?filter%5Bcall_session_id%5D=${encodeURIComponent(callSessionId)}`,
});

export const callEventsAnfrage = (legId) => ({
  anbieter: "telnyx", methode: "GET", pfad: `/v2/call_events?filter%5Bleg_id%5D=${encodeURIComponent(legId)}&page%5Bsize%5D=${TELNYX_SEITENGROESSE}`,
});

export const detailRecordsAnfrage = (recordType, seite) => ({
  anbieter: "telnyx",
  methode: "GET",
  pfad: `/v2/detail_records?filter%5Brecord_type%5D=${encodeURIComponent(recordType)}&page%5Bsize%5D=${TELNYX_SEITENGROESSE}&page%5Bnumber%5D=${seite}`,
});

// IEL-B11 (N2): Telnyx-Doku "calls"/"From" (abgerufen 2026-09-15) belegt Umschlag und Filter;
// parent_call_sid/sip_hangup_cause stehen NICHT im Doku-Schema, sind aber im M1-Messbericht
// als live beobachtete Felder dieses Endpunkts aufgefuehrt (V3).
export const texmlAnrufeAnfrage = (absender) => ({
  anbieter: "telnyx",
  methode: "GET",
  pfad: `/v2/texml/Accounts/${config.telephony.telnyxAccountSid}/Calls?From=${encodeURIComponent(absender)}&PageSize=${TELNYX_SEITENGROESSE}`,
});

// --- Anfrage-Bauer: ElevenLabs ---------------------------------------------------------

const EL_NUMMERN_PFAD = "/v1/convai/phone-numbers";

export const elRegistrierungAnfrage = (id) => ({ anbieter: "eleven", methode: "GET", pfad: `${EL_NUMMERN_PFAD}/${id}` });
export const elRegistrierungPatch = (id, koerper) => ({ anbieter: "eleven", methode: "PATCH", pfad: `${EL_NUMMERN_PFAD}/${id}`, json: koerper });
export const elRegistrierungAnlegen = (koerper) => ({ anbieter: "eleven", methode: "POST", pfad: EL_NUMMERN_PFAD, json: koerper });
export const elRegistrierungLoeschen = (id) => ({ anbieter: "eleven", methode: "DELETE", pfad: `${EL_NUMMERN_PFAD}/${id}` });

export function elGespraecheAnfrage({ nachUnix, agentId, anzahl }) {
  const query = new URLSearchParams({ call_start_after_unix: String(nachUnix), page_size: String(anzahl) });
  if (agentId) query.set("agent_id", agentId);
  return { anbieter: "eleven", methode: "GET", pfad: `/v1/convai/conversations?${query}` };
}

export const elGespraechAnfrage = (id) => ({ anbieter: "eleven", methode: "GET", pfad: `/v1/convai/conversations/${id}` });

// dateiname folgt dem Mitschnitt-Format der Fall-Gruppe (mp3) - ElevenLabs entscheidet am
// Dateinamen, wie es den Upload dekodiert.
export const elSttAnfrage = ({ modell, audio, dateiname }) => ({
  anbieter: "eleven", methode: "POST", pfad: "/v1/speech-to-text", multipart: { felder: { model_id: modell }, datei: audio, dateiname },
});

// IEL-B11 (N2/N1): EL-Doku "sip_messages" - nur ueber ein Gespraech erreichbar (V2).
export const elSipNachrichtenAnfrage = (id) => ({ anbieter: "eleven", methode: "GET", pfad: `/v1/convai/conversations/${id}/sip-messages` });

// --- Wegwerf-Registrierungskoerper (setup) ---------------------------------------------

// Byte-gleich zum bisherigen Inline-Koerper aus legeWegwerfAn (M1, F-F-ohne-agent).
export function wegwerfKoerper({ el_nummer: nummer, label, anrufer_kennung: anrufer }) {
  return { phone_number: nummer, label, provider: "sip_trunk", inbound_trunk_config: { allowed_numbers: [anrufer], media_encryption: "disabled" } };
}

// N1 (Spec E20): dieselbe Wegwerf-Nummer, aber am Agenten zugewiesen - sonst entsteht kein
// Gespraech und keine Messung von M7/M8.
export function wegwerfKoerperAmAgenten({ setup, agentId }) {
  return { ...wegwerfKoerper(setup), agent_id: agentId };
}

// N2: Produktionsform einer Absender-Registrierung (gemessene Trunk-Vorlage, Import statt
// Nachbau), OHNE inbound_trunk_config, mit Wegwerf- statt Produktions-Zugangsdaten; Label
// ueberschrieben (teardown prueft es gegen die Wegwerf-Ablage).
export function wegwerfKoerperNurAusgehend({ setup, agentId, zugang }) {
  return {
    ...registrierungsKoerper({ e164: setup.el_nummer, numberId: setup.label, agentId, sipUser: zugang.username, sipPasswort: zugang.password }),
    label: setup.label,
  };
}

// --- Nur-Lese-Bruecke fuer B9-Helfer (nummern-registrierung.js), IEL-B11 (N2) ------------
// Der B9-Helfer erwartet ein fetch-artiges Signal; diese Bruecke leitet NUR GET durch den
// Transport (Stolperdraht/Trockenlauf bleiben wirksam) und wirft bei jedem anderen Verb.
const METHODE_LESEN = "GET";

export function elLeseFetchUeber(transport) {
  return async (adresse, init = {}) => {
    const methode = init.method ?? METHODE_LESEN;
    if (methode !== METHODE_LESEN) throw new Error("elLeseFetchUeber ist nur lesend");
    const { pathname, search } = new URL(adresse);
    const antwort = await transport.senden({ anbieter: "eleven", methode, pfad: `${pathname}${search}` });
    return { ok: antwort.ok, status: antwort.status, json: async () => antwort.json };
  };
}

// --- Transport: echt -------------------------------------------------------------------

function anbieterZugang(anbieter) {
  if (anbieter === "telnyx") {
    return { basis: config.telephony.telnyxApiBase, kopf: { Authorization: `Bearer ${config.telephony.telnyxApiKey}` } };
  }
  const el = config.voice.elevenLabsOutbound;
  return { basis: el.apiBase, kopf: { "xi-api-key": el.apiKey } };
}

function koerperMitTyp(anfrage) {
  if (anfrage.form) return { body: new URLSearchParams(anfrage.form), typ: FORM_TYP };
  if (anfrage.json) return { body: JSON.stringify(anfrage.json), typ: JSON_TYP };
  if (!anfrage.multipart) return { body: undefined, typ: null };
  const formular = new FormData();
  for (const [name, wert] of Object.entries(anfrage.multipart.felder)) formular.append(name, wert);
  formular.append("file", anfrage.multipart.datei, anfrage.multipart.dateiname);
  return { body: formular, typ: null };
}

async function jsonOderNull(antwort) {
  const text = await antwort.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function echterTransport() {
  return {
    async senden(anfrage) {
      const { basis, kopf } = anbieterZugang(anfrage.anbieter);
      const { body, typ } = koerperMitTyp(anfrage);
      const headers = { ...kopf, Accept: JSON_TYP, ...(typ ? { "Content-Type": typ } : {}) };
      try {
        const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
        const antwort = await fetch(`${basis}${anfrage.pfad}`, { method: anfrage.methode, headers, body, signal });
        return { ok: antwort.ok, status: antwort.status, json: await jsonOderNull(antwort) };
      } catch (fehler) {
        return { ok: false, status: 0, json: null, fehler: fehler.name };
      }
    },
    // Die Download-URL der Aufnahme ist vorsigniert: sie bekommt KEINEN Schluessel mit.
    async holeAudio(url) {
      try {
        const antwort = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        return { ok: antwort.ok, status: antwort.status, audio: antwort.ok ? await antwort.blob() : null };
      } catch (fehler) {
        return { ok: false, status: 0, audio: null, fehler: fehler.name };
      }
    },
  };
}

// --- Transport: trocken ----------------------------------------------------------------

const PLATZHALTER = Object.freeze({
  sid: "<call_sid>",
  ccId: "<call_control_id>",
  leg: "<call_leg_id>",
  session: "<call_session_id>",
  gespraech: "<conversation_id>",
  agent: "<agent_id>",
});

// Feste Musterzeit des Trockenlaufs: der Mitschnitt beginnt zu dieser Sekunde. Keine echte
// Uhr - der Trockenlauf bleibt byte-gleich reproduzierbar.
const MUSTER_AUFNAHME_START = "2026-01-01T00:00:00.000Z";

const MUSTER_BEIN = { call_control_id: PLATZHALTER.ccId, call_leg_id: PLATZHALTER.leg, call_session_id: PLATZHALTER.session };

// Musterantworten je Anfrage-Form. Absichtlich der "schlimmste" Verlauf: der Anruf endet
// nie von selbst, damit der Trockenlauf Wachhund und Nachfassen sichtbar durchlaeuft.
function musterAntwort(anfrage, kontext) {
  const { methode, pfad } = anfrage;
  const regeln = [
    [() => pfad.startsWith("/v2/texml/calls/"), () => ({ data: { sid: PLATZHALTER.sid } })],
    [() => pfad.includes("/Calls?"), () => ({ calls: [{ sid: "<kind_call_sid>", parent_call_sid: PLATZHALTER.sid, to: "<sip_ziel>", sip_hangup_cause: "<sip_hangup_cause>" }] })],
    [() => pfad.endsWith("/active_calls"), () => ({ data: [MUSTER_BEIN] })],
    [() => methode === "POST" && pfad === "/v2/calls", () => ({ data: MUSTER_BEIN })],
    [() => pfad.includes("/Calls/") && methode === "GET", () => ({ status: "in-progress" })],
    [() => pfad.startsWith("/v2/calls/") && methode === "GET", () => ({ data: { is_alive: true } })],
    [() => methode === "GET" && pfad === EL_NUMMERN_PFAD, () => [{ phone_number_id: "<phone_number_id>" }]],
    [() => pfad.startsWith(`${EL_NUMMERN_PFAD}/`) && methode === "GET", () => musterRegistrierung(kontext)],
    [() => methode === "POST" && pfad === EL_NUMMERN_PFAD, () => ({ phone_number_id: "<phone_number_id>" })],
    [() => pfad.endsWith("/sip-messages"), () => ({ sip_messages: [{ direction: "in", raw_message: "INVITE <request_uri> SIP/2.0" }] })],
    [() => pfad.startsWith("/v1/convai/conversations?"), () => ({ conversations: [{ conversation_id: PLATZHALTER.gespraech }] })],
    [() => pfad.startsWith("/v1/convai/conversations/"), () => musterGespraech(kontext)],
    [() => pfad.startsWith("/v2/recordings?"), () => ({ data: [musterAufnahme()] })],
    [() => pfad.startsWith("/v1/speech-to-text"), () => ({ text: "" })],
  ];
  const treffer = regeln.find(([passt]) => passt());
  return treffer ? treffer[1]() : { data: [] };
}

// Musteraufnahme fuer den Trockenlauf: dasselbe Format, das beide Gruppen mitschneiden.
function musterAufnahme() {
  return {
    id: "<recording_id>",
    call_session_id: PLATZHALTER.session,
    recording_started_at: MUSTER_AUFNAHME_START,
    download_urls: { mp3: "<download_url>" },
  };
}

function musterRegistrierung(kontext) {
  return {
    phone_number: kontext.elKennung,
    phone_number_id: "<phone_number_id>",
    label: kontext.label ?? "<label>",
    assigned_agent: { agent_id: kontext.agentId || PLATZHALTER.agent },
    ...(kontext.ohneInbound ? {} : { inbound_trunk: { allowed_numbers: [], media_encryption: "disabled" } }),
    outbound_trunk: { address: "<address>", transport: "<transport>" },
  };
}

function musterGespraech(kontext) {
  return {
    conversation_id: PLATZHALTER.gespraech,
    agent_id: PLATZHALTER.agent,
    status: "<status>",
    metadata: { termination_reason: "<termination_reason>", call_duration_secs: 0, phone_call: { phone_number_id: kontext.registrierungId } },
    transcript: [{ role: "agent", message: "<erste Agent-Nachricht>" }],
    conversation_initiation_client_data: { dynamic_variables: { "<variable>": kontext.laufId } },
  };
}

function trockenZeile(anfrage) {
  const koerper = anfrage.form ?? anfrage.json ?? (anfrage.multipart ? { multipart: Object.keys(anfrage.multipart.felder) } : null);
  const text = `${anfrage.methode} ${anfrage.anbieter} ${anfrage.pfad}${koerper ? ` ${JSON.stringify(koerper)}` : ""}`;
  const accountSid = config.telephony.telnyxAccountSid;
  const ohneKontoKennung = accountSid ? text.replaceAll(accountSid, "<TELNYX_ACCOUNT_SID>") : text;
  return maskiereNummern(ohneKontoKennung).slice(0, TROCKEN_ZEILE_MAX_ZEICHEN);
}

// Aufeinanderfolgende gleiche Anfragen (Status-Abfragen im Takt) werden zusammengefasst.
export function trockenerTransport({ uhr, kontext }) {
  const protokoll = { letzte: null, wiederholungen: 0 };
  const schreibeWiederholungen = () => {
    if (protokoll.wiederholungen > 0) console.log(`           ... dieselbe Anfrage ${protokoll.wiederholungen}x wiederholt`);
    protokoll.wiederholungen = 0;
  };
  return {
    async senden(anfrage) {
      const kennung = `${anfrage.methode} ${anfrage.pfad}`;
      if (kennung === protokoll.letzte) protokoll.wiederholungen += 1;
      else {
        schreibeWiederholungen();
        console.log(`[TROCKEN] t=${uhr.sekunden().toFixed(0).padStart(TROCKEN_ZEIT_SPALTE)} s  ${trockenZeile(anfrage)}`);
      }
      protokoll.letzte = kennung;
      return { ok: true, status: 0, json: musterAntwort(anfrage, kontext) };
    },
    async holeAudio() {
      schreibeWiederholungen();
      console.log(`[TROCKEN] t=${uhr.sekunden().toFixed(0).padStart(TROCKEN_ZEIT_SPALTE)} s  GET <download_url> (vorsigniert, ohne Schluessel)`);
      protokoll.letzte = null;
      return { ok: true, status: 0, audio: new Blob([]) };
    },
  };
}

// --- Uhren -----------------------------------------------------------------------------

const MS_JE_S = 1000;

export function echteUhr() {
  const startMs = Date.now();
  return {
    startMs,
    sekunden: () => (Date.now() - startMs) / MS_JE_S,
    warte: (ms) => new Promise((fertig) => setTimeout(fertig, ms)),
    notaus(handlung, nachS) {
      const timer = setTimeout(handlung, nachS * MS_JE_S);
      return () => clearTimeout(timer);
    },
  };
}

export function trockeneUhr() {
  const stand = { virtuellS: 0 };
  return {
    startMs: Date.now(),
    sekunden: () => stand.virtuellS,
    async warte(ms) {
      stand.virtuellS += ms / MS_JE_S;
    },
    notaus(_handlung, nachS) {
      console.log(`[TROCKEN] Notaus-Timer waere bei t=${nachS} s scharf (unabhaengig vom Ablauf)`);
      return () => {};
    },
  };
}
