# Conversation-Bench: Implementierungs-Report

Umsetzung von `tasks/convo-bench-spec.md`. Rein additiv (`scripts/` + ein neuer
`package.json`-Script-Eintrag), `src/` und `test/` unangetastet.

## Angelegte Dateien

- `scripts/convo-bench.mjs` — CLI-Entry (Argumente parsen, Szenarien-Loop, Exit-Code)
- `scripts/convo-bench/runner.mjs` — Kern-Orchestrierung (Server-Start, Turn-Schleife, Report-Assembly)
- `scripts/convo-bench/texml.mjs` — TwiML/TeXML-Parser (Say/Gather/Hangup + Turn-URL)
- `scripts/convo-bench/persona.mjs` — Persona-Sim (Anthropic-Call) + scriptedTurns-Vorrang + sttNoise-Transform
- `scripts/convo-bench/judge.mjs` — LLM-Judge (Anthropic-Call, separates Modell)
- `scripts/convo-bench/checks.mjs` — 10 deterministische Binary-Checks
- `scripts/convo-bench/metrics-parse.mjs` — `[metrics]`-stdout-Zeilen -> strukturierte Liste
- `scripts/convo-bench/report.mjs` — JSON-Report + stdout-Zusammenfassung + A/B-Vergleich
- `scripts/convo-bench/scenarios/{friseur-voll,termin-duenn,partner-knapp,stt-noise,inbound-nachricht}.mjs`
- `scripts/convo-bench/scenarios/index.mjs` — Szenario-Registry
- `package.json` — ein Zeile ergaenzt: `"convo-bench": "node scripts/convo-bench.mjs"`

`data/` ist bereits gitignored (verifiziert: `.gitignore:8` -> `data/`), Reports
landen unter `data/convo-bench/<run-id>/`.

## Abweichungen von der Spec (mit Begruendung)

1. **Judge-Structured-Output**: Spec schlug `output_config.format` (json_schema)
   vor. Ich habe stattdessen das im Repo bereits BEWIESENE Muster aus
   `claude.js:summarizeCall` genutzt — System-Prompt-JSON-Instruktion +
   defensive Teilstring-Extraktion (`raw.slice(indexOf("{"), lastIndexOf("}")+1)`).
   Grund: `output_config.format` ist mit dieser SDK-Version (`@anthropic-ai/sdk
   ^0.105.0`) im Repo ungetestet; das bestehende Muster hat sich in der
   Produktion bereits bewaehrt. Robustheit im kostenkritischen Erstlauf > Spec-
   Wortlaut. Klemme: `output_config` liesse sich in einer Folge-Iteration
   nachruesten, sobald ein gruener Lauf das bestaetigt.
2. **`disclosureSentence` NICHT aus `claude.js` importiert**: Die Funktion laedt
   intern `store.tenantContext(call.tenantId)` — das waere der Store DIESES
   Bench-Prozesses (anderes `DATA_DIR` als der gespawnte Server-Kindprozess) und
   laege potenziell falsch/leer. `checks.mjs` nutzt stattdessen die reine,
   seiteneffektfreie Funktion `localeFor(language).disclosure(ownerName)` aus
   `src/i18n/locales.js` mit dem SELBST geseedeten `ownerName` (identisch zu
   `OWNER_TEST_FIRST_NAME`/`OWNER_TEST_LAST_NAME` aus `test/helpers.js`) — bewiesen
   byte-identisch zum `DISCLOSURE_JONAS`-Testkonstanten-Wortlaut.
3. **Telnyx-Action-URL-Fix** (nicht explizit in der Spec, aber notwendig):
   `turnDirectives` rendert fuer Telnyx eine ABSOLUTE Action-URL mit
   `config.publicUrl` ("https://agent.test", nicht real erreichbar). `texml.mjs`
   loest die naechste Turn-URL daher IMMER gegen den echten `srv.localUrl` auf
   (nur Pfad+Query aus der Action uebernommen, fremder Origin verworfen) — sonst
   waere jeder Telnyx-Lauf (der Default-Provider!) sofort gescheitert.
