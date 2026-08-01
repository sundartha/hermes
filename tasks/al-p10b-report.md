# Detailbericht: Phase AL-P10b — `look_up` (Recherche IM Gespraech, Brave-Adapter, Flag AUS)

- **Gate-Status**: BLOCKED
- **finalBranch**: `phase/al-p10b-lookup-fix2`
- **Basis**: `master` @ `3651e8d`
- **HEAD (Impl-Commit)**: `3b39f796489d2b31f30eccb46e0b4b9482d4381a`

---

## 1. Plan (gekuerzt)

Ziel: neues MCP-/Tool-Werkzeug `look_up`, mit dem der Agent WAEHREND eines laufenden Outbound-Gespraechs hoechstens zweimal EINE kurze Sachfrage bei Brave Search nachschlaegt. Treffer landen ausschliesslich als `context.key_facts` im HINTERGRUND-Block des Prompts (mit Guardrail-Zeile), nie als Rohtext im `tool_result`. Alles hinter `LOOKUP_ENABLED` (Default AUS) — bei ausgeschaltetem Flag ist Werkzeugsatz und Prompt byte-identisch zum Bestand.

### Acht Kern-Entscheidungen (E1-E8), Abweichungen vom Plan-Wortlaut gegenueber dem Bestand begruendet

- **E1**: `look_up` steht in `agentTools(call)`, NICHT in `toolDefs()` — `toolDefs()` ist der richtungsblinde Satz beider Engines (Budget + Realtime-Bridge); ein Inbound-Anrufer duerfte das Werkzeug sonst sehen. Muster: `getConsultToolDef` (AL-P14).
- **E2**: `look_up` laeuft NIE durch `execTool` — der einzige `await` steht im Tool-Loop selbst. `execTool` bleibt synchron (A4: `bridge.js handleOpenAiEvent` ist nicht `async`). Ohne `case` fuer `look_up` bekommt die Realtime-Bridge automatisch `tc.unknownTool` — der "zweite Riegel".
- **E3**: `agentToolNames()` bleibt UNVERAENDERT — sonst wuerde das Precall-Briefing dem Modell eine Faehigkeit versprechen, die ein konkreter Call gar nicht hat. Als offener Punkt in die Checkliste, nicht stillschweigend geaendert.
- **E4**: Per-Tenant-Faktor liegt auf der PROFIL-Achse (`allowLookup`, JSONB, keine Migration), nicht auf der Settings-Achse (feste Spalten, haette Hand-Migration gebraucht). Fail-closed: `DEFAULT_PROFILE.allowLookup=false`, `PAID_PLAN_PROFILE.allowLookup=false`, `OWNER_PROFILE.allowLookup=true`.
- **E5**: Kontingent-Zaehler ist EPHEMER (kein DB-Feld, Muster `countNoSpeechTurn`) — akzeptiertes Restrisiko: Instanzwechsel mitten im Call setzt ihn zurueck (max. `LOOKUP_MAX_PER_CALL` zusaetzliche Suchen in genau diesem Call).
- **E6**: `LOOKUP_MAX_PER_CALL` und `LOOKUP_TIMEOUT_MS` sind benannte Modul-Konstanten, KEINE Env-Vars (Praezedenz `CONSULT_TIMEOUT_MS`) — ein zu gross gesetzter Wert waere eine neue abgeschaltete Sicherung.
- **E7**: Treffer gehen ausschliesslich ueber `call.context.key_facts` in den naechsten `systemPrompt(call)` — daraus folgt zwingend `ASSISTANT_CONTEXT_ENABLED` als Pflicht-Faktor des Gates (sonst rendert `assistantContextSection` leer und die Suche waere bezahlter Muell).
- **E8**: Der Inhalts-Riegel ist ehrlich enger als der Plan-Satz A3 ("kein Name, keine Rufnummer, keine Adresse, kein Gesundheits-/Finanzdetail"). Deterministisch durchgesetzt: Ziffernfolgen ab 5, E-Mail, `call.to`, `call.callerName`, woertliche Transkript-Uebernahmen. Eine Gesundheits-/Finanz-Schlagwortliste wird bewusst NICHT gebaut (sprachabhaengig, lueckenhaft, taeuscht Schutz vor) — als Restflaeche in Tool-Description + `PLAN-SECURITY.md` gefuehrt.

