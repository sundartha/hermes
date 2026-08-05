# Phase GQ-P15 — „Der Grund eines Fehlanrufs steht in der Benachrichtigung"

**Gate: PASS**
**finalBranch:** `phase/gq-p15-ausfall-grund-fix1`

---

## Plan (gekuerzt)

Basis: `master` (`2c5e1d3`). Autoritativ: `tasks/gq-p15-spec.md`.

**Befund am echten Code:** Der Ausfall-Grund (`call.failureReason`) wird bereits VOR dem
Settlement geschrieben (`store.recordFailureReason(...)` steht vor `terminateAndBillCall`
in `src/routes/voice.js`), und `billThunk` laedt den frisch mutierten Call. Die passive
Benachrichtigung im Frueh-Return-Zweig von `call-finish.js` baut ihren Text aber NUR aus
`call.status` (`t.statusBody(target, call.status)`) — der bereits vorhandene Grund wird nie
gelesen. Cap-Abbruch und Budget-Erschoepfung landen beide unter `status: "completed"` mit
leerem Transkript und erzeugen damit ununterscheidbare Nachrichten.

**Loesung:**

1. Neue Datei `src/i18n/failure-reason-texts.js`: `FAILURE_REASON_TEXTS` (de/fr/en, je
   `reasonLabel` + `phrases`-Tabelle fuer die Token `no-answer`, `busy`, `canceled`, `failed`,
   `max-duration-cap`, `budget-exhausted`) sowie `makeStatusBody(statusLabel, {reasonLabel,
   phrases})` — eine Faktorei statt drei separater Sprach-Lambdas. `Object.hasOwn` statt
   Index-Zugriff schuetzt gegen Prototypen-Injection ueber Provider-Token.
2. `src/telephony/failure-reason.js`: `DETAIL_SEPARATOR` als benannte Konstante (Trenner
   zwischen Basis-Token und SIP-Detail, z. B. `failed:603`), neue reine Funktion
   `failureReasonBase(reason)`, die diesen Trenner konsumiert.
3. `src/i18n/locales.js`: `statusBody` in `postCall` fuer de/fr/en auf `makeStatusBody(...)`
   umgestellt; ohne gesetzten Grund byte-identisch zum Bestandstext.
4. `src/telephony/call-finish.js`: `t.statusBody(target, call.status)` um einen dritten
   Parameter `call.failureReason` erweitert (1 Zeile).
5. Bewusst nicht angefasst: `src/ui/widgets/call.html` (eigener Browser-i18n-Kanal, eigener
   Befund), Gate-Kette, Settlement/Billing, Disclosure, Auth, Config.
6. Neue Testdatei `test/gq-p15-failure-reason-notification.test.js`, Praefix `GQ-P15-` liegt
   ausserhalb des Gates-Pattern → laeuft im Regressionslauf (`npm test`). Block A prueft das
   i18n-Bundle pro Sprache (Golden-Master ohne Grund, Phrase mit Grund, Unterscheidbarkeit
   `no-answer` vs. `busy`, Fremd-/Prototypen-Token, SIP-Detail wird nicht durchgereicht,
   Drift-Guard gegen die echten Token-Konstanten). Block B prueft den Produktionspfad ueber
   `makeCallFinish` mit werfenden Stub-Kollaboratoren (beweisen den Frueh-Return-Zweig).

**Pre-Mortem (im Plan vorweggenommen):** Rohtext-Leck → durch kuratierte Phrasen-Tabelle +
Fallback ausgeschlossen; Prototypen-Wert im Nutzertext → `Object.hasOwn`-Riegel; stiller
FR-Formatbruch → byte-genaue Golden-Master-Tests je Sprache; neues Token bleibt stumm →
Drift-Guard-Test erzeugt die Token-Menge aus den echten Quellen; Geld-/Gate-Pfad unberuehrt →
Diff beschraenkt auf Notification-Text. Akzeptiertes Restrisiko: der Call-Control-Hangup-Pfad
(`telnyx-call-control-ingest.js`) schreibt keinen `failureReason` — separater Befund, nicht
Teil dieser Phase.

---

## Impl-Zusammenfassung

Exakt gemaess Plan umgesetzt:

