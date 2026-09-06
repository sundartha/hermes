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
  addNewsletterRecipient,
  removeNewsletterRecipient,
} from "./api.js";
import { PLAN_CATALOG, formatPlanPrice, findPlan } from "./plans.js";
import { el } from "./render.js";
import { getLang, tPair, tDyn } from "./i18n.js";

// Anzeige-Konstanten (kein Magic-String an den Verwendungsstellen, G25). EN
// bleibt Quelle der Wahrheit (Name/Wert test-gepinnt); "_DE"-Geschwister +
// tPair/tDyn (lib/i18n.js) machen die Verwendungsstellen sprachbewusst
// (Etappe 2 -- Ausnahme: die 312k-Texte weiter unten, s. dortige Kommentare).
const PRICE_CADENCE = " /month";
const PRICE_CADENCE_DE = " /Monat";
const SUBSCRIBE_LABEL = "Subscribe";
const SUBSCRIBE_LABEL_DE = "Abonnieren";
const POPULAR_BADGE = "Popular";
const POPULAR_BADGE_DE = "Beliebt";
const ACTIVE_PLAN_PREFIX = "Active plan: ";
const ACTIVE_PLAN_PREFIX_DE = "Aktiver Tarif: ";
const PLAN_ATTR = "plan"; // data-plan: Slug am Subscribe-Button (delegierter Klick)
// Phase A (PLAN-VOUCHER-SETUP-FEE-GAP.md): Hinweis auf die ZWEITE, separate Abbuchung
// (src/onboarding.js placeHold), die dem Abo-Checkout folgt - ohne Hinweis sah der Kunde
// sie nur als ueberraschenden 402 danach (Problem A im Plan-Dokument).
const FEE_NOTICE_PREFIX = "+ "; // sprachneutral (Zahlenpraefix), keine DE-Variante noetig
const FEE_NOTICE_SUFFIX = " one-time number setup fee";
const FEE_NOTICE_SUFFIX_DE = " einmalige Einrichtungsgebühr für die Nummer";
// AM4: Funnel-Hinweis aus dem no_card-Response (Feld next). Spiegelt NEXT_SETUP_CHECKOUT in
// src/self-service-routes.js -- ein Contract-String ueber die Origin-Grenze (kein gemeinsames
// Modul im Build-freien Frontend, wie die gespiegelten Settings-/error-Strings).
const SETUP_CHECKOUT_NEXT = "setup-checkout";

const MS_PER_SECOND = 1000;
const DATE_LOCALE = "en-US";

// Rueckmeldungen der Subscribe-Zustandsmaschine (EINE Quelle, G5: aktiver UND
// suspended-Pfad zeigen denselben Text). SUBSCRIBE_MESSAGES bleibt der EN-
// Vertrag (Name/Werte test-gepinnt); subscribeMessage() liest darunter zusaetzlich
// SUBSCRIBE_MESSAGES_DE fuer die tatsaechlich angezeigte, sprachbewusste Meldung.
export const SUBSCRIBE_MESSAGES = Object.freeze({
  booked: "Subscription booked.",
  alreadySubscribed: "You already have a subscription.",
  sessionExpired: "Session expired - please sign in again.",
  failed: "Subscription couldn't be booked.",
  checkoutFailed: "Couldn't start checkout.",
});
export const SUBSCRIBE_MESSAGES_DE = Object.freeze({
  booked: "Abo gebucht.",
  alreadySubscribed: "Du hast bereits ein Abo.",
  sessionExpired: "Sitzung abgelaufen - bitte erneut anmelden.",
  failed: "Das Abo konnte nicht gebucht werden.",
  checkoutFailed: "Checkout konnte nicht gestartet werden.",
});
function subscribeMessage(key) {
  return tDyn({ en: SUBSCRIBE_MESSAGES, de: SUBSCRIBE_MESSAGES_DE }, key);
}

// ---- reine Builder ----------------------------------------------------------

// Preis-Zeile: formatierter Preis + " /month" als eigener Span. Beide ueber el()/
// textContent (Preis aus dem Ganzzahl-Cents-Katalog, formatPlanPrice).
function priceLine(doc, plan) {
  const line = el(doc, "div", "plan-price", formatPlanPrice(plan.amountCents, plan.currency));
  line.append(el(doc, "span", "plan-per", tPair(PRICE_CADENCE, PRICE_CADENCE_DE)));
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
  const suffix = tPair(FEE_NOTICE_SUFFIX, FEE_NOTICE_SUFFIX_DE);
  return el(doc, "div", "plan-fee", `${FEE_NOTICE_PREFIX}${price}${suffix}`);
}

// Subscribe-Button mit data-plan=<slug>. Der delegierte Klick-Listener (wireSubscribe)
// liest den Slug aus dataset.plan -> kein Binding pro Button (G5, kein Listener-Leak).
function subscribeButton(doc, slug) {
  const btn = el(doc, "button", "btn plan-cta", tPair(SUBSCRIBE_LABEL, SUBSCRIBE_LABEL_DE));
  btn.type = "button";
  btn.dataset[PLAN_ATTR] = slug;
  return btn;
}

