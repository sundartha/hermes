import {
  WHEEL_QUIET_MS,
  WHEEL_STEP_PX,
  pageDuration,
  pageStep,
  pageTarget,
  wheelPixels,
} from "../lib/mobile-pager.js";
import { anchorFromHash } from "../lib/home-anchors.js";
import { typeableLength, typedSplit } from "../lib/mobile-code.js";

const MOBILE_QUERY = "(max-width: 767.98px) and (not ((pointer: coarse) and (max-height: 500px))), (pointer: coarse) and (min-width: 768px) and (max-width: 1024px) and (orientation: portrait)";
// Screen 2 (Anker #so-funktionierts, test/home-anchors.test.js): Use Cases.
const SCREEN_HOW = 1;
const SCREEN_PRICE = 2;
const SCREEN_DEV = 3;
const COPIED_MS = 1600;
const AXIS_LOCK_PX = 8;
const VELOCITY_WINDOW_MS = 100;
const MIN_SAMPLES = 2;
const SETTLE_MS = 140;
const PROGRESS_DIGITS = 4;
const EASE_POWER = 3;
const CODE_ARRIVE_MS = 560;
const CODE_SWITCH_MS = 140;
const CODE_CHAR_MS = 12;
const CODE_TICK_MS = 24;

const mobile = window.matchMedia(MOBILE_QUERY);
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  active: -1,
  plan: 0,
  way: 0,
  typed: Infinity,
  lang: "en",
};
const el = {};
const enHtml = new Map();
let copiedTimer = 0;
let typeTimer = 0;
let scrollFrame = 0;
const pager = {
  frame: 0,
  target: 0,
  drag: null,
  wheelSum: 0,
  wheelLocked: false,
  wheelTimer: 0,
  settleTimer: 0,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const relOf = (index, current) => {
  if (index === current) return "cur";
  return index < current ? "before" : "after";
};
const setRel = (nodes, current) =>
  nodes.forEach((node, index) => node.setAttribute("data-rel", relOf(index, current)));
const langAttr = (base) => `${base}-${state.lang === "de" ? "de" : "en"}`;

function onScroll() {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(update);
  clearTimeout(pager.settleTimer);
  if (!pager.frame && !pager.drag) pager.settleTimer = setTimeout(settle, SETTLE_MS);
}

function update() {
  scrollFrame = 0;
  const height = el.scroller.clientHeight;
  if (!height || !mobile.matches) return;
  const progress = el.scroller.scrollTop / height;
  el.root.style.setProperty("--p", progress.toFixed(PROGRESS_DIGITS));
  const index = clamp(Math.round(progress), 0, el.screens.length - 1);
  if (index !== state.active) setActive(index);
}

function jump(index) {
  glideTo(clamp(index, 0, el.screens.length - 1));
}

const pageHeight = () => el.scroller.clientHeight;

function pageIndex() {
  if (pager.frame) return pager.target;
  const height = pageHeight();
  return height ? clamp(Math.round(el.scroller.scrollTop / height), 0, el.screens.length - 1) : 0;
}

function stopGlide() {
  cancelAnimationFrame(pager.frame);
  pager.frame = 0;
}

function glideTo(index) {
  stopGlide();
  pager.target = index;
  const height = pageHeight();
  const from = el.scroller.scrollTop;
  const distance = index * height - from;
  if (reduced.matches || Math.abs(distance) < 1) {
    el.scroller.scrollTop = index * height;
    return;
  }
  const duration = pageDuration(distance, height);
  const start = performance.now();
  const tick = (now) => {
    const ratio = clamp((now - start) / duration, 0, 1);
    el.scroller.scrollTop = from + distance * (1 - Math.pow(1 - ratio, EASE_POWER));
    pager.frame = ratio < 1 ? requestAnimationFrame(tick) : 0;
  };
  pager.frame = requestAnimationFrame(tick);
}

function settle() {
  const height = pageHeight();
  if (pager.frame || pager.drag || !height || !mobile.matches) return;
  const exact = el.scroller.scrollTop / height;
  if (Math.abs(exact - Math.round(exact)) * height <= 1) return;
  const active = document.activeElement;
  const focused = el.screens.indexOf(active && active.closest(".mh-screen"));
  const cut = [Math.floor(exact), Math.ceil(exact)];
  glideTo(cut.includes(focused) ? focused : clamp(Math.round(exact), 0, el.screens.length - 1));
}

function onPointerDown(event) {
  if (!mobile.matches || event.pointerType === "mouse") return;
  if (!event.isPrimary) {
    pager.drag = null;
    glideTo(pageIndex());
    return;
  }
  const base = pageIndex();
  stopGlide();
  pager.drag = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    top: el.scroller.scrollTop,
    base,
    axis: null,
    samples: [{ time: event.timeStamp, pos: event.clientY }],
  };
}

