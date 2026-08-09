# Phase FIX-1 — Zusammenfassungs-Timeout + fehlende Token-Sorten im Log

**Gate: PASS**
**finalBranch:** `phase/fix1-summary-timeout`
**Basis:** `master` @ `6e8af94`
**headCommit:** `815b7108dd32d7bb24c90cf690646846e3b9e2a2`

## Ziel

Zwei zusammengehoerige Befunde beheben:

1. `summarizeCall` (Gespraechs-Nachbereitung) haengt am Sprechpfad-Timeout `LLM_REQUEST_TIMEOUT_MS` (3500 ms), obwohl sie detached nach dem Webhook laeuft. Eine 800-Token-Zusammenfassung braucht gemessen 7,7–9,0 s — strukturell unmoeglich innerhalb von 3500 ms.
2. Die `llm`-Metrik im Log traegt nur zwei der vier Token-Sorten (`cache_creation_input_tokens`, `cache_read_input_tokens`); `input_tokens`/`output_tokens` fehlen, obwohl die Buchung (`llm-usage.js`) alle vier kennt. Aus einer Live-Logzeile liess sich der gebuchte Betrag nicht rekonstruieren.

## Plan (gekuerzt)

### Verifikation am Code
- `src/claude.js` nutzt einen einzigen Modul-`llm`-Client, dessen Timeout aus `config.llm.llmRequestTimeoutMs` kommt — auch fuer `summarizeCall`.
- Zusammenfassung laeuft NICHT im Webhook: `call-termination.js` stoesst `bill()` fire-and-forget an, `call-finish.js` awaited `summarizeCall` separat.
- Muster fuer eine Nebeninstanz existiert bereits: `precall-briefing.js` baut sich einen eigenen `createLlmClient` mit `briefingTimeoutMs` und `BRIEFING_MAX_RETRIES = 0`.
- `src/llm.js` `metricsExtra` und `src/metrics.js` `llmCall` lassen nur die zwei Cache-Zaehler durch; die Buchung (`llm-usage.js`) kennt alle vier (`inputUncachedTokens`, `inputCacheWriteTokens`, `inputCacheReadTokens`, `outputTokens`).
- Katalog-Praefix `FIX1-` matcht das Gates-Muster nicht → Tests landen korrekt im Regressionslauf (`npm test`), nicht in `test:gates`.

### Entscheidungen
- **E1**: Zweite Client-Instanz statt Per-Request-Timeout (Timeout sitzt im SDK-Konstruktor, ein Per-Request-Wert wuerde Port-Vertrag + beide Adapter aendern → verworfen, Blast-Radius).
- **E2**: `CALL_SUMMARY_TIMEOUT_MS` Default 20000 ms — gemessen 7745/8856/8985 ms real, ~2,2× schlechtester Messwert als Reserve. Der Code-Default IST der Fix, da Render dashboard-verwaltet ist (kein garantiertes Env-Set).
- **E3**: `SUMMARY_MAX_RETRIES = 1` (Modul-Konstante, kein Env-Knopf) — Fehlgrund war Arithmetik (zu kurze Frist), kein flackerndes Netz; ein gescheiterter Summary-Versuch wird NICHT gebucht (anders als Briefing), also keine unsichtbaren Mehrfachkosten durch mehr Retries.
- **E4**: „gemeldet wird nur ein Wert > 0" gilt fuer alle vier Sorten gleich — 0 heisst in `LlmTokenUsage` „keine Token dieser Klasse", nicht „unbekannt" (das traegt `estimated: true`). Bestandstests `T-I13-3`/`T-L0-1` pinnen den Vier-Basis-Felder-Fall.
- **E5**: Schluesselnamen bleiben Anthropic-Namen (`input_tokens`/`output_tokens`), kein Rename der bestehenden zwei.
- **E6**: Gemeinsame Bauvorschrift `createSecondaryLlmClient` in `llm.js`, genutzt von `claude.js` UND `precall-briefing.js` (G5-Dedup statt zweiter fast-identischer Block); Briefing-Werte bleiben byte-identisch (abgesichert durch `cq-p8-briefing*.test.js`).