// Eine Plan-Kachel. featured -> "Popular"-Badge (Parity zu preise.astro/tenant.html).
// fee (Phase A) optional: { amountCents, currency } | null -> zusaetzliche Gebuehren-
// Zeile zwischen Features und Subscribe-Button (feeLine, null -> keine Zeile).
function planTile(doc, plan, fee) {
  const tile = el(doc, "div", plan.featured ? "plan plan--featured" : "plan");
  if (plan.featured) tile.append(el(doc, "span", "plan-badge", tPair(POPULAR_BADGE, POPULAR_BADGE_DE)));
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
// (en-US) bzw. "TT.MM.JJJJ" (de-DE, s. DATE_LOCALE_DE weiter unten) -- dieselbe
// EINE toLocaleDateString-Aufrufstelle waehlt nur die Konstante (WEB-18-Drift-
// Test, test/dashboard-i18n-surface.test.js: KEINE zweite Aufrufstelle).
// Fehlend/ungueltig -> "" (die Abo-Zeile zeigt dann nur den Plan-Namen).
function renewDate(epochSeconds) {
  if (!epochSeconds) return "";
  const d = new Date(epochSeconds * MS_PER_SECOND);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(getLang() === "de" ? DATE_LOCALE_DE : DATE_LOCALE);
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
  if (!date) return `${tPair(ACTIVE_PLAN_PREFIX, ACTIVE_PLAN_PREFIX_DE)}${name}.`;
  // Voller Satz je Sprache (nicht nur ein Wort ersetzt) -- die Wortstellung
  // unterscheidet sich zwischen EN und DE. EN bleibt test-gepinnt woertlich.
  return tPair(
    `${ACTIVE_PLAN_PREFIX}${name} (renews ${date}).`,
    `${ACTIVE_PLAN_PREFIX_DE}${name} (verlängert sich am ${date}).`,
  );
}

// Kontingent-Zeile: "{remaining} of {included} minutes remaining" oder null, wenn
// kein Kontingent vorliegt (kein aktives Abo / PAYMENT_ENABLED aus). null -> der
// Aufrufer versteckt die Zeile. Keys gespiegelt aus src/billing/meter.js quotaView.
export function quotaLine(quota) {
  if (!quota) return null;
  return tPair(
    `${quota.remainingMinutes} of ${quota.includedMinutes} minutes remaining`,
    `${quota.remainingMinutes} von ${quota.includedMinutes} Minuten übrig`,
  );
}

const PERCENT_MIN = 0;
const PERCENT_MAX = 100;

// Verbrauchter Anteil in Prozent fuer den Minuten-Fortschrittsbalken (Dashboard-
// Design-Spec §10). Geklemmt auf [0,100] (Verteidigung gegen inkonsistente Server-
// Werte, z.B. remainingMinutes > includedMinutes). Kein Kontingent -> 0 (der
// Aufrufer rendert den Balken ohnehin nur, wenn quotaLine(...) einen Text liefert).
export function quotaUsedPercent(quota) {
  if (!quota || !quota.includedMinutes) return PERCENT_MIN;
  const used = quota.includedMinutes - quota.remainingMinutes;
  const percent = Math.round((used / quota.includedMinutes) * 100);
  return Math.min(PERCENT_MAX, Math.max(PERCENT_MIN, percent));
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
      isUnauthorized(err) ? subscribeMessage("sessionExpired") : subscribeMessage("checkoutFailed"),
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
  if (isConflict(err)) return opts.onMessage(subscribeMessage("alreadySubscribed"), false);
  if (isUnauthorized(err)) return opts.onMessage(subscribeMessage("sessionExpired"), false);
  return opts.onMessage(subscribeMessage("failed"), false);
}

// Ein Subscribe-Lauf: POST {plan}. Erfolg -> Rueckmeldung + onSubscribed (re-fetch
// /state + AUTH_EVENT bzw. Reload, je nach Pfad). Misserfolg -> handleSubscribeError.
async function runSubscribe(plan, opts) {
  try {
    await startBillingSubscribe(plan);
    opts.onMessage(subscribeMessage("booked"), true);
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
  // Doppelklick-Schutz (Payment-Neugestaltung): waehrend ein Subscribe-Request laeuft,
  // ignoriert der Listener JEDEN weiteren Klick (auf jede Kachel) - kein zweiter POST,
  // bevor der erste beantwortet ist. busy lebt im Closure DIESES Aufrufs (ein Container
  // = eine Maschine, gleiches Muster wie wireCancelControls unten).
  let busy = false;
  // Listener gibt das runSubscribe-Promise zurueck (vom Browser ignoriert) -> der
  // Lauf ist deterministisch await-bar (Test), kein Verlass auf Microtask-Timing.
  container.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-plan]");
    if (!btn || busy) return undefined;
    busy = true;
    return runSubscribe(btn.dataset[PLAN_ATTR], { onSubscribed, onMessage, navigate }).finally(() => {
      busy = false;
    });
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
// DE-Entsprechung (Etappe 2). PLAN_CHOICE_COPY bleibt der EN-Vertrag (test-
// gepinnt); renderPlanChoice/dismissPlanChoice lesen ueber planChoiceText()
// die sprachbewusste Fassung.
export const PLAN_CHOICE_COPY_DE = Object.freeze({
  title: "Wähle deinen Tarif",
  subtitle: "Wähle einen Tarif, um deinen Assistenten zu aktivieren und deine Rufnummer zu erhalten.",
  bannerTitle: "Konto ausstehend",
  bannerText: "Du kannst jederzeit abonnieren, um deinen Assistenten zu aktivieren.",
});
function planChoiceText(key) {
  return tDyn({ en: PLAN_CHOICE_COPY, de: PLAN_CHOICE_COPY_DE }, key);
}

// Rahmt die suspended-Region als prominente Plan-Auswahl: aktivierende H1, erklaerender
// Untertitel, Plan-Kacheln aus dem Build-Spiegel, sichtbarer Skip-Link. REIN DOM (doc + els),
// kein Netz. els = { title, subtitle, tiles, skip, restore }. Von den beiden Knoepfen ist
// IMMER genau einer sichtbar (CL1-B4). fee (Phase A) optional, an planTiles durchgereicht
// (numberSetupFeeFrom, null -> keine Gebuehren-Zeile). NUR bei PAYMENT_ENABLED aufgerufen
// (Aufrufer-Guard) -> ohne Payment byte-identisch.
export function renderPlanChoice(doc, els, fee = null) {
  els.title.textContent = planChoiceText("title");
  els.subtitle.textContent = planChoiceText("subtitle");
  els.tiles.replaceChildren(...planTiles(doc, fee));
  els.skip.hidden = false;
  // Object.assign statt direkter Zuweisung (no-param-reassign/props:true - dieselbe
  // Wirkung, ohne die bestehende Unterdrueckungszahl der Datei zu bewegen).
  Object.assign(els.restore, { hidden: true });
}

// "Maybe later": blendet die Plan-Auswahl aus, zeigt das ruhige Pending-Banner. REIN DOM,
// ruft KEIN subscribe/setStatus (Invariante AM3: aktiviert nichts, /state bleibt 403).
// CL1-B4: der Zustand behaelt einen Ausgang - der Skip-Knopf weicht dem Rueckweg zur
// Plan-Auswahl. Vorher blieb eine Ansicht ohne Link, Knopf oder Retry zurueck; einziger
// Rueckweg war ein manueller Reload, der nirgends angeboten wurde.
export function dismissPlanChoice(els) {
  els.title.textContent = planChoiceText("bannerTitle");
  els.subtitle.textContent = planChoiceText("bannerText");
  els.tiles.replaceChildren();
  els.skip.hidden = true;
  Object.assign(els.restore, { hidden: false });
}

// ---- 312k-P3: Kuendigungs-Weg (§ 312k BGB) ------------------------------------
// Der DEUTSCHE Wortlaut der beiden Schaltflaechen ist gesetzlich vorgegeben
// (§ 312k Abs. 2 BGB: "Vertraege hier kuendigen" oder eine entsprechende
// eindeutige Formulierung) und bleibt im DE-Modus WOERTLICH unangetastet.
// Owner-Entscheidung 2026-08-14: der EN-Modus zeigt eine gleichwertig
// EINDEUTIGE englische Formulierung statt des deutschen Sprachbruchs -- das
// Gesetz verlangt Eindeutigkeit, nicht deutsche Sprache in einer englischen
// Oberflaeche. Die EN-Fassungen sind eigene benannte Konstanten (KEIN
// Woerterbuch-Eintrag -- der Waechtertest dashboard-i18n-surface stellt sicher,
// dass der deutsche Pflichtwortlaut nie in einem uebersetzbaren Woerterbuch
// landet). EINE Quelle (G25) je Text: die Astro-Insel importiert Konstanten/
// Resolver statt den Wortlaut ein zweites Mal zu tragen.
export const CANCEL_BUTTON_LABEL = "Verträge kündigen";
export const CONFIRM_CANCEL_BUTTON_LABEL = "Jetzt kündigen";
export const CANCEL_BUTTON_LABEL_EN = "Cancel contracts";
export const CONFIRM_CANCEL_BUTTON_LABEL_EN = "Cancel now";
export function cancelButtonLabel() {
  return tPair(CANCEL_BUTTON_LABEL_EN, CANCEL_BUTTON_LABEL);
}
export function confirmCancelButtonLabel() {
  return tPair(CONFIRM_CANCEL_BUTTON_LABEL_EN, CONFIRM_CANCEL_BUTTON_LABEL);
}
// Die uebrigen Beschriftungen sind NICHT gesetzlich vorgegeben -> zweisprachig
// (Etappe 2), Muster der Nachbartexte (SUBSCRIBE_LABEL usw. oben). EN bleibt
// der test-gepinnte Vertrag; cancelAbortLabel()/resumeButtonLabel() liefern die
// sprachbewusste Fassung fuer die Insel (BillingIsland.astro rendert diese
// beiden Schaltflaechen serverseitig/englisch aus den Konstanten und ruft die
// Funktionen zusaetzlich bei jedem Render, s. renderCancelBlock dort).
export const CANCEL_ABORT_LABEL = "Never mind";
const CANCEL_ABORT_LABEL_DE = "Doch nicht";
export const RESUME_BUTTON_LABEL = "Resume subscription";
const RESUME_BUTTON_LABEL_DE = "Abo fortsetzen";
export function cancelAbortLabel() {
  return tPair(CANCEL_ABORT_LABEL, CANCEL_ABORT_LABEL_DE);
}
export function resumeButtonLabel() {
  return tPair(RESUME_BUTTON_LABEL, RESUME_BUTTON_LABEL_DE);
}

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
// (Periodenende) - die beiden Pflichtangaben aus dem Auftrag. Sprachbewusst
// (Owner-Entscheidung 2026-08-14): DE-Satz mit deutschem Datum (germanDate,
// TT.MM.JJJJ), EN-Satz mit renewDate (en-US) - beides BESTEHENDE Aufrufstellen,
// der Waechtertest (exakt 2 Locale-Aufrufstellen) bleibt unberuehrt.
export function cancelConfirmText(sub) {
  const name = planName(sub.planSlug);
  if (getLang() === "de") {
    const date = germanDate(sub.currentPeriodEnd);
    return date
      ? `Dein ${name}-Abo endet am ${date}. Hermes läuft bis dahin wie gewohnt weiter.`
      : `Dein ${name}-Abo endet zum Ende des laufenden Abrechnungszeitraums.`;
  }
  const date = renewDate(sub.currentPeriodEnd);
  return date
    ? `Your ${name} subscription will end on ${date}. Hermes keeps working as usual until then.`
    : `Your ${name} subscription will end at the close of the current billing period.`;
}

// Zustand, wenn bereits gekuendigt: Datum, bis zu dem der Dienst noch laeuft
// (sprachbewusst formatiert, s. cancelConfirmText). Reiner String (DOM-frei,
// testbar); der Aufrufer setzt ihn via textContent (Muster subscriptionLine/quotaLine).
export function cancelStatusLine(sub) {
  if (getLang() === "de") {
    const date = germanDate(sub.currentPeriodEnd);
    return date ? `Gekündigt — aktiv bis ${date}.` : "Gekündigt.";
  }
  const date = renewDate(sub.currentPeriodEnd);
  return date ? `Cancelled — active until ${date}.` : "Cancelled.";
}

// Rueckmeldungen der Kuendigungs-/Ruecknahme-Zustandsmaschine (Muster SUBSCRIBE_MESSAGES).
// CANCEL_MESSAGES bleibt der EN-Vertrag (test-gepinnt); cancelMessage() liest
// zusaetzlich CANCEL_MESSAGES_DE fuer die sprachbewusste Meldung.
export const CANCEL_MESSAGES = Object.freeze({
  cancelled: "Subscription cancelled.",
  resumed: "Subscription resumed.",
  sessionExpired: SUBSCRIBE_MESSAGES.sessionExpired,
  noSubscription: "No active subscription to cancel.",
  cancelFailed: "Couldn't cancel your subscription. Please try again.",
  resumeFailed: "Couldn't resume your subscription. Please try again.",
});
export const CANCEL_MESSAGES_DE = Object.freeze({
  cancelled: "Abo gekündigt.",
  resumed: "Abo fortgesetzt.",
  sessionExpired: SUBSCRIBE_MESSAGES_DE.sessionExpired,
  noSubscription: "Kein aktives Abo zum Kündigen.",
  cancelFailed: "Dein Abo konnte nicht gekündigt werden. Bitte versuch es erneut.",
  resumeFailed: "Dein Abo konnte nicht fortgesetzt werden. Bitte versuch es erneut.",
});
function cancelMessage(key) {
  return tDyn({ en: CANCEL_MESSAGES, de: CANCEL_MESSAGES_DE }, key);
}

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
    if (isUnauthorized(err)) return opts.onMessage(cancelMessage("sessionExpired"), false);
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
  // Doppelklick-Schutz (Payment-Neugestaltung): EIN busy-Flag fuer beide Netz-
  // Schaltflaechen (confirm/resume sind nie gleichzeitig sichtbar, s. renderCancelBlock
  // in BillingIsland.astro) - waehrend ein Cancel/Resume-Request laeuft, ignoriert ein
  // zweiter Klick ihn komplett (kein zweiter Client-Call, ergaenzt die serverseitige
  // Idempotenz aus self-service-routes.js setSubscriptionCancellation).
  let busy = false;
  function guardedStep(op, messages) {
    if (busy) return undefined;
    busy = true;
    return runCancellationStep(op, messages, { onMessage, onDone }).finally(() => {
      busy = false;
    });
  }
  els.confirmBtn.addEventListener("click", () =>
    guardedStep(startBillingCancel, {
      ok: cancelMessage("cancelled"),
      conflict: cancelMessage("noSubscription"),
      failed: cancelMessage("cancelFailed"),
    }),
  );
  els.resumeBtn.addEventListener("click", () =>
    guardedStep(startBillingResume, {
      ok: cancelMessage("resumed"),
      conflict: cancelMessage("noSubscription"),
      failed: cancelMessage("resumeFailed"),
    }),
  );
}

// ---- Status-Zusammenfassung (Payment-Neugestaltung) --------------------------
// EIN gemeinsamer, oben im Zahlungsbereich sichtbarer Zustand aus Karten-/Abo-Lage:
// kein Abo / Karte fehlt / aktiv / gekuendigt-zum-Periodenende - je EIN Satz, was als
// Naechstes passiert (Auftrag). "Fehler" ist bewusst KEIN fuenfter, hier abgeleiteter
// Zustand: er entsteht aus einer fehlgeschlagenen AKTION (Checkout/Subscribe/Cancel/
// Newsletter), nicht aus der Karten-/Abo-LAGE, und lebt in den bestehenden Ruecklauf-/
// Fehlermeldungen (SUBSCRIBE_MESSAGES/CANCEL_MESSAGES/NEWSLETTER_MESSAGES/
// returnMessageText), die BillingIsland.astro jetzt farblich absetzt (ok/err).
export const BILLING_STATUS = Object.freeze({
  NO_CARD: "no_card",
  NO_SUB: "no_sub",
  ACTIVE: "active",
  CANCELLED: "cancelled",
});

// Kurze Pillen-Beschriftung je Zustand. Exportiert NUR fuer den Woerterbuch-
// Paritaets-Waechter (test/dashboard-i18n-surface.test.js).
export const BILLING_STATUS_BADGE = Object.freeze({
  [BILLING_STATUS.NO_CARD]: "No card",
  [BILLING_STATUS.NO_SUB]: "No plan",
  [BILLING_STATUS.ACTIVE]: "Active",
  [BILLING_STATUS.CANCELLED]: "Cancelling",
});
export const BILLING_STATUS_BADGE_DE = Object.freeze({
  [BILLING_STATUS.NO_CARD]: "Keine Karte",
  [BILLING_STATUS.NO_SUB]: "Kein Tarif",
  [BILLING_STATUS.ACTIVE]: "Aktiv",
  [BILLING_STATUS.CANCELLED]: "Wird gekündigt",
});

// CSS-Klassen-Suffix je Zustand (billing-status-badge--<suffix> in BillingIsland.astro).
// active/cancelled nutzen dieselben Token-ROLLEN wie die Anruf-Status-Badges (app.css
// .status-badge--active/--cancelled: positive bzw. critical), pending ist eine ruhige
// neutrale Zwischenfarbe fuer die beiden Vorbereitungs-Zustaende.
const BILLING_STATUS_BADGE_CLASS = Object.freeze({
  [BILLING_STATUS.NO_CARD]: "pending",
  [BILLING_STATUS.NO_SUB]: "pending",
  [BILLING_STATUS.ACTIVE]: "active",
  [BILLING_STATUS.CANCELLED]: "cancelled",
});

const NO_CARD_STATUS_TEXT = "Add a payment method to unlock a plan.";
const NO_CARD_STATUS_TEXT_DE = "Hinterlege ein Zahlungsmittel, um einen Tarif freizuschalten.";
const NO_SUB_STATUS_TEXT = "Choose a plan below to activate Hermes.";
const NO_SUB_STATUS_TEXT_DE = "Wähle unten einen Tarif, um Hermes zu aktivieren.";

// Leitet den sichtbaren Zustand aus Karten-/Abo-Lage ab. Eindeutig - keine zwei
// Zustaende treffen je gleichzeitig zu: ein Abo setzt zwingend eine Karte voraus
// (createTenantSubscription gated no_card, s. self-service-routes.js), darum sticht
// ein aktives/gekuendigtes Abo automatisch vor der Karten-Frage.
export function billingStatusKind({ hasCard, sub }) {
  if (sub.planSlug) return sub.cancelAtPeriodEnd ? BILLING_STATUS.CANCELLED : BILLING_STATUS.ACTIVE;
  return hasCard ? BILLING_STATUS.NO_SUB : BILLING_STATUS.NO_CARD;
}

export function billingStatusBadge(kind) {
  return tDyn({ en: BILLING_STATUS_BADGE, de: BILLING_STATUS_BADGE_DE }, kind) || "";
}

export function billingStatusBadgeClass(kind) {
  return BILLING_STATUS_BADGE_CLASS[kind] || "pending";
}

// Der EINE Satz "was als Naechstes passiert" fuer den aktuellen Zustand. aktiv/
// gekuendigt nutzen die bereits vorhandenen dynamischen Saetze (subscriptionLine/
// cancelStatusLine, EINE Quelle, G5) - Cancelled haengt zusaetzlich den Plan-Namen
// DAVOR an (cancelStatusLine selbst bleibt unveraendert, ihr Wortlaut ist per Test
// gepinnt: "Cancelled - active until ...").
export function billingStatusText(kind, sub) {
  if (kind === BILLING_STATUS.ACTIVE) return subscriptionLine(sub);
  if (kind === BILLING_STATUS.CANCELLED) return `${planName(sub.planSlug)} — ${cancelStatusLine(sub)}`;
  if (kind === BILLING_STATUS.NO_CARD) return tPair(NO_CARD_STATUS_TEXT, NO_CARD_STATUS_TEXT_DE);
  return tPair(NO_SUB_STATUS_TEXT, NO_SUB_STATUS_TEXT_DE);
}

// Dashboard-Design-Spec §10: "Serif-Statuswert mit Mono-Nebenangabe" -- die Billing-
// Insel zeigt den Zustand jetzt zweizeilig statt als EIN Fliesstext. Beide Funktionen
// sind reine Aufspaltungen der bereits bestehenden, getesteten Bausteine (planName/
// renewDate/cancelStatusLine/billingStatusBadge/billingStatusText) -- KEINE neue
// Formulierung, KEIN fuenfter Zustand (G5: dieselbe Quelle, nur anders zusammengesetzt).
// billingStatusText/subscriptionLine/cancelStatusLine bleiben unveraendert (ihr
// Wortlaut ist per Test gepinnt) -- die Insel nutzt fuer die zweizeilige Darstellung
// stattdessen dieses Paar.

// Serif-Hauptwert: Plan-Name bei aktivem/gekuendigtem Abo, sonst dieselbe kurze
// Beschriftung wie die Status-Pille (billingStatusBadge, EINE Quelle statt eines
// zweiten "No card"/"No plan"-Textes).
export function billingStatusHeadline(kind, sub) {
  if (kind === BILLING_STATUS.ACTIVE || kind === BILLING_STATUS.CANCELLED) return planName(sub.planSlug);
  return billingStatusBadge(kind);
}

const RENEWS_PREFIX = "Renews ";
const RENEWS_PREFIX_DE = "Verlängert am ";

// Mono-Nebenangabe: Verlaengerungsdatum (aktiv) bzw. cancelStatusLine (gekuendigt,
// "Cancelled — active until ..."), sonst der bestehende erklaerende Satz aus
// billingStatusText (no_card/no_sub) -- dort ist die Nebenangabe bereits die
// vollstaendige Aussage, kein Headline/Detail-Split noetig.
export function billingStatusDetail(kind, sub) {
  if (kind === BILLING_STATUS.ACTIVE) {
    const date = renewDate(sub.currentPeriodEnd);
    return date ? `${tPair(RENEWS_PREFIX, RENEWS_PREFIX_DE)}${date}` : "";
  }
  if (kind === BILLING_STATUS.CANCELLED) return cancelStatusLine(sub);
  return billingStatusText(kind, sub);
}

// ---- Newsletter-Einwilligung (Opt-in, DSGVO Art. 7 Abs. 1) --------------------
// Route: POST /api/self-service/newsletter-consent, strikt boolean (src/self-
// service-routes.js). Der Zustand reist additiv in der state-Antwort unter
// data.newsletter (state-ops.js tenantNewsletterConsent) -- KEIN Settings-Feld,
// kein Teil der SELF_SERVICE_FREE_FIELDS-Whitelist (Muster privateNumber, H4:
// eigener Record, eigene Route).

// EIGENER kleiner Request statt eines Imports aus lib/api.js: apiRequest ist dort
// NICHT exportiert (G17-Kapselung fuer den Rest-Client), und dieser Endpunkt gehoert
// nicht zum settings-Schreibpfad. Gleiche Form wie die uebrigen Requests dieses
// Clients (Strategie 2.3: same-origin, JSON, ApiError bei non-2xx).
async function postNewsletterConsent(consent) {
  const res = await fetch("/api/self-service/newsletter-consent", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ consent }),
  });
  if (!res.ok) {
    let code;
    try {
      const body = await res.json();
      if (body && typeof body.error === "string") code = body.error;
    } catch {
      // kein/kein gueltiger JSON-Body -> code bleibt undefined, Status entscheidet
    }
    throw new ApiError(res.status, `POST newsletter-consent -> ${res.status}`, { code });
  }
  return res.json();
}

