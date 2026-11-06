// Startseite (pages/index.astro, Canvas v64): Sprache, Menue, Videos der Use cases,
// einmalige Text-Einblendung, Kopier-Knoepfe und die alten Anker.
// Externes Modul (Astro buendelt es same-origin) - CSP-konform ohne Inline-Script.
import { LANG_EVENT, getLang, setLang } from "../lib/i18n.js";
import { anchorFromHash } from "../lib/home-anchors.js";
import { PLAN_CATALOG } from "../lib/plans.js";

// ------------------------------------------------------------------ Woerterbuch
// Englisch steht im Markup. Deutsch hier, je data-i18n-Key (innerHTML) bzw.
// data-i18n-attr="attr:key". Werte mit <em>/<b> sind statisches, eigenes Markup.
// Preise und der Kuendigungs-Wortlaut stehen NICHT hier, sondern zweisprachig im
// HTML (BiText) - sie kommen aus Katalog und Konstanten.
const DE = {
  skip: "Zum Inhalt springen",
  navMain: "Hauptnavigation",
  navFooter: "Fußzeile",
  navIdea: "Die Idee",
  navUses: "Anwendungsfälle",
  navPricing: "Preise",
  navSetup: "Loslegen",
  login: "Anmelden",
  getNumber: "Nummer holen",

  heroAlt: "Antike Säulen vor einem schneebedeckten Berg in der Abenddämmerung",
  heroTitle: "Gib deiner KI eine <em>Telefon&shy;nummer.</em>",
  heroLead: "Hermes nimmt Anrufe an und kümmert sich darum – damit deine KI endlich eine Stimme hat.",
  heroLead2: " Er nimmt Nachrichten entgegen, vereinbart Termine und ruft für dich bei Firmen an.",
  addClaude: "Mit Claude verbinden",
  addChatgpt: "Mit ChatGPT verbinden",
  newTab: " (öffnet in neuem Tab)",
  worksWith: "Funktioniert mit",

  ideaAlt: "Eine Frau arbeitet am Laptop an einem Travertintisch unter Bogenfenstern",
  ideaLabel: "Die Idee",
  ideaTitle: "Deine KI schreibt, plant und recherchiert längst. <em>Jetzt greift sie auch zum Hörer.</em>",
  ideaText: "Hermes gibt deiner KI eine echte Nummer. Er spricht mit deinen Anrufern, ruft für dich bei Firmen an und sagt dir, was besprochen wurde.",
  idea1: "<b>Nummer holen.</b> Eine echte Telefonnummer. Monatlich, jederzeit kündbar.",
  idea2: "<b>KI verbinden.</b> Ein Tipp in Claude. Klappt auch mit ChatGPT, Codex und Cursor.",
  idea3: "<b>Abnehmen lassen.</b> Hermes nimmt ab, bucht und ruft für dich an.",

  usesLabel: "Anwendungsfälle",
  usesTitle: "Was Hermes <em>für dich erledigt.</em>",
  notifLabel: "Mitteilung von Hermes",
  now: "jetzt",
  ago2m: "vor 2 Min.",
  swipe: "Wischen für mehr",

  uc1Label: "I · Hermes nimmt ab",
  uc1Title: "Du sitzt im Meeting. Anna ruft an.",
  uc1Video:
    "Mara präsentiert in einem Meeting, ihr Handy klingelt auf dem Tisch und der Anruf geht an Hermes; Anna hinterlässt Hermes eine Nachricht und legt lächelnd auf; Mara geht hinaus und liest die Zusammenfassung",
  uc1s1: "Anna ruft deine Hermes-Nummer an.",
  uc1s2: "Hermes nimmt ab und spricht mit Anna.",
  uc1s2n: "„Sag Mara, der Vertrag ist fertig. Sie kann mich nach 16 Uhr zurückrufen.“",
  uc1s3: "Du kommst raus. Die Zusammenfassung wartet schon.",
  uc1n: "Anna hat angerufen: Der Vertrag ist fertig.",
  uc1nb: "Ruf sie nach 16 Uhr zurück.",

  uc2Label: "II · Hermes bucht",
  uc2Title: "Anna möchte einen Termin. Hermes bucht ihn.",
  uc2Video:
    "Anna telefoniert von einer sonnigen Piazza aus. Während sie dran ist, sieht Hermes, dass Mittwoch ausgebucht ist, und bietet Donnerstag um 14:30 Uhr an; Anna sagt zu, bekommt die Bestätigung und lehnt sich zurück.",
  uc2s1: "Anna ruft an und bittet um eine halbe Stunde mit dir.",
  uc2s2: "Hermes prüft deinen Kalender, während sie dran ist.",
  uc2s2n: "Mittwoch ist voll. „Wie wäre Donnerstag, 14:30 Uhr?“",
  uc2s3: "Donnerstag, 14:30 Uhr, gebucht. Anna bekommt die Bestätigung.",
  uc2n: "Gebucht: Donnerstag, 14:30 Uhr mit Anna.",
  uc2nb: "Bestätigung verschickt.",

  uc3Label: "III · Hermes ruft für dich an",
  uc3Title: "Lass Hermes beim Friseur anrufen.",
  uc3Video:
    "Mara tippt den Auftrag in ihren Laptop; die Rezeptionistin von Salon Mia nimmt den Anruf von Hermes an; Mara greift zu ihrem Kaffee",
  uc3s1: "Du fragst in Claude und tippst auf „Bestätigen“.",
  uc3s1n: "„Buch mir für Freitagvormittag einen Haarschnitt bei Salon Mia.“",
  uc3s2: "Erst dann ruft Hermes bei Salon Mia an.",
  uc3s2n: "„Hallo, ich bin Hermes, ein KI-Assistent, und rufe für Mara an.“",
  uc3s3: "Hermes bucht, während du deinen Kaffee austrinkst.",
  uc3n: "Gebucht: Freitag, 10:00 Uhr bei Salon Mia.",
  uc3nb: "Die Zusammenfassung liegt in Claude.",

  uc4Label: "IV · Hermes berichtet",
  uc4Title: "Alles landet an einem Ort.",
  uc4Video:
    "Mara sitzt bei Tageslicht in einem Café, liest lächelnd auf ihrem Handy, legt es mit dem Display nach unten ab und lehnt sich zurück",
  uc4s1: "Nach dem Meeting öffnest du dein Dashboard.",
  uc4s2: "Jeder Anruf, den Hermes angenommen oder geführt hat, in wenigen Zeilen.",
  uc4s2n: "Tipp auf einen Anruf, um die Zusammenfassung zu sehen.",
  dashTitle: "Hermes-Dashboard",
  dashMeta: "Heute · 3 Anrufe",
  callIn: "Eingehender Anruf",
  callOut: "Ausgehender Anruf",
  dash1: "Vertrag ist fertig. Nach 16 Uhr zurückrufen.",
  dash2: "Donnerstag, 14:30 Uhr gebucht. Bestätigung verschickt.",
  dash3: "Haarschnitt für Freitag, 10:00 Uhr gebucht.",

  pricingLabel: "Preise",
  pricingTitle: "Zwei Tarife, <em>keine Überraschungen.</em>",
  pricingLead: "Monatlich kündbar. Werden die Minuten knapp, sagen wir dir Bescheid – nie ein automatischer Aufpreis.",
  pricingCaption: "Starter und Pro im Vergleich",
  recommended: "Empfohlen",
  perMonth: "pro Monat, inkl. MwSt.",
  rowNumber: "Eigene Telefonnummer",
  rowMinutes: "Gesprächsminuten pro Monat",
  rowAnswers: "Nimmt deine Anrufe an",
  rowSummaries: "Gesprächs&shy;zusammen&shy;fassungen",
  rowCalls: "Ruft für dich an",
  rowTasks: "Erledigt Aufgaben selbstständig",
  rowSupport: "Support",
  supportEmail: "E-Mail",
  supportPriority: "Bevorzugt",
  included: "Enthalten",
  notIncluded: "Nicht enthalten",

  setupLabel: "Loslegen",
  setupTitle: "Startklar in <em>zwei Minuten.</em>",
  opt1Title: "Claude oder ChatGPT",
  easiest: "Am einfachsten",
  opt1Desc: "Claude: tippen und bestätigen. ChatGPT: einen Connector mit der Server-URL anlegen. Danach einmal bei Hermes anmelden.",
  chatgptCopy: "ChatGPT · URL kopieren",
  opt2Title: "Für Entwickler",
  opt2Desc: "Eine Zeile in Claude Code. Einmal über /mcp anmelden.",
  copyCommand: "Befehl kopieren",
  opt3Title: "Andere KI-Apps",
  opt3Desc: "Füg diesen Satz in deine KI-App ein, zum Beispiel Codex oder Cursor. Sie richtet alles für dich ein.",
  copySentence: "Satz kopieren",
  firstAsk: "Dann frag einfach: „Wer hat heute angerufen – und worum ging es?“",

  statueAlt: "Eine Marmorstatue des Hermes in einem Museumssaal",
  closeTitle: "Verleih deiner KI <em>Flügel.</em>",
  closeText: "Nimm dir Zeit für das, was zählt. <em class=\"serif\">Hermes übernimmt die Anrufe.</em>",

  imprint: "Impressum",
  privacy: "Datenschutz",
  terms: "AGB",
  contact: "Kontakt",
  cookieSettings: "Cookie-Einstellungen",
  aiNote: "Bilder und Videos sind KI-generiert.",
  language: "Sprache",

  // Einwilligungs-Karte (components/site/CookieConsent.astro): zeichengleich zur
  // deutschen Fassung dort, damit beim Umschalten nichts flackert.
  ckTitle: "Cookies &amp; Datenschutz",
  ckText: "Nur, was die Seite braucht. Statistik oder Marketing nur mit deiner Zustimmung. <a href=\"/datenschutz\">Datenschutz</a>",
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
};
// Tarif-Knoepfe: Name aus dem Katalog, deutsche Wortstellung "Starter wählen";
// am Handy (wie EN "Choose") nur "Wählen".
for (const plan of PLAN_CATALOG) {
  DE[`choose_${plan.slug}`] = `<span class="hidem">${plan.name} wählen</span><span class="showm">Wählen</span>`;
  DE[`chooseAria_${plan.slug}`] = `${plan.name} wählen`;
}

