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
  businessLabel: "Business",
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
  businessCta: "Business wählen",
  footnote: "Minuten aufgebraucht? Du bekommst einen Hinweis — kein automatischer Aufpreis.",
  devTitle: "Ein Endpoint, <em>zwei Wege</em>.",
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
  ckText: "Wir speichern auf deinem Gerät nur, was die Seite braucht: deine Sprachwahl und diese Entscheidung. Statistik- oder Marketing-Dienste laufen erst, wenn du zustimmst. <a href=\"/datenschutz\">Mehr im Datenschutz</a>.",
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
  hdAiMsg1: "Klar — ich rufe die Praxis kurz an.",
  hdToolcall: "<span class=\"hd-toolcall__fn\">place_call</span>(\"Praxis Dr. Behrens\")",
  hdCallLabel: "Ausgehender Anruf",
  hdCallee: "Praxis Dr. Behrens",
  hdSpeakerThem: "Praxis",
  hdL1: "Hallo, ich bin der KI-Assistent von Jonas. Ich würde gern einen Termin für ihn vereinbaren.",
  hdL2: "Gerne, worum geht es denn?",
  hdL3: "Um eine Kontrolluntersuchung. Ginge es am Donnerstag, dem 14. August?",
  hdL4: "Donnerstag wäre frei.",
  hdL5: "Das passt gut, den nehmen wir. Auf den Namen Kroh.",
  hdHangup: "Anruf beendet · 0:47",
  hdAiMsg2: "Erledigt! Donnerstag, 14. Aug. um 11:30 bei Dr. Behrens — ich hab dir den Termin eingetragen.",
  hdR1k: "Termin",
  hdR1v: "Donnerstag, 14. Aug. · 11:30 · Praxis Dr. Behrens",
  hdR2v: "Zusammenfassung & Transkript liegen in deinem Dashboard",
  hdStep1: "Auftrag geben",
  hdStep2: "Hermes telefoniert",
  hdStep3: "Ergebnis",
  privacy: "Datenschutz",
  imprint: "Impressum",
  terms: "AGB",
  copiedLabel: "Kopiert",
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
const nav = document.querySelector(".nav-desktop");
const howtoLayer = document.querySelector(".howto-layer");
const howtoBg = document.querySelector(".howto-bg");
const priceLayer = document.querySelector(".price-layer");
const devLayer = document.querySelector(".dev-layer");
const devCardA = document.querySelector('[data-dev-card="a"]');
const devCardB = document.querySelector('[data-dev-card="b"]');
const footer = document.querySelector(".site-footer");

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let restGap = null;
let devPlayed = false;
let glideRaf = null;

/* Wie weit der Hero-Text nach oben darf: hoechstens bis kurz unter die
 * Nav-Kante. Die Leiste bleibt transparent, darum darf die Schrift sie gar
 * nicht erreichen — auf niedrigen Fenstern ist der Weg entsprechend kurz. */
function travel() {
  if (!copy || !nav) return 0;
  if (restGap == null) {
    const atRest = !copy.style.transform || copy.style.transform === "translateY(0px)";
    const gap = copy.getBoundingClientRect().top - nav.getBoundingClientRect().bottom;
    if (atRest) restGap = gap;
    else return Math.max(0, Math.min(220, gap - 12));
  }
  return Math.max(0, Math.min(220, restGap - 12));
}