function onPointerMove(event) {
  const drag = pager.drag;
  if (!drag || event.pointerId !== drag.id) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  if (!drag.axis) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK_PX) return;
    drag.axis = Math.abs(dy) >= Math.abs(dx) ? "y" : "x";
  }
  if (drag.axis !== "y") return;
  const height = pageHeight();
  const lowest = Math.max(0, drag.base - 1) * height;
  const highest = Math.min(el.screens.length - 1, drag.base + 1) * height;
  el.scroller.scrollTop = clamp(drag.top - dy, lowest, highest);
  drag.samples.push({ time: event.timeStamp, pos: event.clientY });
  const old = (sample) => event.timeStamp - sample.time > VELOCITY_WINDOW_MS;
  while (drag.samples.length > MIN_SAMPLES && old(drag.samples[0])) {
    drag.samples.shift();
  }
}

function releaseVelocity(samples) {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const time = last.time - first.time;
  return time > 0 ? (first.pos - last.pos) / time : 0;
}

function onPointerUp(event) {
  const drag = pager.drag;
  if (!drag || event.pointerId !== drag.id) return;
  pager.drag = null;
  if (drag.axis !== "y") {
    glideTo(drag.base);
    return;
  }
  const step = pageStep({
    moved: el.scroller.scrollTop - drag.base * pageHeight(),
    velocity: releaseVelocity(drag.samples),
    height: pageHeight(),
  });
  glideTo(pageTarget(drag.base, step, el.screens.length));
}

function onPointerCancel(event) {
  const drag = pager.drag;
  if (!drag || event.pointerId !== drag.id) return;
  pager.drag = null;
  glideTo(pageIndex());
}

function onWheel(event) {
  if (!mobile.matches || event.ctrlKey) return;
  event.preventDefault();
  clearTimeout(pager.wheelTimer);
  pager.wheelTimer = setTimeout(() => {
    pager.wheelLocked = false;
    pager.wheelSum = 0;
  }, WHEEL_QUIET_MS);
  if (pager.wheelLocked) return;
  pager.wheelSum += wheelPixels(event.deltaY, event.deltaMode, pageHeight());
  if (Math.abs(pager.wheelSum) < WHEEL_STEP_PX) return;
  pager.wheelLocked = true;
  glideTo(pageTarget(pageIndex(), pager.wheelSum, el.screens.length));
  pager.wheelSum = 0;
}

function wirePager() {
  const { scroller } = el;
  scroller.addEventListener("pointerdown", onPointerDown);
  scroller.addEventListener("pointermove", onPointerMove);
  scroller.addEventListener("pointerup", onPointerUp);
  scroller.addEventListener("pointercancel", onPointerCancel);
  scroller.addEventListener("wheel", onWheel, { passive: false });
}

function setActive(index) {
  state.active = index;
  el.root.setAttribute("data-screen", String(index));
  el.screens.forEach((screen, i) => screen.setAttribute("data-active", i === index ? "1" : "0"));
  setCopied(false);
  renderPlan();
  if (index === SCREEN_DEV) startTyping(CODE_ARRIVE_MS);
  else stopTyping();
}

function setPlan(index) {
  if (index === state.plan) return;
  state.plan = index;
  renderPlan();
}

function renderPlan() {
  el.price.setAttribute("data-plan", String(state.plan));
  el.planToggle.setAttribute("data-sel", String(state.plan));
  el.planTabs.forEach((tab) =>
    tab.setAttribute("aria-selected", String(Number(tab.getAttribute("data-mh-plan")) === state.plan)),
  );
  setRel(el.ctaNames, state.plan);
  sizeCta();
}