// Liest die Einwilligung aus der state-Antwort -- die EINE Stelle, an der dieses
// Modul die Form `data.newsletter.consent` annimmt (Contract-Grenze, R5). NIE
// vorangekreuzt: fehlt das Feld (aelterer Server) oder ist consent nicht strikt
// true -> false (fail-closed neutral, Muster subscriptionFrom/cardStatus in api.js).
export function newsletterConsentFrom(data) {
  const newsletter = (data && data.newsletter) || {};
  return newsletter.consent === true;
}

// F2-Mail: liest die Konto-E-Mail aus der state-Antwort (data.accountEmail, additiv,
// src/self-service-routes.js) -- Muster newsletterConsentFrom. Reine Anzeige (readonly
// Prefill des E-Mail-Felds, KEIN Schreibziel/kein zweiter Endpunkt); fehlt das Feld
// (aelterer Server) oder ist es kein String -> null, der Aufrufer zeigt dann den
// Platzhalter statt einer erfundenen Adresse.
export function accountEmailFrom(data) {
  const email = data && data.accountEmail;
  return typeof email === "string" && email ? email : null;
}

// Rueckmeldungen des Newsletter-Schalters (Muster SUBSCRIBE_MESSAGES/CANCEL_MESSAGES).
// NEWSLETTER_MESSAGES bleibt der EN-Vertrag (test-gepinnt); newsletterMessage()
// liest zusaetzlich NEWSLETTER_MESSAGES_DE fuer die sprachbewusste Meldung.
export const NEWSLETTER_MESSAGES = Object.freeze({
  optedIn: "You're subscribed to product updates.",
  optedOut: "You're unsubscribed from product updates.",
  sessionExpired: SUBSCRIBE_MESSAGES.sessionExpired,
  failed: "Couldn't save your choice. Please try again.",
});
export const NEWSLETTER_MESSAGES_DE = Object.freeze({
  optedIn: "Du hast Produkt-Updates abonniert.",
  optedOut: "Du hast Produkt-Updates abbestellt.",
  sessionExpired: SUBSCRIBE_MESSAGES_DE.sessionExpired,
  failed: "Deine Wahl konnte nicht gespeichert werden. Bitte versuch es erneut.",
});
function newsletterMessage(key) {
  return tDyn({ en: NEWSLETTER_MESSAGES, de: NEWSLETTER_MESSAGES_DE }, key);
}

