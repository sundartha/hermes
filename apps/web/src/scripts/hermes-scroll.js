/* =============================================================================
 * hermes-scroll.js — Verhalten der Startseite
 *
 * Herkunft: die Logik-Klasse aus "Hermes Scroll.dc.html". Dort lief sie als
 * React-Komponente; hier als reines DOM-Modul, weil die Live-Seite statisch
 * ausgeliefert wird. Astro buendelt diese Datei zu einem externen, same-origin
 * Modul (astro.config: assetsInlineLimit 0) — damit CSP-konform, ohne
 * script-src 'unsafe-inline'.
 *
 * Vier Aufgaben:
 *   1. Scroll-Choreografie der vier Ebenen (Hero, So funktioniert's, Preise,
 *      Fuer Entwickler) plus aufsteigendes Fussband.
 *   2. Tastatur-Navigation, die auf die Ruhepunkte der Sektionen springt.
 *   3. Vollbild-Blaetter am Handy (Menue, Sektionen, Rechtstexte).
 *   4. Sprachumschalter EN/DE (Default EN).
 * ========================================================================== */

import { anchorFromHash } from "../lib/home-anchors.js";

const QUADRATIC_EXPONENT = 2;
const CUBIC_EXPONENT = 3;
const EASE_HALF_PROGRESS = 0.5;

const HERO_TRAVEL_MAX_PX = 220;
const HERO_NAV_CLEARANCE_PX = 12;
const HERO_FADE_DISTANCE_VH = 0.88;
const HINT_FADE_OUT_FACTOR = 3;
const LAYER_FADE_OUT_FACTOR = 1.35;

const HOWTO_RISE_START_VH = 0.95;
const HOWTO_RISE_DISTANCE_VH = 0.6;
const HOWTO_VISIBLE_MIN_OPACITY = 0.02;
const HOWTO_INTERACTIVE_MIN_RISE = 0.6;
const HOWTO_TO_PRICE_START_VH = 1.6;
const PRICE_TO_DEV_START_VH = 3.2;
const LAYER_RISE_DELAY_VH = 0.75;
const LAYER_RISE_DISTANCE_VH = 0.5;
const LAYER_EXIT_DISTANCE_VH = 0.7;
const LAYER_RISE_OFFSET_PX = 34;
const LAYER_INTERACTIVE_MIN_RISE = 0.5;
const LAYER_INTERACTIVE_MAX_EXIT = 0.2;

const DEV_PLAY_MIN_RISE = 0.55;
const DEV_REPLAY_MAX_RISE = 0.08;
const DEV_CARD_A_DELAY_RISE = 0.05;
const DEV_CARD_B_DELAY_RISE = 0.3;
const DEV_CARD_RISE_OFFSET_PX = 46;
const DEV_BOTTOM_PADDING_STEP_MODE_PX = 20;
const DEV_BOTTOM_PADDING_LOW_VIEWPORT_PX = 34;
const DEV_BOTTOM_PADDING_PX = 44;
const LOW_VIEWPORT_MAX_HEIGHT_PX = 660;
const DEV_HEAD_FADE_DISTANCE_PX = 36;

const FOOTER_START_VH = 4.55;
const FOOTER_START_STEP_MODE_VH = 4.68;
const FOOTER_RISE_DISTANCE_VH = 0.5;
const FOOTER_HIDDEN_OFFSET_PERCENT = 100;
const FOOTER_INTERACTIVE_MIN_RISE = 0.6;

const STEP_FULL_OPACITY_RADIUS_STEPS = 0.22;
const STEP_CROSSFADE_STEPS = 0.3;
const STEP_SLIDE_PX = 44;
const STEP_VISIBLE_MIN_OPACITY = 0.01;

const PRICE_STOP_VH = 3.05;
const DEV_STOP_VH = 4.65;
const FOOTER_STOP_VH = 5.2;
const KEY_STOP_TOLERANCE_VH = 0.25;

const GLIDE_MIN_DISTANCE_PX = 2;
const GLIDE_HERO_ZONE_VH = 0.5;
const GLIDE_FROM_HERO_MS_PER_VH = 470;
const GLIDE_MS_PER_VH = 620;
const GLIDE_MIN_MS = 560;
const GLIDE_MAX_MS = 1400;

const SWIPE_MIN_DISTANCE_PX = 44;
const SWIPE_HORIZONTAL_DOMINANCE_FACTOR = 1.4;
const COPIED_LABEL_DURATION_MS = 1800;

/* ------------------------------------------------------------------ Sprache */

/* Englisch steht IM HTML (das ist seit dem Default-Wechsel 2026-09-10 die
 * indexierte Fassung). Hier liegt nur die deutsche Gegenfassung; beim ersten
 * Umschalten wird der englische Stand je Element eingefroren, damit das
 * Zurueckschalten verlustfrei ist. */
