// Subscribe-Schicht (P2): die EINE Quelle (G5) fuer die Abo-UI, geteilt vom
// aktiven Pfad (BillingIsland) UND vom Aktivierungs-Pfad (suspended, index.astro).
// Reine DOM-Builder (planTiles) + reine String-Builder (subscriptionLine/quotaLine)
// + die Subscribe-Zustandsmaschine (wireSubscribe). Portierung von tenant.html
// (renderPlanCards/renderSubscription/subscribePlan/startCardSetup) als testbares,
// host-unabhaengiges Modul.
//
// XSS-SCHUTZ (Leitplanke): alle Anzeige-Strings (Plan-Name, Preis, Features, Abo-
// Zeile, Kontingent) gehen AUSSCHLIESSLICH ueber el()/textContent in den DOM -- nie
// ueber innerHTML. Plan-Daten stammen aus dem eingefrorenen Build-Spiegel
// (lib/plans.js), kein Tenant-Input; der textContent-only-Bau ist dennoch die Regel.

import { ApiError, HTTP_CONFLICT, HTTP_UNAUTHORIZED, startBillingSubscribe, startBillingSetupCheckout } from "./api.js";
import { PLAN_CATALOG, formatPlanPrice, findPlan } from "./plans.js";
import { el } from "./render.js";

// Anzeige-Konstanten (kein Magic-String an den Verwendungsstellen, G25).
const PRICE_CADENCE = " /month";
const SUBSCRIBE_LABEL = "Subscribe";
const POPULAR_BADGE = "Popular";
const ACTIVE_PLAN_PREFIX = "Active plan: ";
const PLAN_ATTR = "plan"; // data-plan: Slug am Subscribe-Button (delegierter Klick)
const NO_CARD_CODE = "no_card";

const MS_PER_SECOND = 1000;
const DATE_LOCALE = "en-US";

// Rueckmeldungen der Subscribe-Zustandsmaschine (EINE Quelle, G5: aktiver UND
// suspended-Pfad zeigen denselben Text). Reine Anzeige-Strings (Englisch).
export const SUBSCRIBE_MESSAGES = Object.freeze({
  booked: "Subscription booked.",
  alreadySubscribed: "You already have a subscription.",
  sessionExpired: "Session expired - please sign in again.",
  failed: "Subscription couldn't be booked.",
  checkoutFailed: "Couldn't start checkout.",
});

// ---- reine Builder ----------------------------------------------------------

// Preis-Zeile: formatierter Preis + " /month" als eigener Span. Beide ueber el()/
// textContent (Preis aus dem Ganzzahl-Cents-Katalog, formatPlanPrice).
function priceLine(doc, plan) {
  const line = el(doc, "div", "plan-price", formatPlanPrice(plan.amountCents, plan.currency));
  line.append(el(doc, "span", "plan-per", PRICE_CADENCE));
  return line;
}

// Leistungsliste eines Plans (features[], jeweils eine Zeile via textContent).
function featureList(doc, features) {
  const list = el(doc, "ul", "plan-features");
  for (const feature of features || []) list.append(el(doc, "li", "plan-feature", feature));
  return list;
}

// Subscribe-Button mit data-plan=<slug>. Der delegierte Klick-Listener (wireSubscribe)
// liest den Slug aus dataset.plan -> kein Binding pro Button (G5, kein Listener-Leak).
function subscribeButton(doc, slug) {
  const btn = el(doc, "button", "btn plan-cta", SUBSCRIBE_LABEL);
  btn.type = "button";
  btn.dataset[PLAN_ATTR] = slug;
  return btn;
}

// Eine Plan-Kachel. featured -> "Popular"-Badge (Parity zu preise.astro/tenant.html).
function planTile(doc, plan) {
  const tile = el(doc, "div", plan.featured ? "plan plan--featured" : "plan");
  if (plan.featured) tile.append(el(doc, "span", "plan-badge", POPULAR_BADGE));
  tile.append(
    el(doc, "div", "plan-name", plan.name),
    priceLine(doc, plan),
    featureList(doc, plan.features),
    subscribeButton(doc, plan.slug),
  );
  return tile;
}

// Die Plan-Kacheln aus dem eingefrorenen Build-Spiegel (SPIEGEL-PFLICHT: KEIN
// runtime /api/plans-Fetch; lib/plans.js ist 1:1-Kopie von src/plans.js). Liefert
// die Knoten-Liste; der Aufrufer haengt sie in seinen Container (replaceChildren).
export function planTiles(doc) {
  return PLAN_CATALOG.map((plan) => planTile(doc, plan));
}

// Anzeige-Datum aus dem currentPeriodEnd-Epoch (Unix-Sekunden) -> "M/D/YYYY"
// (en-US). Fehlend/ungueltig -> "" (die Abo-Zeile zeigt dann nur den Plan-Namen).
function renewDate(epochSeconds) {
  if (!epochSeconds) return "";
  const d = new Date(epochSeconds * MS_PER_SECOND);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(DATE_LOCALE);
}

