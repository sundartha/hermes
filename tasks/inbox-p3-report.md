# Phase INBOX-P3 — MCP-Werkzeug `check_inbox` — Detailbericht

Basis: `master` @ `cc33d8e` (INBOX-P1+P2 gemergt). Ergebnis-Branch: `phase/inbox-p3-werkzeug`. Commit: `58f972877d2c6496217ce842fc41cc6304f6f223`. Gate: **PASS**.

## 1. Was gebaut wurde

Das MCP-Werkzeug `check_inbox` wurde ueber `uiTool` registriert:

- **outputSchema**: `INBOX_OUTPUT = { entries: z.array(INBOX_ENTRY), remaining: z.number() }`, `INBOX_ENTRY` NICHT `.strict()` (Praezedenz `CALL_LIST_ENTRY`). Deckt sich exakt mit `state-ops.inboxEntryView`, mit dem einen Unterschied `started_at -> at` (formatiert, nullable).
- **include_seen**: optionales Boolean-Eingabefeld (`INCLUDE_SEEN_FIELD`), Default `false`, wird UNVERAENDERT an `POST /api/inbox/poll` durchgereicht; die fail-closed-Auswertung (nur strikt `true` zaehlt) bleibt allein in `src/routes/api-inbox.js` — kein zweiter Validator im Werkzeug.
- **Woertlich festgelegte englische Beschreibung** (`CHECK_INBOX_DESCRIPTION`), byte-identisch zu Plan-Abschnitt E-5 uebernommen:

  > "Check the call inbox: inbound calls that finished since the last check - who called, what they wanted, what was promised, and what to do now. CONSUMING: entries returned here are marked as seen and will NOT appear again. Do NOT use this to browse or re-read call history - use list_calls for that."

  Das **Negativ-Verbot** ("Do NOT use this to browse or re-read call history - use list_calls for that") ist Pflichtbestandteil gegen Pre-Mortem R-11 (Modell zieht `check_inbox` beim blossen Blaettern und verbraucht die Inbox beilaeufig). Ueber `EXPECTED_MARKERS` in `test/p15-mcp-tool-descriptions-en.test.js` nach Anzahl UND Reihenfolge gepinnt: `check_inbox: ["CONSUMING", "NOT", "NOT"]`, `"check_inbox.include_seen": ["NO"]`.
- **Zwei neue `MCP_TEXTS`-Schluessel** (`src/i18n/mcp-texts.js`, je de/en/fr):
  - `emptyInbox` — DE `"Keine neuen Anrufe."`, EN `"No new calls."`, FR `"Aucun nouvel appel."`
  - `inboxSummaryUnavailable` — DE `"Zusammenfassung nicht verfuegbar (technischer Fehler)."`, EN `"Summary unavailable (technical error)."`, FR `"Resume indisponible (erreur technique)."`

## 2. Verdrahtungsstellen (einzeln)

1. `src/mcp-tools.js`, Modulebene nach `callTextLine` (vor `pickCalendarEntry`): `INBOX_ENTRY`, `INBOX_OUTPUT`, `inboxEntryForModel(entry, formatDate)` (Rest-Destrukturierung, KEINE zweite Feldliste — tauscht nur `started_at` gegen `at`), `inboxTextLine(entry, texts)` (Stufe-0-Textzeile, kein Richtungspfeil wie bei `callTextLine`, da Inbox-Eintraege per Konstruktion immer inbound sind), `CHECK_INBOX_DESCRIPTION`, `INCLUDE_SEEN_FIELD`.
2. `src/mcp-tools.js`, in `registerTools` (nach `list_calls`): die `uiTool("check_inbox", ...)`-Registrierung selbst — ruft `call("POST", "/api/inbox/poll", { include_seen: includeSeen })`, prueft mit `requireFields` auf `entries`/`remaining`, mappt Eintraege ueber `inboxEntryForModel`, baut Text via `inboxTextLine` oder `loc.mcp.emptyInbox` bei leerer Liste.
3. `src/i18n/mcp-texts.js`: die zwei neuen Schluessel `emptyInbox`/`inboxSummaryUnavailable` in DE-, EN- und FR-Block.
4. `test/p15-mcp-tool-descriptions-en.test.js`: `EXPECTED_MARKERS` um `check_inbox` und `check_inbox.include_seen` ergaenzt.
5. `test/mcp-tools-language.test.js` (T9-Vollstaendigkeitsliste): `emptyInbox`/`inboxSummaryUnavailable` in die Feldnamen-Schleife ergaenzt (Luecke wuerde `"undefined"` in einen tenant-sichtbaren Text rendern, G27).
6. `eslint-legacy-exceptions.json` + `test/check-staged-suppressions.test.js`: der Lint-Pin fuer `registerTools` (`max-lines-per-function`) byte-gleich von `430` auf `450` nachgezogen — gemessen, nicht geschaetzt. `eslint-suppressions.json` bewusst UNVERAENDERT (zaehlt nur Regel->Anzahl, bleibt bei 1 Fund).
7. `test/inbox-mcp-tool.test.js` (NEU): 9 Testfaelle (a)-(i), siehe Abschnitt 4.