const DE = {
  howItWorks: "So funktioniert's",
  pricing: "Preise",
  forDevs: "Für Entwickler",
  getNumber: "Nummer holen",
  logIn: "Login",
  signUp: "Registrieren",
  heroTitle: "<span class=\"l1\">Gib deiner KI</span> <span>eine <em>Telefonnummer</em>.</span>",
  heroLead: "Hermes nimmt Anrufe an und führt sie für dich. Ein Anschluss über <strong>MCP</strong> — und deine KI hat eine Stimme.",
  howtoTitle: "Ein Anschluss, <em>zwei Minuten</em>.",
  howtoLead: "Ein Anschluss über <strong>MCP</strong>, kein Setup — deine KI ist in unter zwei Minuten unter einer echten Nummer erreichbar.",
  priceTitle: "Zwei Tarife, <em>keine Überraschungen</em>.",
  priceLead: "Wähle das Paket, welches zu dir passt. <strong>Monatlich kündbar</strong>, <strong>keine versteckten Kosten</strong>.",
  starterLabel: "Starter",
  businessLabel: "Pro",
  popular: "Beliebt",
  /* Preisnotation folgt der Sprache: englisch "€4.99" (Punkt, Symbol vorn),
   * deutsch "4,99 €" (Komma, Symbol nachgestellt). Dieselbe Regel wie
   * lib/plans.js formatPlanPrice -- die Betraege selbst stehen im
   * Tarif-Katalog (lib/plans.js), der Gleichlauf ist test-gepinnt
   * (apps/web/test/pages.test.js). */
  starterPrice: "4,99 €",
  businessPrice: "9,99 €",
  perMonth: "/ Monat",
  starterF1: "<strong>30 Minuten</strong> Gespräche pro Monat",
  starterF2: "Nimmt jeden Anruf für dich an",
  starterF3: "Fasst jedes Gespräch für dich zusammen",
  starterF4: "E-Mail-Support",
  starterCta: "Starter wählen",
  businessF1: "<strong>120 Minuten</strong> Gespräche pro Monat",
  businessF2: "Nimmt an <em>und</em> telefoniert für dich raus",
  businessF3: "Erledigt Aufgaben eigenständig für dich",
  businessF4: "Priorisierter Support",
  businessCta: "Pro wählen",
  footnote: "Minuten aufgebraucht? Du bekommst einen Hinweis — kein automatischer Aufpreis.",
  devTitle: "Ein Endpoint, <em>drei Wege</em>.",
  devLead: "Hermes ist ein <strong>MCP</strong>-Server. Verbinde ihn im KI-Tool deiner Wahl oder direkt aus dem Terminal.",
  devWayA: "Im KI-Tool",
  devWayATitle: "Als Konnektor hinzufügen",
  devWayB: "Im Terminal",
  devWayBTitle: "Mit einem Befehl",
  devWindowTitle: "Einstellungen › Konnektoren",
  devAddRow: "Benutzerdefinierten Connector",
  devFieldName: "Name",
  devFieldUrl: "Server-URL",
  devConnectBtn: "Verbinden",
  devTerminalTitle: "zsh — hermes",
  devOut1: "✓ MCP-Server „hermes“ hinzugefügt",
  devOut2: "✓ Verbunden · Tools verfügbar",
  devToolsLabel: "Frag danach — zum Beispiel",
  devAsk1: "„Wer hat heute angerufen und was wollten sie?“",
  devAsk2: "„Ruf Herrn Müller an und verschiebe den Termin auf Donnerstag.“",
  devFootnote: "Streamable HTTP, OAuth beim ersten Verbinden. Läuft mit Claude, Codex und jedem MCP-Client.",
  step1Title: "Nummer holen",
  step1Desc: "Eine echte Rufnummer, in zwei Minuten aktiv. Kein Vertrag, keine Hardware.",
  step2Title: "KI verbinden",
  step2Desc: "Ein Anschluss über MCP. Deine KI weiß danach, wer angerufen hat und was zu tun ist.",
  step3Title: "Abnehmen lassen",
  step3Desc: "Hermes spricht, hört zu, vereinbart Termine und schreibt mit. Du liest das Protokoll.",
  language: "Sprache",
  contact: "Kontakt",
  footerCopy: "© Sundartha — Hermes, dein Telefonassistent",
  copyLabel: "Kopieren",
  /* Einwilligungs-Karte (components/site/CookieConsent.astro, scripts/consent.js). */
  cookieSettings: "Cookie-Einstellungen",
  ckTitle: "Cookies &amp; Datenschutz",
  ckText: "Wir speichern nur, was die Seite braucht: deine Sprache und diese Wahl. Statistik oder Marketing laufen erst, wenn du zustimmst. <a href=\"/datenschutz\">Datenschutz</a>",
  ckNecessary: "Notwendig",
  ckNecessaryDesc: "Sprachwahl, Login im Kundenbereich und diese Einstellung. Immer aktiv.",
  ckStats: "Statistik",
  ckStatsDesc: "Anonyme Reichweitenmessung, damit wir die Seite verbessern können. Derzeit nicht im Einsatz.",
  ckMarketing: "Marketing",
  ckMarketingDesc: "Werbe- und Social-Media-Dienste. Derzeit nicht im Einsatz.",
  ckAcceptAll: "Alle akzeptieren",
  ckNecessaryOnly: "Nur notwendige",
  ckSave: "Auswahl speichern",
  ckSettings: "Einstellungen",
  /* HermesDemo (Session-Stream, components/HermesDemo.astro): die DE-Fassung
   * aller uebersetzbaren Demo-Texte. Sprachneutrale Werte (Rufnummer,
   * Werkzeugliste, "Live", Sprecher "Hermes") tragen im Markup bewusst
   * keinen data-i18n-Key. hdToolcall traegt Inline-HTML (innerHTML-Swap,
   * Muster heroTitle). */
  hdWinTitle: "deine-ki — Hermes-Session",
  hdScene1: "01 · Verbinden & beauftragen",
  hdScene2: "02 · Hermes telefoniert",
  hdScene3: "03 · Das Ergebnis",
  hdEv1k: "Hermes-Nummer aktiv",
  hdEv2k: "Als MCP-Connector verbunden",
  hdYouLabel: "Du, an deine KI",
  hdAiLabel: "Deine KI",
  hdUserMsg: "Kannst du mir für diese Woche einen Kontrolltermin bei Dr. Behrens machen?",
  hdAiMsg1: "Klar — bestätige den Anruf in der Hermes-Karte, dann ruft Hermes die Praxis an.",
  hdToolcall: "<span class=\"hd-toolcall__fn\">prepare_call</span>(\"Praxis Dr. Behrens\")",
  hdCallLabel: "Ausgehender Anruf",
  hdCallee: "Praxis Dr. Behrens",
  hdSpeakerThem: "Praxis",
  hdL1: "Hallo, ich bin der KI-Assistent von Jonas. Ich würde gern einen Termin für ihn vereinbaren.",
  hdL2: "Gerne, worum geht es denn?",
  hdL3: "Um eine Kontrolluntersuchung. Ginge es am Donnerstag, dem 14. August?",
  hdL4: "Donnerstag wäre frei.",
  hdL5: "Das passt gut, den nehmen wir. Auf den Namen Kroh.",
  hdHangup: "Anruf beendet · 0:47",
  hdAiMsg2: "Erledigt! Donnerstag, 14. Aug. um 11:30 bei Dr. Behrens ist gebucht.",
  hdR1k: "Termin",
  hdR1v: "Donnerstag, 14. Aug. · 11:30 · Praxis Dr. Behrens",
  hdR2v: "Die Zusammenfassung liegt in deinem Dashboard",
  hdStep1: "Auftrag geben",
  hdStep2: "Hermes telefoniert",
  hdStep3: "Ergebnis",
  privacy: "Datenschutz",
  imprint: "Impressum",
  terms: "AGB",
  copiedLabel: "Kopiert",
  /* How-it-works-Kacheln (components/HowtoSteps.astro). Titel/Texte nutzen die
   * Keys step1Title ... step3Desc oben. Der kopierte Agenten-Satz selbst bleibt
   * Englisch - er ist fuer das Modell. */
  hgStep: "Schritt",
  hgB11: "Eine echte Rufnummer",
  hgB12: "In zwei Minuten aktiv",
  hgB13: "Kein Vertrag, keine Hardware",
  hgB21: "Ein Anschluss über MCP",
  hgB22: "Claude, Codex oder jeder MCP-Client",
  hgB23: "Deine KI weiß, wer angerufen hat",
  hgB31: "Spricht und hört zu",
  hgB32: "Vereinbart Termine",
  hgB33: "Dein persönlicher Assistent, 24/7",
  hgLive: "Aktiv",
  hgReady: "Zusammenfassung da",
  hgConnected: "Mit deiner KI verbunden",
  agentTryLabel: "Mit deiner KI ausprobieren",
};

