/* =============================================================================
 * consent.js — Einwilligung fuer Cookies & lokale Speicherung (§ 25 TDDDG,
 * Art. 6 Abs. 1 lit. a DSGVO).
 *
 * Grundsatz: Notwendiges (Sprachwahl "hermes.lang.v2", diese Entscheidung selbst,
 * Login-Sitzung im Kundenbereich) braucht keine Einwilligung (§ 25 Abs. 2 Nr. 2
 * TDDDG). Alles andere — Statistik, Marketing — laeuft erst NACH Zustimmung.
 *
 * Wie ein spaeterer Dienst angebunden wird (CSP-konform, same-origin):
 *   <script type="text/plain" data-consent="statistics" data-src="/scripts/stats.js"></script>
 * consent.js aktiviert solche Platzhalter genau einmal, sobald die Kategorie
 * freigegeben ist. Inline-Code geht NICHT (CSP script-src 'self') — nur data-src.
 *
 * Zusaetzlich: document-Event "hermes:consent" mit dem Stand als detail, und
 * window.hermesConsent = { get(), open() } fuer Fusszeilen-Links.
 *
 * Nachweis (Art. 7 Abs. 1 DSGVO): jede Entscheidung geht zusaetzlich als Beacon an
 * das Einwilligungs-Protokoll des Gateways (data-consent-log an der Karte, gesetzt aus
 * lib/routes.js). Uebertragen werden nur Zufalls-ID, Banner-Version und die zwei
 * Kategorien - s. src/cookie-consent-log.js im Wurzelprojekt.
 *
 * Widerruf: ein bereits geladenes Skript laesst sich nicht entladen. Wird eine
 * Kategorie widerrufen, deren Skript auf der Seite schon laeuft, laedt die Seite neu.
 *
 * Der Banner erscheint ungefragt nur, wenn auf der Seite ein gesperrtes Skript auf
 * Einwilligung wartet. Ohne solchen Dienst gibt es nichts zu fragen; ueber
 * "Cookie-Einstellungen" laesst er sich trotzdem jederzeit oeffnen.
 *
 * Astro buendelt diese Datei als externes, same-origin Modul (assetsInlineLimit
 * 0) — damit CSP-konform ohne script-src 'unsafe-inline'.
 * ========================================================================== */

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
    /* Privater Modus / Speicher voll: die Wahl gilt dann nur fuer diese Sitzung. */
  }
  return consent;
}

/* Aktiviert gesperrte Platzhalter-Skripte der freigegebenen Kategorien.
 * Alle uebrigen Attribute des Platzhalters wandern mit (data-domain bei
 * Plausible, data-website-id bei Umami, defer, crossorigin ...). */
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

/* Nachweis an das Protokoll. Fire-and-forget: sendBeacon ueberlebt auch das
 * Neuladen nach einem Widerruf. text/plain ist ein CORS-"einfacher" Typ (kein
 * Preflight). Scheitert der Versand, bleibt die Entscheidung trotzdem gueltig. */
function logDecision(consent) {
  const url = root ? root.dataset.consentLog : "";
  if (!url || typeof navigator.sendBeacon !== "function") return;
  try {
    navigator.sendBeacon(
      url,
      new Blob([JSON.stringify(logPayload(consent))], { type: BEACON_TYPE }),
    );
  } catch {
    /* Beacon abgelehnt (z. B. Blocker): kein Beleg, aber die Wahl gilt. */
  }
}

function announce(consent) {
  activateScripts(consent);
  document.dispatchEvent(new CustomEvent("hermes:consent", { detail: consent }));
}

/* ------------------------------------------------------------------- UI */

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
  // Fokus auf den Dialog selbst (tabindex -1): Screenreader lesen Titel und
  // Text vor, Tab fuehrt zur ersten Handlung — ohne sichtbaren Fokusring auf
  // "Alle akzeptieren" beim Oeffnen (das saehe nach Vorauswahl aus).
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

  // Esc schliesst nur, wenn schon eine Entscheidung vorliegt (sonst bliebe
  // die Frage unbeantwortet, und "Schliessen" darf keine Zustimmung sein).
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
  } else if (
    shouldPrompt({ consent, gatedScripts: document.querySelectorAll(GATED_SELECTOR).length })
  ) {
    open(false);
  }
}

window.hermesConsent = {
  get: readConsent,
  open: () => open(true),
};

init();
