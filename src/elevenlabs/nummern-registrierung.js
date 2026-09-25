// OUTBOUND-E5 (F3): Lebenszyklus EINER ElevenLabs-SIP-Nummernregistrierung. Getrennt von der
// AUSWAHL (telephony/absender-registrierung.js, rein): hier liegt das Netz, dort die
// Entscheidung. IO injiziert (fetchImpl), damit jeder Test gegen eine Attrappe faehrt.
//
// DIE TRUNK-VORLAGE IST GEMESSEN, NICHT GERATEN: sie ist die outbound_trunk-Projektion der
// heute bestehenden Registrierung (GET /v1/convai/phone-numbers, 2026-08-29).
// Der ANLEGE-Koerper (registrierungsKoerper) traegt weiterhin KEIN inbound_trunk_config.
//
// IEL-B9: Lese-Helfer fuer Inventar und exakten Nummernabgleich, geteilt von
// scripts/el-nummern-registrierung.mjs (B9), iel-geheimnisse.mjs (B10) und iel-mess.mjs (B11).
//
// IEX-A10 (E13/E16): der Inbound-Trunk wird getrennt per PATCH geschrieben
// (makeInboundTrunkSchreiber), nur hinter inboundTrunkSchreibenErlaubt (inkl. Scope
// registrierte_dids). Zwei Aufrufer (Onboarding, Boot-Sweep-Reparatur), EINE Konstruktions-
// und Passwort-Lesestelle (inboundTrunkSchreiberWennErlaubt). Flottenweite Rotation bleibt
// scripts/iel-geheimnisse.mjs setzen; der Koerper ist mit dem Skript geteilt.
import {
  listPhoneNumbers,
  createPhoneNumber,
  deletePhoneNumber,
  fetchPhoneNumber,
  patchPhoneNumber,
} from "./convai.js";
import { e164Endung, istNichtLeererString, zugangsFingerabdruck } from "./inbound-path-decision.js";
import { INBOUND_EL_SCOPE } from "./inbound-scope.js";
import { leseTrunkBeleg, trunkSweepHindernis } from "./inbound-trunk-beleg.js";

const TRUNK_ADRESSE = "sip.telnyx.com"; // gemessen; kein Env-Knopf, kein Betriebs-Tuning
const TRUNK_TRANSPORT = "tcp";
const TRUNK_MEDIA_ENCRYPTION = "disabled";
const TRUNK_CODECS = Object.freeze(["PCMU/8000"]);
const KEINE_NUMMER = "(keine Nummer)";

export const REGISTRIERUNG_KLASSE = Object.freeze({
  OFFEN: "offen",
  MIT_ZUGANG: "mit_zugang",
  OHNE_INBOUND: "ohne_inbound",
});

export function registrierungsKoerper({ e164, numberId, agentId, sipUser, sipPasswort }) {
  return {
    phone_number: e164,
    // Label = unsere interne Nummern-ID: stabil, PII-frei, joint zurueck auf den Datensatz.
    label: `hermes-${numberId}`,
    provider: "sip_trunk",
    agent_id: agentId,
    outbound_trunk_config: {
      address: TRUNK_ADRESSE,
      transport: TRUNK_TRANSPORT,
      media_encryption: TRUNK_MEDIA_ENCRYPTION,
      credentials: { username: sipUser, password: sipPasswort },
      enabled_codecs: [...TRUNK_CODECS],
    },
  };
}

// Review-Blocker Runde 1 (Blocker 1/2/G4): die FAIL-CLOSED-Zusage unten war bis hierher nur
// Kommentar - weder hier noch am Injektions-Gate (provisioning-orchestrator.js) wurden
// apiKey/agentId/SIP-Zugangsdaten je geprueft. Fehlten sie, registrierte ensureRegistration
// beim Anbieter mit LEEREN credentials/agent_id - ein echter Schreibzugriff, dessen Ergebnis
// (falls vom Anbieter angenommen) als funktionierende Registrierung persistiert wurde
// (attachNumberRegistration ist set-once, der Schaden war danach NICHT mehr reparierbar).
// Die Pruefung steht bewusst HIER (nicht im Injektions-Gate des Orchestrators): sie deckt
// JEDEN Aufrufer ab (Orchestrator UND den CLI-Reparaturlauf), nicht nur den einen.
export function fehlendeZugangsdaten({ el, sipUser, sipPasswort }) {
  if (!el?.apiKey) return "ELEVENLABS_API_KEY fehlt";
  if (!el?.agentId) return "ELEVENLABS_AGENT_ID fehlt";
  if (!sipUser) return "TELNYX_SIP_TRUNK_USERNAME fehlt";
  if (!sipPasswort) return "TELNYX_SIP_TRUNK_PASSWORD fehlt";
  return null;
}

