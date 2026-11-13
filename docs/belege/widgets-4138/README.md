# Belege Widget-Neuentwurf (#4138)

Bilder: `vorschau-gegen-umsetzung-nacht.jpg` und `vorschau-gegen-umsetzung-stein.jpg`. Links steht jeweils `vorschau.html` des Entwurfs, rechts das ausgelieferte Widget (`ausgelieferteWidgets()`), geladen in einem Host-Rahmen mit Beispielwerten, Breite 530 px, Sprache `de`, Chrome headless, Thema über `prefers-color-scheme`. Zeilen: call dial, live, done, fail, cancel, calls, agent-status, my-number.

## Abgleich der offenen Punkte der README des Entwurfs

| Punkt | Stand |
|---|---|
| Name und Auftrag im Anruf-Widget | Die Werkzeuge liefern beides nicht; die Überschrift fällt auf die Fassung ohne Gegenüber zurück („Hermes ruft an.“), die Auftragszeile bleibt beim Wählen leer. Kein neues Feld (Plan #4138). |
| Rufnummer im Fuß des Anruf-Widgets | Kommt nicht im Ergebnis an; der Fuß zeigt nur den Knopf. |
| Überschrift der Liste, Anzahl | Aus der Länge von `calls`; die Uhrzeit zeigt den vom Server gelieferten Text `startedAt`. |
| Sprachen | de, en, fr über `WIDGET_DICT`. |
| Lange Inhalte, leere Zustände | Durch die Tests der Häppchen 2 bis 5 geprüft; im Bild nicht einzeln gezeigt. |
| Schriften | Das Widget lädt keine Schriften selbst; im Beleg hat der Host sie von Google Fonts nachgeladen. |
| Schmale Breite unter 400 px, Glas außerhalb von Chrome | nicht geprüft (Nicht-Ziel). |

## Abweichungen im Bild

- Verbindungszeile, Pille, Flügel, Karten, Glas, Licht und Linien stimmen in beiden Themen und allen fünf Zuständen mit der Vorschau überein.
- Unterschiede im Text kommen aus den Beispieldaten des Belegs, nicht aus dem Aufbau (Name, Auftrag und Nummer fehlen, siehe oben; Beispiel-Anruflisten und -Status sind andere Werte).
- Zeichenfehler bei Umlauten im Beleg stammen aus der Seite des Belegs (Host ohne Zeichensatz), nicht aus dem Widget.