// Tarif-Karten: waagerecht wischen wechselt die Karte (Pager ist senkrecht).
const SWIPE_MIN_PX = 40;

function wireCards() {
  let start = null;
  el.planToggle.addEventListener("pointerdown", (event) => {
    start = { x: event.clientX, y: event.clientY };
  });
  el.planToggle.addEventListener("pointerup", (event) => {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy)) return;
    const last = el.planTabs.reduce((most, tab) => Math.max(most, Number(tab.getAttribute("data-mh-plan"))), 0);
    setPlan(clamp(state.plan + (dx < 0 ? 1 : -1), 0, last));
  });
}

function buildCta() {
  const template = el.cta.getAttribute(langAttr("data-cta")) || "{}";
  const [pre, suf] = template.split("{}");
  el.ctaPre.textContent = pre || "";
  el.ctaSuf.textContent = suf || "";
  sizeCta();
}

function sizeCta() {
  const name = el.ctaNames[state.plan];
  if (!name) return;
  const width = Math.ceil(name.getBoundingClientRect().width);
  if (width > 0) el.ctaRoll.style.width = `${width + 1}px`;
}

function setWay(index) {
  state.way = index;
  el.dev.setAttribute("data-way", String(index));
  el.wayToggle.setAttribute("data-sel", String(index));
  el.wayTabs.forEach((tab, i) => tab.setAttribute("aria-selected", String(i === index)));
  setRel(el.ways, index);
  setCopied(false);
  renderAllCode();
  startTyping(CODE_SWITCH_MS);
}

const typeTokens = (way) => [...way.querySelectorAll(".mh-tk:not(.mh-tk--p)")];
const tokenText = (token) => token.getAttribute(langAttr("data-t")) || "";

function spanOf(className, text) {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  return node;
}

function renderCode(way, count) {
  const tokens = typeTokens(way);
  const texts = tokens.map(tokenText);
  if (count >= typeableLength(texts)) {
    tokens.forEach((token, i) => token.replaceChildren(texts[i]));
    return;
  }
  const { parts, caret } = typedSplit(texts, count);
  tokens.forEach((token, i) => {
    const nodes = [spanOf("mh-tk__on", parts[i].on)];
    if (i === caret) nodes.push(spanOf("mh-caret", ""));
    nodes.push(spanOf("mh-tk__off", parts[i].off));
    token.replaceChildren(...nodes);
  });
}

function renderAllCode() {
  el.ways.forEach((way, i) => renderCode(way, i === state.way ? state.typed : Infinity));
}

function stopTyping() {
  clearInterval(typeTimer);
  state.typed = Infinity;
  renderAllCode();
}

function startTyping(delay) {
  clearInterval(typeTimer);
  if (reduced.matches || state.active !== SCREEN_DEV) {
    stopTyping();
    return;
  }
  const way = el.ways[state.way];
  const total = typeableLength(typeTokens(way).map(tokenText));
  const start = performance.now() + delay;
  state.typed = 0;
  renderCode(way, 0);
  typeTimer = setInterval(() => {
    const count = Math.floor((performance.now() - start) / CODE_CHAR_MS);
    if (count < 0 || count === state.typed) return;
    if (count >= total) {
      stopTyping();
      return;
    }
    state.typed = count;
    renderCode(way, count);
  }, CODE_TICK_MS);
}

function setCopied(on) {
  clearTimeout(copiedTimer);
  el.dev.setAttribute("data-copied", on ? "1" : "0");
  const idle = state.way === 0 ? "data-copy-url-label" : "data-copy-label";
  el.copySr.textContent = el.copy.getAttribute(langAttr(on ? "data-copied" : idle));
  if (on) copiedTimer = setTimeout(() => setCopied(false), COPIED_MS);
}

async function copyActive() {
  const text = el.ways[state.way].getAttribute(langAttr("data-copy"));
  if (await writeClipboard(text)) setCopied(true);
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacyCopy(text);
  }
}

