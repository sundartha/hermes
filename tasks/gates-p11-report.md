# Phase GATES-P11 — Telefonie-Kleinvertraege

**Spec:** Abschnitt "P11" in `tasks/gates-fix-chain.md`
**Abnahme:** GAP-24 und GAP-26 gruen via `npm run test:gates`, `npm test` mit fail=0 und keinem neu roten Bestandstest, Diff beruehrt `src/`. Zulaessige Testaenderung: NUR der Byte-Identitaets-Test laut `PLAN-GATES.md` Abschnitt 7.
**Gate:** PASS
**finalBranch:** `phase/gates-p11-telefonie-vertraege`
**headCommit:** `7a82b33cbfd9a93df10b15df40e1c61f71d9d20e`
**Basis:** `master` = `b2c9746`

---

## 1. Plan (gekuerzt)

Beide Gate-Premissen am HEAD `b2c9746` empirisch als rot verifiziert, nicht geglaubt:

- `node --test test/telnyx-p8-inbound.test.js` → 9 pass / 1 fail. GAP-24 scheitert mit `undefined !== 'en'` auf `voiceControl.order[1].params.language`. Kein produktionsfremdes Setup: derselbe DI-Aufruf, den `src/routes/voice.js#inboundAssistantHandoffXml` live macht.
- `node --test test/max-duration-live-cap.test.js` → 1 pass / 1 fail. GAP-26 scheitert mit `actual: null` auf `call.failureReason`. Das Feld existiert bereits am Record (`state-ops.js#createCall`), wird auf dem Cap-Pfad nur nie gesetzt.

Zwei unabhaengige Ein-Zeilen-Wurzeln, kein gemeinsamer Code. Kein neuer Endpunkt, kein Gate beruehrt, keine neue Dependency, keine neue Sprachquelle.

**Pre-Mortem (Risiken vorab benannt, ein Jahr spaeter gedacht):**

| Szenario | Entschaerfung |
| --- | --- |
| Inbound-Anrufe fallen aus (Telnyx 4xx auf `transcription:{}`) | Sprach-Hint nur bei truthy `call.language` gesetzt (konditionaler Spread statt `language: undefined`); Ohne-Sprache-Zweig bleibt vom Bestandstest `telnyx-p8-inbound.test.js:62` gepinnt |
| Max-Dauer-Cap greift nicht mehr | Aenderung liegt ausschliesslich im bereits als Erstes laufenden `persistEnd`-Thunk; Quelltext-Waechter T6 (`telnyx-p6-cap-callcontrol`) und `call-termination-order` bleiben gruen |
| Ein Cap-Grund ueberschreibt den echten Provider-Grund | `recordFailureReason` ist set-once + truthy-gated (Bestand, unveraendert) |
| Kunde sieht internes Token | Token ist PII-frei, stabil, kleinbuchstabig, gleiche Klasse wie `no-answer`/`failed:487`; Widget rendert unbekannte Tokens roh (gepinnt) |

**Umsetzungsteile:**

1. `test/cap-failure-reason.test.js` (neu, Regressionslauf ohne Katalog-Praefix): prueft Reihenfolge (Grund vor Provider-Hangup vor Settlement) und den Zombie-Pfad (`status="failed"`), den der Live-Gate-Test nicht erreicht.
2. `src/telnyx-inbound.js` — GAP-24: `startInboundAiAssistant` reicht `call.language` konditional (`languageHint = call.language ? {language: call.language} : {}`) an `vc.startAssistant` durch; dieselbe Sprachquelle wie der bestehende Outbound-Ingest-Pfad, keine neue Quelle.
3. `src/telephony/call-lifecycle.js` — GAP-26: neue Konstante `CAP_FAILURE_REASON = "max-duration-cap"`; `persistEnd` im Cap-Pfad ruft zusaetzlich `store.recordFailureReason(callId, CAP_FAILURE_REASON)` auf, VOR Hangup und Settlement. Quelltext-Waechter-Budget (T6, 1200-Zeichen-Fenster) vorab per Offset-Messung geprueft.
4. `src/telephony/adapters/telnyx/voice.js` — reiner Kommentar-Fix (0 Code-Token): zwei durch GAP-24 sachlich falsch gewordene Kommentare korrigiert (Aussage "Inbound ruft ohne language" stimmte nicht mehr).
5. Testaenderung: `test/telnyx-p8-inbound.test.js`, der Byte-Identitaets-Test, wird auf die Gegenrichtung gedreht (Kopplung war im GAP-24-Kommentar bereits angekuendigt) — die einzige laut Spec zulaessige Testaenderung.

