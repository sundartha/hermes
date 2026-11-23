import { provisionNumber } from "../onboarding.ts";
import { searchParamsForCountry } from "../telephony/provisioning-geo.ts";
import { elevenlabsNummern } from "../elevenlabs/nummern-port.ts";
import { performNumberRelease } from "../release-reconcile.ts";
import { TAUSCH_ERGEBNIS, NUMBER_STATUS, speicherBereiche } from "../store.js";

type Nummer = Awaited<ReturnType<typeof provisionNumber>>;
type Alt = Nummer;
type Anspruch = { ok: false; grund: string } | { ok: true; number: Nummer; purchase: boolean };

interface NummernBereich {
  nummerntauschKandidaten: () => Promise<Alt[]>;
  ersatzNummerAnfordern: (eingabe: {
    oldNumberId: string;
    maxNumbers: number;
  }) => Promise<Anspruch>;
  registrierungAnhaengen: (numberId: string, phoneNumberId: string) => Promise<unknown>;
}

interface Bereiche {
  nummern: NummernBereich;
}

type Ergebnis = (typeof TAUSCH_ERGEBNIS)[keyof typeof TAUSCH_ERGEBNIS];
type SipRegistrar = NonNullable<ProvisionDeps["sipRegistrar"]>;
type NummernPort = ReturnType<typeof elevenlabsNummern>;
type Konfiguration = Parameters<NummernPort["sipRegistrarWennAktiv"]>[0] &
  Parameters<NummernPort["inboundTrunkSchreiberWennErlaubt"]>[0] & {
    provisioning: { maxNumbers: number; provisioningEnabled: boolean };
  };
type ProvisionDeps = Parameters<typeof provisionNumber>[1];
type FreigabeDeps = Parameters<typeof performNumberRelease>[0];
type Speicher = FreigabeDeps["store"] & {
  drainFlushes: () => Promise<unknown>;
  load: () => Parameters<typeof provisionNumber>[0];
};

interface Logger {
  log: (zeile: string) => void;
  warn: (zeile: string) => void;
  error: (zeile: string) => void;
}

type Deps = ProvisionDeps &
  Pick<FreigabeDeps, "provisioner" | "sipRegistrar"> & {
    logger: Logger;
    audit?: FreigabeDeps["audit"] | undefined;
  };

interface Kontext {
  store: Speicher;
  bereiche: Bereiche;
  config: Konfiguration;
  deps: Deps;
}

interface Eintrag {
  tenantId: string;
  alt: Alt;
  neu: Nummer | null;
  ergebnis: string;
}

const LOG_PREFIX = "[nummerntausch]";
const BESTAND_PREFIX = "[kundennummern]";
const ENDUNG_STELLEN = 4;
const UNBEKANNT = "-";
const TAUSCH_ACTOR = "system:nummerntausch";

function endung(e164: string | null | undefined): string {
  return e164 ? `…${e164.slice(-ENDUNG_STELLEN)}` : UNBEKANNT;
}

function logge(logger: Logger, { tenantId, alt, neu, ergebnis }: Eintrag): void {
  logger.log(
    `${LOG_PREFIX} tenant=${tenantId} alt=${endung(alt.e164)} neu=${endung(neu?.e164)} ergebnis=${ergebnis}`,
  );
}

async function fordereErsatzAn({ store, bereiche, config }: Kontext, alt: Alt): Promise<Anspruch> {
  return store.withStoreLock(async () => {
    const anspruch = await bereiche.nummern.ersatzNummerAnfordern({
      oldNumberId: alt.id,
      maxNumbers: config.provisioning.maxNumbers,
    });
    await store.drainFlushes();
    return anspruch;
  });
}

async function kaufeErsatz({ store, deps }: Kontext, number: Nummer): Promise<Ergebnis> {
  try {
    await provisionNumber(store.load(), deps, {
      numberId: number.id,
      ...searchParamsForCountry(number.country),
    });
    return TAUSCH_ERGEBNIS.ERSATZ_AKTIV;
  } catch (err) {
    deps.logger.error(
      `${LOG_PREFIX} Kauf fehlgeschlagen number=${number.id}: ${String(Reflect.get(Object(err), "message"))}`,
    );
    return TAUSCH_ERGEBNIS.KAUF_FEHLGESCHLAGEN;
  } finally {
    store.save();
  }
}

async function sichereRegistrierung(
  { store, bereiche, deps }: Kontext,
  sipRegistrar: SipRegistrar,
  number: Nummer,
): Promise<Ergebnis> {
  try {
    const { phoneNumberId } = await sipRegistrar.ensureRegistration({
      e164: number.e164,
      numberId: number.id,
    });
    await bereiche.nummern.registrierungAnhaengen(number.id, phoneNumberId);
    await store.drainFlushes();
    return TAUSCH_ERGEBNIS.ERSATZ_AKTIV;
  } catch (err) {
    deps.logger.error(
      `${LOG_PREFIX} Registrierung fehlgeschlagen number=${number.id}: ${String(Reflect.get(Object(err), "message"))}`,
    );
    return TAUSCH_ERGEBNIS.REGISTRIERUNG_FEHLGESCHLAGEN;
  }
}

