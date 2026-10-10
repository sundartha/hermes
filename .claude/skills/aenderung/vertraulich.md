# Vertraulicher Fehler: Sicherheitslücke beheben, solange das Repo öffentlich ist

Bis das Advisory veröffentlicht ist, steht über die Lücke nichts in öffentlichen Issues, PRs, Commit-Nachrichten, Branch-Namen, Phasendateien im öffentlichen Repo, im Postmortem oder in der Systemkarte. Die Schritte im Advisory auf GitHub macht der Nutzer mit seinem eigenen Konto; er braucht dafür Admin-Rechte am Repo. Du arbeitest als App „Sundartha Agent“, die nur `sundartha/hermes` sieht, nicht das Advisory und nicht dessen privaten Fork.

Kopiere diese Liste in deine Antwort und hake sie ab:

- [ ] 1. Advisory-Entwurf und privater Fork
- [ ] 2. Phasendatei, Premortem und Teil 2 im Worktree
- [ ] 3. Lokal voll prüfen
- [ ] 4. Stand in den privaten Fork laden
- [ ] 5. Öffentlichen Branch bauen und prüfen
- [ ] 6. Push und PR nach Zustimmung des Nutzers
- [ ] 7. Bis zum Live-Deploy begleiten
- [ ] 8. Fork löschen und Advisory veröffentlichen

## 1. Advisory-Entwurf und privater Fork
Kam die Lücke über die Meldefunktion aus `.github/SECURITY.md`, gibt es den Advisory-Entwurf schon. Sonst legt der Nutzer ihn an, auch für einen Pentest-Befund, eine Meldung per E-Mail, einen Sicherheitshinweis des Prüfers aus der nicht öffentlichen Ablage `sundartha/hermes-sicherheit` oder einen eigenen Fund: im Repo „Security“, dann „Advisories“, dann „New draft security advisory“. Nie ein Issue. Danach startet er im Entwurf unter „Collaborate on a patch“ mit „Start a temporary private fork“ den privaten Fork. Schreib ihm den Text für den Entwurf vor; was er dort einträgt, bleibt bis zur Veröffentlichung privat.

## 2. Phasendatei, Premortem und Teil 2 im Worktree
Phasendatei wie 3b Schritt 3, dann Premortem und Teil 2 wie im Skill. Der Kurzname der Phase nennt die Lücke nicht (etwa `F-<Nummer>-wartung`), denn er steht später in der Zeile „Auftrag:“ des öffentlichen Commits. Starte Teil 2 nur mit `node tools/auftrag.mjs lauf`, nie mit `phase`: `phase` braucht ein öffentliches Issue und lädt einen Branch hoch. Den Branch deines Worktrees pushst du nie, weder nach `upstream` noch anderswohin.

## 3. Lokal voll prüfen
Im privaten Fork laufen keine GitHub-Checks. Lies deshalb die `run:`-Schritte der Workflows der sechs Pflicht-Checks (`ci.yml`, `pruefungen-pruefen.yml`, `pruefleiter.yml`, `lieferkette.yml`, `abhaengigkeiten.yml`, `statische-pruefung.yml`) und führ in deinem Worktree jeden aus, der ohne GitHub läuft, mit `--basis upstream/master`, wo ein Schritt eine Basis verlangt; die volle Testsuite gehört dazu. Schritte, die eine PR-Nummer oder die Merge-Warteschlange brauchen, entfallen. Alle müssen grün sein, bevor es weitergeht. Jede Nacharbeit nach dem Push in Schritt 6 verlängert die Zeit, in der der Fix öffentlich und die Lücke noch offen ist.

## 4. Stand in den privaten Fork laden
Den Push in den Fork macht der Nutzer selbst in einem eigenen Terminal außerhalb dieser Sitzung, mit seinem GitHub-Konto. In dieser Sitzung ist Git auf die App eingestellt, die den Fork nicht sieht. Nenn ihm den Befehl mit dem Pfad deines Worktrees: `git -C <worktree> push https://github.com/sundartha/hermes-ghsa-<kennung>.git HEAD:<branch>`. Die Kennung steht in der Adresse des Advisory. Gibt der Reporter oder ein Mitarbeiter im Fork Änderungen dazu, holt der Nutzer sie ebenso, und du prüfst nach Schritt 3 neu.

## 5. Öffentlichen Branch bauen und prüfen
Der öffentliche PR bekommt einen einzigen neuen Commit ohne die Phasendatei und ohne die Commit-Texte aus Teil 2, denn die nennen das Ziel des Auftrags und die Berichte der Agenten.

