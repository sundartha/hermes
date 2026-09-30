# Hermes Mobile – Design-Schema (für Claude Code / Cowork)

Referenz-Prototyp: `Hermes Mobile v9.dc.html` (Übersicht im Projekt: `Hermes Richtungen.dc.html`, Runde 9).
Gilt nur für Viewports unter 768 px. Der Desktop bleibt unverändert.

## 1 · Prinzip
- Die Seite besteht aus 5 Screens, jeder genau `100svh` hoch. Der Container hat `scroll-snap-type: y mandatory`, jeder Screen `scroll-snap-align: start; scroll-snap-stop: always`.
- Der Hintergrund ist fix und besteht aus Ebenen. Deckkraft und Position ändern sich mit dem Scroll-Fortschritt `p` (0 bis 4).
- **Eine Mittelachse für alles.** Alle Screens sind zentriert.
- Es gibt zwei Screen-Typen:
  - **Bild-Screens** (1 Start, 5 Abschluss): Tempel oben, Text unten verankert.
  - **Inhalts-Screens** (2–4): **Aussage oben** (Faden → Label → H2 → Satz), **Fokus mittig** im freien Raum, **Bedienung unten**.
- Pro Screen gibt es genau einen Fokus und höchstens eine weiße Hauptaktion.

## 2 · Tokens
| Token | Wert |
|---|---|
| Navy | `#0a2245` · tief `#061631` |
| Hellblau | `#cfe4fa` · Himmelblau `#8fb6e3` · Label `#bcd6f3` |
| Grün (Live/Erfolg) | `#8ff0c0` / `#4ade96` |
| Text | Satz `rgba(232,242,253,.88)` · Start `.9` · Fußnote `rgba(207,228,250,.72)` · inaktiv `rgba(207,228,250,.66)` |
| Haarlinie | `rgba(207,228,250,.14)` |
| Glas (Schleier) | `linear-gradient(160deg, rgba(24,62,110,.56), rgba(10,30,62,.6) 55%, rgba(8,24,50,.7))`, `backdrop-filter: blur(22px)` |
| Glas (Bedienelement) | bg `rgba(4,14,32,.36)`, Ring `inset 0 0 0 1px rgba(207,228,250,.13)` |
| Glas (Daumen) | bg `rgba(207,228,250,.18)`, `inset 0 1px 0 rgba(255,255,255,.18), 0 2px 10px rgba(0,10,30,.18)` |
| Glas (Header-Kapsel) | bg `rgba(8,26,54,.3)`, `backdrop-filter: blur(16px) saturate(1.3)`, `inset 0 0 0 1px rgba(255,255,255,.18), inset 0 1px 0 rgba(255,255,255,.12)` |
| Code-Feld | bg `rgba(4,14,32,.44)`, Radius 22, `inset 0 0 0 1px rgba(207,228,250,.12), inset 0 1px 0 rgba(255,255,255,.06)` |
| Pillen-Schatten | `0 10px 30px rgba(0,10,30,.28)` |
| Radien | Pille 99 · Code-Feld 22 |

## 3 · Hintergrund-Ebenen (von unten nach oben)
1. **Wolkenmeer** `howto_clouds.png` (1920 × 1060):
   - Größe: Breite `max(vw, vh × 1920/1060) × 1.12`, Höhe im Seitenverhältnis. Links `vw/2 − 0.4 × Breite`, oben `(vh − Höhe) / 2`.
   - **Kamerafahrt:** `translate3d((2 − p) × vw × 0.28, (2 − p) × 14px, 0)`. Das Meer schwenkt mit jedem Screen ein Stück seitlich.
2. **Tempel** `olymp_hero.png` auf dem Verlauf `#8e9db4 → #aab5c6 → #9fb0c6 → #7f93ae`:
   - Breite `max(2.05 × vw, 0.98 × vh)`
   - left `vw/2 − 0.695 × Breite`
   - top `min(40px, 0.62 × vh − 0.78 × Bildhöhe)`
   - Maske oben und unten weich (`transparent 0 → #000 7% … 78% → transparent 100%`)
   - Deckkraft: bei `p ≤ 1` `1 − 1.25p`, bei `p > 3` `(p − 3.2) / 0.8`
   - **Ziehende Wolken** (siehe 6.1), im Tempel-Layer, also nur auf Start und Abschluss sichtbar.
