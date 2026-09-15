// i18n-Kern fuer das Dashboard (/app). Sinngemaess derselbe Mechanismus wie die
// Marketing-Website (apps/web/src/scripts/hermes-scroll.js, Zeilen 18-113): ein
// data-i18n-Attribut je uebersetzbarem Element, ein Woerterbuch, ein
// localStorage-Key. Hier als eigenstaendiges Modul ohne Framework-Bindung, weil
// mehrere Astro-Inseln (kein gemeinsamer Root-Scope) es importieren.
//
// Markup bleibt Englisch (Quelle der Wahrheit, test-gepinnt -- WEB-03/
// dashboard-i18n-surface). [data-i18n]/[data-i18n-attr] markieren, was zur
// Laufzeit ersetzt wird.
//
// Derselbe Schluesselname wie die Website. Geteilt wird der WERT aber nur
// innerhalb eines Origins: sundartha.com (Static-Service) und app.sundartha.com
// (Gateway) haben getrennte localStorage-Baeume. Auf dem Gateway-Origin liegen
// Dashboard UND Startseite, dort wirkt die Wahl also ueber beide.
//
// Der Schluessel traegt seit dem Default-Wechsel eine Version: Wahlen aus der
// Zeit, als Deutsch der Default war, sollen Englisch nicht aushebeln. Der alte
// Eintrag wird hier ebenfalls entfernt und nicht nur in
// scripts/hermes-scroll.js -- das Dashboard laedt jenes Modul nicht, sonst
// bliebe auf dem Gateway-Origin ein verwaister Wert liegen, den der
// Datenschutztext nicht mehr beschreibt.

const LANG_KEY = "hermes.lang.v2";
const LEGACY_LANG_KEY = "hermes.lang";

// Einmaliges Aufraeumen beim Laden des Moduls. Eigenes try/catch: im
// Privatmodus wirft schon der Zugriff, und ein Fehler hier darf die Insel
// nicht am Starten hindern.
try {
  localStorage.removeItem(LEGACY_LANG_KEY);
} catch {
  /* Kein Speicher -- dann gibt es auch nichts aufzuraeumen. */
}
const SUPPORTED_LANGS = new Set(["de", "en"]);

// Event, ueber das setLang() eine Sprachaenderung meldet. Lauscher: AuthIsland
// (Umschalter-UI, re-dispatcht das zuletzt gecachte AUTH_EVENT + ruft
// applyStaticTranslations() erneut auf -- kein Reload).
export const LANG_EVENT = "hermes:lang";

// Liest die gespeicherte Sprache. try/catch fuer den Privatmodus (Safari wirft
// dort beim Zugriff auf localStorage). Nur "de"/"en" sind gueltig, alles
// andere (fehlend, korrupt, fremder Wert) faellt auf "en" zurueck.
export function getLang() {
  let saved = null;
  try {
    saved = localStorage.getItem(LANG_KEY);
  } catch {
    /* Privater Modus: kein Speicher -- Rueckfall unten greift. */
  }
  return SUPPORTED_LANGS.has(saved) ? saved : "en";
}

// Setzt die Sprache: validiert, schreibt localStorage (best effort), spiegelt
// sie auf <html lang> und meldet die Aenderung per LANG_EVENT. Rueckgabe die
// tatsaechlich gesetzte (validierte) Sprache.
export function setLang(lang) {
  const next = SUPPORTED_LANGS.has(lang) ? lang : "en";
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    /* Privater Modus: die Wahl gilt nur fuer diese Sitzung. */
  }
  document.documentElement.lang = next;
  document.dispatchEvent(new CustomEvent(LANG_EVENT));
  return next;
}

// Uebersetzung eines einzelnen Schluessels in der aktuellen Sprache. Fehlt der
// Schluessel dort, faellt es auf die englische Fassung zurueck, danach auf den
// rohen Schluessel selbst (nie ein leerer String im UI).
export function t(key) {
  const lang = getLang();
  return STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
}

