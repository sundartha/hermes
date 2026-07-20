# Abschlussreport: PLAN-CONVERSATION-QUALITY-V2 — autonome Phasen-Kette

**Datum:** 2026-07-18/19 · **Lauf:** eine Session, Lean-Lead + `phase-impl-lean`-Workflows
**Ergebnis:** alle 10 agenten-tauglichen Phasen umgesetzt, reviewt und auf `master` gemergt.
**Kein Push.** Weder `origin` noch `upstream`. Der Deploy ist eine Owner-Entscheidung.

> Geschrieben aus den strukturierten Workflow-Returns, nicht durch Nachlesen der Phasen-Reports.

---

## 1. Phasen mit Merge-Commits

Start: `e76eb71`, Suite **2422 / 0**. Ende: `6522b60`, Suite **2538 / 0**.

| Phase | Merge-Commit | Tests nach Merge | Fix-Runden | Extra-Review |
|---|---|---|---|---|
| P1b Buchen + Kalender abschalten (E1/L6) | `3977ed1` | 2421 | 2 | — |
| P1 Umlaut-Fix gesprochene Strings (Commit A) | `b104d9d` | 2425 | 1 | — |
| P2a Metriken + heardChars + Dashboard | `bc4ddc7` | 2433 | 1 | — |
| P2b Diagnose-Retention + `allowSummaries`-Leck | `ca93003` | 2456 | 0 | **Opus-Security-Review** |
| P3 Peinlichkeits-Defekte (Cap/Reprompt/Inbound) | `418035a` | 2467 | 1 | **Opus-Security-Review** |
| **P4 Bench härten** | **`b71cf3a`** | 2479 | 0 | — |
| P5 Prompt-Redesign (Commit B) | `6c84f2d` | 2486 | 1 | — |
| P6 Mandat statt Rückfrage | `d7d8d05` | 2513 | 0 | — |
| P7a Budget-Gate per-Modell-Preise | `ae0109f` | 2519 | 0 | **Opus-Security-Review** |
| P8 Pre-Call-Briefing | `6522b60` | 2538 | 0 | — |

Zusatz-Commit `e3713cd`: `tasks/lessons.md` zusammengeführt (siehe §4.1).

**`b71cf3a` ist der Baseline-Anker.** Auf diesem Commit erhebt der Owner den Vorher-Wert
(`git worktree add <pfad> b71cf3a`, dort `npm run convo-bench`), bevor er den Vergleich auf dem
Endstand fährt. Ohne diesen Hash ist der Vorher-Wert nicht mehr rekonstruierbar.

**Nicht in dieser Kette** (laut Kickoff): P0 (Owner-Tagebuch), P7b (Modell-Flip), P9 (Kalibrierung).

### Teststand

Voll-Suite auf `6522b60`: **2538 pass / 0 fail**, zweimal hintereinander grün.
Im ersten Lauf nach dem P8-Merge war 1 Test rot; zwei folgende Voll-Läufe grün, die neuen
P8-Tests isoliert 19/19, `telnyx-p5-gate-proof` isoliert 14/14. **Einschränkung:** der Name des
im ersten Lauf roten Tests wurde nicht mitgeschnitten — die Zuordnung zum bekannten ~12 %-Voll-Last-Flake
ist plausibel, aber nicht bewiesen.

---

## 2. Offene Owner-Schritte, in Arbeitsreihenfolge

### Stufe 0 — vor dem Deploy

1. **Boot-Guard für Modell-IDs bauen (Vorbedingung für P7b, nicht optional).**
   `CLAUDE_MODEL` **und** `PRECALL_BRIEFING_MODEL` sind env-gesetzt und werden nirgends gegen
   `config.llm.modelPricesUsd` validiert. Eine datierte Snapshot-ID (`claude-haiku-4-5-20251001`
   statt `claude-haiku-4-5`) landet bei **jedem** Turn im Fail-closed-Zweig: für das Budget-Gate
   die sichere Richtung, aber dieselbe Rate speist über `aiCostCents` den Stripe-Ledger —
   **echte Kunden würden ~3× zu hoch bepreist**. Vor dem Deploy den im Render-Dashboard
   gesetzten Wert prüfen; der Agent kann ihn nicht lesen.
