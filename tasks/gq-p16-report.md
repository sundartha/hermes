# GQ-P16 — Detailbericht: `endCallWait` direction-neutral in de und fr

**Gate:** PASS
**finalBranch:** `phase/gq-p16-endcallwait-neutral`
**headCommit:** `e3029d5bf5dfb5f0cbd009c96f7d2583c5f7f16d`
**Basis:** `master` @ `3ac18d4`

---

## 1. Ausgangsbefund (am Code gemessen)

`endCallWaitInstruction(call)` (`src/claude.js`) liest ausschliesslich `call.language`, `call.direction` wird auf dem gesamten Pfad (Budget-Engine-Tool-Loop und `src/bridge.js`, `sendFunctionOutput`) nie referenziert. Der Text muss also fuer **beide** Richtungen stimmen. Der Pfad ist bei Inbound erreichbar, seit `shouldSuppressEndCall` (P3.3) den Direction-Kurzschluss verlor.

Defekt: `de.js` sprach von „Der Angerufene", `fr.js` von „La personne appelée" — beides nur bei Outbound fachlich korrekt. `en.js` war bereits neutral ("The other person") und diente als Vorlage.

Zusaetzlicher Fund: `test/llm-message-chain-language.test.js` spiegelt den DE-String woertlich in einer Absenz-Assertion (Konstante `END_CALL_WAIT_INSTRUCTION_TEXT`).

---

## 2. Plan (gekuerzt)

- **Neue Datei:** `test/gq-p16-end-call-wait-direction.test.js` — node:test, in-process, `DATA_DIR` vor erstem `config`-Import, dynamischer Import (Naht wie `test/p11-agent-language-contract.test.js`), kein Server-Spawn, kein Sleep.
  - `GQ-P16-1`: Wait-Text benennt in keiner Richtung (inbound/outbound) eine richtungsgebundene Rolle (de: "angerufene"/"anrufer"; fr: "appelé"/"appelant").
  - `GQ-P16-2`: Wait-Text behaelt in beiden Richtungen die Pflichtmarker (de: "noch nichts gesagt", "Lege nicht auf", "warte"; fr: "n'a encore rien dit", "Ne raccroche pas", "attends").
  - Bewusst NICHT enthalten: `instruction(inbound) === instruction(outbound)` — waere heute tautologisch (Funktion liest `direction` nicht) und wuerde eine spaetere Direction-Zweig-Variante blockieren.
- **Edit 1** `src/i18n/prompts/de.js`: "Der Angerufene hat noch nichts gesagt..." -> "Dein Gegenüber hat noch nichts gesagt...". Begruendung: "dein Gegenüber" ist der im Bundle bereits 12x verwendete neutrale Begriff; nur das Subjekt wechselt, Imperativ-Teil byte-identisch.
- **Edit 2** `src/i18n/prompts/fr.js`: "La personne appelée n'a encore rien dit..." -> "Ton interlocuteur n'a encore rien dit...". Begruendung: "ton interlocuteur" ist der etablierte neutrale Begriff in fr.js (11 Vorkommen), haelt das Tutoiement ein.
- **Edit 3 (Pflicht, nicht optional)** `test/llm-message-chain-language.test.js`: `END_CALL_WAIT_INSTRUCTION_TEXT`-Konstante an neuen Wortlaut angepasst — sonst waere der Absenz-Test vakuum-gruen (abgeschaltete Sicherung, G4/S1).
- **Ausdruecklich kein Edit:** `en.js`, `src/claude.js`, `src/bridge.js`, `shouldSuppressEndCall`/`openingBootstrap`/`silentTurn`, `p11-agent-language-contract.test.js`/`bridge-*.test.js` (greifen ueber `LOCALES`, kein Literal), keine neue Env-Variable.
- **Vorab-Messung** (vor Abgabe des Plans real durchgefuehrt): Sonde gegen unveraendertes `master` gefahren — `GQ-P16-1` rot mit `de/inbound: "angerufene"`, `GQ-P16-2` gruen. Mit den Edits: beide gruen. Danach sauber zurueckgesetzt (`git status --short` leer).
- **Baseline `npm test` auf `3ac18d4`:** 3986/3986 gruen (korrigierte Zahl nach Katalog-Split; roh 4006).
- **Deterministische Pruefungen:** `node --check` auf beiden Prompt-Dateien; isolierter Testlauf der neuen Datei; Gegenprobe via `git stash` (Falsifizierbarkeit); `npm test` als Gate (erwartet 3988 = 3986+2); `grep` nach den alten Literalen (erwartet keine Treffer).
- **Blast-Radius:** 3 geaenderte Zeilen in 3 Dateien + 1 neue Testdatei. Kein Kontrollfluss, keine Signatur, kein Aufrufer, kein Env-Wert.
- Fuer den Report vorab benannte, bewusst nicht gefixte Befunde: veraltete "Outbound"-Kommentare ueber `endCallWaitInstruction` (`src/claude.js`) und am Aufrufer (`src/bridge.js`); ueberholte Kopf-Begruendung der vier gespiegelten Konstanten in `test/llm-message-chain-language.test.js`.

