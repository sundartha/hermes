# Phase KV-P6: Der Ledger führt Geld in Mikro-Cent

**Gate=PASS** · finalBranch=`phase/kv-p6-ledger-mikro-cent` · headCommit=`024bd8382377b03e0caee5844361fe13e642e539`

## Befund (kurz)

101 von 101 bestehenden `ai_token`-Ledger-Zeilen tragen `cost_cents = 0`, weil der Preis je Einzelbuchung auf volle Cent gerundet wird. Die Gate-Achse (`trackUsage` / `budgetExceeded`) ist davon **nicht betroffen** — sie rechnet unabhängig in `costMicroCentsRem` exakt weiter und hat den Betrag nie verloren. Das Problem betraf ausschließlich den Ledger (`usage_event`-Tabelle/Datei), nicht die Kostendecke.

## EHRLICHKEITSREGEL — kein Nachbuchen der Altzeilen

**Diese Phase hat KEINEN Backfill durchgeführt.** Die 101 bestehenden `ai_token`-Zeilen mit `cost_cents = 0` bleiben unverändert bei `0`. Die neue Spalte `cost_micro_cents` ist bei diesen 101 Zeilen `NULL` — nicht `0`, aber eben auch nicht nachträglich berechnet oder gefüllt.

**Wer diese 101 Zeilen in einem halben Jahr aufsummiert (egal ob über `cost_cents` oder `cost_micro_cents`), misst nichts.** `cost_cents` war und bleibt bei ihnen 0 (verlorene Rundung); `cost_micro_cents` ist bei ihnen `NULL` (kein Wert, keine Zahl, kein Nachtrag). Nur Zeilen, die **nach** dem Deploy dieser Phase neu geschrieben werden, tragen einen echten `cost_micro_cents`-Wert. Jede Auswertung, die vor dem Deploy-Zeitpunkt liegende Zeilen einschließt, unterschätzt die tatsächlichen KI-Kosten systematisch — das ist mit dieser Phase nicht behoben und wurde bewusst nicht angegangen (out of scope, s. u.).

## Was gebaut wurde

- Eine neue, reine Funktion `tokenCostMicroCents(tokens, cfg)` in `src/store/state-ops.js`, direkt neben der bereits vorhandenen `tokenCostUsd`. Sie ist die **einzige** Stelle, an der der Mikro-Cent-Betrag berechnet wird.
- `trackUsage` (Gate-Achse) wurde auf einen Aufruf dieser Funktion umgestellt — wertidentische Extraktion, keine Verhaltensänderung (die entfernte Inline-Formel ist jetzt der Funktionskörper).
- `llm-usage.js` (`meterAiTokens`) ruft **dieselbe** Funktion mit denselben `tokens`/`config.llm` auf, um den Ledger-Eintrag (`recordUsageEvent`) zu füllen.
- `recordUsageEvent` (state-ops.js) hat ein neues, additiv-nullables Feld `costMicroCents` (Default `null`) im Event-Objekt.
- Beide Backends (json.js, pg.js) tragen das Feld durch. pg.js: SELECT, Row-Mapping und INSERT je um `cost_micro_cents` erweitert.
- Kommentar in `src/billing/cost-ledger-map.js` präzisiert (Preisquelle), kein Verhaltensunterschied.

## Die Schema-Zeile (Wortlaut)

```sql
-- cost_micro_cents (KV-P6): ungerundeter KI-Kosten-Betrag in Mikro-Cent (1 Cent = 1e6,
-- MICRO_CENTS_PER_CENT, state-ops.js). Additiv NULLABLE: nur ai_token-Belege fuellen sie
-- (tokenCostMicroCents, dieselbe Preisformel wie das Gate-Carry in trackUsage); jedes
-- andere kind und jeder Bestands-Beleg VOR dieser Phase traegt NULL, NICHT 0 - eine 0
-- waere eine erfundene Messung (kein Backfill, s. Phasenbericht KV-P6). BIGINT statt
-- NUMERIC/Float (G26) - reale Lebenszeit-Summen ueberschreiten den INT4-Bereich
-- (~2,1 Mrd.) schon bei wenigen zehn Euro KI-Kosten in Mikro-Cent-Aufloesung.
ALTER TABLE usage_event ADD COLUMN IF NOT EXISTS cost_micro_cents BIGINT;
```

## Urteil zur automatischen Migration (N5)

**Die Kette hält — selbst am Code verifiziert, keine Vermutung.**

| Behauptung | Beleg |
|---|---|
| `init()` ruft `migrate()` unbedingt | `src/store/pg.js:74`: `await migrate(client, BOOTSTRAP_TENANT_ID);` |
| `init()` wird awaited, Fehler beendet den Prozess | `src/store.js:44`: `await store.init();`; `src/store.js:56-66`: `catch (e) { console.error(...); process.exit(1); }` |
| `migrate` führt das Schema-Skript aus | `src/db/migrate.js:266-267`: `export async function migrate(db, tenantId) { await applySchema(db); ... }`; `applySchema` liest `src/db/schema.sql` und ruft `db.exec(ddl)` |
| Schema-Datei enthielt bereits dasselbe Muster | `src/db/schema.sql:557`: `ALTER TABLE usage_event ADD COLUMN IF NOT EXISTS number_id TEXT;` (identisches Idiom, bereits live) |

