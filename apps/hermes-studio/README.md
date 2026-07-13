# Hermes Studio

Lokales Film-Studio für die Social-Media-Videos des Calling-Agenten.
**Higgsfield = Kamera**, **Hermes-Flügel-Overlay (PixiJS/GSAP) = Veredelung**,
**Remotion/FFmpeg = Schnitt & Export.** Eigenes Paket, deployt nicht, berührt
den MCP-Server nicht und verwendet den echten Flügel aus `../hermes-animation-lab` wieder.

## Start

```bash
cd apps/hermes-studio
npm install
npm run dev          # http://127.0.0.1:5180
```

Im Browser: **Format wählen → Inhalt eintragen → Story abspielen** (der Flügel
fährt den Anruf-Lebenszyklus ab) → **Render-Plan als JSON kopieren**.

## Module

| Ordner | Rolle |
|---|---|
| `src/brand/bibel.ts` + `STUDIO-BIBEL.md` | Studio-Bibel — die eine Quelle des Marken-Looks |
| `src/generate/formats.ts` | Feste Formate (Founder Talk, Problem→Lösung, Live-Demo) |
| `src/generate/higgsfield.ts` | Higgsfield-Job-Builder (Marketing-Studio-Parameter, CLI-Befehl) |
| `src/overlay/StudioStage.ts` | Flügel-Overlay (WingApp wiederverwendet) + Status-Bogen |
| `src/compose/renderPlan.ts` | Produktionsauftrag als JSON (Schnittstelle zu Phase 3) |
| `remotion/` | Phase 3 — finaler `.mp4`-Render (eigener Stack, siehe remotion/README.md) |

## Voller Ablauf (end-to-end) — ein Klick

Ab jetzt läuft die ganze Kette im Studio, ohne Terminal-Gefummel:

1. **Studio + Bridge starten:** `npm start` (Studio :5180 + Bridge :5181).
2. Format + Inhalt wählen → **„Video generieren (live)"** (Higgsfield macht den Clip).
3. **„Fertiges Reel rendern (MP4)"** klicken → Bridge ruft Remotion, legt Flügel +
   Untertitel drauf, rendert das fertige 9:16-MP4.
4. Das Reel erscheint direkt in der Vorschau; **„Fertiges Reel herunterladen"** speichert es.

> Technisch: der „Rendern"-Knopf schickt den Render-Plan an `POST /api/render` im
> Bridge-Server (`server.mjs`). Der ruft die lokale Remotion-Binary, schreibt das MP4
> nach `out/` und liefert es unter `/out/…` aus. Der manuelle Weg (unten) geht weiter.

### Manuell (optional, für Feintuning)

1. Render-Plan im Studio als JSON kopieren, als `plan.json` speichern.
2. Clip-URL im Plan setzen.
3. `npx remotion render remotion/index.ts HermesReel out/reel.mp4 --props=./plan.json`.

## Was bewusst NICHT enthalten ist

- **Kein API-Key im Browser.** `submitJob()` ist eine markierte Integrationsnaht.
  Generierung läuft über CLI/MCP (kostet Higgsfield-Credits) — nicht heimlich aus dem Studio.
- **Kein CapCut/Premiere-Klon.** Bewusst ein fokussiertes Marken-Studio:
  Format rein, Marke drauf, Reel raus.

## Defaults zum Anpassen

Alle Marken-Defaults (Farben, Gold-Stärke, Format, Tonalität) habe ich autonom
gesetzt. Sie liegen in `src/brand/bibel.ts` — eine Datei ändern, ganzes Studio zieht mit.

---

## Live-Modus (echte Videos mit deinem Higgsfield-Account)

Das Studio generiert über einen **lokalen Bridge-Server** (`server.mjs`), der die
Higgsfield-CLI mit deinem Login ausführt. Kein API-Key im Browser.

**Einmalig — dein Account verbinden:**

```bash
higgsfield auth login          # öffnet den Browser, du loggst dich ein
higgsfield workspace list      # zeigt deine Workspaces
higgsfield workspace set <id>  # Abrechnungs-Workspace wählen
```

**Studio + Bridge zusammen starten:**

```bash
npm start        # Studio (5180) + Bridge (5181) parallel
```

Im Studio zeigt die Statuszeile oben „Higgsfield verbunden ✓". Dann:
Format wählen → Inhalt tippen → **„Video generieren (live)"**. Der Clip
(1–5 Min.) erscheint automatisch in der Vorschau und im Render-Plan.

> Ohne `npm start` (nur `npm run dev`) fehlt die Bridge — dann nur Vorschau/Plan,
> keine echte Generierung.
