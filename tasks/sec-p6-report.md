# Phase SEC-P6 — Detailbericht

**Titel:** Antwort statt Haenger + drei Struktur-Waechter
**Gate:** PASS
**finalBranch:** `sec/p6`
**headCommit:** `fac29f3a73a3e70820368a88e1e50ff567d4addf`
**Basis:** `master` @ `96ee103`
**Datum:** 2026-09-09

---

## 1. Auftrag (aus `PLAN-SEC-FIX.md` § SEC-P6, ergaenzt durch `tasks/sec-p6-spec.md`)

Zwei Probleme:

1. **GATE-02 — Haenger statt Ablehnung:** Stirbt eine der Gate-Datenquellen der Outbound-Kette (`POST /api/calls`), wirft die Gate-Kette. Express 4 faengt Rejections aus async-Handlern nicht — der Request bekommt kein Antwort-Byte und haengt bis zum Client-Timeout. Gemessen: 17 von 17 sterbenden Datenquellen fuehrten zu null Wahlversuchen (Sicherheitsversprechen hielt), aber 14 davon zu gar keiner Antwort.
2. **Drei fehlende Struktur-Waechter:** RLS-Abdeckung, Wahlfunktions-Aufrufer, Werkzeugsatz des Telefon-Agenten — bislang ungeprueft bzw. nur luecklich geprueft (`includes()` statt geschlossener Menge).

Zusaetzlich (c): das Skript `scripts/spike2-anruf.mjs` entfernen oder hinter dieselbe Gate-Kette legen — es waehlt heute direkt beim Anbieter an, an Denylist, Land-Gate, Kostendecke, Stundenlimit und `OUTBOUND_FROZEN` vorbei.

---

## 2. Plan (gekuerzt)

### 2.1 Zwei Befunde vor der Umsetzung

- **BLOCKER 0.1 — Waechter 3 war in der Vorlage falsch gemessen.** Die Vorlage erwartete `toolDefs("de")` liefere exakt `["end_call","get_consult","look_up","take_message"]`. Am Code gemessen liefert `toolDefs(language)` nur den festen Basissatz beider Engines (`["end_call","take_message"]`) — die vier Namen entstehen erst eine Ebene hoeher in der modul-privaten Funktion `agentTools(call)`, die `get_consult`/`look_up` bedingt anhaengt. Ein Waechter auf `toolDefs` waere sofort rot gewesen. Empfehlung: **Variante A** — `agentTools` aus `src/claude.js` exportieren (eine Zeile, keine Verhaltensaenderung) und dort in beiden Endzustaenden (offen/zu) pinnen. Fallback B (Messung ueber den Draht) wurde verworfen.
- **BLOCKER 0.2 — der naheliegende Fix (try/catch nur um die Gate-Schleife) behebt 14 der 17 Faelle nicht.** Die Ablehnungs-Senke der Route ruft nach dem Gate erneut `store.tenantGeo` (`denialDimensions`) — selbst eine sterbende Datenquelle. Stirbt sie, wirft die Senke ein zweites Mal, ausserhalb jedes Gates → wieder kein Antwort-Byte. Der Fix braucht daher zwei Teile: geworfenes Gate → Ablehnung, UND Zustellung der Ablehnung gegen ihre eigene Beobachtung (Audit/Metrik) abgesichert.

### 2.2 Produktionscode-Edits

1. **`src/telephony/outbound-gates.js`:** neue Modul-Funktion `runOutboundGates({gates, ctx})` — faehrt die Kette an einer Stelle; ein geworfenes Gate wird zu `503` + `audit(grund="gate_error", detail=" gate=<name>")` und **bricht ab** (`return`, kein `continue`). Anzeigetext bewusst sprachinvariant (`GATE_ERROR_MESSAGE`, Deutsch fest verdrahtet), weil die Sprachquelle der Kette selbst sterbend sein kann. Kette, Reihenfolge, `GATE_CHAIN_LENGTH`, jedes Praedikat und der spezifische `try/catch` von `reserve_budget` bleiben unveraendert.
2. **`src/routes/api-calls.js`:** Gate-Schleife ersetzt durch Aufruf von `runOutboundGates`; neue Modul-Funktion `beobachteAblehnung(denial, req, tenantId)` kapselt Audit+Metrik in eigenem `try/catch` — scheitert die Protokollierung, wird sie laut geloggt, die Ablehnung aber trotzdem zugestellt.
3. **`src/claude.js`:** `agentTools(call)` → `export function agentTools(call)` (eine Zeile, kein neuer Aufrufer in `src/`).

