// IEL-Messwerkzeug: misst die Uebergabe Telnyx -> ElevenLabs-SIP (IE1, F-A..F-F) mit
// Maschine-zu-Maschine-Anrufen. Kein Mensch in der Leitung, kein Tunnel, keine Nummer.
//
// Aufruf:  node scripts/iel-mess.mjs <fall|status|setup|teardown> [--dry-run]
// Faelle und ihre Parameter: scripts/iel-mess.cases.json (Aenderungen NUR dort).
//
// Sicherungen IM Skript, nicht per Konvention:
//   - Zaehler tasks/iel-m1-zaehler.json: nach 5 ausgeloesten Anrufen wird jeder weitere
//     verweigert (Exit 2). Gezaehlt wird VOR dem Senden. Fehlt oder zerfaellt die Datei,
//     wird verweigert - Loeschen setzt nichts zurueck.
//   - Sperrdatei tasks/iel-m1-zaehler.lock: nie zwei Mess-Anrufe gleichzeitig.
//   - Je Anruf <= 60 s: Anbieter-Grenzen (TeXML TimeLimit + <Dial timeLimit>, Call-Control
//     time_limit_secs) UND aktives Auflegen per API (Wachhund, Nachfassen, unabhaengiger
//     Notaus-Timer, SIGINT/SIGTERM).
//   - Nur SIP-Ziele: ElevenLabs-SIP mit Spike2- oder fiktiver 555-01xx-Kennung, oder die
//     nie antwortende TEST-NET-Adresse. Keine Telefonnummer wird je gewaehlt.
//   - --dry-run sendet nichts: fetch ist per Stolperdraht gesperrt und wird gezaehlt;
//     Zaehler, Sperre und Ergebnisdatei werden nicht geschrieben.
//   - Schluessel nur aus .env (src/config.js), nie in einer Ausgabe.

import { istTrockenlauf, netzaufrufeImTrockenlauf, TROCKENLAUF_SCHALTER } from "./iel-mess-stolperdraht.mjs";

import { randomBytes } from "node:crypto";
import { appendFile, access, open, readFile, rename, unlink, writeFile } from "node:fs/promises";

import { config } from "../src/config.js";
import * as anbieter from "./iel-mess-anbieter.mjs";
import { sammleCallEvents, sammleDetailRecords, sammleElGespraeche, werteMitschnittAus } from "./iel-mess-belege.mjs";

// --- Owner-Grenzen -----------------------------------------------------------------------
const MAX_ANRUFE = 5;
const HART_MAX_S = 60;
// Auflege-Stufen relativ zum Laufstart. Jede Anfrage bricht nach 5 s ab (Transport), eine
// Stufe kann sich also um hoechstens Abfrage + Takt verspaeten und bleibt unter 60 s.
const WACHHUND_AUFLEGEN_S = 40;
const NACHFASSEN_S = 48;
const NOTAUS_S = 55;
const STATUS_TAKT_MS = 2000;
const ANRUFER_SUCHE_MAX_S = 12;
const SUCHE_TAKT_MS = 1000;
// ElevenLabs schliesst das Gespraech nach dem Auflegen erst ab; vorher fehlen Abbruchgrund und Dauer.
const EL_NACHLAUF_MS = 20000;
const DIAL_TIMEOUT_MIN_S = 5;
const DIAL_TIMEOUT_MAX_S = 20;
const LAUF_ZUFALL_BYTES = 3;
const LAUF_ZEIT_BASIS = 36;
const TELNYX_TITEL_MAX_ZEICHEN = 80;
const HTTP_NICHT_GEFUNDEN = 404;

if (!(WACHHUND_AUFLEGEN_S < NACHFASSEN_S && NACHFASSEN_S < NOTAUS_S && NOTAUS_S < HART_MAX_S)) {
  throw new Error("Auflege-Stufen verletzen die 60-s-Grenze");
}

// --- Erlaubte Ziele ----------------------------------------------------------------------
const EL_SIP_HOST = "sip.rtc.elevenlabs.io";
// RFC 5737 TEST-NET-1: routet nirgendwohin, antwortet nie - die Messung "Gegenstelle stumm".
const STUMMER_SIP_HOST = "192.0.2.1";
const SPIKE2_KENNUNG = "+15739090177";
// NANP-Fiktivbereich 555-0100..0199: gehoert niemandem.
const FIKTIVE_KENNUNG = /^\+1\d{3}55501\d{2}$/;
const E164 = /^\+\d{8,15}$/;
const SIP_ZIEL = /^sip:([^@;?:]+)@([^:;?]+)(:\d+)?(;[a-z]+=[a-z]+)*$/;
const HEADER_NAME = /^X-[A-Za-z0-9-]{1,40}$/;
const TEXML_ENDSTATUS = new Set(["completed", "canceled", "failed", "busy", "no-answer"]);

const PFADE = Object.freeze({
  faelle: new URL("./iel-mess.cases.json", import.meta.url),
  zaehler: new URL("../tasks/iel-m1-zaehler.json", import.meta.url),
  sperre: new URL("../tasks/iel-m1-zaehler.lock", import.meta.url),
  ergebnis: new URL("../tasks/iel-m1-messung.jsonl", import.meta.url),
  wegwerf: new URL("../tasks/iel-m1-wegwerf.json", import.meta.url),
});