4. **Telnyx-Header-Dummy fuer Inbound** (nicht explizit in der Spec):
   `providerFromHeaders` (server.js) entscheidet ueber Signatur-HEADER, nicht
   ueber `--provider`. Fuer `inbound-nachricht` mit `--provider telnyx` setzt
   `runFirstTurn` die Dummy-Header `telnyx-signature-ed25519`/`telnyx-timestamp`
   (wie `test/telnyx-signature.test.js`) — reine Werte, da
   `SKIP_TWILIO_SIGNATURE_CHECK` nur die Krypto-Pruefung selbst uebergeht.
5. **`/voice/status`-Finalisierung ergaenzt** (ueber die Ablauf-Liste der Spec
   §3 hinaus, aber noetig fuer das von der Spec selbst verlangte
   `store_snapshot.summary`/`objective_achieved`): nach der Turn-Schleife postet
   der Runner `POST /voice/status?callId=..&CallStatus=completed` (reiner
   Webhook-Renderer, KEIN `originateCall` — Sicherheitsargument §6 bleibt intakt)
   und pollt best-effort auf `call.summary`, bevor der Store gelesen wird.
6. **`ended_via` um `persona_error` und `no_gather` erweitert** — s. Bugfix unten.
7. **`maxTurnsCap` (CLI `--max-turns`, globale Kosten-Bremse) bewusst getrennt
   von `scenario.maxTurns`** (Check-Schwellwert in `checks.mjs`): der Loop stoppt
   am CLI-Cap (Default 10), der Check `turn_count_within_budget` vergleicht
   gegen den (meist niedrigeren) Szenario-Wert — sonst waere der Check nie
   faelschbar.

## Echter Bug gefunden + gefixt (waehrend der Verifikation)

Der Persona-Call in der Turn-Schleife war NICHT gegen Netzfehler abgesichert
(anders als der Judge-Call). Der reale Smoke-Lauf mit ungueltigem Key deckte das
sofort auf: `friseur-voll` crashte den GESAMTEN Prozess ohne jeden Report. Fix:
`nextCalleeTurn` in try/catch, neuer Terminal-Zustand `ended_via="persona_error"`
(+ `persona_error`-Feld im Report, Anthropic-Fehlermeldungen enthalten nie den
Key selbst) — der Lauf produziert jetzt in jedem Fall einen vollstaendigen
Report. Vor diesem Fix waere die Bench bei jedem echten API-Fehler (Rate-Limit,
Netzwerk, Auth) ergebnislos abgestuerzt.

## Verifikation

### 1. `node --check`
Alle 14 neuen Dateien: PASS (auch nach dem Bugfix erneut geprueft).

### 2. `npm test`
**1493 Tests, 1485 pass, 8 fail.** Alle 8 Fehlschlaege liegen in
`test/personal-assistant-characterization.test.js` (byte-identische
System-Prompt-Assertions) und einem MCP-UI-Shape-Test — verursacht durch
BEREITS VOR meiner Arbeit im Worktree vorhandene, unfertige Aenderungen an
`src/claude.js`/`src/mcp-tools.js`/etc. (paralleles "Impl-1"-Gespraechsqualitaets-
Vorhaben auf demselben Branch, dokumentiert in `tasks/call-quality-findings.md`,
git status zeigt diese als bereits modifiziert VOR meinem ersten Tool-Aufruf).
Ich habe `src/` und `test/` zu keinem Zeitpunkt angefasst (verifiziert per
`git status --short src/ test/` — enthaelt ausschliesslich Dateien, die ich nie
editiert habe). Meine additiven Aenderungen (neue `scripts/`-Dateien + eine
`package.json`-Zeile) fuehren zu KEINEM einzigen neuen Fehlschlag.

