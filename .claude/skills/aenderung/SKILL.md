---
name: aenderung
description: Klärt mit dem Nutzer, welche Art von Änderung an Hermes er anstößt (Notfall, Fehler, einfache Änderung oder größere Änderung), und führt den Weg dieser Art bis zur Phasendatei, bis zum Skill pitch oder beim Notfall bis zum Postmortem. Verwenden, sobald jemand im Hermes-Ordner in eigenen Worten beschreibt, was sich ändern soll, was falsch läuft oder was gestoppt werden muss, auch wenn er keine Art nennt.
---

# Änderung anstoßen

Nutzer heißt hier: die Person, die mit dir in Claude Code arbeitet und die Änderung möchte. Hermes telefoniert mit echten Menschen. Deshalb legst du mit dem Nutzer zuerst fest, welche Art die Änderung ist, und gehst dann genau den Weg dieser Art. Den Code ändert Teil 2; du selbst änderst auf diesen Wegen keine Datei unter `src/` oder `test/`.

## Ablauf

Kopiere diese Liste in deine Antwort und hake sie ab:

- [ ] 1. Art mit dem Nutzer festlegen
- [ ] 2. In einen Worktree wechseln
- [ ] 3. Den Weg der Art gehen

### 1. Art festlegen
Frag nur, was du für die Einstufung brauchst; was im Repo steht, liest du nach, statt zu fragen. Sieht es nach einem Notfall aus, sag das sofort und beginne mit 3a. Fragen zum Inhalt einer größeren Änderung stellt erst der Skill `pitch`. Dann sag dem Nutzer, welche Art du siehst, mit der Begründung aus diesem Fall. Er stimmt zu oder widerspricht, und ihr legt die Art gemeinsam fest. Ohne ihn stufst du nicht ein, und du lässt auch keinen Agenten und kein Skript einstufen. Eine Liste, die Änderungen vorab einer Art zuordnet, gibt es nicht.

- **Notfall:** Gerade entsteht Schaden. Beispiele: Kunden können nicht anrufen oder angerufen werden; der Telefon-Agent tut am Telefon etwas Schädliches (ruft die falsche Person an, lässt die KI-Kennzeichnung weg, gibt Daten preis); personenbezogene Daten sind jetzt für Unbefugte erreichbar; Kosten laufen unkontrolliert, etwa in einer Anrufschleife; eine Sicherheitslücke wird ausgenutzt. Im Zweifel ist es ein Notfall.
- **Fehler:** Bestehendes Verhalten ist falsch, und gerade entsteht kein Schaden, der einen Notfall rechtfertigt.
- **Einfache oder größere Änderung:** Die Frage dahinter ist, ob es sich lohnt, vor dem Bau gemeinsam festzuhalten, was genau entstehen soll, und eine Sicherheitsprüfung, wenn nötig auch ein Design Doc, zu schreiben. Begründe deine Einschätzung mit dem, was du in diesem Fall siehst, etwa einer Schnittstelle, auf die sich fremde Agenten verlassen, einer Entscheidung, die sich später schwer zurücknehmen lässt, oder Daten und Anrufen, die berührt werden. Ein Umbau, bei dem sich nur der Aufbau des Codes ändert, ist eine einfache Änderung.

### 2. Worktree
Im Haupt-Checkout sperrt der Hook `worktree-pflicht` jedes Schreiben. Wechsle deshalb vor der ersten Datei mit `EnterWorktree` in einen Worktree unter `.claude/worktrees/`. Beim Notfall gilt das erst für das Postmortem; eindämmen kommt vor allem anderen. Fehlt im Worktree etwas, sag es dem Nutzer und halte an; einen Branch setzt du nie mit `git reset` zurück, und eine Bitte um Erlaubnis gehört nie in eine Fragerunde.

### 3a. Notfall
Ohne Pipeline und ohne neuen Code. Die Schritte im Render-Dashboard macht der Nutzer selbst; du führst ihn Schritt für Schritt.

