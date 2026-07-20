# Phase PA-7 — Log-Praefix `[voice/call-control]` als benannte Konstante

## Metadaten

| Feld | Wert |
| --- | --- |
| Gate | **PASS** |
| finalBranch | `phase/polish-a-p7` |
| Head-Commit | `674383da5208c201d58a3041db7768f873ac1bc6` |
| Geaenderte Datei | `src/telnyx-call-control-ingest.js` (einzige) |
| Committed | ja (Worktree-Branch, kein Push, kein Deploy) |
| Tests | 2388/2388 gruen (nach 1x isoliert bestaetigtem, unabhaengigem Flake) |

---

## Plan (gekuerzt)

**Ziel:** Das repo-weit nur in `src/telnyx-call-control-ingest.js` vorkommende Log-Praefix-Literal `"[voice/call-control]"` (14 Fundstellen) in eine benannte modul-lokale Konstante extrahieren — reiner G5/G25-Refactor (Duplizierung + Magic-String), verhaltens-erhaltend.

- **Blast-Radius:** genau eine Datei, keine neue Datei/Import/Dependency/Test-Aenderung. Ed25519-Signaturpruefung, Zustandsmaschine, Offenlegung, Settlement bleiben unberuehrt (nur Logging-Text-Quelle).
- **Name/Ort:** `CALL_CONTROL_LOG_PREFIX`, folgt der bestehenden Telnyx-Familien-Konvention (`SHIM_LOG_PREFIX`, `WATCHDOG_LOG_PREFIX`, `metrics.js LOG_PREFIX`). Modul-lokal, **nicht exportiert**. Platzierung direkt nach dem Import-Block, vor dem `OBS-2`-Kommentar.
- **Zwei Aufrufmuster bewusst getrennt gehalten:**
  - Muster 1 (12 Stellen): Praefix im Template-Literal interpoliert (`${CALL_CONTROL_LOG_PREFIX}`).
  - Muster 2 (2 Stellen): Praefix als separates erstes `console.error`/`console.warn`-Argument (`console.error(CALL_CONTROL_LOG_PREFIX, err.message)`), **nicht** in ein Template gezogen — Node joint mit Space, Ausgabe bleibt byte-identisch.
  - Eine Stelle (Edit 13, „unbekannter callId") war auf `master` ein einfacher `"..."`-String ohne Platzhalter und wurde dabei auf Template-Literal umgestellt — Ausgabe byte-identisch.
- **Tests:** bewusst keine neuen/geaenderten Tests (reiner Verhaltenserhalt, P11 verlangt Tests nur fuer neues Verhalten). Verhaltens-Erhalt stattdessen ueber 1:1-Diff, Rohliteral-Grep (0 verbliebene Literale ausser Definition) und Referenz-Grep (15 = 1 Definition + 14 Nutzungen) nachgewiesen. Bewusst **keine** Voll-Text-Console-Spy-Assertion (Anti-Muster gegen die eigene Dedup).
- **Deterministische Pruefungen:** `node --check`, Grep-Zaehlungen (0 Rohliterale ausser Definition, 15 Konstanten-Referenzen), `git diff` als reine 1:1-Substitution, repo-weiter Grep ohne Streu-Literal, volle Testsuite.

---

## Implementierungs-Zusammenfassung

In `src/telnyx-call-control-ingest.js` wurde nach den Imports die Konstante

```js
const CALL_CONTROL_LOG_PREFIX = "[voice/call-control]";
```

eingefuegt (mit knappem Herkunfts-Kommentar, kein redundanter Symbol-Kommentar) und alle 14 Vorkommen des Roh-Literals ersetzt:

- 12x als Template-Literal-Interpolation (`${CALL_CONTROL_LOG_PREFIX} ...`)
- 2x als separates erstes Argument (`console.error(CALL_CONTROL_LOG_PREFIX, err.message)`)

`git diff` zeigt ausschliesslich diese 14 Praefix-Substitutionen plus die eine neue Konstanten-Definition mit Kommentar — keine weiteren Zeilen betroffen.

**Pruefergebnisse:**
- `node --check src/telnyx-call-control-ingest.js` → gruen
- Grep: genau 1 Rohliteral (die Definition), 15 Referenzen der Konstante (1 Definition + 14 Nutzungen), 0 Streu-Literale repo-weit ausserhalb der Definition
- `npm test`: 2388/2388 gruen
- Smoke-Test: Server lokal gestartet (Port 3999, `SKIP_TWILIO_SIGNATURE_CHECK=true`, Dummy-Env), `/healthz` → 200; `POST /voice/call-control?callId=nonexistent-smoke-id` (hangup-Event, unbekannte callId) → 200, Server-Log zeigte exakt die ueber `CALL_CONTROL_LOG_PREFIX` erzeugte Zeile `"[voice/call-control] Event fuer unbekannten callId ignoriert (reason=unknown_call)"` — byte-identisch zum Alt-Literal, bestaetigt live die Template-Literal-Umstellung aus Edit 13. Server sauber per `pkill` beendet.

### Deviations

1. Die woertliche Setup-Anweisung `ln -s "./node_modules" node_modules` haette im Worktree einen selbstreferenzierenden Symlink erzeugt (Ziel relativ zum Worktree-cwd = sich selbst) und `npm test` zum Scheitern gebracht. Stattdessen wurde `ln -s ../../../node_modules node_modules` gesetzt (korrekter relativer Pfad zum echten Repo-Root-`node_modules`) — funktional identische Absicht (geteiltes `node_modules` ohne eigene Installation), nur mit korrektem Pfad. Symlink ist gitignored, nicht committet.
2. Der erste volle `npm test`-Lauf hatte 1 Fehlschlag in `test/onboarding-route.test.js` (404 statt 400) — eine von `telnyx-call-control-ingest.js` unabhaengige Datei. Isoliert lief diese Datei 8/8 gruen, ein zweiter Voll-Lauf lief 2388/2388 gruen. Passt zum bekannten Voll-Last-Spawn-Race-Flake (Projektgedaechtnis: Suite-Flake p5-gate-proof), keine echte Regression durch diese Phase.

---

## Safety-Urteil

**APPROVED.**

- `testsPassIndependently`: true — unabhaengiger Lauf im frischen Worktree: `npm test` → 2388 Tests, 0 Fehler, 0 uebersprungen, ~72,7s, Exit 0 (beide Store-Backends: json + pglite/pg inkl. RLS abgedeckt).
- `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`: alle true.
- **Blockers:** keine.
- **Concerns (nicht-blockierend):**
  1. Umgebungs-Hinweis: die woertliche Symlink-Setup-Anweisung erzeugt einen zirkulaeren Symlink; wurde korrigiert (siehe Deviation 1), fuer kuenftige Reviews dokumentiert.
  2. Kosmetisch: eine Stelle (Zeile ~264, „unbekannter callId") wechselte von einfachem String zu Template-Literal ohne Platzhalter — Ausgabe laufzeit-geprueft byte-identisch.
- **Verdict-Text (Kern):** Reine, verhaltens-erhaltende Kosmetik-Dedup exakt nach Spec. Genau eine Datei geaendert. Literal als eine benannte Konstante extrahiert, grep bestaetigt exakt 1 Rohliteral (Definition) und 14 Verwendungen. Beide Aufrufmuster korrekt getrennt gehalten (12x Interpolation, 2x First-Argument — NICHT zu Interpolation umgebaut), Log-Ausgabe an allen 14 Stellen byte-identisch. Absolute Regeln (Safety-Gates, Offenlegung, Auth fail-closed, Secrets, keine neue Dependency) unberuehrt. Kein Deploy, kein Push.

---

## Clean-Code-Audit (S1-S4)

**Verdict: PASS**, `blocker: false`.

| Stufe | Funde |
| --- | --- |
| S1 | keine |
| S2 | keine |
| S3 | keine |
| S4 | keine |

**PassNotes (Kern):**
- G5/G25 (Duplizierung/Magic-String) korrekt behoben: alle 12 interpolierten Fundstellen konsistent auf die neue Konstante umgestellt; grep bestaetigt keine verbliebene Roh-Literal-Stelle (bis auf den semantisch unterschiedlichen, unveraenderten Routen-Pfad-Kommentar `/voice/call-control`).
- G24 (Konventionen): folgt exakt dem etablierten Repo-Muster (`metrics.js LOG_PREFIX`, `WATCHDOG_LOG_PREFIX`) — modul-lokal, ALL_CAPS.
- G35 korrekt beachtet: bewusst NICHT nach `config.js` verschoben (kein Operator-Knopf), mit Verweis auf das etablierte `ERROR_DETAIL_MAX_LEN`-Muster im selben File — nachvollziehbar begruendet.
- C1-C5: neuer Kommentar ist reine Absichts-/Muster-Begruendung, keine Autor-/Datums-Metadaten, kein Widerspruch zum Code, kein toter Code. Deutsch ohne Umlaute eingehalten.
- Kein Export der Konstante noetig — kein anderes Modul/Test referenziert das Log-Praefix-Literal (anders als `WATCHDOG_LOG_PREFIX`, das echt modulübergreifend gebraucht wird); Nicht-Export ist damit korrekt, nicht unterlassen.
- `node --check` gruen. Betroffene Testdateien (telnyx-event-ingest-route/-machine, voice-signature-403-log, telnyx-p8-opening-contract, telnyx-p5-origination, telnyx-stab-p9-watchdog, call-termination-order, telnyx-observability-secret-guard) je einzeln gegen die Branch-Version gruen.
- Im Kombi-Lauf trat 1x der bekannte, im Projektgedaechtnis dokumentierte Suite-Flake (Settlement-Idempotenz-Test) auf — identisch reproduziert auch mit unveraenderter `master`-Datei im selben Kombi-Lauf, also nachweislich unabhaengig von dieser Phase.
- Prettier meldet Formatting-Abweichungen (lange Template-Literal-Zeilen) — bestehen bereits unveraendert auf `master`, kein Hook im Repo, durch den Diff nicht relevant verschlechtert (Konstante ist 2 Zeichen laenger als das Original-Literal).

**Top-TODOs:**
1. Kein Blocker, mergefaehig.
2. Info: der beobachtete Testfehler in `telnyx-event-ingest-route.test.js` (Settlement-Idempotenz) bei kombiniertem Testlauf ist ein vorbestehender, `master`-reproduzierbarer Flake — gehoert nicht zu PA-7, separat verfolgen falls noch nicht getrackt.
3. Kein Handlungsbedarf am Diff selbst; Muster ist bei zukuenftigen weiteren Log-Praefixen im selben Modul fortzusetzen.

---

## Fix-Runden

**Keine.** Beide Reviews (Safety + Clean-Code) liefen im ersten Durchlauf auf PASS/APPROVED ohne Blocker — keine Fix-Runde erforderlich.
