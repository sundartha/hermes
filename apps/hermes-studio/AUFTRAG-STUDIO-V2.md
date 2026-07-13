# AUFTRAG: Hermes Studio v2 — Studio ohne Oberfläche

**Von:** Antonio (via Berater-Claude) · **Für:** Claude Code · **Datum:** 2026-07-03

## Ziel
Die HTML-Bedienoberfläche (Vite/index.html) wird abgeschafft. Claude Code IST das Studio:
Antonio sagt in normaler Sprache z. B. „Mach mir ein 15-Sekunden-Founder-Talk-Reel:
Agent übernimmt verpasste Anrufe" — und am Ende liegt ein fertiges MP4 in `out/`.

## Was bleibt, was geht
- **Weg:** Vite-Frontend (index.html, src/-UI, Port 5180). Bleibt im Git-Verlauf.
- **Bleibt (als Herzstück):** die Logik aus `server.mjs` — Higgsfield-Clip-Erzeugung,
  Remotion-Render (`POST /api/render` → wird zu einem CLI-Skript), FFmpeg.
- **Neu:** zwei npm-Skripte statt Oberfläche:
  - `npm run clip -- --prompt "..." --format founder_talk` → Higgsfield-CLI erzeugt Clip, wartet, lädt MP4
  - `npm run reel -- --clip <pfad> --hook "..." --claim "..." --cta "..."` → Remotion rendert fertiges Reel

## Design-Änderung
- Der Hermes-Flügel im Reel wird **weiß/neutral** (helles Weiß bis Hellgrau) statt Gold.
  Der Gold-Farbfilter (#C9A227, ColorMatrixFilter) entfällt bzw. wird durch neutrale
  Tönung ersetzt. Branding-Assets in `Branding/` NICHT verändern — nur die Render-Tönung.

## Technischer Kontext (wichtig, nicht neu erforschen)
- Higgsfield-CLI ist eingeloggt (v1.1.2). Credentials: `~/.config/higgsfield/credentials.json`
  (Format: flaches JSON mit `auth_version: 2`). Workspace ist gesetzt. NICHT `hf auth login`
  ausführen — der Browser-Login hat einen Bug (redirect_uri-Mismatch → „Session expired").
  Details: Memory „higgsfield-cli-login" / Berater-Claude fragen.
- Higgsfield ist aus dem Heimnetz NICHT erreichbar (Router filtert SNI). Clip-Erzeugung
  funktioniert nur im Handy-Hotspot. Skripte sollen bei Netzfehler klar sagen: „Hotspot an?"
- Remotion + FFmpeg sind installiert und getestet (End-to-End verifiziert am 2026-07-02).

## Arbeitsregeln (verbindlich)
1. Erst Plan in einfachem Deutsch vorlegen, auf Antonios Freigabe warten, dann umsetzen.
2. Keine neuen Dependencies ohne Rückfrage.
3. Kleine Git-Commits mit deutschen, laienverständlichen Messages.
4. Jede Änderung in einfachem Deutsch erklären (Antonio schreibt keinen Code).

## Definition of Done
- [ ] `npm run clip` + `npm run reel` funktionieren einzeln und nacheinander
- [ ] Eine CLAUDE.md in diesem Ordner erklärt Claude Code, wie es natürliche Sprache
      („Mach ein Reel über X") in die beiden Skripte übersetzt
- [ ] Flügel ist weiß/neutral im gerenderten Reel
- [ ] Vite-UI entfernt, `npm run dev`/`bridge`/`start` aus package.json bereinigt
- [ ] Ein Test-Reel liegt in `out/` und Antonio hat es abgenommen

---

# AUSBAUSTUFE 2 — Vom Clip-Generator zum Filmstudio

**Wichtig:** Erst umsetzen, wenn Ausbaustufe 1 (oben) fertig und von Antonio
abgenommen ist. Jedes Modul einzeln planen, umsetzen, abnehmen lassen — in dieser
Reihenfolge:

## Modul A — Drehbuch & Schnitt (Mehrszenen-Reels)
- Aus Antonios Thema entsteht zuerst ein Mini-Drehbuch: 3–4 Szenen mit je
  Bildbeschreibung (für Higgsfield) und Text-Einblendung. Antonio gibt das
  Drehbuch frei, BEVOR Clips erzeugt werden (spart Credits).
- Pro Szene ein Higgsfield-Clip; Remotion montiert sie mit Schnittrhythmus
  (Hook schnell, Kernaussage ruhig, CTA klar) zu einem Reel.

## Modul B — Voice-over mit ElevenLabs (strategisch wichtig)
- Die Stimme des CALL-E-Agenten (ElevenLabs, gleiche Stimme wie im Produkt)
  spricht das Reel ein. Die Werbung IST damit die Produkt-Demo.
- ElevenLabs-API-Key nur per Umgebungsvariable, nie in Code/Git.
- Musikbett optional; wenn Musik, dann automatisches Absenken unter der Stimme
  (Ducking, FFmpeg sidechain oder Remotion-Volume-Kurve).

## Modul C — Untertitel (Captions)
- Wort-genaue Untertitel im Reel-Stil, automatisch aus dem Voice-over-Text
  (Timings aus ElevenLabs oder per Whisper-Transkription — vor neuer Dependency
  fragen). Stil: groß, mittig-unten, Marken-Schrift, aktives Wort hervorgehoben.
- Reels werden meist stumm geschaut — Captions sind Pflicht in jedem Reel.

## Modul D — Farb-Look (Grading)
- Ein einheitlicher CALL-E-Look als Remotion-Filter über jedem Higgsfield-Clip
  (Kontrast, Temperatur, leichte Vignette), damit jedes Video sofort als
  CALL-E erkennbar ist. Ein Look, zentral definiert, überall gleich.
- Flügel-Signet weiß/neutral (siehe Design-Änderung oben).

## Modul E — Dailies & Clip-Archiv
- „Dailies": Vor dem finalen Render zeigt Claude Code Antonio Vorschaubilder
  der erzeugten Takes; Antonio wählt aus oder lässt neu drehen.
- Archiv: Jeder Higgsfield-Clip wird mit Prompt, Datum und Szenen-Zweck in
  `archive/` abgelegt (JSON-Index). Vor jeder Neuerzeugung erst im Archiv
  suchen — spart Higgsfield-Credits.

## Definition of Done (Ausbaustufe 2)
- [ ] Ein Mehrszenen-Reel (3–4 Szenen) mit ElevenLabs-Stimme, Captions und
      einheitlichem Look, aus einem einzigen Satz von Antonio erzeugt
- [ ] Drehbuch- und Dailies-Freigabe durch Antonio VOR Clip-Erzeugung bzw. Render
- [ ] Archiv funktioniert; wiederholte Themen nutzen vorhandene Clips
