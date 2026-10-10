---
name: pitch
description: Schreibt mit dem Nutzer den Pitch für eine größere Änderung an Hermes nach fester Vorlage, lässt unabhängige Agenten Premortem, Design Doc, Sicherheitsprüfung und Gegenprüfung schreiben und legt alles zur Freigabe vor. Verwenden, sobald der Nutzer und die Sitzung eine Änderung im Gespräch als größere Änderung festgelegt haben, auch wenn er das Wort Pitch nicht benutzt.
---

# Pitch schreiben

Nutzer heißt hier: die Person, die mit dir in Claude Code arbeitet und die Änderung möchte. Ein Pitch legt fest, was eine größere Änderung bewirken soll und woran man erkennt, dass sie fertig ist. Die Idee ist entschieden; der Pitch begründet sie nicht, er hilft, sie gut zu bauen. Aus jedem Szenario wird später ein Abnahmetest; deshalb muss jeder Satz prüfbar sein. Der Nutzer prüft den fertigen Pitch selbst; freigegeben wird er später zusammen mit Design Doc und Sicherheitsprüfung.

## Ablauf

Kopiere diese Liste in deine Antwort und hake sie ab:

- [ ] 1. Datei anlegen
- [ ] 2. Mit dem Nutzer klären
- [ ] 3. Grobe Lösung und Szenarien schreiben
- [ ] 4. Premortem-Agent starten, Ausgänge eintragen
- [ ] 5. Design Doc, Sicherheitsprüfung und Gegenprüfung erstellen lassen, alles im Chat zur Freigabe vorlegen

### 1. Datei anlegen
Kopiere `vorlage.md` nach `plaene/P-<nächste freie Nummer>-<kurzname>/pitch.md`. Verwende genau diese Struktur; jeder Abschnitt bleibt stehen. `beispiel.md` zeigt einen fertigen Pitch.

### 2. Mit dem Nutzer klären
Rede mit dem Nutzer wie mit einem Software-Engineer: mit Fachbegriffen, Werkzeug- und Routennamen und den technischen Abwägungen, ohne zu vereinfachen.

Entscheidungen legst du dem Nutzer vor, auch technische. Fakten, die im Code, in der Doku oder bei einem Anbieter nachzulesen sind, fragst du ihn nicht, sondern liest sie nach: Was im Code oder in der Doku des Repos steht, lässt du vom Agenten `suche` nachlesen; die Doku eines Anbieters liest du selbst mit WebFetch. Solange eine Suche läuft, warten nur die Fragen, die von ihrem Ergebnis abhängen.

Frag in Runden. Eine Runde enthält alle Entscheidungen, die du jetzt stellen kannst, ohne eine noch offene Antwort zu erraten; eine Frage, deren Antwort von einer anderen offenen Frage abhängt, kommt in die nächste Runde. Nummeriere die Fragen, gib zu jeder deine Empfehlung mit einem Satz Begründung und formuliere sie so, dass „ja“ die Empfehlung annimmt.

Der Nutzer darf nach Nummern antworten, nur einen Teil beantworten oder mit „wie empfohlen“ alle Empfehlungen einer Runde annehmen. Was er offen lässt, stellst du in der nächsten Runde erneut oder trägst es unter „Vor dem Bau zu klären“ ein. Möchte er einzelne Fragen, fragst du einzeln.

Lässt sich eine Frage erst beantworten, wenn der Nutzer etwas hört oder sieht, etwa wie ein Satz am Telefon klingt, schlag einen Wegwerf-Versuch vor (einen Testanruf auf Staging, ein Bild) und trag die Frage bis dahin unter „Vor dem Bau zu klären“ ein.

Zur letzten Runde gehört die Frage, ob ein Design Doc entsteht, mit deiner Empfehlung und ihrem Grund aus diesem Fall, etwa weil die technische Lösung unklar ist, es mehr als einen ernsthaften Weg gibt oder sich eine Entscheidung später schwer zurücknehmen lässt. Trag die Antwort mit Grund in die Kopfzeile „Design Doc“ ein; der Architektur-Agent liest daraus, welche Entscheidung sein Dokument tragen soll.

Schritt 2 ist fertig, wenn jeder Abschnitt der Vorlage ohne Annahme geschrieben werden kann, keine Entscheidung mehr offen ist, von der ein anderer Abschnitt abhängt, und feststeht, ob ein Design Doc entsteht.

