# Lessons (selbst gefundene Stolpersteine, fuer kuenftige Sessions)

- **`node --test test/` schlaegt fehl** (Node 22 in diesem Setup versucht, das
  Verzeichnis als Modul zu laden). Funktioniert: `node --test "test/*.test.js"`.
- **stdout-Assertions gegen Kindprozesse brauchen Polling**: Die HTTP-Antwort
  erreicht den Test oft, BEVOR die Log-Pipe beim Parent angekommen ist
  (Flush-Race, fiel erst im parallelen Gesamtlauf auf, nicht isoliert).
  Loesung: `waitForLog()` in `test/helpers.js`.
- **Twilio-Client offline testen**: Mit leerer `TWILIO_ACCOUNT_SID` wirft
  `calls.create()` synchron ("username is required") VOR jedem Netzzugriff -
  damit ist der place_call-Pfad bis unmittelbar vor den API-Call offline
  testbar.
- **Nicht-localhost-Verhalten testbar ohne Spoofing**: Requests an die externe
  Interface-IP des Hosts (os.networkInterfaces) haben eine echte
  Nicht-127.0.0.1-Socket-Adresse; `X-Forwarded-For` waere durch die
  Phase-1-Fixes wirkungslos.
- **dotenv fuellt nur UNgesetzte Variablen**: Test-Kindprozesse muessen ALLE
  config-relevanten Env-Vars explizit setzen (auch leer), sonst sickert eine
  lokale `.env` in die Tests.
- **"Auf welchem Branch?" / "letzte Commits": erst `git fetch --all`**, bevor
  ich antworte. `git branch -a` zeigt nur bereits gefetchte Remotes; in diesem
  Repo lagen die juengsten Commits + `tasks/todo.md` auf einem ungefetchten
  Branch (`claude/plan-security-phase-one-n5dl1h`). "Letzte Commits" per
  Commit-Zeitstempel (`%cI`) ueber ALLE Branches bestimmen, nicht per HEAD des
  gerade ausgecheckten Branches.
- **Plaene koennen gegen aelteren Code geschrieben sein**: Der OAuth-Detailplan
  (Branch inspiring-gates) verwies auf Zeilennummern/Strukturen VOR Phase 2/3.
  Vor dem Umsetzen den Plan gegen den aktuellen Code abgleichen - hier u.a.: den
  in Phase 1 gesetzten Fail-closed-Default von `/mcp` NICHT durch den im Plan
  vorgeschlagenen offenen `off`-Default ersetzen.
