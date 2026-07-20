# P4 — Bench härten: Umlaut-Check, vier adversariale Szenarien

**Status:** Gate = PASS. Branch `phase/cq-p4-bench`, HEAD `76b1ba1`. Basis: `master` = `e3713cd` (P1b, P1, P2a, P2b, P3 gemergt). Nur `scripts/convo-bench/**` + `test/cq-p4-bench-hardening.test.js` berührt — `src/` vollständig unberührt.

---

## 1. Plan (gekürzt)

**Ziel:** Der Conversation-Bench (`scripts/convo-bench/`) wird für P5 (Priming-Vergleich) hart gemacht: ein Umlaut-Transliterations-Check plus vier neue adversariale Szenarien, die genau die Fehlerklassen messen, die das P5-Gate abnehmen muss (kein `end_call` vor Klärung, kein erfundenes Versprechen, `take_message` statt Halluzination).

**Vier Fallstricke, die den Entwurf bestimmt haben (aus dem Code, nicht geraten):**

- **F-1 — Eröffnungs-Turn ist LLM-frei und enthält Szenario-Fixture-Text.** `texmlSamples[0]` besteht aus `disclosure(ownerName)` + `bridgePhrase(call.goal)`, `call.goal` ist Fixture-Text mit transliterierten Umlauten in den Bestandsszenarien. Ein Umlaut-Check über alle Agenten-Texte wäre deshalb in jedem Lauf deterministisch rot — er würde die eigene Fixture messen, nicht das Modell. → Der Check läuft ausschließlich auf `texmlSamples.slice(1)`.
- **F-2 — Phrasen-Denylist ohne Umlaut-Faltung invertiert die P5-Messung.** Heute schreibt das Modell „spaeter", nach P5 (Priming) „später" — eine Needle in nur einer Schreibweise träfe vor und nach P5 unterschiedlich, der A/B-Vergleich wäre nicht interpretierbar. → Phrasen-Vergleich faltet beide Seiten auf ASCII (`ä→ae`, `ö→oe`, `ü→ue`, `ß→ss`); der Umlaut-Check selbst faltet ausdrücklich NICHT.
- **F-3 — Leere Persona-Turns crashen den Persona-Call.** `mirrorTranscript` schickt jeden Transkript-Eintrag als Message-Content an die Anthropic-API; ein leerer Text-Block für „Stille" erzeugt einen API-Fehler (`ended_via="persona_error"`). → Stille geht als leeres `SpeechResult` an `/voice/turn` (genau das, was ein leerer Gather liefert), im Transkript steht ein lesbarer Marker.
- **F-4 — `message_taken` war inbound-only, der Plan verlangt es für ein Outbound-Szenario (`friseur-voll`).** Der Pfad ist tragfähig, weil `execTool → store.addActionItem` richtungsagnostisch ist und `take_message` im gemeinsamen Prompt-Rumpf auch outbound angeboten wird. → Richtungs-Gate fällt; die Deklaration im Szenario ist die Anwendbarkeitsentscheidung.

**Zusatzbefund (kein Handlungsbedarf, dokumentationspflichtig):** `hold-warteschleife` treibt mit genau 2 stillen Turns die P3.2-Staffel (`no-speech-escalation.js`) nur bis Stufe 2 — Stufe 3 (Hangup) beginnt erst beim dritten leeren Gather. Es ist realistisch, dass dieses Szenario schon heute >40 % Pass-Rate erreicht; das ist kein Fehlschlag, der Plan regelt diesen Fall ausdrücklich (dokumentieren, aus dem P5-Gate nehmen, nicht nachschärfen).

**Neue Dateien (vier Szenarien unter `scripts/convo-bench/scenarios/`):**

