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
