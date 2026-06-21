# Phase G0 — Repro-Harness & Instrumentierung

**Status:** Gate = **PASS**
**finalBranch:** `phase/g0-harness`
**Einordnung:** Fundament-Phase, **reine Test-Infrastruktur — kein `src/`-Diff, kein Verhaltens-Diff.**
**HEAD-Commit:** `906ca70cb9465e8196306ccccccac2ad189e7ce3`

---

## 1. Plan (gekuerzt)

G0 ist gemaess `PLAN-CONVERSATION-QUALITY.md` §3 reine Test-Infrastruktur. Ziel: die heute ueber drei
Test-Dateien (`outbound-premature-close.test.js`, `outbound-greeting.test.js`,
`disclosure-outbound.test.js`) verstreute Outbound-/Turn-Choreografie in **einen** wiederverwendbaren
Helper buendeln, gegen den G1-G4 ihre TeXML-/Identitaets-Asserts fahren — plus **ein** Baseline-Test,
der den heutigen leeren-`<Gather/>`-Deadlock deterministisch offline reproduziert (in G2 ins Positiv
gedreht).

**Belegte Duplizierung (am master-Code verifiziert), die G0 legitim extrahiert:**
- `outboundThenTurn(...)` — lokale zweistufige Kette (`/voice/outbound` -> `/voice/turn`) in
  `outbound-premature-close.test.js`.
- `outboundBody(provider)` — einstufig, LLM-frei, dupliziert in `outbound-greeting.test.js`, fast
  identische Inline-Variante in `disclosure-outbound.test.js`.
- `assertDisclosureBefore(body, marker)` — **byte-identisch dupliziert** in zwei Dateien (klassisches
  G5/S2).
- Marker-Konstanten (`DISCLOSURE`, `GATHER`, `HANGUP`) ueber die Dateien dupliziert.

**Deadlock-Wurzel (Baseline-Anker):** `/voice/outbound` rendert
`[sayD(disclosure), ...turnDirectives(call, "")]`. `turnDirectives(call, "")` -> `gatherD({ promptText: "" })`.
Beide Renderer behandeln leeren `promptText` als **self-closing `<Gather .../>` ohne inneren `<Say>`**.
Genau dieses Fehlen eines Anliegen-`<Say>` im Erst-Turn ist der heutige Deadlock.

**Plan-Bausteine:**
1. Neue Datei `test/_outbound-harness.js` — Unterstrich-Praefix = Helper (analog `helpers.js`); baut auf
   `test/helpers.js` (`startServer`/`seedState`/`seedCall`) auf, dupliziert **keine** Spawn-Logik, kein
   `src/`-Produktionsimport. Exporte: Marker (`DISCLOSURE_JONAS`/`GATHER_OPEN`/`HANGUP_TAG`),
   `assertDisclosureBefore`, `runOutbound({...})` (F1 Optionen-Objekt), `runOutboundThenTurn({...})`,
   Anthropic-Mock-Fabriken.
2. Neue Datei `test/outbound-first-gather-baseline.test.js` — pinnt offline+deterministisch den
   Erst-Turn-Deadlock fuer beide Provider ueber Diskriminator `sayCount === 1` (genau die Offenlegung,
   kein Anliegen). G2 dreht ihn auf `=== 2`.
3. Refactor der drei Bestandsdateien auf Import aus dem Harness — verhaltensneutral, Asserts unveraendert
   (sonst entstuende **neue** Doppelung: Harness + drei Inline-Kopien).
4. Test-Begruendung: nur der Baseline-Test ist neues Verhalten; der Harness selbst braucht keinen eigenen
   Test (Korrektheit transitiv ueber die migrierten, unveraendert gruenen Bestandstests).
5. Absolute-Regeln-Check: keine Safety-Gate-/Auth-/Disclosure-/Secret-/MCP-Pfade beruehrt; Diagnose-Logs
   `[turn-recv]`/`[turn-ok]` bewusst **nicht** entfernt (Live-Diskriminator bis G4); kein neuer
   `config`-Var -> kein BASE_ENV-Nachzug; keine neue npm-Dependency.
6. Pruefbares Ergebnis: `npm test` byte-identisch gruen + 2 neue Baseline-Faelle (twilio + telnyx).

