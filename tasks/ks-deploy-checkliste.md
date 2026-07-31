# KS-Kette — was VOR dem Deploy von Hand passieren muss

Diese Datei sammelt alles, was die Kosten-Kette ausserhalb des Repos braucht.
Der Code allein ist nicht ausreichend. Owner-Aufgaben, nicht Agenten-Aufgaben.

## STAND 2026-07-31 — ABGEARBEITET, Kette ist LIVE

| Schritt | Stand |
|---|---|
| DB-Migration (beide Spalten) | erledigt, per `information_schema` verifiziert |
| Push nach `upstream` | erledigt, `upstream/master = d6167bf` |
| Telnyx-App `3014656686179747728` | geloescht (war eine **TeXML**-App, daher im Portal schwer zu finden); `DELETE` 200, Gegenprobe `GET` 404 |
| Render-Dienst `hermes-spike-al-p2` | vom Owner geloescht |
| Deploy Gateway | erledigt, `dep-d9m57abl550s73d8umtg` |
| `/healthz` | `commit=d6167bf...` |
| Boot-Banner | `Worst-Case-Tarif 30 ct/min`, `Plattform-Warnschwelle 3000 ct`, `(nur Beobachtung/Warnschwelle, KS-P9)` |
| Kein fataler Boot-Guard | bestaetigt — auch der neue `planCapReserveFindings` (KS-P3a) feuert nicht |

**Offen:** ein echter Outbound-Anruf, um `estimated_cost_cents = 30` in der `call`-Zeile
zu belegen (s. Abschnitt 4). Das ist die einzige Zusage der Kette, die noch nicht am
Live-System gemessen ist.

**Nebenbefund aus dem Boot-Banner:** `BUDGET_MONTH_ENABLED=true` ist live bestaetigt —
die Decken sind Monats-Werte, kein Lebenszeit-Topf. Diese Frage war bis hierher offen und
stuetzte sich nur auf eine Notiz.

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
| `MAX_CALL_DURATION_S` | **entfaellt** (KS-P3, E2/E3) | Der Key wird nicht mehr gelesen. Ein im Dashboard stehengebliebener Wert ist ab diesem Deploy WIRKUNGSLOS - er kann kein Gespraech mehr kuerzen. Aufraeumen darf der Owner, muss er aber nicht. Die nutzbare Dauer faellt jetzt pro Call aus dem Restguthaben (Notbremse `min(Restminuten + 1 min, 1800 s)`); die 1800 s sind hartkodiert und bewusst kein Knopf. |

## 3. Externe Reste loeschen (AL-P2-Spike, abgeschlossen)

Der Spike-Schalter ist mit KS-AUF aus dem Code entfernt. Die beiden externen Artefakte
kann ich nicht loeschen — fuer Render habe ich nur lesende Tools plus Env-Update und
Deploy-Trigger, fuer Telnyx gar keins:

- **Render-Dienst** `hermes-spike-al-p2` — ID `srv-d9kt9bm1egvs738asd0g`
- **Telnyx-App** `AL-P2 Spike Silence` — ID `3014656686179747728`

Beide laufen sonst als bezahlte Reste weiter.

## 4. Nach dem Deploy pruefen

- Boot-Banner zeigt den Worst-Case-Tarif 30 ct/min.
- Ein Outbound-Anruf schreibt `estimated_cost_cents = 30` (nicht 300) in die `call`-Zeile.
- Deploy-Stand nie aus einer Notiz lesen: `/healthz` gegen
  `git merge-base --is-ancestor <commit> master` pruefen.