### Pre-Mortem (Auszug)
| Todesursache | Gegenmittel |
|---|---|
| Inbound-Fremder loest Suchgebuehren aus | Richtungs-Gate im Registrierungs-Gate + kein `execTool`-Case, beides test-gepinnt |
| Kosten laufen weg | Gebuehr vor dem Absenden gebucht (auch bei Timeout), Kontingent 2/Anruf, Budget-Gate vor jeder Runde |
| Fremdtext steuert den Agenten | Treffer nur in `key_facts` -> HINTERGRUND + Guardrail; Mandat/Offenlegung/Wahlziel strukturell unerreichbar |
| Angerufener wird zum Suchindex | Egress-Riegel serverseitig vor dem Absenden |
| Stille Leitung waehrend Suche | Bruecke (AL-P7b) feuert vor dem `await` |
| Secret leakt | Key nur in `config.research.braveSearchApiKey`, nie geloggt |
| Turn reisst Provider-Hardcut | `LOOKUP_TIMEOUT_MS=2500` gegen `turnLoopDeadlineMs=11500` |

### Neue Dateien
- `src/research/adapters/brave-search.js` — HTTP-Adapter (AbortController, kein Wurf, `{ok,facts|reason}`)
- `src/research/lookup-guard.js` — reine Egress-/Ingress-Filter (`sanitizeLookupQuery`, `lookupFactsFrom`)
- `src/research/in-call.js` — Entscheidungslogik (`lookupProviderFor`, `lookupAvailableFor`, `performLookupRequest`)
- `test/al-p10b-lookup-guard.test.js`, `test/al-p10b-lookup.test.js`

### Edits (Auszug)
`src/research/ports.js` (Typedef `InCallSearchProvider`), `src/research/registry.js` (`inCallSearchProvider()`), `src/config.js` (Namespace `research` 3->7 Keys: `lookupEnabled`, `lookupSearchFeeCents`, `braveSearchApiKey`, `braveSearchApiBase`), `src/llm-usage.js` (`bookLookupSearchFee`), `src/store/state-ops.js` (`addLookupFacts`, `countCallLookup`, `callLookups`, Verallgemeinerung `mergeConsultFacts` -> `mergeContextFacts`), `src/store/{json,pg}.js` + `src/store.js` (Wrapper-Paritaet, keine Schema-Migration — `context` ist bereits JSONB), `src/store/defaults.js` + `src/plans.js` (`allowLookup`), `src/claude.js` (vier chirurgische Edits: `promptInputs`/`boundaryRules`, `agentTools`, Tool-Loop-`await` + `toolResultText`-Extraktion), `src/utils/text.js` + `src/consult/question.js` (reiner Move der Zitat-Helfer, G5), `src/i18n/prompts/{de,en,fr}.js` (4 neue Schluessel je Sprache), `.env.example`, `render.yaml`, `test/helpers.js` `BASE_ENV`, `README.md`, `PLAN-SECURITY.md`, `tasks/al-testcall-checklist.md`, `tasks/assistant-leap-chain.md`.

### Tests (Plan)
- `al-p10b-lookup-guard.test.js`: 8 reine Faelle (Name/Rufnummer/Ziffernfolge/E-Mail/Zitat/Kappe/Fakten-Deckel).
- `al-p10b-lookup.test.js`: 14 integrierte Faelle (Flag-aus-Byte-Identitaet, Registrierung, Richtungs-Gate, execTool-Riegel, Fail-closed pro Faktor, HINTERGRUND-Merge, Bruecke-vor-Suche-Reihenfolge, Kontingent, Gebuehr, Timeout, `end_call`-Sonderfall, Injektion, Egress am Turn, PII-freie Logs).
- Angepasste Buchhaltungs-Pins: `config-namespaces.test.js` (research 3->7, Gesamt 134->138), `config-money-manifest.test.js` (`lookupSearchFeeCents`), `profile-a2-activation.test.js` (PROFILE_FIELDS 7->8).

