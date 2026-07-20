# Phase P1 — Umlaut-Fix, gesprochene Strings (Commit A)

**Gate:** PASS
**finalBranch:** `phase/cq-p1-umlaut-fix1`
**Basis:** `master` = `3977ed1` (P1b bereits gemergt)
**headCommit (Impl):** `4ae3a62e391a2f7a22ef6a5df5d3f4549ded40a9`
**Zugehoeriger Strategieplan:** PLAN-CONVERSATION-QUALITY-V2.md (siehe MEMORY: `conversation-quality-v2-plan`)

---

## 1. Plan (gekuerzt)

**Ziel:** Alle deterministisch gesprochenen deutschen Strings (S1-S8) tragen wieder korrekte Umlaute (UTF-8) statt der bisherigen ASCII-Transliteration (`ue/oe/ae`). Bewusst NICHT angefasst: Strings, die nie gesprochen werden (`realtimeOpener.outbound`, `summarySystem` — LLM-Prompt, dessen Output als JSON geparst wird) sowie der gesamte Systemprompt in `src/claude.js` (das ist P5/Commit B).

**Blast-Radius laut Plan:** 2 Produktionsdateien (`src/i18n/locales.js`, `src/routes/voice.js`), 8 Bestandstests angepasst, 1 neuer Test. Keine neue Datei in `src/`, keine neue Env-Var, keine neue Dependency, keine Signatur-/Strukturaenderung.

**Vorab-Verifikation am Code (Abweichungen zum Plantext, alle vom Plan selbst dokumentiert):**
- `test/l2-calendar-prefetch.test.js` existiert nicht mehr (von P1b entfernt) — uebersprungen.
- Pin-Zeilennummern im Plantext waren veraltet; echter Treffer wurde ueber Testnamen/Konstanten aufgeloest (`DISCLOSURE_DE`, `DE_SUMMARY` etc.), nicht ueber Zeilennummern.
- `f1-i18n-locale.test.js:28` (`DE_SUMMARY` = `summarySystem`) bleibt unveraendert (Scope-Grenze).
- S1-S7 in `locales.js`, S8 in `routes/voice.js` — bestaetigt, alle acht Literale gefunden.
- Kein Code vergleicht gehoerten Text gegen DE-Literale (kein G5-Risiko) — alle Konsumenten (`claude.js`, `llm.js`, `telnyx-llm-shim.js`, `routes/voice.js`) lesen aus dem Bundle.
- Renderpfad ist UTF-8 (`escapeXml` beruehrt nur `& < > " '`, `XML_DECL` ist UTF-8, keine Kompressions-Middleware im Repo) — `Content-Length` ist deterministisch pruefbar.
- `Aeusserung`/`weisst`/`schliesse` (Systemprompt in `src/claude.js`) liegen ausserhalb von S1-S8 → P1 fasst `claude.js` nicht an (das ist P5/Commit B).

**Baseline-Grep vor P1 (Abnahme-Grep, 10 Nicht-Kommentar-Treffer):**
```
locales.js: 99 120 124 130 132 133 134 143 144   ·   voice.js: 194
```
Zielwert nach P1: genau 2 (`realtimeOpener.outbound`, `summarySystem` — beide bewusst ausgenommen).

**Betroffene Felder S1-S8:**

| Feld | Datei | Vorher (Auszug) | Nachher (Auszug) |
|---|---|---|---|
| S1 `disclosure` | locales.js | `Das Gespraech wird fuer meinen Auftraggeber ...` | `Das Gespräch wird für meinen Auftraggeber ...` |
| S2 `llmDegradedSpeech` | locales.js | `... sobald es wieder moeglich ist. Auf Wiederhoeren.` | `... sobald es wieder möglich ist. Auf Wiederhören.` |
| S3 `turnErrorSpeech` | locales.js | `... versuchen Sie es spaeter erneut.` | `... versuchen Sie es später erneut.` |
| S4 `noSpeechReprompt` | locales.js | `Koennen Sie das bitte wiederholen?` | `Können Sie das bitte wiederholen?` |
| S5 `budgetExhaustedHangup` | locales.js | `Demo-Budget ist aufgebraucht. Auf Wiederhoeren.` | `Demo-Budget ist aufgebraucht. Auf Wiederhören.` |
| S6 `turnFallbackSpeech.inbound` | locales.js | `... vielen Dank fuer Ihren Anruf. Auf Wiederhoeren!` | `... vielen Dank für Ihren Anruf. Auf Wiederhören!` |
| S7 `turnFallbackSpeech.outbound` | locales.js | `... vielen Dank fuer Ihre Zeit. Auf Wiederhoeren!` | `... vielen Dank für Ihre Zeit. Auf Wiederhören!` |
| S8 (Say im `!numberRecord`-Zweig) | routes/voice.js | `Diese Nummer ist nicht erreichbar. Auf Wiederhoeren.` | `Diese Nummer ist nicht erreichbar. Auf Wiederhören.` |

