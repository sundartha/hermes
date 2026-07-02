// Gemeinsamer Olympus-HUD-Kartenrahmen fuer die 4 Read-only-Widgets (H4:
// agent-status/my-number/calls/calendar) - dieselbe visuelle Sprache wie
// call.html (H3, MUSTER), aber NICHT aus call.html importiert: call.html
// bleibt in dieser Kette unangetastet (ABS_RULES der H4-Phase), behaelt daher
// seine eigene, werte-identische Token-Deklaration. Die 4 Read-only-Widgets
// teilen dieses Fragment wortgleich - EINE Quelle statt 4x derselben ~35
// CSS-Zeilen (G5/S2). widget-catalog.js injiziert es per Platzhalter-Replace
// (withHudCardCss), dasselbe Muster wie WING_CSS/WING_MARKUP (wing-markup.js)
// und WING_ENGINE (wing-canvas-engine.js).
//
// Bewusst NICHT geteilt (bleibt lokal in den einzelnen Widget-Dateien):
// - .rows/.row-k/.row-v (Schluessel/Wert-Zeilen) - nur agent-status.html
//   braucht sie, kein zweiter Konsument. Kollidiert NICHT mit .list .row
//   unten (dort per .list-Scope auf die Listen-Widgets begrenzt, agent-
//   status.html hat keinen .list-Container).
// - .cell[data-field=...] (feldspezifische Farben/Formatierung) -
//   calls.html/calendar.html haben unterschiedliche Felder/Farben, keine
//   wortgleiche Kopie. Die Basis-Regeln .list .row/.list .cell SIND dagegen
//   wortgleich und leben deshalb hier (analog .list, s.u.).
// Werte (Farben/Radien/Ease) sind ABSICHTLICH identisch zu call.html gewaehlt
// (Produkt-weite Konsistenz), die Wing-Groesse (86px) ist H4-spezifisch
// (call.html bleibt bei 112px).
export const HUD_CARD_CSS = `
  :root {
    --color-navy-800:#0f2d52; --color-navy-900:#0a2245; --color-navy-card:#13335c;
    --color-white:#fff;
    --radius-card:22px; --radius-pill:99px;
    --font-sans:"Space Grotesk","Helvetica Neue",Arial,sans-serif;
    --ease:cubic-bezier(0.22,1,0.36,1);
    --wing-size:86px;
    /* Akzent-Lichtfarbe: dieselbe Herleitung/Werte wie call.html (aufgehellte
       Stufe von navy-700 fuer dunkle Karten, PLAN-WIDGET-HERMES-REDESIGN.md
       Abschnitt 3) - NUR fuer Glow/Ring/Border/aktive Badges, nie als
       Flaechenfarbe. */
    --color-accent-light:#5ea1e0;
    --color-accent-light-strong:#8ec2ee;
    --color-accent-light-rgb:94,161,224;
    --color-accent-light-glow:rgba(var(--color-accent-light-rgb),.5);
    --wing-glow-filter:drop-shadow(0 0 16px var(--color-accent-light-glow)) drop-shadow(0 2px 8px rgba(3,10,24,.6));
  }
  body{margin:0;font-family:var(--font-sans);color:var(--color-white);background:transparent}
  .card{
    position:relative;max-width:min(480px,100%);padding:22px 24px 18px;
    border-radius:var(--radius-card);overflow:hidden;
    background:
      radial-gradient(120% 90% at 50% -10%, rgba(var(--color-accent-light-rgb),.14) 0%, rgba(var(--color-accent-light-rgb),0) 55%),
      linear-gradient(165deg, var(--color-navy-card) 0%, var(--color-navy-800) 42%, var(--color-navy-900) 100%);
    border:1px solid rgba(var(--color-accent-light-rgb),.26);
    box-shadow:
      0 1px 0 rgba(255,255,255,.06) inset,
      0 22px 44px -20px rgba(3,10,24,.7),
      0 0 48px -18px var(--color-accent-light-glow);
  }
  .card::after{
    /* feines Scanline-Overlay wie call.html - rein dekorativ, keine Animation
       (kein reduced-motion-Bezug noetig). */
    content:"";position:absolute;inset:0 0 auto 0;height:150px;
    background:repeating-linear-gradient(to bottom, rgba(255,255,255,.025) 0px, rgba(255,255,255,.025) 1px, transparent 1px, transparent 3px);
    pointer-events:none;
    mask-image:linear-gradient(to bottom, rgba(0,0,0,.8), transparent);
  }
  .eyebrow{position:relative;z-index:1;font-size:10.5px;letter-spacing:.2em;
    text-transform:uppercase;color:rgba(255,255,255,.55);font-weight:600}
  .hero{position:relative;z-index:1;display:flex;flex-direction:column;
    align-items:center;gap:8px;padding:14px 0 18px;text-align:center}
  /* Fester Platz fuer den Wing (86x86) - reserviert unabhaengig davon, ob die
     Canvas-Engine oder die CSS-WingMark aktiv ist (kein reportSize-Jank,
     Kritik R9, Muster call.html .ring-wrap). */
  .wing-wrap{position:relative;width:var(--wing-size);height:var(--wing-size);
    display:grid;place-items:center;flex-shrink:0}
  .wing-canvas-mount{position:absolute;inset:0;display:flex;align-items:center;
    justify-content:center;pointer-events:none}
  .wing-canvas-mount canvas{filter:var(--wing-glow-filter)}
  .phase{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.5)}
  .hero-title{font-size:16px;font-weight:600;color:rgba(255,255,255,.94)}
  /* Objekt-Listen-Wrapper (calls.html/calendar.html) + Basis-Regeln fuer die
     von renderRows() erzeugten Kind-Elemente (widget-bind.js: ROW_CLASS=row,
     CELL_CLASS=cell, DOM ist .list > .row > .cell) - wortgleich zwischen
     calls.html und calendar.html, deshalb hier EINE Quelle statt 2x Kopie
     (G5/S2). Mit .list gescoped, damit diese Basis-Regeln NICHT mit dem
     andersartigen .row in agent-status.html kollidieren (dort .rows > .row-k/
     .row-v, kein .list-Container - s. Kommentar oben). Die feldspezifischen
     [data-field=...]-Overrides bleiben lokal in calls.html/calendar.html. */
  .list{position:relative;z-index:1;display:flex;flex-direction:column}
  .list .row{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;
    padding:11px 2px;border-top:1px solid rgba(255,255,255,.09)}
  .list .row:first-child{border-top:1px solid rgba(255,255,255,.16)}
  .list .cell{color:rgba(255,255,255,.85)}
  .foot{position:relative;z-index:1;display:flex;align-items:center;
    justify-content:space-between;margin-top:14px;padding-top:12px;
    border-top:1px solid rgba(255,255,255,.12);font-size:11px;color:rgba(255,255,255,.4)}
`;
