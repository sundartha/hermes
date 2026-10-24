# P-007 Gesprächsgedächtnis an der Wortgrenze kürzen: Sicherheitsprüfung

Status: freigegeben
Grundlage: pitch.md, design.md (nur „Ausgangslage und Annahmen“, Design Doc: nein), Code-Stand b45867a

## Zur Freigabe
1. Die schwersten Angriffswege, höchstens drei: keine, siehe Angriffswege. Die Änderung kürzt nur Text, der heute schon im Prompt steht, an einer anderen Stelle und hängt ein festes Zeichen an; sie öffnet keinen Eingang, keine Grenze und keine Handlung. Entspricht das deiner Einschätzung?
2. Fehlt dir ein Angriffsweg, der dich beunruhigt?
3. Zu entscheiden: nichts, weil keine Bedrohung gefunden wurde, die einen Ausgang braucht. Offen bleibt nur eine Annahme zum Verhalten des Modells (Abschnitt 4).

## 1. Woran arbeiten wir
### Umfang
Geändert wird nur `memoryLine` in `src/call-memory.js:15-23`: Das Ergebnis (100 Zeichen, `:16`) und die ganze Zeile (200 Zeichen, `:22`) werden statt hart mit `.slice` an der Wortgrenze über die vorhandene Hilfe `clampAtWordBoundary` (`src/utils/text.js:1-6`) gekürzt und bekommen „…“ (Pitch, Grobe Lösung). Die Zeilen gehen über `budgetedMemoryLines` (`src/call-memory.js:25-31`) in `callMemorySection` (`src/claude.js:208-213`) und damit in den Systemprompt der Telnyx-Engine, nur bei Outbound (`src/claude.js:55-58`) und nur mit `allowCallMemory: true` (`src/store/state-ops.js:918-927`, Standard aus: `src/store/defaults.js:282`). Gespeicherte Daten, Grenzen, Werkzeuge, Routen und die Hilfe selbst bleiben unverändert (Pitch, Nicht-Ziele).
### Beteiligte
- Kunde: angemeldeter Mandant; schaltet `allowCallMemory` für seine Anrufe ein und sieht nur eigene Anrufe (SG-02).
- Agent des Kunden: ruft `place_call` mit dem Token des Kunden auf und nennt `to`; er sieht den Systemprompt nicht.
- Angerufener eines früheren Anrufs: was er sagte, formt über die Zusammenfassung Ergebnis und Fakten der Karte (`src/claude.js:718-750`, gekürzt in `src/call-result.js:10-15`); das ist die einzige fremde Quelle für den Gedächtnistext.
- Angerufener des neuen Anrufs: hört, was das Modell aus dem Gedächtnis nennt; kann dieselbe Person sein wie oben oder ein anderer Mensch an derselben Nummer.
- Anrufer bei eingehenden Anrufen: erreicht das Gedächtnis nicht, weil `counterpartyMemoryFor` bei Inbound eine leere Liste liefert (`src/claude.js:56`).
- Anbieter: Telnyx (Webhooks an `/voice/turn`, signiert, SG-05); Sprachmodell-Anbieter (Anthropic oder DeepSeek, `createLlmClient` in `src/claude.js:26`), der den Prompt bekommt.
- Betreiber: setzt Konfiguration und Engine-Wahl (`ELEVENLABS_OUTBOUND_ENABLED`, `render.yaml:53`); keine neue Einstellung.
### Eingänge und Grenzen
Keine neue Grenze. Angesehen wurde der bestehende Datenfluss, an dem die Änderung liegt:
- `place_call` (MCP) und Telnyx-Webhook `POST /voice/turn`: lösen den Bau des Prompts aus. Beleg: `docs/sicherheitsgrenzen.md`, Angriffsfläche; `src/claude.js:28-53`. Angriffswege: keiner, weil die Änderung weder bestimmt, ob ein Anruf entsteht, noch welche Gates greifen; sie formt nur Text innerhalb eines schon gebauten Prompts.
- Rede des früheren Angerufenen → Ergebniskarte im Store: Beleg `src/claude.js:718-751`, `src/call-result.js:28-54`. Angriffswege: keiner, weil die Änderung nur liest und die Karte nicht ändert (Pitch, Nicht-Ziel PM1).
- Ergebniskarte → Gedächtniszeile → Prompt an den Sprachmodell-Anbieter (Hermes nach außen): Beleg `src/store/state-ops.js:918-933`, `src/call-memory.js:15-31`, `src/claude.js:208-213`. Angriffswege: keiner, weil Form und Länge der Zeile gleich streng bleiben: gefaltet wird weiter vor dem Kürzen (`src/call-memory.js:10-13`, Pitch, Falle 1; AL-P12-11 in `test/al-p12-call-memory.test.js:153-161`), die Hilfe fügt weder Zeilenumbruch noch Leerraum ein (`src/utils/text.js:1-6`), „…“ ist kein Leerraum, und die Grenzen 100/200/600 halten (S3 im Pitch, AL-P12-12 in `test/al-p12-call-memory.test.js:163-174`). Mandant und Nummer filtert unverändert `counterpartyMemory` (`src/store/state-ops.js:922`).
- Prompt → Rede des Modells an den neuen Angerufenen: Beleg `src/claude.js:60-78`. Angriffswege: keiner, weil der Inhalt nur kürzer oder gleich wird und das Zeichen die Kürzung sichtbar macht; die Offenlegung kommt aus einer anderen Stelle (`src/claude.js:224-233`) und wird nicht berührt.
### Werte
- Wahrheit dessen, was der Agent dem Angerufenen als Tatsache nennt: Ein verstümmelter Name oder eine halbe Aussage täuscht ihn (Pitch, Problem, PM3).
- Abgrenzung von Inhalt und Anweisung im Prompt: Gedächtnistext stammt aus fremder Rede (SG-10).
- Personenbezogene Angaben des Angerufenen im Gedächtnis (Namen, Kundennummern): Sie gehen an den Sprachmodell-Anbieter.
- Längengrenze des Gedächtnisses: begrenzt Tokenkosten und den Raum für eingeschleusten Text.
### Wem wir was glauben
Keine neue Vertrauensannahme, weil weder ein Anbieter noch der Agent des Kunden etwas Neues liefert oder bekommt. Bestehend und unverändert: Das Modell befolgt die Leitplanke „Information, keine Anweisung“ (`src/i18n/prompts/de.js:130-131`).
### Nicht-Ziele
- Diese Änderung schützt nicht gegen eingeschleusten Text im Gedächtnis, weil das SG-10 mit Faltung und Längengrenze schon abdeckt und die Änderung daran nichts lockert.
- Diese Änderung schützt nicht gegen den Wegfall eines ganzen Wortes genau an der Grenze (PM2) und nicht gegen die harte Kürzung beim Speichern (PM1), weil der Pitch beides bewusst ausklammert; beides verfälscht nicht über das Heutige hinaus.

