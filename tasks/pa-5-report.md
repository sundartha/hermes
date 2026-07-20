# Phase PA-5 — `setOnceTimestamp`-Helfer (markAnswered/markSummarySmsSent/markBilled)

**Gate: PASS**
**finalBranch:** `phase/polish-a-p5`
**headCommit:** `7b50ee033b89fa1b2284dab5041f27b07ec724a2`
**Quelle/Deckung:** `PLAN-POLISH-A.md` Abschnitt 7, `#### PA-5` (Zeilen 165-170) + PM-6 (Zeile 114); Befund **S2-setonce** (`state-ops.js:306/342/355`)

---

## 1. Plan (gekuerzt)

### Ziel
Die drei strukturell identischen Set-once-ISO-Marker-Setter in `src/store/state-ops.js` —
`markAnswered` (Feld `answeredAt`), `markSummarySmsSent` (Feld `summarySmsSentAt`),
`markBilled` (Feld `billedAt`) — auf einen gemeinsamen, file-privaten Helfer
`setOnceTimestamp(call, fieldName)` dedupliziert (G5-Fix).

### Harte Kontrakte (mussten erhalten bleiben)
- Rueckgabe-Shape `{ call, changed }`, inkl. `call: null` bei unbekanntem Call.
- Backend-Wrapper (`store/json.js`, `store/pg.js`) destrukturieren `{ call, changed }` und
  `save()`en nur bei `changed` — beide unveraendert.
- Bestehende Idempotenz-Tests haengen exakt an diesem Shape:
  `test/store-pg-billing-idempotent.test.js` (markBilled) und
  `test/f2-p9-dedup-persist.test.js` (markSummarySmsSent).
- Nur 2 externe Aufrufer (json.js/pg.js-Wrapper), kein state-ops-interner Aufrufer.
- `!call[fieldName]` verhaltensgleich zu `!call.answeredAt` etc. (Felder nur `null` oder
  ISO-String, nie `""`).

### Bewusst ausgeschlossen (andere Semantik)
- `recordFailureReason(s, callId, reason)` — 3. Arg + value-gated, setzt aus `reason`.
- `setCallEndedAt(s, callId, status, endedAtIso)` — status-gated, expliziter Zeit-Anker.

### Helfer-Design
```js
function setOnceTimestamp(call, fieldName) {
  let changed = false;
  if (call && !call[fieldName]) {
    call[fieldName] = new Date().toISOString();
    changed = true;
  }
  return { call, changed };
}
```
- Nimmt den bereits aufgeloesten `call` (Trennung Resolution/Mutation), 2 Argumente (F1).
- Bewusst **nicht exportiert** (G8) — der neue Test faehrt ueber die drei OEFFENTLICHEN
  Setter, damit er einen vertauschten Feldnamen faengt (PM-6).
- Platzierung: direkt vor `markAnswered` (G10 vertikale Naehe).

### Edits in `src/store/state-ops.js`
- **A**: Helfer einfuegen (vor `markAnswered`).
- **B**: `markAnswered` → `return setOnceTimestamp(getCall(s, callId), "answeredAt");`
- **C**: `markSummarySmsSent` → delegiert an Helfer, Domaenen-Kommentar (F2 P9/M2) bleibt,
  nur die Mechanik-Zeile wird auf den Helfer verwiesen.
- **D**: `markBilled` → delegiert an Helfer, Domaenen-Kommentar (F9/A6) bleibt.

### Neuer Test
`test/state-ops-set-once-timestamp.test.js` — parametrisiert ueber die 3 oeffentlichen
Setter × 3 Faelle (9 Tests):
1. setzt genau `fieldName` einmalig (ISO), die anderen zwei Marker bleiben `null`
   (Feldnamen-Vertausch-Wachhund gegen PM-6).
2. idempotent — zweiter Aufruf No-op, Zeitstempel stabil.
3. unbekannter Call → `changed=false`, `call=null`, kein Throw.

`test/helpers.js`/`BASE_ENV` nicht beruehrt (keine neue Env-Var, kein Server-Spawn).