/* Der Schluessel traegt seit dem Default-Wechsel eine Version. Grund: unter dem
 * alten Schluessel "hermes.lang" liegen Wahlen aus der Zeit, als Deutsch der
 * Default war - die wuerden Englisch fuer jeden Rueckkehrer aushebeln. Ab v2
 * zaehlt nur, was jemand NACH dem Wechsel bewusst gewaehlt hat; der alte
 * Eintrag wird beim ersten Besuch entfernt (s. init), damit nichts
 * Verwaistes zurueckbleibt, das der Datenschutztext nicht mehr beschreibt. */
const LANG_KEY = "hermes.lang.v2";
const LEGACY_LANG_KEY = "hermes.lang";
const en = new Map();
let lang = "en";

function i18nNodes() {
  return document.querySelectorAll("[data-i18n]");
}

function applyLang(next) {
  lang = next === "de" ? "de" : "en";
  for (const node of i18nNodes()) {
    const key = node.dataset.i18n;
    if (!en.has(key)) en.set(key, node.innerHTML);
    const value = lang === "de" ? DE[key] : en.get(key);
    if (typeof value === "string") node.innerHTML = value;
  }
  document.documentElement.lang = lang;
  for (const btn of document.querySelectorAll("[data-lang]")) {
    btn.setAttribute("aria-pressed", String(btn.dataset.lang === lang));
  }
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* Privater Modus: die Wahl gilt dann nur fuer diese Sitzung. */
  }
}

/* --------------------------------------------------------------- Blaetter */

/* Dieselbe Abfrage wie im CSS — so koennen Aussehen und Verhalten nicht
 * auseinanderlaufen. Reagiert live auf Drehen und Fenstergroesse. */
const mq = window.matchMedia("(max-width:700px), (pointer:coarse) and (max-width:1024px)");
const isMobile = () => mq.matches;
/* Owner-Entscheidung 2026-09-26: das Handy scrollt wie der Desktop durch die
 * Ebenen (revidiert den Ein-Screen-Hero vom 2026-08-20). Nur das Handy im
 * QUERFORMAT (<= 500px hoch) bleibt beim Ein-Screen-Hero mit Vollbild-
 * Blaettern - dort passt keine Ebene in die Hoehe. Dieselbe Abfrage steht in
 * hermes-mobile-scroll.css. */
const mqSheets = window.matchMedia("(pointer:coarse) and (max-width:1024px) and (max-height:500px)");
const usesSheets = () => mqSheets.matches;

function sheetEl(name) {
  return document.querySelector('.sheet[data-sheet="' + name + '"]');
}

let openedFromMenu = null;

