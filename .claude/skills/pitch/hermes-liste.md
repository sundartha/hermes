# Hermes-Liste für die Lückenprüfung

Geh diese Liste erst durch, nachdem du frei nach Angriffswegen gesucht hast. Jeder Punkt bekommt „trifft zu → T<n>“ oder „trifft nicht zu, weil …“; mehrere Punkte mit demselben Grund dürfen in einer Zeile stehen.

| Nr. | Frage |
|---|---|
| H1 | Kann jemand einen Anruf an eine Person auslösen, die der Auftraggeber nicht anrufen wollte, oder die Bestätigung in der Hermes-Karte umgehen? |
| H2 | Kann jemand Anrufe oder SMS zu teuren Zielen, viele parallele oder sehr viele kurze Vorgänge auslösen, auch mit einem neuen Konto, einer gestohlenen Karte oder einem Gutschein? Welche Grenze je Kunde greift? Die Telnyx-Grenzen gelten je Profil oder Verbindung, nicht je Kunde; prüfe im Code, wie Hermes die Profile nutzt. |
| H3 | Kann Verbrauch ohne Grenze entstehen: Minuten, Sprachsynthese, Wiederholungen, Schleifen zwischen Agenten, Rückrufe? |
| H4 | Kann ein Kunde über irgendeine Kennung (Anruf, Transkript, Ergebnis, Nummer, Postfach, Hintergrundjob, Cache) an Daten eines anderen Kunden kommen? |
| H5 | Nimmt Hermes nur Tokens an, die für Hermes ausgestellt sind, und reicht es keine Tokens weiter? |
| H6 | Kann das, was der Angerufene sagt, den Telefon-Agenten zu einer folgenreichen Handlung bringen? |
| H7 | Kommt Gesagtes des Angerufenen beim Agenten des Kunden klar als fremder Inhalt an, getrennt vom Ergebnis und auf das Nötige beschränkt? |
| H8 | Kann Hermes zum Täuschen von Menschen dienen: fehlende oder späte KI-Kennzeichnung, Auftraggeber nutzt Hermes für Betrugs- oder Werbeanrufe? Berührt die Änderung die Kennzeichnung (Art. 50 KI-Verordnung) oder Werbeanrufe (§ 7 UWG), ist das zusätzlich ein Punkt für die rechtliche Prüfung. |
| H9 | Vertraut irgendetwas der Nummer eines eingehenden Anrufs? Ruft Hermes je unbekannte Nummern zurück? Telnyx liefert eine STIR/SHAKEN-Einstufung für Anrufe aus den USA; für deutsche Nummern gibt es nichts Gleichwertiges. Halte fest, was du annimmst. |
| H10 | Sind eingehende Webhooks mit Signatur und Zeitfenster geprüft, und richten doppelte oder vertauschte Ereignisse keinen Schaden an (Abrechnung, Anrufstatus)? |
| H11 | Sendet Hermes an Adressen, die Kunden angeben, und kann es dabei interne Ziele erreichen? |
| H12 | Was geschieht mit Stimme und Worten der angerufenen Person: Wer sieht sie, wie lange, wie wird gelöscht, landet etwas in Logs? Berührt die Änderung Aufzeichnung oder Transkripte neu (§ 201 StGB, Art. 35 DSGVO), ist das zusätzlich ein Punkt für die rechtliche Prüfung. |
| H13 | Welche Schlüssel braucht die Änderung, wo liegen sie, was passiert, wenn einer abfließt? |
| H14 | Bringt die Änderung neue Pakete, Werkzeugbeschreibungen oder Anbieter, deren Verhalten wir nicht kontrollieren? |
| H15 | Was glauben wir Telnyx, ElevenLabs, Stripe, WorkOS und dem Agenten des Kunden, und was passiert, wenn das falsch ist? |
