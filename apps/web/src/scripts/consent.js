import {
  CONSENT_CATEGORIES,
  CONSENT_VERSION,
  buildConsent,
  logPayload,
  needsReload,
  newConsentId,
  shouldPrompt,
} from "./consent-core.js";

const KEY = "hermes.consent";
const BEACON_TYPE = "text/plain";
const GATED_SELECTOR = 'script[type="text/plain"][data-consent]';

function readConsent() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== CONSENT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeConsent(choice, previous) {
  const consent = buildConsent({ choice, previous, id: newConsentId(crypto), now: new Date() });
  try {
    localStorage.setItem(KEY, JSON.stringify(consent));
  } catch {
  }
  return consent;
}

const CONTROL_ATTRS = new Set(["type", "data-consent", "data-src", "data-consent-done"]);

function activateScripts(consent) {
  const blocked = document.querySelectorAll(GATED_SELECTOR);
  for (const el of blocked) {
    const category = el.dataset.consent;
    if (!consent[category] || el.dataset.consentDone === "1" || !el.dataset.src) continue;
    const script = document.createElement("script");
    for (const attr of el.attributes) {
      if (!CONTROL_ATTRS.has(attr.name)) script.setAttribute(attr.name, attr.value);
    }
    script.src = el.dataset.src;
    el.dataset.consentDone = "1";
    el.after(script);
  }
}

function activatedCategories() {
  const running = new Set();
  for (const el of document.querySelectorAll(GATED_SELECTOR)) {
    if (el.dataset.consentDone === "1") running.add(el.dataset.consent);
  }
  return running;
}

function logDecision(consent) {
  const url = root ? root.dataset.consentLog : "";
  if (!url || typeof navigator.sendBeacon !== "function") return;
  try {
    navigator.sendBeacon(
      url,
      new Blob([JSON.stringify(logPayload(consent))], { type: BEACON_TYPE }),
    );
  } catch {
  }
}

function announce(consent) {
  activateScripts(consent);
  document.dispatchEvent(new CustomEvent("hermes:consent", { detail: consent }));
}

const root = document.querySelector("[data-consent-root]");
const prefs = root ? root.querySelector("[data-consent-prefs]") : null;
const toggles = root ? [...root.querySelectorAll("[data-consent-cat]")] : [];
let lastFocus = null;

function isOpen() {
  return Boolean(root) && !root.hidden;
}

function showPrefs(visible) {
  if (!root || !prefs) return;
  prefs.hidden = !visible;
  root.setAttribute("data-prefs", visible ? "1" : "0");
  const toggle = root.querySelector('[data-consent-action="prefs"]');
  if (toggle) toggle.setAttribute("aria-expanded", String(visible));
}

function syncToggles(consent) {
  for (const input of toggles) {
    input.checked = Boolean(consent && consent[input.dataset.consentCat]);
  }
}

function open(withPrefs) {
  if (!root) return;
  lastFocus = document.activeElement;
  syncToggles(readConsent());
  showPrefs(Boolean(withPrefs));
  root.hidden = false;
  const card = root.querySelector(".consent__card");
  if (card) card.focus({ preventScroll: true });
}

function close() {
  if (!root) return;
  root.hidden = true;
  showPrefs(false);
  if (lastFocus && typeof lastFocus.focus === "function") {
    lastFocus.focus({ preventScroll: true });
  }
  lastFocus = null;
}

function decide(choice) {
  const previous = readConsent();
  const consent = writeConsent(choice, previous);
  logDecision(consent);
  close();
  if (needsReload({ previous, next: consent, activated: activatedCategories() })) {
    window.location.reload();
    return;
  }
  announce(consent);
}

function choiceFromToggles() {
  const choice = {};
  for (const input of toggles) choice[input.dataset.consentCat] = input.checked;
  return choice;
}

function wire() {
  if (!root) return;
  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-consent-action]");
    if (!button) return;
    const action = button.dataset.consentAction;
    if (action === "all") {
      const all = {};
      for (const category of CONSENT_CATEGORIES) all[category] = true;
      decide(all);
    } else if (action === "necessary") {
      decide({});
    } else if (action === "save") {
      decide(choiceFromToggles());
    } else if (action === "prefs") {
      showPrefs(prefs ? prefs.hidden : false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen() && readConsent()) close();
  });

  for (const el of document.querySelectorAll("[data-consent-open]")) {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      open(true);
    });
  }
}

function init() {
  if (!root) return;
  wire();
  const consent = readConsent();
  if (consent) {
    announce(consent);
  } else if (shouldPrompt({ consent })) {
    open(false);
  }
}

window.hermesConsent = {
  get: readConsent,
  open: () => open(true),
};

init();