function legacyCopy(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.className = "mh-clip";
  area.setAttribute("readonly", "");
  document.body.append(area);
  area.select();
  let done;
  try {
    done = document.execCommand("copy");
  } catch {
    done = false;
  }
  area.remove();
  return done;
}

function applyLang(next) {
  const lang = next === "de" ? "de" : "en";
  if (lang === state.lang) return;
  state.lang = lang;
  for (const node of el.i18n) {
    if (!enHtml.has(node)) enHtml.set(node, node.innerHTML);
    node.innerHTML = lang === "de" ? node.getAttribute("data-mh-de") : enHtml.get(node);
  }
  buildCta();
  renderPlan();
  renderAllCode();
  setCopied(false);
  fitScenes();
}

const KEY_STEPS = Object.freeze({ ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 });

function keyTarget(event) {
  if (event.key === "Home") return 0;
  if (event.key === "End") return el.screens.length - 1;
  if (event.key in KEY_STEPS) return state.active + KEY_STEPS[event.key];
  const onControl =
    event.target &&
    event.target.closest &&
    event.target.closest("a, button, input, textarea, select");
  if (event.key === " " && !onControl) return state.active + (event.shiftKey ? -1 : 1);
  return null;
}

function keyIgnored(event) {
  if (!mobile.matches || event.defaultPrevented) return true;
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  if (document.querySelector('.sheet[data-open="1"]')) return true;
  const target = event.target;
  return Boolean(
    target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName || "")),
  );
}

function onKey(event) {
  if (keyIgnored(event)) return;
  const next = keyTarget(event);
  if (next == null) return;
  event.preventDefault();
  jump(next);
}

function stopAll() {
  stopGlide();
  pager.drag = null;
  stopTyping();
}

// Buehne auf Screen 2: je Szene die Zeilen, die den Verlauf bis zum unteren
// Element fuellen (MobileHome.astro, opt/alt). Von allen Kombinationen gewinnt
// die mit dem kleinsten Rest >= 0; eine ausgelassene wichtige Zeile (opt 1-2)
// zaehlt wie FIT_PENALTY px Rest je Stufe. Passt nichts, steht das Kuerzeste.
const FIT_PENALTY = 3;
const FIT_LEAST = 3;

function boxHeight(node, inner) {
  const style = getComputedStyle(node);
  const height = parseFloat(style.height) || 0;
  const edges = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"].reduce(
    (sum, key) => sum + parseFloat(style[key]),
    0,
  );
  if (inner) return style.boxSizing === "border-box" ? height - edges : height;
  return style.boxSizing === "border-box" ? height : height + edges;
}

const fitSkip = (node) => (FIT_LEAST - (Number(node.getAttribute("data-opt")) || FIT_LEAST)) * FIT_PENALTY;

// Je Wahl eine Liste von Varianten: [{ on: [Knoten], height, lines, cost }].
// Optionale Kalenderzeilen zaehlen in ihren Kalender hinein (ohne eigene Luecke).
function fitSlots(chat, rows) {
  const slots = [...rows].map(([row, height]) => [
    { on: [], height: 0, lines: 0, cost: fitSkip(row) },
    { on: [row], height, lines: 0, cost: 0 },
  ]);
  const groups = new Map();
  for (const line of chat.children) {
    const alt = line.getAttribute("data-alt");
    if (alt) groups.set(alt, [...(groups.get(alt) || []), line]);
    else if (line.hasAttribute("data-opt")) groups.set(line, [line]);
  }
  for (const members of groups.values()) {
    const variants = members.map((line) => ({ on: [line], height: boxHeight(line), lines: 1, cost: 0 }));
    if (members.every((line) => line.hasAttribute("data-opt"))) {
      variants.unshift({ on: [], height: 0, lines: 0, cost: fitSkip(members[0]) });
    }
    slots.push(variants);
  }
  return slots;
}