// Ersetzt textContent aller [data-i18n]-Elemente unterhalb von root (Default:
// ganzes Dokument) durch t(key). KEIN innerHTML -- die Dashboard-Strings
// brauchen kein Inline-HTML; taucht doch einmal HTML-Bedarf auf, wird der
// String im Markup gesplittet (Beispiel: "Welcome," + Besitzer-Name als zwei
// getrennte Knoten in pages/app/index.astro).
//
// [data-i18n-attr] uebersetzt zusaetzlich EIN Attribut (aria-label, placeholder,
// ...) im Format "attrname:key".
export function applyStaticTranslations(root = document) {
  for (const node of root.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll("[data-i18n-attr]")) {
    const [attr, key] = (node.dataset.i18nAttr || "").split(":");
    if (attr && key) node.setAttribute(attr.trim(), t(key.trim()));
  }
}

// tPair/tDyn: die kleinen Aufloeser fuer Etappe 2 (dynamische Strings aus
// lib/render.js, lib/subscribe.js, lib/api.js -- werden zur Renderzeit erzeugt,
// nicht ueber [data-i18n] gesetzt). Die STRINGS-Woerterbuecher oben bleiben
// bewusst NUR fuer statisches Markup: die drei Module halten ihre EN-Konstanten
// (Namen/Werte bleiben test-gepinnt) und je eine kleine, modul-lokale DE-
// Entsprechung (Konvention "<NAME>_DE") daneben -- die Aufloeser hier wandeln
// EIN Wertepaar (tPair) bzw. EIN Schluessel-Nachschlag in einem {en,de}-Objekt
// (tDyn) in die aktuelle Sprache um. EINE Konvention fuer alle drei Module,
// keine dritte Schreibweise.
export function tPair(en, de) {
  return getLang() === "de" ? de : en;
}

// dict = { en: {...}, de: {...} } (bzw. Arrays, die duerfen ebenso indiziert
// werden). Fehlt der Schluessel in der Zielsprache -> Rueckfall auf EN (nie
// undefined) -- Muster von t() oben.
export function tDyn(dict, key) {
  const table = dict[getLang()] ?? dict.en;
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : dict.en[key];
}

