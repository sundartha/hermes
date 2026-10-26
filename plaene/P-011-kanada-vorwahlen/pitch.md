# P-011 Zeitzonen-Vermutung für kanadische Vorwahlen

Status: freigegeben
Freigabe: Betreuung im Auftrag von Antonio 25.10.2026
Planung freigegeben: 5000000 Token
(Freigabe Antonio 26.10.2026, voller Neulauf nach 7 472 524 Token)
Issue: 2032
Design Doc: nein, weil die Änderung nur die Vorwahl-Tabelle in einer Datei erweitert, es nur einen ernsthaften Weg gibt und ein Revert sie ganz zurücknimmt.

## Absicht
Ein Anruf an eine kanadische Nummer, deren Vorwahl ganz in einer Zeitzone liegt, die Hermes schon kennt (Eastern, Central, Mountain, Pacific), bekommt dieselbe bestätigungspflichtige Zeitzonen-Vermutung wie eine US-Nummer, damit der Anrufagent Termine nicht ohne Zone aushandeln muss. Für US-Nummern, für Nummern ohne bekannte Vorwahl und für Vorwahlen über mehrere Zonen bleibt alles byte-gleich. Keine Abkürzung über neue Zonen (Atlantic, Neufundland, Saskatchewan) oder über die Land-Ableitung für +1. Im Zweifel bekommt eine Vorwahl keine Vermutung: keine Zone ist besser als eine falsche.

## Problem
Ein Kunde in Berlin lässt Hermes über `POST /api/calls` einen Friseur in Toronto (`+14165550147`) anrufen und einen Termin am Donnerstag ausmachen. Der Anrufagent bekommt heute in `callee_timezone` den Satz „You do not know which time zone the person you are calling is in, and you must not guess one. …“ und darf keine Uhrzeit nennen. Bei einem Friseur in New York (`+12125550147`) bekommt er dagegen „The person you are calling is probably in the America/New_York time zone. …“ und fragt „I have you down as Eastern time - is that right?“. Toronto liegt in derselben Zone wie New York.

## Ergebnis
Nach dieser Änderung bekommt der Anrufagent bei einem Anruf, den das Land-Gate durchlässt, an eine der 32 kanadischen Vorwahlen der Liste unter „Neue Begriffe“ in `callee_timezone` die Vermutung der Zone dieser Vorwahl mit ihrem gesprochenen Namen, etwa für `+14165550147` „probably in the America/New_York time zone“ und „I have you down as Eastern time - is that right?“.

## Grobe Lösung
Der Kunde merkt nichts; der Angerufene in Toronto, Winnipeg, Edmonton oder Vancouver hört statt einer ausweichenden Zeitangabe („tomorrow morning“) die kurze Rückfrage nach seiner Zone und danach eine konkrete Uhrzeit, genau wie heute ein Angerufener in den USA. Die Vorwahl-Tabelle, aus der die Vermutung für US-Nummern kommt, kennt danach auch die kanadischen Vorwahlen der Liste, je unter einer der vier vorhandenen Zonen. Der Satz an den Agenten, der gesprochene Zonenname und die Bestätigungspflicht vor jeder Uhrzeit bleiben, wie sie sind. Die Ableitung des Landes für +1-Nummern bleibt leer, die Vermutung entsteht weiter nur aus der Vorwahl.

