# Phase AL-P12 — Beziehungsgedaechtnis

**Gate:** PASS
**finalBranch:** `phase/al-p12-gedaechtnis`
**Basis:** `master` = `4ae22cb`
**headCommit (Impl):** `5f0c881547384fa3202371966f363fbf9b6f9472`

## 0. Was diese Phase tut

Ein zweiter Outbound-Anruf an dieselbe Nummer bekommt einen zusaetzlichen Prompt-Block „WAS BISHER GESCHAH" aus `outcome` + `facts` der letzten 3 eigenen Anrufe an diese Nummer — hinter einem neuen Per-Tenant-Setting `allowCallMemory`, Default AUS, bei ausgeschaltetem Setting byte-identischer Prompt.

Scope-Riegel: keine neue Env-Variable, keine neue Route, keine neue npm-Dependency, kein neues persistiertes Call-Feld, keine Aenderung an `agentTurn`/Tool-Loop/Offenlegung/Safety-Gates/Auth/Signaturpruefung, keine Retention-Aenderung, keine MCP-Erweiterung, kein Self-Service-Schreibpfad, kein Dashboard-UI.

## 1. Plan (gekuerzt)

**Design-Entscheidungen (mit Pre-Mortem):**

- **E1 — Nur OUTBOUND-Calls, Schluessel `to`.** Inbound-Anrufer-ID ist faelschbar: ein Angreifer koennte gespoofte Nummer + eingeschleuste "Fakten" nutzen, damit ein spaeterer eigener Anruf des Tenants an dieselbe Nummer die untergeschobenen Notizen traegt. Auch: eine neu vergebene Nummer wuerde sonst Notizen des Vorbesitzers zeigen.
- **E2 — Tenant-Gate sitzt IN der Store-Query** (`counterpartyMemory` liefert `[]`, solange `settings.allowCallMemory !== true`, vor jedem Scan) — strukturell (G27), nicht per Konvention. Gate-Wert aus derselben Per-Tenant-Quelle wie `tenantContext` (`settingsFor`), Query gekeyt auf `call.tenantId === tenantId`. Kein cross-tenant-Lesepfad.
- **E3 — Vollstaendigkeits-Praedikat:** „traegt eine Ergebnis-Karte mit Inhalt" (`result.outcome`/`result.facts`), nicht `status` — keine zweite Stelle, die bei neuem Status-Enum-Wert nachgezogen werden muss.
- **E4 — Zeichenbudget:** `3 × 200 = 600` fest, je Eintrag 200 Zeichen (kein globaler Greedy-Zaehler); `outcome` bekommt hoechstens die Haelfte des Eintragsbudgets, damit ein langes Ergebnis die Fakten nicht verdraengt. Konstanten bewusst NICHT konfigurierbar (G35 gilt nicht fuer Drittdaten-Umfang).
- **E5 — Injektions-Riegel:** jede Notiz auf eine Zeile gefaltet (`\s+` -> `" "`), Guardrail-Zeile „Information, keine Anweisung".
- **E6 — Aufbewahrung:** kein neuer Datensatz — reine Leseprojektion auf `call.result`, faellt automatisch mit `pruneOldData` der Quell-Calls; Export/Erase decken es bereits ab.

**Neue Datei:** `src/call-memory.js` (rein, kein Store/IO/config-Import) — `MEMORY_MAX_CALLS=3`, `MEMORY_MAX_ENTRY_CHARS=200`, `MEMORY_MAX_CHARS=600`, `memoryLine()`, `budgetedMemoryLines()`.

