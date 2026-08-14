# Dashboard-Design-Spec (/app)

Verbindliche Gestaltungsvorlage fuer den Umbau von `/app`. Abgeleitet aus dem
Claude-Design-Entwurf "Sundartha Website Redesign" (Dashboard-Mock) und
`DASHBOARD-AUFTRAG.md`. Bei Widerspruch gewinnt diese Datei.

## 0. Grundsatz

**Restyling plus Interaktion — kein Funktionsumbau.** Auth-Gate, AUTH_EVENT-
Verteilung, Schreibpfade, Stripe-Wege, Kuendigung nach § 312k, Newsletter-
Einwilligung: alles bleibt wie es ist. Neu sind nur Aussehen und drei
Interaktionen (Kopier-Knopf, Detail-Fenster, Scroll-Spy).

**Sprache bleibt Englisch.** Der Entwurf ist deutsch, das Repo ist per
`test/dashboard-i18n-surface.test.js` (WEB-18) auf durchgaengig Englisch und
`en-US`-Datumsformate festgelegt. Wir uebernehmen die Gestaltung, nicht die
Sprache. Deutsche Beschriftungen im Entwurf werden gemaess der
Uebersetzungstabelle unten ersetzt.

**CSP.** Keine Inline-Styles (`style="..."`), keine Inline-Handler (`onclick=`).
JS gehoert in den `<script>`-Block einer .astro-Datei oder in eine importierte
.js-Datei.

## 1. Buehne (steht bereits, nicht anfassen)

`App.astro` + `app-hermes.css` liefern schon: Wolkenmeer-Layer, Schleier,
Kopfverlauf, Body-Radialverlauf. Diese Ebene ist korrekt umgesetzt und bleibt.

## 2. Farb- und Materialsprache

| Rolle | Wert |
| --- | --- |
| Akzent | `#8FB6E3`, hell `#cfe4fa` |
| Aussagen (Text) | reines Weiss |
| Beiwerk (Text) | `rgba(255,255,255,.62)` |
| Sehr leise (Mono-Meta) | `rgba(255,255,255,.46)` |
| Glaskarte Fuellung | `rgba(12,30,58,.46)` |
| Glaskarte Rand | `1px solid rgba(255,255,255,.10)` |
| Glaskarte Radius | `20px` |
| Glaskarte Blur | `backdrop-filter: blur(14px)` |
| Eingelassenes Feld (Nummernkarte, Nav-Trog) | `rgba(8,22,46,.52)`, Rand `rgba(255,255,255,.08)`, Radius `16px` |
| Erhabenes Element (aktive Nav-Kachel) | `rgba(255,255,255,.14)`, Radius `12px`, `box-shadow: 0 2px 10px rgba(0,0,0,.22)` |
| Trennlinie | `1px solid rgba(255,255,255,.08)` |
| Hover-Aufhellung Zeile | `rgba(255,255,255,.045)` |

Keine satten Ampelfarben. Alle Statusfarben sind helle Toene auf
durchscheinendem Grund.

## 3. Typografie

| Rolle | Font | Groesse / Stil |
| --- | --- | --- |
| Begruessung | `--font-heading` (Instrument Serif) | `clamp(34px,3.6vw,50px)`, weiss |
| Abschnittstitel (h2) | `--font-heading` | `clamp(22px,2vw,28px)`, weiss |
| Fliesstext, Namen, Knoepfe | `--font-sans` (Space Grotesk) | 14–15px |
| Eyebrow, Statuslabels, Zeiten, Sprachcodes, Nav-Nummern | `--app-mono` (System-Mono, **nicht** IBM Plex Mono) | 10–12px, `letter-spacing:.14em`, Grossbuchstaben |
| Telefonnummer | `--app-mono` | 22px, weiss, Ziffern in Gruppen mit Leerzeichen |

## 4. Kopfzeile

Transparent, kein Rand. Links Fluegel `/assets/hermes-wing.png` 42px
freistehend + zweizeiliges Wortzeichen: `HERMES` (Sans, 22px, `letter-spacing:
.06em`, weiss) ueber `BY SUNDARTHA` (Mono, 11px, `letter-spacing:.16em`,
`rgba(255,255,255,.62)`). Beides mit leichtem Textschatten.

