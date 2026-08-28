# Phase OUTBOUND-E2 F1 — EIN Fehlervokabular ueber alle Engines, getrennt nach Schuld

**Gate:** PASS
**finalBranch:** `phase/outbound-e2-fehlervokabular-fix4`
**Anlass:** Regressionsfang des Outbound-Ausfalls vom 27.08.2026 (`tasks/befund-outbound-ausfall-2026-08-27.md`, Abschnitt 2)
**Basis:** master 46e1441, headCommit 2fdb5a62bbed60a3a4345dd4fe30b0f11b88899d (nach Fix-Runden r1-r4)

## Zusammenfassung

Bis zu dieser Etappe trugen drei verschiedene Sachverhalte dasselbe Label
`call_duration_secs_zero_not_answered`: (a) unser Konfigurationsdefekt (SIP 403,
Absendernummer war dem Telnyx-Konto nicht mehr freigegeben — der 27.08.-Ausfall),
(b) der Tippfehler eines Nutzers (SIP 404, Ziel existiert nicht) und (c) eine echte
Nichtannahme. Ausserdem trug jede Start-Ablehnung aller drei Engines (ElevenLabs,
Telnyx TeXML, Telnyx Call-Control) `failureReason = NULL`.

OUTBOUND-E2 fuehrt EIN Vokabular ein (`src/telephony/failure-reason.js`), das nach
SCHULD trennt: `not-placed` (wir/Anbieter), `unreachable` (Angerufener/Nutzer),
`result-unknown` (Ausgang unbekannt). Die Klassifikation liest ausschliesslich
validierte HTTP-/SIP-Statuscodes und ein Carrier-Kuerzel aus dem Anbieter-Freitext —
der Rohtext selbst wird nie gespeichert oder geloggt (PII-frei by construction). Die
Geldbuchung (Anker/Minuten) ist nachweislich unveraendert.

## Token-Liste mit Zuordnung und Schuld-Klasse

### Basis-Token (`FAILURE_REASON_BASE_TOKENS`, eine exportierte Quelle)

| Token | Herkunft | Schuld | Neu? |
|---|---|---|---|
| `no-answer` | `callFailureReason` | Angerufener | nein |
| `busy` | `callFailureReason` | Angerufener | nein |
| `canceled` | `callFailureReason` | Auftraggeber | nein |
| `failed` | `callFailureReason` | unbekannt | nein |
| `not-placed` | `startRejectionReason`, `providerErrorReason` | wir/Anbieter | JA |
| `unreachable` | `providerErrorReason` | Angerufener/Nutzer | JA |
| `result-unknown` | `startRejectionReason`, `providerErrorReason`, Poll | Anbieter, voruebergehend | JA |
| `max-duration-cap` | `call-lifecycle.js` | — | nein (bleibt separat) |
| `budget-exhausted` | `call-lifecycle.js` | — | nein (bleibt separat) |

### Zuordnungsregel (eine Stelle, `sipBase`/`startRejectionReason`)

| Beobachtung | Token |
|---|---|
| Start-HTTP 4xx | `not-placed:start-<code>` |
| Start-HTTP 5xx | `result-unknown:start-<code>` |
| Start ohne `providerStatus` (Netzfehler/Timeout) | `null` (benannte Luecke, s. Deviations D-4) |
| SIP 401/403/407 | `not-placed:invite-<code>[-<carrier>]` |
| SIP 5xx (< globalem Fehlerbereich) | `not-placed:invite-<code>[-<carrier>]` |
| SIP 404/480/486/603 | `unreachable:invite-<code>[-<carrier>]` |
| SIP-Code ausserhalb aller Mengen (inkl. 6xx-Grenze) | `result-unknown:invite-<code>[-<carrier>]` (fail-closed, nach Fix r2 korrigiert) |
| `metadata.error` ohne erkennbaren SIP-Status | `result-unknown:provider-<code>` bzw. `result-unknown:provider` |
| Poll-Zeitgrenze | `result-unknown:poll-timeout` |
| Dauerhafter Abruffehler | `result-unknown:poll-provider-<status>` |

