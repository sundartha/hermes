# P-011 Zeitzonen-Vermutung für kanadische Vorwahlen: Sicherheitsprüfung

Status: freigegeben
Freigabe: Betreuung im Auftrag von Antonio 25.10.2026
Grundlage: pitch.md, design.md (hält nur die Ausgangslage fest, „Design Doc: nein“ im Pitch), Code-Stand 9294854

## Zur Freigabe
1. Die schwersten Angriffswege: keine, siehe Angriffswege. Entspricht das deiner Einschätzung?
2. Fehlt dir ein Angriffsweg, der dich beunruhigt?
3. Zu entscheiden: nichts, weil die Änderung keine Bedrohung öffnet und damit kein Ausgang zu wählen ist. Hinweis ohne Entscheidung: Die Vermutung wirkt im Betrieb erst, wenn +1 im Land-Gate freigegeben wird (Pitch, Nicht-Ziele, PM1). Diese Freigabe ist ein Eingriff in ein geschütztes Gate und braucht eine eigene Sicherheitsprüfung und rechtliche Prüfung; diese Prüfung hier deckt sie nicht ab.

## 1. Woran arbeiten wir
### Umfang
Geändert wird nur die feste Tabelle `AREA_CODES_BY_ZONE` in `src/elevenlabs/nanp-area-codes.js:13-66`: 32 kanadische Vorwahlen kommen unter die vier vorhandenen Zonen Eastern, Central, Mountain und Pacific (Pitch, Grobe Lösung und Neue Begriffe). Die Nachschlagefunktion `timezoneHypothesisForNumber` liest nur die drei Ziffern nach `+1` und schlägt sie in der daraus gebauten Map nach (`src/elevenlabs/nanp-area-codes.js:79-91`). Das Ergebnis ist eine von sechs festen Zonen-Kennungen oder leer. Es fließt nur in die Variable `callee_timezone` des ElevenLabs-Anrufstarts für ausgehende Anrufe (`src/elevenlabs/time-context.js:25-34`, `src/elevenlabs/outbound.js:262-266`, `:330`, `:436-439`, `:712-719`). Eine Suche nach `calleeZone` und `callee_timezone` in `src/` findet keine weitere Stelle: kein Gate, kein Werkzeug, kein Ergebnisfeld und kein Zeitplan liest die Zone. Satz, gesprochener Name, Land-Gate und Land-Ableitung bleiben, wie sie sind (Pitch, Bleibt unverändert und Nicht-Ziele).
### Beteiligte
- Kunde: angemeldet; wählt über `POST /api/calls` das Ziel `to`. Damit bestimmt er höchstens, welche der vier festen Zonen-Vermutungen der Anrufagent bekommt; eigenen Text kann er nicht einbringen.
- Agent des Kunden: ruft `prepare_call` und `place_call` mit dem Token des Kunden auf; hat dieselbe Wahl wie der Kunde, hinter dem Bestätigungscode (SG-10).
- Angerufener: hört die Rückfrage „I have you down as … time - is that right?“ und bestätigt oder berichtigt; heute nennt er im vagen Modus die Zone selbst (`src/elevenlabs/outbound.js:260`).
- Anrufer bei eingehenden Anrufen: nicht beteiligt, weil der eingehende Pfad die Zeitangaben ohne Gegenstelle bildet (`src/elevenlabs/inbound-initiation.js:31`, `:166`) und damit die Tabelle nie mit der Nummer des Anrufers befragt.
- ElevenLabs: bekommt `callee_timezone` beim Anrufstart; die Zielnummer bekommt es schon heute als `to_number` und als Variable `callee` (`src/elevenlabs/outbound.js:324`, `:437`).
- Telnyx, Stripe, WorkOS: nicht beteiligt.
- Betreiber: entscheidet über `ALLOWED_COUNTRY_CODES`; der Blueprint setzt `+49,+33,+44` (`render.yaml:95-96`), der Standard im Code ist derselbe (`src/config.js:630`). Ein Kunde kann +1 nicht selbst öffnen, weil das Profilfeld nur weiter einschränkt (`src/telephony/outbound-gates.js:170-174`).
### Eingänge und Grenzen
- `POST /api/calls` und die MCP-Werkzeuge `prepare_call`/`place_call`: vom Kunden oder seinem Agenten nach Hermes, angemeldet. Beleg: Pitch, Szenarien S1 bis S5; Gates vor dem Wählen in `src/telephony/outbound-gates.js:250-268`. Angriffswege: keiner, weil die Änderung an diesem Eingang nichts Neues annimmt. Das Ziel ist vor dem Anrufstart als E.164 geprüft (`src/telephony/outbound-gates.js:260`) und muss das Land-Gate passieren (`:261-266`); die Tabelle liest daraus nur drei Ziffern und liefert eine feste Kennung (`src/elevenlabs/nanp-area-codes.js:87-91`).
- Anrufstart bei ElevenLabs (Hermes nach ElevenLabs, ausgehend): der Inhalt von `callee_timezone` ändert sich für 32 Vorwahlen von einem festen Satz zu einem anderen festen Satz (`src/elevenlabs/outbound.js:257-260`). Beleg: `src/elevenlabs/outbound.js:330`, `:436-439`. Angriffswege: keiner, weil beide Sätze fest im Code stehen, nur aus einer der vorhandenen Kennungen gebildet werden und keine Angabe enthalten, die ElevenLabs nicht schon über die Zielnummer hat.
- Gespräch mit dem Angerufenen (Angerufener nach Anrufagent): Beleg: Prompt-Satz `src/elevenlabs/outbound.js:257-258`. Angriffswege: keiner, weil die Antwort des Angerufenen nur die Umrechnung von Uhrzeiten im Gespräch beeinflusst; der Anrufagent bekommt kein neues Werkzeug und keine neue Handlung (SG-11 unverändert).
- Eingehende Anrufe: keine Verbindung zur geänderten Tabelle (`src/elevenlabs/inbound-initiation.js:166`).
Keine neue Grenze; angesehen wurden der Weg vom Ziel `to` über die Gates zum Anrufstart, die Variablen an ElevenLabs und der eingehende Pfad.
### Werte
- Richtige Uhrzeit eines vereinbarten Termins für Kunde und Angerufenen: ein Qualitätswert. Eine falsche, aber bestätigte Zone kostet einen verpassten Termin; das behandelt der Pitch (Fallen, PM4, PM5).
- Das Land-Gate als geschütztes Gate (CLAUDE.md, Absolute Regeln 1): bleibt unberührt (Pitch, Nicht-Ziele).
- Der Offenlegungssatz: steht in `opening_line`, getrennt von `callee_timezone` (`src/elevenlabs/outbound.js:322`, `:330`), und bleibt unberührt.
### Wem wir was glauben
- Öffentlichen Nummerierungsdaten (Wikipedia, im Pitch unter Neue Begriffe genannt; amtlich ungeprüft, design.md, Ausgangslage Zeile 18): wir glauben, dass jede der 32 Vorwahlen ganz in der genannten Zone liegt; wenn nicht, fragt der Anrufagent nach der falschen Zone, und der Angerufene berichtigt sie, außer wenn der Zonenname gleich klingt und die Regeln abweichen. Diesen Fall hat der Pitch für 403 und seine Überlagerungen durch Weglassen gelöst und für 819, 873 und 468 hingenommen (Pitch, Fallen; PM4, PM5). Das ist eine Frage der Richtigkeit, keine Sicherheitsfolge, weil die Zone nichts auslöst außer einem Satz im Gespräch.
- ElevenLabs: keine neue Vertrauensannahme, weil es keine neue Angabe über den Angerufenen bekommt.
### Nicht-Ziele
- Diese Änderung schützt nicht gegen Kosten-, Ziel- und Rechtsrisiken einer Freigabe von +1 im Land-Gate, weil sie das Gate nicht anfasst (Pitch, Nicht-Ziele, PM1). Wer +1 freigibt, öffnet den ganzen Nummernraum +1, nicht nur Kanada und die USA; das gehört in eine eigene Prüfung dieser Freigabe, einschließlich der kanadischen Regeln für automatisierte Anrufe.
- Diese Änderung schützt nicht gegen falsche Zonen durch portierte Mobilnummern, weil Hermes keinen Eingang hat, der den heutigen Ort einer Nummer kennt; das gilt für US-Nummern heute genauso, und die Rückfrage vor jeder Uhrzeit fängt die meisten Fälle ab (`src/elevenlabs/outbound.js:257-258`).

