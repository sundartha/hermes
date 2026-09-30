/* =============================================================================
 * cancel-form.js - Kuendigungsformular ohne Anmeldung (§ 312k BGB).
 *
 * Verdrahtet jedes form[data-cancel-form] (auf /kuendigen eines, im Reiter der
 * Startseite je Sprache eines): blendet Grund bzw. Wunschtermin nur bei Bedarf
 * ein, schickt die Erklaerung an den Gateway (data-endpoint, lib/routes.js) und
 * zeigt danach die Bestaetigungsseite mit Eingangszeitpunkt, die sich speichern
 * oder drucken laesst (§ 312k Abs. 3). Entscheidungen: lib/cancel-form.js.
 *
 * Gesendet wird als application/x-www-form-urlencoded - ein CORS-"einfacher"
 * Request ohne Preflight (connect-src der CSP fuehrt den Gateway-Origin).
 * Astro buendelt die Datei als externes, same-origin Modul (CSP script-src 'self').
 * ========================================================================== */

import {
  FORM_MESSAGE,
  formatReceivedAt,
  formatWishDate,
  isAccepted,
  messageForStatus,
  payloadFrom,
} from "../lib/cancel-form.js";

const MESSAGE_ATTR = Object.freeze({
  [FORM_MESSAGE.INVALID]: "msgInvalid",
  [FORM_MESSAGE.RATE]: "msgRate",
  [FORM_MESSAGE.UNAVAILABLE]: "msgUnavailable",
});
const ISO_DATE_LENGTH = 10;
const MS_PER_MINUTE = 60_000;

const checkedInput = (form, name) => form.querySelector(`input[name="${name}"]:checked`);

// Ein Zusatzfeld (Grund, Wunschtermin) ist nur sichtbar - und nur dann
// Pflicht -, wenn die zugehoerige Auswahl es verlangt.
function syncOptionalField(form, { selector, name, value }) {
  const field = form.querySelector(selector);
  const active = checkedInput(form, name)?.value === value;
  field.hidden = !active;
  field.querySelector("input, textarea").required = active;
}

function syncOptionalFields(form) {
  syncOptionalField(form, { selector: "[data-cf-reason]", name: "kind", value: "extraordinary" });
  syncOptionalField(form, { selector: "[data-cf-date]", name: "timing", value: "date" });
}

const fieldText = (data, name) => String(data.get(name) || "").trim();

function timingSummary(form, lang) {
  const timing = checkedInput(form, "timing");
  if (timing?.value === "date") return formatWishDate(fieldText(new FormData(form), "date"), lang);
  return timing?.dataset.summary ?? "";
}

function summaryValues(form, receivedAt) {
  const { lang } = form.dataset;
  const data = new FormData(form);
  const kind = checkedInput(form, "kind");
  return {
    name: fieldText(data, "name"),
    email: fieldText(data, "email"),
    reference: fieldText(data, "reference"),
    kind: kind?.dataset.summary ?? "",
    reason: kind?.value === "extraordinary" ? fieldText(data, "reason") : "",
    timing: timingSummary(form, lang),
    receivedAt: formatReceivedAt(receivedAt, lang),
  };
}

function showConfirmation(form, receivedAt) {
  const done = form.parentElement.querySelector("[data-cancel-done]");
  const values = summaryValues(form, receivedAt);
  for (const [key, value] of Object.entries(values)) {
    for (const out of done.querySelectorAll(`[data-cf-out="${key}"]`)) out.textContent = value;
    const row = done.querySelector(`[data-cf-row="${key}"]`);
    if (row) row.hidden = !value;
  }
  form.toggleAttribute("hidden", true);
  done.hidden = false;
  done.focus();
}

function showError(form, message) {
  const box = form.querySelector("[data-cf-error]");
  box.textContent = form.dataset[MESSAGE_ATTR[message]] || "";
  box.hidden = false;
}

async function send(form) {
  try {
    const res = await fetch(form.dataset.endpoint, {
      method: "POST",
      body: payloadFrom(new FormData(form).entries()),
    });
    if (!isAccepted(res.status)) return { message: messageForStatus(res.status) };
    const { receivedAt } = await res.json();
    return { receivedAt };
  } catch {
    return { message: FORM_MESSAGE.UNAVAILABLE };
  }
}

async function submit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  form.querySelector("[data-cf-error]").hidden = true;
  button.disabled = true;
  form.setAttribute("aria-busy", "true");
  const { receivedAt, message } = await send(form);
  button.disabled = false;
  form.removeAttribute("aria-busy");
  if (receivedAt) showConfirmation(form, receivedAt);
  else showError(form, message);
}

function today() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * MS_PER_MINUTE);
  return local.toISOString().slice(0, ISO_DATE_LENGTH);
}

function mount(form) {
  form.querySelector('input[name="date"]').setAttribute("min", today());
  form.addEventListener("change", () => syncOptionalFields(form));
  form.addEventListener("submit", submit);
  syncOptionalFields(form);
  const done = form.parentElement.querySelector("[data-cancel-done]");
  done.querySelector("[data-cf-print]").addEventListener("click", () => window.print());
}

document.querySelectorAll("form[data-cancel-form]").forEach(mount);