**Detail-Form:** `<basis>:<quelle>-<code>[-<carrier>]`, `quelle ∈ {start, invite, provider, poll}`,
`code` = validierte 3-stellige Ganzzahl, `carrier` = Treffer von `/\bD\d{2}\b/`. Der
Rohtext (`reason`) verlaesst den Klassifizierer nie — dasselbe Niveau wie `safeCauseToken`
(`adapters/telnyx/webhook-events.js`).

### Die zwei Ankerfixturen

- 27.08. (gemessen): `code:403`, SIP 403 "Unverified origination number D51" -> **`not-placed:invite-403-D51`**
- 15.08. (Bestandsfixture): `code:404`, SIP 404 "Invalid destination number D11" -> **`unreachable:invite-404-D11`**

## Fehlerlandschaft je Engine

**Engine A — ElevenLabs (live, `ELEVENLABS_OUTBOUND_ENABLED=true`)**

| # | Fehlerart | Wo | Vorher | Nachher |
|---|---|---|---|---|
| A1 | Start-HTTP 4xx | `api-calls.js:392` catch | `failed`, NULL | `not-placed:start-<code>` |
| A2 | Start-HTTP 5xx/Timeout | derselbe catch | `failed`, NULL | `result-unknown:start-<code>`; ohne `providerStatus` weiter `null` |
| A3 | SIP 403/D51 (27.08.-Fall) | `outbound.js:1221 finishFromConversation` | `call_duration_secs_zero_not_answered`, NULL | `provider_rejected_before_answer` + `not-placed:invite-403-D51` |
| A4 | SIP 404/D11 (Tippfehler) | derselbe Zweig, vorher identisch mit A3/A5 | dasselbe Label wie A3/A5 | `provider_rejected_before_answer` + `unreachable:invite-404-D11` |
| A5 | Echte Nichtannahme (Dauer 0, kein Fehler) | derselbe Zweig | `call_duration_secs_zero_not_answered` | unveraendert, byte-identisch |
| A6 | Dauer unbrauchbar + Anbieterfehler | `outbound.js:440` | `call_duration_secs_unusable` | `provider_rejected_before_answer` (Fehlerbeleg staerker als kaputte Zahl) |
| A7 | Poll-Zeitgrenze | `finishExpiredPoll` | `failed`, NULL | `result-unknown:poll-timeout` |
| A8 | Dauerhafter Abruffehler | `finishOnPermanentError` | `poll_permanent_provider_error`, NULL | `result-unknown:poll-provider-<401\|404>` |
| A9 | Abbruch (Cap/Budget) | `call-lifecycle.js:102` | `max-duration-cap`/`budget-exhausted` | unveraendert |

**Engine B — Telnyx TeXML (Budget-Engine)**

| # | Fehlerart | Wo | Vorher | Nachher |
|---|---|---|---|---|
| B1 | Start-Ablehnung | `api-calls.js:392` (derselbe catch wie A1) | `failed`, NULL | `not-placed:start-403` — Beleg, dass die Luecke nie EL-spezifisch war |
| B2 | Gespraechsende/SIP-Cause | `routes/voice.js:542` | Bestand | unveraendert (mit sipBase-Verfeinerung ab Fix r4, s. C4-Concern) |
| B3 | Cap/Budget | `call-lifecycle.js:102` | Bestand | unveraendert |

**Engine C — Telnyx Call-Control/AI-Assistant**

| # | Fehlerart | Wo | Vorher | Nachher |
|---|---|---|---|---|
| C1 | Start-Ablehnung | `api-calls.js:392` (derselbe catch) | `failed`, NULL | `not-placed:start-<code>` |
| C2 | Hangup | `telnyx-call-control-ingest.js:100` | Bestand | unveraendert |

**Engine D — Realtime-Bridge:** nicht live, nicht angefasst (Scope-Grenze).

**Beleg "alle drei Zweige in einer Schreibstelle":** `api-calls.js:331` (EL) / `:345` (Call-Control) / `:363` (TeXML) liegen alle im selben `try {`, `catch(err)` bei `:392` umschliesst alle drei.

## Abnahmepunkte einzeln — Urteil und Kommando

