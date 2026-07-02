// Gemeinsame Wing-Marke fuer ALLE Hermes-Widgets: EINE Quelle fuer das
// WING_PNG-Data-URI (aus design-system/components/brand/wing-image.js, der
// kanonischen Bild-Quelle) und die CSS-Regeln/-Keyframes, die die WingMark-
// Zustaende (idle/connecting/working/success/error, siehe WingMark.jsx) auf
// reinem CSS abbilden. widget-catalog.js fuegt beides per Platzhalter-Replace
// beim Laden ein (withWingAssets) - dasselbe Muster wie BIND_SCRIPT (G5/S2,
// eine Quelle statt Copy-Paste in 5 Dateien).
//
// Zwei Auspraegungen, damit die 4 Read-only-Widgets (kein Anruf-Lebenszyklus)
// nicht die ungenutzten State-Keyframes mitschleppen (sonst toter Code):
// - STATIC: nur idle (Drift + Bob) - agent-status/calendar/calls/my-number
// - LIVE: idle + alle vier Anruf-Status - call.html, Statuswechsel per
//   Klassenwechsel auf [data-wing] (siehe dortiges Inline-Skript)
import { WING_PNG } from "../../design-system/components/brand/wing-image.js";

// Basis-Layout + idle-Animation - in JEDER Auspraegung gleich. Kein Fuehrungs-
// Leerzeichen auf der ersten Zeile: der Aufrufer (withWingAssets) ersetzt
// einen bereits eingerueckten Platzhalter, die erste Zeile erbt dessen
// Einrueckung.
const WING_BASE_CSS = `.wing{display:inline-block;width:var(--wing-size);height:var(--wing-size);
        transform-origin:26% 86%;flex-shrink:0}
  .wing-inner{display:block;width:100%;height:100%;transform-origin:26% 86%}
  .wing-inner img{display:block;width:100%;height:100%;object-fit:contain;user-select:none}
  .wing--idle{animation:hermesWingDrift 6.8s ease-in-out infinite}
  .wing--idle .wing-inner{animation:hermesWingBob 3.9s ease-in-out infinite}`;

// Nur die LIVE-Auspraegung braucht die vier Nicht-idle-Zustaende.
const WING_STATE_CSS = `
  .wing--connecting .wing-inner{animation:hermesWingConnect 1.9s ease-in-out infinite}
  .wing--working .wing-inner{animation:hermesWingFlap .52s ease-in-out infinite}
  .wing--success .wing-inner{animation:hermesWingSuccess .95s cubic-bezier(.2,1.1,.3,1) 1 forwards}
  .wing--error .wing-inner{animation:hermesWingError .9s ease-out 1 forwards}`;

const WING_IDLE_KEYFRAMES = `
  @keyframes hermesWingDrift {
    0%   { transform: translate(0%, 0%) rotate(0deg); }
    22%  { transform: translate(-0.7%, -1.1%) rotate(-1deg); }
    48%  { transform: translate(0.5%, 0.5%) rotate(0.6deg); }
    74%  { transform: translate(0.8%, -0.7%) rotate(1.3deg); }
    100% { transform: translate(0%, 0%) rotate(0deg); }
  }
  @keyframes hermesWingBob {
    0%   { transform: translateY(0%); }
    50%  { transform: translateY(-5%); }
    100% { transform: translateY(0%); }
  }`;

const WING_STATE_KEYFRAMES = `
  @keyframes hermesWingConnect {
    0%, 48%, 100% { transform: rotate(0deg) translateY(0%); }
    10% { transform: rotate(11deg) translateY(-5%); }
    20% { transform: rotate(0deg)  translateY(0%); }
    30% { transform: rotate(11deg) translateY(-5%); }
    40% { transform: rotate(0deg)  translateY(0%); }
  }
  @keyframes hermesWingFlap {
    0%   { transform: rotate(-7deg) translateY(0%); }
    35%  { transform: rotate(15deg) translateY(-8%); }
    60%  { transform: rotate(9deg)  translateY(-4%); }
    100% { transform: rotate(-7deg) translateY(0%); }
  }
  @keyframes hermesWingSuccess {
    0%   { transform: rotate(-7deg) translateY(0%)   scale(1); }
    30%  { transform: rotate(17deg) translateY(-18%) scale(1.05); }
    55%  { transform: rotate(4deg)  translateY(-4%)  scale(1); }
    72%  { transform: rotate(-4deg) translateY(3%)   scale(.99); }
    100% { transform: rotate(0deg)  translateY(0%)   scale(1); }
  }
  @keyframes hermesWingError {
    0%   { transform: rotate(0deg)  translateY(0%); }
    10%  { transform: rotate(5deg); }
    22%  { transform: rotate(-4deg); }
    34%  { transform: rotate(4deg); }
    46%  { transform: rotate(-3deg); }
    100% { transform: rotate(-9deg) translateY(6%); }
  }`;

const WING_REDUCED_MOTION_CSS = `
  @media (prefers-reduced-motion: reduce) {
    .wing, .wing * { animation: none !important; }
  }`;

export const WING_CSS_STATIC = WING_BASE_CSS + WING_IDLE_KEYFRAMES + WING_REDUCED_MOTION_CSS;
export const WING_CSS_LIVE =
  WING_BASE_CSS + WING_STATE_CSS + WING_IDLE_KEYFRAMES + WING_STATE_KEYFRAMES + WING_REDUCED_MOTION_CSS;

// Zwei verschachtelte Wrapper + ein statisches <img> (kein innerHTML - Absolute
// Regel 3). LIVE traegt zusaetzlich data-wing, den Hook, ueber den call.html
// den Status per Klassenwechsel spiegelt (updateWingForStatus).
function wingSpan(extraAttr) {
  return (
    `<span class="wing wing--idle"${extraAttr} aria-hidden="true">` +
    `<span class="wing-inner"><img src="${WING_PNG}" alt="" /></span></span>`
  );
}
export const WING_MARKUP_STATIC = wingSpan("");
export const WING_MARKUP_LIVE = wingSpan(" data-wing");
