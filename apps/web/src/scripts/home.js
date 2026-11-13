import { LANG_EVENT, getLang, setLang } from "../lib/i18n.js";
import { anchorFromHash } from "../lib/home-anchors.js";
import { wireSwipePages } from "./home-swipe.js";
import { HOME_GERMAN } from "../lib/home-german.js";
import { EDGE_PX, keyDirection, sectionTarget } from "../lib/section-nav.js";
import { wireSound } from "./home-sound.js";
import { wireProof } from "./home-proof.js";
import { scenePlayback, wakePlayback } from "./home-video.js";
import { dropUndecodableAv1 } from "./home-codec.js";

const RUNTIME = {
  en: {
    openMenu: "Open menu",
    closeMenu: "Close menu",
    pause: "Pause video: ",
    play: "Play video: ",
    useCases: "Use cases",
    setupOptions: "Ways to set up",
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
    setupOptions: "Wege zur Einrichtung",
    copied: "Kopiert",
    copyFailed: "Kopieren fehlgeschlagen",
    selectCopy: "Markieren und kopieren",
    liveOk: "In die Zwischenablage kopiert",
    liveFail: "Kopieren hat nicht geklappt. Markier den Text und kopier ihn selbst.",
    pageTitle: "Hermes — Gib deiner KI eine Telefonnummer",
  },
};

const COPY_FEEDBACK_MS = 1500;
const DESKTOP_MENU_MIN = "(min-width: 1001px)";
const CENTRE_PICK_MAX_HEIGHT = 1600;
const VIDEO_VISIBLE_RATIO = 0.5;
const PRELOAD_MARGIN = "600px";
const VISIBILITY_STEPS = 4;
const REVEAL_STAGGER_S = 0.09;
const REVEAL_STAGGER_MAX = 6;
const SCROLL_SETTLE_MS = 900;
const DOT_PROBE_SHARE = 0.5;
const FOOT_PAGE = "foot";
const NATIVE_KEY_TARGETS =
  'input, textarea, select, button, summary, iframe, audio, video[controls], [contenteditable]:not([contenteditable="false"]), [role="button"], [role="slider"], [role="listbox"], [role="menu"], [role="textbox"], [role="dialog"], dialog, .consent';

const MENU_OPEN_CLASS = "menu-open";

let lang = "en";
let englishTitle = null;
const rt = (key) => RUNTIME[lang][key];
const refreshers = [];
const reduceMotion = () =>
  Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

const enChildren = new WeakMap();
const enAttrs = new WeakMap();

function richNode(part) {
  if (typeof part === "string") return document.createTextNode(part);
  const element = document.createElement(part.tag);
  element.textContent = part.text;
  if (part.className) element.className = part.className;
  if (part.href) element.setAttribute("href", part.href);
  return element;
}

function germanChildren(value) {
  if (value === undefined) return null;
  return (typeof value === "string" ? [value] : value).map(richNode);
}

function copiesOf(nodes) {
  return nodes.map((child) => child.cloneNode(true));
}

function showsChildren(node, children) {
  return (
    node.childNodes.length === children.length &&
    children.every((child, index) => child.isEqualNode(node.childNodes[index]))
  );
}

function translateContents(de) {
  for (const node of document.querySelectorAll("[data-i18n]")) {
    if (!enChildren.has(node)) enChildren.set(node, copiesOf(Array.from(node.childNodes)));
    const children = de
      ? germanChildren(HOME_GERMAN[node.dataset.i18n])
      : copiesOf(enChildren.get(node));
    if (children && !showsChildren(node, children)) node.replaceChildren(...children);
  }
}

function translateAttrs(node, de) {
  if (!enAttrs.has(node)) enAttrs.set(node, new Map());
  const cache = enAttrs.get(node);
  for (const pair of (node.dataset.i18nAttr || "").split(";")) {
    const [attr, key] = pair.split(":").map((part) => (part || "").trim());
    if (!attr || !key) continue;
    if (!cache.has(attr)) cache.set(attr, node.getAttribute(attr) ?? "");
    const value = de ? HOME_GERMAN[key] : cache.get(attr);
    if (typeof value === "string") node.setAttribute(attr, value);
  }
}

function translateLegalLinks(de) {
  for (const link of document.querySelectorAll("[data-href-de]")) {
    if (!link.dataset.hrefEn) link.dataset.hrefEn = link.getAttribute("href");
    link.setAttribute("href", de ? link.dataset.hrefDe : link.dataset.hrefEn);
  }
}