const easeOut = (t) => 1 - Math.pow(1 - t, 2);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function apply() {
  if (!page) return;

  if (isMobile() || reduced) {
    if (copy) {
      copy.style.transform = "none";
      copy.style.opacity = "1";
    }
    if (hint) hint.style.opacity = "1";
    for (const layer of [howtoLayer, priceLayer, devLayer, footer]) {
      if (layer) {
        layer.style.opacity = "0";
        layer.style.pointerEvents = "none";
      }
    }
    if (howtoBg) howtoBg.style.opacity = "0";
    return;
  }

  const vh = Math.max(1, page.clientHeight);
  const y = page.scrollTop;
  const p = clamp01(y / (vh * 0.88));
  const ease = easeOut(p);

  if (copy) {
    copy.style.transform = "translateY(" + -travel() * ease + "px)";
    copy.style.opacity = String(Math.max(0, 1 - p * 1.35));
  }
  if (hint) hint.style.opacity = String(Math.max(0, 1 - p * 3));

  // Ebene 2 erscheint auf demselben Bild, sobald der Hero-Text weg ist.
  const y2 = y - vh * 1.6;
  const r0 = clamp01((y2 - vh * 0.75) / (vh * 0.5));
  const re = easeOut(r0);
  const px = clamp01(y2 / (vh * 0.7));
  const pxe = easeOut(px);

  if (howtoLayer) {
    const q = clamp01((y - vh * 0.95) / (vh * 0.6));
    const qe = easeOut(q);
    howtoLayer.style.opacity = String(qe * Math.max(0, 1 - px * 1.35));
    howtoLayer.style.transform = "translateY(" + (34 * (1 - qe) - travel() * pxe) + "px)";
    howtoLayer.style.pointerEvents = q > 0.6 && px < 0.2 ? "auto" : "none";
    // Der Hintergrund wechselt mit der zweiten Ebene auf das Wolkenmeer.
    if (howtoBg) howtoBg.style.opacity = String(qe);
  }

  // Ebene 4 (Entwickler), dieselbe Choreografie wie 2 -> 3.
  const y3 = y - vh * 3.2;
  const d0 = clamp01((y3 - vh * 0.75) / (vh * 0.5));
  const dev = easeOut(d0);
  const dx = clamp01(y3 / (vh * 0.7));
  const dxe = easeOut(dx);

  if (priceLayer) {
    priceLayer.style.opacity = String(re * Math.max(0, 1 - dx * 1.35));
    priceLayer.style.transform = "translateY(" + (34 * (1 - re) - travel() * dxe) + "px)";
    priceLayer.style.pointerEvents = r0 > 0.5 && dx < 0.2 ? "auto" : "none";
  }

  if (devLayer) {
    devLayer.style.opacity = String(dev);
    devLayer.style.transform = "translateY(" + 34 * (1 - dev) + "px)";
    devLayer.style.pointerEvents = d0 > 0.5 ? "auto" : "none";

    if (dev > 0.55) {
      if (!devPlayed) {
        devPlayed = true;
        void devLayer.offsetWidth;
        devLayer.classList.add("play");
      }
    } else if (devPlayed && dev < 0.08) {
      devPlayed = false;
      devLayer.classList.remove("play");
    }

    // Die beiden Karten steigen versetzt nach, damit der Blick von links nach
    // rechts gefuehrt wird statt beide Bloecke gleichzeitig zu zeigen.
    const stagger = (delay) => {
      const t = clamp01((d0 - delay) / (1 - delay));
      return 1 - Math.pow(1 - t, 3);
    };
    if (devCardA) {
      const s = stagger(0.05);
      devCardA.style.opacity = String(s);
      devCardA.style.transform = "translateY(" + 46 * (1 - s) + "px)";
    }
    if (devCardB) {
      const s = stagger(0.3);
      devCardB.style.opacity = String(s);
      devCardB.style.transform = "translateY(" + 46 * (1 - s) + "px)";
    }
  }

  // Fussband: steigt ganz am Ende von der Unterkante herein, ueber der letzten
  // Ebene — wie ein Footer, nicht wie eine eigene Sektion.
  if (footer) {
    const f = clamp01((y - vh * 4.55) / (vh * 0.5));
    const fe = easeOut(f);
    footer.style.opacity = String(fe);
    footer.style.transform = "translateY(" + 100 * (1 - fe) + "%)";
    footer.style.pointerEvents = f > 0.6 ? "auto" : "none";
    // Die letzte Ebene weicht dem Band aus, statt sich davon ueberdecken zu
    // lassen: das Band ist hoeher als der Bodenabstand der Ebene.
    if (devLayer) {
      const base = vh <= 660 ? 34 : 44;
      const lift = Math.max(0, footer.offsetHeight - base) * fe;
      devLayer.style.paddingBottom = base + lift + "px";
    }
  }
}