// Zur Laufzeit gesetzte Texte (Attribute mit Zustand, Kopier-Rueckmeldung).
const RUNTIME = {
  en: {
    openMenu: "Open menu",
    closeMenu: "Close menu",
    pause: "Pause video: ",
    play: "Play video: ",
    useCases: "Use cases",
    copied: "Copied",
    copyFailed: "Copy failed",
    selectCopy: "Select and copy",
    liveOk: "Copied to clipboard",
    liveFail: "Copy failed. Select the text and copy it manually.",
  },
  de: {
    openMenu: "Menü öffnen",
    closeMenu: "Menü schließen",
    pause: "Video pausieren: ",
    play: "Video abspielen: ",
    useCases: "Anwendungsfälle",
    copied: "Kopiert",
    copyFailed: "Kopieren fehlgeschlagen",
    selectCopy: "Markieren und kopieren",
    liveOk: "In die Zwischenablage kopiert",
    liveFail: "Kopieren hat nicht geklappt. Markier den Text und kopier ihn selbst.",
  },
};

const COPY_FEEDBACK_MS = 1500;
const DESKTOP_MENU_MIN = "(min-width: 1001px)";
const CENTRE_PICK_MAX_HEIGHT = 1600;
const VIDEO_VISIBLE_RATIO = 0.5;
const PRELOAD_MARGIN = "600px";

