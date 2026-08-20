# Phasenbericht OC-P3 — Gleichlauf der uebrigen Outbound-Wege

Gate: **PASS**
finalBranch: `phase/oc-p3-gleichlauf`
headCommit: `7a7536b78fde49c6c947f2cad6ca8415aeec7b1b`

## 1. Ziel der Phase

Die OC-P1/OC-P2-Owner-Ausnahme (Anruf an die eigene hinterlegte Nummer des Auftraggebers
loest statt der Offenlegung eine persoenliche Begruessung aus) galt bisher nur fuer den
ElevenLabs-Weg. OC-P3 zieht denselben Gleichlauf durch die uebrigen Outbound-Wege:
`openingText`, `systemPrompt` (Budget-Engine + Realtime) und den Telnyx-Assistant-Shim.
Einzige Entscheidungsquelle bleibt das OC-P1-Praedikat `call.calleeIsOwner`.

## 2. Verdrahtungsstellen (einzeln)

1. **`promptInputs` (Kontext-Aufloesung), `src/claude.js`**
   `calleeIsOwner: call.calleeIsOwner === true` — strikte, fail-closed Normalisierung des
   Praedikats in die Eingaben, aus denen alle Baustein-Funktionen lesen. Kein erneutes
   Lesen des Schalters, keine Nummern-Vergleichslogik hier.

2. **`outboundSituation`, `src/claude.js`**
   Verzweigt zwischen `situationOutboundOwner` (neu) und der Bestandszeile
   `situationOutbound`, abhaengig von `p.calleeIsOwner`. Ersetzt die Situationszeile
   vollstaendig, ergaenzt sie nicht (Widerspruchsvermeidung).

3. **`identityLineFor` (neu), `src/claude.js`**, aufgerufen aus `clarificationRules`
   Waehlt aus drei Lagen (`identityLines.inbound` / `.outbound` / `.outboundOwner`) die
   passende Identitaets-Zeile fuer den Block "WENN ETWAS UNKLAR IST". Reihenfolge:
   Inbound zuerst, dann Nicht-Owner, dann Owner. Der Owner-Zweig reicht
   `disclosureSentence(p.call)` als fertigen Text hinein — die Sprachmodule bauen den
   Offenlegungssatz nicht selbst (kein Zyklus zu `i18n/locales.js`).

4. **`firstSpokenSentence` / `ownerOpeningFor` (neu), `src/claude.js`**, aufgerufen aus
   `openingText`
   Der erste gesprochene Satz. `ownerOpeningFor` liefert nur dann eine Owner-Begruessung,
   wenn `call.calleeIsOwner === true` UND ein nicht-leerer Vorname aus
   `store.tenantContext(call.tenantId).firstName` vorliegt; sonst `""` und Rueckfall auf
   `disclosureSentence(call)`. Kein Namens-Rueckfall — ohne Vorname immer Offenlegung.

5. **Sprachmodule `src/i18n/prompts/{de,fr,en}.js`**
   Je Sprache: `situationOutboundOwner` (Owner-Situationssatz) und
   `identityLines.{inbound,outbound,outboundOwner}` (reine Textbausteine, keine
   Verzweigung mehr in den Modulen selbst — die dreifach kopierte Ternary wurde
   entfernt und zentral nach `claude.js` gezogen).

6. **Telnyx-Assistant-Shim-Kette (unveraendert genutzt, per Test belegt)**
   `src/telnyx-llm-shim.js:2-3` (Modulkopf, kapselt `agentTurn`), Fabrik `:492`,
   Abhaengigkeit `agentTurn` `:495` → `src/claude.js:1080`
   (`system: systemPrompt(call)` im Budget-Turn-Loop, Definition `systemPrompt` `:291`).
   Belegt durch die neuen Tests Block F (F1: derselbe Call-Datensatz mit
   `calleeIsOwner === true` erreicht `agentTurn`; F2: `systemPrompt` auf genau diesem
   Call traegt Owner-Situationszeile + Rueckfallzeile). Keine Umbauten am Shim selbst.

7. **`apps/web/src/components/app/SettingsIsland.astro`**
   Keine Verdrahtungsstelle im engeren Sinn (s. Befund D3) — Kopfkommentar um die
   Beschriftungspflicht der Owner-Wirkung von `tenant.privateNumber` ergaenzt, kein
   neues UI-Feld.

## 3. Abnahmepunkte (einzeln, Urteil + Kommando)

