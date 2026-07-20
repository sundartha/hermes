# Phase P5b — Monats-Felder in die Projektion

**Gate: BLOCKED**
**finalBranch:** `phase/ba-p5b-monatsfelder-fix2`
**Basis:** `master` @ `abc2e16` (P5a gemergt)
**Kette:** Teil von `budget-axes-deadband` (siehe MEMORY.md)

---

## 1. Zusammenfassung

P5b sollte die Spend-Monat-Achse (P4) und die eigene In-Flight-Reserve in die `/api/state`-Projektion (`usageView`) und darüber in `get_agent_status` (MCP) sowie das Status-Widget heben, ohne die Lebenszeit-Achse (`costEur`/`tenantCapEur`, von den heute gültigen Budget-Prädikaten gelesen) zu berühren. Plan, Implementierung und Safety-Review sind durch — der Safety-Reviewer hat **approved**. Der finale Clean-Code-Audit-Lauf (nach zwei Fix-Runden) hat jedoch **einen S1-Befund** (Blocker) gemeldet: ein neuer `null`-Fallback-Pfad (`spendMonthKey === null`) wird in keinem Test mit echtem `null` durchlaufen. Damit bleibt das Gate **BLOCKED** — die Phase ist nicht mergefähig, obwohl sie inhaltlich weit fortgeschritten und safety-seitig unauffällig ist.

---

## 2. Plan (gekürzt)

### Befund 0 — Korrektur des Plantexts am Code

Der ursprüngliche Plantext nannte `public/index.html` und `public/tenant.html` als Konsumenten der Projektion. Beides stimmt nicht mehr:

- `public/index.html` existiert nicht mehr (gelöscht in einem früheren Owner-Removal-Commit).
- `public/tenant.html` konsumiert `/api/state` nicht (nur `/api/plans`, `/api/self-service/*`), enthält kein `usage`/`costEur`/`Budget`.

→ `usageView` hat auf `master` genau **zwei** Konsumenten: die `/api/state`-JSON-Antwort und `src/mcp-tools.js` (`pickAgentStatus` → `get_agent_status`, Text + `structuredContent`, Widget `agent-status.html`). Beide Dashboard-Dateien werden bewusst **nicht** angefasst — dokumentierte Nicht-Änderung, kein „übersehen".

### Deliverable 1 — neue Form von `usageView`

Ist-Zustand (`src/routes/api-read.js`): `usageView(u, budget)` mit zwei Positionsargumenten, liefert `inputTokens`, `outputTokens`, `calls`, `costEur`, `tenantCapEur`.

Soll-Zustand: `usageView({ usage, budget, reservedCents, nowIso })` (Objekt-Argument statt vierter Positionsparameter, F1-Regel) liefert zusätzlich:

- `spendMonthCostEur` — aus `spendMonthUsageCents(usage, nowIso) / CENTS_PER_EUR` (P4-Funktion, nebeneffektfrei)
- `spendMonthKey` — aus einer **neuen** Funktion `spendMonthWindowKey(bucket, nowIso)` in `src/store/state-ops.js`, die sich `authoritativeSpendMonthKey` mit `spendMonthUsageCents` teilt (G5: eine gemeinsame Vergleichsregel statt Duplikat)
- `reservedEur` — aus `store.reservationOf(tenantId)` → `reservationFor(s, tenantId)` (genau ein Tenant-Schlüssel, nicht die Plattform-Summe `reservationsTotal`)

Begründung für die neue Funktion statt rohem `usage.spendMonthKey`: nach einem Rollover trägt der Bucket noch den **alten** Monatsschlüssel, während der Kostenwert bereits 0 ist — roh projiziert stünde z.B. „2026-06: 0,00 EUR" im Juli, ein Nullwert unter falschem Etikett (D4-Wiederholung). `spendMonthWindowKey` verhindert das strukturell.

Keine Plattform-Größe (`globalCapCents`, `globalUsageTotals`, `reservationsTotal`) verlässt die Tenant-Projektion (Absolute Regel 4/6 aus CLAUDE.md).

### Deliverable 2 — Beschriftungs-Entscheidung