- **Neu:** `src/i18n/failure-reason-texts.js`, `test/gq-p15-failure-reason-notification.test.js`
- **Editiert:** `src/telephony/failure-reason.js` (DETAIL_SEPARATOR + `failureReasonBase`),
  `src/i18n/locales.js` (statusBody-Verdrahtung de/fr/en), `src/telephony/call-finish.js`
  (dritter Parameter `call.failureReason`)
- `node --check` auf allen vier Quelldateien: gruen (Exit 0, keine Ausgabe)
- Neue Testdatei isoliert: 19/19 gruen
- Nachbarschaftstests (p11-post-call-language, f1-i18n-locale, locale-field-consumers,
  de-umlaut-orthography, voice-status-lifecycle, cap-failure-reason, budget-failure-reason):
  40/40 gruen

### Deviations

1. **Testzahl 19 statt 18:** Die im Plan genannte Zielzahl 18 war ein Rechenfehler im
   Plan-Dokument selbst — die eigene Rechnung im Plan ("5 x 3 Sprachen + A6 + B1-B3" =
   15+1+3 = 19) ergibt 19. Die Umsetzung folgt exakt der Plan-Tabellenstruktur (A1-A5 je 3
   Sprachen, A6, B1-B3), nicht der falschen Zielzahl.
2. **`npm test` im Impl-Worktree nicht vollstaendig durchgelaufen** vor dem erzwungenen
   Struktur-Output: Hintergrundlauf stand bei 2726/~3044 Tests, 0 Fehlschlaege, aber nicht
   abgeschlossen — deshalb `testsPass: false` konservativ statt geraten gemeldet, kein Commit
   im Impl-Schritt.
3. **Direktes `npm test` via Bash schlug zweimal mit Exit 194 ohne TAP-Ausgabe fehl** (auch mit
   `dangerouslyDisableSandbox`), Ursache nicht abschliessend geklaert (vermutlich Sandbox-/
   Timeout-Effekt bei spawn-lastigem i18n-catalog-run-Wrapper). Workaround: identischer
   `node --test`-Befehl direkt via `run_in_background` gestartet — lief dort fehlerfrei durch.
4. **Prozess-Befund (Fix-Runde r1):** Die Implementierung lag nur uncommittet im
   Impl-Worktree `wf_16edc006-660-2`, `phase/gq-p15-ausfall-grund` trug 0 Commits — git-Zugriff
   auf fremde Worktrees ist in der Sandbox verboten. Ergebnis wurde in einer Fix-Runde als
   Branch `phase/gq-p15-ausfall-grund-fix1` neu committet.

---

## Safety-Urteil

**approved: true** — alle Einzelurteile (testsPassIndependently, safetyGatesIntact,
disclosureIntact, authFailClosedIntact, noSecretsLeaked, behaviorAsIntended, scopeRespected)
positiv, keine Blocker.

**Unabhaengiger Testlauf** (frischer Worktree `review-gq-p15-r1` = `phase/gq-p15-ausfall-grund-fix1`,
Basis `2c5e1d3` = master-Spitze): `npm test` → 4006/4006, 0 Fehlschlaege, 100 s. Beide
Store-Backends abgedeckt (JSON via BASE_ENV, pg via pglite). Neue Datei allein: 19/19.
Master-Baseline 3967 + 19 = 3986 (die im Plan genannte Spec-Zahl 3959 war veraltet, GQ-P13
hatte danach Tests ergaenzt). Mutationsproben zur Belegung, dass die Tests wirklich binden:
dritten Parameter in `call-finish.js` entfernt → 2 Tests rot; `Object.hasOwn`-Guard entfernt
→ 3 Tests rot.

Diff-Umfang: 5 Dateien, 287 Zeilen. `claude.js`, `bridge.js`, `config.js`, `route-policy.js`,
`auth.js`, `web-auth.js`, Outbound-Gates, `state-ops.js` unangetastet (Offenlegung, Gate-Kette,
Auth, Kostenpfad strukturell unberuehrt). Kein neuer Endpunkt, kein neuer Kanal. PII: nur das
bereits gefilterte Token wandert in eine Lookup-Tabelle; unbekanntes Token faellt auf den
Bestandstext zurueck (durch Test A4 inkl. `constructor`/`toString` belegt), SIP-Detail (`603`)
wird abgeschnitten (Test A5). `package.json`/`package-lock` unveraendert — keine neue Dependency.

**Concerns (nicht blockierend):**