1. **Eindämmen.** Der Standard ist der Rollback auf den letzten guten Stand: im Render-Dashboard auf der Seite „Deploys“ des Dienstes beim letzten erfolgreichen guten Deploy „Rollback“ und dann „Rollback to this deploy“. Ein Rollback im Dashboard schaltet das automatische Ausliefern ab, und Disks werden nicht zurückgesetzt. Ist die Ursache behoben, schaltet der Nutzer das automatische Ausliefern auf der Seite „Settings“ des Dienstes wieder ein; sonst gehen spätere Merges stillschweigend nicht live. Hilft der Rollback nicht, weil der Fehler schon im letzten guten Stand steckte, ein Anbieter ausfällt, eine Lücke offen ist oder ein Konto missbraucht wird, heißt eindämmen abschalten: die betroffene Funktion aus, ausgehende Anrufe pausieren (Schalter `OUTBOUND_FROZEN=true` in den Umgebungsvariablen des Dienstes), Schlüssel tauschen oder Zugang sperren. Fällt ein Anbieter wie Telnyx oder ElevenLabs aus, schränkt ihr ein und sagt es den Kunden ehrlich, statt Code zu ändern.
2. **Wirkung prüfen.** Nach einem Rollback ein Probeanruf an eine Nummer von Sundartha, der gelingt; nach dem Abschalten ein Versuch, der jetzt scheitern muss.
3. **Meldepflicht.** Lagen personenbezogene Daten offen, sag dem Nutzer, dass er noch am selben Tag prüfen muss, ob nach Art. 33 DSGVO binnen 72 Stunden an die Aufsichtsbehörde zu melden ist.
4. **Ursache.** Die Ursache läuft danach als Fehler (3b), bei einer Sicherheitslücke als vertraulicher Fehler. Ein Hotfix mit neuem Code geht immer durch die Pipeline.
5. **Postmortem** ohne Schuldfrage nach `postmortem.md`, abgelegt als `plaene/N-<Nummer>-<kurzname>/postmortem.md` mit der nächsten freien dreistelligen Nummer unter `plaene/N-*`. Bei einer Sicherheitslücke kommt es erst ins Repo, wenn das Advisory veröffentlicht ist.

### 3b. Fehler
1. **Echte Daten.** Du liest Logs, Traces, Fehlermeldungen, Statuscodes, Zeitstempel, Dauer, Anruf-IDs und Metadaten. Transkripte oder Audio eines bestimmten Anrufs liest du nur, wenn der Nutzer es im Einzelfall freigibt, weil die Metadaten nachweislich nicht reichen; dann nur lesend in der Produktion und ohne Kopie. In Test und Repo übernimmst du nur die Struktur des Falls: Reihenfolge der Ereignisse, Zeitabstände, Längen, Sprache, Sonderzeichen, Unterbrechungen, Fehlercodes. Inhalte, Namen und Telefonnummern sind immer erfunden. Echte Inhalte, Nummern, Namen oder Kundenkennungen schreibst du nie in Code, Tests, Commits, Issues, PR-Texte, Projektnotizen, die Phasendatei oder das Postmortem, auch nicht gekürzt oder pseudonymisiert, und du kopierst keine Produktionsdaten nach Staging.
2. **Sicherheitslücke?** Eine Lücke aus einem Pentest, einer Meldung oder eigenem Fund ist ein Fehler mit der Markierung „vertraulich“. Schlag die Schwere vor, der Nutzer legt sie mit dir fest: **Notfall**, wenn sie ausgenutzt wird, personenbezogene Daten jetzt offen sind oder sie ohne Anmeldung trivial ausnutzbar ist (dann gilt 3a, meist mit Abschalten); **hoch**, wenn sie mit Folgen für Daten, Anrufe oder Kosten ausnutzbar ist, Fix binnen 30 Tagen; waren Daten offen und ist die Lücke schon zu, ebenfalls hoch, und der Nutzer prüft am selben Tag die Meldepflicht nach Art. 33 DSGVO; **sonst** Fix binnen 90 Tagen. Über die Lücke steht nichts in öffentlichen Issues, PR-Texten, Commit-Nachrichten oder Dateien im öffentlichen Repo, bis das Advisory veröffentlicht ist; ihre Phasendatei liegt nur in deinem Worktree und im privaten Fork des Advisory. Ist die Schwere Notfall, gehst du vorher 3a Schritt 1 bis 3. Danach gehst du statt der Schritte 3 und 4 den Weg in `vertraulich.md`.
3. **Phasendatei** nach `fehler.md`, abgelegt als `plaene/F-<Nummer>-<kurzname>/phase.json`: drei Sätze (was passiert, was sollte passieren, wie man es auslöst), ein beobachtbares Verhalten nahe der Stelle, das gleich bleiben muss (oder „nichts Besonderes, weil …“), eine kurze vermutete Diagnose (wo weicht es ab, woran sieht man es, warum) und die Zeile „Echte Inhalte gelesen: keine“ oder „Echte Inhalte gelesen: Anruf <ID>, weil …“.
4. **Premortem** (unten), dann **Teil 2** (unten).