Kernproblem: nach dieser Phase stehen zwei Verbrauchszahlen (Lebenszeit vs. Spend-Monat) neben einer Decke, die bis P7 weiterhin gegen die **Lebenszeit**-Zahl gate't. Ein Leser könnte „Monat: 0,00 / Budget: 10,00" fehllesen und Spielraum annehmen, wo keiner ist — der eigentliche Schaden, den diese Phase anrichten könnte (D4 in neuer Form).

**Entscheidung:** Jede Geld-Zeile — **auch die Decke** — benennt ihr Messfenster explizit im Label, in allen drei Sprachen (en/de/fr), im Widget (`agent-status.html` + `widget-i18n.js`) und im MCP-Textrender (`mcp-tools.js`). Die Decke wechselt von fensterlosem „Your budget" zu „Your budget, lifetime" — bewusst, weil sie ab P7 auf „this month" flippen wird und die i18n-Keys damit die Invariante kodieren, die P7 später umlegt.

Neue/geänderte Widget-Zeilen: `costEur` (Label ergänzt um „lifetime"), `tenantCapEur` (Label ergänzt um „lifetime"), `spendMonthCostEur` (neu), `spendMonthKey` (neu), `reservedEur` (neu).

MCP-Textrender bekommt eine neue Konstante `AGENT_STATUS_EUR_DIGITS = 3` + Helfer `eurDigits()` statt drei nackten `.toFixed(3)`-Literalen, und formuliert die Decken-Bindung als Satz aus ("... EUR von ... EUR eigenem Budget").

Kontrakt-Nachzug: `pickAgentStatus`-Whitelist, `AGENT_STATUS_OUTPUT`-Zod-Schema, `widget-i18n.js` (de/fr) müssen um die drei neuen Felder erweitert werden.

### Deliverable 3 — Tests

Betroffene Dateien: `test/api-state-usage-axis.test.js` (erweitert, trägt Rot-vor-Fix), `test/api-read-parity.test.js` (Mock-Store-Nachzug `reservationOf`), `test/mcp-ui.test.js` (Kontrakt-Nachzug). `test/mcp-ui-widget-i18n.test.js` und `test/usage-spend-month-axis.test.js` unverändert.

Geplante Testfälle T1–T5: Rollover (`spendMonthCostEur=0` bei Vormonats-Schlüssel), laufendes/Zukunfts-Fenster (voller Wert), `reservedEur` aus eigener Reserve, Nebeneffektfreiheit (Bucket byte-identisch über zwei Polls, `save()` nie aufgerufen), Whitelist/kein Plattform-Leck.

### Deliverable 4 — Prüfbare Abnahme

Baseline vorab gemessen: **81 pass / 0 fail** über die fünf betroffenen Testdateien auf `master @ abc2e16`. Erwartetes Rot-vor-Fix: 3 Fälle in `api-state-usage-axis.test.js` (T1–T3), grep-Riegel gegen `reservationsTotal`/`globalCapCents`/`globalUsageTotals`/`maxBudgetEur` in der Projektion, `git diff --stat` als Scope-Drift-Nachweis (Budget-Prädikate dürfen keine geänderte Zeile zeigen), erwartete Diff-Dateiliste (8 Dateien).

### Pre-Mortem (aus dem Plan)

| Todesursache | Entschärfung |
|---|---|
| Nutzer liest „Monat 0,00 / Budget 10,00", schließt auf Spielraum, bekommt 402 | Jede Geld-Zeile inkl. Decke trägt ihr Fenster im Label |
| Anzeige zeigt veralteten Monat mit 0,00 | `spendMonthWindowKey` statt rohem Bucket-Stempel |
| Poll stempelt den Monat, Cap wird nach P7 wirkungslos | Nebeneffektfreie Projektion, durch Test gepinnt |
| Plattform-Wert leakt über Tenant-Projektion | `reservationFor` statt `reservationsTotal`, Whitelist-Test, grep-Riegel |
| P7 flippt Gate-Achse, Decken-Label bleibt falsch stehen | Fensterwort steckt im i18n-Key, nicht übersehbar |
| Prädikat wird „nebenbei" mitgeflippt | Vorgabe: `git diff --stat` auf `state-ops.js` |

**Akzeptiertes Restrisiko:** Zwischen P5b und P7 zeigt die Anzeige eine Monatszahl an, die noch kein Gate liest — informativ, nicht normativ, bis P7 die Zusicherung „angezeigtes Fenster == Gate-Fenster" herstellt.