function fitChat(chat) {
  // Ohne Hoehe (Handy-Fassung ausgeblendet) bleibt die letzte Wahl stehen.
  if (boxHeight(chat, true) <= 0) return;
  const choosable = chat.querySelectorAll("[data-opt], [data-alt]");
  choosable.forEach((node) => node.removeAttribute("data-off"));
  // Kalenderzeilen zuerst messen, dann aus dem Kalender nehmen: dessen Hoehe
  // gilt so ohne sie.
  const rows = new Map(
    [...chat.querySelectorAll(".mh-cal__row[data-opt]")].map((row) => [
      row,
      boxHeight(row) + (parseFloat(getComputedStyle(row.parentElement).rowGap) || 0),
    ]),
  );
  rows.forEach((_, row) => row.setAttribute("data-off", ""));
  const avail = boxHeight(chat, true);
  chat.style.removeProperty("row-gap");
  const gap = parseFloat(getComputedStyle(chat).rowGap) || 0;
  const core = [...chat.children].filter((line) => !line.hasAttribute("data-opt") && !line.hasAttribute("data-alt"));
  const base = core.reduce((sum, line) => sum + boxHeight(line), 0);
  const slots = fitSlots(chat, rows);
  let best = null;
  let shortest = null;
  const visit = (index, picked) => {
    if (index < slots.length) {
      for (const variant of slots[index]) visit(index + 1, [...picked, variant]);
      return;
    }
    const count = core.length + picked.reduce((sum, variant) => sum + variant.lines, 0);
    const used = base + picked.reduce((sum, variant) => sum + variant.height, 0) + gap * (count - 1);
    const rest = avail - used;
    const cost = rest + picked.reduce((sum, variant) => sum + variant.cost, 0);
    if (rest >= 0 && (!best || cost < best.cost)) best = { cost, picked, rest, count };
    if (!shortest || used < shortest.used) shortest = { used, picked };
  };
  visit(0, []);
  const on = new Set((best || shortest).picked.flatMap((variant) => variant.on));
  choosable.forEach((node) => node.toggleAttribute("data-off", !on.has(node)));
  // Was an Rest bleibt (kleiner als eine Zeile), geht gleichmaessig in die
  // Luecken - so steht nie ein Loch ueber dem unteren Element.
  if (best && best.count > 1) chat.style.rowGap = `${gap + best.rest / (best.count - 1)}px`;
}

// Szenen-Knopf: springt zur Szene k. Die Runde ist reines CSS (ein Durchlauf,
// 68 s, Szene i beginnt bei 0.6 s + i x 17 s); alle Animationen des Screens
// werden auf den Beginn der Szene gesetzt, Blasen, Balken und Anzeiger laufen
// von dort bis zum Ende weiter. Der erste Knopf startet alles von vorn: die
// vollen Balken der Folge-Szenen sind dann wieder leer.
// Bei reduzierter Bewegung gibt es keine Runde, dort steht die Szene still.
const SCENE_MS = 17000;
const SCENE_START_MS = 600;
const ROUND_MS = 4 * SCENE_MS;

function pickScene(k) {
  const uses = el.uses;
  if (reduced.matches) {
    uses.setAttribute("data-pick", String(k));
    return;
  }
  const time = SCENE_START_MS + k * SCENE_MS;
  for (const animation of uses.getAnimations({ subtree: true })) {
    // Nur die Runde (68 s); der pulsierende Punkt der Anruf-Zeile laeuft eigenstaendig.
    if (animation.effect && animation.effect.getTiming().duration === ROUND_MS) {
      animation.currentTime = time;
      // Nach dem Durchlauf steht die Runde (finished): wieder anlaufen lassen.
      if (animation.playState === "finished") animation.play();
    }
  }
}

function fitScenes() {
  el.chats.forEach(fitChat);
  numberSteps();
  fitDev();
}

// Seite 4: das Fenster zeigt so viel Inhalt, wie hineinpasst. Stufen vom
// vollsten zum knappsten; die erste ohne Ueberlauf gilt.
const DEV_FITS = [
  "",
  "tight",
  "tight nores",
  "tight nogain",
  "tight nosub",
  "tight nosub nores",
  "tight nosub nogain",
];
function fitDev() {
  const dev = document.querySelector(".mh-dev");
  const win = dev && dev.querySelector(".mh-window");
  if (!win) return;
  for (const fit of DEV_FITS) {
    dev.setAttribute("data-fit", fit);
    if (win.scrollHeight <= win.clientHeight + 1) return;
  }
}