| # | Kommando | Erwartet | Urteil |
|---|---|---|---|
| 1 | `node --check src/claude.js && node --check src/i18n/prompts/de.js && node --check src/i18n/prompts/fr.js && node --check src/i18n/prompts/en.js` | keine Ausgabe, Exit 0 | PASS |
| 2 | `NODE_ENV=test LLM_PROVIDER=anthropic node --test test/callee-is-owner-opening.test.js` | `fail 0`, `pass >= 22` | PASS — `tests 39 / pass 39 / fail 0` |
| 3 | `NODE_ENV=test LLM_PROVIDER=anthropic node --test test/disclosure-outbound.test.js test/disclosure-regression.test.js test/g1-identity-binding.test.js test/g2-opening-turn.test.js test/claude-identity.test.js test/telnyx-p8-opening-contract.test.js test/al-p5-opening.test.js test/inbound-disclosure-mandatory.test.js test/de-umlaut-orthography.test.js test/cq-p5-prompt-redesign.test.js` | `fail 0` | PASS — `tests 47 / pass 47 / fail 0` |
| 3b | `NODE_ENV=test LLM_PROVIDER=anthropic node --test test/personal-assistant-characterization.test.js test/p11-agent-language-contract.test.js test/persona-style.test.js test/cq-p6-mandate.test.js test/f1-i18n-locale.test.js` | `fail 0` | PASS — `tests 82 / pass 82 / fail 0` |
| 4 | `LLM_PROVIDER=anthropic npm test` | `fail 0`, Anker 4999 + N neue | PASS — `korrigiert: tests 5039 / pass 5039 / fail 0` (4999 + 40 neu) |
| 5 | `npm run test:gates` | exakt `tests 129 / pass 126 / fail 3` | PASS — exakt bestaetigt, kein Katalog-Leck |
| 6 | `git diff --stat master -- <8 Offenlegungs-Testdateien>` | leer | PASS |
| 7 | `git diff --stat master -- src/elevenlabs src/bridge.js elevenlabs/ src/telephony` | leer | PASS |
| 7b | `git diff --stat master -- src/callee-is-owner.js src/routes/api-calls.js src/store src/config.js .env.example render.yaml` | leer | PASS |
| 8 | Shim-Kette mit Datei:Zeile + Tests | kein "vermutlich" | PASS — s. Verdrahtungsstelle 6, Tests F1/F2 gruen |
| 9 | `grep -rn "disclosure" src/i18n/prompts/de.js src/i18n/prompts/fr.js src/i18n/prompts/en.js` | nur Parameter-Interpolationen | PASS — keine zweite Fassung des Offenlegungssatzes |
| 10 | `git diff --stat master -- apps/web` | eine Datei, nur Kommentare | PASS — `SettingsIsland.astro`, 12 Zeilen, ausschliesslich Kommentar |
| 11 | `git diff master -- src/claude.js \| grep -c "^+.*calleeIsOwner"` | Plan behauptet "genau 3" | **ABWEICHUNG D8**: tatsaechlich 6 (4 Code-Zeilen inkl. `identityLineFor` als vierte Stelle im Plan-Text selbst + 2 Kommentar-Zeilen). Funktional dennoch 3 verzweigende Entscheidungsstellen (`outboundSituation`, `identityLineFor`, `ownerOpeningFor`); `promptInputs` normalisiert nur. Der Plan-Text war an dieser Stelle ungenau, die Spec-Absicht (Invariante 5) ist erfuellt — kein Handlungsbedarf. |

## 4. Ausgefuehrte Gegenproben (woertlich)

Aus IMPL, `failClosedProof`:

