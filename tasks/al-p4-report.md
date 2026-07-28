# Phase AL-P4 — Seiteneffekt-Werkzeuge brechen den Tool-Loop

**Gate:** PASS
**finalBranch:** `phase/al-p4-tool-loop`
**Basis:** `master` = `320c003` (AL-P1 gemergt, `dd0c0dc`)
**headCommit:** `342d900dbf914cec34c016f3266db37ff053de28`

---

## 1. Plan (gekuerzt)

**Ziel:** Ein Roundtrip, der ausschliesslich Seiteneffekt-Werkzeuge anfordert (heute: `end_call`, `take_message` — deren `tool_result` traegt keine Information, auf die das Modell noch reagieren muesste) und bereits Text geliefert hat, soll den Tool-Loop in `agentTurn` (`src/claude.js`) sofort beenden statt eine weitere, unnoetige `llm.complete`-Runde zu erzwingen.

**Zwei Hebel:**
- **Hebel A — Klassifikation + erweiterter Loop-Ausstieg:** neue Namensliste `SIDE_EFFECT_ONLY_TOOL_NAMES` + reine Praedikatsfunktion `isSideEffectOnlyTool(name)`. Abbruchbedingung wird von `if ((endCall || suppressedEndCall) && speech) break;` auf `if (speech && (endCall || suppressedEndCall || sideEffectOnlyRound)) break;` **erweitert, nie verengt** (`break_neu ⊇ break_alt`). Der `end_call`-Arm bleibt bewusst eigenstaendig stehen, damit ein Mischfall (`end_call` neben einem unbekannten/halluzinierten Tool) weiterhin sofort auflegt statt eine Runde nachzulegen. Unbekannte Toolnamen gelten fail-safe als *informationsliefernd* → Loop laeuft wie im Bestand weiter.
- **Hebel B — Tool-Description:** die `take_message`-Beschreibung in DE/EN/FR wird umformuliert (ersetzt, nicht ergaenzt), damit das Modell den Sprechsatz verlaesslich in **derselben** Antwort wie den Werkzeugaufruf liefert.

**Explizit ausgeschlossen:** die `4`-Runden-Obergrenze, `metrics.logTurn`, der Telnyx-Shim, `bridge.js`, die `end_call`-Description, `config.js`, jede neue Env-Variable/Dependency.

**Bestandstest-Absicherung:** acht benannte Bestandsdateien (u.a. `turn-fallback-locale`, `llm-message-chain-language`, `g326-turn-shortcut-empty-guard`, `afix-p4-end-call-discipline`, `cq-p5-prompt-redesign`, `p11-agent-language-contract`) wurden im Plan einzeln durchgerechnet und bleiben laut Konstruktion byte-identisch gruen, da bei leerem `speech` nichts sich aendert.

**Neue Datei:** `test/al-p4-side-effect-tool-loop.test.js`, 9 Tests (AL-P4-1..9), lokaler `node:http`-Anthropic-Mock nach dem Muster von `llm-message-chain-language.test.js` — kein Server-Spawn, kein Netz. Deckt ab: frueher Abbruch bei Text+Seiteneffekt (1 Roundtrip statt 2), Seiteneffekt persistiert trotz frueherem Abbruch, Bestandsverhalten bei fehlendem Text, `end_call`+Text bleibt 1 Roundtrip, `end_call` neben unklassifiziertem Tool bricht weiterhin ab (die "nur erweitern"-Invariante), unklassifiziertes Tool+Text bricht NICHT ab, Klassifikator-Unit-Test, Canary-Test (alle heutigen `toolDefs` sind Seiteneffekt-Werkzeuge — bricht bewusst bei `look_up`/`get_consult`), Description-Klausel je Sprache.

**Pre-Mortem (Kernpunkte):** Kosten sinken (weniger Roundtrips), keine Gate-/Auth-/Disclosure-Beruehrung; groesstes Restrisiko ist Modellgehorsam bei Hebel B, abgefangen durch Fallback-auf-Bestandsverhalten bei Ungehorsam + Checklisten-Gegenprobe (`speechEmpty` darf nicht steigen). Rueckbau: zwei Commits, kein Datenmigrations-Pfad, kein Flag noetig.

---

## 2. Implementierungs-Zusammenfassung

- `src/claude.js`: neue Konstante `SIDE_EFFECT_ONLY_TOOL_NAMES` (Set aus `END_CALL_TOOL_NAME`, `TAKE_MESSAGE_TOOL_NAME`), neue exportierte reine Funktion `isSideEffectOnlyTool(name)`; Loop-Ausstieg am Ende der `for`-Schleife in `agentTurn` erweitert (`sideEffectOnlyRound = toolUses.every(...)`, dann `if (speech && (endCall || suppressedEndCall || sideEffectOnlyRound)) break;`).
- `src/i18n/prompts/{de,en,fr}.js`: `tools.takeMessageDescription` — Satz ersetzt (nicht ergaenzt), verlangt jetzt explizit den Sprechsatz in derselben Antwort/demselben Zug/derselben réponse. DE ohne Transliteration (echte Umlaute), FR mit Akzenten.
- `tasks/al-testcall-checklist.md`: zwei neue Abnahme-Zeilen fuer AL-P4 (Median-Roundtrips-Ziel + `speechEmpty`-Gegenprobe), Stand "offen".
- Neue Testdatei: `test/al-p4-side-effect-tool-loop.test.js`, 9 Tests.

