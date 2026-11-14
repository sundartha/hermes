# Belege Anruf-Widget kompakt (#4397)

Bilder: `vorher-nachher-nacht.jpg` und `vorher-nachher-stein.jpg`. Links steht jeweils das ausgelieferte Anruf-Widget auf master (`b2ba70f0`), rechts der Stand dieses PR (`595fbc8`), beide aus `ausgelieferteWidgets()`, geladen in einem Host-Rahmen mit Beispielwerten, Breite 530 px, Sprache `de-DE`, Chrome headless. Das Thema kommt aus `@media (prefers-color-scheme:light)`, im Beleg durch Ersetzen der Bedingung (`all` für Stein, `not all` für Nacht) erzwungen. Übergänge und Animationen sind im Beleg abgeschaltet, damit der Endzustand sichtbar ist.

Zeilen: Wählen (`dialing`), Live (`in_progress`, 1:23), Ende (`completed`, 3:32, Zusammenfassung mit 1500 Zeichen).

## Befunde im Bild

- Ende: Die Ergebniszeile ist nachher auf 120 px begrenzt und scrollt, die Karte bleibt kompakt; vorher wächst sie mit dem Text auf ein Mehrfaches.
- Flügel: Im hellen Thema ist er nachher marmorweiß (vorher schwarz). Auf dem hellen Grund `#e8e0d4` ist er blass, aber erkennbar.
- Timer und Pille: 96 mal 44 px, 16 px, Gewicht 400. Die fertige Pille ist nachher `#f2ece3` mit Text `#15130f` und auf dem hellen Grund erkennbar (vorher schwarz).
- Offen (Folge-Issue #4406): Der Live-Timer erbt im hellen Thema die dunkle Textfarbe; die Weißlogik gilt nur für die fertige Pille.
