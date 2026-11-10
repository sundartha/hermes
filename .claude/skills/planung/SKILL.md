---
name: planung
description: Plant eine Änderung an Hermes im Issue, bevor gebaut wird - Abnahmekriterien als Vertrag, betroffene Dateien und Tests per Befehl, bei großen Änderungen Design und eine Gegenprüfung (Premortem, Threat Model, Angreifer) und die Häppchenliste. Verwenden für jede neue Funktion, jeden Fehler und jeden Umbau, auch wenn das Wort Plan nicht fällt.
---

# Planung

Die Idee ist entschieden. Der Plan beginnt mit Absicht und Warum, wörtlich aus dem Auftrag, und sorgt dafür, dass sie in einer Runde gut gebaut wird. Alles steht im Issue; es gibt keine weiteren Plan-Dateien.

## 1. Auftrag und Abnahmekriterien

Im Issue stehen vier Abschnitte:

- **Absicht und Warum**: zuerst, wörtlich aus dem Auftrag, nicht neu formuliert; dazu in zwei bis drei Sätzen, was sich für Kunden, Angerufene oder den Betrieb ändert, welche Abkürzung nicht gewollt ist und wie im Zweifel zu wählen ist.
- **Abnahmekriterien**: nummeriert, je ein Verhalten. Das Wenn läuft über einen echten Eingang (Werkzeug aus `docs/mcp-vertrag.json`, Route, Anbieter-Meldung, Satz am Telefon), das Dann nennt etwas von außen Sichtbares mit konkretem Wert (Zahl mit Einheit, Wert in Backticks, Text in Anführungszeichen). Kein „schnell“, „möglichst“, „usw.“. Jedes Kriterium ist Verhalten, das aus der Absicht folgt, wird ein Test, und das Urteil blockiert genau daran; Doku-Texte, die kein Code unter `src/` liest (Markdown unter `docs/`, Runbook, Bereichs-`CLAUDE.md`), sind keine Kriterien, sie laufen im selben PR mit, werden beim Urteil gelesen und verweisen auf die Quelle eines Werts (Datei und Schlüssel), statt ihn abzuschreiben, auch in `.env.example`. Andere Texte unter `src/` sind Verhalten.
- **Bleibt unverändert**: was gleich bleiben muss, wenn die Änderung bestehendes Verhalten berührt, sonst „nichts, weil …“.
- **Nicht-Ziele**: was die Änderung bewusst nicht tut.

## 2. Prämissen per Befehl prüfen, nicht schätzen

Bevor ein Häppchen geschnitten wird, ermittelst du mit Befehlen, worauf es aufsetzt, und schreibst Befehl und Ergebnis in den Abschnitt **Ausgangslage** des Issues:

- Wo die Regel heute steht: `git grep -n "<Name oder Literal>" -- src` und die `CLAUDE.md` des Bereichs. Gibt es die Regel schon, baut der Plan auf ihr auf.
- Welche Tests betroffen sind: `node tools/pruefen.mjs betroffen <Datei> …` (direkt und über Importe). Ändert das Häppchen eine Datei mit vielen betroffenen Tests, gehört das in die Ausgangslage, weil der Bau dort mehr bricht.
- Dass jedes Abnahmekriterium heute auf master nicht erfüllt ist: die Stelle `Datei:Zeile`, die zeigt, was heute stattdessen passiert. Ist ein Kriterium schon erfüllt, gehört es unter „Bleibt unverändert“.
- Ob bestehende Tests das alte Verhalten festhalten, das sich absichtlich ändert: `git grep -n "<sichtbarer Wert>" -- test`. Diese Tests nennt der Plan; ihre Änderung braucht später das Label `verhalten-geaendert`.
- Welche offenen PRs und Issues dieselben Dateien ändern oder das Verhalten voraussetzen: je Datei des Plans `gh pr list -R sundartha/hermes --state open --json number,title,files --jq '.[] | select(any(.files[]; .path == "<Datei>")) | "\(.number) \(.title)"'` und `gh issue list -R sundartha/hermes --state open --search "<Datei oder Begriff>"`. Jeder Treffer steht in der Ausgangslage und wird im Plan Vorgänger eines Häppchens (der Bau meldet dann `WARTET=<Nummer>`) oder ausdrücklich unabhängig mit Grund.
- Über welchen Eingang der Test je Abnahmekriterium läuft: Tests importieren nur Eingänge oder als Fachlogik eingetragene Dateien (`tools/bereiche.json`, Architekturregel `tests-nur-ueber-eingaenge`; nachlesen mit `git grep -n "tests-nur-ueber-eingaenge" -- .dependency-cruiser.cjs tools`). Braucht ein Kriterium einen anderen Weg, hält die Planung an und meldet es im Issue, statt den Test an ein internes Modul zu binden.