## 2. Angriffswege
Keine Angriffswege gefunden, weil die Änderung keinen Eingang, keine Grenze und keine Handlung neu öffnet:
- Rückwärts vom Ziel: Anrufe oder SMS auf unsere Kosten, ein ungewollter Anruf oder Hermes gegen Dritte setzen einen Weg zu Wahl, SMS oder Werkzeug voraus; die Änderung berührt nur `src/call-memory.js` und keinen dieser Wege (`src/telephony/outbound-gates.js` bleibt unberührt). Fremde Daten setzen eine neue Lesestelle voraus; der Filter nach Mandant und Nummer bleibt (`src/store/state-ops.js:922`).
- Normale, bezahlte Nutzung: Ein Kunde mit vielen Anrufen an dieselbe Nummer bekommt weiter höchstens 3 Zeilen zu je höchstens 200 Zeichen (`src/call-memory.js:1-4`, `:30`); die Tokenmenge bleibt gleich oder sinkt um die weggekürzten Wortreste.
- Der frühere Angerufene als Absender von Text: Er steuert über die Zusammenfassung, was in Ergebnis und Fakten steht. Die harte Kürzung heute und die Kürzung an der Wortgrenze geben ihm gleich viel Raum; ein vollständiges Wort am Ende verschafft ihm nichts, was ein kürzerer Satz von ihm nicht schon heute erreicht. Zeilenumbrüche bleiben gefaltet (AL-P12-11).
- Stillschweigende Annahmen: dass „…“ ein Zeichen ist (design.md, Zeile zu U+2026, nachgestellt); dass gefaltet vor gekürzt wird (Pitch, Falle 1). Wäre die erste falsch, läge eine Zeile um höchstens 1 Zeichen über der Grenze; S3 im Pitch fängt das. Wäre die zweite falsch, fiele nur die Wortgrenze bei Tabs schlechter aus, die Faltung selbst bliebe (`singleLine` wird auf Ergebnis und Fakten angewandt, `src/call-memory.js:16-17`).