### 3. Echter Smoke-Lauf `termin-duenn --repeat 1`
Lief durch, Report geschrieben, KEIN Key im Report/stdout (`grep sk-` leer).

- `turn_count=2`, `ended_via=agent_hangup`
- Checks: `no_raw_iso_date_spoken` PASS, `turn_count_within_budget` PASS
  (2/8), `no_verbatim_question_repeat` PASS — **3/3**
- Judge: `{"error":"401 ... invalid x-api-key"}`
- Kosten (Report): $0.0000 (kein erfolgreicher LLM-Call)

Inhaltlich bemerkenswert: Der GESPAWNTE SERVER selbst traf mit dem echten
(aber ungueltigen) Key auf einen echten 401 der echten Anthropic-API. Das hat
den P3b-R-Resilienz-Pfad (`src/llm.js`) real durchlaufen: `metrics.llm_calls`
zeigt `outcome:"non-transient"` (401 ist kein Retry-Kandidat, korrekt kein
Retry-Sturm) und `/voice/turn` rendert korrekt den generischen
`turnErrorSpeech` + Hangup (nicht die Degradation) — das bestaetigt, dass die
Bench tatsaechlich den ECHTEN Anthropic-Endpunkt trifft (kein
`ANTHROPIC_BASE_URL` versehentlich gesetzt) und der Server-seitige Fehlerpfad
korrekt reagiert.

### 4. Echter Smoke-Lauf `friseur-voll --repeat 1`
Lief durch (nach dem Persona-Error-Fix), Report geschrieben, KEIN Key im
Report/stdout.

- `turn_count=1`, `ended_via=persona_error` (Persona-Call traf denselben 401)
- Checks: `disclosure_first` PASS, `no_redundant_ask_about_briefed_info` PASS
  (n/a, keine Treffer), `booked_with_nongeneric_title` **FAIL** (erwartet — es
  konnte nichts gebucht werden), `farewell_before_terminal` PASS (n/a, kein
  Agent-Hangup), `turn_count_within_budget` PASS (1/8) — **4/5**
- Judge: `{"error":"401 ... invalid x-api-key"}`
- Kosten (Report): $0.0000

Das beweist strukturell: der Context-Pfad (`ASSISTANT_CONTEXT_ENABLED=true`,
`call.context`) wird korrekt durchgereicht (die Offenlegung+Anliegen-Zeile im
ersten Say ist korrekt gerendert), und der `booked_with_nongeneric_title`-Check
erkennt korrekt das Fehlen einer Buchung (kein falsches Gruenwaschen).

## PROVABLY BLOCKIERT: ungueltiger ANTHROPIC_API_KEY

Der in `/Users/antonio/Mein Unternehmen/MCP/vodafone-agent/.env` hinterlegte
`ANTHROPIC_API_KEY` wird von der ECHTEN Anthropic-API mit
`401 authentication_error: "invalid x-api-key"` abgelehnt. Isoliert bewiesen
durch einen MINIMALEN, direkten `@anthropic-ai/sdk`-Call OHNE jeden Bench-Code:

```
node -e '... new Anthropic({apiKey}).messages.create({model:"claude-haiku-4-5",...})'
-> AuthenticationError, status 401, "invalid x-api-key"
```

Ausgeschlossen als Ursache (alle ohne Ausgabe des Key-Inhalts geprueft):
- Extraktions-/Quoting-Fehler: Key-String hat keine Anfuehrungszeichen, kein CR,
  keine fuehrende/folgende Whitespace, Laenge exakt wie in `.env` erwartet.
- Mehrfach-Treffer in `.env`, die `sed`s Ausgabe mit einem eingebetteten
  Newline verunreinigen koennten: genau EIN `ANTHROPIC_API_KEY=`-Eintrag.
