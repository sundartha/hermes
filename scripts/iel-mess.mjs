// IEL-Messwerkzeug: misst die Uebergabe Telnyx -> ElevenLabs-SIP (IE1, F-A..F-F) mit
// Maschine-zu-Maschine-Anrufen. Kein Mensch in der Leitung, kein Tunnel, keine Nummer.
//
// IEL-B11: zusaetzlich die Nach-Deploy-Maschinenanrufe (N1/N2, Spec E20) in einer EIGENEN
// Zaehler-Gruppe ("nachdeploy", hoechstens 3 Anrufe) - die M1-Gruppe ("m1", 5 Anrufe) bleibt
// unberuehrt und byte-identisch. N3 (Live-Umleitung an die gepinnte DID) wird NICHT gebaut:
// sie braucht Prod-DB/`.env`-Ziele, die dieser Worktree nicht hat, und wuerde einen echten
// Produktions-Inbound (Buchung, Inbox, Benachrichtigung) ausloesen. Die Live-Umleitung bleibt
// eine Messung am ersten realen Fehlerfall (Spec 8).
//
// IEP-P1: dritte Zaehler-Gruppe "ohrzeuge" - der EINZIGE Weg, der eine echte Telefonnummer
// waehlt (die eigene gepinnte DID) und dabei dual-kanalig mitschneidet. Sie hat einen eigenen,
// ENGEREN Pruefer (vier Riegel, s. scripts/iel-mess-ohrzeuge.mjs), kein setup/teardown und
// keinen Anbieter-Schreibzugriff. "m1" und "nachdeploy" bleiben unberuehrt.
//
// Aufruf:  node scripts/iel-mess.mjs <fall|status|setup|teardown|sprechspur> [--dry-run]
//          node scripts/iel-mess.mjs setup --nachdeploy|--nur-ausgehend [--dry-run]
// Faelle und ihre Parameter: scripts/iel-mess.cases.json (Aenderungen NUR dort).
//
// Sicherungen IM Skript, nicht per Konvention:
//   - Zaehler je Fall-Gruppe (Pflichtfeld "zaehler" im Fall): "m1" -> tasks/iel-m1-zaehler.json,
//     max 5. "nachdeploy" -> tasks/iel-nachdeploy-zaehler.json, max 3. "ohrzeuge" ->
//     tasks/iel-ohrzeuge-zaehler.json, max 18. Jede Gruppe hat eigene Sperr- und Ergebnisdatei.
//     Gezaehlt wird VOR dem Senden. Fehlt oder zerfaellt die Zaehlerdatei einer Gruppe, wird
//     verweigert - Loeschen setzt nichts zurueck.
//   - Sperrdatei je Gruppe: nie zwei Mess-Anrufe derselben Gruppe gleichzeitig.
//   - Je Anruf <= 60 s: Anbieter-Grenzen (TeXML TimeLimit + <Dial timeLimit>, Call-Control
//     time_limit_secs) UND aktives Auflegen per API (Wachhund, Nachfassen, unabhaengiger
//     Notaus-Timer, SIGINT/SIGTERM). Diese Stufen gelten fuer ALLE Gruppen gleich.
//   - Nur SIP-Ziele: M1 ElevenLabs-SIP mit Spike2- oder fiktiver 555-01xx-Kennung, oder die
//     nie antwortende TEST-NET-Adresse. Nachdeploy NUR ElevenLabs-SIP mit fiktiver 555-01xx-
//     Kennung (kein Spike2, kein TEST-NET). Ausnahme ist allein die Ohrzeugen-Gruppe: sie
//     waehlt genau EINE gepinnte Nummer (OHRZEUGE_ZIEL_PIN, ausgeliefert leer = verweigert).
//   - --dry-run sendet nichts: fetch ist per Stolperdraht gesperrt und wird gezaehlt;
//     Zaehler, Sperre und Ergebnisdatei werden nicht geschrieben.
//   - Schluessel nur aus .env (src/config.js), nie in einer Ausgabe.

import { istTrockenlauf, netzaufrufeImTrockenlauf, TROCKENLAUF_SCHALTER } from "./iel-mess-stolperdraht.mjs";

import { createHash, randomBytes } from "node:crypto";
import { appendFile, access, open, readFile, rename, unlink, writeFile } from "node:fs/promises";

import { config } from "../src/config.js";
import { holeRegistrierungen, inventarSchnappschuss } from "../src/elevenlabs/nummern-registrierung.js";
import { synthesizeSpeechStream } from "../src/tts/synth.js";
import * as anbieter from "./iel-mess-anbieter.mjs";
import {
  sammleCallEvents,
  sammleDetailRecords,
  sammleElGespraeche,
  sammleNachdeployBelege,
  sammleOhrzeugeBelege,
  werteMitschnittAus,
} from "./iel-mess-belege.mjs";
import { ohrzeugeSperrenGrund, ohrzeugeVorlaufGrund, sprechspurKommandoId } from "./iel-mess-ohrzeuge.mjs";

// --- Owner-Grenzen -----------------------------------------------------------------------
const MAX_ANRUFE = 5;
const MAX_NACHDEPLOY_ANRUFE = 3;
// IEP-P1, Owner-Entscheidung 11 (tasks/todo.md): harter Deckel der Ohrzeugen-Messanrufe.
const MAX_OHRZEUGE_ANRUFE = 18;
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
  wegwerf: new URL("../tasks/iel-m1-wegwerf.json", import.meta.url),
});

const TASKS = new URL("../tasks/", import.meta.url);

function tasksDatei(name) {
  return Object.freeze({ url: new URL(name, TASKS), anzeige: `tasks/${name}` });
}

