// GP-P0 (PLAN-GELDPFAD.md 2, "Sichtbarkeit: zahlender Mandant ohne Nummer"): der
// Vorfall vom 11.09.2026 war nur durch manuelle DB-Forensik sichtbar - ein Mandant mit
// aktivem Abo und einer Nummer auf 'failed' hat keinen offenen Provisioning-Job mehr und
// entgeht damit dem Boot-Klassifikator. Dieser Waechter schliesst GENAU diese Luecke: er
// beobachtet stuendlich (D1: Zeitanker = Beginn der laufenden Stripe-Abrechnungsperiode,
// billing/period.js), meldet auf der Notiz-Stufe (WARN -> Audit -> Marker, D3 - KEIN
// Mail-/SMS-Versand) und handelt NICHT (kein Kauf, kein Retry, kein Anbieter-Aufruf).
//
// Bewusst ausserhalb dieser Phase: ein Mandant, der dauerhaft auf requested/provisioning
// haengt, HAT eine Live-Nummer (tenantHasLiveNumber/occupiesCapacity) und erscheint hier
// NICHT - diese Klasse deckt der Boot-Reconciler ab (D2).
import { meldeBetreiberNotiz } from "../telephony/outage-report.js";
import * as ops from "../store/state-ops.js";
import { KYC_OUTBOUND_MIN } from "../store/defaults.js";

const BEFUND_BUCKET_PREFIX = "paid-no-number:";
const BEFUND_EVENT = "paid_without_number";
const BEHOBEN_EVENT = "paid_without_number_recovered";

// EXPORTIERT, weil der Marker-Code ein durabler Vertrag ist (outage_alert.code): eine
// zweite, anderswo getippte Zusammensetzung koennte abdriften, ohne dass ein Test es
// merkt (G5, Muster outbound-drift-watch.js#befundBucket).
export const paidWithoutNumberBucket = (tenantId) => `${BEFUND_BUCKET_PREFIX}${tenantId}`;

const istBefundBucket = (code) => code.startsWith(BEFUND_BUCKET_PREFIX);

// PII-frei (Regel 4/10): interne Mandanten-Kennung + ISO-Zeitpunkt, keine e164, kein
// Name, keine Adresse - dieselbe Klasse wie die bestehenden Provisioning-Log-Zeilen.
function befundZeile({ tenantId, paidSinceIso }) {
  return `tenant=${tenantId} zahlend_seit=${paidSinceIso}`;
}

// Ein Kandidat: Faelligkeits-Urteil UND Reservierung ATOMAR im SELBEN Lock (G26-Muster,
// Vorbild outage-report.js#meldeHoldEskalation) - ein bereits offener Marker fuer GENAU
// diesen Mandanten heisst "schon gemeldet", auch bei zwei parallelen Sweeps.
async function meldeMandant({ store, audit, kandidat, nowMs }) {
  const bucket = paidWithoutNumberBucket(kandidat.tenantId);
  const zuMelden = await store.withStoreLock(() => {
    const state = store.load();
    if (ops.openOutageAlert(state, bucket)) return false;
    ops.claimOutageAlert(state, { code: bucket, nowMs });
    return true;
  });
  store.save();
  if (!zuMelden) return;
  const zeile = befundZeile(kandidat);
  await meldeBetreiberNotiz({ store, audit, bucket, aktion: BEFUND_EVENT, zeile, nowMs });
}

// Gegenstueck zu meldeMandant (D6): offene Marker, die in DIESEM Lauf keinen Kandidaten
// mehr haben -> schliessen. EINE Audit-Zeile je Uebergang, und NUR wenn wirklich etwas
// geschlossen wurde (Muster cost-truing.js#closeCoverageBefunde).
async function schliesseBehobene({ store, audit, aktuelleBuckets, nowMs }) {
  const geschlossen = await store.withStoreLock(() => {
    const state = store.load();
    const offene = state.outageAlerts.filter(
      (alert) => alert.closedAt === null && istBefundBucket(alert.code) && !aktuelleBuckets.has(alert.code),
    );
    for (const marker of offene) ops.closeOutageAlert(state, { code: marker.code, nowMs });
    return offene.length;
  });
  store.save();
  if (geschlossen === 0) return;
  const zeile = `marker=${geschlossen}`;
  console.log(`[paid-no-number] behoben ${zeile}`);
  audit(BEHOBEN_EVENT, null, zeile);
}

// Fail-soft wie jeder andere Sweep-Zweig: ein Fehler HIER darf den Stunden-Sweep nie
// abbrechen. nowMs injizierbar (Muster runPlatformHoldEscalationSweep). graceMs<=0 haelt
// den Waechter komplett aus (Rollback-Hebel, D5).
export async function runPaidWithoutNumberSweep({ store, config, audit, nowMs = Date.now() }) {
  try {
    const graceMs = config.billing.paidWithoutNumberGraceMs;
    if (graceMs <= 0) return;
    const kandidaten = ops.paidWithoutNumberCandidates(store.load(), {
      nowMs,
      graceMs,
      kycMinLevel: KYC_OUTBOUND_MIN,
    });
    // Umfangs-Zeile IMMER (Lehre pruefkommando-ohne-positiv-kontrolle): ein Waechter, der
    // nichts findet, muss von einem, der nichts sucht, unterscheidbar bleiben.
    console.log(`[paid-no-number] kandidaten=${kandidaten.length}`);
    for (const kandidat of kandidaten) await meldeMandant({ store, audit, kandidat, nowMs });
    const aktuelleBuckets = new Set(kandidaten.map((kandidat) => paidWithoutNumberBucket(kandidat.tenantId)));
    await schliesseBehobene({ store, audit, aktuelleBuckets, nowMs });
  } catch (err) {
    console.error("[paid-no-number]", err.message);
  }
}

// Fabrik (Muster makeOutageWatch/makeDriftWatch): EINMAL beim Boot verdrahtet (INV-7).
export function makePaidWithoutNumberWatch({ store, config, audit }) {
  return { runPaidWithoutNumberSweep: () => runPaidWithoutNumberSweep({ store, config, audit }) };
}
