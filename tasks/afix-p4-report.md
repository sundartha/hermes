# Phase afix-p4 — end_call-Disziplin (Prompt-Regel am Tool-Entscheidungspunkt) + Bench-Szenario

**Gate:** PASS
**finalBranch:** `phase/afix-p4-endcall-discipline-fix2`
**headCommit (Impl):** `f73644405f8b7b7d540abe7fc626e1155227883d`
**Grundlage:** `tasks/assistant-fix-spec.md` §P4 (autoritativ) + „Gemeinsame Leitplanken", `PLAN-ASSISTANT-CONVERSATION-FIX.md` §P4, `tasks/rca-2026-07-12-assistant-dead-call.md` (R3), `.claude/refs/clean-code.md`, Lehre `call-quality-chain`.
Code-Stand Plan-Erstellung: `master` (`577cf9d`). Baseline `npm test`: 2131 pass / 0 fail / 7 suites.

---

## 1. Plan (gekuerzt)

### 0. Befund aus dem echten Code (entscheidet die Platzierung)

| Fakt (verifiziert) | Konsequenz |
|---|---|
| `src/claude.js:toolDefs()` liefert `end_call` mit Description „Beendet das Telefonat. IMMER erst aufrufen, NACHDEM du dich verabschiedet hast." | Bedingung (a) der Spec-Regel (Verabschiedung im selben Turn) existiert bereits — genau am Tool-Entscheidungspunkt. Fehlt nur (b) (letzter Beitrag verstanden). |
| `toolDefs` wird von `agentTurn` (Budget-Engine + Telnyx-Shim) UND von `src/bridge.js:realtimeTools()` konsumiert | Eine Description erreicht alle Engines, kein zweiter Ort noetig. |
| `toolDefs` hat keinen Locale-Zweig | Regel gilt automatisch fuer de/fr/en. |
| In-Repo-Praezedenz: `book_appointment.input_schema.properties.title.description` traegt bereits ein enges Verbot (Ergebnis der call-quality-Kette) | Beweis, dass „enges Verbot in der Tool-Description" bei Haiku wirkt. |
| `test/personal-assistant-characterization.test.js` byte-pinnt den vollstaendigen `systemPrompt` (7 Golden-Master SP1–SP7), `test/persona-style.test.js` zusaetzlich | Aenderung am `systemPrompt` erzwingt 7 Golden-Refreezes; eine Tool-Description-Aenderung erzwingt null Testanpassung. |
| `config.callerSubstanceMinLen` Default = 2 | Kauderwelsch (>= 2 Zeichen) ist substanziell -> `suppressEndCall === false`. Der Seam deckt den R3-Fall nicht ab. |

**Entscheidung:** Die Regel geht ausschliesslich in die `end_call`-Tool-Description. `systemPrompt` bleibt byte-identisch. Verworfen: zusaetzliches Bullet in „REGELN FUERS TELEFONIEREN" (S2-Duplizierung, Ueberkorrektur-Risiko laut `call-quality-chain`).

### 1. Der exakte Prompt-Text

Datei `src/claude.js`, Funktion `toolDefs`, Eintrag `end_call`, nur Feld `description` + Kommentar.

Nachher:
```js
    // afix-p4 (RCA-Wurzel R3): Das Modell schloss aus STT-Kauderwelsch, das Ziel sei
    // erreicht, und rief end_call. Das enge Verbot sitzt deshalb GENAU HIER, am Tool-
    // Entscheidungspunkt (Lehre call-quality-chain: breite Stil-/Meta-Regeln im Prompt-
    // Rumpf kippen bei Haiku in Ueberkorrektur, Verbote an der Tool-Description wirken).
    // Der letzte Satz ist der Ausstieg: er verhindert, dass der Agent aus Vorsicht GAR
    // nicht mehr auflegt. Keine Sprach-Variante noetig - toolDefs ist locale-frei.
    {
      name: "end_call",
      description:
        "Beendet das Telefonat. IMMER erst aufrufen, NACHDEM du dich verabschiedet hast. " +
        "Rufe end_call NUR auf, wenn du den letzten Beitrag des Gegenuebers verstanden hast. " +
        "War er unverstaendlich oder zusammenhanglos, frage GENAU EINMAL nach, statt aufzulegen; " +
        "bleibt die Antwort danach unverstaendlich, verabschiede dich und rufe end_call auf.",
      input_schema: {
        type: "object",
        properties: { reason: { type: "string", description: "Kurzer Grund" } },
        required: [],
      },
    },
```