**Erwartetes Ergebnis:** `npm run test:gates` GAP-24 + GAP-26 gruen, Restzahl roter Gates unveraendert; `npm test` fail=0, pass = Basis+1; `git diff --name-only` nur `src/telnyx-inbound.js`, `src/telephony/call-lifecycle.js`, `src/telephony/adapters/telnyx/voice.js` (+ die eine Testdatei).

---

## 2. Impl-Zusammenfassung + Deviations

**Ergebnis:** GATES-P11 exakt gemaess Plan umgesetzt. GAP-24 (Inbound-STT-Sprach-Hint) und GAP-26 (Max-Dauer-Cap-Grund) sind gruen. `npm test` (Regressionslauf): 3340/0. `npm run test:gates`: 7 rote Tests, keiner GAP-24/GAP-26 (verbleibend vorbestehend: FMT-15 x2, WEB-08, GAP-05, GAP-15 x2, GAP-37, ausserhalb dieser Phase).

Diff beruehrt exakt:
- `src/telnyx-inbound.js`
- `src/telephony/call-lifecycle.js`
- `src/telephony/adapters/telnyx/voice.js` (Kommentar-only)
- `test/telnyx-p8-inbound.test.js` (die eine zulaessige Testaenderung)
- `test/cap-failure-reason.test.js` (neu, Regressionsschutz)

Quelltext-Waechter-Budget (T6) gepruft: `hangUp@909`, `bill@976`, innerhalb des 1200-Zeichen-Limits.

**Deviations:**
- Manueller curl-Smoke-Test der `/voice/incoming`-Route ausgelassen (best-effort, kein Blocker): lokaler Boot verlangt den vollen Telnyx-Assistant-Env-Satz; dieselbe Konfiguration wird bereits end-to-end durch die gruenen Spawn-Tests in `test/telnyx-p8-inbound.test.js` abgedeckt.
- Erster `npm test`-Lauf zeigte 1 roten Test (nicht per grep identifizierbar im selben Lauf); direkt anschliessender zweiter Lauf war 3340/0 gruen — passt zum dokumentierten Suite-Flake (~12% Voll-Last-Race, Memory `suite-flake-p5-gate-proof-spawn-race`). Kein Bezug zu den geaenderten Dateien.

**cleanCodeSelfCheck (Impl-Agent):** G5 (Konstante exportiert statt String-Duplikat), G25 (kein Magic-Value, bestehender Portname wiederverwendet), C2 (beide falsch gewordenen Kommentare korrigiert), C5 (kein auskommentierter Code), F1 (keine Signaturen >3 Argumente), P15 (kein Lazy-Init), G30/G34 (Abstraktionsebene gewahrt). Keine neuen Dependencies, keine Gates/Auth/Disclosure beruehrt.

`smokePass: false` — manueller Server-Boot mit Dummy-Env scheiterte am Boot-Guard (fehlende Telnyx-Assistant-Pflichtfelder), kein Code-Defekt; end-to-end durch gruene Spawn-Tests abgedeckt.

---

## 3. Safety-Urteil (final)

**approved: true** — alle Einzelfelder true (testsPassIndependently, safetyGatesIntact, disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected, behaviorAsIntended).

**Unabhaengiger Nachvollzug:** frischer Worktree auf `review-gates-p11` (= `phase/gates-p11-telefonie-vertraege`, `7a82b33`; merge-base = aktueller master `b2c9746`, kein stale base).

- `npm test`: roh 3361/3361 pass; korrigiert (20 leere Datei-Wrapper abgezogen) 3341 pass / 0 fail / 92,5 s.
- `npm run test:gates` (Branch): 132 Tests, 125 pass, 7 fail.
- `npm run test:gates` (Baseline `b2c9746`, detached, gleicher Worktree): 132 Tests, 123 pass, 9 fail.
- Delta exakt +2 gruen, kein neuer roter Gate: GAP-24 und GAP-26 gekippt, die 7 verbleibenden roten Gates identisch zur Baseline.
- Rot-vor-Fix an `cap-failure-reason.test.js` bewiesen: nach temporaerem Entfernen der `recordFailureReason`-Zeile faellt der Test mit `actual undefined / expected 'max-duration-cap'`; Zeile danach wieder eingesetzt, Worktree git-clean.
- `node --check` gruen fuer alle drei geaenderten `src`-Dateien. eslint im Worktree nicht lauffaehig (Umgebungsproblem, kein Codebefund). prettier meldet die betroffene Datei bereits auf der Baseline als unformatiert — kein Befund, da im Repo nicht erzwungen.

