# Handoff: Hermes Mobile – Startseite ab Screen 2

## Überblick
Neugestaltung der **Handy-Version** (< 768 px) der Startseite sundartha.com:
- Hero (Screen 1) bleibt, nur mit herausgezoomtem Tempel und fett gesetztem „MCP“.
- Neu gestaltet: So funktioniert's, Preise, Für Entwickler, Abschluss/Footer.
- Header: Menü-Button entfällt; rechts sitzen „EN / DE“ und die Pille „Log in“.

Der Desktop bleibt **unverändert**.

## Über die Design-Dateien
Die Dateien in diesem Ordner sind **Design-Referenzen in HTML**. Sie zeigen Aussehen und Verhalten und sind kein Produktionscode.
- **Aufgabe:** die Screens in der bestehenden **Astro-Seite** mit ihren Mustern nachbauen, als CSS-Klassen plus **ein** externes JS-Modul.
- **Grund:** Die Seite hat eine strenge CSP, also keine Inline-Styles, keine Inline-Skripte und keine externen Libraries.

## Fidelity
**High-fidelity.** Farben, Typo, Abstände und Animationen sind final und sollen 1:1 übernommen werden.

## So startest du (Claude Code / Cowork im Repo)
1. Diesen Ordner ins Repo kopieren, z. B. nach `design/handoff-mobile/`.
2. Claude Code / Cowork im Repo-Ordner starten und sagen:
   > Lies `design/handoff-mobile/README.md` und `Design-Schema.md`. Setze die Handy-Version (< 768 px) der Startseite danach um, ohne den Desktop zu ändern. Öffne `Hermes Mobile v5.dc.html` als Referenz. Arbeite auf einem neuen Branch `feat/mobile-redesign`, prüfe 375×667, 390×750, 390×844 und 430×932 in EN und DE, dann committen, pushen und einen Pull Request öffnen.
3. Prototyp ansehen: `Hermes Mobile v5.dc.html` im Browser öffnen. `support.js` und `hermes-kit.js` müssen daneben liegen.

## Screens
| # | Screen | Aufbau |
|---|---|---|
| 1 | Hero | unverändert: Tempel, H1 unten links, Satz, 2 Pillen |
| 2 | So funktioniert's | Faden → Label → H2 → Satz · Animation (Ring/Nummer, MCP-Ring, Waveform) · Schritttitel + Zeile · Schritt-Leiste mit Autoplay (6,5 s) |
| 3 | Preise | Faden → Label → H2 → Satz · Preis mit rollender Ziffer · 4-Segment-Minuten-Leiste + Zähler · 3 Leistungen · Umschalter Starter/Business (+ Popular-Schild) · „Choose …“ · Fußnote |
| 4 | Für Entwickler | Faden → Label → H2 → Satz · Titel + Code-Feld (zentriert) · Umschalter Connector/Terminal/Your AI · „Copy“ · Fußnote |
| 5 | Abschluss | Tempel kehrt zurück · H2 (Hero-Satz) · „Get a number“ · Rechtliches + © |

Alle Maße, Typo-Stufen, Farben, Ebenen, Bewegung, CSP-Hinweise und i18n stehen in **`Design-Schema.md`**. Es ist die verbindliche Spezifikation.

## Zustände (für das JS-Modul)
- `active` (0–4): aktueller Screen aus dem Scroll-Fortschritt `p = scrollTop / clientHeight`; steuert die gestaffelten Einblendungen.
- `step` (0–2): Autoplay nur auf Screen 2, springt per Tippen oder Wischen.
- `plan` (0 Starter, 1 Business; Start: 1).
- `way` (0–2).
- `copied`: wird nach 1,6 s zurückgesetzt.
- `lang` (en/de).
- `prefers-reduced-motion`: kein Autoplay, kein Parallax, keine Staffel.

## Texte
Alle Strings (EN/DE) stehen in `hermes-kit.js` im Objekt `T` inklusive der Ergänzungen am Dateiende (`bodyP`, `disp`, `perMonth` …). „Verträge kündigen“ bleibt immer deutsch.

## Assets
- `assets/olymp_hero.png`: Hero und Abschluss.
- `assets/howto_clouds.png`: Hintergrund ab Screen 2.
- `assets/hermes-wing.png`: Logo und MCP-Animation.
- `assets/fonts/`: Instrument Serif (normal und kursiv), Space Grotesk.

## Dateien
- `Design-Schema.md`: Spezifikation.
- `Hermes Mobile v5.dc.html`: klickbarer Prototyp (Referenz).
- `hermes-kit.js`: Texte und Animations-Logik (Ring, Tippen, Waveform, Zähler).
- `support.js`: Laufzeit nur für den Prototyp, **nicht** übernehmen.