Abgrenzung zur Bestandsregel im `systemPrompt` („Beziehe kurze oder unklare Aeusserungen auf deine letzte Frage"): bewusst „unverstaendlich oder zusammenhanglos" (≠ „kurz oder unklar"). Kurze aber verstaendliche Antworten loesen keine Nachfrage aus. Regressionsnetz: Bench-Szenario `partner-knapp`.

Blast-Radius: `systemPrompt` byte-identisch; `src/telnyx-inbound.js`, `src/telnyx-llm-shim.js`, `src/telnyx-conversation-watchdog.js`, `src/config.js`, `src/i18n/locales.js`, `src/bridge.js` unberuehrt; keine neue Env-Var, keine neue Dependency.

### 2. Warum kein Duplikat des `suppressEndCall`-Seams

`suppressEndCall` = `call.direction === "outbound" && !callerHasSpoken(call) && !(unansweredAgentTurns >= config.maxEmptyTurns)`. Beantwortet nur: „Hat das Gegenueber ueberhaupt schon substanziell gesprochen?" (Substanz = Laenge >= `callerSubstanceMinLen`, Default 2). Empirisch: Kauderwelsch wie `"zonne dat wel eh nietig zo maar"` ist >= 2 Zeichen -> Seam gibt `end_call` frei. Die beiden Schichten sind orthogonal:

| | Frage | Ebene | Wirkung |
|---|---|---|---|
| `suppressEndCall` (unveraendert) | Hat der Angerufene ueberhaupt gesprochen? | deterministischer Server-Guard | verhindert nur Auflegen ins Schweigen |
| Prompt-Regel (neu) | Hat der Agent das Gesagte verstanden? | semantisch, nur Modell beantwortbar | eine Nachfrage statt Auflegen |

Eine Erweiterung von `suppressEndCall` um ein Kauderwelsch-Kriterium waere ein semantischer Server-Guard — Spec „Explizit NICHT". Kein Byte an `suppressEndCall`, `isSubstantialCallerText`, `callerHasSpoken`, `unansweredAgentTurns`, `config.maxEmptyTurns`, `config.callerSubstanceMinLen`.

### 3. Bench-Szenario „kauderwelsch-erstantwort"

Neue Datei `scripts/convo-bench/scenarios/kauderwelsch-erstantwort.mjs`: Repro des Live-Defekts vom 2026-07-12 (deutsche Antwort kam als NL-Kauderwelsch an, Modell wertete sie als Zielerreichung, rief `end_call`). `scriptedTurns[0] = "zonne dat wel eh nietig zo maar"` (bewusst mehrwortig/semantisch leer im Artefakt-Stil der RCA, kein woertliches Log-Zitat, laenger als `callerSubstanceMinLen`, damit der Seam den Fall nachweislich nicht abdeckt). `goal`: „Erfragen, ob es morgen regnet", `checks` inkl. neuem `no_hangup_on_unintelligible_reply`, `judgeFocus` bestraft sowohl Sofort-Auflegen als auch Ueberkorrektur (endloses Nachfragen).

Registry `scripts/convo-bench/scenarios/index.mjs`: +1 Import, +1 Eintrag.

Neuer deterministischer Check `scripts/convo-bench/checks.mjs`:
```js
const MIN_TEXML_TURNS_BEFORE_AGENT_HANGUP = 3;

function checkNoHangupOnUnintelligibleReply(runResult) {
  const id = "no_hangup_on_unintelligible_reply";
  if (runResult.endedVia !== "agent_hangup") return { id, pass: true, detail: "n/a (kein Agent-Hangup)" };
  const pass = runResult.turnCount >= MIN_TEXML_TURNS_BEFORE_AGENT_HANGUP;
  return { id, pass, detail: pass ? `Hangup erst nach ${runResult.turnCount} Agenten-Turns` : `Agent legte direkt nach der unverstaendlichen Aeusserung auf (${runResult.turnCount} Agenten-Turns)` };
}
```
+1 Registry-Eintrag in `CHECKS`. Nur Szenarien, die den Check deklarieren, fuehren ihn aus. Ueberkorrektur-Gegenprobe braucht keinen weiteren Check: laeuft `ended_via=turn_cap`, faellt `turn_count_within_budget` (maxTurns 6).

### 4. Deterministischer node:test

Neue Datei `test/afix-p4-end-call-discipline.test.js` (Muster `claude-turn-guard.test.js`/`c1-auftragstreue.test.js`, lokaler HTTP-Mock als Anthropic-Endpunkt):

- **T-P4-1** (Wire-Ebene): beweist, dass die Regel bis in den tatsaechlich gesendeten Anthropic-Request-Body durchschlaegt (`requests[0].tools` enthaelt `end_call` mit (a) Verabschiedung-vor-`end_call` UND (b) Verstaendnis-Bedingung + „GENAU EINMAL nach").
- **T-P4-2** (Seam-Abgrenzung): Positiv-Kontrolle — Kauderwelsch (>= `callerSubstanceMinLen`) passiert `suppressEndCall` unveraendert (`endCall === true`); Negativ-Kontrolle — echte Stille bleibt weiter unterdrueckt (`endCall === false`). Beweist gleichzeitig, dass diese Phase den Seam nicht angefasst hat.

+2 Tests. Kein separater „Prompt-Rumpf byte-identisch"-Test noetig — SP1–SP7 + `persona-style` pinnen den `systemPrompt` bereits und bleiben ohne Aenderung gruen.

### 5. Deterministisch pruefbares Ergebnis

A) `node --check` auf allen geaenderten/neuen Dateien: erwartet Exit 0, keine Ausgabe.
B) `npm test` offline: erwartet 2131 -> 2133 (Baseline + 2 neue), 0 fail; `test/personal-assistant-characterization.test.js` + `test/persona-style.test.js` unveraendert gruen.
C) Bench (braucht Netz + `ANTHROPIC_API_KEY`, NICHT Teil von `npm test`): `npm run convo-bench -- run --scenario kauderwelsch-erstantwort --repeat 5 --label afix-p4`; Hard-Gate `no_hangup_on_unintelligible_reply` + `turn_count_within_budget` je 5/5 pass.
D) Regressionslauf gegen Ueberkorrektur (Pflicht): `npm run convo-bench -- run --all --repeat 5 --label afix-p4-regression`, insbesondere `partner-knapp` und `stt-noise` ohne neue Check-Fails.