### Deterministisch pruefbares Ergebnis (Soll)
`node --check` ueber alle neuen/geaenderten Dateien gruen, neue Testdateien `# fail 0`, Regressionsauswahl unveraendert gruen, `npm test` `# fail 0`; `npm run test:gates` darf rot bleiben. Blast-Radius: 6 neue Dateien (0 neue Dependencies), 17 Bestandsdateien chirurgisch editiert, keine DB-Migration, kein Eingriff in `execTool`/`toolDefs`/`bridge.js`/`disclosureSentence`/Gates.

---

## 2. Implementierungs-Zusammenfassung

`look_up` wurde exakt nach obigem Plan gebaut: vier unabhaengige Riegel (Richtungs-Gate outbound+aktiv als Schnittmenge mit `ASSISTANT_CONTEXT_ENABLED` + Profil-Recht `allowLookup` + gesetztem `BRAVE_SEARCH_API_KEY`; Kontingent 2/Anruf mit Vorab-Buchung der Gebuehr; serverseitiger Egress-Filter; `execTool` ohne `look_up`-Case -> `unknownTool` als zweiter Riegel fuer die Realtime-Bridge). Der einzige `await` im Tool-Loop steht nach der AL-P7b-Ueberbrueckung und vor dem `tool_result`-Mapping. Keine neue Dependency, keine DB-Migration (context bleibt JSONB, Kontingent-Zaehler ephemer).

**Verifikation laut Impl-Agent**: `node --check` auf 19 Dateien gruen, eslint sauber, 23 neue Testfaelle gruen, Regressionsauswahl 87/0, volle Suite 3694 pass / 0 fail (zweimal gefahren). Smoke-Test lokal (PORT 3999, `SKIP_TWILIO_SIGNATURE_CHECK=true`, `LOOKUP_ENABLED=false`): `/healthz` 200, `/voice/incoming` 200 mit unveraendertem TeXML (Bestandsverhalten bei ausgeschaltetem Flag). Der eingeschaltete Pfad wurde NICHT per Smoke gefahren (braucht echten Brave-Key) — nur ueber den lokalen Mock in den Tests abgedeckt.

### Deviations (vom Impl-Agenten selbst gemeldet)
1. **E8-Detail**: `NON_PRINTABLE = /\p{C}/gu` statt literaler Control-Chars in der Zeichenklasse — gleiche Wirkung, lesbarer/aenderungssicherer Quelltext.
2. **Zwei Ziffern-Normalformen statt einer**: Laengenpruefung auf separator-reduzierter Form (sonst waere "oeffnet 2026 um 20 Uhr" ein Fehlalarm), `call.to`-Vergleich auf reiner Ziffernfolge (sonst haelt er ueber Schreibweisen hinweg nicht). Beide Faelle test-gepinnt.
3. **Test-Naht**: Der Ueberbrueckungs-Abnehmer (`onSpeechChunk`) wird nur im Reihenfolge-Test uebergeben, sonst ein No-op — der nicht-SSE-faehige Anthropic-Mock kann eine gestreamte Anfrage sonst nicht beantworten.
4. **Injektions-Test** vergleicht `shouldSuppressEndCall` nicht gegen einen Vor-Turn-Schnappschuss (weicht wegen Bestandsverhalten im Transkript-Schreiben ohnehin ab), sondern zeigt: mit substanzieller `caller`-Zeile `false`, mit leerem Transkript `true`.
5. `consult/question.js` re-exportiert `VERBATIM_QUOTE_MIN_WORDS` aus `utils/text.js` fuer Bestands-Importpfade.
6. `.env.example` dokumentiert `BRAVE_SEARCH_API_BASE` als auskommentierten Test-Override statt leerem Key (sonst wuerde ein kopiertes `.env` die Anbieter-Basis leeren); in `test/helpers.js` `BASE_ENV` steht er als `""`.
7. `npm test` lieferte einmal via Shell-Pipe keine Kind-Ausgabe (Exit 194 ohne Log); massgeblich gefahren/ausgewertet wurde `NODE_ENV=test node test/i18n-catalog-run.mjs regression` -> 3694 pass / 0 fail, zweimal reproduziert.

