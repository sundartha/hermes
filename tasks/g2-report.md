# Phase G2 — Erst-Turn-Deadlock aufloesen

**Ziel:** Den leeren Erst-Gather-Deadlock im Outbound-Call aufloesen — Offenlegung **und** Anliegen werden im **selben Turn** gesprochen, das Mikrofon ist sofort offen. `/voice/outbound` bleibt strikt **LLM-frei**.

**Gate:** PASS
**finalBranch:** `phase/g2-first-turn-fix1`
**Commit:** `8b1e31e`
**Tests:** 727/727 gruen (json-Backend, offline)
**Fix-Runden:** 1 (r1)

---

## Plan (gekuerzt)

**Grounding:** master=`4f9896b` (G1 gemergt, 721/721). Geprueft: `src/claude.js` (`disclosureSentence`, `systemPrompt`), `src/server.js` (`/voice/outbound`, `turnDirectives`), `src/telephony/directives.js`, `adapters/telnyx/render.js` (`renderGather`/`GATHER_ATTRS`), `config.js`, `_validation.js` (`objective=500`), G0-Harness + Baseline-Test.

**Scope-Quelle:** PLAN-CONVERSATION-QUALITY.md §3 "G2", §1 #1/#4, §4, §5 (Owner #4). Diese Phase loest NUR den leeren Erst-Gather. AUSSERHALB: STT-Endpointing (#3 → G3), Reprompt/Log-Cleanup (G4), `redirectD`-Entfernung.

**Kern-Design (Approach A, code-bestaetigt):**
Heute rendert `/voice/outbound` `[sayD(disclosure), ...turnDirectives(call, "")]` — also einen separaten Offenlegungs-`<Say>` gefolgt von einem **leeren** `<Gather/>` (self-closing, kein innerer Say) = der Deadlock (15s-Loch, `SpeechResult:0`).
G2: der **gesamte** gesprochene Erst-Turn-Text (Offenlegung + Bruecke + gekapptes Anliegen) wandert als EIN `promptText` **in** das `<Gather>` — byte-strukturgleich zum bewaehrten Inbound-Greeting (`turnDirectives(call, greeting)`). Der separate `sayD(disclosure)` entfaellt. Offenlegung bleibt erster gesprochener Satz (Praefix), Anliegen folgt im selben Turn, Mikrofon sofort offen.

**Neue Symbole (in `claude.js`, nicht config/env):**
- `OPENING_GOAL_MAX_CHARS = 160` — benannte Modul-Konstante (reine TTS-Render-Kappe, kein Sicherheits-/Budget-/Tuning-Wert → keine env-Var, P15; `goal`-Validierungslimit `objective=500` bleibt unberuehrt).
- `openingText(call)` — 1-arg, rein synchron: `disclosure` + " Ich rufe an, weil <goal>." (Offenlegung als Praefix; leeres goal → nur Offenlegung).
- `trimGoalForSpeech(goal)` — Whitespace normalisieren, an Zeichengrenze schneiden (Wortgrenze bevorzugt), Satz-Endzeichen entfernen.

**Doppel-Nennungs-Risiko:** Da der Erst-Gather das Anliegen bereits nennt, wird der Outbound-`systemPrompt` im selben Diff angepasst: statt "Dein allererster Satz muss exakt lauten …" nun "Offenlegung UND Anliegen wurden bereits gesagt — wiederhole sie NICHT, knuepfe an die Antwort an." Damit wird die Offenlegung **deterministisch LLM-frei** garantiert statt per Modell-Gehorsam (staerker als zuvor).

**Tests (geplant):** Baseline `outbound-first-gather-baseline.test.js` ins Positiv drehen + `git mv` → `outbound-first-gather.test.js`; `outbound-greeting.test.js` + `disclosure-outbound.test.js` (Pin-Umkehr `sayIdx<gatherIdx` → `gatherIdx<sayIdx`) anpassen; neu `g2-opening-turn.test.js` (Reihenfolge, LLM-Freiheit, Kappe, leeres goal, kein Doppel-Anliegen).

