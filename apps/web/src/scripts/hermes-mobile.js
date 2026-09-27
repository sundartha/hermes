/* =============================================================================
 * hermes-mobile.js - Verhalten der Handy-Startseite (< 768 px)
 *
 * Gegenstueck zu components/MobileHome.astro und styles/hermes-mobile.css;
 * Umsetzung von design/handoff-mobile (Design-Schema.md, Abschnitt 8). Das
 * Modul setzt nur Zustaende - als Data-Attribute und als Variable --p -, das
 * Aussehen rechnet das CSS. Einzige Ausnahme: Tippen und Zaehler schreiben
 * Text (textContent). Kein Inline-Style im Markup, CSP-konform.
 *
 * Zustaende (README des Handoffs):
 *   active  0-4   aktueller Screen aus p = scrollTop / clientHeight
 *   Blaettern     eine Geste = genau ein Screen, immer buendig (lib/mobile-pager.js)
 *   step    0-2   Autoplay (6.5 s) nur auf Screen 2, Tippen oder Wischen
 *   plan    0/1   Starter / Pro, Start auf dem hervorgehobenen Tarif
 *   way     0-2   Connector / Terminal / Your AI
 *   copied        faellt nach 1.6 s zurueck
 *   lang    en/de folgt <html lang> (der Umschalter laeuft ueber hermes-scroll.js)
 * prefers-reduced-motion: kein Autoplay, kein Parallax, keine Staffel.
 * ========================================================================== */

import {
  WHEEL_QUIET_MS,
  WHEEL_STEP_PX,
  pageDuration,
  pageStep,
  pageTarget,
  wheelPixels,
} from "../lib/mobile-pager.js";

/* Dieselbe Abfrage wie in hermes-mobile.css. */
const MOBILE_QUERY = "(max-width: 767.98px) and (not ((pointer: coarse) and (max-height: 500px)))";
const SCREEN_HOW = 1;
const SCREEN_PRICE = 2;
const AUTOPLAY_MS = 6500;
const COPIED_MS = 1600;
/* Beim Ankommen auf den Preisen starten Leiste, Zaehler und Leistungen nach
 * 520 ms - gilt fuer alles, was in den ersten 300 ms nach dem Ankommen passiert. */
const ARRIVE_WINDOW_MS = 300;
const ARRIVE_DELAY_MS = 520;
const COUNT_BASE_MS = 450;
const COUNT_PER_SEGMENT_MS = 150;
const SWIPE_MIN_PX = 40;
/* Blaettern: ab dieser Strecke (px) steht fest, ob die Geste senkrecht
 * (blaettern) oder waagerecht (Schritte auf Screen 2) gemeint ist; das Tempo
 * am Ende misst sich ueber die letzten VELOCITY_WINDOW_MS; nach SETTLE_MS Ruhe
 * wird eine fremd verursachte Zwischenposition (Fokus, Vorlesen) buendig
 * gestellt. */
const AXIS_LOCK_PX = 8;
const VELOCITY_WINDOW_MS = 100;
const MIN_SAMPLES = 2;
const SETTLE_MS = 140;
const PROGRESS_DIGITS = 4;
const EASE_POWER = 3;
/* Phasen der drei Animationen (ms nach dem Ankommen) und ab welcher Phase die
 * Ergebniszeile getippt wird (Tempo je Zeichen). Werte aus hermes-kit.js. */
const NUMBER_RING_MS = 60;
const NUMBER_TYPE_MS = 1500;
const NUMBER_LIVE_MS = 1900;
const MCP_LOCK_MS = 1700;
const MCP_DONE_MS = 2000;
const WAVE_DONE_MS = 3200;
const VIZ_TIMING = Object.freeze([
  Object.freeze({
    phases: [NUMBER_RING_MS, NUMBER_TYPE_MS, NUMBER_LIVE_MS],
    typeAt: 2,
    typeMs: 55,
  }),
  Object.freeze({ phases: [MCP_LOCK_MS, MCP_DONE_MS], typeAt: 1, typeMs: 40 }),
  Object.freeze({ phases: [WAVE_DONE_MS], typeAt: 0, typeMs: 0 }),
]);
const COPIED_MARK = "✓  ";
/* Zwei gleichwertige Keyframe-Namen im CSS: der Wechsel startet die Fuellung neu. */
const RUN_VARIANTS = 2;

