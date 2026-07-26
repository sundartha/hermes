# Phase P12 — MCP-Textkanal

**Gate:** PASS
**finalBranch:** `phase/i18n-p12-mcp-textkanal`
**headCommit:** `0eb67ac089bb7a41ff4dcd7c95c57167a1d270a8`
**Basis:** `master` 32cf340

---

## 1. Plan (gekuerzt)

Ziel: die deutschen Klartexte der MCP-Tool-Schicht (`src/mcp-tools.js`) folgen der Tenant-Sprache statt fest verdrahtetem Deutsch. Deckt die fuenf Katalog-IDs `PROMPT-09`, `FMT-03`, `MCP-04`, `MCP-06`, `MCP-08`.

**Vorbedingungen:** P10 (Weltdefault-Sprache) gemergt; P11 nicht gemergt, aber Kollisionsflaeche nur `src/i18n/locales.js` (rein additiv).

**Drei vorab geklaerte Befunde:**
- **B1:** `FMT-03` widersprach sich selbst (Test pinnt exakt das Literal, das der Fix entfernen muss) — Assertion von `match` auf `doesNotMatch` gedreht (Polaritaets-Fix, kein Erwartungs-Absenken).
- **B2:** `MCP-04`/`MCP-06` behaupteten einen EN-Tenant, den ihre Fixture nicht herstellte (`scopedTenant` ist ein Store-loser String). Fix: Fixtures bekommen explizit `language: "en"`, statt den Weltdefault scharf zu schalten (das haette Pre-Mortem-Risiko 1 zementiert — ein deutscher Tenant wuerde durch den Weltdefault englisch).
- **B3:** Pre-Mortem-Auflage "Fehler-Klartexte -> stabile Codes" wird an der **internen** Kante geloest (Wurf traegt `ToolError.code`, `wrapHandler` uebersetzt), nicht als sichtbarer Code im Chat — belegt durch Grep, dass kein Text-parsender Konsument existiert.

**Designentscheidungen:**
- **D1:** eine Sprachquelle — `tenantLanguage(store.load(), scopedTenant)` (dieselbe Funktion/Praezedenz wie der Anrufpfad), aufgeloest in `src/routes/mcp.js`, kein Request-Header/Client-Locale.
- **D2:** Sprache je MCP-Registrierung (Leser/Tenant), nicht je Call-Record.
- **D3:** neues Datenmodul `src/i18n/mcp-texts.js`, eingehaengt via `mcp:` in jedes `LOCALES.<lang>` — `localeFor()` bleibt der eine Resolver.
- **D4:** DE bleibt byte-identisch zum Bestand.
- **D5:** Waehrungslabel liest `config.billing.paymentCurrency` zur Aufrufzeit (kein eingefrorener Modul-Const).
- **D6:** stdio-Transport (`src/mcp-server.js`) bekommt bewusst kein `language`-Feld (kein Store dort) — faellt auf Weltdefault zurueck.

**Umfang:** neue Datei `src/i18n/mcp-texts.js` (Rollen-Praefixe + sprachneutrale Fehler-Codes je de/en/fr); Edits an `locales.js` (additiv), `mcp-tools.js` (8 Stellen: Formatter-Fabrik, `ToolError`, `pickCallStatus`/`pickCall`/`pickCalendarEntry` mit Sprachparameter, Waehrungs-Treue, `registerTools`-Signatur, `wrapHandler`-Uebersetzung), `routes/mcp.js` (Sprachaufloesung), `mcp-server.js` (nur Kommentar). Neue Testdatei `test/mcp-tools-language.test.js` (T1–T10), Korrekturen an `test/mcp-tools-i18n.test.js`, A3-Umzug der fuenf gefixten Katalogtests in die neue Datei (verlaesst damit `test:gates` und laeuft in `npm test`).

**Explizit ausserhalb des Scopes:** Tool-Beschreibungen/`inputSchema`, `list_action_items`, Leerzustandstexte, `permissionsSummary`/Widget-Rendering (P13), stdio-Sprachbindung.

---

## 2. Implementierungs-Zusammenfassung