// Verdrahtet den Newsletter-Toggle: Umschalten schreibt SOFORT gegen die Route
// (kein separater Speichern-Knopf noetig, eine einzelne Einwilligungs-Erklaerung).
// Erfolg -> das Haekchen bleibt auf dem SERVER-bestaetigten Wert (result.newsletter-
// Consent, kein blinder Vertrauensvorschuss auf den gesendeten Wert) + Bestaetigung.
// Fehler -> das Haekchen springt zurueck auf den vorherigen Zustand (kein
// vorgetaeuschter Erfolg) + Meldung. toggleEl = die Checkbox.
export function wireNewsletterToggle(toggleEl, { onMessage } = {}) {
  toggleEl.addEventListener("change", async () => {
    const requested = toggleEl.checked;
    toggleEl.disabled = true;
    try {
      const result = await postNewsletterConsent(requested);
      toggleEl.checked = Boolean(result && result.newsletterConsent === true);
      onMessage(
        toggleEl.checked ? newsletterMessage("optedIn") : newsletterMessage("optedOut"),
        true,
      );
    } catch (err) {
      toggleEl.checked = !requested; // Rueckfall: Haekchen springt zurueck
      onMessage(
        isUnauthorized(err) ? newsletterMessage("sessionExpired") : newsletterMessage("failed"),
        false,
      );
    } finally {
      toggleEl.disabled = false;
    }
  });
}