const mobile = window.matchMedia(MOBILE_QUERY);
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  active: -1,
  step: 0,
  run: 0,
  plan: 0,
  way: 0,
  lang: "en",
  arrivedAt: 0,
  countValue: 0,
  countLive: false,
};
const el = {};
const vizTimers = new Set();
const enHtml = new Map();
let autoTimer = 0;
let copiedTimer = 0;
let arriveTimer = 0;
let countFrame = 0;
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
const autoplay = () => mobile.matches && !reduced.matches;
const langAttr = (base) => `${base}-${state.lang === "de" ? "de" : "en"}`;

/* ------------------------------------------------------------ Scrollen */

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

/* ----------------------------------------------------------- Blaettern */

/* Eine Geste bewegt genau einen Screen, und jede Fahrt endet buendig auf einem
 * ganzen Screen - egal wie hart gewischt wurde. Der Finger zieht den Screen mit
 * (hoechstens bis zum Nachbarn), beim Loslassen entscheidet lib/mobile-pager.js
 * ueber weiter / zurueck; die Fahrt dorthin laeuft hier per requestAnimationFrame
 * ueber scrollTop, damit --p, Parallax und Ankommen wie beim Scrollen folgen. */

const pageHeight = () => el.scroller.clientHeight;

/* Worauf die Seite gerade steht oder zufaehrt. */
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

/* Steht die Seite zwischen zwei Screens (der Browser rollt einen fokussierten
 * Knopf ins Bild, Vorlesefunktion), faehrt sie buendig - auf den Screen mit dem
 * Fokus, wenn er einer der beiden angeschnittenen ist, sonst auf den naechsten. */
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
    // Zweiter Finger (Zoomen): Geste abbrechen, buendig stellen.
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

/* Fingertempo am Ende in px/ms, positiv = Richtung naechster Screen. */
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
    // Antippen oder waagerechte Geste: die Seite bleibt, steht aber immer buendig.
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

/* Mausrad und Trackpad: eine Geste = ein Screen; ihr Nachlauf zaehlt nicht. */
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

/* Screen wird aktiv: gestaffeltes Einblenden per CSS, Schritt 1 von vorn,
 * "Copied" zurueck, die Preise laufen ihre Ankunft durch. */
function setActive(index) {
  state.active = index;
  state.arrivedAt = performance.now();
  el.screens.forEach((screen, i) => screen.setAttribute("data-active", i === index ? "1" : "0"));
  if (index === SCREEN_HOW) state.step = 0;
  state.run += 1;
  setCopied(false);
  renderSteps();
  renderPlan();
}

/* -------------------------------------------------- Screen 2: Schritte */

function setStep(index) {
  state.step = index;
  state.run += 1;
  renderSteps();
}

function renderSteps() {
  const { how } = el;
  how.setAttribute("data-step", String(state.step));
  how.setAttribute("data-run", state.run % RUN_VARIANTS ? "b" : "a");
  how.setAttribute("data-auto", autoplay() ? "1" : "0");
  setRel(el.steps, state.step);
  el.bars.forEach((bar, i) => {
    const phase = relOf(i, state.step);
    bar.setAttribute("data-state", { before: "done", cur: "cur", after: "todo" }[phase]);
    if (phase === "cur") bar.setAttribute("aria-current", "step");
    else bar.removeAttribute("aria-current");
  });
  mountViz();
  scheduleAutoplay();
}

function scheduleAutoplay() {
  clearTimeout(autoTimer);
  if (state.active !== SCREEN_HOW || !autoplay() || document.hidden) return;
  autoTimer = setTimeout(() => setStep((state.step + 1) % el.steps.length), AUTOPLAY_MS);
}

function clearViz() {
  // clearTimeout raeumt nach HTML-Spec auch Intervalle ab (gemeinsame Liste).
  for (const id of vizTimers) clearTimeout(id);
  vizTimers.clear();
}

