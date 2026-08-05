# GQ-P13 — Keine „Antwort ist DA"-Anweisung ohne Antwort

**Gate:** PASS
**finalBranch:** `phase/gq-p13-consult-ohne-fakten`
**headCommit:** `589f522d379781b6f2ef9d0fadf4bfb8f29b5e3b`

## Befund

`ANSWERED` wird an drei Stellen zur Sprech-Anweisung, die Bedingung stand zweimal im Code:

| Ort | Rolle |
|---|---|
| `src/store/state-ops.js` · `consultAnswerAwaitingDelivery(call)` | Praedikat -> Steuertext `CONSULT_WAIT.ANSWERED` |
| `src/store/state-ops.js` · `markConsultAnswerDelivered(s, callId)` | zweite, inline duplizierte Kopie derselben Bedingung |
| `src/telnyx-llm-shim.js` (`consultDeliveryDue`, via `src/consult/in-call.js`) | Zustellfenster GQ-P7 |

Ohne Deduplizierung haette `markConsultAnswerDelivered` faktenlose Consults weiterhin markiert — die Spec-Auflage „beide Aufrufer verhalten sich gleich" waere nicht erfuellt gewesen.

## Plan (gekuerzt)

**Keine neuen Produktionsdateien** (S4: Extraktion statt neuer Datei).

`src/store/state-ops.js`, zwei Edits:

1. Neue Funktion `answerAwaitsDelivery(consult)`:
   ```js
   function answerAwaitsDelivery(consult) {
     return (
       consult.status === CONSULT_STATUS.ANSWERED &&
       !consult.deliveredAt &&
       consult.answeredFacts > 0
     );
   }
   export function consultAnswerAwaitingDelivery(call) {
     return inCallConsults(call).some(answerAwaitsDelivery);
   }
   ```
   Kernpunkt: `answerConsult` setzt den Status unbedingt auf `answered`, auch wenn `mergeContextFacts` am geteilten Deckel `KEY_FACTS_LIMITS` null Fakten uebernommen hat. Ohne `answeredFacts > 0` bekaeme das Modell die Anweisung, eine Auskunft zu nennen, die nirgends im Prompt steht — bei gleichzeitigem Verbot, nachzufragen oder auszuweichen. Fehlendes Feld -> `false` (fail-closed, analog `isInCallConsult`).

2. `markConsultAnswerDelivered` auf dasselbe Praedikat umgestellt statt eigener Inline-Bedingung.

Kein weiterer Edit: `advanceInCallConsult` faellt bei `false` sauber auf `CONSULT_WAIT.NONE` durch; `answerConsult`, `claude.js`, i18n, `config.js` unberuehrt (Spec-Abgrenzung).

**Tests:** neue Datei `test/gq-p13-consult-answer-without-facts.test.js` (7 Faelle, reine `state-ops`-Ops: Antwort mit/ohne Fakten, Steuertext-Absenz, kein Zustellfenster, gemischter Fall, fail-closed bei fehlendem Feld, Schleifenfreiheit über mehrere Turns) + Anhang `GQ-P13-8` an `test/gq-p5-provider-nudge.test.js` (end-to-end gegen den Telnyx-Shim-Handler, kein Double). Bestandstests unveraendert — alle Fixtures, die das Praedikat erreichen, tragen bereits `answeredFacts: 1` (verifiziert per grep).

**Spec-Punkt 5:** `AL-P13-10` pinnt ausschliesslich den Vertrag von `answerConsult` selbst (`mergedFacts`, `outcome`, `answeredFacts`), nicht die abgeleitete Prompt-Wirkung — bleibt unveraendert korrekt und wird nicht angefasst.

## Impl-Zusammenfassung