/* Ruhepunkte: dort ist die jeweilige Ebene voll aufgestiegen und wird noch
 * nicht wieder nach oben weggezogen. Letzter Halt: Fussband ganz oben. */
function sectionStops() {
  if (!page) return [0];
  const vh = page.clientHeight;
  const max = Math.max(0, page.scrollHeight - vh);
  return [0, vh * 1.55, vh * 3.05, vh * 4.65, vh * 5.2].map((t) => Math.min(t, max));
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
  if (reduced || Math.abs(dist) < 2) {
    page.scrollTop = to;
    return;
  }
  const vh = Math.max(1, page.clientHeight);
  // Der Sprung aus dem Hero heraus laeuft etwas straffer: dort blendet
  // zusaetzlich der Hero-Text aus, was die Bewegung laenger wirken laesst.
  const speed = from < vh * 0.5 ? 470 : 620;
  const dur = Math.min(1400, Math.max(560, (Math.abs(dist) / vh) * speed));
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    page.scrollTop = from + dist * e;
    glideRaf = t < 1 ? requestAnimationFrame(step) : null;
  };
  glideRaf = requestAnimationFrame(step);
}

function goToSection(index) {
  const stops = sectionStops();
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
      if (!isMobile()) {
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
  for (const trigger of document.querySelectorAll("[data-legal-open]")) {
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      show(trigger.dataset.legalOpen);
      // "Zurueck ins Menue" nur, wenn der Ausloeser wirklich im Menue-Blatt
      // sitzt — vom .stack-foot oder Desktop-Fussband aus schliesst das
      // Rechts-Blatt einfach (kein erfundener Menue-Rueckweg).
      setSheet("legal", Boolean(trigger.closest('.sheet[data-sheet="menu"]')));
    });
  }
  show("privacy");
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
      }, 1800);
    });
  }
}

function wireKeyboard() {
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    // Bei offenem Blatt gehoert die Tastatur dem Blatt: sonst springt die Seite
    // dahinter und der lange Rechtstext liesse sich nicht scrollen.
    const open = document.querySelector('.sheet[data-open="1"]');
    if (open) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSheet();
      }
      return;
    }
    const target = event.target;
    if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName || "")))
      return;
    if (!page || isMobile()) return;

    const stops = sectionStops();
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      glideTo(event.key === "Home" ? 0 : stops[stops.length - 1]);
      return;
    }
    const down =
      event.key === "PageDown" ||
      event.key === "ArrowDown" ||
      (event.key === " " && !event.shiftKey);
    const up =
      event.key === "PageUp" || event.key === "ArrowUp" || (event.key === " " && event.shiftKey);
    if (!down && !up) return;
    event.preventDefault();

    // Tasten springen auf die Ruhepunkte, nicht um eine Bildschirmhoehe —
    // dazwischen liegen die Uebergaenge, in denen nur der Hintergrund zu sehen waere.
    const y = page.scrollTop;
    const tol = page.clientHeight * 0.25;
    let i;
    if (down) {
      i = stops.findIndex((t) => t > y + tol);
      if (i === -1) i = stops.length - 1;
    } else {
      i = 0;
      for (let k = stops.length - 1; k >= 0; k--) {
        if (stops[k] < y - tol) {
          i = k;
          break;
        }
      }
    }
    glideTo(stops[i]);
  });
}

/* ------------------------------------------------------------------- Start */

function init() {
  wireSectionTriggers();
  wireLegal();
  wireCopy();
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
  if (mq.addEventListener) mq.addEventListener("change", onView);
  else mq.addListener(onView);

  // Beim Sichtbarwerden einmal nachziehen: im Hintergrund pausiert der Browser
  // die Frame-Schleife, der Scrollstand kann sich zwischenzeitlich geaendert haben.
  document.addEventListener("visibilitychange", apply);

  apply();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