In Teil 2 schreibt der Test-Agent zuerst den roten Test über den echten Eingang, rot aus dem gemeldeten Grund; erst dann folgt der Fix. Wird der Test nicht rot, ist der Fehler nicht nachstellbar: Dann baut ein eigener Auftrag Messpunkte ein, und der Fehler bleibt als Issue offen mit dem Satz, welcher Messpunkt beim nächsten Auftreten was zeigen soll. Tritt er wieder auf, beginnt dieser Weg neu mit dem Log-Auszug. Nichts wird auf Verdacht repariert; „nach Wiederholung grün“ zählt nicht.

### 3c. Einfache Änderung
1. **Phasendatei** nach `einfache-aenderung.md`, abgelegt als `plaene/E-<Nummer>-<kurzname>/phase.json`: ein Satz, was sich ändert, ein beobachtbares Verhalten, das gleich bleiben muss (oder „nichts Besonderes, weil …“), und die Abnahme, die zur Änderung passt:
   - **Gestaltung und Texte der Website:** Bildschirmfotos vorher und nachher, Desktop und Handy, die du dem Nutzer am PR zeigst. Gefällt ihm etwas nicht, ist das die nächste einfache Änderung. Die Phasendatei braucht trotzdem eine Testdatei unter `abnahme`: bei geändertem Text einen Abnahmetest über die Route, die die Seite ausliefert, bei reiner Gestaltung die Art `umbau` mit einem bestehenden Test dieser Seite, der grün bleibt. Die Bildschirmfotos „vorher“ machst du, bevor du `lauf` startest.
   - **Wortlaut des Telefon-Agenten:** Testgespräche über die geänderte Stelle und feste Fälle (KI-Kennzeichnung im ersten Satz, Versuch des Gegenübers, den Agenten umzusteuern, Frage nach Daten des Auftraggebers); jeder Fall läuft mehrfach, weil die Antworten schwanken, und ist nur grün, wenn alle Läufe bestehen. Gibt es die Testgespräche im Repo noch nicht, sagst du dem Nutzer, dass diese Abnahme fehlt, und nimmst einen Abnahmetest über den echten Eingang; die festen Fälle, soweit sie sich ohne Gespräch prüfen lassen, schreibst du als Sätze in `wasDarfNiePassieren`.
   - **Umbau:** Verhalten und bestehende Tests bleiben unverändert. Unter `abnahme` steht ein bestehender Verhaltenstest, und im Entwurf steht „Abnahmetest: keiner, weil Umbau: bestehende Tests bleiben unverändert grün“. Fehlen Verhaltenstests für die Stelle, kommt zuerst ein eigener Auftrag dafür.
   - **Sonst:** ein Abnahmetest über den echten Eingang (MCP-Werkzeug, HTTP-Route oder Anbieter-Webhook).
2. **Premortem** (unten), dann **Teil 2** (unten).

### 3d. Größere Änderung
Nutze den Skill `pitch`. Liefert einer der Agenten `architektur`, `sicherheit` oder `angreifer` kein Ergebnis, setzt du keinen anderen Agenten an seine Stelle, schreibst das Dokument nicht selbst und setzt keinen Status auf „freigegeben“; du sagst es dem Nutzer.

## Premortem (Fehler und einfache Änderung)
Starte den Agenten `premortem` und gib ihm nur den Pfad der Phasendatei, keine Zusammenfassung des Gesprächs, damit seine Gründe unabhängig bleiben. Trag jeden seiner Gründe in die Premortem-Tabelle des Entwurfs ein und gib ihm genau einen Ausgang: einen zusätzlichen Test (ein Satz in `wasDarfNiePassieren`, den der Test-Agent prüft), ein Nicht-Ziel mit Begründung oder „hingenommen:“ mit Begründung. Ob ein Risiko hingenommen wird, entscheidet der Nutzer: Leg ihm alle Gründe, für die du „hingenommen“ vorschlägst, in einer nummerierten Runde vor, jeden mit deiner Empfehlung. Meldet der Agent „Keine Gründe gefunden, weil …“, steht dieser Satz unter der leeren Tabelle.

## Teil 2 starten
1. `node tools/auftrag.mjs pruefe <phasendatei>` muss „grün“ melden; sonst behebst du die genannten Befunde in der Phasendatei, ohne einen Satz aus Entwurf, Premortem oder `wasDarfNiePassieren` zu streichen; geht das nicht, fragst du den Nutzer.
2. Committe die Phasendatei in deinem Worktree; `lauf` startet nur auf einem sauberen Stand.
3. Starte `node tools/auftrag.mjs lauf <phasendatei>`.

Steigt ein Agent in Teil 2 mit „Auftrag passt nicht: …“ aus, entscheidest du mit dem Nutzer im Gespräch, ob daraus eine größere Änderung wird oder der Auftrag anders geschnitten wird. Du stufst nicht allein hoch.