// --- IEP-P1: Ohrzeuge ---------------------------------------------------------------------
// LEER = jeder Ohrzeugen-Lauf verweigert. Der Wert wird EINMAL vom Lead gesetzt, nachdem
// belegt ist, welche DID dem Mess-Tenant gehoert - er wird NIE geraten und steht bewusst in
// git (reviewbar) statt in einer lokal aenderbaren Shell-Variablen.
const OHRZEUGE_ZIEL_PIN = "";
const MITSCHNITT_MP3 = "mp3";
// dual-kanalig und unkomprimiert - die Kennzahlen rechnen auf den Proben, nicht auf mp3.
const MITSCHNITT_WAV = "wav";
const SPRECHSPUR = tasksDatei("iel-ohrzeuge-sprechspur.mp3");
const VORLAUF = tasksDatei("iel-ohrzeuge-vorlauf.json");

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

async function leseZaehler(gruppe) {
  const zaehler = await leseJson(gruppe.zaehler.url, `Zaehlerdatei ${gruppe.zaehler.anzeige} fehlt oder ist unlesbar - verweigert`);
  if (!Number.isInteger(zaehler.ausgeloest) || zaehler.ausgeloest < 0 || !Array.isArray(zaehler.anrufe)) {
    throw new Verweigerung("Zaehlerdatei hat keine gueltige Form - verweigert");
  }
  if (zaehler.ausgeloest >= gruppe.max) {
    throw new Verweigerung(`Anruf-Budget erschoepft: ${zaehler.ausgeloest}/${gruppe.max} ausgeloest`);
  }
  return zaehler;
}

// Echt: schreibt Zaehler, Sperre, Ergebnis. Trocken: liest nur und zeigt, was geschaehe.
function echteBuchhaltung(gruppe) {
  return {
    async mitSperre(handlung) {
      const sperre = await open(gruppe.sperre.url, "wx").catch(() => {
        throw new Verweigerung(`Sperrdatei ${gruppe.sperre.anzeige} existiert (laufender oder abgestuerzter Lauf) - verweigert`);
      });
      try {
        return await handlung();
      } finally {
        await sperre.close();
        await unlink(gruppe.sperre.url);
      }
    },
    async reserviere({ name, laufId }) {
      const zaehler = await leseZaehler(gruppe);
      zaehler.ausgeloest += 1;
      zaehler.anrufe.push({ nr: zaehler.ausgeloest, fall: name, lauf_id: laufId, zeitpunkt: new Date().toISOString() });
      await schreibeAtomar(gruppe.zaehler.url, zaehler);
      return zaehler.ausgeloest;
    },
    schreibe: (zeile) => appendFile(gruppe.ergebnis.url, `${JSON.stringify(zeile)}\n`),
  };
}

function trockeneBuchhaltung(gruppe) {
  return {
    async mitSperre(handlung) {
      if (await existiert(gruppe.sperre.url)) throw new Verweigerung(`Sperrdatei ${gruppe.sperre.anzeige} existiert - ein echter Lauf wuerde verweigert`);
      return handlung();
    },
    async reserviere() {
      const zaehler = await leseZaehler(gruppe);
      console.log(`[TROCKEN] Zaehler ${zaehler.ausgeloest}/${gruppe.max} -> echt waere es ${zaehler.ausgeloest + 1}/${gruppe.max} (nicht geschrieben)`);
      return zaehler.ausgeloest + 1;
    },
    async schreibe(zeile) {
      console.log(`[TROCKEN] Ergebniszeile mit Musterwerten (nicht geschrieben):\n${JSON.stringify(zeile)}`);
    },
  };
}

function buchhaltungFuer(gruppe) {
  return istTrockenlauf ? trockeneBuchhaltung(gruppe) : echteBuchhaltung(gruppe);
}

// Wegwerf-Registrierung (setup/teardown): EIN gemeinsamer Zustand fuer alle Setup-Varianten
// (M1 ohne Agent, Nachdeploy am Agenten, Nachdeploy nur-ausgehend) - es kann immer nur eine
// geben, teardown baut sie wieder ab, bevor die naechste angelegt wird.
function echteWegwerfAblage() {
  return {
    merke: (zustand) => schreibeAtomar(PFADE.wegwerf, zustand),
    vergiss: () => unlink(PFADE.wegwerf),
    async idFuerFall() {
      const zustand = await leseJson(PFADE.wegwerf, "Fall braucht die Wegwerf-Registrierung: erst 'setup' (tasks/iel-m1-wegwerf.json fehlt)");
      return zustand.phone_number_id;
    },
  };
}

function trockeneWegwerfAblage() {
  return {
    async merke(zustand) {
      console.log(`[TROCKEN] wuerde tasks/iel-m1-wegwerf.json schreiben: ${JSON.stringify(zustand)}`);
    },
    async vergiss() {
      console.log("[TROCKEN] wuerde tasks/iel-m1-wegwerf.json loeschen");
    },
    // Ohne Wegwerf-Datei verweigert ein echter Lauf, bevor die Zaehlerzeile erscheint (V5):
    // der Trockenlauf zeigt trotzdem die Musterkennung, statt selbst zu verweigern.
    async idFuerFall() {
      if (await existiert(PFADE.wegwerf)) {
        const zustand = await leseJson(PFADE.wegwerf, "tasks/iel-m1-wegwerf.json unlesbar");
        return zustand.phone_number_id;
      }
      console.log("[TROCKEN] tasks/iel-m1-wegwerf.json fehlt - echt waere erst 'setup' noetig; Musterkennung <phone_number_id>");
      return "<phone_number_id>";
    },
  };
}

function wegwerfAblageFuer() {
  return istTrockenlauf ? trockeneWegwerfAblage() : echteWegwerfAblage();
}