**Ergebnis:** `node --check` auf allen 4 geaenderten `.js`-Dateien gruen. `npm test`: 3359/3359 gruen (exakt der geplante Stand 3350+9). Alle 8 im Plan genannten Bestandstest-Dateien liefen zusaetzlich isoliert gruen. Server-Smoke (Boot + `/healthz`) gruen. Commit `342d900` auf `phase/al-p4-tool-loop`, working tree clean, kein Push nach upstream/origin.

### Deviations
1. Lokale worktree-Kopie von `master` hatte sich zwischenzeitlich dokumentationsonly weiterbewegt (`57adf4a`), enthielt `320c003` aber als Ancestor. `checkout -b` wurde exakt gegen `320c003` ausgefuehrt — Basis stimmt exakt mit dem Plan ueberein.
2. `npx eslint` konnte lokal nicht laufen (fehlende Dev-Dependency `@eslint/js`, vorbestehende Umgebungsluecke, nicht durch diese Phase verursacht). `node --check` lief gruen; neue Testdatei folgt demselben Stil wie eine bestehende, lintsaubere Datei.

---

## 3. Safety-Urteil

**Verdict: APPROVED**

- `testsPassIndependently`: true (eigener Lauf im frischen Worktree, 3359/0 gruen; `test:gates` 126/3 — dieselben 3 Fehlschlaege wie auf der detachten `master`-Baseline, also null neue rote Tests)
- `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`: alle true
- **Blockers:** keine
- **Concerns (nicht-blockierend):**
  1. `speech` akkumuliert ueber Roundtrips — ein Seiteneffekt-Roundtrip ohne eigenen Text kann den Loop beenden, wenn ein *frueherer* Roundtrip Text lieferte. Spec-konform und sicher (kein verfruehtes Auflegen), aber die einzige nicht explizit gepinnte Kante (AL-P4-3 deckt nur "speech leer von Anfang an" ab).
  2. Neue Testdatei pinnt `STORE_BACKEND` nicht explizit (gleiches Muster wie Bestandstest) — mit lokalem `.env` `STORE_BACKEND=pg` wuerde etwas anderes getestet.
  3. Prettier meldet 3 kosmetische Zeilenbreiten-Nits in der neuen Testdatei; kein CI-Gate.
  4. Kein Feature-Flag — laut Plan bewusst so (Rueckbau = Zeile zuruecksetzen); "flag-off byte-identisch"-Kriterium daher nicht anwendbar, Aequivalent (leeres `speech` = Bestandsverhalten) haelt und ist gepinnt.

Diff-Oberflaeche gepruefte: `git diff master HEAD` gegen `server.js`/`config.js`/`telephony`/`billing`/`auth.js`/`web-auth.js`/`middleware.js` ist leer. Kein neuer Endpunkt. `toolUses` an der Break-Stelle beweisbar nicht leer (vorheriger `if (!toolUses.length) break;`), `.every()` kann nicht vakuum-wahr werden. `execTool` laeuft vor dem `break`, Seiteneffekt persistiert nachweislich (AL-P4-2).

---

## 4. Clean-Code-Audit

**Verdict: PASS** (kein S1/S2-Befund, blocker: false)

- **s1:** keine
- **s2:** keine
- **s3:**
  - G28 (encapsulate conditional) — `src/claude.js:~608`: die zusammengesetzte Bedingung `if (speech && (endCall || suppressedEndCall || sideEffectOnlyRound)) break;` bleibt teilweise inline (nur `sideEffectOnlyRound` ist benannt). Optional in eine benannte Variable wie `shouldEndTurn` extrahieren — rein stilistisch, keine Pflicht.
- **s4:** keine

**Begruendung:** Diff klein und scharf geschnitten (1 neue Konstante, 1 reine Klassifikatorfunktion, 1 erweiterte Abbruchbedingung in `src/claude.js`; konsistente i18n-Nachzuege DE/EN/FR; Checklisten-Eintrag; 175 Zeilen neuer Test). Diff gegen korrekten Merge-Base geprueft (Vorsicht dokumentiert: `origin/master` lag vor AL-P1 und war NICHT der richtige Vergleichspunkt). 9 neue Tests + 11 angrenzende Turn-/Prompt-/Telnyx-Testdateien (63/63) isoliert gruen. `node --check src/claude.js` sauber.

**Positiv hervorgehoben:** Fail-safe-Richtung (unbekannte Toolnamen = informationsliefernd, Loop laeuft weiter), "nur erweitern, nie verengen"-Invariante selbst getestet (AL-P4-5), `isSideEffectOnlyTool` rein/exportiert (N7), Namensliste ist EINE Quelle (keine Kopie an zweiter Stelle, wiederverwendet bestehende Konstanten), bewusst kein Feld an `toolDefs`-Objekten (dieselben Objekte gehen 1:1 an Anthropic UND `bridge.js`/`realtimeTools`), Canary-Test AL-P4-8 erzwingt bewusste Einordnung kuenftiger Werkzeuge statt stillschweigendem Durchfallen.

**Offene Top-Todos (nicht blockierend):**
1. Kein Code-Blocker — Merge aus Clean-Code-Sicht unbedenklich.
2. Optional/S3: zusammengesetzte `break`-Bedingung in eine benannte Variable (`shouldEndTurn`) ziehen — reine Politur.
3. Prozess (nicht Code): die neuen AL-P4-Abnahmekriterien in `tasks/al-testcall-checklist.md` stehen noch auf "offen" — vor Abschluss der Phase per Prod-`turn_ok` oder Bench tatsaechlich messen, nicht nur den Code mergen.

---

## 5. Fix-Runden

Keine — Gate wurde im ersten Durchlauf mit PASS erreicht (Safety: APPROVED ohne Blocker, Clean-Code: PASS ohne S1/S2). Der FIXES-Abschnitt der Quelle ist leer.