2. **Deploy-Ziel beachten:** Render deployt **upstream**. `git push origin` allein macht nichts live.
   Live-Commit danach per `[boot]`-Banner verifizieren.
3. **Postgres:** P6 fügt `call.mandate JSONB` über `schema.sql` idempotent beim Boot hinzu —
   Boot-Log auf sauberen Schema-Durchlauf prüfen.

### Stufe 1 — Render-Env (Dashboard-managed, `render.yaml` ist NICHT autoritativ)

4. **`METRICS_ENABLED=true`** (P2a). Ohne diesen Flip ist P2a in Prod wirkungslos und P9 startet
   ohne `heardChars`-Baseline.
5. **`DIAGNOSTIC_RETENTION_DAYS` bleibt `0`** (P2b), bis der Datenschutztext live ist — dann auf `7`.
6. **`PRECALL_BRIEFING_ENABLED=true`** (P8), setzt `ASSISTANT_CONTEXT_ENABLED=true` voraus.
7. **`CAP_FAREWELL_LEAD_MS`** (P3) nur setzen, falls der Probeanruf eine Nachjustierung ergibt
   (Default 20000 trägt sonst ohne Eintrag).

### Stufe 2 — Website (läuft über `staging` + `hermes-web-staging`, live erst nach Merge auf `master` + manuellem `hermes-web`-Deploy)

8. **Datenschutzerklärung um den Diagnosemodus-Absatz ergänzen** (P2b). Fertiger Textvorschlag
   steht in `PLAN-CONVERSATION-QUALITY-V2.md` §5.1. Vom Agenten bewusst **nicht** editiert.
9. **Datenschutz-Bestätigung P8:** kein neuer Auftragsverarbeiter (nur Anthropic), keine neue
   Datenkategorie — vom Owner zu bestätigen.

### Stufe 3 — Messung

10. **Baseline auf `b71cf3a`** erheben (echte API-Kosten):
    `ANTHROPIC_API_KEY=… npm run convo-bench -- run --all --repeat 5 --label baseline-p4 --out data/convo-bench/baseline-p4`
    `data/` ist gitignored — Report separat sichern.
11. **Vergleichslauf auf dem Endstand** (n ≥ 5) über 6 Bestands- + 4 neue Szenarien.
    Pass-Rate-Definition: ein Repeat besteht, wenn **alle** seine Checks passen; bei n=5 heißt
    „≤ 40 %" also ≤ 2 von 5. Auswertungs-Einzeiler steht in `tasks/cq-p4-report.md`.
12. **Gate-Auswertung ohne Nachschärfen:** erreicht ein neues Szenario schon jetzt > 40 %,
    wird es dokumentiert und aus dem P5-Gate genommen (Kandidat 1: `hold-warteschleife`, weil bei
    zwei stillen Turns die P3.2-Staffel deterministisch antwortet, nicht das Modell). Fallen mehr
    als zwei der vier raus, entfällt P5-Kriterium (c) ersatzlos; (a) und (b) bleiben bindend.

### Stufe 4 — Probeanrufe (echte Kosten, nur Owner)

13. **P1b:** Inbound verspricht keinen Termin mehr. Zusätzlich: **Bestands-Greeting im Dashboard
    auf eine aktualisierte Vorlage umstellen** — C9 ändert nur den Default für *neue* Tenants,
    gespeicherte Greetings sprechen weiter „oder direkt einen Termin vereinbaren".
14. **P1 / P5:** klingt „Gespräch" als deutsches Wort? Frei generierter Umlauttext
    (z. B. Frage nach Öffnungszeiten) ist der eigentliche Test der Priming-These.
    **Bleibt der Effekt aus: die Umlaut-Anweisung im Prompt NICHT nachschärfen.**