function markLangButtons() {
  for (const btn of document.querySelectorAll("[data-lang]")) {
    btn.setAttribute("aria-pressed", String(btn.dataset.lang === lang));
  }
}

function translateTitle(de) {
  if (englishTitle === null) englishTitle = document.title;
  document.title = de ? RUNTIME.de.pageTitle : englishTitle;
}

function applyLang(next) {
  lang = next === "de" ? "de" : "en";
  const de = lang === "de";
  document.documentElement.lang = lang;
  translateTitle(de);
  translateContents(de);
  for (const node of document.querySelectorAll("[data-i18n-attr]")) translateAttrs(node, de);
  translateLegalLinks(de);
  markLangButtons();
  for (const refresh of refreshers) refresh();
}

function wireLang() {
  for (const btn of document.querySelectorAll("[data-lang]")) {
    btn.addEventListener("click", () => setLang(btn.dataset.lang));
  }
  document.addEventListener(LANG_EVENT, () => applyLang(document.documentElement.lang));
}

function wireMenu() {
  const button = document.querySelector(".navmenu");
  const sheet = document.getElementById("m-menu");
  if (!button || !sheet) return;
  const isOpen = () => !sheet.hidden;
  const setOpen = (open, returnFocus) => {
    sheet.hidden = !open;
    document.documentElement.classList.toggle(MENU_OPEN_CLASS, open);
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
    if (isOpen() && !event.target.closest("#m-menu") && !event.target.closest(".navmenu"))
      setOpen(false, false);
  });
  const desktop = window.matchMedia(DESKTOP_MENU_MIN);
  const onDesktop = () => {
    if (desktop.matches && isOpen()) setOpen(false, false);
  };
  if (desktop.addEventListener) desktop.addEventListener("change", onDesktop);
}