---

## 3. Impl-Zusammenfassung

Exakt gemaess Plan umgesetzt. `endCallWait` in `de.js`/`fr.js` von richtungsgebundener Rolle auf den im jeweiligen Bundle bereits etablierten neutralen Begriff umgestellt — nur das Subjekt wechselt, der Imperativ-Teil bleibt byte-identisch. `test/llm-message-chain-language.test.js` an den neuen Wortlaut angepasst. Neue Testdatei `test/gq-p16-end-call-wait-direction.test.js` prueft beide Sprachen x beide Richtungen.

Falsifizierbarkeit vor dem finalen Commit erneut gegenprobiert: mit den alten Strings schlaegt `GQ-P16-1` exakt mit `de/inbound: "angerufene" steht im Wait-Text` fehl, `GQ-P16-2` bleibt gruen; danach zurueckgesetzt.

**Messwerte:**
- `node --check` auf allen 4 Dateien: gruen.
- `npm test` (JSON- und pglite-Backend in derselben Suite): 3988/3988 gruen, 0 fail — passt exakt zur erwarteten korrigierten Zahl.
- `grep` nach den alten Literalen in `src/`/`test/`: kein Treffer (Exit 1).
- Smoke-Test: direkter In-Process-Aufruf von `endCallWaitInstruction` statt vollem Server-Spawn (Sandbox-Restriktion bei background+redirect-Kombination) — ausreichend, da reiner i18n-Text ohne Routen-/Signaturbeeinflussung. DE/inbound und FR/outbound liefern die erwarteten neuen Texte.

**Dateien:**
- Editiert: `src/i18n/prompts/de.js`, `src/i18n/prompts/fr.js`, `test/llm-message-chain-language.test.js`
- Neu: `test/gq-p16-end-call-wait-direction.test.js`
- Commit `e3029d5` auf `phase/gq-p16-endcallwait-neutral`, 4 Dateien, +72/-3.

**Deviations:** keine.

---

## 4. Safety-Urteil

**approved: true** — alle Einzelurteile true (testsPassIndependently, safetyGatesIntact, disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected, behaviorAsIntended). Keine Blocker.

**Unabhaengiger Testlauf** (separater Worktree, Branch `review-gq-p16` aus `phase/gq-p16-endcallwait-neutral`):
- `npm test` Lauf 1: korrigiert 3986/3988 pass, 2 fail; Lauf 2: 3987/3988 pass, 1 fail. Einziger reproduzierter Fehler: `test/media-token.test.js:78` (404 statt 200) — Spawn-/Lastflake unter parallelen Worktrees, isoliert 7/7 gruen, Datei nicht im Diff.
- pg-Backend (pglite): `store-pg-multitenant.test.js`, `web-auth-pg.test.js`, `profile-a3-backfill.test.js` -> 42/42 gruen.
- Direkt betroffene Tests: 26/26 gruen (inkl. P11-9/P11-10, Offenlegung in jedem Locale).
- Defekt-Reproduktion in dieser Session eigenstaendig wiederholt (`git checkout master -- ...`): neuer Test faellt rot mit derselben Meldung — der Test misst wirklich den Befund.
- Gates-Zuordnung geprueft: Testnamen `GQ-P16-*` matchen `config.i18nCatalogPattern` nicht -> bleiben im Regressionslauf.

