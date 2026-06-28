import React from "react";
import { WING_PNG } from "./wing-image.js";

/**
 * WingMark — the Hermes wing, the system's constant brand element (after the
 * winged messenger Hermes). One feathered wing, animated by `status` to mirror
 * the states of the Hermes animation lab:
 *
 *  - idle        perpetual low-amplitude hover (drift + sway + soft bob)
 *  - connecting  two cautious beats, then a pause — "reaching the line"
 *  - working     continuous rhythmic flapping — placing / on the call
 *  - success     a single upward snap with overshoot, settles to rest
 *  - error       a short stutter, then the wing droops (lift lost)
 *
 * Pure CSS so it is portable across every surface; honours
 * `prefers-reduced-motion`. The wing pivots about its root (lower-left), so
 * rotation reads as a flap around the shoulder.
 */
let injected = false;
function ensureKeyframes() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-hermes-wing", "");
  el.textContent = `
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
}
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
}
@media (prefers-reduced-motion: reduce) {
  .hermes-wing, .hermes-wing * { animation: none !important; }
}`;
  document.head.appendChild(el);
}

const INNER_ANIM = {
  idle:       "hermesWingBob 3.9s ease-in-out infinite",
  connecting: "hermesWingConnect 1.9s ease-in-out infinite",
  working:    "hermesWingFlap 0.52s ease-in-out infinite",
  success:    "hermesWingSuccess 0.95s cubic-bezier(.2,1.1,.3,1) 1 forwards",
  error:      "hermesWingError 0.9s ease-out 1 forwards",
};

export function WingMark({
  size = 56,
  status = "idle",
  float = true,
  shadow = true,
  alt = "Hermes wing",
  style,
  ...rest
}) {
  ensureKeyframes();
  const st = INNER_ANIM[status] ? status : "idle";

  const outer = {
    display: "inline-block",
    width: `${size}px`,
    height: `${size}px`,
    transformOrigin: "26% 86%",
    animation: float && st === "idle" ? "hermesWingDrift 6.8s ease-in-out infinite" : "none",
    willChange: "transform",
    ...style,
  };
  const inner = {
    display: "block",
    width: "100%",
    height: "100%",
    transformOrigin: "26% 86%",
    animation: INNER_ANIM[st],
  };
  // The wing glows a touch warmer while it is actively on the line.
  const active = st === "working" || st === "connecting";
  const img = {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
    filter: shadow
      ? `drop-shadow(0 3px 10px rgba(7,18,40,.32))${active ? " brightness(1.06)" : ""}`
      : "none",
    transition: "filter .3s ease",
    userSelect: "none",
  };

  return (
    <span className="hermes-wing" style={outer} {...rest}>
      <span key={st} style={inner}>
        <img src={WING_PNG} alt={alt} style={img} draggable={false} />
      </span>
    </span>
  );
}