function wireReveal() {
  const items = Array.from(document.querySelectorAll(".rv, .rvm"));
  if (reduceMotion() || typeof IntersectionObserver === "undefined") {
    for (const el of items) el.classList.add("in", "rv-now");
    return;
  }
  document.documentElement.classList.add("js-rv");
  const io = new IntersectionObserver(
    (entries) => {
      const arriving = entries.filter((entry) => entry.isIntersecting).map((entry) => entry.target);
      arriving.forEach((target, index) => {
        target.style.setProperty("--rv-d", `${Math.min(index, REVEAL_STAGGER_MAX) * REVEAL_STAGGER_S}s`);
        target.classList.add("in");
        io.unobserve(target);
      });
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

function parseChapters(list) {
  return list.split(",").map(parseFloat);
}

function currentChapter(chapters, time) {
  let current = 0;
  chapters.forEach((chapter, index) => {
    if (time >= chapter) current = index;
  });
  return current;
}

function stepSync(scene, video, reduce) {
  const flow = scene.querySelector(".flow[data-ch]");
  if (reduce || !flow) return () => {};
  const steps = Array.from(flow.querySelectorAll("li"));
  const chapters = parseChapters(flow.dataset.ch);
  const result = scene.querySelector(".result");
  const arrive = result ? parseFloat(result.dataset.arrive || "NaN") : NaN;
  return () => {
    flow.classList.add("sync");
    const current = currentChapter(chapters, video.currentTime);
    steps.forEach((step, index) => step.classList.toggle("on", index === current));
    if (result && !result.classList.contains("arrived")) {
      result.classList.add("waiting");
      if (video.currentTime >= arrive) {
        result.classList.remove("waiting");
        result.classList.add("arrived");
      }
    }
  };
}

function pauseButtonSync(scene, video, button) {
  const label = scene.querySelector(".label");
  return () => {
    if (!button) return;
    const playing = !video.paused;
    const name = label ? label.textContent.replace(/^[IV]+ · /, "") : rt("useCases");
    button.classList.toggle("is-paused", !playing);
    button.setAttribute("aria-label", rt(playing ? "pause" : "play") + name);
  };
}

function scenePlayer(scene, reduce) {
  const video = scene.querySelector("video[data-clip]");
  if (!video) return null;
  video.muted = true;
  const playback = scenePlayback(video.parentElement);
  const button = video.parentElement.querySelector(".vpause");
  const togglePlayback = () => {
    if (video.paused) {
      delete video.dataset.userPaused;
      delete video.dataset.held;
      playback.retry();
      playback.resume();
    } else {
      video.dataset.userPaused = "1";
      video.pause();
    }
  };
  const sync = pauseButtonSync(scene, video, button);
  video.addEventListener("play", sync);
  video.addEventListener("pause", sync);
  video.addEventListener("timeupdate", stepSync(scene, video, reduce));
  refreshers.push(sync);
  if (button) {
    button.hidden = false;
    button.addEventListener("click", togglePlayback);
  }
  sync();
  return playback;
}

function preloadNearView(videos) {
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
}

function visibilityThresholds() {
  const thresholds = [];
  for (let step = 0; step <= VISIBILITY_STEPS; step += 1) thresholds.push(step / VISIBILITY_STEPS);
  return thresholds;
}

function doubledCentreOffset(rect) {
  return Math.hypot(
    rect.left + rect.right - window.innerWidth,
    rect.top + rect.bottom - window.innerHeight,
  );
}

function closestToCentre(videos) {
  let best = null;
  let bestOffset = Infinity;
  for (const video of videos) {
    const offset = doubledCentreOffset(video.getBoundingClientRect());
    if (offset < bestOffset) {
      bestOffset = offset;
      best = video;
    }
  }
  return best;
}

function wantedVideos(videos, ratio) {
  const seen = videos.filter((video) => (ratio.get(video) || 0) >= VIDEO_VISIBLE_RATIO);
  if (window.innerHeight > CENTRE_PICK_MAX_HEIGHT || seen.length <= 1) return seen;
  return [closestToCentre(seen)];
}

function playMostVisible(players, reduce) {
  const videos = players.map((player) => player.video);
  const ratio = new Map();
  const active = new Set();
  let frame = 0;
  const follow = (player, want) => {
    const playing = active.has(player.video);
    if (want && !playing) {
      active.add(player.video);
      if (!reduce) player.enter();
    } else if (want) {
      if (!reduce) player.keep();
    } else if (playing) {
      active.delete(player.video);
      player.leave();
    }
  };
  const choose = () => {
    frame = 0;
    if (document.hidden) return;
    const wanted = wantedVideos(videos, ratio);
    for (const player of players) follow(player, wanted.includes(player.video));
  };
  const queue = () => {
    if (!frame) frame = requestAnimationFrame(choose);
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) ratio.set(entry.target, entry.intersectionRatio);
      queue();
    },
    { threshold: visibilityThresholds() },
  );
  for (const video of videos) {
    video.pause();
    io.observe(video);
  }
  document.addEventListener("scroll", queue, { passive: true, capture: true });
  window.addEventListener("resize", queue);
  wakePlayback(document, players, choose);
}

function wireVideos() {
  const reduce = reduceMotion();
  wireSound();
  wireProof(document, reduce);
  const players = Array.from(document.querySelectorAll(".scene"), (scene) =>
    scenePlayer(scene, reduce),
  ).filter(Boolean);
  if (!players.length || typeof IntersectionObserver === "undefined") return;
  preloadNearView(players.map((player) => player.video));
  playMostVisible(players, reduce);
}

function wireTrack(track, dots, labelKey) {
  const region = () => {
    if (track.scrollWidth > track.clientWidth + 1) {
      track.setAttribute("role", "region");
      track.setAttribute("aria-label", rt(labelKey));
      track.setAttribute("tabindex", "0");
    } else {
      track.removeAttribute("role");
      track.removeAttribute("aria-label");
      track.removeAttribute("tabindex");
    }
  };
  const onScroll = () => {
    const card = track.firstElementChild;
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

function wireCarousel() {
  const uses = document.querySelector(".ucs");
  if (uses) wireTrack(uses, Array.from(document.querySelectorAll(".ucdots i")), "useCases");
  const setup = document.querySelector("#setup .setup");
  if (setup) wireTrack(setup, Array.from(document.querySelectorAll(".setdots i")), "setupOptions");
}

function wireCopy() {
  const live = document.getElementById("copy-live");
  for (const button of document.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", () => {
      const text = button.dataset.copy || "";
      const done = (ok) => {
        button.classList.add(ok ? "copied" : "copyfail");
        const labelNode = button.querySelector(".olbl");
        const before = labelNode ? labelNode.textContent : null;
        const aria = button.getAttribute("aria-label");
        if (labelNode) labelNode.textContent = rt(ok ? "copied" : "selectCopy");
        else button.setAttribute("aria-label", rt(ok ? "copied" : "copyFailed"));
        if (live) live.textContent = rt(ok ? "liveOk" : "liveFail");
        setTimeout(() => {
          button.classList.remove("copied", "copyfail");
          if (labelNode && before !== null) labelNode.textContent = before;
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

function snapStarts() {
  return Array.from(document.querySelectorAll("[data-snap]"))
    .filter((el) => getComputedStyle(el).getPropertyValue("--snap").trim() !== "0" && el.getClientRects().length)
    .map((el) => Math.round(el.getBoundingClientRect().top + window.scrollY));
}

function menuOpen() {
  const menu = document.getElementById("m-menu");
  return Boolean(menu && !menu.hidden);
}

function wantsNativeKey(event) {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return true;
  const target = event.target instanceof Element ? event.target : null;
  if (target && target.closest(NATIVE_KEY_TARGETS)) return true;
  return menuOpen();
}

function wireSectionKeys() {
  let pending = null;
  let settleTimer = 0;
  const clearPending = () => {
    pending = null;
  };
  window.addEventListener("scrollend", clearPending);
  document.addEventListener("keydown", (event) => {
    const direction = keyDirection(event.key, event.shiftKey);
    if (!direction || wantsNativeKey(event)) return;
    const view = window.innerHeight;
    const max = document.documentElement.scrollHeight - view;
    const scrollTop = pending !== null && Math.abs(window.scrollY - pending) > EDGE_PX ? pending : window.scrollY;
    const top = sectionTarget({ starts: snapStarts(), scrollTop, view, max, direction });
    event.preventDefault();
    if (top === null) return;
    pending = top;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(clearPending, SCROLL_SETTLE_MS);
    window.scrollTo({ top, behavior: reduceMotion() ? "auto" : "smooth" });
  });
}

function measureInto(source, target, name) {
  if (!source || !target || typeof ResizeObserver === "undefined") return;
  const write = () => target.style.setProperty(name, `${Math.ceil(source.getBoundingClientRect().height)}px`);
  new ResizeObserver(write).observe(source);
  write();
}

function wireScreenHeights() {
  const uses = document.getElementById("uses");
  measureInto(uses && uses.querySelector(".shead"), uses, "--uh");
  measureInto(document.querySelector(".foot"), document.documentElement, "--fh");
}

function activeDot(links) {
  const probe = window.scrollY + window.innerHeight * DOT_PROBE_SHARE;
  let active = links[0];
  for (const link of links) {
    const section = document.querySelector(link.getAttribute("href"));
    if (section && section.getBoundingClientRect().top + window.scrollY <= probe) active = link;
  }
  return active;
}

function wireDots() {
  const links = Array.from(document.querySelectorAll(".sdots a"));
  if (!links.length) return;
  let frame = 0;
  const mark = () => {
    frame = 0;
    const active = activeDot(links);
    for (const link of links) {
      if (link === active) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  };
  const queue = () => {
    if (!frame) frame = requestAnimationFrame(mark);
  };
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue);
  mark();
}

function pageAtCentre(pages) {
  const probe = window.scrollY + window.innerHeight * DOT_PROBE_SHARE;
  let current = pages[0];
  for (const page of pages) {
    if (page.getBoundingClientRect().top + window.scrollY <= probe) current = page;
  }
  return current;
}

function wireEdges() {
  const pages = Array.from(document.querySelectorAll("main > section[id], .foot"));
  const root = document.documentElement;
  const theme = document.querySelector('meta[name="theme-color"]');
  if (!pages.length) return;
  let frame = 0;
  const mark = () => {
    frame = 0;
    const name = pageAtCentre(pages).id || FOOT_PAGE;
    if (root.dataset.page === name) return;
    root.dataset.page = name;
    if (theme) theme.content = getComputedStyle(root).getPropertyValue("--edge-top").trim();
  };
  const queue = () => {
    if (!frame) frame = requestAnimationFrame(mark);
  };
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue);
  mark();
}

function init() {
  wireLang();
  wireMenu();
  wireReveal();
  wireCarousel();
  wireCopy();
  dropUndecodableAv1(document, navigator.mediaCapabilities).then(wireVideos, wireVideos);
  wireScreenHeights();
  wireSectionKeys();
  wireSwipePages({ pageStarts: snapStarts, menuOpen, reduceMotion });
  wireEdges();
  wireDots();
  if (getLang() === "de" || document.documentElement.lang === "de") applyLang("de");
  resolveLegacyHash();
  window.addEventListener("hashchange", resolveLegacyHash);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