// ---- F2-Newsletter-Recipients: Zusatzempfaenger (Double-Opt-in) --------------
// Additive Liste NEBEN dem Boolean-Consent-Pfad oben (state.newsletterRecipients,
// src/newsletter-recipients.js) -- eigene Adressen Dritter, eigenes Gate (Format ->
// Duplikat (auch gegen die Konto-Adresse) -> Cap 5 -> Tageslimit, s. self-service-
// routes.js planAddNewsletterRecipient). KEIN eigener state-Fetch hier (Muster
// BillingIsland refreshState): die Insel re-fetcht nach add/remove selbst und
// re-dispatcht AUTH_EVENT (onAdded/onRemoved unten).

// Liest die additive Empfaengerliste aus der state-Antwort -- die EINE Stelle, an
// der dieses Modul die Form `data.newsletterRecipients` annimmt (Contract-Grenze,
// R5). Kein Array (aelterer Server/fehlend) -> leere Liste (Muster listFrom/
// callsFrom in lib/api.js), nie ein Absturz.
export function newsletterRecipientsFrom(data) {
  const list = data && data.newsletterRecipients;
  return Array.isArray(list) ? list : [];
}

// Steht mindestens eine Bestaetigung aus? Grundlage fuer den Auto-Refresh der
// NewsletterIsland (Pending-Watch): solange hier true, zieht die Insel den
// State selbst nach, damit "Ausstehend" -> "Bestätigt" ohne manuellen Reload
// umspringt. Fail-closed: kaputte/fehlende Liste oder Zeilen ohne status -> false
// (kein Polling ins Leere bei aelterem Server).
export function hasPendingNewsletterRecipient(data) {
  return newsletterRecipientsFrom(data).some((r) => r && r.status === RECIPIENT_STATUS_PENDING);
}