**Danach: STOPP.** Letzte Phase der Kette — nach Merge kein automatischer Übergang zu P6/P7, offene Owner-Entscheidungen (Cap-Höhe, Warn-Kanal, Boot-Guard für `CLAUDE_MODEL`/`PRECALL_BRIEFING_MODEL`) bleiben unverändert offen.

---

## 3. Implementierung — Zusammenfassung

**Head-Commit:** `ef6c666` (Branch `phase/ba-p5b-monatsfelder`, vor den Fix-Runden). `node --check` grün, Tests grün.

Umgesetzt wie geplant:

- `usageView()` in `src/routes/api-read.js` auf Objekt-Argument `{usage, budget, reservedCents, nowIso}` umgestellt, liefert die drei neuen Felder.
- `spendMonthWindowKey(bucket, nowIso)` neu in `src/store/state-ops.js`, geteilt mit `authoritativeSpendMonthKey`.
- MCP-Textrender + Kontrakt-Whitelist + Zod-Schema in `src/mcp-tools.js` erweitert, `AGENT_STATUS_EUR_DIGITS`/`eurDigits()` eingeführt.
- Widget-Labels (`src/ui/widgets/agent-status.html`, `src/ui/widget-i18n.js`) um die drei neuen Zeilen + „lifetime/gesamt/total"-Qualifier auf den bestehenden zwei Zeilen ergänzt, de/fr/en gepflegt.
- `public/tenant.html` bewusst **nicht** angefasst (Befund 0 bestätigt).

**Testzahlen:** Zielsuite (5 Dateien) 85/0 (81 Baseline + 4 neue Testblöcke; T5 ist ein erweiterter Bestandstest, keine neue `test()`-Instanz). Volle Suite `npm test`: **2603 pass / 0 fail**.

**Deviations (gegenüber Plan, laut Impl-Report):**

1. Testzahl-Schätzung im Plan ("pass 86") vs. tatsächlich 85 — reine Zählweise-Differenz (T5 ist erweiterter Bestandstest statt neuer Testfall), kein Verhaltens-/Scope-Unterschied.
2. Der optionale Runtime-Smoke-Test (echter Server-Boot + `curl /api/state`) konnte nicht vollständig durchlaufen werden — Boot-Guard verlangt reale Provider-Credentials und einen bereits bootstrapten Tenant mit aktiver Nummer, außerhalb des Phasenumfangs. Kompensiert durch `test/api-read-parity.test.js`, das die echte `makeReadRoutes`-Factory in einem echten Express-Server mit nur gemocktem Store end-to-end durchläuft. `smokePass: false`, aber als im Plan selbst als "optional, ersetzt keinen Test" markiert eingeordnet.

**Clean-Code-Selbstprüfung des Implementierers:** F1 (Objekt-Argument), G25 (benannte Konstante statt dreifachem Literal), G5 (geteilte Vergleichsregel), G31 (kein vorgelagertes `nowIso`, inline im einzigen Aufruf), C2 (Kommentar-Nachzug "GENAU ZWEI" → "GENAU DREI" Aufrufer), G12/G9/C5 — keine eigenen S1/S2-Funde gemeldet.

---

## 4. Rot-vor-Fix-Beleg

**Vorgehen:** Die 8 Zieldateien wurden per `git show HEAD:<pfad> > <pfad>` temporär auf den unveränderten `master`-Stand zurückgesetzt (bewusst kein `git stash` — `refs/stash` ist worktree-geteilt, siehe MEMORY-Lehre), Testdateien blieben auf neuem Stand, Tests liefen, danach Fix-Versionen aus einer Scratchpad-Kopie zurückgeschrieben.

**Befehl:** `node --test test/api-state-usage-axis.test.js test/api-read-parity.test.js test/mcp-ui.test.js`

**Ergebnis (src auf altem Stand):** `tests 63 / pass 56 / fail 7`

Rote Fälle wie im Plan erwartet:

- „tenantCapEur ersetzt maxBudgetEur ersatzlos, kein Plattform-Leck" → `AssertionError` (Whitelist fehlen `reservedEur`/`spendMonthCostEur`/`spendMonthKey`)
- „reservedEur aus der eigenen In-Flight-Reserve" → `undefined !== 0.6`
- „Rollover — spendMonthCostEur=0" → `undefined !== 0`
- „laufendes (zukünftiges) Fenster liefert den vollen Wert" → `undefined !== 5`
- „T-W3-AC1: Stufe 0 additiv" / „T-W3-AC3: Fallback fail-closed" / „T-W3-AC4: Whitelist" → jeweils `Object.keys`-Mismatch (3 Felder fehlen)

Grün wie beabsichtigt (Regressions-Riegel, kein Fehlernachweis): „reine Leseprojektion — Bucket bleibt byte-identisch, kein `save()`" (T4) — prüft die vorhandene, unveränderte `spendMonthUsageCents` und ist unabhängig vom neuen Feld grün.

Nach Zurückschreiben des Fix-Stands: `node --check` auf allen geänderten `.js`-Dateien bestanden, dieselben Testdateien liefen grün: `tests 85 / pass 85 / fail 0`.

**Unabhängige Wiederholung durch den Safety-Reviewer** (frischer Worktree, Branch `review-ba-p5b-r2` = `phase/ba-p5b-monatsfelder-fix2` @ `02c54c2`, Baseline `master @ abc2e16`): drei neue Testdateien über unveränderten `master`-Code gelegt → `tests 63, pass 55, fail 8` (4× `api-state-usage-axis` + 4× `mcp-ui`, an genau den erwarteten Stellen). Rot-vor-Fix damit zweifach unabhängig bestätigt.

---

## 5. Safety-Urteil

**Verdikt: APPROVED** (Safety-Reviewer, unabhängiger Lauf im frischen Worktree gegen `phase/ba-p5b-monatsfelder-fix2` @ `02c54c2`).

Kernprüfungen, alle bestanden:

- **Tests, beide Backends:** `npm test` (json-Default) 2603/2603/0 (76,6 s, kein Flake). PGlite-in-process (30 Dateien) 1011/1011/0 (69,4 s) — bereits Teil des 2603er-Laufs.
- **Rot-vor-Fix:** selbst reproduziert, 8 Ausfälle auf `master` (s. Abschnitt 4).
- **Cross-Tenant (härtester Punkt):** eigenes Skript gegen den echten JSON-Store, zwei Tenants mit unverwechselbaren Leck-Markern in beiden Richtungen. Kein Fremdwert, keine Plattform-Summe (`globalUsageTotals`/`reservationsTotal` selbst berechnet und gegengeprüft — tauchen nicht in der Tenant-Antwort auf), kein Plattform-Cap in der Tenant-Projektion. Whitelist exakt 8 Schlüssel, interne Cent-Felder (`costCents`, `spendMonthCostCents`) verlassen die API nicht.
- **Nebeneffektfreiheit:** Bucket mit Vormonats-Stempel, mehrere Polls — Bucket byte-identisch, `store.json` auf Platte unverändert. Das einzige beobachtete In-Memory-Delta (Lazy-Default-Buckets für unbekannte Tenants) tritt identisch auf `master` auf — als Bestandsverhalten getrennt verifiziert, nicht von P5b eingeführt.
- **Prädikate unberührt:** `budgetExceeded`, `reserveExceedsBudget`, `globalBudgetExceeded`, `globalReserveExceedsBudget` byte-identisch zu `master` (Funktionsextraktion verglichen). `src/outbound-gates.js` mit 0 geänderten Zeilen. Der Gate-Flip bleibt sauber P7 vorbehalten.
- **Scope/Regeln:** keine neue Dependency, keine Auth-/Gate-/Disclosure-/Config-Datei angefasst, kein Secret in neuen Zeilen, kein Audio-Pfad.
- **Beschriftung als Reader geprüft:** jede Geldzeile trägt ein Achsenwort in allen drei Sprachen; die Budget-Zeile ist ausdrücklich an die Lebenszeit-Achse gebunden — genau das Prädikat, das heute blockiert.

**Concerns (nicht-blockierend laut Safety-Reviewer):**

