import {
  ApiError,
  HTTP_CONFLICT,
  HTTP_UNAUTHORIZED,
  notifySessionExpired,
  startBillingSetupCheckout,
  startBillingCancel,
  startBillingResume,
  addNewsletterRecipient,
  removeNewsletterRecipient,
} from "./api.js";
import { PLAN_CATALOG, formatPlanPrice, findPlan } from "./plans.js";
import { el } from "./render.js";
import { getLang, tPair, tDyn } from "./i18n.js";

const PRICE_CADENCE = " /month";
const PRICE_CADENCE_DE = " /Monat";
const SUBSCRIBE_LABEL = "Subscribe";
const SUBSCRIBE_LABEL_DE = "Abonnieren";
const POPULAR_BADGE = "Popular";
const POPULAR_BADGE_DE = "Beliebt";
const ACTIVE_PLAN_PREFIX = "Active plan: ";
const ACTIVE_PLAN_PREFIX_DE = "Aktiver Tarif: ";
const PLAN_ATTR = "plan";
const FEE_NOTICE_PREFIX = "+ ";
const FEE_NOTICE_SUFFIX = " one-time number setup fee";
const FEE_NOTICE_SUFFIX_DE = " einmalige Einrichtungsgebühr für die Nummer";

const MS_PER_SECOND = 1000;
const DATE_LOCALE = "en-US";

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

function priceLine(doc, plan) {
  const line = el(doc, "div", "plan-price", formatPlanPrice(plan.amountCents, plan.currency, getLang()));
  line.append(el(doc, "span", "plan-per", tPair(PRICE_CADENCE, PRICE_CADENCE_DE)));
  return line;
}

function featureList(doc, features) {
  const list = el(doc, "ul", "plan-features");
  for (const feature of features || []) list.append(el(doc, "li", "plan-feature", feature));
  return list;
}

function feeLine(doc, fee) {
  if (!fee) return null;
  const price = formatPlanPrice(fee.amountCents, fee.currency, getLang());
  const suffix = tPair(FEE_NOTICE_SUFFIX, FEE_NOTICE_SUFFIX_DE);
  return el(doc, "div", "plan-fee", `${FEE_NOTICE_PREFIX}${price}${suffix}`);
}

function subscribeButton(doc, slug) {
  const btn = el(doc, "button", "btn plan-cta", tPair(SUBSCRIBE_LABEL, SUBSCRIBE_LABEL_DE));
  btn.type = "button";
  btn.dataset[PLAN_ATTR] = slug;
  return btn;
}

function planTile(doc, plan, fee) {
  const tile = el(doc, "div", plan.featured ? "plan plan--featured" : "plan");
  if (plan.featured) tile.append(el(doc, "span", "plan-badge", tPair(POPULAR_BADGE, POPULAR_BADGE_DE)));
  tile.append(el(doc, "div", "plan-name", plan.name), priceLine(doc, plan), featureList(doc, plan.features));
  const feeEl = feeLine(doc, fee);
  if (feeEl) tile.append(feeEl);
  tile.append(subscribeButton(doc, plan.slug));
  return tile;
}

export function planTiles(doc, fee = null) {
  return PLAN_CATALOG.map((plan) => planTile(doc, plan, fee));
}

function renewDate(epochSeconds) {
  if (!epochSeconds) return "";
  const d = new Date(epochSeconds * MS_PER_SECOND);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(getLang() === "de" ? DATE_LOCALE_DE : DATE_LOCALE);
}

function planName(slug) {
  const plan = findPlan(slug);
  if (plan) return plan.name;
  return slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : "";
}

export function subscriptionLine(sub) {
  const name = planName(sub.planSlug);
  const date = renewDate(sub.currentPeriodEnd);
  if (!date) return `${tPair(ACTIVE_PLAN_PREFIX, ACTIVE_PLAN_PREFIX_DE)}${name}.`;
  return tPair(
    `${ACTIVE_PLAN_PREFIX}${name} (renews ${date}).`,
    `${ACTIVE_PLAN_PREFIX_DE}${name} (verlängert sich am ${date}).`,
  );
}

export function quotaLine(quota) {
  if (!quota) return null;
  return tPair(
    `${quota.remainingMinutes} of ${quota.includedMinutes} minutes remaining`,
    `${quota.remainingMinutes} von ${quota.includedMinutes} Minuten übrig`,
  );
}

const PERCENT_MIN = 0;
const PERCENT_MAX = 100;

export function quotaUsedPercent(quota) {
  if (!quota || !quota.includedMinutes) return PERCENT_MIN;
  const used = quota.includedMinutes - quota.remainingMinutes;
  const percent = Math.round((used / quota.includedMinutes) * 100);
  return Math.min(PERCENT_MAX, Math.max(PERCENT_MIN, percent));
}

