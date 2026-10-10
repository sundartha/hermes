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
Kam die Lücke über die Meldefunktion aus `.github/SECURITY.md`, liegt sie im Repo unter „Security“, dann „Advisories“ im Zustand „Triage“; der Nutzer öffnet sie und klickt „Accept and open as draft“. Sonst legt er den Entwurf an, auch für einen Pentest-Befund, eine Meldung per E-Mail, einen Sicherheitshinweis des Prüfers aus der nicht öffentlichen Ablage `sundartha/hermes-sicherheit` oder einen eigenen Fund: im Repo „Security“, dann „Advisories“, dann „New draft security advisory“. Nie ein Issue. Danach startet er im Entwurf unter „Collaborate on a patch“ mit „Start a temporary private fork“ den privaten Fork. Schreib ihm den Text für den Entwurf vor; was er dort einträgt, bleibt bis zur Veröffentlichung privat.

## 2. Phasendatei, Premortem und Teil 2 im Worktree
Phasendatei wie 3b Schritt 3, dann Premortem und Teil 2 wie im Skill. Der Kurzname der Phase nennt die Lücke nicht (etwa `F-<Nummer>-wartung`), denn er steht später in der Zeile „Auftrag:“ des öffentlichen Commits. Starte Teil 2 nur mit `node tools/auftrag.mjs lauf`, nie mit `phase`: `phase` braucht ein öffentliches Issue und lädt einen Branch hoch. Den Branch deines Worktrees pushst du nie, weder nach `upstream` noch anderswohin.

Wird der Test nicht rot oder steigt ein Agent mit „Auftrag passt nicht“ aus, legst du kein Issue an, baust keine Messpunkte ein und startest keinen Pitch im Repo. Du schreibst den Stand in wenigen Sätzen als Text für einen Kommentar im Advisory, der Nutzer trägt ihn dort ein, und du hältst an; wie es weitergeht, entscheidet der Nutzer. Auch Messpunkte kommen nur auf dem Weg ab Schritt 5 ins öffentliche Repo.

## 3. Lokal voll prüfen
Im privaten Fork laufen keine GitHub-Checks. Lies deshalb die `run:`-Schritte der Workflows der sechs Pflicht-Checks (`ci.yml`, `pruefungen-pruefen.yml`, `pruefleiter.yml`, `lieferkette.yml`, `abhaengigkeiten.yml`, `statische-pruefung.yml`) und führ in deinem Worktree jeden aus, der ohne GitHub läuft, mit `--basis upstream/master`, wo ein Schritt eine Basis verlangt; die volle Testsuite gehört dazu. Schritte, die eine PR-Nummer oder die Merge-Warteschlange brauchen, entfallen; commitlint läuft erst auf dem öffentlichen Branch (Schritt 5, Prüfung 5). Alle müssen grün sein, bevor es weitergeht. Jede Nacharbeit nach dem Push in Schritt 6 verlängert die Zeit, in der der Fix öffentlich und die Lücke noch offen ist.

## 4. Stand in den privaten Fork laden
Den Push in den Fork macht der Nutzer selbst in einem eigenen Terminal außerhalb dieser Sitzung, mit seinem GitHub-Konto und Node 22 (der pre-push-Hook startet `npm run pruefleiter`). In dieser Sitzung ist Git auf die App eingestellt, die den Fork nicht sieht. Nenn ihm den Befehl mit dem Pfad deines Worktrees: `git -C <worktree> push https://github.com/sundartha/hermes-ghsa-<kennung>.git HEAD:fix`. Die Kennung steht in der Adresse des Advisory. Sag ihm vorher, dass alle Mitwirkenden am Advisory, auch Melder und Pentester, im Fork die Phasendatei und die Commit-Texte aus Teil 2 lesen. Gibt der Melder oder ein Mitwirkender im Fork Änderungen dazu, holt der Nutzer sie ebenso, und du prüfst nach Schritt 3 neu.

## 5. Öffentlichen Branch bauen und prüfen
Der öffentliche PR bekommt einen einzigen neuen Commit ohne die Phasendatei und ohne die Commit-Texte aus Teil 2, denn die nennen das Ziel des Auftrags und die Berichte der Agenten. `git status --porcelain --untracked-files=all` muss leer sein; sonst hältst du an. Dann im Wurzelordner des Worktrees:

```sh
git fetch upstream master
V=$(git branch --show-current)
A=$(git rev-parse "$V")
git switch --no-track -c fehler/<bereich> upstream/master
git diff --binary "$(git merge-base upstream/master "$A")" "$A" -- . ':(exclude)plaene/' | git apply --3way --index
```

Endet `git apply` nicht mit Exit 0, hältst du an und löst nichts von Hand. `<bereich>` ist der Name der wichtigsten geänderten Datei unter `src/` ohne Ordner und ohne Endung, etwa `fehler/util`; `<Datei>` unten ist derselbe Name mit Endung. Merk dir `V` und `A` für Schritt 7. Die Commit-Nachricht schreibst du in eine Datei außerhalb des Worktrees und committest mit `git commit -F <datei>`, nie mit `-a`. Nur die Teile in spitzen Klammern ersetzen:

```text
Behebe einen Fehler in <Datei>

Ursache: Auftrag a1 der Phase <phase>; tools/auftrag.mjs hat ihn gebaut und geprüft.

Auftrag: <phase>/a1
Art: fehlerbehebung
```

Hat die Phase mehrere Aufträge, steht für jeden eine Zeile „Auftrag:“ da.