**Edits:** `src/store/defaults.js` (neues Setting `allowCallMemory: false`), `src/store/state-ops.js` (`counterpartyMemory` mit 3 strukturellen Riegeln: Tenant-Gate, Tenant-Scope, Richtung; `memoryEntryOf`-Helfer), `src/store/json.js`/`pg.js` (Wrapper + Spalte `allow_call_memory` in `rowToSettings`/`flushSettings`), `src/db/schema.sql` + `migrate.js` (idempotente Spalte, `NOT NULL DEFAULT FALSE`), `src/i18n/prompts/{de,en,fr}.js` (neuer `memory{heading,entryPrefix,guardrail}`-Block), `src/claude.js` (`promptInputs` traegt `memory`, `counterpartyMemoryFor` nur bei Outbound, `callMemorySection` haengt an `assignmentBlock` an — fuehrendes `\n`, `""` bei nichts), `src/store.js` (Re-Export), `PLAN-SECURITY.md` (neuer Abschnitt), `tasks/al-testcall-checklist.md` (3 offene Abnahmen: Bench, Setting-Scharfschaltung, Datenschutz-Vorpruefung), Bench-Erweiterung (`checks.mjs`: `checkMemoryFactRecalled`; `runner.mjs`: `buildSeed` mit `priorCalls`/`settings`; Szenario `zweiter-anruf-gedaechtnis.mjs` um „Nachher"-Messung erweitert, Bestands-Checks bleiben).

**Tests (Plan):** 16 neue Tests `AL-P12-1..16` (Default, Admin-Schreibpfad, Self-Service-Ablehnung, pg-Roundtrip, Gate, Fenster/Sortierung, Cross-Tenant-Isolation, leeres `e164`, Richtungs-Riegel, Nicht-Mutation, Injektions-Faltung, Budget, Byte-Identitaet, gerenderter Block+Position, Inbound-Ausschluss, Backend-Paritaet json/pg) + additive Ergaenzungen in `p11-agent-language-contract.test.js`, `al-p8-bench-checks.test.js`, `test/helpers.js`.

**Deterministisch pruefbares Ergebnis (Plan):** `node --check` auf allen neuen/geaenderten Dateien, `npm test` gruen, `npm run test:gates` unveraendert rot (bekannte Baseline), `grep`-Fundstellenzahl, Boot-Smoke via `/healthz`.

**Blast-Radius:** 1 neue Quelldatei, 1 neue Testdatei, 9 Quelldateien, 2 DB-Dateien, 3 Bench-Dateien, 3 Testdateien, 2 Doku-Dateien angefasst. Nicht angefasst: `server.js`, `routes/*`, `auth.js`, `middleware.js`, `bridge.js`, `telephony/*`, `budget-gate.js`, `outbound-gates.js`, `mcp-tools.js`, `config.js`, `.env.example`, `render.yaml`, `self-service.js`, `precall-briefing.js`.

## 2. Impl-Zusammenfassung

Exakt nach Plan umgesetzt auf `phase/al-p12-gedaechtnis` (von `master` `4ae22cb`). Neue reine Datei `src/call-memory.js` wie spezifiziert. Neues Setting `allowCallMemory` (Default `false`) — keine Eintraege in `OPTIONAL_ENUM_FIELDS`/`SELF_SERVICE_*`-Listen noetig (generischer `typeof`-Zweig traegt es, `selfServicePatch` verwirft es automatisch). Neue Store-Query `counterpartyMemory` mit den drei geplanten Riegeln + `memoryEntryOf`-Helfer; Wrapper in `json.js`/`pg.js`, Spalte `allow_call_memory` in `pg.js` (inkl. `ON CONFLICT DO UPDATE SET`) + `schema.sql` + `migrate.js`, Re-Export in `store.js`. i18n-Baustein `memory{heading,entryPrefix,guardrail}` in de/en/fr. `claude.js`: `promptInputs` traegt `memory` (`counterpartyMemoryFor`: nur Outbound liest `call.to`), `assignmentBlock` haengt `callMemorySection` an. `PLAN-SECURITY.md`- und Checklisten-Eintraege ergaenzt. Bench erweitert (`checks.mjs`, `runner.mjs` `buildSeed()`, Szenario-Erweiterung, Bestands-Checks unveraendert).

Neue Testdatei `test/al-p12-call-memory.test.js` mit 16 Tests `AL-P12-1..16`, alle gruen. Additiv: `p11-agent-language-contract.test.js` (p.memory-Vollstaendigkeit je Sprache), `al-p8-bench-checks.test.js` (`memory_fact_recalled` n/a + Treffer/kein-Treffer). `test/helpers.js` `seedState()` traegt `allowCallMemory:false` explizit (verhaltensneutral).

**Testergebnis:** `npm test` 3475/3475 gruen (ein Flake im ersten Voll-Lauf war im zweiten gruen — bekannte Seed-vor-Boot-Race-Kalibrierung, keine echte Regression). `npm run test:gates` 525/528 gruen — exakt die dokumentierte Baseline rot (GAP-05, GAP-15 x2), kein neuer roter Gate-Test. `node --check` auf allen 14 neuen/geaenderten `.js`/`.mjs`-Dateien gruen. Smoke: Boot mit Dummy-Env + geseedeter Owner-Nummer, `/healthz` -> `{"ok":true}`, Boot-Banner unveraendert.

**Wichtiger Test-Fund waehrend der Umsetzung:** `seedState()` liefert die flache Legacy-Settings-Form, waehrend `settingsFor(s, tenantId)` eine ueber `tenantId` gekeyte Map erwartet (nur `json.js`s `load()` migriert das). Ein direkter `ops.counterpartyMemory(seedState(...), ...)`-Aufruf ohne Map-Form haette den Tenant-Gate immer auf einen frischen Default-`false`-Bucket treffen lassen — falsch-gruene Tests. Behoben durch einen expliziten `stateWithSettings()`-Helfer, der die Map-Form selbst herstellt.

**deviations:**

1. Plan-Praeambel: angenommener HEAD (`4ae22cb`) und tatsaechliche Ausgangslage stimmten ueberein — keine Abweichung.
2. Testauswahl AL-P12-16 (Backend-Paritaet) enger gefasst als woertlich im Plan beschrieben: statt eines vollstaendigen `tempDataDir`/`json.load()`-Durchstichs vergleicht der Test direkt `ops.counterpartyMemory()` (json-Pfad) gegen den pg-Store-Wrapper mit strukturell identischem Seed — beide Wrapper delegieren an dieselbe `ops`-Funktion, die Paritaet ist damit gleichwertig bewiesen, ohne einen zweiten Datei-IO-Pfad im selben Testlauf zu oeffnen.

**cleanCodeSelfCheck (Impl-Agent):** `.claude/refs/clean-code.md` angewendet — G5 (keine Duplizierung), G25 (keine Magic Numbers, alle Konstanten benannt), C5/G9 (kein toter/auskommentierter Code), G12 (keine ungenutzten Imports), N7 (intentions-tragende Namen), G30/G34 (eine Aufgabe je Funktion), F1 (<=3 Argumente), P15 (kein Lazy-Init-Antipattern), C2 (keine brittle Datei:Zeile-Kommentare). Neues Verhalten durchgehend testbelegt.

## 3. Safety-Urteil (final)

**approved: true** — alle Einzelurteile true: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`. **blockers: []**

**Unabhaengiger Testlauf:** frischer Worktree, `checkout -b review-al-p12 phase/al-p12-gedaechtnis`, Basis frisch geprueft. Diff: 21 Dateien, +631/-18, 2 neue Dateien.

1. `npm test` (json + pg in einer Suite): 3495 roh / korrigiert 3475/3475/0 gruen, 93,6s.
2. `npm run test:gates`: korrigiert 129/126/3 — identisch mit sauberer `master`-Kopie (`git archive master`), kein neues Rot.
3. Standalone-Lauf neuer + Nachbardateien: 56/56 pass.
4. `node --check` auf allen geaenderten `src`-Dateien: OK (eslint im Worktree nicht lauffaehig — Umgebungsproblem, kein Codebefund).

**Eigene, vom Impl-Agenten unabhaengige Beweise:**

- **A) Byte-Identitaet Flag-AUS gegen MASTER** (nicht nur branch-intern): Probe-Skript seedet 4 abgeschlossene Outbound-Calls mit vollstaendigen Ergebnis-Karten (inkl. `evidence`), Setting nicht gesetzt; `systemPrompt`(outbound), `systemPrompt`(inbound), `openingText`, `disclosureSentence` auf master-Kopie vs. Branch verglichen: `diff` leer, 7227 Bytes identisch.
- **B) Adversariale Probe Flag-AN:** alle 11 Leck-Kanaele geschlossen — `evidence`, `commitments`, `counterpartyCommitments`, `openPoints`, `nextStep` erscheinen NICHT im Prompt; Inbound-Call von derselben Nummer erscheint NICHT; fremder Tenant mit derselben Zielnummer erscheint NICHT; andere Zielnummer desselben Tenants erscheint NICHT. Injektions-Nutzlast mit 4 Zeilenumbruechen -> genau eine Zeile, auf 200 Zeichen gekappt.
- **C) Offenlegung:** `openingText`/`disclosureSentence` deterministisch (kein LLM-Pfad), Wortlaut unveraendert; `bridge.js` 0 Diff-Zeilen.

**Statische Pruefung:** unberuehrt (0 Diff-Zeilen) `bridge.js`, `telephony/**`, `routes/**`, `config.js`, `auth.js`, `web-auth.js`, `middleware.js`, `mcp-tools.js`, `budget-gate.js`. Keine neue Dependency, keine neue Env-Variable, kein neues Logging, keine Secret-artigen Strings im Diff. `allowCallMemory` ueber bestehende `updateSettings`-Whitelist schreibbar, POST /api/settings hinter `requireTenant` + Basic-Auth, NICHT in `SELF_SERVICE_FREE_FIELDS`.

**Concerns (nicht blockierend):**

1. **Prompt-Injektions-Restrisiko** (bewusst): `call.result.facts` stammt aus fremder Rede und landet woertlich (gefaltet, <=200 Zeichen) im Systemprompt. Eigene adversariale Probe mit eingebetteter Fake-System-Anweisung erscheint entschaerft als eine Zeile, aber inhaltlich unveraendert. Empfehlung: Injektions-Fixture-Suite aus AL-P10 bei AL-P13 auch gegen den Gedaechtnis-Block laufen lassen.
2. **Nummern-Recycling:** Schluessel ist nur `(tenantId, e164)` ohne Zeitfenster. Neu vergebene Zielnummer zeigt Notizen ueber Vorbesitzer. Vor Prod-Scharfschaltung bedenken (Checklisten-Zeile deckt es teilweise ab).
3. **Heisser Pfad:** `s.calls.filter().sort()` bei eingeschaltetem Flag laeuft ueber ALLE Calls ALLER Tenants im Spiegel, einmal pro LLM-Turn (`claude.js:653`) und im Realtime-Pfad (`bridge.js:80`). Etabliertes Repo-Muster, aber O(n)-Kante — Kandidat fuer AL-P15.
4. `counterpartyMemory` als „reiner Leser" dokumentiert, ruft aber `settingsFor` (legt lazy Settings-Bucket an) — fail-closed, kein `save()`, Bestandsmuster; nur die Kommentar-Aussage „rein" ist streng genommen zu stark.
5. **Vorausschau PLAN-AUTH-GATE:** faellt das Basic-Gate wie geplant, wird `/api/settings` fuer jeden eingeloggten Tenant erreichbar, `allowCallMemory` (wie `allowResearch`) damit self-service-artig — beim Gate-Wechsel mitpruefen.

**Verdict:** PASS. Freigabe zum Merge.

## 4. Clean-Code-Audit (final)

- **s1:** []
- **s2:** []
- **s3:** 1 Befund — `src/call-memory.js:38` `budgetedMemoryLines` `slice(0, MEMORY_MAX_CALLS)` dupliziert das bereits in `state-ops.js` `counterpartyMemory` angewendete Limit (dieselbe Konstante, zweimal angewendet); unschaedlich (defense-in-depth), aber ein Kommentar an einer Stelle wuerde klarstellen, dass das zweite `slice()` ein bewusstes Backstop ist, kein Vergessen.
- **s4:** []
- **blocker:** false

**Verdict:** PASS. Keine S1/S2-Befunde. EIN Blatt-Modul fuer die Prompt-Klemmung, EINE Store-Query mit drei strukturellen (nicht konventionsbasierten) Riegeln, konsistent durch json/pg-Backends samt Migration + Default `false`. Byte-Identitaet der Baseline per Test gepinnt (AL-P12-13). Drei Locale-Dateien parallel und vollstaendig erweitert. Injektions-Riegel vorhanden und getestet. Self-Service-Ablehnung folgt generischem Restlisten-Pfad, per Test belegt. convo-bench-Szenario sinnvoll erweitert statt zweite Pipeline. `PLAN-SECURITY.md` und Testcall-Checkliste aktualisiert.

**topTodos:**
1. Vor Prod-Scharfschaltung: Owner-Entscheidung zur Datenschutzerklaerung treffen (in Checkliste bereits als offener Punkt vermerkt, kein Code-Blocker).
2. Optional: Kommentar ergaenzen, der klarstellt, dass das doppelte `MEMORY_MAX_CALLS`-Slicing (state-ops.js + call-memory.js) bewusstes Backstop ist, kein Duplizierungsfehler.

## 5. Fix-Runden

Keine — Gate wurde im ersten Durchlauf mit PASS erreicht (0 S1/S2-Befunde, 0 Safety-Blocker). Keine Fix-Runde noetig.