// Anzeige-Name eines Slugs aus dem Katalog-Spiegel (findPlan, eine Lookup-Quelle).
// Fallback = Slug kapitalisiert, falls der Katalog den Slug nicht kennt (nie "undefined").
function planName(slug) {
  const plan = findPlan(slug);
  if (plan) return plan.name;
  return slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : "";
}

// Abo-Zeile: "Active plan: {name} (renews {date})." bzw. ohne Datum nur "Active
// plan: {name}." -- 1:1 zu tenant.html renderSubscription. Reiner String (DOM-frei,
// testbar); der Aufrufer setzt ihn via textContent. sub = { planSlug, currentPeriodEnd }.
export function subscriptionLine(sub) {
  const name = planName(sub.planSlug);
  const date = renewDate(sub.currentPeriodEnd);
  return date ? `${ACTIVE_PLAN_PREFIX}${name} (renews ${date}).` : `${ACTIVE_PLAN_PREFIX}${name}.`;
}

// Kontingent-Zeile: "{remaining} of {included} minutes remaining" oder null, wenn
// kein Kontingent vorliegt (kein aktives Abo / PAYMENT_ENABLED aus). null -> der
// Aufrufer versteckt die Zeile. Keys gespiegelt aus src/billing/meter.js quotaView.
export function quotaLine(quota) {
  if (!quota) return null;
  return `${quota.remainingMinutes} of ${quota.includedMinutes} minutes remaining`;
}

// ---- Subscribe-Zustandsmaschine ---------------------------------------------

function isConflict(err) {
  return err instanceof ApiError && err.status === HTTP_CONFLICT;
}
function isUnauthorized(err) {
  return err instanceof ApiError && err.status === HTTP_UNAUTHORIZED;
}

// Gefuehrter no_card-Pfad: keine Karte -> Stripe-Checkout MIT getragenem Plan
// (startBillingSetupCheckout(plan) -> Rueckkehr bucht den Plan). 401 -> Session
// abgelaufen; sonst generischer Checkout-Fehler. navigate kapselt den Browser-
// Redirect (DI -> testbar, kein direktes window in der Maschine).
async function guidedCardSetup(plan, { onMessage, navigate }) {
  try {
    const url = await startBillingSetupCheckout(plan);
    navigate(url);
  } catch (err) {
    onMessage(
      isUnauthorized(err) ? SUBSCRIBE_MESSAGES.sessionExpired : SUBSCRIBE_MESSAGES.checkoutFailed,
      false,
    );
  }
}

// Fehler-Zweige der Subscribe-Maschine (Port tenant.html subscribePlan): 409 no_card
// -> gefuehrter Checkout; 409 sonst (already_subscribed) -> Hinweis; 401 -> Session
// abgelaufen; alles andere -> generischer Fehler. Fail-closed: nie als Erfolg deuten.
async function handleSubscribeError(err, plan, opts) {
  if (isConflict(err) && err.code === NO_CARD_CODE) {
    await guidedCardSetup(plan, opts);
    return;
  }
  if (isConflict(err)) return opts.onMessage(SUBSCRIBE_MESSAGES.alreadySubscribed, false);
  if (isUnauthorized(err)) return opts.onMessage(SUBSCRIBE_MESSAGES.sessionExpired, false);
  return opts.onMessage(SUBSCRIBE_MESSAGES.failed, false);
}

// Ein Subscribe-Lauf: POST {plan}. Erfolg -> Rueckmeldung + onSubscribed (re-fetch
// /state + AUTH_EVENT bzw. Reload, je nach Pfad). Misserfolg -> handleSubscribeError.
async function runSubscribe(plan, opts) {
  try {
    await startBillingSubscribe(plan);
    opts.onMessage(SUBSCRIBE_MESSAGES.booked, true);
    await opts.onSubscribed();
  } catch (err) {
    await handleSubscribeError(err, plan, opts);
  }
}

// Browser-Redirect (Default-navigate). Nur in der Verdrahtung benutzt; window wird
// erst beim Aufruf gelesen (Modul bleibt im Node-Test importierbar).
function browserNavigate(url) {
  window.location.assign(url);
}

// Verdrahtet einen Container mit Plan-Kacheln: EIN delegierter Klick-Listener am
// stabilen Container (die Kacheln werden bei jedem Render ersetzt -> kein Binding
// pro Button, kein Leak). Klick auf einen data-plan-Button -> runSubscribe.
//   onSubscribed: nach erfolgreicher Buchung aufgerufen (re-fetch /state bzw. Reload).
//   onMessage(text, ok): Rueckmeldung anzeigen.
//   navigate(url): Browser-Redirect (Default window.location; injizierbar fuer Tests).
export function wireSubscribe(container, { onSubscribed, onMessage, navigate = browserNavigate } = {}) {
  // Listener gibt das runSubscribe-Promise zurueck (vom Browser ignoriert) -> der
  // Lauf ist deterministisch await-bar (Test), kein Verlass auf Microtask-Timing.
  container.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-plan]");
    if (!btn) return undefined;
    return runSubscribe(btn.dataset[PLAN_ATTR], { onSubscribed, onMessage, navigate });
  });
}