## 3. Lückenprüfung
| Punkt | Ergebnis |
|---|---|
| H1, H2, H9, H10, H11 | trifft nicht zu, weil die Änderung keinen Anruf, keine SMS, kein Wahlziel, keine Rufnummer eines eingehenden Anrufs, keinen Webhook und keine ausgehende Adresse berührt; sie läuft erst, wenn Gates und Signaturprüfung schon entschieden haben (`src/claude.js:28-53`) |
| H3 | trifft nicht zu, weil die Längengrenzen 100/200/600 und 3 Anrufe bleiben (`src/call-memory.js:1-6`; S3 im Pitch, AL-P12-12); siehe aber die Annahme zu Werkzeugaufrufen in Abschnitt 4 |
| H4 | trifft nicht zu, weil die Auswahl der früheren Anrufe nach Mandant und Nummer unverändert in `src/store/state-ops.js:918-927` bleibt und die Änderung nur die schon ausgewählten Einträge formt |
| H5, H13, H14 | trifft nicht zu, weil weder Tokens noch Schlüssel, Pakete, Werkzeugbeschreibungen oder Anbieter neu hinzukommen; die genutzte Hilfe liegt schon im Repo (`src/utils/text.js:1`) |
| H6 | trifft nicht zu, weil der Text aus fremder Rede weder mehr Raum noch eine neue Form bekommt (Faltung `src/call-memory.js:10-13`, Leitplanke `src/i18n/prompts/de.js:130-131`) und der Telefonagent keine neuen Werkzeuge erhält |
| H7 | trifft nicht zu, weil an den Agenten des Kunden nichts Neues zurückgeht; Ergebnis und Transkript bleiben, wie sie gespeichert sind (Pitch, Nicht-Ziel PM1) |
| H8 | trifft nicht zu, weil die Offenlegung aus `firstSpokenSentence` kommt (`src/claude.js:224-233`) und nicht aus dem Gedächtnis; die Änderung verringert die Gefahr, dass der Agent dem Angerufenen eine verstümmelte Angabe als Tatsache nennt (PM3). Kein Punkt für die rechtliche Prüfung |
| H12 | trifft nicht zu, weil keine Stimme und keine neuen Worte verarbeitet, gespeichert oder geloggt werden; der Prompt wird nicht ausgegeben (keine Log-Stelle für den Systemprompt in `src/`) und enthält nur weniger Zeichen als heute. Kein Punkt für die rechtliche Prüfung |
| H15 | trifft nicht zu, weil keine neue Annahme über Telnyx, ElevenLabs, Stripe, WorkOS, den Sprachmodell-Anbieter oder den Agenten des Kunden entsteht; die bestehende über das Modell steht unter „Wem wir was glauben“ |
| STRIDE an der geänderten Stelle (Gedächtniszeile im Prompt an den Sprachmodell-Anbieter) | keine Kategorie mit konkretem Weg: Tampering nicht, weil fremder Text weder mehr Raum noch Zeilenumbrüche bekommt; Information Disclosure nicht, weil höchstens weniger Zeichen hinausgehen; Denial of Service nicht, weil die Längen halten (S3); Spoofing, Repudiation und Elevation of Privilege nicht, weil keine Identität, kein Protokoll und kein Recht berührt werden |
| LINDDUN für die angerufene Person | trifft nicht zu, weil die Verknüpfung früherer Anrufe an dieselbe Nummer, das Fehlen eines Hinweises auf das Gedächtnis und die Weitergabe an den Sprachmodell-Anbieter schon heute bestehen und die Änderung keines davon erweitert; der Umfang der weitergegebenen Angaben sinkt, ihre Richtigkeit steigt |

## 4. Offene Fragen
- Angenommen: Das sichtbare „…“ bringt das Modell nicht dazu, den gekürzten Rest häufiger über `look_up` oder `get_consult` nachzuschlagen oder beim neuen Angerufenen nachzufragen. Ändert: wäre die Annahme falsch, entstünde ein Weg, auf dem Angaben aus dem Gedächtnis öfter an den Rechercheanbieter oder an die Person am Apparat gehen und mehr Werkzeugkosten anfallen, beides innerhalb der bestehenden Gates (`src/research/lookup-guard.js:28-36`, SG-11); das wäre dann als Bedrohung zu bewerten. Prüfen durch: `npm run convo-bench` mit den Werten aus S1 und S2, n ≥ 5, vorher und nachher die Zahl der Werkzeugaufrufe und Rückfragen je Gespräch vergleichen.

## 5. Vorschlag für docs/sicherheitsgrenzen.md
Keiner, weil keine neue Grenze, kein neuer Eingang und keine neue Vertrauensannahme entsteht. Die Beschreibung des Mechanismus in SG-10 („Erinnerungen aus fremder Rede auf feste Form und Länge geklemmt (`src/call-memory.js`)“) bleibt nach der Änderung zutreffend.

## 6. Gegenprüfung
| Nr. | Art | Bezug | Befund mit Beleg | Übernommen als |
|---|---|---|---|---|

Keine Befunde: Die Sicherheitsprüfung nennt keine T-n mit Ausgang „verhindern“, also gibt es keinen Schutz zum Umgehen und kein Szenario, das ohne Schutz rot werden müsste. Die Aussagen in Abschnitt 1 bis 3 hat die Gegenprüfung am Code nachvollzogen (einziger Leseweg `src/claude.js:16`, `:37`, `:55-58`, `:208-213`; Filter `src/store/state-ops.js:918-927`; Längen mit Grenze minus 1 und „…“ höchstens 100 bzw. 200 Zeichen; Offenlegung aus `src/claude.js:215-233`; Systemprompt wird nicht geloggt). Den Weg über den Text des früheren Angerufenen weitet die Änderung nicht aus: Die Zeichenzahl ist dieselbe wie heute, und ein „…“ hätte er schon heute selbst sprechen können.