**Offene Mikro-Entscheidung (delegiert):** Always-`Premature`/`4xx`-Mocks in den Harness ziehen
(Variante A, konsistent) oder lokal belassen (Variante B, minimaler Blast-Radius).

---

## 2. Impl-Zusammenfassung

G0 exakt gemaess Plan umgesetzt: reine Test-Infrastruktur, kein `src/`-Diff, kein Verhaltens-Diff.

- **Neu `test/_outbound-harness.js`** — buendelt die dreifach kopierte Outbound-/Turn-Choreografie
  (`runOutbound`/`runOutboundThenTurn`, `assertDisclosureBefore`, Anthropic-Mocks, Marker) in eine
  Quelle (G5/S2). Baut auf `helpers.js` auf, kein Produktionsimport.
- **Neu `test/outbound-first-gather-baseline.test.js`** — pinnt offline+deterministisch den heutigen
  Erst-Turn-Deadlock (genau 1 `<Say>` = Offenlegung, kein Anliegen im selben Turn; kein `<Hangup>`) fuer
  beide Provider. G2 dreht ihn ins Positiv.
- **Refactor** der drei Bestandsdateien (`outbound-premature-close`, `outbound-greeting`,
  `disclosure-outbound`) verhaltensneutral auf den Harness; Bestands-Asserts unveraendert.

**Verifikation:** `node --check` auf alle 5 Dateien gruen; `npm test` **710/710** gruen (vorher 708,
+2 Baseline-Faelle), offline, ohne `.env`; gezielter Lauf der 4 betroffenen Dateien **13/13** gruen.
Commit `906ca70` enthaelt nur die 5 Testdateien (node_modules-Symlink nicht committet).

**Smoke:** Kein separater curl-Smoke noetig — die Harness-Tests starten den echten Server als
Kindprozess und fahren `/voice/outbound` + `/voice/turn` live durch.

**Dateien:**

| Datei | Art | `src/`-Diff? |
|---|---|---|
| `test/_outbound-harness.js` | neu (Helper) | nein |
| `test/outbound-first-gather-baseline.test.js` | neu (Baseline-Test) | nein |
| `test/outbound-premature-close.test.js` | Edit (Import statt lokaler Def.) | nein |
| `test/outbound-greeting.test.js` | Edit (Import statt lokaler Def.) | nein |
| `test/disclosure-outbound.test.js` | Edit (Boilerplate -> Harness) | nein |

### Deviations

1. **Lebenszyklus-Variante (Abschnitt 3a, bewusst vom ersten Plan-Entwurf korrigiert):**
   `runOutbound` UND `runOutboundThenTurn` schliessen den Server **intern** (`finally`) und geben **kein**
   `srv`-Handle zurueck — statt Handle + `try/finally` beim Aufrufer. Im Plan unter 3a explizit als die
   kleinere, weniger fehleranfaellige Variante entschieden (G31: keine vom Aufrufer zu wahrende
   Stop-Reihenfolge). Der Baseline-Test ist entsprechend ohne `try/finally` vereinfacht.
2. **Offene Mikro-Entscheidung (Abschnitt 8): Variante (A) gewaehlt** — alle drei Anthropic-Mock-Fabriken
   (Counting/AlwaysPremature/Always4xx) in den Harness gezogen, da sie bereits in **einer** Datei
   zusammenlebten und der reale Konsument (`outbound-premature-close`) sie alle nutzt.

---

## 3. Safety-Urteil

**APPROVED.**

- `approved: true`, `testsPassIndependently: true`, `safetyGatesIntact: true`, `disclosureIntact: true`,
  `authFailClosedIntact: true`, `noSecretsLeaked: true`, `scopeRespected: true`,
  `behaviorAsIntended: true`.
- **Unabhaengige Verifikation:** JSON-Backend (Prod-Default) `npm test` = **710/710** pass, 0 fail,
  0 skip. G0-Tests direkt: **13/13** pass, 0 skip/only/todo. pg-Backend (`STORE_BACKEND=pg`):
  672 pass / 8 fail — **alle 8 Fehler umgebungsbedingt** (`[store] FATAL: DB unerreichbar,
  AggregateError`, kein lokaler Postgres) und **pre-existing auf master**; keine der 8 Dateien wird von
  G0 beruehrt (G0-Diff ist rein test-land).