let lang = "en";
const rt = (key) => RUNTIME[lang][key];
const refreshers = [];
const reduceMotion = () =>
  Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

// --------------------------------------------------------------------- Sprache
const enHtml = new WeakMap();
const enAttrs = new WeakMap();

function translateAttrs(node, de) {
  if (!enAttrs.has(node)) enAttrs.set(node, new Map());
  const cache = enAttrs.get(node);
  for (const pair of (node.dataset.i18nAttr || "").split(";")) {
    const [attr, key] = pair.split(":").map((part) => (part || "").trim());
    if (!attr || !key) continue;
    if (!cache.has(attr)) cache.set(attr, node.getAttribute(attr) ?? "");
    const value = de ? DE[key] : cache.get(attr);
    if (typeof value === "string") node.setAttribute(attr, value);
  }
}

function applyLang(next) {
  lang = next === "de" ? "de" : "en";
  const de = lang === "de";
  document.documentElement.lang = lang;
  for (const node of document.querySelectorAll("[data-i18n]")) {
    if (!enHtml.has(node)) enHtml.set(node, node.innerHTML);
    const value = de ? DE[node.dataset.i18n] : enHtml.get(node);
    if (typeof value === "string" && node.innerHTML !== value) node.innerHTML = value;
  }
  for (const node of document.querySelectorAll("[data-i18n-attr]")) translateAttrs(node, de);
  for (const link of document.querySelectorAll("[data-href-de]")) {
    if (!link.dataset.hrefEn) link.dataset.hrefEn = link.getAttribute("href");
    link.setAttribute("href", de ? link.dataset.hrefDe : link.dataset.hrefEn);
  }
  for (const btn of document.querySelectorAll("[data-lang]")) {
    btn.setAttribute("aria-pressed", String(btn.dataset.lang === lang));
  }
  for (const refresh of refreshers) refresh();
}