3. Basis-Verlauf, immer an: `rgba(12,28,56,.42) 0%, 0 17%, 0 40%, rgba(10,34,69,.78) 64%, #081c3a 86%, #061631 100%`.
4. Tönung (Screens 2–4): `rgba(8,26,54,.62) 0%, .5 30%, .58 55%, .3 100%`. Deckkraft: bei `p ≤ 1` `p`, bei `p > 3` `(4 − p) / 0.8`.
5. Glas-Schleier: unten, 80 % Höhe, Maske `transparent 0 → #000 45%`, gleiche Deckkraft wie die Tönung.

## 4 · Raster & Abstände
Die Einheiten sind `svh`/`vw`, damit die Werte zur Safari-Leiste passen. Im Prototyp heißen sie `cqh`/`cqw`.

**Alle Screens**
- Seitenrand: 22 px.
- Header: oben 22 px, links 22, rechts 16, Höhe 44.

**Start (Screen 1)**
- Innenabstand: oben 92, seitlich 22, unten 0 (der Faden läuft bis an die Unterkante).
- H1 → Satz `clamp(12px, 2svh, 18px)` · Satz → Pille `clamp(22px, 3.6svh, 32px)` · Pille → „How it works“ `clamp(6px, 1.2svh, 12px)`.
- „How it works“: Textbutton 500 15 px, `padding: 12px 24px 0`, darunter 10 px Abstand, dann der Faden: 1 × `clamp(22px, 4.4svh, 40px)`, Verlauf `rgba(207,228,250,.6) → 0`. Er läuft in den Faden von Screen 2 weiter.

**Inhalts-Screens**
- Innenabstand: oben `clamp(72px, 10.6svh, 104px)`, unten `clamp(16px, 2.8svh, 28px)`.
- **Faden**: 1 × `clamp(12px, 3.2svh, 32px)`, Verlauf `transparent → rgba(207,228,250,.7)`. Er entfällt unter 700 px Höhe (iPhone SE).
- Abstände von oben nach unten:
  - Faden → Label: `clamp(10px, 1.6svh, 16px)`
  - Label → H2: `clamp(12px, 2svh, 18px)`
  - H2 → Satz: `clamp(10px, 1.7svh, 16px)`
- **Fokus-Zone**: `flex: 1; min-height: 0; padding: clamp(8px, 2svh, 20px) 0`. Das Kind bekommt `margin: auto 0` (sichere Zentrierung, auch in Safari).
- **Bedienung**: Spalte, `gap: clamp(10px, 1.5svh, 12px)`, Fußnote `margin-top: 2px`.

**Abschluss (Screen 5)**
- Innenabstand: oben 92, unten `clamp(10px, 1.8svh, 18px)`.
- Von oben: aufsteigender Faden 1 × `clamp(26px, 5.6svh, 52px)` (Verlauf `0 → rgba(207,228,250,.55)`) → `clamp(14px, 2.2svh, 20px)` → H2 → `clamp(22px, 3.6svh, 32px)` → Pille → `clamp(18px, 3.2svh, 28px)` → Footer.
- Footer: Haarlinie oben, `padding-top: clamp(6px, 1svh, 10px)`.

## 5 · Typo-Stufen
| Stufe | Schrift | Größe / Zeile |
|---|---|---|
| H1 Start | Instrument Serif, 2 Zeilen, Zeile 2 *kursiv* als Block | `min(14.2vw, 6.6svh)` / 1, −0.005em → 55 (iPhone 15), 61 (Pro Max), 44 (SE) |
| H2 Sektion + Abschluss | Instrument Serif, Zeile 2 *kursiv* als Block | `min(10.8vw, 5.6svh)` / 1, −0.01em → 42 / 46 / 37 |
| Preis | Instrument Serif | `min(21vw, 8.4svh)` / 1.08, rollende Ziffern · „/ month“ 15 px, Hellblau .8, `padding-left: 10px` |
| H3 Titel | Instrument Serif | `clamp(26px, 3.5svh, 30px)` / 1.1 |
| Satz | Space Grotesk 400 | `clamp(15px, 1.9svh, 16px)` / 1.55, max. 330–336 px, `text-wrap: balance`, Hervorhebung 600 weiß |
| Schritt-Zeilen | Space Grotesk | `clamp(14px, 1.9svh, 16px)` / 1.45, `.86`, 3 Zeilen untereinander, Abstand `clamp(1px, .4svh, 4px)` |
| Minuten-Zeile | Space Grotesk | 15 / 1.4, Zahl + „minutes“ 600 weiß |
| Leistungen | Space Grotesk | `clamp(14px, 1.9svh, 16px)` / 1.45, `.9`, Abstand `clamp(4px, .9svh, 8px)` |
| Label | Space Grotesk 500 | 11 / 12, Großbuchstaben, +0.24em, `padding-left: .24em` (optisch mittig) |
| Ring-Ergebnis | Space Grotesk 500 | 20 / 22 / 24 px (nach Höhe), Tabellenziffern |
| Fußnote | Space Grotesk | 13 / 1.45 · Rechtliches 13, © 12 |
| Code | ui-monospace | 13.5 / 1.65 (SE 13), zentriert |
| UI | Space Grotesk | Pille 600 16 · Umschalter 500 15 · Header 600 12.5 (EN/DE), 500 14.5 (Log in) |

