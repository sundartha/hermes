# Phase 3 — Render (Remotion + FFmpeg)

Diese Komposition rendert den finalen `.mp4` aus einem **Render-Plan** (dem JSON,
das das Studio exportiert).

## Einrichten (einmalig)

Remotion bringt einen eigenen, schweren Stack mit (React + Chromium-Renderer).
Bewusst getrennt vom Vite-Studio, damit das Studio leicht bleibt.

```bash
cd apps/hermes-studio
npm i -D remotion @remotion/cli react react-dom @types/react @types/react-dom
# hermes-wing.png liegt schon in public/ und wird via staticFile() genutzt
```

## Vorschau im Remotion-Studio

```bash
npx remotion studio remotion/index.ts
```

## Final rendern

1. Im Studio (`npm run dev`) ein Format wählen, Inhalt eintragen, **Render-Plan
   als JSON kopieren**, als `plan.json` speichern.
2. Higgsfield-Clip erzeugen (CLI/MCP) und die `clipUrl` im `plan.json` eintragen.
3. Rendern:

```bash
npx remotion render remotion/index.ts HermesReel out/reel.mp4 \
  --props=./plan.json
```

FFmpeg ist in Remotion enthalten — kein separater Schnitt nötig. Ergebnis:
`out/reel.mp4` im 9:16-Markenlook mit Flügel-Akzent und Untertiteln.
