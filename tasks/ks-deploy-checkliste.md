# KS-Kette — was VOR dem Deploy von Hand passieren muss

Diese Datei sammelt alles, was die Kosten-Kette ausserhalb des Repos braucht.
Der Code allein ist nicht ausreichend. Owner-Aufgaben, nicht Agenten-Aufgaben.

## 1. DB-Migration (KS-P5) — BLOCKIEREND

`applySchema` laeuft in diesem Repo **nur in Tests**. Neue Spalten entstehen auf der
Prod-DB NICHT von selbst. Wird der Code deployt, bevor die Spalten existieren, bricht der
erste Anruf.

KS-P5 fuegt der Tabelle `call` zwei additive, nullable Spalten hinzu:

```sql
ALTER TABLE call ADD COLUMN IF NOT EXISTS estimated_cost_spend_month_key TEXT;
ALTER TABLE call ADD COLUMN IF NOT EXISTS estimated_cost_period_key TEXT;
```

Beide Anweisungen sind idempotent und laufen gefahrlos mehrfach.

Ausfuehren mit: `psql "$(cat ~/.config/hermes/db-url)"`
Bei `SSL connection has been closed unexpectedly`: das ist meist die IP-Allowlist, nicht
TLS — aktuelle IP im Render-Dashboard eintragen.

**Kein Backfill.** Rueckwirkend ist der Belastungs-Anker nicht erhebbar. `NULL` heisst
"Anker unbekannt" und laesst eine Gutschrift fail-closed nur auf der Lebenszeit-Achse
wirken — also das Verhalten vor KS-P5. Bestandszeilen verhalten sich damit unveraendert,
neue Anrufe bekommen den Anker.

## 2. Env-Werte im Render-Dashboard

| Variable | Stand | Anmerkung |
|---|---|---|
| `VOICE_TARIFF_DEFAULT_CENTS` | **erledigt** (E1, 30) | Code-Fallback ist mit KS-P6 nachgezogen |
| `MAX_BUDGET_EUR` | unveraendert lassen | seit KS-P9 keine Sperre mehr, nur noch Warnschwelle |
| `MAX_CALL_DURATION_S` | **offen bis KS-P3** | Live-Dienst ist Dashboard-managed; der Blueprint-Wert allein schaltet nichts |

## 3. Nach dem Deploy pruefen

- Boot-Banner zeigt den Worst-Case-Tarif 30 ct/min.
- Ein Outbound-Anruf schreibt `estimated_cost_cents = 30` (nicht 300) in die `call`-Zeile.
- Deploy-Stand nie aus einer Notiz lesen: `/healthz` gegen
  `git merge-base --is-ancestor <commit> master` pruefen.
