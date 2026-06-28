# G4-Spec — Reprompt-Verschlankung + Log-Cleanup

Autoritative Scope-/Design-/Abgrenzungs-Definition fuer Phase G4 der
PLAN-CONVERSATION-QUALITY.md-Kette. Verbindlich VOR dem Plan-Doc.

## G4 — Reprompt-Verschlankung + Log-Cleanup (letzte Phase der Kette)

**Owner-Override (wichtig, vermerken):** Plan §3 G4 schiebt den Log-Cleanup bewusst auf, bis
die G2/G3-Live-Gates gruen sind. Der Owner hat G4 explizit JETZT angeordnet ("mach jetzt G4" +
"mach weiter") — die Deferral ist damit bewusst aufgehoben. Der Log-Cleanup darf jetzt laufen.

### Scope (NUR das — kein scope creep)

**1. Temp-Diagnose-Logs entfernen** in `src/server.js` (Handler `app.post("/voice/turn", ...)`):
- Der `console.log("[turn-recv]", ...)`-Block am Anfang des Handlers (Feld-Namen + Wert-Laengen)
  samt zugehoerigem `TEMP-DIAGNOSE ... Phase 3: wieder entfernen`-Kommentar davor.
- Das `console.log("[turn-recv] -> frueher Hangup: ...")` im Call-fehlt/inaktiv-Zweig (der
  Hangup-Zweig selbst BLEIBT, nur das Log raus).
- Der `console.log("[turn-ok]", ...)`-Block im Erfolgspfad samt `TEMP-DIAGNOSE ... Gegenstueck
  zu [turn-recv] ... Phase 3: zusammen mit [turn-recv] wieder entfernen`-Kommentar davor.
- Der sachliche Erklaer-Kommentar weiter oben (bei der `extractSpeech`-Logik: "Telnyx zeigt real
  `SpeechResult` statt `Transcript`") BLEIBT erhalten — er erklaert Provider-Verhalten, nicht die
  Temp-Logs. Nur die jetzt haengende `[turn-recv]`-Referenz darin neutral umformulieren (z.B.
  Datums-/Quellenhinweis statt Log-Tag), die Erklaerung NICHT loeschen.
- Der `console.error("[turn]", err.message)` im catch-Zweig ist KEIN Temp-Log (regulaeres
  Fehler-Logging) -> BLEIBT unveraendert.

**2. No-Speech-Reprompt verschlanken** in `src/i18n/locales.js` (`noSpeechReprompt` je Locale):
- Ziel: TTS-Sekunden im No-Speech-Wiederhol-Pfad sparen (knappe Rueckfrage, Apologie-Filler raus).
- Vorschlag: de `"Koennen Sie das bitte wiederholen?"`, en `"Could you repeat that?"`,
  fr `"Pouvez-vous répéter ?"`.
- WENN der Clean-Code-/Verhaltens-Review die aktuelle Fassung bereits als ausreichend knapp
  bewertet, diesen Teil WEGLASSEN statt die UX zu verschlechtern — kein Zwangs-Diff. Dann ist
  G4 nur der Log-Cleanup. Diese Entscheidung im Plan begruenden.

### NICHT in Scope (Abgrenzung)
- `redirectD`-Entfernung: ausgeschlossen (Plan §3 G4 + §6, kein Offline-Beleg, nur Live-Gate).
- Keine anderen Dateien. Insbesondere NICHT `OWNER-GOLIVE-GESPRAECH.md` anfassen (die
  Checklist-Anpassung macht der Lead nach dem Merge).
- Keine Gate-/Offenlegungs-/Auth-Aenderung. Keine neue npm-Dependency.

### Invarianten / Safety
- `/voice/turn` ist der Gespraechs-Hot-Path. Verhalten ausser den zwei Punkten oben
  byte-identisch. Der gekuerzte Reprompt rendert weiter `<Say>`+`<Gather>` (ueber
  `followupTurnDirectives`), NIE `<Hangup>`.
- Offenlegungssatz + alle Safety-Gates (numberGateError, Budget, Identitaets-Gate) unberuehrt.
- Kommentare deutsch OHNE Umlaute (ue/oe/ae). ESM, kein Build-Step.

### Deterministisch pruefbares Ergebnis (Checks)
- `node --check src/server.js && node --check src/i18n/locales.js` -> ok.
- `npm test` (beide Backends) gruen, Baseline 1172 pass / 0 fail. Kein Bestandstest pinnt
  aktuell die Temp-Logs oder den Reprompt-String (grep test/ leer) -> i.d.R. keine Test-Aenderung
  noetig. Falls doch ein Test den alten String/Log pinnt: Test mitziehen + begruenden.
- `grep -rn "\\[turn-recv\\]\\|\\[turn-ok\\]" src/` -> KEIN `console.log` mehr (hoechstens der
  umformulierte Erklaer-Kommentar, der die Tags nicht mehr als Log fuehrt).
- Hangup-Regression-Suite bleibt gruen (Reprompt erzeugt nie `<Hangup>`).

### Reiner-Refactor-Hinweis
Punkt 1 ist verhaltens-neutral (nur Logging raus) -> Bestandssuite muss OHNE Test-Aenderung gruen
bleiben. Punkt 2 aendert nur einen ausgesprochenen String -> falls ein Snapshot-Test ihn pinnt,
Snapshot aktualisieren; sonst keine neue Test-Logik noetig.
