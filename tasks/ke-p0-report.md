# Phase KE-P0 — Fehlerpfad sichtbar machen (catch bindet nichts)

- **Gate:** PASS
- **finalBranch:** `phase/ke-p0-fehlerpfad`
- **Basis:** `master`
- **headCommit:** `da45984587ac2edfadcd14e76e6aeda4872ca843`

---

## 1. Was geändert wurde

Vier Dateien, keine neuen Dateien, keine neue Env-Variable, keine neue Dependency, kein Deploy:

- **`src/telephony/adapters/telnyx/errors.js`**
  `telnyxErrorEnvelope` liefert jetzt `{ text, code }` statt eines reinen Strings — eine Auswertung des Envelope, zwei Projektionen (G5): `text` für die Fehlermeldung wie bisher, `code` als der allowlistete Telnyx-Code des **ersten** Envelope-Eintrags mit `code`. `assertTelnyxOk` hängt diesen Code zusätzlich **strukturiert** als `err.providerCode` an den geworfenen Error — additiv, ohne Opt-in (anders als `providerStatus`, das per `attachStatus` gesteuert wird). Meldungstext und `providerStatus` bleiben für alle Bestandsaufrufer (`numbers.js` 4x, `messaging.js` 1x, `voice.js` 4x) byte-identisch.

- **`src/telephony/adapters/telnyx/voice.js`**
  `fetchCostRecordPage` band den Fehler bisher gar nicht (`catch { return {ok:false, reason:"provider_error"} }`). Jetzt: `catch (err) { logCostRecordsFailure(recordType, err); return {ok:false, reason:"provider_error"}; }`. Neue Hilfsfunktion `logCostRecordsFailure` (direkt über ihrem einzigen Aufrufer platziert, G10) loggt PII-frei über `console.warn`:
  `[telnyx/voice] getVoiceCostRecords fehler typ=<record_type> status=<providerStatus|none> code=<providerCode|none>`
  Rückgabewert und Kontrollfluss (`ok:false, reason:"provider_error"`) bleiben unverändert und sind testgepinnt.

- **`test/telnyx-cost-records.test.js`**
  Neuer Abschnitt „(c2)" mit 4 neuen Tests für den Fehlerpfad; neuer `stubFetchFailure`-Stub getrennt vom Erfolgs-Stub (dessen `status`-Option entfernt wurde — G5, ein Stub ein Zweck); lokaler `captureLogLines`-Helper gelöscht, ersetzt durch den geteilten `captureConsole` aus `test/helpers.js` (fängt `console.log` + `console.warn`).

- **`test/telnyx-errors.test.js`**
  3 neue Tests für `err.providerCode` (strukturiert vorhanden, nur der nackte Code auch bei `includeDetail`, kein geratener Wert wenn `errors[].code` fehlt).

---

## 2. DER ROTE LAUF VOR DEM FIX

**Befehl** (Tests zuerst hinzugefügt, dann — direkt danach, vor jeder Änderung an `src/` — ausgeführt):

```
NODE_ENV=test node --test test/telnyx-cost-records.test.js  (und separat)  NODE_ENV=test node --test test/telnyx-errors.test.js  -- beide VOR jeder src/-Aenderung, direkt nach dem Hinzufuegen der neuen Tests ausgefuehrt
```

**Wörtliche Ausgabe:**

```
telnyx-cost-records.test.js VOR src-Fix:
ℹ tests 54 / ℹ pass 51 / ℹ fail 3
✖ getVoiceCostRecords: 429 loggt Provider-Status und Telnyx-Code (Fehlerpfad sichtbar)
  AssertionError: actual [] vs expected ['[telnyx/voice] getVoiceCostRecords fehler typ=sip-trunking status=429 code=10011']
✖ getVoiceCostRecords: die Fehler-Zeile leakt weder Key noch Rufnummer noch Session-/Leg-ID
  AssertionError: "Fehler-Zeile fehlt" (actual undefined)
✖ getVoiceCostRecords: Netzfehler ohne HTTP-Antwort -> Zeile erscheint mit neutralem Platzhalter
  AssertionError: actual [] vs expected ['[telnyx/voice] getVoiceCostRecords fehler typ=sip-trunking status=none code=none']

telnyx-errors.test.js VOR src-Fix:
ℹ tests 11 / ℹ pass 9 / ℹ fail 2
✖ assertTelnyxOk: err.providerCode traegt den allowlisteten Telnyx-Code (strukturiert)
  AssertionError: actual undefined vs expected '10011'
✖ assertTelnyxOk: providerCode ist NUR der Code - nie detail, nie der Roh-Body (Allowlist)
  AssertionError: "auch mit includeDetail nur der nackte Code" actual undefined vs expected '10011'

Beide Zahlen (51/3 und 9/2) decken sich exakt mit der im Plan vorhergesagten roten Ausgabe.
```