// STRINGS: alle STATISCHEN Markup-/Insel-Texte des Dashboards (Auth-Zustaende,
// Nav, Eyebrow, Begruessung, Kartentitel, Erklaertexte, Knoepfe, aria-labels,
// insel-interne Statusmeldungen). EN = die heutigen Markup-Texte 1:1 (bleibt
// Quelle der Wahrheit). DE nach DASHBOARD-AUFTRAG.md / tasks/dashboard-design-
// spec.md, durchgaengig Du-Form.
//
// Bewusst NICHT hier: alles, was aus lib/render.js, lib/subscribe.js oder
// lib/api.js kommt (Anrufliste, Status-/Richtungspillen, Tarifkacheln,
// Sprachkacheln-Labels, Kuendigungs-Knoepfe, Subscribe-/Checkout-Fehlertexte
// dieser drei Module). Das ist Etappe 2 -- sie ergaenzt diese Strings NICHT
// hier, sondern ueber tPair/tDyn direkt in den jeweiligen Modulen (s.o.).
export const STRINGS = {
  en: {
    // Auth (AuthIsland)
    signIn: "Sign in",
    signOut: "Sign out",
    authPending: "Account awaiting activation",
    authSignedInAs: "Signed in as {name}",
    authSignedIn: "Signed in",

    // App-Shell (pages/app/index.astro)
    loading: "Loading…",
    signInRequiredTitle: "Sign in required",
    signInRequiredText: "Please sign in to manage your phone assistant.",
    pendingTitle: "Account awaiting activation",
    pendingText:
      "Your account has been created and is awaiting activation. Once it's active, your assistant will appear here.",
    pendingSkip: "Maybe later",
    pendingRestore: "Show plans",
    errorTitle: "Something went wrong",
    errorText: "The app couldn't load just now. Check your connection and try again.",
    errorRetry: "Try again",
    yourArea: "Your area",
    welcome: "Welcome,",
    navCalls: "Calls",
    navSettings: "Settings",
    navBilling: "Billing",
    navNewsletter: "Newsletter",
    sectionNavAriaLabel: "Section navigation",

    // AgentChip
    yourNumber: "Your number",
    copy: "Copy",
    copied: "Copied",
    copyAriaLabel: "Copy phone number",

    // CallsIsland
    callsTitle: "Calls",
    viewDetails: "View details",
    transcript: "Transcript",
    modalClose: "Close",

    // SettingsIsland
    settingsTitle: "My agent settings",
    settingsHint: "Takes effect on the next call.",
    agentLanguage: "Agent language",
    agentLanguageHint: "Choose the language your agent speaks on calls, or leave it automatic.",
    save: "Save",
    settingsAppliedPrefix: "Saved. Applied:",
    settingsAppliedEmpty: "—",
    settingsRejectedPrefix: "rejected:",
    settingsSessionExpired: "Session expired - please sign in again.",
    settingsNotSaved: "Not saved.",

    // SettingsIsland: own-number block (OC-P2/OC-P3, PLAN-OWNER-CALL)
    privateNumberTitle: "YOUR OWN NUMBER",
    privateNumberHint:
      "Save your own phone number so your agent recognizes you. When it calls you on this number, it skips the full third-party introduction.",
    privateNumberInputAriaLabel: "Your own phone number",
    privateNumberSave: "Save number",
    privateNumberRemove: "Remove",

    // BillingIsland
    billingTitle: "Billing",
    billingSubtitle: "Your plan, payment method and usage for Hermes.",
    paymentMethod: "Payment method",
    cardOnFile: "Card on file.",
    noCardOnFile: "No card on file yet.",
    addPaymentMethod: "Add payment method",
    addDifferentCard: "Add a different card",
    usage: "Usage",
    choosePlan: "Choose your plan",
    billingFootnote: "Payments are processed securely via Stripe.",
    billingSessionExpired: "Session expired - please sign in again.",
    checkoutError: "Couldn't start checkout.",
    cardSaved: "Card saved.",
    cardCancelled: "Cancelled - no card saved.",
    cardError: "Something went wrong - no card was saved. Please try again.",
    subBooked: "Subscription booked.",
    subFailed: "Card saved, but the subscription couldn't be booked. Please try again.",

    // NewsletterIsland
    newsletterTitle: "Newsletter",
    newsletterSubtitle: "Get a short summary emailed after every call — unsubscribe anytime.",
    newsletterAriaLabel: "Subscribe to the newsletter",
    accountEmailAriaLabel: "Account email",
    subscribe: "Subscribe",
    subscribed: "Subscribed",
    unsubscribe: "Unsubscribe",
    newsletterHint: "Sent to your account email.",
    newsletterRecipientsTitle: "Recipients",
    newsletterRecipientAriaLabel: "Recipient email",
    newsletterAdd: "Add",
  },
  de: {
    // Auth (AuthIsland)
    signIn: "Anmelden",
    signOut: "Abmelden",
    authPending: "Konto wartet auf Freischaltung",
    authSignedInAs: "Angemeldet als {name}",
    authSignedIn: "Angemeldet",

    // App-Shell (pages/app/index.astro)
    loading: "Lädt…",
    signInRequiredTitle: "Anmeldung erforderlich",
    signInRequiredText: "Bitte melde dich an, um deinen Telefonassistenten zu verwalten.",
    pendingTitle: "Konto wartet auf Freischaltung",
    pendingText:
      "Dein Konto wurde erstellt und wartet auf die Freischaltung. Sobald es aktiv ist, erscheint dein Assistent hier.",
    pendingSkip: "Vielleicht später",
    pendingRestore: "Tarife anzeigen",
    errorTitle: "Etwas ist schiefgelaufen",
    errorText: "Die App konnte gerade nicht geladen werden. Prüf deine Verbindung und versuch es erneut.",
    errorRetry: "Erneut versuchen",
    yourArea: "Dein Bereich",
    welcome: "Willkommen,",
    navCalls: "Anrufe",
    navSettings: "Einstellungen",
    navBilling: "Abrechnung",
    navNewsletter: "Newsletter",
    sectionNavAriaLabel: "Bereichsnavigation",

    // AgentChip
    yourNumber: "Deine Nummer",
    copy: "Kopieren",
    copied: "Kopiert",
    copyAriaLabel: "Rufnummer kopieren",

    // CallsIsland
    callsTitle: "Anrufe",
    viewDetails: "Details ansehen",
    transcript: "Gesprächsverlauf",
    modalClose: "Schließen",

    // SettingsIsland
    settingsTitle: "Mein Agent",
    settingsHint: "Wird beim nächsten Anruf wirksam.",
    agentLanguage: "Sprache des Agenten",
    agentLanguageHint: "Wähle die Sprache, die dein Agent bei Anrufen spricht, oder lass es automatisch.",
    save: "Speichern",
    settingsAppliedPrefix: "Gespeichert. Übernommen:",
    settingsAppliedEmpty: "—",
    settingsRejectedPrefix: "abgelehnt:",
    settingsSessionExpired: "Sitzung abgelaufen - bitte erneut anmelden.",
    settingsNotSaved: "Nicht gespeichert.",

    // SettingsIsland: Block eigene Nummer (OC-P2/OC-P3, PLAN-OWNER-CALL)
    privateNumberTitle: "DEINE EIGENE NUMMER",
    privateNumberHint:
      "Speichere deine eigene Rufnummer, damit dein Agent dich erkennt. Ruft er dich auf dieser Nummer an, entfällt die lange Vorstellung.",
    privateNumberInputAriaLabel: "Deine eigene Rufnummer",
    privateNumberSave: "Nummer speichern",
    privateNumberRemove: "Entfernen",

    // BillingIsland
    billingTitle: "Abrechnung",
    billingSubtitle: "Dein Tarif, Zahlungsmittel und Verbrauch für Hermes.",
    paymentMethod: "Zahlungsmittel",
    cardOnFile: "Karte hinterlegt.",
    noCardOnFile: "Noch keine Karte hinterlegt.",
    addPaymentMethod: "Zahlungsmittel hinzufügen",
    addDifferentCard: "Andere Karte hinzufügen",
    usage: "Verbrauch",
    choosePlan: "Tarif wählen",
    billingFootnote: "Zahlungen werden sicher über Stripe abgewickelt.",
    billingSessionExpired: "Sitzung abgelaufen - bitte erneut anmelden.",
    checkoutError: "Checkout konnte nicht gestartet werden.",
    cardSaved: "Karte gespeichert.",
    cardCancelled: "Abgebrochen - keine Karte gespeichert.",
    cardError: "Etwas ist schiefgelaufen - es wurde keine Karte gespeichert. Bitte versuch es erneut.",
    subBooked: "Abo gebucht.",
    subFailed: "Karte gespeichert, aber das Abo konnte nicht gebucht werden. Bitte versuch es erneut.",

    // NewsletterIsland
    newsletterTitle: "Newsletter",
    newsletterSubtitle:
      "Erhalte nach jedem Anruf eine kurze Zusammenfassung per E-Mail — jederzeit abbestellbar.",
    newsletterAriaLabel: "Newsletter abonnieren",
    accountEmailAriaLabel: "Konto-E-Mail",
    subscribe: "Anmelden",
    subscribed: "Angemeldet",
    unsubscribe: "Abbestellen",
    newsletterHint: "Wird an deine Konto-E-Mail gesendet.",
    newsletterRecipientsTitle: "Empfänger",
    newsletterRecipientAriaLabel: "E-Mail-Adresse des Empfängers",
    newsletterAdd: "Hinzufügen",
  },
};