function later(ms, run) {
  const id = setTimeout(() => {
    vizTimers.delete(id);
    run();
  }, ms);
  vizTimers.add(id);
}

/* Die Animation des aktuellen Schritts startet bei jedem Ankommen und jedem
 * Schrittwechsel neu. data-reset schaltet fuer einen Frame alle Uebergaenge
 * ab, damit nichts sichtbar zurueckspult. */
function mountViz() {
  clearViz();
  el.vizzes.forEach((viz, i) => viz.setAttribute("data-on", i === state.step ? "1" : "0"));
  const viz = el.vizzes[state.step];
  if (!viz || state.active !== SCREEN_HOW) return;
  viz.setAttribute("data-reset", "");
  viz.setAttribute("data-phase", "0");
  viz.setAttribute("data-done", "0");
  const line = viz.querySelector("[data-type]");
  if (line) line.replaceChildren();
  void viz.offsetWidth;
  viz.removeAttribute("data-reset");
  const timing = VIZ_TIMING[state.step];
  timing.phases.forEach((ms, i) => later(ms, () => enterPhase(viz, i + 1, timing)));
}

function enterPhase(viz, phase, timing) {
  viz.setAttribute("data-phase", String(phase));
  if (phase === timing.typeAt) typeLine(viz, timing.typeMs);
}

function typeLine(viz, speed) {
  const line = viz.querySelector("[data-type]");
  if (!line) return;
  const text = line.getAttribute("data-type");
  let count = 0;
  const id = setInterval(() => {
    count += 1;
    line.replaceChildren(text.slice(0, count));
    if (count < text.length) return;
    clearInterval(id);
    vizTimers.delete(id);
    viz.setAttribute("data-done", "1");
  }, speed);
  vizTimers.add(id);
}

