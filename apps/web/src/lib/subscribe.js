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

import {
  ApiError,
  HTTP_CONFLICT,
  HTTP_UNAUTHORIZED,
  startBillingSubscribe,
  startBillingSetupCheckout,
  startBillingCancel,
  startBillingResume,
} from "./api.js";
import { PLAN_CATALOG, formatPlanPrice, findPlan } from "./plans.js";
import { el } from "./render.js";

// Anzeige-Konstanten (kein Magic-String an den Verwendungsstellen, G25).
const PRICE_CADENCE = " /month";
const SUBSCRIBE_LABEL = "Subscribe";
const POPULAR_BADGE = "Popular";
const ACTIVE_PLAN_PREFIX = "Active plan: ";
const PLAN_ATTR = "plan"; // data-plan: Slug am Subscribe-Button (delegierter Klick)
// Phase A (PLAN-VOUCHER-SETUP-FEE-GAP.md): Hinweis auf die ZWEITE, separate Abbuchung
// (src/onboarding.js placeHold), die dem Abo-Checkout folgt - ohne Hinweis sah der Kunde
// sie nur als ueberraschenden 402 danach (Problem A im Plan-Dokument).
const FEE_NOTICE_PREFIX = "+ ";
const FEE_NOTICE_SUFFIX = " one-time number setup fee";
// AM4: Funnel-Hinweis aus dem no_card-Response (Feld next). Spiegelt NEXT_SETUP_CHECKOUT in
// src/self-service-routes.js -- ein Contract-String ueber die Origin-Grenze (kein gemeinsames
// Modul im Build-freien Frontend, wie die gespiegelten Settings-/error-Strings).
const SETUP_CHECKOUT_NEXT = "setup-checkout";

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

