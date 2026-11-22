import { anfrage } from "../utils/anfrage.js";
import { elevenlabsNummernKonto } from "./nummern-konto-port.ts";
import { e164Endung, istNichtLeererString, zugangsFingerabdruck } from "./inbound-path-decision.ts";
import { leseTrunkBeleg, trunkSweepHindernis } from "./inbound-trunk-beleg.ts";

const KEINE_NUMMER = "(keine Nummer)";

type ConvaiKonto = Parameters<ReturnType<typeof elevenlabsNummernKonto>["listPhoneNumbers"]>[0]["account"];

interface ElZugang extends ConvaiKonto {
  agentId: string;
}

interface ElZugangsangaben {
  apiKey?: string | undefined;
  agentId?: string | undefined;
}

type FetchImpl = Parameters<ReturnType<typeof elevenlabsNummernKonto>["listPhoneNumbers"]>[0]["fetchImpl"];

interface Protokoll {
  warn: (zeile: string) => void;
}

interface Trunkdaten {
  has_auth_credentials?: unknown;
  allowed_numbers?: unknown;
}

interface Registrierungsdaten {
  phone_number?: unknown;
  phone_number_id?: unknown;
  label?: unknown;
  inbound_trunk?: Trunkdaten | null;
  outbound_trunk?: unknown;
  [schluessel: string]: unknown;
}

interface SchreibNummer {
  id: string;
  e164: string;
  providerAgentPhoneNumberId: string;
}

type TrunkSweepVoice = Parameters<typeof trunkSweepHindernis>[0];

interface SipRegistrar {
  ensureRegistration: (nummer: { e164: string; numberId: string }) => Promise<{ phoneNumberId: unknown; angelegt: boolean }>;
  removeRegistration: (phoneNumberId: string) => Promise<{ accepted: boolean; status: number | null }>;
}

interface TrunkSchreiber {
  ensureInboundTrunk: (number: SchreibNummer) => Promise<string>;
  zugangFp: string | null;
}

interface Inventarurteil {
  gruen: boolean;
  offen: Registrierungsdaten[];
  mitZugang: Registrierungsdaten[];
  ohneInbound: Registrierungsdaten[];
}

interface Inventareintrag {
  id: unknown;
  label: unknown;
  endung: string;
  inboundTrunk: boolean;
  zugangsdaten: boolean;
  allowedNumbersEndungen: string[];
  outboundTrunk: boolean;
  klasse: string;
}

interface RegistrarKonfiguration {
  provisioning: { provisioningEnabled: boolean };
  voice: { elevenLabsOutbound: ElZugang };
}

interface TrunkKonfiguration {
  provisioning: { provisioningEnabled: boolean };
  voice: TrunkSweepVoice & { elevenLabsOutbound: ElZugang };
}

export const REGISTRIERUNG_KLASSE = Object.freeze({
  OFFEN: "offen",
  MIT_ZUGANG: "mit_zugang",
  OHNE_INBOUND: "ohne_inbound",
});

export function registrierungsKoerper({ e164, numberId, agentId }: { e164: string; numberId: string; agentId: string }): {
  phone_number: string;
  label: string;
  provider: string;
  agent_id: string;
} {
  return {
    phone_number: e164,
    label: `hermes-${numberId}`,
    provider: "sip_trunk",
    agent_id: agentId,
  };
}

export function fehlendeZugangsdaten({ el }: { el?: ElZugangsangaben | undefined }): string | null {
  if (!el?.apiKey) return "ELEVENLABS_API_KEY fehlt";
  if (!el.agentId) return "ELEVENLABS_AGENT_ID fehlt";
  return null;
}

export function makeElSipRegistrar({
  el,
  fetchImpl = anfrage,
  logger = console,
}: {
  el: ElZugang;
  fetchImpl?: FetchImpl;
  logger?: Protokoll;
}): SipRegistrar {
  async function ensureRegistration({ e164, numberId }: { e164: string; numberId: string }) {
    const grund = fehlendeZugangsdaten({ el });
    if (grund) throw new Error(`ElevenLabs-Nummernregistrierung: ${grund}`);
    const bestand = (await elevenlabsNummernKonto().listPhoneNumbers({ fetchImpl, account: el })).find(
      (eintrag) => eintrag.phone_number === e164,
    );
    if (bestand?.phone_number_id) return { phoneNumberId: bestand.phone_number_id, angelegt: false };
    const { phoneNumberId } = await elevenlabsNummernKonto().createPhoneNumber({
      fetchImpl,
      account: el,
      body: registrierungsKoerper({ e164, numberId, agentId: el.agentId }),
    });
    if (!phoneNumberId)
      throw new Error("ElevenLabs-Nummernregistrierung lieferte keine phone_number_id");
    return { phoneNumberId, angelegt: true };
  }

  async function removeRegistration(phoneNumberId: string) {
    const { accepted, status } = await elevenlabsNummernKonto().deletePhoneNumber({ fetchImpl, account: el, phoneNumberId });
    if (!accepted)
      logger.warn(
        `[el-registrierung] Loeschversuch FEHLGESCHLAGEN phone_number_id=${phoneNumberId} status=${String(status ?? "unbekannt")} - Waise beim Anbieter moeglich, s. Reparaturlauf`,
      );
    return { accepted, status };
  }

  return { ensureRegistration, removeRegistration };
}