### 2.3 Neue Testdateien (Praefix `SEC-P6-…`, laeuft im Regressionslauf, nicht im Gates-Lauf)

- `test/sec-p6-gate-fehlerpfad.test.js` — Abnahme 1, echte Gate-Kette + echte Route, tabellengetrieben ueber alle Ketten-Datenquellen.
- `test/sec-p6-waechter-rls.test.js` — Waechter 1, RLS-Inventar via pglite, mit begruendeter Ausnahmeliste (`account`, `session`, `audit_log`) und Positiv-Kontrolle (Sonde ohne Policy).
- `test/sec-p6-waechter-wahlaufrufer.test.js` — Waechter 2, rein statischer Scan nach Datei+Symbol (keine Zeilennummern), mit Kommentar-Filter-Selbsttest und synthetischer Positiv-Kontrolle.
- `test/sec-p6-waechter-werkzeugsatz.test.js` — Waechter 3, `agentTools` bei offenen/zu Kanaelen, geschlossener Satz (2 vs. 4 Namen sind einander Positiv-Kontrolle).

### 2.4 Aufraeumen

- `scripts/spike2-anruf.mjs` geloescht (kein npm-Skript, kein knip-Eintrag, kein Test, keine Import-Kante; waehlte direkt beim Anbieter).
- `scripts/spike2-sip.mjs` unberuehrt (nur SIP-Strecken-Einrichtung, kein Wahl-Endpunkt).
- `tasks/spike2-messung.jsonl` bleibt (wird von zwei Bestandstests gelesen).

### 2.5 Pflicht-Nacharbeiten

- Lint-Pin (`eslint-legacy-exceptions.json`) fuer `src/routes/api-calls.js` nachgezogen — alle drei bewegten Werte SINKEN (complexity 28→26, Async-Arrow 145→140, `makeCallRoutes` 243→234).
- `PLAN-SECURITY.md`: GATE-02 als behoben markiert, `spike2-anruf.mjs` als entfernt markiert, neuer SEC-P6-Abschnitt inkl. Restrisiken A/B.
- `tasks/sec-fix-chain-state.md`: Phaseneintrag.
- Keine neue Env-Variable → keine Aenderung an `config.js`/`.env.example`/`render.yaml`/`BASE_ENV`.

### 2.6 Restrisiken (benannt statt gebaut)

- **Restrisiko A:** zwischen Gate-Kette und Origination liegen weitere werfende Aufrufe (`resolveCallLanguage`, `resolveCallPrivacyFlags`, `emitOpeningConsult`, `createCall`, `recordCostProfile`, `save`) — keine Gate-Datenquellen, nicht Teil dieser Phase, haengen im Fehlerfall weiterhin.
- **Restrisiko B:** Waechter 2 kennt nur die vier bekannten Wahlwege; ein neuer Weg per rohem `fetch` (die Klasse, die `spike2-anruf.mjs` verkoerperte) wird nicht erkannt. Minderung war Loeschung, nicht Nachruesten.

---

## 3. Implementierungs-Zusammenfassung

Vollstaendig umgesetzt und committet (`fac29f3` auf `sec/p6`).

**Vorher-Messung (Pflicht):** Harness gegen unveraenderten `master` gefahren — Testprozess terminierte NICHT, Request bekam kein Antwort-Byte, `server.close()` lief nie. Bestaetigt den Ist-Zustand aus dem Plan.