**Ausdruecklich NICHT angefasst**: `src/routes/api-inbox.js` (bereits fertig aus P1/P2), `src/store/**`, `src/call-result.js`, `src/app.js`, `src/config.js`, `.env.example`, `render.yaml`, keine neue Route, kein neues Env, kein Safety-Gate, keine Offenlegungs-Mechanik.

## 3. Abnahmepunkte (einzeln, Urteil + Kommando)

| # | Kommando | Urteil | Ergebnis |
|---|---|---|---|
| 0 | `npm run test:gates` auf `master` (Vorher-Anker) | ERFUELLT | `fail 3` — GAP-05, GAP-15, E2E-03 |
| 1 | `node --check src/mcp-tools.js && node --check src/i18n/mcp-texts.js` | ERFUELLT | kein Output, Exit 0 |
| 2 | `node --test test/inbox-mcp-tool.test.js` | ERFUELLT | `tests 9 / pass 9 / fail 0` |
| 3 | `node --test test/p15-mcp-tool-descriptions-en.test.js test/mcp-tools-language.test.js test/mcp-audio-text-only.test.js` | ERFUELLT | `tests 29 / pass 29 / fail 0` |
| 4 | `npx eslint --suppressions-location eslint-suppressions.empty.json -f json src/mcp-tools.js` | ERFUELLT | identisch zur Baseline bis auf `registerTools ... (450)`; id-length 28, max-params 1, no-magic-numbers 7, no-restricted-syntax 18 unveraendert |
| 5 | `npm run lint` | ERFUELLT | `0 errors, 64 warnings` (voll, Worktree) |
| 6 | `LLM_PROVIDER=anthropic npm test` | ERFUELLT | `tests 5111 / pass 5111 / fail 0` (korrigiert 5092/5092/0, >= Anker 5083) |
| 7 | `npm run test:gates` (Nachher) | ERFUELLT | `fail 3`, dieselben drei Faelle wie #0 (GAP-05, GAP-15, E2E-03) — kein Regress |
| 8 | Smoke: `tools/list` ueber echten Server, `STORE_BACKEND=json`, Temp-`DATA_DIR` | ERFUELLT | `check_inbox` gelistet, englische Beschreibung, `outputSchema` vorhanden, woertlich `"use list_calls for that"` enthalten; Server sauber gestoppt |

## 4. Ausgefuehrte Gegenproben (woertlich)

**Sabotage-Gegenprobe (Plan Abschnitt 3, Edit 6), aus dem IMPL-Report:**

> "in `inboxEntryForModel` (src/mcp-tools.js) testweise `transcript: []` in den Rueckgabewert geschmuggelt. Lauf mit Sabotage: `LLM_PROVIDER=anthropic node --test test/inbox-mcp-tool.test.js` -> `pass 7 / fail 2`, exakt (b) und (d) rot: - (b): AssertionError, actual keys enthalten zusaetzlich 'transcript' - (d): AssertionError \"Antwort leakt \\\"transcript\\\"\". Zeile zurueckgebaut (`inboxEntryForModel` wieder ohne transcript), erneuter Lauf: `pass 9 / fail 0`."

**Drei Gegenproben aus dem SAFETY-Review (unabhaengig, selbst eingebaut):**

> "(1) transcript in inboxEntryForModel eingeschmuggelt -> (b) Schluesselsatz-Pin UND (d) Leak-Detektor beide rot; (2) CONSUMING/NOT auf Kleinschreibung -> p15-Emphase-Test rot; (3) fr.emptyInbox entfernt -> mcp-tools-language UND (c) rot. Nach jedem Rueckbau git diff leer, Datei-Test 9/9 gruen."