## Fallen
- Vorwahlen, die Gebiete in einer zweiten Zone decken (807 Nordwest-Ontario Central; 418, 581, 367 mit Magdalenen-Inseln und Blanc-Sablon Atlantic; 250, 778, 236, 672, 257 mit Ost- und Nordost-BC Mountain; 867 Territorien): bekommen keine Vermutung, wie gemischte US-Vorwahlen (850, 915, 906) in der heutigen Tabelle.
- Zonen-Kennung: kanadische Vorwahlen tragen die vorhandenen Kennungen `America/New_York`, `America/Chicago`, `America/Denver`, `America/Los_Angeles`, nicht `America/Toronto` usw.; eine neue Kennung ohne gesprochenen Namen ergäbe „I have you down as America/Toronto“ (`src/elevenlabs/nanp-area-codes.js:93-95`, Rückfall auf die Kennung).
- Nummernblöcke in den Territorien, 403: Die Vorwahl 403 (Süd-Alberta, Calgary) hat einzelne Nummernblöcke regionaler Anbieter in den Territorien; Yukon gilt ganzjährig UTC-7 und führt das als „Mountain Standard Time“. Die Bestätigung, die der Agent vor jeder Uhrzeit verlangt (`src/elevenlabs/outbound.js:257-258`), fängt diesen Fall nicht ab, weil der Angerufene auf „I have you down as Mountain time - is that right?“ mit Ja antwortet, der Agent im Sommer aber nach `America/Denver` (UTC-6) rechnet. Entscheidung: 403 und die Überlagerungen, die 403 mitbedienen (587, 825, 368, Overlay für ganz Alberta), bekommen keine Vermutung; „Zone unbekannt“ ist dort sicherer als eine bestätigte falsche Zone. 780 (Nord-Alberta, Edmonton) bekommt Mountain, weil es nur Alberta bedient (Wikipedia „Area code 780“, gelesen 25.10.2026: alle Vermittlungsstellen in Alberta, Territorien nur bei 403 und 867 genannt).
- Nummernblöcke in den Territorien, 819: Die Vorwahl 819 (West-Quebec) und ihre Überlagerungen 873 und 468 haben einzelne Nummernblöcke regionaler Anbieter in den Territorien, die in einer anderen Zone liegen können. Entscheidung: hingenommen, weil der Agent die Vermutung vor jeder Uhrzeit bestätigen lässt (`src/elevenlabs/outbound.js:257-258`), dort ein anderer Zonenname gilt und 819/873/468 sonst West-Quebec verlören.
- Doppelte Vorwahl: Steht eine Vorwahl in zwei Zonen der Tabelle, gewinnt still die spätere. Keine der 55 kanadischen Vorwahlen (32 der Liste, 23 ausgelassen) steht heute in der Tabelle (nachgestellt 25.10.2026 am master 9294854).
- Abnahmetests: laufen über `POST /api/calls` und den Anrufstart am Anbieter; sie importieren kein internes Modul neu.

## Altfunktionen
- nicht berührt: `src/telephony/outbound-gates.js:makeOutboundGates`, weil die Änderung nur die Vorwahl-Tabelle in `src/elevenlabs/nanp-area-codes.js` erweitert; das Land-Gate steht in design.md und sicherheit.md nur als Beleg, dass Kanada und USA dasselbe Präfix `+1` haben
- nicht berührt: `src/telephony/outbound-gates.js:countryGateAllowed`, weil die Änderung nur die Vorwahl-Tabelle in `src/elevenlabs/nanp-area-codes.js` erweitert und das Land-Gate weder liest noch ändert (Nicht-Ziel Freigabe von +1)
- nicht berührt: `src/routes/api-calls.js:makeCallRoutes`, weil die Änderung nur die Vorwahl-Tabelle in `src/elevenlabs/nanp-area-codes.js` erweitert; die Route steht in sicherheit.md nur als Beleg, dass `originateCall` einen Aufrufer hat
- nicht berührt: `src/routes/api-calls.js:anonym ab Zeile 226`, weil die Änderung nur die Vorwahl-Tabelle in `src/elevenlabs/nanp-area-codes.js` erweitert; der Handler von `POST /api/calls` bleibt unverändert und ist nur der Eingang der Szenarien

## Anforderungen

### Regel R1: Eine kanadische Nummer, deren Vorwahl in der Liste steht, bekommt die Zonen-Vermutung der Zone dieser Vorwahl mit deren gesprochenem Namen.

#### Szenario S1: Toronto bekommt Eastern
Gegeben ein Auftraggeber mit Zone `Europe/Berlin`
Wenn er `POST /api/calls` mit `to: "+14165550147"` aufruft
Dann enthält `callee_timezone` beim Anrufstart am Anbieter „probably in the America/New_York time zone“ und „I have you down as Eastern time - is that right?“

#### Szenario S2: Winnipeg bekommt Central
Gegeben ein Auftraggeber mit Zone `Europe/Berlin`
Wenn er `POST /api/calls` mit `to: "+12045550147"` aufruft
Dann enthält `callee_timezone` beim Anrufstart am Anbieter „probably in the America/Chicago time zone“ und „I have you down as Central time - is that right?“