**Was das für den Deploy bedeutet:** Da der Dienst produktiv läuft (der Boot-Guard würde sonst `exit(1)` auslösen), ist `applySchema` auf der Live-DB bereits erfolgreich durchgelaufen — die neue `ADD COLUMN IF NOT EXISTS`-Zeile läuft beim nächsten Boot automatisch mit. **Kein manueller `psql`-Handgriff nötig** — anders als bei den meisten sonstigen Schema-Änderungen in diesem Repo (die MEMORY-Notiz "keine automatische DB-Migration" bezieht sich auf **Backfills von Dateninhalt**, nicht auf DDL/`ADD COLUMN`; diese Unterscheidung wurde in dieser Phase unabhängig am Code bestätigt, nicht nur behauptet). Die Safety-Review merkt an, dass die MEMORY-Notiz präzisiert werden sollte, damit sie nicht falsch verallgemeinert wird — das ist ein offener Doku-Punkt, kein Blocker.

## Beweis der exakten Gleichheit

Kerntest (KV-P6-1): 100 Turns à 5000 Token (465.000 Mikro-Cent pro Turn, gerechnet über die produktiven `PRICES`). Ergebnis:

- `ledgerMicroSum` (Summe der `cost_micro_cents` aus allen geschriebenen `usage_event`-Zeilen) = 46.500.000
- Gate-Achse: `usage.costCents * MICRO_CENTS_PER_CENT + usage.costMicroCentsRem` = 46 × 1.000.000 + 500.000 = 46.500.000
- Abweichung: 0

**Stammen beide Werte aus derselben Rechenquelle?** Ja — das ist der Punkt, nicht nur das Ergebnis. Beide Aufrufstellen (`trackUsage` für die Gate-Achse, `meterAiTokens`/`recordUsageEvent` für den Ledger) rufen dieselbe Funktion `tokenCostMicroCents(tokens, cfg)` mit denselben Eingaben auf. Es handelt sich nicht um zwei unabhängig geschriebene Formeln, die zufällig übereinstimmen (das wäre keine belastbare Gleichheit, sondern ein Zufallstreffer, der bei der nächsten Preisänderung auseinanderläuft) — sondern um eine Funktion, zweimal aufgerufen. Die Mutationsprobe (s. u.) bestätigt, dass ein Auseinanderlaufen der Formel den Test zuverlässig rot färbt.

## Mikro-Cent-Konstante

`MICRO_CENTS_PER_CENT = 1_000_000`, bereits vorhanden in `src/store/defaults.js:189` (dort schon von `trackUsage` genutzt). Keine neue Konstante angelegt — wiederverwendet.

## Beide Backends

- **json.js**: keine Codeänderung nötig — `recordUsageEvent` reicht das Objekt (inkl. `costMicroCents`) unverändert durch. Belegt durch KV-P6-6 (Wert landet in `store.json`).
- **pg.js**: SELECT, Row-Mapping und INSERT je um `cost_micro_cents` erweitert. Belegt durch KV-P6-5 (pglite-Roundtrip inkl. BIGINT-Wert über 2^31 und NULL bei fehlendem Wert).

## Grenzfälle

- `kind !== 'ai_token'`: `costMicroCents` bleibt `null` (Default-Parameter), kein erfundener Wert.
- Bestandszeilen vor dieser Phase: Spalte ist `NULL` (nicht `0`) — s. Ehrlichkeitsregel oben.
- Betrag rundet sich in Cent auf 0, ist aber in Mikro-Cent > 0: wird jetzt korrekt im Ledger sichtbar (das ist der eigentliche Zweck der Phase).
- BIGINT statt INT4/NUMERIC: reale Lebenszeit-Summen in Mikro-Cent-Auflösung überschreiten den INT4-Bereich (~2,1 Mrd.) schon bei wenigen zehn Euro Gesamtkosten.

## Mutationsprobe

`tokenCostMicroCents` testweise verändert auf `Math.round(usd*eur*CENTS_PER_EUR) * MICRO_CENTS_PER_CENT` (Rundung **vor** der Skalierung auf Mikro-Cent statt danach). Ergebnis: KV-P6-1 (`ledgerMicroSum` 0 statt 46.500.000) und KV-P6-4 (0 statt 465.000) wurden rot. Mutation zurückgenommen, `node --check` + volle Suite (3855/3855) wieder grün. Die Mutationsprobe belegt, dass der Kerntest eine echte Formel-Divergenz fängt, nicht nur zufällig grün ist.

