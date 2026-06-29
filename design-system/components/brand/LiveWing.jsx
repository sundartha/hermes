import React from "react";
import { WING_PNG } from "./wing-image.js";

/**
 * LiveWing — the REAL Hermes wing: a deformable Pixi mesh (the engine ported
 * from the animation lab), driven through the MCP call lifecycle by `status`.
 * Unlike WingMark (a lightweight CSS logo for static spots), this articulates
 * every feather — flap, bend, tip-lag, lift — so `working` looks like genuine
 * flight and `success` snaps with elastic overshoot.
 *
 * Requires the engine script on the page:
 *   <script src="<path>/components/brand/wing-engine.js"></script>
 * (it lazy-loads pixi.js + GSAP from a CDN on first mount). Use LiveWing where
 * the motion is the point — the chat status beacon — not for tiny logos.
 */
function whenEngine(cb) {
  if (window.HermesWingEngine) return cb();
  const t = setInterval(() => {
    if (window.HermesWingEngine) { clearInterval(t); cb(); }
  }, 50);
  return () => clearInterval(t);
}

export function LiveWing({ size = 180, status = "idle", preset = "classic", style, ...rest }) {
  const hostRef = React.useRef(null);
  const ctrlRef = React.useRef(null);

  React.useEffect(() => {
    let alive = true;
    const host = hostRef.current;
    const cancel = whenEngine(() => {
      if (!alive || !host) return;
      window.HermesWingEngine
        .mount(host, { size, status, preset, textureUrl: WING_PNG })
        .then((ctrl) => {
          if (!alive) { ctrl.destroy(); return; }
          ctrlRef.current = ctrl;
        })
        .catch((e) => console.error("LiveWing mount failed", e));
    });
    return () => {
      alive = false;
      if (cancel) cancel();
      if (ctrlRef.current) { ctrlRef.current.destroy(); ctrlRef.current = null; }
      if (host) host.innerHTML = "";
    };
    // Re-mount only when geometry-level inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, preset]);

  React.useEffect(() => {
    if (ctrlRef.current) ctrlRef.current.setStatus(status);
  }, [status]);

  return (
    <div
      ref={hostRef}
      style={{ width: size, height: size, display: "inline-block", lineHeight: 0, ...style }}
      {...rest}
    />
  );
}
