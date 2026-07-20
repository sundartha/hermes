# P8 — Pre-Call-Briefing: Detailbericht

**Datum:** 2026-07-19
**Basis:** `master` @ `ae0109f` (P7a gemergt)
**Finaler Branch:** `phase/cq-p8-briefing`
**Head-Commit:** `51cc4e9` (nicht gepusht)
**Gate:** **PASS**

---

## 1. Zusammenfassung

Phase P8 fügt ein **Pre-Call-Briefing** ein: vor dem eigentlichen Wählen füllt ein starkes LLM (Sonnet) den strukturierten `call.context` (und optional das Mandat) aus dem Auftrag des Nutzers (`objective`/`briefing`/`constraints`/`to`), sofern der Owner selbst keinen Kontext mitgeschickt hat. Feature ist per Default **AUS** (fail-closed), verlangt zwei Flags gleichzeitig, läuft **nach** der kompletten `outboundGates`-Kette (kein neues Gate) und bucht Kosten unmittelbar und unabhängig vom Ergebnis. Alle vier absoluten Projektregeln (Safety-Gates, Offenlegung, Auth-fail-closed, Secrets) bleiben unangetastet.

---

## 2. Plan (gekürzt)

### Design-Entscheidungen (Auswahl)

| # | Entscheidung |
|---|---|
| D1 | Briefing läuft in `src/routes/api-calls.js` **nach** der kompletten `outboundGates`-Kette, **vor** `store.createCall`. Kein neues Gate — Präzedenz ist der bestehende `diagnostic`-Block, der ebenfalls nie ablehnt. |
| D2 | Läuft nur, wenn `ctx.context` leer ist. Owner-Eingabe gewinnt immer; Owner-`mandate` gewinnt ebenso über ein gebrieftes Mandat. |
| D3 | Feature verlangt **beide** Flags: `precallBriefingEnabled && assistantContextEnabled` — ohne Konsument der HINTERGRUND-Sektion wäre das Briefing bezahlter Müll. |
| D4 | Kostenbuchung läuft unmittelbar nach der LLM-Antwort, **vor** jeder Validierung, **außerhalb** des `try` — ein Buchungsfehler wird 500, nicht verschluckt (Regel 1). |
| D5 | `bookTokenUsage` wandert aus `claude.js` in ein neues Modul `src/llm-usage.js` (reiner Move, Signaturwechsel auf `{tenantId, callId, usage, model}` — der Briefing-Aufruf hat noch keinen `call`). |
| D6 | Eigene `createLlmClient`-Instanz (eigener Circuit-Breaker), eigener kurzer Timeout, `maxRetries: 0`. Ein Briefing-Ausfall darf den Gesprächs-Breaker nicht kippen. |
| D7 | Modell-Ausgabe läuft durch **dieselben** Validierer wie der HTTP-Body (`validateAssistantContext`/`validateMandate`). Jeder Verstoß ⇒ `null` (Fail-Soft). |
| D8 | Das Briefing-Modell darf **nie** `on_out_of_scope: "accept_best"` vergeben — weder im Tool-Schema-Enum noch nach Validierung (Code streift es defensiv ab). Nur der Owner selbst kann diese weitreichendste Vollmacht erteilen. |
| D9 | Owner-Text steht ausschließlich in der `user`-Message, nie im `system`-Block (Injection-Härtung). |
| D10 | Dokumentierte Abweichung von Anhang B: `constraints` wird zusätzlich als vierte Eingabe mitgegeben, damit das Briefing kein Mandat erfindet, das den harten Owner-Grenzen widerspricht. |
| D11 | `{tools}` aus Anhang B wird über neuen Export `agentToolNames()` aus `toolDefs()` **abgeleitet** — keine driftende Zweitliste der Agenten-Fähigkeiten. |
| D12 | Keine neue npm-Dependency; strukturierte Ausgabe über Anthropic tool_use + `tool_choice`. |

Nicht angefasst: `disclosureSentence`, Gate-Kette, Auth, `bridge.js`, `apps/web`, Datenschutzerklärung, Bench-Szenarien.