15. **P3:** mit temporär kleinem `MAX_CALL_DURATION_S` prüfen, ob der Abschluss-Satz vollständig
    zu hören ist, bevor aufgelegt wird.
16. **P6:** sagt Haiku am Telefon im Mandat wirklich zu, statt zu punten?
17. **P8:** Probeanruf mit aktivem Briefing; ein realer Turn muss `usage.costCents` sichtbar erhöhen.

---

## 3. Sicherheits-Befunde und Restrisiken

Drei Phasen liefen durch ein **separates, unabhängiges Opus-Security-Review** mit dem Auftrag,
das jeweils vorige Review zu widerlegen. Alle drei: **APPROVED, keine Blocker.**

**P7a (Budget-Gate) — die Fallen wurden vermieden, nicht nur behauptet:**
- Der Kosten-Akku rundet **nicht** pro Inkrement (Mikro-Cent-Rest wird weitergetragen).
  Gegenbeweis am echten Code: 1000 Turns à 0,4 Cent ⇒ `costCents = 399`, nicht 0.
- Unbekanntes Modell ⇒ **teuerste hinterlegte Rate**, nie 0, nie Haiku-Default. 11 Fälle geprüft,
  inkl. `__proto__`/`constructor` (Prototype-Pollution) und leerer Tabelle.
- Testechtheit per **Mutation** bewiesen (Rückdrehen der Produktionslogik ⇒ 4/3/5/1/2 Fehler).

**Offene Restrisiken (kein Blocker, aber benannt):**

| # | Risiko | Phase |
|---|---|---|
| R1 | `CLAUDE_MODEL`/`PRECALL_BRIEFING_MODEL` ohne Boot-Guard ⇒ Überbepreisung echter Kunden | P7a/P8 |
| R2 | Kein Test pinnt die **Produktions**-Preiswerte (nur Namen) — ein zu niedriger Preis fällt niemandem auf | P7a |
| R3 | `privateNumber` ist formvalidiert, **nicht besitz-verifiziert** (kein OTP) — vorbestehend, aber Voraussetzung, bevor Diagnose-Retention scharf geht | P2b |
| R4 | **Kein Backfill:** vor dem Deploy geleakte Rohtranskripte räumt der neue Sweep nicht ab, sie fallen erst über `RETENTION_DAYS` | P2b |
| R5 | **Transkript-Untreue:** die Modell-Antwort wird geschrieben, dann kann der Cap-Abschied gewinnen ⇒ das Transkript enthält einen Satz, den der Anrufer nie gehört hat, und nicht den gesprochenen Abschied. Trifft Forensik und Summary. Ein LLM-Turn wird bezahlt und verworfen (max. 1/Call) | P3 |
| R6 | Kein Boot-Guard gegen `CAP_FAREWELL_LEAD_MS >= MAX_CALL_DURATION_S*1000` ⇒ lautloser Selbst-DoS bei Fehlkonfiguration (Fehlrichtung sicher: Calls enden früher, nie später) | P3 |
| R7 | `MAX_EMPTY_TURNS` darf für Inbound **nie** über 3 — Kostenachse ohne Budget-Gate (Carrier-Minuten sieht der Guard bei Inbound nicht, einziger Deckel ist der 180-s-Cap). Kein Code-Gate erzwingt das | P3 |
| R8 | Summary-SMS kippt durch Umlaute von GSM-7 auf UCS-2 ⇒ ~doppelte Segmentzahl beim Provider, während das Ledger pauschal `quantity:1` bucht. Entschärft durch `smsCostCents`-Default 0 | P1 |
| R9 | `scripts/convo-bench/runner.mjs` führt eine zweite, divergente Preistabelle (Sonnet-5-Einführungsrabatt statt Listenpreis) — reine Report-Zahl, kein Gate | P7a |
| R10 | `allowCalendar`/`allowBooking` bleiben als Settings-Felder ohne lesenden Konsumenten — bewusste, dokumentierte Inkonsistenz | P1b |