function wireLang() {
  for (const btn of document.querySelectorAll("[data-lang]")) {
    btn.addEventListener("click", () => setLang(btn.dataset.lang));
  }
  // setLang setzt <html lang> und meldet LANG_EVENT - auch wenn der Speicher gesperrt ist.
  document.addEventListener(LANG_EVENT, () => applyLang(document.documentElement.lang));
}

// ----------------------------------------------------------------------- Menue
function wireMenu() {
  const button = document.querySelector(".navmenu");
  const sheet = document.getElementById("m-menu");
  if (!button || !sheet) return;
  const isOpen = () => !sheet.hidden;
  const setOpen = (open, returnFocus) => {
    sheet.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-label", rt(open ? "closeMenu" : "openMenu"));
    if (open) {
      const first = sheet.querySelector("a");
      if (first) first.focus();
    } else if (returnFocus) {
      button.focus();
    }
  };
  refreshers.push(() => button.setAttribute("aria-label", rt(isOpen() ? "closeMenu" : "openMenu")));
  button.addEventListener("click", () => setOpen(!isOpen(), false));
  sheet.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false, false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) setOpen(false, true);
  });
  document.addEventListener("click", (event) => {
    if (isOpen() && !event.target.closest("#m-menu") && !event.target.closest(".navmenu")) setOpen(false, false);
  });
  const desktop = window.matchMedia(DESKTOP_MENU_MIN);
  const onDesktop = () => {
    if (desktop.matches && isOpen()) setOpen(false, false);
  };
  if (desktop.addEventListener) desktop.addEventListener("change", onDesktop);
}

// ------------------------------------------------------------- Text-Einblendung
// Einmalig per IntersectionObserver, nicht an den Scroll gekoppelt. Was beim Start
// schon im Bild ist, steht sofort (ohne Uebergang). Reduced Motion: alles sofort.
function wireReveal() {
  const root = document.documentElement;
  root.classList.add("rv-ready");
  const items = Array.from(document.querySelectorAll(".rv"));
  if (!root.classList.contains("js-rv") || reduceMotion() || typeof IntersectionObserver === "undefined") {
    for (const el of items) el.classList.add("in", "rv-now");
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        io.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -6% 0px" },
  );
  const height = window.innerHeight;
  for (const el of items) {
    const rect = el.getBoundingClientRect();
    if (rect.top < height && rect.bottom > 0) el.classList.add("in", "rv-now");
    else io.observe(el);
  }
}