### Neue Dateien (Plan)

- `src/llm-usage.js` — reiner Move von `bookTokenUsage`/`meterAiTokens`/`billedTokens`/`inputTokensOf` aus `claude.js`.
- `src/precall-briefing.js` — Kern: `fetchPrecallBriefing({objective, ownerNotes, constraints, to, tenantId})` → `{context, mandate} | null`. Enthält eigenen Breaker-Client, System-/User-Prompt-Aufbau (Anhang B B.1 + D9/D10), `sanitizedBriefing` (D7), `withoutSelfGrantedAcceptBest` (D8).
- Drei Testdateien: `test/cq-p8-briefing.test.js` (Kern, 12 Tests B1–B12), `test/cq-p8-briefing-http.test.js` (HTTP-Verdrahtung, 5 Tests HP1–HP5), `test/cq-p8-briefing-breaker.test.js` (Breaker-Isolation, 2 Tests BR1–BR2, eigene Datei wegen Prozess-Env-Isolation für `LLM_BREAKER_THRESHOLD=1`).

### Bestandsedits (Plan)

- `src/claude.js`: `bookTokenUsage`-Funktionen entfernt (nach `llm-usage.js` verschoben), zwei Call-Sites (`agentTurn`, `summarizeCall`) auf neue Objekt-Signatur umgestellt, neuer Export `agentToolNames()`.
- `src/config.js`: neue Keys `precallBriefingEnabled` (tenancy-Namespace), `briefingModel`/`briefingTimeoutMs` (llm-Namespace) inkl. `CONFIG_NAMESPACES`-Nachzug.
- `src/routes/api-calls.js`: Aufruf von `fetchPrecallBriefing` zwischen dem `diagnostic`-Block und `store.createCall`, nur wenn `!ctx.context`.
- `.env.example`, `render.yaml`, `test/helpers.js` (`BASE_ENV`), `test/config-namespaces.test.js` (Pin-Nachzug: `llm: 10→12`, `tenancy: 5→6`, `EXPECTED_TOTAL_KEYS: 100→103`).

### Testplan (Auszug)

19 neue Tests decken ab: Happy Path (B1), HTTP-500/Timeout-Fail-Soft (B2/B3), Injection gegen Fremd-Keys (B4) und Feldlänge/DoS (B5), D8-Abstreifung von `accept_best` (B6), Kostenbuchung zur Sonnet-Rate auch bei unbrauchbarer Antwort (B7/B8), Prompt-Grounding system/user-Trennung (B9), Flag-Kombinationen (B10/B11), Byte-Identität des `systemPrompt` bei fehlgeschlagenem Briefing (B12); End-to-End über `POST /api/calls` (HP1–HP5); Breaker-Isolation (BR1/BR2). Plan nennt explizit die `withConfigOverrides`-vs-`withConfig`-Falle bei async Restores als Implementierungshinweis.

### Offene Owner-/Deploy-Auflagen laut Plan (Vorschau, siehe §6 unten für Endstand)

Prod-Anschaltung, Bench-Verdrahtung für Abnahmekriterium (c), Probeanruf, Datenschutz-Bestätigung — alle explizit **nicht** Teil der Agenten-Arbeit.

---

## 3. Implementierung — Zusammenfassung

Phase exakt gemäß Plan umgesetzt.

**Neue Dateien:**
- `src/precall-briefing.js` — `fetchPrecallBriefing` mit eigenem Circuit-Breaker/Timeout/`tool_use`-Erzwingung, Fail-Soft, D8-Schutz gegen `accept_best`-Selbstermächtigung, D9-Injection-Härtung.
- `src/llm-usage.js` — `bookTokenUsage` als reiner Move aus `claude.js`, Signatur auf `{tenantId, callId, usage, model}` umgestellt.
- `test/cq-p8-briefing.test.js`, `test/cq-p8-briefing-http.test.js`, `test/cq-p8-briefing-breaker.test.js`.

