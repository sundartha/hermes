# Anruf-Inbox - Ergebnis (2026-08-21)

Eine Seite fuer Antonio. Ohne Fachbegriffe.

## Was jetzt geht

- Ruft jemand auf der Hermes-Nummer an und sagt wirklich etwas, entsteht nach dem
  Auflegen automatisch ein Eintrag: wer angerufen hat, was die Person wollte, was
  im Gespraech zugesagt wurde und was jetzt zu tun ist.
- Ein angeschlossener KI-Assistent (z.B. Claude) kann jederzeit nachschauen:
  "Gibt es neue Anrufe?" Die Antwort ist entweder die Liste der neuen Eintraege
  oder ein klares, kurzes "Nichts Neues".
- Einmal Abgeholtes wird nicht noch einmal als neu gemeldet - egal, von welchem
  Geraet oder aus welcher Sitzung gefragt wird.
- Anrufe, bei denen niemand etwas gesagt hat (z.B. sofort aufgelegt), erzeugen
  KEINEN Eintrag.
- Datenschutz: Nur das Ergebnis des Gespraechs verlaesst das System, nie der
  Wortlaut. In den technischen Protokollen stehen weder Telefonnummern noch
  Gespraechsinhalte, nur Zaehler.

## Wie der Nachweis lief

- 5111 automatische Pruefungen laufen gruen, darunter neue Pruefungen speziell
  fuer dieses Feature (u.a.: die Liste der Felder, die einen Eintrag verlassen
  duerfen, ist exakt festgeschrieben - kommt je ein Feld dazu, schlaegt die
  Pruefung Alarm).
- Drei Generalproben am laufenden, lokal gestarteten System:
  1. Nachgestellter Anruf mit einer Rueckruf-Bitte -> der Eintrag entstand.
     Dabei war die Zusammenfassungs-KI absichtlich abgeklemmt: der Eintrag
     entstand TROTZDEM und traegt den Hinweis "Zusammenfassung nicht verfuegbar"
     - ein Anruf geht also auch bei einer Stoerung nicht verloren.
  2. Abfrage aus einem angeschlossenen Assistenten -> lieferte genau diesen
     Eintrag (richtige Anrufernummer, kein Gespraechs-Wortlaut). Die zweite
     Abfrage direkt danach meldete kurz und eindeutig: "No new calls."
  3. Nachgestellter Anruf, bei dem der Anrufer nichts sagte -> kein Eintrag,
     auch nicht auf ausdrueckliche Nachfrage nach bereits gesehenen Eintraegen.
- Jede der drei Bau-Etappen wurde von zwei unabhaengigen Pruefern kontrolliert
  (einer fuer Sicherheit/Verhalten, einer fuer Code-Qualitaet), die alle Belege
  selbst nachgefahren haben. Gefundene Maengel wurden behoben und erneut
  geprueft, bevor etwas uebernommen wurde.

## Was offen blieb

1. Der letzte Beweis mit einem ECHTEN Telefonanruf auf der echten Nummer steht
   aus. Dafuer muss der neue Stand online gestellt werden und jemand kurz
   anrufen. Empfehlung: online stellen, vom Handy die Hermes-Nummer anrufen,
   etwas sagen (z.B. eine Rueckruf-Bitte), danach in Claude nach neuen Anrufen
   fragen. Kosten: wenige Cent. Details: Frage F-10 in
   .fortschritt/entscheidungen.md.
2. Zehn Entscheidungsfragen sind mit Empfehlung und getroffener Annahme in
   .fortschritt/entscheidungen.md gesammelt (z.B. Formulierungen, wie viele
   Eintraege pro Abfrage). Die Arbeit lief mit den Empfehlungen weiter; nichts
   davon blockiert den Betrieb. Ein Blick drauf lohnt, wo du anders entscheiden
   wuerdest.

## Wo was liegt (fuer den technischen Blick)

- Plan mit allen Entscheidungen und Risiken: PLAN-ANRUF-INBOX.md
- Kettenstand: tasks/inbox-chain-state.md
- Die drei Etappen in der Git-Historie: 935b7f4 (Eintrag entsteht),
  fee7fc5 (Abhol-Endpunkt), ea9e943 (Abfrage-Werkzeug check_inbox)