| # | Kommando | Urteil | Ergebnis |
|---|---|---|---|
| S0 | `npm run test:gates` (vor erstem Edit, master 46e1441) | PASS | pass 690/fail 3 (korrigiert 129/126/3): GAP-05, GAP-15, E2E-03 |
| S0b | Geld-Assertions vorab gegen Bestandscode | PASS | Werte identisch zum Bestand (kein separater Lauf noetig, s. Deviations) |
| B1 | `node --test test/fehlergrund-vokabular.test.js` | PASS | pass 5/fail 0 |
| B2 | `node --test test/el-anbieterfehler-anker.test.js` | PASS | pass 4/fail 0 |
| B3 | `node --test test/anrufstart-ablehnung-grund.test.js` | PASS | pass 1/fail 0 |
| B4 | `node --test test/el-fixtures-echte-antworten.test.js` | PASS | fail 0 (gedrehte Erwartung + neuer Kommentar) |
| B5 | `node --test test/gq-p15-failure-reason-notification.test.js` | PASS | pass 20/fail 0, A7 als Positiv-Kontrolle |
| B6 | `LLM_PROVIDER=anthropic npm test` | PASS | final 5148/5148/0 (unabhaengig gemessen im dritten, unbeeinflussten Lauf; >= 5147 erfuellt) |
| B7 | `npm run test:gates` (nach Umsetzung) | PASS | pass 693/fail 3, dieselben drei Faelle wie S0 |
| B8 | `npm run lint` (voll, Worktree) | PASS | 0 errors, 64 warnings |
| B9 | `node scripts/check-staged-suppressions.js src/routes/api-calls.js` | PASS | Exit 0 |
| B10 | `node --check` auf jede geaenderte Datei | PASS | keine Ausgabe |
| B11 | `git diff --stat` / `git show --stat HEAD` | PASS | genau die geplanten Dateien + 2 notwendige Zusatzdateien (s. Deviations) |

## Gegenproben woertlich

### Regressionsfang (27.08.2026)
`providerErrorReason(CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.metadata.error) === "not-placed:invite-403-D51"`.
Bestandsfund SIP-404 (`CONVERSATION_FAILED_INVALID_DESTINATION`) -> `"unreachable:invite-404-D11"`,
`failureReasonBase(...)` beider Faelle **verschieden**. Bis zu dieser Etappe trugen beide
`call_duration_secs_zero_not_answered`.

### PII
Eingeschleuster Rohtext: `"unexpected status from INVITE response: sip status: 403:
Invalid destination number +12025550143 for Erika Musterfrau D51 (SIP 403)"`, durch den
echten Poll-Weg (`makeElevenLabsOutbound`, `storeOpsFacade` auf echten
`state-ops`-Mutatoren) geschickt, Konsole komplett mitgeschnitten. Store-JSON und
Log-Volltext enthalten weder `"+12025550143"` noch `"2025550143"` noch
`"Erika Musterfrau"` noch `"Invalid destination"` noch `"INVITE"`. Persistiert wurden
ausschliesslich `"not-placed:invite-403-D51"` und `"provider_rejected_before_answer"`.

### Geld-Pfad
Master-Fassung von `outbound.js` per `git show` danebengelegt, `answeredAnchorOutcome`
A/B gefahren, dazu `voiceMinutesOf` (`billing/metering.js`) auf beiden Ergebnissen. 10
Faelle, Anker UND gebuchte Minuten in ALLEN identisch — inklusive Anbieterfehler bei
Dauer 42s (Anker bleibt, 1 Minute) und 90s (Anker bleibt, 2 Minuten), laufendes
Gespraech (keepAnchor), echte Nichtannahme (0), Erfolg 149s (3). Einzige Differenz ist
das Label `answeredUnclearReason`. Invariante am Code: `answeredAt === null` =>
`voiceMinutesOf === 0`.

### Sabotage (alle selbst rot gesehen, danach vollstaendig zurueckgebaut)
1. **PII-Sabotage:** `providerErrorReason` auf `return error.reason;` reduziert (roher
   Anbieter-Text statt Token) -> `node --test test/fehlergrund-vokabular.test.js`: 3 von
   5 Faellen ROT, u.a. `AssertionError, actual: 'INVITE failed: sip status: 404:
   Invalid destination number +12025550143 D11 (SIP 404)', expected:
   'unreachable:invite-404-D11'`. Nach Wiederherstellung: 5/5 gruen, `git diff --stat`
   leer.