// --- Zaehler-Gruppen -----------------------------------------------------------------------

async function keineZusatzbelege() {
  return {};
}

async function keineZusatzpruefung() {}

// Der Ohrzeuge wertet seinen Mitschnitt in sammleOhrzeugeBelege aus - EIN Download, EINE
// STT-Anfrage (G5). null heisst: dieser Gruppe gehoert kein eigenes mitschnitt-Feld im Beleg.
async function ohneEigeneMitschnittAuswertung() {
  return null;
}

const ZAEHLER_GRUPPEN = Object.freeze({
  m1: Object.freeze({
    max: MAX_ANRUFE,
    zaehler: tasksDatei("iel-m1-zaehler.json"),
    sperre: tasksDatei("iel-m1-zaehler.lock"),
    ergebnis: tasksDatei("iel-m1-messung.jsonl"),
    artPraefix: "iel-m1",
    pruefeZiel: (fall) => pruefeSipZiel(fall.sip_ziel),
    pruefeVorAnruf: keineZusatzpruefung,
    mitschnittFormat: MITSCHNITT_MP3,
    werteMitschnitt: werteMitschnittAus,
    sammleZusatzbelege: keineZusatzbelege,
  }),
  nachdeploy: Object.freeze({
    max: MAX_NACHDEPLOY_ANRUFE,
    zaehler: tasksDatei("iel-nachdeploy-zaehler.json"),
    sperre: tasksDatei("iel-nachdeploy-zaehler.lock"),
    ergebnis: tasksDatei("iel-nachdeploy-messung.jsonl"),
    artPraefix: "iel-nachdeploy",
    pruefeZiel: (fall) => pruefeFiktivesElZiel(fall.sip_ziel),
    pruefeVorAnruf: keineZusatzpruefung,
    mitschnittFormat: MITSCHNITT_MP3,
    werteMitschnitt: werteMitschnittAus,
    sammleZusatzbelege: sammleNachdeployBelege,
  }),
  // IEP-P1: der Ohrzeuge waehlt eine ECHTE Nummer und laeuft NICHT durch
  // src/telephony/outbound-gates.js - deshalb liegt der Notaus hier im Riegel, sonst haette
  // der Kill-Switch eine Luecke (CLAUDE.md Regel 1).
  ohrzeuge: Object.freeze({
    max: MAX_OHRZEUGE_ANRUFE,
    zaehler: tasksDatei("iel-ohrzeuge-zaehler.json"),
    sperre: tasksDatei("iel-ohrzeuge-zaehler.lock"),
    ergebnis: tasksDatei("iel-ohrzeuge-messung.jsonl"),
    artPraefix: "iel-ohrzeuge",
    pruefeZiel: pruefeOhrzeugeZiel,
    pruefeVorAnruf: pruefeOhrzeugeVorAnruf,
    mitschnittFormat: MITSCHNITT_WAV,
    werteMitschnitt: ohneEigeneMitschnittAuswertung,
    sammleZusatzbelege: sammleOhrzeugeBelege,
  }),
});

function belegArt(gruppe, endung) {
  return `${gruppe.artPraefix}-${endung}`;
}

// IEP-P1 Review-Fix: "art" (bestimmt den gewaehlten Weg in WEGE) und "zaehler" (bestimmt die
// gepruefte Riegel-Gruppe) sind zwei freie Felder in scripts/iel-mess.cases.json - ohne diese
// Bindung koennte ein Fall mit art "texml-ohrzeuge" (waehlt eine echte Nummer) unter einem
// fremden Zaehler laufen (schwaechere SIP-Riegel statt der vier Ohrzeugen-Riegel) oder
// umgekehrt ein SIP-Fall unter dem Zaehler "ohrzeuge" (die Ohrzeugen-Riegel pruefen dann ein
// Ziel, das gar nicht gewaehlt wird). Deshalb: exakt symmetrische Paarung, plus das Feld
// "ziel_e164" (die einzige Nummer, die ueberhaupt gewaehlt wird) ausserhalb dieser Gruppe verboten.
const OHRZEUGE_ART = "texml-ohrzeuge";
const OHRZEUGE_ZAEHLER = "ohrzeuge";

function pruefeArtZaehlerPaarung(fall) {
  const artIstOhrzeuge = fall.art === OHRZEUGE_ART;
  const zaehlerIstOhrzeuge = fall.zaehler === OHRZEUGE_ZAEHLER;
  if (artIstOhrzeuge !== zaehlerIstOhrzeuge) {
    throw new Verweigerung(
      `Fall-Art "${fall.art}" und Zaehler-Gruppe "${fall.zaehler}" sind unvereinbar - "${OHRZEUGE_ART}" gehoert ausschliesslich zu Zaehler "${OHRZEUGE_ZAEHLER}" und umgekehrt - verweigert`,
    );
  }
  if (!zaehlerIstOhrzeuge && fall.ziel_e164 !== undefined) {
    throw new Verweigerung(`Feld ziel_e164 ist nur in der Zaehler-Gruppe "${OHRZEUGE_ZAEHLER}" erlaubt - verweigert`);
  }
}