**Concerns (nicht blockierend):**
1. Strukturelle Wurzel bleibt offen: `endCallWaitInstruction` liest weiterhin nur `call.language`, nicht `direction`. Von der Spec explizit als Nicht-Ziel benannt.
2. Neuer Test pinnt nur de/fr hart kodiert; `en` bleibt ungeschuetzt, eine kuenftige vierte Sprache faellt durch kein Netz.
3. Aenderung ist unbedingt (kein Flag) und wirkt daher auch auf Outbound — das entspricht der Spec-Absicht ("neutral" fuer beide Richtungen).
4. `npm run test:gates` konnte in der Safety-Umgebung nicht zu Ende laufen (verwaister Kindprozess in `auth-p9a-cache-headers.test.js`, bekanntes Umgebungsproblem, vom Diff nicht erreichbar). Ersatzweise i18n-/Sprach-Testdateien gezielt gefahren: 10/10 gruen.
5. Lastflake in `test/media-token.test.js` beobachtet, isoliert gruen, Datei nicht im Diff — Rot zaehlt nur, wenn isoliert rot.

**Diff-Pruefung:** `git diff master..HEAD` = 4 Dateien, +72/-3, exakt die zwei Spec-Strings + Testdateien. `src/claude.js`, `src/bridge.js`, `src/route-policy.js`, `src/config.js`, `package.json`, `package-lock.json` mit 0-Zeilen-Diff. `en.js` unangetastet. Keine neue Dependency, keine Signatur-/Aufrufer-Aenderung.

**Offenlegung intakt:** `disclosureSentence` unveraendert, `claude.js`/`bridge.js` null geaenderte Zeilen, P11-9/P11-10 gruen.

---

## 5. Clean-Code-Audit

**Verdict: PASS. blocker: false.**

- **S1:** []
- **S2:** []
- **S3:** []
- **S4:** []

Minimaler, gezielter Diff. `de.js`/`fr.js`-Text von richtungsgebundenem auf neutralen Begriff umgestellt, passend zu `en.js` (bereits neutral) — jetzt sind alle drei Locales konsistent (kein G11-Verstoss). Neuer Test deckt genau den Regressionsfall ab, ein Konzept pro Test (P14), sprechende Konstanten statt Magic Strings, nachvollziehbare Blindstellen-Begruendung im Kommentarkopf. Bestehender Test korrekt angepasst. Scope minimal, keine Duplizierung, keine toten/auskommentierten Stellen, keine Safety-Gate-Beruehrung.

**passNotes:** Konsistenz mit `en.js` hergestellt statt gebrochen. Testnamen bewusst ohne Katalog-ID-Praefix (Lehre `catalog-id-prefix-misroutes-tests`), damit der Test im Regressionslauf bleibt.

**topTodos:** []

---

## 6. Fix-Runden

Keine. `FIXES` ist leer — beide Reviews (Safety und Clean-Code) waren im ersten Durchlauf PASS, keine Nachbesserung noetig.

---

## 7. Fuer Folgephasen benannte, bewusst nicht gefixte Befunde

1. **C2 in `src/claude.js`** — Kommentar ueber `endCallWaitInstruction` behauptet weiterhin "Outbound"-Exklusivitaet; seit P3.3 (Entfernung des Direction-Kurzschlusses in `shouldSuppressEndCall`) nicht mehr korrekt. Gleiches Muster am Aufrufer in `src/bridge.js`.
2. **C2/G5 in `test/llm-message-chain-language.test.js`** — Kopf-Begruendung der vier gespiegelten Konstanten ("byte-identisch zu `src/claude.js`, dort bewusst nicht exportiert") ist ueberholt; alle vier leben inzwischen in `src/i18n/prompts/*` und sind ueber `LOCALES` lesbar. Ein Lesen aus `LOCALES` wuerde die Spiegelung strukturell ersetzen — betrifft aber alle vier Konstanten, drei davon phasenfremd.
3. Formulierungsfrage der Spec beantwortet: "dein Gegenüber" macht den deutschen Text nicht unnatuerlicher, sondern konsistenter (bereits 12x im selben Bundle Standardbegriff).