function isConflict(err) {
  return err instanceof ApiError && err.status === HTTP_CONFLICT;
}
function isUnauthorized(err) {
  return err instanceof ApiError && err.status === HTTP_UNAUTHORIZED;
}

function checkoutErrorMessage(err) {
  if (isConflict(err)) return subscribeMessage("alreadySubscribed");
  if (isUnauthorized(err)) return subscribeMessage("sessionExpired");
  return subscribeMessage("checkoutFailed");
}

async function runSubscribe(plan, opts) {
  try {
    const url = await startBillingSetupCheckout(plan);
    opts.navigate(url);
  } catch (err) {
    opts.onMessage(checkoutErrorMessage(err), false);
  }
}

function browserNavigate(url) {
  window.location.assign(url);
}

export function wireSubscribe(container, { onMessage, navigate = browserNavigate } = {}) {
  let busy = false;
  container.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-plan]");
    if (!btn || busy) return undefined;
    busy = true;
    return runSubscribe(btn.dataset[PLAN_ATTR], { onMessage, navigate }).finally(() => {
      busy = false;
    });
  });
}

export const PLAN_CHOICE_COPY = Object.freeze({
  title: "Choose your plan",
  subtitle: "Pick a plan to activate your assistant and get your phone number.",
  bannerTitle: "Account pending",
  bannerText: "You can subscribe anytime to activate your assistant.",
});
export const PLAN_CHOICE_COPY_DE = Object.freeze({
  title: "Wähle deinen Tarif",
  subtitle: "Wähle einen Tarif, um deinen Assistenten zu aktivieren und deine Rufnummer zu erhalten.",
  bannerTitle: "Konto ausstehend",
  bannerText: "Du kannst jederzeit abonnieren, um deinen Assistenten zu aktivieren.",
});
function planChoiceText(key) {
  return tDyn({ en: PLAN_CHOICE_COPY, de: PLAN_CHOICE_COPY_DE }, key);
}

export function renderPlanChoice(doc, els, fee = null) {
  els.title.textContent = planChoiceText("title");
  els.subtitle.textContent = planChoiceText("subtitle");
  els.tiles.replaceChildren(...planTiles(doc, fee));
  els.skip.hidden = false;
  Object.assign(els.restore, { hidden: true });
}

export function dismissPlanChoice(els) {
  els.title.textContent = planChoiceText("bannerTitle");
  els.subtitle.textContent = planChoiceText("bannerText");
  els.tiles.replaceChildren();
  els.skip.hidden = true;
  Object.assign(els.restore, { hidden: false });
}

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

function germanDate(epochSeconds) {
  if (!epochSeconds) return "";
  const d = new Date(epochSeconds * MS_PER_SECOND);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(DATE_LOCALE_DE);
}

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

export function cancelStatusLine(sub) {
  if (getLang() === "de") {
    const date = germanDate(sub.currentPeriodEnd);
    return date ? `Gekündigt — aktiv bis ${date}.` : "Gekündigt.";
  }
  const date = renewDate(sub.currentPeriodEnd);
  return date ? `Cancelled — active until ${date}.` : "Cancelled.";
}

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

export function wireCancelControls(els, { onMessage, onDone } = {}) {
  els.openBtn.addEventListener("click", () => {
    els.confirmPanel.hidden = false;
    els.openBtn.hidden = true;
  });
  els.abortBtn.addEventListener("click", () => {
    els.confirmPanel.hidden = true;
    els.openBtn.hidden = false;
  });
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

export const BILLING_STATUS = Object.freeze({
  NO_CARD: "no_card",
  NO_SUB: "no_sub",
  ACTIVE: "active",
  CANCELLED: "cancelled",
});

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

export function billingStatusText(kind, sub) {
  if (kind === BILLING_STATUS.ACTIVE) return subscriptionLine(sub);
  if (kind === BILLING_STATUS.CANCELLED) return `${planName(sub.planSlug)} — ${cancelStatusLine(sub)}`;
  if (kind === BILLING_STATUS.NO_CARD) return tPair(NO_CARD_STATUS_TEXT, NO_CARD_STATUS_TEXT_DE);
  return tPair(NO_SUB_STATUS_TEXT, NO_SUB_STATUS_TEXT_DE);
}

export function billingStatusHeadline(kind, sub) {
  if (kind === BILLING_STATUS.ACTIVE || kind === BILLING_STATUS.CANCELLED) return planName(sub.planSlug);
  return billingStatusBadge(kind);
}

const RENEWS_PREFIX = "Renews ";
const RENEWS_PREFIX_DE = "Verlängert am ";

export function billingStatusDetail(kind, sub) {
  if (kind === BILLING_STATUS.ACTIVE) {
    const date = renewDate(sub.currentPeriodEnd);
    return date ? `${tPair(RENEWS_PREFIX, RENEWS_PREFIX_DE)}${date}` : "";
  }
  if (kind === BILLING_STATUS.CANCELLED) return cancelStatusLine(sub);
  return billingStatusText(kind, sub);
}

async function postNewsletterConsent(consent) {
  const res = await fetch("/api/self-service/newsletter-consent", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ consent }),
  });
  if (!res.ok) {
    if (res.status === HTTP_UNAUTHORIZED) notifySessionExpired();
    let code;
    try {
      const body = await res.json();
      if (body && typeof body.error === "string") code = body.error;
    } catch {
    }
    throw new ApiError(res.status, `POST newsletter-consent -> ${res.status}`, { code });
  }
  return res.json();
}