1. „Spend-Monat"/„Spend month" ist interne Projektsprache auf einer Endnutzer-Oberfläche — verständlicher wäre „Abrechnungsmonat"/„Billing month".
2. `eurDigits()` nutzt `toFixed(3)` — Bestandsmuster, aber P5b verdreifacht die Vorkommen und stellt zwei solche Zahlen direkt übereinander; Fehllesen (deutsches Dezimaltrennzeichen) wird wahrscheinlicher.
3. Theoretische NaN-Kante bei `spendMonthCostCents === undefined/NaN` im laufenden Monat — über Bestandsmechanismen (`emptyUsage()`-Backfill, pg-Hydrierung) praktisch nicht erreichbar, kein Regress gegenüber `master`.
4. **P7-Vorbedingung (wichtigster Mitnahme-Punkt):** der fail-closed-Riegel hängt heute ausschließlich an `costCents`. Die Spend-Monat-Achse hat kein Äquivalent. Solange sie inert ist (P5b = reine Anzeige), folgenlos — sobald P7 das Gate auf die Monats-Achse umlegt, muss ein gleichwertiger Korruptions-Riegel mitkommen.
5. Lazy-Default-Verhalten beim Poll unbekannter Tenants — Bestand, nicht von P5b eingeführt, nur zur Präzisierung dokumentiert.

Anmerkung des Reviewers: während der Prüfung wurde versehentlich ein eigener (untrackter) Stash-Eintrag auf den worktree-geteilten Stash-Stack geschoben und sofort wieder entfernt; keine getrackten Änderungen betroffen, Zustand vollständig wiederhergestellt.

---

## 6. Clean-Code-Audit (finaler Lauf, nach Fix-Runde 2)

**Verdikt:** „Nicht sauber genug für ein glattes PASS" — **`blocker: true`**, genau **ein S1**, **S2 = 0** (der in Runde 1 gefundene G5-Verstoß wurde in Runde 2 sauber behoben).

### S1 (Blocker, 1 Fund)

