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
  elSttAnfrage,
  maskiereNummern,
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
  if (probeVariable) return "probe";
  const telefonat = gespraech.metadata?.phone_call ?? {};
  if (registrierungId && telefonat.phone_number_id === registrierungId) return "registrierung";
  return "zeitfenster";
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
  return { variablen, probeVariable, zuordnung, unserAnruf: zuordnung !== "zeitfenster" };
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