// Setup-Gebuehr-Zeile einer Kachel. fee = { amountCents, currency } | null (Phase A,
// numberSetupFeeFrom in api.js). null -> keine Zeile (kein Fee/Payment aus, byte-
// identisch zum Bestand). Wiederverwendet formatPlanPrice (G5, EINE Preis-Formatierung).
function feeLine(doc, fee) {
  if (!fee) return null;
  const price = formatPlanPrice(fee.amountCents, fee.currency);
  return el(doc, "div", "plan-fee", `${FEE_NOTICE_PREFIX}${price}${FEE_NOTICE_SUFFIX}`);
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
// fee (Phase A) optional: { amountCents, currency } | null -> zusaetzliche Gebuehren-
// Zeile zwischen Features und Subscribe-Button (feeLine, null -> keine Zeile).
function planTile(doc, plan, fee) {
  const tile = el(doc, "div", plan.featured ? "plan plan--featured" : "plan");
  if (plan.featured) tile.append(el(doc, "span", "plan-badge", POPULAR_BADGE));
  tile.append(el(doc, "div", "plan-name", plan.name), priceLine(doc, plan), featureList(doc, plan.features));
  const feeEl = feeLine(doc, fee);
  if (feeEl) tile.append(feeEl);
  tile.append(subscribeButton(doc, plan.slug));
  return tile;
}

// Die Plan-Kacheln aus dem eingefrorenen Build-Spiegel (SPIEGEL-PFLICHT: KEIN
// runtime /api/plans-Fetch; lib/plans.js ist 1:1-Kopie von src/plans.js). Liefert
// die Knoten-Liste; der Aufrufer haengt sie in seinen Container (replaceChildren).
// fee (Phase A) optional: { amountCents, currency } | null. Default null haelt
// bestehende Aufrufer ohne Fee-Kenntnis unveraendert (keine Zeile).
export function planTiles(doc, fee = null) {
  return PLAN_CATALOG.map((plan) => planTile(doc, plan, fee));
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
  // Funnel statt Sackgasse: der Server weist per next="setup-checkout" in die Karten-
  // Erfassung (no_card). Diskriminierung ueber den expliziten next-Hinweis, nicht ueber die
  // ueberladene error-Zeichenkette; das verbleibende 409 (kein next) = already_subscribed.
  if (isConflict(err) && err.next === SETUP_CHECKOUT_NEXT) {
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

// ---- Aktivierungs-Default (AM3): Plan-Auswahl als prominenter Default --------

// Copy des Aktivierungs-Pfads. EINE Quelle (G5/G25): Plan-Auswahl-Rahmen UND das
// Pending-Banner nach "Maybe later". Display-Texte (Englisch).
export const PLAN_CHOICE_COPY = Object.freeze({
  title: "Choose your plan",
  subtitle: "Pick a plan to activate your assistant and get your phone number.",
  bannerTitle: "Account pending",
  bannerText: "You can subscribe anytime to activate your assistant.",
});

// Rahmt die suspended-Region als prominente Plan-Auswahl: aktivierende H1, erklaerender
// Untertitel, Plan-Kacheln aus dem Build-Spiegel, sichtbarer Skip-Link. REIN DOM (doc + els),
// kein Netz. els = { title, subtitle, tiles, skip }. fee (Phase A) optional, an planTiles
// durchgereicht (numberSetupFeeFrom, null -> keine Gebuehren-Zeile). NUR bei PAYMENT_ENABLED aufgerufen
// (Aufrufer-Guard) -> ohne Payment byte-identisch.
export function renderPlanChoice(doc, els, fee = null) {
  els.title.textContent = PLAN_CHOICE_COPY.title;
  els.subtitle.textContent = PLAN_CHOICE_COPY.subtitle;
  els.tiles.replaceChildren(...planTiles(doc, fee));
  els.skip.hidden = false;
}

// "Maybe later": blendet die Plan-Auswahl aus, zeigt das ruhige Pending-Banner. REIN DOM,
// ruft KEIN subscribe/setStatus (Invariante AM3: aktiviert nichts, /state bleibt 403).
// Einbahn (Reload bringt die Auswahl zurueck) - bewusst minimal (YAGNI).
export function dismissPlanChoice(els) {
  els.title.textContent = PLAN_CHOICE_COPY.bannerTitle;
  els.subtitle.textContent = PLAN_CHOICE_COPY.bannerText;
  els.tiles.replaceChildren();
  els.skip.hidden = true;
}

// ---- 312k-P3: Kuendigungs-Weg (§ 312k BGB) ------------------------------------
// Zwei Schaltflaechen-Beschriftungen sind GESETZLICH VORGEGEBEN, nicht frei waehlbar
// (Auftragsnotiz) - deshalb Deutsch, obwohl das Dashboard sonst durchgaengig Englisch ist
// (SPRACHBRUCH IST GEWOLLT, kein Versehen; s. Bericht). EINE Quelle (G25) je Text: die
// Astro-Insel importiert diese Konstanten statt den Wortlaut ein zweites Mal zu tragen.
export const CANCEL_BUTTON_LABEL = "Verträge kündigen";
export const CONFIRM_CANCEL_BUTTON_LABEL = "Jetzt kündigen";
// Die uebrigen Beschriftungen sind NICHT gesetzlich vorgegeben -> Englisch, Muster der
// Nachbartexte (SUBSCRIBE_LABEL usw. oben).
export const CANCEL_ABORT_LABEL = "Never mind";
export const RESUME_BUTTON_LABEL = "Resume subscription";

const DATE_LOCALE_DE = "de-DE";

// § 312k verlangt Klarheit ueber den Wirkungstermin der Kuendigung; das deutsche
// Datumsformat (TT.MM.JJJJ) ist hier Teil dieser Eindeutigkeit und bewusst getrennt vom
// sonstigen Dashboard-Datum (renewDate oben, en-US) - nur fuer die Kuendigungs-Anzeige/
// -Bestaetigung. Fehlend/ungueltig -> "" (der Aufrufer zeigt dann einen datumslosen Satz).
function germanDate(epochSeconds) {
  if (!epochSeconds) return "";
  const d = new Date(epochSeconds * MS_PER_SECOND);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(DATE_LOCALE_DE);
}

// Zweite Stufe (Bestaetigungsansicht): WAS gekuendigt wird (Plan-Name) + WANN es wirkt
// (Periodenende, deutsch formatiert) - die beiden Pflichtangaben aus dem Auftrag.
export function cancelConfirmText(sub) {
  const name = planName(sub.planSlug);
  const date = germanDate(sub.currentPeriodEnd);
  return date
    ? `Your ${name} subscription will end on ${date}. Hermes keeps working as usual until then.`
    : `Your ${name} subscription will end at the close of the current billing period.`;
}

// Zustand, wenn bereits gekuendigt: Datum, bis zu dem der Dienst noch laeuft (deutsch
// formatiert, s. germanDate). Reiner String (DOM-frei, testbar); der Aufrufer setzt ihn
// via textContent (Muster subscriptionLine/quotaLine).
export function cancelStatusLine(sub) {
  const date = germanDate(sub.currentPeriodEnd);
  return date ? `Cancelled — active until ${date}.` : "Cancelled.";
}

// Rueckmeldungen der Kuendigungs-/Ruecknahme-Zustandsmaschine (Muster SUBSCRIBE_MESSAGES).
export const CANCEL_MESSAGES = Object.freeze({
  cancelled: "Subscription cancelled.",
  resumed: "Subscription resumed.",
  sessionExpired: SUBSCRIBE_MESSAGES.sessionExpired,
  noSubscription: "No active subscription to cancel.",
  cancelFailed: "Couldn't cancel your subscription. Please try again.",
  resumeFailed: "Couldn't resume your subscription. Please try again.",
});

// Ein Kuendigungs-/Ruecknahme-Lauf: POST ohne Body (die Identitaet kommt aus der Session,
// s. api.js). Erfolg (AUCH beim idempotenten Doppelklick - der Gateway antwortet dann mit
// demselben Body, s. self-service-routes.js) -> Rueckmeldung + onDone(result) (Aufrufer
// re-fetcht /state, Muster onSubscribed). 409 no_subscription -> Hinweis (die Insel zeigt
// die Schaltflaeche ohnehin nur bei vorhandenem Abo, dies ist das Sicherheitsnetz gegen ein
// zwischenzeitlich beendetes Abo in einem zweiten Tab). 401 -> Session abgelaufen.
async function runCancellationStep(op, messages, opts) {
  try {
    const result = await op();
    opts.onMessage(messages.ok, true);
    await opts.onDone(result);
  } catch (err) {
    if (isConflict(err)) return opts.onMessage(messages.conflict, false);
    if (isUnauthorized(err)) return opts.onMessage(CANCEL_MESSAGES.sessionExpired, false);
    return opts.onMessage(messages.failed, false);
  }
}

// Verdrahtet die vier festen Kuendigungs-Steuerelemente (KEINE dynamische Liste wie die
// Plan-Kacheln -> direkte Listener statt Delegation). els = { openBtn, confirmPanel,
// confirmBtn, abortBtn, resumeBtn }. openBtn/abortBtn schalten NUR Sichtbarkeit (rein DOM,
// kein Netz - die zweite Stufe ist noch keine Kuendigung). confirmBtn/resumeBtn loesen den
// jeweiligen Stripe-Call aus. onMessage(text, ok) + onDone(result) wie wireSubscribe.
export function wireCancelControls(els, { onMessage, onDone } = {}) {
  els.openBtn.addEventListener("click", () => {
    els.confirmPanel.hidden = false;
    els.openBtn.hidden = true;
  });
  els.abortBtn.addEventListener("click", () => {
    els.confirmPanel.hidden = true;
    els.openBtn.hidden = false;
  });
  els.confirmBtn.addEventListener("click", () =>
    runCancellationStep(
      startBillingCancel,
      { ok: CANCEL_MESSAGES.cancelled, conflict: CANCEL_MESSAGES.noSubscription, failed: CANCEL_MESSAGES.cancelFailed },
      { onMessage, onDone },
    ),
  );
  els.resumeBtn.addEventListener("click", () =>
    runCancellationStep(
      startBillingResume,
      { ok: CANCEL_MESSAGES.resumed, conflict: CANCEL_MESSAGES.noSubscription, failed: CANCEL_MESSAGES.resumeFailed },
      { onMessage, onDone },
    ),
  );
}