**Bearbeitete Dateien:** `.env.example`, `render.yaml`, `src/claude.js`, `src/config.js`, `src/routes/api-calls.js`, `test/config-namespaces.test.js`, `test/helpers.js`.

`claude.js` exportiert neu `agentToolNames()` (aus `toolDefs()` abgeleitet). `api-calls.js` ruft das Briefing **nach** der kompletten `outboundGates`-Kette und **nur** wenn der Owner keinen eigenen Kontext mitschickte (Owner gewinnt immer). Neue Config-Keys in `.env.example`, `render.yaml` und `test/helpers.js`-`BASE_ENV` nachgezogen; `config-namespaces.test.js`-Pins aktualisiert.

**Ergebnis:** Default aus (fail-closed) — Bestandsverhalten byte-identisch bewiesen (Test B12, HP4, Smoke Test 1). 19 neue Tests (B1–B12/HP1–HP5/BR1–BR2) plus volle Regressionssuite grün: **2538/2538** (json+pg-Backends in derselben `npm test`-Ausführung, 0 fail).

**Node-Check:** bestanden auf allen geänderten/neuen Dateien.

### Deviations vom Plan

1. **grep-Zählabweichung `bookTokenUsage`:** Plan schätzte 5 Treffer, tatsächlich 7 — Differenz sind 2 Import-Zeilen (`claude.js`, `precall-briefing.js`) + 1 Kommentar-Erwähnung in `llm-usage.js`, die der Plan-Text nicht mitgezählt hatte. Semantisch unverändert: genau 1 Definition + 3 legitime Call-Sites (`agentTurn`, `summarizeCall`, `fetchPrecallBriefing`), keine Duplizierung.
2. **Test B8 Token-Größe:** Plan nannte keine konkrete Größe; kleine Werte (z. B. 1000/200) runden über den bestehenden Mikro-Cent-Akkumulator (`state-ops trackUsage`) legitim auf 0 Cent für einen einzelnen kleinen Turn. Umsetzer wählte 1 Mio. Input-Token (wie B7), damit der Test einen echten Cent-Anstieg beweist statt an einem False-Negative vorbeizulaufen.
3. **`config-namespaces.test.js` Zusatz-Pin:** Zusätzlich zu den drei im Plan genannten Zahlen musste auch der `checked === 93`-Assert (Setter-Durchschlag-Test) auf 96 nachgezogen werden (3 neue primitive Blätter, kein neues Array/Objekt) — im Plan nicht explizit genannt, aber zwingende Folge derselben Config-Erweiterung; sonst wäre der Test rot gewesen.

### Smoke-Test (manuell, echter Server)

Server lokal gestartet (`SKIP_TWILIO_SIGNATURE_CHECK=true`, Dummy-Twilio-Creds, geseedete Owner-Identität/-Nummer).

