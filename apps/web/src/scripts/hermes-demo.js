/* =============================================================================
 * hermes-demo.js — Steuerung der Erklär-Animation
 *
 * Die Animation selbst läuft vollständig über CSS-Keyframes (hermes-demo.css).
 * Dieses Modul macht nur drei Dinge:
 *   1. Pause-Taste  → data-paused umschalten (CSS pausiert alles).
 *   2. Scrub-Leiste → an eine Stelle der 76s-Schleife springen.
 *   3. Kopier-Knöpfe für MCP-Adresse und Terminal-Befehl.
 *
 * Alles per CSSOM (setProperty / setAttribute) — Style-ATTRIBUTE im
 * HTML-Quelltext wären unter der Produktions-CSP blockiert, CSSOM ist es nicht.
 * ========================================================================== */

const LOOP = 76; // Sekunden — muss zur animation-duration in hermes-demo.css passen

function initStage(stage) {
  const track = stage.querySelector("[data-hd-track]");
  const pauseBtn = stage.querySelector("[data-hd-pause]");
  let paused = false;
  let at = 0;

  const setPaused = (next) => {
    paused = next;
    stage.setAttribute("data-paused", paused ? "1" : "0");
    if (pauseBtn) {
      pauseBtn.textContent = paused ? "▶" : "❙❙";
      pauseBtn.setAttribute("aria-pressed", String(paused));
    }
  };

  /* Absolut springen statt nur den Verzug zu verschieben: sobald die Schleife
   * läuft, wäre ein geänderter animation-delay bloß relativ. Über die
   * Animationsobjekte ist die Stelle exakt. */
  const seek = (ratio) => {
    at = Math.max(0, Math.min(0.9999, ratio));
    stage.style.setProperty("--hd-t", "0s");
    if (!stage.getAnimations) return;
    const ms = at * LOOP * 1000;
    for (const anim of stage.getAnimations({ subtree: true })) {
      const timing = anim.effect && anim.effect.getTiming();
      if (timing && timing.duration === LOOP * 1000) {
        try {
          anim.currentTime = ms;
        } catch {
          /* Manche Animationen sind noch nicht bereit — die zieht der nächste
             Frame ohnehin nach. */
        }
      }
    }
    if (track) track.setAttribute("aria-valuenow", String(Math.round(at * 100)));
  };

  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => setPaused(!paused));
  }

  if (track) {
    const ratioFrom = (event) => {
      const rect = track.getBoundingClientRect();
      return (event.clientX - rect.left) / Math.max(1, rect.width);
    };

    track.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const wasPaused = paused;
      setPaused(true);
      seek(ratioFrom(event));
      try {
        track.setPointerCapture(event.pointerId);
      } catch {
        /* Ohne Pointer-Capture funktioniert das Ziehen im Rahmen trotzdem. */
      }
      const move = (ev) => seek(ratioFrom(ev));
      const up = () => {
        track.removeEventListener("pointermove", move);
        track.removeEventListener("pointerup", up);
        track.removeEventListener("pointercancel", up);
        if (!wasPaused) setPaused(false);
      };
      track.addEventListener("pointermove", move);
      track.addEventListener("pointerup", up);
      track.addEventListener("pointercancel", up);
    });

    // Mit der Tastatur in 5%-Schritten, damit die Leiste nicht nur mit der
    // Maus bedienbar ist.
    track.addEventListener("keydown", (event) => {
      const step =
        event.key === "ArrowRight" ? 0.05 : event.key === "ArrowLeft" ? -0.05 : 0;
      if (!step) return;
      event.preventDefault();
      setPaused(true);
      seek(at + step);
    });
  }

  // Die Marken der Aktwechsel: ihre Position steht im Markup, gesetzt wird sie
  // hier (ein style-Attribut im HTML wäre CSP-blockiert).
  for (const tick of stage.querySelectorAll("[data-hd-tick]")) {
    tick.style.left = tick.dataset.hdTick;
  }

  /* Die Bühne kennt die Höhe ihrer Fussleiste nicht — die Akte brauchen sie
   * aber, um darüber zu enden statt darunter zu verschwinden. */
  const foot = stage.querySelector(".hd-foot");
  const measure = () => {
    if (foot) stage.style.setProperty("--hd-foot", Math.round(foot.offsetHeight) + "px");
  };
  measure();
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    if (foot) ro.observe(foot);
  } else {
    window.addEventListener("resize", measure);
  }

  // Läuft die Bühne unsichtbar (mobiles Blatt geschlossen), kostet sie nur
  // Rechenzeit. Sichtbarkeit steuert darum, ob die Schleife arbeitet.
  if (window.IntersectionObserver) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!paused) stage.setAttribute("data-paused", entry.isIntersecting ? "0" : "1");
        }
      },
      { threshold: 0.05 }
    );
    io.observe(stage);
  }
}

function initCopy(root) {
  for (const btn of root.querySelectorAll("[data-hd-copy]")) {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const label = btn.textContent;
      try {
        await navigator.clipboard.writeText(btn.dataset.hdCopy);
      } catch {
        /* Ohne Zwischenablage-Recht bleibt der Text trotzdem lesbar. */
      }
      btn.textContent = btn.dataset.hdCopied || "✓";
      setTimeout(() => {
        btn.textContent = label;
      }, 1800);
    });
  }
}

function init() {
  for (const stage of document.querySelectorAll("[data-hd-stage]")) {
    initStage(stage);
    initCopy(stage);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