**Gegenprobe aus dem CLEANCODE-Review (Store-Feld-Sickerung geprueft):**

> "Store-Feld audit_note in inboxEntryView eingefuegt -> mcp-tool-Tests bleiben gruen, inbox-poll-projection wird rot (Befund S3-2); zurueckgebaut, git status leer."

Alle drei Berichte ziehen aus dieser Kette denselben Schluss: die Whitelist-Pruefung ist scharf, nicht gruen per Zufall — ein Gate, das alles durchlaesst, besteht jeden Positiv-Test, hier laesst es nachweislich nichts durch.

## 5. Impl-Zusammenfassung

Handler-Kette: `check_inbox` ruft ausschliesslich `POST /api/inbox/poll` (unveraendert seit P1/P2). `inboxEntryForModel` projiziert NICHT erneut — Rest-Destrukturierung ersetzt genau ein Feld (`started_at` -> `at`, server-seitig formatiert, `null` bei fehlendem Zeitstempel statt erfundener Epoche 1970/01/01). Die fuenf Karten-Felder kommen per Spread aus `RESULT_CARD_OUTPUT`, derselben Quelle wie `get_transcript`/`await_call_event`. `include_seen` wird unveraendert durchgereicht, Entscheidung bleibt server-seitig fail-closed. Neun neue Testfaelle decken Text/structuredContent-Gleichlauf, den echten REST-Schluesselsatz-Beweis (gegen `ops.takeInboxEntries` erzeugt, nicht abgetippt), Leerfall je Sprache, Nicht-Leak-Beweis mit Positiv-Kontrolle, `action_required`-Isolation, `summary_unavailable`, Durchreichung von `include_seen`, degradierte Gateway-Antwort und einen echten Ende-zu-Ende-Zyklus ueber Spawn-Server.

**Deviations (aus dem IMPL-Report):**

- **A-1**: `src/routes/api-inbox.js` war bereits vollstaendig (include_seen fail-closed, `INBOX_MAX_ENTRIES=20`) — planmaessig NICHT angefasst.
- **A-2 (Praezisierung, kein Widerspruch)**: `at` ist `z.string().nullable()` — bei fehlendem `call.startedAt` bleibt `at` `null` statt `new Date(null)` die Epoche zu formatieren und eine erfundene Anrufzeit zu behaupten.
- **A-4 bestaetigt gemessen**: Lint-Pin fuer `registerTools` wuchs exakt von 430 auf 450 Zeilen (20 neue Code-Zeilen), byte-gleich in beiden Pin-Dateien nachgezogen; `eslint-suppressions.json` bewusst unangetastet.
- **Zusaetzlicher Fund, nicht im Plan explizit erwaehnt**: der lokale Test-Harness in der neuen Testdatei erzeugte beim ersten vollen `npm run lint` 12 Lint-Fehler (max-params, id-length, no-magic-numbers, no-param-reassign, no-restricted-syntax) — alle im Code selbst behoben, KEIN neuer `eslint-suppressions`-Eintrag noetig.

## 6. Safety-Urteil

**FREIGABE.** Aus dem SAFETY-Report (final):

> "Jeder Abnahmepunkt der Etappe INBOX-P3 wurde einzeln selbst gefahren, keine Impl-Behauptung uebernommen. Die drei Kernversprechen halten unter eigener Messung: (1) der Tool-Payload traegt exakt die Whitelist ... (2) die Leer-Antwort ist eindeutig leer ... (3) kein Ratchet-Bruch ... Entscheidend fuer die Freigabe war nicht, dass die Tests gruen sind, sondern dass sie beweisbar etwas festhalten."

Alle Kriterien erfuellt: `safetyGatesIntact`, `routeAuthIntact`, `noNewEnvVars`, `noSecretsLeaked`, `piiClean`, `payloadWhitelisted`, `scopeRespected`, `testCountNotShrunk`, `gatesNotWorse`, `fullLintZeroErrors`, `descriptionPinned`, `summaryUnavailableLine`, `toolEndToEnd`, `testsPassIndependently`, `actionRequiredOnlyOpenItems` — alle `true`. Keine Blocker.

**Zwei nicht-blockierende Concerns** (aus dem SAFETY-Report):