const EXIT = Object.freeze({ bedienfehler: 1, verweigert: 2, laufzeitfehler: 3, trockenlaufVerletzt: 4 });

class Verweigerung extends Error {}
class Bedienfehler extends Error {}

// --- Dateien -----------------------------------------------------------------------------

async function existiert(pfad) {
  try {
    await access(pfad);
    return true;
  } catch {
    return false;
  }
}

async function leseJson(pfad, fehlerText) {
  try {
    return JSON.parse(await readFile(pfad, "utf8"));
  } catch {
    throw new Verweigerung(fehlerText);
  }
}

const JSON_EINRUECKUNG = 2;

async function schreibeAtomar(pfad, daten) {
  const zwischen = new URL(`${pfad.href}.tmp`);
  await writeFile(zwischen, `${JSON.stringify(daten, null, JSON_EINRUECKUNG)}\n`);
  await rename(zwischen, pfad);
}

async function leseZaehler() {
  const zaehler = await leseJson(PFADE.zaehler, "Zaehlerdatei tasks/iel-m1-zaehler.json fehlt oder ist unlesbar - verweigert");
  if (!Number.isInteger(zaehler.ausgeloest) || zaehler.ausgeloest < 0 || !Array.isArray(zaehler.anrufe)) {
    throw new Verweigerung("Zaehlerdatei hat keine gueltige Form - verweigert");
  }
  if (zaehler.ausgeloest >= MAX_ANRUFE) {
    throw new Verweigerung(`Anruf-Budget erschoepft: ${zaehler.ausgeloest}/${MAX_ANRUFE} ausgeloest`);
  }
  return zaehler;
}

// Echt: schreibt Zaehler, Sperre, Ergebnis. Trocken: liest nur und zeigt, was geschaehe.
function echteBuchhaltung() {
  return {
    async mitSperre(handlung) {
      const sperre = await open(PFADE.sperre, "wx").catch(() => {
        throw new Verweigerung("Sperrdatei tasks/iel-m1-zaehler.lock existiert (laufender oder abgestuerzter Lauf) - verweigert");
      });
      try {
        return await handlung();
      } finally {
        await sperre.close();
        await unlink(PFADE.sperre);
      }
    },
    async reserviere({ name, laufId }) {
      const zaehler = await leseZaehler();
      zaehler.ausgeloest += 1;
      zaehler.anrufe.push({ nr: zaehler.ausgeloest, fall: name, lauf_id: laufId, zeitpunkt: new Date().toISOString() });
      await schreibeAtomar(PFADE.zaehler, zaehler);
      return zaehler.ausgeloest;
    },
    schreibe: (zeile) => appendFile(PFADE.ergebnis, `${JSON.stringify(zeile)}\n`),
    merkeWegwerf: (zustand) => schreibeAtomar(PFADE.wegwerf, zustand),
    vergissWegwerf: () => unlink(PFADE.wegwerf),
  };
}

function trockeneBuchhaltung() {
  return {
    async mitSperre(handlung) {
      if (await existiert(PFADE.sperre)) throw new Verweigerung("Sperrdatei existiert - ein echter Lauf wuerde verweigert");
      return handlung();
    },
    async reserviere() {
      const zaehler = await leseZaehler();
      console.log(`[TROCKEN] Zaehler ${zaehler.ausgeloest}/${MAX_ANRUFE} -> echt waere es ${zaehler.ausgeloest + 1}/${MAX_ANRUFE} (nicht geschrieben)`);
      return zaehler.ausgeloest + 1;
    },
    async schreibe(zeile) {
      console.log(`[TROCKEN] Ergebniszeile mit Musterwerten (nicht geschrieben):\n${JSON.stringify(zeile)}`);
    },
    async merkeWegwerf(zustand) {
      console.log(`[TROCKEN] wuerde tasks/iel-m1-wegwerf.json schreiben: ${JSON.stringify(zustand)}`);
    },
    async vergissWegwerf() {
      console.log("[TROCKEN] wuerde tasks/iel-m1-wegwerf.json loeschen");
    },
  };
}

// --- Pruefungen vor jedem Senden -------------------------------------------------------

function pruefeSchluessel() {
  const vorhanden = {
    TELNYX_API_KEY: Boolean(config.telephony.telnyxApiKey),
    TELNYX_ACCOUNT_SID: Boolean(config.telephony.telnyxAccountSid),
    ELEVENLABS_API_KEY: Boolean(config.voice.elevenLabsOutbound.apiKey),
  };
  const fehlend = Object.keys(vorhanden).filter((name) => !vorhanden[name]);
  if (fehlend.length > 0) throw new Bedienfehler(`Fehlt in .env: ${fehlend.join(", ")}`);
}

function sipZielTeile(sipZiel) {
  const treffer = SIP_ZIEL.exec(String(sipZiel));
  return treffer ? { kennung: treffer[1], host: treffer[2] } : null;
}

function istErlaubteElKennung(kennung) {
  return kennung === SPIKE2_KENNUNG || FIKTIVE_KENNUNG.test(kennung);
}

