export const HUD_CARD_CSS = `
  :root {
    --color-night:#15130f; --color-card:#201d18; --color-card-2:#2a2620;
    --color-white:#f2ece3;
    --color-on-night-2:#e8e0d4; --color-on-night-3:#d6ccbd; --color-on-night-4:#b9af9f;
    --color-line-rgb:242,236,227;
    --font-serif:"Instrument Serif",Georgia,serif;
    --radius-card:22px; --radius-pill:99px;
    --font-sans:"Space Grotesk",system-ui,sans-serif;
    --ease:cubic-bezier(0.22,1,0.36,1);
    --wing-size:86px;
    --color-accent-light:#c8a673;
    --color-accent-light-strong:#c8a673;
    --color-accent-light-rgb:200,166,115;
    --color-accent-light-glow:rgba(var(--color-accent-light-rgb),.5);
    --wing-glow-filter:drop-shadow(0 0 16px var(--color-accent-light-glow)) drop-shadow(0 2px 8px rgba(21,19,15,.6));
  }
  body{margin:0;width:fit-content;font-family:var(--font-sans);color:var(--color-white);background:transparent}
  .card{
    position:relative;box-sizing:border-box;width:min(530px,100vw);padding:22px 24px 18px;
    border-radius:var(--radius-card);overflow:hidden;
    background:
      radial-gradient(120% 90% at 50% -10%, rgba(var(--color-accent-light-rgb),.08) 0%, rgba(var(--color-accent-light-rgb),0) 55%),
      linear-gradient(165deg, var(--color-card-2) 0%, var(--color-card) 42%, var(--color-night) 100%);
    border:1px solid rgba(var(--color-accent-light-rgb),.26);
    box-shadow:0 1px 0 rgba(var(--color-line-rgb),.06) inset;
  }
  .card::after{
    /* feines Scanline-Overlay wie call.html - rein dekorativ, keine Animation
       (kein reduced-motion-Bezug noetig). */
    content:"";position:absolute;inset:0 0 auto 0;height:150px;
    background:repeating-linear-gradient(to bottom, rgba(var(--color-line-rgb),.025) 0px, rgba(var(--color-line-rgb),.025) 1px, transparent 1px, transparent 3px);
    pointer-events:none;
    mask-image:linear-gradient(to bottom, rgba(0,0,0,.8), transparent);
  }
  .eyebrow{position:relative;z-index:1;font-size:10.5px;letter-spacing:.2em;
    text-transform:uppercase;color:var(--color-on-night-4);font-weight:600}
  .hero{position:relative;z-index:1;display:flex;flex-direction:column;
    align-items:center;gap:8px;padding:14px 0 18px;text-align:center}
  /* Fester Platz fuer den Wing (86x86) - reserviert unabhaengig davon, ob die
     Canvas-Engine oder die CSS-WingMark aktiv ist (kein reportSize-Jank,
     Muster call.html .ring-wrap). */
  .wing-wrap{position:relative;width:var(--wing-size);height:var(--wing-size);
    display:grid;place-items:center;flex-shrink:0}
  .wing-canvas-mount{position:absolute;inset:0;display:flex;align-items:center;
    justify-content:center;pointer-events:none}
  .wing-canvas-mount canvas{display:block}
  .phase{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--color-on-night-4)}
  .hero-title{font-family:var(--font-serif);font-size:22px;font-weight:400;color:var(--color-white)}
  /* Objekt-Listen-Wrapper (calls.html) + Basis-Regeln fuer die von
     renderRows() erzeugten Kind-Elemente (widget-bind.js: ROW_CLASS=row,
     CELL_CLASS=cell, DOM ist .list > .row > .cell) - hier als EINE Quelle
     statt lokal dupliziert (G5/S2). Mit .list gescoped, damit diese
     Basis-Regeln NICHT mit dem andersartigen .row in agent-status.html
     kollidieren (dort .rows > .row-k/.row-v, kein .list-Container - s.
     Kommentar oben). Die feldspezifischen [data-field=...]-Overrides
     bleiben lokal in calls.html. */
  .list{position:relative;z-index:1;display:flex;flex-direction:column}
  .list .row{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;
    padding:11px 2px;border-top:1px solid rgba(var(--color-line-rgb),.09)}
  .list .row:first-child{border-top:1px solid rgba(var(--color-line-rgb),.16)}
  .list .cell{color:var(--color-on-night-2)}
  .foot{position:relative;z-index:1;display:flex;align-items:center;
    justify-content:space-between;margin-top:14px;padding-top:12px;
    border-top:1px solid rgba(var(--color-line-rgb),.12);font-size:11px;color:var(--color-on-night-4)}

  .w{--bg:#15130f;--fg:#f2ece3;--fg2:#b9af9f;--line2:#746b5e;--accent:#c8a673;--hair:rgba(242,236,227,.13);--glass:rgba(21,19,15,.46);--glass2:rgba(242,236,227,.10);--rim:rgba(255,255,255,.26);--rim2:rgba(255,255,255,.07);--shade:rgba(0,0,0,.45);--ga:rgba(200,166,115,.55);--gb:rgba(168,96,88,.42);--gc:rgba(70,92,104,.40);--wingf:none}
  @media (prefers-color-scheme:light){
    .w{--bg:#e8e0d4;--fg:#1e1b17;--fg2:#4a433b;--line2:#8c8273;--accent:#76592f;--hair:rgba(30,27,23,.12);--glass:rgba(255,255,255,.44);--glass2:rgba(255,255,255,.5);--rim:rgba(255,255,255,.95);--rim2:rgba(255,255,255,.35);--shade:rgba(74,60,40,.22);--ga:rgba(200,166,115,.6);--gb:rgba(196,140,128,.4);--gc:rgba(255,255,255,.9);--wingf:invert(.9)}
  }
  .w{position:relative;isolation:isolate;overflow:hidden;width:min(530px,100vw);box-sizing:border-box;padding:24px 24px 12px;border-radius:36px;display:flex;flex-direction:column;background:var(--bg);color:var(--fg);font-family:var(--font-sans)}
  .w>*{position:relative;z-index:1}
  .w h1{margin:0;font-family:var(--font-serif);font-weight:400;font-size:44px;line-height:46px;letter-spacing:-0.01em;text-wrap:balance;overflow-wrap:anywhere}
  .w h1 em{white-space:nowrap}
  .rimcard{position:absolute;inset:0;z-index:3;border-radius:inherit;pointer-events:none;box-shadow:inset 0 1px 0 var(--rim),inset 0 0 0 1px var(--rim2)}
  .szene{position:absolute;inset:0;z-index:0}
  .glow{position:absolute;border-radius:50%;filter:blur(48px);pointer-events:none;transition:opacity 1.2s ease}
  @keyframes driftA{from{transform:translate(0,0)}to{transform:translate(-26px,18px)}}
  @keyframes driftB{from{transform:translate(0,0)}to{transform:translate(22px,-16px)}}
  .ga{background:var(--ga);animation:driftA 17s ease-in-out infinite alternate}
  .gb{background:var(--gb);animation:driftB 23s ease-in-out infinite alternate}
  .gc{background:var(--gc);animation:driftA 29s ease-in-out infinite alternate-reverse}
  .sheet{margin:0 -12px;border-radius:24px;background:var(--glass);-webkit-backdrop-filter:blur(26px) saturate(1.5);backdrop-filter:blur(26px) saturate(1.5);box-shadow:inset 0 1px 0 var(--rim),inset 0 0 0 1px var(--rim2),0 18px 36px -18px var(--shade)}
  .lens{background:var(--glass2);-webkit-backdrop-filter:blur(14px) saturate(1.7);backdrop-filter:blur(14px) saturate(1.7);box-shadow:inset 0 1px 0 var(--rim),inset 0 -1px 0 var(--rim2),inset 0 0 0 1px var(--rim2)}
  .marke{display:flex;align-items:center;gap:8px}
  .marke b{font-size:13px;font-weight:600;letter-spacing:.12em;text-transform:uppercase}
  .w .wing-wrap{filter:var(--wingf)}
  .klein .wing-wrap{--wing-size:48px;margin-left:-6px}
  .klein h1{margin-top:20px}
  @keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
  .rise{animation:rise .7s cubic-bezier(.22,1,.36,1) both}
  .d1{animation-delay:.09s}.d2{animation-delay:.18s}.d3{animation-delay:.27s}.d4{animation-delay:.36s}
  .zeile{display:grid;grid-template-columns:var(--spalte,112px) minmax(0,1fr);column-gap:16px;padding:12px 0}
  .zeile>:first-child{margin:0;font-size:13px;line-height:21px;color:var(--fg2)}
  .zeile>:last-child{margin:0;font-size:15px;line-height:21px;color:var(--fg);overflow-wrap:anywhere}
  @media (prefers-reduced-motion:reduce){.rise,.glow{animation:none !important}.glow{transition:none}}
`;