## 6 · Komponenten
- **Pille (Hauptaktion)**: 52 px hoch, **Breite `min(100%, 248px)`, mittig**, weiß mit Navy-Text, Pillen-Schatten. Gleich auf allen Screens (Start, Preise, Entwickler, Abschluss).
- **Header-Kapsel rechts**: eine Glaskapsel, 44 px hoch, Innenabstand `0 4px 0 2px`.
  - Links „EN / DE“: zwei Buttons 34 × 44, der Schrägstrich mittig darüber; aktive Sprache weiß, die andere `.5`.
  - Haarlinie 1 × 18 px, `rgba(255,255,255,.22)`, Rand `0 7px 0 3px`.
  - Rechts „Log in“: Tippfläche 44 px, darin der Glas-Daumen 36 px hoch, Innenabstand 0 13. Kein weißer Rand.
- **Umschalter**: 52 px, 4 px Innenabstand, Segmente 44 px, volle Breite.
  - Der Daumen gleitet mit `.45s cubic-bezier(.3,.7,.2,1)`.
  - Aktiver Text weiß, inaktiver `.66`.
- **Popular-Schild**: sitzt auf der Oberkante über „Business“ (`top: −9px`). Pille 18 px, `#cfe4fa` mit Navy-Text, 600 9.5 px, Großbuchstaben, +0.16em. Der Umschalter bekommt dafür 6 px Abstand nach oben.

### 6.1 · Ziehende Wolken (Start + Abschluss)
- Band über dem Berg: top `heroTop + 0.48 × Bildhöhe`, Höhe `0.52 × Bildhöhe`, `overflow: hidden`, Maske `transparent 0 → rgba(0,0,0,.85) 42% → #000 68% → transparent 100%`.
- Darin zwei Schichten aus `howto_clouds.png`. Jede ist ein Streifen aus **4 Kacheln im Wechsel normal / gespiegelt** (`scaleX(-1)`). Jede Kachel hat `object-fit: cover; object-position: 50% 100%`.
  - Hinten: Kachelbreite `Bandhöhe × 1920 / 480`, Deckkraft .34, 300 s.
  - Vorne: Kachelbreite `Bandhöhe × 1920 / 360`, Deckkraft .26, `blur(1.5px)`, 250 s.
- Animation: `translateX(0 → −2 × Kachelbreite)`, `linear infinite`. Da sich das Muster nach 2 Kacheln wiederholt, ist die Schleife **nahtlos**: kein Neustart, kein Schwarzbild.
- `animation-play-state: paused`, solange Screen 2–4 aktiv ist.

### 6.2 · So funktioniert's
- **Ein Ring, der stehen bleibt.** Größe nach Höhe: < 700 → 92 · < 800 → 108 · < 900 → 128 · sonst 148. Grundkreis `rgba(8,24,50,.35)`, Rand `rgba(207,228,250,.16)` 1.5 px. Der Bogen ist 2 px `#cfe4fa` und wird grün `#8ff0c0`, wenn der Schritt fertig ist.
- Nur der Inhalt im Ring wechselt (Zeiten ab Schrittstart):
  1. **Nummer**: der Bogen füllt sich (1.4 s) → Haken zeichnet sich (1.86 s) → „+49 176 44 12 908“ tippt sich (55 ms/Zeichen) → „● Live“ (2.81 s).
  2. **Verbinden**: der Bogen läuft als Viertelstück im Kreis, der Flügel steht darin (.55) → rastet bei 1.7 s ein (voller Kreis, Flügel 1) → „app.sundartha.com/mcp“ tippt sich (40 ms/Zeichen) → „● Connected to your AI“ (2.56 s).
  3. **Abnehmen**: 9 Wellenbalken im Ring (3 px, Höhe 0.34 × Ring) schwingen → bei 3.2 s fallen sie zusammen, Haken, „✓ Summary ready“.
