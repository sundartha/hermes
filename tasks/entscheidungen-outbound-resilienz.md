# Entscheidungen: Outbound-Resilienz

**Stand: 2026-08-27.** Alle Fragen unten sind **offen** und warten auf dich, Antonio.

**Was passiert ist, in drei Saetzen.** Eine einzige Rufnummer war gleichzeitig zwei Dinge: die
Telefonnummer eines Test-Kontos **und** die Absendernummer, unter der unser Assistent ALLE
Anrufe rausschickt. Am 24.08. wurde das Test-Konto geloescht, die Nummer damit an den
Telefon-Anbieter zurueckgegeben — und seitdem lehnt der Anbieter jeden Anruf ab, weil die
Absendernummer uns nicht mehr gehoert. Drei Tage lang hat das niemand gemerkt, weil in dieser
Zeit niemand telefoniert hat.

**Wie du das hier liest.** Jede Frage hat eine **EMPFEHLUNG** (was ich vorschlage und warum) und
eine **GETROFFENE ANNAHME** (womit der Plan bis zu deiner Entscheidung weiterarbeitet). Du musst
nichts entscheiden, damit die Arbeit weitergeht — aber **F-1, F-6, F-7 und F-9 solltest du vor
dem ersten Schritt beantworten**, sie kosten Geld oder aendern etwas Grundlegendes.

Alle Preise in **USD**, so wie der Telefon-Anbieter sie abrechnet.

---

## F-1 — Wie machen wir den Outbound wieder heil, und mit welcher Nummer?

**Status: offen** | **Datum: 2026-08-27** | **Kostet Geld: ja (0 bis 3 USD)**

**Kontext.** Der Anbieter hat drei Nummern, die uns gehoeren: `+15804504874`, `+17067101188`,
`+18643028341`. Eine davon als neue Absendernummer einzutragen ist ein einziger Handgriff und
kostet nichts. Das Problem: mindestens eine dieser Nummern ist die Telefonnummer eines Kontos —
wir wuerden also genau den Zustand wiederherstellen, der den Ausfall verursacht hat, nur diesmal
mit einem Sicherheitsschloss davor.

**EMPFEHLUNG: eine EIGENE Nummer kaufen, die keinem Konto gehoert.**
Kosten: **1,00 USD einmalig + 2,00 USD pro Monat** (US-Nummer). Drei Gruende:

1. **Es beendet das Problem, statt es einzufrieren.** Solange die Absendernummer einem Konto
   gehoert, kann dieses Konto nie sauber gekuendigt werden — das Schloss wuerde die Kuendigung
   blockieren.
2. **Rueckrufe landen sonst beim falschen Menschen.** Wen unser Assistent anruft, der sieht die
   Absendernummer und ruft vielleicht zurueck. Heute landet dieser Rueckruf beim Assistenten des
   Kontos, dem die Nummer gehoert — samt Gespraechsmitschrift. Solange das dein eigenes Konto
   ist, ist das harmlos. Bei einem echten Kunden waere es ein Datenschutz-Vorfall.
3. **3 USD sind billiger als jeder Folgeschaden.**

Zur eigenen Nummer gehoert: **wer dort anruft, muss etwas hoeren** — eine Ansage oder eine
Weiterleitung. Eine Absendernummer, die ins Leere laeuft, ist eine halbe Loesung.

**GETROFFENE ANNAHME.** Der Plan beschreibt alle Wege. Vor jedem Handgriff steht eine
Pflicht-Pruefung: *"Gehoert die gewaehlte Nummer einem Kunden-Konto?"* — wenn ja, wird sie nicht
genommen. Die schnelle Variante mit einer vorhandenen Nummer ist ausdruecklich als
**Zwischenloesung** gekennzeichnet, nicht als Endzustand.

---

## F-2 — Eine Absendernummer fuer alle Kunden, oder je Kunde eine eigene?

**Status: offen** | **Datum: 2026-08-27** | **Kostet Geld: ja, spaeter (3,00 USD je Kunde im
ersten Monat, dann 2,00 USD/Monat je Kunde)**

**Kontext.** Heute gehen alle Anrufe aller Kunden unter derselben Nummer raus. Das hat drei
Probleme: der Angerufene kann nicht sinnvoll zurueckrufen; die EU verlangt fuer Anrufe in
Europa eine echte, erreichbare Absendernummer; und wenn ein einziger Kunde die Nummer durch
Missbrauch verbrennt, sind alle anderen mit gesperrt.