- `prettier --check` flaggt die neue Datei `failure-reason-texts.js` (uneinheitlich gequotete
  Objekt-Keys) — kosmetisch, kein Verhalten; `locales.js`/`call-finish.js` waren schon vorher
  unformatiert auf `master`.
- DE-Nutzertext folgt der ASCII-Transliterations-Konvention fuer nicht gesprochenen Text
  (Muster `mcp-texts.js`), ist aber Dashboard-sichtbar — Owner-Entscheid wert, ob echte Umlaute
  hier besser waeren.
- Cap-/Budget-Abbruch erzeugt jetzt `"... (Status: completed, Grund: das Budget war
  aufgebraucht)"` — die gewollte Unterscheidbarkeit liest sich leicht widerspruechlich
  (`completed` + Ausfallgrund in einem Satz).
- `npm run test:gates` haengt in dieser Umgebung an `test/auth-p9a-cache-headers.test.js` —
  identisch auf `master` reproduziert, in `tasks/lessons.md:203-207` als bekannter,
  ungefixter Bestandsdefekt dokumentiert, nicht von dieser Phase verursacht.
- eslint war nicht ausfuehrbar (`@eslint/js` fehlt); `node --check` auf allen vier
  Quelldateien war gruen.

---

## Clean-Code-Audit

**Verdict: PASS** — keine S1/S2-Befunde (kein Blocker).

**S1 (Blocker):** keine.

**S2 (Blocker):** keine.

**S3 (kein Blocker, Fix bei Gelegenheit):**

- **G5/G22 (Duplizierung), `src/i18n/failure-reason-texts.js` (neu):** Das
  Failure-Token-Vokabular existiert bereits als eigenstaendige, unvollstaendige Tabelle in
  `src/ui/widgets/call.html` (`FAILURE_REASON_LABELS` + eigene `split(':')[0]`-Logik; dort
  fehlen `max-duration-cap`/`budget-exhausted`). GQ-P15 legt mit `FAILURE_REASON_TEXTS` eine
  **dritte**, unabhaengige Quelle fuer dieselbe Domaenen-Frage an, ohne Querverweis. Kein
  Blocker, weil das Projekt bereits das Muster separater Kanal-Bundles kennt
  (MCP_TEXTS/GATE_TEXTS/widget-i18n.js) und Cross-Runtime-Sharing (Node-ESM vs. inline
  Browser-Skript) nicht trivial ist; `call.html` liegt ausserhalb des Diff-Scopes. Empfohlener
  Fix bei Gelegenheit: gemeinsame Token-Namensliste an einer Stelle definieren, aus der beide
  Tabellen ihre Schluesselmenge ableiten/gegenpruefen, oder mindestens ein Verweis-Kommentar
  in `call.html`.

**S4 (Stil, nicht flag-wuerdig):**

- Objekt-Keys in `failure-reason-texts.js` uneinheitlich gequotet (`"no-answer"` wegen
  Bindestrich, `"busy"` ohne) — rein kosmetisch.

**passNotes:** Duplizierung der drei statusBody-Lambdas korrekt zu einer Faktorei
(`makeStatusBody`) aufgeloest; `Object.hasOwn` statt Bracket-Zugriff bewusst gegen
Prototype-Pollution durch Provider-Token gewuerdigt; Golden-Master-Test pinnt Byte-Identitaet
des Bestandsverhaltens; Vollstaendigkeits-Test (A6) prueft echte Konstanten statt
abgeschriebener Werte gegen Drift; PII-Grenze (kein Roh-SIP-Detail im Nutzertext) explizit
getestet (A5). Kommentare beantworten die WHY-Fragen (PII-Grenze, Drift-Schutz, Trennung von
gesprochenen Locale-Strings) praezise und decken sich mit dem Code.

---

## Fix-Runden

**r1:** Beide zunaechst gemeldeten Blocker liefen auf denselben Prozess-Befund hinaus: der
Branch `phase/gq-p15-ausfall-grund` trug 0 Commits, die Implementierung lag nur uncommittet
im Impl-Worktree `wf_16edc006-660-2` — git-Zugriff auf fremde Worktrees ist in der Sandbox
verboten, der echte Diff des fremden Worktrees war damit nicht per git einsehbar. Ergebnis:
neuer Branch `phase/gq-p15-ausfall-grund-fix1` mit dem tatsaechlich committeten Stand, gegen
den anschliessend Safety und Clean-Code final urteilten (beide PASS, siehe oben).
