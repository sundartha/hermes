import { provisionNumber } from "../onboarding.js";
import { searchParamsForCountry } from "../telephony/provisioning-geo.js";
import {
  sipRegistrarWennAktiv,
  inboundTrunkSchreiberWennErlaubt,
} from "../elevenlabs/nummern-registrierung.js";
import { TAUSCH_ERGEBNIS } from "../store.js";

const LOG_PREFIX = "[nummerntausch]";
const ENDUNG_STELLEN = 4;
const UNBEKANNT = "-";

function endung(e164) {
  return e164 ? `…${e164.slice(-ENDUNG_STELLEN)}` : UNBEKANNT;
}

function logge(logger, { tenantId, alt, neu, ergebnis }) {
  logger.log(
    `${LOG_PREFIX} tenant=${tenantId} alt=${endung(alt.e164)} neu=${endung(neu?.e164)} ergebnis=${ergebnis}`,
  );
}

async function fordereErsatzAn({ store, config }, alt) {
  return store.withStoreLock(async () => {
    const anspruch = store.ersatzNummerAnfordern({
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

async function tausche(kontext, alt) {
  const anspruch = await fordereErsatzAn(kontext, alt);
  if (!anspruch.ok) return { ergebnis: anspruch.grund };
  if (!anspruch.purchase) return { ergebnis: TAUSCH_ERGEBNIS.ERSATZ_AKTIV, neu: anspruch.number };
  return { ergebnis: await kaufeErsatz(kontext, anspruch.number), neu: anspruch.number };
}

async function tauscheEinen(kontext, alt) {
  const { config, deps } = kontext;
  const eintrag = { tenantId: alt.tenantId, alt, neu: null, ergebnis: TAUSCH_ERGEBNIS.KAUF_FEHLGESCHLAGEN };
  try {
    if (!config.provisioning.provisioningEnabled) eintrag.ergebnis = TAUSCH_ERGEBNIS.DRY_RUN;
    else Object.assign(eintrag, await tausche(kontext, alt));
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
  logger = console,
}) {
  const deps = { provisioner: numberProvisioning(), sipRegistrar, inboundTrunkSchreiber, logger };
  const kandidaten = store.nummerntauschKandidaten({
    platformAniE164: config.provisioning.platformAniE164,
  });
  const ergebnisse = [];
  for (const alt of kandidaten) ergebnisse.push(await tauscheEinen({ store, config, deps }, alt));
  return ergebnisse;
}