**Fix, zwei Haelften:**
1. `runOutboundGates({gates, ctx})` in `outbound-gates.js` — geworfenes Gate → 503 + `audit grund=gate_error gate=<name>`, Abbruch (`return`, kein `continue`).
2. `beobachteAblehnung` in `api-calls.js` — Audit/Metrik der Ablehnungs-Senke gegen eigenes Werfen abgesichert (die zweite Haelfte war der eigentliche Blocker, weil `denialDimensions` `store.tenantGeo` ein zweites Mal liest).

**Wirksamkeit per Gegenprobe belegt** (von Hand, nicht committet): `catch`→`continue` macht `SEC-P6-3` rot; `beobachteAblehnung` ohne `try/catch` laesst `SEC-P6-4` wieder haengen. Beide restauriert.

**18 neue Testfaelle** in vier Dateien:
- Fehlerpfad: SEC-P6-1..6, -2b, -6b (8 Faelle) — inkl. Owner-Invariante, dass `claimPlatformSpendWarning` nie ablehnen darf.
- RLS: SEC-P6-7..9 (3 Faelle).
- Wahlaufrufer: SEC-P6-10..12, -12b (4 Faelle).
- Werkzeugsatz: SEC-P6-13..15 (3 Faelle).

**Testlauf:** 503 pass, 0 fail (29 Dateien inkl. betroffener Bestandstests). `node --check` gruen fuer alle drei geaenderten `src`-Dateien. `eslint` ueber das ganze Repo: 0 Fehler. Pre-Commit-Hook (Suppressions + Lint) bestanden, kein `--no-verify`.

### Deviations (vom Plan abweichend, alle begruendet)

1. Waechter 3 misst `agentTools(call)` statt `toolDefs("de")` — Plan-Vorlage war falsch gemessen (s.o. 0.1), Variante A umgesetzt wie im Plan zur Wahl gestellt und empfohlen.
2. RLS-Inventar: 18 Tabellen mit `tenant_id` (nicht 19 wie im Plan geschaetzt), 15 mit FORCE+Policy, genau die drei Plan-Ausnahmen. Zahl im Test nicht hartkodiert, nur die Plan-Beschreibung war ungenau.
3. Vierte Konfigurations-Variante noetig (`paymentEnabled:true`) — sonst haette `SEC-P6-2` zwei Store-Quellen nicht gemessen (`tenantSubscription`, `planMinutesExceeded`).
4. `claimPlatformSpendWarning` ist keine der 17 gemessenen Faelle, eigener try/catch (Owner-Invariante: Warnung darf nie ablehnen) — eigener Fall `SEC-P6-6b`.
5. Zusaetzliche Luecken-Riegel-Faelle ueber den Plan hinaus: `SEC-P6-2b`, `SEC-P6-6b`, `SEC-P6-12b`.
6. `beobachteAblehnung`/`denialDimensions` sitzen auf Modul-Ebene statt in der Closure (wie im Plan skizziert) — sonst haette der pre-commit-Pin angehoben werden muessen; so sinken alle drei gepinnten Werte.
7. Spiegel der Altlast-Liste in `test/check-staged-suppressions.test.js` musste mitgezogen werden (dokumentierte Hauspraxis, kein neuer Eintrag, alle Werte sinken).

---

## 4. Safety-Urteil

**Verdict: PASS — SEC-P6 ist freigabefaehig.**

- `approved: true`, `testsPassIndependently: true`, `safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`, `scopeRespected: true`, `behaviorAsIntended: true`.
- Unabhaengiger Testlauf im frischen Worktree (`review-sec-p6` auf `sec/p6`): 503 Tests, 9 Suiten, 0 fail, 0 skipped, 20747 ms.
- **Scope eingehalten:** genau die drei Auftragsteile (Antwortverhalten, drei Waechter, Skript-Entfernung); keine neue Dependency (pglite war bereits Bestand).
- **Safety-Gates intakt:** Kette byte-gleich, `runOutboundGates` bricht ab statt weiterzulaufen (adversarial belegt: `kycReached` stirbt → `tryReserveOutboundBudget` 0-mal gerufen, 0 Wahlversuche). Alle 18 Ketten-Datenquellen einzeln sterbend gegen echte Route gefahren.
- **Offenlegung intakt:** `src/bridge.js` nicht im Diff; in `claude.js` nur der `export`-Zusatz.
- **Auth fail-closed intakt:** `internalOnly` unangetastet, keine Route/Middleware geaendert.
- **Secrets/PII sauber:** Logzeilen nennen nur Gate-Name/`fehler?.message`, Antwort-Body ohne Innenleben (per `SEC-P6-6` negativ gepinnt).