function gruppeFuer(name, fall) {
  if (!Object.hasOwn(ZAEHLER_GRUPPEN, fall.zaehler ?? "")) {
    throw new Verweigerung(`Fall ${name} nennt keine gueltige Zaehler-Gruppe (zaehler: ${Object.keys(ZAEHLER_GRUPPEN).join("|")}) - verweigert`);
  }
  pruefeArtZaehlerPaarung(fall);
  return ZAEHLER_GRUPPEN[fall.zaehler];
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

function pruefeAgentKennung() {
  if (!config.voice.elevenLabsOutbound.agentId) throw new Bedienfehler("Fehlt in .env: ELEVENLABS_AGENT_ID");
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

// IEL-B11 (Nachdeploy): enger als pruefeSipZiel - nur ElevenLabs-SIP mit fiktiver Kennung.
// Weder Spike2 noch die stumme TEST-NET-Adresse sind hier erlaubte Nachdeploy-Ziele (V4).
function pruefeFiktivesElZiel(sipZiel) {
  const teile = sipZielTeile(sipZiel);
  if (!teile) throw new Verweigerung(`sip_ziel hat keine SIP-URI-Form: ${anbieter.maskiereNummern(sipZiel)}`);
  if (teile.host !== EL_SIP_HOST || !FIKTIVE_KENNUNG.test(teile.kennung)) {
    throw new Verweigerung("Nach-Deploy-Ziel muss ElevenLabs-SIP mit fiktiver 555-01xx-Kennung sein - verweigert");
  }
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

// Ein Fall, der eine zugewiesene Registrierung voraussetzt, braucht auch den Agenten in
// .env - sonst waere der spaetere Vergleich blind (pruefeRegistrierungsErwartung).
function pruefeErwartungsKonfiguration(fall) {
  if (fall.registrierung_erwartet?.agent) pruefeAgentKennung();
}

// --- IEP-P1: die vier Riegel und der Vorlauf-Beleg ---------------------------------------
// Die Entscheidung selbst liegt rein in scripts/iel-mess-ohrzeuge.mjs; hier steht nur, wo
// die Eingaben herkommen und dass eine Verweigerung wirklich wirft.

function werfeWennGesperrt(grund) {
  if (grund) throw new Verweigerung(grund);
}

function ohrzeugeUmgebung() {
  return {
    outboundFrozen: config.safety.outboundFrozen,
    inboundTenantIds: config.voice.elevenLabsInbound.tenantIds,
    inboundScope: config.voice.elevenLabsInbound.scope,
  };
}

function pruefeOhrzeugeZiel(fall) {
  werfeWennGesperrt(ohrzeugeSperrenGrund({ fall, pin: OHRZEUGE_ZIEL_PIN, umgebung: ohrzeugeUmgebung() }));
}

// Dieselbe Datei fuer alle Laeufe: der Pin in iel-mess.cases.json belegt, dass genau die
// gerenderte Sprechspur gespielt wird und nicht irgendeine Datei gleichen Namens.
async function ladeSprechspur(ohrzeuge) {
  const pin = ohrzeuge?.sprechspur_sha256;
  if (!pin) throw new Verweigerung("Sprechspur nicht gepinnt (ohrzeuge.sprechspur_sha256 fehlt) - verweigert");
  const bytes = await readFile(SPRECHSPUR.url).catch(() => null);
  if (!bytes) throw new Verweigerung(`Sprechspur ${SPRECHSPUR.anzeige} fehlt - erst 'sprechspur' rendern`);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== pin) throw new Verweigerung("Sprechspur weicht vom Pin ab - verweigert");
  return { base64: bytes.toString("base64"), sha256: hash };
}

// Eigentumsbeleg ueber den Transport (also trockenlauffest): je Nummer die Trefferliste,
// exakt verglichen wird in ohrzeugeVorlaufGrund.
async function leseKontoNummern(kontext, nummern) {
  const treffer = {};
  for (const nummer of nummern) {
    const antwort = await kontext.transport.senden(anbieter.kontoNummerAnfrage(nummer));
    if (!antwort.ok) throw new Verweigerung(`Konto-Nummern nicht lesbar (HTTP ${antwort.status}) - kein Anruf`);
    treffer[nummer] = antwort.json?.data ?? [];
  }
  return treffer;
}

function vorlaufSicht(vorlauf) {
  return {
    belegt_am: vorlauf.belegt_am ?? null,
    tenant_id: vorlauf.tenant_id ?? null,
    ziel_did: maskiert(vorlauf.ziel_did),
    sms_summary_opt_in: vorlauf.sms_summary_opt_in ?? null,
    private_number_treffer: vorlauf.private_number_treffer ?? null,
    kostendecke_rest_cents: vorlauf.kostendecke_rest_cents ?? null,
  };
}

async function pruefeOhrzeugeVorAnruf(kontext) {
  const vorlauf = await leseJson(VORLAUF.url, `Vorlauf-Beleg ${VORLAUF.anzeige} fehlt oder ist unlesbar - verweigert`);
  const kontoNummern = await leseKontoNummern(kontext, [kontext.fall.ziel_e164, kontext.fall.anrufer_kennung]);
  werfeWennGesperrt(ohrzeugeVorlaufGrund({ fall: kontext.fall, vorlauf, kontoNummern, umgebung: ohrzeugeUmgebung(), jetztMs: Date.now() }));
  Object.assign(kontext, { sprechspur: await ladeSprechspur(kontext.konfiguration.ohrzeuge) });
  Object.assign(kontext.beleg, { vorlauf: vorlaufSicht(vorlauf) });
}

function pruefeAnrufFall(kontext) {
  const { fall, header, gruppe } = kontext;
  gruppe.pruefeZiel(fall);
  pruefeAnruferKennung(fall.anrufer_kennung);
  pruefeDialTimeout(fall.dial_timeout_s);
  pruefeElternAuflegenNachS(fall.eltern_auflegen_nach_s);
  pruefeHeaderNamen(header);
  pruefeErwartungsKonfiguration(fall);
}

async function loeseRegistrierungsId(kontext, id) {
  if (id !== "wegwerf") return id ?? null;
  return kontext.wegwerf.idFuerFall();
}

// Die EINE Projektion einer Registrierung, die Faelle und Setup teilen (G5): erwarteter
// Agent (Positiv-Kontrolle) und ob/wie Inbound konfiguriert ist.
function registrierungsSicht({ id, daten, anruferKennung }) {
  return {
    id,
    agentId: daten.assigned_agent?.agent_id ?? null,
    eingehend_konfiguriert: Boolean(daten.inbound_trunk),
    anrufer_in_allowed_numbers: (daten.inbound_trunk?.allowed_numbers ?? []).includes(anruferKennung),
  };
}

function pruefeRegistrierungsErwartung(sicht, erwartet) {
  if (!erwartet) return;
  if (!sicht) throw new Verweigerung("Fall erwartet eine Registrierung, nennt aber keine el_registrierung_id - verweigert");
  if (erwartet.agent && sicht.agentId !== config.voice.elevenLabsOutbound.agentId) {
    throw new Verweigerung("Registrierung ist nicht ELEVENLABS_AGENT_ID zugewiesen - erst 'setup --nachdeploy' bzw. 'setup --nur-ausgehend' - verweigert");
  }
  if (sicht.eingehend_konfiguriert !== erwartet.inbound_trunk) {
    throw new Verweigerung(`Registrierung ${sicht.eingehend_konfiguriert ? "mit" : "ohne"} inbound_trunk passt nicht zum Messaufbau - verweigert`);
  }
}

// Liest die Registrierung VOR dem Anruf: erwarteter Agent (Positiv-Kontrolle fuer F-A) und
// Abgleich, dass das SIP-Ziel wirklich diese Registrierung meint - sonst waere der Anruf blind.
async function leseRegistrierung(kontext) {
  const id = await loeseRegistrierungsId(kontext, kontext.fall.el_registrierung_id);
  if (!id) return null;
  const antwort = await kontext.transport.senden(anbieter.elRegistrierungAnfrage(id));
  if (!antwort.ok) throw new Verweigerung(`Registrierung nicht lesbar (HTTP ${antwort.status})`);
  const daten = antwort.json ?? {};
  const kennung = sipZielTeile(kontext.fall.sip_ziel).kennung;
  if (daten.phone_number !== kennung || !istErlaubteElKennung(daten.phone_number)) {
    throw new Verweigerung("Registrierung und SIP-Ziel meinen verschiedene Kennungen - verweigert");
  }
  const sicht = registrierungsSicht({ id, daten, anruferKennung: kontext.fall.anrufer_kennung });
  pruefeRegistrierungsErwartung(sicht, kontext.fall.registrierung_erwartet);
  return sicht;
}

async function pruefeRegistrierungVorAnruf(kontext) {
  const registrierung = await leseRegistrierung(kontext);
  Object.assign(kontext, { registrierung });
  Object.assign(kontext.beleg, { registrierung });
}

// IEL-B11 (N2): Trunk-Inventar VOR dem Anruf, nur lesend, ueber den B9-Helfer - laeuft damit
// ueber denselben Transport und ist trockenlauffest. Nur fuer Faelle mit n2_protokoll.
async function merkeInventarVorAnruf(kontext) {
  if (!kontext.fall.n2_protokoll) return;
  try {
    const registrierungen = await holeRegistrierungen({
      fetchImpl: anbieter.elLeseFetchUeber(kontext.transport),
      account: config.voice.elevenLabsOutbound,
    });
    Object.assign(kontext.beleg, { trunk_inventar: registrierungen.map(inventarSchnappschuss) });
  } catch (fehler) {
    throw new Verweigerung(`Trunk-Inventar vor dem Anruf nicht lesbar (HTTP ${fehler.providerStatus ?? "unbekannt"}) - kein Anruf`);
  }
}

// --- Kontext ---------------------------------------------------------------------------

function mitLaufId(header, laufId) {
  return Object.fromEntries(Object.entries(header ?? {}).map(([name, wert]) => [name, String(wert).replace("{{lauf_id}}", laufId)]));
}

function maskiert(text) {
  return text ? anbieter.maskiereNummern(text) : null;
}

function neuerBeleg({ name, fall, laufId, header, gruppe }) {
  const ziel = sipZielTeile(fall.sip_ziel);
  return {
    art: belegArt(gruppe, "anruf"),
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
      // Nur die Ohrzeugen-Gruppe waehlt eine Nummer; fuer alle anderen bleibt das Feld weg.
      ...(fall.ziel_e164 ? { ziel_e164: maskiert(fall.ziel_e164) } : {}),
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

// Fallback-Kette fuer die Test-Kennung des Trockenlauf-Musters: SIP-Ziel > el_kennung >
// das Setup-Feld der jeweils passenden Sektion (M1 "setup" oder "setup_nachdeploy").
function elKennungFuer({ fall, konfiguration, setupVariante }) {
  const setupSektion = setupVariante ? konfiguration.setup_nachdeploy : konfiguration.setup;
  return sipZielTeile(fall.sip_ziel)?.kennung ?? fall.el_kennung ?? setupSektion?.el_nummer;
}

function trockenMusterFuer({ fall, konfiguration, setupVariante, laufId }) {
  const erwartung = fall.registrierung_erwartet ?? setupVariante?.erwartet;
  return {
    elKennung: elKennungFuer({ fall, konfiguration, setupVariante }),
    laufId,
    registrierungId: fall.el_registrierung_id,
    label: konfiguration.setup?.label,
    agentId: config.voice.elevenLabsOutbound.agentId,
    ohneInbound: erwartung?.inbound_trunk === false,
  };
}

function baueKontext({ name, fall, konfiguration, gruppe, setupVariante }) {
  const laufId = `iel-${Date.now().toString(LAUF_ZEIT_BASIS)}-${randomBytes(LAUF_ZUFALL_BYTES).toString("hex")}`;
  const header = mitLaufId(konfiguration.gemeinsam.probe_header, laufId);
  const uhr = istTrockenlauf ? anbieter.trockeneUhr() : anbieter.echteUhr();
  const muster = trockenMusterFuer({ fall, konfiguration, setupVariante, laufId });
  return {
    name,
    fall,
    gemeinsam: konfiguration.gemeinsam,
    konfiguration,
    gruppe,
    setupVariante,
    laufId,
    header,
    uhr,
    transport: istTrockenlauf ? anbieter.trockenerTransport({ uhr, kontext: muster }) : anbieter.echterTransport(),
    buchhaltung: gruppe ? buchhaltungFuer(gruppe) : null,
    wegwerf: wegwerfAblageFuer(),
    griffe: {},
    beleg: gruppe ? neuerBeleg({ name, fall, laufId, header, gruppe }) : null,
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
    // trim/play_beep bleiben AUS: ein Beep waere unser eigener Fremdton, trim verschoebe die
    // Zeitachse, an der M-S2 gemessen wird.
    const koerper = { format: kontext.gruppe.mitschnittFormat, channels: "dual" };
    merkeSchritt(kontext, "mitschnitt_start", await kontext.transport.senden(aktion("record_start", koerper)));
  }
}

async function ccBeinBeendet(kontext, callControlId) {
  const antwort = await kontext.transport.senden(anbieter.ccStatusAnfrage(callControlId));
  return antwort.status === HTTP_NICHT_GEFUNDEN || antwort.json?.data?.is_alive === false;
}

// Beide TeXML-Wege teilen Start, Endeerkennung und Auflege-Griff; sie unterscheiden sich NUR
// im Dokument, das gesendet wird (Bruecke an ein SIP-Ziel gegen Ohrzeuge an eine Nummer).
function texmlWeg(anfrageBauer) {
  return {
    async starte(kontext) {
      const antwort = merkeSchritt(kontext, "texml_anlegen", await kontext.transport.senden(anfrageBauer(kontext)));
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
  };
}

const WEGE = Object.freeze({
  "texml-bruecke": texmlWeg(anbieter.texmlAnrufAnfrage),
  "texml-ohrzeuge": texmlWeg(anbieter.texmlOhrzeugeAnfrage),
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

// IEP-P1: der kontrollierte Anrufer-Text. Ohne ihn gibt es keine Turn-Luecke zu messen und
// keinen Wirkungsbeleg in P4. Eigene command_id, damit Kennzahl (iii) unsere Spur nicht als
// Fremdton zaehlt.
async function spieleSprechspurWennGefordert(kontext) {
  const nachS = kontext.fall.sprechspur_nach_s;
  if (!nachS || !kontext.griffe.ccId) return;
  if (await warteAufEnde(kontext, nachS)) return;
  const anfrage = anbieter.ccSprechspurAnfrage(kontext.griffe.ccId, {
    inhaltBase64: kontext.sprechspur.base64,
    kommandoId: sprechspurKommandoId(kontext.laufId),
  });
  merkeSchritt(kontext, "sprechspur_start", await kontext.transport.senden(anfrage));
}

async function begleiteBisEnde(kontext) {
  await spieleSprechspurWennGefordert(kontext);
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
    console.error("ACHTUNG: Registrierung NICHT im Ausgangszustand - von Hand pruefen (Ergebnisdatei, Feld digest)");
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

async function sammleBelegeNachAnruf(kontext) {
  const { hauptbein, ccId, ccLeg, ccSession } = kontext.griffe;
  const kennungen = {
    hauptbein: hauptbein ?? null,
    hauptbein_quelle: kontext.griffe.hauptbeinQuelle ?? null,
    call_control_id: ccId ?? null,
    call_leg_id: ccLeg ?? null,
    call_session_id: ccSession ?? null,
  };
  Object.assign(kontext.beleg, { kennungen });
  await kontext.uhr.warte(EL_NACHLAUF_MS);
  Object.assign(kontext.beleg, { elevenlabs: await sammleElGespraeche(kontext) });
  Object.assign(kontext.beleg, { telnyx_ereignisse: await sammleCallEvents(kontext) });
  if (!kontext.fall.mitschnitt) return;
  const mitschnitt = await kontext.gruppe.werteMitschnitt(kontext);
  if (mitschnitt) Object.assign(kontext.beleg, { mitschnitt });
}

async function messeAnruf(kontext) {
  pruefeAnrufFall(kontext);
  pruefeSchluessel();
  // Budget zuerst: ist es erschoepft, geht nicht einmal die lesende Vorab-Anfrage hinaus.
  await leseZaehler(kontext.gruppe);
  await pruefeRegistrierungVorAnruf(kontext);
  await merkeInventarVorAnruf(kontext);
  // ohrzeuge: Vorlauf-Beleg, Konto-DIDs, Sprechspur - alles VOR der Reservierung.
  await kontext.gruppe.pruefeVorAnruf(kontext);
  await kontext.buchhaltung.mitSperre(async () => {
    const anruf = async () => {
      const nr = await kontext.buchhaltung.reserviere(kontext);
      Object.assign(kontext.beleg, { nr });
      await fuehreAnrufDurch(kontext);
    };
    await (kontext.fall.digest ? mitDigestZugang(kontext, anruf) : anruf());
  });
  await sammleBelegeNachAnruf(kontext);
  Object.assign(kontext.beleg, await kontext.gruppe.sammleZusatzbelege(kontext));
  await kontext.buchhaltung.schreibe(kontext.beleg);
}

// --- Faelle ohne Anruf -----------------------------------------------------------------

async function leseProtokollierteKennungen(gruppe) {
  if (!(await existiert(gruppe.ergebnis.url))) return [];
  const inhalt = await readFile(gruppe.ergebnis.url, "utf8");
  const zeilen = inhalt.split("\n").filter(Boolean).map((zeile) => JSON.parse(zeile));
  const anrufe = zeilen.filter((zeile) => zeile.art === belegArt(gruppe, "anruf") && !zeile.trockenlauf);
  return anrufe.flatMap((anruf) => [
    ...Object.values(anruf.kennungen ?? {}),
    ...(anruf.elevenlabs?.gespraeche ?? []).map((gespraech) => gespraech.conversation_id),
  ]);
}

async function messeDetailRecords(kontext) {
  pruefeSchluessel();
  const kennungen = await leseProtokollierteKennungen(kontext.gruppe);
  const typen = kontext.gemeinsam.detail_record_typen;
  const ergebnis = await sammleDetailRecords({ transport: kontext.transport, typen, kennungen });
  await kontext.buchhaltung.schreibe({
    art: belegArt(kontext.gruppe, "detail-records"),
    zeitpunkt: new Date().toISOString(),
    trockenlauf: istTrockenlauf,
    kennungen: kennungen.length,
    typen: ergebnis,
  });
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
  const id = await loeseRegistrierungsId(kontext, fall.el_registrierung_id);
  const vorher = await leseRegistrierungRoh(kontext, id);
  if (vorher.phone_number !== fall.el_kennung) throw new Verweigerung("Registrierung traegt nicht die erwartete el_kennung - kein PATCH");
  const vorherInbound = alsInboundKonfiguration(vorher.inbound_trunk);
  const patch = await transport.senden(anbieter.elRegistrierungPatch(id, { inbound_trunk_config: fall.inbound_patch ?? vorherInbound }));
  const nachher = await leseRegistrierungRoh(kontext, id);
  const zurueck = fall.inbound_patch ? await transport.senden(anbieter.elRegistrierungPatch(id, { inbound_trunk_config: vorherInbound })) : null;
  await kontext.buchhaltung.schreibe({
    art: belegArt(kontext.gruppe, "registrierung"),
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

const SETUP_VARIANTEN = Object.freeze({
  "--nachdeploy": Object.freeze({ baueKoerper: anbieter.wegwerfKoerperAmAgenten, erwartet: Object.freeze({ agent: true, inbound_trunk: true }) }),
  "--nur-ausgehend": Object.freeze({ baueKoerper: anbieter.wegwerfKoerperNurAusgehend, erwartet: Object.freeze({ agent: true, inbound_trunk: false }) }),
});

// Gemeinsame Anlage-Naht fuer M1 ("setup") und Nachdeploy ("setup --variante"): existiert-
// Pruefung, fiktiv-Pruefung, POST, Wegwerf-Zustand merken. Liefert die phone_number_id.
async function legeRegistrierungAn(kontext, { abschnitt, koerperFuer }) {
  if (await existiert(PFADE.wegwerf)) throw new Verweigerung("tasks/iel-m1-wegwerf.json existiert - erst 'teardown'");
  const setup = kontext.konfiguration[abschnitt];
  if (!FIKTIVE_KENNUNG.test(setup.el_nummer)) throw new Verweigerung(`${abschnitt}.el_nummer muss eine fiktive 555-01xx-Kennung sein`);
  const antwort = await kontext.transport.senden(anbieter.elRegistrierungAnlegen(koerperFuer(setup)));
  if (!antwort.ok) throw new Error(`Anlegen fehlgeschlagen (HTTP ${antwort.status})`);
  const id = antwort.json?.phone_number_id;
  await kontext.wegwerf.merke({ phone_number_id: id, label: setup.label, angelegt: new Date().toISOString() });
  return id;
}

async function legeWegwerfAn(kontext) {
  pruefeSchluessel();
  await legeRegistrierungAn(kontext, { abschnitt: "setup", koerperFuer: anbieter.wegwerfKoerper });
}

async function belegeWegwerfOderRaeumeAb(kontext, id) {
  try {
    const daten = await leseRegistrierungRoh(kontext, id);
    const sicht = registrierungsSicht({ id, daten, anruferKennung: kontext.konfiguration.setup_nachdeploy.anrufer_kennung });
    pruefeRegistrierungsErwartung(sicht, kontext.setupVariante.erwartet);
    console.log(`Wegwerf-Registrierung belegt: Agent ja, inbound_trunk ${sicht.eingehend_konfiguriert ? "ja" : "nein"}`);
  } catch (fehler) {
    await raeumeWegwerfAb(kontext).catch(() => console.error("ACHTUNG: Wegwerf-Registrierung nicht abgebaut - 'teardown' erneut ausfuehren"));
    throw fehler;
  }
}

async function legeNachdeployWegwerfAn(kontext) {
  pruefeSchluessel();
  pruefeAgentKennung();
  const { setupVariante: variante, konfiguration } = kontext;
  const id = await legeRegistrierungAn(kontext, {
    abschnitt: "setup_nachdeploy",
    koerperFuer: (setup) => variante.baueKoerper({ setup, agentId: config.voice.elevenLabsOutbound.agentId, zugang: wegwerfZugangsdaten() }),
  });
  Object.assign(kontext, { konfiguration });
  await belegeWegwerfOderRaeumeAb(kontext, id);
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
  await kontext.wegwerf.vergiss();
}

// --- IEP-P1: Sprechspur rendern (einmalig, kein Zaehler, kein Anruf) ----------------------
// EINE TTS-Naht (src/tts/synth.js), derselbe Weg wie im Produktionspfad. Ergebnis ist eine
// Datei plus ihr SHA-256 - der Hash wird in iel-mess.cases.json gepinnt und committed.

async function rendereSprechspur(kontext) {
  const text = kontext.konfiguration.ohrzeuge?.sprechspur_text;
  if (!text) throw new Bedienfehler("scripts/iel-mess.cases.json: ohrzeuge.sprechspur_text fehlt");
  if (istTrockenlauf) {
    console.log(`[TROCKEN] wuerde ${text.length} Zeichen synthetisieren und nach ${SPRECHSPUR.anzeige} schreiben (kein Netz)`);
    return;
  }
  const tts = config.voice.elevenLabsPlayTts;
  if (!(tts.apiKey && tts.voiceId)) throw new Bedienfehler("Fehlt in .env: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID");
  const strom = await synthesizeSpeechStream(text, {
    ...tts,
    fetchImpl: fetch,
    firstChunkTimeoutMs: tts.synthTimeoutMs,
    totalTimeoutMs: tts.synthTotalTimeoutMs,
  });
  if (!strom.ok) throw new Error(`Sprechspur-Synthese gescheitert (${strom.reason})`);
  const { bytes } = await strom.audio;
  await writeFile(SPRECHSPUR.url, bytes);
  console.log(`${SPRECHSPUR.anzeige} geschrieben: ${bytes.length} Bytes`);
  console.log(`sprechspur_sha256: ${createHash("sha256").update(bytes).digest("hex")}`);
}

// --- Status (offline) ------------------------------------------------------------------

const STATUS_NAME_BREITE = 16;
const STATUS_ART_BREITE = 24;
const STATUS_ZAEHLER_BREITE = 10;

async function leseZaehlerFuerStatus(zaehlerPfad) {
  try {
    const inhalt = await readFile(zaehlerPfad, "utf8");
    return JSON.parse(inhalt);
  } catch {
    return null;
  }
}

async function zeigeGruppenStatus(name, gruppe) {
  const zaehler = await leseZaehlerFuerStatus(gruppe.zaehler.url);
  const sperrePfad = gruppe.sperre.url;
  const sperre = (await existiert(sperrePfad)) ? "GESETZT" : "frei";
  console.log(`Zaehler ${name}: ${zaehler ? `${zaehler.ausgeloest}/${gruppe.max}` : "FEHLT (jeder Anruf wird verweigert)"}   Sperre: ${sperre}`);
}

async function zeigeStatus(kontext) {
  for (const [name, gruppe] of Object.entries(ZAEHLER_GRUPPEN)) {
    await zeigeGruppenStatus(name, gruppe);
  }
  console.log(`Wegwerf-Registrierung: ${(await existiert(PFADE.wegwerf)) ? "vermerkt" : "keine"}`);
  for (const [name, fall] of Object.entries(kontext.konfiguration.faelle)) {
    const anruf = Boolean(WEGE[fall.art]);
    console.log(
      `  ${name.padEnd(STATUS_NAME_BREITE)} ${fall.art.padEnd(STATUS_ART_BREITE)} ${(fall.zaehler ?? "?").padEnd(STATUS_ZAEHLER_BREITE)} ${anruf ? "ANRUF" : "kein Anruf"}${fall.braucht_setup ? ", braucht setup" : ""}`,
    );
  }
}

// --- Einstieg --------------------------------------------------------------------------

const UNTERBEFEHLE = Object.freeze({ status: zeigeStatus, setup: legeWegwerfAn, teardown: raeumeWegwerfAb, sprechspur: rendereSprechspur });
const ARTEN = Object.freeze({
  "texml-bruecke": messeAnruf,
  "texml-ohrzeuge": messeAnruf,
  "cc-direkt": messeAnruf,
  "detail-records": messeDetailRecords,
  "registrierung-vergleich": messeRegistrierungsVergleich,
});

// argv[0] = node, argv[1] = Skriptpfad - beide vor den eigentlichen Argumenten ueberspringen.
const CLI_ARGV_OFFSET = 2;

// Loest EINEN Aufruf-Eintrag auf: entweder "setup --variante" (Nachdeploy-Wegwerf-Anlage,
// braucht genau eine bekannte Option) oder ein Unterbefehl/Fall ohne jede Option. Alles
// andere (unbekannter Name, ueberzaehlige Optionen) ist kein gueltiger Eintrag.
function loeseEinstieg(argumente, konfiguration) {
  const [name, ...optionen] = argumente;
  if (name === "setup" && optionen.length === 1 && Object.hasOwn(SETUP_VARIANTEN, optionen[0])) {
    return { name, fall: {}, handlung: legeNachdeployWegwerfAn, gruppe: null, setupVariante: SETUP_VARIANTEN[optionen[0]] };
  }
  if (optionen.length > 0) return null;
  const fall = konfiguration.faelle[name];
  const handlung = UNTERBEFEHLE[name] ?? ARTEN[fall?.art];
  if (!handlung) return null;
  return { name, fall: fall ?? {}, handlung, gruppe: fall ? gruppeFuer(name, fall) : null, setupVariante: null };
}

async function hauptprogramm() {
  const argumente = process.argv.slice(CLI_ARGV_OFFSET).filter((argument) => argument !== TROCKENLAUF_SCHALTER);
  const konfiguration = JSON.parse(await readFile(PFADE.faelle, "utf8"));
  const eintrag = loeseEinstieg(argumente, konfiguration);
  if (!eintrag) {
    const erlaubt = [...Object.keys(UNTERBEFEHLE), ...Object.keys(konfiguration.faelle)].join(" | ");
    throw new Bedienfehler(
      `Aufruf: node scripts/iel-mess.mjs <${erlaubt}> [${TROCKENLAUF_SCHALTER}]  |  node scripts/iel-mess.mjs setup --nachdeploy|--nur-ausgehend [${TROCKENLAUF_SCHALTER}]`,
    );
  }
  await eintrag.handlung(baueKontext({ ...eintrag, konfiguration }));
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