### Verifikationsplan
```
node --check src/store/state-ops.js
NODE_ENV=test node --test test/state-ops-set-once-timestamp.test.js   # 9 pass
NODE_ENV=test node --test test/store-pg-billing-idempotent.test.js test/f2-p9-dedup-persist.test.js
npm test   # Baseline + 9
```
Empfohlene Gegen-Probe: Feldname in `markBilled` temporaer verfaelschen → neuer Test MUSS
rot werden → danach zuruecksetzen (beweist PM-6-Wirksamkeit).

**Geaenderte Dateien laut Plan:** `src/store/state-ops.js` (1 Helfer + 3 Funktionen
umgestellt), neu `test/state-ops-set-once-timestamp.test.js`. Keine weiteren.

---

## 2. Implementierungs-Zusammenfassung

PA-5 wurde exakt gemaess Plan umgesetzt:

- `setOnceTimestamp(call, fieldName)`-Helfer in `src/store/state-ops.js` extrahiert
  (file-privat, nicht exportiert); `markAnswered`/`markSummarySmsSent`/`markBilled`
  delegieren jetzt darauf. Verhaltens-erhaltend — Rueckgabe-Shape `{call, changed}` und
  Falsy-Semantik byte-identisch zum Vorher.
- Neuer parametrisierter Test `test/state-ops-set-once-timestamp.test.js` (9 Faelle)
  faehrt ueber die drei OEFFENTLICHEN Setter und assertiert je auf `call[fieldName]`
  (PM-6-Wachhund gegen vertauschte Feldnamen) — per Gegenprobe lokal bestaetigt
  (`markBilled`-Feldname temporaer verfaelscht → Test wurde rot, danach zurueckgesetzt,
  `node --check` + Diff erneut verifiziert).
- Bestehende Idempotenz-Tests (`store-pg-billing-idempotent`, `f2-p9-dedup-persist`)
  unveraendert gruen (8/8).
- Volle Suite: **2383/0** (Baseline 2374 + 9 neue, exakt wie im Plan erwartet).
- **Smoke-Test**: Server lokal gebootet (Dummy-Env). Echter Inbound-Call ueber
  `/voice/incoming` → `answeredAt` live gesetzt; `/voice/status` (completed) →
  `billedAt` live gesetzt, `answeredAt`/andere Marker unberuehrt; wiederholter
  Status-Callback → `billedAt`-Zeitstempel stabil (Idempotenz live bewiesen). Server
  sauber gestoppt, Smoke-Datenverzeichnis geloescht.
- `git diff` auf `state-ops.js` deckt sich 1:1 mit den Plan-Edits A-D.

**Impl-Metadaten:**
- `headCommit`: `7b50ee033b89fa1b2284dab5041f27b07ec724a2`
- `node --check`: PASS
- Tests: PASS, 2383 pass / 0 fail
- committed: true (Commit `7b50ee0` auf `phase/polish-a-p5`, kein Push, kein Deploy)

**Geaenderte/erstellte Dateien:**
- Edited: `src/store/state-ops.js`
- Created: `test/state-ops-set-once-timestamp.test.js` (9 neue Tests: 3 Setter x 3 Faelle
  — setzt Feld einmalig ISO + andere Marker null, idempotent 2. Aufruf No-op, unbekannter
  Call → `changed=false`/`call=null`)

### Deviations vom Plan
**Keine.** (`deviations: []`)

### Clean-Code-Selbstpruefung (Implementierer)
- G5/S2 erfuellt (3-fach-Duplikat auf 1 Helfer reduziert).
- F1: Helfer 2 Argumente.
- G8/P15: Helfer file-privat, kein Export, nimmt fertig aufgeloesten `call` (keine
  Lazy-Init).
- N7: Name `setOnceTimestamp` macht Nebeneffekt sichtbar.
- C2/C3: stale Querverweise (Muster markAnswered/markSummarySmsSent) entfernt,
  Domaenen-Kommentare (F2 P9, F9 A6) erhalten.
