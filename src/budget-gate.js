// EINE Quelle (G5) fuer die Frage "sperrt die Geld-Achse gerade?" - Regel 1, Token- UND
// (seit KS-P2) Carrier-Achse. Seit KS-P9/E10 gibt es GENAU EINE Geld-Achse (die
// pro-Tenant-Decke); die Plattform-Achse misst und warnt nur noch. Reine Query: liest seit
// KS-P2 zusaetzlich die laufende Zeit aus dem Store, weiterhin ohne Mutation und ohne Log
// (jeder Aufrufer loggt mit seinem eigenen Kontext).
import { liveVoiceSpendCents } from "./billing/metering.js";

export const BUDGET_AXIS = Object.freeze({
  TENANT: "budget_tenant", // Grund-Token seit telnyx-p6 im Shim-Log - Wortlaut bleibt
});

const BUDGET_AXIS_VALUES = Object.freeze(new Set(Object.values(BUDGET_AXIS)));

export function blockingBudgetAxis({ store, billing, tenantId }) {
  // KS-P2: die Frage lautet nicht mehr "was ist gebucht?", sondern "was ist gebucht PLUS was
  // laeuft gerade?". Bis hierher war die Carrier-Achse mid-call blind: die KI-Token-Achse
  // bucht in jeder Schleifenrunde, die Carrier-Minuten erst bei Call-Ende
  // (reconcileVoiceBudget) - und genau die sind die teure Achse.
  // Die Signatur bleibt bewusst call-frei: der Live-Term ist eine TENANT-Groesse (Summe
  // aller laufenden Legs des Tenants, seit KV-P2 beide Richtungen). Damit gibt es kein vom
  // Aufrufer geliefertes Datum, das ein vergessener Aufrufer stumm auf 0 setzen koennte (G27).
  const liveCents = liveVoiceSpendCents(store.activeCallsFor(tenantId), Date.now());
  return store.liveBudgetExceeded(tenantId, liveCents, billing) ? BUDGET_AXIS.TENANT : null;
}

// Ist ein Turn-Abbruchgrund eine GELD-Achse (im Gegensatz zur Zeit-Frist)? Die Aufrufer
// reagieren auf Geld anders als auf Zeit: auflegen statt weitersprechen (Regel 1).
export function isBudgetAxis(reason) {
  return BUDGET_AXIS_VALUES.has(reason);
}