function setSheet(which, cameFromMenu) {
  openedFromMenu = cameFromMenu ? which : null;
  for (const sheet of document.querySelectorAll(".sheet")) {
    sheet.setAttribute("data-open", sheet.dataset.sheet === which ? "1" : "0");
  }
  // Die Mockup-Animationen im Entwickler-Blatt starten bei jedem Oeffnen neu.
  const devSheet = sheetEl("dev");
  if (devSheet) {
    devSheet.classList.remove("play");
    if (which === "dev") {
      void devSheet.offsetWidth;
      devSheet.classList.add("play");
    }
  }
  document.body.classList.toggle("sheet-open", Boolean(which));
}

function closeSheet() {
  if (openedFromMenu) {
    setSheet("menu", false);
    return;
  }
  setSheet(null, false);
}

/* ------------------------------------------------------- Scroll-Choreografie */

const page = document.querySelector(".page");
const copy = document.querySelector(".hero-copy");
const hint = document.querySelector(".scroll-hint");
const navDesktop = document.querySelector(".nav-desktop");
const navMobile = document.querySelector(".nav-mobile");
const navEl = () => (navDesktop && navDesktop.offsetHeight ? navDesktop : navMobile);
const howtoLayer = document.querySelector(".howto-layer");
const howtoBg = document.querySelector(".howto-bg");
const priceLayer = document.querySelector(".price-layer");
const devLayer = document.querySelector(".dev-layer");
const devCardA = document.querySelector('[data-dev-card="a"]');
const devCardB = document.querySelector('[data-dev-card="b"]');
const footer = document.querySelector(".site-footer");
const devList = document.querySelector(".dev-list");
const devHead = devLayer ? devLayer.querySelectorAll(".layer-eyebrow, .layer-title") : [];

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Handy (Owner-Entwurf v3, 2026-09-26): "So funktioniert's" zeigt die drei
 * Schritt-Karten NACHEINANDER, je eine pro Scroll-Halt. Dafuer wird an der
 * Stelle, an der die Ebene voll steht (HOWTO_REST), zusaetzlicher Scrollweg
 * eingeschoben (STEP_RUN je Wechsel); alles danach verschiebt sich um genau
 * diesen Weg. Der Desktop zeigt die drei Kacheln nebeneinander - dort ist der
 * Einschub 0. Die Laenge der Buehne steht in hermes-mobile-scroll.css. */
const HOWTO_REST = 1.55;
const STEP_RUN = 0.9;
const stepTiles = howtoLayer ? [...howtoLayer.querySelectorAll(".hg-tile")] : [];
const stepBars = howtoLayer ? [...howtoLayer.querySelectorAll(".layer-progress i")] : [];
const stepMode = () => isMobile() && !usesSheets() && stepTiles.length > 1;
const stepExtra = (vh) => (stepMode() ? (stepTiles.length - 1) * STEP_RUN * vh : 0);
let restGap = null;
let devPlayed = false;
let glideRaf = null;

/* Wie weit der Hero-Text nach oben darf: hoechstens bis kurz unter die
 * Nav-Kante. Die Leiste bleibt transparent, darum darf die Schrift sie gar
 * nicht erreichen — auf niedrigen Fenstern ist der Weg entsprechend kurz. */
function travel() {
  const nav = navEl();
  if (!copy || !nav) return 0;
  if (restGap == null) {
    const atRest = !copy.style.transform || copy.style.transform === "translateY(0px)";
    const gap = copy.getBoundingClientRect().top - nav.getBoundingClientRect().bottom;
    if (atRest) restGap = gap;
    else return Math.max(0, Math.min(HERO_TRAVEL_MAX_PX, gap - HERO_NAV_CLEARANCE_PX));
  }
  return Math.max(0, Math.min(HERO_TRAVEL_MAX_PX, restGap - HERO_NAV_CLEARANCE_PX));
}

const easeOut = (progress) => 1 - Math.pow(1 - progress, QUADRATIC_EXPONENT);
const clamp01 = (value) => Math.min(1, Math.max(0, value));

function easeInOutCubic(progress) {
  if (progress < EASE_HALF_PROGRESS) {
    return Math.pow(progress / EASE_HALF_PROGRESS, CUBIC_EXPONENT) * EASE_HALF_PROGRESS;
  }
  return 1 - Math.pow((1 - progress) / EASE_HALF_PROGRESS, CUBIC_EXPONENT) * EASE_HALF_PROGRESS;
}

function staggeredRise(rise, delay) {
  const progress = clamp01((rise - delay) / (1 - delay));
  return 1 - Math.pow(1 - progress, CUBIC_EXPONENT);
}

function layerHandover(vh, position, startVh) {
  const local = position - vh * startVh;
  return {
    incoming: clamp01((local - vh * LAYER_RISE_DELAY_VH) / (vh * LAYER_RISE_DISTANCE_VH)),
    outgoing: clamp01(local / (vh * LAYER_EXIT_DISTANCE_VH)),
  };
}

function apply() {
  if (!page) return;

  // Bewegung reduzieren: die Ebenen werden trotzdem gezeigt (vorher blieben sie
  // am Desktop dauerhaft unsichtbar - Preise/Entwickler waren nicht erreichbar).
  // Die Uebergaenge haengen allein am Scrollen, laufen also nicht von selbst.
  if (usesSheets()) {
    applySheetMode();
    return;
  }

  const stage = measureStage();
  applySteps(stage.stepProgress);
  applyHero(stage);
  applyHowto(stage);
  applyPrice(stage);
  applyDev(stage);
  applyFooter(stage);
}