// FAIL-CLOSED, NIE STILLES GRUEN: fehlt Schluessel/Agent/SIP-Zugang, wird NICHT "nichts zu
// tun" gemeldet, sondern geworfen - der Aufrufer zaehlt das als eigenen, benannten
// Fehlschlag.
export function makeElSipRegistrar({ el, sipUser, sipPasswort, fetchImpl = fetch, logger = console }) {
  // Schloss #2 (Wiederanlauf): existiert die Nummer beim Anbieter schon, wird ihre Kennung
  // UEBERNOMMEN. Deckt den Fall "angelegt, aber vor dem Persistieren abgestuerzt" ab, ohne
  // sich auf eine Anbieter-Garantie zu stuetzen, die UNBELEGT ist.
  async function ensureRegistration({ e164, numberId }) {
    // VOR jedem Netzzugriff (auch vor dem GET) - ein Aufruf mit leeren Zugangsdaten liefe
    // sonst als echter, folgenreicher Anbieter-Schreibzugriff durch.
    const grund = fehlendeZugangsdaten({ el, sipUser, sipPasswort });
    if (grund) throw new Error(`ElevenLabs-Nummernregistrierung: ${grund}`);
    const bestand = (await listPhoneNumbers({ fetchImpl, account: el })).find(
      (eintrag) => eintrag.phone_number === e164,
    );
    if (bestand?.phone_number_id) return { phoneNumberId: bestand.phone_number_id, angelegt: false };
    const { phoneNumberId } = await createPhoneNumber({
      fetchImpl,
      account: el,
      body: registrierungsKoerper({ e164, numberId, agentId: el.agentId, sipUser, sipPasswort }),
    });
    if (!phoneNumberId)
      throw new Error("ElevenLabs-Nummernregistrierung lieferte keine phone_number_id");
    return { phoneNumberId, angelegt: true };
  }

  // Freigabe-Protokoll (release-reconcile.js): fail-soft, nie werfen (Muster
  // deletePhoneNumber selbst) - eine haengende Anbieter-API darf die Freigabe unserer
  // Nummer nicht blockieren. logger nur fuer den benannten Fehlschlag, PII-/Secret-frei.
  async function removeRegistration(phoneNumberId) {
    const { accepted, status } = await deletePhoneNumber({ fetchImpl, account: el, phoneNumberId });
    if (!accepted)
      logger.warn(
        `[el-registrierung] Loeschversuch FEHLGESCHLAGEN phone_number_id=${phoneNumberId} status=${status ?? "unbekannt"} - Waise beim Anbieter moeglich, s. Reparaturlauf`,
      );
    return { accepted, status };
  }

  return { ensureRegistration, removeRegistration };
}

// Dreifach-Gate des Anbieter-Schreibwegs (PROVISIONING_ENABLED + zwei EL-Riegel): EINE Quelle
// fuer Registrar und Inbound-Trunk-Schreiber (G5). PROVISIONING_ENABLED zuerst und kurzschliessend:
// config.voice wird nur bei offenem Provisioning gelesen (Bestandsverhalten, Aufrufer ohne voice).
function elNummernRegistrierungAktiv(config) {
  if (!config.provisioning.provisioningEnabled) return false;
  const outbound = config.voice.elevenLabsOutbound;
  return Boolean(outbound?.enabled && outbound?.numberRegistrationEnabled);
}