- Falsches Auth-Schema (OAuth-Token statt API-Key): Praefix ist `sk-ant-api03-`
  (Standard-API-Key-Format), nicht `sk-ant-oat01-` (OAuth) — `apiKey:`-Feld +
  `x-api-key`-Header sind also der richtige Mechanismus.
- Kein alternativer/aktualisierter Key vorhanden: weder ein zweiter
  `ANTHROPIC_*`-Eintrag in derselben `.env`, noch ein `.env` im Worktree selbst
  (nur `.env.example`), noch ein bereits im Shell-Environment gesetzter
  `ANTHROPIC_API_KEY`.

Das ist ein Credential-/Umgebungsproblem ausserhalb des Aufgaben-Scopes, KEIN
Defekt in der Bench-Implementierung — beide Smoke-Laeufe belegen, dass die
gesamte Mechanik (Server-Boot, Seeding, TeXML-Parsing, Turn-Schleife,
Check-Ausfuehrung, Judge-Fehlerbehandlung, Persona-Fehlerbehandlung,
Report-Schreiben, Key-Hygiene) korrekt funktioniert; nur die tatsaechlichen
LLM-Antworten (Agent + Persona + Judge) sind durch den ungueltigen Key
blockiert. Sobald ein gueltiger Key in `.env` liegt, sollte derselbe Aufruf
ohne weitere Aenderungen durchlaufen (Erwartung: >=2 echte Agenten-Turns,
Judge-Scores 1-5, plausible Kostenschaetzung ~0.01-0.03 USD).

## Offene Punkte / Risiken

1. **Blockierend**: Die geforderte Vollverifikation (echte mehrstufige
   Konversation, echte Judge-Scores) steht aus, bis ein gueltiger
   `ANTHROPIC_API_KEY` in `.env` verfuegbar ist. Sobald vorhanden: denselben
   Smoke-Befehl erneut fahren (keine Code-Aenderung noetig).
2. Judge-Structured-Output nutzt bewusst NICHT `output_config.format` (s.
   Abweichung 1) — sollte nach einem gruenen Lauf mit gueltigem Key evaluiert
   werden, ob das Feature diese SDK-Version/Modellkombination unterstuetzt
   (waere robuster als die Teilstring-Extraktion).
3. Preistabelle fuer `cost_estimate_usd` ist eine eigene Konstante in
   `runner.mjs` (Haiku $1/$5, Sonnet-5 Intro $2/$10 bis 2026-08-31) — spiegelt
   `src/config.js`s Werte, ist aber NICHT von dort importiert (bewusst: Import
   von `config.js` in den Bench-Prozess haette dieselbe DATA_DIR-Problematik
   wie bei `disclosureSentence`, s. Abweichung 2). Drift-Risiko, falls
   `config.js`s Preise sich aendern, ohne dass `runner.mjs` nachgezogen wird —
   informativer Wert, kein Budget-Gate, daher vertretbar.
4. `stt-noise`, `partner-knapp`, `inbound-nachricht` sind bisher NUR
   Import-gepueft (Modul laedt fehlerfrei), nicht end-to-end mit echtem Key
   gelaufen (Blocker s.o.). Strukturell identisch zu den beiden verifizierten
   Szenarien, aber nicht selbst beobachtet.
5. Vorbestehend, nicht von mir verursacht: 8 rote Tests in `npm test`
   (`test/personal-assistant-characterization.test.js` + ein MCP-UI-Test) durch
   ein paralleles, unfertiges Vorhaben auf demselben Branch/Worktree
   (`tasks/call-quality-findings.md`, "Impl-1"). `src/` und `test/` habe ich zu
   keinem Zeitpunkt editiert (per `git status` verifizierbar).
6. Beobachtung (nicht behoben, ausserhalb des Scopes): Laufzeit-Node ist
   `v26.0.0`, `package.json` pinnt `engines: ">=22 <23"` — vorbestehende
   Diskrepanz, nicht durch diese Aufgabe verursacht.