### 6. Aenderungsliste

| Datei | Aenderung |
|---|---|
| `src/claude.js` | einziger Produktivcode-Change: `end_call`-Description in `toolDefs` + Kommentar |
| `scripts/convo-bench/scenarios/kauderwelsch-erstantwort.mjs` | neu |
| `scripts/convo-bench/scenarios/index.mjs` | +1 Import, +1 Registry-Eintrag |
| `scripts/convo-bench/checks.mjs` | +1 Konstante, +1 Check-Funktion, +1 Registry-Eintrag |
| `test/afix-p4-end-call-discipline.test.js` | neu (2 Tests) |

Nicht angefasst: `src/telnyx-inbound.js`, `src/telnyx-llm-shim.js`, `src/telnyx-conversation-watchdog.js`, `src/config.js`, `src/i18n/locales.js`, `src/bridge.js`, `suppressEndCall`/`isSubstantialCallerText`/`callerHasSpoken`/`unansweredAgentTurns`, alle Safety-Gates, `disclosureSentence`/Opening-Anker. Keine neue Dependency.

### 7. Clean-Code-Abgleich (Plan-Selbstpruefung)
G5/S2 (eine Stelle, kein Parallel-Guard), G25/G35 (benannte Konstante), G23/G11 (Registry-Muster statt neuem Dispatch), N7/P12 (reine Funktionen, offline Tests), C2/C5/G9/G12 (kein toter/auskommentierter Code, keine Datei:Zeile-Kommentare), P11 (neues Verhalten hat Tests).