Dazu ein zentraler Konventions-Kommentar in `locales.js` (neu: erklaert, warum DE jetzt korrekte Umlaute traegt, welche zwei Felder bewusst ausgenommen sind, und dass Kommentare selbst ASCII bleiben — Repo-Konvention) sowie mehrere C2-Kommentare, die durch den Fix sonst falsch geworden waeren ("byte-identisch" stimmte nach dem Fix nicht mehr).

**Neuer Test `test/de-umlaut-orthography.test.js`** (einzige neue Datei), vier Tests:
- **P1-U1**: Denylist bekannter ASCII-Transliterations-Staemme (`fuer|Gespraech|moeglich|Koennen|spaeter|Wiederhoer|...`) gegen S1-S7 — keiner darf mehr matchen.
- **P1-U2**: Gegenprobe — jedes S1-S7-Feld muss ein echtes `ä/ö/ü` enthalten (verhindert, dass ein "Fix" das Wort einfach streicht statt korrekt zu schreiben).
- **P1-U3**: Abgrenzung — `realtimeOpener.outbound` und `summarySystem` bleiben bewusst transliteriert (pinnt die Scope-Grenze als Test).
- **P1-U4**: S8 ueber den echten Renderpfad (`/voice/incoming` mit unbekannter Zielnummer) — prueft `Content-Type: text/xml; charset=utf-8`, korrektes `Auf Wiederhören` im Body, und dass `Content-Length` exakt `Buffer.byteLength(body, "utf8")` entspricht (Umlaut-Byte-Fehlermodus waere sonst unsichtbar).

**Test-Pins (ueber Testnamen/Konstanten aufgeloest, nicht ueber Zeilennummern):** `f1-i18n-locale.test.js` (`DE_DISCLOSURE`, zwei Testnamen ehrlich umbenannt weg von "byte-identisch"), `turn-fallback-locale.test.js`, `disclosure-regression.test.js` (`DISCLOSURE_TAIL`; `DISCLOSURE_PREFIX`/`NO_REPEAT_CLAUSE` unveraendert — der semantische Regel-2-Schutz bleibt vollstaendig erhalten), `g4-no-speech-reprompt.test.js`, `telnyx-render.test.js`, `directive-render.test.js`, `outbound-premature-close.test.js` (`LLM_DEGRADED_MARKER`), `personal-assistant-characterization.test.js` (`DISCLOSURE_DE`). Bewusst NICHT angefasst: Tests, deren Umlaut-Stamm-Treffer Fixtures simulierter Modell-Ausgabe sind, keine Locale-Strings (`afix-p4-end-call-discipline`, `bridge-openai-event`, `telnyx-shim-endcall`, `telnyx-stab-p9-watchdog` inkl. `MS_PER_CHAR`-Rechnung), sowie `_outbound-harness.js`/`disclosure-outbound.test.js` (pinnen nur den umlautfreien Praefix).

**Keine neue Env-Var** → `.env.example` und `test/helpers.js` `BASE_ENV` bleiben unberuehrt.

**Arbeitsreihenfolge laut Plan (erzwingt "rot vor gruen" ohne `git stash`):** 1) neuen Test anlegen, 2) rot bestaetigen (Baseline-Nachweis), 3) `locales.js` dann `voice.js` editieren, 4) `node --check`, 5) Test-Pins nachziehen, 6) Verifikation (Grep, volle Suite, Smoke).

**Bewusst ausserhalb von P1** (Anti-Scope-Creep): `src/claude.js` (Systemprompt-Instruktionstexte, gehoert zu P5/Commit B), `speechClause`/`bridgePhrase`/`greetingDefault`/FR-/EN-Bundles, `src/mcp-tools.js`/`middleware.js`/`outbound-gates.js` (Log-/HTTP-Fehlertexte, erreichen weder TTS noch LLM), kein Extrahieren von S8 in eine Konstante, Safety-Gates/Offenlegungs-Wortlaut/-Reihenfolge/-Verdrahtung/Auth unberuehrt.