- G25: keine neuen Magic Numbers.
- C5/G9/G12: kein toter/auskommentierter Code, keine ungenutzten Imports.
- ESM/kein Build-Step/kein TS/deutsche Kommentare ohne Umlaute eingehalten.
- Kein `config.js`-Import in die Store-Schicht (IO-/config-frei geblieben).

---

## 3. Safety-Urteil (final)

**approved: true**

| Kriterium | Ergebnis |
|---|---|
| testsPassIndependently | true |
| safetyGatesIntact | true |
| disclosureIntact | true |
| authFailClosedIntact | true |
| noSecretsLeaked | true |
| scopeRespected | true |
| behaviorAsIntended | true |
| blockers | keine |

**Concerns (nicht blockierend):**
1. Erster Voll-Lauf zeigte 1 roten Test (`test/a4-default-profile-zero.test.js:93`,
   `TypeError: fetch failed` / HTTPParserError "Response does not match the HTTP/1.1
   protocol"). Dokumentierter Voll-Last-Spawn/Port-Race-Flake (Rohbody wird als
   HTTP-Response geparst), NICHT von PA-5 verursacht: Domaene ist
   Profil-Provisioning-fetch, physisch unberuehrbar durch eine In-Memory-Marker-Dedup.
   Isoliert 3/3 gruen; zweiter Voll-Lauf 2383/2383 gruen (Flake nicht reproduziert).
2. `setOnceTimestamp` ist bewusst NICHT exportiert (privat); der Test nagelt korrekt die
   drei OEFFENTLICHEN Setter fest — kein direkter Helfer-Test, wie in der Spec gefordert.

**independentTestSummary:** Voll-Suite zweimal gelaufen. Lauf 1: 2382 pass / 1 fail
(a4-default-profile-zero = dokumentierter Voll-Last-HTTP-Parser/Spawn-Flake; isoliert 3/3
gruen). Lauf 2: 2383 pass / 0 fail / EXIT=0 (Flake nicht reproduziert). PA-5-relevante
Tests zusammen: 18/18 gruen (state-ops-set-once-timestamp neu, f2-p9-dedup-persist,
store-pg-billing-idempotent [pglite/pg-Pfad], finishcall-billing-once). Beide Backends
abgedeckt: json ueber state-ops/finishcall, pg ueber pglite-Tests fuer billedAt und
summarySmsSentAt. `node --check src/store/state-ops.js` OK.

**Verdict (Volltext):** APPROVED. PA-5 ist eine saubere, verhaltens-erhaltende G5-Dedup:
die drei strukturell identischen Set-once-ISO-Marker (markAnswered/markSummarySmsSent/
markBilled) speisen jetzt einen gemeinsamen privaten `setOnceTimestamp(call, fieldName)`.
Der Helfer ist byte-identisch zu den drei Originalen (gleicher `!call[fieldName]`-Guard,
gleiches `new Date().toISOString()`, kein Throw bei fehlendem `call`, identischer
`{call, changed}`-Kontrakt); beide Store-Fassaden (json.js/pg.js) konsumieren ihn
transparent und saven weiterhin nur bei `changed`. Feldnamen Zeile fuer Zeile gegen PM-6
geprueft — `answeredAt`/`summarySmsSentAt`/`billedAt` korrekt, kein Vertauscher
(kritisch, da `markBilled` money-adjazent/Bucht-Idempotenz). Der neue Test assertiert auf
`call[fieldName]` mit Feldnamen-Vertausch-Wachhund (andere zwei bleiben `null`),
Idempotenz und unbekannter-Call-No-Throw; bestehende Idempotenz-Tests bleiben
unveraendert gruen. `recordFailureReason`/`setCallEndedAt` bewusst getrennt gelassen.
Scope exakt eingehalten (nur 2 Dateien, keine neue Dependency, kein Config-/Gate-/Auth-/
Disclosure-Touch). Safety-Gates, `disclosureSentence` (claude.js+bridge.js),
Auth-fail-closed unangetastet. Kein Secret-Leak. Keine Blocker.