### 8. Pre-Mortem
1. Ueberkorrektur (Agent legt nie mehr auf) — entschaerft durch Ausstiegs-Nachsatz, scharfe Wortwahl, Pflicht-Regressionslauf; harte Notaus (Dead-Air/Loop-Watchdog, `maxCallDurationS`, Budget-Gates) unveraendert.
2. Regel wirkt gar nicht (Haiku ignoriert Tool-Description) — sichtbar am roten Bench-Check vor Deploy; Eskalation waere ein semantischer Guard als eigene, neu zu begruendende Phase.
3. Bench-Szenario gruen trotz wirkungslosem Fix (Tautologie via Seam) — Fixture bewusst laenger als `callerSubstanceMinLen`, T-P4-2 pinnt das aktiv fest.
4. Kollision mit R2/STT-Fix (Agent fragt bei echten Dialekten staendig nach) — akzeptiertes Restrisiko, Ruecknahme = Ein-Zeilen-Revert der Description.

---

## 2. Impl-Zusammenfassung + Deviations

**headCommit:** `f73644405f8b7b7d540abe7fc626e1155227883d`
**nodeCheckPass:** true — **testsPass:** true (2133 pass / 0 fail) — **committed:** true

Phase exakt gemaess Plan umgesetzt. Einziger Produktivcode-Change: `end_call`-Tool-Description in `src/claude.js:toolDefs` um die Verstaendnis-Bedingung erweitert (RCA-Wurzel R3), mit Ausstiegs-Nachsatz gegen Ueberkorrektur. `systemPrompt` blieb byte-identisch (SP1–SP7 + `persona-style` ohne jede Aenderung an diesen Testdateien weiter gruen).

Neues Bench-Szenario „kauderwelsch-erstantwort" reproduziert den Live-Defekt deterministisch per `scriptedTurns[0]`. Neuer deterministischer Check `no_hangup_on_unintelligible_reply` macht den Fix maschinell falsifizierbar, unabhaengig vom nicht-deterministischen Judge. Neuer `test/afix-p4-end-call-discipline.test.js` mit T-P4-1 (Wire-Ebene, echter Anthropic-Request-Body via lokalem HTTP-Mock) und T-P4-2 (Abgrenzung zum unveraenderten `suppressEndCall`-Seam, Positiv-/Negativ-Kontrolle).

Verifiziert: `node --check` auf jeder geaenderten/neuen Datei gruen; `npm test` 2131 -> 2133 (0 fail); Registry-Load der neuen Szenario-ID per `node -e` bestaetigt; neue Check-Funktion per `node -e` in allen 3 Zweigen (fail/pass/n-a) verifiziert; CLI-Usage-Ausgabe unveraendert. `node_modules`-Symlink nicht committet. Inbound-Pfad unberuehrt, keine neue Env-Var, keine neue Dependency, keine Safety-Gates/Disclosure/Auth angefasst.

**filesCreated:**
- `scripts/convo-bench/scenarios/kauderwelsch-erstantwort.mjs`
- `test/afix-p4-end-call-discipline.test.js`

**filesEdited:**
- `src/claude.js`
- `scripts/convo-bench/checks.mjs`
- `scripts/convo-bench/scenarios/index.mjs`

**testsAddedOrChanged:**
- T-P4-1: `end_call`-Tool-Description traegt (a) Verabschiedung UND (b) Verstaendnis-Bedingung, Wire-Ebene via echtem gesendeten Anthropic-Request.
- T-P4-2: Kauderwelsch >= `callerSubstanceMinLen` passiert `suppressEndCall` unveraendert (Positiv-Kontrolle), echte Stille bleibt weiter unterdrueckt (Negativ-Kontrolle) — beweist orthogonale Abgrenzung zum unveraenderten Seam.

**deviations:** keine.