function pruefeSipZiel(sipZiel) {
  const teile = sipZielTeile(sipZiel);
  if (!teile) throw new Verweigerung(`sip_ziel hat keine SIP-URI-Form: ${anbieter.maskiereNummern(sipZiel)}`);
  if (teile.host === STUMMER_SIP_HOST) return teile;
  if (teile.host !== EL_SIP_HOST) throw new Verweigerung(`SIP-Host nicht erlaubt: ${teile.host}`);
  if (!istErlaubteElKennung(teile.kennung)) throw new Verweigerung("SIP-Kennung ist weder Spike2 noch fiktiv (555-01xx) - verweigert");
  return teile;
}

function pruefeAnruferKennung(anrufer_kennung) {
  if (!E164.test(anrufer_kennung ?? "")) throw new Verweigerung("anrufer_kennung ist keine E.164-Nummer");
}

function pruefeDialTimeout(timeout) {
  if (!Number.isInteger(timeout) || timeout < DIAL_TIMEOUT_MIN_S || timeout > DIAL_TIMEOUT_MAX_S) {
    throw new Verweigerung(`dial_timeout_s muss ${DIAL_TIMEOUT_MIN_S}..${DIAL_TIMEOUT_MAX_S} sein`);
  }
}

function pruefeElternAuflegenNachS(auflegen) {
  if (auflegen != null && !(Number.isInteger(auflegen) && auflegen > 0 && auflegen < WACHHUND_AUFLEGEN_S)) {
    throw new Verweigerung(`eltern_auflegen_nach_s muss null oder 1..${WACHHUND_AUFLEGEN_S - 1} sein`);
  }
}

function pruefeHeaderNamen(header) {
  const falscheHeader = Object.keys(header).filter((name) => !HEADER_NAME.test(name));
  if (falscheHeader.length > 0) throw new Verweigerung(`Header-Namen nicht erlaubt: ${falscheHeader.join(", ")}`);
}

function pruefeAnrufFall({ fall, header }) {
  pruefeSipZiel(fall.sip_ziel);
  pruefeAnruferKennung(fall.anrufer_kennung);
  pruefeDialTimeout(fall.dial_timeout_s);
  pruefeElternAuflegenNachS(fall.eltern_auflegen_nach_s);
  pruefeHeaderNamen(header);
}

async function loeseRegistrierungsId(id) {
  if (id !== "wegwerf") return id ?? null;
  const zustand = await leseJson(PFADE.wegwerf, "Fall braucht die Wegwerf-Registrierung: erst 'setup' (tasks/iel-m1-wegwerf.json fehlt)");
  return zustand.phone_number_id;
}

// Liest die Registrierung VOR dem Anruf: erwarteter Agent (Positiv-Kontrolle fuer F-A) und
// Abgleich, dass das SIP-Ziel wirklich diese Registrierung meint - sonst waere der Anruf blind.
async function leseRegistrierung(kontext) {
  const id = await loeseRegistrierungsId(kontext.fall.el_registrierung_id);
  if (!id) return null;
  const antwort = await kontext.transport.senden(anbieter.elRegistrierungAnfrage(id));
  if (!antwort.ok) throw new Verweigerung(`Registrierung nicht lesbar (HTTP ${antwort.status})`);
  const daten = antwort.json ?? {};
  const kennung = sipZielTeile(kontext.fall.sip_ziel).kennung;
  if (daten.phone_number !== kennung || !istErlaubteElKennung(daten.phone_number)) {
    throw new Verweigerung("Registrierung und SIP-Ziel meinen verschiedene Kennungen - verweigert");
  }
  return {
    id,
    agentId: daten.assigned_agent?.agent_id ?? null,
    eingehend_konfiguriert: Boolean(daten.inbound_trunk),
    anrufer_in_allowed_numbers: (daten.inbound_trunk?.allowed_numbers ?? []).includes(kontext.fall.anrufer_kennung),
  };
}

// --- Kontext ---------------------------------------------------------------------------

function mitLaufId(header, laufId) {
  return Object.fromEntries(Object.entries(header ?? {}).map(([name, wert]) => [name, String(wert).replace("{{lauf_id}}", laufId)]));
}

function maskiert(text) {
  return text ? anbieter.maskiereNummern(text) : null;
}

function neuerBeleg({ name, fall, laufId, header }) {
  const ziel = sipZielTeile(fall.sip_ziel);
  return {
    art: "iel-m1-anruf",
    fall: name,
    deckt: fall.deckt ?? [],
    lauf_id: laufId,
    trockenlauf: istTrockenlauf,
    zeitpunkt: new Date().toISOString(),
    nr: null,
    anfrage: {
      weg: fall.art,
      sip_host: ziel?.host ?? null,
      sip_kennung: maskiert(ziel?.kennung),
      anrufer_kennung: maskiert(fall.anrufer_kennung),
      header_namen: Object.keys(header),
      dial_timeout_s: fall.dial_timeout_s,
      anbieter_zeitlimit_s: anbieter.ANBIETER_ZEITLIMIT_S,
      eltern_auflegen_nach_s: fall.eltern_auflegen_nach_s ?? null,
    },
    registrierung: null,
    schritte: [],
    auflegen: [],
    ende: null,
    kennungen: null,
    telnyx_ereignisse: null,
    elevenlabs: null,
    mitschnitt: null,
  };
}