---

## 2. Implementierungs-Zusammenfassung

P1 wurde exakt gemaess Plan umgesetzt, ein Commit auf frischem Branch (Basis `3977ed1`, Vorab-Verifikation am Code deckungsgleich mit dem Plan).

- **Reihenfolge eingehalten:** `test/de-umlaut-orthography.test.js` zuerst angelegt und **rot bestaetigt** — 3 von 4 Tests scheiterten wie im Plan vorhergesagt (U1/U2/U4 rot, U3 gruen), Ausgabe wurde als Nachweis (nicht Behauptung) mitgefuehrt.
- Danach `src/i18n/locales.js` (Konventions-Kommentar zuerst, dann S1-S7-Umlaute + zugehoerige C2-Kommentare) und `src/routes/voice.js` (S8 + zwei C2-Kommentare) editiert.
- **Negativ-Gegenprobe-Grep** liefert exakt die vom Plan vorhergesagten 2 Restzeilen (`realtimeOpener.outbound`, `summarySystem` in `locales.js`) — Baseline war 10.
- Acht Bestandstestdateien gemaess Plan-Tabelle ueber Testnamen/Konstanten (nicht Zeilennummern) nachgezogen; `DE_SUMMARY`-Konstante und alle bewusst ausgenommenen Test-Fixtures (`O5_LONG_GOAL`, `MS_PER_CHAR`-Fixtures in den vier explizit nicht angefassten Dateien) blieben wie verlangt unveraendert.
- `node --check` auf allen 11 geaenderten/neuen `.js`-Dateien gruen.
- `npm test`: **2425/2425 gruen** (Baseline 2421 + 4 neue P1-U1..U4-Tests), 0 fail.
- Manueller Smoke (temporaerer, nicht committeter Helper, danach geloescht) bestaetigt Charset/Content-Length-Korrektheit am echten Renderpfad: `/voice/incoming` mit unbekannter `To` → `Content-Type: text/xml; charset=utf-8`, Body `Auf Wiederhören` (korrektes ö), `Content-Length`-Header 175 == `Buffer.byteLength(body,'utf8')` 175 (`body.length` in Zeichen: 174 — ein Byte mehr durch das Umlaut-Zeichen, wie erwartet). `/voice/turn` mit leerem `SpeechResult` liefert korrekt `Können Sie das bitte wiederholen?`.
- Kein `git push` (weder `origin` noch `upstream`), kein Live-Deploy — Cutover ist Owner-Entscheidung.
- Arbeitsverzeichnis nach Commit clean.

**Geaenderte/neue Dateien:**

*Neu:*
- `test/de-umlaut-orthography.test.js`

*Editiert:*
- `src/i18n/locales.js`
- `src/routes/voice.js`
- `test/directive-render.test.js`
- `test/disclosure-regression.test.js`
- `test/f1-i18n-locale.test.js`
- `test/g4-no-speech-reprompt.test.js`
- `test/outbound-premature-close.test.js`
- `test/personal-assistant-characterization.test.js`
- `test/telnyx-render.test.js`
- `test/turn-fallback-locale.test.js`

**Testzahlen:** `testPassCount` 2425, `testFailCount` 0, `testsPass` true, `nodeCheckPass` true, `smokePass` true.

### Deviations vom Plan

**Keine** (`deviations: []` im Impl-Report). Die im Plan selbst dokumentierten Abweichungen zum urspruenglichen Plantext (veraltete Zeilennummern, entfernte Testdatei `l2-calendar-prefetch.test.js`) waren bereits Teil der Vorab-Verifikation und keine Abweichung der Umsetzung vom (aktualisierten) Plan.

### Clean-Code-Selbstpruefung (Impl-Agent)