// E5-01 (Review-Blocker Runde 3): gemeinsame Konstruktions-Naht fuer die FREIGABE-
// Aufrufer (web-login.js, contract-end-cleanup.js via billing/webhook.js), die den
// Registrar zuvor NIE injizierten - jede Freigabe hinterliess dadurch live eine EL-Waise.
// ABGESCHLOSSEN (Owner-Auftrag 2026-08-29, Blocker 4+5): der Provisioning-Orchestrator
// (worker/provisioning-orchestrator.js#runProvisioningDrain) ruft jetzt ebenfalls diese
// Funktion statt das Dreifach-Gate inline nachzubauen - EIN Bauplatz statt zweier, wie
// dieser Kommentar es vorher nur behauptete. Der Fix aendert den max-lines-per-function-
// Befundtext von makeProvisioningOrchestrator (180 -> 171 Zeilen, echte Verbesserung,
// bleibt aber ueber der Grenze) - dafuer traegt eslint-legacy-exceptions.json seit diesem
// Auftrag einen eigenen, gepinnten Eintrag (Begruendung dort), test/check-staged-
// suppressions.test.js ist mitgezogen.
export function sipRegistrarWennAktiv(config) {
  if (!elNummernRegistrierungAktiv(config)) return undefined;
  return makeElSipRegistrar({
    el: config.voice.elevenLabsOutbound,
    sipUser: config.telephony.telnyxSipTrunkUsername,
    sipPasswort: config.telephony.telnyxSipTrunkPassword,
  });
}

// ---- IEL-B9: Inventar der Registrierungen (nur lesend) -----------------------------------

// Rein. OFFEN = inbound_trunk vorhanden OHNE has_auth_credentials === true (E15-2, fail-closed:
// fehlend/false/sonstiges zaehlt als offen). OHNE_INBOUND = kein inbound_trunk (E15-4: KEIN
// Schutzbeleg - ob der Anbieter dann einen INVITE ablehnt, ist ungemessen).
export function registrierungsKlasse(registrierung) {
  const trunk = registrierung?.inbound_trunk;
  if (!trunk) return REGISTRIERUNG_KLASSE.OHNE_INBOUND;
  return trunk.has_auth_credentials === true ? REGISTRIERUNG_KLASSE.MIT_ZUGANG : REGISTRIERUNG_KLASSE.OFFEN;
}

// Liste + je Registrierung ein Einzel-GET (die Liste traegt den Trunk nicht), seriell. Wirft mit
// err.providerStatus - ein unlesbares Inventar ist nie gruen.
export async function holeRegistrierungen({ fetchImpl, account }) {
  const liste = await listPhoneNumbers({ fetchImpl, account });
  const registrierungen = [];
  for (const eintrag of liste) {
    registrierungen.push(await fetchPhoneNumber({ fetchImpl, account, phoneNumberId: eintrag.phone_number_id }));
  }
  return registrierungen;
}

// Rein. Exakter String-Abgleich auf phone_number: kein Praefix, keine Normalisierung (E13/E16-b).
export function registrierungenMitNummer(registrierungen, e164) {
  return registrierungen.filter((registrierung) => registrierung.phone_number === e164);
}

// Rein. gruen = keine Registrierung der Klasse OFFEN.
export function inventarUrteil(registrierungen) {
  const inKlasse = (klasse) => registrierungen.filter((registrierung) => registrierungsKlasse(registrierung) === klasse);
  const offen = inKlasse(REGISTRIERUNG_KLASSE.OFFEN);
  return {
    gruen: offen.length === 0,
    offen,
    mitZugang: inKlasse(REGISTRIERUNG_KLASSE.MIT_ZUGANG),
    ohneInbound: inKlasse(REGISTRIERUNG_KLASSE.OHNE_INBOUND),
  };
}

function istString(wert) {
  return typeof wert === "string";
}

// Rein. Die EINZIGE Ausgabe-Projektion einer Registrierung (B9-Zeile, B11-Schnappschuss): NIE
// username, NIE die volle Nummer, NIE allowed_addresses (Regel 4/PII).
export function inventarSchnappschuss(registrierung) {
  const trunk = registrierung.inbound_trunk;
  const erlaubteNummern = Array.isArray(trunk?.allowed_numbers) ? trunk.allowed_numbers : [];
  return {
    id: registrierung.phone_number_id,
    label: registrierung.label ?? null,
    endung: istString(registrierung.phone_number) ? e164Endung(registrierung.phone_number) : KEINE_NUMMER,
    inboundTrunk: Boolean(trunk),
    zugangsdaten: trunk?.has_auth_credentials === true,
    allowedNumbersEndungen: erlaubteNummern.filter(istString).map(e164Endung),
    outboundTrunk: Boolean(registrierung.outbound_trunk),
    klasse: registrierungsKlasse(registrierung),
  };
}