function wireSwipe() {
  let start = null;
  el.swipe.addEventListener("pointerdown", (event) => {
    start = { left: event.clientX, top: event.clientY };
  });
  el.swipe.addEventListener("pointercancel", () => {
    start = null;
  });
  el.swipe.addEventListener("pointerup", (event) => {
    if (start == null) return;
    const dx = event.clientX - start.left;
    const dy = event.clientY - start.top;
    start = null;
    // Nur eine ueberwiegend waagerechte Geste wechselt den Schritt; senkrecht blaettert.
    if (Math.abs(dx) <= SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return;
    const next = state.step + (dx < 0 ? 1 : -1);
    if (next >= 0 && next < el.steps.length) setStep(next);
  });
}

/* ---------------------------------------------------- Screen 3: Preise */

function setPlan(index) {
  if (index === state.plan) return;
  state.plan = index;
  renderPlan();
}

function arrivalDelay() {
  const fresh = performance.now() - state.arrivedAt < ARRIVE_WINDOW_MS;
  return fresh && !reduced.matches && state.active === SCREEN_PRICE ? ARRIVE_DELAY_MS : 0;
}

function renderPlan() {
  const { price } = el;
  const on = state.active === SCREEN_PRICE;
  const lit = litSegments(state.plan);
  const delay = arrivalDelay();
  price.setAttribute("data-plan", String(state.plan));
  el.planToggle.setAttribute("data-sel", String(state.plan));
  el.planTabs.forEach((tab, i) => tab.setAttribute("aria-selected", String(i === state.plan)));
  el.priceNum
    .querySelectorAll(".mh-roll")
    .forEach((roll) => setRel([...roll.children], state.plan));
  el.benefitRows.forEach((row) => setRel([...row.children], state.plan));
  setRel(el.ctas, state.plan);
  // Die Verzoegerung beim Ankommen rechnet das CSS ueber data-arrive.
  clearTimeout(arriveTimer);
  price.toggleAttribute("data-arrive", delay > 0);
  if (delay > 0)
    arriveTimer = setTimeout(() => price.removeAttribute("data-arrive"), ARRIVE_WINDOW_MS);
  el.segments.forEach((segment, j) => segment.classList.toggle("is-on", on && j < lit));
  renderCount(on, lit, delay);
  if (el.priceFallback) el.priceNum.replaceChildren(el.priceFallback[state.plan] || "");
}

/* Ein Segment steht fuer ein Viertel der groessten Minutenzahl (30 von 120). */
function litSegments(plan) {
  const most = Math.max(1, ...el.minutes);
  return Math.round(el.minutes[plan] / (most / el.segments.length));
}

/* Zaehler laeuft synchron zur Leiste (Tabellenziffern im CSS). Beim Ankommen
 * zaehlt er von 0; ausserhalb der Preise steht die Zahl still. */
function renderCount(on, lit, delay) {
  cancelAnimationFrame(countFrame);
  const target = el.minutes[state.plan];
  if (!on) {
    state.countLive = false;
    state.countValue = target;
    el.count.replaceChildren(String(target));
    return;
  }
  if (!state.countLive) {
    state.countLive = true;
    state.countValue = 0;
    el.count.replaceChildren("0");
  }
  const duration = reduced.matches ? 0 : COUNT_BASE_MS + lit * COUNT_PER_SEGMENT_MS;
  countTo(target, duration, delay);
}

function countTo(target, duration, delay) {
  const from = state.countValue;
  const start = performance.now() + delay;
  const tick = (now) => {
    const ratio = duration > 0 ? clamp((now - start) / duration, 0, 1) : 1;
    const eased = 1 - Math.pow(1 - ratio, EASE_POWER);
    state.countValue = Math.round(from + (target - from) * eased);
    el.count.replaceChildren(String(state.countValue));
    if (ratio < 1) countFrame = requestAnimationFrame(tick);
  };
  countFrame = requestAnimationFrame(tick);
}

/* Preis in Schaechte zerlegen: nur Zeichen, die sich zwischen den Tarifen
 * unterscheiden, rollen. Gleiche Zerlegung wie im Astro-Markup. */
function priceSlots(list) {
  if (!list.every((price) => price.length === list[0].length)) return null;
  return Array.from(list[0], (_ch, pos) => list.map((price) => price[pos]));
}

function slotNode(chars) {
  const node = document.createElement("span");
  if (chars.every((ch) => ch === chars[0])) {
    node.textContent = chars[0];
    return node;
  }
  node.className = "mh-roll";
  chars.forEach((ch, index) => {
    const layer = document.createElement("span");
    layer.textContent = ch;
    layer.setAttribute("data-rel", relOf(index, state.plan));
    node.append(layer);
  });
  return node;
}

function buildPrice() {
  const list = (el.priceNum.getAttribute(langAttr("data-prices")) || "").split("|");
  const slots = priceSlots(list);
  el.priceFallback = slots ? null : list;
  el.priceNum.replaceChildren(...(slots ? slots.map(slotNode) : []));
}

/* ------------------------------------------------ Screen 4: Entwickler */

function setWay(index) {
  state.way = index;
  el.dev.setAttribute("data-way", String(index));
  el.wayToggle.setAttribute("data-sel", String(index));
  el.wayTabs.forEach((tab, i) => tab.setAttribute("aria-selected", String(i === index)));
  setRel(el.ways, index);
  setCopied(false);
}

function setCopied(on) {
  clearTimeout(copiedTimer);
  el.dev.setAttribute("data-copied", on ? "1" : "0");
  const label = el.copy.getAttribute(langAttr(on ? "data-copied" : "data-copy-label"));
  el.copy.replaceChildren(on ? COPIED_MARK + label : label);
  if (on) copiedTimer = setTimeout(() => setCopied(false), COPIED_MS);
}

/* Kopiert wird immer der vollstaendige Text (beim Terminal der ganze Befehl).
 * "Copied" erscheint nur, wenn es wirklich geklappt hat. */
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

/* ------------------------------------------------------------- Sprache */

/* Englisch steht im Markup; beim ersten Wechsel wird es je Knoten eingefroren,
 * die deutsche Fassung reist als data-mh-de mit (eigenes, statisches Markup). */
function applyLang(next) {
  const lang = next === "de" ? "de" : "en";
  if (lang === state.lang) return;
  state.lang = lang;
  for (const node of el.i18n) {
    if (!enHtml.has(node)) enHtml.set(node, node.innerHTML);
    node.innerHTML = lang === "de" ? node.getAttribute("data-mh-de") : enHtml.get(node);
  }
  for (const bar of el.bars) {
    if (!enHtml.has(bar)) enHtml.set(bar, bar.getAttribute("aria-label"));
    bar.setAttribute(
      "aria-label",
      lang === "de" ? bar.getAttribute("data-mh-de-label") : enHtml.get(bar),
    );
  }
  buildPrice();
  renderPlan();
  setCopied(false);
}

/* ------------------------------------------------------------ Tastatur */

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

/* Die Tastatur gehoert dem Handy-Screen nur, wenn kein Blatt offen ist und
 * nicht gerade in ein Feld getippt wird. */
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

/* --------------------------------------------------------------- Start */

function stopAll() {
  stopGlide();
  pager.drag = null;
  clearTimeout(autoTimer);
  clearViz();
  cancelAnimationFrame(countFrame);
}

/* Groesse geaendert (Drehen, Fensterbreite): den aktiven Screen wieder
 * buendig stellen, der Zustand bleibt. */
function realign() {
  if (!mobile.matches || state.active < 0) return;
  const index = pager.frame ? pager.target : state.active;
  stopGlide();
  el.scroller.scrollTop = index * el.scroller.clientHeight;
  update();
}

/* Handy-Abfrage oder Bewegungs-Wunsch geaendert: alles neu ableiten. */
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
  const how = root.querySelector(".mh-how");
  const price = root.querySelector(".mh-price");
  const dev = root.querySelector(".mh-dev");
  const minutes = price.querySelector("[data-minutes]");
  Object.assign(el, {
    root,
    how,
    price,
    dev,
    scroller: root.querySelector(".mh-scroll"),
    screens: [...root.querySelectorAll(".mh-screen")],
    steps: [...how.querySelectorAll(".mh-step")],
    bars: [...how.querySelectorAll("[data-mh-step]")],
    vizzes: [...how.querySelectorAll(".mh-viz")],
    swipe: how.querySelector("[data-mh-swipe]"),
    priceNum: price.querySelector(".mh-price__num"),
    planToggle: price.querySelector(".mh-toggle"),
    planTabs: [...price.querySelectorAll("[data-mh-plan]")],
    benefitRows: [...price.querySelectorAll(".mh-benefit-row")],
    ctas: [...price.querySelectorAll(".mh-cta")],
    segments: [...price.querySelectorAll(".mh-seg")],
    count: price.querySelector(".mh-count"),
    minutes: minutes.getAttribute("data-minutes").split("|").map(Number),
    wayToggle: dev.querySelector(".mh-toggle"),
    wayTabs: [...dev.querySelectorAll("[data-mh-way]")],
    ways: [...dev.querySelectorAll(".mh-way")],
    copy: dev.querySelector("[data-mh-copy]"),
    i18n: [...root.querySelectorAll("[data-mh-de]")],
    priceFallback: null,
  });
  state.plan = Number(price.getAttribute("data-plan")) || 0;
}

function wire(root) {
  el.scroller.addEventListener("scroll", onScroll, { passive: true });
  for (const btn of root.querySelectorAll("[data-mh-go]")) {
    btn.addEventListener("click", () => jump(Number(btn.getAttribute("data-mh-go"))));
  }
  el.bars.forEach((bar, i) => bar.addEventListener("click", () => setStep(i)));
  el.planTabs.forEach((tab, i) => tab.addEventListener("click", () => setPlan(i)));
  el.wayTabs.forEach((tab, i) => tab.addEventListener("click", () => setWay(i)));
  el.copy.addEventListener("click", copyActive);
  wireSwipe();
  wirePager();
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.active === SCREEN_HOW) setStep(state.step);
  });
  window.addEventListener("resize", realign);
  for (const query of [mobile, reduced]) query.addEventListener("change", refresh);
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
  buildPrice();
  applyLang(document.documentElement.lang);
  root.setAttribute("data-ready", "");
  root.setAttribute("data-pager", "");
  refresh();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