**Pre-Mortem:** (a) versehentliche LLM-Kopplung → `openingText` rein synchron, Test ohne Anthropic-Mock; (b) Offenlegung nicht mehr erster Satz → Praefix + Reihenfolge-Pin; (c) Doppel-Anliegen → systemPrompt im selben Diff; Anti-Impersonation: woertliche gebundene Offenlegung wird LLM-frei garantiert gerendert.

---

## Implementierungs-Zusammenfassung

- **`src/claude.js`**: `OPENING_GOAL_MAX_CHARS = 160` (benannt, kommentiert), `openingText(call)` + `trimGoalForSpeech(goal)` direkt unter `disclosureSentence` (reine Funktionen, 1-arg). Outbound-`systemPrompt`: alter Pflicht-Satz-Wortlaut ersetzt durch "bereits gesagt / NICHT wiederholen".
- **`src/server.js`**: `/voice/outbound` rendert `render(turnDirectives(call, openingText(call)), call.provider)` — EIN Say IM Gather; `addTranscript` mit dem Opening-Text; ungenutzten `disclosureSentence`-Import entfernt (G12); ueberholten Kommentar aktualisiert (C2).
- **Tests**: `outbound-first-gather.test.js` (git mv + Inhalt gedreht), `outbound-greeting.test.js`, `disclosure-outbound.test.js`, `g1-identity-binding.test.js` (Fall 4), `outbound-premature-close.test.js` (Fall A), `disclosure-regression.test.js` (T-P2-10/10b), `_outbound-harness.js` (toten Helper `assertDisclosureBefore` entfernt), neu `g2-opening-turn.test.js` (6 Faelle, beide Provider).

**Offline-Smoke (bestaetigt):** Server PORT 3987, `SKIP_TWILIO_SIGNATURE_CHECK=true`, OWNER_FIRST_NAME=Max/OWNER_LAST_NAME=Mustermann, geseedeter outbound-Call mit goal. `POST /voice/outbound?callId=call_smoke` liefert exakt:
`<Gather ...><Say voice="Polly.Vicki-Neural" language="de-DE">Guten Tag, hier spricht ein KI-Assistent im Auftrag von Max Mustermann. Das Gespraech wird fuer meinen Auftraggeber zusammengefasst. Ich rufe an, weil einen Friseurtermin zu vereinbaren.</Say></Gather><Redirect .../>` — genau ein Say IM Gather, Offenlegung als Praefix vor dem Anliegen, kein separater Say davor, kein `<Hangup>`. Mikrofon sofort offen.

### Deviations
1. **Plan-Doc §1 (config.js/.env.example):** NICHT angefasst — `OPENING_GOAL_MAX_CHARS` als Modul-Konstante in `claude.js` (reine TTS-Kosmetik, keine ungenutzte env-Var, P15). Exakt wie im Plan als Default-Entscheidung begruendet.
2. **Test-Bruch-Radius groesser als geplant:** Ueber die im Plan genannten Dateien hinaus brachen auch `g1-identity-binding.test.js` (Fall 4), `outbound-premature-close.test.js` (Fall A) und `disclosure-regression.test.js` (T-P2-10/10b) — durch die strukturelle Verschiebung (Offenlegung jetzt IM Gather) bzw. die bewusste systemPrompt-Aenderung. Alle als bewusste, plan-begruendete Pin-Umkehr angepasst (Offenlegung bleibt erster gesprochener Satz, nur strukturell im Gather; wird LLM-frei garantiert gerendert). `assertDisclosureBefore` wurde dadurch in allen Callern obsolet und als toter Code entfernt (G12/F4).

---

## Safety-Urteil: APPROVED

