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

const TRUNK_ADRESSE = "sip.telnyx.com";
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

export function fehlendeZugangsdaten({ el, sipUser, sipPasswort }) {
  if (!el?.apiKey) return "ELEVENLABS_API_KEY fehlt";
  if (!el?.agentId) return "ELEVENLABS_AGENT_ID fehlt";
  if (!sipUser) return "TELNYX_SIP_TRUNK_USERNAME fehlt";
  if (!sipPasswort) return "TELNYX_SIP_TRUNK_PASSWORD fehlt";
  return null;
}

export function makeElSipRegistrar({ el, sipUser, sipPasswort, fetchImpl = fetch, logger = console }) {
  async function ensureRegistration({ e164, numberId }) {
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

function elNummernRegistrierungAktiv(config) {
  if (!config.provisioning.provisioningEnabled) return false;
  const outbound = config.voice.elevenLabsOutbound;
  return Boolean(outbound?.enabled && outbound?.numberRegistrationEnabled);
}

export function sipRegistrarWennAktiv(config) {
  if (!elNummernRegistrierungAktiv(config)) return undefined;
  return makeElSipRegistrar({
    el: config.voice.elevenLabsOutbound,
    sipUser: config.telephony.telnyxSipTrunkUsername,
    sipPasswort: config.telephony.telnyxSipTrunkPassword,
  });
}

export function registrierungsKlasse(registrierung) {
  const trunk = registrierung?.inbound_trunk;
  if (!trunk) return REGISTRIERUNG_KLASSE.OHNE_INBOUND;
  return trunk.has_auth_credentials === true ? REGISTRIERUNG_KLASSE.MIT_ZUGANG : REGISTRIERUNG_KLASSE.OFFEN;
}

export async function holeRegistrierungen({ fetchImpl, account }) {
  const liste = await listPhoneNumbers({ fetchImpl, account });
  const registrierungen = [];
  for (const eintrag of liste) {
    registrierungen.push(await fetchPhoneNumber({ fetchImpl, account, phoneNumberId: eintrag.phone_number_id }));
  }
  return registrierungen;
}

export function registrierungenMitNummer(registrierungen, e164) {
  return registrierungen.filter((registrierung) => registrierung.phone_number === e164);
}

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

const INBOUND_TRUNK_ALLE_ADRESSEN = "0.0.0.0/0";
const STATUS_UNBEKANNT = "unbekannt";

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

export function inboundTrunkSchreibenErlaubt(config) {
  if (!elNummernRegistrierungAktiv(config)) return false;
  if (config.voice.elevenLabsInbound?.scope !== INBOUND_EL_SCOPE.REGISTRIERTE_DIDS) return false;
  return trunkSweepHindernis(config.voice) === null;
}

export function inboundTrunkSchreiberWennErlaubt(config) {
  if (!inboundTrunkSchreibenErlaubt(config)) return undefined;
  return makeInboundTrunkSchreiber({ el: config.voice.elevenLabsOutbound, zugang: config.voice.elevenLabsInbound });
}

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