## Angepasste Bestandstests

- `test/store-pg.test.js`: nichts Bestehendes geändert — nur KV-P6-5 als neuer Test nach dem bestehenden `usage_event`-Test angehängt (gleiches Testmuster übernommen).
- `test/kv-p1-cost-ledger-map.test.js`: unverändert gelassen, bleibt grün (KV-P1-3 prüft weiter `costCents === 0`, ist von `costMicroCents` unberührt).

Neue Testdateien: `test/kv-p6-micro-cent-ledger.test.js`, `test/kv-p6-json-durchstich.test.js`.

Abweichung vom Plan: der Grenzfalltest "fehlender Wert bleibt NULL" wurde zusätzlich als eigener Test `KV-P6-3b` in die Kern-Testdatei aufgenommen (statt unter der Nummer `KV-P6-5`, um Namenskollision mit dem gleichnamigen pg-Test zu vermeiden).

## Safety-Urteil

Safety-Review (final): **approved**. Tests unabhängig nachvollzogen (3835/3835 grün, kein Flake beobachtet — Zahl weicht leicht von der Impl-Meldung 3855/3855 ab, beide Läufe grün ohne Fehlschläge). Scope respektiert, Gate-Achse unangetastet, `cost_cents` unverändert, Stripe-Payload unverändert, exakte Gleichheit bestätigt, kein Float für Geld, beide Backends abgedeckt, Spalte additiv-nullable, kein Backfill, keine Map-Werte geändert, keine Secrets geleakt, bestehende Assertions nicht abgeschwächt. Einziger Concern (kein Blocker): die ältere MEMORY-Notiz zu Migrationen sollte präzisiert werden (Backfill vs. DDL), damit sie nicht falsch verallgemeinert wird.

## Clean-Code-Audit

Verdict: sauber. S1/S2 = leer (keine Blocker). S3 nennt einen Nicht-Verstoß zur Vollständigkeit (`GROSS_BETRAG`-Testkonstante in `test/store-pg.test.js`, bereits kommentiert). Eine Preisformel für Gate und Ledger, bestehende Konstante `MICRO_CENTS_PER_CENT` wiederverwendet (keine zweite Konstante angelegt), additiv-nullable ohne Backfill, BIGINT sachlich begründet, Kommentare in `cost-ledger-map.js` aktualisiert. 8 Tests inkl. Grenzfällen grün.

## Fix-Runden inkl. Fehlalarme

Keine Fix-Runde nötig — die IMPL-Phase lief in einem Durchgang durch, Mutationsprobe bestätigte den Kerntest sofort korrekt. `test:gates` hing dokumentiert bei `auth-p9a-cache-headers` (bekanntes Repo-Muster, kein KV-P6-Bezug) — abgebrochen und gemeldet, keine Reparatur versucht, da ein isolierter Lauf dieses Tests vorher grün war.

## Was diese Phase NICHT tut

- **Gate-Achse unangetastet**: `trackUsage`/`budgetExceeded` verhalten sich bit-identisch wie vorher (wertidentische Extraktion, kein neuer Parameter, kein geändertes Rückgabeverhalten).
- **`cost_cents` unverändert**: bleibt exakt die gerundete Cent-Zahl wie vorher, für alte wie neue Zeilen.
- **Stripe-Payload unverändert**: `reportMeter` (`billing/stripe.js`) sendet weiterhin nur `{tenantRef, kind, quantity, idempotencyKey}` — kein `costCents`/`costMicroCents` verlässt den Dienst Richtung Stripe.
- **Landkarte (`cost-ledger-map.js`) unverändert**: `ledger: true, gate: true` für `ai_token` bleibt wie vorher, nur ein Kommentar wurde präzisiert.
- **Kein Backfill** der 101 Altzeilen (s. Ehrlichkeitsregel oben — der zentrale Punkt dieses Berichts).

## Was der Lead nach dem Deploy prüfen muss

1. **Existiert die Spalte in Prod wirklich?**
   ```sql
   SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_name = 'usage_event' AND column_name = 'cost_micro_cents';
   ```
   Erwartet: eine Zeile, `data_type = bigint`, `is_nullable = YES`.

2. **Tragen NEUE Zeilen (nach dem Deploy) einen Wert > 0?**
   ```sql
   SELECT id, kind, cost_cents, cost_micro_cents, occurred_at
   FROM usage_event
   WHERE kind = 'ai_token' AND occurred_at > '<Deploy-Zeitpunkt>'
   ORDER BY occurred_at ASC
   LIMIT 20;
   ```
   Erwartet: `cost_micro_cents` ist bei diesen Zeilen befüllt (typischerweise > 0, auch wenn `cost_cents` weiterhin oft 0 ist). Zeilen vor dem Deploy-Zeitpunkt bleiben zum Vergleich `NULL` — das ist erwartet, kein Fehler (s. Ehrlichkeitsregel).