Gepruefte Punkte gemaess `.claude/refs/clean-code.md`:
- **G5/S2** (keine Duplizierung): `SPOKEN_DE_FIELDS` und `TRANSLITERATION_STEMS` sind je eine Quelle, in U1/U2/U4 wiederverwendet.
- **G25** (Magic Numbers): keine neuen Zahlenliterale ausser impliziten 0/1 in Testlogik.
- **C5/G9** (toter/auskommentierter Code): keiner eingefuehrt; alle geaenderten Kommentare beschreiben den jetzigen Zustand (kein "byte-identisch", wo es nicht mehr stimmt).
- **G12** (ungenutzte Imports): neuer Test importiert nur `test`, `assert`, `LOCALES`, `startServer` — alle vier genutzt.
- **N7** (Namen): `SPOKEN_DE_FIELDS`, `TRANSLITERATION_STEMS`, `UNROUTED_TO` sprechen die Absicht aus.
- **G30/G34** (eine Aufgabe/Abstraktionsebene): jede der vier Testfunktionen prueft genau einen Aspekt.
- **F1** (≤3 Argumente): keine neuen Funktionen mit >2 Parametern.
- **P15** (Lazy-Init-Antipattern): nicht beruehrt.
- **C2** (bruechige Datei:Zeile-Kommentare): die vier ueberarbeiteten Kommentare referenzieren Testnamen/Konzepte, keine Zeilennummern.
- Kommentare bleiben ASCII (Repo-Konvention; `grep -P` auf Umlaute in `//`-Zeilen liefert 0 Treffer).

---

## 3. Safety-Urteil (final)

**Verdikt: FREIGEGEBEN** (`approved: true`)

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

**Begruendung (gekuerzt):** P1 ist eine reine Orthografie-Aenderung an genau den acht im Plan benannten Feldern (S1-S8) plus dem Konventions-Kommentar; ein Commit, 11 Dateien, keine Dependency-Aenderung (`package.json`/`package-lock.json`-Diff leer), keine `.skip`/`.only`/`eslint-disable`, keine geloeschten Tests.

- **Regel 2 (Offenlegung):** mechanisch bewiesen, nicht per Augenschein — normalisiert man im neuen String `ae/oe/ue` zurueck, ist er byte-identisch zum `master`-String; Wortzahl und Reihenfolge identisch. `src/claude.js` und `src/bridge.js` sind gegenueber `master` byte-identisch (0-Zeilen-Diff) — Verdrahtung, Erst-Satz-Position und Nicht-Abschaltbarkeit unangetastet, im Smoke auf `/voice/outbound` praktisch bestaetigt.
- **Regel 1 (Safety-Gates):** unberuehrt. Der einzige `src`-Hunk ausserhalb `locales.js` ist in `routes/voice.js` der Say-Text im `!numberRecord`-Zweig plus Kommentare — keine Gate-Logik, keine Budget-/Denylist-/Land-/Stundenlimit-/Max-Dauer-Pfade, kein neuer Endpunkt.
- **Regel 3 (Auth fail-closed):** unberuehrt — Signaturpruefung, Basic-Auth, MCP-Auth, `safeEqual` alle nicht im Diff.
- **Regel 4/5 (Secrets/Audio):** kein neues Logging, keine Response-/MCP-Ausgabe-Aenderung, kein Audio-Pfad.
- **Regel 6 (Scope):** eingehalten, inklusive der Disziplin, die zwei nicht gesprochenen Felder trotz Denylist-Treffer NICHT mitzufixen.

**Unabhaengiger Test-Lauf (eigener Worktree, Branch `review-p1-r1` aus `phase/cq-p1-umlaut-fix1`):**
- Hinweis: der vorgegebene `ln -s "./node_modules" node_modules` erzeugte einen kaputten Selbstverweis — neu auf das `node_modules` des Haupt-Checkouts gezeigt.
- Lauf 1: 2425 Tests, 2424 pass, 1 fail (`test/voice-speak-status.test.js`, `UND_ERR_CONNECT_TIMEOUT` auf 127.0.0.1) — isoliert nachgefahren: 2/2 gruen.
- Lauf 2 (voll): 2425/2425 pass, 0 fail, 0 skipped, 0 todo, ~72s.
- Beide Store-Backends abgedeckt: `test/helpers.js` `BASE_ENV` pinnt `STORE_BACKEND=json` fuer Spawn-Tests, ~130 Testdateien instanziieren pglite explizit — alle gruen.
- Eigener Route-Smoke (Server als Kindprozess, temp `DATA_DIR`): `/voice/incoming` unrouted (S8) 175 Bytes, routed 475, `/voice/turn` leeres `SpeechResult` 428, `/voice/outbound` 569 — in allen Faellen `Content-Length == Buffer.byteLength(body,'utf8')` und `content-type text/xml; charset=utf-8`, Umlaute vorhanden wo erwartet, kein Transliterations-Treffer in gesprochener Ausgabe. Offenlegungssatz erscheint im `/voice/outbound`-Body LLM-frei als erster Satz.
- Negative Gegenprobe (Grep) liefert exakt das geforderte Bild: nur Kommentar-Treffer plus `locales.js:105` (`realtimeOpener.outbound`) und `locales.js:130` (`summarySystem`) — beide zusaetzlich durch Test P1-U3 gepinnt.