**EMPFEHLUNG: eine Nummer fuer alle bleibt bis zum Start — aber sie muss uns gehoeren und
erreichbar sein.** Der Umstieg auf "je Kunde eine eigene Nummer" wird gebaut, **wenn der erste
zahlende Fremdkunde live geht**, nicht vorher. Grund: solange wir die einzigen Nutzer sind,
kostet der Umstieg Geld und Arbeit und loest ein Problem, das wir noch nicht haben. Eine
deutsche Nummer (+49) ist uebrigens kein schneller Weg: das ist ein Behoerdenvorgang von
Wochen.

**GETROFFENE ANNAHME.** Der Plan baut in dieser Runde nur die **Ehrlichkeit**: das System
speichert kuenftig, unter welcher Nummer tatsaechlich angerufen wurde — und sagt "unbekannt",
wenn es das nicht weiss. Statt wie heute eine Nummer zu speichern, die gar nicht gesendet wurde.

---

## F-3 — Wie sollen wir dich alarmieren, wenn so etwas wieder passiert?

**Status: offen** | **Datum: 2026-08-27** | **Kostet Geld: praktisch nein (SMS ~0,05 USD je
Alarm, Mail kostenlos)**

**Kontext.** Heute gibt es genau einen Alarm-Weg: eine SMS. Diese SMS geht ueber **dasselbe
Telefon-Konto und dieselbe Nummern-Liste**, die beim Ausfall kaputt waren. Ein Alarm, den
derselbe Defekt mitreisst, ist kein Alarm. Und bei unserem Telefon-Guthaben gilt: ist es alle,
gehen auch keine Alarm-SMS mehr raus.

**EMPFEHLUNG: E-Mail wird der Haupt-Alarmweg, SMS bleibt als zweiter.** E-Mail haengt an keinem
Telefon-Anbieter, kostet nichts, und der Versandweg existiert schon. Zusaetzlich sollte das
System beim Start meckern, wenn **gar kein** Alarm-Empfaenger eingetragen ist.

**Was ich dazu von dir brauche:** eine E-Mail-Adresse fuer Betriebs-Alarme. Und bitte pruefen,
ob im Render-Dashboard ueberhaupt eine Alarm-Handynummer hinterlegt ist — das laesst sich von
hier aus nicht sehen.

**GETROFFENE ANNAHME.** Der Alarm laeuft in vier Stufen: Logbuch -> unloeschbarer Eintrag ->
E-Mail -> SMS. Ohne eingetragene E-Mail-Adresse faellt Stufe 3 einfach aus, alles andere laeuft.

---

## F-4 — Wer weckt den Waechter, wenn niemand telefoniert?

**Status: offen** | **Datum: 2026-08-27** | **Kostet Geld: nein**

**Kontext.** Der neue Waechter prueft regelmaessig, ob unsere Absendernummer noch uns gehoert.
Das Problem: unser Server schlaeft ein, wenn niemand ihn benutzt (das ist der Gratis-Tarif). Ein
schlafender Waechter prueft nichts. Genau deshalb lief der Ausfall drei Tage.

**EMPFEHLUNG: der Waechter laeuft zusaetzlich bei GitHub, stuendlich, automatisch.** Das kostet
nichts, laeuft ausserhalb unseres Servers und ausserhalb unserer Telefonie — also genau dort,
wo derselbe Defekt ihn nicht mitreissen kann. Wir haben das Werkzeug schon; es muss nur
zeitgesteuert werden.

**Was ich dazu von dir brauche:** die Zugangsschluessel fuer Telnyx und ElevenLabs muessen
im Code-Repository als "Secret" hinterlegt werden — **nur mit Lese-Rechten**. Ohne sie kann der
Waechter nichts pruefen.

**Ein Hinweis, den ich nicht verschweigen will:** genau dieser Mechanismus existiert schon
einmal fuer eine andere Pruefung — und er tut seit Monaten **nichts**, weil das Secret nie
hinterlegt wurde, und er meldet das nicht als Fehler, sondern als harmlose Warnung. Der neue
Waechter wird deshalb **rot**, wenn der Schluessel fehlt. Ein Waechter, dessen Untaetigkeit
gruen aussieht, ist schlimmer als keiner.