// Rueckmeldungen (Muster NEWSLETTER_MESSAGES/CANCEL_MESSAGES): Erfolgs- UND
// Fehler-Schluessel in EINEM Woerterbuch. Die Fehler-Schluessel sind die
// STABILEN Server-Codes aus planAddNewsletterRecipient (invalid_format/
// duplicate/cap_reached/daily_limit, self-service-routes.js) -- direkt als
// Lookup-Schluessel, kein zweites Mapping.
export const NEWSLETTER_RECIPIENT_MESSAGES = Object.freeze({
  added: "Confirmation email sent.",
  removed: "Recipient removed.",
  invalid_format: "That doesn't look like a valid email address.",
  duplicate: "That address is already on your list.",
  cap_reached: "You've reached the limit of 5 recipients.",
  daily_limit: "Daily limit reached — please try again tomorrow.",
  sessionExpired: SUBSCRIBE_MESSAGES.sessionExpired,
  failed: "Couldn't save your change. Please try again.",
});
export const NEWSLETTER_RECIPIENT_MESSAGES_DE = Object.freeze({
  added: "Bestätigungs-E-Mail gesendet.",
  removed: "Empfänger entfernt.",
  invalid_format: "Das sieht nicht nach einer gültigen E-Mail-Adresse aus.",
  duplicate: "Diese Adresse steht bereits auf deiner Liste.",
  cap_reached: "Du hast das Limit von 5 Empfängern erreicht.",
  daily_limit: "Tageslimit erreicht — bitte versuch es morgen erneut.",
  sessionExpired: SUBSCRIBE_MESSAGES_DE.sessionExpired,
  failed: "Deine Änderung konnte nicht gespeichert werden. Bitte versuch es erneut.",
});
function newsletterRecipientMessage(key) {
  return tDyn({ en: NEWSLETTER_RECIPIENT_MESSAGES, de: NEWSLETTER_RECIPIENT_MESSAGES_DE }, key);
}