## 2. Angriffswege
Keine Angriffswege gefunden, weil die Änderung nur feste Daten erweitert, die ein bereits geprüftes Ziel auf eine von vier festen Zonen abbilden, und die Zone nur einen festen Satz im Prompt des Anrufagenten wählt. Gesucht wurde je Beteiligtem und vom Ziel rückwärts:
- Kunde und Agent des Kunden: Sie bestimmen nur das Ziel. Ob, wohin und wie oft gewählt wird, entscheiden weiter die Gates vor dem Anrufstart (`src/telephony/outbound-gates.js:250-268`), die die Tabelle nicht lesen. Ein Ziel mit Sonderzeichen erreicht die Tabelle nicht (`src/telephony/outbound-gates.js:260`). Aus drei Ziffern entsteht nur eine der vorhandenen Kennungen (`src/elevenlabs/nanp-area-codes.js:6-11`, `:87-91`), also kein eigener Text im Prompt.
- Angerufener: Er kann die Vermutung bestätigen oder berichtigen. Das kann er heute im vagen Modus auch, weil der Agent dort die Zone wiederholt, die der Angerufene nennt (`src/elevenlabs/outbound.js:260`). Er bekommt dadurch keine neue Möglichkeit, den Agenten zu einer Handlung zu bringen.
- Anrufer bei eingehenden Anrufen: erreicht die Tabelle nicht (`src/elevenlabs/inbound-initiation.js:31`, `:166`).
- ElevenLabs: bekommt einen anderen festen Satz; die Zielnummer, aus der die Zone folgt, hat es schon (`src/elevenlabs/outbound.js:437`).
- Betreiber: Die Änderung gibt einen Anreiz, +1 freizugeben, öffnet aber selbst nichts (Pitch, PM1); siehe Nicht-Ziele.
- Rückwärts vom Ziel: Anrufe oder SMS auf unsere Kosten setzen eine Änderung an Gates oder Wählen voraus, die es nicht gibt. Fremde Daten setzen eine Kennung voraus, über die Mandantendaten gelesen werden; die Tabelle ist fest und mandantenlos. Ein Anruf, den niemand wollte, setzt voraus, dass die Zone einen Zeitpunkt zum Wählen bestimmt; kein Code in `src/` liest sie dafür. Hermes als Werkzeug gegen Dritte setzt eine neue Handlung oder einen täuschenden Inhalt voraus; die Offenlegung steht getrennt in `opening_line` (`src/elevenlabs/outbound.js:322`), und die Vermutung ist im Satz selbst als unsicher markiert (`src/elevenlabs/outbound.js:258`).
- Stille Annahmen: (a) Eine Vorwahl, die schon in der US-Tabelle steht, würde still überschrieben (Pitch, Fallen „Doppelte Vorwahl“); das ist durch S5 und B1 im Pitch abgedeckt und hätte nur eine falsche Zone zur Folge, keine Sicherheitsfolge. (b) Die Vorwahl sagt den Ort voraus; wenn nicht, folgt eine Rückfrage oder ein verpasster Termin (Pitch, PM4 bis PM6), keine Sicherheitsfolge.