- `testsPassIndependently`: true — json-Backend 727/727 selbst ausgefuehrt; pg-Backend 679/689 (10 Fails ALLE infrastrukturell "DB unerreichbar", identische Datei-Liste auf master → keine G2-Regression). `node --check` ok.
- `safetyGatesIntact`: true — `numberGateError`-Kette/Signatur-/Basic-/MCP-Auth/Secrets nicht angefasst.
- `disclosureIntact`: true — Regel 2: byte-identischer Wortlaut, erster gesprochener Satz, jetzt **deterministisch garantiert** (statt LLM-Ermessen).
- `authFailClosedIntact`: true; `noSecretsLeaked`: true; `scopeRespected`: true (nur claude.js, server.js, Tests; keine neuen Dependencies); `behaviorAsIntended`: true.

**Concerns (nicht-blockierend):**
- pg-Suite in dieser Umgebung nicht testbar (kein Live-Postgres); 10 Fails deckungsgleich mit master. Empfehlung: pg-Suite vor Live-Deploy einmal gegen echte/pglite-DB fahren.
- Neue Angriffsflaeche: user-kontrollierter `call.goal` landet jetzt im gesprochenen `<Say>`. Geprueft — Telnyx (`escapeXml`) **und** Twilio (SDK `vr.say` auto-escape) escapen → kein TwiML-Injection. Nur dokumentiert.

**Verdict:** Loest den Deadlock sauber, Pfad bleibt strikt LLM-frei (`openingText` rein synchron, kein `await agentTurn`), de-DE unveraendert, bridge.js/Realtime unberuehrt. Identitaets-Bindung intakt (Name aus `tenant.ownerName` via `disclosureSentence`, nicht ueber Call-Parameter; G1-fail-closed-Gate unberuehrt).

---

## Clean-Code-Audit: PASS

- **S1 (Blocker):** keine
- **S2 (Blocker):** keine
- **S3:**
  - G16/G25 · `src/claude.js:91` · `OPENING_GOAL_MAX_CHARS=160` benannt + kommentiert (sauber); im Test als Literal 160 gespiegelt (bewusst per Kommentar, pinnt Verhalten nicht Zahl) — vertretbar, kein Fix.
  - G11 (ausserhalb Diff-Scope) · `src/bridge.js:137` · Realtime-Engine instruiert den LLM weiter mit "Nenne danach kurz dein Anliegen" (alter Stil) — inkonsistent zur neuen G2-Logik. Nicht in den geaenderten Dateien → per Regel 5 nicht geflaggt; Folge-Hinweis fuer Konsistenz, falls Realtime spaeter aktiviert wird.
- **S4:**
  - G10 · `src/claude.js:92-114` · `openingText`/`trimGoalForSpeech` sauber direkt unter `disclosureSentence`, Funktionslaengen <15 Zeilen, 1-arg, Verschachtelung ≤2. Keine Massnahme.

**Verdict:** PASS — kein S1/S2. Regel 2 byte-stabil und am echten Markup (Twilio+Telnyx) festgenagelt, nicht nur am Prompt. LLM-Freiheit explizit getestet. Grenzfaelle abgedeckt (leeres goal → kein "weil ."-Artefakt; ueberlanges goal → Kappung an Wortgrenze). S2 aktiv verbessert: `assertDisclosureBefore` → `assertDisclosureInGather` als einzige Quelle (vorher byte-identische Kopien in mehreren Testdateien). Baseline-Test sinnvoll in Positiv-Test migriert (kein toter/@Ignore-Test). Keine Magic Numbers, keine dangling Imports, Funktionen kurz. 26 Zieltests + Syntaxcheck selbst gruen.

---

## Fix-Runden

**r1:** Einzigen Review-Blocker G5-1 (S2 Duplizierung) behoben. Die Impl hatte den geteilten Helper `assertDisclosureBefore` aus `_outbound-harness.js` entfernt und durch drei byte-identische Inline-Kopien der Assertion ersetzt; konsolidiert auf einen einzigen geteilten Helper (`assertDisclosureInGather`). Danach Gate=PASS.
