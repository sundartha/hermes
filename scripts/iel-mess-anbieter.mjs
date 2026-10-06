import { config } from "../src/config.js";
import { registrierungsKoerper } from "../src/elevenlabs/nummern-registrierung.js";

const TEXML_APP_ID = "3048315229369796444";
const CC_APP_ID = "3048315366347376485";
const ANRUFER_SUBDOMAIN = "hermesie15c3d4cd0.sip.telnyx.com";

export const ANBIETER_ZEITLIMIT_S = 60;
const ANRUFER_KLINGEL_S = 15;

const FETCH_TIMEOUT_MS = 5000;
const FORM_TYP = "application/x-www-form-urlencoded";
const JSON_TYP = "application/json";
const NUMMER_SICHTBARE_ZIFFERN = 4;
const NUMMER_MUSTER = /(?<!\w)\+?\d{7,15}(?!\w)/g;
const TROCKEN_ZEILE_MAX_ZEICHEN = 1200;
const TROCKEN_ZEIT_SPALTE = 3;
const TELNYX_SEITENGROESSE = 50;

export function maskiereNummern(text) {
  return String(text).replace(NUMMER_MUSTER, (nummer) => `…${nummer.slice(-NUMMER_SICHTBARE_ZIFFERN)}`);
}

function escapeXml(wert) {
  const ersatz = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
  return String(wert).replace(/[&<>"']/g, (zeichen) => ersatz[zeichen]);
}

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

export const texmlAnrufeAnfrage = (absender) => ({
  anbieter: "telnyx",
  methode: "GET",
  pfad: `/v2/texml/Accounts/${config.telephony.telnyxAccountSid}/Calls?From=${encodeURIComponent(absender)}&PageSize=${TELNYX_SEITENGROESSE}`,
});

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

export const elSttAnfrage = ({ modell, audio, dateiname }) => ({
  anbieter: "eleven", methode: "POST", pfad: "/v1/speech-to-text", multipart: { felder: { model_id: modell }, datei: audio, dateiname },
});

export const elSipNachrichtenAnfrage = (id) => ({ anbieter: "eleven", methode: "GET", pfad: `/v1/convai/conversations/${id}/sip-messages` });

export function wegwerfKoerper({ el_nummer: nummer, label, anrufer_kennung: anrufer }) {
  return { phone_number: nummer, label, provider: "sip_trunk", inbound_trunk_config: { allowed_numbers: [anrufer], media_encryption: "disabled" } };
}

export function wegwerfKoerperAmAgenten({ setup, agentId }) {
  return { ...wegwerfKoerper(setup), agent_id: agentId };
}

export function wegwerfKoerperNurAusgehend({ setup, agentId, zugang }) {
  return {
    ...registrierungsKoerper({ e164: setup.el_nummer, numberId: setup.label, agentId, sipUser: zugang.username, sipPasswort: zugang.password }),
    label: setup.label,
  };
}

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

const PLATZHALTER = Object.freeze({
  sid: "<call_sid>",
  ccId: "<call_control_id>",
  leg: "<call_leg_id>",
  session: "<call_session_id>",
  gespraech: "<conversation_id>",
  agent: "<agent_id>",
});

const MUSTER_AUFNAHME_START = "2026-01-01T00:00:00.000Z";

const MUSTER_BEIN = { call_control_id: PLATZHALTER.ccId, call_leg_id: PLATZHALTER.leg, call_session_id: PLATZHALTER.session };

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