function baueKontext({ name, fall, konfiguration }) {
  const laufId = `iel-${Date.now().toString(LAUF_ZEIT_BASIS)}-${randomBytes(LAUF_ZUFALL_BYTES).toString("hex")}`;
  const header = mitLaufId(konfiguration.gemeinsam.probe_header, laufId);
  const uhr = istTrockenlauf ? anbieter.trockeneUhr() : anbieter.echteUhr();
  const elKennung = sipZielTeile(fall.sip_ziel)?.kennung ?? fall.el_kennung ?? konfiguration.setup?.el_nummer;
  const muster = { elKennung, laufId, registrierungId: fall.el_registrierung_id, label: konfiguration.setup?.label };
  return {
    name,
    fall,
    gemeinsam: konfiguration.gemeinsam,
    konfiguration,
    laufId,
    header,
    uhr,
    transport: istTrockenlauf ? anbieter.trockenerTransport({ uhr, kontext: muster }) : anbieter.echterTransport(),
    buchhaltung: istTrockenlauf ? trockeneBuchhaltung() : echteBuchhaltung(),
    griffe: {},
    beleg: neuerBeleg({ name, fall, laufId, header }),
  };
}

// --- Anruf-Ablauf ----------------------------------------------------------------------

function merkeSchritt(kontext, schritt, antwort) {
  const fehler = antwort.json?.errors?.[0];
  kontext.beleg.schritte.push({
    schritt,
    t_s: Math.round(kontext.uhr.sekunden()),
    http: antwort.status,
    ...(antwort.fehler ? { netzfehler: antwort.fehler } : {}),
    ...(fehler ? { telnyx_code: fehler.code ?? null, telnyx_titel: String(fehler.title ?? "").slice(0, TELNYX_TITEL_MAX_ZEICHEN) } : {}),
  });
  return antwort;
}

// Beleg Anruf 1 (2026-09-14, lauf iel-mu1c1dal-8ac9a5): active_calls der Call-Control-App
// lieferte als erstes das TeXML-Elternbein (dessen call_control_id == TeXML-sid laut
// TeXML-Anrufliste); answer darauf -> 422/90102, das echte eingehende Bein blieb ungeantwortet.
// Deshalb: Kandidaten zuerst aus call.initiated (direction incoming, "to" traegt die lauf_id),
// dann aus active_calls; jeder Kandidat wird hoechstens einmal angenommen, erstes 2xx gewinnt.
const HTTP_UNVERARBEITBAR = 422;

function kandidatenAusEreignissen(antwort, laufId) {
  const ereignisse = antwort.json?.data ?? [];
  return ereignisse
    .map((ereignis) => ereignis.payload?.payload ?? {})
    .filter((bein) => bein.direction === "incoming" && String(bein.to ?? "").includes(laufId));
}

async function nimmErstenKandidatenAn(kontext, kandidaten, versucht) {
  for (const bein of kandidaten) {
    if (!bein.call_control_id || versucht.has(bein.call_control_id)) continue;
    versucht.add(bein.call_control_id);
    const antwort = merkeSchritt(kontext, "anrufer_annehmen", await kontext.transport.senden(anbieter.ccAktionAnfrage(bein.call_control_id, "answer", {})));
    if (antwort.ok) return bein;
    // Ein abgelehntes Bein aus active_calls ist (Beleg oben) das TeXML-Elternbein.
    if (antwort.status === HTTP_UNVERARBEITBAR && !kontext.griffe.hauptbein) {
      Object.assign(kontext.griffe, { hauptbein: bein.call_control_id, hauptbeinQuelle: "active_calls_abgelehnt" });
    }
  }
  return null;
}

async function sucheUndNimmAnruferAn(kontext) {
  const { transport, uhr, laufId } = kontext;
  const versucht = new Set();
  while (uhr.sekunden() < ANRUFER_SUCHE_MAX_S) {
    const ereignisse = await transport.senden(anbieter.anruferEreignisseAnfrage());
    const aktiv = await transport.senden(anbieter.aktiveAnrufeAnfrage());
    const kandidaten = [...kandidatenAusEreignissen(ereignisse, laufId), ...(aktiv.json?.data ?? [])];
    const bein = await nimmErstenKandidatenAn(kontext, kandidaten, versucht);
    if (bein) return bein;
    await uhr.warte(SUCHE_TAKT_MS);
  }
  return null;
}

async function nimmAnruferAn(kontext) {
  const bein = await sucheUndNimmAnruferAn(kontext);
  if (!bein) {
    merkeSchritt(kontext, "anrufer_nicht_gefunden", { status: null, json: null });
    return;
  }
  Object.assign(kontext.griffe, { ccId: bein.call_control_id, ccLeg: bein.call_leg_id, ccSession: bein.call_session_id });
  const aktion = (name, koerper) => anbieter.ccAktionAnfrage(bein.call_control_id, name, koerper);
  if (kontext.fall.mitschnitt) {
    merkeSchritt(kontext, "mitschnitt_start", await kontext.transport.senden(aktion("record_start", { format: "mp3", channels: "dual" })));
  }
}

async function ccBeinBeendet(kontext, callControlId) {
  const antwort = await kontext.transport.senden(anbieter.ccStatusAnfrage(callControlId));
  return antwort.status === HTTP_NICHT_GEFUNDEN || antwort.json?.data?.is_alive === false;
}