## 3. Lückenprüfung
| Punkt | Ergebnis |
|---|---|
| H1 | trifft nicht zu, weil die Änderung weder das Ziel noch den Bestätigungscode berührt; die Zone entsteht erst nach dem Wählentscheid aus dem schon gewählten Ziel (`src/elevenlabs/outbound.js:712-719`) |
| H2, H3 | trifft nicht zu, weil die Änderung keinen Anruf und keine SMS auslöst und kein Gate die Zone liest; eine Rückfrage mehr im Gespräch bleibt unter Max-Gesprächsdauer und Kostendecke, die unverändert sind |
| H4 | trifft nicht zu, weil die Tabelle fest und mandantenlos ist und nur mit der Zielnummer des eigenen Anrufs befragt wird |
| H5, H13 | trifft nicht zu, weil die Änderung weder Tokens noch Schlüssel berührt |
| H6 | trifft nicht zu, weil die Antwort des Angerufenen nur die Umrechnung im Gespräch ändert; der Anrufagent bekommt kein neues Werkzeug (SG-11) |
| H7, H12 | trifft nicht zu, weil sich der Weg des Transkripts nicht ändert und keine neue Angabe gespeichert wird; im heutigen vagen Modus nennt der Angerufene seine Zone ebenso (`src/elevenlabs/outbound.js:260`) |
| H8 | trifft nicht zu, weil Offenlegung und KI-Kennzeichnung in `opening_line` getrennt bleiben (`src/elevenlabs/outbound.js:322`) und die Änderung keine Werbe- oder Täuschungsmöglichkeit schafft; kein Punkt für die rechtliche Prüfung dieser Änderung (die Freigabe von +1 wäre einer, siehe Nicht-Ziele) |
| H9 | trifft nicht zu, weil der eingehende Pfad die Tabelle ohne Gegenstelle befragt (`src/elevenlabs/inbound-initiation.js:166`) und nichts der Nummer eines eingehenden Anrufs glaubt |
| H10, H11 | trifft nicht zu, weil die Änderung weder Webhooks noch Aufrufe an Adressen von Kunden berührt |
| H14 | trifft nicht zu, weil kein Paket, kein Anbieter und kein Werkzeugtext dazukommt; der Prompt-Satz bleibt zeichengleich (Pitch, B1) |
| H15 | trifft nicht zu, weil die Änderung keinem Anbieter und dem Agenten des Kunden nichts Neues glaubt; die einzige Annahme betrifft Nummerierungsdaten, siehe „Wem wir was glauben“ |
| STRIDE an geänderten Grenzen | keine neue oder geänderte Grenze; am Anrufstart bei ElevenLabs ändert sich nur der Inhalt einer Variablen. Kein Weg in einer Kategorie, weil die Sätze fest im Code stehen (Tampering), aus Ziffern eines geprüften E.164-Ziels entstehen (`src/telephony/outbound-gates.js:260`), keine Angabe über die Zielnummer hinaus verraten (Information Disclosure, `src/elevenlabs/outbound.js:437`), in fester Zeit nachgeschlagen werden (Denial of Service) und kein Recht verleihen (Spoofing, Repudiation, Elevation of Privilege) |
| LINDDUN für die angerufene Person | trifft nicht zu, weil die Zone eine grobe Ableitung aus der Nummer ist, die Hermes, der Kunde und ElevenLabs schon haben, und weil der Angerufene im Transkript nicht mehr über sich preisgibt als heute, wo er die Zone im vagen Modus selbst nennt (`src/elevenlabs/outbound.js:260`) |

