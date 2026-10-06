const LANG_KEY = "hermes.lang.v2";
const LEGACY_LANG_KEY = "hermes.lang";

try {
  localStorage.removeItem(LEGACY_LANG_KEY);
} catch {
}
const SUPPORTED_LANGS = new Set(["de", "en"]);

export const LANG_EVENT = "hermes:lang";

export function getLang() {
  let saved = null;
  try {
    saved = localStorage.getItem(LANG_KEY);
  } catch {
  }
  return SUPPORTED_LANGS.has(saved) ? saved : "en";
}

export function setLang(lang) {
  const next = SUPPORTED_LANGS.has(lang) ? lang : "en";
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
  }
  document.documentElement.lang = next;
  document.dispatchEvent(new CustomEvent(LANG_EVENT));
  return next;
}

export function t(key) {
  const lang = getLang();
  return STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
}

export function applyStaticTranslations(root = document) {
  for (const node of root.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll("[data-i18n-attr]")) {
    const [attr, key] = (node.dataset.i18nAttr || "").split(":");
    if (attr && key) node.setAttribute(attr.trim(), t(key.trim()));
  }
}

export function tPair(en, de) {
  return getLang() === "de" ? de : en;
}

export function tDyn(dict, key) {
  const table = dict[getLang()] ?? dict.en;
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : dict.en[key];
}

export const STRINGS = {
  en: {
    signIn: "Sign in",
    signOut: "Sign out",
    authPending: "Account awaiting activation",
    authSignedInAs: "Signed in as {name}",
    authSignedIn: "Signed in",

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

    yourNumber: "Your number",
    copy: "Copy",
    copied: "Copied",
    copyAriaLabel: "Copy phone number",

    callsTitle: "Calls",
    viewDetails: "View details",
    showMore: "Show more",
    showLess: "Show less",
    transcript: "Transcript",
    modalClose: "Close",

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

    privateNumberTitle: "YOUR OWN NUMBER",
    privateNumberHint:
      "Save your own phone number so your agent recognizes you. When it calls you on this number, it skips the full third-party introduction.",
    privateNumberInputAriaLabel: "Your own phone number",
    privateNumberSave: "Save number",
    privateNumberRemove: "Remove",

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
    signIn: "Anmelden",
    signOut: "Abmelden",
    authPending: "Konto wartet auf Freischaltung",
    authSignedInAs: "Angemeldet als {name}",
    authSignedIn: "Angemeldet",

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

    yourNumber: "Deine Nummer",
    copy: "Kopieren",
    copied: "Kopiert",
    copyAriaLabel: "Rufnummer kopieren",

    callsTitle: "Anrufe",
    viewDetails: "Details ansehen",
    showMore: "Mehr anzeigen",
    showLess: "Weniger anzeigen",
    transcript: "Gesprächsverlauf",
    modalClose: "Schließen",

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

    privateNumberTitle: "DEINE EIGENE NUMMER",
    privateNumberHint:
      "Speichere deine eigene Rufnummer, damit dein Agent dich erkennt. Ruft er dich auf dieser Nummer an, entfällt die lange Vorstellung.",
    privateNumberInputAriaLabel: "Deine eigene Rufnummer",
    privateNumberSave: "Nummer speichern",
    privateNumberRemove: "Entfernen",

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