Rechts: `Sign out` (Sans, 15px, weiss). **Kein DE/EN-Umschalter** — der Entwurf
zeigt einen, wir bauen ihn nicht (siehe Grundsatz).

Mobil ≤760px: Fluegel 38px, Namen 18px/11px.

## 5. Seitenkopf

Zweispaltig: links Eyebrow + Begruessung, rechts die Nummernkarte.
`grid-template-columns: 1fr auto`, `gap: 28px`, `align-items: center`.
≤900px: einspaltig gestapelt, Nummernkarte volle Breite.

**Eyebrow-Pille:** Punkt 5px `#8FB6E3` + Mono-Text `YOUR AREA`.
`background: rgba(10,28,56,.46)`, `border: 1px solid rgba(143,182,227,.34)`,
`backdrop-filter: blur(6px)`, `border-radius: 999px`, `padding: 6px 14px`.

**Begruessung:** Serif, `Welcome, {Name}`.

**Nummernkarte** (eingelassenes Feld, siehe §2): eine Zeile mit
`display:flex; align-items:center; gap:18px`.

- Radiopunkt 10px links. Aktiv (Agent telefoniert): `#7FE0B0` mit Puls-Ring
  (`@keyframes`, 2s, `box-shadow` von `0 0 0 0 rgba(127,224,176,.5)` auf
  `0 0 0 10px rgba(127,224,176,0)`). Inaktiv: `rgba(255,255,255,.28)`, kein Puls.
  Bestehende Klassen `.live-dot` / `.live-dot--off` weiterverwenden.
- Mitte: Mono-Label `YOUR NUMBER` (10px, `rgba(255,255,255,.46)`) ueber der
  Nummer (Mono 22px weiss).
- Rechts: Kopier-Knopf als Ghost-Pille — `border: 1px solid rgba(255,255,255,.22)`,
  `border-radius: 999px`, `padding: 10px 18px`, Sans 14px weiss, Inline-SVG
  Copy-Glyphe (zwei versetzte abgerundete Rechtecke, 16px, `stroke: currentColor`,
  `fill: none`, `stroke-width: 1.5`) + Label `Copy`.
  Klick: `navigator.clipboard.writeText` mit `document.execCommand("copy")`-
  Fallback. Danach 1800ms Label `Copied`, Farbe `#7FE0B0`, Rand
  `rgba(127,224,176,.45)`, kurze Pop-Skalierung (`transform: scale(1.06)`,
  180ms, `prefers-reduced-motion` respektieren). `aria-live="polite"`.

## 6. Bereichs-Navigation

Vier Eintraege, Anker in dieser Reihenfolge:

| Nr. | Label (EN) | Anker |
| --- | --- | --- |
| 01 | Calls | `#anrufe` |
| 02 | Settings | `#einstellungen` |
| 03 | Billing | `#abrechnung` |
| 04 | Newsletter | `#newsletter` |

Optik: eingelassener Trog (§2) mit `padding: 6px`. Jeder Eintrag ist eine
Kachel, Inhalt zentriert, zweizeilig: Mono-Nummer `01` (10px,
`rgba(255,255,255,.42)`) ueber dem Label (Sans 13px). Aktiv: erhabenes Element
(§2), Label weiss, Nummer `rgba(255,255,255,.7)`. Inaktiv: transparent, Label
`rgba(255,255,255,.62)`; Hover hebt auf `rgba(255,255,255,.06)`.

**Scroll-Spy.** Alle vier Abschnitte bleiben gleichzeitig im DOM — kein
Tab-Verstecken. Ein `IntersectionObserver` (`rootMargin: "-96px 0px -60% 0px"`)
setzt `is-active` auf den Eintrag des oben sichtbaren Abschnitts. Klick scrollt
sanft so, dass der Abschnittskopf 96px unter der Oberkante steht; Abschnitte
bekommen `scroll-margin-top: 96px`. Bei `prefers-reduced-motion` ohne Animation.

Layout:
- Desktop (>980px): sticky linke Spalte, 200px breit, `position: sticky;
  top: 26px`; die Eintraege stehen dort untereinander, Nummer links neben dem
  Label. Rechts daneben die scrollende Inhaltsspalte.