Dann prüfst du und zeigst dem Nutzer jede Ausgabe:

1. `git diff --name-only upstream/master..HEAD` nennt keinen Pfad unter `plaene/` und nur Dateien, die Teil 2 geändert hat; `git status --porcelain --untracked-files=all` ist leer.
2. `node tools/tests-nur-ergaenzt.mjs --basis upstream/master --pr 1` meldet „keine bestehende Testzeile geändert oder gelöscht“. Sonst verlangt Testschutz ein öffentliches Issue; dann hältst du an und besprichst mit dem Nutzer, wie es weitergeht.
3. Die Wortprüfung findet nichts in Branch-Name, Commit-Nachrichten, PR-Titel und PR-Text aus Schritt 6: `{ git branch --show-current; git log --format=%B upstream/master..HEAD; echo "<PR-Titel>"; echo "<PR-Text>"; } | grep -i -E "$W"` mit `W='ghsa|cve|advisory|sicherheit|security|secure|lücke|luecke|leck|leak|vuln|exploit|angriff|angreif|attack|vertraulich|schwachstelle|pentest|auth|token|signatur|inject|xss|csrf|ssrf|rce|bypass|umgeh|unbefugt|missbrauch|unsicher'`. Trifft sie nur den Namen in `<bereich>` und `<Datei>`, setzt du dort `wartung` ein und prüfst neu.
4. `git diff upstream/master..HEAD | grep '^+' | grep -i -E "$W"`: Jede Trefferzeile zeigst du dem Nutzer. Verrät eine Zeile die Lücke (Testname, Kommentar, Fehlermeldung, neuer Dateiname), hältst du an; neu benennen geht nur über einen neuen Auftrag in Teil 2 und danach Schritt 3 und 5 neu.
5. Schritt 3 noch einmal auf diesem Branch, dazu `npx --no-install commitlint --from upstream/master --to HEAD`, alles grün.

## 6. Push und PR nach Zustimmung des Nutzers
Sag dem Nutzer vor dem Push: Ab dem Push kann jeder den Fix lesen, die Lücke ist in der Produktion aber noch offen, bis der Live-Deploy durch ist, nach bisheriger Erfahrung 20 bis 35 Minuten, mit Nacharbeit länger. Schlag ihm vor, die betroffene Funktion bis dahin abzuschalten wie in 3a Schritt 1, wenn das geht; er entscheidet. Erst nach seinem ausdrücklichen Ja pushst du den Branch nach `upstream` und öffnest den PR: Titel gleich der ersten Zeile des Commits, Text ein Satz „Behebt einen Fehler in <Datei>.“, kein `Closes #`, kein Verweis auf ein Issue. Dann Auto-Merge wie bei jedem PR.

## 7. Bis zum Live-Deploy begleiten
- Wird ein Check rot oder fällt der PR aus der Warteschlange, sag es dem Nutzer und frag, ob er nacharbeiten will. Nacharbeit nur so: neuer Auftrag in der Phasendatei, `lauf` auf dem Branch `$V`, Schritt 3, dann auf `fehler/<bereich>` `git diff --binary "$A" "$V" -- . ':(exclude)plaene/' | git apply --3way --index`, ein neuer Commit im Format aus Schritt 5, Prüfungen 1 bis 5 aus Schritt 5, Push; danach `A=$(git rev-parse "$V")`.
- Ändert der Fix den Gesprächsabdruck, wartet der Live-Deploy auf einen Hörtest, den ein Owner von Hand startet. Sag das dem Nutzer sofort.
- Legt die Warteschlange nach dem Merge einen Rücknahme-PR an, ist die Lücke wieder offen und der Fix schon öffentlich. Das ist ein Notfall: sofort 3a Schritt 1, abschalten.
- Erscheint ein Issue mit dem Label `pruefer` zu diesem PR, das die Lücke oder eine verbleibende Schwachstelle beschreibt, sag es dem Nutzer sofort. Er kopiert den Befund als Kommentar ins Advisory und löscht dann als Admin in der Oberfläche oder im eigenen Terminal das Issue, das Artefakt `pruefer-ergebnis-pr<N>` des Laufs „Prüfer prüfen“ und, falls „Prüfer nachstellen“ lief, dessen Logs und Artefakt. Du selbst schreibst dort nichts.

## 8. Fork löschen und Advisory veröffentlichen
Bevor es weitergeht, liest du den Status „Prüfer“ am Kopf des PRs: `gh api repos/sundartha/hermes/commits/<kopf>/status --jq '.statuses[] | select(.context=="Prüfer") | .state + " " + .description'`. Steht dort „Sicherheitsbefund“ oder „BLOCKER“, hältst du an; ob der Fix reicht und ob veröffentlicht wird, entscheidet der Nutzer. Sonst: Sobald der Lauf „Live“ (`.github/workflows/live.yml`) für den Merge-Commit grün ist, löscht der Nutzer im Advisory den temporären privaten Fork, ergänzt die betroffenen Versionen und veröffentlicht das Advisory, ohne Pause dazwischen. Hat er eine Funktion abgeschaltet, schaltet er sie danach wieder ein. Erst jetzt dürfen Phasendatei, Postmortem und Notizen über die Lücke ins Repo.

Stellt sich in Schritt 1 oder 2 heraus, dass keine Sicherheitslücke vorliegt, löscht der Nutzer zuerst den Fork und schließt dann das Advisory ohne Veröffentlichung („Close security advisory“). Ist es ein gewöhnlicher Fehler, geht er danach den Weg 3b ohne die Markierung „vertraulich“.