// Fehlertext einer fehlgeschlagenen Add/Remove-Anfrage: 401 -> Session abgelaufen;
// ein bekannter Server-Code -> die passende Meldung; sonst der generische
// Fallback (Muster handleSubscribeError, fail-closed nie erfunden).
function newsletterRecipientErrorText(err) {
  if (isUnauthorized(err)) return newsletterRecipientMessage("sessionExpired");
  const code = err instanceof ApiError ? err.code : undefined;
  if (code && Object.prototype.hasOwnProperty.call(NEWSLETTER_RECIPIENT_MESSAGES, code)) {
    return newsletterRecipientMessage(code);
  }
  return newsletterRecipientMessage("failed");
}

// Status-Pillen-Beschriftung + CSS-Klassen-Suffix je Empfaenger-Status. Nutzt
// DIESELBEN Farbtoken wie die Billing-Status-Pille oben (billing-status-badge
// --active/--cancelled -- EINE Quelle/G5 statt neu erfundener Farben): pending =
// gelblich (--cancelled-Ton), confirmed = gruenlich (--active-Ton), exakt die im
// Auftrag genannte Materialsprache der Call-Status-Pillen (calls.css).
export const NEWSLETTER_RECIPIENT_STATUS_LABELS = Object.freeze({ pending: "Pending", confirmed: "Confirmed" });
export const NEWSLETTER_RECIPIENT_STATUS_LABELS_DE = Object.freeze({ pending: "Ausstehend", confirmed: "Bestätigt" });
export function newsletterRecipientStatusLabel(status) {
  return (
    tDyn({ en: NEWSLETTER_RECIPIENT_STATUS_LABELS, de: NEWSLETTER_RECIPIENT_STATUS_LABELS_DE }, status) || status
  );
}
export function newsletterRecipientBadgeClass(status) {
  return status === "confirmed" ? "active" : "cancelled";
}