## 3. Klein oder groß

**Klein** ist eine Funktion oder ein Fehler bis etwa 300 geänderte Zeilen ohne Änderung an Datenbankschema, öffentlicher Schnittstelle (HTTP-Routen, MCP-Werkzeuge, Webhooks) oder Abhängigkeiten. Dann genügt im Issue der Abschnitt **Plan** mit 5–10 Zeilen: welche Dateien, welcher Abnahmetest, welcher Eingang.

**Groß** ist alles andere. Dann kommen zwei Abschnitte dazu:

- **Design**: welche Bereiche zusammenspielen, über welchen Eingang je Bereich, welche Daten wohin fließen, und bei einer schwer umkehrbaren Entscheidung die ernsthaft verworfene Alternative mit Grund. Keine erfundenen Alternativen, wo es nur einen Weg gibt.
- **Häppchen**: nummeriert, je 100–300 geänderte Zeilen, je Häppchen Dateien, Abnahmekriterien, Abnahmetest und Vorgänger. Ein Umbau ohne neues Verhalten ist ein eigenes Häppchen ohne neue Tests.

### Durchstich zuerst (klein und groß)

Das erste Häppchen ist immer der einfachste Gutfall, einmal vom echten Eingang bis zur von außen sichtbaren Wirkung, so schmal wie möglich, ohne Rückfälle, Varianten und Robustheit. Nennt die Absicht einen Zielwert (Zeit, Kosten, Quote), misst das erste Häppchen ihn. Ausbau, Rückfälle und Robustheit kommen erst danach als eigene Häppchen. Trägt der Durchstich nicht, weil der Zielwert verfehlt ist oder der Weg nicht geht, hält das Paket an und der Plan wird neu gemacht.

## 4. Gegenprüfung, nur bei großen Änderungen

Bei kleinen Änderungen entfällt sie. Eine frische Sitzung, die den Plan nicht geschrieben hat, liest Issue und betroffenen Code einmal und beantwortet drei Fragen in einer Tabelle:

1. **Premortem**: Die Änderung ist seit einem Jahr live und hat Schaden angerichtet. Warum? Jeder Grund ist eine Kette „Weil <Umstand aus diesem Plan>, passiert <Ereignis>, Folge <Schaden>“.
2. **Angriff (Threat Model)**: Wer kann über welchen Eingang was erreichen, auch über bestehenden Code? Gegen `docs/sicherheitsgrenzen.md` und die Absoluten Regeln in `CLAUDE.md`.
3. **Leere Kriterien**: Welches Abnahmekriterium wäre auch ohne die Änderung schon grün, oder welcher Schutz würde von keinem Kriterium rot?

Jeder Fund wird ein Abnahmekriterium (nur wenn er Verhalten betrifft), eine mitlaufende Textänderung oder ein Nicht-Ziel; „hingenommen“ gibt es nur, wenn Antonio es entscheidet. Sicherheitsfunde im bestehenden Code kommen nie ins öffentliche Issue, sondern vertraulich an Antonio. Es gibt keinen zweiten Durchgang.

## 5. Fragen an Antonio

Nur bei Geld, Recht, Kunden, Produktion, Unumkehrbarem oder einer Lockerung einer Prüfung, immer mit Empfehlung und Grund. Alles andere entscheidet die Planung selbst und schreibt die Entscheidung mit Grund ins Issue.