export function sipRegistrarWennAktiv(config: RegistrarKonfiguration): SipRegistrar | undefined {
  if (!config.provisioning.provisioningEnabled) return undefined;
  return makeElSipRegistrar({ el: config.voice.elevenLabsOutbound });
}

export function registrierungsKlasse(registrierung: Registrierungsdaten | null | undefined): string {
  const trunk = registrierung?.inbound_trunk;
  if (!trunk) return REGISTRIERUNG_KLASSE.OHNE_INBOUND;
  return trunk.has_auth_credentials === true ? REGISTRIERUNG_KLASSE.MIT_ZUGANG : REGISTRIERUNG_KLASSE.OFFEN;
}

export async function holeRegistrierungen({ fetchImpl, account }: { fetchImpl: FetchImpl; account: ConvaiKonto }): Promise<(Registrierungsdaten | null)[]> {
  const liste = await elevenlabsNummernKonto().listPhoneNumbers({ fetchImpl, account });
  const registrierungen = [];
  for (const eintrag of liste) {
    registrierungen.push(await elevenlabsNummernKonto().fetchPhoneNumber({ fetchImpl, account, phoneNumberId: String(eintrag.phone_number_id) }));
  }
  return registrierungen;
}

export function registrierungenMitNummer(registrierungen: Registrierungsdaten[], e164: string): Registrierungsdaten[] {
  return registrierungen.filter((registrierung) => registrierung.phone_number === e164);
}

export function inventarUrteil(registrierungen: Registrierungsdaten[]): Inventarurteil {
  const inKlasse = (klasse: string) => registrierungen.filter((registrierung) => registrierungsKlasse(registrierung) === klasse);
  const offen = inKlasse(REGISTRIERUNG_KLASSE.OFFEN);
  return {
    gruen: offen.length === 0,
    offen,
    mitZugang: inKlasse(REGISTRIERUNG_KLASSE.MIT_ZUGANG),
    ohneInbound: inKlasse(REGISTRIERUNG_KLASSE.OHNE_INBOUND),
  };
}

function istString(wert: unknown) {
  return typeof wert === "string";
}

export function inventarSchnappschuss(registrierung: Registrierungsdaten): Inventareintrag {
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

export function inboundTrunkKoerper({
  benutzer,
  passwort,
  e164,
}: {
  benutzer: string | undefined;
  passwort: string | undefined;
  e164: string;
}): { inbound_trunk_config: { credentials: { username: string | undefined; password: string | undefined }; allowed_numbers: string[]; allowed_addresses: string[] } } {
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

export function inboundTrunkSchreibenErlaubt(config: TrunkKonfiguration): boolean {
  if (!config.provisioning.provisioningEnabled) return false;
  return trunkSweepHindernis(config.voice) === null;
}

export function inboundTrunkSchreiberWennErlaubt(config: TrunkKonfiguration): TrunkSchreiber | undefined {
  if (!inboundTrunkSchreibenErlaubt(config)) return undefined;
  return makeInboundTrunkSchreiber({ el: config.voice.elevenLabsOutbound, zugang: config.voice.elevenLabsInbound });
}

export function makeInboundTrunkSchreiber({
  el,
  zugang,
  fetchImpl = anfrage,
  logger = console,
}: {
  el: ElZugang;
  zugang: TrunkSweepVoice["elevenLabsInbound"];
  fetchImpl?: FetchImpl;
  logger?: Protokoll;
}): TrunkSchreiber {
  const soll = { sipUser: zugang.sipUser, agentId: el.agentId };
  const lies = (phoneNumberId: string | null | undefined) =>
    elevenlabsNummernKonto().fetchPhoneNumber({ fetchImpl, account: el, phoneNumberId: String(phoneNumberId) });

  async function ensureInboundTrunk(number: SchreibNummer) {
    const body = inboundTrunkKoerper({ benutzer: zugang.sipUser, passwort: zugang.sipPassword, e164: number.e164 });
    await schreibeOhneWurf(number, body);
    const { beleg } = await leseTrunkBeleg({ lies, number, soll });
    return beleg;
  }

  async function schreibeOhneWurf(number: SchreibNummer, body: ReturnType<typeof inboundTrunkKoerper>) {
    try {
      await elevenlabsNummernKonto().patchPhoneNumber({ fetchImpl, account: el, phoneNumberId: number.providerAgentPhoneNumberId, body });
    } catch (fehler) {
      logger.warn(
        `[el-trunk] schreiben_fehlgeschlagen nummer_id=${number.id} status=${String(Reflect.get(Object(fehler), "providerStatus") ?? STATUS_UNBEKANNT)}`,
      );
    }
  }

  return { ensureInboundTrunk, zugangFp: zugangsFingerabdruck(zugang.sipUser) };
}
