// Kuendigung zum Periodenende (§ 312k BGB): die Sequenz hinter dem Knopf im
// Kundenbereich (self-service-routes.js). Eigenes Modul seit #169; das oeffentliche
// Formular, das sie dort mitbenutzte, ist seit 2026-10-01 wieder entfernt (Owner-
// Entscheidung: gekuendigt wird nur eingeloggt). Kein HTTP hier.

// 312k-P3: geteilte Kuendigungs-/Ruecknahme-Sequenz hinter BEIDEN Richtungen (G5) -
// scheduleCancellation/unscheduleCancellation (312k-P2, billing/ports.js) sind DERSELBE
// Stripe-Call mit umgekehrtem Wert, hier gilt dasselbe fuer den Route-Layer. KEIN HTTP/
// Audit hier (G34, Muster subscribeAndActivate).
//
// Idempotenz (Doppelklick/zwei Tabs): der aktuelle Zustand wird VOR jedem Stripe-Call
// gelesen. Steht er dem angeforderten Wert bereits gleich, macht dieser Aufruf GAR
// KEINEN Stripe-Call und GAR KEINEN zweiten Store-Write - derselbe Endzustand, den ein
// vorheriger Erfolg schon hergestellt hat, kommt einfach zurueck (alreadyApplied:true).
// Der Aufrufer (Route) liest daran ab, ob eine NEUE durable Bestaetigung noetig ist.
//
// Konfliktfreiheit mit dem Webhook (312k-P1, billing/webhook.js CANCEL_SCHEDULED/
// ACTIVATE): BEIDE Wege schreiben cancelAtPeriodEnd (+ optional currentPeriodEnd)
// AUSSCHLIESSLICH ueber denselben Setter store.setTenantSubscription mit demselben
// Feldnamen. Es gibt keinen zweiten Zustands-Ort, den einer der beiden Wege staendig
// zuruecksetzen koennte - der Webhook bestaetigt binnen Millisekunden denselben Wert,
// den diese Route soeben gesetzt hat (letzter Schreiber gewinnt, beide schreiben
// denselben Wert -> kein sichtbarer Unterschied, kein Gegeneinander-Schreiben).
export async function setSubscriptionCancellation({ store, billing, tenant, cancel }) {
  const before = store.tenantSubscription(tenant);
  if (!before.subscriptionId) return { ok: false, reason: "no_subscription" };
  if (before.cancelAtPeriodEnd === cancel) {
    return {
      ok: true,
      cancelAtPeriodEnd: before.cancelAtPeriodEnd,
      currentPeriodEnd: before.currentPeriodEnd,
      alreadyApplied: true,
    };
  }
  const idempotencyKey = (cancel ? "cancel_sched_" : "cancel_unsched_") + before.subscriptionId;
  const op = cancel ? billing.scheduleCancellation : billing.unscheduleCancellation;
  const result = await op({ subscriptionId: before.subscriptionId, idempotencyKey });
  // Selektiver Patch (Muster webhook.js CANCEL_SCHEDULED/ACTIVATE): nur die vom Provider
  // tatsaechlich gelieferten Felder, s. Kommentar oben (Konfliktfreiheit mit dem Webhook).
  const patch = { cancelAtPeriodEnd: result.cancelAtPeriodEnd };
  if (result.currentPeriodEnd != null) patch.currentPeriodEnd = result.currentPeriodEnd;
  store.setTenantSubscription(tenant, patch);
  return {
    ok: true,
    cancelAtPeriodEnd: result.cancelAtPeriodEnd,
    currentPeriodEnd: result.currentPeriodEnd ?? before.currentPeriodEnd,
    alreadyApplied: false,
  };
}