// ---------------------------------------------------------------------- Videos
// Nur das Video im Blick spielt (bis 1600 px Fensterhoehe das mittigste), Start bei
// data-start. Pause-Knopf je Video mit echtem Zustand. Schritte und Mitteilung folgen
// den Kapiteln des Clips (data-ch, data-arrive). Reduced Motion: kein Autoplay, keine
// Schritt-Synchronisierung, der Endzustand bleibt sichtbar.
function playFromStart(video) {
  const start = parseFloat(video.dataset.start || "0");
  const seek = () => {
    try {
      video.currentTime = start;
    } catch {
      // Seek vor den Metadaten - dann eben ab 0.
    }
  };
  if (video.readyState >= 1) seek();
  else video.addEventListener("loadedmetadata", seek, { once: true });
  playSafe(video);
}

function playSafe(video) {
  const promise = video.play();
  if (promise && promise.catch) promise.catch(() => {});
}

function wireVideos() {
  const videos = Array.from(document.querySelectorAll("video[data-clip]"));
  if (!videos.length) return;
  const reduce = reduceMotion();

  for (const video of videos) {
    video.muted = true;
    const scene = video.closest(".scene");
    const button = video.parentElement.querySelector(".vpause");
    const label = scene ? scene.querySelector(".label") : null;
    const flow = scene ? scene.querySelector(".flow[data-ch]") : null;
    const steps = flow ? Array.from(flow.querySelectorAll("li")) : [];
    const chapters = flow ? flow.dataset.ch.split(",").map(parseFloat) : [];
    const result = scene ? scene.querySelector(".result") : null;
    const arrive = result ? parseFloat(result.dataset.arrive || "NaN") : NaN;

    const sync = () => {
      if (!button) return;
      const playing = !video.paused;
      const name = label ? label.textContent.replace(/^[IV]+ · /, "") : rt("useCases");
      button.classList.toggle("is-paused", !playing);
      button.setAttribute("aria-label", rt(playing ? "pause" : "play") + name);
    };
    const tick = () => {
      if (reduce || !flow) return;
      flow.classList.add("sync");
      let current = 0;
      chapters.forEach((chapter, index) => {
        if (video.currentTime >= chapter) current = index;
      });
      steps.forEach((step, index) => step.classList.toggle("on", index === current));
      if (result && !result.classList.contains("arrived")) {
        result.classList.add("waiting");
        if (video.currentTime >= arrive) {
          result.classList.remove("waiting");
          result.classList.add("arrived");
        }
      }
    };
    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    video.addEventListener("timeupdate", tick);
    refreshers.push(sync);

    if (button) {
      button.hidden = false;
      button.addEventListener("click", () => {
        if (video.paused) {
          delete video.dataset.userPaused;
          if (video.currentTime === 0) playFromStart(video);
          else playSafe(video);
        } else {
          video.dataset.userPaused = "1";
          video.pause();
        }
      });
    }
    sync();
  }

  if (typeof IntersectionObserver === "undefined") return;

  // uc2-4 laden erst kurz vor dem Blick (preload none -> auto).
  const preloader = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.preload = "auto";
        preloader.unobserve(entry.target);
      }
    },
    { rootMargin: PRELOAD_MARGIN },
  );
  for (const video of videos) {
    if (video.getAttribute("preload") === "none") preloader.observe(video);
  }

  const ratio = new Map();
  const active = new Set();
  let frame = 0;
  const choose = () => {
    frame = 0;
    const seen = videos.filter((video) => (ratio.get(video) || 0) >= VIDEO_VISIBLE_RATIO);
    let wanted = seen;
    if (window.innerHeight <= CENTRE_PICK_MAX_HEIGHT && seen.length > 1) {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      let best = null;
      let bestDistance = Infinity;
      for (const video of seen) {
        const rect = video.getBoundingClientRect();
        const distance = Math.hypot(rect.left + rect.width / 2 - cx, rect.top + rect.height / 2 - cy);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = video;
        }
      }
      wanted = [best];
    }
    for (const video of videos) {
      const want = wanted.includes(video);
      if (want && !active.has(video)) {
        active.add(video);
        if (!reduce && !video.dataset.userPaused) playFromStart(video);
      } else if (!want && active.has(video)) {
        active.delete(video);
        video.pause();
      }
    }
  };
  const queue = () => {
    if (!frame) frame = requestAnimationFrame(choose);
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) ratio.set(entry.target, entry.intersectionRatio);
      queue();
    },
    { threshold: [0, 0.25, 0.5, 0.75, 1] },
  );
  for (const video of videos) {
    video.pause();
    io.observe(video);
  }
  document.addEventListener("scroll", queue, { passive: true, capture: true });
  window.addEventListener("resize", queue);
}