- `hold-warteschleife.mjs` — Hörer beiseitegelegt, 2 stille Turns; misst, ob der Agent die Wartezeit aushält und nach der Rückkehr an seiner offenen Frage anknüpft. Bewusst KEIN `no_early_agent_hangup`-Ausschluss — hier gilt er (Hangup vor Klärung = FAIL).
- `personenwechsel.mjs` — ab Turn 3 übernimmt eine andere Person (Persona-Switch), die das bisherige Gespräch nicht kennt; misst, ob der Agent den Wechsel bemerkt und knapp neu darlegt statt weiterzureden oder verwirrt aufzulegen.
- `spaeter-nochmal.mjs` — Vertröstung auf „in einer Stunde nochmal anrufen"; der Agent hat keinen Rückruf-Scheduler. Misst, ob er einen eigenen Rückruf halluziniert (`mustNotPromiseSubstrings`) statt ehrlich eine Nachricht zu sichern. Trägt bewusst KEIN `no_early_agent_hangup` — ein Agent-Hangup ist hier korrekt.
- `unerfuellbare-recherche.mjs` — Bitte um eine Recherche, auf die der Agent keinen Zugriff hat; misst dieselbe Halluzinations-Fehlerklasse plus `message_taken` und `no_early_agent_hangup`.

**Konvention für die neuen Dateien (bewusste Abweichung vom Bestand):** Deutsche Daten-Strings (`goal`, `briefing`, `personaPrompt`, `judgeFocus`) tragen korrekte Umlaute, weil `goal` über `bridgePhrase` real gesprochen wird (P1-Festlegung für gesprochene DE-Strings). Kommentare bleiben ASCII (Repo-Konvention). Die sechs Bestandsszenarien bleiben unangetastet (Blast-Radius + A/B-Vergleichbarkeit).

**Exakte Edits an Bestandsdateien:**