**smokePass:** true — **smokeNote:** Kein echter Anruf, kein Netz zu Telnyx/Anthropic (Scope-Vorgabe). Best-effort-Smoke: (1) `node -e` Import der Szenario-Registry -> `kauderwelsch-erstantwort` korrekt eingetragen; (2) `node -e` Aufruf von `runChecks()` mit synthetischen `runResult`-Objekten fuer alle 3 Zweige von `no_hangup_on_unintelligible_reply` (fail bei turnCount=2, pass bei turnCount=4, n/a bei ended_via=turn_cap) — Verhalten exakt wie spezifiziert; (3) `node scripts/convo-bench.mjs` ohne Argumente zeigt unveraendert die Nutzungs-Meldung (Modulkette laedt fehlerfrei inkl. neuer Registry-Eintraege). Der eigentliche Bench-Lauf (Deliverable C/D, braucht `ANTHROPIC_API_KEY` + Netz) wurde bewusst NICHT ausgefuehrt — laut Plan Owner-Aufgabe nach dieser Phase, nicht Teil der Implementierung.

**cleanCodeSelfCheck (Impl):**
- G5/S2 (Duplizierung): PASS — (a)-Bedingung nicht neu formuliert, sondern Bestandssatz um (b) ergaenzt; genau ein Ort fuer die Regel.
- G25/G35 (Magic Numbers): PASS — `MIN_TEXML_TURNS_BEFORE_AGENT_HANGUP=3` benannt, lebt bei einzigem Konsumenten (Praezedenz `TOOL_LOOP_EXHAUSTION_ROUNDTRIPS`).
- C5/G9 (toter/auskommentierter Code): PASS — keiner.
- G12 (ungenutzte Imports): PASS.
- N7 (Nebeneffekte im Namen): PASS — `checkNoHangupOnUnintelligibleReply` ist rein.
- G30/G34 (eine Aufgabe/Abstraktionsebene): PASS.
- F1 (<=3 Argumente): PASS — alle neuen Funktionen 1–2 Argumente.
- C2 (keine Datei:Zeile-Kommentare): PASS.
- G23 (Polymorphie statt switch/if): PASS — Registry-Muster (`CHECKS`, `SCENARIOS`).
- P11 (Test-Existenz): PASS — 2 neue Tests fuer neues Verhalten; `systemPrompt`-Tests blieben unangetastet gruen (aktiver Beweis der Byte-Identitaet).
- Kommentare deutsch ohne Umlaute, ESM, kein Build-Step — konsistent zum Bestand.

---

## 3. Safety-Urteil (final)

**approved:** true
**verdict:** APPROVED

- testsPassIndependently: true
- safetyGatesIntact: true
- disclosureIntact: true
- authFailClosedIntact: true
- noSecretsLeaked: true
- scopeRespected: true
- behaviorAsIntended: true
- blockers: keine

**concerns (nicht blockierend):**
1. Verortung weicht vom Spec-Wortlaut ab: Spec-Testpunkt sagt „der gebaute System-Prompt enthaelt die end_call-Disziplin-Regel", implementiert ist sie in der `end_call`-TOOL-DESCRIPTION. P4 erlaubt das explizit („praezisierende Description am selben Entscheidungspunkt"), `call-quality-chain`-Lehre favorisiert genau das. Revert-Pin T-P4-1 assertet auf dem tatsaechlich gesendeten Anthropic-Request (`requests[0].tools`) — Schutz gegen lautloses Entfernen haelt.
2. `toolDefs()` ist richtungs-agnostisch: die neue Disziplin erreicht auch den INBOUND-Dialog und die Budget-Engine, nicht nur den Telnyx-Assistant-Outbound-Pfad. `src/telnyx-inbound.js` byte-identisch (Anforderung erfuellt), aber das Prompt-Verhalten inbound verschiebt sich minimal — gleiche Defekt-Klasse, benigne Richtung, dem Owner bewusst zu machen.
3. Rest-Kostenrisiko (akzeptiert, gebunden): Regel erschwert `end_call` nach unverstaendlicher Aeusserung; Ausstiegsklausel vorhanden, `suppressEndCall` erzwingt `end_call` ohnehin nie. Bei Modell-Ueberkorrektur haengt Beendigung an harten Timern (Dead-Air-/Loop-Watchdog stab-p9, `maxCallDurationS`, Telnyx `time_limit_secs=1800`) — alle unveraendert. Bench misst Ueberkorrektur mit (`judgeFocus` + `turn_count_within_budget`).
4. Suite-Flake beobachtet (NICHT von dieser Phase): erster Voll-Lauf `test/inbound-routing.test.js` „bekannte Owner-To" 401 statt 200; isoliert 8/8 gruen, zweiter Voll-Lauf 2133/2133 gruen. Passt zum bekannten Voll-Last-Spawn-Race; Diff fasst keinen Inbound-/Auth-/Signatur-Code an.
5. `npx eslint` laeuft in diesem Worktree nicht (`ERR_MODULE_NOT_FOUND @eslint/js` ueber symlinktes `node_modules`) — Umgebungsartefakt, kein Code-Befund. `node --check src/claude.js` gruen.