export function newsletterConsentFrom(data) {
  const newsletter = (data && data.newsletter) || {};
  return newsletter.consent === true;
}

export function accountEmailFrom(data) {
  const email = data && data.accountEmail;
  return typeof email === "string" && email ? email : null;
}

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
      toggleEl.checked = !requested;
      onMessage(
        isUnauthorized(err) ? newsletterMessage("sessionExpired") : newsletterMessage("failed"),
        false,
      );
    } finally {
      toggleEl.disabled = false;
    }
  });
}

export function newsletterRecipientsFrom(data) {
  const list = data && data.newsletterRecipients;
  return Array.isArray(list) ? list : [];
}

export function hasPendingNewsletterRecipient(data) {
  return newsletterRecipientsFrom(data).some((r) => r && r.status === RECIPIENT_STATUS_PENDING);
}

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

function newsletterRecipientErrorText(err) {
  if (isUnauthorized(err)) return newsletterRecipientMessage("sessionExpired");
  const code = err instanceof ApiError ? err.code : undefined;
  if (code && Object.prototype.hasOwnProperty.call(NEWSLETTER_RECIPIENT_MESSAGES, code)) {
    return newsletterRecipientMessage(code);
  }
  return newsletterRecipientMessage("failed");
}

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

const RECIPIENT_EMPTY = "No one else yet.";
const RECIPIENT_EMPTY_DE = "Sonst noch niemand.";
const RECIPIENT_REMOVE_LABEL = "Remove recipient";
const RECIPIENT_REMOVE_LABEL_DE = "Empfänger entfernen";
const RECIPIENT_PENDING_HINT = "Confirmation email sent";
const RECIPIENT_PENDING_HINT_DE = "Bestätigungs-E-Mail gesendet";
const RECIPIENT_STATUS_PENDING = "pending";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(doc, tag, attrs) {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of attrs) node.setAttribute(name, value);
  return node;
}

function removeCross(doc) {
  const svg = svgEl(doc, "svg", [
    ["viewBox", "0 0 16 16"],
    ["aria-hidden", "true"],
    ["focusable", "false"],
  ]);
  svg.append(
    svgEl(doc, "path", [
      ["d", "M4 4 L12 12 M12 4 L4 12"],
      ["stroke", "currentColor"],
      ["stroke-width", "1.5"],
      ["stroke-linecap", "round"],
    ]),
  );
  return svg;
}

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
  const removeBtn = el(doc, "button", "newsletter-recipient__remove");
  removeBtn.type = "button";
  removeBtn.setAttribute("aria-label", tPair(RECIPIENT_REMOVE_LABEL, RECIPIENT_REMOVE_LABEL_DE));
  removeBtn.append(removeCross(doc));
  removeBtn.addEventListener("click", () => onRemove(recipient.email, removeBtn));
  main.append(removeBtn);
  li.append(main);
  if (recipient.status === RECIPIENT_STATUS_PENDING) {
    li.append(el(doc, "p", "newsletter-form__hint", tPair(RECIPIENT_PENDING_HINT, RECIPIENT_PENDING_HINT_DE)));
  }
  return li;
}

export function newsletterRecipientRows(doc, data, onRemove = () => {}) {
  const recipients = newsletterRecipientsFrom(data);
  if (!recipients.length) return [el(doc, "li", "data-empty", tPair(RECIPIENT_EMPTY, RECIPIENT_EMPTY_DE))];
  return recipients.map((r) => recipientRow(doc, r, onRemove));
}

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

export async function newsletterRecipientRemove(email, { onMessage, onRemoved } = {}) {
  try {
    await removeNewsletterRecipient(email);
    onMessage(newsletterRecipientMessage("removed"), true);
    await onRemoved();
  } catch (err) {
    onMessage(newsletterRecipientErrorText(err), false);
  }
}