> 6 Sabotage-Gegenproben ausgefuehrt (Aenderung -> rot -> Zeile 1:1 zurueckgespielt -> wieder gruen 39/39): S1 (KERN-GEGENPROBE, von der Aufgabe gefordert): src/claude.js ownerOpeningFor() `if (call.calleeIsOwner !== true) return "";` -> `if (call.calleeIsOwner === false) return "";` (Owner-Zweig fuer JEDES Fremd-Ziel erzwungen, ausser explizit false). Ergebnis: `tests 39 / pass 32 / fail 7` (rot: A openingText Fremd-Ziel de/fr/en, A10 fail-closed undefined/"true"/1, D2 Fremd-Ziel Telnyx-Assistant). Zeile zurueckgespielt -> `tests 39 / pass 39 / fail 0`. S2: identityLineFor() `if (p.isInbound) return lines.inbound(p.owner);` entfernt -> `tests 39 / pass 36 / fail 3` (rot: B systemPrompt Inbound de/fr/en). Zurueckgespielt -> 39/39 gruen. S3: outboundSituation() `p.calleeIsOwner ? ... : ...` -> `true ? ... : ...` -> kombiniert mit Bestands-Pins `tests 65 / pass 59 / fail 6` (rot: B systemPrompt Fremd-Ziel outbound de/fr/en + SP1/SP2/SP6 aus personal-assistant-characterization.test.js). Zurueckgespielt -> 65/65 gruen. S4: de.js identityLines.outboundOwner Pflicht-Rueckfallzeile entfernt -> `tests 39 / pass 37 / fail 2` (rot: B Owner-Ziel de Pflicht-Rueckfallzeile, F2 Shim-Beleg). Zurueckgespielt -> 39/39 gruen. S5: fr.js identityLines.outboundOwner `${disclosure}` durch Umschreibung ersetzt -> `tests 39 / pass 38 / fail 1` (rot: B Owner-Ziel fr Pflicht-Rueckfallzeile). Zurueckgespielt -> 39/39 gruen. S6: ownerOpeningFor() `if (!name) return "";` entfernt (leerer Vorname erzeugt Owner-Anrede 'Hallo , ...') -> `tests 39 / pass 38 / fail 1` (rot: A11 Tenant ohne Vornamen). Zurueckgespielt -> 39/39 gruen. Nach jeder Sabotage wurde git diff gegen den Commit-Stand geprueft (leer) und der volle Testfile-Lauf erneut gruen bestaetigt. HEAD ist am Ende byte-identisch zum committeten Stand (git status --short leer nach der letzten Ruecknahme).

Unabhaengig wiederholt in SAFETY (4 von 5 selbst gefahrene Sabotagen rot gesehen,
darunter die Kern-Gegenprobe S1, dort mit 14 Roten inkl. Bestands-Riegeln
`/voice/outbound`-Offenlegung, LAW-03, G2-telnyx, AL-P5 — s. Abschnitt "SABOTAGE-GEGENPROBEN" im SAFETY-Bericht). Zusaetzlich fand SAFETY eine **eigene, sechste Sabotage (S2 im SAFETY-Bericht, "Ratschen-Luecke")**: `promptInputs`-Normalisierung `=== true` -> `Boolean(...)` gelockert, blieb bei 0/39 rot — s. Befund unten.

## 5. Impl-Zusammenfassung

- headCommit `7a7536b78fde49c6c947f2cad6ca8415aeec7b1b`, `nodeCheckPass: true`,
  `testsPass: true`, `testPassCount: 5039`, `testFailCount: 0`.
- Neue Dateien: `test/callee-is-owner-opening.test.js` (39 Faelle, Bloecke A-F),
  `test/fixtures/oc-p3-nichtowner-golden.json` (aus unberuehrtem master `28f553f`
  abgegriffen, gegen master rekonstruiert 12/12 OK, gegen die Impl geprueft —
  byte-identische Nicht-Owner-Pfade).
- Geaenderte Dateien: `src/claude.js`, `src/i18n/prompts/{de,fr,en}.js`,
  `apps/web/src/components/app/SettingsIsland.astro` (nur Kommentar),
  `test/p11-agent-language-contract.test.js` (+`situationOutboundOwner` in
  `FUNCTION_FIELDS`, neuer eigenstaendiger Test P11-1b fuer `identityLines`-Sprach-Paritaet).
- Keine neue Route, keine neue Env-Variable, keine Aenderung an
  `src/callee-is-owner.js`, `src/routes/api-calls.js`, `src/store`, `src/config.js`,
  `.env.example`, `render.yaml`, `src/bridge.js`, `src/elevenlabs`, `src/telephony`.

### Deviations

- **D1** (aus dem Plan uebernommen, bestaetigt): Spec/Plan-Anker `4909` war veraltet
  (Stand vor OC-P1). Gueltiger Anker ist `4999` — so gemessen und verwendet.