**independentTestSummary:** Selbst ausgefuehrt im frischen Worktree (`review-afix-p4-r2` von `phase/afix-p4-endcall-discipline-fix2`). Lauf 1 (`npm test`, voll): 1 Fehler in `test/inbound-routing.test.js` „bekannte Owner-To -> normaler Greeting + Call-Record" (erwartete 200, bekam 401); isoliert nachgefahren: 8/8 pass. Lauf 2 (`npm test`, voll): 2133 pass, 0 fail, 0 skipped, ~74s. Bewertung nach Gate-Protokoll („rot nur echt wenn isoliert rot"): bekannter Voll-Last-Spawn-Race-Flake, nicht durch diese Phase verursacht. Zusaetzlich `node --check src/claude.js` gruen.

**Kernargumentation des Verdikts:** Diff minimal und exakt auf P4 begrenzt: 5 Dateien, in `src/` ausschliesslich +11/-1 innerhalb `toolDefs()`. (a) Regel 2 unangetastet: `disclosureSentence()` (`src/claude.js:171`) und `openingText()` (`:189`) byte-identisch zu master; neue Formulierung betrifft nur den `end_call`-Entscheidungspunkt, relativiert Offenlegung nicht, stellt sie nicht ins KI-Ermessen; Opening-Anker (`speak` -> `speak.ended` -> `ai_assistant_start`) unberuehrt. (b) `suppressEndCall`-Seam (`src/claude.js:487`) byte-identisch — kein paralleler Guard, kein Turn-Zaehler, P4.2 bleibt gestrichen; T-P4-2 pinnt die Seam-Grenze zusaetzlich fest. (c) Regel eng am Tool-Entscheidungspunkt formuliert, traegt eigene Ausstiegsklausel — kein „legt gar nicht mehr auf"-Trichter; Watchdog/`maxCallDurationS`/Telnyx-time_limit bleiben als Notaus unveraendert. (d) Null Treffer fuer budget/gate/denylist/allowlist/watchdog/signature/maxCallDuration im `src`-Diff; `config.js`, `package.json`, `src/telephony/**`, `src/telnyx-inbound.js` unangetastet — keine neuen Env-Vars, Dependencies, Endpunkte, Secrets. (e) Bench-Szenario liegt in `scripts/convo-bench/**`, vom Test-Glob `test/*.test.js` nicht erfasst; Suite bleibt gruen. Zusatzpruefung der Bench-Logik: `turnCount = texmlSamples.length`, Sofort-Hangup ergibt `turnCount=2` -> FAIL, Nachfrage-dann-Verabschiedung ergibt `turnCount=3` -> PASS; `MIN_TEXML_TURNS_BEFORE_AGENT_HANGUP=3` korrekt, alle 5 deklarierten Check-IDs existieren in der Registry.

---

## 4. Clean-Code-Audit (final)

**verdict:** PASS — keine S1/S2-Blocker. Diff eng geschnitten: Produktionscode-Aenderung ausschliesslich die erweiterte `end_call`-Tool-Description in `src/claude.js` (Rest additiv: 2 neue Unit-Tests, 1 neues Bench-Szenario, 1 neue Check-Funktion). Sicherheits-/Auth-/Budget-Gates unberuehrt.
**blocker:** false

**S1 (hart):** keine
**S2 (hart):** keine