2. **Geld-Sabotage (PM-14-Fang):** Fehler-Frage in `answeredAnchorOutcome` an den
   allerersten Platz gezogen, vor die Dauer-brauchbar-Pruefung -> 2 von 4 Faellen ROT,
   u.a. `AssertionError "eine brauchbare Anbieter-Dauer MUSS einen Anker setzen, auch
   bei metadata.error"` (0 statt 1 gebuchte Minute). Nach Wiederherstellung: 4/4 gruen,
   `git diff --stat` identisch zum committeten Stand (74 insertions/10 deletions).
3. **`providerErrorReason` auf `null` entschaerft** -> 8 rot in 4 Dateien (u.a.
   27.08.-Regressionsfang, Geld-Regression, PII-Probe).
4. **`sipBase` liefert immer `UNREACHABLE`** (Schuld-Trennung verwaschen) -> 6 rot,
   darunter genau die Klassen-Trennung 403 vs. 404.
5. **i18n-Phrase entfernt** -> GQ-P15-A6 + A7 rot.
6. **Widget-Label entfernt** -> T-W1-call-AC7f + T-i18n-failure-labels rot.
7. **Reihenfolge in `api-calls.js` verletzt** (Grund nach `terminateAndBillCall`
   geschrieben) -> ALLES bleibt gruen (**das ist Safety-Concern C1**, s. unten — die
   Reihenfolge-Invariante ist im Produktionscode nicht durch einen Test gesichert).

Nach jeder Sabotage: Datei aus Sicherung zurueckgespielt, `node --check` + `eslint` +
Testlauf + `git status --short`/`git diff --stat` leer bestaetigt.

## Umlaut-Entscheidung (gemessene Begruendung)

Gemessenes Bestandsmuster von `src/i18n/failure-reason-texts.js` (Dateikopf, Zeilen
7-10, unveraendert): *"die deutschen Werte bleiben deshalb in der
ASCII-Transliteration des Bestands (Repo-Konvention). FR traegt Akzente, EN ist
kuratiert."* Am Bestand belegt: `"die maximale Gespraechsdauer war erreicht"` (DE,
ASCII) neben `"personne n'a décroché"` (FR, Akzente).

**Entscheidung:** Die drei neuen Phrasen folgen exakt diesem Muster — DE ASCII
(`"der Anruf konnte auf unserer Seite nicht aufgebaut werden"`, `"der Anschluss war
nicht erreichbar"`, `"der Ausgang des Anrufs ist unbekannt"`), FR mit Akzenten
(`"l'appel n'a pas pu être établi de notre côté"`, `"le numéro n'était pas
joignable"`, `"l'issue de l'appel est inconnue"`), EN kuratiert. Keines der neuen
DE-Woerter brauchte ohnehin einen Umlaut — es entsteht keine sichtbare
Transliteration. Die Datei bleibt einheitlich, der Dateikopf-Kommentar bleibt
sachlich richtig.

## Implementierung — Zusammenfassung

Kernstueck `src/telephony/failure-reason.js`: drei neue Basis-Token mit reinen,
config-/netz-/store-freien Erzeugern (`startRejectionReason`, `providerErrorReason`,
`pollProviderErrorReason`, `POLL_TIMEOUT_REASON`) und der EINEN exportierten Quelle
`FAILURE_REASON_BASE_TOKENS`. `src/i18n/failure-reason-texts.js` traegt drei neue
Phrasen je Sprache. `src/elevenlabs/outbound.js` persistiert den Anbieterfehlergrund
zwischen dem "laeuft noch"- und dem "Dauer 0"-Zweig (die geld-neutrale Stelle,
PM-14). `src/routes/api-calls.js` persistiert den Start-Ablehnungsgrund fuer alle
drei Engines ueber eine extrahierte Modul-Funktion, die den gepinnten
Zeilen-Pin in `eslint-legacy-exceptions.json` unangetastet laesst (Komplexitaet sank
sogar von 23 auf 22, im Golden-Snapshot mitgezogen).

