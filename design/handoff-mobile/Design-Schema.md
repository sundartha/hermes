# Hermes Mobile – Design-Schema (für Claude Code)

Referenz-Prototyp: `Hermes Mobile v5.dc.html` (Übersicht: `Hermes Richtungen.dc.html`, Runde 5).
Gilt nur für Viewports unter 768 px. Der Desktop bleibt unverändert.

## 1 · Prinzip
- Die Seite besteht aus 5 Screens, jeder genau `100svh` hoch. Der Container hat `scroll-snap-type: y mandatory`, jeder Screen `scroll-snap-align: start; scroll-snap-stop: always`.
- Der Hintergrund ist fix und besteht aus Ebenen. Nur ihre Deckkraft ändert sich mit dem Scroll-Fortschritt `p` (0 bis 4).
- Es gibt zwei Screen-Typen:
  - **Bild-Screens** (1 Hero, 5 Abschluss): Tempel oben, Text unten verankert.
  - **Inhalts-Screens** (2–4, zentriert): **Aussage oben** (Faden → Label → H2 → Satz), **Fokus mittig** im freien Raum, **Bedienung unten**.
- Pro Screen gibt es genau einen Fokus und höchstens eine weiße Hauptaktion.

## 2 · Tokens
| Token | Wert |
|---|---|
| Navy | `#0a2245` · tief `#061631` |
| Hellblau | `#cfe4fa` · Himmelblau `#8fb6e3` · Label `#bcd6f3` |
| Grün (Live/Erfolg) | `#8ff0c0` / `#4ade96` |
| Text | Satz `rgba(232,242,253,.88)` · Hero `.92` · Fußnote `rgba(207,228,250,.72)` · inaktiv `rgba(207,228,250,.66)` |
| Haarlinie | `rgba(207,228,250,.14)` |
| Glas (Schleier) | `linear-gradient(160deg, rgba(24,62,110,.56), rgba(10,30,62,.6) 55%, rgba(8,24,50,.7))`, `backdrop-filter: blur(22px)` |
| Glas (Bedienelement) | bg `rgba(4,14,32,.36)`, Ring `inset 0 0 0 1px rgba(207,228,250,.13)` |
| Glas (Daumen) | bg `rgba(207,228,250,.18)`, `inset 0 1px 0 rgba(255,255,255,.18), 0 2px 10px rgba(0,10,30,.18)` |
| Code-Feld | bg `rgba(4,14,32,.44)`, Radius 22, `inset 0 0 0 1px rgba(207,228,250,.12), inset 0 1px 0 rgba(255,255,255,.06)` |
| Radien | Pille 99 · Code-Feld 22 |

## 3 · Hintergrund-Ebenen (von unten nach oben)
1. `howto_clouds.png`: cover, `object-position: 34% 50%`, `scale(1.08)`, Parallax `translateY((2 − p) × 12px)`.
2. Tempel `olymp_hero.png` auf dem Verlauf `#8e9db4 → #aab5c6 → #9fb0c6 → #7f93ae`. Das Bild ist herausgezoomt:
   - Breite `max(2.05 × vw, 0.98 × vh)`
   - left `vw/2 − 0.695 × Breite`
   - top `min(40px, 0.62 × vh − 0.78 × Bildhöhe)`
   - Maske oben und unten weich (`transparent 0 → #000 7% … 78% → transparent 100%`)
   - Deckkraft: bei `p ≤ 1` `1 − 1.25p`, bei `p > 3` `(p − 3.2) / 0.8`
3. Basis-Verlauf, immer an: `rgba(12,28,56,.42) 0%, 0 17%, 0 40%, rgba(10,34,69,.78) 64%, #081c3a 86%, #061631 100%`.
4. Tönung (Screens 2–4): `rgba(8,26,54,.62) 0%, .5 30%, .58 55%, .3 100%`.
   - Deckkraft: bei `p ≤ 1` `p`, bei `p > 3` `(4 − p) / 0.8`
5. Glas-Schleier: unten, 80 % Höhe, Maske `transparent 0 → #000 45%`, gleiche Deckkraft wie die Tönung.

## 4 · Raster & Abstände
Die Einheiten sind `svh`/`vw`, damit die Werte zur Safari-Leiste passen. Im Prototyp heißen sie `cqh`/`cqw`.

**Alle Screens**
- Seitenrand: 22 px.
- Header: oben 22 px, links 22, rechts 16, Höhe 44.

**Inhalts-Screens**
- Innenabstand: oben `clamp(72px, 10.6svh, 104px)`, unten `clamp(16px, 2.8svh, 28px)`.
- **Faden**: 1 × `clamp(12px, 3.2svh, 32px)`, Verlauf `transparent → rgba(207,228,250,.7)`. Er entfällt unter 700 px Höhe (iPhone SE).
- Abstände von oben nach unten:
  - Faden → Label: `clamp(10px, 1.6svh, 16px)`
  - Label → H2: `clamp(12px, 2svh, 18px)`
  - H2 → Satz: `clamp(10px, 1.7svh, 16px)`