```sh
git fetch upstream master
V=$(git branch --show-current)
git switch -c fehler/<bereich> upstream/master
git diff --binary "$(git merge-base upstream/master "$V")" "$V" -- . ':(exclude)plaene/' | git apply --3way --index
```

`<bereich>` ist der Name der Datei oder des Ordners ohne Endung, etwa `fehler/util`. Commit-Nachricht, nur die Teile in spitzen Klammern ersetzen:

```text
Behebe einen Fehler in <Datei>

Ursache: Auftrag a1 der Phase <phase>; tools/auftrag.mjs hat ihn gebaut und geprüft.

Auftrag: <phase>/a1
Art: fehlerbehebung
```

Hat die Phase mehrere Aufträge, steht für jeden eine Zeile „Auftrag:“ da.

Dann prüfst du und zeigst dem Nutzer jede Ausgabe:

1. `git diff --name-only upstream/master..HEAD` nennt keinen Pfad unter `plaene/` und nur Dateien, die Teil 2 geändert hat.
2. `git diff --diff-filter=DMR --name-only upstream/master..HEAD -- test/` ist leer: Der Fix fügt Tests hinzu und ändert keinen bestehenden. Sonst verlangt Testschutz ein öffentliches Issue; dann hältst du an und besprichst mit dem Nutzer, wie es weitergeht.
3. `{ git branch --show-current; git log --format=%B upstream/master..HEAD; } | grep -i -E 'ghsa|cve|advisory|sicherheit|lücke|luecke|exploit|angriff|angreif|vertraulich|schwachstelle|security|vuln'` findet nichts.
4. Schritt 3 noch einmal auf diesem Branch, alles grün.

## 6. Push und PR nach Zustimmung des Nutzers
Sag dem Nutzer vor dem Push: Ab dem Push kann jeder den Fix lesen, die Lücke ist in der Produktion aber noch offen, bis der Live-Deploy durch ist, nach bisheriger Erfahrung 20 bis 35 Minuten, mit Nacharbeit länger. Schlag ihm vor, die betroffene Funktion bis dahin abzuschalten wie in 3a Schritt 1, wenn das geht; er entscheidet. Erst nach seinem ausdrücklichen Ja pushst du den Branch nach `upstream` und öffnest den PR: Titel gleich der ersten Zeile des Commits, Text ein Satz „Behebt einen Fehler in <Datei>.“, kein `Closes #`, kein Verweis auf ein Issue. Dann Auto-Merge wie bei jedem PR.

## 7. Bis zum Live-Deploy begleiten
- Wird ein Check rot oder fällt der PR aus der Warteschlange, behebst du es auf demselben Branch mit denselben Regeln: neue Commits im Format aus Schritt 5, und vor jedem Push die Prüfungen 1 bis 3 aus Schritt 5.
- Ändert der Fix den Gesprächsabdruck, wartet der Live-Deploy auf einen Hörtest, den ein Owner von Hand startet. Sag das dem Nutzer sofort.
- Legt die Warteschlange nach dem Merge einen Rücknahme-PR an, ist die Lücke wieder offen und der Fix schon öffentlich. Das ist ein Notfall: sofort 3a Schritt 1, abschalten.
- Erscheint ein Issue mit dem Label `pruefer` zu diesem PR, das die Lücke oder eine verbleibende Schwachstelle beschreibt, sag es dem Nutzer sofort; als Admin kann er das Issue löschen. Du selbst schreibst dort nichts.

## 8. Fork löschen und Advisory veröffentlichen
Sobald der Lauf „Live“ (`.github/workflows/live.yml`) für den Merge-Commit grün ist, löscht der Nutzer im Advisory den temporären privaten Fork, ergänzt die betroffenen Versionen und veröffentlicht das Advisory, ohne Pause dazwischen. Hat er eine Funktion abgeschaltet, schaltet er sie danach wieder ein. Erst jetzt dürfen Postmortem und Notizen über die Lücke ins Repo.

Stellt sich in Schritt 1 oder 2 heraus, dass keine Sicherheitslücke vorliegt, löscht der Nutzer zuerst den Fork und schließt dann das Advisory ohne Veröffentlichung („Close security advisory“). Ist es ein gewöhnlicher Fehler, geht er danach den Weg 3b ohne die Markierung „vertraulich“.