### Concerns (kein Blocker, siehe Owner-Auflagen unten)

1. **SPEC-LUECKE (nicht Impl-Defekt):** `DEFAULT_GREETING` (`src/store/defaults.js:214-215`) ist ein deterministisch gesprochener deutscher String (`locales.de.greetingDefault` + `defaultSettings().greeting`) und lautet weiterhin `"Ich kann eine Nachricht fuer {owner} aufnehmen."` — steht nicht in der S1-S8-Liste, das Weglassen ist Regel-6-korrekt, widerspricht aber dem Phasenziel "jeder gesprochene String traegt korrekte Umlaute": jeder Tenant ohne angepasste Begruessung hoert im Erstkontakt weiter "fuer". Vermuteter Grund: Aenderung wuerde geseedete Store-Werte UND `self-service.js` `GREETING_TEMPLATES` beruehren (Migrations-/Drift-Risiko). Gehoert in eine Folge-Phase.
2. Prompt-Deutsch in `src/claude.js` (z.B. `speechClause` "Nur natuerlich gesprochenes Deutsch.") bleibt transliteriert — laut Plan P5 (Prompt-Redesign inkl. Umlaut-Priming), keine Regression.
3. Offene Owner-Auflage (Abnahmepunkt 5 der Spec, Nicht-Agenten-Arbeit): Live-Probeanruf zur Bestaetigung von "Gespräch" als deutsches Wort.
4. **Testsuite-Flake:** `test/voice-speak-status.test.js` fiel im ersten Voll-Lauf mit `UND_ERR_CONNECT_TIMEOUT` (Server-Spawn-Race unter Voll-Last) — isoliert gruen, zweiter Voll-Lauf komplett gruen; bekannter vorbestehender ~12%-Flake, nicht durch P1 verursacht.
5. Dokumentierte, bewusst akzeptierte Nebenwirkungen des Plans bleiben bestehen (siehe Owner-Auflagen unten).

---

## 4. Clean-Code-Audit (final)

**Verdikt: PASS** (`blocker: false`)

| Kategorie | Befunde |
|---|---|
| S1 (Blocker) | keine |
| S2 (Blocker) | keine |
| S3 (kosmetisch) | 1 |
| S4 | keine |

**S3-Fund:** *P1-Kommentar · `src/i18n/locales.js:12-15`* — die Konventions-Kommentar zaehlt nur `realtimeOpener` und `summarySystem` als bewusst transliterierte Ausnahmen auf; `speechClause` ("Nur natuerlich gesprochenes Deutsch.") und die `STYLE_CLAUSES_DE`-Werte ("...persoenlichen Ton...") sind ebenfalls nie gesprochene LLM-Instruktionstexte und bleiben ebenso transliteriert, werden aber im Kommentar nicht erwaehnt. **Empfehlung:** Kommentar um diese Faelle ergaenzen oder generischer formulieren ("alle System-Prompt-Instruktionstexte, die nie an den Anrufer gehen"). Rein kosmetisch, keine Funktionsauswirkung (kein Test behauptet das Gegenteil) — **nicht behoben, da kein Blocker.**

**Pass-Notizen (Auszug):** Diff eng geschnitten (nur `locales.js`, `voice.js` + 8 Bestandstests + 1 neuer Test), macht genau das Angekuendigte. Verifiziert: `node --check` OK; volle Suite in isoliertem Klon gruen (2425/2425); neuer Test rot-vor-Fix/gruen-nach-Fix im direkten A/B-Vergleich gegen `master` bestaetigt (echte Regression, kein Placebo-Test); Umlaut-Zeichen kommen ausschliesslich in String-Literalen/Regex-Mustern vor, nie in Kommentaren; Bestandstests wurden ehrlich umbenannt ("byte-identisch" → "gepinnter Wortlaut") statt die jetzt falsche alte Behauptung stehen zu lassen. Test-Duplizierung der Disclosure-Zeichenkette ueber 3 Testdateien ist vorbestehend, wird synchron gehalten und ist bewusste Test-Unabhaengigkeit fuer Pinning-/Charakterisierungstests — kein Flag.