const WEGE = Object.freeze({
  "texml-bruecke": {
    async starte(kontext) {
      const antwort = merkeSchritt(kontext, "texml_anlegen", await kontext.transport.senden(anbieter.texmlAnrufAnfrage(kontext)));
      // Anruf 1: weder data.sid noch data.call_sid gesetzt - Schluesselnamen belegen die Form.
      const daten = antwort.json?.data ?? antwort.json ?? {};
      Object.assign(kontext.beleg, { texml_antwort_schluessel: Object.keys(daten) });
      const hauptbein = daten.sid ?? daten.call_sid ?? null;
      Object.assign(kontext.griffe, { hauptbein });
      if (hauptbein) Object.assign(kontext.griffe, { hauptbeinQuelle: "texml_antwort" });
      // Auch ohne sid in der Antwort: das Anrufer-Bein ist der zweite Griff zum Auflegen.
      // Ohne unser answer wird nie zu ElevenLabs gebrueckt.
      if (antwort.ok) await nimmAnruferAn(kontext);
    },
    async beendet(kontext) {
      const { hauptbein, ccId } = kontext.griffe;
      if (!hauptbein) return ccBeinBeendet(kontext, ccId);
      const antwort = await kontext.transport.senden(anbieter.texmlStatusAnfrage(hauptbein));
      return TEXML_ENDSTATUS.has(antwort.json?.status ?? antwort.json?.data?.status);
    },
    legeHauptbeinAufAnfrage: (kontext) => anbieter.texmlBeendenAnfrage(kontext.griffe.hauptbein),
  },
  "cc-direkt": {
    async starte(kontext) {
      const antwort = merkeSchritt(kontext, "cc_waehlen", await kontext.transport.senden(anbieter.ccWaehlenAnfrage(kontext)));
      const bein = antwort.json?.data ?? {};
      Object.assign(kontext.griffe, { hauptbein: bein.call_control_id ?? null, ccLeg: bein.call_leg_id ?? null, ccSession: bein.call_session_id ?? null });
    },
    beendet: (kontext) => ccBeinBeendet(kontext, kontext.griffe.hauptbein),
    legeHauptbeinAufAnfrage: (kontext) => anbieter.ccAktionAnfrage(kontext.griffe.hauptbein, "hangup", {}),
  },
});

// nurHauptbein (F-C): nur das Elternbein per API beenden, damit sichtbar wird, ob DAS die
// Bruecke beendet. Ohne Hauptbein-Griff faellt es auf das Anrufer-Bein zurueck, sonst
// geschaehe gar nichts. Wachhund, Nachfassen und Notaus legen weiter BEIDE Beine auf.
async function legeAuf(kontext, grund, { nurHauptbein = false } = {}) {
  const { griffe, transport, uhr, beleg } = kontext;
  const weg = WEGE[kontext.fall.art];
  const auftraege = [];
  if (griffe.hauptbein) auftraege.push(["hauptbein", weg.legeHauptbeinAufAnfrage(kontext)]);
  if (griffe.ccId && !(nurHauptbein && griffe.hauptbein)) auftraege.push(["anrufer", anbieter.ccAktionAnfrage(griffe.ccId, "hangup", {})]);
  for (const [bein, anfrage] of auftraege) {
    const antwort = await transport.senden(anfrage);
    beleg.auflegen.push({ grund, bein, t_s: Math.round(uhr.sekunden()), http: antwort.status });
  }
}

async function warteAufEnde(kontext, bisSekunde) {
  const weg = WEGE[kontext.fall.art];
  while (kontext.uhr.sekunden() < bisSekunde) {
    if (await weg.beendet(kontext)) return true;
    await kontext.uhr.warte(STATUS_TAKT_MS);
  }
  return false;
}

async function begleiteBisEnde(kontext) {
  const elternAuflegenS = kontext.fall.eltern_auflegen_nach_s;
  if (elternAuflegenS && !(await warteAufEnde(kontext, elternAuflegenS))) await legeAuf(kontext, "eltern_api", { nurHauptbein: true });
  if (!(await warteAufEnde(kontext, WACHHUND_AUFLEGEN_S))) await legeAuf(kontext, "wachhund");
  if (!(await warteAufEnde(kontext, NACHFASSEN_S))) await legeAuf(kontext, "nachfassen");
  const weg = WEGE[kontext.fall.art];
  const bestaetigt = await weg.beendet(kontext);
  const anruferBeendet = kontext.griffe.ccId ? await ccBeinBeendet(kontext, kontext.griffe.ccId) : null;
  Object.assign(kontext.beleg, { ende: { bestaetigt, anrufer_beendet: anruferBeendet, t_s: Math.round(kontext.uhr.sekunden()) } });
}

const ABBRUCH_SIGNALE = ["SIGINT", "SIGTERM"];

