import { provisionNumber } from "../onboarding.js";
import { searchParamsForCountry } from "../telephony/provisioning-geo.js";
import {
  sipRegistrarWennAktiv,
  inboundTrunkSchreiberWennErlaubt,
} from "../elevenlabs/nummern-registrierung.js";
import { performNumberRelease } from "../release-reconcile.js";
import { TAUSCH_ERGEBNIS, NUMBER_STATUS, speicherBereiche } from "../store.js";

const LOG_PREFIX = "[nummerntausch]";
const BESTAND_PREFIX = "[kundennummern]";
const ENDUNG_STELLEN = 4;
const UNBEKANNT = "-";
const TAUSCH_ACTOR = "system:nummerntausch";

function endung(e164) {
  return e164 ? `…${e164.slice(-ENDUNG_STELLEN)}` : UNBEKANNT;
}

function logge(logger, { tenantId, alt, neu, ergebnis }) {
  logger.log(
    `${LOG_PREFIX} tenant=${tenantId} alt=${endung(alt.e164)} neu=${endung(neu?.e164)} ergebnis=${ergebnis}`,
  );
}

async function fordereErsatzAn({ store, bereiche, config }, alt) {
  return store.withStoreLock(async () => {
    const anspruch = await bereiche.nummern.ersatzNummerAnfordern({
      oldNumberId: alt.id,
      maxNumbers: config.provisioning.maxNumbers,
    });
    await store.drainFlushes();
    return anspruch;
  });
}

async function kaufeErsatz({ store, deps }, number) {
  try {
    await provisionNumber(store.load(), deps, { numberId: number.id, ...searchParamsForCountry(number.country) });
    return TAUSCH_ERGEBNIS.ERSATZ_AKTIV;
  } catch (err) {
    deps.logger.error(`${LOG_PREFIX} Kauf fehlgeschlagen number=${number.id}: ${err.message}`);
    return TAUSCH_ERGEBNIS.KAUF_FEHLGESCHLAGEN;
  } finally {
    store.save();
  }
}

async function sichereRegistrierung({ store, bereiche, deps }, number) {
  try {
    const { phoneNumberId } = await deps.sipRegistrar.ensureRegistration({ e164: number.e164, numberId: number.id });
    await bereiche.nummern.registrierungAnhaengen(number.id, phoneNumberId);
    await store.drainFlushes();
    return TAUSCH_ERGEBNIS.ERSATZ_AKTIV;
  } catch (err) {
    deps.logger.error(`${LOG_PREFIX} Registrierung fehlgeschlagen number=${number.id}: ${err.message}`);
    return TAUSCH_ERGEBNIS.REGISTRIERUNG_FEHLGESCHLAGEN;
  }
}

async function pruefeRegistrierung(kontext, number, ergebnis) {
  if (ergebnis !== TAUSCH_ERGEBNIS.ERSATZ_AKTIV) return ergebnis;
  if (number.providerAgentPhoneNumberId) return ergebnis;
  if (!kontext.deps.sipRegistrar) return TAUSCH_ERGEBNIS.REGISTRIERUNG_FEHLGESCHLAGEN;
  return sichereRegistrierung(kontext, number);
}

function ersatzBereit({ store }, neu) {
  const frisch = store.load().numbers.find((number) => number.id === neu.id);
  return frisch?.status === NUMBER_STATUS.ACTIVE && Boolean(frisch.providerAgentPhoneNumberId);
}

async function gibAlteNummerFrei(kontext, alt, neu) {
  const { store, deps } = kontext;
  if (!deps.audit) {
    deps.logger.warn(`${LOG_PREFIX} keine Audit-Senke - alte Nummer ${alt.id} wird nicht freigegeben`);
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

async function tausche(kontext, alt) {
  const anspruch = await fordereErsatzAn(kontext, alt);
  if (!anspruch.ok) return { ergebnis: anspruch.grund };
  const gekauft = anspruch.purchase ? await kaufeErsatz(kontext, anspruch.number) : TAUSCH_ERGEBNIS.ERSATZ_AKTIV;
  const registriert = await pruefeRegistrierung(kontext, anspruch.number, gekauft);
  const ergebnis =
    registriert === TAUSCH_ERGEBNIS.ERSATZ_AKTIV ? await gibAlteNummerFrei(kontext, alt, anspruch.number) : registriert;
  return { ergebnis, neu: anspruch.number };
}

async function tauscheEinen(kontext, alt) {
  const { config, deps } = kontext;
  const eintrag = { tenantId: alt.tenantId, alt, neu: null, ergebnis: TAUSCH_ERGEBNIS.KAUF_FEHLGESCHLAGEN };
  try {
    if (config.provisioning.provisioningEnabled) Object.assign(eintrag, await tausche(kontext, alt));
    else eintrag.ergebnis = TAUSCH_ERGEBNIS.DRY_RUN;
  } catch (err) {
    deps.logger.error(`${LOG_PREFIX} Fehler tenant=${alt.tenantId}: ${err.message}`);
  }
  logge(deps.logger, eintrag);
  return eintrag;
}

export async function runNummerntausch({
  store,
  config,
  numberProvisioning,
  sipRegistrar = sipRegistrarWennAktiv(config),
  inboundTrunkSchreiber = inboundTrunkSchreiberWennErlaubt(config),
  audit,
  logger = console,
}) {
  const deps = { provisioner: numberProvisioning(), sipRegistrar, inboundTrunkSchreiber, audit, logger };
  const bereiche = speicherBereiche(store);
  const kandidaten = await bereiche.nummern.nummerntauschKandidaten({
    platformAniE164: config.provisioning.platformAniE164,
  });
  logger.log(`${BESTAND_PREFIX} aktive_ausserhalb_plus1=${kandidaten.length}`);
  const ergebnisse = [];
  for (const alt of kandidaten) ergebnisse.push(await tauscheEinen({ store, bereiche, config, deps }, alt));
  return ergebnisse;
}

export function starteNummerntausch({ logger = console, ...optionen }) {
  return runNummerntausch({ logger, ...optionen }).catch((err) =>
    logger.error(`${LOG_PREFIX} Lauf abgebrochen: ${err.message}`),
  );
}