- 761–980px: waagerechte Leiste ueber dem Inhalt, vier Kacheln nebeneinander,
  Nummer ueber Label (Optik wie im Entwurf).
- ≤760px: dieselbe waagerechte Leiste, vier Kacheln in einer Reihe, Labels
  duerfen auf 12px schrumpfen.

## 7. Abschnitt Calls

Kartenkopf: Serif-Titel `Calls` links, rechts Mono-Hinweis `View details`
(11px, `rgba(255,255,255,.46)`).

Anrufzeile — `display: grid; grid-template-columns: 38px 1fr auto; gap: 14px;
padding: 16px 4px`, Trennlinie zwischen den Zeilen, Hover-Aufhellung, ganze
Zeile klickbar (`<button>` oder `role="button"` mit Tastaturbedienung).

- **Pfeil-Kreis** 38px, `border-radius: 999px`, `border: 1px solid`, transparent
  gefuellt. Eingehend `↙`: Rand `rgba(127,224,176,.42)`, Glyphe `#7FE0B0`.
  Ausgehend `↗`: Rand `rgba(143,182,227,.45)`, Glyphe `#8FB6E3`.
- **Mitte:** Name/Nummer (Sans 15px, `font-weight: 600`, weiss), darunter
  Mono-Meta `Today, 09:12 · 2:40` (11px, `rgba(255,255,255,.46)`), darunter die
  einzeilige Zusammenfassung (Sans 14px, `rgba(255,255,255,.78)`,
  zweizeilig abgeschnitten).
- **Rechts:** Status-Pille, Mono 10px, Grossbuchstaben, `letter-spacing: .12em`,
  `border-radius: 999px`, `padding: 5px 11px`, 1px Rand, durchscheinende
  Fuellung:

| Status | Text (EN) | Farbe | Rand | Fuellung |
| --- | --- | --- | --- | --- |
| aktiv | `LIVE` | `#7FE0B0` | `rgba(127,224,176,.42)` | `rgba(127,224,176,.10)` |
| beendet | `ENDED` | `#A9C4E4` | `rgba(143,182,227,.40)` | `rgba(143,182,227,.10)` |
| abgebrochen | `CANCELLED` | `#E0C48F` | `rgba(224,196,143,.42)` | `rgba(224,196,143,.10)` |
| fehlgeschlagen | `FAILED` | `#E8A9A9` | `rgba(232,169,169,.42)` | `rgba(232,169,169,.10)` |

## 8. Detail-Fenster (Modal)

Ersetzt das heutige Aufklappen der Zeile (`aria-expanded`-Akkordeon auf dem
Branch `feat/dashboard-neubau`). Der vorhandene Transkript-Aufbau
(`transcriptFrom`, `chatBubble`, `chatLog`, `EMPTY_TRANSCRIPT`) wird
weiterverwendet, nur der Behaelter wechselt.

- Hintergrund: `rgba(4,12,28,.62)` mit `backdrop-filter: blur(8px)`.
- Karte: mittig, `max-width: 620px`, `max-height: 82vh`, Glaskarte (§2), aber
  dunkler abgetoent (`rgba(10,26,52,.86)`), eigener Scrollbereich.
- Kopf: Richtungs-Pille (`Incoming` / `Outgoing`, Optik wie Status-Pille in
  Akzentblau) links, Schliessen-Kreuz rechts oben (Ghost-Kreis 34px).
- Darunter die Anrufer-Zeile: Punkt + Mono-Label `CONTACT`, Name/Nummer,
  Mono-Meta Zeit · Dauer, Status-Pille. (Das ist die "Nummer drueber" aus dem
  Entwurf — sie steht immer sichtbar ueber dem Gespraech.)
- `Summary`-Box: eingelassenes Feld (§2), Mono-Label ueber Fliesstext.
- `Transcript` als Chat: Hermes links (`chat-bubble--agent`, Fuellung
  `rgba(143,182,227,.16)`, Rand `rgba(143,182,227,.24)`, Ecke unten links spitz
  `border-radius: 16px 16px 16px 4px`), Gegenseite rechts
  (`chat-bubble--counterparty`, Fuellung `rgba(255,255,255,.10)`, Ecke unten
  rechts spitz `16px 16px 4px 16px`). Ueber jeder Blase Sprecher-Label (Mono
  10px) und Zeitstempel.