- Dahinter ein weicher Lichtschein (radial, 2.6 × Ring, `rgba(170,204,242,.22) → 0`). Ist ein Schritt fertig, leuchtet er einmal kurz grün auf (`rgba(143,240,192,.18)`, 2.4 s).
- **Unter der Animation**: Titel (H3) + 3 Zeilen untereinander. Die Zeilen kommen einzeln (140 + 80 ms Versatz).
- **Schritt-Leiste**: 3 Segmente à 3 px, Abstand 6, max. 280 px, mittig. Tippfläche 44 px hoch. **Keine Labels.** Das aktive Segment füllt sich in 6,5 s linear, dann folgt der nächste Schritt. Erledigt = weiß, offen = 18 % weiß. Antippen oder Wischen springt direkt. Autoplay läuft nur, solange Screen 2 sichtbar ist.

### 6.3 · Preise
1. **Preis**: Serif, groß, `white-space: pre`. Preis und „/ month“ stehen **zusammen mittig**. Jedes Zeichen sitzt in einem eigenen Schacht. Beim Umschalten rollt **nur die Ziffer, die sich ändert** (4 → 9) senkrecht durch, 0.7 s. Dahinter weicher Lichtschein (`clamp(220px, 36svh, 320px)`).
2. **Minuten-Leiste**: 4 Segmente à 3 px, Abstand 6 px, max. 280 px; ein Segment steht für 30 Minuten. Starter füllt 1, Business alle 4. Füllen nacheinander (150 ms Versatz), leeren rückwärts (90 ms). Beim Ankommen Start nach 520 ms.
3. **Minuten-Zeile**: „**120 minutes** of calls per month“. Die Zahl zählt synchron zur Leiste (Tabellenziffern).
4. **Leistungen**: 3 zentrierte Zeilen. Beim Umschalten Zeile für Zeile (90 ms Versatz): alt verschwimmt nach oben (`blur 4px`), neu kommt scharf von unten.
5. **Button „Choose …“**: Nur der Tarifname rollt senkrecht (0.6 s, wie die Ziffer), „Choose“ bzw. „wählen“ bleibt stehen. Die Breite des Namens gleitet mit (0.5 s).

### 6.4 · Entwickler
- Titel (H3) + **Code-Feld**: volle Breite, `min-height: clamp(84px, 11svh, 100px)`, Innenabstand 16/20, Inhalt zentriert.
- **Farben im Code**: `$ ` und Flags (`--transport http`) Himmelblau `#8fb6e3` · URL Hellblau `#cfe4fa` · Rest `#e8f2fd` · bei „Your AI“ der Link fett weiß.
- **Tippen**: Beim Ankommen (nach 560 ms) und bei jedem Wegwechsel (nach 140 ms) tippt sich der Code, 12 ms/Zeichen. Der noch nicht getippte Rest ist schon da, aber transparent, damit sich nichts verschiebt. Cursor: Block `.5em × 1.1em`, `#8fb6e3`.
- **Kopieren**: Der Code wird markiert wie ausgewählter Text (`rgba(143,182,227,.3)`, Radius 4, `box-decoration-break: clone`). „Copy“ rollt senkrecht zu „✓ Copied“, Text grün `#16784c`. Nach 1,6 s geht es zurück.

### 6.5 · Footer
- **Zwei feste Zeilen, mittig**, Abstand 14, Tippfläche 44 px, die zweite Zeile rückt 10 px hoch:
  - Zeile 1: Privacy · Imprint · Terms · Cancel contracts
  - Zeile 2: Contact · Cookie settings
- Darunter die ©-Zeile.