function applySheetMode() {
  if (copy) {
    copy.style.setProperty("transform", "none", "important");
    copy.style.setProperty("opacity", "1", "important");
  }
  if (hint) hint.style.opacity = "1";
  for (const layer of [howtoLayer, priceLayer, devLayer, footer]) {
    if (layer) {
      layer.style.opacity = "0";
      layer.style.pointerEvents = "none";
    }
  }
  if (howtoBg) howtoBg.style.opacity = "0";
}

function measureStage() {
  const vh = Math.max(1, page.clientHeight);
  const raw = page.scrollTop;
  // Handy: waehrend des eingeschobenen Wegs steht die Zeitachse still und nur
  // die Schritt-Karten wechseln; danach laeuft sie um den Einschub versetzt weiter.
  const rest = vh * HOWTO_REST;
  const extra = stepExtra(vh);
  const position = raw <= rest ? raw : raw <= rest + extra ? rest : raw - extra;
  return {
    vh,
    position,
    stepProgress: extra > 0 ? clamp01((raw - rest) / extra) : null,
    // Ebene 2 erscheint auf demselben Bild, sobald der Hero-Text weg ist.
    howtoToPrice: layerHandover(vh, position, HOWTO_TO_PRICE_START_VH),
    // Ebene 4 (Entwickler), dieselbe Choreografie wie 2 -> 3.
    priceToDev: layerHandover(vh, position, PRICE_TO_DEV_START_VH),
  };
}

function applyHero(stage) {
  const progress = clamp01(stage.position / (stage.vh * HERO_FADE_DISTANCE_VH));
  const eased = easeOut(progress);
  if (copy) {
    // "important" am Element: das Handy-CSS pinnt den Hero-Text sonst fest.
    copy.style.setProperty("transform", "translateY(" + -travel() * eased + "px)", "important");
    copy.style.setProperty(
      "opacity",
      String(Math.max(0, 1 - progress * LAYER_FADE_OUT_FACTOR)),
      "important",
    );
  }
  if (hint) hint.style.opacity = String(Math.max(0, 1 - progress * HINT_FADE_OUT_FACTOR));
}

function applyHowto(stage) {
  if (!howtoLayer) return;
  const { vh, position } = stage;
  const exit = stage.howtoToPrice.outgoing;
  const rise = clamp01((position - vh * HOWTO_RISE_START_VH) / (vh * HOWTO_RISE_DISTANCE_VH));
  const risen = easeOut(rise);
  const howtoOpacity = risen * Math.max(0, 1 - exit * LAYER_FADE_OUT_FACTOR);
  howtoLayer.style.opacity = String(howtoOpacity);
  // Die Kachel-Animationen (HowtoSteps.astro) laufen nur, solange die Ebene
  // sichtbar ist - spart Rechenzeit/Akku, und man sieht sie beim Ankommen.
  howtoLayer.classList.toggle("is-visible", howtoOpacity > HOWTO_VISIBLE_MIN_OPACITY);
  howtoLayer.style.transform =
    "translateY(" + (LAYER_RISE_OFFSET_PX * (1 - risen) - travel() * easeOut(exit)) + "px)";
  howtoLayer.style.pointerEvents =
    rise > HOWTO_INTERACTIVE_MIN_RISE && exit < LAYER_INTERACTIVE_MAX_EXIT ? "auto" : "none";
  // Der Hintergrund wechselt mit der zweiten Ebene auf das Wolkenmeer.
  if (howtoBg) howtoBg.style.opacity = String(risen);
}

function applyPrice(stage) {
  if (!priceLayer) return;
  const rise = stage.howtoToPrice.incoming;
  const exit = stage.priceToDev.outgoing;
  const risen = easeOut(rise);
  priceLayer.style.opacity = String(risen * Math.max(0, 1 - exit * LAYER_FADE_OUT_FACTOR));
  priceLayer.style.transform =
    "translateY(" + (LAYER_RISE_OFFSET_PX * (1 - risen) - travel() * easeOut(exit)) + "px)";
  priceLayer.style.pointerEvents =
    rise > LAYER_INTERACTIVE_MIN_RISE && exit < LAYER_INTERACTIVE_MAX_EXIT ? "auto" : "none";
}

function applyDev(stage) {
  if (!devLayer) return;
  const rise = stage.priceToDev.incoming;
  const risen = easeOut(rise);
  devLayer.style.opacity = String(risen);
  devLayer.style.transform = "translateY(" + LAYER_RISE_OFFSET_PX * (1 - risen) + "px)";
  devLayer.style.pointerEvents = rise > LAYER_INTERACTIVE_MIN_RISE ? "auto" : "none";
  replayDevAnimation(risen);

  // Die beiden Karten steigen versetzt nach, damit der Blick von links nach
  // rechts gefuehrt wird statt beide Bloecke gleichzeitig zu zeigen.
  if (devCardA) {
    const shown = staggeredRise(rise, DEV_CARD_A_DELAY_RISE);
    devCardA.style.opacity = String(shown);
    devCardA.style.transform = "translateY(" + DEV_CARD_RISE_OFFSET_PX * (1 - shown) + "px)";
  }
  if (devCardB) {
    const shown = staggeredRise(rise, DEV_CARD_B_DELAY_RISE);
    devCardB.style.opacity = String(shown);
    devCardB.style.transform = "translateY(" + DEV_CARD_RISE_OFFSET_PX * (1 - shown) + "px)";
  }
}

function replayDevAnimation(risen) {
  if (risen > DEV_PLAY_MIN_RISE) {
    if (!devPlayed) {
      devPlayed = true;
      void devLayer.offsetWidth;
      devLayer.classList.add("play");
    }
  } else if (devPlayed && risen < DEV_REPLAY_MAX_RISE) {
    devPlayed = false;
    devLayer.classList.remove("play");
  }
}