## 4. Offene Fragen
- Angenommen: Der Anrufagent fragt bei einer Vermutung nicht weiter nach dem Ort als im vagen Modus, sondern nur nach der Zone. Ändert: LINDDUN für die angerufene Person (dann käme mehr über den Aufenthaltsort ins Transkript als heute). Prüfen durch: ein Testgespräch mit Vermutung und eines ohne über `elevenlabs/testgespraeche/` vergleichen; das Verhalten ist für US-Nummern schon heute dasselbe.
- Angenommen: Jeder ausgehende Anrufstart bei ElevenLabs geht über die Gates in `src/telephony/outbound-gates.js` (geprüft nur für `POST /api/calls` laut Pitch). Ändert: keine Bewertung dieser Änderung, weil die Zone nur einen festen Satz wählt; nur die Aussage „wirkt erst nach Freigabe von +1“ (Pitch, Nicht-Ziele) hinge daran. Prüfen durch: alle Aufrufer von `originateCall` (`src/elevenlabs/outbound.js:712`) auf den Gate-Durchlauf zurückverfolgen.

## 5. Vorschlag für docs/sicherheitsgrenzen.md
Keiner, weil keine neue Grenze, kein neuer Eingang und keine neue Vertrauensannahme gegenüber Beteiligten entsteht; die Zeilen für `POST /api/calls`, `prepare_call` und `place_call` in der Angriffsfläche bleiben gültig.

## 6. Gegenprüfung
| Nr. | Art | Bezug | Befund mit Beleg | Übernommen als |
|---|---|---|---|---|

Nichts gefunden, weil die Prüfung keine T-n mit dem Ausgang „verhindern“ enthält, die man umgehen könnte, und der Angreifer im Code keinen Weg fand, auf dem die erweiterte Tabelle Geld, Anrufe, SMS oder fremde Daten berührt (Agent `angreifer`, 25.10.2026). Nachgelesen: einziger Leser der Tabelle `src/elevenlabs/time-context.js:31`, Ausgabe nur in `src/elevenlabs/outbound.js:257-266` und `callee_timezone` (`:330`); in den Satz kommt nur eine feste Kennung (`src/elevenlabs/nanp-area-codes.js:6-11`, `:87-91`); der eingehende Pfad fragt ohne Gegenstelle (`src/elevenlabs/inbound-initiation.js:166`). Zur zweiten offenen Frage: `originateCall` hat genau einen Aufrufer, den Handler von `POST /api/calls` (`src/routes/api-calls.js:333`, eingebunden `src/app.js:205`), nach dem Anlegen des Anrufs (`src/routes/api-calls.js:307-309`); die Frage ist damit beantwortet (Vorschlag in der Freigabeliste).
