// Gemeinsame Wing-Marke fuer ALLE Hermes-Widgets: EINE Quelle fuer das
// WING_PNG-Data-URI (Laufzeit-Kopie in wing-image-data.js, synchron zu
// design-system/components/brand/wing-image.js, der Autoring-Quelle - src/
// importiert NICHT direkt aus design-system/, siehe dortiger Kommentar) und
// die CSS-Regeln/-Keyframes, die die WingMark-Zustaende (idle/connecting/
// working/success/error, siehe WingMark.jsx) auf reinem CSS abbilden.
// widget-catalog.js fuegt beides per Platzhalter-Replace beim Laden ein
// (withWingAssets) - dasselbe Muster wie BIND_SCRIPT (G5/S2, eine Quelle statt
// Copy-Paste in 5 Dateien).
//
// Zwei Auspraegungen, damit die 3 Read-only-Widgets (kein Anruf-Lebenszyklus)
// nicht die ungenutzten State-Keyframes mitschleppen (sonst toter Code):
// - STATIC: nur idle (Drift + Bob) - agent-status/calls/my-number (calendar
//   entfallen seit T2-12)
// - LIVE: idle + alle vier Anruf-Status - call.html, Statuswechsel per
//   Klassenwechsel auf [data-wing] (siehe dortiges Inline-Skript)
import { WING_PNG } from "./wing-image-data.js";

// Basis-Layout + idle-Animation - in JEDER Auspraegung gleich. Kein Fuehrungs-
// Leerzeichen auf der ersten Zeile: der Aufrufer (withWingAssets) ersetzt
// einen bereits eingerueckten Platzhalter, die erste Zeile erbt dessen
// Einrueckung. Der navy Rundungs-Grund ist notwendig, nicht dekorativ: WING_PNG
// ist ein weisser Wing auf transparentem Grund (fuer den dunklen Hero gedacht,
// design-system/README.md "Logo/brand mark") - ohne dunklen Untergrund waere er
// auf der hellen Widget-Karte fast unsichtbar (empirisch im Browser gefunden).
const WING_BASE_CSS = `.wing{display:inline-flex;align-items:center;justify-content:center;
        width:var(--wing-size);height:var(--wing-size);border-radius:50%;
        background:radial-gradient(120% 120% at 30% 0%,var(--color-navy-700) 0%,var(--color-navy-800) 72%);
        transform-origin:26% 86%;flex-shrink:0}
  .wing-inner{display:block;width:62%;height:62%;transform-origin:26% 86%}
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

// Dunkle Auspraegung (H2, Olympus-HUD-Karte): weisser Wing OHNE navy Rundmarke.
// Der navy Rundungs-Grund in WING_BASE_CSS ist Sichtbarkeits-Mittel fuer HELLE
// Karten (s.o.) - auf der volldunklen Karte waere er navy-auf-navy unsichtbar
// (Regression von Commit 0dca7ce). Alles andere (Groesse, Transform-Origin,
// Keyframes) bleibt identisch - nur der Hintergrund entfaellt.
const WING_DARK_OVERRIDE_CSS = `
  .wing--dark{background:none}`;

export const WING_CSS_STATIC = WING_BASE_CSS + WING_IDLE_KEYFRAMES + WING_REDUCED_MOTION_CSS;
export const WING_CSS_LIVE =
  WING_BASE_CSS + WING_STATE_CSS + WING_IDLE_KEYFRAMES + WING_STATE_KEYFRAMES + WING_REDUCED_MOTION_CSS;
export const WING_CSS_DARK_STATIC =
  WING_BASE_CSS + WING_DARK_OVERRIDE_CSS + WING_IDLE_KEYFRAMES + WING_REDUCED_MOTION_CSS;
export const WING_CSS_DARK_LIVE =
  WING_BASE_CSS + WING_DARK_OVERRIDE_CSS + WING_STATE_CSS + WING_IDLE_KEYFRAMES +
  WING_STATE_KEYFRAMES + WING_REDUCED_MOTION_CSS;

// Ein <span> mit zwei verschachtelten Wrappern + statischem <img> (kein
// innerHTML - Absolute Regel 3). `live` haengt data-wing an (Hook fuer
// call.html/updateWingForStatus). `dark` haengt die Modifier-Klasse wing--dark
// an (zieht WING_DARK_OVERRIDE_CSS). Unabhaengige Datenpunkte statt ein
// boolesches Verzweigungs-Flag-Argument (G15) - die vier Kombinationen sind
// vier benannte Exporte, kein Aufrufparameter im Widget-Code.
function wingSpan({ dark = false, live = false } = {}) {
  const cls = "wing" + (dark ? " wing--dark" : "") + " wing--idle";
  const attr = live ? " data-wing" : "";
  return (
    `<span class="${cls}"${attr} aria-hidden="true">` +
    `<span class="wing-inner"><img src="${WING_PNG}" alt="" /></span></span>`
  );
}
export const WING_MARKUP_STATIC = wingSpan();
export const WING_MARKUP_LIVE = wingSpan({ live: true });
export const WING_MARKUP_DARK_STATIC = wingSpan({ dark: true });
export const WING_MARKUP_DARK_LIVE = wingSpan({ dark: true, live: true });
