// Beleg-Sammlung des IEL-Messwerkzeugs (scripts/iel-mess.mjs): nach dem Anruf, ohne Mensch.
//
// Was hier NIE in ein Ergebnis gelangt: Transkript-Volltext, volle Rufnummern, Werte von
// dynamic variables (nur ihre NAMEN und ob die Probe-Kennung ankam), Schluessel.
// Jede Abfrage traegt ihren HTTP-Status mit - ein falscher Filter liefert bei Telnyx
// 200 mit 0 Treffern und sieht sonst aus wie "nichts passiert".

import {
  aufnahmenAnfrage,
  callEventsAnfrage,
  detailRecordsAnfrage,
  elGespraechAnfrage,
  elGespraecheAnfrage,
  elSipNachrichtenAnfrage,
  elSttAnfrage,
  maskiereNummern,
  texmlAnrufeAnfrage,
} from "./iel-mess-anbieter.mjs";

const MS_JE_S = 1000;
// Puffer vor dem Laufstart fuer den Gespraechsfilter (Uhrenversatz Anbieter <-> lokal).
const EL_ZEITFENSTER_PUFFER_S = 5;
const EL_MAX_GESPRAECHE = 5;
const NACHRICHT_MAX_ZEICHEN = 80;
const ABBRUCHGRUND_MAX_ZEICHEN = 160;
// Die Aufnahme liegt erst nach dem Auflegen bereit; so lange wird hoechstens gewartet.
const AUFNAHME_VERSUCHE = 6;
const AUFNAHME_TAKT_MS = 5000;
const DETAIL_RECORDS_MAX_SEITEN = 3;
// Kuerzere Kennungen koennten zufaellig in fremden Belegen vorkommen.
const KENNUNG_MIN_LAENGE = 8;
const BELEG_FELDER = Object.freeze([
  "record_type", "direction", "status", "connection_id", "started_at", "start_time",
  "finished_at", "end_time", "call_sec", "billed_sec", "cost", "currency",
]);
const ZUORDNUNG = Object.freeze({ PROBE: "probe", REGISTRIERUNG: "registrierung", ZEITFENSTER: "zeitfenster" });

function kuerze(text, maxZeichen) {
  return text == null ? null : maskiereNummern(text).slice(0, maxZeichen);
}