**Dateien neu:** `test/fehlergrund-vokabular.test.js`, `test/el-anbieterfehler-anker.test.js`,
`test/anrufstart-ablehnung-grund.test.js`

**Dateien geaendert (Kern):** `src/telephony/failure-reason.js`,
`src/i18n/failure-reason-texts.js`, `src/elevenlabs/outbound.js`,
`src/routes/api-calls.js`, `eslint-legacy-exceptions.json`, `PLAN-SECURITY.md`,
`test/fixtures/elevenlabs-conversations.js`, `test/el-fixtures-echte-antworten.test.js`,
`test/gq-p15-failure-reason-notification.test.js` + sechs Attrappen-Nachzuege
(`test/el-geldpfad-s1.test.js`, `test/a8-abschluss-zusammenfassung.test.js`,
`test/el-action-items.test.js`, `test/elevenlabs-data-collection.test.js`,
`test/el-beende-versuch.test.js`, `test/check-staged-suppressions.test.js`)

**testPassCount:** 5158 (initial IMPL) / final unabhaengig gemessen 5148 (nach
Fix-Runden, Testfaelle im Diff netto +23/-3 Umbenennungen)

### Deviations (aus IMPL, unveraendert relevant)

- **D-1:** Der Plan selbst schlug vor, den gepinnten `max-lines-per-function`-Wert in
  `eslint-legacy-exceptions.json` anzuheben (136/243 -> 137/244). Die bindende
  Vorgehens-Anweisung verbietet das Anheben gepinnter Altlast-Werte. Stattdessen wurde
  `recordStartRejectionReason()` extrahiert, die den Aufruf auf eine Zeile
  zusammenzieht — Pin bleibt bei exakt 243/136, Komplexitaet sank sogar auf 22
  (Golden-Snapshot in `test/check-staged-suppressions.test.js` entsprechend
  nachgezogen).
- Zwei Bestandstestdateien brauchten ungeplante Attrappen-Nachzuege
  (`test/el-beende-versuch.test.js`, `test/check-staged-suppressions.test.js`) —
  reine Mechanik, keine inhaltliche Entscheidung.
- Ein Testlauf-Zwischenstand mit 4 roten Faellen wurde als Selbst-Kollision
  (gleichzeitige Sabotage-Gegenprobe an derselben importierten Datei) identifiziert
  und durch isolierten Wiederholungslauf falsifiziert.
- **D-4 (benannte Luecke, bewusst nicht E2-Scope):** Start-Fehlschlag ohne
  `providerStatus` (Netzfehler/Timeout) bleibt `failureReason = null`. Kandidat fuer
  E3a.
- **D-5 (benannte Luecke, bewusst nicht E2-Scope):** Live-Widget zeigt ein
  unbekanntes neues Basis-Token roh an (Diagnosewert, kein Bruch, PII-frei).
  Nutzer-Text-Aufbereitung ist E3a-Scope. (Nach Fix-Runde r4 teilweise vorgezogen:
  Widget-Labels fuer die drei neuen Basis-Token wurden ergaenzt, s. Fix-Runden unten.)

## Safety-Urteil

**verdict:** FREIGABE (approved: true)

Alle Kernpunkte selbst gemessen statt uebernommen: `alleEnginesAbgedeckt`,
`bestandsverhaltenIntakt`, `einVokabular`, `fullLintZeroErrors`, `gatesNotWorse`,
`geldPfadUnveraendert`, `noProviderWrites`, `noSecretsLeaked`, `piiDicht`,
`regressionsfangEcht`, `routeAuthIntact`, `safetyGatesIntact`,
`schuldTrennungWirksam`, `scopeRespected`, `testCountNotShrunk`,
`testsPassIndependently` — alle `true`, keine `blockers`.