function applyFooter(stage) {
  // Fussband: steigt ganz am Ende von der Unterkante herein, ueber der letzten
  // Ebene — wie ein Footer, nicht wie eine eigene Sektion.
  if (!footer) return;
  const { vh, position } = stage;
  // Am Handy setzt das Band erst NACH dem Entwickler-Halt ein - sonst stuende
  // dort schon ein Hauch Fussband unter der Karte.
  const startVh = stepMode() ? FOOTER_START_STEP_MODE_VH : FOOTER_START_VH;
  const rise = clamp01((position - vh * startVh) / (vh * FOOTER_RISE_DISTANCE_VH));
  const risen = easeOut(rise);
  footer.style.opacity = String(risen);
  footer.style.transform = "translateY(" + FOOTER_HIDDEN_OFFSET_PERCENT * (1 - risen) + "%)";
  footer.style.pointerEvents = rise > FOOTER_INTERACTIVE_MIN_RISE ? "auto" : "none";
  // Die letzte Ebene weicht dem Band aus, statt sich davon ueberdecken zu
  // lassen: das Band ist hoeher als der Bodenabstand der Ebene.
  if (devLayer) liftDevLayer(vh, risen);
}

function devBottomPaddingPx(vh) {
  if (stepMode()) return DEV_BOTTOM_PADDING_STEP_MODE_PX;
  return vh <= LOW_VIEWPORT_MAX_HEIGHT_PX ? DEV_BOTTOM_PADDING_LOW_VIEWPORT_PX : DEV_BOTTOM_PADDING_PX;
}

function liftDevLayer(vh, footerRisen) {
  const base = devBottomPaddingPx(vh);
  const lift = Math.max(0, footer.offsetHeight - base) * footerRisen;
  devLayer.style.paddingBottom = base + lift + "px";
  // Handy: die Ebene steht oben buendig (nicht mittig), der Bodenabstand
  // allein hebt sie nicht an. Reicht die Karte ins Band, rueckt die ganze
  // Ebene um genau die Ueberdeckung nach oben.
  let headOpacity = "";
  if (stepMode() && devList && footerRisen > 0) {
    const bottom = devList.offsetTop + devList.offsetHeight;
    const overlap = Math.max(0, bottom - (vh - footer.offsetHeight)) * footerRisen;
    devLayer.style.transform = "translateY(" + -overlap + "px)";
    // Rueckt die Ebene dabei unter die Kopfleiste, weicht ihr Kopf aus.
    if (overlap > 0) headOpacity = String(Math.max(0, 1 - overlap / DEV_HEAD_FADE_DISTANCE_PX));
  }
  for (const head of devHead) head.style.opacity = headOpacity;
}

/* Schritt-Karten am Handy: s = 0 (Schritt 1) ... 1 (letzter Schritt). Jede
 * Karte steht eine Weile ganz, dazwischen blendet sie weich ueber und gleitet
 * dabei ein Stueck zur Seite. null = Desktop: alle Karten normal. */
function applySteps(progress) {
  if (!stepTiles.length) return;
  if (progress == null) {
    for (const tile of stepTiles) {
      tile.style.opacity = "";
      tile.style.transform = "";
      tile.style.visibility = "";
      tile.classList.remove("is-active");
    }
    return;
  }
  const position = progress * (stepTiles.length - 1);
  const current = Math.round(position);
  for (const [i, tile] of stepTiles.entries()) {
    const offset = position - i;
    const opacity = clamp01(
      1 - (Math.abs(offset) - STEP_FULL_OPACITY_RADIUS_STEPS) / STEP_CROSSFADE_STEPS,
    );
    tile.style.opacity = String(opacity);
    // Seitlich wie eine Galerie: die naechste Karte kommt von rechts, die
    // vorige geht nach links - passt zum Wischen.
    tile.style.transform = "translateX(" + -Math.max(-1, Math.min(1, offset)) * STEP_SLIDE_PX + "px)";
    tile.style.visibility = opacity > STEP_VISIBLE_MIN_OPACITY ? "visible" : "hidden";
    tile.classList.toggle("is-active", i === current);
  }
  stepBars.forEach((bar, i) => bar.classList.toggle("is-on", i <= current));
}

/* Ruhepunkte: dort ist die jeweilige Ebene voll aufgestiegen und wird noch
 * nicht wieder nach oben weggezogen. Letzter Halt: Fussband ganz oben. Am
 * Handy liegen hinter "So funktioniert's" die Halte der Schritte 2 und 3;
 * withSteps=false liefert nur die Sektionen (Index = data-goto). */
function sectionStops(withSteps = true) {
  if (!page) return [0];
  const vh = page.clientHeight;
  const max = Math.max(0, page.scrollHeight - vh);
  const extra = stepExtra(vh);
  const rest = vh * HOWTO_REST;
  const steps = [];
  if (withSteps && extra > 0) {
    for (let i = 1; i < stepTiles.length; i++) steps.push(rest + i * STEP_RUN * vh);
  }
  return [
    0,
    rest,
    ...steps,
    vh * PRICE_STOP_VH + extra,
    vh * DEV_STOP_VH + extra,
    vh * FOOTER_STOP_VH + extra,
  ].map((stop) => Math.min(stop, max));
}

/* Eigene Scroll-Animation mit gleicher GESCHWINDIGKEIT statt gleicher Dauer:
 * sonst fuehlt sich der weiteste Sprung anders an als die kurzen. */