- `src/i18n/mcp-texts.js` (neu): `MCP_ERROR_CODE`-Enum + `MCP_TEXTS` je de/en/fr (Rollen-Praefixe, drei Fehlertexte). DE-Texte ASCII-transliteriert wie der Bestand (nie gesprochen).
- `src/i18n/locales.js`: additiver Import + `mcp:`-Feld in allen drei Bundles.
- `src/mcp-tools.js`: `fmt()` -> `makeDateFormatter(dateLocale)`-Fabrik; `requireFields` wirft `ToolError` mit stabilem Code statt deutschem Klartext; `pickCallStatus(callId, c, texts)`, `pickCall(c, formatDate)`, `pickCalendarEntry(e, formatDate)` nehmen Sprache/Formatter als Parameter; `get_agent_status` zeigt `config.billing.paymentCurrency` statt hartem `EUR` (`AGENT_STATUS_COST_DIGITS`/`costDigits`/`chargeCurrencyLabel`); `registerTools()` bekommt `language`-Option, loest `loc = localeFor(language)` + `formatDate` einmal je Registrierung auf; `wrapHandler` uebersetzt `err.code` ueber `loc.mcp.errors`, faellt auf `err.message`, dann auf den lokalisierten Auffangsatz zurueck.
- `src/routes/mcp.js`: Import `tenantLanguage`, `const language = tenantLanguage(store.load(), scopedTenant)` nach `resolveProfile`, durchgereicht an `registerTools`.
- `src/mcp-server.js` (stdio): nur Kommentar, kein Code — bewusst kein `language`-Feld.
- `test/mcp-tools-i18n.test.js`: FMT-03-Assertion invertiert, MCP-04/MCP-06 mit `language:"en"` ergaenzt; danach die fuenf gefixten Tests (PROMPT-09/FMT-03/MCP-04/MCP-06/MCP-08) nach `test/mcp-tools-language.test.js` umgezogen (A3). Verbleibend: `MCP-05` (gruen), `MCP-09`/`MCP-12` (bewusst rot, P13).
- `test/mcp-tools-language.test.js` (neu): T1–T6 (Umzuege), T7 (Pre-Mortem-1-Regressionsschutz: DE-Tenant bleibt deutsch trotz scharfem Weltdefault), T8 (ein einziger Fallback via `localeFor(null)`), T9 (`MCP_TEXTS`-Vollstaendigkeit je Sprache x Fehlercode), T10 (echter Wiring-Test ueber den `/mcp`-HTTP-Pfad).

**Ergebnis:** `headCommit` 0eb67ac, `node --check` gruen auf allen fuenf geaenderten Quelldateien, `npm test` 3208/3208 gruen (0 rot), Smoke ueber `startServer()`-Testharness bestaetigt (manueller curl scheiterte zunaechst am Boot-Guard — Bestandsverhalten, kein P12-Defekt).

### Deviations (im Report explizit benannt)

1. T3/T4 pruefen die Datumsformat-Divergenz per Formprobe (Punkt- vs. Schraegstrich-Trenner) statt des im Plan genannten 4-stelligen Jahres-Regex — der bestehende `toLocaleString`-Optionsatz liefert empirisch kein Jahr; der Plantext war an dieser Stelle ungenau. Die Verhaltens-Absicht (unterschiedliches Format je Sprache) bleibt exakt geprueft.
2. Bewusste, im Plan selbst benannte Abweichung von "ENTSCHAERFT (2)": die stabilen Fehler-Codes uebersetzen an der **internen** Kante (Wurf -> `wrapHandler`); der Chat-Nutzer sieht weiterhin einen lokalisierten Satz, keinen sichtbaren Code.

---

## 3. Safety-Urteil

**Verdikt: FREIGABE (approved: true), keine Blocker.**