- **Fokus-Zone**: `flex: 1; min-height: 0; padding: clamp(8px, 2svh, 20px) 0`. Das Kind bekommt `margin: auto 0` (sichere Zentrierung, auch in Safari).
- **Bedienung**: Spalte, `gap: clamp(10px, 1.5svh, 12px)`, Fußnote `margin-top: 2px`.

**Abschluss**
- Innenabstand: oben 92, unten `clamp(10px, 1.8svh, 18px)`.
- Abstände:
  - H2 → Pille: `clamp(20px, 3.4svh, 30px)`
  - Pille → Footer: `clamp(18px, 3.2svh, 28px)`
- Footer: Haarlinie oben, `padding-top: clamp(6px, 1svh, 10px)`.

## 5 · Typo-Stufen
| Stufe | Schrift | Größe / Zeile |
|---|---|---|
| H1 Hero | Instrument Serif | 46 / 1, −0.005em (unverändert) |
| H2 Sektion | Instrument Serif, Zeile 2 *kursiv* als Block | `min(10.8vw, 5.6svh)` / 1, −0.01em → 42 (iPhone 15), 46 (Pro Max), 37 (SE) |
| Preis | Instrument Serif | `min(21vw, 8.4svh)` / 1.08, rollende Ziffern · „/ month“ 15 px, Hellblau .8 |
| H3 Titel | Instrument Serif | `clamp(26px, 3.5svh, 30px)` / 1.1 |
| Satz | Space Grotesk 400 | `clamp(15px, 1.9svh, 16px)` / 1.55, max. 336 px, `text-wrap: balance`, Hervorhebung 600 weiß |
| Minuten-Zeile | Space Grotesk | 15 / 1.4, Zahl + „minutes“ 600 weiß |
| Leistungen | Space Grotesk | `clamp(14px, 1.9svh, 16px)` / 1.45, `.9`, Abstand `clamp(4px, .9svh, 8px)` |
| Label | Space Grotesk 500 | 11 / 12, Großbuchstaben, +0.24em, `padding-left: .24em` (optisch mittig) |
| Fußnote | Space Grotesk | 13 / 1.45 · Rechtliches 13, © 12 |
| Code | ui-monospace | 13.5 / 1.65 (SE 13), zentriert, `$ ` in Himmelblau |
| UI | Space Grotesk | Pille 600 16 · Umschalter 500 15 · Schritt-Label 500 12 |

## 6 · Komponenten
- **Pille**: 52 px hoch, volle Breite. Primär: weiß mit Navy-Text. Sekundär: Rand 1.5 px `rgba(255,255,255,.8)`.
- **Umschalter**: 52 px, 4 px Innenabstand, Segmente 44 px.
  - Der Daumen gleitet per `transform: translateX(n × 100%)` mit `.45s cubic-bezier(.3,.7,.2,1)`.
  - Aktiver Text weiß, inaktiver `.66`.
- **Popular-Schild**: sitzt auf der Oberkante über „Business“ (`top: −9px`).
  - Pille 18 px, `#cfe4fa` mit Navy-Text, 600 9.5 px, Großbuchstaben, +0.16em.
  - Der Umschalter bekommt dafür 6 px Abstand nach oben.
- **Preisblock** (Fokus Preise), in dieser Reihenfolge untereinander:
  1. **Preis**: Serif, groß, `white-space: pre`.
     - Jedes Zeichen sitzt in einem eigenen Schacht.
     - Beim Umschalten rollt **nur die Ziffer, die sich ändert** (4 → 9) senkrecht durch, 0.7 s.
  2. **Minuten-Leiste**: 4 Segmente à 3 px, Abstand 6 px, max. 280 px breit; ein Segment steht für 30 Minuten.
     - Starter füllt 1 Segment, Business alle 4.
     - Die Segmente füllen sich nacheinander (150 ms Versatz) und leeren sich rückwärts (90 ms).
     - Beim Ankommen startet die Leiste nach 520 ms.
  3. **Minuten-Zeile**: „**120 minutes** of calls per month“. Die Zahl zählt synchron zur Leiste hoch bzw. runter (Tabellenziffern).
  4. **Leistungen**: die 3 übrigen als zentrierte, weiße Zeilen, alle sichtbar, untereinander.
     - Beim Ankommen erscheinen sie nacheinander.
     - Beim Umschalten wechselt Zeile für Zeile (90 ms Versatz): alt verschwimmt nach oben, neu kommt scharf von unten.