function normalisiere(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// --- ElevenLabs-Gespraeche ------------------------------------------------------------

// Zuordnung von stark nach schwach. Nur "probe" und "registrierung" gelten als unser
// Anruf; ein Treffer nur ueber das Zeitfenster kann fremder Verkehr desselben Agenten sein.
function bestimmeZuordnung(gespraech, { probeVariable, registrierungId }) {
  if (probeVariable) return ZUORDNUNG.PROBE;
  const telefonat = gespraech.metadata?.phone_call ?? {};
  if (registrierungId && telefonat.phone_number_id === registrierungId) return ZUORDNUNG.REGISTRIERUNG;
  return ZUORDNUNG.ZEITFENSTER;
}

function ersteAgentNachricht(transkript) {
  const eintrag = (transkript ?? []).find((zeile) => zeile.role === "agent" && zeile.message);
  return eintrag ? kuerze(eintrag.message, NACHRICHT_MAX_ZEICHEN) : null;
}

// Die Probe-Kennung kann eine Endung tragen (mehrere Dials je Anruf), daher "enthaelt".
function traegtLaufId(wert, laufId) {
  return typeof wert === "string" && wert.includes(laufId);
}

// metadata.phone_call.sip_header_dynamic_variables: Form laut OpenAPI nicht festgelegt (Liste).
// Belegt werden nur Namen/Schluessel und ob die Probe-Kennung darin steckt, nie Werte.
function sipHeaderBeleg(telefonat, laufId) {
  const roh = telefonat.sip_header_dynamic_variables;
  if (roh == null) return null;
  const eintraege = Array.isArray(roh) ? roh : [roh];
  const namen = eintraege.flatMap((eintrag) => (eintrag && typeof eintrag === "object" ? Object.keys(eintrag) : [typeof eintrag]));
  return { anzahl: eintraege.length, schluessel: [...new Set(namen)], probe_enthalten: JSON.stringify(roh).includes(laufId) };
}

// Ermittelt, ob/wie das Gespraech unserem Lauf zugeordnet ist - Vorstufe fuer alle
// abhaengigen Felder (unserAnruf schaltet sip_header_variablen/erste_agent_nachricht/
// variablen_namen frei).
function ermittleZuordnungskontext(gespraech, kontext) {
  const variablen = gespraech.conversation_initiation_client_data?.dynamic_variables ?? {};
  const probeVariable = Object.keys(variablen).find((name) => traegtLaufId(variablen[name], kontext.laufId)) ?? null;
  const zuordnung = bestimmeZuordnung(gespraech, { probeVariable, registrierungId: kontext.registrierung?.id });
  return { variablen, probeVariable, zuordnung, unserAnruf: zuordnung !== ZUORDNUNG.ZEITFENSTER };
}

function baueMetadatenFelder(gespraech) {
  const metadata = gespraech.metadata ?? {};
  return {
    status: gespraech.status ?? null,
    abbruchgrund: kuerze(metadata.termination_reason, ABBRUCHGRUND_MAX_ZEICHEN),
    dauer_s: metadata.call_duration_secs ?? null,
    start_unix: metadata.start_time_unix_secs ?? null,
  };
}

function baueTelefonatFelder(telefonat, unserAnruf, laufId) {
  return {
    telefonat_typ: telefonat.type ?? null,
    telefonat_richtung: telefonat.direction ?? null,
    telefonat_registrierung: telefonat.phone_number_id ?? null,
    telefonat_anrufer: kuerze(telefonat.external_number, ABBRUCHGRUND_MAX_ZEICHEN),
    telefonat_angerufen: kuerze(telefonat.agent_number, ABBRUCHGRUND_MAX_ZEICHEN),
    telefonat_call_id_vorhanden: Boolean(telefonat.call_id),
    sip_header_variablen: unserAnruf ? sipHeaderBeleg(telefonat, laufId) : null,
  };
}

// Nur die Endung hinter der lauf_id (Digest-Fall: -mit/-ohne), nie der Wert selbst.
function baueProbeFelder(probeVariable, variablen, laufId) {
  return {
    probe_variable: probeVariable,
    probe_endung: probeVariable ? variablen[probeVariable].slice(variablen[probeVariable].indexOf(laufId) + laufId.length) : null,
  };
}

function baueUnserAnrufFelder(unserAnruf, variablen, transkript) {
  return {
    variablen_namen: unserAnruf ? Object.keys(variablen) : null,
    erste_agent_nachricht: unserAnruf ? ersteAgentNachricht(transkript) : null,
  };
}

function fasseGespraechZusammen(gespraech, kontext) {
  const { variablen, probeVariable, zuordnung, unserAnruf } = ermittleZuordnungskontext(gespraech, kontext);
  const erwarteterAgent = kontext.registrierung?.agentId;
  const telefonat = gespraech.metadata?.phone_call ?? {};
  return {
    conversation_id: gespraech.conversation_id ?? null,
    agent_id: gespraech.agent_id ?? null,
    agent_wie_registrierung: erwarteterAgent ? gespraech.agent_id === erwarteterAgent : null,
    zuordnung,
    ...baueMetadatenFelder(gespraech),
    ...baueTelefonatFelder(telefonat, unserAnruf, kontext.laufId),
    ...baueProbeFelder(probeVariable, variablen, kontext.laufId),
    ...baueUnserAnrufFelder(unserAnruf, variablen, gespraech.transcript),
  };
}

export async function sammleElGespraeche(kontext) {
  const { transport, uhr, registrierung } = kontext;
  const nachUnix = Math.floor(uhr.startMs / MS_JE_S) - EL_ZEITFENSTER_PUFFER_S;
  const anfrage = elGespraecheAnfrage({ nachUnix, agentId: registrierung?.agentId, anzahl: EL_MAX_GESPRAECHE });
  const liste = await transport.senden(anfrage);
  const gespraeche = [];
  for (const eintrag of liste.json?.conversations ?? []) {
    const detail = await transport.senden(elGespraechAnfrage(eintrag.conversation_id));
    gespraeche.push({ detail_http: detail.status, ...fasseGespraechZusammen(detail.json ?? {}, kontext) });
  }
  return { liste_http: liste.status, agent_filter: Boolean(registrierung?.agentId), gespraeche };
}

// --- Telnyx call_events ------------------------------------------------------------------

function zaehleNamen(namen) {
  return namen.reduce((summe, name) => ({ ...summe, [name]: (summe[name] ?? 0) + 1 }), {});
}

export async function sammleCallEvents(kontext) {
  const beinId = kontext.griffe.ccLeg;
  if (!beinId) return { status: "kein_call_control_bein" };
  const antwort = await kontext.transport.senden(callEventsAnfrage(beinId));
  const namen = (antwort.json?.data ?? []).map((ereignis) => ereignis.name ?? ereignis.type ?? "?");
  // Positiv-Kontrolle: ein Bein, das wirklich existierte, hat mindestens ein Ereignis.
  return { http: antwort.status, positivkontrolle: namen.length > 0, namen: zaehleNamen(namen) };
}

// --- Mitschnitt des Anrufer-Beins -----------------------------------------------------

async function warteAufAufnahme(kontext) {
  const { transport, uhr, griffe } = kontext;
  for (let versuch = 1; versuch <= AUFNAHME_VERSUCHE; versuch += 1) {
    const antwort = await transport.senden(aufnahmenAnfrage(griffe.ccSession));
    const aufnahme = (antwort.json?.data ?? []).find((eintrag) => eintrag.call_session_id === griffe.ccSession);
    if (aufnahme?.download_urls?.mp3) return aufnahme;
    await uhr.warte(AUFNAHME_TAKT_MS);
  }
  return null;
}

// Hoert "der Anrufer" Pflichtsatz und Rueckfallsatz? Beantwortet ueber je ein Kontrollwort
// im Erkenner-Text. Der Pflichtsatz ist die Positiv-Kontrolle des Mitschnittwegs selbst.
export async function werteMitschnittAus(kontext) {
  const { transport, griffe, gemeinsam } = kontext;
  if (!griffe.ccSession) return { status: "kein_anrufer_bein" };
  const aufnahme = await warteAufAufnahme(kontext);
  if (!aufnahme) return { status: "keine_aufnahme" };
  const download = await transport.holeAudio(aufnahme.download_urls.mp3);
  if (!download.ok) return { status: "download_fehlgeschlagen", http: download.status };
  const erkennung = await transport.senden(elSttAnfrage({ modell: gemeinsam.stt_modell, audio: download.audio }));
  const text = normalisiere(erkennung.json?.text ?? "");
  return {
    status: "ausgewertet",
    aufnahme_id: aufnahme.id ?? null,
    stt_http: erkennung.status,
    erkannte_zeichen: text.length,
    pflichtsatz_gehoert: text.includes(normalisiere(gemeinsam.kontrollwort_pflichtsatz)),
    rueckfall_gehoert: text.includes(normalisiere(gemeinsam.kontrollwort_rueckfall)),
  };
}

// --- Telnyx detail_records (F-D) --------------------------------------------------------

function fasseBelegZusammen(beleg, trefferUeber) {
  const auszug = Object.fromEntries(BELEG_FELDER.filter((feld) => beleg[feld] != null).map((feld) => [feld, beleg[feld]]));
  return { treffer_ueber: trefferUeber, ...auszug };
}

async function durchsucheTyp({ transport, typ, kennungen }) {
  const treffer = [];
  const status = [];
  for (let seite = 1; seite <= DETAIL_RECORDS_MAX_SEITEN; seite += 1) {
    const antwort = await transport.senden(detailRecordsAnfrage(typ, seite));
    const daten = antwort.json?.data ?? [];
    status.push(antwort.status);
    for (const beleg of daten) {
      const text = JSON.stringify(beleg);
      const kennung = kennungen.find((wert) => text.includes(wert));
      if (kennung) treffer.push(fasseBelegZusammen(beleg, kennung));
    }
    if (daten.length === 0) break;
  }
  return { http: status, treffer };
}

export async function sammleDetailRecords({ transport, typen, kennungen }) {
  const brauchbar = kennungen.filter((wert) => typeof wert === "string" && wert.length >= KENNUNG_MIN_LAENGE);
  const ergebnis = {};
  for (const typ of typen) ergebnis[typ] = await durchsucheTyp({ transport, typ, kennungen: brauchbar });
  return ergebnis;
}

// --- IEL-B11: Nach-Deploy-Belege (N1/N2) ------------------------------------------------
//
// N2 kann keinen INVITE ueber ein Gespraech nachweisen (die Ablehnung erzeugt keins) - das
// Diskriminierungs-Urteil kommt deshalb NICHT aus sip-messages, sondern aus dem Kindbein
// der TeXML-Anrufliste (V2/V3).

const SIP_OK = 200;
const SIP_STATUS_FORM = /^[1-6]\d{2}$/;
const SIP_ANTWORT_ZEILE = /^SIP\/2\.0 (\d{3})\b/;
const INVITE_ZEILE = /^INVITE (\S+) SIP\/2\.0/;

export const N2_URTEIL = Object.freeze({ ANNAHME_DISKRIMINIEREND: "ANNAHME_DISKRIMINIEREND", NICHT_DISKRIMINIEREND: "NICHT_DISKRIMINIEREND" });

function kuerzeNummer(text) {
  return maskiereNummern(text);
}

// Spec 8 R-B: der Trunk der gepinnten DID lehnt einen fremden INVITE selbst ab (J4/J6, Trunk-Wahl
// J5) - nur eine 200-Annahme unterscheidet das Verhalten.
export function n2Urteil({ sipStatus }) {
  return sipStatus === SIP_OK ? N2_URTEIL.ANNAHME_DISKRIMINIEREND : N2_URTEIL.NICHT_DISKRIMINIEREND;
}

export function sipStatusAus(wert) {
  return SIP_STATUS_FORM.test(String(wert ?? "")) ? Number(wert) : null;
}

// NUR Kindbeine (parent_call_sid === hauptbein): das Elternbein wird von unserer Wegwerf-
// Call-Control-App angenommen und traegt selbst 200 (V3, Anruf 1 vom 2026-09-14).
export function kindbeinStatus({ calls, hauptbein }) {
  const kinder = hauptbein ? (calls ?? []).filter((anruf) => anruf.parent_call_sid === hauptbein) : [];
  return { kind_beine: kinder.length, sip_status: kinder.length === 1 ? sipStatusAus(kinder[0].sip_hangup_cause) : null };
}

// Nur die ERSTE Zeile jeder Roh-Nachricht: Kopfzeilen (Proxy-Authorization, From/To) tragen
// womoeglich Geheimnisse oder PII und verlassen diese Funktion nie.
export function sipNachrichtenBeleg(nachrichten) {
  let requestUri = null;
  const codes = [];
  for (const nachricht of nachrichten ?? []) {
    const rohtext = String(nachricht?.raw_message ?? "");
    const ersteZeile = rohtext.split("\n")[0].trim();
    const invite = INVITE_ZEILE.exec(ersteZeile);
    if (invite && !requestUri) requestUri = maskiereNummern(invite[1].split("?")[0]);
    const antwort = SIP_ANTWORT_ZEILE.exec(ersteZeile);
    if (antwort) codes.push(Number(antwort[1]));
  }
  return { request_uri: requestUri, antwort_codes: [...new Set(codes)] };
}

export async function sammleTexmlKindbein(kontext) {
  const hauptbein = kontext.griffe.hauptbein;
  if (!hauptbein) return { http: null, kind_beine: 0, sip_status: null };
  const antwort = await kontext.transport.senden(texmlAnrufeAnfrage(kontext.fall.anrufer_kennung));
  return { http: antwort.status, ...kindbeinStatus({ calls: antwort.json?.calls, hauptbein }) };
}

export async function sammleSipNachrichten(kontext) {
  const elevenlabsBeleg = kontext.beleg.elevenlabs;
  const gespraeche = (elevenlabsBeleg?.gespraeche ?? []).filter((gespraech) => gespraech.zuordnung !== ZUORDNUNG.ZEITFENSTER);
  const ergebnis = [];
  for (const gespraech of gespraeche) {
    const antwort = await kontext.transport.senden(elSipNachrichtenAnfrage(gespraech.conversation_id));
    ergebnis.push({ conversation_id: gespraech.conversation_id, http: antwort.status, ...sipNachrichtenBeleg(antwort.json?.sip_messages) });
  }
  return ergebnis;
}

export async function sammleNachdeployBelege(kontext) {
  const kindbein = await sammleTexmlKindbein(kontext);
  const sipNachrichten = await sammleSipNachrichten(kontext);
  return {
    from: kuerzeNummer(kontext.fall.anrufer_kennung),
    request_uri: { gesendet: kuerzeNummer(kontext.fall.sip_ziel), empfangen: sipNachrichten.find((beleg) => beleg.request_uri)?.request_uri ?? null },
    sip_status: kindbein.sip_status,
    texml_kindbein: kindbein,
    sip_nachrichten: sipNachrichten,
    ...(kontext.fall.n2_protokoll ? { n2_urteil: n2Urteil({ sipStatus: kindbein.sip_status }) } : {}),
  };
}