**Test-Lücke für den `null`-Fallback-Pfad.** In `src/mcp-tools.js` (Textblock `get_agent_status`: `data.spendMonthKey ?? "unbekannt"`) und in `test/mcp-ui.test.js` (`AGENT_STATUS_OUTPUT.spendMonthKey: z.string().nullable()`) wurde ein neuer Fallback-Branch bzw. ein neuer nullable-Schema-Zweig eingeführt, aber in **keinem** Test mit echtem `null` durchlaufen — `RICH_STATE` und alle Fixtures liefern durchgängig einen String (`'2026-07'`), nie `null`. Nach der projekteigenen Regel in `.claude/refs/clean-code.md` („fehlende Verifikation neuen Verhaltens zählt als S1") ist das ein Blocker, auch wenn der Pfad in Produktion praktisch nur bei unlesbarer Uhr greift (`nowIso` kommt real immer aus `new Date().toISOString()`).

**Fix-Vorschlag:** ein Testfall mit `usage.spendMonthKey = null` (bzw. `spendMonthWindowKey`-Rückgabe `null`) durch Route → Tool → Text/Schema schicken und sowohl den Text (`„...Spend-Monat unbekannt: ..."`) als auch `structuredContent.spendMonthKey === null` prüfen.

### S2: keine Funde

Der in Runde 1 gefundene G5-Verstoß (zwei unabhängige Konstruktionen des autoritativen Spend-Monat-Schlüssels — `spendMonthUsageCents` und die neue `api-read.js`-Projektion bauten den Schlüssel unabhängig mit demselben Ausdruck) wurde in Runde 2 korrekt behoben: `spendMonthUsageCents` delegiert jetzt an `spendMonthWindowKey`, es gibt genau eine exportierte Leseprojektion.

### S3 (2 gebündelte Kleinigkeiten)

1. **Terminologie-Drift (N7/G11):** Die Lebenszeit-Achse heißt im Text-Tool explizit „KI-Kosten gesamt (Lebenszeit)", im Widget-Label (de) nur „gesamt", (fr) „total" — ohne Lebenszeit-Qualifier. Dieselbe Achse liest sich auf den beiden Oberflächen nicht identisch.
2. **Formatierungs-Asymmetrie (G11):** `tenantCapEur` bleibt im Textblock unformatiert (kein `eurDigits()`), während `costEur`/`spendMonthCostEur`/`reservedEur` im selben Absatz neu einheitlich auf 3 Nachkommastellen formatiert sind. Bestand vorher, fällt jetzt stärker auf.

### S4 (kosmetisch)

`spendMonthWindowKey(usage, nowIso)` wird in `usageView()` pro Request zweimal aufgerufen (direkt + indirekt in `spendMonthUsageCents`) — reine, billige Funktion, kein Korrektheits-/G5-Problem, aber vermeidbare doppelte Berechnung.

### Positiv festgehalten (`passNotes`)

Der G5-Fix aus Runde 1 sitzt sauber; N7 (Achsen-Benennung per Präfix) vorbildlich umgesetzt; keine C2-Verstöße (keine Datei:Zeile-Kommentare) im gesamten Diff; Whitelist-Disziplin (`pickAgentStatus`) bleibt explizit; Nebeneffektfreiheit ist durch einen eigenen Test bewiesen, nicht nur behauptet; `usageView()`-Umstellung auf Objekt-Argument ist ein sauberer Umgang mit F1. Alle 79 einschlägigen Tests (inkl. der unveränderten P4-Testdatei) laufen grün, `node --check` sauber auf allen vier betroffenen Quelldateien.

---

## 7. Fix-Runden

**r1 — Branch `phase/ba-p5b-monatsfelder-fix1`** (von `phase/ba-p5b-monatsfelder` abgezweigt): behebt den einzigen zu diesem Zeitpunkt gemeldeten Blocker (T1/P11 — fehlender Test). `test/mcp-ui.test.js` um drei neue Regex-Assertions gegen `result.content[0].text` erweitert (je eine pro Achse, inkl. Werten aus `RICH_STATE`), sonst nichts angefasst.

**r2 — Branch `phase/ba-p5b-monatsfelder-fix2`** (von `-fix1` abgezweigt, Worktree per `node_modules`-Symlink vorbereitet): behebt den einzigen zu diesem Zeitpunkt gemeldeten Blocker (G5-Duplikat in `src/store/state-ops.js`). `spendMonthUsageCents` delegiert jetzt an `spendMonthWindowKey`, statt den identischen Schlüssel-Ausdruck ein zweites Mal zu konstruieren.

**Nach r2:** der finale Clean-Code-Lauf (Abschnitt 6) fand einen **neuen** S1 (Test-Lücke für den `null`-Fallback-Pfad), der in keiner der beiden Fix-Runden adressiert wurde — dieser Fund ist der Grund, warum das Gate weiterhin **BLOCKED** steht, trotz Safety-`approved` und behobenem G5-Duplikat.

---

## 8. Offene Deploy-Vorbedingungen

1. **Merge-Blocker (unmittelbar):** S1 aus Abschnitt 6 beheben — Testfall für `spendMonthKey === null` durch Route → Tool → Text/Schema, dann erneuten Clean-Code-Lauf gegen den Fix einholen.
2. **Empfohlen, nicht blockierend, vor Merge sinnvoll mitzunehmen:** die beiden S3-Funde (Lebenszeit-Label-Terminologie zwischen Text-Tool und Widget-i18n angleichen; `tenantCapEur` im Textblock optional durch `eurDigits()` formatieren oder die bewusste Nicht-Rundung kommentieren).
3. **Vor P7 zwingend (Safety-Concern, kein P5b-Blocker):** der fail-closed-Riegel hängt heute ausschließlich an `costCents`. Sobald P7 das Budget-Gate auf die Spend-Monat-Achse umlegt, muss ein gleichwertiger Korruptions-/Fail-closed-Riegel für `spendMonthCostCents` eingeführt werden — sonst blockt ein vergifteter Monats-Zähler nicht mehr fail-closed.
4. **Unverändert offen aus der Kette (nicht P5b-spezifisch):** Owner-Entscheidungen zu Cap-Höhe und Warn-Kanal, sowie der in `conversation-quality-v2-chain` notierte Boot-Guard für `CLAUDE_MODEL`/`PRECALL_BRIEFING_MODEL` — beide bleiben Vorbedingungen für P7, unabhängig vom P5b-Ausgang.
5. **Kein echter Runtime-Smoke-Test durchgeführt** (Boot-Guard verlangt reale Provider-Credentials + bootstrapten Tenant mit aktiver Nummer, außerhalb des Phasenumfangs) — vor einem Live-Deploy nachzuholen, kompensiert bislang nur durch den End-to-End-Testpfad über `api-read-parity.test.js`.
