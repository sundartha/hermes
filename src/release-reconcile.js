// tenant-prolif-d + -e: DID-Lifecycle-Release. Phase D: Grace-Reconcile gibt active
// Telnyx-DIDs >Grace-suspendierter Tenants nach Live-Recheck frei (graceMs=0 = Observe-
// Only). Phase E: releaseTenantNumbersOnErase gibt bei Art.-17-Loeschung grace-frei frei.
// BEIDE teilen denselben Release-Kern (performNumberRelease): Provider-DELETE VOR der
// Store-Mutation (Konvergenz), idempotent, durabler Audit. Kein Safety-Gate beruehrt: laeuft
// ueber den bestehenden NumberProvisioning-Port. Alle IO injiziert (store/provisioner/audit/
// logger); nowMs/graceMs als Argument -> testbar/repeatable (F.I.R.S.T.), kein Date.now im Kern.
import {
  classifyNumbersForRelease,
  numberReleaseVerdict,
  findNumber,
  releaseNumber,
  tenantInactive,
  tenantNumbersForErase,
  RELEASE_VERDICT,
} from "./store/state-ops.js";
import { NUMBER_STATUS } from "./store/defaults.js";

// Telnyx-DELETE einer bereits geloeschten Nummer -> als Erfolg werten (Idempotenz/
// Konvergenz, Invariante 4). Der Adapter haengt den Status per attachStatus an.
const PROVIDER_NOT_FOUND = 404;
// audit_log-Actor je Ausloeser: Grace-Reconcile (Phase D) und Art.-17-Erase-Release (Phase E)
// teilen den Release-Kern, sind im Audit aber unterscheidbar (Compliance: eine Erasure-Release
// ist ein Art.-17-Ereignis) -> Actor als Parameter, nicht hartkodiert. Action/Detail bleiben
// fuer Phase D byte-identisch (nur der Actor wird jetzt explizit hereingereicht).
const RECONCILE_ACTOR = "system:release-reconcile";
const ERASE_ACTOR = "system:erase-release";
const AUDIT_ACTION = Object.freeze({
  RELEASED: "did_released",
  ABORTED: "did_release_aborted",
});

// Durabler Audit (EINE Quelle, G5). detail traegt NUR interne IDs (kein e164/Key/PII, Regel 4/5).
function recordDidAudit(audit, { actor, tenantId, action, detail }) {
  return audit.record({ actorSub: actor, tenantId, action, detail });
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

// Gemeinsamer Release-Kern (Phase D Grace-Reconcile + Phase E Erase, EINE Quelle G5).
// Provider-DELETE VOR der Store-Mutation (Konvergenz - ein Crash dazwischen konvergiert beim
// naechsten Lauf, divergiert nicht) -> Store active->released unter Lock (idempotent: nur wenn
// noch active) -> durabler Audit. Der Aufrufer hat die Freigabe-Eignung bereits geprueft
// (Grace-Recheck bzw. Erase-Selektor). actor unterscheidet die Ausloeser im Audit. Liefert
// true bei Release, false bei Provider-Fehler (Store bleibt active -> retrybar, kein Orphan).
async function performNumberRelease({ store, provisioner, audit, logger, actor, number }) {
  if (!(await providerReleaseOrGone(provisioner, number, logger))) {
    await recordDidAudit(audit, {
      actor,
      tenantId: number.tenantId,
      action: AUDIT_ACTION.ABORTED,
      detail: `number=${number.id} grund=provider_error`,
    });
    return false;
  }
  await store.withStoreLock(() => {
    const s = store.load();
    const n = findNumber(s, number.id);
    if (n && n.status === NUMBER_STATUS.ACTIVE) releaseNumber(s, number.id);
    store.save();
  });
  logger.log(`[did-release] freigegeben number=${number.id} tenant=${number.tenantId}`);
  await recordDidAudit(audit, {
    actor,
    tenantId: number.tenantId,
    action: AUDIT_ACTION.RELEASED,
    detail: `number=${number.id} provider=${number.providerNumberId}`,
  });
  return true;
}

// Ein Grace-Kandidat: Live-Recheck (Invariante 3) gegen den FRISCHEN Store -> Release-Kern.
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
      actor: RECONCILE_ACTOR,
      tenantId: number ? number.tenantId : null,
      action: AUDIT_ACTION.ABORTED,
      detail: `number=${numberId} grund=recheck`,
    });
    return false;
  }
  return performNumberRelease({ store, provisioner, audit, logger, actor: RECONCILE_ACTOR, number });
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

// tenant-prolif-e: Art.-17-Erase gibt die active Telnyx-DIDs eines Tenants frei. GRACE-FREI
// (der Tenant wird geloescht - keine Reaktivierung, kein Live-Recheck noetig), aber ueber
// DENSELBEN Release-Kern wie Phase D (performNumberRelease): idempotent + audit-gedeckt.
// Idempotenz: der Selektor (tenantNumbersForErase) liefert NUR active-e Nummern -> ein zweiter
// Erase-Lauf findet die schon released-en NICHT mehr (kein zweiter Provider-DELETE). non-telnyx
// bleibt unangetastet (nur der Telnyx-Adapter hat releaseNumber; eine Altzeile mit fremdem
// provider bleibt manuell). Latenz-Hinweis: in dieser Phase gibt
// es BEWUSST NOCH KEINEN Live-Aufrufer (kein neuer Endpunkt, Scope) - die Freigabe wird vorab
// verdrahtet; die kuenftige Erase-Route komponiert store.eraseTenantData (Daten) + diese Fn
// (Nummern). Kein toter Code: exportierter Seam mit Testabdeckung (der Test ist der Aufrufer).
// Alle IO injiziert (store/provisioner/audit/logger).
export async function releaseTenantNumbersOnErase({ store, provisioner, audit, logger = console, tenantId }) {
  const candidates = tenantNumbersForErase(store.load(), tenantId);
  let released = 0;
  let aborted = 0;
  for (const number of candidates) {
    const ok = await performNumberRelease({
      store, provisioner, audit, logger, actor: ERASE_ACTOR, number,
    });
    if (ok) released++;
    else aborted++;
  }
  return { released, aborted };
}