async function pruefeRegistrierung(
  kontext: Kontext,
  number: Nummer,
  ergebnis: Ergebnis,
): Promise<Ergebnis> {
  if (ergebnis !== TAUSCH_ERGEBNIS.ERSATZ_AKTIV) return ergebnis;
  if (number.providerAgentPhoneNumberId) return ergebnis;
  const { sipRegistrar } = kontext.deps;
  if (!sipRegistrar) return TAUSCH_ERGEBNIS.REGISTRIERUNG_FEHLGESCHLAGEN;
  return sichereRegistrierung(kontext, sipRegistrar, number);
}

function ersatzBereit({ store }: Kontext, neu: Nummer): boolean {
  const frisch = store.load().numbers.find((number) => number.id === neu.id);
  return frisch?.status === NUMBER_STATUS.ACTIVE && Boolean(frisch.providerAgentPhoneNumberId);
}

async function gibAlteNummerFrei(kontext: Kontext, alt: Alt, neu: Nummer): Promise<Ergebnis> {
  const { store, deps } = kontext;
  if (!deps.audit) {
    deps.logger.warn(
      `${LOG_PREFIX} keine Audit-Senke - alte Nummer ${alt.id} wird nicht freigegeben`,
    );
    return TAUSCH_ERGEBNIS.ERSATZ_AKTIV;
  }
  if (!ersatzBereit(kontext, neu)) return TAUSCH_ERGEBNIS.FREIGABE_FEHLGESCHLAGEN;
  const freigegeben = await performNumberRelease({
    store,
    provisioner: deps.provisioner,
    audit: deps.audit,
    logger: deps.logger,
    actor: TAUSCH_ACTOR,
    number: alt,
    sipRegistrar: deps.sipRegistrar,
  });
  return freigegeben ? TAUSCH_ERGEBNIS.GETAUSCHT : TAUSCH_ERGEBNIS.FREIGABE_FEHLGESCHLAGEN;
}

async function tausche(
  kontext: Kontext,
  alt: Alt,
): Promise<Pick<Eintrag, "ergebnis"> & { neu?: Nummer }> {
  const anspruch = await fordereErsatzAn(kontext, alt);
  if (!anspruch.ok) return { ergebnis: anspruch.grund };
  const gekauft = anspruch.purchase
    ? await kaufeErsatz(kontext, anspruch.number)
    : TAUSCH_ERGEBNIS.ERSATZ_AKTIV;
  const registriert = await pruefeRegistrierung(kontext, anspruch.number, gekauft);
  const ergebnis =
    registriert === TAUSCH_ERGEBNIS.ERSATZ_AKTIV
      ? await gibAlteNummerFrei(kontext, alt, anspruch.number)
      : registriert;
  return { ergebnis, neu: anspruch.number };
}

async function tauscheEinen(kontext: Kontext, alt: Alt): Promise<Eintrag> {
  const { config, deps } = kontext;
  const eintrag: Eintrag = {
    tenantId: alt.tenantId,
    alt,
    neu: null,
    ergebnis: TAUSCH_ERGEBNIS.KAUF_FEHLGESCHLAGEN,
  };
  try {
    if (config.provisioning.provisioningEnabled)
      Object.assign(eintrag, await tausche(kontext, alt));
    else eintrag.ergebnis = TAUSCH_ERGEBNIS.DRY_RUN;
  } catch (err) {
    deps.logger.error(
      `${LOG_PREFIX} Fehler tenant=${alt.tenantId}: ${String(Reflect.get(Object(err), "message"))}`,
    );
  }
  logge(deps.logger, eintrag);
  return eintrag;
}

interface Optionen {
  store: Speicher;
  config: Konfiguration;
  numberProvisioning: () => Deps["provisioner"];
  sipRegistrar?: Deps["sipRegistrar"];
  inboundTrunkSchreiber?: Deps["inboundTrunkSchreiber"];
  audit?: Deps["audit"];
  logger?: Logger;
}

export async function runNummerntausch({
  store,
  config,
  numberProvisioning,
  sipRegistrar = elevenlabsNummern().sipRegistrarWennAktiv(config),
  inboundTrunkSchreiber = elevenlabsNummern().inboundTrunkSchreiberWennErlaubt(config),
  audit,
  logger = console,
}: Optionen): Promise<Eintrag[]> {
  const deps = {
    provisioner: numberProvisioning(),
    sipRegistrar,
    inboundTrunkSchreiber,
    audit,
    logger,
  };
  const bereiche: Bereiche = speicherBereiche(store);
  const kandidaten = await bereiche.nummern.nummerntauschKandidaten();
  logger.log(`${BESTAND_PREFIX} aktive_ausserhalb_plus1=${String(kandidaten.length)}`);
  const ergebnisse: Eintrag[] = [];
  for (const alt of kandidaten)
    ergebnisse.push(await tauscheEinen({ store, bereiche, config, deps }, alt));
  return ergebnisse;
}

export function starteNummerntausch({ logger = console, ...optionen }: Optionen): Promise<Eintrag[] | undefined> {
  return runNummerntausch({ logger, ...optionen }).catch((err: unknown): undefined => {
    logger.error(`${LOG_PREFIX} Lauf abgebrochen: ${String(Reflect.get(Object(err), "message"))}`);
  });
}
