# Phase IEX-A5: record_voice gerichtet schreibbar

**Gate: PASS**
**finalBranch:** `phase/iex-a5-record-voice`

## Plan (gekuerzt)

Basis war master `e82e96b`. Ziel: `record_voice` aus `GESPERRTE_FELDER` in `scripts/push-elevenlabs.mjs` entfernen und stattdessen ueber eine neue, enge Richtungs-Ausnahme `RECORD_VOICE_ERLAUBT` (`{feld: "record_voice", wert: false, seit: "2026-09-15", grund: "Owner-Entscheidung O2 ..."}`) nur in Richtung `false` schreibbar machen. `retention_days` bleibt in `GESPERRTE_FELDER` und ist weiterhin in KEINER Richtung schreibbar.

Bausteine laut Plan:
- Riegel 1a/1b (Nennung bzw. blinder Passagier) bleiben fuer `retention_days` unveraendert scharf.
- Neuer Riegel 1c (`falscheRichtungStellen`) durchsucht den fertigen Patch-Koerper (auch in Listen) und meldet `RICHTUNG GESPERRT`, sobald `record_voice` dort einen anderen Wert als `false` traegt — strikt `!==`, faengt `null`/`"false"`/`0` ab (fail-closed).
- `stellenMitSchluessel` bekommt den Wert als zweites Praedikat-Argument (bestehende Aufrufer bleiben unveraendert).
- `koerperVerstoesse` ruft Riegel 1c zusaetzlich zu den bestehenden Riegeln auf, VOR der Weiche Trockenlauf/Ausfuehren.
- `bauePatchKoerper` wird exportiert, als Testnaht (da `ladeVorlage()` keine Einspeisestelle hat).
- Vorlage `outbound-agent.template.json`: der `ausgenommen`-Block am `record_voice`-Besitzeintrag entfaellt, `_hinweis` bekommt den O2-Owner-Entscheidungssatz.
- Vier reine Kommentar-Nachzuege (keine Logik) in `elevenlabs-besitz.mjs`, `check-elevenlabs-drift.mjs`, `test/helpers/elevenlabs-push-attrappe.mjs`, `test/elevenlabs-drift-rotprobe.test.js` — von "zwei ausgenommene Felder" auf "ein Feld" korrigiert.
- `PLAN-SECURITY.md` bekommt neuen Unterabschnitt 8 unter IEL-B9 mit Owner-Begruendung O2.
- 7 neue/umgebaute Tests `IEX-A5-1..7` in `test/elevenlabs-push-sperrliste.test.js` (Erlaubnis-Fall, kombinierte Nennung bricht weiterhin ab, Grenzwerte-Tabelle true/null/"false"/0 als Objekt und Liste, Positiv-Kontrolle `false`, Vorlage-im-Speicher-manipuliert-Gegenprobe ueber die reinen Bausteine) und `test/elevenlabs-push-feldauswahl.test.js` (Vorlage nimmt nur noch `retention_days` aus, Trockenlauf ohne Feldauswahl zeigt `record_voice` als Schreib-Kandidat).
- Pre-Mortem im Plan deckte ab: Vorlage wieder auf `true` gesetzt (Riegel 1c faengt es), `retention_days` versehentlich mitgenommen (Sperre bleibt hart, auch kombiniert), Aufweichung erfasst weitere Felder (Ausnahme ist ein einzelnes, striktes Objekt), Drift-Anzeige bis Push rot (akzeptiert, dokumentiert), Anbieter-Wirkung von `record_voice=false` auf Transkripte (werkzeugseitig nicht pruefbar, Messung M-O2 separat in Runbook a5).

Betroffene Dateien laut Plan (9, kein `src/`): `scripts/push-elevenlabs.mjs`, `elevenlabs/agent_configs/outbound-agent.template.json`, `scripts/lib/elevenlabs-besitz.mjs`, `scripts/check-elevenlabs-drift.mjs`, `test/helpers/elevenlabs-push-attrappe.mjs`, `test/elevenlabs-push-sperrliste.test.js`, `test/elevenlabs-push-feldauswahl.test.js`, `test/elevenlabs-drift-rotprobe.test.js`, `PLAN-SECURITY.md`.

## Impl-Zusammenfassung

Head-Commit: `f94cf5157f9adb3926ea8093a330862aebbf2de1`. `node --check` sauber, volle Suite 5854/5854 gruen (0 fail, `--test-concurrency=4`).

Umgesetzt exakt gemaess Plan:
- `GESPERRTE_FELDER` ist jetzt nur noch `["retention_days"]`.
- Neue Konstante `RECORD_VOICE_ERLAUBT` (eingefroren) mit `feld`, `wert: false`, `seit`, `grund`.
- Neue Funktion `falscheRichtungStellen` (Riegel 1c), delegiert an die bestehende `stellenMitSchluessel`-Traversierung, keine duplizierte Baum-Logik.
- `koerperVerstoesse` meldet bei Verstoss `RICHTUNG GESPERRT - record_voice wird nur als false geschrieben ...` mit betroffenen Pfaden, keine Werte in der Ausgabe.
- `bauePatchKoerper` exportiert, mit Begruendungskommentar.
- Vorlage: `ausgenommen`-Block am `record_voice`-Eintrag entfernt, `_hinweis` um O2-Satz ergaenzt.
- 4 Kommentar-Nachzuege wie geplant, nur Text, keine Logik.
- `PLAN-SECURITY.md` Abschnitt 8 unter IEL-B9 ergaenzt.
- 7 Tests `IEX-A5-1..7` wie im Plan beschrieben, inkl. Grenzwerte-Tabelle und der Vorlage-im-Speicher-manipuliert-Gegenprobe ueber `vergleicheBesitz`/`teileAbweichungen`/`mitSchreibwerten`/`bauePatchKoerper`/`koerperVerstoesse`.

