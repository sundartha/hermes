import { NUMBER_SWAP_JOB } from "../begriffe/nummern-vergabe.js";
import { NUMBER_STATUS, PROVISIONING_JOB_STATUS } from "../begriffe/nummern.ts";
import { normNum } from "../begriffe/rufnummern.js";
import { newId } from "./zustand/grundlagen.js";
import { bootstrapNummerAnlegen, swapKey } from "./zustand/nummern.ts";

export const ERSATZ_GRUND = Object.freeze({
  ALTE_NICHT_AKTIV: "alte_nummer_nicht_aktiv",
  NEUE_NICHT_AKTIV: "neue_nummer_nicht_aktiv",
  ANDERER_ERSATZ: "andere_ersatz_spur",
  KEINE_SPUR: "keine_spur",
});

function aktiveNummer(state, e164, tenantId) {
  return state.numbers.find(
    (number) => number.e164 === e164 && number.tenantId === tenantId && number.status === NUMBER_STATUS.ACTIVE,
  );
}

function spurAnlegen(state, neu, alt) {
  const schluessel = swapKey(alt.id);
  const vorhanden = state.provisioningJobs.find(
    (job) => job.kind === NUMBER_SWAP_JOB && job.idempotencyKey === schluessel,
  );
  if (vorhanden) return vorhanden.numberId === neu.id ? { ok: true } : { ok: false, grund: ERSATZ_GRUND.ANDERER_ERSATZ };
  state.provisioningJobs.push({
    id: newId("job"),
    numberId: neu.id,
    tenantId: neu.tenantId,
    kind: NUMBER_SWAP_JOB,
    status: PROVISIONING_JOB_STATUS.DONE,
    idempotencyKey: schluessel,
    attempts: 1,
    lastError: null,
    createdAt: new Date().toISOString(),
  });
  return { ok: true };
}

export function ersatzNummerEintragen(state, { e164, alteE164, tenantId, provider }) {
  const alt = aktiveNummer(state, normNum(alteE164), tenantId);
  if (!alt) return { ok: false, grund: ERSATZ_GRUND.ALTE_NICHT_AKTIV };
  bootstrapNummerAnlegen(state, e164, { tenantId, provider });
  const neu = aktiveNummer(state, normNum(e164), tenantId);
  if (!neu) return { ok: false, grund: ERSATZ_GRUND.NEUE_NICHT_AKTIV };
  return spurAnlegen(state, neu, alt);
}

export function ersatzSpurEntfernen(state, { e164, alteE164, tenantId }) {
  const alt = aktiveNummer(state, normNum(alteE164), tenantId);
  if (!alt) return { ok: false, grund: ERSATZ_GRUND.ALTE_NICHT_AKTIV };
  const neu = aktiveNummer(state, normNum(e164), tenantId);
  const schluessel = swapKey(alt.id);
  const index = state.provisioningJobs.findIndex(
    (job) => job.kind === NUMBER_SWAP_JOB && job.idempotencyKey === schluessel,
  );
  if (index < 0) return neu ? { ok: true, geaendert: false } : { ok: false, grund: ERSATZ_GRUND.KEINE_SPUR };
  if (!neu || state.provisioningJobs[index].numberId !== neu.id) return { ok: false, grund: ERSATZ_GRUND.ANDERER_ERSATZ };
  const [entfernt] = state.provisioningJobs.splice(index, 1);
  return { ok: true, geaendert: true, auftragId: entfernt.id };
}