- `filesEdited`: `src/store/state-ops.js`, `test/gq-p5-provider-nudge.test.js`
- `filesCreated`: `test/gq-p13-consult-answer-without-facts.test.js`
- Tests: GQ-P13-1..8, alle gruen
- `nodeCheckPass`: true, `testsPass`: true, `testPassCount`: 3967 (Basis 3959 + 8), `testFailCount`: 0
- `committed`: true
- `smokePass`: false — Server-Boot mit Dummy-Env scheitert am Boot-Guard („Keine aktive Nummer im Store"), erfordert Tenant-Bootstrap-Seed ausserhalb des Scopes; kein Blocker, da der geaenderte Codepfad end-to-end durch die neue Testdatei und GQ-P13-8 (direkt gegen den Telnyx-Shim-Handler, kein Double) abgedeckt ist.
- **deviations:** keine

**AL-P13-10 Ergebnis:** unveraendert gruen ohne Testaenderung — bestaetigt, dass die Spec-Abgrenzung von `answerConsult` korrekt eingehalten wurde.

**Zweite duplizierte Kopie aufgeloest (G5):** `markConsultAnswerDelivered` hatte die Bedingung inline dupliziert; jetzt teilen sich beide Aufrufer eine Quelle (`answerAwaitsDelivery`) — ohne diese Extraktion waere die Spec-Auflage nicht erfuellt gewesen.

## Safety-Urteil

**APPROVED.** Keine der absoluten Regeln beruehrt.

- **Scope:** nur GQ-P13, 3 Dateien, 175 Zeilen (151 Test). Keine neue Dependency, kein Stale-Base.
- **Offenlegung:** `src/claude.js`, `src/bridge.js` byte-identisch zu master.
- **Safety-Gates:** keine Gate-Datei angefasst; Aenderung ist strikt restriktiv — `consultDeliveryDue` wird haeufiger `false`, mehr Provider-Anstoesse werden geblockt -> weniger LLM-Turns -> geringere Kosten. Kann keinen Call-/SMS-/Geld-Pfad oeffnen, nur schliessen.
- **Auth:** kein neuer Endpunkt/Route/Middleware beruehrt.
- **Secrets:** keine geleakt.
- **Verifiziert:** Postgres-Round-Trip fuer `answeredFacts` intakt (wholesale JSON-Serialisierung, kein Feld-Mapping, das es fallen liesse); genau EINE Kopie des Praedikats im gesamten `src/` (gegrept) — G5-Deduplikation ist echt.

**Concerns (nicht-blockierend):**
1. AL-P13-10-Analyse war zum Zeitpunkt der Safety-Pruefung noch nicht in einem Report dokumentiert (dieser Report schliesst die Luecke).
2. Kein Feature-Flag — unbedingte Verhaltensaenderung, deckt sich mit der Spec, sollte aber bewusste Merge-Entscheidung sein.
3. Deploy-Moment-Kante: ein bereits `ANSWERED`-Consult ohne `deliveredAt` und ohne `answeredFacts`-Feld faellt fail-closed und bekommt nie ein Zustellfenster — praktisch nahe null, da `emitConsult` seit AL-P13 immer `answeredFacts: 0` schreibt.
4. Produktluecke bleibt offen: bei vollem `key_facts`-Deckel wird die Antwort still verschluckt, kein ehrlicher Marker — von der Spec bewusst in eine spaetere Phase verschoben.
5. Vorbestehend, nicht vom Diff verursacht: `consultDeliveryDue` (telnyx-llm-shim.js:731) wird vor der Auswertung gegen frischen Zustand (:800) berechnet — Race bei neu beantwortetem Consult zwischen diesen Zeilen, Bestandsverhalten.

## Clean-Code-Audit (s1-s4)

**PASS**, keine Findings in s1/s2/s3/s4, kein Blocker.

- Neue Funktion `answerAwaitsDelivery` ersetzt zwei vormals separate Inline-Bedingungen und fuegt die fehlende Bedingung hinzu (G5-Dedup + Korrektheits-Fix in einem Zug).
- Keine dritte Kopie im Code gefunden (gegrept).
- 8 neue Tests decken Normalfall, Nullfall, gemischten Fall, fehlendes Feld (fail-closed), Wiederholungssicherheit ab.
- Kommentare praezise (Motivation + Beleg-Kette), keine Umlaute im Diff, keine Magic Numbers (0 explizit begruendet), keine toten Pfade, kein auskommentierter Code.
- Funktion kurz (8 Zeilen), Verschachtelungstiefe minimal (0), 1 Argument.
- `topTodos`: keine.

## Fix-Runden

Keine — Gate direkt PASS, keine Nachbesserung noetig.