- **Schritt-Leiste** (So funktioniert's):
  - 3 Balken à 2 px, Abstand 10, Tippfläche 48 px hoch.
  - Der aktive Balken füllt sich in 6,5 s linear (`scaleX`), dann folgt der nächste Schritt.
  - Erledigt = weiß, offen = 22 % weiß.
  - Antippen oder Wischen springt direkt zu einem Schritt.
  - Autoplay läuft nur, solange Screen 2 sichtbar ist.
- **Animation (Fokus)**: Ringgröße nach Höhe: < 700 → 92 · < 800 → 108 · < 900 → 128 · sonst 148.
  - Alle 3 Schritte haben denselben Aufbau: Symbol, Ergebniszeile (getippt, 20/22/24 px), Statuszeile 13 px grün.
  - Dahinter liegt ein weicher Lichtschein (radial, 2.6 × Ringgröße, `rgba(170,204,242,.22) → 0`).
- **Code-Feld**: volle Breite, `min-height: clamp(92px, 13.6svh, 120px)`, Innenabstand 16/20, Inhalt zentriert.
- **Header rechts**:
  - „EN / DE“ mit je 44 × 44 Tippfläche; aktive Sprache weiß, die andere `.5`.
  - Danach „Log in“ als Randpille, 44 px hoch, Rand 1.5 px `rgba(255,255,255,.75)`, Innenabstand 0 14.
  - Kein Menü-Button.
- **Footer-Links**: umbrechende Zeile, zentriert, Abstand 14, Tippfläche 44 px hoch; darunter die ©-Zeile.

## 7 · Bewegung
- **Beim Ankommen** (Screen wird aktiv) blendet der Inhalt gestaffelt ein, in dieser Reihenfolge: Faden (`scaleY 0 → 1`, 1.1 s), Label, H2, Satz, Fokus, Bedienung.
  - Verzögerungen 80 / 170 / 260 / 350 / 440 / 530 ms.
  - `opacity .8s ease` plus `translateY 16px → 0`, 1 s `cubic-bezier(.2,.7,.2,1)`.
- **Beim Verlassen**: sofort ausblenden, ohne Verzögerung.
- **Umschalten** (Schritt, Tarif, Weg): Überblendung .5–.6 s. Schritte und Wege gleiten dabei 18–20 px seitlich. Bei Tarifen rollt die geänderte Ziffer, die Minuten-Leiste füllt oder leert sich, die Leistungen wechseln Zeile für Zeile.
- **`prefers-reduced-motion: reduce`**: kein Autoplay, kein Parallax, keine Staffel und kein Versatz, nur Überblenden.

## 8 · Umsetzung unter CSP (keine Inline-Styles oder -Skripte)
- **Styles**: alles als Klassen im Seiten-CSS.
- **Zustände**: über Data-Attribute am Screen bzw. an der Komponente, gesetzt von **einem** externen JS-Modul: `data-active`, `data-step="0-2"`, `data-plan="0|1"`, `data-way="0-2"`, `data-copied`.
- **Scroll**: Fortschritt `p` per `scroll`-Listener am Snap-Container; das Modul setzt die CSS-Variable `--p` auf `:root`. Die Ebenen-Deckkraft rechnet CSS über `clamp()` und `calc()` mit `var(--p)`.
- **Animationen**: Inline-SVG plus CSS-Keyframes (Ring füllen, Suchen, Waveform, Balken füllen). Das Tippen erledigt das JS-Modul über `textContent`.
- **Zugänglichkeit**:
  - Umschalter als `role="tablist"` / `role="tab"` mit `aria-selected`.
  - Kopier-Button mit `aria-live="polite"` („Copied“).
  - Schritt-Buttons mit `aria-label` = Schritttitel.

## 9 · Texte & i18n
- **Englisch ist Standard**, Deutsch per EN / DE. „Verträge kündigen“ bleibt immer deutsch.
- **Hervorhebungen** wie am Desktop:
  - fett: „MCP“ in Hero, Screen 2 und Screen 4
  - fett: „Cancel monthly, no hidden costs.“
  - fett: „30/120 minutes“
  - kursiv: „and“
- **Bindestrich-Wörter** umbrechen nicht: nach dem Bindestrich ein U+2060 einfügen (`heads-⁠up`, `MCP-⁠Server`, `KI-⁠Tool`, `MCP-⁠Client`).
- **Terminal-Befehl**: Angezeigt wird er als eine umbrechende Zeile mit `$ `; kopiert wird der vollständige Befehl.
- **„Your AI“**: Die Anweisung steht in Zeile 1, der Link fett in Zeile 2.
- **Prüfmaße**: Alle Screens passen in EN und DE bei 375 × 667, 390 × 750, 390 × 844 und 430 × 932.

## 10 · Screen-Map
| Screen | Aussage | Fokus | Bedienung |
|---|---|---|---|
| 1 Hero | unten links: H1, Satz | Tempel | Get a number · How it works |
| 2 So funktioniert's | Label, H2, Satz | Animation mit Lichtschein | Schritttitel + Zeile, Schritt-Leiste |
| 3 Preise | Label, H2, Satz | Preis (rollend), Minuten-Leiste + Zähler, 3 Leistungen | Umschalter (+ Popular), „Choose …“, Fußnote |
| 4 Entwickler | Label, H2, Satz | Titel + Code-Feld | Umschalter, „Copy“, Fußnote |
| 5 Abschluss | unten: H2 (Hero-Satz) | Tempel | Get a number, Rechtliches, © |