---

## 4. Beobachtungen aus dem Lauf (Pre-Mortem-relevant)

### 4.1 Ein Branch hätte lokale Arbeit lautlos gelöscht

Der P3-Branch legte `tasks/lessons.md` **neu** an (8 Zeilen). Im Arbeitsbaum lag eine untracked
Datei gleichen Namens mit **104 Zeilen** Lehren aus den Fragility-/Polish-A-Ketten. Ein normaler
Merge hätte sie überschrieben. Erkannt wurde das nur, weil das Security-Review es als Merge-Hazard
meldete. Beide Stände sind in `e3713cd` zusammengeführt, Backup im Session-Scratchpad.
**Lehre:** untrackte Dateien im Arbeitsbaum sind für Worktree-Agenten unsichtbar — sie legen sie
neu an, und der Merge klobbert.

### 4.2 Ein toter Impl-Agent erzeugt ein plausibles Schein-PASS

In P2a starb der Impl-Agent an einem API-Fehler und hinterließ einen **leeren** Branch. Der
Workflow lieferte trotzdem `gate: PASS` zurück — weil das Review korrekt blockierte, der Fix-Agent
die Phase dann selbst implementierte und das Re-Review auf echtem Code approvte. Der Return sah
mit `filesTouched: []` und `testPassCount: null` aber aus wie ein Erfolg ohne Arbeit.
**Lehre:** ein PASS aus dem Workflow ist kein Merge-Freibrief. `git diff --stat <branch>` gegen
die Basis kostet nichts und unterscheidet „fertig" von „nichts passiert". Dasselbe Muster trat in
P1 auf (Safety-Reviewer starb, leere Fix-Runde, PASS kam aus dem Ersatz-Review).

### 4.3 Was der Plan nicht wusste

- **P2a:** der Plan nahm an, es fehle nur die Anzeige — tatsächlich fehlte serverseitig
  `notifications` in `/api/self-service/state`. Additiv nachgezogen, vom Safety-Review abgenommen.
- **P8:** Abnahmekriterium (c) („Bench `termin-duenn` verbessert sich messbar") ist **nicht
  messbar**: der Bench-Runner seedet Calls direkt über `seedState`/`seedCall` und geht nie durch
  `POST /api/calls` — das Briefing läuft dort also gar nicht. Eine bench-seitige Verdrahtung ist
  bewusst nicht Teil von P8 und braucht eine Owner-Entscheidung, weil sie die Vergleichbarkeit
  des Szenarios verändert.
- **P3:** der Plan behauptet, der Retention-Sweep laufe „nur beim Boot" — es gibt einen 6-h-Timer.
  Die Implementierung ist hier genauer als der Plan.

### 4.4 Zur Todesursache-These des Plans (§2)

Die Kette hat **Qualität** repariert, nicht **Nutzen**. Das Pre-Mortem-Verdikt des Plans — die
wahrscheinlichste Todesursache ist fehlender Nutzen, nicht Gesprächsqualität — ist von dieser
Kette unberührt. P1b hat die Schein-Erledigung *entfernt*; P6 gibt dem Agenten mit dem Mandat
erstmals die Möglichkeit, im Rahmen einer Vollmacht **verbindlich zuzusagen**. Ob daraus echte
Aufträge werden, entscheidet P0 (Anlass-Tagebuch) — das läuft weiter beim Owner.

---

## 5. Offene Fragen an den Owner

1. Sollen `realtimeOpener` und `summarySystem` (dormanter bzw. nie gesprochener Pfad) orthografisch
   nachgezogen werden? Dann muss P1-U3 mit umgedreht werden. Default dieser Phase: **nein**.
2. Bench-Verdrahtung des Briefings (siehe 4.3) — ja oder nein?
3. Vorwarn-Stufe vor dem Cap: erst wiedervorlegen, wenn der Cap-Anteil über 5 % steigt —
   messbar erst mit `METRICS_ENABLED=true` in Prod.