function glideTo(top) {
  if (!page) return;
  const max = Math.max(0, page.scrollHeight - page.clientHeight);
  const to = Math.min(Math.max(0, top), max);
  const from = page.scrollTop;
  const dist = to - from;
  if (glideRaf) cancelAnimationFrame(glideRaf);
  if (reduced || Math.abs(dist) < GLIDE_MIN_DISTANCE_PX) {
    page.scrollTop = to;
    return;
  }
  const vh = Math.max(1, page.clientHeight);
  // Der Sprung aus dem Hero heraus laeuft etwas straffer: dort blendet
  // zusaetzlich der Hero-Text aus, was die Bewegung laenger wirken laesst.
  const speed = from < vh * GLIDE_HERO_ZONE_VH ? GLIDE_FROM_HERO_MS_PER_VH : GLIDE_MS_PER_VH;
  const dur = Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, (Math.abs(dist) / vh) * speed));
  const t0 = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - t0) / dur);
    page.scrollTop = from + dist * easeInOutCubic(progress);
    glideRaf = progress < 1 ? requestAnimationFrame(step) : null;
  };
  glideRaf = requestAnimationFrame(step);
}

function goToSection(index) {
  const stops = sectionStops(false);
  glideTo(stops[Math.min(index, stops.length - 1)]);
}

/* ------------------------------------------------------------------ Verdrahtung */

/* Am Handy tritt an die Stelle des Scrollens jeweils ein Vollbild-Blatt
 * (Owner-Entscheidung 2026-08-20: nur die Startseite ist sichtbar, alles
 * andere oeffnet sich als eigene Seite); auf dem Desktop scrollt derselbe
 * Knopf zur Sektion. */
function wireSectionTriggers() {
  for (const el of document.querySelectorAll("[data-goto]")) {
    const [sheet, index] = el.dataset.goto.split(":");
    const fromMenu = el.hasAttribute("data-from-menu");
    el.addEventListener("click", (event) => {
      event.preventDefault();
      if (!usesSheets()) {
        // Aus dem Handy-Menue heraus: erst das Menue schliessen, dann gleiten.
        if (fromMenu) setSheet(null, false);
        goToSection(Number(index));
        return;
      }
      setSheet(sheet, fromMenu);
    });
  }
  for (const el of document.querySelectorAll("[data-open-sheet]")) {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      setSheet(el.dataset.openSheet, el.hasAttribute("data-from-menu"));
    });
  }
  for (const el of document.querySelectorAll("[data-close-sheet]")) {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      closeSheet();
    });
  }
  for (const el of document.querySelectorAll("[data-lang]")) {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      applyLang(el.dataset.lang);
    });
  }
}

/* Rechtstexte im Blatt: die Pillen tauschen das sichtbare Dokument. Die
 * Dokumente stehen vollstaendig im HTML (aus src/data/legal/*.json gebaut) —
 * dieselben Texte, die auch unter /datenschutz & Co. ausgeliefert werden. */
function wireLegal() {
  const pills = document.querySelectorAll("[data-legal-pill]");
  const docs = document.querySelectorAll("[data-legal-doc]");
  if (!pills.length) return;
  const show = (slug) => {
    for (const pill of pills) {
      const on = pill.dataset.legalPill === slug;
      if (on) pill.setAttribute("aria-current", "page");
      else pill.removeAttribute("aria-current");
    }
    for (const doc of docs) {
      doc.hidden = doc.dataset.legalDoc !== slug;
    }
  };
  for (const pill of pills) {
    pill.addEventListener("click", (event) => {
      event.preventDefault();
      show(pill.dataset.legalPill);
    });
  }
  const legalSheet = sheetEl("legal");
  for (const trigger of document.querySelectorAll("[data-legal-open]")) {
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      show(trigger.dataset.legalOpen);
      // Verweis INNERHALB des Blatts (Support -> Kuendigen, -> Datenschutz): nur den
      // Reiter wechseln und zum Anfang, der Rueckweg ins Menue bleibt, wie er war.
      if (legalSheet && legalSheet.contains(trigger)) {
        legalSheet.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
        return;
      }
      // "Zurueck ins Menue" nur, wenn der Ausloeser wirklich im Menue-Blatt
      // sitzt — vom .stack-foot oder Desktop-Fussband aus schliesst das
      // Rechts-Blatt einfach (kein erfundener Menue-Rueckweg).
      setSheet("legal", Boolean(trigger.closest('.sheet[data-sheet="menu"]')));
    });
  }
  show("privacy");
}

/* Handy: die Schritt-Karten lassen sich auch seitlich wischen. Ein Wisch
 * gleitet zum Halt des naechsten/vorigen Schritts - dieselbe Stelle, an die
 * auch das Scrollen fuehrt, darum passen Karte und Fortschritt immer. */
function wireStepSwipe() {
  const zone = howtoLayer && howtoLayer.querySelector(".hg--layer");
  if (!zone || !page) return;
  let x0 = null;
  let y0 = 0;
  zone.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.touches[0];
      x0 = touch.clientX;
      y0 = touch.clientY;
    },
    { passive: true },
  );
  zone.addEventListener(
    "touchend",
    (event) => {
      if (x0 == null || !stepMode()) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - x0;
      const dy = touch.clientY - y0;
      x0 = null;
      if (
        Math.abs(dx) < SWIPE_MIN_DISTANCE_PX ||
        Math.abs(dx) < Math.abs(dy) * SWIPE_HORIZONTAL_DOMINANCE_FACTOR
      )
        return;
      const vh = page.clientHeight;
      const rest = vh * HOWTO_REST;
      const stepPosition =
        clamp01((page.scrollTop - rest) / stepExtra(vh)) * (stepTiles.length - 1);
      const next = Math.max(
        0,
        Math.min(stepTiles.length - 1, Math.round(stepPosition) + (dx < 0 ? 1 : -1)),
      );
      glideTo(rest + next * STEP_RUN * vh);
    },
    { passive: true },
  );
}