#### Szenario S3: Edmonton bekommt Mountain
Gegeben ein Auftraggeber mit Zone `Europe/Berlin`
Wenn er `POST /api/calls` mit `to: "+17805550147"` aufruft
Dann enthält `callee_timezone` beim Anrufstart am Anbieter „probably in the America/Denver time zone“ und „I have you down as Mountain time - is that right?“

#### Szenario S4: Vancouver bekommt Pacific
Gegeben ein Auftraggeber mit Zone `Europe/Berlin`
Wenn er `POST /api/calls` mit `to: "+16045550147"` aufruft
Dann enthält `callee_timezone` beim Anrufstart am Anbieter „probably in the America/Los_Angeles time zone“ und „I have you down as Pacific time - is that right?“

#### Szenario S5: jede Vorwahl der Liste bekommt ihre Zone
Gegeben ein Auftraggeber mit Zone `Europe/Berlin`
Wenn er `POST /api/calls` mit `to: "+1<Vorwahl>5550147"` für eine der 32 Vorwahlen der Liste unter „Neue Begriffe“ aufruft
Dann enthält `callee_timezone` beim Anrufstart am Anbieter für jede der 32 Vorwahlen „probably in the <Kennung> time zone“ und „I have you down as <Name> - is that right?“ mit Kennung und Name der Zone, unter der die Vorwahl in der Liste steht (Eastern: `America/New_York`, „Eastern time“; Central: `America/Chicago`, „Central time“; Mountain: `America/Denver`, „Mountain time“; Pacific: `America/Los_Angeles`, „Pacific time“)

## Bleibt unverändert

### Szenario B1: US-Nummer wie heute
Gegeben ein Auftraggeber mit Zone `Europe/Berlin`
Wenn er `POST /api/calls` mit `to: "+12125550147"` aufruft
Dann ist `callee_timezone` beim Anrufstart am Anbieter zeichengleich mit heute: „The person you are calling is probably in the America/New_York time zone. That is an assumption derived from their area code, it is not confirmed, and it may be wrong. Before you name any specific time, confirm it in one short sentence, for example: "I have you down as Eastern time - is that right?" Once they have confirmed it, convert every time you agree between those two zones and say which zone you mean.“ (mit führendem Zeilenumbruch)

### Szenario B2: unbekannte Vorwahl ohne Vermutung
Gegeben ein Auftraggeber mit Zone `Europe/Berlin`
Wenn er `POST /api/calls` mit `to: "+15555550147"` aufruft
Dann ist `callee_timezone` beim Anrufstart am Anbieter zeichengleich mit heute: „You do not know which time zone the person you are calling is in, and you must not guess one. Never name an absolute time while the zone is unknown - no specific time, no clock time. Stay vague instead ("tomorrow morning") and let them name the exact time; then repeat it back together with the time zone they used.“ (mit führendem Zeilenumbruch)

### Szenario B3: ausgelassene kanadische Vorwahlen ohne Vermutung
Gegeben ein Auftraggeber mit Zone `Europe/Berlin`
Wenn er `POST /api/calls` mit `to: "+1<Vorwahl>5550147"` für eine der 23 ausgelassenen kanadischen Vorwahlen aufruft: 807, 418, 581, 367, 250, 778, 236, 672, 257, 403, 587, 825, 368, 867, 306, 474, 639, 902, 782, 506, 428, 709, 879
Dann ist `callee_timezone` beim Anrufstart am Anbieter für jede dieser 23 Vorwahlen zeichengleich mit dem Satz aus B2

## Nicht-Ziele
- Nicht Teil dieser Änderung: neue Zonen Atlantic (902, 782, 506, 428), Neufundland (709, 879) und Saskatchewan ohne Sommerzeit (306, 474, 639), weil die Tabelle und die gesprochenen Namen heute nur Eastern, Central, Mountain, Arizona, Pacific und Hawaii kennen.
- Nicht Teil dieser Änderung: eine Land-Ableitung für +1-Nummern (Kanada oder USA), weil sie nach Owner-Entscheidung E2 bewusst leer bleibt.
- Nicht Teil dieser Änderung: eigene kanadische Zonen-Kennungen wie `America/Toronto` oder neue gesprochene Namen, weil die vorhandenen Kennungen dieselben Regeln haben.
- Nicht Teil dieser Änderung: die Freigabe von +1 im Land-Gate (`ALLOWED_COUNTRY_CODES`, Profilfeld `allowedCountryCodes`), weil das ein geschütztes Safety-Gate ist (CLAUDE.md, Absolute Regeln 1); der Blueprint setzt `+49,+33,+44` (`render.yaml:95-96`), die Vermutung wirkt erst, wenn der Betreiber +1 freigibt, bis dahin nur in der Testumgebung (`test/helpers.js:80`).
- Nicht Teil dieser Änderung: weitere US-Vorwahlen oder Änderungen an bestehenden US-Einträgen.

