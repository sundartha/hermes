# Hermes Animation Lab

Isolierte Dev-Umgebung fuer die Hermes-Fluegel-Animation. **PixiJS 8** (Mesh-Deformation)
+ **GSAP** (Timing/Status) + **Vite/TypeScript**. Eigenes Paket mit eigener Lockfile —
beruehrt den MCP-Server (`src/`) und das Marketing-Site (`apps/web`) nicht und wird nicht deployt.

## Start

```bash
cd apps/hermes-animation-lab
npm install
npm run dev          # http://127.0.0.1:5173
```

Weitere Skripte: `npm run typecheck`, `npm run build`, `npm run preview`.

## Markenelement / Transparenz-Befund

Asset: `public/hermes-wing.png` — 500x500, **echtes RGBA mit Alpha** (≈71% transparent,
1% weiche Kanten, alle Ecken alpha=0). Die sichtbare Fluegelform liegt bei x[97..404] y[21..455].

> Historie: Die erste gelieferte Datei war zwar RGBA, aber **zu 100% opak** (weisser Fluegel auf
> nahezu weissem Hintergrund) — eine verlustfreie Freistellung war unmoeglich. Der Owner hat daraufhin
> eine sauber freigestellte transparente Version nachgeliefert; diese wird hier verwendet.

Es existiert immer **genau eine** Fluegelgrafik: eine Textur auf einem zusammenhaengenden Mesh.
Keine Klone, Spiegelungen, Ghosts, Trails, Afterimages oder zweiten Ebenen. Mehrere Vorschau-Kacheln
sind je eine eigenstaendige Einzel-Instanz (geteilte Textur im Speicher).

## Animationsmodell

`HermesMotionState` (siehe `src/types.ts`) wird von GSAP animiert; `src/wing/deform.ts` berechnet
jeden Frame deterministisch aus der **unveraenderten Originalgeometrie** neue Vertex-Positionen,
gewichtet zur Fluegelwurzel (Root ~ keine Bewegung, lange Aussenfedern am staerksten, Spitzen mit
verzoegertem `tipLag`). Kein Zufall, kein Akkumulieren — bei Ruhe ist das Mesh exakt das Original.

Der Kanal `lift` hebt zusaetzlich den **ganzen** Fluegel als Gesamt-Versatz (nicht pro Vertex,
siehe `HermesWing.applyState`): der kraeftige Abschlag erzeugt sichtbaren Auftrieb, der Fluegel
schwebt oben aus und sinkt langsam zurueck — getragener Flug statt reinem Klappen.

Drei Presets (`src/wing/presets.ts`): **A Hermes Classic**, **B Rapid Messenger**, **C Premium UI**.

## Status-API (vorbereitet, noch nicht an MCP verdrahtet)

```ts
type HermesStatus = "idle" | "connecting" | "working" | "success" | "error";
window.setHermesStatus("working");
```

`src/wing/status.ts` haelt **genau eine** aktive Timeline; jeder Wechsel killt die alte sauber
(kein Overlap). `idle` ist ein sehr sanftes Dauer-Schweben (kleine `lift`/`flap`-Amplitude, langsames
yoyo) — die geflügelte Sandale flattert auch in Ruhe leise. Unter `prefers-reduced-motion` bleibt der
Fluegel statisch (idle wird beim Boot nicht abgespielt).

## Performance / A11y

`prefers-reduced-motion` → statischer Fluegel. Rendering stoppt ausserhalb des Viewports
(IntersectionObserver) und bei verborgenem Tab (visibilitychange). DPR auf 2 begrenzt. Teardown
zerstoert Renderer + Timelines vollstaendig.

## Keypose-Screenshots (Review)

`scripts/capture-keyposes.mjs` faehrt die drei Presets ueber `window.hermesLab` deterministisch an
und speichert die Keyposes nach `artifacts/hermes-animation-review/`. Benoetigt Playwright
(on-demand, **nicht** in `package.json`): siehe Kommentar im Skript.
