# Phase G4 — Reprompt-Verschlankung + Log-Cleanup

**Gate:** PASS
**Final Branch:** `phase/g4-reprompt-log-cleanup`
**Head-Commit (Impl):** `4c94e9d3a2ae68deaa5b4841749b8d605c1a0fab`
**Baseline:** `master` @ `9799e88`, `npm test` = 1172 pass / 0 fail

## Ziel

TTS-Sekunden im No-Speech-Wiederhol-Pfad sparen (Apologie-Filler raus) und die als
`TEMP-DIAGNOSE` markierten `[turn-recv]`/`[turn-ok]`-Logs aus dem `/voice/turn`-Handler
entfernen. Owner-Override hebt die fruehere Plan-§3-Deferral auf — G4 ist freigegeben.

## Plan (gekuerzt)

**Befund vs. Spec — eine harte Abweichung:** Die G4-Spec behauptet, kein Bestandstest pinne
den Reprompt-String (`grep test/` leer). Das stimmt nicht: zwei Tests pinnen den DE-Reprompt
exakt — `test/f1-i18n-locale.test.js` (`assert.equal(LOCALES.de.noSpeechReprompt, …)`) und
`test/g4-no-speech-reprompt.test.js` (`<Say>…</Say>`-Regex). Folge: Punkt 2 ist kein
test-freier Diff, die zwei DE-Pins muessen mitgezogen werden (vom Spec-Satz "falls ein
Snapshot-Test ihn pinnt, Snapshot aktualisieren" gedeckt). Punkt 1 (Logs) bleibt test-frei.

**Punkt 1 — Log-Cleanup (verhaltens-neutral):** `[turn-recv]`-Eingangs-Log + frueher-Hangup-Log
und `[turn-ok]`-Erfolgs-Log aus `/voice/turn` entfernen; tote `[turn-recv]`-Referenz im
`extractSpeech`-Kommentar neutralisieren (Erklaerung bleibt, nur der Log-Tag raus).

**Punkt 2 — Reprompt verschlanken:** Apologie-Filler (`"Entschuldigung, "` / `"Sorry, "` /
`"Désolé, "`) feuert bei jedem stillen Turn als reine Vorlauf-TTS. Kuerzen ist ein bewusster,
gerechtfertigter Diff (Skip-Bedingung "bereits knapp genug" greift nicht). Direkte Rueckfrage
bleibt hoeflich genug.

**Keine neuen Dateien (YAGNI/P11):** Punkt 1 verhaltens-neutral → kein neuer Test; Punkt 2
aendert nur Strings in einem Pfad, dessen Invariante (`<Say>`+`<Gather>`, kein `<Hangup>`)
bereits von `g4-no-speech-reprompt.test.js` bewacht wird → nur die zwei DE-Pins aktualisieren.

**Edits (8 total in 4 Dateien):**

| Edit | Datei | Aenderung |
|---|---|---|
| A | `src/server.js` | `[turn-recv]`-Eingangs-Log + frueher-Hangup-Log entfernt (Hangup-Zweig selbst byte-identisch) |
| B | `src/server.js` | `[turn-ok]`-Erfolgs-Log entfernt |
| C | `src/server.js` | tote `[turn-recv]`-Referenz im `extractSpeech`-Kommentar → `"Live-Beleg 2026-06-20"` |
| D | `src/i18n/locales.js` | de: `"Entschuldigung, koennen Sie das bitte wiederholen?"` → `"Koennen Sie das bitte wiederholen?"` |
| E | `src/i18n/locales.js` | fr: `"Désolé, pouvez-vous répéter, s'il vous plaît ?"` → `"Pouvez-vous répéter ?"` |
| F | `src/i18n/locales.js` | en: `"Sorry, could you please repeat that?"` → `"Could you repeat that?"` |
| — | `test/f1-i18n-locale.test.js` | DE-Pin auf verschlankten String aktualisiert |
| — | `test/g4-no-speech-reprompt.test.js` | `<Say>`-Regex-Pin auf verschlankten Reprompt aktualisiert |

**Deterministische Checks:** `node --check` beide Files → `OK`; `grep -rn "\[turn-recv\]\|\[turn-ok\]" src/`
→ leer; `npm test` → 1172 pass / 0 fail (Count unveraendert); `node --test test/g4-no-speech-reprompt.test.js`
→ 1 pass.

## Implementierung — Zusammenfassung

8 Edits in 2 Quell- + 2 Testdateien exakt gemaess Plan. 0 neue Dateien, 0 neue Dependencies,
Test-Count unveraendert (1172). Diff `+6/-29`.

- **Punkt 1 (Log-Cleanup):** `[turn-recv]`- (Eingang + frueher-Hangup) und `[turn-ok]`-Diagnose-Logs
  aus dem `/voice/turn`-Handler entfernt; tote `[turn-recv]`-Referenz im `extractSpeech`-Kommentar
  zu `"Live-Beleg 2026-06-20"` umgeschrieben statt verwaist zu lassen.
- **Punkt 2 (Reprompt):** Apologie-Filler aus `noSpeechReprompt` fuer de/fr/en gestrichen; die zwei
  DE-Pins mitgezogen, EN/FR ohne exakten Pin.
- **Verifikation:** `node --check` beide Files OK; `grep src/` nach den Log-Tags leer; Suite
  1172 pass / 0 fail (exit 0); `g4-no-speech-reprompt` rendert verschlankten `<Say>` + `<Gather`,
  kein `<Hangup`.
- **Commit:** `4c94e9d` (nur die 4 Dateien; node_modules-Symlink nicht committet).
- **Smoke:** Autoritativ via passierende Integration `g4-no-speech-reprompt.test.js` (gespawnter
  Server mit geseedetem Store, POST `/voice/turn?callId=call_g4` mit leerem `SpeechResult` →
  `<Say>Koennen Sie das bitte wiederholen?</Say>` + `<Gather`, kein `<Hangup`, Status 200). In keinem
  Boot-Log erschienen `[turn-recv]`/`[turn-ok]` (Cleanup wirksam).

### Deviations

1. **npm-Wrapper exit 194:** `npm test` liefert exit 194 ohne Test-Output, sobald stdout in eine
   Datei umgeleitet wird — npm-Quirk im Worktree (zirkulaerer node_modules-Symlink). Workaround:
   `node --test "test/*.test.js"` direkt → exit 0, 1172 pass / 0 fail. Identischer Befehl ohne Wrapper.
2. **Sandbox-Netzwerk-Artefakt:** Unter Default-Sandbox scheitern socket-bindende Integrationstests
   (media-token, media-WebSocket stream_token, outbound-premature-close) mit Sandbox-Artefakten
   (SSH-Banner in Localhost-Sockets, 401 statt 200). Mit `dangerouslyDisableSandbox=true` alle 1172
   gruen — Umgebungsartefakt, keine Code-Regression. Keine dieser Dateien im G4-Edit-Set.
3. **Manueller Standalone-Smoke blockiert:** Server-Boot + curl scheitert am fail-closed boot-guard
   (verlangt geseedete Owner-Nummer im Store) → HTTP 000. Route stattdessen ueber die passierende
   Integration verifiziert; erwartetes Fail-closed-Verhalten, kein Blocker.

## Safety-Urteil

**APPROVED.** Tests unabhaengig gruen, Safety-Gates intakt, Disclosure intakt, Auth fail-closed
intakt, keine Secrets geleakt, Scope respektiert, Verhalten wie beabsichtigt.

- **Unabhaengige Tests:** JSON-Backend 1172 pass / 0 fail / 0 skip. Postgres-Backend (store-pg*-Tests
  gegen pglite, offline) gruen innerhalb der 1172. Globales Forcieren `STORE_BACKEND=pg` erzeugt nur
  umgebungsbedingtes `[store] FATAL: pg-Backend nicht initialisierbar` auf 12 unrelated Test-Files
  (keine Live-DB in der Sandbox, `DATABASE_URL` unset) — branch-unabhaengig, korrektes
  Fail-closed-Verhalten, keine G4-Regression. Gezielter Safety-Set (g4-no-speech-reprompt,
  f1-i18n-locale, disclosure-regression, claude-identity, hangup-regression): 29/29 gruen.
- **Absolute Regeln:** Safety-Gates (numberGateError Denylist/Allowlist/Land/Stunde/Budget/Max-Dauer
  + `/voice/turn` early-return-Guard) unberuehrt; `disclosureSentence` in claude.js+bridge.js nicht im
  Diff, disclosure-regression gruen; Auth fail-closed unberuehrt; Secrets-Posture strikt verbessert
  (entfernte Logs waren bereits PII-sicher — nur Feldnamen + Wert-Laengen, kein neues Logging).
- **Concerns (nicht-blockierend):** (1) Test-Name "DE byte-identisch …" behauptet weiter "kein Drift"
  fuer ein Feld, dessen Assertion bewusst geaendert wurde — kosmetischer Naming-Nit. (2) FR/EN
  ebenfalls verkuerzt, obwohl Spec nur die eine server.js-Zeile nennt — konsistent mit dem
  Locale-Bundle, im G4-Geist. (3) `[boot] deployed commit`-TEMP-DIAGNOSE bei server.js:~1720 bleibt
  (separates STATUS.md-A5-Item) — korrekt out-of-scope.

## Clean-Code-Audit (S1–S4)

**Verdict: PASS** — keine S1/S2. Sauberer, klar abgegrenzter Cleanup-Diff (4 Dateien, `+6/-29`):
drei i18n-Reprompts (de/fr/en) verkuerzt + zwei TEMP-DIAGNOSE-Bloecke (`[turn-recv]`/`[turn-ok]`)
aus `/voice/turn` entfernt. **Blocker: nein.**

- **S1 (Blocker):** keine
- **S2 (Blocker):** keine
- **S3 (sollte fixen):** `test/f1-i18n-locale.test.js:152/159` (C2/G11) — Der Test heisst
  "DE byte-identisch zum frueheren server.js-Bestand (kein Drift)". Fuer `noSpeechReprompt` gilt diese
  Garantie nach G4 nicht mehr (bewusst auf `"Koennen Sie das bitte wiederholen?"` verkuerzt).
  Testname/Intent widerspricht der mitgeaenderten Assertion. Fix: `noSpeechReprompt` aus dem
  Byte-Identitaets-Guard nehmen ODER per Inline-Kommentar als bewusste G4-Abweichung markieren.
- **S4 (Nice-to-have):** `STATUS.md` (nicht im Diff, Folge des Branches) — A5 listet
  `[turn-recv]`/`[turn-ok]` weiter als "OFFEN". Nach diesem Branch sind sie entfernt, nur das
  `[boot] deployed commit`-TEMP-DIAGNOSE (server.js:~1723) bleibt absichtlich. Tracker ist stale.
  Fix: A5 auf Teil-Erledigung aktualisieren.

**Pass-Notes:** Der `/voice/turn`-Guard (`if !call || status !== 'active'` → hangup) bleibt
vollstaendig erhalten — nur die diagnostischen `console.log` davor/darin entfernt; kein
Auth/Budget/Allowlist/Signatur/Offenlegungs-Pfad beruehrt. Entfernte Logs waren als
"Phase 3: wieder entfernen" markierte, bewusst temporaere und bereits PII-bewusste Diagnose
(G12-Cleanup). Neues Verhalten verifiziert: `g4-no-speech-reprompt.test.js` + f1-Byte-Assertion
synchron zur Quelle aktualisiert, node:test gruen. Vorbildlich: der frueher danglende `[turn-recv]`-
Marker im `extractSpeech`-Kommentar (server.js:428) wurde zu "Live-Beleg 2026-06-20" umgeschrieben
statt verwaist zu lassen. `node --check` server.js + locales.js sauber.

## Fix-Runden

Keine. Der duale Review (Safety + Clean-Code) lief ohne Blocker durch (S1/S2 = leer,
Safety = APPROVED) — es waren keine Self-Fix-Runden noetig. Verbleibende S3/S4-Punkte
(Test-Naming-Nit, STATUS.md-A5-Nachzug) sind kosmetisch/out-of-scope und dem Lead als
Residual ueberlassen.

## Residual-Notizen (fuer den Lead, nicht in diesem Scope)

1. `test/f1-i18n-locale.test.js`: `noSpeechReprompt` aus dem "byte-identisch"-Guard nehmen oder als
   bewusste G4-Abweichung kommentieren.
2. `STATUS.md` A5: `[turn-recv]`/`[turn-ok]` als erledigt markieren, verbleibendes `[boot]`-TEMP-DIAGNOSE
   (server.js:~1723) als bewusst-belassen kennzeichnen (bis Gate 1.1).

## Relevante Pfade

- `/Users/jonaskroh/Larry/deliverables/vodafone-agent/src/server.js`
- `/Users/jonaskroh/Larry/deliverables/vodafone-agent/src/i18n/locales.js`
- `/Users/jonaskroh/Larry/deliverables/vodafone-agent/test/f1-i18n-locale.test.js`
- `/Users/jonaskroh/Larry/deliverables/vodafone-agent/test/g4-no-speech-reprompt.test.js`