Alle Kernpunkte bestaetigt: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`.

Unabhaengiger Lauf (frischer Worktree, review-p12 auf 0eb67ac, master 32cf340 als Vorfahr):
- `npm test`: Branch 3208/3208 gruen; Master-Baseline 3198/3198; Delta = +10 = genau T1–T10.
- `npm run test:gates`: Branch 43 Tests/21 pass/22 fail; Master 48/21/27 — Pass-Zahl unveraendert (kein gruener Gate-Test verloren), es sind genau die fuenf gefixten IDs (MCP-04/06/08, FMT-03, PROMPT-09) aus dem Gate-Lauf verschwunden (A3-Umzug). `MCP-05` bleibt gruen im Gate-Lauf.
- pglite-Backend: 129/129 gruen; eigene pglite-Probe bestaetigt `tenantLanguage`/`resolveCallLanguage` traegt auch auf Postgres.
- Runtime-Smoke gegen echte `/mcp`-Route: DE byte-identisch zum Bestand ("Gegenseite: ", "Fr., 26.06., 11:59"), EN korrekt divergent ("Other party: ", "Fri 26/06, 11:59").
- Diff-Pruefung: 7 Dateien, +439/-154, keine neue Dependency, `claude.js`/`bridge.js` unberuehrt (Offenlegungssatz unangetastet), kein neuer Endpunkt, `/mcp` bleibt hinter `mcpAuth`.

**Fuenf nicht-blockierende Concerns (Nacharbeit):**
1. `loc.mcp.errors[err?.code]` ist ein ungeschuetzter Objekt-Lookup auf ein normales Literal (Prototype-Pollution-Risiko bei `err.code === "constructor"` o.ae.) — real unwahrscheinlich, aber billig mit `Object.hasOwn`-Guard oder `Object.create(null)` zu schliessen.
2. `tenantLanguage(store.load(), scopedTenant)` in `routes/mcp.js` liegt ausserhalb des try-Blocks (wie das bestehende `resolveProfile`) — Express 4 faengt Rejections eines async-Handlers nicht; Bestandsmuster, aber P12 fuegt eine zweite Wurfstelle hinzu.
3. stdio-Kanal (`npm run mcp`) wird beim spaeteren Weltdefault-Flip in Produktion englisch, unabhaengig vom Tenant — heute byte-identisch deutsch, weil `WORLD_DEFAULT_LANGUAGE_ENABLED=false`.
4. `test/mcp-tools-language.test.js` ist nicht prettier-formatiert (kosmetisch, kein CI-Gate).
5. DE-MCP-Texte bleiben ASCII-transliteriert — Produktmakel in einem geschriebenen Kanal, aber bewusste Byte-Identitaets-Entscheidung dieser Phase.

---

## 4. Clean-Code-Audit

**Verdikt: PASS, kein Blocker.**

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3 (Konsistenz-Befund):** `src/mcp-tools.js:664,706,737-742` — P12 lokalisiert im `get_agent_status`-Textblock gezielt die Waehrungs-Labels, laesst aber die umgebenden Feld-Labels ("Agent-Nummer:", "Besitzer:", "Voice-Engine:", "Modell:", "Berechtigungen:") sowie die Leerzustandstexte in `list_calls`/`get_calendar` ("Noch keine Anrufe.", "Kalender ist leer.") hart Deutsch. Ein EN-Tenant sieht dadurch einen gemischtsprachigen Textblock. Aus dem Diff nicht zu belegen, ob das bewusst einer Folgephase (P13) zugeordnet ist — Klaerungsbedarf, kein bestaetigter Scope-Verstoss.
- **S4 (kosmetisch):** Kommentar in `test/mcp-tools-language.test.js:11` verweist auf eine Dedup-Begruendung in `mcp-ui-i18n-divergence.test.js`, die dort nicht mehr in der behaupteten Form steht — Verweis fuehrt ins Leere, kein Blocker.

**passNotes:** klare Trennung Wurf/Uebersetzung (`ToolError.code` -> nur `wrapHandler` uebersetzt, getesteter Fallback-Vorrang `err.code > err.message > Weltdefault`); Sprachaufloesung ausschliesslich ueber bestehende `tenantLanguage()`; `mcp-server.js` bewusst ohne Store-Kopplung dokumentiert; T7–T9 sind echter Regressionsschutz gegen die drei Pre-Mortem-Risiken, nicht nur Feature-Tests; DE bleibt byte-identisch (T1/T5 pinnen das).

**topTodos:**
1. Klaeren, ob die verbliebenen hart-deutschen Strings in `get_agent_status`/`list_calls`/`get_calendar` bewusst P13 zugeordnet sind oder ein Scope-Loch in P12 darstellen.
2. Kommentar-Verweis in `test/mcp-tools-language.test.js:11` auf den tatsaechlichen Beleg-Ort korrigieren (kosmetisch).

---

## 5. Fix-Runden

Keine — der erste Impl-/Review-Durchlauf erreichte direkt PASS (Safety: FREIGABE ohne Blocker, Clean-Code: PASS ohne S1/S2). Es gab keine `=== FIXES ===`-Runde; alle Concerns/S3/S4-Befunde sind als offene Nacharbeit dokumentiert, nicht als Blocker behoben.
