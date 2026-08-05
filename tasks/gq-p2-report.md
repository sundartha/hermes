# Phase GQ-P2 — Consult-Rückkanal (Detailbericht)

- **Gate:** PASS
- **finalBranch:** `phase/gq-p2-consult-rueckkanal`
- **headCommit:** `8903a47d7ea2c89d811133818fba72c6cd1d9c6e`
- **Basis:** `master` = `6061b23` (Plan), merge-base beim Review `842a9cc` (ein Doku-Commit hinter `master`)

## 1. Plan (gekürzt)

**B-2-Vorabmessung (Pflicht vor jeder Konstanten-Änderung):** Die Marge (`CONSULT_POLL_ABORT_MS = CONSULT_POLL_HOLD_MS + CONSULT_POLL_ABORT_MARGIN_MS` = 22000+3000) reicht rechnerisch; der heutige Log-Boolean `consultPollFresh` kann "nie gepollt" nicht von "knapp zu alt" trennen. Entscheidung: **keine Konstante ändern**, stattdessen eine Zahl statt eines Booleans einführen (`consultPollAgeMs`, `-1` = nie gepollt) — kleinster Eingriff, der den nächsten Testanruf entscheidbar macht.

**W1 — zwei getrennte Fristen statt einer geteilten**, beide in `src/config.js` (numEnv, geklemmt, nicht fatal):
- `CONSULT_WAIT_MS` (Default 4000, Max 60000) — wie lange der laufende Turn auf die Antwort wartet, bevor überbrückt wird (LLM-freier Halte-Satz); reserviert zugleich Platz in der laufenden Abrechnungsminute.
- `CONSULT_OPEN_MS` (Default 47000, Max 300000) — wie lange die Rückfrage offen bleibt und eine Antwort noch annimmt; hergeleitet aus zwei vollen Poll-Zyklen + Abbruchmarge, nicht geraten.

**W2 — Abbruch an der Wanduhr statt am Turn-Zähler:** `advanceInCallConsult` (state-ops.js) prüfte bisher beim zweiten Aufruf bedingungslos `timed_out` — bei Telefon-Turns praktisch sofort. Neu: `consultAgeMs`/`consultAlive` als **eine** Quelle für Turn-Schritt und Antwort-Kante; neuer Zwischenzustand `CONSULT_WAIT.PENDING` (Consult bleibt `OPEN`, Turn läuft normal, einmaliger ehrlicher Hinweis statt Stille). Neuer Ablehnungsgrund `CONSULT_ANSWER.DEADLINE_PASSED`, getrennt von `ALREADY_ANSWERED`. Fail-closed: fehlende/unlesbare Frist → Ablehnung. Consult #0 (Klingelzeit, AL-P13) bleibt von der Wanduhr-Frist ausgenommen (byte-identisches Bestandsverhalten).

**Weitere Edits:** `defaults.js` (neue Enum-Werte), `consult/in-call.js` (Fristen aus config, neue Kante `acceptConsultAnswer`, `consultPollAgeMs`/`CONSULT_POLL_NEVER=-1`), `routes/api-calls.js` (Antwortroute), i18n-Prompts de/en/fr (`consultPending` neu, `consultTimeout` um explizites Falschaussage-Verbot ergänzt — "sage NIE, dass dir eine Rückfrage nicht möglich sei"), `claude.js` (`consultTurnMarker`-Helfer, eine Zuordnung statt zweier if-Ketten), `telnyx-llm-shim.js` (`consultPollAgeMs` zusätzlich im `turn_ok`-Log), plus `.env.example`/`render.yaml`/`test/helpers.js` (BASE_ENV-Pinning, Lehre *test-base-env-drift*).