1. **Kosmetik**: Bei unbekanntem Anrufer (`call.from == null`) rendert die Stufe-0-Textzeile das literale Wort `"null"` (`[c_anon] null | Fri 21/08, 10:02 | S2"`); `structuredContent` ist korrekt (`caller: null`). `inboxTextLine` behandelt nur `summary` (via `inboxSummaryUnavailable`), nicht `caller`/`at`. Kein PII-Leck, kein Safety-Bezug.
2. **Testluecke** dazu: kein Etappen-Test faehrt `caller=null` durch die Textsicht.

Ausserdem eine Beobachtung (kein Befund): `include_seen` ist ueber die echte Leitung DOPPELT fail-closed — der MCP-SDK-Eingabewaechter weist einen String `"true"` bereits mit `-32602` ab, zusaetzlich zum `=== true`-Vergleich in `api-inbox.js`.

## 7. Clean-Code-Audit

**Verdict: PASS.** Aus dem CLEANCODE-Report: `s1: []`, `s2: []` (keine Blocker), 6 S3-Befunde (nicht blockierend, empfohlen fuer Nachzug), 3 S4-Hinweise.

**S3-Befunde (einzeln):**

1. **S3-1** — der ~45-Zeilen-Mini-Test-Harness in `test/inbox-mcp-tool.test.js` ist die vierte Kopie desselben Musters (`mcp-tools-language.test.js` u.a.) und driftet bereits leicht ab. FIX: nach `test/helpers.js` ziehen.
2. **S3-2** — Kommentar an `INBOX_ENTRY` verweist auf den falschen Test als Schluesselsatz-Pin; tatsaechlich pinnt `test/inbox-poll-projection.test.js` den Store-Erweiterungsfall, nicht `inbox-mcp-tool.test.js` (per Gegenprobe belegt). FIX: Kommentar korrigieren.
3. **S3-3** — `remaining` ist in JEDER Fixture `0`; ein hartkodiertes `remaining: 0` im Handler waere unbemerkt gruen geblieben. FIX: Fall mit `remaining: 3` ergaenzen.
4. **S3-4** — Zweig „`started_at` fehlt -> `at` bleibt `null`" hat keine eigene Assertion (praktisch unerreichbar, da `state-ops.js` `startedAt` immer setzt). FIX: Testfall ergaenzen.
5. **S3-5** — von drei nullbaren Feldern der Textzeile wird nur `summary` behandelt; `caller===null` oder `at===null` rendern `"null"` (deckt sich mit dem SAFETY-Concern 1).
6. **S3-6** — `remaining` erreicht nur `structuredContent`, der Textkanal schweigt bei zurueckgehaltenen Eintraegen (`INBOX_MAX_ENTRIES=20`).

**S4-Hinweise:** S4-1 (Konstanten-Duplizierung CALLER/OWNER_DID statt `test/helpers.js`-Export), S4-2 (Architektur-Hinweis: SDK-Schema-Verstoss wirft VOR dem sauberen Tool-Fehlerpfad), S4-3 (README nennt `check_inbox` nicht in der kuratierten Bonus-Tools-Liste).

**Bestaetigter Kernpunkt** (aus `passNotes`): das Werkzeug projiziert nachweislich NICHT erneut — `inboxEntryForModel` tauscht per Rest-Destrukturierung genau ein Feld, `INBOX_ENTRY` deckt sich Feld fuer Feld mit `state-ops.inboxEntryView`, `include_seen` wird unveraendert durchgereicht, Suppression-Tabu eingehalten (nur `src/mcp-tools.js` beruehrt, gemessene statt geschaetzte Zahl, `eslint-suppressions.json` unveraendert).

## 8. Fix-Runden

**Keine.** Die Phase erreichte PASS im ersten Durchlauf ohne Nachbesserungsschleife — `=== FIXES ===` im Quellmaterial ist leer. Alle S3/S4-Befunde aus dem Clean-Code-Audit und die zwei Concerns aus dem Safety-Review sind offen fuer einen spaeteren Nachzug, nicht Teil dieser Fix-Runde.

## 9. Top-Todos fuer einen Nachzug (aus dem Clean-Code-Report)

1. Fall mit `remaining > 0` ergaenzen (S3-3).
2. Dateiverweis im `INBOX_ENTRY`-Kommentar korrigieren: Schluesselsatz-Pin liegt in `test/inbox-poll-projection.test.js`, nicht in `test/inbox-mcp-tool.test.js` (S3-2).
3. Mini-Harness nach `test/helpers.js` ziehen (S3-1).
4. `caller`/`at` `null`-Behandlung in `inboxTextLine` analog zu `summary` ergaenzen (S3-5 / SAFETY-Concern).