**Top-Todos (optional, kein Blocker):**
- Kommentar-Ausnahmeliste in `locales.js` praezisieren (`speechClause`/`STYLE_CLAUSES_DE` erwaehnen oder generisch fassen).
- Kein weiterer Handlungsbedarf fuer P1 selbst; uebrige ASCII-transliterierte Strings ausserhalb des Diffs (`claude.js`/`bridge.js` Systemprompt) liegen ausserhalb des P1-Scopes, vermutlich fuer eine spaetere Phase (P5) vorgesehen.

---

## 5. Fix-Runden

**Runde 1 (r1):** Branch `phase/cq-p1-umlaut-fix1` wurde von `phase/cq-p1-umlaut` angelegt (Worktree: `.claude/worktrees/wf_9f78c111-664-5`), `node_modules`-Symlink gesetzt. Die uebergebene Blocker-Liste war **leer** (`[]`) — es gab keine benannten Runde-1-Blocker zu beheben. Kein Code-Fix in dieser Runde noetig; der Branch-Name `-fix1` spiegelt den Workflow-Schritt wider, nicht eine tatsaechliche Korrektur.

Damit endete die Kette nach Runde 1 direkt mit Safety- und Clean-Code-PASS ohne inhaltliche Nacharbeit.

---

## 6. Offene Owner-/Deploy-Auflagen (NICHT-AGENTEN-ARBEIT, Restrisiken, Bestandsdaten-Auflagen)

Diese Punkte sind bewusst **nicht** Teil des agentenseitigen Abnahmekriteriums und wurden **nicht** umgesetzt — sie erfordern eine Entscheidung/Handlung des Owners bzw. echte Kosten/echte Anrufer:

1. **⛔ Live-Probeanruf (Abnahmepunkt 5 des Plans):** Der Owner muss am echten Anruf bestaetigen, dass die Offenlegung "Gespräch" als deutsches Wort spricht (nicht als Buchstabenfolge). Ein Agent loest keinen echten Anruf aus (Kosten, echter Mensch am anderen Ende).
2. **Kein Deploy in dieser Phase:** Kein `git push` (weder `origin` noch `upstream`), kein Live-Cutover. Der Branch `phase/cq-p1-umlaut-fix1` liegt lokal bereit; Merge/Deploy ist Owner-Entscheidung.
3. **Nebenwirkung (a) — akzeptiert, gehoert in `tasks/lessons.md`:** Summary-SMS kippt von GSM-7 auf UCS-2 (durch Umlaute) → grob doppelte Segmentzahl beim Provider, waehrend das Ledger pauschal `quantity: 1` bucht. Entschaerft, da `smsCostCents` per Default 0 ist. Nicht in P1 gefixt (laut Plan bewusst; `summarySystem` selbst wurde korrekt NICHT angefasst).
4. **Nebenwirkung (b) — akzeptiert:** Der Farewell-Watchdog schaetzt ueber `MS_PER_CHAR`; Umlaute verkuerzen manche Strings um ein Zeichen (Byte- vs. Zeichenzahl). Betrifft nur den nicht-live C-Telnyx-Pfad, liegt im dokumentierten ~12%-Aufschlag.
5. **SPEC-LUECKE `DEFAULT_GREETING`** (`src/store/defaults.js:214-215`, `locales.de.greetingDefault`): bleibt "Ich kann eine Nachricht fuer {owner} aufnehmen." — steht nicht in S1-S8, ist also Regel-6-korrekt ausgelassen, widerspricht aber dem Phasenziel fuer Tenants ohne angepasste Begruessung. Kandidat fuer eine Folge-Phase; Aenderung wuerde geseedete Store-Werte und `self-service.js` `GREETING_TEMPLATES` beruehren (Migrations-/Drift-Risiko) — nicht leichtfertig in P1 nachschieben.
6. **P5/Commit B (separat, nicht Teil von P1):** `src/claude.js`-Systemprompt (`Aeusserungen`, `weisst`, `schliesse hoeflich`, `moeglich`, `naechsten`, `speechClause`, `STYLE_CLAUSES_DE`) bleibt transliteriert — geplantes Prompt-Redesign inkl. Umlaut-Priming.
7. **Bekannter vorbestehender Flake:** `test/voice-speak-status.test.js` (~12% Voll-Last-Flake, Server-Spawn-Race) — nicht durch P1 verursacht, gilt nur als echt rot, wenn isoliert rot.
8. **Optionale Kosmetik (Clean-Code S3, kein Blocker):** Konventions-Kommentar in `locales.js:12-15` koennte die Ausnahmeliste um `speechClause`/`STYLE_CLAUSES_DE` ergaenzen oder generischer fassen.
