# Handoff: Hermes Mobile – Startseite (finale Fassung v9)

## Überblick
Neugestaltung der **Handy-Version** (< 768 px) der Startseite sundartha.com, alle 5 Screens:
- **Start**: zentriert, Headline in 2 Zeilen, eine weiße Pille, „How it works“ als Faden-Hinweis, ziehende Wolken.
- **So funktioniert's, Preise, Für Entwickler**: gemeinsames Raster auf einer Mittelachse.
- **Abschluss**: Tempel kehrt zurück, Footer in zwei Zeilen.
- **Header**: Menü-Button entfällt. Rechts sitzt eine Glaskapsel mit „EN / DE“ und „Log in“.

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
   > Lies `design/handoff-mobile/README.md` und `Design-Schema.md`. Setze die Handy-Version (< 768 px) der Startseite danach um, ohne den Desktop zu ändern. Öffne `Hermes Mobile v9.dc.html` als Referenz. Arbeite auf einem neuen Branch `feat/mobile-redesign`, prüfe 375×667, 390×750, 390×844 und 430×932 in EN und DE, auch mit „Bewegung reduzieren“. Dann committen, pushen und einen Pull Request öffnen.
3. Prototyp ansehen: `Hermes Mobile v9.dc.html` im Browser öffnen. `support.js`, `hermes-kit.js` und `assets/` müssen daneben liegen.

## Screens
| # | Screen | Aufbau |
|---|---|---|
| 1 | Start | Tempel + ziehende Wolken · H1 zentriert (2 Zeilen) · Satz · „Get a number“ · „How it works“ + Faden bis zur Unterkante |
| 2 | So funktioniert's | Faden → Label → H2 → Satz · ein Ring, Inhalt wechselt (Nummer, Verbinden, Anruf) · Titel + 3 Zeilen · Segment-Leiste mit Autoplay (6,5 s) |
| 3 | Preise | Faden → Label → H2 → Satz · Preis mit rollender Ziffer · Minuten-Leiste + Zähler · 3 Leistungen · Umschalter Starter/Business (+ Popular) · „Choose …“ (Name rollt) · Fußnote |
| 4 | Für Entwickler | Faden → Label → H2 → Satz · Titel + Code-Feld (tippt sich, farbig) · Umschalter Connector/Terminal/Your AI · „Copy“ → „✓ Copied“ · Fußnote |
| 5 | Abschluss | Tempel + ziehende Wolken · aufsteigender Faden · H2 (Start-Satz) · „Get a number“ · Rechtliches in 2 Zeilen + © |

Alle Maße, Typo-Stufen, Farben, Ebenen, Bewegung, CSP-Hinweise und i18n stehen in **`Design-Schema.md`**. Es ist die verbindliche Spezifikation.

## Zustände (für das JS-Modul)
- `active` (0–4): aktueller Screen aus dem Scroll-Fortschritt `p = scrollTop / clientHeight`. Steuert Einblendungen, Tropfen, Tippen und das Pausieren der Wolken.
- `step` (0–2): Autoplay nur auf Screen 2, springt per Tippen oder Wischen.
- `plan` (0 Starter, 1 Business; Start: 1).
- `way` (0–2).
- `copied`: wird nach 1,6 s zurückgesetzt.
- `lang` (en/de).
- `prefers-reduced-motion`: siehe Schema, Abschnitt 7.

## Texte
Alle Strings (EN/DE) stehen in `hermes-kit.js` im Objekt `T`, inklusive der Ergänzungen am Dateiende (`bodyP`, `disp`, `perMonth` …).
- Kündigungslink: EN „Cancel contracts“, DE „Verträge kündigen“. Vor dem Go-live rechtlich prüfen (§ 312k BGB).

## Assets
- `assets/olymp_hero.png`: Start und Abschluss.
- `assets/howto_clouds.png`: Wolkenmeer (Kamerafahrt) und ziehende Wolken.
- `assets/hermes-wing.png`: Logo und Ring (Schritt „Verbinden“).
- `assets/fonts/`: Instrument Serif (normal und kursiv), Space Grotesk.

## Dateien
- `Design-Schema.md`: Spezifikation.
- `Hermes Mobile v9.dc.html`: klickbarer Prototyp (Referenz).
- `hermes-kit.js`: Texte (EN/DE) und Hilfslogik (Zähler).
- `support.js`: Laufzeit nur für den Prototyp, **nicht** übernehmen.