// ---- IEX-A10 (E13/E16): Inbound-Trunk einer Registrierung schreiben ----------------------

// Gemessen [M1]: Barriere ist Digest + Init-Token, nicht die Quelladresse. media_encryption
// bleibt ungesendet (L-2).
const INBOUND_TRUNK_ALLE_ADRESSEN = "0.0.0.0/0";
const STATUS_UNBEKANNT = "unbekannt";

// Rein. Die EINE Koerperform des Inbound-Trunks (Server + scripts/iel-geheimnisse-setzen.mjs).
// Fail-closed: ein leerer Wert wirft VOR jedem Netzzugriff - nie credentials:null und nie
// allowed_numbers:[] ([IEL] E15). [M1] F-E: PATCH inbound laesst outbound_trunk intakt.
export function inboundTrunkKoerper({ benutzer, passwort, e164 }) {
  if (![benutzer, passwort, e164].every(istNichtLeererString))
    throw new Error("inboundTrunkKoerper: Benutzer, Passwort und Nummer sind Pflicht");
  return {
    inbound_trunk_config: {
      credentials: { username: benutzer, password: passwort },
      allowed_numbers: [e164],
      allowed_addresses: [INBOUND_TRUNK_ALLE_ADRESSEN],
    },
  };
}

// E13: Registrierungs-Gate UND Beleg-Sweep-Voraussetzungen (Schalter, Zugang, EL-Konto) UND
// Scope registrierte_dids. Unter allowlist schreibt der Server nie (sonst liefe der Riegel
// "halbe Rotation" in a7a/b3 ROT). Reihenfolge: Registrierungs-Gate zuerst (kurzschliessend).
export function inboundTrunkSchreibenErlaubt(config) {
  if (!elNummernRegistrierungAktiv(config)) return false;
  if (config.voice.elevenLabsInbound?.scope !== INBOUND_EL_SCOPE.REGISTRIERTE_DIDS) return false;
  return trunkSweepHindernis(config.voice) === null;
}

// Muster sipRegistrarWennAktiv: Gate zu -> undefined, der Aufrufer schreibt nichts. EINZIGE
// Konstruktionsstelle des Schreibers im Server.
export function inboundTrunkSchreiberWennErlaubt(config) {
  if (!inboundTrunkSchreibenErlaubt(config)) return undefined;
  return makeInboundTrunkSchreiber({ el: config.voice.elevenLabsOutbound, zugang: config.voice.elevenLabsInbound });
}

// ensureInboundTrunk(number): SCHREIBT den Inbound-Trunk der Registrierung
// number.providerAgentPhoneNumberId beim Anbieter und liefert das Urteil des NACH-GETs
// (TRUNK_BELEG). Anbieter-Fehler werfen nicht: sie stehen nur als Status im Log (nie Koerper,
// nie err.message - ein Parse-Fehlertext kann Koerper-Schnipsel tragen). Ein leerer Zugangswert
// wirft (Programmierfehler, vor dem Netz). Nach dem Schreibversuch wird IMMER nachgelesen:
// der Endstand ist der tatsaechliche Anbieterzustand. zugangFp = Fingerabdruck des geschriebenen
// Zugangs.
export function makeInboundTrunkSchreiber({ el, zugang, fetchImpl = fetch, logger = console }) {
  const soll = { sipUser: zugang.sipUser, agentId: el.agentId };
  const lies = (phoneNumberId) => fetchPhoneNumber({ fetchImpl, account: el, phoneNumberId });

  async function ensureInboundTrunk(number) {
    const body = inboundTrunkKoerper({ benutzer: zugang.sipUser, passwort: zugang.sipPassword, e164: number.e164 });
    await schreibeOhneWurf(number, body);
    const { beleg } = await leseTrunkBeleg({ lies, number, soll });
    return beleg;
  }

  async function schreibeOhneWurf(number, body) {
    try {
      await patchPhoneNumber({ fetchImpl, account: el, phoneNumberId: number.providerAgentPhoneNumberId, body });
    } catch (fehler) {
      logger.warn(
        `[el-trunk] schreiben_fehlgeschlagen nummer_id=${number.id} status=${fehler?.providerStatus ?? STATUS_UNBEKANNT}`,
      );
    }
  }

  return { ensureInboundTrunk, zugangFp: zugangsFingerabdruck(zugang.sipUser) };
}