**Absolute Regeln:** SAFETY-GATES unberuehrt (kein Budget-/Denylist-/Land-/Stundenlimit-Code, keine Signaturpruefung im Diff, kein neuer Endpunkt/Call-/SMS-Ausloeser). OFFENLEGUNG unberuehrt (`claude.js`/`bridge.js` nicht im Diff). AUTH FAIL-CLOSED unberuehrt (kein Auth-/Middleware-/Signatur-Code, keine neue Route). SECRETS: kein neues Log/Env, einziges neues nach aussen sichtbares Datum ist der statische PII-freie Token `max-duration-cap` ueber das bereits bestehende Whitelist-Feld `failure_reason`. SCOPE: 3 Quell- + 2 Testdateien, keine neue Dependency; die eine Testaenderung ist genau die spec-zugelassene.

**Concerns (nicht blockierend, im Bericht festgehalten):**
1. `persistEnd` enthaelt jetzt zwei Store-Aufrufe statt einem — marginales Restrisiko, dass ein Fehler im zweiten Aufruf den Hangup blockiert (vorbestehende Struktur, eine Zeile mehr in der Fehlerflaeche).
2. Testbegruendung ("die Buchungs-/Summary-Kette liest ihn bereits mit") ist staerker formuliert als der Code hergibt — grep zeigt nur `mcp-tools.js#get_call_status` und `call.html` als echte Leser.
3. Zweite Token-Quelle: `CAP_FAILURE_REASON` lebt in `call-lifecycle.js`, die uebrige Vokabel in `failure-reason.js` — im Kommentar begruendet, vertretbar; Doku-Drift in `call.html:264-266` (nennt nur `failure-reason.js`).
4. Neues, unlokalisiertes Token `max-duration-cap` in kundensichtbarer Oberflaeche — Widget rendert es roh (dokumentierter Fallback), Wirkungsbereich klein (nur Boot-Zombie-Pfad).
5. `src/telephony/adapters/telnyx/voice.js` steht nicht in der P11-Dateiliste der Spec — nachweislich kommentar-only, kein echter Scope-Bruch, aber formal ausserhalb der Spec-Dateien.
6. Kein Report auf dem Branch zum Zeitpunkt des Safety-Reviews (dieser Bericht schliesst das jetzt).
7. Stil-Divergenz am selben Seam: `telnyx-inbound.js` nutzt konditionalen Spread, `telnyx-call-control-ingest.js:179` reicht `language` direkt durch — Wirkung identisch, zwei Idiome fuer dieselbe Zusage.

**Verdikt:** FREIGABE (approved) mit auflagenfreien Hinweisen. GAP-24 und GAP-26 durch echten Produktionscode gruen geworden, kein Gate gruen geredet.

---

## 4. Clean-Code-Audit (final)

- **s1 (Blocker):** keine
- **s2:** keine
- **s3 (Info, kein echter Verstoss):** `test/telnyx-p8-inbound.test.js` — zwei Tests (aktualisierter Regressionstest "Sprach-Durchstich, P11" + bestehender Katalogtest "GAP-24 (SOLL, rot)") pruefen nach dem Fix inhaltlich fast dasselbe. Bewusst so belassen: einer ist dauerhafter Regressionsschutz (`npm test`), der andere der Katalogtest fuer die Gate-Buchhaltung (`test:gates`) — Entfernen eines der beiden wuerde entweder Gate-Zaehlung oder Regressionsschutz verlieren.
- **s4:** keine
- **blocker: false**

**Verdikt:** PASS. Diff bleibt eng am Scope, klein (5 Dateien, +134/-21 Zeilen), rein additiv, keine Sicherung entfernt/geschwaecht. Beide Aenderungen sind einfache Value-Passthroughs bzw. ein zusaetzlicher set-once-Schreibvorgang — keine neue Verschachtelung, keine Magic Numbers, keine Duplizierung von Produktionslogik. Neuer Unit-Test beweist Reihenfolge/Idempotenz des Cap-Grunds. Volle Suite lokal nachgefahren: 3341/3341 gruen, alle betroffenen/neuen Tests einzeln verifiziert (13/13 gruen, inkl. beider vormals SOLL-roter GAP-Tests).

**passNotes:** `recordFailureReason` bereits set-once + value-gated — neuer Aufruf im Cap-Pfad kann einen bereits vom Provider gesetzten Grund nicht ueberschreiben, und umgekehrt gewinnt der Cap-Grund gegen einen spaeteren `/voice/status`-Retry. `transcriptionFields()`-Mapping unveraendert. `languageHint`-Spread defensiv gegen fehlendes `call.language`.

**topTodos:**
- Kein Blocker, direkt mergefaehig.
- Bei Gelegenheit: inhaltliche Naehe der zwei Sprach-Passthrough-Tests im naechsten Aufraeum-Pass pruefen, ob die Katalog-Buchhaltung den GAP-24-Test inzwischen als erledigt fuehren kann.

---

## 5. Fix-Runden

Keine. Die Phase erreichte PASS in der ersten Review-Runde (kein Blocker in Safety oder Clean-Code, keine Nachbesserung noetig).