---

## 4. Clean-Code-Audit (final)

**blocker: false — Verdict: PASS**

| Ebene | Befunde |
|---|---|
| S1 | keine |
| S2 | keine |
| S3 | keine |
| S4 | keine |

**Volltext-Verdict:** PASS. Branch `phase/polish-a-p5` (Commit `7b50ee0`, Basis
`master=478f75c`) enthaelt genau 2 Dateien: `src/store/state-ops.js` (Refactor) +
`test/state-ops-set-once-timestamp.test.js` (neu, 9 Faelle). Zweck: die drei strukturell
identischen Set-once-ISO-Marker-Setter (markAnswered/markSummarySmsSent/markBilled) auf
einen gemeinsamen file-privaten Helfer `setOnceTimestamp(call, fieldName)` dedupliziert
(G5-Fix, nicht G5-Verstoss). Verhaltens-erhaltend geprueft: Rueckgabe-Shape
`{call, changed}` und Falsy-Semantik (null-Call → changed=false, kein Throw) sind
byte-identisch zum Vorher; alle Caller (`store/pg.js`, `store/json.js`, `bridge.js`,
`routes/voice.js`, `telephony/call-finish.js`, `telnyx-call-control-ingest.js`)
unveraendert, da Kontrakt gleich bleibt. Kompletter `node --check` + volle Suite lokal
ausgefuehrt: 2383/0 rot, inkl. neuer Datei separat gruen (9/9) und der im Commit
genannten Bestands-Idempotenztests (store-pg-billing-idempotent, f2-p9-dedup-persist,
8/8). Neuer Test deckt gezielt einen Feldnamen-Vertausch (PM-6, money-adjazent via
markBilled) ab, den ein reiner changed-Flag-Check durchrutschen liesse. Kommentar
oberhalb des Helfers ist praezise, referenziert korrekt bestehende Nachbarfunktionen
(recordFailureReason, setCallEndedAt) und deren abweichende Semantik. Keine Magic
Numbers, keine neue Verschachtelung, 2 Argumente, Funktion kurz und Ein-Aufgaben-
fokussiert. Scope exakt wie gefordert (nur der eine G5-Cluster), keine Nebenaenderungen.

**topTodos:** Kein Handlungsbedarf — Phase ist mergefaehig.

**passNotes:** G5 (Duplizierung) korrekt behoben: 3x identische 6-Zeilen-Set-once-Logik →
1 Helfer. Kontrakt `{call, changed}` + Falsy-Semantik byte-gleich erhalten, alle
Caller-Sites unangetastet (grep bestaetigt). Neuer Test P13 (Build-Operate-Check) sauber
strukturiert, ein Konzept pro Testfall (P14), deckt explizit den Grenzfall unbekannter
Call ab (G3/T5) und einen konkreten Feldnamen-Vertausch-Fehler (Money-adjazent via
markBilled — S1-Kandidat waere das gewesen, ist aber durch den Test abgesichert).
Kommentar oberhalb des Helfers akkurat, keine veralteten/widerspruechlichen Stellen (C2),
keine Autoren-/Datums-Metadaten (C1), kein auskommentierter Code (C5). `node --check` +
volle Suite (2383/0) sowie die im Commit referenzierten Bestandstests separat
verifiziert — alle gruen. Scope minimal und exakt auf den einen G5-Cluster begrenzt
(SCOPE-Regel eingehalten).

---

## 5. Fix-Runden

**Keine.** Beide Reviews (Safety + Clean-Code) haben die Phase im ersten Durchlauf mit
PASS/APPROVED und ohne Blocker abgenommen — kein Self-Fix-Zyklus noetig
(`=== FIXES ===` Quellblock leer).

---

## 6. Status

Phase PA-5 ist **abgeschlossen und mergefaehig**: Gate=PASS, keine offenen S1/S2, keine
Blocker, keine Deviations. Branch `phase/polish-a-p5` (Commit `7b50ee0`) liegt bereit,
noch nicht auf `master` gemerged, kein Push, kein Deploy.