**GETROFFENE ANNAHME.** Der zeitgesteuerte GitHub-Lauf ist Teil der Bauarbeit, nicht "machen wir
spaeter mal von Hand". Zusaetzlich laeuft der Waechter bei jedem Aufwachen des Servers.

---

## F-5 — Darf das System Anrufe blockieren, die sicher scheitern wuerden?

**Status: offen** | **Datum: 2026-08-27** | **Kostet Geld: nein**

**Kontext.** Wenn der Waechter weiss, dass unsere Absendernummer uns nicht mehr gehoert, dann
weiss er auch: **jeder** Anruf wird scheitern. Er koennte den Anruf dann gar nicht erst starten
und stattdessen sofort eine klare Meldung geben. Das Risiko: wenn der Waechter sich irrt,
blockiert er einen bezahlten Kundenanruf.

**EMPFEHLUNG: erst beobachten, dann blockieren.** Die Blockade wird gebaut, aber
**ausgeschaltet** ausgeliefert. Nach einer Woche, in der der Waechter fehlerfrei gelaufen ist,
wird sie eingeschaltet. Zusaetzliche Sicherung: die Blockade greift nur, wenn die Messung
**frisch** ist (hoechstens 15 Minuten alt) und wenn eine sofortige Nachmessung sie bestaetigt.
Bei jeder Unsicherheit wird der Anruf durchgelassen.

**GETROFFENE ANNAHME.** Standard aus. Und: der grosse Not-Aus (`OUTBOUND_FROZEN`, der alle
Anrufe stoppt) wird **niemals automatisch** ausgeloest — das bleibt allein deine Entscheidung.
Ein Not-Aus, der sich selbst ausloest, killt das Produkt beim ersten Fehlalarm.

---

## F-6 — Umlaute in den neuen Fehlermeldungen?

**Status: offen** | **Datum: 2026-08-27** | **Kostet Geld: nein** | **Vor dem Bau zu klaeren**

**Kontext.** Es kommen neue deutsche Saetze dazu, die der Nutzer zu sehen bekommt ("Der Anruf
kam nicht zustande, weil…"). Die Datei, in der sie stehen, haelt ihre sechs bestehenden Saetze
absichtlich **ohne** Umlaute (also "koennen" in der ae/oe/ue-Schreibweise statt mit
Umlaut-Punkten), mit der Begruendung, sie wuerden
nie vorgelesen. Deine Regel im Projekt sagt aber: was der Nutzer liest, traegt echte Umlaute.

**EMPFEHLUNG: alle acht Saetze mit echten Umlauten**, und den irrefuehrenden Kommentar in der
Datei korrigieren. Es sind sechs zusaetzliche Zeilen Arbeit, und alle acht Saetze sind
nutzer-sichtbar.

**Was auf keinen Fall passieren sollte:** halb und halb. Eine Datei, in der sechs Saetze ohne und
zwei mit Umlauten stehen, ist die schlechteste aller Varianten — sie sieht nach Versehen aus,
und der Kommentar am Dateianfang waere dann schlicht falsch.

**GETROFFENE ANNAHME.** Bis zu deiner Entscheidung wird nichts gebaut, was die Datei
uneinheitlich macht.

---

## F-7 — Guthaben auffuellen?

**Status: offen** | **Datum: 2026-08-27** | **Kostet Geld: ja (Betrag deine Wahl)**

**Kontext.** Zwei Konten sind knapp bzw. leer:
- **Telnyx (Telefonie): 3,09 USD.** Es gibt keinen Ueberziehungsrahmen — bei Null ist Schluss,
  und dann gehen auch die Alarm-SMS nicht mehr raus.
- **DeepSeek (die KI, die das Gespraech fuehrt): leer.** Sie meldete am 27.08. woertlich
  "Insufficient Balance". Der Anruf lief trotzdem weiter, weil eine Ersatz-Logik griff — aber
  das ist Glueck, kein Plan.

**EMPFEHLUNG: beides vor dem Test-Anruf auffuellen.** Sonst scheitert der Test-Anruf aus einem
**zweiten**, unabhaengigen Grund, und du weisst hinterher nicht, ob die Reparatur funktioniert
hat. Beim Telefon-Guthaben lohnt es sich, statt eines festen Betrags zu fragen: "wie lange
reicht das bei aktuellem Verbrauch?" — der Waechter warnt kuenftig genau so (unter 72 Stunden
Reichweite), nicht bei einem starren Betrag.