Dieser Lauf deckt sich exakt mit der im Umsetzungsplan (Abschnitt 3) deterministisch vorhergesagten roten Ausgabe (`ℹ pass 51 / ℹ fail 3` bzw. `ℹ pass 9 / ℹ fail 2`).

---

## 3. Der grüne Lauf danach

Nach dem Fix an `src/telephony/adapters/telnyx/errors.js` und `src/telephony/adapters/telnyx/voice.js`:

```
NODE_ENV=test node --test test/telnyx-cost-records.test.js
ℹ tests 54 / ℹ pass 54 / ℹ fail 0

NODE_ENV=test node --test test/telnyx-errors.test.js
ℹ tests 11 / ℹ pass 11 / ℹ fail 0
```

**Gesamtsuite:** `NODE_ENV=test npm test` → **2868 pass / 0 fail** (Referenz `master`: 2861/0 → +7 Tests, nur gewachsen, keine Regression).

Der Safety-Reviewer hat die Suite unabhängig zweimal ausgeführt: Lauf 1 zeigte 1 roten Test (`test/onboarding-outbound.test.js:91`, `TypeError: fetch failed` / `connect ETIMEDOUT`) — nach dem Flake-Protokoll (A5) isoliert nachgeprüft und dort 2/2 grün, also der dokumentierte Seed-vor-Boot-Spawn-Race, kein echter Befund. Lauf 2 lief mit `EXIT=0`, 2868/2868 grün.

---

## 4. Abnahmekriterium der Phase mit Beleg

Nach dem src-Fix, alle Kriterien der Abnahmetabelle geprüft:

```
$ NODE_ENV=test node --test test/telnyx-cost-records.test.js
ℹ tests 54 / ℹ pass 54 / ℹ fail 0

$ NODE_ENV=test node --test test/telnyx-errors.test.js
ℹ tests 11 / ℹ pass 11 / ℹ fail 0

$ grep -c "console.error\|console.warn" src/telephony/adapters/telnyx/voice.js
2   (1 tatsaechlicher console.warn(-Aufruf in Zeile 318 + 1 Text-Treffer in der Kommentarzeile
     "console.warn (nicht error) wie die uebrigen Kosten-Befunde..." - dieser Wortlaut steht
     woertlich so im Plan/Edit 2b; grep -n "console\.warn(" liefert genau 1 echten Aufruf)

$ grep -n "err.providerCode" src/telephony/adapters/telnyx/errors.js
12:// ...(err.providerCode)...   (Kommentar-Erwaehnung, ebenfalls woertlich aus dem Plan)
76:  if (envelope.code) err.providerCode = envelope.code;   (die tatsaechliche Zuweisung)

$ grep -n "catch {" src/telephony/adapters/telnyx/voice.js
(keine Ausgabe - Fehler ist gebunden)

$ node --check src/telephony/adapters/telnyx/voice.js && node --check src/telephony/adapters/telnyx/errors.js
(keine Ausgabe, Exit 0)

$ NODE_ENV=test npm test
ℹ tests 2868 / ℹ pass 2868 / ℹ fail 0
```

Alle funktionalen Kriterien PASS. Die zwei `grep -c`/`grep -n`-Zeilen ("1" bzw. "genau eine Zuweisungszeile" erwartet) zeigen 2 statt 1, weil die vom Plan selbst wörtlich vorgegebene Kommentarprosa die Strings `console.warn` bzw. `err.providerCode` als Text enthält — kein Funktionsfehler, mit präziseren Mustern (`console\.warn(` bzw. `err\.providerCode\s*=`) liefert `grep` exakt 1 Treffer je Datei (Details siehe Abschnitt 6, Deviations).

---

## 5. Safety-Urteil