async function fuehreAnrufDurch(kontext) {
  const stoppeNotaus = kontext.uhr.notaus(() => legeAuf(kontext, "notaus"), NOTAUS_S);
  const beiSignal = () => legeAuf(kontext, "signal").finally(() => process.exit(EXIT.verweigert));
  ABBRUCH_SIGNALE.forEach((signal) => process.once(signal, beiSignal));
  try {
    const weg = WEGE[kontext.fall.art];
    await weg.starte(kontext);
    if (kontext.griffe.hauptbein || kontext.griffe.ccId) await begleiteBisEnde(kontext);
    else Object.assign(kontext.beleg, { ende: { bestaetigt: false, grund: "kein_griff" } });
  } catch (fehler) {
    await legeAuf(kontext, "programmfehler");
    throw fehler;
  } finally {
    stoppeNotaus();
    ABBRUCH_SIGNALE.forEach((signal) => process.removeListener(signal, beiSignal));
  }
}

// --- Digest-Messung (M3): Wegwerf-Zugangsdaten nur fuer die Dauer EINES Anrufs ------------
// Ablauf: Registrierung lesen -> Zugangsdaten per PATCH setzen -> per GET belegen (sonst
// Abbruch VOR der Zaehler-Reservierung, also kein verbrauchter Anruf) -> Anruf -> im finally
// Zugangsdaten entfernen und den Ausgangszustand per GET belegen. Die Zugangsdaten stehen nur
// im Speicher (kontext.geheim) und im TeXML-Koerper, nie in Ausgabe oder Ergebnisdatei.
const DIGEST_BENUTZER_BYTES = 6;
const DIGEST_PASSWORT_BYTES = 18;

function wegwerfZugangsdaten() {
  if (istTrockenlauf) return { username: "<wegwerf-benutzer>", password: "<wegwerf-passwort>" };
  return {
    username: `ielm1${randomBytes(DIGEST_BENUTZER_BYTES).toString("hex")}`,
    password: randomBytes(DIGEST_PASSWORT_BYTES).toString("hex"),
  };
}

function digestSicht(registrierung) {
  const trunk = registrierung?.inbound_trunk ?? {};
  return { has_auth_credentials: trunk.has_auth_credentials ?? null, benutzer_gesetzt: Boolean(trunk.username), allowed_addresses: trunk.allowed_addresses ?? null };
}

async function setzeDigestZugang(kontext, { id, vorherInbound }) {
  Object.assign(kontext, { geheim: wegwerfZugangsdaten() });
  const antwort = await kontext.transport.senden(anbieter.elRegistrierungPatch(id, { inbound_trunk_config: { ...vorherInbound, credentials: kontext.geheim } }));
  const gesetzt = await leseRegistrierungRoh(kontext, id);
  Object.assign(kontext.beleg.digest, { setzen_http: antwort.status, gesetzt: digestSicht(gesetzt) });
  if (!istTrockenlauf && !(antwort.ok && gesetzt.inbound_trunk?.has_auth_credentials)) {
    throw new Verweigerung(`Zugangsdaten nicht wirksam gesetzt (HTTP ${antwort.status}) - kein Anruf`);
  }
}

async function entferneDigestZugang(kontext, { id, vorher, vorherInbound }) {
  const antwort = await kontext.transport.senden(anbieter.elRegistrierungPatch(id, { inbound_trunk_config: { ...vorherInbound, credentials: null } }));
  const nachher = await leseRegistrierungRoh(kontext, id);
  const inboundGleich = JSON.stringify(vorher.inbound_trunk) === JSON.stringify(nachher.inbound_trunk);
  const outboundGleich = JSON.stringify(vorher.outbound_trunk) === JSON.stringify(nachher.outbound_trunk);
  Object.assign(kontext.beleg.digest, { entfernen_http: antwort.status, nachher: digestSicht(nachher), inbound_wie_vorher: inboundGleich, outbound_wie_vorher: outboundGleich });
  if (!istTrockenlauf && !(inboundGleich && outboundGleich)) {
    console.error("ACHTUNG: Spike2-Registrierung NICHT im Ausgangszustand - von Hand pruefen (Ergebnisdatei, Feld digest)");
    process.exitCode = EXIT.laufzeitfehler;
  }
}

async function mitDigestZugang(kontext, handlung) {
  if (!kontext.registrierung?.id) throw new Verweigerung("Digest-Fall braucht eine el_registrierung_id");
  const id = kontext.registrierung.id;
  const vorher = await leseRegistrierungRoh(kontext, id);
  // Verweigert, wenn schon Zugangsdaten anliegen: die liessen sich nicht verlustfrei zurueckschreiben.
  const vorherInbound = alsInboundKonfiguration(vorher.inbound_trunk);
  Object.assign(kontext.beleg, { digest: { vorher: digestSicht(vorher) } });
  try {
    await setzeDigestZugang(kontext, { id, vorherInbound });
    return await handlung();
  } finally {
    await entferneDigestZugang(kontext, { id, vorher, vorherInbound });
  }
}