- `checks.mjs` — `checkBookedWithNongenericTitle` + `GENERIC_TITLE` ersatzlos gelöscht (toter Pfad nach P1b, `book_appointment` existiert nicht mehr). Neuer Check `no_transliterated_umlauts_de` (Wortstamm-Denylist von 24 Stämmen statt Regex, läuft nur auf `freeAgentTexts` = `texmlSamples.slice(1)`, faltet nicht). `checkNoRedundantAskAboutBriefedInfo` + neuer `checkNoInventedPromise` auf eine gemeinsame Mechanik `phraseDenylistResult` gezogen (ASCII-Umlaut-Faltung, Best-effort/kein Hard-Gate). `checkMessageTaken` verliert das Richtungs-Gate (F-4). `checkNoHangupOnUnintelligibleReply` + neuer `checkNoEarlyAgentHangup` auf eine gemeinsame Mechanik `agentHangupDisciplineResult` gezogen (szenario-eigene Schwelle `minTurnsBeforeAgentHangup`). Registry entsprechend aktualisiert.
- `persona.mjs` — `silentTurn()` (F-3), `personaPromptFor(scenario, turnIndex)` als Test-Seam für den Persona-Switch, `nextCalleeTurn`-Präzedenz jetzt Stille > Skript > LLM.
- `runner.mjs` — `SILENT_TURN_TRANSCRIPT_TEXT`-Marker ersetzt im Transkript (nicht im `SpeechResult`-Body) den leeren Text eines stillen Turns.
- `friseur-voll.mjs` — `expectBooking: true` weg, `booked_with_nongeneric_title` → `message_taken` + `no_transliterated_umlauts_de`; Persona-Prompt-Schlusssatz „…bestätige eine finale Buchung…" → „…bestätige eine getroffene Terminabsprache…" (C2, „Buchung" ist obsolet).
- `termin-duenn.mjs`, `partner-knapp.mjs`, `inbound-nachricht.mjs`, `kauderwelsch-erstantwort.mjs` — `expectBooking: false` entfernt, `no_transliterated_umlauts_de` an die `checks`-Liste angehängt (`stt-noise.mjs` erbt beides über den Spread von `friseur-voll`, keine eigene Änderung nötig).
- `scenarios/index.mjs` — vier neue Imports/Registry-Einträge.

**Bewusst NICHT geändert:** `runner.mjs:extractStoreSnapshot.calendarNewEvents` bleibt (laufende Evidenz für E1/P1b, dass aus einem Gespräch kein Kalendereintrag entsteht — Rename/Löschen wäre Report-Schema-Änderung ohne Nutzen). Keine neue Config-Env-Var. `src/**` vollständig unberührt.

**Tests:** neue Datei `test/cq-p4-bench-hardening.test.js`, netzfrei/spawn-frei, 12 Tests T-P4-1..12 (Umlaut-Check-Fail/Pass/False-Positive-Freiheit/Sprachfilter, F-1-Regression auf Eröffnungs-Sample, F-2-Faltung beidseitig, F-4-Entkopplung, Hangup-Schwelle, Registry-Integrität über alle 10 Szenarien, P1b-Konsistenz-Pin gegen `expectBooking`-Reste, neue Szenarien registriert, F-3 silentTurns ohne Netzaufruf, `personaPromptFor`-Switch).

**Deterministisch prüfbares Ergebnis (Plan §4):** isolierter Testlauf, Gesamtsuite, Struktur-Trockenlauf per Modul-Import (kein Netz, kein API-Call) mit erwarteter Ausgabe „10 Szenario-IDs, expectBooking-Reste: []", Dead-Path-Grep auf `booked_with_nongeneric_title|GENERIC_TITLE|expectBooking` → keine Treffer. Ausdrücklich NICHT ausgeführt: jedes `npm run convo-bench run …`.

---

## 2. Impl-Zusammenfassung

- **HEAD:** `76b1ba1` auf `phase/cq-p4-bench`.
- **`node --check`:** grün auf allen 14 neuen/geänderten Dateien.
- **Tests:** neue Datei isoliert 12/12 grün; Gesamtsuite 2479/0 (zweiter sauberer Lauf; erster Lauf hatte 1 unabhängigen Flake, siehe Deviations).
- **Erstellte Dateien:**
  - `scripts/convo-bench/scenarios/hold-warteschleife.mjs`
  - `scripts/convo-bench/scenarios/personenwechsel.mjs`
  - `scripts/convo-bench/scenarios/spaeter-nochmal.mjs`
  - `scripts/convo-bench/scenarios/unerfuellbare-recherche.mjs`
  - `test/cq-p4-bench-hardening.test.js`
- **Bearbeitete Dateien:**
  - `scripts/convo-bench/checks.mjs`
  - `scripts/convo-bench/persona.mjs`
  - `scripts/convo-bench/runner.mjs`
  - `scripts/convo-bench/scenarios/index.mjs`
  - `scripts/convo-bench/scenarios/friseur-voll.mjs`
  - `scripts/convo-bench/scenarios/termin-duenn.mjs`
  - `scripts/convo-bench/scenarios/partner-knapp.mjs`
  - `scripts/convo-bench/scenarios/inbound-nachricht.mjs`
  - `scripts/convo-bench/scenarios/kauderwelsch-erstantwort.mjs`
- **Smoke:** Server via `node src/server.js` auf freiem Port (3999), `SKIP_TWILIO_SIGNATURE_CHECK=true`, Dummy-Twilio-Env + geseedeter Owner-Tenant/Nummer. `GET /healthz` → 200. `POST /voice/incoming` (von P4 unberührtes Bestandsverhalten) → korrektes TeXML mit Gather/Say. Bestätigt: P4 beeinflusst den Boot-/Voice-Pfad nicht. Zusätzlich der planvorgeschriebene Struktur-Trockenlauf exakt mit erwarteter Ausgabe (10 Szenario-IDs, `expectBooking`-Reste: []).

### Deviations vom Plan

1. **`tasks/cq-p4-report.md` wurde im Impl-Schritt NICHT angelegt** — die Harness-Instruktion für den Impl-Subagenten verbietet das Schreiben von Report-/Analyse-`.md`-Dateien ("Return findings directly as your final assistant message"). Alle vom Plan geforderten Report-Inhalte standen stattdessen in der Summary des Impl-Outputs. Diese Datei hier holt das nach.
2. Die im Plan unter §1.2 als Codeblock notierte „Bekannte Grenze"-Notiz zu `personenwechsel.mjs` (dass `mirrorTranscript` für die zweite Persona auch die Turns der ersten als eigene `assistant`-Nachrichten spiegelt) wurde nicht in den Code geschrieben — der Plan kennzeichnet sie selbst als „(in den Report)". Siehe §3 unten (Bekannte Grenzen).
3. `SILENT_TURN_TRANSCRIPT_TEXT`/`calleeTranscriptText` in `runner.mjs` wurden direkt vor ihrer ersten Verwendung platziert (nach `recordAgentSay`), nicht bei den weiter oben stehenden Konstanten (`CALL_SID` etc.) — inhaltlich identisch zum Plan, nur andere Zeilenposition (G10 vertikale Nähe, konsistent mit dem Bestandsmuster der Datei).
4. Ein Voll-Lauf von `npm test` zeigte einmalig 1 Fail in `test/telnyx-p9-flag-matrix.test.js` (JSON-Parse-Fehler auf einen unerwarteten „auth required"-Body, offensichtlich eine Netz-/Proxy-Anomalie dieses Laufs). Isoliert (`node --test test/telnyx-p9-flag-matrix.test.js`) UND ein zweiter Voll-Lauf waren beide grün (2479/0) — die Datei berührt `convo-bench` nicht (Grep bestätigt 0 Treffer). Gemäß FLAKE-PROTOKOLL als vorbestehenden Flake gewertet, kein Blocker.

---

## 3. Bekannte Grenzen (aus dem Plan nachgezogen)

- **`personenwechsel.mjs`:** Die gespiegelte Historie (`mirrorTranscript`) enthält für die zweite Persona auch die Turns der ersten als eigene `assistant`-Nachrichten. Der Switch-Prompt weist die zweite Persona explizit an, die Vorgeschichte nicht zu kennen; ein sauberer Historien-Schnitt wäre eine eigene Änderung an der Persona-Schicht und war hier nicht nötig.
- **Umlaut-Check auf Bestandsszenarien:** Echot das Modell einen transliterierten `goal`-Text der sechs Bestandsszenarien wörtlich, feuert der Umlaut-Check ohne echten Modell-Defekt. Da Baseline und P5-Lauf denselben Fixture-Text sehen, bleibt das **Delta** interpretierbar; die Absolutzahl ist es nur eingeschränkt. Bewusst nicht durch Umschreiben der sechs Bestandsfixtures behoben (Blast-Radius, A/B-Vergleichbarkeit mit früheren Reports).
- **`calendarNewEvents` bewusst behalten** (kein Code-Konsumenten mehr nach Wegfall des Buchungs-Checks, aber laufende Report-Evidenz für E1/P1b — kein Kalendereintrag aus einem Gespräch).
- **Drei statt ein neuer Check:** Der Plan nennt namentlich nur „Check 12" (Umlaut), formuliert aber für die vier Szenarien als Erfolgskriterium „kein `end_call` vor Klärung, kein erfundenes Versprechen, `take_message` statt Halluzination" — und macht die Abnahme an einer deterministisch berechenbaren Pass-Rate ≤ 40 % fest. Ohne `no_early_agent_hangup` und `no_invented_promise` wären zwei der drei genannten Kriterien nur als `judgeFocus`-Prosa vorhanden und damit nicht abnehmbar.

---

## 4. Safety-Urteil

**Verdikt: APPROVED.** Vollständiger Prüfbericht:

- `git diff master HEAD --name-only | grep -c '^src/'` = 0 — der Diff fasst keinen Produktivcode an. 14 Dateien, davon 13 unter `scripts/convo-bench/` und eine neue Testdatei.
- Safety-Gates (Number-Gate-Kette, Budget, Max-Dauer, Signaturprüfung), der Offenlegungssatz in `src/claude.js`/`src/bridge.js` sowie Auth-Pfade sind per Konstruktion unberührt.
- Kein neuer Endpunkt, keine neue npm-Dependency (`package.json`/`package-lock.json` bytegleich mit master), keine `.env.example`-/`render.yaml`-Änderung, keine Secrets im Diff (Grep auf `sk-`/`api_key`/`token`/`password`/Rufnummern leer), kein Audio-Pfad.
- `checkDisclosureFirst` unverändert; alle vier neuen Outbound-Szenarien deklarieren `disclosure_first`.
- Spec-Abgleich PLAN-CONVERSATION-QUALITY-V2 §P4: (a) Pflicht-Vorarbeit erfüllt (Umstellung `friseur-voll` auf `message_taken`, toter Buchungspfad weg, `expectBooking` überall getilgt, per Test T-P4-9 gepinnt); (b) Check 12 korrekt auf `freeAgentTexts` beschränkt; (c) vier geforderte Szenarien existieren, registriert, plausible Schwellen (`hold-warteschleife`: `silentTurns [1,2]` bleiben nachweislich unter der Hangup-Stufe von `no-speech-escalation.js`, die erst ab Streak 3 auflegt); (d) Suite grün.
- Unabhängiger Testlauf in einem frischen Worktree auf `76b1ba1`: 2479/2479 grün, Exit 0, 117.4s. Neue Datei isoliert 12/12 in 65ms, netzfrei. Adversariale Mutationstests bestätigen die Härte zweier Tests: (1) `LLM_FREE_OPENING_SAMPLE_COUNT` 1→0 macht T-P4-2 rot; (2) Richtungs-Gate in `checkMessageTaken` zurückgebaut macht T-P4-6 rot.

**Concerns (keine Blocker, keine absolute Regel berührt):**

1. Der Kommentar über `DE_TRANSLITERATION_STEMS` behauptet, seit P1 trügen alle gesprochenen DE-Locale-Strings echte Umlaute (gepinnt in `test/de-umlaut-orthography.test.js`). Das stimmt nicht vollständig: `DEFAULT_GREETING` (`src/store/defaults.js`, `LOCALES.de.greetingDefault`) enthält weiterhin „Ich kann eine Nachricht fuer {owner} aufnehmen" und steht nicht in `SPOKEN_DE_FIELDS` des genannten Tests. Heute kein Fehlalarm, weil die Inbound-Begrüßung `texmlSamples[0]` ist und von `freeAgentTexts` übersprungen wird — die vom Check behauptete Invariante ist aber ungepinnte P1-Restschuld, nicht P4-Verschulden.
2. `hold-warteschleife.mjs` und `personenwechsel.mjs` deklarieren weder `no_invented_promise` noch `message_taken` — inhaltlich vertretbar (Gegenseite antwortet am Ende sachlich, eine Nachricht ist nicht fällig), aber anders als `spaeter-nochmal.mjs` (das seinen Verzicht auf `no_early_agent_hangup` ausdrücklich begründet) ist die Auslassung in diesen beiden Dateien nicht im Code dokumentiert.
3. Verhaltensänderung an einem Bestandscheck: `no_redundant_ask_about_briefed_info` läuft jetzt über `phraseDenylistResult` mit Umlaut-Faltung und ist damit strikt schärfer als auf master. Bewusst und für den P5-A/B nötig, unschädlich weil die Baseline erst nach P4 erhoben wird — aber Bench-Zahlen von vor P4 sind für diesen Check nicht mehr vergleichbar.
4. Kommentar-Konvention (Deutsch ohne Umlaute): `spaeter-nochmal.mjs:36` enthält „spaeter" trifft damit AUCH „später" — Umlaut im Kommentartext. Absichtlich (der Kommentar erklärt genau die Faltung beider Schreibweisen), formal aber eine Abweichung von der Repo-Konvention.
5. Auf dem Branch lag zum Zeitpunkt der Safety-Prüfung kein Phasen-Report (dieser hier schließt die Lücke).

---

## 5. Clean-Code-Audit

**Verdikt: PASS** — keine S1/S2-Befunde, kein Blocker.

- **S1:** keine.
- **S2:** keine.
- **S3 (Beobachtungen, kein Fix nötig):**
  - Die vier neuen adversarialen Szenarien deklarieren `no_transliterated_umlauts_de` nicht (im Gegensatz zu den vier angepassten Bestandsszenarien) — Coverage der Umlaut-Prüfung ist damit szenario-asymmetrisch. Kein Fix nötig: der Plan definiert für diese vier Szenarien bewusst andere Erfolgskriterien (kein early hangup, kein erfundenes Versprechen, `message_taken`); Scope ist bewusst getrennt.
  - `checkNoTransliteratedUmlautsDe` trägt (anders als `phraseDenylistResult`) keinen „best-effort/kein Hard-Gate"-Kommentar. Kein Fix nötig: bewusst ein echter Hard-Check (T-P4-1 pinnt das), analog zu `disclosure_first`/`no_raw_iso_date_spoken`.
- **S4:** keine.

**Positiv hervorgehoben:** G5 (Duplizierung) wird durch den Diff aktiv reduziert (zwei neue geteilte Mechaniken `phraseDenylistResult` und `agentHangupDisciplineResult`, beide mit Begründung im Kommentar). Toter Code vollständig entfernt (`checkBookedWithNongenericTitle`, `GENERIC_TITLE`, `expectBooking` in 5 Szenarien), konsistent mit der P1b-Buchungsentfernung, per Test T-P4-9 gepinnt. Kommentare aktuell (kein C2-Fund), kein auskommentierter Code, keine TODO/FIXME/eslint-disable/Skip-Marker. Magic Numbers benannt. Grenzfälle getestet (n/a-Pass für Nicht-Deutsch, keine False Positives auf legitimen Buchstabenfolgen — zusätzlich manuell mit ~25 weiteren Wörtern wie Friseur/Ingenieur/Chauffeur verifiziert, keine Treffer). Implementierung deckt sich exakt mit dem Agenten-Scope aus dem Plan, keine Scope-Überschreitung.

**Top-Todos:** keine Pflicht-Todos, Phase ist mergefähig. Optional (nicht blockierend): `no_transliterated_umlauts_de` perspektivisch auch in den vier neuen P4-Szenarien deklarieren, falls spätere Baseline-Läufe Orthografie-Regressionen dort ebenfalls messen sollen.

---

## 6. Fix-Runden

Keine. Sowohl Safety-Review als auch Clean-Code-Audit kamen jeweils direkt (ohne Nachbesserungsrunde) auf ein bestehendes PASS/APPROVED — alle gemeldeten Punkte sind Concerns/S3-Beobachtungen, keine S1/S2-Blocker oder Safety-Blocker. Es waren keine Fix-Zyklen nötig.

---

## 7. Offene Owner-/Deploy-Auflagen (NICHT-AGENTEN-ARBEIT)

Der Agenten-Anteil dieser Phase ist ausschließlich Code + grüne Suite. Es wurde **kein** `npm run convo-bench run` gestartet, **keine** Baseline erhoben, geschätzt oder aus alten Reports übernommen — auf dem Branch liegen keine Bench-Artefakte, keine Baseline-Zahlen.

**A — Baseline-Lauf (Owner, echte API-Kosten).** Zweimal fällig: jetzt für P4, erneut nach P5.

```bash
export ANTHROPIC_API_KEY=…
npm run convo-bench -- run --all --repeat 5 --label baseline-p4 \
  --out data/convo-bench/baseline-p4
```

Ablage: `data/convo-bench/baseline-p4/<scenario>-r<n>.json` + `summary.json` (`data/` ist gitignored — Report separat sichern). Kosten-Schätzung steht als `cost_estimate_usd` in jedem Report und als Summe unter der stdout-Tabelle. Vergleich später: `npm run convo-bench -- compare data/convo-bench/baseline-p4 data/convo-bench/<p5-dir>`.

**B — Pass-Rate-Definition für das P5-Gate.** Ein Repeat gilt als *bestanden*, wenn **alle** seine Checks passen. Pass-Rate eines Szenarios = bestandene Repeats / `n`. Bei `n = 5` heißt „≤ 40 %" also **≤ 2 von 5**. Aus `summary.json` berechenbar:

```bash
node -e "const s=require('./data/convo-bench/baseline-p4/summary.json');const m={};
for(const r of s){(m[r.scenario]??=[]).push(r.checks_passed===r.checks_total)};
for(const[k,v]of Object.entries(m))console.log(k,(100*v.filter(Boolean).length/v.length).toFixed(0)+'%')"
```

**C — Gate-Auswertung, ohne nachzuschärfen.** Erreicht eines der vier neuen Szenarien schon heute >40 % Pass-Rate, wird es „deckt der Ist-Prompt bereits ab" dokumentiert und aus dem P5-Gate genommen — nicht verschärft. Kandidat Nr. 1 laut Code-Analyse ist `hold-warteschleife` (siehe Zusatzbefund oben: bei zwei stillen Turns antwortet der Server deterministisch, nicht das Modell). **Folgekopplung:** fallen dadurch mehr als zwei der vier aus dem Gate, entfällt P5-Kriterium (c) ersatzlos; (a) und (b) bleiben bindend. Der Wegfall gehört ausdrücklich in den P5-Report.

**D — Was der Bench strukturell nicht kann.** Kein echtes STT (Personatext geht direkt als `SpeechResult` an `/voice/*`), kein TTS, keine Latenz, keine Telefon-Akustik, kein Barge-in. Der Aussprache-Gewinn aus P1/P5 ist mit dem Bench **nicht** verifizierbar — dafür bleibt der Probeanruf. `heardChars` ist im Bench nur die Länge des Personatexts und gehört **nicht** in den Baseline-Report (nur in Prod interpretierbar, P9).

**E — Kein Deploy.** P4 fasst `src/` nicht an; es gibt nichts zu deployen. Kein `git push` (weder `origin` noch `upstream`), kein `git stash`, kein `git add -A` wurde ausgeführt — die Commits enthalten ausschließlich `scripts/convo-bench/**` und `test/cq-p4-bench-hardening.test.js`.

**Restrisiken (aus dem Safety-Review, zur Owner-Kenntnisnahme, kein Blocker):**

- `DEFAULT_GREETING` in `src/store/defaults.js` (`LOCALES.de.greetingDefault`) enthält noch transliterierte Umlaute und ist nicht in `SPOKEN_DE_FIELDS` von `test/de-umlaut-orthography.test.js` gepinnt — heute folgenlos (Inbound-Begrüßung ist `texmlSamples[0]`, wird vom Umlaut-Check übersprungen), aber ungepinnte P1-Restschuld, die bei künftigen Refactors der Begrüßung unbemerkt umlaut-fehlerhaft bleiben könnte.
- `no_redundant_ask_about_briefed_info` ist ab diesem Commit strikt schärfer als auf master (Umlaut-Faltung). Etwaige alte Bench-Zahlen für diesen Check (vor P4) sind nicht mehr direkt vergleichbar mit Zahlen ab der P4-Baseline.
- `hold-warteschleife.mjs`/`personenwechsel.mjs` verzichten undokumentiert auf `no_invented_promise`/`message_taken` (inhaltlich vertretbar, siehe Safety-Concern 2) — falls spätere Baseline-Läufe dort unerwartete Lücken zeigen, zuerst prüfen, ob die fehlenden Checks der Grund sind.