---

## 3. Safety-Urteil (final)

**Verdict: BLOCKIERT** (eine Runde, ein Befund).

- `testsPassIndependently`: true — eigene Laeufe: `npm test` Lauf 1 zeigte 1 roten Test (`G2: /voice/outbound bleibt LLM-frei`, bekannter Voll-Last-Spawn-Race, isoliert 6/6 gruen), Lauf 2 voll 3694/3694; pg-Backend-Subset 111/111; `test:gates` 126/129 (3 rot = bekannter Vorbestand, kein AL-P10b-Bezug).
- `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`: alle **true**.
- `behaviorAsIntended`: **false** — hier sitzt der Blocker.

### Blocker (bestaetigt, nicht nur gelesen — eigene Probe)
Der Realtime-Pfad bekommt den Prompt-Satz "du kannst nachschlagen" OHNE das Werkzeug tatsaechlich anzubieten. `promptInputs()` in `src/claude.js` setzt `lookupAvailable: lookupAvailableFor(call)`, `boundaryRules()` rendert daraufhin `b.lookupAllowed`. `systemPrompt()` wird aber auch von `src/bridge.js` verwendet (`instructions(call) = systemPrompt(call) + realtimeSpeechStyle`), dessen Werkzeugsatz `realtimeTools(language) = toolDefs(language)` NIE `look_up` enthaelt (E1, bewusst). Empirisch gemessen (`LOOKUP_ENABLED=true`, `ASSISTANT_CONTEXT_ENABLED=true`, Key gesetzt, aktiver Outbound-Call, `VOICE_ENGINE=realtime`): Prompt sagt "kann nachschlagen: true", tatsaechliches `toolDefs`: nur `end_call,take_message`. Das ist eine neu eingefuehrte Faehigkeits-Unehrlichkeit im geteilten Code — genau der Caller, den CLAUDE.md ("Tools werden von Budget-Engine UND Realtime-Bridge genutzt!") verlangt, selbst zu greppen. Kein Gate-/Offenlegungs-/Auth-Bruch, in der heutigen Live-Konfiguration (`VOICE_ENGINE=budget`, Flag aus) nicht ausloesbar, aber unbeabsichtigt und nirgends als bewusste Abweichung dokumentiert.

Vorgeschlagener Fix: GRENZEN-Zeile an das im jeweiligen Zug tatsaechlich angebotene Werkzeug binden (bzw. `lookupAvailable` fuer den Realtime-Pfad fail-closed auf `false`) plus Regressionstest, der pinnt, dass der Realtime-Prompt nie `lookupAllowed` enthaelt solange `realtimeTools` kein `look_up` traegt. Alternativ als benannte Abweichung in Chain-Doc + `PLAN-SECURITY.md` fuehren.

### Concerns (nicht blockierend, festgehalten)
- Egress-Filter ist enger als Plantext A3 (kein Namens-/Adress-/Gesundheits-/Finanz-Filter durchgesetzt, nur Tool-Description) — als E8 ehrlich dokumentiert, aber Owner-Akzeptanz noetig vor `LOOKUP_ENABLED=true`.
- A3-Restschuld "Herkunftsmarkierung fuer Action-Items" nicht gebaut — offene Checklisten-Zeile.
- Gebuehr wirkt erst auf die naechste Runde (Budget-Gate prueft am Rundenkopf), nicht "vor der Ausgabe" im engsten Sinn — Fehlerrichtung sicher, Betrag klein (1 ct).
- Zwei `look_up`-Aufrufe in derselben Runde: nur der erste wird bearbeitet (Fehlerrichtung sicher), aber ungetestet/unkommentiert.
- `comparableWords` in `utils/text.js` hat keinen externen Konsumenten — Clean-Code-Nit.