- **Blocker:** keine.
- **Concerns:** (a) pg-Fehler lokal umgebungsbedingt + pre-existing, ausserhalb G0-Scope, vom Lead in
  Postgres-Umgebung gegenpruefbar; (b) reiner Test-Refactor — die gepinnten Invarianten
  (Disclosure-Bindung, `/voice/outbound` LLM-frei) sind hier nur als Erwartungen festgehalten; die
  eigentliche Identitaets-Bindung-Logik kommt erst in spaeteren G-Phasen. G0 dokumentiert korrekt den
  IST-Zustand (Deadlock-Baseline) und weicht nichts auf.

**Verdict:** Sauberer, scope-treuer Test-Harness-Refactor: 5 Test-Dateien, null
src/config/dependency-Diff, kein neuer npm-Dep. Dreifach kopierte Spawn-/Mock-Logik (G5/S2) in
`test/_outbound-harness.js` zentralisiert (kein Produktionsimport, baut auf `helpers.js`). Alle
bestehenden Assertions byte-aequivalent erhalten (Disclosure-Wortlaut, Disclosure-vor-Gather,
kein-Hangup, LLM-frei-Diskriminator, Retry-Grenzen, Degradation-vs-generischer-Fehler). Der
Baseline-Test pinnt korrekt den Leer-Gather-Deadlock (`sayCount === 1`) als IST-Stand fuer G2.
Safety-Gates, Auth, Secrets, Audio-MCP-Regel unberuehrt.

---

## 4. Clean-Code-Audit

**Verdict:** PASS · `blocker: false` · Diff +248/-216 (5 Dateien, rein test-land).

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3 (Nits):**
  - G19/N1 · `test/_outbound-harness.js:84,103` · `runOutbound`/`runOutboundThenTurn` akzeptieren `env`;
    `runOutbound` reicht es nur an `startServer` durch, `runOutboundThenTurn` merged es in
    `{ANTHROPIC_BASE_URL, ...env}`. Verhalten korrekt; der `env`-Param bei `runOutbound` hat im
    aktuellen Scope noch keinen Aufrufer (latente Vorab-Generalitaet, P15/BDUF-nah, minimal/plausibel
    fuer G1/G2). Fix optional.
  - C-Hinweis (kein FLAG) · `test/_outbound-harness.js` · sehr kommentarreich, aber jeder Kommentar
    traegt echten Domaenen-/Regel-Kontext (Regel 2, SDK-0.39-Premature-close-Mechanik,
    G6/G13-Begruendung) — kein C3-Redundanz-Verstoss, bewusst belassen.
- **S4 (Mikro):**
  - F1 (grenzwertig, kein FLAG) · `runOutbound`/`runOutboundThenTurn` nutzen ein Options-Objekt mit
    Defaults statt >3 Positionsargumenten — genau die in F1 empfohlene Loesung. PASS.

**passNotes:** Reiner Test-Land-Diff, keine Produktions-/Safety-Logik beruehrt. Kernziel erreicht:
bisher DREIFACH kopierte Offline-Bank in EINE Quelle gezogen — starke S2/G5-Reduktion. Saubere
DIP-Schichtung (baut auf `helpers.js`, kein `src/`-Import). G31 explizit adressiert (Server intern via
`finally` geschlossen, kein `srv`-Handle nach aussen). G6/G13 korrekt: provider-spezifisches
`<Say voice=...>`-Markup (`SAY_OPEN`) bleibt lokal in `disclosure-outbound`. Marker/Konstanten benannt
(kein Magic — `DEFAULT_CALL_ID`/`CALL_SID`/`EXPECTED_SAY_COUNT`), `assertDisclosureBefore` mit
dokumentiertem Default. Konventionstreu (ESM, deutsche umlautfreie Kommentare).

**topTodos:** (1) Optional: ungenutzten `env`-Param von `runOutbound` erst mit dem ersten echten
Konsumenten (G1/G2) einfuehren, sonst belassen — minimal, kein Blocker. (2) Merge freigeben: S1 und S2
leer, Gate = PASS.

---

## 5. Fix-Runden

**0 Fix-Runden.** Gate war direkt PASS (Safety APPROVED, Clean-Code S1/S2 leer). Keine Nachbesserung
vor Freigabe noetig; die verbliebenen S3/S4-Punkte sind optionale Nits ohne Blocker-Charakter.