## 7 · Bewegung
- **Beim Ankommen** (Screen wird aktiv) blendet der Inhalt gestaffelt ein: Faden (`scaleY 0 → 1`, 1.1 s), Label, H2 Zeile 1, H2 Zeile 2, Satz, Fokus, Bedienung.
  - Verzögerungen `80 + n × 85 ms`.
  - `opacity .8s ease` plus `translateY 16px → 0`, 1 s `cubic-bezier(.2,.7,.2,1)`.
  - **Headlines (H1/H2) zusätzlich unscharf → scharf**: `filter: blur(7px) → 0`, .9 s, Zeile für Zeile.
- **Lichttropfen im Faden**: Beim Ankommen auf Screen 2–4 läuft einmal ein heller Tropfen den Faden hinunter (1.3 s, 200 ms Verzögerung). Auf dem Start läuft er als Scroll-Hinweis in Schleife (2.6 s, ab 1.2 s). Auf dem Abschluss steigt er nach oben (2.8 s, Schleife).
- **Start beim Laden**: Der Text rollt nach 150 ms ein, gleiche Staffel wie oben.
- **Beim Verlassen**: sofort ausblenden, ohne Verzögerung.
- **Umschalten** (Schritt, Weg): Überblendung .5–.6 s, 18–20 px seitlich plus `blur(4px) → 0`. Tarife: siehe 6.3.
- **`prefers-reduced-motion: reduce`**: kein Autoplay, keine Kamerafahrt, keine ziehenden Wolken, kein Tippen, keine Tropfen, keine Staffel und kein Versatz. Es bleibt nur Überblenden.

## 8 · Umsetzung unter CSP (keine Inline-Styles oder -Skripte)
- **Styles**: alles als Klassen im Seiten-CSS.
- **Zustände**: über Data-Attribute am Screen bzw. an der Komponente, gesetzt von **einem** externen JS-Modul: `data-active`, `data-step="0-2"`, `data-plan="0|1"`, `data-way="0-2"`, `data-copied`.
- **Scroll**: Fortschritt `p` per `scroll`-Listener am Snap-Container. Das Modul setzt die CSS-Variable `--p` auf `:root`. Ebenen-Deckkraft und Kamerafahrt rechnet CSS über `calc()`/`clamp()` mit `var(--p)`.
- **Ziehende Wolken**: reine CSS-Keyframes, die Distanz als CSS-Variable (`--fx`). Das Modul setzt nur `data-active` für `animation-play-state`.
- **Animationen**: Inline-SVG plus CSS-Keyframes (Bogen füllen, Suchen, Welle, Leiste füllen, Tropfen). Das Tippen erledigt das JS-Modul über `textContent`.
- **Zugänglichkeit**:
  - Umschalter als `role="tablist"` / `role="tab"` mit `aria-selected`.
  - Kopier-Button mit `aria-live="polite"` („Copied“).
  - Schritt-Segmente mit `aria-label` = Schritttitel.
  - Deko (Wolken, Faden, Lichtschein) mit `aria-hidden="true"`.

## 9 · Texte & i18n
- **Englisch ist Standard**, Deutsch per EN / DE.
- **Kündigungslink**: EN „Cancel contracts“, DE „Verträge kündigen“. Rechtlich (§ 312k BGB) vor dem Go-live prüfen, ob die Formulierung reicht.
- **Hervorhebungen** wie am Desktop:
  - fett: „MCP“ in Start, Screen 2 und Screen 4
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
| 1 Start | unten, zentriert: H1 (2 Zeilen), Satz | Tempel + ziehende Wolken | „Get a number“ (Pille) · „How it works“ + Faden |
| 2 So funktioniert's | Faden, Label, H2, Satz | ein Ring mit wechselndem Inhalt + Lichtschein | Titel + 3 Zeilen, Segment-Leiste |
| 3 Preise | Faden, Label, H2, Satz | Preis (rollend), Minuten-Leiste + Zähler, 3 Leistungen | Umschalter (+ Popular), „Choose …“ (Name rollt), Fußnote |
| 4 Entwickler | Faden, Label, H2, Satz | Titel + Code-Feld (tippt sich) | Umschalter, „Copy“ → „✓ Copied“, Fußnote |
| 5 Abschluss | aufsteigender Faden, H2 (Start-Satz) | Tempel + ziehende Wolken | „Get a number“, Rechtliches (2 Zeilen), © |