**GETROFFENE ANNAHME.** Im Plan als Voraussetzung dokumentiert, nicht ausgefuehrt. Blockiert
keine der Bau-Etappen, nur den abschliessenden Test-Anruf.

---

## F-8 — Darf eine Kuendigung haengen bleiben, wenn die Nummer noch gebraucht wird?

**Status: offen** | **Datum: 2026-08-27** | **Kostet Geld: ja, indirekt (2,00 USD/Monat je
haengender Nummer)**

**Kontext.** Das neue Sicherheitsschloss verhindert, dass eine Nummer freigegeben wird, solange
sie als Absendernummer in Benutzung ist. Wenn ausgerechnet ein kuendigender Kunde diese Nummer
hat, bleibt die Rueckgabe stehen, bis jemand eingreift — und die Monatsmiete laeuft weiter.

**Wichtig, damit hier kein falscher Eindruck entsteht:** die **persoenlichen Daten** des Kunden
werden trotzdem vollstaendig geloescht (Gespraeche, Notizen, Kontaktdaten). Die
DSGVO-Loeschpflicht ist erfuellt. Offen bleibt allein die **Rueckgabe der Rufnummer** an den
Anbieter — also eine Kosten- und Betriebsfrage, kein Rechtsproblem.

**EMPFEHLUNG: ja, mit Krach.** Lieber eine haengende Nummern-Rueckgabe als ein
Produkt-Totalausfall. Aber: der Zustand wird protokolliert, und **wenn er laenger als 24 Stunden
besteht, bekommst du eine Meldung**. Ohne diese Meldung waere es wieder genau die Krankheit vom
27.08.: etwas ist kaputt und niemand erfaehrt es.

**Und der beste Ausweg:** wenn die Absendernummer eine eigene Nummer ohne Kundenbezug ist (F-1),
tritt dieser Fall nie ein.

**GETROFFENE ANNAHME.** Haengen erlaubt, mit Protokoll und 24-Stunden-Eskalation.

---

## F-9 — Soll eine zurueckgegebene Nummer wieder kaufbar sein?

**Status: offen** | **Datum: 2026-08-27** | **Kostet Geld: nein**

**Kontext.** Bei der Pruefung ist ein bisher unbekannter Fehler aufgefallen: **eine einmal
zurueckgegebene Nummer kann heute nicht wieder gekauft werden.** Unsere Datenbank haelt die
Nummer an der alten, erledigten Zeile fest; ein erneuter Kauf derselben Nummer scheitert dann
mit einer technischen Fehlermeldung, die auf nichts Sichtbares zeigt.

**Warum dich das jetzt betrifft:** der naheliegendste Wunsch nach diesem Ausfall waere *"holen
wir einfach die alte Nummer +1573… zurueck"*. Das geht heute nicht.

**EMPFEHLUNG: ja, in dieser Runde mitreparieren.** Der Fix ist klein — bei der Rueckgabe wird
die Nummer aus der alten Zeile entfernt; die Historie "wer hatte wann welche Nummer" bleibt an
anderer Stelle vollstaendig erhalten.

**GETROFFENE ANNAHME.** Der Fix ist Teil der ersten Bau-Etappe. Wenn du ihn nicht willst, wird
"alte Nummer zurueckholen" ausdruecklich als **nicht verfuegbarer Weg** dokumentiert.

---

## Was NUR du tun kannst (Zusammenfassung)

| Aktion | Kosten | Wann |
|---|---|---|
| Absendernummer beim Anbieter umstellen (Schreibzugriff im Telnyx-Portal) | 0 USD | vor allem anderen |
| Eine eigene Plattform-Nummer kaufen (empfohlen) | 1,00 USD + 2,00 USD/Monat | mit dem Umstellen |
| `PLATFORM_ANI_E164` im Render-Dashboard setzen | 0 USD | **bevor** die erste Bau-Etappe live geht |
| Telefon-Guthaben auffuellen | deine Wahl | vor dem Test-Anruf |
| DeepSeek-Guthaben auffuellen | deine Wahl | vor dem Test-Anruf |
| Alarm-E-Mail-Adresse festlegen; Alarm-Handynummer im Dashboard pruefen | 0 USD | mit Etappe "Alarm" |
| Lese-Zugangsschluessel als GitHub-Secrets hinterlegen | 0 USD | mit Etappe "Waechter" |
| Einen echten Test-Anruf machen | wenige Cent | ganz am Ende |