### 3. Schreiben
- Ein Szenario beschreibt genau ein Verhalten: ein Wenn, höchstens fünf Schritte.
- Das Wenn läuft über einen echten Eingang: ein Werkzeug aus `docs/mcp-vertrag.json`, eine Route, eine Meldung eines Anbieters oder ein Satz des Gesprächspartners am Telefon, jeweils in Backticks oder Anführungszeichen. Neue Werkzeuge, Routen und Werte trägst du unter „Neue Begriffe“ ein.
- Das Dann nennt, was von außen sichtbar ist, mit konkretem Wert: eine Zahl mit Einheit, einen Wert in Backticks oder einen Text in Anführungszeichen. Nie, was in der Datenbank oder im Protokoll steht, weil ein Test über den echten Eingang nur Sichtbares prüfen kann.
- Zeiten immer als Zahl mit Einheit, etwa „innerhalb von 30 Sekunden“.
- Kann die Änderung bestehendes Verhalten berühren, schreibst du unter „Bleibt unverändert“ ein Szenario für das, was gleich bleiben muss. Sonst steht dort „keins, weil …“. Soll sich nach außen gar nichts ändern (etwa beim Wechsel eines Anbieters), steht unter „Anforderungen“ „keine neuen, weil …“, und das Prüfbare steht unter „Bleibt unverändert“. Erfinde keine Szenarien, um einen Abschnitt zu füllen; jedes Szenario wird ein Test.
- Szenarien stehen unter der Regel, die sie zeigen: ein Satz je Regel. Ist das Dann einer Regel unklar, ist das eine offene Frage, kein Szenario.
- Anforderungen, die sich nicht von außen beobachten lassen, etwa „Geheimnisse werden nie geloggt“, gehören nicht in die Szenarien, sondern in die Sicherheitsprüfung.
- Unter „Fallen“ stehen technische Stolpersteine, die schon vor dem Bau bekannt sind, je mit der Entscheidung, wie ihr damit umgeht. Gibt es keine, steht dort „keine bekannt“.
- Statt Wörtern, die man nicht testen kann, etwa „schnell“, „möglichst“, „ggf.“ oder „usw.“, schreibst du den Wert oder die vollständige Liste.
- Die grobe Lösung beschreibt, wie es sich für den anfühlt, der die Änderung bemerkt, und welche Teile zusammenspielen. Dateinamen, Code und Aufträge gehören nicht hinein; die entstehen später.

### 4. Premortem
Starte den Agenten `premortem` und gib ihm nur den Pfad der Pitch-Datei, keine Zusammenfassung des Gesprächs, damit seine Gründe unabhängig bleiben. Trag jeden seiner Gründe in die Premortem-Tabelle ein und gib ihm genau einen Ausgang (meldet er „keine Gründe gefunden, weil …“, steht dieser Satz unter der leeren Tabelle): ein neues Szenario, ein Nicht-Ziel oder „hingenommen:“ mit Begründung. Ob ein Risiko hingenommen wird, entscheidet der Nutzer: Leg ihm alle Gründe, für die du „hingenommen“ vorschlägst, in einer nummerierten Runde vor, jeden mit deiner Empfehlung.

### 5. Weitere Dokumente und Freigabe
Sind alle Fragen unter „Vor dem Bau zu klären“ beantwortet, setz den Status auf „fertig“. Dann, ohne Rückfrage:

1. Steht im Kopf „Design Doc: ja“, starte den Agenten `architektur` mit dem Pfad der Pitch-Datei. Antwortet er „Pitch passt nicht: …“, geh mit dem Nutzer zurück in die Fragerunden. Sonst trägst du seine Rückmeldungen an den Pitch ein: Vorgeschlagene Szenarien werden S-n oder B-n, vorgeschlagene Nicht-Ziele kommen unter „Nicht-Ziele“. Rückfragen an den Pitch und offene Fragen kommen mit seiner Empfehlung in die Freigabeliste.
2. Starte den Agenten `sicherheit` mit den Pfaden von Pitch und Design Doc (falls es eins gibt).
3. Starte danach den Agenten `angreifer` mit denselben Pfaden und dem Pfad der Sicherheitsprüfung. Trag seine Tabelle in den Abschnitt „Gegenprüfung“ ein:
   - Ein belegter neuer Weg wird eine neue T-n mit vorgeschlagenem Ausgang.
   - Ein Szenario, das ohne den Schutz nicht rot würde, schreibst du um.
   - Ein umgangener Schutz wird ein zusätzliches Szenario.
   - Eine Widerlegung kommt als Vorschlag in die Freigabeliste.
   Neue Werte und Routen aus Design Doc und Sicherheitsprüfung trägst du unter „Neue Begriffe“ ein. Meldet ein Agent einen Befund im bestehenden Code, behandle ihn als vertraulichen Fehler nach Abschnitt 3b des Skills `aenderung`, schreib ihn in kein Dokument und mach mit diesem Pitch weiter.
4. Leg dem Nutzer hier im Chat eine einzige nummerierte Liste vor, jeden Punkt mit Empfehlung:
   - die Entscheidungen, Rückfragen und offenen Fragen aus „Zur Freigabe“ im Design Doc;
   - die höchstens drei schwersten Angriffswege aus „Zur Freigabe“ in der Sicherheitsprüfung, mit der Frage, ob das seiner Einschätzung entspricht und ob ihm ein Angriffsweg fehlt;
   - alles, was hingenommen, weggelassen oder übertragen werden soll, aus Premortem, Design Doc und Sicherheitsprüfung;
   - strittige Punkte aus der Gegenprüfung;
   - was sich durch Premortem und Gegenprüfung geändert hat und welche Entscheidungen er mit „wie empfohlen“ übernommen hat.
   Zu „hinnehmen“ und „übertragen“ erklärst du die Einzelheiten nur im Chat; in den Dokumenten steht nur, was offen bleibt, weil das Repo öffentlich ist.

Nimmt der Nutzer einen Vorschlag an, der ein Szenario, einen Begriff oder eine Entscheidung ändert, passt du Pitch, Design Doc und Sicherheitsprüfung an. Der Nutzer gibt mit einem Wort im Chat frei; dann setzt du den Status aller Dokumente auf „freigegeben“. Will er etwas ändern, änderst du es und passt die betroffenen Dokumente an.