async function messeAnruf(kontext) {
  pruefeAnrufFall(kontext);
  pruefeSchluessel();
  // Budget zuerst: ist es erschoepft, geht nicht einmal die lesende Vorab-Anfrage hinaus.
  await leseZaehler();
  const registrierung = await leseRegistrierung(kontext);
  Object.assign(kontext, { registrierung });
  Object.assign(kontext.beleg, { registrierung });
  await kontext.buchhaltung.mitSperre(async () => {
    const anruf = async () => {
      const nr = await kontext.buchhaltung.reserviere(kontext);
      Object.assign(kontext.beleg, { nr });
      await fuehreAnrufDurch(kontext);
    };
    await (kontext.fall.digest ? mitDigestZugang(kontext, anruf) : anruf());
  });
  const { hauptbein, ccId, ccLeg, ccSession } = kontext.griffe;
  const kennungen = { hauptbein: hauptbein ?? null, hauptbein_quelle: kontext.griffe.hauptbeinQuelle ?? null, call_control_id: ccId ?? null, call_leg_id: ccLeg ?? null, call_session_id: ccSession ?? null };
  Object.assign(kontext.beleg, { kennungen });
  await kontext.uhr.warte(EL_NACHLAUF_MS);
  Object.assign(kontext.beleg, { elevenlabs: await sammleElGespraeche(kontext) });
  Object.assign(kontext.beleg, { telnyx_ereignisse: await sammleCallEvents(kontext) });
  if (kontext.fall.mitschnitt) Object.assign(kontext.beleg, { mitschnitt: await werteMitschnittAus(kontext) });
  await kontext.buchhaltung.schreibe(kontext.beleg);
}

// --- Faelle ohne Anruf -----------------------------------------------------------------

async function leseProtokollierteKennungen() {
  if (!(await existiert(PFADE.ergebnis))) return [];
  const inhalt = await readFile(PFADE.ergebnis, "utf8");
  const zeilen = inhalt.split("\n").filter(Boolean).map((zeile) => JSON.parse(zeile));
  const anrufe = zeilen.filter((zeile) => zeile.art === "iel-m1-anruf" && !zeile.trockenlauf);
  return anrufe.flatMap((anruf) => [
    ...Object.values(anruf.kennungen ?? {}),
    ...(anruf.elevenlabs?.gespraeche ?? []).map((gespraech) => gespraech.conversation_id),
  ]);
}

async function messeDetailRecords(kontext) {
  pruefeSchluessel();
  const kennungen = await leseProtokollierteKennungen();
  const typen = kontext.gemeinsam.detail_record_typen;
  const ergebnis = await sammleDetailRecords({ transport: kontext.transport, typen, kennungen });
  await kontext.buchhaltung.schreibe({ art: "iel-m1-detail-records", zeitpunkt: new Date().toISOString(), trockenlauf: istTrockenlauf, kennungen: kennungen.length, typen: ergebnis });
}

const INBOUND_FELDER = Object.freeze(["allowed_addresses", "allowed_numbers", "media_encryption", "remote_domains", "attributes_to_headers"]);

function alsInboundKonfiguration(trunk) {
  if (trunk?.credentials || trunk?.has_auth_credentials) {
    throw new Verweigerung("Registrierung traegt Inbound-Zugangsdaten - ohne Passwort nicht verlustfrei zurueckschreibbar");
  }
  return Object.fromEntries(INBOUND_FELDER.filter((feld) => trunk?.[feld] !== undefined).map((feld) => [feld, trunk[feld]]));
}

function abweichendeSchluessel(vorher, nachher) {
  const namen = new Set([...Object.keys(vorher ?? {}), ...Object.keys(nachher ?? {})]);
  return [...namen].filter((name) => JSON.stringify(vorher?.[name]) !== JSON.stringify(nachher?.[name]));
}

async function leseRegistrierungRoh(kontext, id) {
  const antwort = await kontext.transport.senden(anbieter.elRegistrierungAnfrage(id));
  if (!antwort.ok || !istErlaubteElKennung(antwort.json?.phone_number)) {
    throw new Verweigerung(`Registrierung nicht lesbar oder keine Test-Kennung (HTTP ${antwort.status})`);
  }
  return antwort.json;
}

async function messeRegistrierungsVergleich(kontext) {
  pruefeSchluessel();
  const { transport, fall } = kontext;
  const id = await loeseRegistrierungsId(fall.el_registrierung_id);
  const vorher = await leseRegistrierungRoh(kontext, id);
  if (vorher.phone_number !== fall.el_kennung) throw new Verweigerung("Registrierung traegt nicht die erwartete el_kennung - kein PATCH");
  const vorherInbound = alsInboundKonfiguration(vorher.inbound_trunk);
  const patch = await transport.senden(anbieter.elRegistrierungPatch(id, { inbound_trunk_config: fall.inbound_patch ?? vorherInbound }));
  const nachher = await leseRegistrierungRoh(kontext, id);
  const zurueck = fall.inbound_patch ? await transport.senden(anbieter.elRegistrierungPatch(id, { inbound_trunk_config: vorherInbound })) : null;
  await kontext.buchhaltung.schreibe({
    art: "iel-m1-registrierung",
    zeitpunkt: new Date().toISOString(),
    trockenlauf: istTrockenlauf,
    registrierung: id,
    patch_http: patch.status,
    outbound_abweichend: abweichendeSchluessel(vorher.outbound_trunk, nachher.outbound_trunk),
    inbound_abweichend: abweichendeSchluessel(vorher.inbound_trunk, nachher.inbound_trunk),
    zurueckgeschrieben_http: zurueck?.status ?? null,
  });
}

// --- Wegwerf-Registrierung bei ElevenLabs (setup/teardown) -----------------------------