- Schliessen per Kreuz, Klick auf den Hintergrund, `Escape`. Fokus beim Oeffnen
  auf das Schliessen-Kreuz, Fokus-Falle innerhalb der Karte, beim Schliessen
  zurueck auf die ausloesende Zeile. `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby`.

## 9. Abschnitt Settings

Feld `Agent language` mit Erklaertext, darunter Auswahlkacheln im
Radiobutton-Stil statt `<select>` — **die Sprachliste kommt unveraendert aus
dem bestehenden Markup**, es werden keine Sprachen hinzugefuegt oder entfernt.

Kachel: eingelassenes Feld (§2), `display: grid; grid-template-columns: 20px
1fr auto`, `padding: 14px 16px`. Links Ring 18px (`border: 1.5px solid
rgba(255,255,255,.28)`), bei Auswahl gefuellter Punkt 8px `#8FB6E3` und Ring
`#8FB6E3`; Kachel-Rand `rgba(143,182,227,.45)`, Fuellung
`rgba(143,182,227,.10)`. Mitte Label (Sans 15px). Rechts Sprachcode in Mono
(11px, `rgba(255,255,255,.46)`). Tastaturbedienbar (echte `input[type=radio]`,
optisch versteckt, nicht `display:none` — `opacity:0; position:absolute`, damit
Fokus sichtbar bleibt).

`Save` als weisse Pille (`background:#fff`, Text `#0a2245`, `border-radius:999px`,
`padding: 12px 26px`, Sans 15px, `font-weight:600`). Bestaetigungstext
erscheint nach dem Speichern fuer 2600ms, danach ausblenden.

Alle weiteren vorhandenen Einstellungen (Einwilligungs-Schalter, private
Nummer) behalten ihr Markup und ihre Logik, bekommen nur dieselbe Optik:
`.perm-row` mit Trennlinie und Hover-Aufhellung, `.fld` als eingelassenes Feld.

## 10. Abschnitt Billing

Reihenfolge und Zustaende des Branches `feat/dashboard-neubau` bleiben
unveraendert (Status → Zahlungsmittel → Kontingent → Tarifwechsel → Kuendigung).
Nur die Optik:

- Statuszeile: Serif-Wert, Mono-Nebenangabe (Verlaengerungsdatum).
- **Minuten-Balken:** Trog `rgba(255,255,255,.10)`, Hoehe 8px,
  `border-radius: 999px`; Fuellung `linear-gradient(90deg,#8FB6E3,#cfe4fa)`,
  Breite aus dem bestehenden Kontingentwert. Darunter Mono-Zeile
  `93 of 120 minutes left`. Nur rendern, wenn ein Kontingent vorliegt.
- Zahlungsmittel-Karte: Kartensymbol als Inline-SVG (abgerundetes Rechteck mit
  Magnetstreifen) links, Text mittig, rechts Ghost-Knopf (weisser Rand, siehe
  Kopier-Knopf).
- Mono-Fussnote unter dem Abschnitt.
- Die Kuendigungs-Beschriftungen nach § 312k BGB bleiben **woertlich**
  unveraendert und unmittelbar erreichbar. Nicht umformulieren, nicht hinter
  einem zusaetzlichen Schritt verstecken.

## 11. Abschnitt Newsletter

Eigener Abschnitt `#newsletter` als vierter Nav-Eintrag. Die
Einwilligungs-Logik (Route, nie vorangekreuzt, Widerruf jederzeit,
Fehler setzt zurueck) bleibt exakt wie auf `feat/dashboard-neubau`.

Optik: Erklaertext, darunter je nach Zustand
- nicht angemeldet: Eingabefeld (eingelassenes Feld) + weisse Pille daneben;
- angemeldet: gruene Pille mit Punkt (`#7FE0B0`, Fuellung
  `rgba(127,224,176,.12)`, Rand `rgba(127,224,176,.40)`).

## 12. Abnahme

- `npm --prefix apps/web run build` laeuft durch.
- `npm --prefix apps/web test` gruen.
- `npm test` im Repo-Root gruen.
- Browser-Konsole ohne CSP-Verstoss.
- Kein `style="`-Attribut, kein `on*=`-Handler in geaenderten Dateien.