---

## 4. Clean-Code-Audit (final)

**Verdict: PASS.** `blocker: false`. Keine S1/S2/S3/S4-Funde.

- Diff: ~1350 Zeilen ueber 32 Dateien (master -> `phase/al-p10b-lookup-fix2`).
- Master-Schalter + Secret fail-closed (geprueft in Test AL-P10b-5); vier unabhaengige Gates in `lookupProviderFor` in kostenguenstiger Reihenfolge.
- Egress-Riegel (`lookup-guard.js`) rein (kein Store/config/IO), deterministisch, ehrlich dokumentierte Grenze.
- Zitat-Erkennung sauber per G5-Dedup aus `consult/question.js` nach `utils/text.js` gezogen, kein Doppel mehr.
- `execTool` kennt `look_up` bewusst nicht (zweiter Riegel Realtime).
- Gebuehr vor dem Absenden gebucht (Regel 1), auch bei Timeout, nie bei serverseitig verworfener Query.
- Fremdtext hat genau einen Weg in den Prompt (`key_facts` -> HINTERGRUND mit Guardrail), durch Injektionstest belegt.
- Logs PII-frei (aktiv getestet).
- Alle Env-Vars zentralisiert in `config.js`, in `.env.example` UND `render.yaml` dokumentiert (Secret `sync:false`).
- Buchhaltungs-Pins konsistent nachgezogen (125->129, 134->138, 7->8 Profile-Felder).
- `test/al-p10b-lookup-hooks.test.js`: gezielter Regressionstest fuer einen in einer frueheren Runde gefundenen Haenger (`after()`-Hook griff bei fehlendem `before()` auf `undefined` zu, jetzt optional-chained + Kindprozess-Test).
- Keine Magic Numbers ohne benannte Konstante, keine toten Codepfade, keine neue abgeschaltete Sicherung, Verschachtelung <= 2-3 Ebenen, Funktionen kurz.

### Top-Todos (Clean-Code-Auditor)
1. Vor `LOOKUP_ENABLED=true` in Produktion: Datenschutzerklaerung um zweiten Auftragsverarbeiter (Brave) ergaenzen.
2. `npm test` explizit lokal auf dem Branch laufen lassen (Audit war reines Diff-Review ohne eigenen Testlauf).

---

## 5. Fix-Runden

**Runde 1 (r1)**: Einziger gemeldeter Blocker behoben — der `after()`-Hook in `test/al-p10b-lookup.test.js` dereferenzierte `anthropic`/`brave` ungeprueft (`anthropic.closeAllConnections?.()` — Optional-Chain sass an der Methode statt am Objekt), was beim Laufen der Datei durch den Gates-Filter (`--test-name-pattern`, kein vorheriges `before()`) zu einem Absturz fuehrte. Gefixt.

**Runde 2 (r2)**: Blocker aus dem vorherigen Safety-Review behoben durch Option B aus dem Finding (ersatzlose Streichung statt neuer Datenquelle): `call.callerName` ist seit der G1-Identitaets-Bindung in `state-ops.js createCall` hart `null` — kein Producer im gesamten Repo befuellt es (per `grep` bestaetigt), und der Test, der den Filter zuvor gruen zeigte, hatte den Wert kuenstlich gesetzt.

**Ergebnis nach r2**: Das finale Safety-Review (siehe Abschnitt 3) fand — unabhaengig von r1/r2 — einen NEUEN, eigenstaendigen Blocker (Realtime-Prompt vs. Realtime-Werkzeugsatz, `look_up`-Faehigkeits-Unehrlichkeit in `bridge.js`-Pfad). Dieser ist zum Zeitpunkt dieses Berichts NICHT behoben. **Gate-Status bleibt BLOCKED.**