// --mh-step zaehlt nur die sichtbaren Blasen einer Szene: eine ausgelassene
// Zeile hinterlaesst keine Pause in der Abfolge.
function numberSteps() {
  for (const chat of el.chats) {
    const shown = [...chat.children].filter((msg) => getComputedStyle(msg).display !== "none");
    shown.forEach((msg, i) => msg.style.setProperty("--mh-step", String(i)));
  }
}

function realign() {
  fitScenes();
  if (!mobile.matches || state.active < 0) return;
  const index = pager.frame ? pager.target : state.active;
  stopGlide();
  el.scroller.scrollTop = index * el.scroller.clientHeight;
  update();
}

function openAnchor() {
  const anchor = anchorFromHash(window.location.hash);
  if (anchor && mobile.matches) el.scroller.scrollTop = anchor.index * el.scroller.clientHeight;
}

function refresh() {
  if (!mobile.matches) {
    stopAll();
    return;
  }
  if (state.active >= 0) el.scroller.scrollTop = state.active * el.scroller.clientHeight;
  state.active = -1;
  update();
}

function collect(root) {
  const price = root.querySelector(".mh-price");
  const dev = root.querySelector(".mh-dev");
  const cta = price.querySelector(".mh-cta");
  Object.assign(el, {
    root,
    price,
    dev,
    cta,
    scroller: root.querySelector(".mh-scroll"),
    screens: [...root.querySelectorAll(".mh-screen")],
    planToggle: price.querySelector(".mh-cards"),
    planTabs: [...price.querySelectorAll("[data-mh-plan]")],
    ctaPre: cta.querySelector(".mh-cta__pre"),
    ctaSuf: cta.querySelector(".mh-cta__suf"),
    ctaRoll: cta.querySelector(".mh-cta__roll"),
    ctaNames: [...cta.querySelectorAll(".mh-cta__name")],
    wayToggle: dev.querySelector(".mh-toggle"),
    wayTabs: [...dev.querySelectorAll("[data-mh-way]")],
    ways: [...dev.querySelectorAll(".mh-way")],
    copy: dev.querySelector("[data-mh-copy]"),
    copySr: dev.querySelector("[data-mh-copy-sr]"),
    i18n: [...root.querySelectorAll("[data-mh-de]")],
    chats: [...root.querySelectorAll(".mh-chat")],
    uses: root.querySelector(".mh-uses"),
  });
  state.plan = Number(price.getAttribute("data-plan")) || 0;
}

function wire(root) {
  el.scroller.addEventListener("scroll", onScroll, { passive: true });
  for (const btn of root.querySelectorAll("[data-mh-go]")) {
    btn.addEventListener("click", () => jump(Number(btn.getAttribute("data-mh-go"))));
  }
  for (const btn of root.querySelectorAll("[data-mh-scene]")) {
    btn.addEventListener("click", () => pickScene(Number(btn.getAttribute("data-mh-scene"))));
  }
  el.planTabs.forEach((tab) =>
    tab.addEventListener("click", () => setPlan(Number(tab.getAttribute("data-mh-plan")))),
  );
  wireCards();
  el.wayTabs.forEach((tab, i) => tab.addEventListener("click", () => setWay(i)));
  el.copy.addEventListener("click", copyActive);
  wirePager();
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", realign);
  for (const query of [mobile, reduced]) query.addEventListener("change", refresh);
  if (document.fonts) {
    document.fonts.ready.then(() => {
      sizeCta();
      fitScenes();
    });
  }
  new MutationObserver(() => applyLang(document.documentElement.lang)).observe(
    document.documentElement,
    {
      attributes: true,
      attributeFilter: ["lang"],
    },
  );
}

function init() {
  const root = document.querySelector("[data-mh]");
  if (!root) return;
  collect(root);
  wire(root);
  buildCta();
  applyLang(document.documentElement.lang);
  fitScenes();
  root.setAttribute("data-ready", "");
  root.setAttribute("data-pager", "");
  openAnchor();
  refresh();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