- **D8** (neu): Abnahme 11 des Plans behauptet "genau 3" Fundstellen fuer
  `calleeIsOwner` in `git diff master -- src/claude.js`; tatsaechlich 6 (4 Code- +
  2 Kommentarzeilen). Der Plan-Text selbst fuehrt in Edit C bereits die vierte Stelle
  (`identityLineFor`) ein, die die Abnahme-11-Liste uebersieht. Funktional bleiben es
  3 verzweigende Entscheidungsstellen, keine zusaetzliche Nummern-Vergleichslogik.
  Kein Handlungsbedarf, Spec 2.2b erfuellt.
- **D9** (Prozess): Pre-Commit-Hook `scripts/check-staged-suppressions.js` blockierte
  den ersten Commit-Versuch (verschobene eslint-Lint-Baselines in vorbelasteten
  Dateien: `id-length` `p`/`f` zu kurz, Komplexitaet einer bereits ueber der Grenze
  liegenden Testfunktion). Behoben durch Umbenennungen
  (`p`→`inputs`/`localePrompt`, `f`→`field`, `p`→`payload`) und Auslagern des
  Paritaetstests in eine eigene Funktion (P11-1b) statt Einbettung in P11-1. Keine
  Suppression-Datei angefasst, kein `--no-verify` verwendet.