## Neue Begriffe
- Liste der kanadischen Vorwahlen (32): Eastern Ontario 416 647 437 942 905 289 365 742 613 343 753 519 226 548 382 705 249 683, Eastern Quebec 514 438 263 450 579 354 819 873 468; Central Manitoba 204 431 584; Mountain Alberta 780; Pacific British Columbia 604. Quelle: Wikipedia „Telephone numbers in Canada“ und „Area code 780“, gelesen 25.10.2026.

## Offene Fragen

### Vor dem Bau zu klären
keine

### Kann warten
- Atlantic, Neufundland und Saskatchewan als eigene Zonen mit gesprochenen Namen?
- Wechsel auf `America/Toronto`, `America/Winnipeg`, `America/Edmonton` und `America/Vancouver` mit gesprochenen Namen, sobald sich die Regeln dieser Zonen von denen der US-Zonen unterscheiden?

## Premortem
| Nr. | Grund | Ausgang |
|---|---|---|
| PM1 | Weil der Blueprint das Land-Gate auf `+49,+33,+44` setzt (`render.yaml:95-96`), kommt ein Kanada-Anruf im Betrieb gar nicht zum Anbieter, und die Folge ist, dass man die Änderung für wirksam hält und jemand das Land-Gate lockert, um sie „nutzbar“ zu machen. | Nicht-Ziel: Freigabe von +1 im Land-Gate |
| PM2 | Weil S1–S4 nur 4 der 32 Vorwahlen prüfen, bleibt eine fehlende, falsch einsortierte oder vertippte Vorwahl (etwa „415“ statt „416“, die dann still San Francisco überschreibt) unbemerkt, und die Folge sind Uhrzeiten, die eine Stunde oder mehr daneben liegen. | S5 |
| PM3 | Weil B3 nur 6 der 23 ausgelassenen Vorwahlen prüft, trägt der Bau die Überlagerungen 778, 236, 672, 257, 581, 367 leicht mit ein, und die Folge ist eine stille Vermutung „Pacific“ für eine 778-Nummer in Cranbrook (Mountain). | B3 (auf alle 23 erweitert) |
| PM4 | Weil Yukon-Nummernblöcke in 403 auf „Mountain time“ mit Ja antworten, der Agent im Sommer aber nach `America/Denver` rechnet, bestätigt der Angerufene eine falsche Zone, und die Folge ist ein Termin eine Stunde daneben. | B3 (403, 587, 825, 368 ausgelassen; S3 auf 780) |
| PM5 | Weil der Restfehler nur 403 und 819 nannte, fehlten die Überlagerungen 873 und 468 (zu 819) in der Entscheidung, und die Folge wäre, dass eine spätere Korrektur sie übersieht. | hingenommen: 819, 873 und 468 behalten Eastern, weil der Agent die Vermutung vor jeder Uhrzeit bestätigen lässt und in den Territorien dort ein anderer Zonenname gilt; Falle nennt alle drei |
| PM6 | Weil Ontario und BC eine ganzjährige Sommerzeit an Nachbarn koppeln, können `America/Toronto` und `America/New_York` (oder Vancouver und Los Angeles) auseinanderlaufen, und die Folge wäre eine bestätigte „Eastern time“, nach der der Agent falsch rechnet. | hingenommen: heute gelten dieselben Regeln, eine Abweichung entsteht erst mit einer Gesetzesänderung; Eintrag unter „Kann warten“ |
| PM7 | Weil der Satz an den Agenten die Kennung `America/New_York` nennt und er „say which zone you mean“ befolgt, kann er einem Angerufenen in Toronto „10 a.m. New York time“ sagen, und die Folge ist eine Rückfrage, die Gesprächszeit kostet. | hingenommen: bei US-Nummern außerhalb New Yorks gilt das heute genauso; den Satz zu ändern ist eine eigene Änderung an `src/elevenlabs/outbound.js` |