Unabhaengiger Lauf (frischer Worktree, `review-outbound-e2-r4` aus
`phase/outbound-e2-fehlervokabular-fix4`, Basis 67b95b0 auf master 46e1441):
`LLM_PROVIDER=anthropic npm test` final 5148/5148/0; `npm run lint` 0 errors/64
warnings; `npm run test:gates` auf Etappe wie auf master identisch 129/126/fail 3
(GAP-05, GAP-15, E2E-03). Vier eigene Sabotagen selbst rot gesehen und
zurueckgebaut, Baum am Ende sauber. Kein `bridge.js`, kein `outbound-gates.js`, kein
`route-policy.js`, kein `config.js`, kein `boot-guard`, kein Signatur-Code, kein
`state-ops.js`, kein `callee-is-owner`/Offenlegung, kein E1-Code im Diff. Kein neuer
Call-Status, keine neue Env-Variable, kein `eslint-disable`, kein uebersprungener
Check, kein Provider-Schreibzugriff, kein echter Anruf/SMS.

### Concerns (keine Blocker, dokumentiert)

- **C1 (wichtigster Befund, selbst gefahren):** Die Reihenfolge-Invariante
  "`recordFailureReason` VOR `terminateAndBillCall`" ist in `src/routes/api-calls.js`
  **nicht** durch einen Test gesichert. Sabotage-Gegenprobe (Reihenfolge vertauscht)
  blieb komplett gruen. Auswirkung bei kuenftiger Regression: Notification faellt auf
  `"<Ziel> (Status: failed)"` zurueck, `call.failureReason` wird trotzdem korrekt
  geschrieben (MCP/Widget bleiben korrekt). Riegel gehoert an die Naht in E3a.
- **C2:** `startRejectionReason(undefined/null) -> null` — Timeout/Netzfehler beim
  Anrufstart bekommt kein Token, obwohl die Plan-Zuordnungstabelle das unter
  `result-unknown` fuehrt. Im Code-Kommentar als Bestandsverhalten referenziert, aber
  Plan-Abschnitt 8 enthaelt dazu keinen expliziten Eintrag — als D-4 nachtraeglich in
  diesem Report benannt.
- **C3 (Zukunftsrisiko E3b):** Die Schuld-Klassifikation haengt am Teilstring
  `"sip status:"` im Anbieter-Freitext. Formuliert ElevenLabs den Text um, faellt der
  27.08.-Fall still auf `result-unknown:provider-403` — fail-closed fuer die
  Schuldzuweisung, aber `result-unknown` zaehlt nicht in den geplanten
  Ausfall-Alarm. Drift-Pruefung nach E4/E3b empfohlen.
- **C4:** `callFailureReason` (TeXML-/Call-Control-Weg) klassifiziert jetzt auch
  numerische `sipHangupCause` ueber dasselbe `sipBase` — eine bewusste
  Verhaltensaenderung ausserhalb der im Plan explizit genannten vier Schreibstellen,
  durch `test/call-failure-reason.test.js` + `voice-status-lifecycle.test.js`
  gepinnt.
- **C5:** `FAILURE_REASON_BASE_TOKENS` ist handgepflegt, keine aus den Erzeugern
  abgeleitete Menge — eine vierte Basisklasse braucht manuellen Eintrag.
- **C6:** Ist `metadata.error` truthy aber kein Objekt, setzt
  `answeredAnchorOutcome` `provider_rejected_before_answer`, waehrend
  `providerErrorReason` `null` liefert — Anker-Label und `failureReason` koennen
  auseinanderlaufen (Geld unveraendert, aber zwei Antworten auf eine Frage).
- **C7 (kosmetisch):** typografische Anfuehrungszeichen in einem Testkommentar
  (ASCII-Konvention verletzt).

## Clean-Code-Audit

**verdict:** PASS (blocker: false)

S1/S2 (Blocker-Kategorien): leer, keine Funde.

### S3 (nicht blockierend, empfohlen fuer Folge-Etappen)

- **E2-A** (`src/routes/api-calls.js:67-70`): Command-Query-Vermischung in
  `recordStartRejectionReason` — schreibt UND liefert `providerStatus` zurueck,
  Kommentar begruendet das explizit metrik-getrieben (Lint-Pin-Erhalt), nicht
  lesbarkeitsgetrieben.