Ergebnis-Check: `node -e` auf der Vorlage lieferte `['retention_days'] false 0` (Ausnahmeliste, `record_voice`, `retention_days`), `grep -c credentials scripts/push-elevenlabs.mjs` = 0, `git diff --stat master` zeigte genau die 9 geplanten Dateien.

**Deviations:** keine (`deviations: []` im Impl-Report). Einzige dokumentierte Selbstkorrektur waehrend der Implementierung (kein Plan-Abweichen, kein Produktionscode betroffen): `setzeAnPfad` mutiert in-place und gibt `undefined` zurueck — im ersten Entwurf des Tests IEX-A5-5 faelschlich als reine Funktion verwendet, beim ersten Testlauf als AssertionError aufgefallen, mit einer Zwischenvariable korrigiert.

## Safety-Urteil

**approved: true**, alle Einzelurteile (`testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`) true, **blockers: []**.

Unabhaengiger Testlauf im Review-Worktree (`phase/iex-a5-record-voice`, 1 Commit `f94cf51`): `node --check` ok, Vorlage gueltiges JSON, betroffene/verbundene Testdateien 97/97 gruen, `el-stimme-abnahme` 8/1 (der eine rote Fall ist der vorbestehende ABNAHME-AS10, Abnahme-Bahn, kein Regressionsfang).

Verdict: PASS. Diff beschraenkt sich auf Werkzeug, Vorlage, Tests, `PLAN-SECURITY.md`; `src/` unberuehrt, damit keine Wirkung auf `claude.js`/`disclosureSentence`, Outbound-Offenlegung, Inbound-Pfad, Safety-Gates oder Auth. Keine neuen Dependencies. E7 wie in Spec umgesetzt: `retention_days` hart in beiden Richtungen gesperrt (auch kombinierte Nennung, IEX-A5-2), `record_voice` nur Richtung `false` offen, Riegel 1c strikt `!== false` inkl. Listen, laeuft vor jeder Trockenlauf/Ausfuehren-Weiche. Positiv- und Negativ-Kontrollen vorhanden (IEX-A5-1, -3, -4, -5).

Concerns (nicht blockierend):
- Wegfall von `ausgenommen` macht `record_voice` auch OHNE `--felder` zum Schreib-Kandidaten (Test IEX-A5-7 belegt das). Ein spaeterer `--ausfuehren`-Push ohne `--felder` schaltet den Mitschnitt nebenbei aus, noch vor Messung M-O2. Geht nur Richtung `false`, deckt sich mit O2/E7, datenschutzseitig unkritisch — Owner/Runbook a4 sollte informiert werden.
- `npm run elevenlabs:drift` bleibt fuer `record_voice` rot bis zum Push (Runbook a4). Gewollt, in Vorlagen-`_hinweis` und `PLAN-SECURITY.md` §8 dokumentiert.
- `bauePatchKoerper` zusaetzlich exportiert (Testnaht) — kleine Oberflaechenerweiterung, kein Verhaltenswechsel.
- Ausserhalb der urspruenglichen Spec-Dateiliste geaendert (aber laut Plan vorgesehen): `check-elevenlabs-drift.mjs`, `elevenlabs-besitz.mjs`, `elevenlabs-drift-rotprobe.test.js`, `elevenlabs-push-attrappe.mjs` — per Diff geprueft, dort nur Kommentare.
- `test/el-stimme-abnahme.test.js` hat den vorbestehenden roten Fall ABNAHME-AS10 (Owner-Entscheidung 2026-09-04, kein Testanruf), gehoert zur Abnahme-Bahn und ist unabhaengig von diesem Diff.

## Clean-Code-Audit (S1-S4)

**blocker: false**, Verdict: PASS.

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3:** eine kosmetische Anmerkung — `test/helpers/elevenlabs-push-attrappe.mjs:55-56`, neuer Kommentar-Satz auf einer ~127-Zeichen-Zeile statt der im Bestand ueblichen ~75-80 Zeichen Umbruchbreite. Empfehlung: auf Bestandsbreite umbrechen.
- **S4:** eine begruendete, nicht-blockierende Anmerkung (G5, "leicht/geduldet") — der neue Test-Helper `koerperAusVorlage()` (IEX-A5-5) bildet die Aufrufreihenfolge von `laufeAgentenPush()` nach statt `runCli()` end-to-end zu treiben; im Code-Kommentar begruendet (Repo-Vorlage soll im Test nicht ueberschrieben werden), ruft nur bestehende reine Funktionen auf, keine Logik-Duplizierung. Hinweis: bei kuenftiger Umstellung der Pipeline-Reihenfolge in `laufeAgentenPush()` diesen Helper synchron halten.

Weitere Feststellungen: keine Magic-Number-, Dead-Code- oder Umlaut-Verstoesse; Kommentare sorgfaeltig und aktuell (kein C2/C5); `PLAN-SECURITY.md` wie von CLAUDE.md gefordert erweitert; Verifikation im temporaeren Worktree auf dem echten Phase-Commit: `node --check` fehlerfrei, 40/40 in den vier direkt betroffenen Testdateien gruen, 299/299 in allen `elevenlabs*`-Testdateien gruen.

Top-Todos (nicht blockierend):
1. Kommentarzeile in `test/helpers/elevenlabs-push-attrappe.mjs` (~Zeile 55) auf Bestandsbreite umbrechen.
2. Bei kuenftiger Umstellung der Push-Pipeline (`laufeAgentenPush`) den Test-Helper `koerperAusVorlage()` in derselben PR mitziehen.

## Fix-Runden

Keine — der erste Review-Durchlauf (Safety + Clean-Code) ergab PASS ohne Blocker; keine Fix-Runde noetig.