- **Test 1** (`PRECALL_BRIEFING_ENABLED=false`, Default): `POST /api/calls` durchläuft alle Gates, scheitert erwartungsgemäß am Offline-Twilio-Originate (500 „Anruf konnte nicht gestartet werden") — byte-identisches Bestandsverhalten bestätigt.
- **Test 2** (`PRECALL_BRIEFING_ENABLED=true`, `ANTHROPIC_BASE_URL` auf unerreichbaren Port): Server-Log zeigt exakt den erwarteten Fail-Soft-Pfad `[precall-briefing] uebersprungen: LLM nicht verfuegbar: retries-exhausted`; der Call wird trotzdem angelegt (Audit-Log, dann Originate-Versuch), persistiert mit `context: null`/`mandate: null` (per `store.json` verifiziert), Response weiterhin 500 (Twilio-Auth-Fehler, unverändert). Kein Crash, kein Hang, kein Leak.

Beide Server sauber gestoppt, Temp-Verzeichnisse aufgeräumt.

---

## 4. Safety-Urteil

**`approved: true`** — alle Einzelprüfungen bestanden: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`.

**Unabhängige Verifikation:** Frisches Worktree, `git checkout -b review-p8-fresh phase/cq-p8-briefing`, `node_modules` symlinked. Volle Suite selbst ausgeführt: 2538 Tests, 2538 pass, 0 fail, 0 skipped, 0 todo, Exit 0, 75.2s. Beide Backends abgedeckt (10 dedizierte `*-pg.test.js`-Dateien via pglite, alle grün). Gezielter Re-Run von `test/outbound-gates-order.test.js` + den drei neuen P8-Dateien: 40/40 pass. Zusätzlich ein eigener adversarieller Test (nicht Teil der Phase, danach gelöscht, Worktree sauber) für die neue Persistenz-Kombination: `store.recordUsageEvent({callId: null})` auf dem PG-Backend, da das Briefing Token bucht **bevor** `store.createCall` existiert — verifiziert gegen `src/db/schema.sql`, dass `usage_event.call_id` nullable ist ohne FK, Insert+Reopen-Roundtrip bewiesen (1/1 pass).

### Verdikt (wörtlich zusammengefasst)

- **SAFETY-GATES:** `src/telephony/outbound-gates.js` im gesamten Diff unberührt (per `--name-only` verifiziert), ebenso `bridge.js`, auth/web-auth/middleware/signature. Briefing ist bewusst kein Gate, läuft nach der Kette. `test/outbound-gates-order.test.js` unverändert und grün. Kostenachse geschlossen: `bookTokenUsage` läuft vor dem Parsen, außerhalb des Fehler-`try`/`catch` — verbrauchte Token werden auch bei unbrauchbarer Antwort gebucht (Regel 1, gepinnt durch B8). Briefing-Modell `claude-sonnet-5` steht bereits in `config.modelPricesUsd` (aus P7a), wird also zur echten Rate gebucht statt fail-closed teuerst.
- **DISCLOSURE:** `disclosureSentence` in `claude.js`/`bridge.js` bit-identisch zu `master`. Die `claude.js`-Änderung ist ausschließlich der `bookTokenUsage`-Move plus additiver Export `agentToolNames`.
- **AUTH:** kein neuer Endpunkt, nur der bestehende, bereits abgesicherte `POST /api/calls` erweitert.
- **SECRETS:** kein Key-Material in neuen Dateien; der einzige neue Log gibt ausschließlich `err.message` aus. Kein Audio via MCP.
- **VERHALTEN:** Flag-off ist echt byte-identisch (`briefingActive()` prüft zuerst, liefert `null` vor jedem Seiteneffekt). Beide Flags nötig (D3). Defaults fail-closed in `config.js`, `.env.example`, `render.yaml` und `test/helpers.js`-`BASE_ENV`. Injection-Härtung substanziell: Owner-Freitext nur in `user`-Message, Modellausgabe durch dieselben Validierer wie HTTP-Body, D8 doppelt gesichert (Schema-Enum + Code-Nachriegel). Eigener Breaker-Client deckt alle sechs von `llm.js` gelesenen `llm.*`-Keys ab.
- **SCOPE:** keine neue npm-Dependency; `llm-usage.js`-Extraktion ist notwendiger Enabler, kein ungefragtes Extra; kein `eslint-disable`, kein toter Code.

### Concerns (nicht-blockierend, alle vermerkt für Folgephasen)

1. **Reserve-Leak-Fenster verbreitert** (`src/routes/api-calls.js:114-127`): `reserve_budget` ist per dokumentierter Invariante das letzte Gate und persistiert eine Budget-Reservierung. P8 setzt einen awaited Netzwerk-Aufruf plus zwei Store-Schreibvorgänge zwischen diese Reservierung und `store.createCall`. `bookTokenUsage`/`sanitizedBriefing` sitzen bewusst außerhalb des try/catch in `precall-briefing.js`; ein Wurf dort propagiert aus dem Route-Handler → 500, während die Reserve gebucht bleibt (`releaseOutboundReserve` verlangt ein `call`-Objekt, kein Sweeper für verwaiste Reserven existiert). Praktisches Risiko gering (reine In-Memory-Mutationen ohne IO), Fehlrichtung konservativ (zu viel reserviert, nie ein ungegateter Call). **Empfehlung für Folgephase:** try/catch um die Buchung ziehen oder Reserve-Freigabe call-unabhängig machen.
2. **Bis zu 6 s zusätzliche synchrone Latenz** auf `POST /api/calls` (`PRECALL_BRIEFING_TIMEOUT_MS=6000`, `maxRetries 0`), während die Budget-Reserve bereits gehalten wird. Keine Idempotency-Key/Doppel-Dial-Guard auf der Route → Client-Retry (z. B. via MCP) wird wahrscheinlicher. Kein Gate-Bypass, aber messbar höhere Kollisionswahrscheinlichkeit.
3. **`contextReceivedMeta`-Semantikdrift:** meldet bei aktivem Flag jetzt den modell-erzeugten Kontext als „received", während der bestehende Kommentar „was vom optionalen context tatsächlich ankam" den Owner-Input meint. Nur Booleans, rein observability-seitig, flag-off byte-identisch — aber Doku/Semantik driften auseinander.
4. **`briefingLlm`-Konstruktion beim Modul-Import** (`src/precall-briefing.js:88`), auch bei ausgeschaltetem Flag, liest `briefingTimeoutMs` zur Eval-Zeit. Konsistent mit bestehendem `claude.js`-Muster, aber ein Runtime-config-Override schlägt auf den Timeout nicht mehr durch.

---

## 5. Clean-Code-Audit

**Verdikt: PASS** (kein S1, kein S2, `blocker: false`)

- **S1 (Blocker):** keine.
- **S2 (Fragilität):** keine.
- **S3 (Beobachtungen, nicht blockierend):**
  1. `src/precall-briefing.js` · `agentToolNames()` (neuer Export in `claude.js`) hat keinen direkten Unit-Test, nur indirekte Abdeckung über B9 (`system`-Block enthält „end_call"/„take_message"). Optional: kleiner isolierter Test, nicht blockierend.
  2. `src/routes/api-calls.js:104-119` · der neue `await fetchPrecallBriefing(...)`-Aufruf sitzt außerhalb jedes try/catch im Handler; ein Wurf aus `bookTokenUsage` (bewusst außerhalb des eigenen try/catch, Regel 1) würde nicht als 500 beantwortet, sondern bis zum Client-Timeout hängen und nur im globalen `unhandledRejection`-Log landen. Bestehendes Handler-Muster, durch die pure/nebenwirkungsarme Natur von `bookTokenUsage` praktisch unerreichbar; falls gewünscht: try/catch mit Fallback auf `ctx.context = null`.
- **S4:** keine.

**Pass-Notes:** Sehr hohe Testabdeckung für eine reine Diff-Prüfung (B1–B12, BR1–BR2, HP1–HP5). System-Prompt stimmt wörtlich mit Anhang B.1 überein; die zwei dokumentierten Abweichungen (D9 Owner-Text/Ziel in `user`-Message statt `system`, D10 `constraints` als viertes Eingabefeld) sind explizit kommentiert und sicherheitstechnisch sinnvoll. Preis-Fallback folgt exakt dem bestehenden P7a-Muster. Keine toten Importe, kein auskommentierter Code, keine abgeschalteten Sicherungen, keine unbenannten Magic Numbers.

**Top-Todos (alle optional, kein Merge-Blocker):**
- try/catch um `await fetchPrecallBriefing(...)` in `api-calls.js` erwägen (aktuell praktisch unerreichbar).
- kleiner direkter Unit-Test für `agentToolNames()`.

### Self-Check des Implementierers (Auszug)

Gegen `.claude/refs/clean-code.md` geprüft: G5 (eine `bookTokenUsage`-Definition, 3 legitime Call-Sites), G25 (benannte Konstanten `BRIEFING_MAX_TOKENS`/`BRIEFING_MAX_RETRIES`/`BRIEFING_TOOL_NAME`), G9/C5 (kein toter/auskommentierter Code), G12 (keine ungenutzten Imports, einzeln verifiziert), F1 (alle neuen Funktionen ≤1 Objekt-Argument), G30/G34 (kleine Einzelfunktionen ≤15 Zeilen), P15 (Modul-Top-Verdrahtung des LLM-Clients, kein Lazy-Init), N7 (Funktionsname trägt Nebeneffekt). Kommentare deutsch ohne Umlaute (verifiziert); Prompt-/Schema-Literale tragen bewusst echte Umlaute wie der Bestand.

---

## 6. Fix-Runden

**Keine.** Die Phase erreichte PASS bereits in der ersten Review-Runde — Safety-Review und Clean-Code-Audit ergaben keine Blocker (S1/S2 leer, `blockers: []`), daher entfiel jeder Self-Fix-Zyklus.

---

## 7. Offene Owner-/Deploy-Auflagen (NICHT-AGENTEN-ARBEIT)

Diese Punkte sind explizit nicht Teil des Abnahmekriteriums des Agenten und erfordern Owner-Entscheidungen bzw. echte Kosten:

1. **Prod-Anschaltung:** `PRECALL_BRIEFING_ENABLED=true` im Render-Dashboard setzen (Live-Service ist Dashboard-managed, nicht `render.yaml`) — erst nach Verifikation. Voraussetzung: `ASSISTANT_CONTEXT_ENABLED=true` (D3).
2. **Abnahmekriterium (c) nicht messbar ohne Owner-Entscheidung:** `scripts/convo-bench/runner.mjs` seedet Calls direkt über `seedState`/`seedCall` und geht **nie** durch `POST /api/calls` — das Briefing läuft dort also aktuell gar nicht, und das Bench-Szenario `termin-duenn` pinnt bewusst `assistantContextEnabled: false` (exakte Live-Repro). Eine bench-seitige Verdrahtung (Runner ruft `fetchPrecallBriefing` und seedet den erzeugten `context`) ist bewusst **nicht** Teil von P8 (Scope) und verändert die Vergleichbarkeit des Szenarios — braucht eine Owner-Entscheidung.
3. **Probeanruf** mit aktivem Briefing (`PRECALL_BRIEFING_ENABLED=true`) — echte Anthropic-Kosten, vom Owner auszulösen.
4. **Datenschutz-Bestätigung:** kein neuer Auftragsverarbeiter (ausschließlich Anthropic, wie von P8 vorgegeben), keine neue Datenkategorie (`objective`/`briefing`/`constraints`/`to` gehen bereits heute an denselben Anbieter). Kein Handlungsbedarf an der Datenschutzerklärung — vom Owner zu bestätigen, nicht vom Agenten zu ändern.

**Restrisiken / Beobachtungspunkte aus Safety-Review, vor scharfer Live-Schaltung zu würdigen** (siehe §4 Concerns für Details):

- Reserve-Leak-Fenster zwischen Budget-Reservierung und `store.createCall` verbreitert sich um den awaited Briefing-Aufruf — Risiko praktisch gering und konservativ fehlgerichtet, aber als Folgephase empfohlen (try/catch um die Buchung oder call-unabhängige Reserve-Freigabe).
- Bis zu 6 s zusätzliche synchrone Latenz auf `POST /api/calls` bei gehaltener Budget-Reserve erhöht die Wahrscheinlichkeit von Client-Retries/Doppel-Dial-Versuchen (kein Gate-Bypass, aber messbar).
- `contextReceivedMeta` meldet bei aktivem Flag den modell-erzeugten statt nur den Owner-Kontext als „received" — Doku-Kommentar an der bestehenden Stelle sollte bei Gelegenheit nachgezogen werden.
- Akzeptiertes Restrisiko aus dem Plan (Pre-Mortem): das Briefing kennt `call.language` nicht — bei fr/en-Calls kann der HINTERGRUND-Block in der Sprache des Owner-Texts stehen. Wird nie gesprochen, Prompt-Labels sind ohnehin deutsch (P0-Entscheidung); bewusst außerhalb des Scopes, hier als Beobachtungspunkt geführt.