### Pre-Mortem (Auszug)
- Sprechpfad-Timeout NICHT mitgezogen: `llmRequestTimeoutMs` unangetastet, `FIX1-3` pinnt 3500 ms + Doku-Parity.
- Boot-Waechter/Turn-Budget lesen ausschliesslich `llmRequestTimeoutMs`, der neue Wert geht in keine Rechnung ein.
- Anthropic-Brownout: eigener Breaker pro Instanz kappt die Kette (Schwelle 5/10 s → 30 s open); bewusste Konsequenz: Nachbereitung ist vom Gespraechs-Breaker entkoppelt.
- Whitelist bleibt Whitelist (kein PII-Leck), `FIX1-5` beweist es explizit.
- Spawn-Tests: `BASE_ENV` pinnt `CALL_SUMMARY_TIMEOUT_MS=20000`, Anbieter wird per Mock oder liefert 401 (kein Retry, kein Haengen).

### Geplante Aenderungen
- `src/config.js`: neuer Key `summaryTimeoutMs` (`CALL_SUMMARY_TIMEOUT_MS`, Default 20000, min 1) + Namespace-Eintrag.
- `src/llm.js`: neue Exportfunktion `createSecondaryLlmClient({config, requestTimeoutMs, maxRetries, metrics})`; `metricsExtra` ergaenzt um `input_tokens`/`output_tokens`.
- `src/metrics.js`: `LLM_OPTIONAL_FIELDS`-Whitelist-Konstante ersetzt die vier Einzel-`if`s durch eine Schleife.
- `src/claude.js`: `SUMMARY_MAX_RETRIES = 1`, `summaryLlm` als eigene Instanz via `createSecondaryLlmClient`, `summarizeCall` nutzt `summaryLlm` statt `llm`.
- `src/precall-briefing.js`: auf `createSecondaryLlmClient` umgestellt (werte-identisch, keine Verhaltensaenderung).
- `src/telephony/call-termination.js`: Kommentarkorrektur (veraltete „~12s"-Angabe).
- `.env.example`, `render.yaml`: neuer Key dokumentiert/gesetzt.
- `test/helpers.js`: `BASE_ENV.CALL_SUMMARY_TIMEOUT_MS = "20000"`.
- Neue Testdatei `test/fix1-summary-timeout.test.js` (FIX1-1..3, echter HTTP-Mock); Ergaenzungen in `test/l0-metrics.test.js` (FIX1-4/5), `test/llm.test.js` (FIX1-6), `test/config-namespaces.test.js` (Zaehlungen 143→144, `llm` 14→15).

### Deterministisches Ergebnis (Plan-Vorgabe)
`node --check` auf allen geaenderten Dateien Exit 0; `npm test` exit 0, `# fail 0`, `# pass` ≥ 4116 (Basis 4110 + 6 neue FIX1-Tests); zwei Rotproben (Timeout zurueckbiegen → FIX1-1 rot; `input_tokens` aus Whitelist entfernen → FIX1-4/5 rot), danach zurueckgedreht.

## Implementierung — Zusammenfassung

Gemaess Plan umgesetzt und gemergt auf `phase/fix1-summary-timeout` (Base `master@6e8af94`).

- Eigener Per-Request-Timeout fuer die Gespraechs-Zusammenfassung (`config.llm.summaryTimeoutMs` / `CALL_SUMMARY_TIMEOUT_MS`, Default 20000 ms) ueber eine neue `createSecondaryLlmClient`-Instanz in `src/claude.js`, genau 1 Retry, statt des zu kurzen Sprechpfad-Timeouts (3500 ms, unveraendert).
- `src/precall-briefing.js` auf dieselbe extrahierte Bauvorschrift umgestellt (werte-identisch, keine Duplizierung).
- `src/llm.js` `metricsExtra` und `src/metrics.js` `llmCall` (jetzt ueber `LLM_OPTIONAL_FIELDS`-Whitelist-Konstante statt Einzel-`if`s) ergaenzt um die zwei fehlenden Token-Sorten `input_tokens`/`output_tokens` (>0-Regel unveraendert, gleiche Behandlung fuer alle vier Sorten).
- Doku (`.env.example`, `render.yaml`), `test/helpers.js` `BASE_ENV` und `test/config-namespaces.test.js` (Zaehlungen 143→144 Keys, `llm`-Namespace 14→15) nachgezogen.
- Kommentarkorrektur in `src/telephony/call-termination.js` (veraltete „~12s"-Angabe).

**Neue Tests:** `test/fix1-summary-timeout.test.js` (FIX1-1..3, echter lokaler HTTP-Mock, beweist die Timeout-Trennung end-to-end), `test/l0-metrics.test.js` (FIX1-4/5: alle vier Token-Sorten additiv + kein PII-Leck), `test/llm.test.js` (FIX1-6: Seam-Ebene, >0-Regel-Gegenprobe).

**Testlauf:** `npm test` 4116/4116 gruen (vorher 4110, +6 neue FIX1-Tests), 0 fail. Beide Rotproben aus dem Plan durchgefuehrt und bestaetigt (danach sauber zurueckgedreht, volle Suite erneut gruen):
- R1: Timeout auf `llmRequestTimeoutMs` zurueckgebogen → `FIX1-1` rot.
- R2: `input_tokens` aus `LLM_OPTIONAL_FIELDS` entfernt → `FIX1-4` und `FIX1-5` rot.

pglite-Backend-Tests liefen als Teil derselben `npm test`-Ausfuehrung mit (180 Testdateien referenzieren pglite/`STORE_BACKEND=pg`).

**Smoke-Test:** Server lokal gebootet (`SKIP_TWILIO_SIGNATURE_CHECK=true`, `bootstrap-tenant.js` fuer eine aktive Nummer, `COST_TRUING_REQUIRED_RECORD_TYPES` gesetzt), `/healthz` → 200, danach sauber beendet.

Keine Safety-Gates, Disclosure-Satz oder Auth-Pfade beruehrt. Keine neue npm-Dependency. `node_modules`-Symlink nicht committet (`git ls-files` bestaetigt 0 Treffer). Commit `815b710` auf Branch `phase/fix1-summary-timeout`.

**Geaenderte Dateien:** `src/config.js`, `src/llm.js`, `src/metrics.js`, `src/claude.js`, `src/precall-briefing.js`, `src/telephony/call-termination.js`, `.env.example`, `render.yaml`, `test/helpers.js`, `test/config-namespaces.test.js`, `test/l0-metrics.test.js`, `test/llm.test.js`.
**Neue Datei:** `test/fix1-summary-timeout.test.js`.

**Deviations:** keine.

## Safety-Urteil (final)

**Verdict: FREIGABE (approved).** Alle vier unantastbaren Regeln nachweislich unberuehrt (Safety-Gates, Offenlegung, Auth fail-closed, Secrets), Scope respektiert, Verhalten wie beabsichtigt. Unabhaengiger Testlauf im frischen Worktree: 4116/4116 gruen, beide Rotproben selbst nachgefahren und bestaetigt, zusaetzliche eigene Leck-Sonde gegen die Metrik-Whitelist (Prototype-/Gross-Klein-/Whitespace-Umgehung) — Whitelist dicht.

Positiver Zusatzbefund: der Fix STAERKT die pro-Tenant-Kostendecke — bei bisher strukturell scheiternden Summary-Aufrufen generierte der Anbieter die vollen 800 Token, gebucht wurde nichts (Buchung laeuft erst nach der Antwort); diese Token landen jetzt korrekt auf der Budget-Achse.

**Concerns (keine Blocker):**
1. `FIX1-3` prueft die Sprechpfad-Timeout-Invarianz per Quelltext-Regex (`readFileSync` + `/fallback:\s*3500/`), nicht per Laufzeit-Assertion — ein Refactoring, das das Literal stehen laesst aber nicht mehr nutzt, bliebe gruen. Fuer Doku-Parity richtig, fuer die Invariante waere ein envfreier Zweitprozess sauberer.
2. `precall-briefing.js`-Umstellung auf `createSecondaryLlmClient` steht nicht woertlich in der Spec — nachgerechnet verhaltensidentisch, ist die vom Clean-Code-Gate ohnehin verlangte G5-Dedup. Formal Scope-Rand, kein Blocker.
3. `summarizeCall` haengt jetzt an Modul-Konstante `SUMMARY_MAX_RETRIES=1` statt `config.llm.llmMaxRetries` — ein Betreiber mit `LLM_MAX_RETRIES=0` erreicht den Zusammenfassungspfad damit nicht mehr. Begruendet und dokumentiert.
4. `summaryLlm` wird beim Modul-Import konstruiert (liest `summaryTimeoutMs` einmalig) — identisch zum Bestandsmuster `briefingLlm`, nicht neu.
5. Worst-Case-Wanduhrzeit der detachten Nachbereitung steigt von ~10,5 s (3×3500) auf ~40 s (2×20000); kein Gate haengt daran, Anbieterkosten sinken sogar (2 statt 3 volle Generierungen). Bewusste Konsequenz.
6. `npm run test:gates` konnte wegen verwaister Testserver aus vorangegangenen Laeufen nicht komplett durchlaufen; die haengende Datei laeuft isoliert gruen (5/5), und die Gates-Partition ist statisch nachweislich unveraendert (kein `FIX1-`-Test matcht das Katalogmuster).

## Clean-Code-Audit (final)

**Verdict: PASS**, `blocker: false`. Keine S1/S2-Befunde.

- **S1** (Architektur/Korrektheit-Verstoesse): keine.
- **S2** (harte Clean-Code-Verstoesse): keine.
- **S3** (Hinweise, kein Verstoss): dieselbe Mess-Begruendung (7745/8856/8985 ms, Faktor 2) steht wortgleich an drei Stellen (`.env.example`/`render.yaml`/`src/config.js`) — gewollte Doku-Parity-Konvention laut CLAUDE.md, keine Aenderung noetig.
- **S4** (Stil/Kosmetik): keine.

**passNotes:** `createSecondaryLlmClient` zieht die vorher inline in `precall-briefing.js` gebaute Verdrahtung heraus — eine Quelle fuer beide Nebenpfade, G5-Verbesserung gegenueber Bestand. `metrics.js`: vier `if`-Checks durch `LLM_OPTIONAL_FIELDS`-Whitelist + Schleife ersetzt (weniger Wiederholung). Sicherheits-/kostenrelevante Doku praezise (eigener Breaker pro Instanz explizit als bewusste Konsequenz benannt, `SUMMARY_MAX_RETRIES=1` gegen unsichtbare Mehrfachkosten begruendet). Elf neue/betroffene Tests lokal gruen, `node --check` auf allen sechs geaenderten `src`-Dateien sauber. Keine Magic Numbers ohne Konstante, keine Umlaute in Kommentaren, keine toten Importe.

**topTodos:** keine Blocker offen. Optional (kosmetisch, C2): Kommentar-Rest „(createLlmClient-Instanz unten)" in `precall-briefing.js` bei Gelegenheit auf `createSecondaryLlmClient` aktualisieren.

## Fix-Runden

Keine — der Impl-Stand bestand Safety- und Clean-Code-Review im ersten Durchlauf ohne Fix-Runde (0 Blocker in beiden Reviews).