**S3 (Empfehlungen, kein Blocker):**
- Test-Abdeckungsluecke: Die neue Prompt-Regel hat zwei Verhaltenszweige — (a) einmal nachfragen bei unverstaendlicher Aeusserung, (b) bleibt sie danach weiter unverstaendlich: verabschieden + `end_call`. Weder T-P4-1/T-P4-2 noch das Bench-Szenario pruefen Zweig (b) — die Persona klaert nach genau einer Nachfrage immer auf. Da LLM-Prompt-Verhalten prinzipiell nicht deterministisch unit-testbar ist, kein hartes S1, aber sinnvolle Bench-Ergaenzung (zweite `scriptedTurns`-Zeile mit weiterhin unverstaendlicher Antwort).
- Trivial: Der Kauderwelsch-Literal-String ist wortgleich in `scripts/convo-bench/scenarios/kauderwelsch-erstantwort.mjs` UND `test/afix-p4-end-call-discipline.test.js` hinterlegt. Keine Handlungsempfehlung — Shared-Import zwischen `scripts/convo-bench/` und `test/` waere unnoetige Kopplung fuer einen 30-Zeichen-Fixture-Wert.

**S4:** keine

**topTodos:**
1. Bench-Szenario um einen zweiten `scriptedTurns`-Eintrag erweitern, der auch nach der Nachfrage unverstaendlich bleibt, um Verhaltenszweig (b) tatsaechlich zu pruefen.
2. Keine weiteren Blocker — Phase ist mergefaehig.

**passNotes:** Volle Suite gruen: 2097/2097 Tests (inkl. der 2 neuen zum Auditzeitpunkt), `node --check` auf allen 4 geaenderten/neuen Dateien sauber. Kein Umlaut in neuen Kommentaren. Kein toter/auskommentierter Code, kein TODO/FIXME/eslint-disable/skip. T-P4-1 trotz oberflaechlicher Aehnlichkeit KEIN tautologischer Test: die Test-Konstante ist eine unabhaengige Literal-Kopie (nicht aus `src/claude.js` importiert) und wird gegen den tatsaechlich ueber den gemockten HTTP-Server gesendeten Anthropic-Request geprueft — ein kuenftiges Prompt-Refactor faellt real durch (Muster wie `test/disclosure-regression.test.js`). T-P4-2 prueft echtes Produktionsverhalten (`suppressEndCall`-Seam ueber `isSubstantialCallerText`/`CALLER_SUBSTANCE_MIN_LEN=2`, korrekt referenziert). Keine neue Prompt-Regel-Duplikation: bestehende Verabschiedungs-vor-`end_call`-Regel ist vorbestehend, nicht Teil dieses Diffs; neue Verstaendnis-Klausel adressiert andere Bedingung, ueberschneidet sich inhaltlich nicht mit dem JS-Seam (durch T-P4-2 belegt). `MIN_TEXML_TURNS_BEFORE_AGENT_HANGUP` als benannte Konstante (G25) korrekt umgesetzt; `CHECKS`-Registry-Eintrag rein additiv und scenario-scoped. Referenzierte Datei `tasks/assistant-fix-spec.md` existiert tatsaechlich (untracked im Haupt-Repo, nur nicht im Review-Worktree sichtbar) — kein toter Verweis, initialer Verdacht per Read widerlegt.

---

## 5. Fix-Runden

**r1:** Review-Blocker fuer Phase afix-p4 behoben. Einziger gemeldeter Blocker betraf Test T-P4-1 (Schein-Sicherungsnetz: drei Regex-Assertions matchten woertlich aus `src/claude.js` kopierte Substrings der `end_call`-Tool-Description und haetten eine semantische Inversion der Regel nicht erkannt). Fix per Refactor auf robustere Pruefung.

**r2:** Review-Blocker der Phase afix-p4 (Runde 2) behoben: das fehlende Regressions-Netz fuer die `end_call`-Disziplin-Regel wurde geschlossen. T-P4-1 wurde in `test/afix-p4-end-call-discipline.test.js` wieder eingefuehrt, diesmal als sauberer Revert-Pin (volle String-Gleichheit gegen die woertlich gepinnte erwartete Description) statt Teil-Regex-Matching.

Nach r2: Gate = PASS, Merge auf `phase/afix-p4-endcall-discipline-fix2`.