const RECIPIENT_EMPTY = "No additional recipients yet.";
const RECIPIENT_EMPTY_DE = "Noch keine weiteren Empfänger.";
const RECIPIENT_REMOVE_LABEL = "Remove recipient";
const RECIPIENT_REMOVE_LABEL_DE = "Empfänger entfernen";
const RECIPIENT_PENDING_HINT = "Confirmation email sent";
const RECIPIENT_PENDING_HINT_DE = "Bestätigungs-E-Mail gesendet";
const RECIPIENT_STATUS_PENDING = "pending";

// Eine Empfaenger-Zeile: Adresse (Sans) + Status-Pille + Ghost-Kreuz zum
// Entfernen; eine pending-Zeile traegt zusaetzlich den Mono-Hinweis (Auftrag).
// onRemove(email, button) wird bei jedem Zeilen-eigenen Button-Klick gerufen --
// kein delegierter Listener noetig, die Liste wird bei jedem AUTH_EVENT komplett
// ersetzt (Muster callRow in lib/render.js).
function recipientRow(doc, recipient, onRemove) {
  const li = el(doc, "li", "newsletter-recipient");
  const main = el(doc, "div", "newsletter-recipient__main");
  main.append(el(doc, "span", "newsletter-recipient__email", recipient.email));
  main.append(
    el(
      doc,
      "span",
      `billing-status-badge billing-status-badge--${newsletterRecipientBadgeClass(recipient.status)}`,
      newsletterRecipientStatusLabel(recipient.status),
    ),
  );
  const removeBtn = el(doc, "button", "newsletter-recipient__remove", "×");
  removeBtn.type = "button";
  removeBtn.setAttribute("aria-label", tPair(RECIPIENT_REMOVE_LABEL, RECIPIENT_REMOVE_LABEL_DE));
  removeBtn.addEventListener("click", () => onRemove(recipient.email, removeBtn));
  main.append(removeBtn);
  li.append(main);
  if (recipient.status === RECIPIENT_STATUS_PENDING) {
    li.append(el(doc, "p", "newsletter-form__hint", tPair(RECIPIENT_PENDING_HINT, RECIPIENT_PENDING_HINT_DE)));
  }
  return li;
}

// Die Empfaengerliste als DOM-Knoten (Muster callRows: (doc, data, onSelect) ->
// Knoten, direkt mit bindList verdrahtbar). Leere Liste -> EINE ruhige
// Hinweiszeile (data-empty, dieselbe Optik wie die Anrufliste), kein leeres <ul>.
export function newsletterRecipientRows(doc, data, onRemove = () => {}) {
  const recipients = newsletterRecipientsFrom(data);
  if (!recipients.length) return [el(doc, "li", "data-empty", tPair(RECIPIENT_EMPTY, RECIPIENT_EMPTY_DE))];
  return recipients.map((r) => recipientRow(doc, r, onRemove));
}

// Verdrahtet das Hinzufuegen-Formular (echtes <form>, Muster wireNewsletterToggle:
// schreibt sofort gegen die Route, kein zweiter Speichern-Schritt -- ein <form>
// gibt native Enter-zum-Absenden-Semantik gratis dazu). Doppel-Submit-Schutz wie
// wireSubscribe/wireCancelControls (busy-Flag). Erfolg -> Feld geleert + onAdded()
// (die Insel re-fetcht + re-dispatcht AUTH_EVENT, Muster BillingIsland
// refreshState). els = { form, input, addBtn }.
export function wireNewsletterRecipientAdd(els, { onAdded, onMessage } = {}) {
  let busy = false;
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) return undefined;
    const email = els.input.value.trim();
    busy = true;
    els.addBtn.disabled = true;
    return addNewsletterRecipient(email)
      .then(async () => {
        els.input.value = "";
        onMessage(newsletterRecipientMessage("added"), true);
        await onAdded();
      })
      .catch((err) => onMessage(newsletterRecipientErrorText(err), false))
      .finally(() => {
        busy = false;
        els.addBtn.disabled = false;
      });
  });
}

// Ein Entfernen-Lauf (Klick auf das Ghost-Kreuz einer Zeile): kein Doppelklick-
// Schutz noetig (jede Zeile traegt ihren eigenen Button, der Server ist ohnehin
// idempotent -- Muster removeRecipient in self-service-routes.js). Erfolg ->
// Meldung + onRemoved() (Re-Fetch, Muster wireCancelControls onDone).
export async function newsletterRecipientRemove(email, { onMessage, onRemoved } = {}) {
  try {
    await removeNewsletterRecipient(email);
    onMessage(newsletterRecipientMessage("removed"), true);
    await onRemoved();
  } catch (err) {
    onMessage(newsletterRecipientErrorText(err), false);
  }
}