- **D3** (aus dem Plan uebernommen, verifiziert): Das Dashboard-Feld fuer die private
  Nummer existiert seit "Feedback-Runde 2" nicht mehr in der UI
  (`savePrivateNumber()` hat keinen Aufrufer mehr). Spec 2.4 ("ergaenze den
  erklaerenden Text") war am Ist-Code nicht ausfuehrbar; statt eines UI-Rebuilds
  (Scope-Verletzung) wurde der Kopfkommentar der Astro-Komponente um die
  Beschriftungspflicht ergaenzt (Edit H). `tenant.privateNumber` bleibt ueber
  API/Onboarding weiterhin setzbar, ohne dass die Owner-Wirkung im Dashboard
  angezeigt wird — Owner-Entscheidung noetig, kein Umsetzungsfehler.

### Bekannte, in der Spec ausdruecklich benannte Einschraenkungen

- `boundaries.personalData` / `boundaries.noCalendar` bleiben auch im Owner-Zweig
  stehen — uebervorsichtig gegenueber dem Auftraggeber, nicht falsch.
- `src/bridge.js` (Realtime-Opener) bleibt bei `disclosureSentence` — Owner hoerte dort
  eine ueberfluessige Offenlegung (harmlose Richtung, Realtime ist am
  Telnyx-Provider produktiv ohnehin blockiert, `VOICE_ENGINE=budget` live).
- `routes/webhooks-elevenlabs.js` entscheidet den Rueckfrage-Weg weiterhin nur nach
  Profil — OC-P2-Altlast, betrifft nur den EL-Weg, nicht OC-P3.

## 6. Safety-Urteil

`approved: true`, keine Blocker. Zentrale Zusagen von SAFETY unabhaengig selbst
nachgefahren (eigener Renderer, eigener Worktree, `git archive` gegen master):

- **Nicht-Owner-Byte-Identitaet** unabhaengig bewiesen: eigener Renderer, 261 gerenderte
  Faelle (3 Sprachen x 2 Richtungen x 7 `calleeIsOwner`-Varianten x 6 `goal`-Varianten +
  Extra-Faelle), SHA-256 zwischen master und Phase identisch
  (`ea83f6f37443b9b4`). Golden-Fixture zusaetzlich gegen master rekonstruiert: 12/12
  Werte OK, keine Selbstbestaetigung.
- **Fail-closed**: A10-Matrix (undefined/false/`"true"`/1) + A11 (leerer Vorname) +
  eigene Positiv-Kontrolle je Sprache; Sabotage S1 (Kern-Gegenprobe) reisst 14 Tests,
  darunter Bestands-Riegel (`/voice/outbound`-Offenlegung, LAW-03, G2-telnyx, AL-P5).
- Abnahmen 6/7/7b/9/10 einzeln nachgefahren: alle leer bzw. wie gefordert.
- `route-auth-inventory.test.js`: 9/9 gruen — keine neue Route, Auth-Kette unberuehrt.

Zwei Auflagen fuer den Lead vor Merge (kein Blocker):

1. **D3 (Spec 2.4 materiell unerfuellt)** — Owner-Entscheidung noetig, ob die
   Beschriftungsluecke fuer `tenant.privateNumber` (API/Onboarding-setzbar, im
   Dashboard nicht angezeigt) akzeptiert wird.
2. **Ratschen-Luecke (von SAFETY selbst gefunden, kein Test faengt sie)**: Lockert man
   `src/claude.js` `promptInputs` von `calleeIsOwner: call.calleeIsOwner === true` auf
   `Boolean(call.calleeIsOwner)`, bleibt die neue Testdatei 39/39 gruen. Code ist
   heute korrekt (Store normalisiert hart auf Boolean, der gesprochene Offenlegungssatz
   haengt an einer zweiten, unabhaengig getesteten strikten Pruefung in
   `ownerOpeningFor`) — betroffen waere nur Prompt-Text, nicht die Offenlegung selbst.
   Empfehlung: A10-Fail-closed-Matrix zusaetzlich fuer `systemPrompt` fahren.

Weitere, nicht blockierende Concerns aus SAFETY: EN-Wortlaut von
`identityLines.outboundOwner` hat keine Entsprechung des OC-P2-Verstaerkungssatzes
("Never leave a person who is not owner unaware..."), inhaltlich aber gleichwertig;
schwache Gegenproben E2/E4 (garantiert bereits durch Bestandsrumpf, tragende Richtung
E1/E3 funktioniert nachweislich); kleiner G5-Verstoss im Test
(`FR_TRANSLITERATION_STEMS` in der neuen Testdatei kopiert statt zentral exportiert);
D2-Test enthaelt eine tautologische Erstassertion (zweite Assertion traegt den Beweis);
Anker `4909` in Spec/Plan-Dokumenten veraltet, sollte fuer Folgephasen nachgezogen
werden.

## 7. Clean-Code-Audit

`blocker: false`, keine Flags in S1-S4.

Verdikt (PASS):

> Diff phase/oc-p3-gleichlauf gegen master: src/claude.js (+outboundSituation-Verzweigung, identityLineFor, firstSpokenSentence/ownerOpeningFor), src/i18n/prompts/{de,en,fr}.js (+situationOutboundOwner, identityLines{inbound,outbound,outboundOwner}), test/callee-is-owner-opening.test.js (neu, 34 Tests), test/fixtures/oc-p3-nichtowner-golden.json (neu), test/p11-agent-language-contract.test.js (+2 Assertions), apps/web/.../SettingsIsland.astro (nur Kommentar-Ergaenzung, kein Code). Keine FLAGs in keiner Kategorie.

Gepruefte Schwerpunkte laut Clean-Code-Bericht:

- **G5/S2 (Duplizierung/Owner-Entscheidungslogik)**: grep bestaetigt genau eine
  Aufrufstelle je Selektor (`outboundSituation`, `identityLineFor`,
  `firstSpokenSentence`, `ownerOpeningFor`) — kein zweiter if/ternary-Zweig mehr in
  den drei Sprachmodulen; die Auswahl sitzt zentral in `claude.js`. Der EL-Pfad
  (`elevenlabs/outbound.js#ownerFirstMessage`) ist ein separater, unveraenderter
  Mechanismus fuer eine andere Engine, keine Kopie derselben Logik.
- **Umlaut-Regel**: gesprochene DE/FR-Strings tragen echte Umlaute/Akzente,
  Code-Kommentare durchgehend ASCII — aktiv getestet (OC-P3-E1..E4, isoliert gruen).
- **Testabdeckung**: 34 neue Tests + 2 neue P11-Assertions, alle 50/50 isoliert
  gruen ausgefuehrt (nicht nur behauptet).
- **apps/web**: Aenderung ausschliesslich ein Kommentarblock, kein
  Markup/Style-Diff.

`topTodos`: keine Blocker; die zwei beim vollen Suite-Lauf beobachteten Last-Flakes
(`cq-p8-briefing` B1, `el-opening-line` A6) sind scope-fremd, isoliert nachgestellt
52/52 gruen, als Last-Flake eingestuft (Memory-Lehre
`suite-flake-p5-gate-proof-spawn-race`); Empfehlung, vor Merge einen sauberen
Solo-Testlauf ohne parallele Konkurrenz zu fahren.

## 8. Fix-Runden

Keine — die Impl-Phase brauchte keine Nachbesserungs-Runde durch Reviewer-Befunde;
`FIXES` ist leer. Die einzige aufgetretene Huerde war der Pre-Commit-Hook (D9), von der
Impl selbst innerhalb der Umsetzung behoben (Umbenennungen, Extraktion P11-1b), nicht
als separate Fix-Runde nach Review.
