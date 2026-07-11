// tenant-prolif-d: DID-Lifecycle-Reconcile. Identifiziert active Telnyx-DIDs von
// >Grace suspendierten Tenants und gibt sie NUR im scharfen Modus (graceMs>0) nach
// Live-Recheck idempotent frei; graceMs=0 (Default) = Observe-Only, NUR Log, NIE ein
// DELETE. Kein Safety-Gate beruehrt: laeuft ueber den bestehenden NumberProvisioning-
// Port. Alle IO injiziert (store/provisioner/audit/logger); nowMs/graceMs als Argument
// -> testbar/repeatable (F.I.R.S.T.), kein Date.now im Kern.
import {
  classifyNumbersForRelease,
  numberReleaseVerdict,
  findNumber,
  releaseNumber,
  tenantInactive,
  RELEASE_VERDICT,
} from "./store/state-ops.js";
import { NUMBER_STATUS } from "./store/defaults.js";

// Telnyx-DELETE einer bereits geloeschten Nummer -> als Erfolg werten (Idempotenz/
// Konvergenz, Invariante 4). Der Adapter haengt den Status per attachStatus an.
const PROVIDER_NOT_FOUND = 404;
// audit_log-Actor fuer den System-Reconcile (kein IdP-sub).
const RECONCILE_ACTOR = "system:release-reconcile";
const AUDIT_ACTION = Object.freeze({
  RELEASED: "did_released",
  ABORTED: "did_release_aborted",
});

// Durabler Audit mit fest verdrahtetem System-Actor (EINE Quelle, G5). detail traegt NUR
// interne IDs (kein e164/Key/PII, Regel 4/5).
function recordDidAudit(audit, { tenantId, action, detail }) {
  return audit.record({ actorSub: RECONCILE_ACTOR, tenantId, action, detail });
}

// Provider-Release; 404 (bereits weg) zaehlt als Erfolg. Jeder andere Fehler -> false
// (Store bleibt active, naechster Lauf retryt; PII-/Key-frei geloggt).
async function providerReleaseOrGone(provisioner, number, logger) {
  try {
    await provisioner.releaseNumber(number.providerNumberId);
    return true;
  } catch (err) {
    if (err.providerStatus === PROVIDER_NOT_FOUND) {
      logger.warn(`[did-release] provider 404 (bereits weg) number=${number.id} -> Store nachziehen`);
      return true;
    }
    logger.warn(`[did-release] provider-release fehlgeschlagen number=${number.id}: ${err.message}`);
    return false;
  }
}

// Ein Kandidat: Live-Recheck -> Provider-DELETE -> Store-Mutation + durabler Audit.
// Liefert true bei erfolgtem Release, sonst false (Abbruch). Eine Aufgabe, injizierte deps.
async function releaseCandidate({ store, provisioner, audit, logger, nowMs, graceMs, numberId }) {
  // Live-Recheck (Invariante 3) gegen den FRISCHEN Store, unmittelbar vor dem DELETE:
  // reaktivierte der Kunde zwischenzeitlich (suspended_at geloescht + status active),
  // kippt der Verdict + tenantInactive -> Abbruch. Ein Fehl-Release ist Rufnummern-
  // Verlust fuer einen zahlenden Kunden.
  const fresh = store.load();
  const number = findNumber(fresh, numberId);
  const stillReleasable =
    !!number &&
    numberReleaseVerdict(fresh, number, { nowMs, graceMs }).action === RELEASE_VERDICT.RELEASE &&
    tenantInactive(fresh, number.tenantId);
  if (!stillReleasable) {
    logger.warn(`[did-release] recheck-abbruch number=${numberId} (reaktiviert/veraendert)`);
    await recordDidAudit(audit, {
      tenantId: number ? number.tenantId : null,
      action: AUDIT_ACTION.ABORTED,
      detail: `number=${numberId} grund=recheck`,
    });
    return false;
  }
  // Provider-DELETE VOR der Store-Mutation (Konvergenz, Invariante 4).
  if (!(await providerReleaseOrGone(provisioner, number, logger))) {
    await recordDidAudit(audit, {
      tenantId: number.tenantId,
      action: AUDIT_ACTION.ABORTED,
      detail: `number=${numberId} grund=provider_error`,
    });
    return false; // Store bleibt active -> naechster Lauf retryt (kein Store-Divergenz-Orphan)
  }
  // Store active->released unter Lock (kurzer Schreibabschnitt, KEIN Netz-await).
  // Idempotent: nur mutieren, wenn noch active (transitionNumber wuerfe sonst).
  await store.withStoreLock(() => {
    const s = store.load();
    const n = findNumber(s, numberId);
    if (n && n.status === NUMBER_STATUS.ACTIVE) releaseNumber(s, numberId);
    store.save();
  });
  logger.log(`[did-release] freigegeben number=${numberId} tenant=${number.tenantId}`);
  await recordDidAudit(audit, {
    tenantId: number.tenantId,
    action: AUDIT_ACTION.RELEASED,
    detail: `number=${numberId} provider=${number.providerNumberId}`,
  });
  return true;
}

// Ein Reconcile-Lauf. graceMs===0 (Observe-Only-Sentinel, Invariante 2) = Feature aus:
// NIE ein DELETE, nur die Kandidatenliste sichtbar machen. Die Fruehausfahrt ist die
// HARTE Grenze - der Release-Pfad ist nur bei graceMs>0 erreichbar.
export async function runReleaseReconcile({ store, provisioner, audit, logger = console, nowMs, graceMs }) {
  const candidates = classifyNumbersForRelease(store.load(), { nowMs, graceMs }).release;
  if (graceMs === 0) {
    if (candidates.length)
      logger.warn(
        `[did-release] OBSERVE-ONLY (RELEASE_GRACE_DAYS=0): ${candidates.length} Kandidat(en) NICHT freigegeben: ${candidates.map((n) => n.id).join(",")}`,
      );
    return { released: 0, aborted: 0, observed: candidates.length };
  }
  let released = 0;
  let aborted = 0;
  for (const candidate of candidates) {
    const ok = await releaseCandidate({ store, provisioner, audit, logger, nowMs, graceMs, numberId: candidate.id });
    if (ok) released++;
    else aborted++;
  }
  return { released, aborted, observed: 0 };
}