**Tests (Plan):** neue Datei `test/gq-p2-consult-deadline.test.js`, Präfix `GQ-P2-<n>:` (bewusst außerhalb `config.i18nCatalogPattern`, Lehre *catalog-id-prefix-misroutes-tests*), 6 Fälle je mit Gegenbeispiel (Annahme/Ablehnung nach Fristablauf, Consult-#0-Ausnahme, HOLD→PENDING→NONE ohne Tod, Denylist gegen Falschaussagen inkl. Gegenprobe, Herleitung `OPEN_MS ≥ 2×POLL_HOLD_MS`, `consultPollAgeMs` trennt "nie" von "alt"). Bestandsanpassungen: `al-p14-in-call-consult.test.js` (AL-P14-18 umgedreht: zweiter Turn lebt jetzt statt `timed_out`; AL-P14-19/-20 auf neue Konstanten/Kante); `al-p13-*` erwartungsgemäß unverändert grün zu verifizieren.

**Safety/Blast-Radius (Plan):** keine Safety-Gates, keine Offenlegung, kein Auth, kein DDL berührt; kein Gespräch wird verlängert (Zustandsschritt ohne Timer, Halte-Satz weiterhin höchstens einmal); Default `IN_CALL_CONSULT_ENABLED=false` bleibt verhaltensneutral; obere Klemme gegen "Operator macht daraus ein Postfach".

## 2. Impl-Zusammenfassung

- `headCommit` 8903a47, `nodeCheckPass=true`, `testsPass=true`, `testPassCount=3916`, `testFailCount=0`, `committed=true`.
- Umsetzung exakt gemäß Plan: `CONSULT_WAIT_MS`/`CONSULT_OPEN_MS` in `config.js` (numEnv, `CONSULT_WAIT_MAX_MS=60000`, `CONSULT_OPEN_MAX_MS=300000`, in `NAMESPACES.tenancy`). `state-ops.js`: `consultAgeMs`/`consultAlive` als eine Quelle für `answerConsult` (fail-closed, nur In-Call-Consults) und `advanceInCallConsult` (Wanduhr statt Turn-Zähler, `pendingNoted`-Latch, kein DDL/Backfill nötig). `defaults.js`: `CONSULT_WAIT.PENDING`, `CONSULT_ANSWER.DEADLINE_PASSED`. `consult/in-call.js`: Fristen aus config, neue Kante `acceptConsultAnswer()`, `consultPollAgeMs()`+`CONSULT_POLL_NEVER=-1`. `claude.js`: `consultTurnMarker()`. `telnyx-llm-shim.js`: `consultPollAgeMs` zusätzlich im `turn_ok`-Log, gleiche Momentaufnahme-Uhrzeit für beide Felder. `.env.example`/`render.yaml`/`test/helpers.js` dokumentiert/gepinnt.
- Neue Testdatei `test/gq-p2-consult-deadline.test.js` mit 6 Tests (GQ-P2-1..6), alle grün. Voller Regressionslauf zweimal: 3916/3916 grün (erster Lauf hatte 3 Treffer, 2 durch nötige Namespace-Buchhaltung erklärt/gefixt, 1 — W5-4 — unter Volllast isoliert grün nachgefahren, bekanntes Lastartefakt).
- Smoke: `node --check` auf allen 14 geänderten Dateien sauber. Echter Server-Smoke scheiterte am Boot-Guard "keine aktive Nummer im Store" (fehlender Tenant-Seed im isolierten Worktree, kein Bezug zur Phase) — Ersatzbeleg über produktionsidentisches Log-Format während der Testläufe (`[consult] gestellt call=... warte_ms=4000 offen_ms=47000`, `consultPollAgeMs` im `turn_ok`-Log).

### Deviations

1. **Plan 2.5 (Route auf `inCall.acceptConsultAnswer()` umstellen) wurde nicht wie vorgesehen umgesetzt.** `acceptConsultAnswer` importiert den statischen Store-Singleton (`src/store.js`), während die Route Factory-basiert ist und in Tests mit einem Store-Double injiziert wird (P4 DIP). Ein direkter Aufruf hätte am Test-Double vorbeigegriffen und 3 Bestandstests (AL-P13-13/-14/-46) rot gemacht. **Fix:** Route ruft weiterhin den injizierten `store.answerConsult()` mit `nowMs`/`openMs` auf, importiert aus `consult/in-call.js` nur die Konstante `CONSULT_OPEN_MS` — DIP bleibt gewahrt, Frist bleibt an einer Quelle. `acceptConsultAnswer()` bleibt exportiert und wird von claude.js-Kontext-Tests direkt gegen den echten Store genutzt (kein toter Code aus Sicht der Impl-Phase — siehe Safety-Concern unten für die abweichende Einschätzung).
2. **`test/config-namespaces.test.js`** musste als Folge der zwei neuen `config.tenancy`-Keys aktualisiert werden (reine Zähl-Buchhaltung: tenancy 8→10 Keys, Gesamt 140→142, geprüfte primitive Blätter 131→133) — im Plan (2.1c) implizit erwartet, aber nicht explizit als zu ändernde Testdatei genannt.

## 3. Safety-Urteil

**approved=true**, alle Kernflags grün: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`. **blockers=[]**.

Unabhängige Läufe (frischer Worktree, `review-gq-p2` von `phase/gq-p2-consult-rueckkanal`): `npm test` 3916/3916 grün (korrigiert um 20 Datei-Wrapper: 3896/3896); eigener PG-Gegentest (pglite, 6 Fälle REV-PG-1..6, danach entfernt) bestätigt Annahme/Ablehnung nach Frist, fail-closed bei fehlendem `openMs`, Consult-#0-Ausnahme, HOLD→PENDING→NONE inkl. Latch-Persistenz über `save()`/Reopen, genau ein `TIMED_OUT`, `WAIT_MS < OPEN_MS`; ungefilterter Zielsatz von 8 betroffenen Dateien 79/79 grün; `node --check` grün auf allen 6 geänderten src-Dateien.

Geprüft und bestätigt: kein Gate im Diff (gesamter Diff gegen disclosure/numberGateError/`OUTBOUND_FROZEN`/`budgetExceeded`/`safeEqual`/`verifySignature`/`webAuthMw`/`adminMw`/`internalOnly`/Max-Dauer/Denylist gegrept — null Treffer außer der neuen Falschaussage-Denylist im Test selbst). `consultFitsBillingMinute` liest jetzt die konfigurierbare Wartefrist — kein geschütztes Gate, Richtung sicher (größerer Wert = Rückfrage seltener angeboten). Kein `sleep`: HOLD bleibt höchstens ein Turn (Latch), PENDING läuft als normaler Modell-Turn — 47s offener Consult verlängert kein Gespräch, unterdrückt kein `end_call`, `expireOpenConsults` schließt am Call-Ende. `disclosureSentence` unberührt (Hunks liegen weit entfernt). Auth an der Consult-Route unverändert (`internalOnly` + `requireTenant` + `callVisibleTo` + `consultAllowedFor`). Einzige geänderte Log-Zeile trägt nur ID + zwei Zahlen, kein Audio/Transkript in neuen Ausgaben. Flag-off byte-identisch verifiziert (`advanceConsultWait` kurzschließt vor jedem Store-Zugriff, wenn `IN_CALL_CONSULT_ENABLED` nicht `true` ist).

**Concerns (kein Blocker, 5 Punkte):**
1. **Toter Produktionscode:** `acceptConsultAnswer` (`src/consult/in-call.js:148`) hat NULL Produktions-Aufrufer — nur Tests nutzen ihn; die Route ruft bewusst `store.answerConsult` direkt auf. Folge: GQ-P2-1/2/3 pinnen den Helfer, nicht den echten Kanal — würde `nowMs`/`openMs` aus der Route entfernt, blieben diese Tests grün. Route selbst gelesen und als korrekt verifiziert (übergibt beides), Routen-Tests grün — Verhalten heute richtig, Regressionsschutz an der echten Naht aber dünn.
2. Prettier: `src/consult/in-call.js:99` (Log-Zeile) 105 Zeichen bei printWidth 100 — kosmetisch, Datei war schon vorher unformatiert (7. von zuvor 6).
3. Branch-Basis ein Commit hinter `master` (merge-base `842a9cc` vs. `master` `a0a2b35`); Zusatz-Commit ist reine Doku (`tasks/gq-chain-state.md`, `gq-p1-spec.md`, `gq-p2-spec.md`) — Artefakt der Basis, kein Scope-Verstoß, aber beim Merge nicht verlieren.
4. **Bestehender Fail-open-Randfall (nicht neu eingeführt):** In-Call-Consult mit unlesbarem `askedAt` fällt schon in `isInCallConsult` auf `false` und umgeht damit das neue Uhr-Gate vollständig — empirisch bestätigt in REV-PG-5. Kein realistischer Auslöser (`askedAt` ist server-generiertes ISO), aber die Fail-closed-Zusage der Spec deckt diesen Pfad nicht.
5. B-2 ist instrumentiert, nicht behoben (spec-konform: Konstante nicht auf Verdacht ändern) — Abnahmepunkt "`get_consult` erscheint in `offeredToolNames`" bleibt bis zum nächsten Testanruf offen. `npm run test:gates` konnte wegen Tool-Timeout nicht zu Ende gefahren werden; Ersatz: 8 betroffene Dateien ungefiltert gefahren, 79/79 grün.

## 4. Clean-Code-Audit (S1–S4)

**verdict:** PASS (kein Blocker). **blocker=false.**

- **S1:** keine Funde.
- **S2:** keine Funde.
- **S3 (2 leichte Funde, kein Blocker):**
  1. `src/store/state-ops.js:304-309` (Kommentar über `advanceInCallConsult`): beschreibt PENDING als "die Wartefrist ist um" — tatsächlich prüft der Code nur `!consult.held` bereits false (HOLD schon einmal ausgelöst), unabhängig davon ob die Wartefrist wirklich abgelaufen ist. Bei zwei schnell aufeinanderfolgenden Turns springt der Zustand direkt von HOLD auf PENDING — genau das beweist GQ-P2-3/AL-P14-18 absichtlich. Verhalten gewollt und getestet, Kommentar zu präzise formuliert. **Fix-Vorschlag:** "der Halte-Satz wurde schon einmal gesprochen (held) ODER die Wartefrist ist um".
  2. `src/research/in-call.js:22` (außerhalb Phasen-Scope, aber durch die Umbenennung veraltet): referenziert `CONSULT_TIMEOUT_MS`, das seit diesem Diff nicht mehr existiert (aufgeteilt in `CONSULT_WAIT_MS`/`CONSULT_OPEN_MS`). **Fix-Vorschlag:** Referenz auf `CONSULT_WAIT_MS` aktualisieren (kleiner Folge-Patch, kein Blocker für diese Phase).
- **S4 (1 Beobachtung, kein Verstoß):** `src/routes/api-calls.js:350-355` vs. `src/consult/in-call.js:181-188` — zwei fast identische Aufrufe von `store.answerConsult({eventId, facts, nowMs, openMs})`. Bewusst begründet (Route Factory-basiert mit injiziertem Store-Double, direkter `acceptConsultAnswer`-Aufruf würde am Test-Double vorbeigreifen), im Kommentar dokumentiert, reine Wiring-Duplikation (3 Zeilen). Beobachtung: bei einem dritten Aufrufer wäre ein `makeAcceptConsultAnswer(store)`-Factory-Wrapper die nächste Stufe.

**passNotes:** Fristen sauber in `config.js` zentralisiert (Env + `.env.example` + `render.yaml` + Namespace-Test synchron), oben geklemmt statt fatal. Fail-closed konsequent (fehlende/NaN-Frist → `DEADLINE_PASSED`, Consult #0 bewusst/getestet ausgenommen). Eine Quelle (`consultAlive`) in beiden Aufrufern verhindert die Inkonsistenz, die zwei Prädikate erzeugt hätten (G5 sauber vermieden). i18n-Texte de/en/fr konsistent inkl. explizitem Falschaussage-Verbot, mit eigenem Denylist-Test (GQ-P2-4) verifiziert. Testnamen bewusst ohne Katalog-ID-Präfix. Aufräumen der Phasen-Spec-Dateien im Diff enthalten. Alle relevanten Tests lokal via git-archive-Snapshot nachgefahren — 100% grün.

**topTodos:**
1. Kommentar in `state-ops.js` (`advanceInCallConsult`, PENDING-Zweig) präzisieren.
2. Bei Gelegenheit den veralteten `CONSULT_TIMEOUT_MS`-Verweis in `src/research/in-call.js:22` auf `CONSULT_WAIT_MS` umstellen (kein Blocker).

## 5. Fix-Runden

Keine — die Quelle enthält keinen `=== FIXES ===`-Inhalt. Gate wurde direkt PASS erreicht (kein Blocker in Safety oder Clean-Code, nur S3/S4-Beobachtungen und dokumentierte Concerns).