function wireCopy() {
  for (const btn of document.querySelectorAll("[data-copy]")) {
    btn.addEventListener("click", async () => {
      const label = btn.textContent;
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
      } catch {
        /* Ohne Zwischenablage-Recht bleibt die Adresse trotzdem lesbar. */
      }
      btn.textContent = lang === "de" ? DE.copiedLabel : "Copied";
      setTimeout(() => {
        btn.textContent = label;
      }, COPIED_LABEL_DURATION_MS);
    });
  }
}

function wireKeyboard() {
  document.addEventListener("keydown", onKeyDown);
}

function onKeyDown(event) {
  if (isModifiedKeyEvent(event)) return;
  // Bei offenem Blatt gehoert die Tastatur dem Blatt: sonst springt die Seite
  // dahinter und der lange Rechtstext liesse sich nicht scrollen.
  if (keyHandledByOpenSheet(event)) return;
  if (isTypingTarget(event.target)) return;
  // Handy-Fassung (hermes-mobile.js): dort ist die Buehne ausgeblendet und
  // die Tastatur gehoert den Screens.
  if (!page || !page.clientHeight || usesSheets()) return;
  navigateByKey(event);
}

function isModifiedKeyEvent(event) {
  return event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey;
}

function keyHandledByOpenSheet(event) {
  const open = document.querySelector('.sheet[data-open="1"]');
  if (!open) return false;
  if (event.key === "Escape") {
    event.preventDefault();
    closeSheet();
  }
  return true;
}

function isTypingTarget(target) {
  return Boolean(
    target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName || "")),
  );
}

function keyDirection(event) {
  const down =
    event.key === "PageDown" ||
    event.key === "ArrowDown" ||
    (event.key === " " && !event.shiftKey);
  if (down) return "down";
  const up =
    event.key === "PageUp" || event.key === "ArrowUp" || (event.key === " " && event.shiftKey);
  return up ? "up" : null;
}

function firstStopAfter(stops, threshold) {
  const index = stops.findIndex((stop) => stop > threshold);
  return index === -1 ? stops.length - 1 : index;
}

function lastStopBefore(stops, threshold) {
  for (let k = stops.length - 1; k >= 0; k--) {
    if (stops[k] < threshold) return k;
  }
  return 0;
}

function navigateByKey(event) {
  const stops = sectionStops();
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    glideTo(event.key === "Home" ? 0 : stops[stops.length - 1]);
    return;
  }
  const direction = keyDirection(event);
  if (!direction) return;
  event.preventDefault();

  // Tasten springen auf die Ruhepunkte, nicht um eine Bildschirmhoehe —
  // dazwischen liegen die Uebergaenge, in denen nur der Hintergrund zu sehen waere.
  const scrollTop = page.scrollTop;
  const tolerance = page.clientHeight * KEY_STOP_TOLERANCE_VH;
  const index =
    direction === "down"
      ? firstStopAfter(stops, scrollTop + tolerance)
      : lastStopBefore(stops, scrollTop - tolerance);
  glideTo(stops[index]);
}

/* Unterseiten verlinken "So funktioniert's" und "Preise" als Anker der Startseite
 * (lib/home-anchors.js): beim Laden steht die Buehne gleich auf der Ebene, im
 * Handy-Querformat oeffnet sich das passende Blatt. Die Handy-Fassung
 * (hermes-mobile.js) liest denselben Anker selbst - dort ist die Buehne
 * ausgeblendet (clientHeight 0), darum greift hier nichts. */
function openAnchor() {
  const target = anchorFromHash(window.location.hash);
  if (!target) return;
  if (usesSheets()) {
    setSheet(target.sheet, false);
    return;
  }
  if (!page || !page.clientHeight) return;
  page.scrollTop = sectionStops(false)[target.index];
}

/* ------------------------------------------------------------------- Start */

function init() {
  wireSectionTriggers();
  wireLegal();
  wireCopy();
  wireStepSwipe();
  wireKeyboard();

  try {
    localStorage.removeItem(LEGACY_LANG_KEY);
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "de") applyLang("de");
  } catch {
    /* Kein Speicher, keine Vorauswahl — Englisch bleibt. */
  }

  if (!page) return;

  page.addEventListener("scroll", apply, { passive: true });
  window.addEventListener("resize", () => {
    // Nach Groessenaenderung den Ruheabstand neu messen: dazu kurz zurueck auf
    // den Ruhezustand, sonst wird mitten in der Bewegung gemessen.
    if (copy) copy.style.transform = "translateY(0px)";
    restGap = null;
    apply();
  });
  const onView = () => {
    restGap = null;
    apply();
  };
  for (const query of [mq, mqSheets]) {
    if (query.addEventListener) query.addEventListener("change", onView);
    else query.addListener(onView);
  }

  // Beim Sichtbarwerden einmal nachziehen: im Hintergrund pausiert der Browser
  // die Frame-Schleife, der Scrollstand kann sich zwischenzeitlich geaendert haben.
  document.addEventListener("visibilitychange", apply);

  openAnchor();
  apply();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