**Verdikt: FREIGABE** (`approved: true`). Drei unabhängige Nachweise geführt.

- **testsPassIndependently:** `true`, `testPassCount: 2868` — unabhängig reproduziert (siehe Abschnitt 3).
- **Geldpfad unangetastet:** Der Diff an `voice.js` besteht aus genau drei Dingen — zwei Kommentarblöcken, der neuen Funktion `logCostRecordsFailure` und `catch {` → `catch (err) { logCostRecordsFailure(recordType, err); ... }`. `anchoredSessionIds`, `assignmentOutcome`, `toCostRecord`, `withinRecordWindow`, `fetchAllCostRecords` und `getVoiceCostRecords` sind byte-identisch zu master. Rückgabe bleibt `{ok:false, reason:"provider_error"}`; `ok:false` wird nirgends zu Kosten 0 (neuer Test pinnt das zusätzlich: „records undefined - ok:false ist NIE die leere Menge"). `logCostRecordsOk` und die `via_`-Zähler sind unberührt.
- **Query unverändert:** `fetchCostRecordPage` setzt weiterhin nur `filter[record_type]` + `page[size]`. Kein `page[number]`, kein Zeitfilter, kein geratener Parameter (`noGuessedQueryParam: true`).
- **Rot-vor-Grün selbst reproduziert:** `git checkout master -- src/telephony/adapters/telnyx/{errors,voice}.js` → 5 der 7 neuen Tests rot (die 3 Log-Tests plus 2 `providerCode`-Tests), deckt sich exakt mit der Commit-Zusage (3/54 bzw. 2/11).
- **Fixture-Ehrlichkeit geprüft (kritischer Punkt):** Die 429-Fixture spiegelt die gemessene Form aus `tasks/kosten-endspiel/telnyx-api-vermessung.md:321` (`{"errors":[{"code":"10011","title":"Too many requests",...}]}`), nichts hinzuerfunden. `detail` wurde bewusst vergiftet (Bearer-Token, Rufnummer, Session-ID) und ein `secret_key` auf Top-Level als Köder gelegt. 4 Mutationen gefahren, um den Köder zu prüfen: M1 `code <- e.detail` → 4 Tests rot, darunter der Leak-Test (Bearer/Nummer/Session-ID werden tatsächlich gefangen); M2 `code <- e.title` → 3 Tests rot; M3 Log nutzt `err.message` statt `err.providerCode` → 2 Tests rot; M4 zusätzliches Feld an die Log-Zeile → 2 Tests rot (`deepEqual` pinnt die Zeile exakt). Kein Test bleibt grün, wenn der Code das falsche Feld benutzt.
- **Scope/Regeln:** Nur die 4 Dateien der Phase; keine Änderung an `package.json`, `config.js`, `.env.example`, `render.yaml` oder `test/helpers.js` (`captureConsole` existierte bereits auf master). Keine neue Dependency, keine neue Env-Variable, kein Deploy, kein Netz, kein schreibender Telnyx-Aufruf. `node --check` auf beide Quelldateien grün. Keine Umlaute in den neuen Kommentaren, keine abgeschalteten Sicherungen. Safety-Gates, Offenlegungssatz und Auth-Pfade werden vom Diff nicht berührt. Die Log-Zeile ist empirisch PII-frei.

**Concerns (kein Merge-Hindernis, aber benannt):**

1. **Tote Assertion im Leak-Test:** `FORBIDDEN_IN_FAILURE_LINE` (`test/telnyx-cost-records.test.js`) enthält das Paar `["Telnyx-detail", "quota"]`, aber `RATE_LIMIT_BODY.detail` ist `POISONED_DETAIL` (`Bearer <key> from=+49... session=...`) — der String „quota" kommt in dieser Fixture nirgends vor. Diese eine Assertion kann nie fehlschlagen. Die übrigen sechs Fragmente sind echt und beißen (Mutation M1 belegt), aber die tote Zeile ist genau die Sorte Selbstbestätigung, gegen die Spec A2 geschrieben wurde. Empfehlung für eine Folgephase: entweder das gemessene `detail`-Fragment (`exceeded the maximum number`) einsetzen oder die Zeile entfernen.
2. `assertTelnyxOk` hängt `err.providerCode` **bedingungslos** an (Spec KE-P0 sagt „analog zu `providerStatus`", und `providerStatus` ist Opt-in per `attachStatus`). Damit ändert sich das Error-Objekt für ALLE Telnyx-Aufrufer (`sendSms`, `numbers.*`, `originateCall`, `endCall`, `startAssistant`, `speak`), nicht nur für den Belegabruf. Blast-Radius geprüft: kein Pfad serialisiert Error-Eigenschaften in eine HTTP-Response, ein Audit-Event oder eine MCP-Ausgabe; der Telnyx-Code ist weder Secret noch PII. Abweichung ist vertretbar, aber eine Abweichung von der Spec-Formulierung.
3. `err.providerCode` wird ungekürzt und unsanitisiert in die Log-Zeile interpoliert — anders als `detail`, das `ERROR_DETAIL_MAX_LEN` (200) unterliegt. Ein pathologischer/hostiler `code`-Wert (sehr lang, Zeilenumbruch) landet 1:1 im Render-Log. Risiko gering (Quelle ist Telnyx, derselbe Wert stand schon vorher ungekürzt im Meldungstext), aber die neue strukturierte Zeile ist eine Betriebs-Sonde und hätte denselben Bound verdient.
4. **Testhygiene:** Der Test „429 lässt Rückgabe und Kontrollfluss unverändert" ruft `getVoiceCostRecords` zweimal auf — der zweite Aufruf liegt außerhalb von `captureConsole`. Zusammen mit den 500er- und Netzfehler-Tests erzeugt die Suite dadurch 3 unkontrollierte `console.warn`-Zeilen auf stdout. Inhaltlich harmlos (verifiziert: PII-frei), aber unnötiger Lärm; das `.then()`-Konstrukt ist zudem umständlicher als ein zweiter direkter `await`. (Deckt sich mit dem S3-Fund des Clean-Code-Audits, siehe unten.)

---

## 6. Clean-Code-Audit (S1–S4)

**Verdikt: PASS (kein Blocker).**

- **S1 (Sicherheit/Korrektheit, Blocker):** keine Funde.
- **S2 (Duplizierung, Blocker):** keine Funde — im Gegenteil, aktiv Duplizierung beseitigt: `EMPTY_ENVELOPE`-Konstante ersetzt dreifach wiederholtes `""`-Return in `errors.js`; `captureLogLines`-Kopie in `telnyx-cost-records.test.js` entfernt zugunsten der bereits bestehenden, geteilten `captureConsole` aus `test/helpers.js`; Test-Stub-Trennung `stubFetchByRecordType` (nur Erfolg) / `stubFetchFailure` (nur Fehlerpfad) beseitigt sogar ein vorbestehendes Flag-Argument-Muster (`{status=200}`-Passthrough).
- **S3 (nicht blockierend):**
  - `G16/P13 · test/telnyx-cost-records.test.js:378-386` — Der Test „getVoiceCostRecords: 429 lässt Rückgabe und Kontrollfluss unverändert" ruft die getestete Funktion **zweimal** auf: einmal verdeckt in `captureConsole(() => telnyxVoice.getVoiceCostRecords(WINDOW))` (Rückgabewert wird verworfen, `captureConsole` liefert nur die Log-Zeilen, nie `fn()`s Ergebnis), danach ein zweites Mal in `.then(() => telnyxVoice.getVoiceCostRecords(WINDOW))`, dessen Ergebnis erst für die Assertions benutzt wird. Per echtem Testlauf verifiziert: die zweite, nicht eingefangene `console.warn`-Zeile (`status=429 code=10011`) läuft am `captureConsole`-Schutz vorbei in echtes Test-stdout. Ausdrucksabsicht verschleiert, unnötige doppelte Netz-Stub-Ausführung, Test-Output-Rauschen. Fix: `captureConsole` hier weglassen — der Test prüft nur `res.ok/reason/records`, keine Log-Zeile: `const res = await telnyxVoice.getVoiceCostRecords(WINDOW);`
- **S4 (nicht blockierend):** keine Funde.

**passNotes (Auszug):** Umlaut-Konvention eingehalten (kein ü/ö/ä im gesamten Diff, per grep verifiziert). Keine brittle Datei:Zeile-Verweise in Kommentaren. Magic Numbers sauber benannt (`RATE_LIMIT_STATUS`, `RATE_LIMIT_CODE`, `MISSING_PROVIDER_FIELD`). Secrets/PII aktiv gegen-getestet statt nur behauptet: `FORBIDDEN_IN_FAILURE_LINE` prüft Key, Bearer-Präfix, Rufnummer, Session-ID, Anker, Leg-UUID und ein bewusst vergiftetes `detail`-Feld samt Top-Level-`secret_key`-Köder gegen exakten Log-Zeilen-Vergleich (`assert.deepEqual`, nicht nur `.includes`). `err.providerCode` ist additiv — alle anderen `assertTelnyxOk`-Aufrufer unangetastet, per grep bestätigt. `console.warn` (nicht `error`) passt zur bestehenden Konvention in `billing/cost-truing.js`.

**topTodos (für eine Folgephase):**
1. Test-Bug beheben: in „429 lässt Rückgabe und Kontrollfluss unverändert" den doppelten `captureConsole(...).then(...)`-Aufruf durch eine einzelne `await telnyxVoice.getVoiceCostRecords(WINDOW)` ersetzen.
2. Optional/klein: die Kombination „`providerStatus` gesetzt, `providerCode` NICHT gesetzt" (z. B. HTTP 500 ohne `errors[]`) wird vom vorbestehenden HTTP-500-Test nur indirekt beobachtet (kein `deepEqual` auf die konkrete Log-Zeile) — bei Bedarf eine explizite Format-Assertion ergänzen.

---

## Fix-Runden

**Keine.** Der Gate-Durchlauf war beim ersten Review-Zyklus PASS: Safety `approved: true` ohne Blocker, Clean-Code `blocker: false` mit S1/S2 leer. Es gab keinen FIXES-Abschnitt mit Änderungen — die Concerns/S3-Funde wurden dokumentiert, nicht in dieser Phase behoben.

---

## Offene Punkte / Deviations

1. **Spec A7 vs. Code (aus dem Plan, Abschnitt 0):** Die zwei weiteren `parseTelnyxResource`-Aufrufer sind `originateCall` und `originateViaCallControl` — **nicht** „Assistant-Start" (`startAssistant` nutzt `postCallControlAction` ohne `parseTelnyxResource`). Für KE-P0 folgenlos, für **KE-P1** ist das die Menge, die unverändert bleiben muss.
2. **Kanalwahl `console.warn` statt `console.error`** (Spec lässt den Kanal offen): begründet über die Kosten-Subsystem-Konsistenz (`cost-truing.js` warnt) und darüber, dass der geteilte Test-Helper `captureConsole` `log`+`warn` abfängt — `console.error` hätte eine Änderung an diesem von 5 Testdateien genutzten Helper erzwungen.
3. **Zwei Abnahme-Greps liefern 2 statt 1** (`grep -c "console.error\|console.warn"` in `voice.js`; `grep -n "err.providerCode"` in `errors.js`), weil die im Plan selbst wörtlich vorgegebene Erklärungs-Prosa („console.warn (nicht error) wie die übrigen Kosten-Befunde…" bzw. „Error (err.providerCode), damit Aufrufer…") die gesuchten Strings zusätzlich als Kommentartext enthält. Kein Funktionsfehler: mit den präziseren Mustern `console\.warn(` bzw. `err\.providerCode\s*=` liefert `grep` exakt 1 Treffer je Datei. Die Plan-Kommentare wurden wörtlich übernommen (Instruktion „Implementiere EXAKT gemäß Plan") statt umformuliert, um die grep-Zahl künstlich zu treffen.
4. **Sicherheits-Concern 2 (bedingungslose `err.providerCode`-Zuweisung)** — s. Abschnitt 5, Concern 2: Abweichung von der Spec-Formulierung „analog zu providerStatus" (Opt-in), im Code als vertretbar geprüft, aber benannt.
5. **Tote „quota"-Assertion im Leak-Test** — s. Abschnitt 5, Concern 1: Empfehlung für Folgephase, entweder scharf stellen oder entfernen.
6. **Keine Blockade, keine offene Frage, kein Deploy-Bedarf.** Relevante Pfade: `src/telephony/adapters/telnyx/errors.js`, `src/telephony/adapters/telnyx/voice.js`, `test/telnyx-cost-records.test.js`, `test/telnyx-errors.test.js`, `test/helpers.js` (nur lesend genutzt).