### Concerns (keine Blocker, Produktbefunde fuer Folgephasen)

1. `GATE_ERROR_MESSAGE` ist fest verdrahtet **Deutsch** in einem Produkt mit Weltdefault `en` — Sprach-Invarianz-Begruendung korrekt, aber die invariante Sprache haette Englisch sein sollen.
2. `beobachteAblehnung` verschluckt jetzt auch einen Wurf aus `audit()` selbst — Ablehnung wird zugestellt, Audit-Zeile fehlt (nur `console.error`), fuer den Client unsichtbar. Bewusst dokumentiert, von `SEC-P6-5` gepinnt.
3. Waechter 2 scannt nur `src/` und nur vier benannte Wahlwege per Regex — ein neuer Weg per rohem `fetch` oder etwas in `scripts/` wird nicht gefunden (Restrisiko B, s.o.).
4. Restrisiko A bleibt offen (s.o.) — als eigener Befund/eigene Phase ausgewiesen.
5. Verwaiste Verweise auf das geloeschte `scripts/spike2-anruf.mjs` in mehreren `tasks/*`-Dateien und `PLAN-SEC-FIX.md:212` — laut CLAUDE.md Bestandspraxis, kein Befund, nur Hinweis fuer den Lead.

---

## 5. Clean-Code-Audit (s1-s4)

**Verdict: PASS.** Keine S1/S2-Befunde.

- **s1 (Blocker-Klasse):** keine.
- **s2 (schwerwiegend):** keine.
- **s3 (mittel):** keine.
- **s4 (kosmetisch):** eine doppelte Leerzeile in `src/routes/api-calls.js:311-313` nach dem Verschieben von `denialDimensions` auf Modul-Ebene — rein kosmetisch, kein Verhaltensaspekt.

**passNotes:** Fail-closed durchgaengig (Wurf in einem Gate wird immer zur Ablehnung, nie zum Weiterlaufen); keine neue abgeschaltete Sicherung; kein Secret-Leak im Fehlerpfad; GAP-35-Bedingung unveraendert uebernommen; doppelter Fehlermodus (Gate wirft / Beobachtung wirft) beide sauber getestet inkl. Owner-Invariante der Fruehwarnung; drei neue Struktur-Waechter mit je eigener Positiv-Kontrolle; Loeschung von `spike2-anruf.mjs` behebt einen echten, dokumentierten Gate-Bypass; eslint-Pin-Historie und Suppressions-Test konsistent nachgezogen (alle Kennzahlen sinken); Syntax-Check und alle 18 neuen Tests isoliert gruen.

**Voller `npm test`-Lauf zeigte 1 Fail** (`test/number-gate.test.js`, "Land schlaegt Allowlist") — isoliert erneut gelaufen: gruen (46/46) → Suite-Flake, nicht durch diesen Diff verursacht (deckt sich mit dokumentierter Lehre `suite-flake-p5-gate-proof-spawn-race`).

**topTodos (offen, nicht blockierend):**
1. Doppelte Leerzeile in `api-calls.js` (Zeile ~311) entfernen — kosmetisch.
2. Vollen `npm test`-Lauf einmal wiederholen, um den `number-gate.test.js`-Flake sicher als Suite-Artefakt zu bestaetigen, bevor gemergt wird.

---

## 6. Fix-Runden

Keine Fix-Runde noetig — beide Reviews (Safety, Clean-Code) kamen im ersten Durchlauf auf PASS ohne Blocker. Die einzigen offenen Punkte sind als Concerns/topTodos dokumentiert, nicht als zu behebende Befunde dieser Phase.