- **E2-B** (`test/anrufstart-ablehnung-grund.test.js:206-256`): Der
  "ordnungssensitive Regressionsfang" baut die Reihenfolge im Test selbst nach statt
  den Produktionspfad zu fahren — deckt sich mit Safety-Concern C1. Ausgefuehrte
  Gegenprobe (Reviewer, 3 Laeufe) bestaetigt: Reihenfolge-Umstellung im echten Code
  bleibt fuer diesen Test unsichtbar.
- **E2-C** (`src/telephony/failure-reason.js:32` vs. `127-133/184-189`): SIP
  486/480/603 werden `unreachable` statt der bereits existierenden
  selbstsprechenden Token `busy`/`no-answer` — zwei ueberlappende Token-Familien
  koexistieren unbegruendet.
- **E2-D** (`src/elevenlabs/outbound.js:475-476, 1271-1278`): `providerErrorReasonFor`
  haengt nur am Buchungsanker, nicht am Endstatus — eine als `completed`
  gespeicherte Konversation mit `metadata.error` und unbrauchbarer Dauer koennte ein
  widerspruechliches `not-placed`/`unreachable`-Label tragen; kein Test deckt diese
  Kombination ab.

### S4 (kosmetisch)
Nicht-ASCII-Anfuehrungszeichen in einem Testkommentar, ein deutscher
Variablenname (`zahl`) in sonst durchgaengig englischer Datei, ein Tippfehler
("roet" statt "rot"), ein doppelter Import in `test/helpers.js`, ein
nicht nachgezogener Zeilenumbruch in einem Kommentar.

### Unabhaengig verifiziert (Clean-Code-Review, eigener Worktree auf 67b95b0)
Volles Lint 0 errors; `eslint-legacy-exceptions.json` Pin korrekt gesenkt (23->22);
voller Regressionslauf 5148/5148/0; gezielte Laeufe der 13 betroffenen Testdateien
175 Tests gruen; eigene Gegenprobe zu E2-B bestaetigt den Befund (Reihenfolge
vertauscht, Test bleibt in 3/3 Laeufen gruen). Single Source of Truth bestaetigt
(genau eine SIP-Zuordnung `sipBase`, genau eine `sip status:`-Regex, genau eine
Carrier-Regex im gesamten `src/`). Reinheit, Magic-Numbers, Fail-closed, PII und
Geld-Invariante alle PASS.

## Fix-Runden

- **r1:** Behebt E2-S2-1 (G5 Duplizierung) — `storeFacade`/`withFetch`/`waitUntil`
  waren byte-identische Kopien zwischen `el-anbieterfehler-anker.test.js` und
  `el-geldpfad-s1.test.js`. Konsolidiert als `storeOpsFacade`/`withFetch`/`waitUntil`
  in `test/helpers.js`.
- **r2:** Behebt E2-S1-1 (fail-closed-Bruch bei 6xx) — `sipBase` hatte einen
  unbegrenzten Auffangast `sip >= SIP_SERVER_ERROR_MIN`; ersetzt durch
  `sip >= SIP_SERVER_ERROR_MIN && sip < SIP_GLOBAL_FAILURE_MIN` (neue benannte
  Grenzkonstante), damit SIP 6xx korrekt auf `result-unknown` statt `not-placed`
  faellt.
- **r3:** Behebt beide Blocker aus Runde 2 vollstaendig (Basis fix2, Commit
  4245940). S1-1: zwei neue Regressionstests pinnen, dass `finishExpiredPoll` bzw.
  `finishOnPermanentError` tatsaechlich die korrekten Poll-Token schreiben.
- **r4 (final):** Behebt alle drei gemeldeten Review-Blocker der Runde 4: (1)
  Widget-Fehlervokabular ergaenzt — `call.html#FAILURE_REASON_LABELS` und
  `widget-i18n.js#WIDGET_DICT` (de/fr) um die drei neuen Basis-Token erweitert,
  behebt den von Reviewer belegten Befund, dass unbekannte Token roh im Live-Widget
  erscheinen (teilweise Vorziehen von D-5). Ergebnis: `finalBranch =
  phase/outbound-e2-fehlervokabular-fix4`, Gate PASS.