async function legeWegwerfAn(kontext) {
  pruefeSchluessel();
  if (await existiert(PFADE.wegwerf)) throw new Verweigerung("tasks/iel-m1-wegwerf.json existiert - erst 'teardown'");
  const { el_nummer: nummer, label, anrufer_kennung: anrufer } = kontext.konfiguration.setup;
  if (!FIKTIVE_KENNUNG.test(nummer)) throw new Verweigerung("setup.el_nummer muss eine fiktive 555-01xx-Kennung sein");
  const koerper = { phone_number: nummer, label, provider: "sip_trunk", inbound_trunk_config: { allowed_numbers: [anrufer], media_encryption: "disabled" } };
  const antwort = await kontext.transport.senden(anbieter.elRegistrierungAnlegen(koerper));
  if (!antwort.ok) throw new Error(`Anlegen fehlgeschlagen (HTTP ${antwort.status})`);
  await kontext.buchhaltung.merkeWegwerf({ phone_number_id: antwort.json?.phone_number_id, label, angelegt: new Date().toISOString() });
}

async function raeumeWegwerfAb(kontext) {
  pruefeSchluessel();
  const zustand = await leseJson(PFADE.wegwerf, "Keine Wegwerf-Registrierung vermerkt (tasks/iel-m1-wegwerf.json fehlt) - nichts abzubauen");
  const registrierung = await leseRegistrierungRoh(kontext, zustand.phone_number_id);
  if (registrierung.label !== zustand.label || !FIKTIVE_KENNUNG.test(registrierung.phone_number)) {
    throw new Verweigerung("Registrierung passt nicht zum vermerkten Wegwerf-Objekt - nicht geloescht");
  }
  const antwort = await kontext.transport.senden(anbieter.elRegistrierungLoeschen(zustand.phone_number_id));
  if (!antwort.ok) throw new Error(`Loeschen fehlgeschlagen (HTTP ${antwort.status})`);
  await kontext.buchhaltung.vergissWegwerf();
}

// --- Status (offline) ------------------------------------------------------------------

const STATUS_NAME_BREITE = 16;
const STATUS_ART_BREITE = 24;

async function zeigeStatus(kontext) {
  const zaehler = await readFile(PFADE.zaehler, "utf8").then(JSON.parse).catch(() => null);
  console.log(`Zaehler: ${zaehler ? `${zaehler.ausgeloest}/${MAX_ANRUFE}` : "FEHLT (jeder Anruf wird verweigert)"}`);
  console.log(`Sperre: ${(await existiert(PFADE.sperre)) ? "GESETZT" : "frei"}   Wegwerf-Registrierung: ${(await existiert(PFADE.wegwerf)) ? "vermerkt" : "keine"}`);
  for (const [name, fall] of Object.entries(kontext.konfiguration.faelle)) {
    const anruf = Boolean(WEGE[fall.art]);
    console.log(`  ${name.padEnd(STATUS_NAME_BREITE)} ${fall.art.padEnd(STATUS_ART_BREITE)} ${anruf ? "ANRUF" : "kein Anruf"}${fall.braucht_setup ? ", braucht setup" : ""}`);
  }
}

// --- Einstieg --------------------------------------------------------------------------

const UNTERBEFEHLE = Object.freeze({ status: zeigeStatus, setup: legeWegwerfAn, teardown: raeumeWegwerfAb });
const ARTEN = Object.freeze({
  "texml-bruecke": messeAnruf,
  "cc-direkt": messeAnruf,
  "detail-records": messeDetailRecords,
  "registrierung-vergleich": messeRegistrierungsVergleich,
});

// argv[0] = node, argv[1] = Skriptpfad - beide vor den eigentlichen Argumenten ueberspringen.
const CLI_ARGV_OFFSET = 2;

async function hauptprogramm() {
  const argumente = process.argv.slice(CLI_ARGV_OFFSET).filter((argument) => argument !== TROCKENLAUF_SCHALTER);
  const konfiguration = JSON.parse(await readFile(PFADE.faelle, "utf8"));
  const name = argumente[0];
  const fall = konfiguration.faelle[name];
  const handlung = UNTERBEFEHLE[name] ?? ARTEN[fall?.art];
  if (argumente.length !== 1 || !handlung) {
    const erlaubt = [...Object.keys(UNTERBEFEHLE), ...Object.keys(konfiguration.faelle)].join(" | ");
    throw new Bedienfehler(`Aufruf: node scripts/iel-mess.mjs <${erlaubt}> [${TROCKENLAUF_SCHALTER}]`);
  }
  await handlung(baueKontext({ name, fall: fall ?? {}, konfiguration }));
}

function exitCodeFuer(fehler) {
  if (fehler instanceof Verweigerung) return EXIT.verweigert;
  if (fehler instanceof Bedienfehler) return EXIT.bedienfehler;
  return EXIT.laufzeitfehler;
}

try {
  await hauptprogramm();
} catch (fehler) {
  console.error(`${fehler instanceof Verweigerung ? "VERWEIGERT" : "FEHLER"}: ${anbieter.maskiereNummern(fehler.message)}`);
  process.exitCode = exitCodeFuer(fehler);
} finally {
  if (istTrockenlauf) {
    const netzaufrufe = netzaufrufeImTrockenlauf();
    console.log(`[TROCKEN] fetch-Aufrufe in diesem Lauf: ${netzaufrufe}`);
    if (netzaufrufe > 0) process.exitCode = EXIT.trockenlaufVerletzt;
  }
}