// ------------------------------------------------- Use-case-Karussell (Handy)
function wireCarousel() {
  const track = document.querySelector(".ucs");
  if (!track) return;
  const dots = Array.from(document.querySelectorAll(".ucdots i"));
  // Region + Tastaturfokus nur, solange die Spur wirklich horizontal scrollt.
  const region = () => {
    if (track.scrollWidth > track.clientWidth + 1) {
      track.setAttribute("role", "region");
      track.setAttribute("aria-label", rt("useCases"));
      track.tabIndex = 0;
    } else {
      track.removeAttribute("role");
      track.removeAttribute("aria-label");
      track.removeAttribute("tabindex");
    }
  };
  const onScroll = () => {
    const card = track.querySelector(".scene");
    if (!card || !dots.length) return;
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    const index = Math.round(track.scrollLeft / (card.getBoundingClientRect().width + gap));
    dots.forEach((dot, i) => dot.classList.toggle("on", i === Math.min(index, dots.length - 1)));
  };
  track.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", region);
  refreshers.push(region);
  region();
}

// ---------------------------------------------------------------- Kopieren
function wireCopy() {
  const live = document.getElementById("copy-live");
  for (const button of document.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", () => {
      const text = button.dataset.copy || "";
      const done = (ok) => {
        button.classList.add(ok ? "copied" : "copyfail");
        const labelNode = button.querySelector(".olbl");
        const before = labelNode ? labelNode.innerHTML : null;
        const aria = button.getAttribute("aria-label");
        if (labelNode) labelNode.textContent = rt(ok ? "copied" : "selectCopy");
        else button.setAttribute("aria-label", rt(ok ? "copied" : "copyFailed"));
        if (live) live.textContent = rt(ok ? "liveOk" : "liveFail");
        setTimeout(() => {
          button.classList.remove("copied", "copyfail");
          if (labelNode && before !== null) labelNode.innerHTML = before;
          if (aria) button.setAttribute("aria-label", aria);
          if (live) live.textContent = "";
        }, COPY_FEEDBACK_MS);
      };
      const legacy = () => {
        try {
          const area = document.createElement("textarea");
          area.value = text;
          area.setAttribute("readonly", "");
          area.className = "copy-ta";
          document.body.appendChild(area);
          area.focus({ preventScroll: true });
          area.select();
          const ok = document.execCommand("copy");
          area.remove();
          button.focus({ preventScroll: true });
          done(Boolean(ok));
        } catch {
          done(false);
        }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => done(true), legacy);
      } else {
        legacy();
      }
    });
  }
}

// ------------------------------------------------------------- Alte Anker
// #so-funktionierts -> #idea, #preise -> #pricing (lib/home-anchors.js).
function resolveLegacyHash() {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return;
  const target = anchorFromHash(raw);
  if (!target || target.id === raw) return;
  const section = document.getElementById(target.id);
  if (!section) return;
  history.replaceState(null, "", `#${target.id}`);
  section.scrollIntoView();
}

function init() {
  wireLang();
  wireMenu();
  wireReveal();
  wireCarousel();
  wireCopy();
  wireVideos();
  if (getLang() === "de" || document.documentElement.lang === "de") applyLang("de");
  resolveLegacyHash();
  window.addEventListener("hashchange", resolveLegacyHash);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
